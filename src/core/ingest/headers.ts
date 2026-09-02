/* 헤더 행 탐지 + 컬럼명 → 컬럼번호 매핑.
   server/parse_val.py 의 find_header_row 와 cmap 구성을 그대로 옮긴 것이다. */
import { type Sheet, textOf } from './types'

/** 지원자를 식별하는 키 컬럼. 헤더 행을 찾는 기준이기도 하다. */
export const KEY = '지원자 번호'

/** 마스터·회신 파일이 공유하는 표준 컬럼. 누락되면 경고를 낸다. */
export const STD = [
  '지원자 번호', '한글성명', '생년월일', '나이', '성별', '국적', '병역구분', '복무 종료일', '계급',
  '1지망_조직', '1지망_직무', '1지망_지역', 'R&D/N-R&D', '직무', '최종학력_학교유형', '최종학력_학교명',
  '최종학력_졸업구분', '최종학력_졸업일', '최종학력_주전공', '최종학력_환산학점', '최종학력_전공환산학점',
] as const

/** 표준 헤더 행. 이 값과 다르면 경고만 내고 계속 간다. */
export const STD_HEADER_ROW = 4

/**
 * '지원자 번호' 가 있는 행 중 **가장 아래** = 실제 데이터 직전의 헤더.
 * 위쪽에 그룹 헤더가 겹쳐 있는 파일이 있어서 가장 아래를 고른다.
 */
export function findHeaderRow(sheet: Sheet, maxr = 8): number | null {
  const cands: number[] = []
  for (let r = 1; r <= Math.min(maxr, sheet.rowCount); r++) {
    for (let c = 1; c <= sheet.columnCount; c++) {
      if (textOf(sheet, r, c) === KEY) {
        cands.push(r)
        break
      }
    }
  }
  return cands.length ? Math.max(...cands) : null
}

/** 컬럼명 → 컬럼번호(1-indexed). 같은 이름이 여러 번 나오면 **첫 등장**이 이긴다. */
export function columnMap(sheet: Sheet, headerRow: number): Map<string, number> {
  const cmap = new Map<string, number>()
  for (let c = 1; c <= sheet.columnCount; c++) {
    const v = textOf(sheet, headerRow, c)
    if (v !== null && !cmap.has(v)) cmap.set(v, c)
  }
  return cmap
}

/** 헤더 영역(1행~headerRow)에 텍스트가 있는 마지막 열. 면접관 컬럼을 고르는 기준이다. */
export function lastHeaderCol(sheet: Sheet, headerRow: number): number {
  let last = 0
  for (let c = 1; c <= sheet.columnCount; c++) {
    for (let r = 1; r <= headerRow; r++) {
      const v = textOf(sheet, r, c)
      if (v !== null && v.trim() !== '') {
        last = c
        break
      }
    }
  }
  return last
}

/** 어떤 열의 헤더 영역에 쌓인 문자열들 (위에서 아래 순서) */
export function headerStack(sheet: Sheet, headerRow: number, col: number): string[] {
  const out: string[] = []
  for (let r = 1; r <= headerRow; r++) {
    const v = textOf(sheet, r, col)
    if (v !== null && v.trim() !== '') out.push(v)
  }
  return out
}
