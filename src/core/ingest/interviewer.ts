/* 면접관 컬럼을 고르는 규칙.
   ─────────────────────────────────────────────────────────────────────────
   규칙을 바꿔야 하면 이 파일만 보면 된다. 다른 어디에도 이 판단이 없다.
   ─────────────────────────────────────────────────────────────────────────

   규칙:  면접관 컬럼 = 헤더 텍스트가 있는 마지막 열

   근거 — data/ 8개 + data/demo-archive/ 12개, 총 20개 회신 파일 전부에서 그러했다.
   컬럼 수가 22 · 49 · 52 · 55 로 제각각인데도 예외가 없었다. 헤더명만 갈린다:

       면접관 (16) · 팀 면접관 (2) · 면접관 성명 (2) · 인원 (2)

   '인원' 처럼 '면접관' 이라는 글자가 아예 없는 헤더가 있어서, 헤더명으로 **찾을** 수는 없다.
   그래서 헤더명은 찾는 수단이 아니라 **확인 수단**으로만 쓴다.

   server/parse_val.py 의 옛 방식은 헤더에 '면접관' 이 없으면 NOT_NAME 접미사 목록 ·
   2~6자 한글 정규식 · 20% 임계값으로 "사람 이름처럼 생긴 컬럼" 을 뒤에서부터 뒤졌다.
   그 복잡한 탐색이 실제로 하던 일은 마지막 열을 고르는 것뿐이었다.
   이름 모양 검사는 버리지 않고 **안전망**으로 남겼다 (아래 looksLikeNames). */
import { STD, headerStack, lastHeaderCol } from './headers'
import { type Sheet, cellOf } from './types'

/** 사람 이름이 아닌 값(조직·학교·전공 등)을 걸러내는 접미사 — 안전망 검사용 */
const NOT_NAME = ['학과', '학부', '대학교', '대학', '캠퍼스', '전공', '팀', '과정', '구', '시', '국', '원', '부', '소']

const HANGUL_ONLY = /^[가-힣]+$/

/** 한 값이 사람 이름 모양인가 — 2~6자 한글이고 조직/학교 접미사로 끝나지 않는다 */
export function looksLikeName(v: unknown): boolean {
  if (typeof v !== 'string') return false
  const s = v.trim()
  return s.length >= 2 && s.length <= 6 && HANGUL_ONLY.test(s) && !NOT_NAME.some(x => s.endsWith(x))
}

export interface InterviewerCol {
  /** 1-indexed 컬럼 번호. 면접관 컬럼이 없다고 판단하면 null */
  col: number | null
  header: string | null
  /** 'header' = 헤더에 '면접관' 이 들어 있었다 · 'position' = 마지막 열 규칙으로 골랐다 */
  how: 'header' | 'position' | null
  /** 안전망 — 그 열의 값들이 사람 이름 모양인가. 값이 하나도 없으면 null(판단 보류) */
  looksLikeNames: boolean | null
}

/**
 * 면접관 컬럼을 고른다.
 *
 * @param known 마스터에 존재하는 컬럼명 집합. 마지막 열이 표준/마스터 컬럼이면
 *              그 파일에는 면접관 컬럼이 아예 없는 것으로 본다 (표준 컬럼을 면접관으로 오인하지 않게).
 */
export function findInterviewerCol(sheet: Sheet, headerRow: number, known?: Set<string>): InterviewerCol {
  const none: InterviewerCol = { col: null, header: null, how: null, looksLikeNames: null }

  const col = lastHeaderCol(sheet, headerRow)
  if (col === 0) return none

  const stack = headerStack(sheet, headerRow, col)
  const header = stack.length ? stack[stack.length - 1] : null
  if (header === null) return none

  // 마지막 열이 표준 컬럼이면 면접관 컬럼이 붙지 않은 파일이다
  const isStandard = (STD as readonly string[]).includes(header) || (known?.has(header) ?? false)
  if (isStandard) return { ...none }

  // 값이 있는 행만 모아 이름 모양을 본다 (값이 전부 비었으면 '미기재' 경고가 따로 나간다)
  const vals: unknown[] = []
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    if (cellOf(sheet, r, 1) === null) continue
    const v = cellOf(sheet, r, col)
    if (v !== null && String(v).trim() !== '') vals.push(v)
  }
  const named = vals.filter(looksLikeName).length
  const looksLikeNames = vals.length === 0 ? null : named >= Math.max(2, vals.length * 0.2)

  return {
    col,
    header,
    how: header.includes('면접관') ? 'header' : 'position',
    looksLikeNames,
  }
}
