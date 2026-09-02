/* 취합파일 없이 — 팀 회신 파일만으로 편성할 수 있는가.

   회신 파일은 취합파일에서 뽑아 만든 것이라 지원자 컬럼(번호·성명·학력)을 그대로 이고 있다.
   그래서 마스터 없이도 조인에 필요한 것이 다 있다. 팀 회신이 먼저 오고 취합파일이 늦게 오는
   것이 실무 순서이므로, 그동안 화면이 비어 있을 이유가 없다.

   기준값: tests/golden/payload.json — **취합파일을 넣었을 때와 같은 결과가 나와야** 한다.
   같지 않으면 이 경로는 편의가 아니라 위험이다. */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mergeAsMaster, parseMaster, parseTeam } from '..'
import { resolve, MASTER_FILE, type TeamInput } from '@/core/resolve'
import { readSheet } from '@/io/xlsx'
import type { Payload } from '@/core/schedule'

const ROOT = path.resolve(import.meta.dirname, '../../../../..')
const GOLDEN = path.join(ROOT, 'tests/golden/payload.json')
const DATA = path.join(ROOT, 'data')
const has = fs.existsSync(GOLDEN) && fs.existsSync(DATA)

const sheetOf = async (file: string) =>
  readSheet(fs.readFileSync(path.join(DATA, file)).buffer as ArrayBuffer, file)

const teamFiles = () =>
  has
    ? fs.readdirSync(DATA).map(n => n.normalize('NFC'))
        .filter(n => /^희망지원자_.+\.xlsx$/.test(n) && !n.startsWith('~$')).sort()
    : []

/** 취합파일을 빼고 파이프라인을 돌린다 — io/dataset 의 마스터 없는 경로와 같은 순서다 */
async function withoutMaster(): Promise<Payload> {
  const sheets = []
  for (const f of teamFiles()) sheets.push({ file: f, sheet: await sheetOf(f) })
  const master = mergeAsMaster(sheets.map(s => s.sheet))
  const teams: TeamInput[] = []
  for (const { file, sheet } of sheets) {
    const { parsed, warnings } = parseTeam(sheet, master.columns)
    if (parsed) teams.push({ file, parsed, warnings })
  }
  return resolve({ master, teams })
}

async function withMaster(): Promise<Payload> {
  const master = parseMaster(await sheetOf(MASTER_FILE))
  const teams: TeamInput[] = []
  for (const f of teamFiles()) {
    const { parsed, warnings } = parseTeam(await sheetOf(f), master.columns)
    if (parsed) teams.push({ file: f, parsed, warnings })
  }
  return resolve({ master, teams })
}

describe.skipIf(!has)('취합파일 없이 팀 회신만으로', () => {
  it('편성 대상이 취합파일을 넣었을 때와 똑같다', async () => {
    const got = await withoutMaster()
    const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as Payload

    const key = (a: Payload['apps'][number]) =>
      `${a.id}|${a.edu}|${a.teams.join(',')}|${a.interviewers.join(',')}`
    expect(got.apps.map(key)).toEqual(gold.apps.map(key))
    expect(got.meta.requests_total).toBe(gold.meta.requests_total)
    expect(got.meta.requests_matched).toBe(gold.meta.requests_matched)
    expect(got.excluded.length).toBe(gold.excluded.length)
  })

  it('면접관 컬럼을 표준 컬럼으로 오인하지 않는다', async () => {
    /* 회신 파일 자체를 마스터로 삼으면 면접관 헤더까지 '마스터 컬럼' 집합에 들어간다.
       그대로 두면 findInterviewerCol 이 그 열을 버려 전원이 '면접관 미매칭' 이 된다 —
       mergeAsMaster 가 마지막 열 헤더를 빼는 이유가 이것이다. */
    const sheets = []
    for (const f of teamFiles()) sheets.push(await sheetOf(f))
    const master = mergeAsMaster(sheets)

    for (const h of ['면접관', '팀 면접관', '면접관 성명', '인원']) expect(master.columns.has(h)).toBe(false)
    expect(master.columns.has('한글성명')).toBe(true)
    expect(master.columns.has('최종학력_학교유형')).toBe(true)

    const got = await withoutMaster()
    expect(got.apps.every(a => a.interviewers.length > 0)).toBe(true)
  })

  it('어디서 지원자 정보를 읽었는지 경고로 남긴다', async () => {
    const got = await withoutMaster()
    expect(got.meta.warnings.some(w => w.includes('취합파일이 없어'))).toBe(true)
  })

  it('취합파일이 있으면 그쪽이 이긴다 — attrs 가 마스터 전 컬럼이다', async () => {
    const a = await withMaster()
    const b = await withoutMaster()
    expect(Object.keys(a.apps[0].attrs ?? {}).length).toBeGreaterThan(0)
    expect(b.apps[0].id).toBe(a.apps[0].id)
  })
})
