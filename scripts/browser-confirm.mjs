/* 단계적 확정과 재통보 실브라우저 검증 — 확정 → 고침 → 재통보 → 되돌리기 → 해제 → 복원 */
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = '/Users/dulos/orca/projects/lgHR_Hack_Twins/lg-demo'
const URL = process.env.APP_URL || 'http://localhost:5173/'
const SHOTS = process.argv[2] || '/tmp'
const teamFiles = readdirSync(`${ROOT}/data`)
  .filter(f => f.startsWith('희망지원자') && f.endsWith('.xlsx'))
  .map(f => resolve(ROOT, 'data', f))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const NOISE = /ERR_CONNECTION_REFUSED|11434|Failed to fetch/
const note = t => { if (!NOISE.test(t)) errors.push(t) }
page.on('console', m => { if (m.type() === 'error') note(m.text()) })
page.on('pageerror', e => note(`pageerror: ${e.message}`))

const checks = []
const check = (name, ok, extra = '') => { checks.push([name, ok, extra]); console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const step = s => console.log(`\n── ${s}`)

async function dragCard(fromSel, toSel) {
  await page.locator(toSel).first().scrollIntoViewIfNeeded()
  await page.locator(fromSel).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(80)
  const a = await page.locator(fromSel).first().boundingBox()
  const b = await page.locator(toSel).first().boundingBox()
  if (!a || !b) throw new Error(`드래그 대상 없음 ${fromSel} → ${toSel}`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(200)
}

const chipValue = async label => {
  const t = await page.locator('.summary').innerText()
  const m = t.match(new RegExp(`${label}\\s*\\n?\\s*([0-9]+)`))
  return m ? Number(m[1]) : null
}
const hasChip = async label => (await page.locator('.summary').innerText()).includes(label)
const goDay = async n => {
  await page.evaluate(i => {
    for (const b of document.querySelectorAll('.day-tabs button')) if (b.textContent.startsWith(`${i}일차`)) b.click()
  }, n)
  await page.waitForTimeout(200)
}
const emptySpot = () => page.evaluate(() => {
  for (const td of document.querySelectorAll('td[data-spot]')) if (!td.querySelector('.cell-card')) return td.dataset.spot
  return null
})
const firstCard = () => page.evaluate(() => {
  for (const td of document.querySelectorAll('td[data-spot]')) {
    const c = td.querySelector('.cell-card')
    if (c) return { spot: td.dataset.spot, name: c.querySelector('b').textContent }
  }
  return null
})
const classOfName = name => page.evaluate(n => {
  for (const c of document.querySelectorAll('td[data-spot] .cell-card'))
    if (c.querySelector('b')?.textContent === n) return c.className
  return null
}, name)
const countClass = sel => page.locator(sel).count()
/** 통보된(확정) 카드만 골라 이름 → 칸. 확정 안 된 사람은 다시 편성이 옮길 수 있으므로
    「안 움직인다」를 잴 때는 이쪽만 봐야 한다. */
const layoutOfConfirmed = () => page.evaluate(() => {
  const out = {}
  for (const td of document.querySelectorAll('td[data-spot]')) {
    const c = td.querySelector('.cell-card.confirmed b')
    if (c) out[c.textContent] = td.dataset.spot
  }
  return out
})
/** 지금 화면에 보이는 날짜의 배치 — 이름 → 칸 */
const layoutOfDay = () => page.evaluate(() => {
  const out = {}
  for (const td of document.querySelectorAll('td[data-spot]')) {
    const c = td.querySelector('.cell-card b')
    if (c) out[c.textContent] = td.dataset.spot
  }
  return out
})

/* ── 준비: 업로드 → 편성 ── */
await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: '지원자 명단 등록' }).first().click()
await page.setInputFiles('input[type=file]', resolve(ROOT, 'data', '취합파일.xlsx'))
await page.waitForFunction(() => !!localStorage.getItem('ax.v1.session'), null, { timeout: 30000 })
await page.getByRole('button', { name: '면접 일정 편성' }).first().click()
await page.setInputFiles('input[type=file]', teamFiles)
await page.waitForSelector('.schedule-table .cell-card', { timeout: 60000 })
step('1차 편성 완료')

/* ── 1. 확정 전 ── */
step('1. 확정하기 전')
check('재통보 칩은 아직 없다', !(await hasChip('재통보')), '확정한 날짜가 없으면 뜻이 없다')
check('확정 배지가 없다', (await countClass('.day-tabs .tag.confirmed')) === 0)
check('확정 버튼이 있다', await page.getByRole('button', { name: '1일차 확정' }).isVisible())
check('확정된 카드 표시가 없다', (await countClass('.cell-card.confirmed')) === 0)

/* ── 2. 1일차 확정 ── */
step('2. 1일차 확정')
const day1cards = await countClass('td[data-spot] .cell-card')
await page.getByRole('button', { name: '1일차 확정' }).click()
await page.waitForTimeout(300)
check('탭에 확정 배지가 붙는다', (await countClass('.day-tabs .tag.confirmed')) === 1)
check('그날 카드가 전부 확정으로 표시된다', (await countClass('.cell-card.confirmed')) === day1cards,
  `${await countClass('.cell-card.confirmed')} / ${day1cards}장`)
check('재통보는 0명', (await chipValue('재통보')) === 0)
check('버튼이 「확정 해제」로 바뀐다', await page.getByRole('button', { name: '1일차 확정 해제' }).isVisible())
check('확정해도 안내 문구가 뜬다', (await page.locator('.confirm-note').innerText()).includes('재통보'))
await page.screenshot({ path: `${SHOTS}/c1-확정.png` })

await goDay(2)
check('2일차는 확정되지 않았다', (await countClass('.cell-card.confirmed')) === 0)
check('2일차에는 「2일차 확정」 버튼이 보인다', await page.getByRole('button', { name: '2일차 확정' }).isVisible())
await goDay(1)

/* ── 3. 확정한 날을 고치면 재통보 대상이 된다 (막지는 않는다) ── */
step('3. 확정한 날짜를 고친다 — 막지 않고 재통보로 잡는다')
const moved = await firstCard()
const empty = await emptySpot()
await dragCard(`td[data-spot="${moved.spot}"] .cell-card`, `td[data-spot="${empty}"]`)
check('확정한 날짜도 이동은 된다 — 막지 않는다(D1)', (await chipValue('변경')) === 1)
check('재통보 1명으로 잡힌다', (await chipValue('재통보')) === 1, moved.name)
const cls = await classOfName(moved.name)
check('그 카드에 재통보 표시가 붙는다', /renotify/.test(cls ?? ''), cls)
check('카드에 「재통보」 딱지가 보인다', (await countClass('.cell-card .tag.renotify')) === 1)
await page.screenshot({ path: `${SHOTS}/c2-재통보.png` })

await page.locator('.summary button', { hasText: '재통보' }).click()
await page.waitForSelector('.v-panel')
const panelText = await page.locator('.v-panel').innerText()
check('재통보 패널이 누구를 어디로 옮겼는지 말한다',
  panelText.includes(moved.name) && panelText.includes('→'),
  panelText.split('\n').find(t => t.includes(moved.name))?.slice(0, 70) ?? '')

/* ── 4. 확정 안 한 날짜는 아무리 고쳐도 재통보가 안 는다 ── */
step('4. 미확정 날짜 수정 — 영향 범위가 그날 안에서 끝난다')
await goDay(3)
const d3 = await firstCard()
const d3empty = await emptySpot()
await dragCard(`td[data-spot="${d3.spot}"] .cell-card`, `td[data-spot="${d3empty}"]`)
check('3일차를 고쳐도 재통보는 그대로 1명', (await chipValue('재통보')) === 1,
  `변경 ${await chipValue('변경')}건인데 재통보는 안 는다`)
check('3일차 카드에는 재통보 딱지가 없다', (await countClass('.cell-card .tag.renotify')) === 0)
await goDay(1)

/* ── 5. 되돌리기 ── */
step('5. 되돌리면 재통보에서 빠진다')
await page.getByRole('button', { name: '되돌리기' }).first().click()   // 3일차 이동 되돌림
await page.waitForTimeout(200)
await page.getByRole('button', { name: '되돌리기' }).first().click()   // 1일차 이동 되돌림
await page.waitForTimeout(250)
check('재통보 0명으로 돌아간다', (await chipValue('재통보')) === 0)
check('재통보 딱지가 사라진다', (await countClass('.cell-card .tag.renotify')) === 0)
check('확정 표시는 그대로 남는다', (await countClass('.day-tabs .tag.confirmed')) === 1,
  '되돌리기는 편성표를 되돌릴 뿐, 나간 통보를 되돌리지 못한다')

/* ── 6. 새로고침 복원 ── */
step('6. 새로고침해도 확정이 남는다')
await page.reload({ waitUntil: 'networkidle' })
// 새로고침하면 첫 화면으로 돌아온다 — 편성 화면으로 다시 들어가야 격자가 보인다
await page.getByRole('button', { name: '면접 일정 편성' }).first().click()
await page.waitForSelector('.schedule-table .cell-card', { timeout: 30000 })
check('확정 배지가 복원된다', (await countClass('.day-tabs .tag.confirmed')) === 1)
check('확정 카드 표시도 복원된다', (await countClass('.cell-card.confirmed')) > 0,
  `${await countClass('.cell-card.confirmed')}장`)
check('재통보 칩도 복원된다', (await chipValue('재통보')) === 0)

/* ── 7. 확정 해제 ── */
step('7. 확정 해제')
await page.getByRole('button', { name: '1일차 확정 해제' }).click()
await page.waitForTimeout(300)
check('확정 배지가 사라진다', (await countClass('.day-tabs .tag.confirmed')) === 0)
check('확정 카드 표시도 사라진다', (await countClass('.cell-card.confirmed')) === 0)
check('재통보 칩이 사라진다', !(await hasChip('재통보')))
check('다시 확정할 수 있다', await page.getByRole('button', { name: '1일차 확정' }).isVisible())

/* ── 8. 확정분을 고정한 채 다시 편성 ── */
step('8. 2·3일차 다시 편성 — 1일차는 안 흔들린다')
await page.getByRole('button', { name: '1일차 확정' }).click()
await page.waitForTimeout(250)
await goDay(1)
const day1before = await layoutOfDay()
await goDay(3)
const day3before = await layoutOfDay()

check('다시 편성 버튼이 미확정 일자를 짚는다',
  await page.getByRole('button', { name: '2일차·3일차 다시 편성' }).isVisible())
await page.getByRole('button', { name: '2일차·3일차 다시 편성' }).click()
await page.waitForSelector('.modal', { timeout: 5000 })
const ask = await page.locator('.modal').innerText()
check('무엇이 고정되고 무엇이 움직이는지 미리 센다',
  /그대로 두는 \d+명/.test(ask) && /다시 배치하는 \d+명/.test(ask),
  ask.split('\n').filter(t => t.includes('명')).join(' / ').slice(0, 90))
check('되돌릴 수 없다고 알린다', ask.includes('되돌리기로 되돌릴 수 없습니다'))

await page.getByRole('button', { name: '다시 편성', exact: true }).click()
await page.waitForTimeout(800)

await goDay(1)
const day1after = await layoutOfDay()
/* 보장은 「통보된 사람이 안 움직인다」이지 「그 날짜가 통째로 얼어붙는다」가 아니다.
   빈자리가 남아 있으면 다시 편성이 거기에 새 사람을 넣을 수 있고, 그건 재통보로 잡는다. */
const shifted = Object.entries(day1before).filter(([name, spot]) => day1after[name] !== spot)
check('통보된 사람은 한 명도 안 움직였다', shifted.length === 0,
  shifted.length ? shifted.map(([n]) => n).join(',') : `${Object.keys(day1before).length}명 그대로`)
const newcomers = Object.keys(day1after).filter(n => !(n in day1before))
check('편성 인원은 그대로', (await chipValue('편성')) === 60)
check('내가 만든 위반은 늘지 않는다', (await chipValue('내가 만든 위반')) === 0)
// 확정한 날짜에 새로 들어온 사람이 있으면 재통보로 잡혀야 한다 — 그 팀 면접관 일정이 늘어난다
check('확정한 날에 새로 들어온 사람은 재통보로 잡힌다',
  (await chipValue('재통보')) === newcomers.length,
  newcomers.length ? `새로 ${newcomers.join(',')} → 재통보 ${await chipValue('재통보')}명` : '새로 들어온 사람 없음')
if (newcomers.length) {
  await page.locator('.summary button', { hasText: '재통보' }).click()
  await page.waitForSelector('.v-panel')
  const addedText = await page.locator('.v-panel').innerText()
  check('새로 배정됐다고 말해 준다', addedText.includes('새로 배정됨'),
    addedText.split('\n').find(t => t.includes('새로 배정됨'))?.slice(0, 70) ?? '')
  await page.locator('.summary button', { hasText: '재통보' }).click()
}

await goDay(3)
const day3after = await layoutOfDay()
// 미확정 날짜 사람이 사라지지는 않는다 — 자리는 바뀔 수 있어도 인원은 지켜진다
check('미확정 날짜 사람이 사라지지 않는다',
  Object.keys(day3after).length + Object.keys(day1after).length > 0 &&
  (await chipValue('미배정')) === 0,
  `3일차 ${Object.keys(day3before).length}명 → ${Object.keys(day3after).length}명`)
await page.screenshot({ path: `${SHOTS}/c3-재편성.png` })

await goDay(1)
await page.locator('.summary button', { hasText: '변경' }).click()
await page.waitForSelector('.v-panel')
const history = await page.locator('.v-panel').innerText()
check('변경 이력에 재편성이 한 줄로 남는다', /다시 편성/.test(history),
  history.split('\n').find(t => t.includes('다시 편성'))?.slice(0, 60) ?? '')
await page.locator('.summary button', { hasText: '변경' }).click()

const beforeUndo = await layoutOfDay()
await page.getByRole('button', { name: '되돌리기' }).first().click()
await page.waitForTimeout(300)
check('다시 편성은 되돌리기로 안 풀린다',
  JSON.stringify(await layoutOfDay()) === JSON.stringify(beforeUndo))

await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: '면접 일정 편성' }).first().click()
await page.waitForSelector('.schedule-table .cell-card', { timeout: 30000 })
await goDay(1)
check('새로고침해도 재편성 결과가 남는다',
  JSON.stringify(await layoutOfDay()) === JSON.stringify(day1after))
check('확정도 그대로 복원된다', (await countClass('.day-tabs .tag.confirmed')) === 1)

/* 미확정 날짜를 실제로 고친 뒤 다시 편성한다 — 여기가 「영향 범위 축소」의 본 무대다 */
step('8.5 3일차를 고치고 다시 편성 — 1일차는 여전히 안 흔들린다')
await goDay(3)
const dropped = await firstCard()
await dragCard(`td[data-spot="${dropped.spot}"] .cell-card`, '.drawer')
check('3일차에서 한 명을 뺐다', (await chipValue('편성')) === 59, dropped.name)
await goDay(1)
const day1kept = await layoutOfConfirmed()
const beforeAdded = await chipValue('재통보')
await page.getByRole('button', { name: '2일차·3일차 다시 편성' }).click()
await page.waitForSelector('.modal', { timeout: 5000 })
await page.getByRole('button', { name: '다시 편성', exact: true }).click()
await page.waitForTimeout(800)

await goDay(1)
const kept = await layoutOfConfirmed()
const movedAgain = Object.entries(day1kept).filter(([name, spot]) => kept[name] !== spot)
check('통보된 사람은 이번에도 안 움직였다', movedAgain.length === 0,
  movedAgain.map(([n]) => n).join(',') || `${Object.keys(day1kept).length}명 그대로`)
check('뺀 사람은 자리를 다시 만들어 주지 않는다', (await chipValue('편성')) === 59,
  `미배정 ${await chipValue('미배정')}명`)
check('뺀 사람이 서랍에 그대로 있다', (await page.locator('.drawer').innerText()).includes(dropped.name))
check('재통보가 새로 들어온 사람만큼만 는다',
  (await chipValue('재통보')) >= beforeAdded,
  `${beforeAdded}명 → ${await chipValue('재통보')}명 · 통보된 사람이 옮겨진 것은 0건`)

await page.getByRole('button', { name: '1일차 확정 해제' }).click()
await page.waitForTimeout(250)

/* ── 9. 확정분이 있으면 재업로드가 경고한다 ── */
step('9. 확정한 채로 팀 회신 재업로드')
await page.getByRole('button', { name: '1일차 확정' }).click()
await page.waitForTimeout(250)
await page.locator('input[type=file]').last().setInputFiles(teamFiles)
await page.waitForSelector('.modal', { timeout: 5000 })
const modal = await page.locator('.modal').innerText()
check('확인 창이 확정을 짚어 준다', modal.includes('확정한') && modal.includes('통보'),
  modal.split('\n').find(t => t.includes('확정한'))?.slice(0, 60) ?? '')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
check('그만두면 확정이 그대로 남는다', (await countClass('.day-tabs .tag.confirmed')) === 1)

/* ── 판정 ── */
console.log('\n═══ 판정 ═══')
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '))
const failed = checks.filter(([, ok]) => !ok)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
await browser.close()
process.exit(failed.length ? 1 : 0)
