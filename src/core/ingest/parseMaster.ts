/* 지원자 마스터(취합파일.xlsx) → 지원자번호별 전 컬럼.
   server/build_apps.py 의 _read_master 를 옮긴 것이다.

   회신 파일과 달리 **전 컬럼을 그대로 보존한다** — 화면의 상세·필터가 쓰는 attrs 의 원천이다. */
import { KEY, STD_HEADER_ROW, findHeaderRow, headerStack, lastHeaderCol } from './headers'
import { type Cell, type Sheet, cellOf, textOf } from './types'

export interface MasterRow {
  [column: string]: Cell
}

export interface ParsedMaster {
  /** 지원자번호 → 그 행의 전 컬럼 */
  rows: Map<Cell, MasterRow>
  /** 마스터가 가진 컬럼명 집합 — 회신 파일의 표준 컬럼 판정에 쓰인다 */
  columns: Set<string>
  header_row: number
  warnings: string[]
}

export function parseMaster(sheet: Sheet): ParsedMaster {
  const hr = findHeaderRow(sheet)
  if (hr === null) throw new Error(`${sheet.name}: 헤더 행(지원자 번호)을 찾지 못함`)

  const warnings: string[] = []
  if (hr !== STD_HEADER_ROW) warnings.push(`[마스터] 헤더 행이 표준(${STD_HEADER_ROW}행)과 다름 → ${hr}행`)

  // 컬럼명 → 컬럼번호. 같은 이름이 여러 번 나오면 첫 등장이 이긴다.
  const cols = new Map<string, number>()
  for (let c = 1; c <= sheet.columnCount; c++) {
    const v = textOf(sheet, hr, c)
    if (v !== null && !cols.has(v)) cols.set(v, c)
  }

  const keyCol = cols.get(KEY)
  if (keyCol === undefined) throw new Error(`${sheet.name}: '${KEY}' 컬럼이 없습니다`)

  const rows = new Map<Cell, MasterRow>()
  for (let r = hr + 1; r <= sheet.rowCount; r++) {
    const aid = cellOf(sheet, r, keyCol)
    if (aid === null) continue
    const row: MasterRow = {}
    for (const [name, c] of cols) row[name] = cellOf(sheet, r, c)
    rows.set(aid, row)
  }

  return { rows, columns: new Set(cols.keys()), header_row: hr, warnings }
}

/**
 * 취합파일이 없을 때 — **팀 회신 파일들을 지원자 마스터로 삼는다.**
 *
 * 회신 파일은 취합파일에서 뽑아 만든 것이라 지원자 컬럼을 그대로 이고 있다.
 * data/ 8개 전부가 `지원자 번호` · `한글성명` · `최종학력_학교유형` 을 갖고 있어
 * 마스터가 없어도 조인에 필요한 것이 다 있다 — 실측으로 대상 60명이 골든과 완전히 일치했다.
 * 팀 회신이 먼저 도착하고 취합파일이 늦게 오는 것이 실무 순서이기도 하다.
 *
 * ⚠ 마지막 열(면접관)은 `columns` 에서 뺀다. 이 집합은 회신 파일의 "표준 컬럼" 판정에 쓰이는데,
 *   면접관 헤더가 거기 들어가 있으면 findInterviewerCol 이 그 열을 표준 컬럼으로 보고 버린다 —
 *   그러면 면접관을 아무도 못 찾아 전원이 '면접관 미매칭' 으로 제외된다.
 *
 * 파일 순서는 호출자가 정한다(이름 오름차순). 같은 지원자가 여러 팀에 있으면 먼저 읽은 것이 이긴다.
 */
export function mergeAsMaster(sheets: readonly Sheet[]): ParsedMaster {
  const rows = new Map<Cell, MasterRow>()
  const columns = new Set<string>()
  const ivHeaders = new Set<string>()
  const warnings: string[] = []

  for (const sheet of sheets) {
    let one: ParsedMaster
    try {
      one = parseMaster(sheet)
    } catch (e) {
      // 한 장이 마스터 모양이 아니어도 나머지는 계속 간다 — 회신 파일은 팀마다 서식이 다르다
      warnings.push(`[${sheet.name}] 지원자 정보를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    for (const [aid, row] of one.rows) if (!rows.has(aid)) rows.set(aid, row)
    for (const c of one.columns) columns.add(c)

    const hr = findHeaderRow(sheet)
    if (hr === null) continue
    const stack = headerStack(sheet, hr, lastHeaderCol(sheet, hr))
    if (stack.length) ivHeaders.add(stack[stack.length - 1])
  }
  for (const h of ivHeaders) columns.delete(h)

  warnings.unshift(
    `취합파일이 없어 팀 회신 파일 ${sheets.length}개에서 지원자 정보를 읽었습니다 (${rows.size}명)`
  )
  return { rows, columns, header_row: 0, warnings }
}
