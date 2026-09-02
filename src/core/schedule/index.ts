/* 검증된 편성 엔진(sched.js)을 타입과 함께 노출한다.
   sched.js 는 확장자와 내용을 그대로 둔다 — 타입 주석을 다는 순간 그 파일을 고치는 것이 되고,
   검토서의 실측치(위반 건수·소요일·결정성)를 다시 받아야 한다. */
import './sched.js'

export type Edu = '학사' | '석사' | '박사'

export interface Applicant {
  id: number
  name: string
  edu: Edu
  teams: string[]
  interviewers: string[]
  /** 면접관 + 소속 짝. interviewers 는 이름만이라 소속 칩을 못 만든다 */
  iv?: { t: string; n: string }[]
  attrs?: Record<string, string | number | null>
  dropped_teams?: string[]
}

export interface Excluded {
  id: number
  name: string | null
  reason: string
  teams: string[]
}

export interface Payload {
  meta: {
    parsed_at: string
    files: number
    requests_total: number
    requests_matched: number
    applicants_total: number
    warnings: string[]
    failed_files: { file: string; error: string }[]
  }
  apps: Applicant[]
  excluded: Excluded[]
}

export interface Cfg {
  startDate: string
  days: number
  sessions: number
  rooms: number | Record<string, number> | 'auto'
  startTime: string
  sessionMin: number
  breakMin: number
  lunchStart: string
  lunchMin: number
  amSessions: number
  separateEdu: boolean
  eduBoundary: 'session' | 'day'
  checkInterviewer: boolean
  avoidFirstSlot: 'off' | 'soft' | 'hard'
  rotateEvery: number
  skipWeekend: boolean
  /** 주말 말고도 건너뛸 날 — ISO 'YYYY-MM-DD' (FR-0.6).
      엔진은 이 값을 모른다(dateOf 는 주말만 건너뛴다) — 화면이 결과의 `dates` 를 다시 매긴다
      (lib/slotLabel.ts withExcludedDates). */
  excludedDates?: string[]
  /** 일별 최적화 — 엔진은 모른다. 화면(useSolve)이 읽는다.
      엔진이 정한 날짜는 그대로 두고 하루 안의 자리만 HiGHS 로 다시 고른다 (core/solve). */
  solver?: 'off' | 'highs'
  /** 하루 한 판의 제한 시간(초) — 넘기면 그때까지의 최선해를 쓴다 */
  solverTimeLimit?: number
  pinned: { id: number; day: number; slot: number; room: number }[] | null
}

export interface Placed {
  app: Applicant
  day: number
  room: number
  slot: number
  team: string
  teams: string[]
  interviewers: string[]
  edu: Edu
  pinned?: boolean
}

export interface TimeSlot { i: number; start: number; end: number; label: string; pm: boolean }
export interface DateInfo { iso: string; wd: string; label: string }

export interface RoomsPlan {
  map: Record<string, number> | null
  peak: number
  seats: number
  label?: string
  dMin?: number | null
}

export interface Result {
  cfg: Cfg & { rooms: number }
  roomsPlan: RoomsPlan | null
  times: TimeSlot[]
  FS: { am: number; pm: number }
  grid: Record<string, Placed>
  placed: Placed[]
  unplaced: Applicant[]
  demand: Record<string, number>
  teamsAsc: string[]
  minDemand: number
  totalDays: number
  groupDays: number[][]
  groups: string[]
  dates: DateInfo[]
}

export interface Violation {
  day?: number
  slot?: number
  team?: string
  edu?: string
  room?: number
  kind?: string
  detail: string
}

export interface Validation { r1: Violation[]; r2: Violation[]; r3: Violation[]; r4: Violation[] }

export interface Block {
  day: number
  room: number
  team: string
  slotFrom: number
  slotTo: number
  apps: Placed[]
}

export type MinDays = { days: number; team: string; requests: number; sessions: number } | 0

interface SchedApi {
  DEFAULT_CFG: Cfg
  EDU_ORDER: Edu[]
  schedule(apps: Applicant[], cfg?: Partial<Cfg>): Result
  scheduleAuto(apps: Applicant[], cfg?: Partial<Cfg>): Result
  validate(res: Result): Validation
  buildTimes(cfg: Cfg): TimeSlot[]
  toHM(v: number): string
  dateOf(startDate: string, offset: number, skipWeekend?: boolean): DateInfo
  autoRooms(apps: Applicant[], cfg: Cfg): RoomsPlan | null
  minDays(apps: Applicant[], cfg?: Partial<Cfg>): MinDays
  blocksOf(placed: Placed[]): Block[]
}

/* sched.js 는 UMD 꼴이다 — 브라우저에서는 module 이 없으므로 globalThis.Sched 로 붙는다. */
export const Sched = (globalThis as unknown as { Sched: SchedApi }).Sched
export const EDU_ORDER = Sched.EDU_ORDER
