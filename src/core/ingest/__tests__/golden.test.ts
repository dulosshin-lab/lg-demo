/* ① ingest 골든 대조 — TS 파서가 Python 파서(server/parse_val.py)와 같은 결과를 내는가.
   기준값은 tests/golden/parse.json 이며 아래 명령으로 다시 만든다:

     python - <<'PY'  ... (README 개발자용 절 참조)

   대조 대상은 20개 실 파일(data/ 8 + data/demo-archive/ 12) 전부다.
   컬럼 수가 22 · 49 · 52 · 55 로 갈리고 면접관 헤더가 4종이라 회귀 가치가 크다. */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { KEY, parseMaster, parseTeam } from '..'
import { readSheet } from '@/io/xlsx'

const ROOT = path.resolve(import.meta.dirname, '../../../../..')
const GOLDEN = path.join(ROOT, 'tests/golden/parse.json')

interface Golden {
  master: { header_row: number; columns: string[]; rows: number }
  teams: Record<string, {
    header_row: number; icol: number | null; iheader: string | null
    how: string | null; cols: number; n: number
    iv: Record<string, string | null>
    warnings: string[]
  }>
}

const has = fs.existsSync(GOLDEN)
const golden: Golden | null = has ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : null

const sheetOf = async (rel: string) =>
  readSheet(fs.readFileSync(path.join(ROOT, rel)).buffer as ArrayBuffer, path.basename(rel))

describe.skipIf(!has)('ingest 골든 대조', () => {
  it('마스터 — 헤더 행 · 컬럼 집합 · 행 수가 일치한다', async () => {
    const m = parseMaster(await sheetOf('data/취합파일.xlsx'))
    expect(m.header_row).toBe(golden!.master.header_row)
    expect(m.rows.size).toBe(golden!.master.rows)
    expect([...m.columns].sort()).toEqual(golden!.master.columns)
  })

  it.for(Object.keys(golden?.teams ?? {}))('%s — 면접관 컬럼과 명단이 일치한다', async rel => {
    const g = golden!.teams[rel]
    const master = parseMaster(await sheetOf('data/취합파일.xlsx'))
    const { parsed } = parseTeam(await sheetOf(rel), master.columns)

    expect(parsed).not.toBeNull()
    expect(parsed!.header_row).toBe(g.header_row)
    expect(parsed!.cols).toBe(g.cols)
    expect(parsed!.icol).toBe(g.icol)
    expect(parsed!.iheader).toBe(g.iheader)
    expect(parsed!.rows.length).toBe(g.n)

    // 본체 — 지원자번호별 면접관이 한 명도 어긋나면 안 된다
    const got: Record<string, unknown> = {}
    for (const r of parsed!.rows) got[String(r[KEY])] = r.면접관 ?? null
    expect(got).toEqual(g.iv)
  })
})
