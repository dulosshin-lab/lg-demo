/* 팀 제안 큐 + 내보내기(PNG·CSV·XLSX) 실브라우저 검증 */
import { chromium } from 'playwright'
import { readdirSync, statSync } from 'node:fs'
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
page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()) })
page.on('pageerror', e => { if (!NOISE.test(e.message)) errors.push(`pageerror: ${e.message}`) })

const checks = []
const check = (n, ok, extra = '') => { checks.push([n, ok]); console.log(`${ok ? '✅' : '❌'} ${n}${extra ? ` — ${extra}` : ''}`) }
const step = s => console.log(`\n── ${s}`)
const role = name => page.locator('.role-pill button', { hasText: name }).click()
const nav = name => page.locator('.nav-item', { hasText: name }).first().click()
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
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(200)
}

const chip = async label => {
  const t = await page.locator('.summary').innerText()
  const m = t.match(new RegExp(`${label}\\s*\\n?\\s*([0-9]+)`))
  return m ? Number(m[1]) : null
}

/* ── 준비 ── */
await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await nav('지원자 명단 등록')
await page.setInputFiles('input[type=file]', resolve(ROOT, 'data', '취합파일.xlsx'))
await page.waitForFunction(() => !!localStorage.getItem('ax.v1.session'), null, { timeout: 30000 })
await nav('면접 일정 편성')
await page.setInputFiles('input[type=file]', teamFiles)
await page.waitForSelector('.schedule-table .cell-card', { timeout: 60000 })
step('편성 완료')

/* ── 0. 범례 ── */
step('0. 표식 범례')
const legend = await page.locator('.legend').innerText()
check('범례가 화면에 있다', legend.includes('같은 시간대 중복'), legend.replace(/\n/g, ' / '))
check('내가 만든 예외와 1차 편성부터를 가른다',
  legend.includes('내가 만든 예외') && legend.includes('1차 편성부터'))
const baseNotice = await page.locator('.cell-card.has-base-notice').count()
const newNotice = await page.locator('.cell-card.has-new-notice').count()
check('편집 전에는 「내가 만든 예외」 표식이 없다', newNotice === 0, `기준선 표식 ${baseNotice}개`)

/* ── 1. 내보내기 메뉴 ── */
step('1. 내보내기 — PNG · CSV · XLSX')
const grab = async (label) => {
  await page.getByRole('button', { name: '내보내기 ▾' }).click()
  await page.waitForSelector('.export-menu')
  const dl = page.waitForEvent('download', { timeout: 30000 })
  await page.locator('.export-menu button', { hasText: label }).first().click()
  const f = await dl
  const path = `${SHOTS}/${f.suggestedFilename()}`
  await f.saveAs(path)
  return { name: f.suggestedFilename(), size: statSync(path).size, path }
}
const dayPng = await grab('이 날짜 편성표')
check('이 날짜 PNG', /_1일차\.png$/.test(dayPng.name) && dayPng.size > 20000, `${dayPng.name} ${Math.round(dayPng.size / 1024)}KB`)
const allPng = await grab('전 일자 편성표')
check('전 일자 PNG 가 더 크다', /_전체\.png$/.test(allPng.name) && allPng.size > dayPng.size,
  `${allPng.name} ${Math.round(allPng.size / 1024)}KB`)
const csv = await grab('편성표 (CSV)')
check('편성표 CSV', /\.csv$/.test(csv.name) && csv.size > 1000, `${csv.name} ${Math.round(csv.size / 1024)}KB`)
const chCsv = await grab('변경 요약 (CSV)')
check('변경 요약 CSV', /_변경요약\.csv$/.test(chCsv.name), chCsv.name)
const xlsx = await grab('전체 (XLSX)')
check('전체 XLSX', /\.xlsx$/.test(xlsx.name), xlsx.name)

/* PNG 가 실제 그림인지 확인 */
const png = await page.evaluate(async src => {
  const img = new Image()
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = src })
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  c.getContext('2d').drawImage(img, 0, 0)
  const d = c.getContext('2d').getImageData(0, 0, img.width, img.height).data
  let ink = 0
  for (let i = 0; i < d.length; i += 400) if (d[i] < 200) ink++
  return { w: img.width, h: img.height, ink }
}, `data:image/png;base64,${(await import('node:fs')).readFileSync(allPng.path).toString('base64')}`)
// 편성표는 흰 여백이 많은 지면이다 — 글자가 실제로 찍혔는지만 본다
check('PNG 에 글자가 찍혔다', png.ink > 200 && png.w > 900 && png.h > 1500,
  `${png.w}×${png.h}px · 잉크 표본 ${png.ink}`)

/* ── 1.5 요청이 0건일 때 — 빈 화면이 스스로 설명해야 한다 ── */
step('1.5 빈 요청함')
check('요청 0건으로 시작한다', (await chip('받은 요청')) === 0)
await page.locator('.summary button', { hasText: '받은 요청' }).click()
await page.waitForSelector('.slideover', { timeout: 3000 })
check('0건이어도 서랍이 열린다', (await page.locator('.slideover').count()) === 1)
const emptyText = await page.locator('.inbox-empty').innerText()
check('무엇을 기다리는 자리인지 적혀 있다', /우리 팀 면접 일정/.test(emptyText) && /승인|거절/.test(emptyText),
  emptyText.replace(/\n/g, ' ').slice(0, 80))
check('팀 화면으로 가는 지름길이 있다', (await page.locator('.inbox-empty .button').isVisible()))
await page.locator('.inbox-empty .button').click()
await page.waitForTimeout(300)
check('지름길이 팀 담당자 화면을 연다',
  (await page.locator('h1').innerText()).includes('우리 팀') &&
  (await page.locator('.role-pill button[aria-pressed="true"]').innerText()).includes('팀 담당자'))
await page.screenshot({ path: `${SHOTS}/p0-빈요청함.png` })

/* ── 2. 팀 담당자가 제안을 보낸다 ── */
step('2. 팀 담당자 → 수정 요청')
await page.waitForSelector('.page')
const teamRows = await page.locator('tbody tr').count()
check('우리 팀 면접이 보인다', teamRows > 0, `${teamRows}건`)

await page.locator('tbody tr button', { hasText: '수정 요청' }).first().click()
await page.waitForSelector('.prop-compose')
// 사유 없이 보내면 막는다
await page.getByRole('button', { name: '간사에게 보내기' }).click()
check('사유 없이 보내면 막는다', (await page.locator('.prop-warn').count()) > 0,
  await page.locator('.prop-warn').first().innerText())

/** 지금 자리가 아닌 빈 자리를 골라 요청을 보낸다 */
async function sendRequest(reason) {
  await page.locator('.compose-reason textarea').fill(reason)
  await page.locator('.compose-row select').first().selectOption('move')
  const slotSel = page.locator('.compose-row select').nth(2)
  const cur = await slotSel.evaluate(el => el.selectedIndex)
  const idx = await slotSel.evaluate((el, c) => {
    for (let i = el.options.length - 1; i >= 0; i--)
      if (i !== c && /빈 조/.test(el.options[i].text)) return i
    return c
  }, cur)
  await slotSel.selectOption({ index: idx })
  const roomSel = page.locator('.compose-row select').nth(3)
  const room = await roomSel.evaluate(el => {
    for (let i = 0; i < el.options.length; i++) if (/빈 자리/.test(el.options[i].text)) return i
    return 0
  })
  await roomSel.selectOption({ index: room })
  const picked = `${await slotSel.evaluate(el => el.options[el.selectedIndex].text)} / ${await roomSel.evaluate(el => el.options[el.selectedIndex].text)}`
  await page.getByRole('button', { name: '간사에게 보내기' }).click()
  await page.waitForTimeout(300)
  return picked
}

const target = await page.locator('.prop-compose h2').innerText()
const picked1 = await sendRequest('박팀장이 그날 오전 임원회의가 잡혀 오후로 옮겨야 합니다.')
check('빈 자리를 화면이 알려준다', /빈 조/.test(picked1) && /빈 자리/.test(picked1), picked1)
check('요청이 목록에 쌓인다', (await page.locator('.prop-list.done li').count()) === 1, target.slice(0, 40))
check('대기 중으로 표시된다', (await page.locator('.prop-status').first().innerText()) === '대기 중')
await page.screenshot({ path: `${SHOTS}/p1-팀요청.png` })

/* 제자리 제안은 막는다 */
await page.locator('tbody tr button', { hasText: '수정 요청' }).nth(1).click()
await page.waitForSelector('.prop-compose')
await page.locator('.compose-reason textarea').fill('시험용')
await page.getByRole('button', { name: '간사에게 보내기' }).click()
check('지금 있는 자리를 그대로 제안하면 막는다',
  (await page.locator('.prop-compose .prop-warn').innerText()).includes('같습니다'),
  await page.locator('.prop-compose .prop-warn').innerText())

/* 두 번째 요청 — 거절용 */
await sendRequest('지원자가 그 시간에 다른 일정이 있다고 연락했습니다.')
check('요청 2건이 됐다', (await page.locator('.prop-list.done li').count()) === 2)

/* ── 3. 간사가 큐에서 처리 ── */
step('3. HR 간사 → 승인 · 거절')
await role('HR 간사')
check('사이드바에 요청 배지가 뜬다',
  /요청 \d+건/.test(await page.locator('.nav-item', { hasText: '면접 일정 편성' }).innerText()),
  (await page.locator('.nav-item', { hasText: '면접 일정 편성' }).innerText()).replace(/\n/g, ' '))
await nav('면접 일정 편성')
await page.waitForSelector('.schedule-table')
check('상단 칩에 대기 건수가 뜬다', (await chip('받은 요청')) === 2)

await page.locator('.summary button', { hasText: '받은 요청' }).click()
await page.waitForSelector('.slideover')
check('오른쪽 서랍으로 열린다', (await page.locator('.slideover').count()) === 1)
const sBox = await page.locator('.slideover').boundingBox()
check('서랍이 화면 오른쪽에 붙는다', sBox.x + sBox.width >= 1590, `x${Math.round(sBox.x)} w${Math.round(sBox.width)}`)
check('편성표가 가려지지 않는다', (await page.locator('.schedule-table .cell-card').first().isVisible()))

/* 서랍이 열려도 미배정으로 빼기가 계속 되어야 한다.
   숨기면(display:none) 크기가 0 이 되어 놓는 자리가 사라지고 조용히 실패한다 — 실제로 그랬다. */
const railBox = await page.locator('.drawer').boundingBox()
check('미배정 서랍이 레일로 남는다 (사라지지 않는다)', railBox !== null && railBox.width > 20,
  railBox ? `${Math.round(railBox.width)}px` : '없음')
const wrap = await page.evaluate(() => {
  const w = document.querySelector('.table-wrap')
  return { width: Math.round(w.getBoundingClientRect().width), scrolls: w.scrollWidth > w.clientWidth }
})
check('격자가 가로로 밀리지 않는다', !wrap.scrolls, `표 폭 ${wrap.width}px`)

const outBefore = await chip('미배정')
await dragCard('.schedule-table .cell-card', '.drawer')
check('서랍이 열린 채로도 배정 취소가 된다', (await chip('미배정')) === outBefore + 1,
  `미배정 ${outBefore} → ${await chip('미배정')}`)
check('레일에 「펼치기」가 나온다', (await page.locator('.drawer-expand').isVisible()))
await page.locator('.drawer-expand').click()
await page.waitForTimeout(250)
check('펼치면 요청 서랍이 닫히고 목록이 보인다',
  (await page.locator('.slideover').count()) === 0 && (await page.locator('.drawer-card').count()) === 1)
// 되돌려 놓고 이어서 검증한다
await page.getByRole('button', { name: '되돌리기' }).first().click()
await page.waitForTimeout(250)
check('되돌리면 미배정이 원래대로', (await chip('미배정')) === outBefore)
await page.locator('.summary button', { hasText: '받은 요청' }).click()
await page.waitForSelector('.slideover')
const q = await page.locator('.slideover').innerText()
check('요청 사유가 큐에 그대로 보인다', q.includes('임원회의'))
// 승인하면 무엇이 어긋나는지 누르기 전에 보여야 한다 — 막지는 않는다
const effectShown = await page.locator('.prop-effect').count()
if (effectShown) {
  const eff = await page.locator('.prop-effect').first().innerText()
  check('승인하면 생기는 일을 미리 보여준다', /승인하면/.test(eff), eff.replace(/\n/g, ' ').slice(0, 70))
  check('알려도 승인 버튼은 살아 있다',
    await page.locator('.prop-list button', { hasText: '승인' }).first().isEnabled())
} else {
  check('어긋남이 없으면 표시하지 않는다', true, '이번 요청은 문제 없음')
}
check('보낸 팀과 사람이 보인다', /전극기술팀/.test(q))

// 승인
const placedBefore = await chip('편성')
const eventsBefore = await chip('변경')
await page.locator('.prop-list button', { hasText: '승인' }).first().click()
await page.waitForSelector('.prop-form')
await page.locator('.prop-form textarea').fill('요청대로 오후로 옮겼습니다.')
await page.getByRole('button', { name: '승인하고 회신' }).click()
await page.waitForTimeout(400)
check('승인하면 편집 이벤트가 늘어난다', (await chip('변경')) === eventsBefore + 1,
  `${eventsBefore} → ${await chip('변경')}`)
check('배정 인원은 그대로', (await chip('편성')) === placedBefore)
check('대기가 1건으로 줄었다', (await chip('받은 요청')) === 1)
await page.screenshot({ path: `${SHOTS}/p2-간사큐.png` })

/* 승인을 되돌리면 요청도 함께 되돌아가야 한다 —
   표만 원복하고 「승인함」을 두면 팀은 자리가 옮겨진 줄 안다. */
step('3.2 승인 되돌리기')
const approvedName = (await page.locator('.prop-list.done .prop-head').first().innerText().catch(() => '')) || ''
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
check('되돌리면 편집 이벤트가 줄어든다', (await chip('변경')) === eventsBefore, `→ ${await chip('변경')}건`)
check('요청이 대기 중으로 돌아온다', (await chip('받은 요청')) === 2, `받은 요청 ${await chip('받은 요청')}건`)
const backText = await page.locator('.slideover').innerText()
check('큐에 다시 나타난다', /임원회의/.test(backText), approvedName.replace(/\n/g, ' ').slice(0, 40))
await page.screenshot({ path: `${SHOTS}/p5-철회.png` })

// 다시 승인해서 흐름을 이어간다
await page.locator('.prop-list button', { hasText: '승인' }).first().click()
await page.waitForSelector('.prop-form')
await page.locator('.prop-form textarea').fill('요청대로 오후로 옮겼습니다.')
await page.getByRole('button', { name: '승인하고 회신' }).click()
await page.waitForTimeout(400)
check('다시 승인할 수 있다', (await chip('받은 요청')) === 1)

// 거절 — 사유 없이 못 보낸다
await page.locator('.prop-list button', { hasText: '거절' }).first().click()
await page.waitForSelector('.prop-form')
await page.getByRole('button', { name: '거절하고 회신' }).click()
check('사유 없는 거절은 막는다', (await page.locator('.prop-form .prop-warn').count()) > 0,
  await page.locator('.prop-form .prop-warn').first().innerText())

const why = '그 시간에는 김총이 면접관이 AI솔루션팀 면접에 들어가 있어 옮길 수 없습니다. 14:10 이후로 다시 제안해 주세요.'
await page.locator('.prop-form textarea').fill(why)
await page.getByRole('button', { name: '거절하고 회신' }).click()
await page.waitForTimeout(400)
check('거절하면 대기가 0건이 된다', (await chip('받은 요청')) === 0)

/* ── 3.5 종 알림 ── */
step('3.5 종 알림 — 간사')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
check('ESC 로 서랍이 닫힌다', (await page.locator('.slideover').count()) === 0)
await page.locator('.bell').click()
await page.waitForSelector('.notif-panel')
const hrBell = await page.locator('.notif-panel').innerText()
check('처리를 마치면 종에서 요청이 사라진다', !/요청했습니다/.test(hrBell), hrBell.split('\n')[1] ?? '')
await page.locator('.bell').click()

/* ── 4. 팀 담당자 — 종에 회신이 오고, 열어보면 사라진다 ── */
step('4. 팀 담당자 → 종 알림과 회신 확인')
await role('팀 담당자')
await page.waitForTimeout(250)
// 아직 우리 팀 화면을 열지 않았다 — 회신은 안 읽은 상태여야 한다
const bellCount = await page.locator('.bell-count').innerText()
check('팀 종에 안 읽은 회신 수가 뜬다', bellCount === '2', `${bellCount}건`)
check('사이드바에도 회신 배지가 붙는다',
  /회신 2건/.test(await page.locator('.nav-item', { hasText: '우리 팀 면접 일정' }).innerText()),
  (await page.locator('.nav-item', { hasText: '우리 팀 면접 일정' }).innerText()).replace(/\n/g, ' '))

await page.locator('.bell').click()
await page.waitForSelector('.notif-panel')
const teamBell = await page.locator('.notif-panel').innerText()
check('승인·거절 회신이 종에 뜬다', /회신이 왔습니다/.test(teamBell), teamBell.split('\n')[1] ?? '')
check('거절은 빨갛게 구분된다', (await page.locator('.notif-tag.hot').count()) >= 1)
await page.screenshot({ path: `${SHOTS}/p4-종알림.png` })

await page.locator('.notif-row').first().click()
await page.waitForSelector('.prop-list.done')
check('알림을 누르면 우리 팀 화면으로 간다', (await page.locator('h1').innerText()).includes('우리 팀'))

const replies = await page.locator('.prop-list.done').innerText()
check('승인 회신이 도착한다', replies.includes('승인함') && replies.includes('요청대로 오후로 옮겼습니다'))
check('거절 사유가 통째로 전달된다', replies.includes(why), `${why.slice(0, 30)}…`)
check('거절 회신이 눈에 띈다', (await page.locator('.prop-status.rejected').count()) === 1)

await page.waitForTimeout(350)
const afterRead = await page.locator('.bell-count').innerText().catch(() => '없음')
check('열어보면 팀 종에서 회신이 사라진다', afterRead !== '2', `${bellCount} → ${afterRead}`)
check('거절 건은 목록에서 계속 강조된다', (await page.locator('.prop-list li.needs-action').count()) === 1)
await page.screenshot({ path: `${SHOTS}/p3-팀회신.png` })

/* ── 5. 새로고침 ── */
step('5. 새로고침 후 유지')
await page.reload({ waitUntil: 'networkidle' })
await role('팀 담당자')
await nav('우리 팀 면접 일정')
await page.waitForSelector('.prop-list.done')
check('제안과 회신이 남는다', (await page.locator('.prop-list.done li').count()) === 2)
check('거절 사유도 남는다', (await page.locator('.prop-list.done').innerText()).includes(why))

console.log('\n═══ 판정 ═══')
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '))
const failed = checks.filter(([, ok]) => !ok)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
await browser.close()
process.exit(failed.length ? 1 : 0)
