/* 제약사항별 테스트 엑셀 생성기.

   `data/constraint-tests/<케이스>/` 아래에 취합파일 + 팀 회신 파일을 만든다.
   케이스 하나가 제약 하나를 겨눈다 — 손으로 세어 확인할 수 있을 만큼 작게 잡았고,
   기대값은 `docs/제약사항_정리.md` 와 `tests/constraint-cases.test.ts` 에 적혀 있다.

   서식은 실제 회신 파일(`data/희망지원자_*.xlsx`)을 따른다:
     - 4행이 헤더 (STD_HEADER_ROW), 5행부터 데이터
     - 면접관 = 헤더 텍스트가 있는 마지막 열
     - 취합파일에는 면접관 열이 없다

     node scripts/make-constraint-cases.mjs
*/
import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'data/constraint-tests')

/** headers.ts 의 STD 와 같은 순서 — 하나라도 빠지면 파서가 '표준 컬럼 누락' 경고를 낸다 */
const STD = [
  '지원자 번호', '한글성명', '생년월일', '나이', '성별', '국적', '병역구분', '복무 종료일', '계급',
  '1지망_조직', '1지망_직무', '1지망_지역', 'R&D/N-R&D', '직무', '최종학력_학교유형', '최종학력_학교명',
  '최종학력_졸업구분', '최종학력_졸업일', '최종학력_주전공', '최종학력_환산학점', '최종학력_전공환산학점',
]

const EDU_CODE = { 학사: '과정1', 석사: '과정2', 박사: '과정3' }

const NAMES = [
  '가온', '나래', '다솜', '라온', '마루', '바다', '사랑', '아라', '자람', '차오름',
  '카린', '타래', '파랑', '하람', '새봄', '별빛', '온누리', '해오름', '미르', '슬기',
  '여울', '도담', '한별', '벼리', '이든', '유하', '시온', '라희', '노을', '초롱',
  '단비', '구름', '나린', '보라', '아름', '예솔', '주아', '한솔', '푸름', '소망',
]
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임']
const SCHOOLS = ['아라대학교', '마루대학교', '타래대학교', '사랑대학교', '슬기대학교']
const MAJORS = ['미르지능학과', '벼리재료학과', '여울생산학과', '온누리연산학부', '해오름설계학과']
const JOBS = ['직무가', '직무나', '직무다', '직무라']

/** 지원자 하나 — 케이스별로 id 를 겹치지 않게 시드에서 굴린다 */
function makeApp(seq, edu) {
  const id = 4000000 + seq
  const name = SURNAMES[seq % SURNAMES.length] + NAMES[seq % NAMES.length]
  return {
    id, name, edu,
    row: {
      '지원자 번호': id,
      '한글성명': name,
      '생년월일': '1998-03-14',
      '나이': 27,
      '성별': seq % 2 ? '성별A' : '성별B',
      '국적': '가온국',
      '병역구분': seq % 3 ? '이행완료' : '비대상',
      '복무 종료일': seq % 3 ? '2022-05-31' : '',
      '계급': seq % 3 ? '등급1' : '',
      '1지망_조직': '제1기술원',
      '1지망_직무': JOBS[seq % JOBS.length],
      '1지망_지역': '가상시 미르구',
      'R&D/N-R&D': '구분R',
      '직무': `D0${(seq % 4) + 1}`,
      '최종학력_학교유형': EDU_CODE[edu] ?? edu,   // edu 가 '과정4' 같은 원시 코드면 그대로 쓴다
      '최종학력_학교명': SCHOOLS[seq % SCHOOLS.length],
      '최종학력_졸업구분': '상태1',
      '최종학력_졸업일': '2026-02-14',
      '최종학력_주전공': MAJORS[seq % MAJORS.length],
      '최종학력_환산학점': 3.4 + (seq % 10) / 10,
      '최종학력_전공환산학점': 3.6 + (seq % 8) / 10,
    },
  }
}

/** 시트 한 장을 쓴다. headerRow 위쪽은 비워 둔다(실 파일의 그룹 헤더 자리). */
function addSheet(wb, name, columns, rows, headerRow = 4) {
  const ws = wb.addWorksheet(name)
  columns.forEach((c, i) => ws.getCell(headerRow, i + 1).value = c)
  rows.forEach((r, ri) => columns.forEach((c, ci) => {
    const v = r[c]
    ws.getCell(headerRow + 1 + ri, ci + 1).value = v === undefined || v === '' ? null : v
  }))
  return ws
}

async function writeMaster(dir, apps) {
  const wb = new ExcelJS.Workbook()
  addSheet(wb, 'Sheet1', STD, apps.map(a => a.row))
  await wb.xlsx.writeFile(path.join(dir, '취합파일.xlsx'))
}

/**
 * 팀 회신 파일 한 장.
 * @param rows      [{ app, iv }] — iv 가 null/'' 이면 면접관 미기재
 * @param opts.ivHeader  면접관 열의 헤더명 (기본 '면접관')
 * @param opts.noIv      면접관 열 자체를 붙이지 않는다
 * @param opts.headerRow 헤더 행 (기본 4 = 표준)
 */
async function writeTeam(dir, team, rows, opts = {}) {
  const { ivHeader = '면접관', noIv = false, headerRow = 4 } = opts
  const columns = noIv ? STD : [...STD, ivHeader]
  const wb = new ExcelJS.Workbook()
  addSheet(wb, 'Sheet1', columns,
    rows.map(({ app, iv }) => (noIv ? { ...app.row } : { ...app.row, [ivHeader]: iv ?? '' })),
    headerRow)
  await wb.xlsx.writeFile(path.join(dir, `희망지원자_${team}_re.xlsx`))
}

/** 케이스 하나 — 폴더를 비우고 취합파일 + 팀 파일을 새로 쓴다 */
async function build(caseName, { master, teams }) {
  const dir = path.join(OUT, caseName)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  await writeMaster(dir, master)
  for (const t of teams) await writeTeam(dir, t.team, t.rows, t.opts)
  const n = teams.reduce((a, t) => a + t.rows.length, 0)
  console.log(`${caseName.padEnd(28)} 취합 ${String(master.length).padStart(3)}명 · 팀 ${teams.length}개 · 요청 ${n}건`)
}

/** 순번을 케이스마다 다른 대역에서 굴린다 — 케이스를 섞어 올려도 지원자번호가 안 겹친다 */
const seeder = base => { let n = 0; return edu => makeApp(base + n++, edu) }

/* ────────────────────────────────────────────────────────────────
   C1 · 하드 ① 학력 분리
   학사 6 · 석사 4 · 박사 2 를 3팀에 섞어 넣는다. 팀 파일에는 학력이 뒤섞여 있지만
   편성 결과에서는 학사 → 석사 → 박사 블록이 시간축에서 갈려야 한다. */
async function c1() {
  const s = seeder(100)
  const B = Array.from({ length: 6 }, () => s('학사'))
  const M = Array.from({ length: 4 }, () => s('석사'))
  const D = Array.from({ length: 2 }, () => s('박사'))
  const master = [...B, ...M, ...D]
  const iv = { 가온기술팀: '김하늘', 나래솔루션팀: '이한별', 다솜생산팀: '박도윤' }
  const pick = (team, apps) => ({ team, rows: apps.map(app => ({ app, iv: iv[team] })) })
  await build('C1_학력분리_하드', {
    master,
    teams: [
      pick('가온기술팀', [B[0], B[1], B[2], M[0]]),
      pick('나래솔루션팀', [B[3], B[4], M[1], M[2]]),
      pick('다솜생산팀', [B[5], M[3], D[0], D[1]]),
    ],
  })
}

/* C2 · 하드 ② 팀 중복 — 한 팀 10명. 하루 8세션이 상한이라 반드시 2일로 갈린다. */
async function c2() {
  const s = seeder(200)
  const apps = Array.from({ length: 10 }, () => s('학사'))
  await build('C2_팀중복_하드', {
    master: apps,
    teams: [{ team: '가온기술팀', rows: apps.map(app => ({ app, iv: '김하늘' })) }],
  })
}

/* C3 · 하드 ② 면접관 중복 — 팀은 둘인데 면접관이 같은 사람이다.
   checkInterviewer 를 끄면 두 팀이 같은 세션에 나란히 앉아 한 사람이 두 방에 동시에 들어간다. */
async function c3() {
  const s = seeder(300)
  const A = Array.from({ length: 5 }, () => s('학사'))
  const B = Array.from({ length: 5 }, () => s('학사'))
  await build('C3_면접관중복_하드', {
    master: [...A, ...B],
    teams: [
      { team: '가온기술팀', rows: A.map(app => ({ app, iv: '한지호' })) },
      { team: '나래솔루션팀', rows: B.map(app => ({ app, iv: '한지호' })) },
    ],
  })
}

/* C4 · 하드 ② 합동면접 — 한 지원자가 여러 팀 회신에 동시에 등장한다.
   배치는 한 번뿐이고, 그 시간대는 관련된 팀·면접관 전부가 점유한 것으로 잡혀야 한다. */
async function c4() {
  const s = seeder(400)
  const apps = Array.from({ length: 8 }, () => s('학사'))
  const [a0, a1, a2, a3, a4, a5, a6, a7] = apps
  await build('C4_합동면접_하드', {
    master: apps,
    teams: [
      { team: '가온기술팀', rows: [a0, a1, a2, a3].map(app => ({ app, iv: '김하늘' })) },
      { team: '나래솔루션팀', rows: [a2, a3, a4, a5].map(app => ({ app, iv: '이한별' })) },
      { team: '다솜생산팀', rows: [a3, a6, a7].map(app => ({ app, iv: '박도윤' })) },
    ],
  })
}

/* C5 · 소프트 ③ 연속 배치 — 팀 6개 > 조 4개 · 팀 크기가 제각각 · 학사와 석사가 섞여 있다.
   팀 크기가 조 수로 딱 나눠떨어지면 그리디가 처음부터 깔끔하게 놓아 정리할 것이 없다.
   그래서 일부러 어긋나게 잡았다 — 학력 블록 경계가 하루 가운데를 지나가면서 팀이 쪼개진다.
   contiguous(arrange) 를 껐다 켰다 하며 팀 덩어리·면접관 쪼갬을 비교하는 자리다. */
async function c5() {
  const s = seeder(500)
  const spec = [
    ['가온기술팀', '김하늘', { 학사: 4, 석사: 1 }],
    ['나래솔루션팀', '이한별', { 학사: 2, 석사: 2 }],
    ['다솜생산팀', '박도윤', { 학사: 3, 석사: 0 }],
    ['라온품질팀', '최서준', { 학사: 5, 석사: 2 }],
    ['마루설계팀', '정예린', { 학사: 1, 석사: 1 }],
    ['바다공정팀', '강민재', { 학사: 4, 석사: 0 }],
  ]
  const master = []
  const teams = spec.map(([team, iv, mix]) => {
    const mine = []
    for (const [edu, n] of Object.entries(mix)) for (let i = 0; i < n; i++) mine.push(s(edu))
    master.push(...mine)
    return { team, rows: mine.map(app => ({ app, iv })) }
  })
  await build('C5_연속배치_소프트', { master, teams })
}

/* C6 · 소프트 ④ 첫 타임 — 수요가 1 · 2 · 8 · 8 로 갈린다.
   ④ 는 "첫 타임은 수요가 가장 적은 팀에게" 이므로 수요 1인 팀만 위반이 아니다.
   avoidFirstSlot 을 off / soft / hard 로 돌려 가며 위반 건수와 공석을 비교한다. */
async function c6() {
  const s = seeder(600)
  const spec = [['가온기술팀', 2, '김하늘'], ['나래솔루션팀', 3, '이한별'],
                ['다솜생산팀', 8, '박도윤'], ['라온품질팀', 8, '최서준']]
  const master = []
  const teams = spec.map(([team, n, iv]) => {
    const mine = Array.from({ length: n }, () => s('학사'))
    master.push(...mine)
    return { team, rows: mine.map(app => ({ app, iv })) }
  })
  await build('C6_첫타임_소프트', { master, teams })
}

/* C7 · 소프트 ⑤ 병목 팀 선배치 — 한 팀이 하루 세션 수(8)를 넘는 12명을 요청한다.
   ④(수요 적은 팀 먼저) 만 따르면 이 팀이 맨 뒤로 밀려 2일차 격자가 반쪽으로 빈다.
   조 3개로 돌리는 것을 전제로 만든 데이터다(README 의 4팀 3조 회귀와 같은 모양). */
async function c7() {
  const s = seeder(700)
  const spec = [['가온기술팀', 12, '김하늘'], ['나래솔루션팀', 3, '이한별'],
                ['다솜생산팀', 3, '박도윤'], ['라온품질팀', 3, '최서준']]
  const master = []
  const teams = spec.map(([team, n, iv]) => {
    const mine = Array.from({ length: n }, () => s('학사'))
    master.push(...mine)
    return { team, rows: mine.map(app => ({ app, iv })) }
  })
  await build('C7_병목팀선배치_소프트', { master, teams })
}

/* C8 · 대상 선별(제외 규칙 3종) — 편성 이전에 걸러지는 하드 필터다.
     · 마스터 미존재    회신에는 있는데 취합파일에 없다
     · 면접관 미매칭    어느 팀도 면접관을 안 적었다
     · 학력 구분 불명   최종학력_학교유형이 과정1/2/3 이 아니다
   여기에 「일부 팀만 면접관을 안 적은」 경우를 하나 넣는다 — 지원자는 살고 그 팀 요청만 버려진다. */
async function c8() {
  const s = seeder(800)
  const ok = Array.from({ length: 4 }, () => s('학사'))
  const ghost = s('학사')          // 취합파일에 넣지 않는다 → 마스터 미존재
  const blank = s('학사')          // 두 팀 다 면접관 공란 → 면접관 미매칭
  const badEdu = s('과정4')        // 학력 코드가 규칙 밖 → 학력 구분 불명
  const partial = s('학사')        // 한 팀만 면접관 기재 → 지원자는 유지, 그 팀만 버려진다
  await build('C8_대상선별_제외규칙', {
    master: [...ok, blank, badEdu, partial],           // ghost 는 빠져 있다
    teams: [
      { team: '가온기술팀', rows: [
        { app: ok[0], iv: '김하늘' }, { app: ok[1], iv: '김하늘' },
        { app: ghost, iv: '김하늘' }, { app: blank, iv: '' },
        { app: badEdu, iv: '김하늘' }, { app: partial, iv: '' },
      ] },
      { team: '나래솔루션팀', rows: [
        { app: ok[2], iv: '이한별' }, { app: ok[3], iv: '이한별' },
        { app: blank, iv: '' }, { app: partial, iv: '이한별' },
      ] },
    ],
  })
}

/* C9 · 파일 서식 규칙 — 편성 이전, 파서가 지키는 약속들.
   네 파일이 각각 하나씩 어긋난다. 화면의 경고 배너가 이 케이스로 확인된다. */
async function c9() {
  const s = seeder(900)
  const mk = n => Array.from({ length: n }, () => s('학사'))
  const A = mk(3), B = mk(3), C = mk(3), D = mk(3)
  await build('C9_파일서식_경고', {
    master: [...A, ...B, ...C, ...D],
    teams: [
      // ① 헤더 행이 5행 — 표준(4행)과 다르다는 경고만 내고 계속 간다
      { team: '가온기술팀', rows: A.map(app => ({ app, iv: '김하늘' })), opts: { headerRow: 5 } },
      // ② 면접관 헤더명이 '인원' — 헤더명으로는 못 찾는다. 마지막 열 규칙으로 고른다
      { team: '나래솔루션팀', rows: B.map(app => ({ app, iv: '이한별' })), opts: { ivHeader: '인원' } },
      // ③ 마지막 열 값이 사람 이름 모양이 아니다 — '사람 확인 필요' 배너
      { team: '다솜생산팀', rows: C.map(app => ({ app, iv: '가온팀' })), opts: { ivHeader: '담당조직' } },
      // ④ 면접관 열이 아예 없다 — 이 팀 요청은 전부 버려진다
      { team: '라온품질팀', rows: D.map(app => ({ app, iv: null })), opts: { noIv: true } },
    ],
  })
}

fs.mkdirSync(OUT, { recursive: true })
await c1(); await c2(); await c3(); await c4(); await c5()
await c6(); await c7(); await c8(); await c9()
console.log(`\n→ ${path.relative(ROOT, OUT)}/`)
