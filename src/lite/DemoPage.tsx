import { useEffect, useRef, type MouseEvent } from 'react'

type DemoPageProps = {
  readonly html: string
  readonly onGoto: (page: string) => void
  readonly onNotify: (text: string) => void
}

const SIDE_KEY = 'lite.side'
const SIDES = ['white', 'red', 'black']

/** 고른 사이드바 색을 문서에 반영한다. 기본값 레드는 속성 없이 둔다. */
export function applySide(side: string): void {
  const root = document.documentElement
  if (side === 'red' || !SIDES.includes(side)) delete root.dataset.side
  else root.dataset.side = side
}

/** 이 브라우저에 저장된 선택. 저장이 막힌 브라우저도 있어 실패하면 기본값으로 돌아간다. */
export function storedSide(): string {
  try {
    return localStorage.getItem(SIDE_KEY) ?? 'red'
  } catch {
    return 'red'
  }
}

const markSideopts = (root: Element, side: string) => {
  for (const each of root.querySelectorAll<HTMLElement>('.sideopt')) {
    each.setAttribute('aria-pressed', String(each.dataset.side === side))
  }
}

const text = (node: Element | null | undefined): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** 일일 슬롯 프리셋. 고르면 하루 자리 수까지 같이 바뀐다. */
const PRESETS: Record<string, number> = { '8×4': 32, '10×6': 60, '14×6': 84 }

/** 가까운 패널의 표를 CSV 로 내려받는다. 표가 없으면 아무것도 하지 않고 false 를 준다. */
const exportCsv = (from: Element): boolean => {
  const table = from.closest('.panel')?.querySelector('table')
  if (!table) return false
  const lines: string[] = []
  for (const row of table.querySelectorAll('tr')) {
    const cells: string[] = []
    for (const cell of row.querySelectorAll('th, td')) cells.push(`"${text(cell).replace(/"/g, '""')}"`)
    if (cells.length > 0) lines.push(cells.join(','))
  }
  if (lines.length === 0) return false
  const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = '데모내보내기.csv'
  link.click()
  URL.revokeObjectURL(url)
  return true
}

/** 데이터가 실제로 바뀌지 않는 버튼은 「데모 동작」이라고 밝힌다. */
const MOCK: Record<string, string> = {
  '리마인더': '전극기술팀에 회신 리마인더를 보내는 동작입니다.',
  '확정 통보 메일 열기': '확정 통보 메일 초안을 여는 동작입니다.',
  '전형 종료': '전형을 읽기 전용으로 닫는 동작입니다. 산출물이 고정됩니다.',
  '평가 마감': '위원 입력을 잠그고 인계 파일을 확정하는 동작입니다.',
  '수정': '수정 폼이 열리는 동작입니다.',
  '작성': '평가 작성 화면이 열리는 동작입니다.',
  '희망자 선택 완료': '희망자 선택을 완료로 표시하는 동작입니다.',
  '+ 불가 시간 등록': '불가 시간 등록 폼이 열리는 동작입니다.',
  '+ 회피 관계 신고': '회피 관계 신고 폼이 열리는 동작입니다.',
  'Webex 입장': '면접방 연결은 생략합니다. 본 제품에서 Webex 로 입장합니다.',
  '면접방 입장': '면접방 연결은 생략합니다. 본 제품에서 Webex 로 입장합니다.',
  '회신 파일에서 가져오기': '회신 파일에서 위원 명부를 가져오는 동작입니다.',
  '+ 위원 등록': '위원 등록 폼이 열리는 동작입니다.',
  '제안 만들기': '매칭 제안 12건을 만드는 동작입니다.',
  '제안 적용': '제안 12건을 시간표에 반영하는 동작입니다.',
  '+ 전형 만들기': '전형 생성 폼이 열리는 동작입니다.',
  '복제': '직전 전형의 편성 설정을 복제하는 동작입니다.',
  '시작': '본 제품에서 제공되는 기능입니다. 데모에서는 생략합니다.',
  '보기': '본 제품에서 제공되는 기능입니다. 데모에서는 생략합니다.',
}

/** 시안 마크업을 그대로 그리고, 시안 JS 가 하던 동작(허브 탭 전환, 페이지 이동, 사이드바 색)만 되살린다.
 *  나머지 버튼도 눌리면 반드시 무언가로 답한다. 진짜로 되는 일은 진짜로 하고, 나머지는 데모 동작이라고 알린다. */
export function DemoPage({ html, onGoto, onNotify }: DemoPageProps) {
  const ref = useRef<HTMLDivElement>(null)

  // 화면 설정 탭이 새로 그려질 때마다 지금 색에 눌림 표시를 맞춘다
  useEffect(() => {
    if (ref.current) markSideopts(ref.current, storedSide())
  }, [html])

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const root = event.currentTarget

    const tab = target.closest<HTMLElement>('.hubtab')
    if (tab) {
      for (const each of root.querySelectorAll('.hubtab')) each.setAttribute('aria-current', String(each === tab))
      for (const pane of root.querySelectorAll<HTMLElement>('.hubpane')) pane.hidden = pane.id !== `tab-${tab.dataset.tab}`
      return
    }

    const option = target.closest<HTMLElement>('.sideopt')
    if (option?.dataset.side) {
      const side = option.dataset.side
      applySide(side)
      try {
        localStorage.setItem(SIDE_KEY, side)
      } catch {
        // 저장이 막힌 브라우저 — 색은 이번 세션에만 남는다
      }
      markSideopts(root, side)
      return
    }

    const goto = target.closest<HTMLElement>('[data-goto]')
    if (goto?.dataset.goto) {
      onGoto(goto.dataset.goto)
      return
    }

    // 스위치는 진짜로 켜지고 꺼진다
    const toggle = target.closest<HTMLElement>('.switch')
    if (toggle) {
      const knob = toggle.querySelector('.sw')
      if (knob) {
        knob.classList.toggle('on')
        onNotify(`${text(toggle)} ${knob.classList.contains('on') ? '켜짐' : '꺼짐'}`)
      }
      return
    }

    const button = target.closest<HTMLElement>('button')
    if (!button) return
    const label = text(button)

    // 일일 슬롯 프리셋은 고른 자리가 눌린 채로 남고 하루 자리 수도 따라 바뀐다
    if (label in PRESETS) {
      const row = button.parentElement
      if (row) {
        for (const each of row.querySelectorAll('button')) each.classList.toggle('pri', each === button)
        const count = row.querySelector('.chip b')
        if (count) count.textContent = String(PRESETS[label])
      }
      onNotify(`일일 슬롯을 ${label}로 바꿨습니다. 하루 ${PRESETS[label]}자리입니다.`)
      return
    }

    // 표가 있는 자리에서는 진짜 CSV 를 내려받는다
    if (label === 'CSV' || label.endsWith(' CSV')) {
      if (exportCsv(button)) onNotify('CSV를 내려받았습니다.')
      else onNotify(`${label === 'CSV' ? '명부' : label.replace(' CSV', '')} 파일을 CSV로 내려받는 동작입니다.`)
      return
    }

    if (label === '빠른 편성 (판당 10초)') {
      onNotify('면접 일정 편성 화면으로 이동합니다.')
      onGoto('schedule')
      return
    }

    if (label === '취합 마감') {
      onNotify('희망자 취합을 마감하는 동작입니다. 취합 데이터 검증으로 이동합니다.')
      onGoto('verify')
      return
    }

    // 신청 버튼은 그 줄의 상태를 진짜로 바꾼다
    if (label === '신청') {
      const row = button.closest('tr')
      const chip = row?.querySelector('.chip')
      if (chip) chip.innerHTML = '<span class="dot"></span>신청됨 (박팀장)'
      button.textContent = '수정'
      onNotify('신청 상태를 신청됨으로 바꿨습니다.')
      return
    }

    if (label === '처리') {
      const kind = text(button.closest('.action')?.querySelector('h2'))
      onNotify(`${kind || '변경'} 처리 화면이 열리는 동작입니다.`)
      return
    }

    if (label.endsWith('XLSX') || label === '검증 리포트') {
      onNotify(`${label} 파일을 내려받는 동작입니다.`)
      return
    }

    const mock = MOCK[label]
    onNotify(mock ?? `「${label}」 데모 동작입니다.`)
  }

  return <div className="demo-page" ref={ref} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
