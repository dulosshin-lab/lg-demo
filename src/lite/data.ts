import { parseMaster, parseTeam, type ParsedMaster } from '@/core/ingest'
import { resolve, CRS, type FailedFile, type TeamInput } from '@/core/resolve'
import { Sched, type Payload, type Result, type Validation } from '@/core/schedule'
import { readFileAsSheet } from '@/io/xlsx'
import { arrange, withPlaced, type ArrangeReport } from './arrange'
import { confirmedDays, pinsOf, type ConfirmEvent } from './confirm'
import { DEFAULT_SETUP, toCfg, withDates, type Setup } from './setup'
import { removedIds, touchedIds, type EditState } from './edit'
import { buildMaster, parseResume, type ResumeParse, type ResumeRecord, type TextItem } from './resume'

export type LiteCandidate = {
  readonly id: string
  readonly name: string
  readonly education: string
  readonly major: string
  readonly job: string
}

export type LiteRoster = {
  readonly fileName: string
  /** 어디서 온 명단인가. 저장본에 없으면(옛 세션) 취합파일로 본다 */
  readonly source?: 'xlsx' | 'pdf'
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
  /** ③ 연속 배치 정리가 무엇을 줄였나. 배치(placed)는 담지 않는다 —
      저장하면 60명분이 두 벌이 되고 참조가 갈라진다. */
  readonly tidy: Omit<ArrangeReport, 'placed'>
  /** 이 편성을 만든 전형 설정 — 나중에 「무슨 설정으로 돌린 결과인가」를 읽으려면 함께 남아야 한다 */
  readonly setup: Setup
}

const text = (value: string | number | boolean | null): string => value === null ? '—' : String(value)

export async function readRoster(file: File): Promise<LiteRoster> {
  return rosterOf(parseMaster(await readFileAsSheet(file)), file.name, 'xlsx')
}

/**
 * 이력서 PDF 묶음 → 명단. 취합파일 없이 시작하는 두 번째 입구다.
 * PDF 를 읽는 함수(pdf.js)는 밖에서 받는다 — 이 모듈은 브라우저 없이도 돌아야 한다.
 * 파일 순서는 이름순으로 고정한다. 같은 번호가 겹치면 먼저 읽은 것이 이기므로 순서가 결과다.
 */
export async function readRosterFromResumes(
  files: readonly File[],
  extract: (file: File) => Promise<readonly TextItem[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<LiteRoster> {
  const pdfs = files
    .filter(f => /\.pdf$/i.test(f.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (pdfs.length === 0) throw new Error('폴더에 PDF 가 없습니다')
  /* 몇 장을 겹쳐 읽는다 — 파일 읽기와 파싱이 번갈아 기다리는 시간을 메운다.
     결과는 자리(index)로 넣으므로 끝나는 순서와 무관하게 이름순이 지켜진다. */
  const records: ResumeRecord[] = new Array(pdfs.length)
  let next = 0
  let done = 0
  const lane = async () => {
    while (next < pdfs.length) {
      const k = next++
      const file = pdfs[k]
      let parse: ResumeParse
      try {
        parse = parseResume(await extract(file))
      } catch (e) {
        parse = { form: null, fields: {}, warnings: [`읽지 못함: ${e instanceof Error ? e.message : String(e)}`] }
      }
      records[k] = { file: file.name, parse }
      onProgress?.(++done, pdfs.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pdfs.length) }, lane))
  const folder = (pdfs[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0]
  const label = `${folder ? `${folder}/` : '이력서 PDF'} (PDF ${pdfs.length}개)`
  const roster = rosterOf(buildMaster(records), label, 'pdf')
  if (roster.candidates.length === 0) throw new Error(`PDF ${pdfs.length}개 중 이력서로 읽힌 것이 없습니다`)
  return roster
}

function rosterOf(parsed: ParsedMaster, fileName: string, source: 'xlsx' | 'pdf'): LiteRoster {
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
  return { fileName, source, columnCount: parsed.columns.size, candidates, headers, rows, parsed }
}

export async function buildSchedule(
  roster: LiteRoster, files: readonly File[], setup: Setup = DEFAULT_SETUP,
): Promise<LiteSchedule> {
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
  const raw = Sched.schedule(payload.apps, toCfg(setup) as never)
  /* ③ 팀 연속 배치 — 엔진의 배치 순서 탓에 생긴 쪼갬을 결과 위에서 정리한다.
     기준선 자체를 정리된 것으로 둔다. 편집 계층에서 돌리면 담당자가 손대지도 않은 이동이
     변경 이력에 수십 건 쌓이고, 위반 기준선도 정리 전 결과가 되어 어긋난다. */
  const { placed, ...tidy } = arrange(raw, { contiguous: setup.contiguous })
  // 공휴일은 엔진이 모른다 — 날짜만 여기서 다시 붙인다(편성 자체는 날짜 인덱스만 쓴다)
  const result = withDates(withPlaced(raw, placed), setup)
  const validation = Sched.validate(result)
  return {
    sourceCount: files.length,
    payload,
    result,
    validation,
    hardViolations: validation.r1.length + validation.r2.length,
    tidy,
    setup,
  }
}

/** 다시 편성한 결과와, 무엇이 고정되고 무엇이 움직였는지 */
export type RescheduleReport = {
  readonly schedule: LiteSchedule
  /** 고정한 사람 수 — 확정분 + 수기 조정분 */
  readonly pinned: number
  /** 확정된 날짜 수 */
  readonly confirmedDays: number
  /** 수기로 자리를 정해 준 사람 수 */
  readonly touched: number
  /** 엔진이 다시 자리를 잡은 사람 수 */
  readonly replaced: number
}

/* 확정분을 고정한 채 나머지를 다시 편성한다 — 미팅 P0-4 「1일차 확정 → 2일차 재배치」.

   D3(수정 뒤 솔버를 다시 돌리지 않는다)와 어긋나지 않는다. 저건 카드를 옮길 때마다 자동으로
   도는 것을 막자는 뜻이고, 이건 담당자가 「다시 편성」을 눌렀을 때만 도는 명시적 행동이다.

   고정하는 것 둘 —
   ① 확정(통보)된 사람: 지금 앉은 자리. 통보한 날짜가 흔들리면 확정의 뜻이 없다
   ② 담당자가 손으로 옮긴 사람: 지금 앉은 자리. 재편성이 손질을 지우면 「고쳐도 안 깨지게」가 거짓말이 된다

   담당자가 뺀 사람은 아예 넣지 않고 미배정으로 되돌려 둔다 — 자리를 만들어 주면
   「뺐는데 왜 또 있냐」가 된다. 엔진이 못 넣은 사람과는 다른 사정이라 구분해서 다시 붙인다. */
export function rescheduleWith(
  schedule: LiteSchedule, edit: EditState, confirms: readonly ConfirmEvent[],
): RescheduleReport {
  const removed = removedIds(edit.events)
  const touched = touchedIds(edit.events)

  // 자리 하나에 핀이 둘이면 엔진이 뒤엣것을 버린다 — appId 로 한 번 더 접는다
  const pins = new Map<number, { id: number; day: number; slot: number; room: number }>()
  for (const pin of pinsOf(edit.placed, confirms)) pins.set(pin.id, pin)
  for (const p of edit.placed) {
    if (!touched.has(p.app.id)) continue
    pins.set(p.app.id, { id: p.app.id, day: p.day, slot: p.slot, room: p.room })
  }

  const setup = schedule.setup ?? DEFAULT_SETUP
  const apps = schedule.payload.apps.filter(a => !removed.has(a.id))
  const raw = Sched.schedule(apps, { ...schedule.result.cfg, pinned: [...pins.values()] })
  const { placed, ...tidy } = arrange(raw, { contiguous: setup.contiguous })

  // 담당자가 뺀 사람은 미배정 서랍으로 되돌린다
  const back = schedule.payload.apps.filter(a => removed.has(a.id))
  const result = withDates(withPlaced({ ...raw, unplaced: [...raw.unplaced, ...back] }, placed), setup)
  const validation = Sched.validate(result)

  return {
    schedule: {
      ...schedule, result, validation, tidy,
      hardViolations: validation.r1.length + validation.r2.length,
    },
    pinned: pins.size,
    confirmedDays: confirmedDays(confirms).size,
    touched: touched.size,
    replaced: placed.length - pins.size,
  }
}
