import { useEffect, useState, type ChangeEvent } from 'react'
import { Bell } from 'lucide-react'
import { ChatBot } from './ChatBot'
import { RosterPage } from './RosterPage'
import { SchedulePage } from './SchedulePage'
import { WorkspacePage } from './WorkspacePage'
import { DemoPage, applySide, storedSide } from './DemoPage'
import { DEMO_PAGES } from './demoPages'
import { buildSchedule, readRoster, type LiteRoster, type LiteSchedule } from './data'

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

const SETTINGS: Extract<NavEntry, { kind: 'item' }> = { kind: 'item', page: 'settings', label: '설정' }

/** 화면을 가리키는 알림은 그 화면으로 데려가고, 나머지는 알림 문구로 답한다. */
const NOTIFICATIONS: readonly { readonly title: string; readonly meta: string; readonly page?: string }[] = [
  { title: '전극기술팀이 아직 선택 중입니다', meta: '회신 마감이 이틀 남았습니다. 10분 전', page: 'req' },
  { title: '지원자 190 취소 요청이 접수되었습니다', meta: '변경 대응과 재통보에서 처리합니다. 1시간 전', page: 'change' },
  { title: '새 기능 안내', meta: '편성 격자에서 면접위원별 강조를 지원합니다. 어제' },
]

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

  // 지난번에 고른 사이드바 색을 되살린다
  useEffect(() => { applySide(storedSide()) }, [])

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
      setRoster(next)
      setSchedule(null)
    } catch (reason) {
      if (reason instanceof Error) setError(reason.message)
      else throw reason
    } finally {
      setBusy(false)
    }
  }

  const uploadTeams = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : []
    if (!roster || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      setSchedule(await buildSchedule(roster, files))
    } catch (reason) {
      if (reason instanceof Error) setError(reason.message)
      else throw reason
    } finally {
      setBusy(false)
    }
  }

  const switchRole = (next: LiteRole) => {
    setRole(next)
    setPage(HOME[next])
  }

  const goto = (target: string) => setPage(GOTO_ALIAS[target] ?? target)

  /** 알림 목록의 한 줄. 화면을 가리키면 HR 화면으로 데려가고, 아니면 문구로 답한다. */
  const openNotification = (target: string | undefined, title: string) => {
    setBellOpen(false)
    if (!target) {
      notify(`「${title}」 상세를 여는 동작입니다.`)
      return
    }
    setRole('hr')
    setPage(target)
  }

  const badgeOf = (item: Extract<NavEntry, { kind: 'item' }>) => {
    if (item.page === 'roster') return roster ? `${roster.candidates.length}명` : undefined
    if (item.page === 'schedule') return schedule ? '완료' : undefined
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
        {badge && <span className={item.hot ? 'nav-badge hot' : 'nav-badge'}>{badge}</span>}
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
                <span className="bell-count">3</span>
              </button>
              {bellOpen && (
                <div className="notif-panel">
                  <div className="notif-head">알림</div>
                  {NOTIFICATIONS.map(item => (
                    <button className="notif-row" type="button" key={item.title} onClick={() => openNotification(item.page, item.title)}>
                      <b>{item.title}</b><span>{item.meta}</span>
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
          {page === 'roster' && <RosterPage roster={roster} busy={busy} onUpload={uploadRoster} onNext={() => setPage('schedule')} />}
          {page === 'schedule' && <SchedulePage roster={roster} schedule={schedule} busy={busy} onUpload={uploadTeams} onBack={() => setPage('roster')} />}
          {page === 'i-work' && <WorkspacePage onNotify={notify} />}
          {page !== 'roster' && page !== 'schedule' && page !== 'i-work' && <DemoPage html={DEMO_PAGES[page] ?? ''} onGoto={goto} onNotify={notify} />}
        </main>
      </div>
      <ChatBot role={role} page={page} roster={roster} schedule={schedule} />
      {toast && <div className="toast" role="status" aria-live="polite" key={toast.seq}>{toast.text}</div>}
    </div>
  )
}
