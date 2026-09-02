import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Bell } from 'lucide-react'
import { ChatBot } from './ChatBot'
import { RosterPage } from './RosterPage'
import { SchedulePage } from './SchedulePage'
import { WorkspacePage } from './WorkspacePage'
import { DemoPage, applySide, storedSide } from './DemoPage'
import { DEMO_PAGES } from './demoPages'
import { buildSchedule, readRoster, rescheduleWith, type LiteRoster, type LiteSchedule } from './data'
import { editReducer, initEdit } from './edit'
import { ConfirmReupload } from './ConfirmReupload'
import { judge } from './violations'
import { exportSchedule } from './exportXlsx'
import { clearSession, loadSession, saveSession, ulid } from './persist'
import { confirmDay, confirmedDays, releaseDay, type ConfirmEvent } from './confirm'
import { SetupPage } from './SetupPage'
import { DEFAULT_SETUP, lastSetup, rememberSetup, type Setup } from './setup'
import type { EditState } from './edit'
import { TeamSchedulePage } from './TeamSchedulePage'
import {
  decide, inboxOf, markRepliesSeen, replyText, unreadRepliesOf,
  withdraw, KIND_LABEL, type Proposal,
} from './proposals'

export type LiteRole = 'hr' | 'lead' | 'iv' | 'app'

/** 역할을 바꾸면 그 역할의 첫 화면으로 돌아간다. */
export const HOME: Record<LiteRole, string> = { hr: 'dash', lead: 't-pick', iv: 'i-sched', app: 'a-guide' }

const USERS: Record<LiteRole, { readonly name: string; readonly sub: string }> = {
  hr: { name: '김간사', sub: '인사팀' },
  lead: { name: '박팀장', sub: '전극기술팀' },
  iv: { name: '이위원', sub: 'AI솔루션팀' },
  app: { name: '이서아', sub: '지원자' },
}

const ROLES: readonly { readonly role: LiteRole; readonly label: string }[] = [
  { role: 'hr', label: 'HR 간사' },
  { role: 'lead', label: '팀 담당자' },
  { role: 'iv', label: '면접위원' },
  { role: 'app', label: '지원자' },
]

/** 시안 JS 의 data-goto 값 중 라이트 데모에서 실제 동작하는 화면 키로 바꿔야 하는 것들. */
const GOTO_ALIAS: Record<string, string> = { sched: 'schedule', cand: 'roster' }

type NavEntry =
  | { readonly kind: 'label'; readonly text: string }
  | { readonly kind: 'item'; readonly page: string; readonly label: string; readonly badge?: string; readonly hot?: boolean }

const NAV: Record<LiteRole, readonly NavEntry[]> = {
  hr: [
    { kind: 'item', page: 'dash', label: '운영 대시보드' },
    { kind: 'label', text: '전형 진행 순서' },
    { kind: 'item', page: 'setup', label: '전형 설정' },
    { kind: 'item', page: 'roster', label: '지원자 명단 등록' },
    { kind: 'item', page: 'req', label: '조직 희망자 취합', badge: '8/8팀' },
    { kind: 'item', page: 'verify', label: '취합 데이터 검증', badge: '결측 0' },
    { kind: 'item', page: 'schedule', label: '면접 일정 편성' },
    { kind: 'item', page: 'change', label: '변경 대응과 재통보', badge: '3건', hot: true },
    { kind: 'item', page: 'close', label: '전형 종료와 산출물' },
  ],
  lead: [
    { kind: 'label', text: '우리 팀 할 일' },
    { kind: 'item', page: 't-pick', label: '면접 희망자 선택', badge: '14건' },
    { kind: 'item', page: 't-avail', label: '면접위원 불가 시간', badge: '2/3명' },
    { kind: 'item', page: 't-avoid', label: '회피 관계 신고', badge: '1건' },
    { kind: 'label', text: '편성 이후' },
    { kind: 'item', page: 't-sched', label: '우리 팀 면접 일정', badge: '14건' },
  ],
  iv: [
    { kind: 'label', text: '나의 면접' },
    { kind: 'item', page: 'i-sched', label: '나의 면접 일정', badge: '8건' },
    { kind: 'item', page: 'i-work', label: '면접 진행 워크스페이스', badge: '오늘 3건' },
    { kind: 'item', page: 'i-evals', label: '평가 제출 현황', badge: '5/8' },
  ],
  app: [
    { kind: 'label', text: '나의 면접' },
    { kind: 'item', page: 'a-guide', label: '나의 면접 안내', badge: '확정' },
  ],
}

/** 팀 담당자 시연 계정이 속한 팀 — 사이드바의 「박팀장 · 전극기술팀」과 맞춘다 */
const TEAM_OF_LEAD = '전극기술팀'

const SETTINGS: Extract<NavEntry, { kind: 'item' }> = { kind: 'item', page: 'settings', label: '설정' }

type Notice = {
  readonly key: string
  readonly title: string
  readonly meta: string
  readonly page?: string
  readonly tag?: string
  readonly hot?: boolean
  /** 열면서 받은 요청 서랍까지 펼칠지 */
  readonly inbox?: boolean
}

/** 팀 요청이 없을 때 보이는 기본 알림 — 시연용 예시다 */
const STATIC_NOTICES: readonly Notice[] = [
  { key: 's1', title: '전극기술팀이 아직 선택 중입니다', meta: '회신 마감이 이틀 남았습니다. 10분 전', page: 'req' },
  { key: 's2', title: '지원자 190 취소 요청이 접수되었습니다', meta: '변경 대응과 재통보에서 처리합니다. 1시간 전', page: 'change' },
  { key: 's3', title: '새 기능 안내', meta: '편성 격자에서 면접위원별 강조를 지원합니다. 어제' },
]

const ago = (ts: string) => `${ts.slice(5, 10).replace('-', '/')} ${ts.slice(11, 16)}`

type LiteAppProps = {
  readonly initialRole?: LiteRole
  readonly initialPage?: string
}

export function LiteApp({ initialRole = 'hr', initialPage }: LiteAppProps = {}) {
  const [role, setRole] = useState<LiteRole>(initialRole)
  const [page, setPage] = useState<string>(initialPage ?? HOME[initialRole])
  const [bellOpen, setBellOpen] = useState(false)
  const [roster, setRoster] = useState<LiteRoster | null>(null)
  const [schedule, setSchedule] = useState<LiteSchedule | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ readonly text: string; readonly seq: number } | null>(null)
  /** 편성안 식별자. 명단을 새로 올릴 때마다 새로 발급한다. */
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  /** 편성표 수기 편집분. 편집기가 바꿀 때마다 받아서 저장한다. */
  const [edit, setEdit] = useState<EditState | null>(null)
  /** 팀이 보낸 수정 제안 큐 */
  const [proposals, setProposals] = useState<readonly Proposal[]>([])
  /** 일자별 확정·해제 기록 — 통보가 나간 사실이라 편집 이력과 따로 둔다 */
  const [confirms, setConfirms] = useState<readonly ConfirmEvent[]>([])
  /* 전형 설정. 편성 전에는 화면에서 고치고, 편성이 끝나면 그 편성이 쓴 설정을 그대로 보여 준다 —
     화면 값과 편성 결과가 어긋나면 담당자가 무엇으로 돌린 결과인지 알 수 없다. */
  const [setup, setSetup] = useState<Setup>(() => lastSetup() ?? DEFAULT_SETUP)
  /** 알림에서 「받은 요청」을 열라는 신호 */
  const [inboxSignal, setInboxSignal] = useState(0)
  /** 다시 올리려는 팀 회신 — 조정한 것이 있으면 확인을 받고 진행한다 */
  const [pendingUpload, setPendingUpload] = useState<readonly File[] | null>(null)

  // 지난번에 고른 사이드바 색을 되살린다
  useEffect(() => { applySide(storedSide()) }, [])

  // 지난번에 올린 명단과 편성표를 되살린다 — 새로고침해도 처음부터 다시 올리지 않게
  useEffect(() => {
    const saved = loadSession()
    if (!saved) return
    setSessionId(saved.id)
    setRoster(saved.roster)
    setSchedule(saved.schedule)
    setEdit(saved.edit)
    setProposals(saved.proposals)
    setConfirms(saved.confirms)
    if (saved.schedule?.setup) setSetup(saved.schedule.setup)
    setRestored(true)
  }, [])

  // 같은 문구를 다시 띄워도 표시 시간이 처음부터 다시 흐르도록 순번을 함께 센다
  const notify = (text: string) => setToast(current => ({ text, seq: (current?.seq ?? 0) + 1 }))
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const uploadRoster = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const next = await readRoster(file)
      const id = ulid()
      setRoster(next)
      setSchedule(null)
      setSessionId(id)
      setRestored(false)
      setEdit(null)
      setProposals([])
      setConfirms([])
      const saved = saveSession(next, null, id)
      if (!saved.ok) notify(saved.reason)
    } catch (reason) {
      if (reason instanceof Error) setError(reason.message)
      else throw reason
    } finally {
      setBusy(false)
    }
  }

  /** 회신을 다시 올리면 1차 편성이 새로 만들어지므로 그 위에 쌓은 조정이 사라진다.
      미팅 47:21 「본인이 원하는 대로 수정하고 추가하고 변경해서」 — 재업로드는 일상이다.
      말없이 날리지 않고 무엇이 사라지는지 세어 보여 준 뒤 진행한다. */
  const runUploadTeams = async (files: readonly File[]) => {
    if (!roster || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const next = await buildSchedule(roster, [...files], setup)
      rememberSetup(setup)
      setSchedule(next)
      setRestored(false)
      setEdit(null)
      setProposals([])
      setConfirms([])
      const saved = saveSession(roster, next, sessionId ?? undefined)
      if (!saved.ok) notify(saved.reason)
    } catch (reason) {
      if (reason instanceof Error) setError(reason.message)
      else throw reason
    } finally {
      setBusy(false)
    }
  }

  /** 지금 사라질 것들 — 확인 창이 세어 보여 준다 */
  const atRisk = {
    edits: edit?.events.length ?? 0,
    decided: proposals.filter(p => p.status !== 'pending').length,
    waiting: proposals.filter(p => p.status === 'pending').length,
    confirmed: confirmedDays(confirms).size,
  }
  const hasWork = atRisk.edits > 0 || proposals.length > 0 || atRisk.confirmed > 0

  const uploadTeams = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : []
    event.target.value = ''            // 그만두더라도 같은 파일을 다시 고를 수 있게
    if (!roster || files.length === 0) return
    if (hasWork) { setPendingUpload(files); return }
    await runUploadTeams(files)
  }

  /** 확인 창의 「내보내고 계속」 — 사라지기 전에 종이 사본을 남긴다 */
  const exportThenUpload = async () => {
    const files = pendingUpload
    setPendingUpload(null)
    if (!files) return
    try {
      if (schedule && edit) {
        await exportSchedule(schedule.result, edit, judge(schedule.result, edit.placed, edit.acks), schedule.setup)
        notify('현재 편성표를 내려받았습니다.')
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '내보내기에 실패했습니다.')
    }
    await runUploadTeams(files)
  }

  /** 되살린 편성안을 버리고 처음부터 — 저장분까지 지운다 */
  const resetSession = () => {
    clearSession()
    setRoster(null)
    setSchedule(null)
    setEdit(null)
    setProposals([])
    setConfirms([])
    setSessionId(null)
    setRestored(false)
    setError(null)
    setPage('roster')
    notify('저장된 편성안을 지웠습니다.')
  }

  /** 편집기가 상태를 바꿀 때마다 저장한다. 용량이 넘치면 알리고 편집은 계속하게 둔다. */
  const saveEdit = useCallback((next: EditState) => {
    setEdit(next)
    if (!roster || !schedule) return
    const out = saveSession(roster, schedule, sessionId ?? undefined, next, proposals, confirms)
    if (!out.ok) notify(out.reason)
  }, [roster, schedule, sessionId, proposals, confirms])

  const saveProposals = useCallback((next: readonly Proposal[], nextEdit?: EditState) => {
    setProposals(next)
    if (nextEdit) setEdit(nextEdit)
    if (!roster || !schedule) return
    const out = saveSession(roster, schedule, sessionId ?? undefined, nextEdit ?? edit, next, confirms)
    if (!out.ok) notify(out.reason)
  }, [roster, schedule, sessionId, edit, confirms])

  /* 확정분을 고정한 채 나머지를 다시 편성한다.

     편성표와 편집 상태를 **함께** 갈아 끼우고 한 번에 저장한다. 나눠서 넣으면 새 편성표에
     옛 편집분이 잠깐 얹히면서, 그 사이에 저장이 돌면 어긋난 한 쌍이 남는다. */
  const reschedule = useCallback(() => {
    if (!roster || !schedule) return
    // 고친 것이 없으면 저장분이 비어 있다(빈 편집은 저장하지 않는다). 기준선에서 시작하면 된다 —
    // 여기서 그냥 돌아서면 버튼이 아무 일도 안 하고 아무 말도 안 하는 상태가 된다.
    const from = edit ?? initEdit(schedule.result)
    try {
      const report = rescheduleWith(schedule, from, confirms)
      const nextEdit = editReducer(from, {
        type: 'reschedule', base: report.schedule.result,
        pinnedCount: report.pinned, movedCount: report.replaced,
        actor: { id: 'local', name: USERS.hr.name },
      })
      setSchedule(report.schedule)
      setEdit(nextEdit)
      const out = saveSession(roster, report.schedule, sessionId ?? undefined, nextEdit, proposals, confirms)
      if (!out.ok) notify(out.reason)
      else notify(`${report.pinned}명을 고정하고 ${report.replaced}명을 다시 편성했습니다.`)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '다시 편성에 실패했습니다.')
    }
  }, [roster, schedule, edit, confirms, proposals, sessionId])

  /** 일자 확정·해제. 통보가 걸린 일이라 Ctrl+Z 로는 풀리지 않는다. */
  const saveConfirms = useCallback((next: readonly ConfirmEvent[]) => {
    setConfirms(next)
    if (!roster || !schedule) return
    const out = saveSession(roster, schedule, sessionId ?? undefined, edit, proposals, next)
    if (!out.ok) notify(out.reason)
  }, [roster, schedule, sessionId, edit, proposals])

  /** 팀이 요청을 보낸다 */
  const sendProposal = useCallback((p: Proposal) => {
    saveProposals([...proposals, p])
    notify('간사에게 요청을 보냈습니다.')
  }, [proposals, saveProposals])

  /** 간사가 승인 — 편집분은 이미 반영된 상태로 넘어온다 */
  const approveProposal = useCallback((p: Proposal, note: string, next: EditState) => {
    saveProposals(proposals.map(x => x.id === p.id ? decide(x, 'approved', USERS.hr.name, note) : x), next)
  }, [proposals, saveProposals])

  /** 승인으로 생긴 편집을 되돌렸다 — 요청도 대기 중으로 되돌린다 */
  const withdrawProposal = useCallback((proposalId: string) => {
    const target = proposals.find(x => x.id === proposalId)
    if (!target || target.status !== 'approved') return
    saveProposals(proposals.map(x => x.id === proposalId ? withdraw(x) : x))
  }, [proposals, saveProposals])

  const rejectProposal = useCallback((p: Proposal, note: string) => {
    saveProposals(proposals.map(x => x.id === p.id ? decide(x, 'rejected', USERS.hr.name, note) : x))
  }, [proposals, saveProposals])

  /* 종 알림 — 역할마다 뜻이 다르다.
     간사에게는 「내가 처리할 요청」이라 승인·거절하면 사라지고,
     팀에게는 「도착한 회신」이라 우리 팀 화면을 열어보면 사라진다. */
  const notices: readonly Notice[] = (() => {
    if (role === 'hr') {
      const waiting = inboxOf(proposals)
      if (!waiting.length) return STATIC_NOTICES
      return waiting.slice().reverse().map(p => ({
        key: p.id,
        title: `${p.fromTeam}이 ${KIND_LABEL[p.kind]}을 요청했습니다`,
        meta: `${p.appName} · “${p.reason}” · ${ago(p.createdAt)}`,
        page: 'schedule', tag: '요청', hot: true, inbox: true,
      }))
    }
    if (role === 'lead') {
      const unread = unreadRepliesOf(proposals, TEAM_OF_LEAD)
      if (!unread.length) return STATIC_NOTICES
      return unread.slice().reverse().map(p => ({
        key: p.id,
        title: `${KIND_LABEL[p.kind]} 요청에 회신이 왔습니다`,
        meta: `${p.appName} · ${replyText(p)}`,
        page: 't-sched',
        tag: p.status === 'rejected' ? '거절' : '승인',
        hot: p.status === 'rejected',
      }))
    }
    return STATIC_NOTICES
  })()

  /** 팀이 우리 팀 화면을 열면 도착한 회신을 본 것으로 적는다 */
  const markSeen = useCallback(() => {
    if (!unreadRepliesOf(proposals, TEAM_OF_LEAD).length) return
    saveProposals(markRepliesSeen(proposals, TEAM_OF_LEAD))
  }, [proposals, saveProposals])

  const switchRole = (next: LiteRole) => {
    setRole(next)
    setPage(HOME[next])
  }

  const goto = (target: string) => setPage(GOTO_ALIAS[target] ?? target)

  /** 알림 한 줄을 연다. 요청 알림이면 편성 화면으로 가서 받은 요청 서랍까지 펼친다. */
  const openNotification = (n: Notice) => {
    setBellOpen(false)
    if (!n.page) {
      notify(`「${n.title}」 상세를 여는 동작입니다.`)
      return
    }
    setPage(n.page)
    if (n.inbox) setInboxSignal(v => v + 1)
  }

  const badgeOf = (item: Extract<NavEntry, { kind: 'item' }>) => {
    if (item.page === 'roster') return roster ? `${roster.candidates.length}명` : undefined
    if (item.page === 'schedule') {
      const n = inboxOf(proposals).length
      return n ? `요청 ${n}건` : (schedule ? '완료' : undefined)
    }
    if (item.page === 't-sched') {
      const unread = unreadRepliesOf(proposals, TEAM_OF_LEAD).length
      if (unread) return `회신 ${unread}건`
      const mine = proposals.filter(p => p.fromTeam === TEAM_OF_LEAD).length
      return mine ? `요청 ${mine}건` : item.badge
    }
    return item.badge
  }

  const items = [...NAV[role].filter(entry => entry.kind === 'item'), SETTINGS]
  const user = USERS[role]

  const navButton = (item: Extract<NavEntry, { kind: 'item' }>, className?: string) => {
    const badge = badgeOf(item)
    return (
      <button
        className={className}
        key={item.page}
        type="button"
        aria-current={item.page === page ? 'page' : undefined}
        onClick={() => setPage(item.page)}
      >
        <span>{item.label}</span>
        {badge && <span className={item.hot || /^요청 |^회신 /.test(badge) ? 'nav-badge hot' : 'nav-badge'}>{badge}</span>}
      </button>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">면접 AX</div>
        <div className="round"><b>2026 하반기 신입 2차 직무면접</b><span>라이트</span></div>
        <nav className="nav-group" aria-label="주 메뉴">
          {NAV[role].map(entry => (
            entry.kind === 'label'
              ? <div className="nav-label" key={`label-${entry.text}`}>{entry.text}</div>
              : navButton(entry, 'nav-item')
          ))}
        </nav>
        <div className="sidebar-foot">
          <nav className="nav-group foot-nav" aria-label="설정">
            {navButton(SETTINGS, 'nav-item')}
          </nav>
          <div className="foot-user"><b>{user.name}</b><span>{user.sub}</span></div>
          <p>백업 시연용 라이트 데모입니다. 데이터는 이 브라우저에만 저장되며, 도움말 챗봇은 로컬 LLM(Ollama)을 사용합니다. 외부 전송이 없습니다.</p>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <span className="lite-label">L1 · 라이트 데모</span>
          <div className="topbar-tools">
            <div className="role-pill" aria-label="역할">
              {ROLES.map(entry => (
                <button
                  key={entry.role}
                  type="button"
                  aria-pressed={entry.role === role}
                  onClick={() => switchRole(entry.role)}
                >{entry.label}</button>
              ))}
            </div>
            <div className="bell-wrap">
              <button className="bell" type="button" aria-label="알림" aria-expanded={bellOpen} onClick={() => setBellOpen(open => !open)}>
                <Bell size={16} />
                {notices.length > 0 && <span className="bell-count">{notices.length}</span>}
              </button>
              {bellOpen && (
                <div className="notif-panel">
                  <div className="notif-head">알림</div>
                  {notices.length === 0 && <p className="notif-empty">새 알림이 없습니다.</p>}
                  {notices.map(item => (
                    <button className="notif-row" type="button" key={item.key} onClick={() => openNotification(item)}>
                      <b>{item.tag && <span className={`notif-tag${item.hot ? ' hot' : ''}`}>{item.tag}</span>}{item.title}</b>
                      <span>{item.meta}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="라이트 데모 메뉴">
          {items.map(item => navButton(item))}
        </nav>
        <main>
          {error && <div className="error" role="alert">{error}</div>}
          {restored && (
            <div className="restored" role="status">
              <span>이전에 올린 명단{schedule ? '과 편성표를' : '을'} 되살렸습니다.</span>
              <button className="switch" type="button" onClick={resetSession}>새로 시작</button>
            </div>
          )}
          {page === 'roster' && <RosterPage roster={roster} busy={busy} onUpload={uploadRoster} onNext={() => setPage('schedule')} />}
          {page === 'schedule' && <SchedulePage roster={roster} schedule={schedule} busy={busy} onUpload={uploadTeams} onBack={() => setPage('roster')} onEdit={saveEdit} saved={edit} onNotify={notify} proposals={proposals} onApproveProposal={approveProposal} onRejectProposal={rejectProposal} openInbox={inboxSignal} onGoTeam={() => { setRole('lead'); setPage('t-sched') }} onWithdrawProposal={withdrawProposal}
            confirms={confirms}
            onConfirmDay={(day, placed) => {
              saveConfirms(confirmDay(confirms, day, placed, { id: 'local', name: USERS.hr.name }))
              notify(`${day + 1}일차를 확정했습니다. 이 날짜를 고치면 재통보 대상으로 잡힙니다.`)
            }}
            onReleaseDay={day => {
              saveConfirms(releaseDay(confirms, day, { id: 'local', name: USERS.hr.name }))
              notify(`${day + 1}일차 확정을 풀었습니다.`)
            }}
            onReschedule={reschedule} />}
          {page === 'i-work' && <WorkspacePage onNotify={notify} />}
          {page === 't-sched' && (
            <TeamSchedulePage
              team={TEAM_OF_LEAD} who={USERS.lead.name}
              base={schedule?.result ?? null} state={edit ?? (schedule ? initEdit(schedule.result) : null)}
              proposals={proposals} onSend={sendProposal} onGoSchedule={() => { setRole('hr'); setPage('schedule') }}
              onSeen={markSeen}
            />
          )}
          {page === 'setup' && (
            <SetupPage
              setup={setup}
              onChange={next => { setSetup(next); rememberSetup(next) }}
              apps={schedule?.payload.apps ?? []}
              confirmedDays={confirmedDays(confirms).size}
              hasSchedule={!!schedule}
              onNotify={notify}
              onNext={() => setPage(schedule ? 'schedule' : 'roster')}
            />
          )}
          {page !== 'roster' && page !== 'schedule' && page !== 'i-work' && page !== 't-sched' && page !== 'setup'
            && <DemoPage html={DEMO_PAGES[page] ?? ''} onGoto={goto} onNotify={notify} />}
        </main>
      </div>
      <ChatBot role={role} page={page} roster={roster} schedule={schedule} />
      {pendingUpload && (
        <ConfirmReupload
          files={pendingUpload.length}
          atRisk={atRisk}
          canExport={!!(schedule && edit)}
          onExport={exportThenUpload}
          onProceed={() => { const f = pendingUpload; setPendingUpload(null); void runUploadTeams(f) }}
          onCancel={() => setPendingUpload(null)}
        />
      )}
      {toast && <div className="toast" role="status" aria-live="polite" key={toast.seq}>{toast.text}</div>}
    </div>
  )
}
