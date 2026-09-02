import { parseMaster, parseTeam, type ParsedMaster } from '@/core/ingest'
import { resolve, CRS, type FailedFile, type TeamInput } from '@/core/resolve'
import { Sched, type Payload, type Result, type Validation } from '@/core/schedule'
import { readFileAsSheet } from '@/io/xlsx'

export type LiteCandidate = {
  readonly id: string
  readonly name: string
  readonly education: string
  readonly major: string
  readonly job: string
}

export type LiteRoster = {
  readonly fileName: string
  readonly columnCount: number
  readonly candidates: readonly LiteCandidate[]
  /** 올린 파일의 전 컬럼명 (원본 열 순서) */
  readonly headers: readonly string[]
  /** 화면에 그대로 뿌리는 원본 표 — 앞 ROSTER_ROW_LIMIT 행만 담는다 */
  readonly rows: readonly (readonly string[])[]
  readonly parsed: ParsedMaster
}

/** 확인용 표에 그리는 최대 행 수. 나머지는 '외 n명'으로 알린다. */
export const ROSTER_ROW_LIMIT = 100

/** 블라인드 채용에서 가리는 신상 항목 — 취합파일의 실제 헤더명 */
const BLIND_HEADERS: readonly string[] = ['생년월일', '나이', '성별', '국적', '병역구분', '최종학력_학교명']

/** 표준 항목명을 하나도 못 찾은 파일에만 쓰는 넓은 판정 */
const BLIND_KEYWORDS = /성별|생년|연령|나이|국적|병역|학점|어학|출신|사진/

/** 가릴 컬럼명 집합. 표준 항목이 하나라도 있으면 그것만, 없으면 키워드로 찾는다. */
export function blindColumns(headers: readonly string[]): ReadonlySet<string> {
  const exact = headers.filter(header => BLIND_HEADERS.includes(header))
  return new Set(exact.length ? exact : headers.filter(header => BLIND_KEYWORDS.test(header)))
}

export type LiteSchedule = {
  readonly sourceCount: number
  readonly payload: Payload
  readonly result: Result
  readonly validation: Validation
  readonly hardViolations: number
}

const text = (value: string | number | boolean | null): string => value === null ? '—' : String(value)

export async function readRoster(file: File): Promise<LiteRoster> {
  const parsed = parseMaster(await readFileAsSheet(file))
  const candidates = [...parsed.rows.values()].map(row => {
    const educationCode = text(row['최종학력_학교유형'])
    return {
      id: text(row['지원자 번호']),
      name: text(row['한글성명']),
      education: CRS[educationCode] ?? educationCode,
      major: text(row['최종학력_주전공']),
      job: text(row['1지망_직무']),
    }
  })
  const headers = [...parsed.columns]
  const rows = [...parsed.rows.values()]
    .slice(0, ROSTER_ROW_LIMIT)
    .map(row => headers.map(header => text(row[header] ?? null)))
  return { fileName: file.name, columnCount: parsed.columns.size, candidates, headers, rows, parsed }
}

export async function buildSchedule(roster: LiteRoster, files: readonly File[]): Promise<LiteSchedule> {
  const teams: TeamInput[] = []
  const failed: FailedFile[] = []

  for (const file of files) {
    try {
      const { parsed, warnings } = parseTeam(await readFileAsSheet(file), roster.parsed.columns)
      if (parsed) teams.push({ file: file.name, parsed, warnings })
      else failed.push({ file: file.name, error: warnings.join('; ') })
    } catch (error) {
      if (error instanceof Error) failed.push({ file: file.name, error: `${error.name}: ${error.message}` })
      else throw error
    }
  }

  const payload = resolve({ master: roster.parsed, teams, failed })
  const result = Sched.schedule(payload.apps, {
    ...Sched.DEFAULT_CFG,
    rooms: 4,
    days: 0,
    sessions: 8,
    amSessions: 4,
  })
  const validation = Sched.validate(result)
  return {
    sourceCount: files.length,
    payload,
    result,
    validation,
    hardViolations: validation.r1.length + validation.r2.length,
  }
}
