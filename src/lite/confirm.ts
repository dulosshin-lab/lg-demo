/* 단계적 확정과 재통보 — 「1일차 확정 → 픽스 → 2일차 재배치」.

   미팅 P0-4: "고쳐도 전체가 안 깨지게" 하는 장치다. 1일차를 확정해 통보하고 나면 그 날짜는
   더 이상 흔들리지 않아야, 2일차를 다시 편성해도 영향 범위가 그날 안에서 끝난다.

   왜 편집 이벤트(edit.ts)에 섞지 않았나 —
   확정은 편집이 아니다. **바깥 세계에 통보가 나갔다**는 사실을 적는 일이라, Ctrl+Z 로 슬그머니
   풀리면 안 된다. 되돌리기는 편성표를 되돌릴 뿐 이미 나간 메일을 되돌리지 못한다.
   그래서 확정은 별도 이벤트로 쌓고, 푸는 것도 「확정 해제」라는 명시적 행동으로만 한다.

   확정한 뒤 카드를 옮기는 것은 **막지 않는다**(D1). 대신 통보한 자리와 달라진 사람을
   「재통보 대상」으로 집어낸다 — 담당자가 알아야 할 것은 "옮길 수 있나"가 아니라
   "누구에게 다시 알려야 하나"다.

   이벤트는 덧붙이기만 한다. 확정 해제도 지우지 않고 release 를 더한다 — 언제 확정했다가
   언제 풀었는지가 그대로 남아야 나중에 "왜 이 사람만 두 번 통보됐나"를 읽을 수 있다. */
import type { Placed } from '@/core/schedule'
import type { Actor } from './edit'
import { DEFAULT_ACTOR } from './edit'
import { nowISO, ulid } from './persist'

/** 확정 시점에 통보된 자리. 지금 자리가 이것과 다르면 재통보 대상이다. */
export type NoticeSpot = {
  readonly appId: number
  readonly appName: string
  readonly day: number
  readonly slot: number
  readonly room: number
}

export type ConfirmEvent = {
  readonly id: string          // ULID — 시간순 정렬
  readonly seq: number
  readonly ts: string
  readonly actorId: string
  readonly actorName: string
  readonly op: 'confirm' | 'release'
  readonly day: number
  /** confirm 일 때만. 그날 배정된 사람들의 자리를 통째로 찍어 둔다 */
  readonly spots?: readonly NoticeSpot[]
}

const spotOf = (p: Placed): NoticeSpot => ({
  appId: p.app.id, appName: p.app.name, day: p.day, slot: p.slot, room: p.room,
})

const nextSeq = (list: readonly ConfirmEvent[]) => (list.length ? list[list.length - 1].seq + 1 : 1)

/** 이 날짜를 확정한다 — 지금 배정을 통보 내용으로 찍어 둔다 */
export function confirmDay(
  list: readonly ConfirmEvent[], day: number, placed: readonly Placed[], actor: Actor = DEFAULT_ACTOR,
): ConfirmEvent[] {
  if (confirmedDays(list).has(day)) return [...list]
  return [...list, {
    id: ulid(), seq: nextSeq(list), ts: nowISO(),
    actorId: actor.id, actorName: actor.name,
    op: 'confirm', day,
    spots: placed.filter(p => p.day === day).map(spotOf),
  }]
}

/** 확정을 푼다 — 재통보 판정도 함께 사라진다 */
export function releaseDay(
  list: readonly ConfirmEvent[], day: number, actor: Actor = DEFAULT_ACTOR,
): ConfirmEvent[] {
  if (!confirmedDays(list).has(day)) return [...list]
  return [...list, {
    id: ulid(), seq: nextSeq(list), ts: nowISO(),
    actorId: actor.id, actorName: actor.name,
    op: 'release', day,
  }]
}

/** 지금 확정돼 있는 날짜들 — 이벤트를 앞에서부터 접어 낸다 */
export function confirmedDays(list: readonly ConfirmEvent[]): Set<number> {
  const out = new Set<number>()
  for (const e of list) {
    if (e.op === 'confirm') out.add(e.day)
    else out.delete(e.day)
  }
  return out
}

/** 확정된 날짜의 통보 자리 — appId 로 찾는다. 확정을 풀면 빠진다. */
export function noticeSpots(list: readonly ConfirmEvent[]): Map<number, NoticeSpot> {
  const byDay = new Map<number, readonly NoticeSpot[]>()
  for (const e of list) {
    if (e.op === 'confirm') byDay.set(e.day, e.spots ?? [])
    else byDay.delete(e.day)
  }
  const out = new Map<number, NoticeSpot>()
  for (const [, spots] of byDay) for (const s of spots) out.set(s.appId, s)
  return out
}

export type RenotifyKind = 'moved' | 'removed' | 'added'

export type Renotify = {
  readonly appId: number
  readonly appName: string
  readonly kind: RenotifyKind
  /** 통보했던 자리 — 확정 뒤에 새로 들어온 사람은 없다 */
  readonly was: NoticeSpot | null
  /** 지금 자리 — 배정이 취소됐으면 null */
  readonly now: { readonly day: number; readonly slot: number; readonly room: number } | null
}

/** 통보한 뒤 달라진 사람들. 이 목록이 곧 재통보 명단이다.

    세 가지를 잡는다 — 옮겨진 사람, 배정이 취소된 사람, 그리고 **확정된 날짜에 새로 들어온 사람**.
    셋째가 빠지면 구멍이 난다: 다시 편성이 확정된 날의 빈자리를 채우면 그 사람 본인은 아직
    통보 전이라 괜찮지만, 그 팀 면접관은 이미 받은 일정에 면접이 하나 늘어난다. */
export function renotifyOf(placed: readonly Placed[], list: readonly ConfirmEvent[]): Renotify[] {
  const notices = noticeSpots(list)
  if (!notices.size) return []
  const days = confirmedDays(list)
  const at = new Map(placed.map(p => [p.app.id, p]))
  const out: Renotify[] = []
  for (const [appId, was] of notices) {
    const p = at.get(appId)
    if (!p) {
      out.push({ appId, appName: was.appName, kind: 'removed', was, now: null })
      continue
    }
    if (p.day === was.day && p.slot === was.slot && p.room === was.room) continue
    out.push({
      appId, appName: was.appName, kind: 'moved', was,
      now: { day: p.day, slot: p.slot, room: p.room },
    })
  }
  for (const p of placed) {
    if (notices.has(p.app.id) || !days.has(p.day)) continue
    out.push({
      appId: p.app.id, appName: p.app.name, kind: 'added', was: null,
      now: { day: p.day, slot: p.slot, room: p.room },
    })
  }
  // 사람이 읽는 순서 — 자리가 있는 쪽(통보했던 자리, 없으면 지금 자리) 기준 날짜·세션 순
  const key = (r: Renotify) => r.was ?? r.now!
  return out.sort((a, b) =>
    key(a).day - key(b).day || key(a).slot - key(b).slot || key(a).room - key(b).room)
}

/** 이 사람은 확정(통보)된 사람인가 */
export const isConfirmed = (notices: ReadonlyMap<number, NoticeSpot>, appId: number) => notices.has(appId)

/** 재편성 때 고정할 자리 — 확정된 사람은 **지금 앉아 있는 자리**로 고정한다.

    통보했던 자리로 고정하고 싶어지지만 그러면 안 된다. 확정 뒤 담당자가 그 사람을 옮겼다면
    (지원자 사정이 바뀐 것이다) 재편성이 그 이동을 말없이 되돌려 버린다 — 재통보 대상에서도
    빠져서 담당자는 자기가 한 일이 사라진 줄도 모른다. 통보했던 자리는 재통보 판정에만 쓴다. */
export function pinsOf(
  placed: readonly Placed[], list: readonly ConfirmEvent[],
): { id: number; day: number; slot: number; room: number }[] {
  const notices = noticeSpots(list)
  const out: { id: number; day: number; slot: number; room: number }[] = []
  for (const p of placed) {
    if (!notices.has(p.app.id)) continue                    // 확정 안 된 사람은 열어 둔다
    out.push({ id: p.app.id, day: p.day, slot: p.slot, room: p.room })
  }
  return out                                                // 배정이 취소된 사람은 자리가 없어 빠진다
}

export function renotifyText(
  r: Renotify, dayLabel: (d: number) => string, slotLabel: (s: number) => string,
): string {
  const at = (s: { day: number; slot: number; room: number }) =>
    `${dayLabel(s.day)} ${slotLabel(s.slot)} ${s.room + 1}조`
  if (r.kind === 'removed') return `${r.appName} — ${at(r.was!)} 배정이 취소됨`
  if (r.kind === 'added') return `${r.appName} — ${at(r.now!)}에 새로 배정됨 (확정한 날짜에 추가)`
  return `${r.appName} — ${at(r.was!)} → ${at(r.now!)}`
}
