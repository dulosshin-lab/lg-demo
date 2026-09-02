import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LiteApp } from './LiteApp'
import { WorkspacePage } from './WorkspacePage'

describe('면접 진행 워크스페이스', () => {
  it('오늘의 면접 세 건을 목록으로 내놓는다', () => {
    // Given: 면접위원 워크스페이스 화면
    const markup = renderToStaticMarkup(<WorkspacePage />)

    // When: 왼쪽 목록을 확인하면
    // Then: 세 건이 시각과 지원자 번호로 나와야 한다
    expect(markup).toContain('오늘의 면접 3건')
    for (const each of ['09:00 지원자 087', '09:30 지원자 112', '10:00 지원자 134']) {
      expect(markup).toContain(each)
    }
    // 그리고 첫 건이 선택되어 있어야 한다
    expect(markup.split('aria-current="true"')).toHaveLength(2)
  })

  it('첫 지원자의 블라인드 정보와 평가 기준을 함께 보여 준다', () => {
    // Given: 첫 면접이 열린 워크스페이스
    const markup = renderToStaticMarkup(<WorkspacePage />)

    // When: 오른쪽 패널을 확인하면
    // Then: 087 의 전공과 직무, 블라인드 안내가 있어야 한다
    expect(markup).toContain('지원자 087')
    expect(markup).toContain('전자공학')
    expect(markup).toContain('R&amp;D, AI 응용')
    expect(markup).toContain('생년월일, 성별, 국적, 병역, 학점, 어학은 이 화면에 표시하지 않습니다.')

    // 그리고 다섯 평가 기준과 질문 초안 버튼이 있어야 한다
    for (const label of ['직무 역량', '문제 해결', '커뮤니케이션', '조직 적합', '종합']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('초안 생성')
  })

  it('처음 그릴 때는 점수도 저장 표시도 없다', () => {
    // Given: 아직 아무것도 누르지 않은 워크스페이스
    const markup = renderToStaticMarkup(<WorkspacePage />)

    // When: 점수 칸과 저장 표시를 확인하면
    // Then: 기본값 없이 비어 있어야 한다
    expect(markup).not.toContain('pt on')
    expect(markup).not.toContain('저장됨')
  })

  it('면접위원 메뉴의 워크스페이스는 목업 대신 이 화면을 연다', () => {
    // Given: 면접위원 역할로 워크스페이스를 연 셸
    const markup = renderToStaticMarkup(<LiteApp initialRole="iv" initialPage="i-work" />)

    // When: 본문을 확인하면
    // Then: 살아 있는 컨트롤(점수 버튼, 노트 입력)이 있어야 한다
    expect(markup).toContain('aria-label="직무 역량 1점"')
    expect(markup).toContain('aria-label="면접 노트"')
  })
})
