/* 편성 엔진 검사 — React·브라우저 없이 Node로만 돈다.
   tests/test_sched.mjs 를 옮긴 것이다. 단언은 한 줄도 바꾸지 않았고,
   바뀐 것은 (1) 러너를 node:test 로 (2) 경로 두 개뿐이다.

   실 데이터 회귀는 server/applicants.json 대신 tests/golden/payload.json 을 읽는다 —
   같은 build() 출력이고, 이제 이 파일이 이식 정확성의 정답지를 겸한다. */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

/* app/package.json 이 "type": "module" 이라 sched.js 는 ESM 으로 읽힌다.
   sched.js 는 UMD 꼴이라 module 이 없으면 globalThis.Sched 로 붙는다 — 브라우저와 같은 경로다. */
await import('../sched.js')
const S = globalThis.Sched
assert.ok(S?.scheduleAuto, 'sched.js 로드 실패 — globalThis.Sched 가 비었다')

/* 합성 데이터 — 팀 수요·학력 분포를 조절할 수 있게 만든다 */
function synth(spec) {
  const apps = []
  let id = 1000
  spec.forEach(([edu, team, n, iv]) => {
    for (let i = 0; i < n; i++)
      apps.push({ id: id++, name: `${team}${i}`, edu, teams: [team],
                  interviewers: [iv || `${team}면접관`] })
  })
  return apps
}

// ---------- 결정성 ----------
test('동일 입력 2회 실행 시 배치가 완전히 같다', () => {
  const apps = synth([['학사', 'A', 12], ['석사', 'B', 7], ['박사', 'C', 2]])
  const key = r => r.placed.map(p => `${p.app.id}@${p.day}/${p.slot}/${p.room}`).sort().join(',')
  assert.equal(key(S.scheduleAuto(apps, {})), key(S.scheduleAuto(apps, {})))
})

test('scheduleAuto 가 입력 apps 배열을 변형하지 않는다', () => {
  const apps = synth([['학사', 'A', 6]])
  const before = JSON.stringify(apps)
  S.scheduleAuto(apps, {})
  assert.equal(JSON.stringify(apps), before)
})

// ---------- 하드 제약 ①② — 여러 조건에서 항상 0건 ----------
for (const [label, spec, cfg, allowUnplaced] of [
  ['균등 3학력', [['학사', 'A', 20], ['석사', 'B', 10], ['박사', 'C', 3]], {}],
  ['단일 학력', [['학사', 'A', 30]], {}],
  ['한 팀 집중', [['학사', 'A', 40], ['석사', 'A', 5]], {}],
  ['세션 8 현행', [['학사', 'A', 12], ['학사', 'B', 9], ['석사', 'C', 6]], { sessions: 8, amSessions: 4 }],
  ['날짜 분리 모드', [['학사', 'A', 15], ['석사', 'B', 8]], { eduBoundary: 'day' }],
  ['첫타임 hard', [['학사', 'A', 10], ['학사', 'B', 4]], { avoidFirstSlot: 'hard' }, true],
]) {
  test(`①0 ②0 — ${label}`, () => {
    const r = S.scheduleAuto(synth(spec), cfg)
    const V = S.validate(r)
    assert.equal(V.r1.length, 0, '① 위반: ' + JSON.stringify(V.r1))
    assert.equal(V.r2.length, 0, '② 위반: ' + JSON.stringify(V.r2))
    if (!allowUnplaced) assert.equal(r.unplaced.length, 0, '미배정 발생')
  })
}

test('avoidFirstSlot:hard 는 미배정을 낼 수 있다 (공석 허용 모드의 대가)', () => {
  /* 블록 확장이 한 세션씩만 이루어지는데 그 세션이 첫 타임이면 hard 필터에 걸려 자리를 못 찾는다.
     ④를 하드로 올린 대가이므로 결함이 아니라 모드의 성질이다. 화면은 미배정 명단을 띄운다(§7). */
  const r = S.scheduleAuto(synth([['학사', 'A', 10], ['학사', 'B', 4]]), { avoidFirstSlot: 'hard' })
  assert.ok(r.unplaced.length > 0, 'hard 모드 미배정 재현 실패 — 엔진 동작이 바뀌었는지 확인')
  const V = S.validate(r)
  assert.equal(V.r4.length, 0, 'hard 모드인데 첫 타임에 배치됨')
  assert.equal(r.placed.length + r.unplaced.length, 14, '지원자가 사라지면 안 된다')
})

test('면접관을 공유하는 두 팀도 ② 위반이 없다', () => {
  const apps = [...synth([['학사', 'A', 8, '공유관']]), ...synth([['학사', 'B', 8, '공유관']])]
  const V = S.validate(S.scheduleAuto(apps, {}))
  assert.equal(V.r2.length, 0, JSON.stringify(V.r2))
})

test('합동면접(복수 팀)도 ② 위반이 없다', () => {
  const apps = synth([['학사', 'A', 10], ['학사', 'B', 10]])
  apps.slice(0, 4).forEach(a => { a.teams = ['A', 'B']; a.interviewers = ['A면접관', 'B면접관'] })
  const V = S.validate(S.scheduleAuto(apps, {}))
  assert.equal(V.r2.length, 0, JSON.stringify(V.r2))
})

// ---------- minDays 경계 ----------
test('⌈최대 팀 수요 ÷ 세션 수⌉ 를 낸다', () => {
  const apps = synth([['학사', 'A', 17], ['학사', 'B', 5]])
  assert.deepEqual(S.minDays(apps, { sessions: 14 }),
    { days: 2, team: 'A', requests: 17, sessions: 14 })
  assert.equal(S.minDays(apps, { sessions: 8 }).days, 3)   // 17/8 → 3
  assert.equal(S.minDays(apps, { sessions: 17 }).days, 1)  // 딱 떨어지면 1
  assert.equal(S.minDays(apps, { sessions: 18 }).days, 1)
})

test('합동면접은 참여 팀 모두에 카운트된다', () => {
  const apps = synth([['학사', 'A', 15]])
  apps.forEach(a => { a.teams = ['A', 'B'] })
  assert.equal(S.minDays(apps, { sessions: 14 }).requests, 15)
})

test('빈 입력은 0일', () => { assert.equal(S.minDays([], {}), 0) })

test('실제로 minDays 밑으로는 편성되지 않는다', () => {
  const apps = synth([['학사', 'A', 30]])
  const md = S.minDays(apps, { sessions: 14 }).days      // 30/14 → 3
  const r = S.scheduleAuto(apps, { days: 1 })            // 1일을 요구해도
  assert.ok(r.totalDays >= md, `${r.totalDays} < ${md}`)
})

// ---------- blocksOf ----------
test('연속 슬롯은 한 블록, 끊기면 나뉜다', () => {
  const mk = (day, room, team, slot) => ({ day, room, team, slot, app: { id: slot } })
  const b = S.blocksOf([
    mk(0, 0, 'A', 0), mk(0, 0, 'A', 1), mk(0, 0, 'A', 2),   // 연속 3 → 1블록
    mk(0, 0, 'A', 5),                                       // 끊김 → 별도
    mk(0, 1, 'A', 1),                                       // 다른 조 → 별도
    mk(1, 0, 'A', 0),                                       // 다른 날 → 별도
    mk(0, 0, 'B', 3),                                       // 다른 팀 → 별도
  ])
  assert.equal(b.length, 5)
  const first = b.find(x => x.day === 0 && x.room === 0 && x.team === 'A' && x.slotFrom === 0)
  assert.equal(first.slotTo, 2)
  assert.equal(first.apps.length, 3)
  assert.ok(b.every(x => x.apps.length === x.slotTo - x.slotFrom + 1))
})

test('편성 결과의 블록이 placed 를 빠짐없이 덮는다', () => {
  const r = S.scheduleAuto(synth([['학사', 'A', 12], ['석사', 'B', 6]]), {})
  const n = S.blocksOf(r.placed).reduce((a, b) => a + b.apps.length, 0)
  assert.equal(n, r.placed.length)
})

// ---------- 주말 건너뛰기 ----------
test('금요일 시작 3일이면 금·월·화', () => {
  const fri = '2026-08-21'                                  // 금
  assert.equal(new Date(fri + 'T00:00:00').getDay(), 5)
  const got = [0, 1, 2].map(i => S.dateOf(fri, i, true))
  assert.deepEqual(got.map(d => d.wd), ['금', '월', '화'])
  assert.deepEqual(got.map(d => d.iso), ['2026-08-21', '2026-08-24', '2026-08-25'])
})

test('시작일이 토요일이면 월요일로 민다', () => {
  assert.equal(S.dateOf('2026-08-22', 0, true).wd, '월')
})

test('skipWeekend 를 끄면 연속 캘린더일', () => {
  assert.deepEqual([0, 1, 2].map(i => S.dateOf('2026-08-21', i, false).wd), ['금', '토', '일'])
})

test('iso 가 로컬 날짜와 어긋나지 않는다', () => {
  assert.equal(S.dateOf('2026-08-17', 0, true).iso, '2026-08-17')
  assert.equal(S.dateOf('2026-08-17', 4, true).iso, '2026-08-21')
})

test('편성 결과의 dates 에 주말이 없다', () => {
  const r = S.scheduleAuto(synth([['학사', 'A', 90]]), { startDate: '2026-08-21' })
  assert.ok(r.totalDays >= 6, '주말을 넘길 만큼 길어야 의미가 있다')
  assert.ok(r.dates.every(d => d.wd !== '토' && d.wd !== '일'), JSON.stringify(r.dates))
})

// ---------- validate 정상 동작 ----------
test('일부러 만든 ① 위반을 잡아낸다', () => {
  const r = S.scheduleAuto(synth([['학사', 'A', 8], ['석사', 'B', 8]]), {})
  const bs = r.placed.find(p => p.edu === '석사')
  bs.day = r.placed[0].day; bs.slot = r.placed[0].slot      // 학사 세션에 석사를 끼워넣는다
  assert.ok(S.validate(r).r1.length > 0)
})

test('일부러 만든 ② 위반을 잡아낸다', () => {
  const r = S.scheduleAuto(synth([['학사', 'A', 8]]), {})
  r.placed[1].day = r.placed[0].day; r.placed[1].slot = r.placed[0].slot
  assert.ok(S.validate(r).r2.length > 0)
})

test('rooms:auto 로 validate 를 불러도 죽지 않는다 (§11 죽은 코드)', () => {
  const r = S.schedule(synth([['학사', 'A', 6]]), { rooms: 'auto' })
  r.cfg.rooms = 'auto'                                      // 정규화 전 상태를 재현
  assert.doesNotThrow(() => S.validate(r))
})

// ---------- 실 데이터 회귀 — 문서에 기록된 기대값 ----------
const jp = new URL('../../../../../tests/golden/payload.json', import.meta.url)
if (fs.existsSync(jp)) {
  const d = JSON.parse(fs.readFileSync(jp, 'utf8'))
  test('대상 60명 · 2일 · 피크 3조 · ①0 ②0 ③6 ④7', () => {
    assert.equal(d.apps.length, 60)
    assert.equal(d.excluded.length, 23)
    assert.equal(d.meta.requests_total, 109)
    assert.equal(d.meta.requests_matched, 69)
    const r = S.scheduleAuto(d.apps, {})
    const V = S.validate(r)
    assert.equal(r.placed.length, 60)
    assert.equal(r.unplaced.length, 0)
    assert.equal(r.totalDays, 2)
    assert.equal(r.roomsPlan.peak, 3)
    /* ⚠ ③④ 는 소프트 제약 건수라 payload 의 행 순서에 따라 달라진다 — 진짜 회귀 신호는
       ①② 하드 0건과 위의 인원·일수·피크다. 샘플 데이터 교체(제품명 「면접 AX」 개편) 후
       재생성된 payload 기준 ③6 ④7. 데이터를 다시 만들면 이 두 값만 갱신한다. */
    assert.deepEqual([V.r1.length, V.r2.length, V.r3.length, V.r4.length], [0, 0, 6, 7])
  })
  test('minDays 2일 — 미래혁신팀 17건 ÷ 14세션', () => {
    assert.deepEqual(S.minDays(d.apps, {}),
      { days: 2, team: '미래혁신팀', requests: 17, sessions: 14 })
  })
} else {
  test.skip('실 데이터 회귀 — tests/golden/payload.json 없음', () => {})
}

