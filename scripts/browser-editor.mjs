/* 편집기 실브라우저 검증 — 드래그 이동·교환·삭제·되돌리기·위반 표시·저장 복원 */
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

/** 겨냥한 칸이 실제로 잡혔는지 보고, 어긋나면 맞춘다.

    dnd-kit 은 포인터가 아니라 **끌고 있는 카드의 사각형**으로 대상을 고른다(closestCenter).
    행 높이가 카드 내용에 따라 달라서 td 중심을 겨냥해도 이웃 칸이 잡히는 경우가 있다.
    사람은 칸 색이 바뀌는 걸 보고 손을 조금 움직여 맞추므로 문제가 안 되지만, 스크립트는
    맞은 줄 알고 엉뚱한 칸에 놓아 버린다 — 실제로 그 탓에 붙들었다 뗀 것이 편집으로 남았다. */
const overSpot = () => page.evaluate(() => document.querySelector('td.over')?.dataset.spot ?? null)

async function aim(x, y, spot) {
  await page.mouse.move(x, y, { steps: 12 })
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(60)
    const over = await overSpot()
    if (over === spot) return { x, y }
    const want = await page.locator(`td[data-spot="${spot}"]`).boundingBox()
    const got = over ? await page.locator(`td[data-spot="${over}"]`).boundingBox() : null
    y += got ? (want.y + want.height / 2) - (got.y + got.height / 2) : -8
    await page.mouse.move(x, y, { steps: 4 })
  }
  if ((await overSpot()) !== spot) throw new Error(`칸을 겨냥하지 못했다: ${spot} (잡힌 칸 ${await overSpot()})`)
  return { x, y }
}

/** dnd-kit 은 PointerEvent 를 쓴다 — 사람이 끄는 것과 같은 순서로 보낸다 */
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
  const spot = toSel.match(/data-spot="([^"]+)"/)?.[1]
  if (spot) await aim(b.x + b.width / 2, b.y + b.height / 2, spot)
  else await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(180)
}

/** 놓지 않고 대상 위에 붙들어 둔 채 살펴본다 — 드래그 중에만 보이는 예고를 재려면 필요하다.
    끝나면 원래 칸으로 되돌려 떼기 때문에 편성표는 그대로다. */
async function holdOver(fromSel, toSel, fn) {
  await page.locator(toSel).first().scrollIntoViewIfNeeded()
  await page.locator(fromSel).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(80)
  const a = await page.locator(fromSel).first().boundingBox()
  const b = await page.locator(toSel).first().boundingBox()
  if (!a || !b) throw new Error(`드래그 대상 없음 ${fromSel} → ${toSel}`)
  const home = fromSel.match(/data-spot="([^"]+)"/)?.[1]
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 })
  const spot = toSel.match(/data-spot="([^"]+)"/)?.[1]
  if (spot) await aim(b.x + b.width / 2, b.y + b.height / 2, spot)
  else await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.waitForTimeout(160)
  try { await fn() } finally {
    // 원래 칸으로 되돌려 떼야 편성표가 그대로 남는다 — 여기서도 실제로 그 칸이 잡혔는지 본다
    if (home) await aim(a.x + a.width / 2, a.y + a.height / 2, home)
    else await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 8 })
    await page.waitForTimeout(80)
    await page.mouse.up()
    await page.waitForTimeout(160)
  }
}

const toneOf = spot => page.evaluate(sp => {
  const td = document.querySelector(`td[data-spot="${sp}"]`)
  if (!td) return null
  return ['good', 'warn', 'bad'].find(c => td.classList.contains(c)) ?? ''
}, spot)
const labelText = () => page.locator('.drag-label').innerText().catch(() => '')

const chipValue = async label => {
  const t = await page.locator('.summary').innerText()
  const m = t.match(new RegExp(`${label}\\s*\\n?\\s*([0-9]+)`))
  return m ? Number(m[1]) : null
}
const cellText = spot => page.locator(`td[data-spot="${spot}"]`).innerText().catch(() => '')
/** 이 사람이 지금 어느 칸에 있나 — 없으면 null */
const spotOfName = name => page.evaluate(n => {
  for (const td of document.querySelectorAll('td[data-spot]')) {
    const b = td.querySelector('.cell-card b')
    if (b && b.textContent === n) return td.dataset.spot
  }
  return null
}, name)
const eventCount = () => page.evaluate(() => {
  const raw = localStorage.getItem('ax.v1.session')
  return raw ? (JSON.parse(raw).edit?.events?.length ?? 0) : 0
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
console.log(`   ${(await page.locator('.summary').innerText()).replace(/\n/g, ' ')}`)
await page.screenshot({ path: `${SHOTS}/e1-편성직후.png` })

const placed0 = await chipValue('편성')
check('1차 편성 60명', placed0 === 60, `${placed0}명`)
check('편집 전 변경 0건', (await chipValue('변경')) === 0)
check('편집 전 「내가 만든 위반」 0건', (await chipValue('내가 만든 위반')) === 0,
  '기준선 잡음(첫 타임 등)이 섞이지 않는다')

/* ── 1. 빈 칸으로 이동 ── */
step('1. 빈 칸으로 드래그')
const emptySpot = await page.evaluate(() => {
  for (const td of document.querySelectorAll('td[data-spot]')) if (!td.querySelector('.cell-card')) return td.dataset.spot
  return null
})
const movedName = await page.locator('.schedule-table .cell-card b').first().innerText()
const homeSpot = await spotOfName(movedName)
await dragCard('.schedule-table .cell-card', `td[data-spot="${emptySpot}"]`)
const landed = await spotOfName(movedName)
check('카드가 다른 칸으로 옮겨졌다', landed !== null && landed !== homeSpot, `${movedName} ${homeSpot} → ${landed}`)
check('변경 1건으로 늘었다', (await chipValue('변경')) === 1)
check('저장에 이벤트가 기록됐다', (await eventCount()) === 1)
check('편성 인원은 그대로', (await chipValue('편성')) === 60)

/* ── 2. 되돌리기 ── */
step('2. 되돌리기')
await page.getByRole('button', { name: '되돌리기' }).first().click()
await page.waitForTimeout(200)
check('되돌리면 원래 칸으로 돌아온다', (await spotOfName(movedName)) === homeSpot, `→ ${await spotOfName(movedName)}`)
check('변경 0건으로 돌아간다', (await chipValue('변경')) === 0)
check('저장분도 0건', (await eventCount()) === 0)

/* ── 2.5 교환 예고 (놓기 전) ── */
step('2.5 교환 시 상대가 밀려갈 자리 예고')
/* 실데이터에서 「끄는 쪽은 깨끗한데 밀려나는 쪽이 부딪히는」 짝을 찾는다.
   이 절은 아직 아무것도 안 고친 시점이라 저장된 1차 편성이 화면과 같다. */
const swapPairs = await page.evaluate(() => {
  const raw = localStorage.getItem('ax.v1.session')
  if (!raw) return null
  const placed = JSON.parse(raw).schedule?.result?.placed ?? []
  const iv = p => p.interviewers ?? []
  const hits = (who, at, skip) => placed.some(o =>
    !skip.includes(o.app.id) && o.day === at.day && o.slot === at.slot &&
    (who.teams.some(t => o.teams.includes(t)) || iv(who).some(i => iv(o).includes(i))))
  const at = p => ({ spot: `${p.day}|${p.slot}|${p.room}`, name: p.app.name })
  let dirty = null, clean = null
  for (const a of placed) {
    for (const b of placed) {
      if (a.app.id === b.app.id || (a.day === b.day && a.slot === b.slot)) continue
      if (a.day !== 0 || b.day !== 0) continue                 // 1일차 안에서 — 탭을 안 바꾸게
      const skip = [a.app.id, b.app.id]
      const bClash = hits(b, a, skip), aClash = hits(a, b, skip)
      if (!dirty && !bClash && aClash) dirty = { a: at(a), b: at(b) }   // 상대만 부딪힘
      if (!clean && !bClash && !aClash) clean = { a: at(a), b: at(b) }  // 양쪽 다 깨끗
      if (dirty && clean) return { dirty, clean }
    }
  }
  return { dirty, clean }
})
check('실데이터에 상대만 부딪히는 교환이 있다', !!swapPairs?.dirty,
  swapPairs?.dirty ? `${swapPairs.dirty.b.name} → ${swapPairs.dirty.a.name} 자리` : '못 찾음')

if (swapPairs?.dirty) {
  const { a, b } = swapPairs.dirty
  await holdOver(`td[data-spot="${b.spot}"] .cell-card`, `td[data-spot="${a.spot}"]`, async () => {
    check('점유 칸에도 예고 색이 붙는다', !!(await toneOf(a.spot)), `td.${await toneOf(a.spot) || '색 없음'}`)
    check('상대만 부딪혀도 칸이 빨갛다', (await toneOf(a.spot)) === 'bad')
    const text = await labelText()
    check('커서 옆에 교환 라벨이 뜬다', text.includes('⇄'), text.split('\n')[0])
    check('두 사람 이름이 다 적힌다', text.includes(a.name) && text.includes(b.name))
    check('밀려날 상대를 지목한다', text.includes(`${a.name}`) && text.includes('갈 자리'),
      text.split('\n').find(t => t.includes(a.name) && t.includes('갈 자리')) ?? '')
    await page.screenshot({ path: `${SHOTS}/e3-교환예고.png` })
  })
  check('붙들었다 되돌리면 편성표는 그대로', (await chipValue('변경')) === 0)
}

if (swapPairs?.clean) {
  const { a, b } = swapPairs.clean
  await holdOver(`td[data-spot="${b.spot}"] .cell-card`, `td[data-spot="${a.spot}"]`, async () => {
    check('멀쩡한 교환까지 빨갛게 물들이지 않는다', (await toneOf(a.spot)) !== 'bad', `td.${await toneOf(a.spot)}`)
  })
}

/* ── 3. 교환 ── */
step('3. 배정된 칸끼리 교환')
const spots = await page.evaluate(() => {
  const out = []
  for (const td of document.querySelectorAll('td[data-spot]')) {
    const c = td.querySelector('.cell-card')
    if (c) out.push({ spot: td.dataset.spot, name: c.querySelector('b').textContent })
  }
  return out.slice(0, 2)
})
await dragCard(`td[data-spot="${spots[0].spot}"] .cell-card`, `td[data-spot="${spots[1].spot}"]`)
const [t0, t1] = [await cellText(spots[0].spot), await cellText(spots[1].spot)]
check('두 사람 자리가 맞바뀐다', t0.includes(spots[1].name) && t1.includes(spots[0].name),
  `${spots[0].name} ↔ ${spots[1].name}`)
check('교환도 이벤트 1건', (await chipValue('변경')) === 1)
check('교환 후에도 60명', (await chipValue('편성')) === 60)

/* ── 4. 미배정 서랍으로 빼기 ── */
step('4. 서랍으로 빼기')
const before = await chipValue('미배정')
const victim = await page.locator('.schedule-table .cell-card b').first().innerText()
await dragCard('.schedule-table .cell-card', '.drawer')
check('미배정이 1명 늘었다', (await chipValue('미배정')) === before + 1, `${before} → ${await chipValue('미배정')}`)
check('편성이 1명 줄었다', (await chipValue('편성')) === 59)
check('서랍에 그 사람이 보인다', (await page.locator('.drawer').innerText()).includes(victim), victim)
check('서랍 카드에 「담당자가 뺌」 표시', (await page.locator('.drawer').innerText()).includes('담당자가 뺌'))
await page.screenshot({ path: `${SHOTS}/e2-서랍.png` })

/* ── 5. 서랍에서 다시 배정 ── */
step('5. 서랍에서 다시 격자로')
const back = await page.evaluate(() => {
  for (const td of document.querySelectorAll('td[data-spot]')) if (!td.querySelector('.cell-card')) return td.dataset.spot
  return null
})
await dragCard('.drawer-card', `td[data-spot="${back}"]`)
check('다시 60명', (await chipValue('편성')) === 60)
check('미배정이 원래대로', (await chipValue('미배정')) === before)
check('격자에 다시 나타난다', (await spotOfName(victim)) !== null, `${victim} @ ${await spotOfName(victim)}`)

/* ── 6. 학력 위반을 일부러 만든다 ── */
step('6. 석사를 학사 구간으로 (담당자가 알고 하는 조작)')
await page.evaluate(() => { for (const b of document.querySelectorAll('.day-tabs button')) if (b.textContent.includes('3일차')) b.click() })
await page.waitForTimeout(150)
const masters = await page.evaluate(() => {
  const out = []
  for (const td of document.querySelectorAll('td[data-spot]')) {
    const c = td.querySelector('.cell-card')
    if (c && c.textContent.includes('석사')) out.push({ spot: td.dataset.spot, name: c.querySelector('b').textContent })
  }
  return out
})
check('3일차에 석사가 있다', masters.length > 0, `${masters.length}명`)
const master = masters[0]
await page.evaluate(() => { for (const b of document.querySelectorAll('.day-tabs button')) if (b.textContent.includes('1일차')) b.click() })
await page.waitForTimeout(150)

// 3일차 카드를 1일차로 끌 수 없으니 서랍 경유로 옮긴다
await page.evaluate(() => { for (const b of document.querySelectorAll('.day-tabs button')) if (b.textContent.includes('3일차')) b.click() })
await page.waitForTimeout(150)
await dragCard(`td[data-spot="${master.spot}"] .cell-card`, '.drawer')
await page.evaluate(() => { for (const b of document.querySelectorAll('.day-tabs button')) if (b.textContent.includes('1일차')) b.click() })
await page.waitForTimeout(150)
const day1empty = await page.evaluate(() => {
  for (const td of document.querySelectorAll('td[data-spot]')) if (!td.querySelector('.cell-card')) return td.dataset.spot
  return null
})
await dragCard('.drawer-card', `td[data-spot="${day1empty}"]`)
await page.waitForTimeout(200)

const alerts = await chipValue('내가 만든 위반')
const masterSpot = await spotOfName(master.name)
check('석사가 1일차로 옮겨졌다', masterSpot !== null, `${master.name} @ ${masterSpot}`)
// 표식 클래스는 has-alert · has-new-notice · has-base-notice 세 가지다.
// /has-(alert|notice)/ 는 has-new-notice 를 못 잡아, 우연히 중복까지 겹친 자리에서만 통과했다.
const masterClass = await page.locator(`td[data-spot="${masterSpot}"] .cell-card`).getAttribute('class') ?? ''
check('그 카드에 표식이 붙었다', /has-(alert|new-notice|base-notice)/.test(masterClass), masterClass)
console.log(`   내가 만든 위반 ${alerts}건`)
await page.screenshot({ path: `${SHOTS}/e3-학력위반.png` })

/* ── 7. 위반 패널 ── */
step('7. 위반 목록과 「알고 있음」')
await page.locator('.summary button', { hasText: '내가 만든 위반' }).click()
await page.waitForSelector('.v-panel')
const vtext = await page.locator('.v-panel').innerText()
check('목록에 그 사람 이름이 나온다', vtext.includes(master.name), master.name)
check('「학사 구간」으로 설명한다', /학사 구간/.test(vtext))
check('손대지 않은 사람을 지목하지 않는다', !/\d\d건이 끼어듦/.test(vtext))

const ackedBefore = await chipValue('예외')
await page.locator('.v-list button.switch', { hasText: '알고 있음' }).first().click()
await page.waitForTimeout(200)
check('「알고 있음」을 누르면 예외로 옮겨간다', (await chipValue('예외')) === ackedBefore + 1)
check('기준선 잡음은 접힌 영역에 들어간다', (await page.locator('.v-old summary').innerText()).includes('1차 편성부터'),
  await page.locator('.v-old summary').innerText())
await page.screenshot({ path: `${SHOTS}/e4-위반패널.png` })

/* ── 8. 변경 이력 ── */
step('8. 변경 이력')
await page.locator('.summary button', { hasText: '변경' }).click()
await page.waitForSelector('.h-list')
const htext = await page.locator('.v-panel').innerText()
check('이력에 사람 이름과 좌표가 나온다', /\d일차 \d+세션 \d조/.test(htext))
check('이력이 AI 스럽지 않다', !/AI|알고리즘|자동 분석/.test(htext))
const evAll = await eventCount()
console.log(`   기록된 이벤트 ${evAll}건`)
await page.screenshot({ path: `${SHOTS}/e5-이력.png` })

/* ── 8.5 면접관 일정 ── */
step('8.5 면접관 개인 일정')
await page.locator('.summary button', { hasText: '면접관 일정' }).click()
await page.waitForSelector('.people-list')
const people = await page.locator('.people-list > li').count()
check('면접관 목록이 나온다', people > 0, `${people}명`)
const ivText = await page.locator('.v-panel').innerText()
check('일자·시간·조가 함께 보인다', /\d일 \d\d:\d\d · \d조/.test(ivText))
// 배터리기술팀 도하햐하 — 혼자 5건을 연속으로 본다
check('한 사람의 여러 건이 한 줄에 모인다',
  (await page.locator('.people-list > li').first().locator('.p-slot').count()) >= 3,
  `첫 줄 ${await page.locator('.people-list > li').first().locator('.p-slot').count()}건`)
await page.locator('.people-find').fill('배터리')
await page.waitForTimeout(200)
check('팀 이름으로 걸러진다', (await page.locator('.people-list > li').count()) < people,
  `${people} → ${await page.locator('.people-list > li').count()}`)
await page.screenshot({ path: `${SHOTS}/e7-면접관.png` })
await page.locator('.summary button', { hasText: '면접관 일정' }).click()

/* ── 9. 새로고침 복원 ── */
step('9. 새로고침 후 편집분 복원')
const beforeReload = {
  placed: await chipValue('편성'), unplaced: await chipValue('미배정'),
  events: await chipValue('변경'), acked: await chipValue('예외'), alerts: await chipValue('내가 만든 위반'),
}
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: '면접 일정 편성' }).first().click()
await page.waitForSelector('.schedule-table .cell-card', { timeout: 20000 })
const afterReload = {
  placed: await chipValue('편성'), unplaced: await chipValue('미배정'),
  events: await chipValue('변경'), acked: await chipValue('예외'), alerts: await chipValue('내가 만든 위반'),
}
check('새로고침해도 편집분이 남는다', JSON.stringify(beforeReload) === JSON.stringify(afterReload),
  `${JSON.stringify(beforeReload)} vs ${JSON.stringify(afterReload)}`)
await page.screenshot({ path: `${SHOTS}/e6-복원.png` })

/* ── 10. 엑셀 내보내기 ── */
step('10. 엑셀 내보내기')
const dl = page.waitForEvent('download', { timeout: 20000 })
await page.getByRole('button', { name: '내보내기 ▾' }).click()
await page.waitForSelector('.export-menu')
await page.locator('.export-menu button', { hasText: '전체 (XLSX)' }).click()
const file = await dl
check('파일이 내려받아진다', /면접편성_\d{8}_\d{4}\.xlsx/.test(file.suggestedFilename()), file.suggestedFilename())
const path = `${SHOTS}/${file.suggestedFilename()}`
await file.saveAs(path)
console.log(`   저장: ${path}`)

/* ── 10.5 표식 롤오버 툴팁 ── */
step('10.5 표식 툴팁')
await page.locator('.day-tabs button').first().click()
await page.waitForTimeout(200)
const markCount = await page.locator('.cell-card .mark').count()
check('표식이 있다', markCount > 0, `${markCount}개`)
check('툴팁은 평소 숨어 있다', (await page.locator('.tip').count()) === 0)

await page.locator('.cell-card .mark').first().hover()
await page.waitForSelector('.tip', { timeout: 3000 })
const tipText = await page.locator('.tip').innerText()
check('기호에 올리면 툴팁이 뜬다', tipText.length > 0, tipText.replace(/\n/g, ' / ').slice(0, 100))
check('무슨 표식인지 알려준다', /같은 시간대 중복|내가 만든 예외|1차 편성부터/.test(tipText))
// 세 규칙의 문장 형태가 서로 다르다 — 어느 것이든 날짜와 사정이 들어간다
check('구체적인 사유가 들어 있다', /\d일차/.test(tipText) && tipText.split('\n').length >= 3,
  `${tipText.split('\n').filter(Boolean).length}줄`)
const tipBox = await page.locator('.tip').boundingBox()
check('툴팁이 화면 밖으로 나가지 않는다',
  tipBox.x >= 0 && tipBox.y >= 0 && tipBox.x + tipBox.width <= 1600 && tipBox.y + tipBox.height <= 1000,
  `x${Math.round(tipBox.x)} y${Math.round(tipBox.y)} ${Math.round(tipBox.width)}×${Math.round(tipBox.height)}`)
await page.screenshot({ path: `${SHOTS}/e8-툴팁.png` })
await page.mouse.move(10, 10)
await page.waitForTimeout(250)
check('벗어나면 사라진다', (await page.locator('.tip').count()) === 0)

await page.locator('.legend i[data-legend]').first().hover()
await page.waitForSelector('.tip', { timeout: 3000 })
check('범례 기호에도 툴팁이 뜬다', (await page.locator('.tip').innerText()).includes('같은 시간대 중복'))
await page.mouse.move(10, 10)
await page.waitForTimeout(250)

/* ── 11. 키보드 접근성 ── */
step('11. 키보드')
const focusable = await page.evaluate(() => document.querySelectorAll('.cell-card[tabindex], .cell-card[role]').length)
check('카드가 키보드로 잡힌다', focusable > 0, `${focusable}개`)
// 카드에 초점이 오면 툴팁이 뜬다 — 표식을 따로 탭 정지로 만들지 않고도 읽힌다
await page.locator('.cell-card.has-alert, .cell-card.has-new-notice, .cell-card.has-base-notice').first().focus()
await page.waitForTimeout(250)
check('키보드 초점으로도 툴팁이 뜬다', (await page.locator('.tip').count()) === 1)
check('범례 기호도 키보드로 잡힌다', (await page.locator('.legend i[tabindex="0"]').count()) === 3)

/* ── 12. 재업로드 확인 — 조정을 말없이 날리지 않는다 ── */
step('12. 팀 회신 재업로드 가드')
const before12 = { events: Number((await page.locator('.summary').innerText()).match(/변경\s*\n?\s*(\d+)/)?.[1] ?? -1) }
check('고친 것이 있다', before12.events > 0, `변경 ${before12.events}건`)

// 1) 그만두기 — 아무것도 사라지지 않는다
await page.setInputFiles('.primary-file', teamFiles)
await page.waitForSelector('.modal', { timeout: 5000 })
const risk = await page.locator('.modal').innerText()
check('확인 창이 뜬다', risk.includes('사라집니다'))
check('무엇이 얼마나 사라지는지 센다', /수기 편집 \d+건/.test(risk), risk.split('\n').find(l => /수기 편집/.test(l)) ?? '')
check('처리 안 한 요청도 짚어 준다', !/팀 요청/.test(risk) || /팀 요청 \d+건/.test(risk))
await page.getByRole('button', { name: '그만두기' }).click()
await page.waitForTimeout(300)
const after12 = Number((await page.locator('.summary').innerText()).match(/변경\s*\n?\s*(\d+)/)?.[1] ?? -1)
check('그만두면 편집이 그대로 남는다', after12 === before12.events, `${before12.events} → ${after12}`)

// 2) ESC 로도 빠져나온다
await page.setInputFiles('.primary-file', teamFiles)
await page.waitForSelector('.modal')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
check('ESC 로 닫힌다', (await page.locator('.modal').count()) === 0)

// 3) 같은 파일을 다시 고를 수 있어야 한다 (input value 를 비웠는지)
await page.setInputFiles('.primary-file', teamFiles)
check('그만둔 뒤 같은 파일을 다시 고를 수 있다', (await page.locator('.modal').count()) === 1)

// 4) 내보내고 계속 — 사본을 남기고 진행한다
const dl12 = page.waitForEvent('download', { timeout: 30000 })
await page.getByRole('button', { name: '내보내고 계속' }).click()
const saved12 = await dl12
check('내보내고 계속이 사본을 남긴다', /\.xlsx$/.test(saved12.suggestedFilename()), saved12.suggestedFilename())
/* 엑셀 8개를 다시 읽는 데 몇 초가 걸린다 — 정해진 시간이 아니라 상태가 바뀌기를 기다린다.
   waitForFunction 은 truthy 를 기다리므로 「0건이 됐다」를 0 으로 돌려주면 영원히 안 끝난다. */
const reset12 = await page.waitForFunction(() => {
  const m = (document.querySelector('.summary')?.innerText ?? '').match(/변경\s*\n?\s*(\d+)/)
  return m && Number(m[1]) === 0 ? 'reset' : false
}, null, { timeout: 60000 }).then(() => 0).catch(() => -1)
check('진행하면 새 편성으로 초기화된다', reset12 === 0, `변경 ${reset12 === 0 ? 0 : '초기화 안 됨'}건`)
check('편성 인원은 그대로', (await chipValue('편성')) === 60)

// 5) 고친 것이 없으면 확인 창을 띄우지 않는다
await page.setInputFiles('.primary-file', teamFiles)
await page.waitForTimeout(600)
check('조정이 없으면 바로 진행한다', (await page.locator('.modal').count()) === 0)
await page.waitForSelector('.schedule-table .cell-card', { timeout: 60000 })

console.log('\n═══ 판정 ═══')
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '))
const failed = checks.filter(([, ok]) => !ok)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
await browser.close()
process.exit(failed.length ? 1 : 0)
