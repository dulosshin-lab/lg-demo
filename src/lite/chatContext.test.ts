import { describe, expect, it } from 'vitest'
import { buildContext, htmlToText, PAGE_LABELS } from './chatContext'
import { DEMO_PAGES } from './demoPages'
import type { LiteRoster } from './data'

const FAKE_ROSTER: LiteRoster = {
  fileName: '지원자명단.xlsx',
  columnCount: 2,
  candidates: [
    { id: '101', name: '이서아', education: '학사', major: '화학공학', job: '전극개발' },
    { id: '102', name: '김도윤', education: '석사', major: '전기공학', job: '셀설계' },
  ],
  headers: ['지원자 번호', '한글성명'],
  rows: [['101', '이서아'], ['102', '김도윤']],
  parsed: { rows: new Map(), columns: new Set(['지원자 번호', '한글성명']), header_row: 3, warnings: [] },
}

describe('챗봇 화면 맥락', () => {
  it('목업 마크업을 태그 없는 줄글로 바꾼다', () => {
    // Given: 표와 엔티티가 섞인 목업 조각
    const html = '<h1>운영 &amp; 현황</h1><table><tr><th>이름</th><th>팀</th></tr><tr><td>이서아</td><td>전극기술</td></tr></table>'

    // When: 줄글로 바꾸면
    const text = htmlToText(html)

    // Then: 태그는 사라지고 엔티티는 풀리며 표는 칸 구분이 남아야 한다
    expect(text).not.toContain('<')
    expect(text).toContain('운영 & 현황')
    expect(text).toContain('이름 | 팀')
    expect(text).toContain('이서아 | 전극기술')
  })

  it('시연용 화면에서는 그 화면의 예시 데이터를 함께 넣는다', () => {
    // Given: 운영 대시보드 화면
    const context = buildContext({ role: 'hr', page: 'dash', roster: null, schedule: null })

    // When: 맥락 블록을 확인하면
    // Then: 현재 화면 라벨과 그 화면의 목업 수치가 있어야 한다
    expect(context).toContain(`현재 화면: ${PAGE_LABELS.dash}`)
    expect(context).toContain('현재 역할: HR 간사')
    expect(context).toContain('이 화면의 데이터(예시 데이터):')
    expect(context).toContain('전체 지원자')
    expect(context).toContain('467')
  })

  it('명단 화면에서는 업로드된 실제 지원자를 넣는다', () => {
    // Given: 명단이 올라간 상태의 명단 등록 화면
    const context = buildContext({ role: 'hr', page: 'roster', roster: FAKE_ROSTER, schedule: null })

    // When: 맥락 블록을 확인하면
    // Then: 인원수와 실제 지원자 줄이 보여야 한다
    expect(context).toContain('지원자 2명')
    expect(context).toContain('이서아')
    expect(context).toContain('화학공학')
  })

  it('명단이 없으면 없다고 알린다', () => {
    // Given: 아직 업로드하지 않은 명단 등록 화면
    const context = buildContext({ role: 'hr', page: 'roster', roster: null, schedule: null })

    // When/Then: 지어내지 않고 비었음을 알려야 한다
    expect(context).toContain('아직 명단이 업로드되지 않았습니다.')
  })

  it('어떤 화면이든 맥락 길이가 상한을 넘지 않는다', () => {
    // Given: 모든 시연용 화면
    // When: 각 화면의 맥락을 만들면
    // Then: num_ctx 안에 들어가는 길이여야 한다
    for (const page of Object.keys(DEMO_PAGES)) {
      const context = buildContext({ role: 'hr', page, roster: null, schedule: null })
      expect(context.length).toBeLessThanOrEqual(6200)
    }
  })
})
