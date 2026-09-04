/* 이력서 PDF 폴더 → 명단 실브라우저 검증.

   취합파일로 만든 편성과 PDF 폴더로 만든 편성이 **같은지**가 핵심이다 — 엔진은
   지원자 번호·성명·학력만 쓰므로 두 입구의 결과가 갈리면 파서가 그중 하나를 틀린 것이다.
   pdf.js 워커가 실제 브라우저에서 뜨는지는 여기서만 확인된다(단위 테스트는 Node 빌드를 쓴다). */
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = '/Users/dulos/orca/projects/lgHR_Hack_Twins/lg-demo'
const URL = process.env.APP_URL || 'http://localhost:5173/'
const SHOTS = process.argv[2] || '/tmp'
const PDF_DIR = resolve(ROOT, 'data/lg_resumes_pdf')
const PDF_COUNT = readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf')).length
const teamFiles = readdirSync(`${ROOT}/data`)
  .filter(f => f.startsWith('희망지원자') && f.endsWith('.xlsx'))
  .map(f => resolve(ROOT, 'data', f))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const NOISE = /ERR_CONNECTION_REFUSED|11434|Failed to fetch/
page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
/* 헤드리스 크롬에는 PDF 뷰어가 없어 iframe 의 /resumes/ 요청이 「실패」로 찍힌다 — 파일이 열리는지는 HEAD 로 따로 본다 */
page.on('requestfailed', r => { if (!/11434|\/resumes\//.test(r.url())) errors.push(`요청 실패 ${r.url()}`) })

const checks = []
const check = (name, ok, extra = '') => { checks.push([name, ok, extra]); console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const step = s => console.log(`\n── ${s}`)
const PDF_INPUT = 'input[aria-label="이력서 PDF 폴더 업로드"]'
const XLSX_INPUT = 'input[aria-label="명단 엑셀 업로드"]'

const scheduleShape = async () => ({
  summary: await page.locator('.summary').innerText(),
  days: await page.locator('.day-tabs button').count(),
  cards: await page.locator('.schedule-table .cell-card').count(),
})
const fresh = async () => {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '지원자 명단 등록' }).first().click()
}
const runSchedule = async () => {
  await page.getByRole('button', { name: '면접 일정 편성' }).first().click()
  await page.waitForSelector('input[type=file]')
  await page.setInputFiles('input[type=file]', teamFiles)
  await page.waitForSelector('.schedule-table .cell-card', { timeout: 60000 })
  await page.waitForTimeout(300)
  return scheduleShape()
}

/* ── 0. 기준선 — 취합파일로 편성 ── */
step('0. 기준선 — 취합파일로 편성')
await fresh()
await page.setInputFiles(XLSX_INPUT, resolve(ROOT, 'data', '취합파일.xlsx'))
await page.waitForFunction(() => !!localStorage.getItem('ax.v1.session'), null, { timeout: 30000 })
const baseline = await runSchedule()
console.log(`   ${baseline.summary.replace(/\n/g, ' | ')} · 일자 ${baseline.days} · 카드 ${baseline.cards}`)

/* ── 1. PDF 폴더 올리기 ── */
step('1. 이력서 PDF 폴더 올리기')
await fresh()
check('두 입구가 나란히 있다', (await page.locator(XLSX_INPUT).count()) === 1 && (await page.locator(PDF_INPUT).count()) === 1)
check('PDF 입력이 폴더를 고른다', (await page.locator(PDF_INPUT).getAttribute('webkitdirectory')) !== null)
const t0 = Date.now()
await page.setInputFiles(PDF_INPUT, PDF_DIR)
const sawProgress = await page.locator('.chip', { hasText: 'PDF 읽는 중' }).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
await page.locator('.chip', { hasText: `${PDF_COUNT}명` }).first().waitFor({ timeout: 180000 })
const elapsed = Date.now() - t0
check('읽는 동안 진행을 보여 준다', sawProgress)
check(`PDF ${PDF_COUNT}장이 명단이 된다`, true, `${(elapsed / 1000).toFixed(1)}초`)
const chip = await page.locator('.upload-panel').nth(1).locator('.chip').innerText()
check('칩에 폴더 이름과 장 수가 실린다', /lg_resumes_pdf\/ \(PDF \d+개\)/.test(chip), chip)
check('취합파일 칩은 대기 상태다', (await page.locator('.upload-panel').nth(0).locator('.chip').innerText()).includes('업로드 대기'))
await page.screenshot({ path: `${SHOTS}/r1-pdf명단.png` })

/* ── 2. 명단 표 ── */
step('2. 명단 표')
const headers = await page.locator('.roster-table th').allInnerTexts()
check('열은 읽은 항목 11개다', headers.length === 11, headers.join(' · '))
check('지원자 번호·한글성명·최종학력_학교유형이 있다', ['지원자 번호', '한글성명', '최종학력_학교유형'].every(h => headers.includes(h)))
const masked = await page.locator('.roster-table th.blind-col').allInnerTexts()
check('블라인드가 생년월일·성별·학교명을 가린다', masked.length === 3 && masked.includes('생년월일') && masked.includes('성별') && masked.includes('최종학력_학교명'), masked.join(' · '))
const firstRow = await page.locator('.roster-table tbody tr').first().locator('td').allInnerTexts()
check('첫 행이 3200370 마초롱 과정1 이다', firstRow[0] === '3200370' && firstRow[1] === '마초롱' && firstRow[7] === '과정1', firstRow.slice(0, 8).join(' · '))
check('가린 칸은 ●● 로 보인다', firstRow[2] === '●●' && firstRow[3] === '●●')
check('파일별 경고가 없다 (합성본 467장은 전부 읽힌다)', (await page.locator('.roster-notes').count()) === 0)
check('다음 단계 안내에 인원이 맞다', (await page.locator('.next-panel').innerText()).includes(`명단 ${PDF_COUNT}명`))

/* ── 3. 새로고침 복원 ── */
step('3. 새로고침해도 남는다')
const bytes = await page.evaluate(() => localStorage.getItem('ax.v1.session')?.length ?? 0)
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: '지원자 명단 등록' }).first().click()
const chipAfter = await page.locator('.upload-panel').nth(1).locator('.chip').innerText()
check('PDF 칩이 복원된다', chipAfter.includes(`${PDF_COUNT}명`), chipAfter)
check('저장 용량이 취합파일보다 작다', bytes < 400_000, `${(bytes / 1024).toFixed(0)}KB`)

/* ── 4. 팀 회신 → 편성이 기준선과 같다 ── */
step('4. 팀 회신을 올려 편성 — 취합파일 기준선과 같아야 한다')
const viaPdf = await runSchedule()
console.log(`   ${viaPdf.summary.replace(/\n/g, ' | ')} · 일자 ${viaPdf.days} · 카드 ${viaPdf.cards}`)
check('편성 요약이 같다', viaPdf.summary === baseline.summary)
check('일자 수가 같다', viaPdf.days === baseline.days)
check('1일차 카드 수가 같다', viaPdf.cards === baseline.cards)
await page.screenshot({ path: `${SHOTS}/r2-pdf편성.png` })

/* ── 5. 지원자 상세와 이력서 원본 ── */
step('5. 지원자 상세 — 읽은 항목만 보이고 원본은 그대로 열린다')
const first = await page.evaluate(() => {
  const c = document.querySelector('td[data-spot] .cell-card')
  return { name: c.querySelector('b').textContent, spot: c.closest('td').dataset.spot }
})
await page.locator(`td[data-spot="${first.spot}"] .card-more`).click()
await page.waitForSelector('.modal.applicant', { timeout: 3000 })
const modal = await page.locator('.modal.applicant').innerText()
check('그 지원자의 창이 뜬다', modal.includes(first.name), first.name)
check('학력·지원 항목이 보인다', modal.includes('주전공') && modal.includes('지원자 번호'))
check('취합파일에만 있는 항목은 없다', !modal.includes('러브지니') && !modal.includes('지도교수'))
check('「원본 값 더 보기」가 없다 (남는 열이 없다)', !modal.includes('원본 값 더 보기'))
const id = modal.match(/지원자 번호\s*\n?\s*(\d+)/)?.[1]
check('지원자 번호가 창에 있다', !!id, id ?? '')
const head = (await page.request.head(`${URL.replace(/\/$/, '')}/resumes/${id}`)).status()
check('그 번호의 이력서 원본이 열린다', head === 200, `HEAD ${head}`)
await page.getByRole('button', { name: '원본보기' }).click()
await page.waitForSelector('.applicant-pdf iframe', { timeout: 5000 })
check('원본 창이 같은 번호를 가리킨다', (await page.locator('.applicant-pdf iframe').getAttribute('src')) === `/resumes/${id}`)
await page.keyboard.press('Escape')

/* ── 6. 취합파일로 다시 올리면 PDF 명단을 대체한다 ── */
step('6. 취합파일을 올리면 PDF 명단을 대체한다')
await page.getByRole('button', { name: '지원자 명단 등록' }).first().click()
await page.setInputFiles(XLSX_INPUT, resolve(ROOT, 'data', '취합파일.xlsx'))
await page.locator('.upload-panel').nth(0).locator('.chip', { hasText: '취합파일.xlsx' }).waitFor({ timeout: 30000 })
check('취합파일 칩이 채워진다', true)
check('PDF 칩은 안내 문구로 돌아간다', (await page.locator('.upload-panel').nth(1).locator('.chip').innerText()).includes('폴더를 고르면'))
check('열이 취합파일 것(52열)으로 바뀐다', (await page.locator('.roster-table th').count()) === 52)

/* ── 7. PDF 가 아닌 폴더 ── */
step('7. 이력서가 없는 폴더는 이유를 말한다')
await page.setInputFiles(PDF_INPUT, resolve(ROOT, 'docs'))
const alert = await page.locator('[role=alert]').first().innerText({ timeout: 10000 }).catch(() => '')
check('PDF 가 없다고 알린다', alert.includes('PDF 가 없습니다'), alert)
check('기존 명단(취합파일)은 그대로다', (await page.locator('.roster-table th').count()) === 52)

console.log('\n═══ 판정 ═══')
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' / '))
const failed = checks.filter(([, ok]) => !ok)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
await browser.close()
process.exit(failed.length ? 1 : 0)
