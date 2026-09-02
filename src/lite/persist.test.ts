/* 저장·복원 — 실제 엑셀을 태워 왕복시킨다.
   Map·Set 이 온전히 살아나는지, 복원한 명단으로 편성을 다시 만들 수 있는지가 요점이다. */
import { readFile, readdir } from 'node:fs/promises'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseMaster } from '@/core/ingest'
import { Sched } from '@/core/schedule'
import { readSheet } from '@/io/xlsx'
import { buildSchedule, type LiteRoster } from './data'
import { clearSession, gridOf, loadSession, nowISO, packSession, saveSession, ulid, unpackSession } from './persist'

/* localStorage 가 없는 Node 환경을 위한 최소 구현 */
class MemoryStorage {
  private map = new Map<string, string>()
  quota = Infinity
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new DOMException('quota', 'QuotaExceededError')
    this.map.set(k, v)
  }
  removeItem(k: string) { this.map.delete(k) }
}
let store: MemoryStorage
beforeEach(() => {
  store = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
})

const DIR = 'data'
const fileOf = async (name: string): Promise<File> => {
  const b = await readFile(`${DIR}/${name}`)
  return new File([new Uint8Array(b)], name)
}
const sheetOf = async (name: string) => {
  const b = await readFile(`${DIR}/${name}`)
  return readSheet(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name)
}

const rosterOf = async (): Promise<LiteRoster> => {
  const parsed = parseMaster(await sheetOf('취합파일.xlsx'))
  const headers = [...parsed.columns]
  const rows = [...parsed.rows.values()].slice(0, 5).map(r => headers.map(h => String(r[h] ?? '—')))
  return {
    fileName: '취합파일.xlsx', columnCount: parsed.columns.size,
    candidates: [...parsed.rows.values()].slice(0, 3).map(r => ({
      id: String(r['지원자 번호']), name: String(r['한글성명']),
      education: '학사', major: String(r['최종학력_주전공'] ?? ''), job: '',
    })),
    headers, rows, parsed,
  }
}

describe('ulid', () => {
  it('26자이고 시간순으로 정렬된다', () => {
    const early = ulid(1_700_000_000_000)
    const late = ulid(1_800_000_000_000)
    expect(early).toHaveLength(26)
    expect(early < late).toBe(true)
  })
  it('같은 밀리초에 만들어도 겹치지 않는다', () => {
    const at = Date.now()
    const ids = new Set(Array.from({ length: 500 }, () => ulid(at)))
    expect(ids.size).toBe(500)
  })
})

describe('nowISO', () => {
  it('타임존 오프셋을 붙인다', () => {
    expect(nowISO(new Date(2026, 8, 2, 14, 3, 11))).toMatch(/^2026-09-02T14:03:11[+-]\d{2}:\d{2}$/)
  })
  it('문자열 정렬이 시간순과 같다', () => {
    const a = nowISO(new Date(2026, 8, 2, 9, 0, 0))
    const b = nowISO(new Date(2026, 8, 2, 14, 0, 0))
    expect(a < b).toBe(true)
  })
})

describe('gridOf', () => {
  it('placed 를 좌표 색인으로 만들고 같은 객체를 가리킨다', () => {
    const p = { day: 1, slot: 2, room: 3 } as never
    const grid = gridOf([p])
    expect(grid['1|2|3']).toBe(p)
  })
})

describe('명단만 있는 세션', () => {
  it('왕복해도 Map·Set 과 키 타입이 그대로다', async () => {
    const roster = await rosterOf()
    const back = unpackSession(packSession(roster, null))
    expect(back.roster.parsed.rows).toBeInstanceOf(Map)
    expect(back.roster.parsed.columns).toBeInstanceOf(Set)
    expect(back.roster.parsed.rows.size).toBe(roster.parsed.rows.size)
    expect(back.roster.parsed.columns.size).toBe(roster.parsed.columns.size)
    // 키 타입 보존 — 숫자 번호를 문자열로 눕히면 뒤의 조인이 조용히 깨진다
    const [key] = [...roster.parsed.rows.keys()]
    expect([...back.roster.parsed.rows.keys()][0]).toBe(key)
    expect(back.roster.parsed.rows.get(key)).toEqual(roster.parsed.rows.get(key))
    expect(back.schedule).toBeNull()
  })

  it('저장하고 다시 읽으면 같은 명단이 나온다', async () => {
    const roster = await rosterOf()
    const id = ulid()
    expect(saveSession(roster, null, id).ok).toBe(true)
    const loaded = loadSession()
    expect(loaded?.id).toBe(id)
    expect(loaded?.roster.candidates).toEqual(roster.candidates)
    expect(loaded?.roster.parsed.rows.size).toBe(roster.parsed.rows.size)
  })
})

describe('편성표까지 있는 세션', () => {
  it('편성표가 그대로 살아나고 격자가 placed 와 같은 객체를 가리킨다', async () => {
    const roster = await rosterOf()
    const names = (await readdir(DIR)).filter(f => f.startsWith('희망지원자'))
    const files = await Promise.all(names.map(fileOf))
    const schedule = await buildSchedule(roster, files)
    expect(schedule.result.placed.length).toBeGreaterThan(0)

    expect(saveSession(roster, schedule, ulid()).ok).toBe(true)
    const back = loadSession()!.schedule!

    expect(back.result.placed).toHaveLength(schedule.result.placed.length)
    expect(back.result.totalDays).toBe(schedule.result.totalDays)
    expect(back.result.dates).toEqual(schedule.result.dates)
    expect(back.result.times).toEqual(schedule.result.times)
    expect(back.hardViolations).toBe(schedule.hardViolations)

    // grid 는 저장하지 않고 다시 만든다 — placed 와 같은 객체여야 편집이 한쪽만 고치는 일이 없다
    expect(Object.keys(back.result.grid)).toHaveLength(back.result.placed.length)
    const first = back.result.placed[0]
    expect(back.result.grid[`${first.day}|${first.slot}|${first.room}`]).toBe(first)
  })

  it('복원한 결과를 다시 검증해도 하드 위반이 0이다', async () => {
    const roster = await rosterOf()
    const names = (await readdir(DIR)).filter(f => f.startsWith('희망지원자'))
    const schedule = await buildSchedule(roster, await Promise.all(names.map(fileOf)))
    saveSession(roster, schedule, ulid())
    const V = Sched.validate(loadSession()!.schedule!.result)
    expect(V.r1).toHaveLength(0)
    expect(V.r2).toHaveLength(0)
  })

  it('복원한 명단으로 편성을 다시 만들 수 있다 (조인이 살아 있다)', async () => {
    const roster = await rosterOf()
    saveSession(roster, null, ulid())
    const restored = loadSession()!.roster
    const names = (await readdir(DIR)).filter(f => f.startsWith('희망지원자'))
    const files = await Promise.all(names.map(fileOf))
    const fresh = await buildSchedule(roster, files)
    const again = await buildSchedule(restored, await Promise.all(names.map(fileOf)))
    expect(again.payload.apps).toHaveLength(fresh.payload.apps.length)
    expect(again.result.placed.map(p => p.app.name)).toEqual(fresh.result.placed.map(p => p.app.name))
  })
})

describe('저장이 실패하는 경우', () => {
  it('용량을 넘기면 던지지 않고 사유를 돌려준다', async () => {
    const roster = await rosterOf()
    store.quota = 10
    const out = saveSession(roster, null, ulid())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('저장 공간')
  })

  it('저장된 값이 깨져 있으면 null 을 주고 지운다', () => {
    store.setItem('ax.v1.session', '{깨진 JSON')
    expect(loadSession()).toBeNull()
    expect(store.getItem('ax.v1.session')).toBeNull()
  })

  it('스키마 버전이 다르면 읽지 않는다', () => {
    store.setItem('ax.v1.session', JSON.stringify({ v: 99, id: 'x', roster: { parsed: {} } }))
    expect(loadSession()).toBeNull()
  })

  it('저장된 것이 없으면 null 이다', () => {
    expect(loadSession()).toBeNull()
  })

  it('clearSession 뒤에는 남지 않는다', async () => {
    saveSession(await rosterOf(), null, ulid())
    expect(loadSession()).not.toBeNull()
    clearSession()
    expect(loadSession()).toBeNull()
  })
})
