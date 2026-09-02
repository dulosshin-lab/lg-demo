/* 편집 모드 위반 판정.

   `Sched.validate()` 는 **자동 편성 결과**를 검사하려고 만들어졌다. 손으로 고친 편성표에
   그대로 쓰면 두 가지가 어긋난다 — 실데이터로 확인한 내용이다.

   ① 학력 — validate 는 "학력 구간끼리 겹치나"(집합 대 집합)를 묻는다. 석사 한 명을 학사
      구간으로 옮기면 석사의 '구간' 이 그 한 명 때문에 학사 블록을 통째로 삼켜서
      「석사 구간 안에 학사 37건이 끼어듦」 이 나온다. 손대지 않은 37명을 범인으로 지목한다.
      → 여기서는 "이 사람이 자기 학력의 기준 구간 밖에 있나"(사람 단위)를 묻는다.
        기준은 1차 자동 편성 결과의 구간이다. 위반 수 = 담당자가 예외로 둔 사람 수가 된다.

   ③ 연속 — validate 는 "조 분산" 과 "세션 끊김" 을 따로 세어 같은 사정을 두 번 센다.
      담당자가 신경 쓰는 것은 「이 팀이 하루에 몇 번 들어와야 하나」 — 곧 덩어리 수다.
      → blocksOf() 로 덩어리를 세고, 방 개수는 덧붙이는 정보로 둔다.

   ② 팀·면접관 중복과 ④ 첫 타임은 validate 의 것을 그대로 쓴다. 문장까지 손대지 않는다.

   담당자는 ① 을 **알고** 옮긴다(미팅: "아니 아니 돼야 돼요"). 모르고 딸려오는 것은 ②③ 이다.
   그래서 severity 를 나눈다 — ① 은 조용히 기록, ②③ 은 적극적으로 알린다. */
import type { Edu, Placed, Result } from '@/core/schedule'
import { Sched } from '@/core/schedule'
import { iGa } from './hangul'

export type Rule = 'r1' | 'r2' | 'r3' | 'r4'

/** 'notice' = 담당자가 알고 한 것 · 'alert' = 모르고 딸려온 것 */
export type Severity = 'alert' | 'notice'

export type Finding = {
  readonly rule: Rule
  readonly severity: Severity
  /** 확인 표시(ack)를 붙이는 자리. 같은 위반이 다시 생기면 옛 표시가 다시 붙는다. */
  readonly key: string
  readonly detail: string
  readonly day?: number
  readonly slot?: number
  readonly room?: number
  readonly appId?: number
  readonly team?: string
  /** 1차 자동 편성부터 있던 것인가. 담당자가 만든 것과 갈라 보여주려는 표시다 —
      섞어 두면 첫 타임 13건 같은 기준선 잡음에 정작 방금 만든 위반이 묻힌다. */
  readonly sinceBase?: boolean
}

export type Span = { readonly min: number; readonly max: number }

/** 기준선(1차 자동 편성)의 학력별 전역 세션 구간. 편집이 아무리 쌓여도 이 값은 안 바뀐다. */
export function baseSpans(base: Result): Record<string, Span> {
  const S = base.cfg.sessions
  const out: Record<string, { min: number; max: number }> = {}
  for (const p of base.placed) {
    const g = p.day * S + p.slot
    const v = out[p.edu] ?? (out[p.edu] = { min: g, max: g })
    v.min = Math.min(v.min, g)
    v.max = Math.max(v.max, g)
  }
  return out
}

/** 이 사람이 자기 학력 구간을 벗어났나 — 벗어났다면 어느 학력 구간에 들어와 있나 */
export function strayOf(p: Placed, spans: Record<string, Span>, sessions: number): string | null | undefined {
  const own = spans[p.edu]
  if (!own) return undefined                       // 기준선에 없던 학력 — 판정하지 않는다
  const g = p.day * sessions + p.slot
  if (g >= own.min && g <= own.max) return undefined
  const host = Object.entries(spans).find(([e, v]) => e !== p.edu && g >= v.min && g <= v.max)
  return host ? host[0] : null                     // null = 어느 구간에도 안 들어간 바깥
}

export type Judgement = {
  readonly findings: readonly Finding[]
  /** 확인 표시가 안 붙었고, 이번 편집으로 새로 생긴 것 — 상단 카운터가 세는 값 */
  readonly openNew: number
  /** 확인 표시가 안 붙었지만 1차 편성부터 있던 것 */
  readonly openBase: number
  readonly acked: number
  /** 연속 덩어리 수 = Webex 링크·방 예약 단위 */
  readonly blocks: number
}

/** 기준선에 이미 있던 위반의 키 — 한 번 재서 계속 쓴다 */
const baseKeyCache = new WeakMap<Result, ReadonlySet<string>>()
function baseKeys(base: Result): ReadonlySet<string> {
  const hit = baseKeyCache.get(base)
  if (hit) return hit
  const keys = new Set(rawFindings(base, base.placed).map(f => f.key))
  baseKeyCache.set(base, keys)
  return keys
}

/** 편집 중인 배치를 판정한다. `acks` 에 있는 키는 확인된 것으로 친다. */
export function judge(
  base: Result,
  placed: readonly Placed[],
  acks: Readonly<Record<string, string>> = {},
): Judgement {
  const seen = baseKeys(base)
  const findings = rawFindings(base, placed).map(f => ({ ...f, sinceBase: seen.has(f.key) }))
  const open = findings.filter(f => !(f.key in acks))
  return {
    findings,
    openNew: open.filter(f => !f.sinceBase).length,
    openBase: open.filter(f => f.sinceBase).length,
    acked: findings.length - open.length,
    blocks: Sched.blocksOf(placed as Placed[]).length,
  }
}

function rawFindings(base: Result, placed: readonly Placed[]): Finding[] {
  const S = base.cfg.sessions
  const spans = baseSpans(base)
  const findings: Finding[] = []

  /* ① 학력 — 사람 단위. 담당자가 알고 옮긴 것이므로 notice */
  for (const p of placed) {
    const host = strayOf(p, spans, S)
    if (host === undefined) continue
    findings.push({
      rule: 'r1', severity: 'notice',
      key: `r1|${p.app.id}`,
      appId: p.app.id, day: p.day, slot: p.slot, room: p.room,
      detail: `${p.app.name}(${p.edu})${iGa(p.app.name)} ${host ? `${host} 구간` : '학력 구간 밖'}에 있습니다 — ${p.day + 1}일차 ${p.slot + 1}세션`,
    })
  }

  /* ②④ — 엔진의 판정을 그대로 쓴다. 문장도 그대로다. */
  const V = Sched.validate({ ...base, placed: placed as Placed[], grid: {} } as Result)
  for (const v of V.r2) {
    findings.push({
      rule: 'r2', severity: 'alert',
      key: `r2|${v.day}|${v.slot}|${v.team ?? ''}`,
      day: v.day, slot: v.slot, team: v.team, detail: v.detail,
    })
  }
  for (const v of V.r4) {
    findings.push({
      rule: 'r4', severity: 'notice',
      key: `r4|${v.day}|${v.slot}|${v.team ?? ''}`,
      day: v.day, slot: v.slot, team: v.team, detail: v.detail,
    })
  }

  /* ③ 연속 — 덩어리 수. 팀×날짜×학력이 두 덩어리 이상이면 그만큼 다시 들어와야 한다. */
  const blocks = Sched.blocksOf(placed as Placed[])
  const groups = new Map<string, typeof blocks>()
  for (const b of blocks) {
    const edu = b.apps[0]?.edu ?? ''
    const k = `${b.day}|${b.team}|${edu}`
    const list = groups.get(k)
    if (list) list.push(b)
    else groups.set(k, [b])
  }
  for (const [k, list] of groups) {
    if (list.length < 2) continue
    const [d, team, edu] = k.split('|')
    const rooms = new Set(list.map(b => b.room))
    findings.push({
      rule: 'r3', severity: 'alert',
      key: `r3|${k}`,
      day: +d, team, detail:
        `${+d + 1}일차 ${team}(${edu}) — ${list.length}덩어리로 나뉨` +
        (rooms.size > 1 ? ` · ${rooms.size}개 방` : ''),
    })
  }

  return findings
}

/* ---------- 드래그 예고 ---------- */

export type SpotVerdict = {
  readonly ok: boolean          // 하드 위반 없음 — 교환이면 상대 쪽까지 본 값이다
  readonly clashes: readonly string[]   // ② 사유 — 놓기 전에 보여줄 문구
  readonly stray: boolean       // ① 자기 학력 구간 밖
  readonly linkDelta: number    // 덩어리(= 링크) 증감
  /** 점유 칸에 놓으면 교환이다. 상대는 내가 있던 자리로 밀려간다 — 그 자리의 사정도 함께 잰다.
      끌고 있는 사람만 보면 상대가 옮겨 갈 자리의 중복이 놓은 뒤에야 드러난다. */
  readonly peer?: {
    readonly name: string
    readonly clashes: readonly string[]
    readonly stray: boolean
  }
}

/** 이미 이동이 반영된 배치에서, 이 사람이 이 시간대에 부딪히는 것들 */
function clashesAt(
  after: readonly Placed[],
  selfId: number,
  at: { day: number; slot: number },
  teams: readonly string[],
  interviewers: readonly string[],
): string[] {
  const out: string[] = []
  for (const o of after) {
    if (o.app.id === selfId) continue
    if (o.day !== at.day || o.slot !== at.slot) continue
    for (const t of teams) if (o.teams.includes(t)) out.push(`${t} 같은 시간대에 이미 있음`)
    for (const iv of interviewers) if (o.interviewers.includes(iv)) out.push(`면접관 ${iv} 같은 시간대에 이미 있음`)
  }
  return [...new Set(out)]
}

/** 이 사람을 이 칸에 놓으면 어떻게 되는지 — 드래그 중 전 칸에 대해 부른다.
    한 칸 판정이 맵 조회 몇 번이라 96칸을 훑어도 1ms 아래다(실측 0.013ms).

    `peer` 를 주면 교환으로 계산한다. 먼저 **양쪽을 다 옮긴 배치**를 만들고 그 위에서 재는 것이
    핵심이다 — 상대를 제자리에 둔 채로 재면 곧 비워질 칸 때문에 없는 중복을 알리고, 정작
    상대가 갈 자리는 아무도 안 본다. */
export function previewSpot(
  base: Result,
  placed: readonly Placed[],
  app: { id: number; teams: readonly string[]; interviewers: readonly string[]; edu: Edu },
  to: { day: number; slot: number; room: number },
  spans: Record<string, Span>,
  blocksBefore: number,
  peer?: Placed,
): SpotVerdict {
  const S = base.cfg.sessions
  const from = placed.find(p => p.app.id === app.id)
  // 미배정 카드를 끌고 있으면 상대가 갈 자리가 없다 — 교환이 성립하지 않는다
  const swap = peer && peer.app.id !== app.id && from ? { peer, back: from } : null

  const after = placed.map(p =>
    p.app.id === app.id ? { ...p, day: to.day, slot: to.slot, room: to.room }
    : swap && p.app.id === swap.peer.app.id
      ? { ...p, day: swap.back.day, slot: swap.back.slot, room: swap.back.room }
      : p)

  const clashes = clashesAt(after, app.id, to, app.teams, app.interviewers)
  const own = spans[app.edu]
  const g = to.day * S + to.slot
  const stray = !!own && (g < own.min || g > own.max)

  const peerOut = swap ? {
    name: swap.peer.app.name,
    clashes: clashesAt(after, swap.peer.app.id, swap.back, swap.peer.teams, swap.peer.interviewers),
    stray: strayOf(
      { ...swap.peer, day: swap.back.day, slot: swap.back.slot } as Placed, spans, S,
    ) !== undefined,
  } : undefined

  return {
    ok: clashes.length === 0 && !peerOut?.clashes.length,
    clashes,
    stray,
    linkDelta: Sched.blocksOf(after as Placed[]).length - blocksBefore,
    ...(peerOut ? { peer: peerOut } : {}),
  }
}

export const RULE_LABEL: Record<Rule, string> = {
  r1: '학력 구간',
  r2: '같은 시간대 중복',
  r3: '연속 배치',
  r4: '첫 타임',
}
