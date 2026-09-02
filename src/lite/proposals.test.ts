/* 제안 큐 · CSV · 그림 내보내기 — 실제 엑셀로 만든 편성표 위에서 확인한다. */
import { readFile, readdir } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseMaster, parseTeam } from '@/core/ingest'
import { resolve as resolveApps } from '@/core/resolve'
import { Sched, type Result } from '@/core/schedule'
import { readSheet } from '@/io/xlsx'
import { atSpot, editReducer, initEdit, type EditState, type Spot } from './edit'
import { judge } from './violations'
import { toCsv, buildRows, buildChanges } from './exportXlsx'
import { imageNameOf, marksBySpot, planImage } from './exportImage'
import {
  applyProposal, createProposal, decide, decidedOf, effectOf, inboxOf, isApplicable, KIND_LABEL,
  markRepliesSeen, pendingOf, proposalText, replyText, STATUS_LABEL, unreadRepliesOf, withdraw,
  type Proposal,
} from './proposals'

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
  const payload = resolveApps({ master, teams, failed: [] })
  base = Sched.schedule(payload.apps, { ...Sched.DEFAULT_CFG, rooms: 4, days: 0, sessions: 8, amSessions: 4 })
}, 60_000)

const emptySpot = (s: EditState, day = 0): Spot => {
  for (let d = day; d < s.base.totalDays; d++)
    for (let slot = 0; slot < s.base.cfg.sessions; slot++)
      for (let room = 0; room < s.base.cfg.rooms; room++)
        if (!atSpot(s.placed, { day: d, slot, room })) return { day: d, slot, room }
  throw new Error('빈 칸 없음')
}
const teamOf = (s: EditState) => s.placed[0].teams[0]
const propose = (s: EditState, over: Partial<Parameters<typeof createProposal>[1]> = {}, list: Proposal[] = []) => {
  const who = s.placed[0]
  return createProposal(list, {
    fromTeam: teamOf(s), fromName: '박팀장', kind: 'move',
    appId: who.app.id, appName: who.app.name,
    from: { day: who.day, slot: who.slot, room: who.room },
    to: emptySpot(s), reason: '팀장 회의가 겹칩니다',
    ...over,
  })
}

describe('제안 만들기', () => {
  it('ULID·순번·시각·대기 상태를 갖춘다', () => {
    const s = initEdit(base)
    const p = propose(s)
    expect(p.id).toHaveLength(26)
    expect(p.seq).toBe(1)
    expect(p.status).toBe('pending')
    expect(p.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(p.reason).toBeTruthy()
  })

  it('순번은 큐 길이를 따른다', () => {
    const s = initEdit(base)
    const first = propose(s)
    const second = propose(s, {}, [first])
    expect(second.seq).toBe(2)
  })

  it('사람이 읽는 문장으로 요약된다', () => {
    const s = initEdit(base)
    const p = propose(s)
    const text = proposalText(base, p)
    expect(text).toContain(p.appName)
    expect(text).toMatch(/→/)
    expect(text).not.toMatch(/undefined|NaN/)
  })

  it('종류별 문장이 다르다', () => {
    const s = initEdit(base)
    const a = s.placed[0], b = s.placed[3]
    const swap = propose(s, { kind: 'swap', peerAppId: b.app.id, peerAppName: b.app.name, to: null })
    const rm = propose(s, { kind: 'remove', to: null })
    expect(proposalText(base, swap)).toContain('교환')
    expect(proposalText(base, swap)).toContain(b.app.name)
    expect(proposalText(base, rm)).toContain('배정 취소')
    expect(a.app.name).toBeTruthy()
  })
})

describe('적용 가능 판정', () => {
  it('빈 칸으로 옮기는 제안은 적용할 수 있다', () => {
    const s = initEdit(base)
    expect(isApplicable(s, propose(s))).toEqual({ ok: true })
  })

  it('이미 찬 자리면 사유와 함께 막는다', () => {
    const s = initEdit(base)
    const a = s.placed[0], occupied = s.placed[5]
    const p = propose(s, { to: { day: occupied.day, slot: occupied.slot, room: occupied.room } })
    const out = isApplicable(s, p)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.why).toContain(occupied.app.name)
      expect(out.why).toContain('교환')          // 다음에 할 일을 알려준다
    }
    expect(a).toBeTruthy()
  })

  it('간사가 이미 빼낸 사람의 제안은 막는다', () => {
    let s = initEdit(base)
    const p = propose(s)
    s = editReducer(s, { type: 'remove', appId: p.appId })
    const out = isApplicable(s, p)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain(p.appName)
  })

  it('배정 취소 제안은 그 사람이 배정돼 있어야 한다', () => {
    let s = initEdit(base)
    const p = propose(s, { kind: 'remove', to: null })
    expect(isApplicable(s, p).ok).toBe(true)
    s = editReducer(s, { type: 'remove', appId: p.appId })
    expect(isApplicable(s, p).ok).toBe(false)
  })
})

describe('승인', () => {
  it('편성표에 실제로 반영되고 이벤트가 남는다', () => {
    const s = initEdit(base)
    const p = propose(s)
    const next = applyProposal(s, p, '김간사')
    const moved = next.placed.find(x => x.app.id === p.appId)!
    expect({ day: moved.day, slot: moved.slot, room: moved.room }).toEqual(p.to)
    expect(next.events).toHaveLength(1)
    expect(next.events[0].op).toBe('move')
    expect(next.events[0].actorName).toBe('김간사')      // 누가 반영했는지 이력에 남는다
  })

  it('교환 제안도 그대로 반영된다', () => {
    const s = initEdit(base)
    const a = s.placed[0], b = s.placed[4]
    const pa = { day: a.day, slot: a.slot, room: a.room }
    const pb = { day: b.day, slot: b.slot, room: b.room }
    const p = propose(s, { kind: 'swap', peerAppId: b.app.id, peerAppName: b.app.name, to: null })
    const next = applyProposal(s, p, '김간사')
    const na = next.placed.find(x => x.app.id === a.app.id)!
    const nb = next.placed.find(x => x.app.id === b.app.id)!
    expect({ day: na.day, slot: na.slot, room: na.room }).toEqual(pb)
    expect({ day: nb.day, slot: nb.slot, room: nb.room }).toEqual(pa)
  })

  it('배정 취소 제안은 미배정으로 보낸다', () => {
    const s = initEdit(base)
    const p = propose(s, { kind: 'remove', to: null })
    const next = applyProposal(s, p, '김간사')
    expect(next.unplaced.some(a => a.id === p.appId)).toBe(true)
  })

  it('승인 뒤에도 되돌리기가 된다 — 보통 편집과 같은 이벤트다', () => {
    const s = initEdit(base)
    const p = propose(s)
    const home = s.placed.find(x => x.app.id === p.appId)!
    let next = applyProposal(s, p, '김간사')
    next = editReducer(next, { type: 'undo' })
    const back = next.placed.find(x => x.app.id === p.appId)!
    expect({ day: back.day, slot: back.slot, room: back.room })
      .toEqual({ day: home.day, slot: home.slot, room: home.room })
  })
})

describe('결재와 회신', () => {
  it('승인은 결재자·시각을 남기고 회신 문장을 만든다', () => {
    const s = initEdit(base)
    const p = decide(propose(s), 'approved', '김간사', '')
    expect(p.status).toBe('approved')
    expect(p.decidedBy).toBe('김간사')
    expect(p.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(replyText(p)).toContain('승인')
  })

  it('거절 회신에는 사유가 그대로 실린다', () => {
    const s = initEdit(base)
    const why = '그 시간에는 김총이 면접관이 AI솔루션팀 면접에 들어가 있습니다. 14:10 이후로 다시 제안해 주세요.'
    const p = decide(propose(s), 'rejected', '김간사', why)
    const reply = replyText(p)
    expect(reply).toContain('거절')
    expect(reply).toContain(why)                       // 디테일이 잘리지 않는다
  })

  it('승인 메모를 적으면 회신에 함께 간다', () => {
    const s = initEdit(base)
    const p = decide(propose(s), 'approved', '김간사', '요청대로 오후로 옮겼습니다.')
    expect(replyText(p)).toContain('요청대로 오후로 옮겼습니다.')
  })

  it('대기 중이면 기다린다고 알린다', () => {
    expect(replyText(propose(initEdit(base)))).toContain('기다리는')
  })

  it('큐를 대기와 처리분으로 가른다', () => {
    const s = initEdit(base)
    const a = propose(s)
    const b = decide(propose(s, {}, [a]), 'rejected', '김간사', '불가')
    const list = [a, b]
    expect(pendingOf(list)).toHaveLength(1)
    expect(decidedOf(list)).toHaveLength(1)
  })

  it('상태·종류 이름표가 모두 한국어다', () => {
    for (const v of Object.values(STATUS_LABEL)) expect(v).toMatch(/[가-힣]/)
    for (const v of Object.values(KIND_LABEL)) expect(v).toMatch(/[가-힣]/)
  })
})

describe('CSV 내보내기', () => {
  it('BOM 으로 시작한다 — 엑셀에서 한글이 깨지지 않게', () => {
    const csv = toCsv(buildRows(base, initEdit(base)), '없음')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('머리글과 배정 인원만큼의 줄이 나온다', () => {
    const s = initEdit(base)
    const lines = toCsv(buildRows(base, s), '없음').trimEnd().split('\r\n')
    expect(lines[0]).toContain('지원자')
    expect(lines).toHaveLength(s.placed.length + 1)
  })

  it('쉼표가 든 값은 따옴표로 감싼다 (합동면접 팀 목록)', () => {
    const s = initEdit(base)
    const csv = toCsv(buildRows(base, s), '없음')
    const joint = s.placed.find(p => p.teams.length > 1)!
    expect(csv).toContain(`"${joint.teams.join(', ')}"`)
  })

  it('따옴표는 겹쳐 쓴다', () => {
    expect(toCsv([{ a: '그는 "말했다"' }], '없음')).toContain('"그는 ""말했다"""')
  })

  it('빈 목록이면 안내 문구를 낸다', () => {
    expect(toCsv([], '고친 것이 없습니다.')).toContain('고친 것이 없습니다.')
  })

  it('변경 요약도 CSV 로 나온다', () => {
    let s = initEdit(base)
    s = editReducer(s, { type: 'move', appId: s.placed[0].app.id, to: emptySpot(s) })
    const lines = toCsv(buildChanges(base, s), '없음').trimEnd().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('이전')
  })
})

describe('그림 내보내기', () => {
  it('전 일자를 한 장에 담을 크기를 잡는다', () => {
    const all = planImage(base)
    const one = planImage(base, { day: 0 })
    expect(all.days).toHaveLength(base.totalDays)
    expect(one.days).toEqual([0])
    expect(all.height).toBeGreaterThan(one.height)
    expect(all.width).toBe(one.width)
    expect(all.width).toBeGreaterThan(900)
  })

  it('파일 이름이 날짜 범위를 알려준다', () => {
    const at = new Date(2026, 8, 2, 14, 3)
    expect(imageNameOf(at)).toBe('면접편성_20260902_1403_전체.png')
    expect(imageNameOf(at, 1)).toBe('면접편성_20260902_1403_2일차.png')
  })

  it('표식 좌표가 화면과 같은 규칙으로 나온다', () => {
    let s = initEdit(base)
    const m = s.placed.find(p => p.edu === '석사')!
    s = editReducer(s, { type: 'move', appId: m.app.id, to: emptySpot(s, 0) })
    const v = judge(base, s.placed, s.acks)
    const map = marksBySpot(v.findings, s.placed)
    const moved = s.placed.find(p => p.app.id === m.app.id)!
    expect(map.has(`${moved.day}|${moved.slot}|${moved.room}`)).toBe(true)
  })
})

describe('제자리 제안', () => {
  it('지금 있는 자리로 옮기는 제안은 처리할 수 없다고 알린다', () => {
    const s = initEdit(base)
    const who = s.placed[0]
    const p = propose(s, { to: { day: who.day, slot: who.slot, room: who.room } })
    const out = isApplicable(s, p)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('바뀌는 것이 없습니다')
  })
})

describe('종 알림 — 역할마다 뜻이 다르다', () => {
  const team = '전극기술팀'
  const make = (over = {}) => ({
    ...propose(initEdit(base)), fromTeam: team, ...over,
  }) as Proposal

  it('간사의 종에는 대기 중인 요청만 뜬다', () => {
    const list = [make(), make({ status: 'approved' }), make({ status: 'rejected' })]
    expect(inboxOf(list)).toHaveLength(1)
  })

  it('처리하면 간사의 종에서 곧바로 빠진다', () => {
    let list = [make(), make()]
    expect(inboxOf(list)).toHaveLength(2)
    list = [decide(list[0], 'approved', '김간사', ''), list[1]]
    expect(inboxOf(list)).toHaveLength(1)
    list = [list[0], decide(list[1], 'rejected', '김간사', '불가')]
    expect(inboxOf(list)).toHaveLength(0)
  })

  it('팀의 종에는 처리됐는데 아직 안 본 회신만 뜬다', () => {
    const list = [
      make(),                                                   // 대기 — 회신이 아직 없다
      decide(make(), 'approved', '김간사', ''),                  // 안 봤다
      { ...decide(make(), 'rejected', '김간사', '불가'), seenByTeamAt: '2026-09-02T10:00:00+09:00' },
    ]
    const unread = unreadRepliesOf(list, team)
    expect(unread).toHaveLength(1)
    expect(unread[0].status).toBe('approved')
  })

  it('우리 팀 회신만 본다 — 다른 팀 것은 뜨지 않는다', () => {
    const list = [decide(make({ fromTeam: '미술팀' }), 'approved', '김간사', '')]
    expect(unreadRepliesOf(list, team)).toHaveLength(0)
    expect(unreadRepliesOf(list, '미술팀')).toHaveLength(1)
  })

  it('화면을 열면 회신이 읽은 것으로 바뀌어 종에서 빠진다', () => {
    const list = [decide(make(), 'approved', '김간사', ''), decide(make(), 'rejected', '김간사', '불가')]
    expect(unreadRepliesOf(list, team)).toHaveLength(2)
    const after = markRepliesSeen(list, team)
    expect(unreadRepliesOf(after, team)).toHaveLength(0)
    expect(after.every(p => p.seenByTeamAt)).toBe(true)
  })

  it('대기 중인 요청은 읽음 표시를 받지 않는다 — 회신이 아직 없다', () => {
    const after = markRepliesSeen([make()], team)
    expect(after[0].seenByTeamAt).toBeUndefined()
  })

  it('이미 읽은 회신의 시각은 덮어쓰지 않는다', () => {
    const at = '2026-09-02T10:00:00+09:00'
    const after = markRepliesSeen([{ ...decide(make(), 'approved', '김간사', ''), seenByTeamAt: at }], team)
    expect(after[0].seenByTeamAt).toBe(at)
  })
})

describe('승인 되돌리기', () => {
  const team = '전극기술팀'

  it('승인으로 생긴 편집 이벤트가 어느 요청인지 기억한다', () => {
    const s = initEdit(base)
    const p = { ...propose(s), fromTeam: team } as Proposal
    const next = applyProposal(s, p, '김간사')
    expect(next.events[0].proposalId).toBe(p.id)
  })

  it('손으로 옮긴 편집에는 요청 연결이 없다', () => {
    let s = initEdit(base)
    s = editReducer(s, { type: 'move', appId: s.placed[0].app.id, to: emptySpot(s) })
    expect(s.events[0].proposalId).toBeUndefined()
  })

  it('철회하면 대기 중으로 돌아가고 결재 흔적이 지워진다', () => {
    const p = decide({ ...propose(initEdit(base)), fromTeam: team } as Proposal, 'approved', '김간사', '옮겼습니다')
    const back = withdraw(p)
    expect(back.status).toBe('pending')
    expect(back.decidedAt).toBeUndefined()
    expect(back.decidedBy).toBeUndefined()
    expect(back.note).toBeUndefined()
    expect(back.withdrawnAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('팀에게 승인이 취소됐다고 알린다 — 「승인됨」이 남지 않는다', () => {
    const p = decide({ ...propose(initEdit(base)), fromTeam: team } as Proposal, 'approved', '김간사', '옮겼습니다')
    expect(replyText(p)).toContain('승인')
    const back = withdraw(p)
    expect(replyText(back)).toContain('되돌렸습니다')
    expect(replyText(back)).not.toContain('승인되었습니다')
  })

  it('이미 읽은 회신이라도 철회하면 팀 종에 다시 뜬다', () => {
    const seen = {
      ...decide({ ...propose(initEdit(base)), fromTeam: team } as Proposal, 'approved', '김간사', ''),
      seenByTeamAt: '2026-09-02T10:00:00+09:00',
    }
    expect(unreadRepliesOf([seen], team)).toHaveLength(0)
    const back = withdraw(seen)
    expect(back.seenByTeamAt).toBeUndefined()
    expect(unreadRepliesOf([back], team)).toHaveLength(1)
  })

  it('철회 건도 읽으면 종에서 빠진다', () => {
    const back = withdraw(decide({ ...propose(initEdit(base)), fromTeam: team } as Proposal, 'approved', '김간사', ''))
    const after = markRepliesSeen([back], team)
    expect(unreadRepliesOf(after, team)).toHaveLength(0)
  })

  it('되돌린 뒤 다시 승인할 수 있다 — 대기 중으로 돌아왔으므로', () => {
    const s = initEdit(base)
    const p = { ...propose(s), fromTeam: team } as Proposal
    const applied = applyProposal(s, p, '김간사')
    const undone = editReducer(applied, { type: 'undo' })
    expect(undone.events).toHaveLength(0)
    const back = withdraw(decide(p, 'approved', '김간사', ''))
    expect(inboxOf([back])).toHaveLength(1)
    expect(isApplicable(undone, back).ok).toBe(true)
  })
})

describe('승인하면 생기는 일 — 미리 알림', () => {
  const team = '전극기술팀'

  it('빈 칸으로 옮기는 평범한 요청은 알릴 것이 없다', () => {
    const s = initEdit(base)
    const p = { ...propose(s), fromTeam: team } as Proposal
    const e = effectOf(base, s, p)
    expect(e.alerts).toHaveLength(0)
  })

  it('면접관이 겹치는 자리면 승인 전에 알려 준다', () => {
    const s = initEdit(base)
    // 면접관을 공유하는 두 사람을 찾아, 한쪽을 다른 쪽 시간대의 빈 조로 옮기는 요청
    const freeRoomAt = (day: number, slot: number) => {
      for (let r = 0; r < base.cfg.rooms; r++) if (!atSpot(s.placed, { day, slot, room: r })) return r
      return -1
    }
    let a = null, b = null, room = -1
    outer: for (const x of s.placed) for (const y of s.placed) {
      if (x === y || (x.day === y.day && x.slot === y.slot)) continue
      if (!x.interviewers.some(i => y.interviewers.includes(i))) continue
      const r = freeRoomAt(y.day, y.slot)        // 그 시간대에 놓을 빈 조가 있어야 한다
      if (r < 0) continue
      a = x; b = y; room = r; break outer
    }
    expect(a).toBeTruthy()
    expect(room).toBeGreaterThanOrEqual(0)

    const p = { ...propose(s), fromTeam: team, appId: a!.app.id, appName: a!.app.name,
      from: { day: a!.day, slot: a!.slot, room: a!.room },
      to: { day: b!.day, slot: b!.slot, room } } as Proposal
    const e = effectOf(base, s, p)
    expect(e.alerts.length).toBeGreaterThan(0)
    expect(e.alerts.join(' ')).toMatch(/중복/)
  })

  it('알리기만 하고 승인을 막지는 않는다', () => {
    const s = initEdit(base)
    const occupiedSlot = s.placed[0]
    let room = -1
    for (let r = 0; r < base.cfg.rooms; r++) if (!atSpot(s.placed, { day: occupiedSlot.day, slot: occupiedSlot.slot, room: r })) { room = r; break }
    if (room < 0) return
    const mate = s.placed.find(x => x.teams.some(t => occupiedSlot.teams.includes(t)) && x.app.id !== occupiedSlot.app.id)
    if (!mate) return
    const p = { ...propose(s), fromTeam: team, appId: mate.app.id, appName: mate.app.name,
      from: { day: mate.day, slot: mate.slot, room: mate.room },
      to: { day: occupiedSlot.day, slot: occupiedSlot.slot, room } } as Proposal
    expect(isApplicable(s, p).ok).toBe(true)      // 빈 칸이므로 승인 자체는 가능하다
  })

  it('블록이 쪼개지면 면접방 이동 증가를 센다', () => {
    const s = initEdit(base)
    const blocks = Sched.blocksOf(s.placed as never).filter(b => b.apps.length >= 3)
    if (!blocks.length) return
    const victim = blocks[0].apps[1]
    const to = emptySpot(s, Math.min(base.totalDays - 1, blocks[0].day + 1))
    const p = { ...propose(s), fromTeam: team, appId: victim.app.id, appName: victim.app.name,
      from: { day: victim.day, slot: victim.slot, room: victim.room }, to } as Proposal
    expect(effectOf(base, s, p).linkDelta).toBeGreaterThan(0)
  })

  it('배정 취소 요청은 중복을 만들지 않는다', () => {
    const s = initEdit(base)
    const p = { ...propose(s), fromTeam: team, kind: 'remove', to: null } as Proposal
    expect(effectOf(base, s, p).alerts).toHaveLength(0)
  })
})
