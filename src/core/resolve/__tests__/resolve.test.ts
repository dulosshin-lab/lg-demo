/* ②③ resolve 단위 검사 — 엑셀 없이 합성 Sheet 로 돈다.
   tests/test_parse.py 의 코어 수준 케이스를 옮긴 것이다.
   (NFD 파일명 · ~$ 잠금파일 · 깨진 엑셀 같은 파일 계층 관심사는 io/dataset 쪽에서 본다) */
import { describe, expect, it } from 'vitest'
import { parseMaster, parseTeam, type Cell, type Sheet } from '@/core/ingest'
import { resolve, type TeamInput } from '..'

/** 헤더 4행 + 데이터 구조를 재현한다 (실제 파일과 같은 모양) */
function sheet(headers: string[], rows: Cell[][]): Sheet {
  const columnCount = Math.max(headers.length, ...rows.map(r => r.length), 1)
  const pad = (r: Cell[]) => r.concat(new Array(columnCount - r.length).fill(null))
  const grid: Cell[][] = [pad(['그룹헤더']), pad([]), pad([]), pad(headers), ...rows.map(pad)]
  return { name: 'test.xlsx', grid, rowCount: grid.length, columnCount }
}

const MASTER_COLS = ['지원자 번호', '한글성명', '나이', '최종학력_학교유형', '최종학력_주전공']

/** 마스터 한 명 = [번호, 이름, 나이, 학교유형, 전공] */
const master = (rows: Cell[][], extra: string[] = [], extraVals: Cell[][] = []) =>
  parseMaster(sheet([...MASTER_COLS, ...extra], rows.map((r, i) => [...r, ...(extraVals[i] ?? [])])))

/** 팀 회신 = [번호, 이름, 면접관] */
function team(file: string, rows: Cell[][], columns?: Set<string>): TeamInput {
  const { parsed, warnings } = parseTeam(sheet(['지원자 번호', '한글성명', '면접관'], rows), columns)
  return { file, parsed: parsed!, warnings }
}

describe('attrs 보존', () => {
  it('마스터 전 컬럼이 attrs 에 담긴다 (표준 밖 컬럼 포함)', () => {
    const m = master([[1, '김철수', 25, '과정1', '기계공학']], ['1차서류 결과'], [['합격']])
    const p = resolve({ master: m, teams: [team('희망지원자_A팀.xlsx', [[1, '김철수', '박면접']])] })

    expect(p.apps).toHaveLength(1)
    expect(p.apps[0].attrs).toMatchObject({
      '지원자 번호': 1, 한글성명: '김철수', 나이: 25,
      최종학력_주전공: '기계공학', '1차서류 결과': '합격',   // 표준 밖 컬럼도 살아 있다
    })
  })

  it('엔진 입력 필드와 attrs 는 분리되어 있다', () => {
    const m = master([[1, '김철수', 25, '과정2', '전자공학']])
    const { apps } = resolve({ master: m, teams: [team('희망지원자_A팀.xlsx', [[1, '김철수', '박면접']])] })

    // 엔진이 읽는 것 — 여기에만 있어야 한다
    expect(apps[0]).toMatchObject({ id: 1, name: '김철수', edu: '석사', teams: ['A팀'], interviewers: ['박면접'] })
    // attrs 는 화면 표시·필터용이라 엔진 필드를 흉내내지 않는다
    expect(apps[0].attrs).not.toHaveProperty('edu')
    expect(apps[0].attrs).not.toHaveProperty('teams')
  })
})

describe('면접관 미매칭 제외', () => {
  it('요청 전건 미매칭이면 excluded 로 빠진다', () => {
    const m = master([[1, '김철수', 25, '과정1', '기계공학']])
    const p = resolve({ master: m, teams: [team('희망지원자_A팀.xlsx', [[1, '김철수', null]])] })

    expect(p.apps).toHaveLength(0)
    expect(p.excluded).toEqual([{ id: 1, name: '김철수', reason: '면접관 미매칭', teams: ['A팀'] }])
    expect(p.meta.requests_total).toBe(1)
    expect(p.meta.requests_matched).toBe(0)
  })

  it('일부 팀만 미매칭이면 그 팀 요청만 버리고 지원자는 유지한다', () => {
    const m = master([[1, '김철수', 25, '과정1', '기계공학']])
    const p = resolve({
      master: m,
      teams: [
        team('희망지원자_A팀.xlsx', [[1, '김철수', '박면접']]),
        team('희망지원자_B팀.xlsx', [[1, '김철수', null]]),
      ],
    })

    expect(p.apps).toHaveLength(1)
    expect(p.apps[0].teams).toEqual(['A팀'])            // B팀 요청은 버려진다
    expect(p.apps[0].dropped_teams).toEqual(['B팀'])    // 버렸다는 사실은 남긴다
    expect(p.meta.requests_matched).toBe(1)
  })
})

describe('합동면접', () => {
  it('복수 팀 요청은 한 지원자로 합쳐진다', () => {
    const m = master([[1, '김철수', 25, '과정1', '기계공학']])
    const p = resolve({
      master: m,
      teams: [
        team('희망지원자_A팀.xlsx', [[1, '김철수', '박면접']]),
        team('희망지원자_B팀.xlsx', [[1, '김철수', '이면접']]),
      ],
    })

    expect(p.apps).toHaveLength(1)
    expect(p.apps[0].teams).toEqual(['A팀', 'B팀'])
    expect(p.apps[0].interviewers).toEqual(['박면접', '이면접'])
    expect(p.apps[0].iv).toEqual([{ t: 'A팀', n: '박면접' }, { t: 'B팀', n: '이면접' }])
    expect(p.meta.applicants_total).toBe(1)
    expect(p.meta.requests_total).toBe(2)
  })
})

describe('제외 사유', () => {
  it('마스터에 없는 지원자는 사유와 함께 excluded', () => {
    const m = master([[1, '김철수', 25, '과정1', '기계공학']])
    const p = resolve({ master: m, teams: [team('희망지원자_A팀.xlsx', [[99, '유령', '박면접']])] })

    expect(p.excluded).toEqual([{ id: 99, name: null, reason: '마스터 미존재', teams: ['A팀'] }])
  })

  it('학력 구분을 알 수 없으면 excluded', () => {
    const m = master([[1, '김철수', 25, '과정9', '기계공학']])
    const p = resolve({ master: m, teams: [team('희망지원자_A팀.xlsx', [[1, '김철수', '박면접']])] })

    expect(p.apps).toHaveLength(0)
    expect(p.excluded[0].reason).toBe('학력 구분 불명(과정9)')
  })
})

describe('정렬', () => {
  it('학력 → 첫 팀 → 지원자번호 순으로 정렬한다', () => {
    const m = master([
      [1, '가', 25, '과정3', 'x'], [2, '나', 25, '과정1', 'x'],
      [3, '다', 25, '과정2', 'x'], [4, '라', 25, '과정1', 'x'],
    ])
    const p = resolve({
      master: m,
      teams: [
        team('희망지원자_B팀.xlsx', [[1, '가', '면접'], [4, '라', '면접']]),
        team('희망지원자_A팀.xlsx', [[2, '나', '면접'], [3, '다', '면접']]),
      ],
    })
    // 학사(2·4) → 석사(3) → 박사(1). 학사끼리는 첫 팀(A팀 < B팀)
    expect(p.apps.map(a => a.id)).toEqual([2, 4, 3, 1])
    expect(p.apps.map(a => a.edu)).toEqual(['학사', '학사', '석사', '박사'])
  })
})

describe('경고와 실패 전달', () => {
  it('파서 경고에 팀명이 붙어 meta.warnings 로 올라온다', () => {
    const m = master([[1, '김철수', 25, '과정1', 'x']])
    const p = resolve({ master: m, teams: [team('희망지원자_A팀.xlsx', [[1, '김철수', null]])] })

    expect(p.meta.warnings).toContain('[A팀] 면접관 미기재 1/1건')
  })

  it('파싱 실패 파일이 failed_files 로 격리되고 나머지는 계속 간다', () => {
    const m = master([[1, '김철수', 25, '과정1', 'x']])
    const p = resolve({
      master: m,
      teams: [team('희망지원자_A팀.xlsx', [[1, '김철수', '박면접']])],
      failed: [{ file: '희망지원자_B팀.xlsx', error: '헤더 행(지원자 번호)을 찾지 못함' }],
    })

    expect(p.apps).toHaveLength(1)               // A팀은 그대로 편성된다
    expect(p.meta.files).toBe(1)
    expect(p.meta.failed_files).toEqual([{ file: '희망지원자_B팀.xlsx', error: '헤더 행(지원자 번호)을 찾지 못함' }])
  })
})

describe('파일명 → 팀 이름', () => {
  it('_re · _rev 접미사와 희망지원자_ 접두사를 벗긴다', () => {
    const m = master([[1, '김철수', 25, '과정1', 'x']])
    for (const [file, want] of [
      ['희망지원자_AI솔루션팀_re.xlsx', 'AI솔루션팀'],
      ['희망지원자_미술팀_rev.xlsx', '미술팀'],
      ['희망지원자_생산기술팀.xlsx', '생산기술팀'],
    ] as const) {
      const p = resolve({ master: m, teams: [team(file, [[1, '김철수', '박면접']])] })
      expect(p.apps[0].teams).toEqual([want])
    }
  })
})
