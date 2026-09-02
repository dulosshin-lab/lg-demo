/* 지원자 상세 — 취합파일의 원본 행을 사람이 읽는 묶음으로 편다.

   왜 「이력서」가 아니라 「지원자 상세」인가 —
   취합파일에는 정형 항목(인적·학력·어학·자격증)만 있고 **자기소개서·경력기술서·포트폴리오가
   없다.** 면접관이 이력서를 여는 이유의 절반이 그 서술형이라, 이 화면을 「이력서」라고 부르면
   열어 본 사람이 "왜 자기소개서가 없냐"고 묻게 된다. 원본 PDF 가 연결되면 같은 창에 탭으로
   붙일 자리다.

   역할에 따라 보이는 항목이 다르다. 생년월일·성별·국적·병역은 채용에서 면접관에게 굳이 열
   항목이 아니다(블라인드 요소). 간사만 본다.

   실데이터에서 확인한 두 가지 —
   ① 날짜가 **엑셀 일련번호**(1899-12-30 이 0)로 들어온다. 같은 열에 '2026-02-16' 같은 문자열이
      섞여 있어 둘 다 받아야 한다.
   ② 열마다 채움률이 14~100% 로 제각각이고 아예 빈 열도 있다(러브지니·LG Aimers·보훈청 추천).
      빈 항목을 그대로 그리면 빈 칸 투성이가 되므로 **값이 있는 것만** 남긴다. */

export type Field = { readonly label: string; readonly value: string }
export type Section = { readonly title: string; readonly fields: readonly Field[] }

/** 'hr' = 간사(전체) · 'team' = 팀 담당자(인적 항목 제외) */
export type DetailRole = 'hr' | 'team'

export type Attrs = Record<string, string | number | null | undefined>

/** 엑셀 일련번호를 날짜로 — 1899-12-30 을 0 으로 센다(1900 윤년 버그 포함한 관례) */
export function excelDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 날짜 칸을 사람이 읽는 꼴로. 일련번호·문자열 둘 다 받고, 못 읽으면 원문을 그대로 돌려준다 */
export function dateText(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100000) {
    const d = excelDate(v)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : s
}

const DATE_COLS = new Set([
  '생년월일', '복무 종료일', '최종학력_졸업일', '학사1_졸업일',
  '공인어학성적1_취득일자', '공인어학성적2_취득일자',
])

/** 열 하나를 문자열로. 빈 값이면 '' */
function cell(attrs: Attrs, col: string): string {
  const v = attrs[col]
  if (v === null || v === undefined) return ''
  if (DATE_COLS.has(col)) return dateText(v)
  const s = String(v).trim()
  return s === '-' ? '' : s
}

type Spec = {
  readonly title: string
  /** [열 이름, 화면 라벨] — 라벨을 비우면 열 이름을 그대로 쓴다 */
  readonly cols: readonly (readonly [string, string?])[]
  /** 간사만 보는 묶음인가 */
  readonly hrOnly?: boolean
}

const SPECS: readonly Spec[] = [
  {
    title: '지원',
    cols: [
      ['지원자 번호'], ['1지망_조직', '1지망 조직'], ['1지망_직무', '1지망 직무'],
      ['1지망_지역', '1지망 지역'], ['R&D/N-R&D', 'R&D 구분'], ['직무', '직무 코드'],
      ['1차서류 결과'], ['이전 지원 전체 횟수', '이전 지원 횟수'],
      ['타겟랩여부', '타겟랩'], ['지도교수'],
    ],
  },
  {
    title: '인적',
    hrOnly: true,
    cols: [
      ['생년월일'], ['나이'], ['성별'], ['국적'],
      ['병역구분'], ['복무 종료일'], ['계급'],
    ],
  },
  {
    title: '최종학력',
    cols: [
      ['최종학력_학교명', '학교명'], ['최종학력_학교유형', '학교유형'],
      ['최종학력_주전공', '주전공'], ['최종학력_졸업구분', '졸업구분'],
      ['최종학력_졸업일', '졸업일'], ['최종학력_환산학점', '환산학점'],
      ['최종학력_전공환산학점', '전공 환산학점'],
      ['최종학력_복수/부전공 구분', '복수/부전공 구분'],
      ['최종학력_복수/부전공명', '복수/부전공명'],
    ],
  },
  {
    title: '학사',
    cols: [
      ['학사1_학교명', '학교명'], ['학사1_학교유형', '학교유형'],
      ['학사1_주전공', '주전공'], ['학사1_졸업구분', '졸업구분'],
      ['학사1_졸업일', '졸업일'], ['학사1_환산학점', '환산학점'],
      ['학사1_전공환산학점', '전공 환산학점'],
      ['학사1_복수/부전공 구분', '복수/부전공 구분'],
      ['학사1_복수/부전공명', '복수/부전공명'],
    ],
  },
  {
    title: '어학',
    cols: [
      ['공인어학성적1_언어', '언어'], ['공인어학성적1_시험명', '시험명'],
      ['공인어학성적1_점수/등급', '점수/등급'], ['공인어학성적1_취득일자', '취득일'],
      ['공인어학성적2_언어', '언어 2'], ['공인어학성적2_시험명', '시험명 2'],
      ['공인어학성적2_점수/등급', '점수/등급 2'], ['공인어학성적2_취득일자', '취득일 2'],
    ],
  },
  {
    title: '자격증',
    cols: [
      ['자격증1_자격증명', '자격증 1'], ['자격증2_자격증명', '자격증 2'],
      ['자격증3_자격증명', '자격증 3'],
    ],
  },
]

/** 최종학력과 학사가 같은 학교·전공이면 학사 묶음은 접는다 — 학사 지원자는 두 묶음이 똑같다 */
const sameSchool = (a: Attrs) =>
  cell(a, '최종학력_학교명') === cell(a, '학사1_학교명') &&
  cell(a, '최종학력_주전공') === cell(a, '학사1_주전공') &&
  cell(a, '최종학력_졸업일') === cell(a, '학사1_졸업일')

/** 원본 행을 화면에 그릴 묶음으로 편다. 값이 없는 항목과 빈 묶음은 빠진다. */
export function detailOf(attrs: Attrs | undefined, role: DetailRole): Section[] {
  if (!attrs) return []
  const out: Section[] = []
  for (const spec of SPECS) {
    if (spec.hrOnly && role !== 'hr') continue
    if (spec.title === '학사' && sameSchool(attrs)) continue
    const fields: Field[] = []
    for (const [col, label] of spec.cols) {
      const value = cell(attrs, col)
      if (value) fields.push({ label: label ?? col, value })
    }
    if (fields.length) out.push({ title: spec.title, fields })
  }
  return out
}

/** 화면에 안 실린 나머지 열 — 「원본 값 더 보기」로 접어 둔다. 간사만 본다. */
export function restOf(attrs: Attrs | undefined, role: DetailRole): Field[] {
  if (!attrs || role !== 'hr') return []
  const used = new Set(SPECS.flatMap(s => s.cols.map(([c]) => c)))
  // 이름 조각은 한글성명과 겹쳐 읽을 것이 없다
  const skip = new Set(['한글성명', '한글성', '한글이름'])
  const out: Field[] = []
  for (const col of Object.keys(attrs)) {
    if (used.has(col) || skip.has(col)) continue
    const value = cell(attrs, col)
    if (value) out.push({ label: col, value })
  }
  return out
}
