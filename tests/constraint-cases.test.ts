/* 제약사항 케이스 회귀 — `data/constraint-tests/` 의 엑셀을 실제 파이프라인에 그대로 태운다.

   케이스 파일은 `node scripts/make-constraint-cases.mjs` 가 만든다.
   기대값의 근거와 읽는 법은 `docs/제약사항_정리.md` 에 있다. 여기가 그 문서의 계측기다 —
   문서에 적힌 수치가 실제와 어긋나면 이 파일이 먼저 깨져야 한다.

   화면(`src/lite/data.ts` buildSchedule)과 같은 순서로 돈다:
     parseMaster → parseTeam → resolve → Sched.schedule → arrange → validate */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseMaster, parseTeam } from '@/core/ingest'
import { resolve } from '@/core/resolve'
import { Sched, type Cfg, type Placed } from '@/core/schedule'
import { arrange, withPlaced } from '@/lite/arrange'
import { readSheet } from '@/io/xlsx'

const ROOT = path.resolve(import.meta.dirname, '..')
const CASES = path.join(ROOT, 'data/constraint-tests')
const has = fs.existsSync(CASES)

const sheetOf = async (file: string) =>
  readSheet(fs.readFileSync(file).buffer as ArrayBuffer, path.basename(file))

/** 화면과 같은 기본값 — DEFAULT_SETUP 의 슬롯 설정(8세션 · 4조 · 오전 4) */
const BASE = { sessions: 8, rooms: 4, amSessions: 4 } as const

async function run(name: string, over: Partial<Cfg> = {}, contiguous = true) {
  const dir = path.join(CASES, name)
  const master = parseMaster(await sheetOf(path.join(dir, '취합파일.xlsx')))
  const teams = []
  for (const f of fs.readdirSync(dir).filter(x => x.startsWith('희망지원자')).sort()) {
    const { parsed, warnings } = parseTeam(await sheetOf(path.join(dir, f)), master.columns)
    if (parsed) teams.push({ file: f, parsed, warnings })
  }
  const payload = resolve({ master, teams })
  const raw = Sched.schedule(payload.apps, { ...Sched.DEFAULT_CFG, ...BASE, ...over })
  const tidy = arrange(raw, { contiguous })
  const result = withPlaced(raw, tidy.placed)
  return { payload, result, tidy, V: Sched.validate(result) }
}

/** 학력별 전역 세션 구간 — ① 이 지켜졌으면 구간끼리 겹치지 않는다 */
function spans(placed: readonly Placed[], sessions: number) {
  const out: Record<string, [number, number]> = {}
  for (const p of placed) {
    const g = p.day * sessions + p.slot
    const v = out[p.edu]
    out[p.edu] = v ? [Math.min(v[0], g), Math.max(v[1], g)] : [g, g]
  }
  return out
}

/** (날짜·세션) 한 칸에 같은 팀/같은 면접관이 둘 이상 있나 */
function doubled(placed: readonly Placed[], key: (p: Placed) => readonly string[]) {
  const seen = new Map<string, number>()
  for (const p of placed) for (const k of key(p)) {
    const id = `${p.day}|${p.slot}|${k}`
    seen.set(id, (seen.get(id) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
}

describe.skipIf(!has)('제약사항 케이스', () => {
  /* ── 하드 ────────────────────────────────────────────────── */

  it('C1 ① 학력 분리 — 학사·석사·박사 구간이 시간축에서 안 겹친다', async () => {
    const r = await run('C1_학력분리_하드')
    expect(r.result.placed).toHaveLength(12)
    expect(r.V.r1).toHaveLength(0)

    const s = spans(r.result.placed, r.result.cfg.sessions)
    expect(s.학사[1]).toBeLessThan(s.석사[0])
    expect(s.석사[1]).toBeLessThan(s.박사[0])
  })

  it('C1 ① 끄면(separateEdu:false) 같은 세션에 학력이 섞인다', async () => {
    const off = await run('C1_학력분리_하드', { separateEdu: false })
    expect(off.V.r1.length).toBeGreaterThan(0)
  })

  it('C1 ① 날짜 분리(eduBoundary:day)는 학력마다 날을 따로 쓴다', async () => {
    const day = await run('C1_학력분리_하드', { eduBoundary: 'day' })
    expect(day.V.r1).toHaveLength(0)
    expect(day.result.totalDays).toBe(3)              // 학사 · 석사 · 박사 하루씩
  })

  it('C2 ② 팀 중복 — 한 팀 10명은 하루 8세션 상한에 걸려 이틀로 갈린다', async () => {
    const r = await run('C2_팀중복_하드')
    expect(doubled(r.result.placed, p => p.teams)).toEqual([])
    expect(r.V.r2).toHaveLength(0)
    expect(r.result.totalDays).toBe(2)
    expect(Sched.minDays(r.payload.apps, BASE)).toMatchObject({ days: 2, requests: 10, sessions: 8 })
  })

  it('C3 ② 면접관 중복 — 팀이 달라도 같은 면접관은 같은 시간대에 못 앉는다', async () => {
    const r = await run('C3_면접관중복_하드')
    expect(doubled(r.result.placed, p => p.interviewers)).toEqual([])
    expect(r.V.r2).toHaveLength(0)
    expect(r.result.totalDays).toBe(2)                // 10명 ÷ 면접관 1명 = 8세션 초과
  })

  it('C3 ② 검사를 끄면(checkInterviewer:false) 한 사람이 두 방에 동시에 들어간다', async () => {
    const off = await run('C3_면접관중복_하드', { checkInterviewer: false })
    expect(off.result.totalDays).toBe(1)              // 하루로 줄지만
    expect(off.V.r2).toHaveLength(5)                  // 다섯 세션에서 면접관이 겹친다
    expect(off.V.r2.every(v => v.detail.includes('한지호'))).toBe(true)
  })

  it('C4 합동면접 — 요청 11건이 지원자 8명으로 합쳐지고 1회만 배치된다', async () => {
    const r = await run('C4_합동면접_하드')
    expect(r.payload.meta.requests_total).toBe(11)
    expect(r.payload.apps).toHaveLength(8)
    expect(r.result.placed).toHaveLength(8)

    const three = r.payload.apps.find(a => a.teams.length === 3)!
    expect(three.interviewers).toHaveLength(3)

    // 합동 지원자의 시간대는 관련 팀 전부가 점유한 것으로 잡힌다
    expect(doubled(r.result.placed, p => p.teams)).toEqual([])
    expect(r.V.r2).toHaveLength(0)
  })

  it('C8 대상 선별 — 제외 사유 세 가지가 각각 한 건씩 잡힌다', async () => {
    const r = await run('C8_대상선별_제외규칙')
    expect(r.payload.meta.requests_total).toBe(10)
    expect(r.payload.apps).toHaveLength(5)
    expect(r.payload.excluded.map(e => e.reason).sort()).toEqual(
      ['마스터 미존재', '면접관 미매칭', '학력 구분 불명(과정4)'])

    // 일부 팀만 면접관을 안 적었으면 지원자는 살고 그 팀 요청만 버려진다
    const partial = r.payload.apps.find(a => a.dropped_teams?.length)!
    expect(partial.teams).toEqual(['나래솔루션팀'])
    expect(partial.dropped_teams).toEqual(['가온기술팀'])
  })

  it('C9 파일 서식 — 네 파일이 각각 다른 경고를 낸다', async () => {
    const dir = path.join(CASES, 'C9_파일서식_경고')
    const master = parseMaster(await sheetOf(path.join(dir, '취합파일.xlsx')))
    const of = async (team: string) =>
      parseTeam(await sheetOf(path.join(dir, `희망지원자_${team}_re.xlsx`)), master.columns)

    const a = await of('가온기술팀')                     // 헤더 행이 5행
    expect(a.parsed!.header_row).toBe(5)
    expect(a.warnings).toContain('헤더 행이 표준(4행)과 다름 → 5행')

    const b = await of('나래솔루션팀')                   // 헤더명이 '인원' — 마지막 열 규칙으로 찾는다
    expect(b.parsed!.iheader).toBe('인원')
    expect(b.parsed!.how).toBe('position')
    expect(b.warnings).toContain('면접관 컬럼명이 비표준 → "인원"')

    const c = await of('다솜생산팀')                     // 값이 사람 이름 모양이 아니다
    expect(c.warnings.some(w => w.includes('값 패턴으로 추정'))).toBe(true)

    const d = await of('라온품질팀')                     // 면접관 열이 없다 → 이 팀 요청은 전부 버려진다
    expect(d.parsed!.icol).toBeNull()
    expect(d.warnings).toContain('면접관 컬럼을 찾지 못함')

    const r = await run('C9_파일서식_경고')
    expect(r.payload.apps).toHaveLength(9)
    expect(r.payload.excluded).toHaveLength(3)
    expect(r.payload.excluded.every(e => e.reason === '면접관 미매칭')).toBe(true)
  })

  /* ── 소프트 ──────────────────────────────────────────────── */

  it('C5 ③ 연속 배치 — 정리 패스가 팀 덩어리와 면접관 쪼갬을 줄인다', async () => {
    const on = await run('C5_연속배치_소프트', {}, true)
    expect(on.tidy.before.teamBlocks).toBe(13)
    expect(on.tidy.after.teamBlocks).toBe(10)
    expect(on.tidy.before.ivSplit).toBe(4)
    expect(on.tidy.after.ivSplit).toBe(2)
    expect(on.V.r3).toHaveLength(0)

    // 정리를 끄면 엔진이 놓은 그대로 — 개선분이 없다
    const off = await run('C5_연속배치_소프트', {}, false)
    expect(off.tidy.moves).toBe(0)
    expect(off.tidy.after.teamBlocks).toBe(13)

    // 하드 제약은 정리 뒤에도 그대로 0 이어야 한다 — 이것이 정리의 전제다
    expect(on.V.r1).toHaveLength(0)
    expect(on.V.r2).toHaveLength(0)
  })

  it('C6 ④ 첫 타임 — off → soft → hard 로 갈수록 위반이 줄고 공석이 는다', async () => {
    const off = await run('C6_첫타임_소프트', { avoidFirstSlot: 'off' })
    const soft = await run('C6_첫타임_소프트', { avoidFirstSlot: 'soft' })
    const hard = await run('C6_첫타임_소프트', { avoidFirstSlot: 'hard' }, false)

    expect(off.V.r4).toHaveLength(5)
    expect(soft.V.r4).toHaveLength(4)
    expect(hard.V.r4).toHaveLength(0)

    // hard 는 「첫 타임을 비워서라도 지킨다」 — 자리가 모자라면 미배정이 생긴다
    expect(hard.result.totalDays).toBe(2)
    expect(hard.result.unplaced).toHaveLength(1)
  })

  it('C6 ④ 는 정리 패스가 지켜 주지 않는다 — arrange 는 ①② 만 보존한다', async () => {
    const hard = await run('C6_첫타임_소프트', { avoidFirstSlot: 'hard' }, true)
    expect(hard.tidy.moves).toBeGreaterThan(0)
    expect(hard.V.r4.length).toBeGreaterThan(0)       // 정리가 첫 타임으로 다시 끌어온다
    expect(hard.V.r1).toHaveLength(0)                 // 하드는 그대로 지킨다
    expect(hard.V.r2).toHaveLength(0)
  })

  it('C7 ⑤ 병목 팀 선배치 — 하루 상한을 넘는 팀이 1일차를 꽉 채운다', async () => {
    for (const rooms of [3, 4]) {
      const r = await run('C7_병목팀선배치_소프트', { rooms })
      const day1 = r.result.placed.filter(p => p.day === 0 && p.team === '가온기술팀')
      expect(day1).toHaveLength(8)                    // 1일차 8세션 = 하루 상한
      expect(new Set(day1.map(p => p.room)).size).toBe(1)   // 한 조에 이어 앉는다
      expect(r.result.totalDays).toBe(2)
      expect(r.V.r1).toHaveLength(0)
      expect(r.V.r2).toHaveLength(0)
    }
  })
})
