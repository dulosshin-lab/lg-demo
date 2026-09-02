/* 챗봇에 넣을 화면 맥락을 만든다.
   DOM API 를 쓰지 않는 순수 함수만 둔다 — vitest 의 node 환경과 SSR 에서도 그대로 돈다. */
import { DEMO_PAGES } from './demoPages'
import type { LiteRoster, LiteSchedule } from './data'

/** 맥락 전체 상한. 너무 길면 num_ctx 를 넘겨 앞부분(지시문)이 잘린다. */
const MAX_CONTEXT = 6000
const CUT = '…(이하 생략)'

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** 목업 마크업을 사람이 읽는 줄글로 바꾼다. 표는 셀을 ' | ' 로 잇는다. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(tr|table|thead|tbody|div|p|h[1-6]|li|ul|ol|section|span|small|b|button)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;|&#\d+;/gi, match => ENTITIES[match.toLowerCase()] ?? ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').replace(/\s*\|\s*$/, '').trim())
    .filter(line => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 화면 키 → 메뉴 라벨. LiteApp 의 NAV 와 같은 값을 두되, 반대 방향 import 를 만들지 않는다. */
export const PAGE_LABELS: Record<string, string> = {
  dash: '운영 대시보드',
  setup: '전형 설정',
  roster: '지원자 명단 등록',
  req: '조직 희망자 취합',
  verify: '취합 데이터 검증',
  schedule: '면접 일정 편성',
  change: '변경 대응과 재통보',
  close: '전형 종료와 산출물',
  't-pick': '면접 희망자 선택',
  't-avail': '면접위원 불가 시간',
  't-avoid': '회피 관계 신고',
  't-sched': '우리 팀 면접 일정',
  'i-sched': '나의 면접 일정',
  'i-work': '면접 진행 워크스페이스',
  'i-evals': '평가 제출 현황',
  'a-guide': '나의 면접 안내',
  settings: '설정',
}

const ROLE_LABELS: Record<string, string> = {
  hr: 'HR 간사',
  lead: '팀 담당자',
  iv: '면접위원',
  app: '지원자',
}

const OVERVIEW = [
  '이 앱은 채용 면접 일정을 짜는 "면접 AX" 데모다.',
  'HR 간사가 전형를 열고, 각 팀이 면접할 지원자와 면접위원 사정을 회신하면, 그 회신으로 면접 일정을 자동 편성한다.',
  '전체 흐름은 다음 순서다: 지원자 명단 등록 → 조직 희망자 취합 → 취합 데이터 검증 → 면접 일정 편성 → 변경 대응 → 전형 종료.',
].join(' ')

const LIMIT = 30

function rosterSection(roster: LiteRoster | null): string {
  if (!roster) return '아직 명단이 업로드되지 않았습니다.'
  const columns = [...roster.parsed.columns]
  const lines = roster.candidates
    .slice(0, LIMIT)
    .map(c => `${c.id} | ${c.name} | ${c.education} | ${c.major} | ${c.job}`)
  const more = roster.candidates.length > LIMIT ? `\n…외 ${roster.candidates.length - LIMIT}명` : ''
  return [
    `업로드 파일: ${roster.fileName}`,
    `지원자 ${roster.candidates.length}명, 열 ${roster.columnCount}개.`,
    `열 이름: ${columns.join(', ')}`,
    `지원자 목록 (번호 | 이름 | 학력 | 전공 | 1지망 직무), 앞 ${Math.min(LIMIT, roster.candidates.length)}명:`,
    lines.join('\n') + more,
  ].join('\n')
}

function scheduleSection(roster: LiteRoster | null, schedule: LiteSchedule | null): string {
  if (!schedule) {
    return roster
      ? '아직 팀 회신을 올리지 않아 편성 결과가 없습니다.'
      : '아직 지원자 명단이 업로드되지 않아 편성을 시작할 수 없습니다.'
  }
  const { result } = schedule
  const rooms = result.cfg.rooms
  const days = result.dates.map((d, i) => `${i + 1}일차 ${d.iso}(${d.wd})`).join(', ')
  const lines = result.placed
    .slice(0, LIMIT)
    .map(p => {
      const time = result.times[p.slot]?.label ?? `${p.slot + 1}세션`
      return `${p.day + 1}일차 | ${time} | ${p.room + 1}조 | ${p.app.name} | ${p.edu} | ${p.teams.join(' + ')}`
    })
  const more = result.placed.length > LIMIT ? `\n…외 ${result.placed.length - LIMIT}건` : ''
  return [
    `팀 회신 ${schedule.sourceCount}개로 편성했습니다.`,
    `총 ${result.totalDays}일, 하루 ${result.cfg.sessions}세션 × ${rooms}조.`,
    `일자: ${days}`,
    `편성 완료 ${result.placed.length}명, 미배정 ${result.unplaced.length}명, 하드 위반 ${schedule.hardViolations}건.`,
    `편성표 (일차 | 시간 | 조 | 지원자 | 학력 | 팀), 앞 ${Math.min(LIMIT, result.placed.length)}건:`,
    lines.join('\n') + more,
  ].join('\n')
}

export type ChatContextInput = {
  readonly role: string
  readonly page: string
  readonly roster: LiteRoster | null
  readonly schedule: LiteSchedule | null
}

/** 지금 화면에 무엇이 떠 있는지를 한국어 블록으로 만든다. 요청마다 새로 만든다. */
export function buildContext({ role, page, roster, schedule }: ChatContextInput): string {
  const head = [
    OVERVIEW,
    '',
    `현재 역할: ${ROLE_LABELS[role] ?? role}`,
    `현재 화면: ${PAGE_LABELS[page] ?? page}`,
    '',
  ].join('\n')

  let body: string
  if (page === 'roster') {
    body = `이 화면의 데이터(업로드된 실제 명단):\n${rosterSection(roster)}`
  } else if (page === 'schedule') {
    body = `이 화면의 데이터(편성 결과):\n${scheduleSection(roster, schedule)}`
  } else {
    const html = DEMO_PAGES[page]
    body = html
      ? `이 화면의 데이터(예시 데이터):\n${htmlToText(html)}`
      : '이 화면의 데이터는 확인할 수 없습니다.'
  }

  const room = MAX_CONTEXT - head.length - CUT.length
  if (body.length > room) body = `${body.slice(0, Math.max(0, room))}${CUT}`
  return head + body
}
