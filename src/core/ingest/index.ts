/* ① ingest — 엑셀 → 행 목록 */
export { KEY, STD, STD_HEADER_ROW, columnMap, findHeaderRow, headerStack, lastHeaderCol } from './headers'
export { findInterviewerCol, looksLikeName, type InterviewerCol } from './interviewer'
export { mergeAsMaster, parseMaster, type MasterRow, type ParsedMaster } from './parseMaster'
export { parseTeam } from './parseTeam'
export { cellOf, textOf, type Cell, type ParsedTeam, type ParseResult, type Sheet, type TeamRow } from './types'
