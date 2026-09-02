/* 실브라우저 검증 — 업로드 → 새로고침 → 복원 */
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
/* Ollama(11434) 는 시연 때만 띄운다 — 챗봇의 연결 실패는 이 검증과 무관하다 */
const errors = []
const OLLAMA_NOISE = /ERR_CONNECTION_REFUSED|11434|Failed to fetch/
const note = t => { if (!OLLAMA_NOISE.test(t)) errors.push(t) }
page.on('console', m => { if (m.type() === 'error') note(m.text()) })
page.on('pageerror', e => note(`pageerror: ${e.message}`))
page.on('requestfailed', r => { if (!/11434/.test(r.url())) note(`요청 실패 ${r.url()}`) })

const step = (n, s) => console.log(`[${n}] ${s}`)
const ls = () => page.evaluate(() => {
  const raw = localStorage.getItem('ax.v1.session')
  if (!raw) return null
  const o = JSON.parse(raw)
  return { v: o.v, id: o.id, savedAt: o.savedAt, bytes: raw.length,
           rows: o.roster?.parsed?.rows?.length ?? 0,
           placed: o.schedule?.result?.placed?.length ?? 0,
           hasGrid: 'grid' in (o.schedule?.result ?? {}) }
})

await page.goto(URL, { waitUntil: 'networkidle' })
step(1, '앱 로드')
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })

// 지원자 명단 등록
await page.getByRole('button', { name: '지원자 명단 등록' }).first().click()
await page.setInputFiles('input[type=file]', resolve(ROOT, 'data', '취합파일.xlsx'))
await page.waitForFunction(() => !!localStorage.getItem('ax.v1.session'), null, { timeout: 30000 })
step(2, `명단 업로드 완료 · 저장됨 ${JSON.stringify(await ls())}`)

// 면접 일정 편성
await page.getByRole('button', { name: '면접 일정 편성' }).first().click()
await page.waitForSelector('input[type=file]')
await page.setInputFiles('input[type=file]', teamFiles)
await page.waitForSelector('.schedule-table table', { timeout: 60000 })
const before = {
  summary: await page.locator('.summary').innerText(),
  days: await page.locator('.day-tabs button').count(),
  cells: await page.locator('.schedule-table td b').count(),
  more: await page.locator('.more').innerText(),
}
step(3, `편성 완료 · ${before.summary.replace(/\n/g, ' / ')} · 일자탭 ${before.days} · 1일차 표시 ${before.cells}명`)
step(3.1, `저장됨 ${JSON.stringify(await ls())}`)
await page.screenshot({ path: `${SHOTS}/1-편성완료.png` })

// ── 새로고침 ──
await page.reload({ waitUntil: 'networkidle' })
step(4, '새로고침')
const restoredBanner = await page.locator('.restored').count()
await page.getByRole('button', { name: '면접 일정 편성' }).first().click()
await page.waitForSelector('.schedule-table table', { timeout: 15000 })
const after = {
  summary: await page.locator('.summary').innerText(),
  days: await page.locator('.day-tabs button').count(),
  cells: await page.locator('.schedule-table td b').count(),
  more: await page.locator('.more').innerText(),
}
step(5, `복원됨 · ${after.summary.replace(/\n/g, ' / ')} · 일자탭 ${after.days} · 1일차 표시 ${after.cells}명`)
step(5.1, `복원 안내 띠 ${restoredBanner ? '표시됨' : '없음'}`)
await page.screenshot({ path: `${SHOTS}/2-복원후.png` })

// 3일차까지 각 탭 대조
const perDay = async () => {
  const out = []
  const n = await page.locator('.day-tabs button').count()
  for (let i = 0; i < n; i++) {
    await page.locator('.day-tabs button').nth(i).click()
    out.push(await page.locator('.schedule-table td b').count())
  }
  return out
}
const afterDays = await perDay()
step(6, `일자별 배치 수(복원 후): ${afterDays.join(' / ')} = 합 ${afterDays.reduce((a, b) => a + b, 0)}명`)

// "새로 시작"
await page.locator('.restored button').click().catch(() => {})
await page.waitForTimeout(300)
const cleared = await ls()
step(7, `새로 시작 → 저장분 ${cleared === null ? '지워짐' : '남음(문제)'}`)
await page.screenshot({ path: `${SHOTS}/3-새로시작.png` })

console.log('\n═══ 판정 ═══')
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const checks = [
  ['편성 요약이 새로고침 전후 같다', before.summary === after.summary],
  ['일자 탭 수가 같다', before.days === after.days],
  ['1일차 배치 인원이 같다', before.cells === after.cells],
  ['세션×조 표기가 같다', before.more === after.more],
  ['복원 안내 띠가 뜬다', restoredBanner > 0],
  ['새로 시작이 저장분을 지운다', cleared === null],
  ['콘솔 오류 없음', errors.length === 0],
]
checks.forEach(([n, ok]) => console.log(`${ok ? '✅' : '❌'} ${n}`))
if (errors.length) console.log('\n콘솔 오류:', errors.slice(0, 5))
console.log(`\n편성 전: ${before.summary.replace(/\n/g, ' | ')}`)
console.log(`복원 후: ${after.summary.replace(/\n/g, ' | ')}`)
await browser.close()
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
