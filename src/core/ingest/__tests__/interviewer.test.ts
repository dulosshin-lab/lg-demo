/* 면접관 컬럼 규칙 단위 검사 — 엑셀 없이 합성 Sheet 로 돈다.
   규칙을 바꾸면 여기가 먼저 깨져야 한다. */
import { describe, expect, it } from 'vitest'
import { findInterviewerCol, looksLikeName } from '../interviewer'
import { parseTeam } from '../parseTeam'
import type { Cell, Sheet } from '../types'

/** 헤더 4행 + 데이터 구조를 재현한다 (실제 회신 파일과 같은 모양) */
function sheet(headers: string[], rows: Cell[][], headerRow = 4): Sheet {
  const columnCount = Math.max(headers.length, ...rows.map(r => r.length))
  const grid: Cell[][] = []
  for (let r = 1; r < headerRow; r++) grid.push(new Array(columnCount).fill(null))
  grid.push(headers.concat(new Array(columnCount - headers.length).fill(null)))
  for (const row of rows) grid.push(row.concat(new Array(columnCount - row.length).fill(null)))
  return { name: 'test.xlsx', grid, rowCount: grid.length, columnCount }
}

const STD_HEAD = ['지원자 번호', '한글성명']

describe('looksLikeName', () => {
  it('2~6자 한글은 이름으로 본다', () => {
    expect(looksLikeName('김철수')).toBe(true)
    expect(looksLikeName('남궁민수')).toBe(true)
  })
  it('조직·학교 접미사로 끝나면 이름이 아니다', () => {
    for (const v of ['기계공학과', '공과대학', '전자전공', 'AI솔루션팀', '서울시'])
      expect(looksLikeName(v)).toBe(false)
  })
  it('한글이 아니거나 길이를 벗어나면 이름이 아니다', () => {
    for (const v of ['A', 'Kim', '가', '일곱글자이름입니다', 123, null, ''])
      expect(looksLikeName(v)).toBe(false)
  })
})

describe('findInterviewerCol — 마지막 열 규칙', () => {
  it("헤더가 '면접관' 이면 how=header", () => {
    const s = sheet([...STD_HEAD, '면접관'], [[1, '지원자', '김철수']])
    expect(findInterviewerCol(s, 4)).toMatchObject({ col: 3, header: '면접관', how: 'header' })
  })

  it("헤더에 '면접관' 이 들어만 있으면 how=header", () => {
    for (const h of ['팀 면접관', '면접관 성명']) {
      const s = sheet([...STD_HEAD, h], [[1, '지원자', '김철수']])
      expect(findInterviewerCol(s, 4)).toMatchObject({ col: 3, header: h, how: 'header' })
    }
  })

  it("헤더가 '인원' 이어도 마지막 열이면 고른다 — 옛 파서가 값 패턴으로 추정하던 경우", () => {
    const s = sheet([...STD_HEAD, '인원'], [
      [1, '지원자1', '김철수'], [2, '지원자2', '이영희'], [3, '지원자3', null],
    ])
    expect(findInterviewerCol(s, 4)).toMatchObject({
      col: 3, header: '인원', how: 'position', looksLikeNames: true,
    })
  })

  it('마지막 열이 표준 컬럼이면 면접관 컬럼이 없는 것으로 본다', () => {
    const s = sheet(STD_HEAD, [[1, '지원자']])
    expect(findInterviewerCol(s, 4).col).toBeNull()
  })

  it('마스터에만 있는 컬럼이 마지막이어도 면접관으로 오인하지 않는다', () => {
    const s = sheet([...STD_HEAD, '1차서류 결과'], [[1, '지원자', '합격']])
    expect(findInterviewerCol(s, 4, new Set(['1차서류 결과'])).col).toBeNull()
  })

  it('값이 사람 이름 모양이 아니면 looksLikeNames=false — 안전망이 걸린다', () => {
    const s = sheet([...STD_HEAD, '비고'], [
      [1, '지원자1', '기계공학과'], [2, '지원자2', '전자전공'], [3, '지원자3', '공과대학'],
    ])
    expect(findInterviewerCol(s, 4)).toMatchObject({ how: 'position', looksLikeNames: false })
  })

  it('값이 하나도 없으면 판단을 보류한다 (미기재 경고가 따로 나간다)', () => {
    const s = sheet([...STD_HEAD, '인원'], [[1, '지원자1', null], [2, '지원자2', null]])
    expect(findInterviewerCol(s, 4).looksLikeNames).toBeNull()
  })
})

describe('parseTeam 경고', () => {
  const rows = [[1, '지원자1', '김철수'], [2, '지원자2', '이영희'], [3, '지원자3', '박민수']]

  it("헤더가 '면접관' 이면 컬럼 관련 경고가 없다", () => {
    const { warnings } = parseTeam(sheet([...STD_HEAD, '면접관'], rows))
    expect(warnings.filter(w => w.includes('면접관 컬럼'))).toEqual([])
  })

  it("비표준 헤더는 '비표준' 경고만 낸다 — 값이 이름이면 확인 배너를 띄우지 않는다", () => {
    const { warnings } = parseTeam(sheet([...STD_HEAD, '인원'], rows))
    expect(warnings).toContain('면접관 컬럼명이 비표준 → "인원"')
    expect(warnings.some(w => w.includes('값 패턴으로 추정'))).toBe(false)
  })

  it('값이 수상하면 확인 배너용 문구를 낸다', () => {
    const bad = [[1, 'a', '기계공학과'], [2, 'b', '전자전공'], [3, 'c', '공과대학']]
    const { warnings } = parseTeam(sheet([...STD_HEAD, '비고'], bad))
    // Warnings.tsx 가 이 문구로 '사람 확인 필요' 배너를 만든다
    expect(warnings.some(w => w.includes('값 패턴으로 추정'))).toBe(true)
  })

  it('면접관 미기재 건수를 센다', () => {
    const some = [[1, 'a', '김철수'], [2, 'b', null], [3, 'c', null]]
    const { warnings } = parseTeam(sheet([...STD_HEAD, '면접관'], some))
    expect(warnings).toContain('면접관 미기재 2/3건')
  })

  it('헤더 행이 4행이 아니면 경고한다', () => {
    const { warnings } = parseTeam(sheet([...STD_HEAD, '면접관'], rows, 2))
    expect(warnings).toContain('헤더 행이 표준(4행)과 다름 → 2행')
  })

  it('헤더 행을 못 찾으면 파싱하지 않는다', () => {
    const s = sheet(['이름', '소속'], [['가', '나']])
    const { parsed, warnings } = parseTeam(s)
    expect(parsed).toBeNull()
    expect(warnings).toEqual(['헤더 행(지원자 번호)을 찾지 못함'])
  })
})
