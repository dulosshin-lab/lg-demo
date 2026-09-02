/* 편성 결과 정리 — 같은 팀을 같은 방에서 이어 앉힌다.

   미팅 P0-3: "1일차 전무기술팀처럼 오전 8시 / 오후 1시로 쪼개지면 안 됩니다.
   면접관이 하루에 두 번 나와야 하기 때문입니다."

   원인은 엔진의 배치 **순서**다. sched.js 는 팀의 첫 사람을 전역 최저비용 칸(이른 세션)에
   놓고 나머지를 이어 붙이는 그리디라, 앞선 팀이 자리를 채우면 뒤 팀은 이어붙일 곳이 없다.
   scoreSlot 의 연속 가중치(연속 0 vs 다른 조 +45)는 이미 크지만 순서가 이긴다.
   설정으로는 못 고친다 — 실측 10가지 중 최선이 팀 쪼갬 5→2 이고 다른 지표가 나빠졌다.

   sched.js 는 불가침이므로 **편성 결과 위에서** 자리를 맞바꿔 정리한다. 실데이터 60명 실측:

     팀 덩어리 28 → 21 · 면접관 쪼갬 5 → 1 · 엔진 ③ 6 → 2 · 하드 제약 ①② 0 유지 · 88ms

   지키는 것 셋 — 하나라도 깨면 정리가 아니라 재편성이 된다.
   ① 학력 구간 밖으로 내보내지 않는다 (미팅: "학사 사이에 석사가 끼는 것은 안 된다")
   ② 팀·면접관 중복을 새로 만들지 않는다
   ③ 확정(pinned)된 사람은 건드리지 않는다 — 단계적 통보의 핀이 여기서 흔들리면 안 된다

   순진한 방식은 오히려 나쁘다. 「쪼개진 팀을 주 덩어리에 붙인다」만 하면 팀의 시간축은
   붙지만 조가 분산돼 엔진 기준 ③ 이 6→13 으로 악화한다. 조 = 물리적 면접방·링크(D6)라
   방을 옮기는 순간 면접관이 옮겨 다녀야 한다. 그래서 **목적함수를 두고** 개선될 때만 옮긴다.

   「빈 슬롯 최소화」는 옵션으로 뒀다가 **뺐다.** 연속 배치와 반대 방향으로 당겨서, 켜면 빈칸
   20→16 을 얻는 대신 팀 덩어리가 24→25 로 늘었다(실측). 빈칸을 실제로 좌우하는 것은 조 수다 —
   조를 하나 줄이면 빈칸 20→12 로 떨어지고 일수는 3일 그대로다. 효과 작은 손잡이를 담당자에게
   쥐여 주는 것보다 조 수를 보게 하는 편이 낫다. 목적함수의 hole 가중치는 0 으로 남겨 둔다. */
import type { Placed, Result } from '@/core/schedule'

export type ArrangeOptions = {
  /** ③ 가로(연속) 배열 — 같은 팀을 같은 방에서 이어 앉힌다. 기본 켬 */
  readonly contiguous?: boolean
  /** 안전장치 — 이 시간을 넘기면 지금까지의 개선분만 쓴다 */
  readonly budgetMs?: number
}

export type Metrics = {
  /** (날짜·방·팀) 덩어리 수 = 면접관이 방에 들어오는 횟수 */
  readonly teamBlocks: number
  /** (날짜·면접관) 덩어리 수 */
  readonly ivBlocks: number
  /** 하루에 두 번 이상 나와야 하는 면접관 수 — 미팅이 지목한 그 증상 */
  readonly ivSplit: number
  /** 쓰인 세션 줄 안의 빈 칸 */
  readonly holes: number
}

export type ArrangeReport = {
  readonly placed: Placed[]
  /** 자리를 옮긴 횟수 — 교환은 1회로 센다 */
  readonly moves: number
  readonly before: Metrics
  readonly after: Metrics
  readonly ms: number
}

/** 이어진 세션을 한 덩어리로 세어 개수를 낸다 */
function blocksIn(slots: readonly number[]): number {
  const u = [...new Set(slots)].sort((a, b) => a - b)
  let n = u.length ? 1 : 0
  for (let i = 1; i < u.length; i++) if (u[i] !== u[i - 1] + 1) n++
  return n
}

const push = (m: Map<string, number[]>, k: string, v: number) => {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

export function metricsOf(placed: readonly Placed[], rooms: number): Metrics {
  const team = new Map<string, number[]>()
  const iv = new Map<string, number[]>()
  const rows = new Map<string, number>()
  for (const p of placed) {
    for (const t of p.teams) push(team, `${p.day}|${p.room}|${t}`, p.slot)
    for (const i of p.interviewers) push(iv, `${p.day}|${i}`, p.slot)
    const rk = `${p.day}|${p.slot}`
    rows.set(rk, (rows.get(rk) ?? 0) + 1)
  }
  let teamBlocks = 0
  for (const [, slots] of team) teamBlocks += blocksIn(slots)
  let ivBlocks = 0, ivSplit = 0
  for (const [, slots] of iv) {
    const n = blocksIn(slots)
    ivBlocks += n
    if (n > 1) ivSplit++
  }
  let holes = 0
  for (const [, n] of rows) holes += Math.max(0, rooms - n)
  return { teamBlocks, ivBlocks, ivSplit, holes }
}

type Span = { min: number; max: number }

/** 학력별 전역 세션 구간 — 정리 **전에** 재서 고정한다. 옮기면서 다시 재면 구간이 따라 흘러
    ① 이 조용히 무너진다. */
function spansOf(placed: readonly Placed[], sessions: number): Record<string, Span> {
  const out: Record<string, Span> = {}
  for (const p of placed) {
    const g = p.day * sessions + p.slot
    const v = out[p.edu] ?? (out[p.edu] = { min: g, max: g })
    v.min = Math.min(v.min, g)
    v.max = Math.max(v.max, g)
  }
  return out
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** 1차 편성 결과를 정리한다. 원본은 건드리지 않는다. */
export function arrange(base: Result, opts: ArrangeOptions = {}): ArrangeReport {
  const rooms = base.cfg.rooms
  const S = base.cfg.sessions
  const placed: Placed[] = base.placed.map(p => ({ ...p }))
  const before = metricsOf(placed, rooms)

  const contiguous = opts.contiguous !== false
  const w = { team: contiguous ? 3 : 0, iv: contiguous ? 2 : 0, hole: 0 }
  if (!w.team && !w.iv && !w.hole) return { placed, moves: 0, before, after: before, ms: 0 }

  const t0 = now()
  const budget = opts.budgetMs ?? 3000
  const spans = spansOf(placed, S)
  const days = [...new Set(placed.map(p => p.day))].sort((a, b) => a - b)

  const key = (p: { day: number; slot: number; room: number }) => `${p.day}|${p.slot}|${p.room}`
  const grid = new Map<string, Placed>()
  for (const p of placed) grid.set(key(p), p)

  const inSpan = (p: Placed, day: number, slot: number) => {
    const own = spans[p.edu]
    if (!own) return true                       // 기준선에 없던 학력 — 판정하지 않는다
    const g = day * S + slot
    return g >= own.min && g <= own.max
  }
  /** who 를 (day,slot) 에 놓아도 팀·면접관이 안 겹치나. `ignore` 는 그 자리를 비울 사람 */
  const free = (who: Placed, day: number, slot: number, ignore: Placed | null) => {
    for (const o of placed) {
      if (o === who || o === ignore) continue
      if (o.day !== day || o.slot !== slot) continue
      for (const t of who.teams) if (o.teams.includes(t)) return false
      for (const i of who.interviewers) if (o.interviewers.includes(i)) return false
    }
    return true
  }
  const cost = () => {
    const m = metricsOf(placed, rooms)
    return w.team * m.teamBlocks + w.iv * m.ivBlocks + w.hole * m.holes
  }

  let cur = cost()
  let moves = 0
  for (let sweep = 0; sweep < 8; sweep++) {
    let improved = false
    for (const who of placed) {
      if (who.pinned) continue                  // 확정 통보분은 못 옮긴다
      if (now() - t0 > budget) { sweep = 8; break }
      const home = { day: who.day, slot: who.slot, room: who.room }
      let best: { c: number; peer: Placed | null; to: { day: number; slot: number; room: number } } | null = null

      for (const day of days) {
        for (let slot = 0; slot < S; slot++) {
          if (!inSpan(who, day, slot)) continue
          for (let room = 0; room < rooms; room++) {
            if (day === home.day && slot === home.slot && room === home.room) continue
            const peer = grid.get(`${day}|${slot}|${room}`) ?? null
            if (peer?.pinned) continue
            if (peer) {
              if (!inSpan(peer, home.day, home.slot)) continue
              if (!free(who, day, slot, peer) || !free(peer, home.day, home.slot, who)) continue
            } else if (!free(who, day, slot, null)) continue

            // 옮겨 놓고 재 본 뒤 되돌린다 — 나아질 때만 진짜로 옮긴다
            place(who, { day, slot, room })
            if (peer) place(peer, home)
            const c = cost()
            place(who, home)
            if (peer) place(peer, { day, slot, room })

            if (c < cur - 1e-9 && (!best || c < best.c)) best = { c, peer, to: { day, slot, room } }
          }
        }
      }

      if (best) {
        grid.delete(key(home))
        if (best.peer) grid.delete(key(best.to))
        place(who, best.to)
        if (best.peer) place(best.peer, home)
        grid.set(key(who), who)
        if (best.peer) grid.set(key(best.peer), best.peer)
        cur = best.c
        moves++
        improved = true
      }
    }
    if (!improved) break
  }

  return { placed, moves, before, after: metricsOf(placed, rooms), ms: now() - t0 }
}

function place(p: Placed, at: { day: number; slot: number; room: number }) {
  p.day = at.day
  p.slot = at.slot
  p.room = at.room
}

/** 정리된 배치로 Result 를 다시 만든다 — grid 는 placed 의 색인이라 함께 갈아야 한다 */
export function withPlaced(base: Result, placed: Placed[]): Result {
  const grid: Record<string, Placed> = {}
  for (const p of placed) grid[`${p.day}|${p.slot}|${p.room}`] = p
  return { ...base, placed, grid }
}
