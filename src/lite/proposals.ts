/* 편성 수정 제안 — 팀 담당자 ↔ HR 간사.

   지금은 팀이 메일로 「우리 3번 지원자를 오후로 빼주세요」를 보내고, 간사가 그걸 읽어
   손으로 옮기고 다시 메일로 답한다. 그 왕복을 화면 안으로 들인다.

   흐름은 한 방향이다:
     팀이 제안 → 큐에 쌓임 → 간사가 승인하면 **편성표에 바로 반영**되고,
     거절하면 **사유와 함께** 팀에게 회신된다. 거절 사유는 비울 수 없다 —
     사유 없는 거절이 메일 왕복을 다시 만드는 원인이기 때문이다.

   제안도 이벤트처럼 덧붙이기만 한다. 상태는 지우지 않고 결재 결과를 적어 넣는다.
   SQLite 로 옮길 때 proposal 테이블 한 장이면 된다. */
import type { Placed, Result } from '@/core/schedule'
import { atSpot, editReducer, sameSpot, type EditState, type Spot } from './edit'
import { judge } from './violations'
import { iGa, eunNeun } from './hangul'
import { nowISO, ulid } from './persist'

export type ProposalKind = 'move' | 'swap' | 'remove'
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'stale'

export type Proposal = {
  readonly id: string           // ULID
  readonly seq: number
  readonly createdAt: string
  readonly fromTeam: string
  readonly fromName: string
  readonly kind: ProposalKind
  readonly appId: number
  readonly appName: string
  readonly from: Spot | null
  readonly to: Spot | null
  readonly peerAppId?: number
  readonly peerAppName?: string
  /** 팀이 적은 요청 사유 */
  readonly reason: string
  readonly status: ProposalStatus
  readonly decidedAt?: string
  readonly decidedBy?: string
  /** 간사 회신. 거절이면 반드시 채워진다. */
  readonly note?: string
  /** 팀이 회신을 본 시각. 종 알림은 이 값이 없는 것만 띄운다. */
  readonly seenByTeamAt?: string
  /** 승인했다가 되돌린 시각. 대기 중으로 돌아가지만 팀은 이 사실을 알아야 한다. */
  readonly withdrawnAt?: string
}

export const KIND_LABEL: Record<ProposalKind, string> = {
  move: '자리 이동',
  swap: '자리 교환',
  remove: '배정 취소',
}

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: '대기 중',
  approved: '승인함',
  rejected: '거절함',
  stale: '이미 바뀐 자리',
}

const spotText = (base: Result, s: Spot) =>
  `${base.dates[s.day]?.label ?? `${s.day + 1}일차`} ${base.times[s.slot]?.label?.split('–')[0] ?? `${s.slot + 1}세션`} ${s.room + 1}조`

/** 큐 한 줄에 쓰는 문장 — 간사가 읽고 바로 판단할 수 있게 */
export function proposalText(base: Result, p: Proposal): string {
  switch (p.kind) {
    case 'move':
      return `${p.appName}${p.from ? ` — ${spotText(base, p.from)}` : ''} → ${p.to ? spotText(base, p.to) : '미배정'}`
    case 'swap':
      return `${p.appName} ↔ ${p.peerAppName} 자리 교환`
    case 'remove':
      return `${p.appName} 배정 취소${p.from ? ` (${spotText(base, p.from)})` : ''}`
  }
}

export type NewProposal = {
  readonly fromTeam: string
  readonly fromName: string
  readonly kind: ProposalKind
  readonly appId: number
  readonly appName: string
  readonly from: Spot | null
  readonly to?: Spot | null
  readonly peerAppId?: number
  readonly peerAppName?: string
  readonly reason: string
}

export function createProposal(list: readonly Proposal[], input: NewProposal): Proposal {
  return {
    id: ulid(),
    seq: list.length + 1,
    createdAt: nowISO(),
    status: 'pending',
    to: input.to ?? null,
    ...input,
  }
}

/** 제안이 지금도 적용 가능한가 — 그 사이 간사가 이미 옮겼을 수 있다 */
export function isApplicable(state: EditState, p: Proposal): { ok: true } | { ok: false; why: string } {
  const me = state.placed.find(x => x.app.id === p.appId)
  if (p.kind === 'remove') {
    return me ? { ok: true } : { ok: false, why: `${p.appName}${eunNeun(p.appName)} 이미 배정에서 빠져 있습니다.` }
  }
  if (!me) return { ok: false, why: `${p.appName}${eunNeun(p.appName)} 지금 배정되어 있지 않습니다.` }
  if (p.kind === 'swap') {
    const peer = state.placed.find(x => x.app.id === p.peerAppId)
    return peer ? { ok: true } : { ok: false, why: `${p.peerAppName}${eunNeun(p.peerAppName ?? '')} 지금 배정되어 있지 않습니다.` }
  }
  if (!p.to) return { ok: false, why: '옮길 자리가 지정되지 않았습니다.' }
  if (sameSpot({ day: me.day, slot: me.slot, room: me.room }, p.to)) {
    return { ok: false, why: `${p.appName}${eunNeun(p.appName)} 이미 그 자리에 있습니다. 승인해도 바뀌는 것이 없습니다.` }
  }
  const taken = atSpot(state.placed, p.to)
  if (taken && taken.app.id !== p.appId) {
    return { ok: false, why: `그 자리에는 이미 ${taken.app.name}${iGa(taken.app.name)} 있습니다. 교환으로 바꾸거나 다른 자리를 제안해 주세요.` }
  }
  return { ok: true }
}

/** 이 요청을 받아들이면 배치가 어떻게 되는지 — 이벤트는 남기지 않고 결과만 계산한다 */
function placedAfter(state: EditState, p: Proposal): readonly Placed[] {
  if (p.kind === 'remove') return state.placed.filter(x => x.app.id !== p.appId)
  if (p.kind === 'swap') {
    const a = state.placed.find(x => x.app.id === p.appId)
    const b = state.placed.find(x => x.app.id === p.peerAppId)
    if (!a || !b) return state.placed
    return state.placed.map(x =>
      x.app.id === a.app.id ? { ...x, day: b.day, slot: b.slot, room: b.room }
      : x.app.id === b.app.id ? { ...x, day: a.day, slot: a.slot, room: a.room }
      : x)
  }
  if (p.kind === 'move' && p.to) {
    return state.placed.map(x =>
      x.app.id === p.appId ? { ...x, day: p.to!.day, slot: p.to!.slot, room: p.to!.room } : x)
  }
  return state.placed
}

/** 승인하면 새로 생기는 어긋남 — 간사가 누르기 전에 알 수 있게.
    빈 칸인지만 보고 승인하면 팀·면접관 중복이 회신이 나간 뒤에야 드러난다.
    막지는 않는다 — 담당자는 알고도 어길 수 있어야 한다(미팅 46:22). */
export function effectOf(base: Result, state: EditState, p: Proposal): {
  readonly alerts: readonly string[]
  readonly linkDelta: number
} {
  const before = judge(base, state.placed)
  const after = judge(base, placedAfter(state, p))
  const known = new Set(before.findings.map(f => f.key))
  return {
    alerts: after.findings
      .filter(f => f.severity === 'alert' && f.rule === 'r2' && !known.has(f.key))
      .map(f => f.detail),
    linkDelta: after.blocks - before.blocks,
  }
}

/** 승인 — 편집 상태에 실제로 반영한다. 간사가 손으로 옮긴 것과 같은 이벤트를 남긴다. */
export function applyProposal(state: EditState, p: Proposal, actorName: string): EditState {
  const actor = { id: 'local', name: actorName }
  const link = p.id                       // 되돌릴 때 이 요청을 찾아 함께 되돌린다
  if (p.kind === 'remove') return editReducer(state, { type: 'remove', appId: p.appId, actor, proposalId: link })
  if (p.kind === 'swap' && p.peerAppId !== undefined) {
    return editReducer(state, { type: 'swap', appId: p.appId, peerAppId: p.peerAppId, actor, proposalId: link })
  }
  if (p.kind === 'move' && p.to) return editReducer(state, { type: 'move', appId: p.appId, to: p.to, actor, proposalId: link })
  return state
}

/** 승인을 되돌렸다 — 요청을 대기 중으로 돌리고, 팀이 다시 보도록 읽음 표시를 지운다.
    표만 원복하고 요청을 「승인함」으로 두면 팀은 옮겨진 줄 안다. */
export const withdraw = (p: Proposal): Proposal => ({
  ...p,
  status: 'pending',
  withdrawnAt: nowISO(),
  decidedAt: undefined,
  decidedBy: undefined,
  note: undefined,
  seenByTeamAt: undefined,
})

export const decide = (
  p: Proposal, status: 'approved' | 'rejected' | 'stale', by: string, note: string,
): Proposal => ({ ...p, status, decidedAt: nowISO(), decidedBy: by, note })

export const pendingOf = (list: readonly Proposal[]) => list.filter(p => p.status === 'pending')
export const decidedOf = (list: readonly Proposal[]) => list.filter(p => p.status !== 'pending')

/* 종 알림은 역할마다 뜻이 다르다.
   간사에게 알림은 「내가 할 일」이라 처리하면 사라지고,
   팀에게 알림은 「도착한 회신」이라 읽으면 사라진다. */

/** 간사의 종 — 아직 처리하지 않은 요청 */
export const inboxOf = pendingOf

/** 팀의 종 — 아직 안 본 소식. 처리된 회신과, 승인이 철회된 건이 여기 든다. */
export const unreadRepliesOf = (list: readonly Proposal[], team: string) =>
  list.filter(p => p.fromTeam === team && (p.status !== 'pending' || p.withdrawnAt) && !p.seenByTeamAt)

/** 팀이 화면을 열었다 — 도착한 회신을 본 것으로 적는다 */
export const markRepliesSeen = (list: readonly Proposal[], team: string): Proposal[] => {
  const at = nowISO()
  return list.map(p =>
    p.fromTeam === team && (p.status !== 'pending' || p.withdrawnAt) && !p.seenByTeamAt
      ? { ...p, seenByTeamAt: at } : p)
}

/** 팀 화면에 보이는 회신 문장 */
export function replyText(p: Proposal): string {
  if (p.status === 'pending') {
    return p.withdrawnAt
      ? '간사가 승인했다가 되돌렸습니다. 다시 확인 중입니다.'
      : '간사 확인을 기다리는 중입니다.'
  }
  if (p.status === 'approved') return p.note?.trim() ? `승인되었습니다. ${p.note}` : '승인되어 편성표에 반영되었습니다.'
  if (p.status === 'stale') return `자리가 이미 바뀌어 처리하지 못했습니다. ${p.note ?? ''}`.trim()
  return `거절되었습니다. ${p.note ?? ''}`.trim()
}

/** 이 사람이 지금 어디에 있나 — 팀 화면에서 제안을 만들 때 쓴다 */
export const spotOfApp = (placed: readonly Placed[], appId: number): Placed | undefined =>
  placed.find(p => p.app.id === appId)
