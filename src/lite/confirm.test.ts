/* 단계적 확정과 재통보 — 실제 엑셀로 만든 편성표 위에서 확인한다. */
import { readFile, readdir } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseMaster, parseTeam } from '@/core/ingest'
import { resolve as resolveApps } from '@/core/resolve'
import { Sched, type Result } from '@/core/schedule'
import { readSheet } from '@/io/xlsx'
import { arrange, withPlaced } from './arrange'
import { editReducer, eventText, initEdit, touchedIds, type EditState } from './edit'
import { rescheduleWith, type LiteSchedule } from './data'
import { metricsOf } from './arrange'
import { DEFAULT_SETUP } from './setup'
import {
  confirmDay, confirmedDays, isConfirmed, noticeSpots, pinsOf, releaseDay, renotifyOf, renotifyText,
  type ConfirmEvent,
} from './confirm'

const DIR = 'data'
const sheetOf = async (name: string) => {
  const b = await readFile(`${DIR}/${name}`)
  return readSheet(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name)
}

let base: Result

beforeAll(async () => {
  const master = parseMaster(await sheetOf('취합파일.xlsx'))
  const names = (await readdir(DIR)).filter(f => f.startsWith('희망지원자'))
  const teams = []
  for (const f of names) {
    const { parsed, warnings } = parseTeam(await sheetOf(f), master.columns)
    if (parsed) teams.push({ file: f, parsed, warnings })
  }
  const apps = resolveApps({ master, teams, failed: [] }).apps
  const raw = Sched.schedule(apps, { ...Sched.DEFAULT_CFG, rooms: 4, days: 0, sessions: 8, amSessions: 4 })
  base = withPlaced(raw, arrange(raw).placed)
}, 60_000)

const EMPTY_METRICS = metricsOf([], 0)

const emptySpotOn = (s: EditState, day: number) => {
  for (let slot = 0; slot < s.base.cfg.sessions; slot++)
    for (let room = 0; room < s.base.cfg.rooms; room++)
      if (!s.placed.some(p => p.day === day && p.slot === slot && p.room === room)) return { day, slot, room }
  throw new Error(`빈 칸 없음 (${day + 1}일차)`)
}

describe('확정', () => {
  it('그날 사람들의 자리를 통째로 찍어 둔다', () => {
    const s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    expect(confirmedDays(list).has(0)).toBe(true)
    const day0 = s.placed.filter(p => p.day === 0)
    expect(list[0].spots).toHaveLength(day0.length)
    expect(noticeSpots(list).size).toBe(day0.length)
    // 다른 날짜 사람은 안 들어간다
    for (const [, spot] of noticeSpots(list)) expect(spot.day).toBe(0)
  })

  it('같은 날을 두 번 확정해도 이벤트가 늘지 않는다', () => {
    const s = initEdit(base)
    const once = confirmDay([], 0, s.placed)
    expect(confirmDay(once, 0, s.placed)).toHaveLength(once.length)
  })

  it('확정을 풀면 지우지 않고 반대 이벤트를 더한다', () => {
    const s = initEdit(base)
    const list = releaseDay(confirmDay([], 0, s.placed), 0)
    expect(list).toHaveLength(2)
    expect(list.map(e => e.op)).toEqual(['confirm', 'release'])
    expect(confirmedDays(list).size).toBe(0)
    expect(noticeSpots(list).size).toBe(0)
  })

  it('안 확정한 날은 풀어도 아무 일이 없다', () => {
    expect(releaseDay([], 1)).toHaveLength(0)
  })

  it('날짜마다 따로 확정한다 — 1일차만 굳고 2·3일차는 열려 있다', () => {
    const s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    expect(confirmedDays(list)).toEqual(new Set([0]))
    const both = confirmDay(list, 1, s.placed)
    expect(confirmedDays(both)).toEqual(new Set([0, 1]))
    // 1일차를 풀어도 2일차는 남는다
    expect(confirmedDays(releaseDay(both, 0))).toEqual(new Set([1]))
  })

  it('누가 언제 확정했는지 남는다', () => {
    const s = initEdit(base)
    const [e] = confirmDay([], 0, s.placed, { id: 'u1', name: '김간사' })
    expect(e).toMatchObject({ actorId: 'u1', actorName: '김간사', op: 'confirm', day: 0 })
    expect(e.id).toHaveLength(26)                       // ULID
    expect(Date.parse(e.ts)).not.toBeNaN()
  })
})

describe('재통보 대상', () => {
  it('확정 전에는 아무도 재통보 대상이 아니다', () => {
    const s = initEdit(base)
    expect(renotifyOf(s.placed, [])).toHaveLength(0)
  })

  it('확정만 하고 손대지 않으면 0명이다', () => {
    const s = initEdit(base)
    expect(renotifyOf(s.placed, confirmDay([], 0, s.placed))).toHaveLength(0)
  })

  it('확정한 날 사람을 옮기면 그 한 명만 잡힌다', () => {
    let s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const who = s.placed.find(p => p.day === 0)!
    s = editReducer(s, { type: 'move', appId: who.app.id, to: emptySpotOn(s, 0) })

    const out = renotifyOf(s.placed, list)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ appId: who.app.id, kind: 'moved' })
    expect(out[0].was).toMatchObject({ day: who.day, slot: who.slot, room: who.room })
  })

  it('확정 안 한 날짜를 아무리 고쳐도 재통보는 0명이다 — 그래서 영향 범위가 줄어든다', () => {
    let s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    for (const p of s.placed.filter(x => x.day === 2).slice(0, 3))
      s = editReducer(s, { type: 'move', appId: p.app.id, to: emptySpotOn(s, 2) })
    expect(s.events.length).toBeGreaterThan(0)
    expect(renotifyOf(s.placed, list)).toHaveLength(0)
  })

  it('배정을 취소하면 「취소됨」으로 잡힌다', () => {
    let s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const who = s.placed.find(p => p.day === 0)!
    s = editReducer(s, { type: 'remove', appId: who.app.id })
    const out = renotifyOf(s.placed, list)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('removed')
    expect(out[0].now).toBeNull()
  })

  it('되돌리면 재통보 대상에서 빠진다', () => {
    let s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const who = s.placed.find(p => p.day === 0)!
    s = editReducer(s, { type: 'move', appId: who.app.id, to: emptySpotOn(s, 0) })
    expect(renotifyOf(s.placed, list)).toHaveLength(1)
    s = editReducer(s, { type: 'undo' })
    expect(renotifyOf(s.placed, list)).toHaveLength(0)
  })

  it('확정을 풀면 재통보 판정도 사라진다', () => {
    let s = initEdit(base)
    let list = confirmDay([], 0, s.placed)
    const who = s.placed.find(p => p.day === 0)!
    s = editReducer(s, { type: 'move', appId: who.app.id, to: emptySpotOn(s, 0) })
    expect(renotifyOf(s.placed, list)).toHaveLength(1)
    list = releaseDay(list, 0)
    expect(renotifyOf(s.placed, list)).toHaveLength(0)
  })

  it('문장이 어디서 어디로 갔는지 말해 준다', () => {
    let s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const who = s.placed.find(p => p.day === 0)!
    s = editReducer(s, { type: 'move', appId: who.app.id, to: emptySpotOn(s, 0) })
    const [r] = renotifyOf(s.placed, list)
    const text = renotifyText(r, d => `${d + 1}일차`, sl => `${sl + 1}세션`)
    expect(text).toContain(who.app.name)
    expect(text).toContain('→')
    expect(text).toContain('1일차')
  })
})

describe('재편성 핀', () => {
  it('확정 뒤 옮긴 사람은 「지금 자리」로 고정한다 — 재편성이 담당자 손질을 되돌리면 안 된다', () => {
    let s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const who = s.placed.find(p => p.day === 0)!
    const was = { day: who.day, slot: who.slot, room: who.room }
    const to = emptySpotOn(s, 0)
    s = editReducer(s, { type: 'move', appId: who.app.id, to })

    const pin = pinsOf(s.placed, list).find(p => p.id === who.app.id)!
    expect(pin).toMatchObject(to)
    expect(pin).not.toMatchObject(was)
    // 통보했던 자리는 재통보 판정에만 남는다
    expect(renotifyOf(s.placed, list)[0].was).toMatchObject(was)
  })

  it('확정 안 한 날짜 사람은 핀이 없다', () => {
    const s = initEdit(base)
    const pins = pinsOf(s.placed, confirmDay([], 0, s.placed))
    const day0 = s.placed.filter(p => p.day === 0)
    expect(pins).toHaveLength(day0.length)
    for (const pin of pins) expect(pin.day).toBe(0)
  })

  it('배정이 취소된 사람은 핀에서 빠진다 — 없는 사람을 고정할 수 없다', () => {
    let s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const who = s.placed.find(p => p.day === 0)!
    s = editReducer(s, { type: 'remove', appId: who.app.id })
    expect(pinsOf(s.placed, list).some(p => p.id === who.app.id)).toBe(false)
  })

  it('핀을 그대로 엔진에 넣으면 그 자리에 다시 앉는다', () => {
    const s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const pins = pinsOf(s.placed, list)
    const again = Sched.schedule(
      base.placed.map(p => p.app).concat(base.unplaced),
      { ...base.cfg, pinned: pins },
    )
    for (const pin of pins) {
      const p = again.placed.find(x => x.app.id === pin.id)
      expect(p).toBeDefined()
      expect({ day: p!.day, slot: p!.slot, room: p!.room })
        .toEqual({ day: pin.day, slot: pin.slot, room: pin.room })
    }
  })
})

describe('확정과 표식', () => {
  it('확정된 사람인지 바로 알 수 있다', () => {
    const s = initEdit(base)
    const notices = noticeSpots(confirmDay([], 0, s.placed))
    const day0 = s.placed.find(p => p.day === 0)!
    const day1 = s.placed.find(p => p.day === 1)!
    expect(isConfirmed(notices, day0.app.id)).toBe(true)
    expect(isConfirmed(notices, day1.app.id)).toBe(false)
  })

  it('빈 목록에서도 죽지 않는다', () => {
    const empty: ConfirmEvent[] = []
    expect(confirmedDays(empty).size).toBe(0)
    expect(noticeSpots(empty).size).toBe(0)
    expect(renotifyOf([], empty)).toHaveLength(0)
    expect(pinsOf([], empty)).toHaveLength(0)
  })
})

/* ── 확정분을 고정한 채 다시 편성 ──
   미팅 P0-4 의 핵심이다. 확정한 날짜가 흔들리지 않는지, 담당자 손질이 살아남는지,
   그리고 실제로 「영향 범위가 줄어드는지」를 실데이터로 잰다. */
describe('다시 편성', () => {
  const scheduleOf = (): LiteSchedule => ({
    sourceCount: 8,
    payload: { meta: {} as never, apps: base.placed.map(p => p.app).concat(base.unplaced), excluded: [] },
    result: base,
    validation: Sched.validate(base),
    hardViolations: 0,
    tidy: { moves: 0, before: EMPTY_METRICS, after: EMPTY_METRICS, ms: 0 },
    setup: DEFAULT_SETUP,
  })

  it('확정한 날짜는 한 사람도 안 움직인다', () => {
    const s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const before = new Map(s.placed.filter(p => p.day === 0).map(p => [p.app.id, `${p.day}|${p.slot}|${p.room}`]))

    const out = rescheduleWith(scheduleOf(), s, list)
    for (const [id, spot] of before) {
      const p = out.schedule.result.placed.find(x => x.app.id === id)
      expect(p, `${id} 가 사라졌다`).toBeDefined()
      expect(`${p!.day}|${p!.slot}|${p!.room}`).toBe(spot)
    }
    expect(out.pinned).toBe(before.size)
    expect(out.confirmedDays).toBe(1)
  })

  it('확정 안 한 날짜는 다시 배치된다', () => {
    const s = initEdit(base)
    const out = rescheduleWith(scheduleOf(), s, confirmDay([], 0, s.placed))
    expect(out.replaced).toBeGreaterThan(0)
    // 인원은 그대로다
    expect(out.schedule.result.placed).toHaveLength(base.placed.length)
  })

  it('담당자가 손으로 옮긴 사람은 그 자리에 남는다 — 재편성이 손질을 지우지 않는다', () => {
    let s = initEdit(base)
    const who = s.placed.find(p => p.day === 2)!            // 확정 안 한 날짜에서 고른다
    const to = emptySpotOn(s, 2)
    s = editReducer(s, { type: 'move', appId: who.app.id, to })

    const out = rescheduleWith(scheduleOf(), s, confirmDay([], 0, s.placed))
    const after = out.schedule.result.placed.find(p => p.app.id === who.app.id)!
    expect({ day: after.day, slot: after.slot, room: after.room }).toEqual(to)
    expect(out.touched).toBe(1)
  })

  it('담당자가 뺀 사람은 미배정으로 남는다 — 자리를 만들어 주지 않는다', () => {
    let s = initEdit(base)
    const who = s.placed.find(p => p.day === 2)!
    s = editReducer(s, { type: 'remove', appId: who.app.id })

    const out = rescheduleWith(scheduleOf(), s, [])
    expect(out.schedule.result.placed.some(p => p.app.id === who.app.id)).toBe(false)
    expect(out.schedule.result.unplaced.some(a => a.id === who.app.id)).toBe(true)
  })

  it('하드 제약을 깨지 않고, 정리도 함께 돈다', () => {
    const s = initEdit(base)
    const out = rescheduleWith(scheduleOf(), s, confirmDay([], 0, s.placed))
    expect(out.schedule.validation.r1).toHaveLength(0)
    expect(out.schedule.validation.r2).toHaveLength(0)
    expect(out.schedule.hardViolations).toBe(0)
  })

  it('아무것도 확정하지 않으면 전부 다시 배치된다', () => {
    const s = initEdit(base)
    const out = rescheduleWith(scheduleOf(), s, [])
    expect(out.pinned).toBe(0)
    expect(out.replaced).toBe(base.placed.length)
  })

  it('재통보 대상은 재편성 뒤에도 그대로다 — 통보 자리로 슬쩍 되돌리지 않는다', () => {
    let s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const who = s.placed.find(p => p.day === 0)!
    const was = { day: who.day, slot: who.slot, room: who.room }
    const to = emptySpotOn(s, 0)
    s = editReducer(s, { type: 'move', appId: who.app.id, to })
    expect(renotifyOf(s.placed, list)).toHaveLength(1)

    const out = rescheduleWith(scheduleOf(), s, list)
    const after = out.schedule.result.placed.find(p => p.app.id === who.app.id)!
    expect({ day: after.day, slot: after.slot, room: after.room }).toEqual(to)
    const still = renotifyOf(out.schedule.result.placed, list).find(r => r.appId === who.app.id)!
    expect(still.kind).toBe('moved')
    expect(still.was).toMatchObject(was)
  })

  it('확정한 날짜의 빈자리를 새로 채우면 그 사람도 재통보 명단에 잡힌다', () => {
    const s = initEdit(base)
    const list = confirmDay([], 0, s.placed)
    const knownIds = new Set(s.placed.filter(p => p.day === 0).map(p => p.app.id))

    const out = rescheduleWith(scheduleOf(), s, list)
    const added = out.schedule.result.placed.filter(p => p.day === 0 && !knownIds.has(p.app.id))
    const flagged = renotifyOf(out.schedule.result.placed, list).filter(r => r.kind === 'added')

    /* 새로 들어온 사람 본인은 아직 통보 전이라 괜찮지만, 그 팀 면접관은 이미 받은 일정에
       면접이 하나 늘어난다. 그래서 잡혀야 한다 — 이 데이터에서는 실제로 1명이 들어온다. */
    expect(flagged.map(r => r.appId).sort()).toEqual(added.map(p => p.app.id).sort())
    if (flagged.length) {
      expect(flagged[0].was).toBeNull()
      expect(renotifyText(flagged[0], d => `${d + 1}일차`, sl => `${sl + 1}세션`)).toContain('새로 배정됨')
    }
  })

  it('이력이 끊기지 않는다 — 재편성도 한 줄로 남고 되돌릴 수는 없다', () => {
    let s = initEdit(base)
    const who = s.placed.find(p => p.day === 2)!
    s = editReducer(s, { type: 'move', appId: who.app.id, to: emptySpotOn(s, 2) })
    const out = rescheduleWith(scheduleOf(), s, confirmDay([], 0, s.placed))

    const before = s.events.length
    s = editReducer(s, {
      type: 'reschedule', base: out.schedule.result,
      pinnedCount: out.pinned, movedCount: out.replaced,
    })
    expect(s.events).toHaveLength(before + 1)
    expect(s.events[s.events.length - 1].op).toBe('reschedule')
    expect(eventText(s.events[s.events.length - 1])).toContain('다시 편성')
    expect(s.base).toBe(out.schedule.result)

    // 재편성은 되돌릴 수 없다 — 되감을 「이전 자리」가 사람마다 다르다
    const frozen = editReducer(s, { type: 'undo' })
    expect(frozen).toBe(s)
  })

  it('재편성 뒤에는 손질이 편성에 녹아들어 다시 고정하지 않는다', () => {
    let s = initEdit(base)
    const who = s.placed.find(p => p.day === 2)!
    s = editReducer(s, { type: 'move', appId: who.app.id, to: emptySpotOn(s, 2) })
    expect(touchedIds(s.events).size).toBe(1)
    s = editReducer(s, { type: 'reschedule', base, pinnedCount: 1, movedCount: 1 })
    expect(touchedIds(s.events).size).toBe(0)
  })
})
