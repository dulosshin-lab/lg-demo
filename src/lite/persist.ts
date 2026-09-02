/* 편성 세션 저장·복원 — 새로고침해도 올린 명단과 편성표가 남는다.

   저장 형태는 뒤에 SQLite 로 옮길 것을 염두에 두고 정한다:
   - 키에 스키마 버전을 박는다(`ax.v1.*`). 모양이 바뀌면 v2 로 가고 마이그레이션이 v1 을 읽는다.
   - 편성안(session)을 최상위 개체로 둔다 — 지금은 하나뿐이지만 회차마다 하나씩 생긴다.
   - 식별자는 ULID. 클라이언트가 독립적으로 만들어도 겹치지 않고, 문자열 정렬이 곧 시간순이다.

   result.grid 는 저장하지 않는다 — placed 와 같은 객체를 가리키는 색인이라
   그대로 직렬화하면 60명분이 두 벌이 되고, 복원해도 참조가 갈라진다. 읽을 때 다시 만든다. */
import type { Cell, MasterRow, ParsedMaster } from '@/core/ingest'
import type { Applicant, Placed, Result } from '@/core/schedule'
import { Sched } from '@/core/schedule'
import type { LiteRoster, LiteSchedule } from './data'
import type { EditEvent, EditState } from './edit'
import type { Proposal } from './proposals'

/** 스키마 버전. 저장 모양을 바꾸면 올리고, 옛 키를 읽어 옮기는 코드를 둔다. */
export const SCHEMA = 'v1'
const SESSION_KEY = `ax.${SCHEMA}.session`

/** 이벤트가 이만큼 쌓이면 저장소 한계가 가깝다 — SQLite 로 옮길 때다 */
export const EVENT_WARN_AT = 10_000

/* ---------- ULID ---------- */

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'   // Crockford — I·L·O·U 를 뺀다

/** 시간 접두사 10자 + 난수 16자. 사전식 정렬이 곧 시간순이다.
    crypto.randomUUID() 는 v4 라 정렬되지 않아 쓰지 않는다. */
export function ulid(at: number = Date.now()): string {
  let time = ''
  for (let i = 9, v = at; i >= 0; i--, v = Math.floor(v / 32)) time = B32[v % 32] + time
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let rand = ''
  for (const b of bytes) rand += B32[b % 32]
  return time + rand
}

/** 저장에 쓰는 시각 — ISO 8601 + 타임존. TEXT 컬럼에 넣어도 사전식 정렬이 시간순이 된다. */
export function nowISO(at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const off = -at.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}` +
    `T${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
}

/* ---------- 직렬화 ---------- */

/** ParsedMaster 는 Map·Set 을 담고 있어 JSON 이 그대로 삼키지 못한다.
    키(지원자 번호)는 문자열로 눕히지 않는다 — 숫자로 들어온 파일을 복원한 뒤
    팀 회신을 조인할 때 `rows.get(1042)` 가 `'1042'` 와 어긋나기 때문이다. */
type WireMaster = {
  rows: [Cell, MasterRow][]
  columns: string[]
  header_row: number
  warnings: string[]
}

type WireSession = {
  v: 1
  id: string
  savedAt: string
  roster: Omit<LiteRoster, 'parsed'> & { parsed: WireMaster }
  /** grid 를 뺀 편성 결과 — 읽을 때 placed 로 다시 만든다 */
  schedule: (Omit<LiteSchedule, 'result'> & { result: Omit<Result, 'grid'> }) | null
  /** 수기 편집분. 배치는 좌표만 저장하고 지원자 본체는 base 에서 다시 붙인다 —
      60명분 객체를 두 벌 쌓지 않기 위해서다. */
  edit: WireEdit | null
  /** 팀이 보낸 수정 제안과 그 결재 결과 */
  proposals: Proposal[] | null
}

type WireEdit = {
  /** appId → 좌표. base 와 다른 자리에 있는 사람만 담는다 */
  spots: [number, { day: number; slot: number; room: number }][]
  /** 미배정으로 뺀 사람 */
  out: number[]
  events: EditEvent[]
  acks: Record<string, string>
}

const packMaster = (m: ParsedMaster): WireMaster => ({
  rows: [...m.rows],
  columns: [...m.columns],
  header_row: m.header_row,
  warnings: m.warnings,
})

const unpackMaster = (w: WireMaster): ParsedMaster => ({
  rows: new Map(w.rows),
  columns: new Set(w.columns),
  header_row: w.header_row,
  warnings: w.warnings,
})

/** placed 로 격자 색인을 다시 만든다 — 저장하지 않는 파생값이다 */
export const gridOf = (placed: readonly Placed[]): Record<string, Placed> =>
  Object.fromEntries(placed.map(p => [`${p.day}|${p.slot}|${p.room}`, p]))

const packEdit = (e: EditState): WireEdit => ({
  spots: e.placed.map(p => [p.app.id, { day: p.day, slot: p.slot, room: p.room }]),
  out: e.unplaced.map(a => a.id),
  events: [...e.events],
  acks: { ...e.acks },
})

export function packSession(
  roster: LiteRoster, schedule: LiteSchedule | null, id = ulid(),
  edit?: EditState | null, proposals?: readonly Proposal[] | null,
): WireSession {
  const { parsed, ...rest } = roster
  let wireSchedule: WireSession['schedule'] = null
  if (schedule) {
    const { grid: _grid, ...result } = schedule.result
    wireSchedule = { ...schedule, result }
  }
  return {
    v: 1, id, savedAt: nowISO(),
    roster: { ...rest, parsed: packMaster(parsed) },
    schedule: wireSchedule,
    edit: edit && edit.events.length ? packEdit(edit) : null,
    proposals: proposals && proposals.length ? [...proposals] : null,
  }
}

/** 좌표만 저장한 편집분을 base 위에 다시 얹는다 */
function unpackEdit(base: Result, w: WireEdit): EditState {
  const byId = new Map(base.placed.map(p => [p.app.id, p]))
  const appById = new Map(base.placed.map(p => [p.app.id, p.app]))
  for (const a of base.unplaced) appById.set(a.id, a)

  const out = new Set(w.out)
  const placed: Placed[] = []
  for (const [id, s] of w.spots) {
    if (out.has(id)) continue
    const app = appById.get(id)
    if (!app) continue                                  // 명단에서 사라진 사람의 자리는 버린다
    const was = byId.get(id)
    placed.push({
      app, day: s.day, slot: s.slot, room: s.room,
      team: was?.team ?? app.teams[0], teams: app.teams.slice(),
      interviewers: (app.interviewers ?? []).slice(), edu: app.edu,
    })
  }
  const unplaced = [...out].map(id => appById.get(id)).filter((a): a is Applicant => !!a)
  return { base, placed, unplaced, events: w.events, acks: w.acks }
}

export function unpackSession(w: WireSession): {
  id: string; roster: LiteRoster; schedule: LiteSchedule | null
  edit: EditState | null; proposals: Proposal[]
} {
  const roster: LiteRoster = { ...w.roster, parsed: unpackMaster(w.roster.parsed) }
  let schedule: LiteSchedule | null = null
  let edit: EditState | null = null
  if (w.schedule) {
    const result = { ...w.schedule.result, grid: gridOf(w.schedule.result.placed) } as Result
    schedule = { ...w.schedule, result }
    if (w.edit) edit = unpackEdit(result, w.edit)
  }
  return { id: w.id, roster, schedule, edit, proposals: w.proposals ?? [] }
}

/* ---------- localStorage ---------- */

export type SaveOutcome = { ok: true; bytes: number } | { ok: false; reason: string }

/** 저장한다. 용량을 넘기면 던지지 않고 사유를 돌려준다 — 편집을 막을 일은 아니다. */
export function saveSession(
  roster: LiteRoster, schedule: LiteSchedule | null, id?: string,
  edit?: EditState | null, proposals?: readonly Proposal[] | null,
): SaveOutcome {
  let text: string
  try {
    text = JSON.stringify(packSession(roster, schedule, id, edit, proposals))
  } catch (reason) {
    return { ok: false, reason: reason instanceof Error ? reason.message : '저장할 수 없는 값입니다' }
  }
  try {
    localStorage.setItem(SESSION_KEY, text)
    return { ok: true, bytes: text.length }
  } catch {
    return { ok: false, reason: '브라우저 저장 공간이 가득 찼습니다. 편집은 계속할 수 있지만 새로고침하면 사라집니다.' }
  }
}

/** 읽는다. 없거나 깨졌으면 null — 깨진 값은 지운다. */
export function loadSession(): {
  id: string; roster: LiteRoster; schedule: LiteSchedule | null
  edit: EditState | null; proposals: Proposal[]
} | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const w = JSON.parse(raw) as WireSession
    if (w.v !== 1 || !w.roster?.parsed) throw new Error('모양이 다릅니다')
    return unpackSession(w)
  } catch {
    try { localStorage.removeItem(SESSION_KEY) } catch { /* 지우지 못해도 계속한다 */ }
    return null
  }
}

export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* 무시 */ }
}

/** 저장된 편성표의 하드 위반을 다시 세어 본다 — 복원이 온전한지 확인하는 용도 */
export const revalidate = (schedule: LiteSchedule) => Sched.validate(schedule.result)
