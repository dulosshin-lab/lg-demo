/* 전형 설정 실브라우저 검증 — 설정이 실제 편성으로 이어지는지, 확정 때 잠기는지 */
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

const goPage = async label => {
  await page.evaluate(t => {
    for (const b of document.querySelectorAll('.side button, .side a, nav button, nav a'))
      if (b.textContent.trim().startsWith(t)) { b.click(); return }
  }, label)
  await page.waitForTimeout(300)
}
/** 라벨로 입력칸 찾기 — 설정 화면은 label > span + input 짜임이다 */
const fieldOf = label => page.locator('.s-field', { hasText: label }).first().locator('input, select').first()
const setNum = async (label, v) => { await fieldOf(label).fill(String(v)); await page.waitForTimeout(150) }
const previewText = () => page.locator('.s-preview').innerText()

/* ── 준비: 명단만 올린 상태에서 설정부터 만진다 ── */
await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(() => { localStorage.clear() })
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: '지원자 명단 등록' }).first().click()
await page.setInputFiles('input[type=file]', resolve(ROOT, 'data', '취합파일.xlsx'))
await page.waitForFunction(() => !!localStorage.getItem('ax.v1.session'), null, { timeout: 30000 })
step('명단 등록 완료')

/* ── 1. 설정 화면이 실제로 열린다 ── */
step('1. 전형 설정 화면')
await goPage('전형 설정')
await page.waitForSelector('#setup-title', { timeout: 5000 })
check('정적 그림이 아니라 진짜 화면이다', (await page.locator('.s-panel').count()) >= 5,
  `${await page.locator('.s-panel').count()}개 절`)
for (const t of ['면접 기간', '일일 슬롯', '팀 회신 마감일', '편성 규칙'])
  check(`${t} 절이 있다`, (await page.locator('.s-head').allInnerTexts()).some(x => x.includes(t)))
check('조별 화상 링크가 접혀 있다', (await page.locator('summary', { hasText: '조별 화상 링크' }).count()) === 1)

/* ── 2. 고치면 계산 결과가 따라 움직인다 ── */
step('2. 미리보기 — 끝나는 시각·하루 자리·왜 N일')
const base = await previewText()
check('시작·종료 시각을 보여 준다', /시작 · 마지막 면접 \d{2}:\d{2} 종료/.test(base), base.split('\n')[0])
check('하루 자리를 센다', base.includes('하루 32자리'), base.split('\n')[1])

await setNum('면접 시간', 25)
await setNum('시작 시각', '09:00')
const after = await previewText()
check('면접 시간을 줄이면 끝나는 시각이 당겨진다', after !== base, after.split('\n')[0])
check('시작 시각이 반영된다', after.includes('09:00 시작'))

await setNum('조 수', 6)
check('조 수를 늘리면 하루 자리가 는다', (await previewText()).includes('하루 48자리'))
await setNum('조 수', 4)

/* ── 3. 경고 ── */
step('3. 말 안 되는 설정에는 알린다')
await setNum('오전 세션 수', 8)
await page.waitForTimeout(200)
check('오전 세션이 넘치면 경고한다',
  (await page.locator('.s-warn').count()) === 1 && (await page.locator('.s-warn').innerText()).includes('오전'))
await setNum('오전 세션 수', 4)
await page.waitForTimeout(200)
check('바로잡으면 경고가 사라진다', (await page.locator('.s-warn').count()) === 0)

/* ── 4. 공휴일 ── */
step('4. 공휴일 제외')
await page.locator('.s-field', { hasText: '쉬는 날 추가' }).locator('input').fill('2026-08-18')
await page.getByRole('button', { name: '추가' }).click()
await page.waitForTimeout(200)
check('쉬는 날이 칩으로 붙는다', (await page.locator('.s-chip').innerText()).includes('2026-08-18'))

/* ── 5. 전형 이름과 링크 ── */
step('5. 전형 이름 · 조별 링크')
await page.locator('.s-field', { hasText: '전형 이름' }).locator('input').fill('2026 하반기 신입 2차')
await page.locator('summary', { hasText: '조별 화상 링크' }).click()
await page.waitForTimeout(200)
for (let i = 1; i <= 4; i++)
  await page.locator('.fold-body .s-field', { hasText: `${i}조` }).first().locator('input').fill(`https://link/${i}`)
await page.waitForTimeout(200)
check('링크 입력 수가 요약에 뜬다', (await page.locator('summary', { hasText: '조별 화상 링크' }).innerText()).includes('4/4조'))

/* ── 6. 설정대로 편성된다 ── */
step('6. 이 설정으로 1차 편성')
await goPage('면접 일정 편성')
await page.setInputFiles('input[type=file]', teamFiles)
await page.waitForSelector('.schedule-table .cell-card', { timeout: 60000 })
const firstTime = await page.locator('.schedule-table tbody th').first().innerText()
check('시작 시각 09:00 이 편성표에 반영됐다', firstTime.startsWith('09:00'), firstTime)
const tabs = await page.locator('.day-tabs button').allInnerTexts()
check('공휴일 8/18 을 건너뛴다', !tabs.some(t => t.includes('8/18')), tabs.map(t => t.split(' ')[1]).join(' '))
check('일자 수는 그대로 3일', (await page.locator('.day-tabs button').count()) === 3)
await page.screenshot({ path: `${SHOTS}/s1-설정반영.png` })

/* ── 7. 저장·복원 ── */
step('7. 새로고침해도 설정이 남는다')
await page.reload({ waitUntil: 'networkidle' })
await goPage('전형 설정')
await page.waitForSelector('#setup-title')
check('전형 이름이 복원된다',
  (await page.locator('.s-field', { hasText: '전형 이름' }).locator('input').inputValue()) === '2026 하반기 신입 2차')
check('면접 시간이 복원된다', (await fieldOf('면접 시간').inputValue()) === '25')
check('쉬는 날이 복원된다', (await page.locator('.s-chip').innerText()).includes('2026-08-18'))

/* ── 8. 확정하면 시간표가 잠긴다 ── */
step('8. 확정 뒤 시간표 잠금')
await goPage('면접 일정 편성')
await page.waitForSelector('.schedule-table .cell-card')
await page.getByRole('button', { name: '1일차 확정' }).click()
await page.waitForTimeout(300)
await goPage('전형 설정')
await page.waitForSelector('#setup-title')
check('왜 잠겼는지 알려 준다', (await page.locator('.s-lock').innerText()).includes('확정한 날짜가 1일'),
  (await page.locator('.s-lock').innerText()).slice(0, 60))
check('면접 시간이 잠긴다', await fieldOf('면접 시간').isDisabled())
check('세션 수가 잠긴다', await fieldOf('하루 세션 수').isDisabled())
check('시작 시각이 잠긴다', await fieldOf('시작 시각').isDisabled())
check('조 수는 안 잠긴다 — 시각을 안 바꾼다', !(await fieldOf('조 수').isDisabled()))
check('전형 이름도 안 잠긴다',
  !(await page.locator('.s-field', { hasText: '전형 이름' }).locator('input').isDisabled()))
await page.screenshot({ path: `${SHOTS}/s2-잠금.png` })

await goPage('면접 일정 편성')
await page.getByRole('button', { name: '1일차 확정 해제' }).click()
await page.waitForTimeout(300)
await goPage('전형 설정')
check('확정을 풀면 다시 열린다', !(await fieldOf('면접 시간').isDisabled()))

/* ── 판정 ── */
console.log('\n═══ 판정 ═══')
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '))
const failed = checks.filter(([, ok]) => !ok)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
await browser.close()
process.exit(failed.length ? 1 : 0)
