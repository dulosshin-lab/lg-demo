/* 편성 결과 정리 — 실제 엑셀로 만든 편성표 위에서 확인한다.

   여기서 지켜야 할 것은 「좋아졌나」보다 「망가뜨리지 않았나」다. 정리는 담당자가 보기 전의
   결과를 말없이 바꾸는 일이라, 하드 제약이나 학력 구간이 한 건이라도 새로 깨지면 정리가
   아니라 조용한 재편성이 된다. */
import { readFile, readdir } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseMaster, parseTeam } from '@/core/ingest'
import { resolve as resolveApps } from '@/core/resolve'
import { Sched, type Applicant, type Result } from '@/core/schedule'
import { readSheet } from '@/io/xlsx'
import { arrange, metricsOf, withPlaced } from './arrange'

const DIR = 'data'
const sheetOf = async (name: string) => {
  const b = await readFile(`${DIR}/${name}`)
  return readSheet(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name)
}

let apps: Applicant[]
let raw: Result

beforeAll(async () => {
  const master = parseMaster(await sheetOf('취합파일.xlsx'))
  const names = (await readdir(DIR)).filter(f => f.startsWith('희망지원자'))
  const teams = []
  for (const f of names) {
    const { parsed, warnings } = parseTeam(await sheetOf(f), master.columns)
    if (parsed) teams.push({ file: f, parsed, warnings })
  }
  apps = resolveApps({ master, teams, failed: [] }).apps
  raw = Sched.schedule(apps, { ...Sched.DEFAULT_CFG, rooms: 4, days: 0, sessions: 8, amSessions: 4 })
}, 60_000)

/** 학력별 전역 세션 구간 */
const spans = (r: { placed: readonly { edu: string; day: number; slot: number }[] }, S: number) => {
  const out: Record<string, { min: number; max: number }> = {}
  for (const p of r.placed) {
    const g = p.day * S + p.slot
    const v = out[p.edu] ?? (out[p.edu] = { min: g, max: g })
    v.min = Math.min(v.min, g)
    v.max = Math.max(v.max, g)
  }
  return out
}

describe('망가뜨리지 않는다', () => {
  it('인원이 그대로다 — 한 명도 잃지 않고 겹쳐 앉히지도 않는다', () => {
    const { placed } = arrange(raw)
    expect(placed).toHaveLength(raw.placed.length)
    expect(new Set(placed.map(p => p.app.id)).size).toBe(raw.placed.length)
    // 한 칸에 두 명이 앉으면 안 된다
    expect(new Set(placed.map(p => `${p.day}|${p.slot}|${p.room}`)).size).toBe(placed.length)
  })

  it('하드 제약 ①② 를 새로 만들지 않는다', () => {
    const V0 = Sched.validate(raw)
    const V1 = Sched.validate(withPlaced(raw, arrange(raw).placed))
    expect(V0.r1).toHaveLength(0)
    expect(V0.r2).toHaveLength(0)
    expect(V1.r1).toHaveLength(0)
    expect(V1.r2).toHaveLength(0)
  })

  it('학력 구간 밖으로 내보내지 않는다 — 학사 사이에 석사가 끼면 안 된다', () => {
    const S = raw.cfg.sessions
    const base = spans(raw, S)
    const { placed } = arrange(raw)
    for (const p of placed) {
      const g = p.day * S + p.slot
      expect(g).toBeGreaterThanOrEqual(base[p.edu].min)
      expect(g).toBeLessThanOrEqual(base[p.edu].max)
    }
    // 구간끼리 여전히 겹치지 않는다
    const after = Object.values(spans({ placed }, S)).sort((a, b) => a.min - b.min)
    for (let i = 1; i < after.length; i++) expect(after[i].min).toBeGreaterThan(after[i - 1].max)
  })

  it('날짜가 늘지 않는다 — 3일이 4일이 되면 통보가 달라진다', () => {
    const { placed } = arrange(raw)
    expect(Math.max(...placed.map(p => p.day))).toBe(Math.max(...raw.placed.map(p => p.day)))
  })

  it('확정(pinned)된 사람은 건드리지 않는다', () => {
    const pinnedIds = raw.placed.slice(0, 5).map(p => p.app.id)
    const withPins = {
      ...raw,
      placed: raw.placed.map(p => (pinnedIds.includes(p.app.id) ? { ...p, pinned: true } : { ...p })),
    }
    const { placed } = arrange(withPins)
    for (const id of pinnedIds) {
      const was = raw.placed.find(p => p.app.id === id)!
      const now = placed.find(p => p.app.id === id)!
      expect({ day: now.day, slot: now.slot, room: now.room })
        .toEqual({ day: was.day, slot: was.slot, room: was.room })
    }
  })

  it('원본을 건드리지 않는다', () => {
    const snapshot = raw.placed.map(p => `${p.app.id}|${p.day}|${p.slot}|${p.room}`).join(',')
    arrange(raw)
    expect(raw.placed.map(p => `${p.app.id}|${p.day}|${p.slot}|${p.room}`).join(',')).toBe(snapshot)
  })

  it('같은 입력이면 같은 결과다 — 돌릴 때마다 편성표가 달라지면 안 된다', () => {
    const a = arrange(raw).placed.map(p => `${p.app.id}|${p.day}|${p.slot}|${p.room}`).join(',')
    const b = arrange(raw).placed.map(p => `${p.app.id}|${p.day}|${p.slot}|${p.room}`).join(',')
    expect(a).toBe(b)
  })
})

describe('실제로 붙는다', () => {
  it('팀 덩어리와 면접관 재입장이 줄어든다', () => {
    const r = arrange(raw)
    expect(r.after.teamBlocks).toBeLessThan(r.before.teamBlocks)
    expect(r.after.ivSplit).toBeLessThan(r.before.ivSplit)
    expect(r.moves).toBeGreaterThan(0)
  })

  it('엔진이 세는 ③ 연속 끊김도 함께 줄어든다', () => {
    const before = Sched.validate(raw).r3.length
    const after = Sched.validate(withPlaced(raw, arrange(raw).placed)).r3.length
    expect(after).toBeLessThan(before)
  })

  it('1초 안에 끝난다 — 요구치는 1차 편성 전체가 1초다', () => {
    expect(arrange(raw).ms).toBeLessThan(1000)
  })

  it('끄면 아무것도 안 옮긴다', () => {
    const r = arrange(raw, { contiguous: false })
    expect(r.moves).toBe(0)
    expect(r.placed.map(p => `${p.day}|${p.slot}|${p.room}`))
      .toEqual(raw.placed.map(p => `${p.day}|${p.slot}|${p.room}`))
  })

  it('시간 예산을 넘기면 그때까지의 개선분만 쓴다', () => {
    const r = arrange(raw, { budgetMs: 0 })
    expect(r.placed).toHaveLength(raw.placed.length)
    expect(Sched.validate(withPlaced(raw, r.placed)).r2).toHaveLength(0)
  })
})

describe('지표', () => {
  it('덩어리와 빈 칸을 격자대로 센다', () => {
    const iv = (n: string) => [n]
    const one = (day: number, slot: number, room: number, team: string, name: string) => ({
      app: { id: slot * 10 + room, name: '' }, day, slot, room, team, teams: [team],
      interviewers: iv(name), edu: '학사',
    }) as never
    // 같은 방·같은 팀이 이어 앉으면 한 덩어리, 한 칸 띄면 두 덩어리
    expect(metricsOf([one(0, 0, 0, 'A', 'x'), one(0, 1, 0, 'A', 'x')], 2)).toMatchObject({ teamBlocks: 1, ivSplit: 0 })
    expect(metricsOf([one(0, 0, 0, 'A', 'x'), one(0, 2, 0, 'A', 'x')], 2)).toMatchObject({ teamBlocks: 2, ivSplit: 1 })
    // 조가 2개인데 한 줄에 한 명만 앉으면 그 줄에 빈 칸이 하나
    expect(metricsOf([one(0, 0, 0, 'A', 'x')], 2).holes).toBe(1)
    expect(metricsOf([one(0, 0, 0, 'A', 'x'), one(0, 0, 1, 'B', 'y')], 2).holes).toBe(0)
  })
})
