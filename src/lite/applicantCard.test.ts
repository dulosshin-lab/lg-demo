/* 지원자 상세 — 실제 취합파일로 확인한다.

   여기서 잡아야 할 것은 「예쁘게 나오나」가 아니라 **거짓을 보여주지 않나**다.
   엑셀 일련번호를 날짜로 못 읽으면 생년월일이 36609 로 뜨고, 역할 필터가 새면 팀 담당자에게
   생년월일·성별·국적이 그대로 넘어간다. */
import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseMaster } from '@/core/ingest'
import { readSheet } from '@/io/xlsx'
import { dateText, detailOf, excelDate, restOf, type Attrs } from './applicantCard'

let rows: Attrs[]

beforeAll(async () => {
  const b = await readFile('data/취합파일.xlsx')
  const sheet = await readSheet(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, '취합파일.xlsx')
  rows = [...parseMaster(sheet).rows.values()] as unknown as Attrs[]
}, 60_000)

const labels = (attrs: Attrs, role: 'hr' | 'team') =>
  detailOf(attrs, role).flatMap(s => s.fields.map(f => f.label))

describe('엑셀 날짜', () => {
  it('일련번호를 1899-12-30 기준으로 읽는다', () => {
    expect(dateText(44244)).toBe('2021-02-17')          // 실데이터의 졸업일 — 2월 졸업
    expect(excelDate(1).toISOString().slice(0, 10)).toBe('1899-12-31')
  })

  it('문자열 날짜도 같은 꼴로 맞춘다 — 한 열에 두 형태가 섞여 있다', () => {
    expect(dateText('2026-02-16')).toBe('2026-02-16')
    expect(dateText('2026/2/6')).toBe('2026-02-06')
  })

  it('빈 값과 못 읽는 값에 죽지 않는다', () => {
    expect(dateText(null)).toBe('')
    expect(dateText(undefined)).toBe('')
    expect(dateText('')).toBe('')
    expect(dateText('미상')).toBe('미상')             // 원문을 그대로 — 지어내지 않는다
  })

  it('실데이터의 생년월일이 사람이 읽는 날짜로 나온다', () => {
    const one = rows.find(r => typeof r['생년월일'] === 'number')!
    const born = dateText(one['생년월일'] as number)
    expect(born).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // 나이 열과 어긋나지 않는다 — 변환이 100년 밀리면 여기서 걸린다
    const age = Number(one['나이'])
    const years = 2026 - Number(born.slice(0, 4))
    expect(Math.abs(years - age)).toBeLessThanOrEqual(1)
  })
})

describe('역할별 노출', () => {
  it('간사는 인적 항목을 본다', () => {
    const l = labels(rows[0], 'hr')
    for (const c of ['생년월일', '나이', '성별', '국적', '병역구분']) expect(l).toContain(c)
  })

  it('팀 담당자에게는 인적 항목이 하나도 넘어가지 않는다', () => {
    for (const attrs of rows.slice(0, 40)) {
      const l = labels(attrs, 'team')
      for (const c of ['생년월일', '나이', '성별', '국적', '병역구분', '복무 종료일', '계급'])
        expect(l, `${attrs['한글성명']} 에게서 ${c} 가 샜다`).not.toContain(c)
    }
  })

  it('팀 담당자도 학력·어학·자격증·지원 정보는 본다 — 면접에 필요한 것들이다', () => {
    const l = labels(rows[0], 'team')
    expect(l).toContain('학교명')
    expect(l).toContain('주전공')
    expect(l).toContain('1지망 직무')
  })

  it('「원본 값 더 보기」는 간사만 본다', () => {
    // 이 취합파일은 52열이 전부 묶음에 실려 있어 남는 열이 없다(빈 열 3개는 값이 없어 빠진다).
    // 다른 서식이 들어와 모르는 열이 생기면 그때 이 접힘이 받아 준다 — 간사에게만.
    expect(restOf(rows[0], 'team')).toHaveLength(0)
    const extra = { ...rows[0], '면접 메모': '추가 열' }
    expect(restOf(extra, 'hr').map(f => f.label)).toContain('면접 메모')
    expect(restOf(extra, 'team')).toHaveLength(0)
  })
})

describe('빈 항목', () => {
  it('값이 없는 항목은 아예 빠진다 — 빈 칸을 그리지 않는다', () => {
    for (const attrs of rows.slice(0, 50))
      for (const s of detailOf(attrs, 'hr'))
        for (const f of s.fields) expect(f.value).not.toBe('')
  })

  it('한 번도 채워지지 않은 열은 어디에도 안 나온다', () => {
    // 실데이터에서 러브지니·LG Aimers·보훈청 추천은 467행 내내 비어 있다
    const empty = ['러브지니', 'LG Aimers', '보훈청 추천']
    for (const col of empty) {
      const filled = rows.filter(r => r[col] !== null && r[col] !== undefined && String(r[col]).trim() !== '')
      expect(filled, `${col} 이 실제로는 채워져 있다`).toHaveLength(0)
    }
    const l = [...labels(rows[0], 'hr'), ...restOf(rows[0], 'hr').map(f => f.label)]
    for (const col of empty) expect(l).not.toContain(col)
  })

  it('빈 묶음은 통째로 빠진다', () => {
    expect(detailOf({}, 'hr')).toHaveLength(0)
    expect(detailOf(undefined, 'hr')).toHaveLength(0)
  })
})

describe('학력 묶음', () => {
  it('최종학력과 학사가 같으면 학사 묶음을 접는다 — 같은 표를 두 번 보여주지 않는다', () => {
    const same = rows.find(r => r['최종학력_학교명'] === r['학사1_학교명']
      && r['최종학력_주전공'] === r['학사1_주전공'])!
    expect(detailOf(same, 'hr').map(s => s.title)).not.toContain('학사')
  })

  it('대학원 지원자처럼 학사가 다르면 따로 보여 준다', () => {
    const diff = rows.find(r => r['학사1_학교명'] && r['최종학력_학교명'] !== r['학사1_학교명'])
    if (!diff) return                       // 데이터에 없으면 넘어간다
    expect(detailOf(diff, 'hr').map(s => s.title)).toContain('학사')
  })
})

describe('실데이터 전수', () => {
  it('467명 누구를 열어도 죽지 않고, 뭐라도 보여 준다', () => {
    for (const attrs of rows) {
      const s = detailOf(attrs, 'hr')
      expect(s.length).toBeGreaterThan(0)
      expect(s.some(x => x.fields.length > 0)).toBe(true)
    }
  })
})
