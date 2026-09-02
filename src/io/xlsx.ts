/* 부수효과 계층 — 엑셀 바이트를 core/ingest 가 아는 Sheet 로 바꾼다.
   ExcelJS 를 아는 곳은 이 파일뿐이다. 엑셀 라이브러리를 갈아끼워도 core 는 그대로다.

   openpyxl 의 load_workbook(data_only=True) 와 같은 값을 내는 것이 목표다:
   수식은 캐시된 결과로, 날짜는 'YYYY-MM-DD' 문자열로. */
import type ExcelJS from 'exceljs'
import type { Cell, Sheet } from '@/core/ingest'

/* ExcelJS 는 무겁다(번들의 대부분). 엑셀을 실제로 읽을 때만 내려받게 미룬다 —
   신청 포털 경로만 쓰는 담당자는 이 코드를 아예 받지 않는다. */
let lib: Promise<typeof ExcelJS> | null = null
const excel = () => (lib ??= import('exceljs').then(m => m.default))

/** 엑셀 날짜는 UTC 자정으로 들어온다 — 로컬 시간대로 변환하면 하루가 밀린다 */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** ExcelJS 의 셀 값을 openpyxl(data_only=True) 과 같은 모양으로 정규화한다 */
function normalize(v: unknown): Cell {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return ymd(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return normalize(o.result)                       // 수식 → 캐시된 결과
    if ('richText' in o) return (o.richText as { text: string }[]).map(t => t.text).join('')
    if ('text' in o) return String(o.text)                              // 하이퍼링크
    if ('error' in o) return null                                       // #N/A 등
    if ('sharedFormula' in o) return null
    return null
  }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return null
}

function toSheet(ws: ExcelJS.Worksheet, name: string): Sheet {
  const rowCount = ws.rowCount
  const columnCount = ws.columnCount
  const grid: Cell[][] = []
  for (let r = 1; r <= rowCount; r++) {
    const row: Cell[] = new Array(columnCount).fill(null)
    for (let c = 1; c <= columnCount; c++) row[c - 1] = normalize(ws.getCell(r, c).value)
    grid.push(row)
  }
  return { name, grid, rowCount, columnCount }
}

/** 엑셀 바이트 → 첫 번째 시트. 화면의 파일 입력·드래그앤드롭이 주는 ArrayBuffer 를 받는다. */
export async function readSheet(buffer: ArrayBuffer, name: string): Promise<Sheet> {
  const wb = new (await excel()).Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error(`${name}: 시트가 없습니다`)
  return toSheet(ws, name)
}

/** 브라우저 File → Sheet */
export async function readFileAsSheet(file: File): Promise<Sheet> {
  return readSheet(await file.arrayBuffer(), file.name)
}
