import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor,
  closestCenter, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import type { Applicant, Placed, Result } from '@/core/schedule'
import type { LiteRoster, LiteSchedule } from './data'
import {
  DEFAULT_ACTOR, editReducer, eventText, gridOf, hhmm, initEdit, isDirty, removedIds, touchedIds,
  type EditState, type Spot,
} from './edit'
import { baseSpans, judge, previewSpot, RULE_LABEL, type Finding, type SpotVerdict } from './violations'
import {
  confirmedDays, noticeSpots, pinsOf, renotifyOf, renotifyText,
  type ConfirmEvent, type Renotify,
} from './confirm'
import { ApplicantModal } from './ApplicantModal'
import { ConfirmReschedule } from './ConfirmReschedule'
import { applyProposal } from './proposals'
import { exportChangesCsv, exportCsv, exportSchedule } from './exportXlsx'
import { exportImage } from './exportImage'
import { eulReul, eunNeun, iGa } from './hangul'
import { ProposalPanel } from './ProposalPanel'
import type { Proposal } from './proposals'

type SchedulePageProps = {
  readonly roster: LiteRoster | null
  readonly schedule: LiteSchedule | null
  readonly busy: boolean
  readonly onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  readonly onBack: () => void
  /** 편집 상태가 바뀔 때마다 부른다 — 저장은 앱 껍데기가 맡는다 */
  readonly onEdit?: (state: EditState) => void
  /** 저장돼 있던 편집 상태 */
  readonly saved?: EditState | null
  readonly onNotify?: (text: string) => void
  readonly proposals?: readonly Proposal[]
  readonly onApproveProposal?: (p: Proposal, note: string, next: EditState) => void
  readonly onRejectProposal?: (p: Proposal, note: string) => void
  /** 알림에서 「받은 요청」을 열라는 신호 — 값이 바뀔 때마다 연다 */
  readonly openInbox?: number
  /** 팀 담당자 화면으로 가는 지름길 — 빈 요청함에서 안내한다 */
  readonly onGoTeam?: () => void
  /** 승인으로 생긴 편집을 되돌렸다 — 요청도 대기 중으로 되돌려야 한다 */
  readonly onWithdrawProposal?: (proposalId: string) => void
  /** 일자별 확정·해제 기록 */
  readonly confirms?: readonly ConfirmEvent[]
  readonly onConfirmDay?: (day: number, placed: readonly Placed[]) => void
  readonly onReleaseDay?: (day: number) => void
  /** 확정분을 고정한 채 나머지를 다시 편성한다 — 실제 계산과 저장은 앱 껍데기가 맡는다 */
  readonly onReschedule?: () => void
}

/* ── 끌 수 있는 지원자 카드 ── */
function Card({ p }: { readonly p: Placed }) {
  return (
    <>
      <b>{p.app.name}</b>
      <span>{p.edu} · {p.teams.join(' + ')}</span>
      <small>{p.interviewers.join(' · ')}</small>
    </>
  )
}

/** 카드에 붙일 표식 — 성격(알림/참고)과 출처(내가 만든 것/원래 있던 것)를 함께 가른다.
    패널에서 이미 「내가 만든 위반」과 「1차 편성부터」를 갈라 놓았으니 카드도 같게 맞춘다. */
export type MarkKind = 'alert' | 'new-notice' | 'base-notice' | null
export function markOf(marks: readonly Finding[]): MarkKind {
  if (!marks.length) return null
  if (marks.some(m => m.severity === 'alert')) return 'alert'
  return marks.some(m => !m.sinceBase) ? 'new-notice' : 'base-notice'
}
const MARK_GLYPH: Record<Exclude<MarkKind, null>, string> = { alert: '▲', 'new-notice': '●', 'base-notice': '●' }

/** 표식이 뜻하는 것 — 범례와 툴팁이 같은 문장을 쓴다 */
const MARK_MEANING: Record<Exclude<MarkKind, null>, { title: string; hint: string }> = {
  alert: { title: '같은 시간대 중복', hint: '한 팀·한 면접관이 같은 시각에 두 곳에 있어야 합니다. 손봐야 합니다.' },
  'new-notice': { title: '내가 만든 예외', hint: '1차 편성에는 없던 것으로, 편집하면서 생겼습니다.' },
  'base-notice': { title: '1차 편성부터', hint: '처음 편성될 때부터 있던 것입니다. 굳이 손대지 않아도 됩니다.' },
}

/** 격자가 스크롤 영역 안이라 칸 안에 띄우면 잘린다 — 화면 좌표(fixed)로 띄운다. */
export type Tip = { readonly x: number; readonly y: number; readonly kind: Exclude<MarkKind, null>; readonly items: readonly Finding[] }

function TipBubble({ tip }: { readonly tip: Tip }) {
  const meaning = MARK_MEANING[tip.kind]
  const flipX = tip.x > window.innerWidth - 320
  const flipY = tip.y > window.innerHeight - 180
  return (
    <div
      className={`tip${flipX ? ' flip-x' : ''}${flipY ? ' flip-y' : ''}`}
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      <div className="tip-head"><i className={`mark ${tip.kind}`}>{MARK_GLYPH[tip.kind]}</i> {meaning.title}</div>
      <ul>{tip.items.map(f => <li key={f.key}>{f.detail}</li>)}</ul>
      <p className="tip-hint">{meaning.hint}</p>
    </div>
  )
}

function DraggableCard({
  p, marks, onTip, confirmed, renotify, onOpen,
}: {
  readonly p: Placed
  readonly marks: readonly Finding[]
  readonly onTip: (tip: Tip | null) => void
  /** 이 사람은 이미 통보된 사람인가 */
  readonly confirmed?: boolean
  /** 통보한 자리에서 벗어났나 — 다시 알려야 한다 */
  readonly renotify?: boolean
  readonly onOpen?: (p: Placed) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `app-${p.app.id}` })
  const kind = markOf(marks)
  const detail = marks.map(m => m.detail).join('\n')

  /* 표식에서 툴팁을 띄운다. 카드에 초점이 와도 띄워 키보드로도 읽을 수 있게 한다 —
     표식을 따로 탭 정지로 만들면 카드 수만큼 정지가 늘어난다. */
  const show = (el: Element | null) => {
    if (!kind || !el) return
    const r = el.getBoundingClientRect()
    onTip({ x: r.left + r.width / 2, y: r.bottom + 8, kind, items: marks })
  }
  const hide = () => onTip(null)

  return (
    <div
      ref={setNodeRef}
      className={`cell-card${isDragging ? ' dragging' : ''}${kind ? ` has-${kind}` : ''}`
        + (renotify ? ' renotify' : confirmed ? ' confirmed' : '')}
      {...listeners}
      {...attributes}
      onFocus={e => show(e.currentTarget.querySelector('.mark'))}
      onBlur={hide}
      aria-label={`${p.app.name} ${p.edu} ${p.teams.join(', ')} — ${p.day + 1}일차 ${p.slot + 1}세션 ${p.room + 1}조`
        + (renotify ? '. 통보한 자리에서 벗어났습니다 — 재통보 대상' : confirmed ? '. 확정·통보된 자리' : '')
        + (detail ? `. ${detail}` : '')}
    >
      {renotify && <span className="tag renotify">재통보</span>}
      {onOpen && (
        /* 끌기와 겹치지 않게 pointerdown 을 여기서 끊는다. 드래그 활성화 거리가 4px 라
           가만히 누른 클릭은 드래그로 잡히지 않지만, 눌린 채 손이 흔들리면 카드가 딸려 간다. */
        <button
          type="button" className="card-more" title={`${p.app.name} 상세`}
          aria-label={`${p.app.name} 지원자 상세 보기`}
          onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onOpen(p) }}
        >상세</button>
      )}
      {kind && (
        <span
          className={`mark ${kind}`}
          data-mark={kind}
          aria-hidden="true"
          onMouseEnter={e => show(e.currentTarget)}
          onMouseLeave={hide}
        >{MARK_GLYPH[kind]}</span>
      )}
      <Card p={p} />
    </div>
  )
}

/** 격자 위 범례 — 표식의 뜻을 화면에서 바로 읽을 수 있게.
    기호에 마우스를 올리면 카드의 것과 같은 설명이 뜬다. */
const LEGEND_TEXT: Record<Exclude<MarkKind, null>, string> = {
  alert: '같은 시간대 중복 — 손봐야 합니다',
  'new-notice': '내가 만든 예외 — 학력 구간을 벗어남',
  'base-notice': '1차 편성부터 — 첫 타임 등',
}

function Legend({ onTip }: { readonly onTip: (tip: Tip | null) => void }) {
  const kinds: Exclude<MarkKind, null>[] = ['alert', 'new-notice', 'base-notice']
  return (
    <p className="legend" aria-label="표식 설명">
      {kinds.map(kind => (
        <span key={kind}>
          <i
            className={`mark ${kind}`}
            data-legend={kind}
            tabIndex={0}
            role="button"
            aria-label={`${MARK_MEANING[kind].title} — ${MARK_MEANING[kind].hint}`}
            onMouseEnter={e => {
              const r = e.currentTarget.getBoundingClientRect()
              onTip({ x: r.left + r.width / 2, y: r.bottom + 8, kind, items: [] })
            }}
            onMouseLeave={() => onTip(null)}
            onFocus={e => {
              const r = e.currentTarget.getBoundingClientRect()
              onTip({ x: r.left + r.width / 2, y: r.bottom + 8, kind, items: [] })
            }}
            onBlur={() => onTip(null)}
          >{MARK_GLYPH[kind]}</i> {LEGEND_TEXT[kind]}
        </span>
      ))}
    </p>
  )
}

/* ── 놓을 수 있는 칸 ── */
function Cell({
  spot, occupant, verdict, marks, onTip, confirmed, renotify, onOpen,
}: {
  readonly spot: Spot
  readonly occupant?: Placed
  readonly verdict?: SpotVerdict
  readonly marks: readonly Finding[]
  readonly onTip: (tip: Tip | null) => void
  readonly confirmed?: boolean
  readonly renotify?: boolean
  readonly onOpen?: (p: Placed) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `spot-${spot.day}-${spot.slot}-${spot.room}` })
  // 교환이면 상대 쪽 중복도 빨강이다 — 내 쪽만 깨끗하다고 초록으로 두면 거짓 안심이 된다
  const tone = !verdict ? '' : !verdict.ok ? ' bad' : (verdict.stray || verdict.peer?.stray) ? ' warn' : ' good'
  const joint = occupant && occupant.teams.length > 1
  return (
    <td
      ref={setNodeRef}
      className={`${joint ? 'joint' : ''}${tone}${isOver ? ' over' : ''}`}
      data-spot={`${spot.day}|${spot.slot}|${spot.room}`}
    >
      {occupant
        ? <DraggableCard p={occupant} marks={marks} onTip={onTip} confirmed={confirmed} renotify={renotify} onOpen={onOpen} />
        /* 빈 칸도 자리를 그린다 — 테두리가 없으면 「놓을 수 있는 곳」인지 안 보이고,
           끌고 오는 동안에도 목표가 어디인지 눈으로 못 짚는다 */
        : <div className="cell-empty" aria-hidden="true"><span>여기</span></div>}
    </td>
  )
}

/* ── 드래그 중 커서 옆 라벨 ──
   칸 색은 「문제가 있다」까지만 말한다. 교환은 두 사람이 동시에 움직여서 색만으로는
   **누구 때문인지**를 못 읽는다 — 밀려나는 상대의 사정은 화면 반대편 칸에서 벌어지기 때문이다.
   그래서 끄는 동안 커서를 따라다니는 자리(DragOverlay)에 사유를 적는다. */
function DragLabel({ name, verdict }: { readonly name: string; readonly verdict?: SpotVerdict }) {
  if (!verdict) return null
  const lines: string[] = []
  if (verdict.clashes.length) lines.push(`${name}${iGa(name)} 갈 자리 — ${verdict.clashes.join(' · ')}`)
  if (verdict.peer?.clashes.length) {
    lines.push(`${verdict.peer.name}${iGa(verdict.peer.name)} 갈 자리 — ${verdict.peer.clashes.join(' · ')}`)
  }
  if (!lines.length && verdict.stray) lines.push(`${name}${eunNeun(name)} 학력 구간 밖입니다`)
  if (!lines.length && verdict.peer?.stray) lines.push(`${verdict.peer.name}${eunNeun(verdict.peer.name)} 학력 구간 밖으로 갑니다`)
  if (!lines.length) return null
  return (
    <div className={`drag-label${verdict.ok ? '' : ' bad'}`}>
      {verdict.peer && <b>{name} ⇄ {verdict.peer.name}</b>}
      {lines.map(t => <span key={t}>{t}</span>)}
    </div>
  )
}

/* ── 미배정 서랍의 한 명 ── */
function DrawerCard({ app, byUser }: { readonly app: Applicant; readonly byUser: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `app-${app.id}` })
  return (
    <div
      ref={setNodeRef}
      className={`drawer-card${isDragging ? ' dragging' : ''}`}
      {...listeners}
      {...attributes}
      aria-label={`${app.name} ${app.edu} ${app.teams.join(', ')} — 미배정`}
    >
      <b>{app.name}</b>
      <span>{app.edu} · {app.teams.join(' + ')}</span>
      <small>{byUser ? '담당자가 뺌' : '엔진이 넣지 못함'}</small>
    </div>
  )
}

export function SchedulePage({
  roster, schedule, busy, onUpload, onBack, onEdit, saved, onNotify, confirms = [],
  onConfirmDay, onReleaseDay, onReschedule,
  proposals = [], onApproveProposal, onRejectProposal, openInbox = 0, onGoTeam, onWithdrawProposal,
}: SchedulePageProps) {
  const [day, setDay] = useState(0)
  const [panel, setPanel] = useState<'none' | 'violations' | 'history' | 'people' | 'renotify'>('none')
  /** 오른쪽 서랍(받은 요청) 열림 여부 */
  const [inbox, setInbox] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  /** 지금 커서가 올라가 있는 칸 — 라벨에 어느 칸의 사정을 적을지 고른다 */
  const [overKey, setOverKey] = useState<string | null>(null)
  const [undoHint, setUndoHint] = useState<{ readonly text: string; readonly seq: number } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  /** 다시 편성 확인 창 */
  const [askReschedule, setAskReschedule] = useState(false)
  /** 지원자 상세 창 — 열려 있는 지원자 */
  const [detail, setDetail] = useState<Placed | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const seqRef = useRef(0)

  const base = schedule?.result ?? null
  const [state, dispatch] = useReducer(
    editReducer,
    null,
    () => saved ?? (base ? initEdit(base) : initEdit({ placed: [], unplaced: [], cfg: { sessions: 1 } } as never)),
  )

  /* 저장된 편집분은 **편성표가 바뀌는 순간에만** 읽는다.
     `saved` 를 의존성에 두면 위로 올린 상태가 다시 내려와 두 effect 가 서로를 깨우고,
     같은 값의 사본이 오가며 렌더가 끝나지 않는다(실제로 그렇게 만들어 봤다).
     아래로는 한 번만 흘리고, 위로만 보고한다. */
  const savedRef = useRef(saved)
  savedRef.current = saved
  const initedFor = useRef(base)

  useEffect(() => {
    if (!base || initedFor.current === base) return
    initedFor.current = base
    const keep = savedRef.current
    dispatch(keep && keep.base === base ? { type: 'load', state: keep } : { type: 'reset', base })
    setDay(0)
  }, [base])

  // 위로 보고 — 처음 한 번은 고친 것이 없으니 건너뛴다(600KB 를 헛되이 다시 쓰지 않는다)
  const sentRef = useRef<EditState | null>(null)
  useEffect(() => {
    if (!state.base || !onEdit) return
    if (sentRef.current === state) return
    if (sentRef.current === null && state.events.length === 0) { sentRef.current = state; return }
    sentRef.current = state
    onEdit(state)
  }, [state, onEdit])

  // 종 알림에서 부르면 서랍을 연다
  const inboxSignal = useRef(openInbox)
  useEffect(() => {
    if (openInbox === inboxSignal.current) return
    inboxSignal.current = openInbox
    setInbox(true)
  }, [openInbox])

  // 메뉴 바깥을 누르면 닫는다
  useEffect(() => {
    if (!exportOpen) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest('.export-wrap')) setExportOpen(false)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [exportOpen])

  // 되돌리기 안내는 잠깐만 띄운다
  useEffect(() => {
    if (!undoHint) return
    const t = window.setTimeout(() => setUndoHint(null), 8000)
    return () => window.clearTimeout(t)
  }, [undoHint])

  /* 되돌리기는 버튼과 Ctrl+Z 두 길로 들어오는데 하는 일이 같아야 한다.
     승인으로 생긴 편집이면 요청도 함께 되돌린다 — 표만 원복하고 요청을 「승인함」으로 두면
     팀은 자리가 옮겨진 줄 안다. */
  const undoRef = useRef<() => void>(() => {})
  const undo = useCallback(() => {
    const last = state.events[state.events.length - 1]
    if (!last) return
    dispatch({ type: 'undo' })
    setUndoHint(null)
    if (last.proposalId && onWithdrawProposal) {
      onWithdrawProposal(last.proposalId)
      onNotify?.(`되돌렸습니다 — ${eventText(last)} · 팀 요청은 다시 대기 중이 됩니다.`)
    } else {
      onNotify?.(`되돌렸습니다 — ${eventText(last)}`)
    }
  }, [state.events, onNotify, onWithdrawProposal])
  undoRef.current = undo

  // Ctrl/Cmd+Z
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor))

  const grid = useMemo(() => gridOf(state.placed), [state.placed])
  const verdict = useMemo(() => base ? judge(base, state.placed, state.acks) : null, [base, state.placed, state.acks])
  const spans = useMemo(() => base ? baseSpans(base) : {}, [base])
  /* 확정된 날짜와, 통보한 자리에서 벗어난 사람들.
     확정 뒤에도 이동은 막지 않는다(D1) — 대신 「누구에게 다시 알려야 하나」를 집어낸다. */
  const confirmedSet = useMemo(() => confirmedDays(confirms), [confirms])
  const notices = useMemo(() => noticeSpots(confirms), [confirms])
  const renotify = useMemo(() => renotifyOf(state.placed, confirms), [state.placed, confirms])
  const renotifyIds = useMemo(() => new Set(renotify.map(r => r.appId)), [renotify])

  const pinPreview = useMemo(() => {
    const confirmed = new Set(pinsOf(state.placed, confirms).map(p => p.id))
    const touched = new Set<number>()
    for (const id of touchedIds(state.events))
      if (!confirmed.has(id) && state.placed.some(p => p.app.id === id)) touched.add(id)
    return { confirmed: confirmed.size, touched: touched.size }
  }, [state.placed, state.events, confirms])

  const marksBySpot = useMemo(() => {
    const m = new Map<string, Finding[]>()
    if (!verdict) return m
    for (const f of verdict.findings) {
      if (f.day === undefined || f.slot === undefined) continue
      for (const p of state.placed) {
        if (p.day !== f.day || p.slot !== f.slot) continue
        if (f.appId !== undefined && p.app.id !== f.appId) continue
        if (f.team && !p.teams.includes(f.team)) continue
        const k = `${p.day}|${p.slot}|${p.room}`
        const list = m.get(k)
        if (list) list.push(f)
        else m.set(k, [f])
      }
    }
    return m
  }, [verdict, state.placed])

  // 담당자가 뺀 사람과 엔진이 못 넣은 사람을 가른다
  const removedByUser = useMemo(() => removedIds(state.events), [state.events])

  const dragged = dragging === null ? null
    : state.placed.find(p => p.app.id === dragging) ?? state.unplaced.find(a => a.id === dragging) ?? null
  const draggedApp = dragged && 'app' in dragged ? dragged.app : (dragged as Applicant | null)

  const blocksNow = verdict?.blocks ?? 0
  /* 점유 칸도 뺄 수 없다 — 그게 교환이고, 교환이야말로 상대가 밀려나서 예고가 필요한 자리다.
     미배정 카드는 교환할 자리가 없으니 점유 칸을 건너뛴다(놓아도 아무 일이 없다). */
  const fromDrawer = !!draggedApp && !state.placed.some(p => p.app.id === draggedApp.id)
  const preview = useMemo(() => {
    if (!base || !draggedApp) return null
    const out = new Map<string, SpotVerdict>()
    for (let s = 0; s < base.cfg.sessions; s++) {
      for (let r = 0; r < base.cfg.rooms; r++) {
        const spot = { day, slot: s, room: r }
        const key = `${day}|${s}|${r}`
        const held = grid[key]
        if (held && held.app.id === draggedApp.id) { out.set(key, previewSpot(base, state.placed, draggedApp, spot, spans, blocksNow)); continue }
        if (held && fromDrawer) continue
        out.set(key, previewSpot(base, state.placed, draggedApp, spot, spans, blocksNow, held))
      }
    }
    return out
  }, [base, draggedApp, day, grid, state.placed, spans, blocksNow, fromDrawer])

  if (!schedule || !base) {
    return (
      <section className="page" aria-labelledby="schedule-title">
        <h1 id="schedule-title">면접 일정 편성</h1>
        <p className="caption">팀 회신을 올리면 본제품과 같은 엔진 경로로 편성표를 만들고, 그 뒤로는 손으로 고칠 수 있습니다.</p>
        <UploadPanel roster={roster} schedule={schedule} busy={busy} onUpload={onUpload} onBack={onBack} />
        <div className="sample-path"><b>샘플 파일</b> tests/sample_data/희망지원자_*_re.xlsx · 여러 파일을 한 번에 선택하세요.</div>
        <div className="panel empty" role="status">{roster ? '팀 회신 엑셀을 올리면 일자 탭과 편성 격자가 표시됩니다.' : '먼저 지원자 명단을 등록하세요.'}</div>
      </section>
    )
  }

  const onDragStart = (e: DragStartEvent) => {
    setTip(null)
    setOverKey(null)
    const id = String(e.active.id)
    if (id.startsWith('app-')) setDragging(Number(id.slice(4)))
  }

  const onDragOver = (e: DragOverEvent) => {
    const id = e.over ? String(e.over.id) : null
    if (!id || !id.startsWith('spot-')) { setOverKey(null); return }
    const [, d, s, r] = id.split('-').map(Number)
    setOverKey(`${d}|${s}|${r}`)
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    setOverKey(null)
    const activeId = String(e.active.id)
    if (!activeId.startsWith('app-')) return
    const appId = Number(activeId.slice(4))
    const overId = e.over ? String(e.over.id) : null
    if (!overId) return

    if (overId === 'drawer') {
      if (state.placed.some(p => p.app.id === appId)) {
        const who = state.placed.find(p => p.app.id === appId)!
        dispatch({ type: 'remove', appId, actor: DEFAULT_ACTOR })
        setUndoHint({ text: `${who.app.name} 배정을 취소했습니다.`, seq: ++seqRef.current })
      }
      return
    }
    if (!overId.startsWith('spot-')) return
    const [, d, s, r] = overId.split('-').map(Number)
    const to: Spot = { day: d, slot: s, room: r }
    const from = state.placed.find(p => p.app.id === appId)
    const occupant = state.placed.find(p => p.day === d && p.slot === s && p.room === r)

    if (occupant && occupant.app.id === appId) return

    if (from) {
      if (occupant) dispatch({ type: 'swap', appId, peerAppId: occupant.app.id, actor: DEFAULT_ACTOR })
      else dispatch({ type: 'move', appId, to, actor: DEFAULT_ACTOR })
    } else {
      if (occupant) return
      dispatch({ type: 'place', appId, to, actor: DEFAULT_ACTOR })
    }

    // 놓은 뒤 딸려온 것만 알린다 — ① 은 담당자가 알고 한 것이라 조용히 둔다.
    // 교환이면 상대가 밀려간 자리도 말한다. 끌던 사람만 보면 절반만 알리는 셈이다.
    const app = from?.app ?? state.unplaced.find(a => a.id === appId)
    if (!app) return
    const v = previewSpot(base, state.placed, app, to, spans, blocksNow, from ? occupant : undefined)
    const parts: string[] = []
    if (v.clashes.length) parts.push(`${app.name}${eunNeun(app.name)} ${v.clashes.join(' · ')}`)
    if (v.peer?.clashes.length) parts.push(`${v.peer.name}${iGa(v.peer.name)} 간 자리에 ${v.peer.clashes.join(' · ')}`)
    if (v.linkDelta > 0) parts.push(`면접방 이동이 ${v.linkDelta}건 늘었습니다`)
    if (parts.length) setUndoHint({ text: parts.join(' / '), seq: ++seqRef.current })
  }

  const goTo = (f: Finding) => { if (f.day !== undefined) setDay(f.day) }

  const run = async (what: () => string | Promise<string>) => {
    setExportOpen(false)
    try { const name = await what(); onNotify?.(`${name}${eulReul(name)} 내려받았습니다.`) }
    catch (reason) { onNotify?.(reason instanceof Error ? reason.message : '내보내기에 실패했습니다.') }
  }

  const dirty = isDirty(state)
  const pendingCount = proposals.filter(p => p.status === 'pending').length
  /** 아직 확정하지 않은 날짜 — 다시 편성이 손대는 범위다 */
  const openDays = base.dates.map((_, i) => i).filter(d => !confirmedSet.has(d))

  return (
    <section className="page wide" aria-labelledby="schedule-title">
      <h1 id="schedule-title">면접 일정 편성</h1>
      <p className="caption">
        1차 편성 결과입니다. 카드를 끌어 옮기거나 바꾸고, 오른쪽 서랍으로 빼낼 수 있습니다.
        제약을 어겨도 막지 않습니다 — 대신 표시만 남깁니다.
      </p>

      <UploadPanel roster={roster} schedule={schedule} busy={busy} onUpload={onUpload} onBack={onBack} />

      <div className="panel summary" aria-label="편성 요약">
        <span className="chip"><span className="dot" />편성 <b>{state.placed.length}명</b></span>
        <span className="chip">일수 <b>{base.totalDays}일</b></span>
        <span className="chip">미배정 <b>{state.unplaced.length}명</b></span>
        <button className={`chip button-chip${verdict!.openNew ? ' danger' : ''}`} type="button" onClick={() => setPanel(p => p === 'violations' ? 'none' : 'violations')}>
          내가 만든 위반 <b>{verdict!.openNew}</b>
        </button>
        <button className="chip button-chip" type="button" onClick={() => setPanel(p => p === 'violations' ? 'none' : 'violations')}>
          예외 <b>{verdict!.acked}</b>
        </button>
        <span className="chip">면접방 이동 <b>{verdict!.blocks}건</b></span>
        <button className="chip button-chip" type="button" onClick={() => setPanel(p => p === 'history' ? 'none' : 'history')}>
          변경 <b>{state.events.length}건</b>
        </button>
        {confirmedSet.size > 0 && (
          <button className={`chip button-chip${renotify.length ? ' danger' : ''}`} type="button"
            onClick={() => setPanel(p => p === 'renotify' ? 'none' : 'renotify')}>
            재통보 <b>{renotify.length}명</b>
          </button>
        )}
        <button className="chip button-chip" type="button" onClick={() => setPanel(p => p === 'people' ? 'none' : 'people')}>
          면접관 일정
        </button>
        <button className={`chip button-chip${pendingCount ? ' hot' : ''}`} type="button"
          aria-expanded={inbox} onClick={() => setInbox(o => !o)}>
          받은 요청 <b>{pendingCount}건</b>
        </button>
        <button className="button" type="button" onClick={undo} disabled={!dirty}>되돌리기</button>
        <div className="export-wrap">
          <button className="button" type="button" aria-expanded={exportOpen} aria-haspopup="menu"
            onClick={() => setExportOpen(o => !o)}>내보내기 ▾</button>
          {exportOpen && (
            <div className="export-menu" role="menu">
              <div className="export-group">그림</div>
              <button type="button" role="menuitem" onClick={() => run(() => exportImage(base, state, verdict!.findings, { day }))}>
                이 날짜 편성표 (PNG)<small>{base.dates[day]?.label}</small>
              </button>
              <button type="button" role="menuitem" onClick={() => run(() => exportImage(base, state, verdict!.findings))}>
                전 일자 편성표 (PNG)<small>{base.totalDays}일치를 한 장에</small>
              </button>
              <div className="export-group">표</div>
              <button type="button" role="menuitem" onClick={() => run(() => exportCsv(base, state, schedule.setup))}>
                편성표 (CSV)<small>메일·다른 도구에 붙이기</small>
              </button>
              <button type="button" role="menuitem" onClick={() => run(() => exportChangesCsv(base, state, schedule.setup))}>
                변경 요약 (CSV)<small>{state.events.length}건</small>
              </button>
              <button type="button" role="menuitem" onClick={() => run(() => exportSchedule(base, state, verdict!, schedule.setup))}>
                전체 (XLSX)<small>편성표 · 변경 요약 · 확인 목록</small>
              </button>
            </div>
          )}
        </div>
      </div>

      {panel === 'violations' && <ViolationPanel verdict={verdict!} acks={state.acks} onGo={goTo}
        onAck={key => dispatch({ type: 'ack', key })} onUnack={key => dispatch({ type: 'unack', key })} />}
      {panel === 'history' && <HistoryPanel state={state} />}
      {panel === 'people' && <PeoplePanel base={base} placed={state.placed} onGo={setDay} onOpen={setDetail} />}
      {panel === 'renotify' && <RenotifyPanel base={base} list={renotify} onGo={goTo} />}
      {detail && (
        <ApplicantModal
          p={detail} role="hr" onClose={() => setDetail(null)}
          placementText={`${detail.day + 1}일차 ${base.times[detail.slot]?.label ?? `${detail.slot + 1}세션`} ${detail.room + 1}조`}
        />
      )}
      {askReschedule && (
        <ConfirmReschedule
          openDays={openDays}
          confirmedDays={confirmedSet.size}
          confirmedPeople={pinPreview.confirmed}
          touched={pinPreview.touched}
          replaced={state.placed.length - pinPreview.confirmed - pinPreview.touched}
          onCancel={() => setAskReschedule(false)}
          onProceed={() => { setAskReschedule(false); onReschedule?.() }}
        />
      )}
      {inbox && (
        <ProposalPanel
          base={base} state={state} proposals={proposals} onGo={setDay} onClose={() => setInbox(false)}
          onGoTeam={onGoTeam && (() => { setInbox(false); onGoTeam() })}
          onApprove={(p, note) => {
            const next = applyProposal(state, p, DEFAULT_ACTOR.name)
            dispatch({ type: 'load', state: next })
            onApproveProposal?.(p, note, next)
            onNotify?.(`${p.appName} 요청을 승인해 편성표에 반영했습니다.`)
          }}
          onReject={(p, note) => {
            onRejectProposal?.(p, note)
            onNotify?.(`${p.fromTeam}에 거절 사유를 회신했습니다.`)
          }}
        />
      )}

      {/* 단계적 확정 — 1일차를 확정해 통보하고 나면 그 날짜는 굳는다. 확정한 뒤에도 이동은
          막지 않되(D1), 통보한 자리에서 벗어난 사람을 재통보 대상으로 집어낸다. */}
      <div className="day-row">
      <div className="day-tabs" aria-label="면접 일자">
        {base.dates.map((date, index) => (
          <button key={date.iso} type="button" aria-pressed={day === index} onClick={() => setDay(index)}
            className={confirmedSet.has(index) ? 'is-confirmed' : undefined}>
            {index + 1}일차 {date.iso.slice(5).replace('-', '/')}({date.wd})
            {confirmedSet.has(index) && <i className="tag confirmed" aria-label="확정됨">확정</i>}
          </button>
        ))}
      </div>
        {confirmedSet.has(day) ? (
          <button className="button" type="button" onClick={() => onReleaseDay?.(day)}>
            {day + 1}일차 확정 해제
          </button>
        ) : (
          <button className="button primary" type="button"
            onClick={() => onConfirmDay?.(day, state.placed)}
            disabled={!state.placed.some(p => p.day === day)}>
            {day + 1}일차 확정
          </button>
        )}
        {confirmedSet.size > 0 && openDays.length > 0 && onReschedule && (
          <button className="button" type="button" onClick={() => setAskReschedule(true)}>
            {openDays.map(d => `${d + 1}일차`).join('·')} 다시 편성
          </button>
        )}
      </div>
      {confirmedSet.has(day) && (
        <p className="confirm-note">
          {day + 1}일차는 확정·통보된 날짜입니다. 고칠 수는 있지만 옮긴 사람은 재통보 대상이 됩니다.
        </p>
      )}

      {/* 격자에서는 「가장 가까운 칸」이 사람의 기대와 맞는다. 그리고 끄는 동안 칸 위치를 계속
          다시 잰다 — 하루 탭을 바꾸거나 표가 스크롤되면 처음 잰 값이 어긋나기 때문이다. */}
      <Legend onTip={setTip} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => { setDragging(null); setOverKey(null) }}
      >
        <div className={`editor${inbox ? ' with-inbox' : ''}`}>
          <div className="table-wrap schedule-table" tabIndex={0}>
            <table>
              <thead><tr><th>시간</th>{Array.from({ length: base.cfg.rooms }, (_, room) => <th key={room}>{room + 1}조</th>)}</tr></thead>
              <tbody>
                {base.times.map((time, slot) => (
                  <tr key={time.i}>
                    <th>{time.label.split('–')[0]}</th>
                    {Array.from({ length: base.cfg.rooms }, (_, room) => {
                      const key = `${day}|${slot}|${room}`
                      return (
                        <Cell key={room} spot={{ day, slot, room }} occupant={grid[key]}
                          verdict={preview?.get(key)} marks={marksBySpot.get(key) ?? []} onTip={setTip}
                          confirmed={!!grid[key] && notices.has(grid[key].app.id)}
                          renotify={!!grid[key] && renotifyIds.has(grid[key].app.id)}
                          onOpen={setDetail} />
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Drawer unplaced={state.unplaced} removedByUser={removedByUser} onExpand={() => setInbox(false)} />
        </div>

        <DragOverlay dropAnimation={null}>
          {draggedApp && (
            <div className="drag-ghost-wrap">
              <div className="cell-card drag-ghost"><b>{draggedApp.name}</b><span>{draggedApp.edu} · {draggedApp.teams.join(' + ')}</span></div>
              <DragLabel name={draggedApp.name} verdict={overKey ? preview?.get(overKey) : undefined} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <p className="more">{base.cfg.sessions}세션 × {base.cfg.rooms}조 · 카드를 끌어 옮기세요. 되돌리기는 Ctrl+Z 입니다.</p>

      {tip && <TipBubble tip={tip} />}

      {undoHint && (
        <div className="undo-toast" role="status" key={undoHint.seq}>
          <span>{undoHint.text}</span>
          <button className="button" type="button" onClick={undo}>되돌리기</button>
        </div>
      )}
    </section>
  )
}

function UploadPanel({ roster, schedule, busy, onUpload, onBack }: Pick<SchedulePageProps, 'roster' | 'schedule' | 'busy' | 'onUpload' | 'onBack'>) {
  return (
    <div className="panel upload-panel">
      <div>
        <h2>팀 회신 올리기</h2>
        <div className="chip-row">
          <span className="chip">명단 <b>{roster ? `${roster.candidates.length}명` : '필요'}</b></span>
          {schedule && <span className="chip">회신 <b>{schedule.sourceCount}개</b></span>}
        </div>
      </div>
      {roster ? (
        <input className="file-input primary-file" aria-label="팀 회신 엑셀 업로드" type="file" accept=".xlsx" multiple disabled={busy} onChange={onUpload} />
      ) : (
        <button className="button" type="button" onClick={onBack}>지원자 명단 먼저 등록</button>
      )}
    </div>
  )
}

/* 미배정 서랍. 받은 요청 서랍이 열리면 좁은 레일로 접히지만 **사라지지는 않는다** —
   숨기면(display:none) 크기가 0이 되어 놓는 자리 자체가 없어지고,
   배정 취소가 아무 말 없이 안 된다(실제로 그랬다). 레일에서도 끌어다 놓을 수 있다.
   레일 상태에서 안에 있는 사람을 다시 꺼내려면 「펼치기」로 받은 요청을 닫는다. */
function Drawer({
  unplaced, removedByUser, onExpand,
}: {
  readonly unplaced: readonly Applicant[]
  readonly removedByUser: ReadonlySet<number>
  readonly onExpand: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'drawer' })
  return (
    <aside ref={setNodeRef} className={`drawer${isOver ? ' over' : ''}`} aria-label="미배정">
      <div className="drawer-head">미배정 <b>{unplaced.length}명</b></div>
      {unplaced.length > 0 && (
        <button className="drawer-expand" type="button" onClick={onExpand}
          title="받은 요청을 닫고 미배정 목록을 펼칩니다">펼치기</button>
      )}
      {unplaced.length === 0
        ? <p className="drawer-empty">여기로 끌어오면 배정을 취소합니다.</p>
        : unplaced.map(a => <DrawerCard key={a.id} app={a} byUser={removedByUser.has(a.id)} />)}
    </aside>
  )
}

function ViolationPanel({
  verdict, acks, onGo, onAck, onUnack,
}: {
  readonly verdict: ReturnType<typeof judge>
  readonly acks: Readonly<Record<string, string>>
  readonly onGo: (f: Finding) => void
  readonly onAck: (key: string) => void
  readonly onUnack: (key: string) => void
}) {
  const open = verdict.findings.filter(f => !(f.key in acks))
  const fresh = open.filter(f => !f.sinceBase)
  const old = open.filter(f => f.sinceBase)
  const done = verdict.findings.filter(f => f.key in acks)
  const row = (f: Finding, acked: boolean) => (
    <li key={f.key} className={acked ? 'acked' : f.severity}>
      <button type="button" className="v-go" onClick={() => onGo(f)}>
        <span className="v-rule">{RULE_LABEL[f.rule]}</span>
        <span>{f.detail}</span>
      </button>
      <button type="button" className="switch" onClick={() => (acked ? onUnack(f.key) : onAck(f.key))}>
        {acked ? '예외 해제' : '알고 있음'}
      </button>
    </li>
  )
  return (
    <div className="panel v-panel">
      <h2>내가 만든 위반 {fresh.length}건</h2>
      {fresh.length === 0
        ? <p className="drawer-empty">1차 편성에서 어긋난 곳이 더 늘지 않았습니다.</p>
        : <ul className="v-list">{fresh.map(f => row(f, false))}</ul>}

      {done.length > 0 && (
        <>
          <h3 className="v-sub">알고 있음으로 표시한 것 {done.length}건</h3>
          <ul className="v-list">{done.map(f => row(f, true))}</ul>
        </>
      )}

      {old.length > 0 && (
        <details className="v-old">
          <summary>1차 편성부터 있던 것 {old.length}건</summary>
          <ul className="v-list">{old.map(f => row(f, false))}</ul>
        </details>
      )}
    </div>
  )
}

/* 면접관 한 사람의 하루를 가로 시간축으로 —
   「저 10시에 안 됩니다」 민원이 오면 그 사람 일정을 바로 확인하는 자리다(미팅 39:47).
   읽기 전용이다. 여기서 고치지 않는다. */
function PeoplePanel({
  base, placed, onGo, onOpen,
}: {
  readonly base: NonNullable<SchedulePageProps['schedule']>['result']
  readonly placed: readonly Placed[]
  readonly onGo: (day: number) => void
  readonly onOpen: (p: Placed) => void
}) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const by = new Map<string, Placed[]>()
    for (const p of placed) for (const iv of p.interviewers) {
      const list = by.get(iv)
      if (list) list.push(p)
      else by.set(iv, [p])
    }
    return [...by.entries()]
      .map(([name, list]) => ({
        name,
        teams: [...new Set(list.flatMap(p => p.teams))],
        slots: list.slice().sort((a, b) => a.day - b.day || a.slot - b.slot),
        /* 같은 시간대에 두 건 — 물리적으로 불가능하다 */
        clash: new Set(list.map(p => `${p.day}|${p.slot}`)).size !== list.length,
      }))
      .sort((a, b) => Number(b.clash) - Number(a.clash) || b.slots.length - a.slots.length || a.name.localeCompare(b.name))
  }, [placed])

  const shown = q.trim() ? rows.filter(r => r.name.includes(q.trim()) || r.teams.some(t => t.includes(q.trim()))) : rows

  return (
    <div className="panel v-panel">
      <h2>면접관 일정 {rows.length}명</h2>
      <input className="people-find" type="search" placeholder="면접관 이름이나 팀으로 찾기"
        aria-label="면접관 찾기" value={q} onChange={e => setQ(e.target.value)} />
      <ul className="people-list">
        {shown.map(r => (
          <li key={r.name} className={r.clash ? 'clash' : undefined}>
            <div className="p-who">
              <b>{r.name}</b>
              <span>{r.teams.join(', ')} · {r.slots.length}건{r.clash ? ' · 같은 시간대 겹침' : ''}</span>
            </div>
            <div className="p-slots">
              {r.slots.map(p => (
                <span key={`${p.day}|${p.slot}|${p.room}`} className="p-pair">
                  <button type="button" className="p-slot" onClick={() => onGo(p.day)}
                    title={`${p.app.name} · ${p.teams.join(', ')}`}>
                    {p.day + 1}일 {base.times[p.slot]?.label.split('–')[0] ?? `${p.slot + 1}세션`} · {p.room + 1}조
                  </button>
                  <button type="button" className="p-name" onClick={() => onOpen(p)}
                    title={`${p.app.name} 지원자 상세`}>{p.app.name}</button>
                </span>
              ))}
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="drawer-empty">찾는 면접관이 없습니다.</li>}
      </ul>
    </div>
  )
}

/* 재통보 명단 — 통보한 뒤 자리가 달라진 사람들.
   변경 이력은 「무엇을 했나」를 시간순으로 쌓지만, 재통보에 필요한 것은 「통보한 것과 지금이
   어떻게 다른가」다. 두 번 옮긴 사람은 이력에 두 줄이지만 재통보 명단에는 한 줄이어야 한다. */
function RenotifyPanel({
  base, list, onGo,
}: {
  readonly base: Result
  readonly list: readonly Renotify[]
  readonly onGo: (f: Finding) => void
}) {
  const dayLabel = (d: number) => `${d + 1}일차`
  const slotLabel = (sl: number) => base.times[sl]?.label.split('–')[0] ?? `${sl + 1}세션`
  return (
    <div className="panel v-panel">
      <h2>재통보 대상 {list.length}명</h2>
      {list.length === 0
        ? <p className="drawer-empty">확정한 날짜를 손대지 않았습니다. 다시 알릴 사람이 없습니다.</p>
        : <ul className="h-list">{list.map(r => (
            <li key={r.appId}>
              <button type="button" className="link"
                onClick={() => onGo({ day: r.now?.day ?? r.was?.day ?? 0 } as Finding)}>
                {renotifyText(r, dayLabel, slotLabel)}
              </button>
            </li>
          ))}</ul>}
    </div>
  )
}

function HistoryPanel({ state }: { readonly state: EditState }) {
  const list = [...state.events].reverse()
  return (
    <div className="panel v-panel">
      <h2>변경 이력 {state.events.length}건</h2>
      {list.length === 0
        ? <p className="drawer-empty">아직 고친 것이 없습니다.</p>
        : <ol className="h-list">{list.map(e => (
            <li key={e.id}>
              <span className="h-time">{hhmm(e.ts)}</span>
              <span className="h-who">{e.actorName}</span>
              <span className="h-what">{eventText(e)}</span>
            </li>
          ))}</ol>}
    </div>
  )
}
