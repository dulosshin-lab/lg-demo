/* ① ingest — 엑셀 한 장을 행 목록으로 바꾸는 계층의 자료형.
   ExcelJS 를 여기서 알지 못한다. 엑셀 라이브러리를 바꿔도 이 아래는 그대로다.
   시트를 Sheet 로 만드는 일은 io/xlsx.ts 가 맡는다. */

/** 셀 하나의 값. 날짜는 io 계층에서 'YYYY-MM-DD' 문자열로 이미 바뀌어 들어온다. */
export type Cell = string | number | boolean | null

/** 시트 한 장. 순수 데이터라 테스트에서 손으로 만들 수 있다. */
export interface Sheet {
  name: string
  /** grid[r][c] — 0-indexed 내부 저장. 읽을 때는 cellOf 로 1-indexed 로 접근한다 */
  grid: Cell[][]
  rowCount: number
  columnCount: number
}

/** openpyxl 의 ws.cell(r, c) 과 같은 1-indexed 좌표계. 포팅한 코드를 그대로 읽히게 하려는 것이다. */
export function cellOf(sheet: Sheet, row: number, col: number): Cell {
  const v = sheet.grid[row - 1]?.[col - 1]
  return v === undefined ? null : v
}

/** 문자열 셀만 꺼낸다 (헤더 판정용) */
export function textOf(sheet: Sheet, row: number, col: number): string | null {
  const v = cellOf(sheet, row, col)
  return typeof v === 'string' ? v : null
}

/** 팀 회신 파일 한 장의 파싱 결과 */
export interface TeamRow {
  /** 표준 컬럼 값 + 면접관. 원본 엑셀의 행 번호는 _row 에 남긴다 */
  [key: string]: Cell | number | undefined
  면접관: Cell
  _row: number
}

export interface ParsedTeam {
  rows: TeamRow[]
  header_row: number
  /** 면접관 컬럼 번호 (1-indexed). 못 찾으면 null */
  icol: number | null
  /** 면접관 컬럼의 헤더 문자열 */
  iheader: string | null
  /** 'header' = 헤더에 '면접관' 이 있었다 · 'position' = 마지막 열 규칙으로 골랐다 */
  how: 'header' | 'position' | null
  cols: number
}

export interface ParseResult {
  parsed: ParsedTeam | null
  warnings: string[]
}
