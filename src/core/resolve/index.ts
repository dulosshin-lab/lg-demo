/* ②③ resolve — 팀 회신 + 지원자 마스터 → 편성 엔진 입력(Payload)
   server/build_apps.py 의 build() 를 옮긴 것이다.

   ingest 는 "엑셀 한 장을 행으로 만드는 것" 만 안다.
   대상 선별(면접관 미매칭 제외)과 마스터 조인은 이 계층이 맡는다. */
import { KEY, type ParsedMaster, type ParsedTeam } from '@/core/ingest'
import type { Applicant, Excluded, Payload } from '@/core/schedule'

/** 마스터의 최종학력_학교유형 코드 → 학력 */
export const CRS: Record<string, string> = { 과정1: '학사', 과정2: '석사', 과정3: '박사' }
export const EDU_ORDER = ['학사', '석사', '박사'] as const
export const MASTER_FILE = '취합파일.xlsx'

/** 파일명에서 팀 이름을 뽑는다 — 희망지원자_{팀}_re.xlsx / _rev.xlsx */
export function teamNameOf(filename: string): string {
  return filename.normalize('NFC').replace(/^희망지원자_/, '').replace(/_rev?\.xlsx$/i, '').replace(/\.xlsx$/i, '')
}

/** resolve 에 들어가는 팀 하나 — 파일명과 ingest 결과의 짝 */
export interface TeamInput {
  /** 파일명 (팀 이름을 여기서 뽑는다) */
  file: string
  parsed: ParsedTeam
  warnings: string[]
}

/** 파싱 자체가 실패한 파일 */
export interface FailedFile {
  file: string
  error: string
}

export interface ResolveInput {
  master: ParsedMaster
  teams: TeamInput[]
  failed?: FailedFile[]
}

interface Request {
  team: string
  interviewer: string | null
}

/* 코드포인트 비교 — Python 의 sorted() 와 같은 순서를 낸다.
   localeCompare 는 ICU 대조라 한글에서 Python 과 어긋날 수 있다.
   정렬 순서가 달라지면 격자 배치가 통째로 달라지므로 여기서는 코드포인트가 맞다. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * 팀별 요청을 지원자 단위로 합치고 마스터와 조인한다.
 *
 * 제외 사유는 셋이다 (담당자 방침):
 *   1. 마스터 미존재      — 회신에는 있는데 지원자 마스터에 없다
 *   2. 면접관 미매칭      — 어느 팀도 면접관을 적지 않았다
 *   3. 학력 구분 불명     — 최종학력_학교유형이 과정1/2/3 이 아니다
 */
export function resolve({ master, teams, failed = [] }: ResolveInput): Payload {
  const warnings: string[] = [...master.warnings]

  // 팀 이름 → 파싱 결과. 같은 팀 파일이 둘이면 나중 것이 이긴다 (Python dict 와 같은 동작)
  const byTeam = new Map<string, ParsedTeam>()
  const ordered = [...teams].sort((a, b) => cmp(a.file.normalize('NFC'), b.file.normalize('NFC')))
  for (const t of ordered) {
    const name = teamNameOf(t.file)
    byTeam.set(name, t.parsed)
    warnings.push(...t.warnings.map(w => `[${name}] ${w}`))
  }

  // 요청 취합 — 지원자 1명이 여러 팀에 걸릴 수 있다(합동면접)
  const reqs = new Map<number, Request[]>()
  let total = 0
  for (const [team, parsed] of byTeam) {
    for (const row of parsed.rows) {
      const aid = row[KEY] as number
      total++
      const list = reqs.get(aid) ?? []
      const iv = row.면접관
      list.push({ team, interviewer: iv === null || iv === undefined || String(iv).trim() === '' ? null : String(iv) })
      reqs.set(aid, list)
    }
  }

  const apps: Applicant[] = []
  const excluded: Excluded[] = []
  let matched = 0

  for (const [aid, rs] of reqs) {
    const ok = rs.filter(r => r.interviewer)
    matched += ok.length
    const teamsAll = [...new Set(rs.map(r => r.team))].sort(cmp)

    const m = master.rows.get(aid)
    if (m === undefined) {
      excluded.push({ id: aid, name: null, reason: '마스터 미존재', teams: teamsAll })
      continue
    }
    if (!ok.length) {
      excluded.push({ id: aid, name: m.한글성명 as string, reason: '면접관 미매칭', teams: teamsAll })
      continue
    }
    const edu = CRS[String(m.최종학력_학교유형)]
    if (edu === undefined) {
      excluded.push({
        id: aid, name: m.한글성명 as string,
        reason: `학력 구분 불명(${m.최종학력_학교유형})`, teams: teamsAll,
      })
      continue
    }

    apps.push({
      id: aid,
      name: m.한글성명 as string,
      edu: edu as Applicant['edu'],
      teams: [...new Set(ok.map(r => r.team))].sort(cmp),
      interviewers: [...new Set(ok.map(r => r.interviewer!))].sort(cmp),
      /* 화면은 면접관을 소속과 함께 칩으로 보여준다 —
         interviewers 는 이름만 남기므로 짝을 따로 싣는다 */
      iv: ok
        .map(r => ({ t: r.team, n: r.interviewer! }))
        .filter((x, i, a) => a.findIndex(y => y.t === x.t && y.n === x.n) === i)
        .sort((a, b) => cmp(a.t, b.t) || cmp(a.n, b.n)),
      attrs: { ...m } as Applicant['attrs'],
      dropped_teams: [...new Set(rs.filter(r => !r.interviewer).map(r => r.team))].sort(cmp),
    })
  }

  apps.sort((a, b) =>
    EDU_ORDER.indexOf(a.edu) - EDU_ORDER.indexOf(b.edu) ||
    cmp(a.teams[0], b.teams[0]) ||
    a.id - b.id)

  return {
    meta: {
      parsed_at: '',                       // 호출자가 채운다 — core 는 시계를 읽지 않는다
      files: byTeam.size,
      requests_total: total,
      requests_matched: matched,
      applicants_total: reqs.size,
      warnings,
      failed_files: failed,
    },
    apps,
    excluded,
  }
}
