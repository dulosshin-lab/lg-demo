/* 지원자 상세 실브라우저 검증 — 세 자리에서 열리는지, 역할별로 가려지는지, 닫히는지 */
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
page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

const checks = []
const check = (name, ok, extra = '') => { checks.push([name, ok, extra]); console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const step = s => console.log(`\n── ${s}`)
const modalText = () => page.locator('.modal.applicant').innerText()
const closeModal = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(200) }

/* ── 준비 ── */
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

/* ── 1. 편성표 카드에서 열기 ── */
step('1. 편성표 카드에서 열기')
check('평소에는 창이 없다', (await page.locator('.modal.applicant').count()) === 0)
const first = await page.evaluate(() => {
  const c = document.querySelector('td[data-spot] .cell-card')
  return { name: c.querySelector('b').textContent, spot: c.closest('td').dataset.spot }
})
check('카드에 상세 단추가 숨어 있다', (await page.locator('.cell-card .card-more').count()) > 0,
  `${await page.locator('.cell-card .card-more').count()}개`)
await page.locator(`td[data-spot="${first.spot}"] .card-more`).click()
await page.waitForSelector('.modal.applicant', { timeout: 3000 })
const hr = await modalText()
check('그 지원자의 창이 뜬다', hr.includes(first.name), first.name)
check('배정 자리를 함께 보여 준다', /\d일차/.test(hr) && /조/.test(hr),
  hr.split('\n')[1]?.slice(0, 50) ?? '')

/* ── 2. 간사에게 보이는 것 ── */
step('2. 간사 — 전체를 본다')
for (const [label, why] of [
  ['생년월일', '인적'], ['성별', '인적'], ['국적', '인적'], ['병역구분', '인적'],
  ['학교명', '학력'], ['주전공', '학력'], ['환산학점', '학력'],
  ['1지망 직무', '지원'], ['지원자 번호', '지원'],
]) check(`${why} — ${label} 이 보인다`, hr.includes(label))
check('날짜가 일련번호가 아니라 날짜로 보인다', /\d{4}-\d{2}-\d{2}/.test(hr),
  hr.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '없음')
check('일련번호가 그대로 새지 않았다', !/\b3\d{4}\b|\b4[0-6]\d{3}\b/.test(hr))
check('빈 항목을 빈 칸으로 그리지 않는다', !/\n\s*\n\s*\n/.test(hr))
check('무엇이 없는지 알려 준다', hr.includes('자기소개서'),
  '「자기소개서·경력기술서는 들어 있지 않습니다」')
check('원본보기 단추가 있다', await page.getByRole('button', { name: '원본보기' }).isVisible())
await page.screenshot({ path: `${SHOTS}/a1-지원자상세.png` })

/* ── 2.5 원본보기 — 이력서 PDF 를 같은 창에서 ── */
step('2.5 이력서 원본')
const id = (hr.match(/지원자 번호\s*\n?\s*(\d+)/) ?? [])[1]
check('상세에 지원자 번호가 있다', !!id, id ?? '없음')
const head = (await page.request.head(`${URL.replace(/\/$/, '')}/resumes/${id}`)).status()
check('그 번호로 원본이 내려온다', head === 200, `HTTP ${head}`)

await page.getByRole('button', { name: '원본보기' }).click()
await page.waitForSelector('.applicant-pdf iframe', { timeout: 5000 })
const src = await page.locator('.applicant-pdf iframe').getAttribute('src')
check('그 지원자의 원본을 연다', src === `/resumes/${id}`, src ?? '')
check('상세는 잠시 접힌다', (await page.locator('.applicant-body').count()) === 0)
check('단추가 「상세보기」로 바뀐다', await page.getByRole('button', { name: '상세보기' }).isVisible())
await page.waitForTimeout(700)
await page.screenshot({ path: `${SHOTS}/a3-원본보기.png` })
await page.getByRole('button', { name: '상세보기' }).click()
await page.waitForSelector('.applicant-body', { timeout: 3000 })
check('다시 상세로 돌아온다', (await page.locator('.applicant-pdf').count()) === 0)

/* 아래 둘은 일부러 실패를 확인하는 요청이라 **페이지 밖에서** 때린다 —
   페이지 안에서 fetch 하면 브라우저가 404·403 을 콘솔 오류로 적어 「콘솔 오류 0」이 깨진다. */
const missing = (await page.request.head(`${URL.replace(/\/$/, '')}/resumes/9999999`)).status()
check('원본이 없으면 404 로 답한다', missing === 404, `HTTP ${missing}`)
const master = (await page.request.get(`${URL.replace(/\/$/, '')}/data/%EC%B7%A8%ED%95%A9%ED%8C%8C%EC%9D%BC.xlsx`)).status()
check('취합파일은 여전히 막혀 있다', master === 403, `HTTP ${master}`)

/* ── 3. 닫기 ── */
step('3. 닫기')
await closeModal()
check('ESC 로 닫힌다', (await page.locator('.modal.applicant').count()) === 0)
await page.locator(`td[data-spot="${first.spot}"] .card-more`).click()
await page.waitForSelector('.modal.applicant')
await page.mouse.click(20, 20)
await page.waitForTimeout(200)
check('바깥을 눌러도 닫힌다', (await page.locator('.modal.applicant').count()) === 0)

/* ── 4. 끌기와 부딪히지 않는다 ── */
step('4. 상세 단추를 눌러도 카드가 안 옮겨진다')
const before = await page.evaluate(() => {
  const raw = localStorage.getItem('ax.v1.session')
  return raw ? (JSON.parse(raw).edit?.events?.length ?? 0) : 0
})
await page.locator(`td[data-spot="${first.spot}"] .card-more`).click()
await page.waitForSelector('.modal.applicant')
await closeModal()
const after = await page.evaluate(() => {
  const raw = localStorage.getItem('ax.v1.session')
  return raw ? (JSON.parse(raw).edit?.events?.length ?? 0) : 0
})
check('편집 이벤트가 안 생긴다', before === after, `${before} → ${after}`)
check('그 자리에 그대로 있다',
  (await page.locator(`td[data-spot="${first.spot}"] .cell-card b`).innerText()) === first.name)

/* ── 5. 면접관 일정 패널에서 열기 ── */
step('5. 면접관 일정 패널에서 열기')
await page.locator('.summary button', { hasText: '면접관 일정' }).click()
await page.waitForSelector('.people-list')
const who = await page.locator('.people-list .p-name').first().innerText()
await page.locator('.people-list .p-name').first().click()
await page.waitForSelector('.modal.applicant', { timeout: 3000 })
check('면접관 목록의 지원자 이름으로도 열린다', (await modalText()).includes(who), who)
await closeModal()
await page.locator('.summary button', { hasText: '면접관 일정' }).click()

/* ── 6. 팀 담당자 화면 — 인적 항목이 가려진다 ── */
step('6. 팀 담당자 — 인적 항목은 안 보인다')
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.trim() === '팀 담당자') { b.click(); return }
  }
})
await page.waitForTimeout(300)
await page.evaluate(() => {
  for (const a of document.querySelectorAll('.side a, .side button, nav button, nav a')) {
    if (a.textContent.includes('우리 팀 면접')) { a.click(); return }
  }
})
await page.waitForSelector('.p-name', { timeout: 5000 })
const teamWho = await page.locator('.p-name').first().innerText()
await page.locator('.p-name').first().click()
await page.waitForSelector('.modal.applicant', { timeout: 3000 })
const team = await modalText()
check('팀 화면에서도 열린다', team.includes(teamWho), teamWho)
for (const label of ['생년월일', '나이', '성별', '국적', '병역구분', '계급'])
  check(`인적 항목 「${label}」 이 가려진다`, !team.includes(label))
for (const label of ['학교명', '주전공', '1지망 직무'])
  check(`면접에 필요한 「${label}」 은 보인다`, team.includes(label))
check('「원본 값 더 보기」도 안 보인다', !team.includes('원본 값 더 보기'))
await page.screenshot({ path: `${SHOTS}/a2-팀담당자.png` })
await closeModal()

/* ── 판정 ── */
console.log('\n═══ 판정 ═══')
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '))
const failed = checks.filter(([, ok]) => !ok)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
await browser.close()
process.exit(failed.length ? 1 : 0)
