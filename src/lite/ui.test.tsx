import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HOME, LiteApp } from './LiteApp'
import { RosterPage } from './RosterPage'
import { SchedulePage } from './SchedulePage'
import { DEMO_PAGES } from './demoPages'
import type { LiteRoster, LiteSchedule } from './data'

const EMPTY_SCHEDULE: LiteSchedule = {
  sourceCount: 1,
  payload: { meta: { parsed_at: '', files: 1, requests_total: 0, requests_matched: 0, applicants_total: 0, warnings: [], failed_files: [] }, apps: [], excluded: [] },
  result: { cfg: { startDate: '2026-08-17', days: 0, sessions: 1, rooms: 1, startTime: '09:00', sessionMin: 25, breakMin: 5, lunchStart: '12:00', lunchMin: 60, amSessions: 1, separateEdu: true, eduBoundary: 'session', checkInterviewer: true, avoidFirstSlot: 'off', rotateEvery: 0, skipWeekend: true, pinned: null }, roomsPlan: null, times: [{ i: 0, start: 540, end: 565, label: '09:00–09:25', pm: false }], FS: { am: 0, pm: -1 }, grid: {}, placed: [], unplaced: [], demand: {}, teamsAsc: [], minDemand: 0, totalDays: 1, groupDays: [], groups: [], dates: [{ iso: '2026-08-17', wd: '월', label: '8/17(월)' }] },
  validation: { r1: [], r2: [], r3: [], r4: [] },
  hardViolations: 0,
}

const HEADERS = ['지원자 번호', '한글성명', '성별', '최종학력_주전공']

const FAKE_ROSTER: LiteRoster = {
  fileName: '취합파일.xlsx',
  columnCount: HEADERS.length,
  candidates: [{ id: 'A1', name: '김지원', education: '학사', major: '기계공학', job: '설계' }],
  headers: HEADERS,
  rows: [['A1', '김지원', '여', '기계공학']],
  parsed: { rows: new Map(), columns: new Set(HEADERS), header_row: 4, warnings: [] },
}

const mobileNavOf = (markup: string) => markup.split('aria-label="라이트 데모 메뉴"')[1]?.split('</nav>')[0] ?? ''

const rosterMarkup = () =>
  renderToStaticMarkup(<RosterPage roster={FAKE_ROSTER} busy={false} onUpload={() => undefined} onNext={() => undefined} />)

describe('L1 라이트 데모 접근 가능한 셸', () => {
  it('좁은 화면용 메뉴에도 HR 경로를 모두 남긴다', () => {
    // Given: 초기 라이트 데모 셸
    const markup = renderToStaticMarkup(<LiteApp />)

    // When: 모바일 내비게이션 마크업만 확인하면
    const mobileNav = mobileNavOf(markup)

    // Then: HR 여덟 화면과 설정이 모두 있어야 한다
    for (const label of ['운영 대시보드', '전형 설정', '지원자 명단 등록', '조직 희망자 취합', '취합 데이터 검증', '면접 일정 편성', '변경 대응과 재통보', '전형 종료와 산출물', '설정']) {
      expect(mobileNav).toContain(label)
    }
    // 그리고 더 이상 잠긴 메뉴가 없어야 한다
    expect(mobileNav).not.toContain('비활성')
    expect(mobileNav).not.toContain('disabled')
  })

  it('운영 대시보드를 열면 시안의 목업 지표가 그대로 나온다', () => {
    // Given: HR 첫 화면인 운영 대시보드
    expect(HOME.hr).toBe('dash')

    // When: 그 화면을 렌더하면
    const markup = renderToStaticMarkup(<LiteApp initialPage="dash" />)

    // Then: 시안의 카드 문구가 보여야 한다
    expect(markup).toContain('전체 지원자')
    expect(markup).toContain('다음 할 일: 변경 대응 3건')
  })

  it('역할을 팀 담당자로 바꾸면 팀 메뉴와 첫 화면이 함께 바뀐다', () => {
    // Given: 팀 담당자 역할로 전환한 셸
    expect(HOME.lead).toBe('t-pick')
    const markup = renderToStaticMarkup(<LiteApp initialRole="lead" />)

    // When: 메뉴와 본문을 확인하면
    const mobileNav = mobileNavOf(markup)

    // Then: 팀 담당자 메뉴가 뜨고 면접 희망자 선택 화면에 있어야 한다
    expect(mobileNav).toContain('면접 희망자 선택')
    expect(mobileNav).toContain('회피 관계 신고')
    expect(mobileNav).not.toContain('운영 대시보드')
    expect(markup).toContain('HR이 전달한 지원자 중 전극기술팀이 면접할 희망자를 고르고')
    expect(markup).toContain('박팀장')
  })

  it('메뉴에 (demo) 꼬리표를 더는 붙이지 않는다', () => {
    // Given: 초기 라이트 데모 셸
    const markup = renderToStaticMarkup(<LiteApp />)

    // When: 메뉴 전체를 확인하면
    // Then: 시연 표시는 사라지고 목업 배지는 남아야 한다
    expect(markup).not.toContain('(demo)')
    const mobileNav = mobileNavOf(markup)
    expect(mobileNav).toContain('8/8팀')
    expect(mobileNav).toContain('결측 0')
    expect(mobileNav).toContain('3건')
  })

  it('모든 화면에 도움말 챗봇 버튼을 띄운다', () => {
    // Given: 초기 라이트 데모 셸
    const markup = renderToStaticMarkup(<LiteApp />)

    // When: 우측 하단 버튼을 찾으면
    // Then: 챗봇 여는 버튼이 있고 패널은 아직 닫혀 있어야 한다
    expect(markup).toContain('aria-label="도움말 챗봇"')
    expect(markup).not.toContain('chatpanel')
  })

  it('네 역할의 첫 화면과 시연용 화면이 모두 목업 마크업을 갖는다', () => {
    // Given: 시안에서 옮겨 온 시연용 화면 목록
    const keys = Object.keys(DEMO_PAGES)

    // When: 역할별 첫 화면과 목업 마크업을 대조하면
    // Then: 열다섯 화면이 모두 채워져 있고, 동작하는 두 화면은 목업을 쓰지 않아야 한다
    expect(keys).toHaveLength(15)
    for (const key of keys) expect(DEMO_PAGES[key].length).toBeGreaterThan(200)
    for (const key of ['roster', 'schedule']) expect(DEMO_PAGES[key]).toBeUndefined()
    for (const role of ['hr', 'lead', 'iv', 'app'] as const) expect(keys).toContain(HOME[role])
  })

  it('일자 선택은 불완전한 탭 역할 대신 누름 상태 버튼을 쓴다', () => {
    // Given: 하루가 있는 편성 결과
    const markup = renderToStaticMarkup(<SchedulePage roster={null} schedule={EMPTY_SCHEDULE} busy={false} onUpload={() => undefined} onBack={() => undefined} />)

    // When: 일자 선택 컨트롤을 확인하면
    const dayControls = markup.split('aria-label="면접 일자"')[1]?.split('</div>')[0] ?? ''

    // Then: 일반 버튼의 누름 상태로 현재 일자를 알려야 한다
    expect(dayControls).toContain('aria-pressed="true"')
    expect(dayControls).not.toContain('role="tab"')
  })

  it('사이드바 안내는 브라우저 저장을 사실대로 알린다', () => {
    // Given: 평가를 이 브라우저에 저장하게 된 라이트 데모
    const markup = renderToStaticMarkup(<LiteApp />)

    // When: 사이드바 하단 안내를 확인하면
    // Then: 저장 없음이라는 옛 문구가 사라지고 브라우저 저장을 알려야 한다
    expect(markup).not.toContain('저장 없이 이 브라우저에서 동작하며')
    expect(markup).toContain('데이터는 이 브라우저에만 저장되며')
  })

  it('올린 데이터 확인 표는 올린 열을 하나도 빠뜨리지 않는다', () => {
    // Given: 네 열짜리 명단
    // When: 명단 화면을 렌더하면
    const markup = rosterMarkup()

    // Then: 헤더가 전부 나오고 가로 스크롤이 걸리는 표여야 한다
    for (const header of HEADERS) expect(markup).toContain(header)
    expect(markup).toContain('table-wrap roster-table')
  })

  it('블라인드 채용은 기본으로 켜져 신상 항목을 가린다', () => {
    // Given: 성별 열이 있는 명단
    // When: 명단 화면을 처음 열면
    const markup = rosterMarkup()

    // Then: 성별 값만 가려지고 나머지 값은 그대로 보여야 한다
    expect(markup).toContain('블라인드 채용')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('●●')
    expect(markup).not.toContain('>여<')
    expect(markup).toContain('김지원')
    expect(markup).toContain('기계공학')
    // 그리고 가린 항목 수와 평가자 화면 안내를 함께 알려야 한다
    expect(markup).toContain('1항목')
    expect(markup).toContain('평가자 화면에는 가림 항목이 표시되지 않습니다.')
  })

  it('안내 토스트는 누르기 전에는 떠 있지 않다', () => {
    // Given: 아무 버튼도 누르지 않은 라이트 데모 셸
    const markup = renderToStaticMarkup(<LiteApp />)

    // When: 토스트 자리를 확인하면
    // Then: 빈 껍데기 없이 아예 없어야 한다
    expect(markup).not.toContain('class="toast"')
    // 그리고 알림 목록은 눌러서 여는 버튼이어야 한다
    expect(markup).toContain('aria-label="알림"')
  })

  it('한글 문장은 의미 단위 줄바꿈을 전역으로 상속한다', () => {
    // Given: 라이트 데모 스타일시트
    const stylesheet = readFileSync(resolve(import.meta.dirname, 'styles.css'), 'utf8')

    // When: 본문 기본 규칙을 확인하면
    const bodyRule = stylesheet.match(/body\s*\{[^}]+\}/)?.[0] ?? ''

    // Then: 한글 어절과 문장 단위 줄바꿈을 함께 지정해야 한다
    expect(bodyRule).toContain('word-break: keep-all')
    expect(bodyRule).toContain('text-wrap: pretty')
  })
})
