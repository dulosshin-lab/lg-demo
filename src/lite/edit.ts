/* 편성표 수동 편집 — 상태와 변경 이벤트.

   1차 자동 편성이 끝나면 그 결과가 기준선이 되고, 이후는 사람이 손으로 고친다.
   미팅 결정: 수정 뒤에 솔버를 다시 돌리지 않는다. 사람이 옮긴 것은 그대로 둔다.

   모든 변경은 이벤트로 남는다 — 되돌리기·이력·내보내기가 전부 이 배열 하나에서 나온다.
   이벤트는 덧붙이기만 한다(append-only). 취소는 지우는 것이 아니라 되돌리는 이벤트를 더하는 것이다.

   저장 형태는 SQLite 의 edit_event 테이블과 1:1 이다 — 필드 이름을 컬럼명 그대로 쓰고,
   좌표를 from_day/from_slot 처럼 눕혀 둔다. 옮길 때 INSERT ... SELECT 한 줄이면 된다. */
import type { Applicant, Placed, Result } from '@/core/schedule'
import { nowISO, ulid } from './persist'

export type EditOp = 'move' | 'swap' | 'remove' | 'place' | 'ack' | 'unack' | 'reschedule'

/** 격자 한 칸 */
export type Spot = { readonly day: number; readonly slot: number; readonly room: number }

export const spotKey = (s: Spot) => `${s.day}|${s.slot}|${s.room}`
export const sameSpot = (a: Spot | null, b: Spot | null) =>
  a === b || (!!a && !!b && a.day === b.day && a.slot === b.slot && a.room === b.room)

export type EditEvent = {
  readonly id: string          // ULID — 여럿이 각자 만들어도 겹치지 않고 정렬이 시간순이다
  readonly seq: number         // 화면 표시용 순번. 서버가 생기면 서버가 다시 매긴다
  readonly baseSeq: number     // 만들 때 본 마지막 seq — 나중에 충돌 감지에 쓴다
  readonly ts: string
  readonly actorId: string
  readonly actorName: string
  readonly op: EditOp
  readonly appId: number
  readonly appName: string     // 이름 스냅샷 — 지원자가 빠져도 이력은 읽혀야 한다
  readonly from: Spot | null   // null = 미배정에서 왔다
  readonly to: Spot | null     // null = 미배정으로 갔다
  readonly peerAppId?: number
  readonly peerAppName?: string
  readonly ackKey?: string
  readonly reason?: string
  /** 팀 요청을 승인해서 생긴 편집이면 그 요청의 id.
      되돌릴 때 요청 상태도 함께 되돌리려면 이 연결이 있어야 한다 —
      없으면 표는 원복되는데 팀에게는 「승인됨」이 남아 어긋난다. */
  readonly proposalId?: string
  /** reschedule 일 때 — 몇 명을 고정하고 몇 명을 다시 배치했나 */
  readonly pinnedCount?: number
  readonly movedCount?: number
}

/** 편집 중인 편성표. base 는 1차 자동 편성 결과로, 절대 바뀌지 않는다. */
export type EditState = {
  readonly base: Result
  readonly placed: readonly Placed[]
  readonly unplaced: readonly Applicant[]
  readonly events: readonly EditEvent[]
  /** 담당자가 "알고 한 것"으로 표시한 위반 지점. 값은 사유(없으면 빈 문자열). */
  readonly acks: Readonly<Record<string, string>>
}

export type Actor = { readonly id: string; readonly name: string }

export const DEFAULT_ACTOR: Actor = { id: 'local', name: 'HR 간사' }

export function initEdit(base: Result): EditState {
  return { base, placed: base.placed.slice(), unplaced: base.unplaced.slice(), events: [], acks: {} }
}

/** placed 로 격자 색인을 만든다 — 저장하지 않는 파생값이다 */
export const gridOf = (placed: readonly Placed[]): Record<string, Placed> =>
  Object.fromEntries(placed.map(p => [spotKey(p), p]))

export const atSpot = (placed: readonly Placed[], s: Spot): Placed | undefined =>
  placed.find(p => p.day === s.day && p.slot === s.slot && p.room === s.room)

export const findPlaced = (placed: readonly Placed[], appId: number): Placed | undefined =>
  placed.find(p => p.app.id === appId)

/* ---------- 행동 ---------- */

export type EditAction =
  | { type: 'move'; appId: number; to: Spot; actor?: Actor; proposalId?: string }
  | { type: 'swap'; appId: number; peerAppId: number; actor?: Actor; proposalId?: string }
  | { type: 'remove'; appId: number; actor?: Actor; proposalId?: string }
  | { type: 'place'; appId: number; to: Spot; actor?: Actor; proposalId?: string }
  | { type: 'ack'; key: string; reason?: string; actor?: Actor }
  | { type: 'unack'; key: string; actor?: Actor }
  | { type: 'undo' }
  | { type: 'reset'; base: Result }
  | { type: 'load'; state: EditState }
  /** 확정분을 고정한 채 나머지를 다시 편성했다. 기준선 자체가 바뀌므로 배치는 새 base 를 쓰고,
      이력은 이어 붙인다 — 재편성 때문에 「누가 언제 무엇을」 기록이 끊기면 안 된다. */
  | { type: 'reschedule'; base: Result; pinnedCount: number; movedCount: number; actor?: Actor }

const spotOf = (p: Placed): Spot => ({ day: p.day, slot: p.slot, room: p.room })
const moveTo = (p: Placed, s: Spot): Placed => ({ ...p, day: s.day, slot: s.slot, room: s.room })

function nextEvent(
  state: EditState, actor: Actor, op: EditOp,
  app: { id: number; name: string }, from: Spot | null, to: Spot | null,
  extra: Partial<EditEvent> = {},
): EditEvent {
  const seq = state.events.length + 1
  return {
    id: ulid(), seq, baseSeq: state.events.length, ts: nowISO(),
    actorId: actor.id, actorName: actor.name,
    op, appId: app.id, appName: app.name, from, to, ...extra,
  }
}

/** 이벤트 하나를 되돌린다. 지우지 않고 반대 방향으로 다시 적용한다. */
function undoOne(state: EditState, e: EditEvent): EditState {
  const placed = state.placed.slice()
  const unplaced = state.unplaced.slice()
  const idx = (id: number) => placed.findIndex(p => p.app.id === id)

  if (e.op === 'move' && e.from) {
    const i = idx(e.appId)
    if (i >= 0) placed[i] = moveTo(placed[i], e.from)
  } else if (e.op === 'swap' && e.from && e.to && e.peerAppId !== undefined) {
    const a = idx(e.appId), b = idx(e.peerAppId)
    if (a >= 0) placed[a] = moveTo(placed[a], e.from)
    if (b >= 0) placed[b] = moveTo(placed[b], e.to)
  } else if (e.op === 'remove' && e.from) {
    const u = unplaced.findIndex(a => a.id === e.appId)
    const app = u >= 0 ? unplaced[u] : null
    if (app) {
      unplaced.splice(u, 1)
      const was = state.base.placed.find(p => p.app.id === e.appId)
      placed.push({
        app, day: e.from.day, slot: e.from.slot, room: e.from.room,
        team: was?.team ?? app.teams[0], teams: app.teams.slice(),
        interviewers: (app.interviewers ?? []).slice(), edu: app.edu,
      })
    }
  } else if (e.op === 'place' && e.to) {
    const i = idx(e.appId)
    if (i >= 0) { unplaced.push(placed[i].app); placed.splice(i, 1) }
  } else if (e.op === 'ack' && e.ackKey) {
    const { [e.ackKey]: _gone, ...rest } = state.acks
    return { ...state, acks: rest, events: state.events.slice(0, -1) }
  } else if (e.op === 'unack' && e.ackKey) {
    return { ...state, acks: { ...state.acks, [e.ackKey]: e.reason ?? '' }, events: state.events.slice(0, -1) }
  }
  return { ...state, placed, unplaced, events: state.events.slice(0, -1) }
}

export function editReducer(state: EditState, action: EditAction): EditState {
  const actor = 'actor' in action ? (action.actor ?? DEFAULT_ACTOR) : DEFAULT_ACTOR

  switch (action.type) {
    case 'move': {
      const i = state.placed.findIndex(p => p.app.id === action.appId)
      if (i < 0) return state
      const from = spotOf(state.placed[i])
      if (sameSpot(from, action.to)) return state
      if (atSpot(state.placed, action.to)) return state          // 점유 칸은 swap 이 맡는다
      const placed = state.placed.slice()
      placed[i] = moveTo(placed[i], action.to)
      return {
        ...state, placed,
        events: [...state.events, nextEvent(state, actor, 'move', { id: action.appId, name: placed[i].app.name }, from, action.to,
          { proposalId: action.proposalId })],
      }
    }

    case 'swap': {
      const a = state.placed.findIndex(p => p.app.id === action.appId)
      const b = state.placed.findIndex(p => p.app.id === action.peerAppId)
      if (a < 0 || b < 0 || a === b) return state
      const from = spotOf(state.placed[a])
      const to = spotOf(state.placed[b])
      const placed = state.placed.slice()
      placed[a] = moveTo(placed[a], to)
      placed[b] = moveTo(placed[b], from)
      return {
        ...state, placed,
        events: [...state.events, nextEvent(state, actor, 'swap',
          { id: action.appId, name: placed[a].app.name }, from, to,
          { peerAppId: action.peerAppId, peerAppName: placed[b].app.name, proposalId: action.proposalId })],
      }
    }

    case 'remove': {
      const i = state.placed.findIndex(p => p.app.id === action.appId)
      if (i < 0) return state
      const gone = state.placed[i]
      const placed = state.placed.slice()
      placed.splice(i, 1)
      return {
        ...state, placed, unplaced: [...state.unplaced, gone.app],
        events: [...state.events, nextEvent(state, actor, 'remove', { id: action.appId, name: gone.app.name }, spotOf(gone), null,
          { proposalId: action.proposalId })],
      }
    }

    case 'place': {
      const u = state.unplaced.findIndex(a => a.id === action.appId)
      if (u < 0) return state
      if (atSpot(state.placed, action.to)) return state
      const app = state.unplaced[u]
      const was = state.base.placed.find(p => p.app.id === action.appId)
      const rec: Placed = {
        app, day: action.to.day, slot: action.to.slot, room: action.to.room,
        team: was?.team ?? app.teams[0], teams: app.teams.slice(),
        interviewers: (app.interviewers ?? []).slice(), edu: app.edu,
      }
      const unplaced = state.unplaced.slice()
      unplaced.splice(u, 1)
      return {
        ...state, placed: [...state.placed, rec], unplaced,
        events: [...state.events, nextEvent(state, actor, 'place', { id: action.appId, name: app.name }, null, action.to,
          { proposalId: action.proposalId })],
      }
    }

    case 'ack': {
      if (action.key in state.acks) return state
      return {
        ...state, acks: { ...state.acks, [action.key]: action.reason ?? '' },
        events: [...state.events, nextEvent(state, actor, 'ack', { id: -1, name: '' }, null, null,
          { ackKey: action.key, reason: action.reason })],
      }
    }

    case 'unack': {
      if (!(action.key in state.acks)) return state
      const reason = state.acks[action.key]
      const { [action.key]: _gone, ...rest } = state.acks
      return {
        ...state, acks: rest,
        events: [...state.events, nextEvent(state, actor, 'unack', { id: -1, name: '' }, null, null,
          { ackKey: action.key, reason })],
      }
    }

    case 'undo': {
      const last = state.events[state.events.length - 1]
      if (!last) return state
      // 다시 편성은 되돌릴 수 없다 — 되감을 「이전 자리」가 사람마다 다르고, 기준선까지 바뀌었다
      if (last.op === 'reschedule') return state
      return undoOne(state, last)
    }

    case 'reschedule': {
      const next = initEdit(action.base)
      return {
        ...next,
        acks: state.acks,                     // 같은 위반이 남아 있으면 확인 표시도 유효하다
        events: [...state.events, nextEvent(state, actor, 'reschedule', { id: 0, name: '' }, null, null,
          { pinnedCount: action.pinnedCount, movedCount: action.movedCount })],
      }
    }

    case 'reset':
      return initEdit(action.base)

    case 'load':
      return action.state
  }
}

/* ---------- 이력 문구 ---------- */

const spotText = (s: Spot) => `${s.day + 1}일차 ${s.slot + 1}세션 ${s.room + 1}조`

/** 이력 패널 한 줄. 미팅 요청대로 사람이 쓴 것처럼 읽히게 한다. */
export function eventText(e: EditEvent): string {
  switch (e.op) {
    case 'move':  return `${e.appName} — ${e.from ? spotText(e.from) : '미배정'} → ${e.to ? spotText(e.to) : '미배정'}`
    case 'swap':  return `${e.appName} ↔ ${e.peerAppName} 자리 교환 (${e.from ? spotText(e.from) : ''} ↔ ${e.to ? spotText(e.to) : ''})`
    case 'remove': return `${e.appName} 배정 취소 — ${e.from ? spotText(e.from) : ''}에서 뺌`
    case 'place': return `${e.appName} 배정 — ${e.to ? spotText(e.to) : ''}`
    case 'ack':   return `예외로 표시${e.reason ? ` — ${e.reason}` : ''}`
    case 'unack': return '예외 표시 해제'
    case 'reschedule':
      return `확정분 ${e.pinnedCount ?? 0}명을 고정하고 나머지 ${e.movedCount ?? 0}명을 다시 편성`
  }
}

/** 시각에서 시:분만 — 이력 목록이 길어져도 읽기 쉽게 */
export const hhmm = (ts: string) => ts.slice(11, 16)

/** 담당자가 미배정으로 뺀 사람 — 다시 편성해도 자리를 만들지 않는다 */
export function removedIds(events: readonly EditEvent[]): Set<number> {
  const ids = new Set<number>()
  for (const e of events) {
    if (e.op === 'remove') ids.add(e.appId)
    if (e.op === 'place') ids.delete(e.appId)
  }
  return ids
}

/** 담당자가 손으로 자리를 정해 준 사람 — 다시 편성할 때 그 자리를 지킨다.
    재편성마다 손질이 날아가면 「고쳐도 전체가 안 깨지게」가 성립하지 않는다. */
export function touchedIds(events: readonly EditEvent[]): Set<number> {
  const ids = new Set<number>()
  for (const e of events) {
    if (e.op === 'move' || e.op === 'place') ids.add(e.appId)
    if (e.op === 'swap') {
      ids.add(e.appId)
      if (e.peerAppId !== undefined) ids.add(e.peerAppId)
    }
    if (e.op === 'remove') ids.delete(e.appId)
    if (e.op === 'reschedule') ids.clear()      // 이미 편성에 녹아든 손질이다
  }
  return ids
}

/** 편집이 있었나 — 저장·내보내기 버튼을 켤지 정한다 */
export const isDirty = (s: EditState) => s.events.length > 0
