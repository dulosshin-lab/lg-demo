/* 편집 상태·이벤트·위반 판정 — 실제 엑셀로 만든 편성표 위에서 확인한다. */
import { readFile, readdir } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseMaster } from '@/core/ingest'
import { resolve as resolveApps } from '@/core/resolve'
import { Sched, type Result } from '@/core/schedule'
import { readSheet } from '@/io/xlsx'
import {
  atSpot, editReducer, eventText, gridOf, initEdit, isDirty, sameSpot, spotKey,
  type EditState, type Spot,
} from './edit'
import { baseSpans, judge, previewSpot, strayOf } from './violations'
import { buildChanges, buildFindings, buildRows, fileNameOf } from './exportXlsx'

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
    const { parseTeam } = await import('@/core/ingest')
    const { parsed, warnings } = parseTeam(await sheetOf(f), master.columns)
    if (parsed) teams.push({ file: f, parsed, warnings })
  }
  const payload = resolveApps({ master, teams, failed: [] })
  base = Sched.schedule(payload.apps, { ...Sched.DEFAULT_CFG, rooms: 4, days: 0, sessions: 8, amSessions: 4 })
}, 60_000)

const emptySpot = (s: EditState, day: number): Spot => {
  for (let slot = 0; slot < s.base.cfg.sessions; slot++)
    for (let room = 0; room < s.base.cfg.rooms; room++)
      if (!atSpot(s.placed, { day, slot, room })) return { day, slot, room }
  throw new Error(`빈 칸 없음 (${day + 1}일차)`)
}

/** 학사 구간(전역 세션 기준) 안의 빈 칸 — 석사를 끼워 넣을 자리를 찾을 때 */
const emptyInBachelorSpan = (s: EditState): Spot => {
  const own = baseSpans(s.base)['학사']
  const S = s.base.cfg.sessions
  for (let day = 0; day < s.base.totalDays; day++)
    for (let slot = 0; slot < S; slot++) {
      const g = day * S + slot
      if (g < own.min || g > own.max) continue
      for (let room = 0; room < s.base.cfg.rooms; room++)
        if (!atSpot(s.placed, { day, slot, room })) return { day, slot, room }
    }
  throw new Error('학사 구간에 빈 칸 없음')
}

describe('좌표 도우미', () => {
  it('spotKey 와 sameSpot 이 격자 좌표를 같게 본다', () => {
    expect(spotKey({ day: 1, slot: 2, room: 3 })).toBe('1|2|3')
    expect(sameSpot({ day: 1, slot: 2, room: 3 }, { day: 1, slot: 2, room: 3 })).toBe(true)
    expect(sameSpot({ day: 1, slot: 2, room: 3 }, { day: 1, slot: 2, room: 0 })).toBe(false)
    expect(sameSpot(null, null)).toBe(true)
  })
})

describe('기준선', () => {
  it('편집 전에는 이벤트도 위반도 없다', () => {
    const s = initEdit(base)
    expect(isDirty(s)).toBe(false)
    const v = judge(base, s.placed)
    expect(v.findings.filter(f => f.rule === 'r1')).toHaveLength(0)
    expect(v.findings.filter(f => f.rule === 'r2')).toHaveLength(0)
  })

  it('학력 구간이 겹치지 않게 나뉘어 있다', () => {
    const spans = baseSpans(base)
    const ordered = Object.values(spans).sort((a, b) => a.min - b.min)
    for (let i = 1; i < ordered.length; i++) expect(ordered[i].min).toBeGreaterThan(ordered[i - 1].max)
  })

  it('격자 색인이 placed 와 같은 객체를 가리킨다', () => {
    const s = initEdit(base)
    const g = gridOf(s.placed)
    expect(g[spotKey(s.placed[0])]).toBe(s.placed[0])
  })
})

describe('이동', () => {
  it('빈 칸으로 옮기면 좌표가 바뀌고 이벤트가 하나 쌓인다', () => {
    let s = initEdit(base)
    const who = s.placed[0]
    const to = emptySpot(s, 0)
    s = editReducer(s, { type: 'move', appId: who.app.id, to })
    const now = s.placed.find(p => p.app.id === who.app.id)!
    expect({ day: now.day, slot: now.slot, room: now.room }).toEqual(to)
    expect(s.events).toHaveLength(1)
    expect(s.events[0].op).toBe('move')
    expect(s.events[0].from).toEqual({ day: who.day, slot: who.slot, room: who.room })
    expect(s.events[0].to).toEqual(to)
    expect(s.events[0].appName).toBe(who.app.name)
  })

  it('이미 찬 칸으로는 move 가 아무 일도 하지 않는다 (교환이 맡는다)', () => {
    let s = initEdit(base)
    const a = s.placed[0], b = s.placed[1]
    s = editReducer(s, { type: 'move', appId: a.app.id, to: { day: b.day, slot: b.slot, room: b.room } })
    expect(s.events).toHaveLength(0)
  })

  it('제자리로 옮기면 이벤트를 남기지 않는다', () => {
    let s = initEdit(base)
    const a = s.placed[0]
    s = editReducer(s, { type: 'move', appId: a.app.id, to: { day: a.day, slot: a.slot, room: a.room } })
    expect(s.events).toHaveLength(0)
  })

  it('되돌리면 원래 자리로 돌아가고 이벤트가 사라진다', () => {
    let s = initEdit(base)
    const who = s.placed[0]
    const home = { day: who.day, slot: who.slot, room: who.room }
    s = editReducer(s, { type: 'move', appId: who.app.id, to: emptySpot(s, 0) })
    s = editReducer(s, { type: 'undo' })
    const now = s.placed.find(p => p.app.id === who.app.id)!
    expect({ day: now.day, slot: now.slot, room: now.room }).toEqual(home)
    expect(s.events).toHaveLength(0)
  })
})

describe('교환', () => {
  it('두 사람의 자리가 맞바뀐다', () => {
    let s = initEdit(base)
    const a = s.placed[0], b = s.placed[5]
    const pa = { day: a.day, slot: a.slot, room: a.room }
    const pb = { day: b.day, slot: b.slot, room: b.room }
    s = editReducer(s, { type: 'swap', appId: a.app.id, peerAppId: b.app.id })
    const na = s.placed.find(p => p.app.id === a.app.id)!
    const nb = s.placed.find(p => p.app.id === b.app.id)!
    expect({ day: na.day, slot: na.slot, room: na.room }).toEqual(pb)
    expect({ day: nb.day, slot: nb.slot, room: nb.room }).toEqual(pa)
    expect(s.events[0].op).toBe('swap')
    expect(s.events[0].peerAppName).toBe(b.app.name)
  })

  it('되돌리면 둘 다 제자리로 온다', () => {
    let s = initEdit(base)
    const a = s.placed[0], b = s.placed[5]
    const pa = { day: a.day, slot: a.slot, room: a.room }
    const pb = { day: b.day, slot: b.slot, room: b.room }
    s = editReducer(s, { type: 'swap', appId: a.app.id, peerAppId: b.app.id })
    s = editReducer(s, { type: 'undo' })
    const na = s.placed.find(p => p.app.id === a.app.id)!
    const nb = s.placed.find(p => p.app.id === b.app.id)!
    expect({ day: na.day, slot: na.slot, room: na.room }).toEqual(pa)
    expect({ day: nb.day, slot: nb.slot, room: nb.room }).toEqual(pb)
  })

  it('교환해도 배치 인원은 그대로다', () => {
    let s = initEdit(base)
    const n = s.placed.length
    s = editReducer(s, { type: 'swap', appId: s.placed[0].app.id, peerAppId: s.placed[3].app.id })
    expect(s.placed).toHaveLength(n)
  })
})

describe('삭제와 다시 배정', () => {
  it('빼면 미배정으로 가고 다시 넣으면 돌아온다', () => {
    let s = initEdit(base)
    const who = s.placed[0]
    const n = s.placed.length
    s = editReducer(s, { type: 'remove', appId: who.app.id })
    expect(s.placed).toHaveLength(n - 1)
    expect(s.unplaced.some(a => a.id === who.app.id)).toBe(true)

    const to = emptySpot(s, 1)
    s = editReducer(s, { type: 'place', appId: who.app.id, to })
    expect(s.placed).toHaveLength(n)
    expect(s.unplaced.some(a => a.id === who.app.id)).toBe(false)
    const now = s.placed.find(p => p.app.id === who.app.id)!
    expect({ day: now.day, slot: now.slot, room: now.room }).toEqual(to)
    expect(now.teams).toEqual(who.teams)
    expect(now.interviewers).toEqual(who.interviewers)
  })

  it('삭제를 되돌리면 뺐던 자리로 돌아온다', () => {
    let s = initEdit(base)
    const who = s.placed[0]
    const home = { day: who.day, slot: who.slot, room: who.room }
    s = editReducer(s, { type: 'remove', appId: who.app.id })
    s = editReducer(s, { type: 'undo' })
    const now = s.placed.find(p => p.app.id === who.app.id)!
    expect({ day: now.day, slot: now.slot, room: now.room }).toEqual(home)
    expect(s.unplaced.some(a => a.id === who.app.id)).toBe(false)
  })

  it('여러 번 고쳐도 하나씩 전부 되돌아온다', () => {
    let s = initEdit(base)
    const snapshot = s.placed.map(p => `${p.app.id}@${spotKey(p)}`).sort().join()
    s = editReducer(s, { type: 'move', appId: s.placed[0].app.id, to: emptySpot(s, 0) })
    s = editReducer(s, { type: 'swap', appId: s.placed[1].app.id, peerAppId: s.placed[4].app.id })
    s = editReducer(s, { type: 'remove', appId: s.placed[2].app.id })
    s = editReducer(s, { type: 'move', appId: s.placed[3].app.id, to: emptySpot(s, 2) })
    expect(s.events).toHaveLength(4)
    for (let i = 0; i < 4; i++) s = editReducer(s, { type: 'undo' })
    expect(s.events).toHaveLength(0)
    expect(s.placed.map(p => `${p.app.id}@${spotKey(p)}`).sort().join()).toBe(snapshot)
  })
})

describe('① 학력 — 사람 단위 판정', () => {
  it('석사 1명을 학사 구간으로 옮기면 위반이 딱 1건이다', () => {
    let s = initEdit(base)
    const spans = baseSpans(base)
    const m = s.placed.find(p => p.edu === '석사')!
    const to = emptySpot(s, 0)
    s = editReducer(s, { type: 'move', appId: m.app.id, to })
    const r1 = judge(base, s.placed).findings.filter(f => f.rule === 'r1')
    expect(r1).toHaveLength(1)
    expect(r1[0].appId).toBe(m.app.id)
    expect(r1[0].detail).toContain(m.app.name)
    expect(r1[0].detail).toContain('학사 구간')
    // 손대지 않은 학사들은 지목되지 않는다 — 현행 validate 의 「학사 37건」 문제
    expect(r1[0].detail).not.toMatch(/\d\d건/)
    expect(strayOf(s.placed.find(p => p.app.id === m.app.id)!, spans, base.cfg.sessions)).toBe('학사')
  })

  it('석사 3명을 옮기면 3건이다 — 손댄 수와 정확히 같다', () => {
    let s = initEdit(base)
    const ms = s.placed.filter(p => p.edu === '석사').slice(0, 3)
    for (const m of ms) s = editReducer(s, { type: 'move', appId: m.app.id, to: emptyInBachelorSpan(s) })
    expect(judge(base, s.placed).findings.filter(f => f.rule === 'r1')).toHaveLength(3)
  })

  it('① 은 notice — 담당자가 알고 하는 일이라 조용히 센다', () => {
    let s = initEdit(base)
    const m = s.placed.find(p => p.edu === '석사')!
    s = editReducer(s, { type: 'move', appId: m.app.id, to: emptySpot(s, 0) })
    const r1 = judge(base, s.placed).findings.filter(f => f.rule === 'r1')
    expect(r1[0].severity).toBe('notice')
  })

  it('같은 학력 안에서 옮기면 ① 이 생기지 않는다', () => {
    let s = initEdit(base)
    const spans = baseSpans(base)
    const S = base.cfg.sessions
    const who = s.placed.find(p => p.edu === '학사')!
    const own = spans['학사']
    let to: Spot | null = null
    for (let d = 0; d < base.totalDays && !to; d++)
      for (let slot = 0; slot < S && !to; slot++) {
        const g = d * S + slot
        if (g < own.min || g > own.max) continue
        for (let room = 0; room < base.cfg.rooms; room++)
          if (!atSpot(s.placed, { day: d, slot, room })) { to = { day: d, slot, room }; break }
      }
    s = editReducer(s, { type: 'move', appId: who.app.id, to: to! })
    expect(judge(base, s.placed).findings.filter(f => f.rule === 'r1')).toHaveLength(0)
  })
})

describe('② 중복 — 엔진 판정을 그대로 쓴다', () => {
  it('면접관을 공유하는 둘을 같은 시간대에 두면 잡아낸다', () => {
    let s = initEdit(base)
    let a = null, b = null
    outer: for (const x of s.placed) for (const y of s.placed) {
      if (x === y) continue
      if (x.day === y.day && x.slot === y.slot) continue
      if (x.interviewers.some(i => y.interviewers.includes(i))) { a = x; b = y; break outer }
    }
    expect(a).toBeTruthy()
    let room = -1
    for (let r = 0; r < base.cfg.rooms; r++) if (!atSpot(s.placed, { day: b!.day, slot: b!.slot, room: r })) { room = r; break }
    s = editReducer(s, { type: 'move', appId: a!.app.id, to: { day: b!.day, slot: b!.slot, room } })
    const v = judge(base, s.placed)
    const r2 = v.findings.filter(f => f.rule === 'r2')
    expect(r2.length).toBeGreaterThan(0)
    expect(r2[0].severity).toBe('alert')          // 모르고 딸려오는 것이라 적극적으로 알린다
    expect(r2.some(f => f.detail.includes('면접관'))).toBe(true)
  })
})

describe('③ 연속 — 덩어리 수', () => {
  it('한 팀을 흩으면 덩어리가 늘고 그만큼 알린다', () => {
    const before = judge(base, initEdit(base).placed)
    let s = initEdit(base)
    // 어느 팀의 연속 블록 한가운데를 빼내 다른 날로 보낸다
    const blocks = Sched.blocksOf(s.placed as never).filter(b => b.apps.length >= 3)
    expect(blocks.length).toBeGreaterThan(0)
    const victim = blocks[0].apps[1]
    const to = emptySpot(s, Math.min(base.totalDays - 1, blocks[0].day + 1))
    s = editReducer(s, { type: 'move', appId: victim.app.id, to })
    const after = judge(base, s.placed)
    expect(after.blocks).toBeGreaterThan(before.blocks)
    expect(after.findings.filter(f => f.rule === 'r3').every(f => f.severity === 'alert')).toBe(true)
  })

  it('덩어리 판정은 팀×날짜당 한 줄이다 (조 분산과 세션 끊김을 겹쳐 세지 않는다)', () => {
    const v = judge(base, initEdit(base).placed)
    const keys = v.findings.filter(f => f.rule === 'r3').map(f => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('확인함(ack)', () => {
  it('표시하면 미확인 수에서 빠지고 예외 수로 옮겨간다', () => {
    let s = initEdit(base)
    const m = s.placed.find(p => p.edu === '석사')!
    s = editReducer(s, { type: 'move', appId: m.app.id, to: emptySpot(s, 0) })
    const before = judge(base, s.placed, s.acks)
    const r1 = before.findings.find(f => f.rule === 'r1')!
    expect(before.openNew).toBeGreaterThan(0)
    expect(r1.sinceBase).toBe(false)          // 담당자가 방금 만든 것

    s = editReducer(s, { type: 'ack', key: r1.key, reason: '팀장 양해' })
    const after = judge(base, s.placed, s.acks)
    expect(after.acked).toBe(before.acked + 1)
    expect(after.openNew).toBe(before.openNew - 1)
    expect(s.acks[r1.key]).toBe('팀장 양해')
  })

  it('해제하면 되돌아오고, 되돌리기로도 복구된다', () => {
    let s = initEdit(base)
    const m = s.placed.find(p => p.edu === '석사')!
    s = editReducer(s, { type: 'move', appId: m.app.id, to: emptySpot(s, 0) })
    const key = judge(base, s.placed, s.acks).findings.find(f => f.rule === 'r1')!.key
    s = editReducer(s, { type: 'ack', key, reason: 'x' })
    s = editReducer(s, { type: 'unack', key })
    expect(key in s.acks).toBe(false)
    s = editReducer(s, { type: 'undo' })
    expect(s.acks[key]).toBe('x')
  })

  it('같은 위반이 사라졌다 다시 생기면 옛 표시가 다시 붙는다', () => {
    let s = initEdit(base)
    const m = s.placed.find(p => p.edu === '석사')!
    const home = { day: m.day, slot: m.slot, room: m.room }
    const to = emptySpot(s, 0)
    s = editReducer(s, { type: 'move', appId: m.app.id, to })
    const key = judge(base, s.placed, s.acks).findings.find(f => f.rule === 'r1')!.key
    s = editReducer(s, { type: 'ack', key })
    s = editReducer(s, { type: 'move', appId: m.app.id, to: home })
    expect(judge(base, s.placed, s.acks).findings.filter(f => f.rule === 'r1')).toHaveLength(0)
    s = editReducer(s, { type: 'move', appId: m.app.id, to })
    const back = judge(base, s.placed, s.acks)
    expect(back.findings.find(f => f.rule === 'r1')!.key).toBe(key)
    expect(back.acked).toBeGreaterThan(0)
  })
})

describe('드래그 예고', () => {
  it('빈 칸·같은 학력이면 문제없다고 답한다', () => {
    const s = initEdit(base)
    const spans = baseSpans(base)
    const who = s.placed.find(p => p.edu === '학사')!
    const blocks = Sched.blocksOf(s.placed as never).length
    const v = previewSpot(base, s.placed, who.app, { day: who.day, slot: who.slot, room: who.room }, spans, blocks)
    expect(v.ok).toBe(true)
    expect(v.stray).toBe(false)
  })

  it('점유된 시간대의 팀 충돌을 놓기 전에 알려준다', () => {
    const s = initEdit(base)
    const spans = baseSpans(base)
    const a = s.placed[0]
    const peer = s.placed.find(p => p.day === a.day && p.slot === a.slot && p.app.id !== a.app.id)
      ?? s.placed.find(p => p.app.id !== a.app.id)!
    const v = previewSpot(base, s.placed, peer.app, { day: a.day, slot: a.slot, room: 99 }, spans, 0)
    expect(Array.isArray(v.clashes)).toBe(true)
  })

  /* 실데이터에서 조건에 맞는 짝을 찾는다 — 고정 인덱스로 잡으면 데이터가 바뀔 때 조용히 빗나간다 */
  const wouldClash = (
    placed: readonly { app: { id: number }; day: number; slot: number; teams: readonly string[]; interviewers: readonly string[] }[],
    who: { teams: readonly string[]; interviewers: readonly string[] },
    at: { day: number; slot: number },
    skip: ReadonlySet<number>,
  ) => placed.some(o => !skip.has(o.app.id) && o.day === at.day && o.slot === at.slot &&
    (who.teams.some(t => o.teams.includes(t)) || who.interviewers.some(i => o.interviewers.includes(i))))

  it('교환하면 상대가 밀려갈 자리의 중복을 놓기 전에 알려준다', () => {
    const s = initEdit(base)
    const spans = baseSpans(base)
    const blocks = Sched.blocksOf(s.placed as never).length

    // 끌고 가는 쪽은 깨끗하지만 밀려나는 쪽이 부딪히는 짝 — 예전엔 이게 통째로 안 보였다
    let pair: { a: typeof s.placed[number]; b: typeof s.placed[number] } | null = null
    outer: for (const a of s.placed) {
      for (const b of s.placed) {
        if (a.app.id === b.app.id || (a.day === b.day && a.slot === b.slot)) continue
        const skip = new Set([a.app.id, b.app.id])
        if (wouldClash(s.placed, b, a, skip)) continue          // 끄는 쪽은 깨끗해야 한다
        if (!wouldClash(s.placed, a, b, skip)) continue         // 밀려나는 쪽은 부딪혀야 한다
        pair = { a, b }
        break outer
      }
    }
    expect(pair).not.toBeNull()

    const { a, b } = pair!
    const v = previewSpot(base, s.placed, b.app, { day: a.day, slot: a.slot, room: a.room }, spans, blocks, a)
    expect(v.clashes).toHaveLength(0)                 // 끄는 사람 자리는 멀쩡하고
    expect(v.peer?.name).toBe(a.app.name)
    expect(v.peer!.clashes.length).toBeGreaterThan(0) // 상대 자리가 부딪힌다
    expect(v.ok).toBe(false)                          // 그래도 칸은 빨갛다
  })

  it('곧 비워질 상대 자리 때문에 없는 중복을 알리지 않는다', () => {
    const s = initEdit(base)
    const spans = baseSpans(base)
    const blocks = Sched.blocksOf(s.placed as never).length

    // A 의 시간대에서 B 와 부딪히는 사람이 A 뿐인 짝 — A 가 비켜 주면 충돌은 사라진다
    let pair: { a: typeof s.placed[number]; b: typeof s.placed[number] } | null = null
    outer: for (const a of s.placed) {
      for (const b of s.placed) {
        if (a.app.id === b.app.id || (a.day === b.day && a.slot === b.slot)) continue
        if (!b.teams.some(t => a.teams.includes(t)) && !b.interviewers.some(i => a.interviewers.includes(i))) continue
        if (wouldClash(s.placed, b, a, new Set([a.app.id, b.app.id]))) continue
        pair = { a, b }
        break outer
      }
    }
    expect(pair).not.toBeNull()

    const { a, b } = pair!
    const v = previewSpot(base, s.placed, b.app, { day: a.day, slot: a.slot, room: a.room }, spans, blocks, a)
    expect(v.clashes).toHaveLength(0)
  })

  it('미배정 카드는 교환이 아니다 — 상대를 줘도 밀려날 자리가 없다', () => {
    const s = initEdit(base)
    const spans = baseSpans(base)
    const blocks = Sched.blocksOf(s.placed as never).length
    // 이 설정에선 미배정자가 없다 — 한 명 빼서 서랍으로 보낸다
    const out = s.placed[0]
    const drawer = editReducer(s, { type: 'remove', appId: out.app.id })
    const who = drawer.unplaced.find(a => a.id === out.app.id)!
    expect(who).toBeTruthy()
    const seat = drawer.placed[0]
    const v = previewSpot(base, drawer.placed, who, { day: seat.day, slot: seat.slot, room: seat.room }, spans, blocks, seat)
    expect(v.peer).toBeUndefined()
  })

  it('학력 구간 밖이면 stray 로 답한다', () => {
    const s = initEdit(base)
    const spans = baseSpans(base)
    const m = s.placed.find(p => p.edu === '석사')!
    const blocks = Sched.blocksOf(s.placed as never).length
    const v = previewSpot(base, s.placed, m.app, { day: 0, slot: 0, room: 3 }, spans, blocks)
    expect(v.stray).toBe(true)
  })
})

describe('이력 문구', () => {
  it('사람이 읽는 문장으로 나온다', () => {
    let s = initEdit(base)
    const who = s.placed[0]
    s = editReducer(s, { type: 'move', appId: who.app.id, to: emptySpot(s, 0) })
    const text = eventText(s.events[0])
    expect(text).toContain(who.app.name)
    expect(text).toMatch(/\d일차 \d+세션 \d조/)
    expect(text).not.toMatch(/AI|자동|알고리즘/)     // 미팅 요청 — AI 스럽지 않게
  })
})

describe('내보내기 표', () => {
  it('편성표 행이 배치 인원과 같고 시간순으로 정렬된다', () => {
    const s = initEdit(base)
    const rows = buildRows(base, s)
    expect(rows).toHaveLength(s.placed.length)
    expect(rows[0]).toHaveProperty('지원자')
    expect(rows[0]).toHaveProperty('면접관')
  })

  it('변경 요약이 이벤트 수와 같고 이전/이후를 담는다', () => {
    let s = initEdit(base)
    const who = s.placed[0]
    s = editReducer(s, { type: 'move', appId: who.app.id, to: emptySpot(s, 0) })
    const rows = buildChanges(base, s)
    expect(rows).toHaveLength(1)
    expect(rows[0].구분).toBe('이동')
    expect(rows[0].지원자).toBe(who.app.name)
    expect(rows[0].이전).not.toBe('—')
    expect(rows[0].이후).not.toBe('—')
  })

  it('확인 목록이 예외 표시 상태를 함께 담는다', () => {
    let s = initEdit(base)
    const m = s.placed.find(p => p.edu === '석사')!
    s = editReducer(s, { type: 'move', appId: m.app.id, to: emptySpot(s, 0) })
    const v = judge(base, s.placed, s.acks)
    const key = v.findings.find(f => f.rule === 'r1')!.key
    s = editReducer(s, { type: 'ack', key, reason: '본인 요청' })
    const rows = buildFindings(judge(base, s.placed, s.acks), s.acks)
    const row = rows.find(r => r.내용.includes(m.app.name))!
    expect(row.상태).toBe('예외로 표시함')
    expect(row.사유).toBe('본인 요청')
  })

  it('파일 이름에 날짜와 시각이 들어간다', () => {
    expect(fileNameOf(new Date(2026, 8, 2, 14, 3))).toBe('면접편성_20260902_1403.xlsx')
  })
})

describe('조사', () => {
  it('받침 유무에 따라 이/가를 고른다', async () => {
    const { particle } = await import('./hangul')
    expect(particle('여누리', '이', '가')).toBe('가')
    expect(particle('온나윤', '이', '가')).toBe('이')
    expect(particle('김총이', '이', '가')).toBe('가')
    expect(particle('Kim', '이', '가')).toBe('가')
  })
})

describe('기준선 잡음 가르기', () => {
  it('1차 편성부터 있던 위반은 sinceBase 로 표시된다', () => {
    const v = judge(base, initEdit(base).placed)
    expect(v.findings.length).toBeGreaterThan(0)
    expect(v.findings.every(f => f.sinceBase)).toBe(true)
    expect(v.openNew).toBe(0)                    // 손대지 않았으면 「내가 만든 위반」 0건
    expect(v.openBase).toBe(v.findings.length)
  })

  it('편집으로 생긴 것만 openNew 로 센다', () => {
    let s = initEdit(base)
    const m = s.placed.find(p => p.edu === '석사')!
    s = editReducer(s, { type: 'move', appId: m.app.id, to: emptyInBachelorSpan(s) })
    const v = judge(base, s.placed)
    expect(v.openNew).toBeGreaterThan(0)
    expect(v.findings.filter(f => !f.sinceBase).some(f => f.rule === 'r1')).toBe(true)
    // 첫 타임 13건 같은 기준선 잡음은 openNew 에 섞이지 않는다
    expect(v.findings.filter(f => !f.sinceBase).every(f => f.rule !== 'r4' || !f.sinceBase)).toBe(true)
  })
})

describe('표식 판정', () => {
  it('알림이 참고보다 우선한다 — 빨간 ▲ 가 회색 ● 에 묻히지 않게', async () => {
    const { markOf } = await import('./SchedulePage')
    const alert = { rule: 'r2', severity: 'alert', key: 'a', detail: '', sinceBase: false } as never
    const notice = { rule: 'r4', severity: 'notice', key: 'b', detail: '', sinceBase: true } as never
    expect(markOf([notice, alert])).toBe('alert')
    expect(markOf([alert])).toBe('alert')
  })

  it('참고끼리는 내가 만든 것이 우선한다', async () => {
    const { markOf } = await import('./SchedulePage')
    const mine = { rule: 'r1', severity: 'notice', key: 'a', detail: '', sinceBase: false } as never
    const old = { rule: 'r4', severity: 'notice', key: 'b', detail: '', sinceBase: true } as never
    expect(markOf([old, mine])).toBe('new-notice')
    expect(markOf([old])).toBe('base-notice')
  })

  it('어긋난 것이 없으면 표식이 없다', async () => {
    const { markOf } = await import('./SchedulePage')
    expect(markOf([])).toBeNull()
  })
})

describe('한글 조사', () => {
  it('받침 유무를 가린다', async () => {
    const { hasFinal, iGa, eunNeun, eulReul, withIGa } = await import('./hangul')
    expect(hasFinal('온타래')).toBe(false)
    expect(hasFinal('온나윤')).toBe(true)
    expect(hasFinal('Kim')).toBeNull()
    expect(iGa('온타래')).toBe('가')
    expect(iGa('온나윤')).toBe('이')
    expect(eunNeun('온타래')).toBe('는')
    expect(eunNeun('온나윤')).toBe('은')
    expect(eulReul('편성표')).toBe('를')
    expect(withIGa('온타래')).toBe('온타래가')
  })

  it('한글이 아니면 받침 없는 쪽을 쓴다 — 파일명·영문 이름', async () => {
    const { iGa, eulReul } = await import('./hangul')
    expect(iGa('Kim')).toBe('가')
    expect(eulReul('면접편성_20260902.xlsx')).toBe('를')
  })

  it('빈 문자열에도 죽지 않는다', async () => {
    const { hasFinal, iGa } = await import('./hangul')
    expect(hasFinal('')).toBeNull()
    expect(iGa('')).toBe('가')
  })
})
