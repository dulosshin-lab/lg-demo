/* ②③ resolve 골든 대조 — 이 프로젝트의 핵심 게이트.
   TS 파이프라인(ingest → resolve)이 Python(server/build_apps.py build())과
   **완전히 같은 Payload** 를 내는지 본다. 정렬 순서와 attrs 까지 포함한다.

   기준값: tests/golden/payload.json (parsed_at 은 실행 시각이라 빠져 있다) */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseMaster, parseTeam } from '@/core/ingest'
import { MASTER_FILE, resolve, type TeamInput } from '..'
import { readSheet } from '@/io/xlsx'
import type { Payload } from '@/core/schedule'

const ROOT = path.resolve(import.meta.dirname, '../../../../..')
const GOLDEN = path.join(ROOT, 'tests/golden/payload.json')
const DATA = path.join(ROOT, 'data')

const has = fs.existsSync(GOLDEN)

const sheetOf = async (abs: string) =>
  readSheet(fs.readFileSync(abs).buffer as ArrayBuffer, path.basename(abs))

/** data/ 폴더 전체를 파이프라인에 태운다 — 화면이 하는 일과 같은 순서다 */
async function runPipeline(): Promise<Payload> {
  const names = fs.readdirSync(DATA)
    .map(n => n.normalize('NFC'))
    .filter(n => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$'))

  const master = parseMaster(await sheetOf(path.join(DATA, MASTER_FILE)))

  const teams: TeamInput[] = []
  for (const file of names.filter(n => /^희망지원자_.+\.xlsx$/.test(n)).sort()) {
    const { parsed, warnings } = parseTeam(await sheetOf(path.join(DATA, file)), master.columns)
    if (parsed) teams.push({ file, parsed, warnings })
  }
  return resolve({ master, teams })
}

describe.skipIf(!has)('resolve 골든 대조', () => {
  it('Payload 가 Python 출력과 완전히 일치한다', async () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as Payload
    const got = await runPipeline()

    /* parsed_at 은 실행 시각, warnings 는 아래에서 따로 본다
       (면접관 컬럼 규칙을 바꾸면서 경고 한 줄이 의도적으로 줄었다) */
    const strip = (p: Payload) => {
      const { parsed_at: _t, warnings: _w, ...meta } = p.meta
      return meta
    }

    // 실패 시 어디가 다른지 보이도록 좁은 것부터 본다
    expect(strip(got)).toEqual(strip(golden))
    expect(got.apps.map(a => a.id)).toEqual(golden.apps.map(a => a.id))
    expect(got.excluded).toEqual(golden.excluded)
    expect(got.apps).toEqual(golden.apps)
  })

  it('경고는 한 줄만 의도적으로 줄어든다 — 나머지는 그대로', async () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as Payload
    const got = await runPipeline()

    /* 옛 파서는 헤더에 '면접관' 이 없기만 하면 '값 패턴으로 추정' 경고를 냈다.
       새 규칙은 마지막 열을 규칙으로 고르므로, 값까지 수상할 때만 그 경고를 낸다.
       로봇응용기술팀('인원')은 값이 실제 사람 이름이라 확인이 필요 없다 —
       그래서 이 경고 한 줄이 사라지는 것이 이번 변경의 의도다. */
    const dropped = golden.meta.warnings.filter(w => w.includes('값 패턴으로 추정'))
    expect(dropped).toEqual(['[로봇응용기술팀] 면접관 컬럼을 값 패턴으로 추정 (헤더 "인원")'])

    expect(got.meta.warnings).toEqual(golden.meta.warnings.filter(w => !w.includes('값 패턴으로 추정')))
    // 새 파이프라인은 확인 배너를 띄우지 않는다 (띄울 이유가 없다)
    expect(got.meta.warnings.some(w => w.includes('값 패턴으로 추정'))).toBe(false)
  })

  it('README 기대값 — 요청 109건 → 매칭 69건 · 대상 60명 · 제외 23명', async () => {
    const p = await runPipeline()
    expect(p.meta.requests_total).toBe(109)
    expect(p.meta.requests_matched).toBe(69)
    expect(p.apps.length).toBe(60)
    expect(p.excluded.length).toBe(23)
    expect(p.meta.files).toBe(8)
  })
})
