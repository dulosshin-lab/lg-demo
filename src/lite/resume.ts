/* 이력서 PDF → 지원자 마스터.

   취합파일 없이 이력서 PDF 폴더만으로 명단을 만드는 두 번째 입구다.
   PDF 를 읽는 일(pdf.js)은 pdfText.ts 가 맡고, 이 파일은 **글자와 좌표만** 받아 값을 찾는다.
   그래서 브라우저 없이 Node 에서 실제 PDF 467장을 태워 검증할 수 있다.

   ⚠ 지금 아는 양식은 `data/lg_resumes_pdf/` 의 합성본 하나뿐이다(python-docx → LibreOffice).
     LG 공식 양식이 오면 `FORMS` 에 하나를 더 붙이고 detectForm 이 고르게 한다.
     양식에 매인 것은 이 파일의 「양식별 자리 찾기」 절뿐이고, 명단 합치기·경고·화면은 양식과 무관하다.

   편성 엔진이 실제로 쓰는 값은 셋이다 — 지원자 번호 · 한글성명 · 최종학력_학교유형.
   나머지 열은 화면(명단 표·지원자 상세)에만 실리므로, 자신 있게 읽히는 것만 담고 추측하지 않는다. */
import type { Cell, MasterRow, ParsedMaster } from '@/core/ingest'
import { CRS } from '@/core/resolve'

/** pdf.js 가 주는 글자 조각 하나. y 는 위에서 아래로 커지는 화면 좌표다. */
export type TextItem = {
  readonly str: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export type ResumeForm = 'lg-synthetic-v1'

export type ResumeParse = {
  /** 알아본 양식. null 이면 이력서가 아니거나 모르는 양식이라 값을 만들지 않았다 */
  readonly form: ResumeForm | null
  /** 표준 컬럼명(취합파일 헤더) → 값. 못 읽은 항목은 키가 없다 */
  readonly fields: Readonly<MasterRow>
  readonly warnings: readonly string[]
}

/** PDF 에서 만든 마스터가 갖는 열 — 취합파일 헤더명 그대로, 이 순서로 화면에 실린다 */
export const RESUME_COLUMNS: readonly string[] = [
  '지원자 번호', '한글성명', '생년월일', '성별',
  '1지망_조직', '1지망_직무', '1지망_지역',
  '최종학력_학교유형', '최종학력_학교명', '최종학력_주전공', '최종학력_환산학점',
]

/** 「학사」 → 「과정1」. 취합파일은 코드로 적고 엔진(resolve.CRS)도 코드만 안다 */
const EDU_CODE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CRS).map(([code, label]) => [label, code]),
)

/* ── 줄 만들기 ─────────────────────────────────────────────────────────── */

type Line = { readonly y: number; readonly items: readonly TextItem[]; readonly text: string }

/** 같은 높이의 조각을 한 줄로 묶는다. 조각 사이의 공백 조각이 띄어쓰기를 그대로 실어 온다 */
export function linesOf(items: readonly TextItem[]): Line[] {
  const sorted = items.filter(i => i.str !== '').slice().sort((a, b) => a.y - b.y || a.x - b.x)
  const out: { y: number; items: TextItem[] }[] = []
  for (const it of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.y - it.y) <= 3) last.items.push(it)
    else out.push({ y: it.y, items: [it] })
  }
  return out.map(l => {
    const items = l.items.slice().sort((a, b) => a.x - b.x)
    return { y: l.y, items, text: items.map(i => i.str).join('').replace(/\s+/g, ' ').trim() }
  })
}

const center = (i: TextItem) => i.x + i.w / 2

/**
 * 표의 「행」 하나 — 셀 안에서 줄바꿈된 값은 위아래로 한 줄씩 더 찍히므로(간격 ≤ 16px)
 * 그 줄들까지 같은 행으로 묶는다. 다음 행은 더 큰 간격으로 떨어져 있다.
 */
function firstRowOf(lines: readonly Line[]): Line[] {
  const out: Line[] = []
  for (const l of lines) {
    if (out.length && l.y - out[out.length - 1].y > 16) break
    out.push(l)
  }
  return out
}

/**
 * 표 한 칸 읽기 — 머리글 줄의 라벨 위치로 열 경계를 잡고, 그 아래 행 구간의 조각을 열별로 모은다.
 * 셀 안에서 줄바꿈된 값(「학사」가 한 줄 아래 따로 찍힘)도 같은 열이면 같이 잡힌다.
 */
function tableCells(
  header: Line, labels: readonly string[], rows: readonly Line[],
): Map<string, string> {
  /* 머리글 라벨은 조각 여러 개로 갈라져 올 수 있다(「부」「·」「복수전공」). 공백을 뺀 머리글
     문자열에서 라벨을 찾고, 그 글자들을 덮는 조각들의 가운데를 열 중심으로 삼는다 */
  const owner: number[] = []
  let joined = ''
  header.items.forEach((it, k) => {
    const s = it.str.replace(/\s/g, '')
    joined += s
    for (let i = 0; i < s.length; i++) owner.push(k)
  })
  const cols = labels
    .map(label => {
      const key = label.replace(/\s/g, '')
      const at = joined.indexOf(key)
      if (at < 0) return null
      const first = header.items[owner[at]]
      const last = header.items[owner[at + key.length - 1]]
      return { label, c: (first.x + last.x + last.w) / 2 }
    })
    .filter((c): c is { label: string; c: number } => c !== null)
    .sort((a, b) => a.c - b.c)
  const bounds = cols.map((col, k) => ({
    label: col.label,
    lo: k === 0 ? -Infinity : (cols[k - 1].c + col.c) / 2,
    hi: k === cols.length - 1 ? Infinity : (col.c + cols[k + 1].c) / 2,
  }))
  const out = new Map<string, string[]>()
  for (const row of rows) {
    for (const it of row.items) {
      if (it.str.trim() === '') continue
      const c = center(it)
      const b = bounds.find(x => c >= x.lo && c < x.hi)
      if (!b) continue
      const list = out.get(b.label) ?? []
      list.push(it.str)
      out.set(b.label, list)
    }
  }
  return new Map([...out].map(([k, v]) => [k, v.join('').replace(/\s+/g, ' ').trim()]))
}

/* ── 양식별 자리 찾기 ──────────────────────────────────────────────────── */

const SYNTHETIC_MARKS = ['인적사항', '지원사항', '학력사항', '성명(한글)', '지원자 번호']

/** 이 양식인지 — 절 제목과 라벨이 전부 있어야 한다. 하나라도 없으면 값을 만들지 않는다 */
function isSynthetic(lines: readonly Line[]): boolean {
  const all = lines.map(l => l.text).join('\n')
  return SYNTHETIC_MARKS.every(m => all.includes(m))
}

function parseSynthetic(lines: readonly Line[]): { fields: MasterRow; warnings: string[] } {
  const fields: MasterRow = {}
  const warnings: string[] = []
  const all = lines.map(l => l.text).join('\n')
  const find = (re: RegExp): string | null => {
    const m = all.match(re)
    return m ? m[1].trim() : null
  }

  const id = find(/지원자 번호\s*(\d{4,})/)
  if (id !== null) fields['지원자 번호'] = Number(id)
  else warnings.push('본문에서 지원자 번호를 찾지 못함')

  const name = find(/성명\(한글\)\s*(\S+)\s*성명\(영문\)/)
  if (name !== null) fields['한글성명'] = name
  else warnings.push('본문에서 성명을 찾지 못함')

  const birth = find(/생년월일\s*(\d{4}[.\-/]\d{2}[.\-/]\d{2})/)
  if (birth !== null) fields['생년월일'] = birth.replace(/[./]/g, '-')

  const sex = find(/성별\s*(남성|여성|남|여)(?=\s|$)/)
  if (sex !== null) fields['성별'] = sex

  // 지원사항 표 — 머리글 줄 다음부터 「2지망」 줄 전까지가 1지망 행이다 (셀 안 줄바꿈 포함)
  const hi = lines.findIndex(l => l.text.includes('사업본부') && l.text.includes('최종학력'))
  if (hi >= 0) {
    const end = lines.findIndex((l, k) => k > hi && /^2\s*지망/.test(l.text))
    const rows = lines.slice(hi + 1, end > hi ? end : hi + 2).filter(l => /^1\s*지망/.test(l.text) || !/^\d\s*지망/.test(l.text))
    const cells = tableCells(lines[hi], ['구분', '사업본부', '상세 모집분야', '직무', '근무지', '최종학력', '입사 가능일'], rows)
    const org = cells.get('사업본부'); if (org) fields['1지망_조직'] = org
    const job = cells.get('직무'); if (job) fields['1지망_직무'] = job
    const area = cells.get('근무지'); if (area) fields['1지망_지역'] = area
    const edu = cells.get('최종학력')
    if (edu) {
      const code = EDU_CODE[edu]
      fields['최종학력_학교유형'] = code ?? edu
      if (!code) warnings.push(`최종학력 「${edu}」 은 학사·석사·박사가 아님`)
    } else warnings.push('지원사항 표에서 최종학력을 찾지 못함')
  } else warnings.push('지원사항 표를 찾지 못함')

  // 학력사항 표 — 첫 행이 최종학력이다
  const ei = lines.findIndex(l => l.text.includes('재학기간') && l.text.includes('학교명'))
  if (ei >= 0) {
    const end = lines.findIndex((l, k) => k > ei && /병역사항/.test(l.text))
    const rows = lines.slice(ei + 1, end > ei ? end : ei + 2)
    const cells = tableCells(lines[ei], ['재학기간', '학교명', '전공', '부·복수전공', '학점', '소재지', '졸업구분'], firstRowOf(rows))
    const school = cells.get('학교명'); if (school) fields['최종학력_학교명'] = school
    const major = cells.get('전공'); if (major) fields['최종학력_주전공'] = major
    const gpa = cells.get('학점'); if (gpa) fields['최종학력_환산학점'] = gpa
  }

  return { fields, warnings }
}

/* ── 공개 API ──────────────────────────────────────────────────────────── */

/** 1페이지 글자 조각 → 표준 컬럼 값. 양식을 못 알아보면 form=null 이고 fields 는 빈 객체다 */
export function parseResume(items: readonly TextItem[]): ResumeParse {
  const lines = linesOf(items)
  if (!isSynthetic(lines)) return { form: null, fields: {}, warnings: ['아는 이력서 양식이 아님'] }
  const { fields, warnings } = parseSynthetic(lines)
  return { form: 'lg-synthetic-v1', fields, warnings }
}

/** 파일명 `{지원자번호}_{성명}.pdf` 에서 번호와 이름. 번호가 없으면 null — 이름은 NFC 로 맞춘다 */
export function nameOfFile(fileName: string): { id: number | null; name: string | null } {
  const base = fileName.normalize('NFC').split('/').pop() ?? ''
  const m = base.match(/^(\d+)(?:_(.+?))?\.pdf$/i)
  if (!m) return { id: null, name: null }
  return { id: Number(m[1]), name: m[2] ?? null }
}

export type ResumeRecord = { readonly file: string; readonly parse: ResumeParse }

/**
 * 이력서 묶음 → 지원자 마스터. 취합파일의 parseMaster 가 내는 것과 같은 모양이라
 * 뒤 단계(팀 회신 조인 · 편성 · 지원자 상세 · 저장)는 어느 쪽에서 왔는지 모른다.
 *
 * 키는 **파일명의 번호**다. 본문 번호와 다르면 경고하고 파일명을 따른다 —
 * 이력서 원본 보기(`/resumes/{번호}`)도 파일명으로 찾으므로 둘이 같은 기준을 써야 한다.
 */
export function buildMaster(records: readonly ResumeRecord[]): ParsedMaster {
  const rows = new Map<Cell, MasterRow>()
  const warnings: string[] = []
  let skipped = 0

  for (const { file, parse } of records) {
    const tag = `[${file.normalize('NFC').split('/').pop()}]`
    if (parse.form === null) {
      skipped++
      warnings.push(`${tag} 이력서 양식이 아니어서 건너뜀`)
      continue
    }
    const fromName = nameOfFile(file)
    const bodyId = parse.fields['지원자 번호']
    const id = fromName.id ?? (typeof bodyId === 'number' ? bodyId : null)
    if (id === null) {
      skipped++
      warnings.push(`${tag} 지원자 번호가 파일명에도 본문에도 없어 건너뜀`)
      continue
    }
    if (typeof bodyId === 'number' && fromName.id !== null && bodyId !== fromName.id)
      warnings.push(`${tag} 본문 지원자 번호(${bodyId})가 파일명과 달라 파일명을 따름`)
    if (rows.has(id)) {
      warnings.push(`${tag} 지원자 번호 ${id} 가 겹쳐 먼저 읽은 파일을 씀`)
      continue
    }
    for (const w of parse.warnings) warnings.push(`${tag} ${w}`)

    const row: MasterRow = {}
    for (const col of RESUME_COLUMNS) row[col] = parse.fields[col] ?? null
    row['지원자 번호'] = id
    if (row['한글성명'] === null && fromName.name !== null) row['한글성명'] = fromName.name
    rows.set(id, row)
  }

  warnings.unshift(
    `이력서 PDF ${records.length}개에서 지원자 정보를 읽었습니다 (${rows.size}명${skipped ? ` · 건너뜀 ${skipped}` : ''})`,
  )
  return { rows, columns: new Set(RESUME_COLUMNS), header_row: 0, warnings }
}
