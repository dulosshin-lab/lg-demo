/* 전형 설정 — 지금까지 코드 상수였던 편성 조건을 담당자가 정한다.

   미팅 30:37 담당자 직접 요구: 면접 시간·휴식 시간·시작 시각. 그리고
   "HR 은 최대한 많이 범위를 열어줘야 튜닝도 할 수 있고 … 면접관은 최소화하는 게 좋아요."
   우리가 「허들이라서 뺐다」고 한 것은 판단 미스였다는 지적이 있어, 기본값을 보여 주고
   상세는 접어 두는 형태로 되살린다.

   엔진(`sched.js`)은 이미 17가지 설정을 받는다. 여기서 하는 일은 **화면에서 받은 값을 그
   모양으로 옮기는 것**이고, 시간표 계산은 엔진에게 그대로 시킨다(`previewOf`) — 같은 규칙을
   두 벌로 두면 화면이 보여 준 시각과 실제 편성이 조용히 갈라진다.

   딱 하나 엔진에 없는 것이 **공휴일**이다. `dateOf()` 는 토·일만 건너뛴다("공휴일은 데이터가
   없어 처리하지 않는다"). 그런데 편성 로직은 날짜 인덱스(0·1·2)만 쓰고 실제 날짜는 표시용이라,
   **화면 계층에서 dates 만 다시 만들면** 편성표·엑셀·PNG·통보에 전부 전파된다. 엔진은 그대로 둔다. */
import { Sched, type Applicant, type Result } from '@/core/schedule'

export type EduBoundary = 'session' | 'day'
export type FirstSlotMode = 'off' | 'soft' | 'hard'

export type Setup = {
  /** 전형 이름 — 파일명·편성표 머리글에 실린다 */
  readonly name: string

  /* A. 면접 기간 */
  readonly startDate: string
  readonly skipWeekend: boolean
  /** 쉬는 날 (ISO). 엔진이 모르는 유일한 항목이라 화면 계층에서 날짜를 다시 센다 */
  readonly holidays: readonly string[]
  /** 0 = 필요한 만큼 자동 */
  readonly days: number

  /* B. 일일 슬롯 */
  readonly sessions: number
  readonly rooms: number
  readonly sessionMin: number
  readonly breakMin: number
  readonly startTime: string
  readonly lunchStart: string
  readonly lunchMin: number
  readonly amSessions: number

  /* C. 팀 회신 마감일 — 편성에는 안 쓰고 취합 진행을 재는 데 쓴다 */
  readonly replyDue: string

  /* D. 편성 규칙 */
  readonly separateEdu: boolean
  readonly eduBoundary: EduBoundary
  readonly checkInterviewer: boolean
  readonly avoidFirstSlot: FirstSlotMode
  /** 편성 뒤 팀 연속 배치 정리 (arrange) */
  readonly contiguous: boolean

  /** 조별 상설 화상 링크 — 조 = 물리적 면접방이라 링크도 조에 붙는다(D6) */
  readonly links: readonly string[]
}

/** 지금까지 코드에 박혀 있던 값 그대로. 설정을 안 건드리면 편성 결과가 달라지지 않는다. */
export const DEFAULT_SETUP: Setup = {
  name: '2026 하반기 신입 2차 직무면접',
  startDate: '2026-08-17',
  skipWeekend: true,
  holidays: [],
  days: 0,
  sessions: 8,
  rooms: 4,
  sessionMin: 30,
  breakMin: 5,
  startTime: '08:00',
  lunchStart: '12:00',
  lunchMin: 60,
  amSessions: 4,
  replyDue: '',
  separateEdu: true,
  eduBoundary: 'session',
  checkInterviewer: true,
  avoidFirstSlot: 'soft',
  contiguous: true,
  links: [],
}

/** 화면 값 → 엔진 cfg. 엔진이 모르는 항목(공휴일·이름·링크·마감일·정리 옵션)은 넘기지 않는다. */
export function toCfg(s: Setup) {
  return {
    ...Sched.DEFAULT_CFG,
    startDate: s.startDate,
    days: s.days,
    sessions: s.sessions,
    rooms: s.rooms,
    startTime: s.startTime,
    sessionMin: s.sessionMin,
    breakMin: s.breakMin,
    lunchStart: s.lunchStart,
    lunchMin: s.lunchMin,
    amSessions: s.amSessions,
    separateEdu: s.separateEdu,
    eduBoundary: s.eduBoundary,
    checkInterviewer: s.checkInterviewer,
    avoidFirstSlot: s.avoidFirstSlot,
    skipWeekend: s.skipWeekend,
  }
}

const WD = ['일', '월', '화', '수', '목', '금', '토']
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 쉬는 날인가 — 주말(설정에 따라)이거나 공휴일 */
const isOff = (d: Date, s: Setup, holidays: ReadonlySet<string>) =>
  (s.skipWeekend && (d.getDay() === 0 || d.getDay() === 6)) || holidays.has(iso(d))

/** 면접일 목록. 엔진의 dateOf 와 같은 규칙에 **공휴일 건너뛰기**를 더한 것이다. */
export function datesOf(s: Setup, totalDays: number) {
  const holidays = new Set(s.holidays)
  const d = new Date(`${s.startDate}T00:00:00`)
  const out: { iso: string; wd: string; label: string }[] = []
  let guard = 0
  while (isOff(d, s, holidays) && guard++ < 400) d.setDate(d.getDate() + 1)
  for (let i = 0; i < totalDays; i++) {
    if (i > 0) {
      guard = 0
      do { d.setDate(d.getDate() + 1) } while (isOff(d, s, holidays) && guard++ < 400)
    }
    const wd = WD[d.getDay()]
    out.push({ iso: iso(d), wd, label: `${d.getMonth() + 1}/${d.getDate()}(${wd})` })
  }
  return out
}

/** 편성 결과의 날짜를 설정 기준으로 다시 붙인다 — 공휴일을 반영하는 유일한 지점 */
export function withDates(result: Result, s: Setup): Result {
  return { ...result, dates: datesOf(s, result.totalDays) }
}

export type Preview = {
  readonly times: Result['times']
  /** 마지막 면접이 끝나는 시각 — 담당자는 이 값으로 판단한다 */
  readonly endTime: string
  readonly seatsPerDay: number
  /** 시간 설정이 점심을 침범해 오후로 밀린 세션 수 */
  readonly pushed: number
}

/** 시간표 미리보기. 계산은 엔진에게 시킨다 — 같은 규칙을 두 벌로 두지 않으려는 것이다. */
export function previewOf(s: Setup): Preview {
  const r = Sched.schedule([], toCfg(s) as never)
  const times = r.times
  const last = times[times.length - 1]
  const am = Math.max(0, Math.min(s.sessions, s.amSessions))
  const pushed = times.slice(0, am).filter(t => t.pm).length
  return {
    times,
    endTime: last ? last.label.split('–')[1] : '—',
    seatsPerDay: s.sessions * s.rooms,
    pushed,
  }
}

/** 「왜 N일인가」 — minDays 가 이미 계산하고 있는 값을 문장으로 */
export function daysNote(apps: readonly Applicant[], s: Setup): string {
  if (!apps.length) return ''
  const md = Sched.minDays(apps as Applicant[], toCfg(s) as never)
  if (!md || typeof md === 'number') return ''
  return `${md.team} ${md.requests}건 ÷ 하루 ${md.sessions}세션 = 최소 ${md.days}일`
}

/** 설정이 말이 되나 — 막지는 않고 알린다 */
export function warningsOf(s: Setup, appCount = 0): string[] {
  const out: string[] = []
  if (s.sessions < 1) out.push('하루 세션 수는 1 이상이어야 합니다.')
  if (s.rooms < 1) out.push('조 수는 1 이상이어야 합니다.')
  if (s.amSessions > s.sessions) out.push('오전 세션 수가 하루 세션 수보다 많습니다.')
  if (s.sessionMin < 5) out.push('면접 시간이 5분 미만입니다.')
  const p = previewOf(s)
  if (p.pushed > 0) out.push(`오전 ${p.pushed}세션이 점심에 걸려 오후로 밀립니다.`)
  const endHour = Number(p.endTime.split(':')[0])
  if (endHour >= 19) out.push(`마지막 면접이 ${p.endTime}에 끝납니다 — 하루가 너무 깁니다.`)
  if (appCount > 0 && s.days > 0) {
    const need = Math.ceil(appCount / (s.sessions * s.rooms))
    if (s.days < need) out.push(`${appCount}명을 ${s.days}일에 넣으려면 자리가 모자랍니다(하루 ${s.sessions * s.rooms}자리).`)
  }
  if (s.links.length && s.links.filter(Boolean).length < s.rooms) {
    out.push(`조별 화상 링크가 ${s.links.filter(Boolean).length}/${s.rooms}조만 입력됐습니다.`)
  }
  return out
}

/** 시간표를 건드리는 항목 — 확정된 날짜가 있으면 잠근다.

    확정은 {날짜·세션·조} 좌표로 굳는다. 그런데 세션 길이나 시작 시각이 바뀌면 **좌표는 그대로인데
    가리키는 시각이 달라진다** — 8세션 25분에서 3번 슬롯은 09:10 이지만 10세션 20분이면 09:00 이다.
    통보한 시각과 화면이 조용히 어긋나므로, 확정이 하나라도 있으면 이 항목들은 못 바꾸게 한다. */
export const TIME_KEYS = [
  'startTime', 'sessionMin', 'breakMin', 'sessions', 'amSessions', 'lunchStart', 'lunchMin',
] as const

export type TimeKey = (typeof TIME_KEYS)[number]

export const isTimeKey = (k: keyof Setup): k is TimeKey =>
  (TIME_KEYS as readonly string[]).includes(k)

/* ---------- 프리셋 ---------- */

export type Preset = { readonly label: string; readonly sessions: number; readonly rooms: number }

export const PRESETS: readonly Preset[] = [
  { label: '8×4', sessions: 8, rooms: 4 },
  { label: '10×6', sessions: 10, rooms: 6 },
  { label: '14×6', sessions: 14, rooms: 6 },
]

/* ---------- 마지막 설정 기억 ---------- */

const LAST_KEY = 'ax.v1.setup'

/** 다음 전형에서 불러쓰라고 마지막 설정을 남긴다 — 미팅의 「템플릿」 장기 과제의 첫 걸음 */
export function rememberSetup(s: Setup): void {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(s)) } catch { /* 저장 못 해도 계속한다 */ }
}

export function lastSetup(): Setup | null {
  try {
    const raw = localStorage.getItem(LAST_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Setup>
    /* 기본값 위에 **아는 열쇠만** 덮어 쓴다. 옛 저장분이 앱을 못 열게 하지도 않고,
       지워진 설정(빈 슬롯 최소화 등)이 새 저장으로 흘러들지도 않는다. */
    const out = { ...DEFAULT_SETUP }
    for (const k of Object.keys(DEFAULT_SETUP) as (keyof Setup)[])
      if (v[k] !== undefined) (out as Record<string, unknown>)[k] = v[k]
    return { ...out, links: [...(v.links ?? [])], holidays: [...(v.holidays ?? [])] }
  } catch {
    return null
  }
}
