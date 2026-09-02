/* 편성표 내보내기.

   미팅의 페인포인트는 「v1~v4 가 메일로 오고 간사는 v4 만 본다 — 뭐가 바뀌었는지 모른다」였다.
   그래서 편성표 한 장만 내보내지 않고 **무엇이 달라졌는지**를 같은 파일에 붙인다.

   시트 셋:
     편성표    — 일자·시간·조 격자를 행으로 편 것
     변경 요약 — 1차 편성 대비 이동·교환·취소·추가. 이력이 곧 이 시트다.
     확인 목록 — 어긋난 곳과 담당자가 예외로 표시한 것

   ExcelJS 는 무거워서 io/xlsx.ts 와 같은 방식으로 쓸 때만 내려받는다. */
import type { Result } from '@/core/schedule'
import type { EditState } from './edit'
import { eventText } from './edit'
import { RULE_LABEL, type Judgement } from './violations'

const excel = () => import('exceljs').then(m => m.default)

const spotText = (r: Result, s: { day: number; slot: number; room: number }) =>
  `${r.dates[s.day]?.label ?? `${s.day + 1}일차`} ${r.times[s.slot]?.label ?? `${s.slot + 1}세션`} ${s.room + 1}조`

/** 셀 안에서 여러 값을 잇는 구분자 — 기존 산출물 규칙대로 쉼표를 쓴다 */
const join = (xs: readonly string[]) => xs.join(', ')

export function buildRows(base: Result, state: EditState) {
  const sorted = [...state.placed].sort((a, b) => a.day - b.day || a.slot - b.slot || a.room - b.room)
  return sorted.map(p => ({
    일자: base.dates[p.day]?.label ?? `${p.day + 1}일차`,
    시간: base.times[p.slot]?.label ?? `${p.slot + 1}세션`,
    조: `${p.room + 1}조`,
    지원자: p.app.name,
    학력: p.edu,
    팀: join(p.teams),
    면접관: join(p.interviewers),
  }))
}

export function buildChanges(base: Result, state: EditState) {
  return state.events.map(e => ({
    순번: e.seq,
    시각: e.ts,
    담당자: e.actorName,
    구분: { move: '이동', swap: '교환', remove: '배정 취소', place: '배정', ack: '예외 표시', unack: '예외 해제' }[e.op],
    지원자: e.appName || '—',
    이전: e.from ? spotText(base, e.from) : '—',
    이후: e.to ? spotText(base, e.to) : '—',
    내용: eventText(e),
    사유: e.reason ?? '',
  }))
}

export function buildFindings(verdict: Judgement, acks: Readonly<Record<string, string>>) {
  return verdict.findings.map(f => ({
    구분: RULE_LABEL[f.rule],
    상태: f.key in acks ? '예외로 표시함' : '확인 필요',
    내용: f.detail,
    사유: acks[f.key] ?? '',
  }))
}

const sheetFrom = (ws: { columns: unknown; addRow: (r: unknown) => unknown; getRow: (n: number) => { font: unknown } },
                   rows: readonly Record<string, string | number>[]) => {
  if (!rows.length) return
  const keys = Object.keys(rows[0])
  ws.columns = keys.map(k => ({ header: k, key: k, width: Math.max(10, Math.min(42, k.length * 2 + 8)) }))
  for (const r of rows) ws.addRow(r)
  ws.getRow(1).font = { bold: true }
}

/* ---------- CSV ---------- */

/** 엑셀이 UTF-8 로 읽게 BOM 을 붙인다 — 없으면 한글이 깨진 채 열린다 */
const BOM = '\ufeff'

/** RFC 4180 — 쉼표·따옴표·줄바꿈이 있으면 감싸고 따옴표는 겹친다 */
const csvCell = (v: string | number): string => {
  const t = String(v ?? '')
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

export function toCsv(rows: readonly Record<string, string | number>[], emptyNote: string): string {
  if (!rows.length) return BOM + emptyNote + '\r\n'
  const keys = Object.keys(rows[0])
  const lines = [keys.map(csvCell).join(','), ...rows.map(r => keys.map(k => csvCell(r[k])).join(','))]
  return BOM + lines.join('\r\n') + '\r\n'
}

/** 파일 이름 — 언제 내보낸 것인지 한눈에 */
export function fileNameOf(at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `면접편성_${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}.xlsx`
}

export async function buildWorkbookBlob(base: Result, state: EditState, verdict: Judgement): Promise<Blob> {
  const ExcelJS = await excel()
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()

  sheetFrom(wb.addWorksheet('편성표') as never, buildRows(base, state))

  const changes = buildChanges(base, state)
  const ws = wb.addWorksheet('변경 요약')
  if (changes.length) sheetFrom(ws as never, changes)
  else ws.addRow(['1차 편성 이후 고친 것이 없습니다.'])

  const findings = buildFindings(verdict, state.acks)
  const wf = wb.addWorksheet('확인 목록')
  if (findings.length) sheetFrom(wf as never, findings)
  else wf.addRow(['어긋난 곳이 없습니다.'])

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function download(blob: Blob, name: string): string {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}

export async function exportSchedule(base: Result, state: EditState, verdict: Judgement): Promise<string> {
  return download(await buildWorkbookBlob(base, state, verdict), fileNameOf())
}

/** 편성표만 CSV 로. 다른 도구에 붙여 넣거나 메일에 싣기 좋은 형태다. */
export function exportCsv(base: Result, state: EditState): string {
  const text = toCsv(buildRows(base, state), '배정된 면접이 없습니다.')
  return download(new Blob([text], { type: 'text/csv;charset=utf-8' }), fileNameOf().replace(/\.xlsx$/, '.csv'))
}

/** 변경 요약만 CSV 로 — 「무엇이 바뀌었나」만 팀에 돌릴 때 */
export function exportChangesCsv(base: Result, state: EditState): string {
  const text = toCsv(buildChanges(base, state), '1차 편성 이후 고친 것이 없습니다.')
  return download(new Blob([text], { type: 'text/csv;charset=utf-8' }), fileNameOf().replace(/\.xlsx$/, '_변경요약.csv'))
}
