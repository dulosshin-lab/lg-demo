/* 팀 회신 파일 한 장 → 행 목록 + 경고.
   server/parse_val.py 의 parse_team 을 옮긴 것이다. 경고 문구는 화면(Warnings.tsx)이
   문자열로 걸러 쓰므로 표현을 함부로 바꾸지 않는다. */
import { KEY, STD, STD_HEADER_ROW, columnMap, findHeaderRow } from './headers'
import { findInterviewerCol } from './interviewer'
import { type ParseResult, type Sheet, type TeamRow, cellOf } from './types'

/**
 * 회신 파일 한 장을 파싱한다.
 * @param known 마스터에 존재하는 컬럼명 집합 — 표준 컬럼을 면접관으로 오인하지 않게 한다
 */
export function parseTeam(sheet: Sheet, known?: Set<string>): ParseResult {
  const warnings: string[] = []

  const hr = findHeaderRow(sheet)
  if (hr === null) return { parsed: null, warnings: ['헤더 행(지원자 번호)을 찾지 못함'] }
  if (hr !== STD_HEADER_ROW) warnings.push(`헤더 행이 표준(${STD_HEADER_ROW}행)과 다름 → ${hr}행`)

  const cmap = columnMap(sheet, hr)
  const missing = STD.filter(k => !cmap.has(k))
  if (missing.length) warnings.push('표준 컬럼 누락: ' + missing.join(', '))

  const iv = findInterviewerCol(sheet, hr, known)
  if (iv.col === null) {
    warnings.push('면접관 컬럼을 찾지 못함')
  } else {
    if (iv.header !== '면접관') warnings.push(`면접관 컬럼명이 비표준 → "${iv.header}"`)
    /* 안전망 — 마지막 열을 골랐는데 값이 사람 이름 모양이 아니면 사람이 봐야 한다.
       화면이 이 문구('값 패턴으로 추정')로 별도 배너를 띄운다. 옛 파서는 헤더에 '면접관' 이
       없기만 하면 이 배너를 띄웠지만, 이제는 값까지 수상할 때만 띄운다. */
    if (iv.looksLikeNames === false)
      warnings.push(`면접관 컬럼을 값 패턴으로 추정 (헤더 "${iv.header}") · 값이 사람 이름 형태가 아닙니다`)
  }

  const keyCol = cmap.get(KEY)!
  const rows: TeamRow[] = []
  for (let r = hr + 1; r <= sheet.rowCount; r++) {
    if (cellOf(sheet, r, keyCol) === null) continue
    const d = { 면접관: iv.col ? cellOf(sheet, r, iv.col) : null, _row: r } as TeamRow
    for (const k of STD) {
      const c = cmap.get(k)
      if (c !== undefined) d[k] = cellOf(sheet, r, c)
    }
    rows.push(d)
  }

  const nblank = rows.filter(d => !d.면접관).length
  if (nblank) warnings.push(`면접관 미기재 ${nblank}/${rows.length}건`)

  return {
    parsed: {
      rows,
      header_row: hr,
      icol: iv.col,
      iheader: iv.header,
      how: iv.how,
      cols: sheet.columnCount,
    },
    warnings,
  }
}
