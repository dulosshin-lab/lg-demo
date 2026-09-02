/* 전형 설정 — 설정이 실제 편성으로 이어지는지, 그리고 조용히 어긋나지 않는지 */
import { readFile, readdir } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseMaster, parseTeam } from '@/core/ingest'
import { resolve as resolveApps } from '@/core/resolve'
import { Sched, type Applicant } from '@/core/schedule'
import { readSheet } from '@/io/xlsx'
import {
  DEFAULT_SETUP, datesOf, daysNote, isTimeKey, previewOf, toCfg, warningsOf, withDates, type Setup,
} from './setup'

const DIR = 'data'
const sheetOf = async (name: string) => {
  const b = await readFile(`${DIR}/${name}`)
  return readSheet(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name)
}

let apps: Applicant[]

beforeAll(async () => {
  const master = parseMaster(await sheetOf('취합파일.xlsx'))
  const names = (await readdir(DIR)).filter(f => f.startsWith('희망지원자'))
  const teams = []
  for (const f of names) {
    const { parsed, warnings } = parseTeam(await sheetOf(f), master.columns)
    if (parsed) teams.push({ file: f, parsed, warnings })
  }
  apps = resolveApps({ master, teams, failed: [] }).apps
}, 60_000)

const on = (over: Partial<Setup>): Setup => ({ ...DEFAULT_SETUP, ...over })

describe('기본값', () => {
  it('설정을 안 건드리면 지금과 똑같이 편성된다', () => {
    const before = Sched.schedule(apps, { ...Sched.DEFAULT_CFG, rooms: 4, days: 0, sessions: 8, amSessions: 4 })
    const after = Sched.schedule(apps, toCfg(DEFAULT_SETUP) as never)
    const key = (r: typeof before) => r.placed.map(p => `${p.app.id}@${p.day}/${p.slot}/${p.room}`).join(',')
    expect(key(after)).toBe(key(before))
  })
})

describe('시간표', () => {
  it('면접 시간·휴식·시작 시각이 실제 시각표를 바꾼다', () => {
    const p = previewOf(on({ startTime: '09:00', sessionMin: 25, breakMin: 5, sessions: 4, amSessions: 4 }))
    expect(p.times[0].label).toBe('09:00–09:25')
    expect(p.times[1].label).toBe('09:30–09:55')
    expect(p.endTime).toBe('10:55')   // 4세션 × (25+5)분, 마지막은 휴식 없이 끝난다
  })

  it('끝나는 시각을 알려 준다 — 담당자는 이 값으로 판단한다', () => {
    expect(previewOf(on({ sessionMin: 30, breakMin: 5 })).endTime)
      .not.toBe(previewOf(on({ sessionMin: 20, breakMin: 5 })).endTime)
  })

  it('하루 자리는 세션 × 조다', () => {
    expect(previewOf(on({ sessions: 8, rooms: 4 })).seatsPerDay).toBe(32)
    expect(previewOf(on({ sessions: 10, rooms: 6 })).seatsPerDay).toBe(60)
  })

  it('점심에 걸린 오전 세션을 세어 알려 준다', () => {
    // 08:00 시작 · 50분 면접 · 오전 6세션이면 뒤쪽이 점심을 넘는다
    const s = on({ startTime: '08:00', sessionMin: 50, breakMin: 5, sessions: 8, amSessions: 6 })
    expect(previewOf(s).pushed).toBeGreaterThan(0)
    expect(warningsOf(s).some(w => w.includes('점심'))).toBe(true)
  })

  it('미리보기 시각표가 실제 편성의 시각표와 같다 — 두 벌로 갈라지지 않는다', () => {
    const s = on({ startTime: '09:30', sessionMin: 25, breakMin: 10, sessions: 6, amSessions: 3 })
    const real = Sched.schedule(apps, toCfg(s) as never)
    expect(previewOf(s).times.map(t => t.label)).toEqual(real.times.map(t => t.label))
  })
})

describe('공휴일', () => {
  it('토·일과 공휴일을 함께 건너뛴다', () => {
    // 2026-08-17 은 월요일. 8/19 를 쉬면 3일차가 8/20 이 된다
    const s = on({ startDate: '2026-08-17', holidays: ['2026-08-19'] })
    expect(datesOf(s, 3).map(d => d.iso)).toEqual(['2026-08-17', '2026-08-18', '2026-08-20'])
  })

  it('공휴일이 없으면 엔진이 낸 날짜와 똑같다', () => {
    const s = on({ startDate: '2026-08-17' })
    const r = Sched.schedule(apps, toCfg(s) as never)
    expect(datesOf(s, r.totalDays)).toEqual(r.dates)
  })

  it('시작일이 공휴일이면 다음 영업일로 민다', () => {
    const s = on({ startDate: '2026-08-17', holidays: ['2026-08-17'] })
    expect(datesOf(s, 1)[0].iso).toBe('2026-08-18')
  })

  it('연휴가 이어져도 끝까지 민다', () => {
    const s = on({ startDate: '2026-08-17', holidays: ['2026-08-18', '2026-08-19', '2026-08-20'] })
    expect(datesOf(s, 2).map(d => d.iso)).toEqual(['2026-08-17', '2026-08-21'])
  })

  it('주말 건너뛰기를 끄면 토·일에도 편성된다', () => {
    const s = on({ startDate: '2026-08-21', skipWeekend: false })   // 금요일
    expect(datesOf(s, 3).map(d => d.iso)).toEqual(['2026-08-21', '2026-08-22', '2026-08-23'])
  })

  it('편성 결과에 붙이면 편성표·엑셀이 함께 바뀐다', () => {
    const s = on({ holidays: ['2026-08-19'] })
    const r = Sched.schedule(apps, toCfg(s) as never)
    const fixed = withDates(r, s)
    expect(fixed.dates.some(d => d.iso === '2026-08-19')).toBe(false)
    expect(fixed.placed).toBe(r.placed)          // 배치는 손대지 않는다
    expect(fixed.dates).toHaveLength(r.totalDays)
  })
})

describe('편성 규칙', () => {
  it('학력 분리를 끄면 하드 위반이 생길 수 있다 — 그래서 기본은 켬이다', () => {
    const off = Sched.validate(Sched.schedule(apps, toCfg(on({ separateEdu: false })) as never))
    const onn = Sched.validate(Sched.schedule(apps, toCfg(on({ separateEdu: true })) as never))
    expect(onn.r1).toHaveLength(0)
    expect(off.r1.length).toBeGreaterThan(0)
  })

  it('첫 타임 회피를 끄면 첫 타임 위반이 줄어든다', () => {
    const soft = Sched.validate(Sched.schedule(apps, toCfg(on({ avoidFirstSlot: 'soft' })) as never))
    const none = Sched.validate(Sched.schedule(apps, toCfg(on({ avoidFirstSlot: 'off' })) as never))
    expect(none.r4.length).not.toBe(soft.r4.length)
  })

  it('조 수를 줄이면 일수가 늘어난다', () => {
    const four = Sched.schedule(apps, toCfg(on({ rooms: 4 })) as never)
    const two = Sched.schedule(apps, toCfg(on({ rooms: 2 })) as never)
    expect(two.totalDays).toBeGreaterThan(four.totalDays)
    expect(two.unplaced).toHaveLength(0)
  })
})

describe('왜 N일인가', () => {
  it('가장 바쁜 팀과 나눗셈을 문장으로 보여 준다', () => {
    const note = daysNote(apps, DEFAULT_SETUP)
    expect(note).toMatch(/÷ 하루 8세션 = 최소 3일/)
    expect(note).toContain('미래혁신팀')
  })

  it('명단이 없으면 아무 말도 하지 않는다', () => {
    expect(daysNote([], DEFAULT_SETUP)).toBe('')
  })
})

describe('경고', () => {
  it('말이 되는 설정에는 잔소리하지 않는다', () => {
    expect(warningsOf(DEFAULT_SETUP)).toHaveLength(0)
  })

  it('오전 세션이 하루 세션보다 많으면 알린다', () => {
    expect(warningsOf(on({ sessions: 4, amSessions: 6 })).some(w => w.includes('오전'))).toBe(true)
  })

  it('하루가 너무 길면 알린다', () => {
    expect(warningsOf(on({ sessions: 14, sessionMin: 50, breakMin: 10 })).some(w => w.includes('끝납니다'))).toBe(true)
  })

  it('일수를 손으로 줄여 자리가 모자라면 알린다', () => {
    expect(warningsOf(on({ days: 1 }), 60).some(w => w.includes('모자랍니다'))).toBe(true)
    expect(warningsOf(on({ days: 3 }), 60).some(w => w.includes('모자랍니다'))).toBe(false)
  })

  it('조별 링크가 덜 채워졌으면 알린다', () => {
    expect(warningsOf(on({ rooms: 4, links: ['a', 'b'] })).some(w => w.includes('링크'))).toBe(true)
    expect(warningsOf(on({ rooms: 2, links: ['a', 'b'] })).some(w => w.includes('링크'))).toBe(false)
  })
})

describe('확정과 부딪히는 항목', () => {
  it('시간표를 건드리는 항목을 가려낸다', () => {
    for (const k of ['startTime', 'sessionMin', 'breakMin', 'sessions', 'amSessions', 'lunchStart', 'lunchMin'] as const)
      expect(isTimeKey(k)).toBe(true)
    for (const k of ['rooms', 'startDate', 'name', 'holidays', 'separateEdu', 'links'] as const)
      expect(isTimeKey(k)).toBe(false)
  })

  it('세션 설정을 바꾸면 같은 좌표가 다른 시각을 가리킨다 — 잠가야 하는 이유', () => {
    const a = previewOf(on({ sessions: 8, sessionMin: 25, breakMin: 5 })).times[3].label
    const b = previewOf(on({ sessions: 10, sessionMin: 20, breakMin: 5 })).times[3].label
    expect(a).not.toBe(b)
  })
})

describe('설정이 산출물에 실린다', () => {
  it('파일 이름에 전형 이름이 앞에 붙는다', async () => {
    const { fileNameOf, safeName } = await import('./exportXlsx')
    const at = new Date(2026, 8, 3, 9, 5)
    expect(fileNameOf(at, '2026 하반기 신입 2차')).toBe('2026_하반기_신입_2차_면접편성_20260903_0905.xlsx')
    expect(fileNameOf(at)).toBe('면접편성_20260903_0905.xlsx')       // 이름이 없으면 종전 그대로
    expect(safeName('신입/2차: 직무*면접')).toBe('신입2차_직무면접')   // 경로 문자는 뺀다
  })

  it('조별 링크를 넣으면 편성표에 열이 하나 붙는다', async () => {
    const { buildRows } = await import('./exportXlsx')
    const { initEdit } = await import('./edit')
    const r = Sched.schedule(apps, toCfg(DEFAULT_SETUP) as never)
    const state = initEdit(r)
    expect(Object.keys(buildRows(r, state)[0])).not.toContain('화상')
    const withLink = buildRows(r, state, ['L1', 'L2', 'L3', 'L4'])
    expect(Object.keys(withLink[0])).toContain('화상')
    // 링크는 조를 따라간다
    const first = [...state.placed].sort((a, b) => a.day - b.day || a.slot - b.slot || a.room - b.room)[0]
    expect(withLink[0].화상).toBe(`L${first.room + 1}`)
  })
})
