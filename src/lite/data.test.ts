import { readFileSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSchedule, readRoster } from './data'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const FIXTURE_ROOT = resolve(REPO_ROOT, 'data')
const fileOf = (path: string) => new File([readFileSync(path)], basename(path))

describe('L1 라이트 데모 데이터 어댑터', () => {
  it('명단 읽기와 편성 실행 API를 제공한다', async () => {
    // Given: 저장 없는 라이트 데모 전용 모듈
    const data = await import('./data')

    // When: 공개 API를 조회하면
    const exports = Object.keys(data)

    // Then: 두 업로드 흐름에 필요한 함수만 제공한다
    expect(exports).toContain('readRoster')
    expect(exports).toContain('buildSchedule')
  })

  it('취합파일을 기존 파서로 읽어 467명 명단을 만든다', async () => {
    // Given: 실제 취합파일 픽스처
    const file = fileOf(resolve(FIXTURE_ROOT, '취합파일.xlsx'))

    // When: 라이트 데모에서 명단을 읽으면
    const roster = await readRoster(file)

    // Then: 원본 행과 열을 잃지 않고 화면용 명단이 만들어진다
    expect(roster.fileName).toBe('취합파일.xlsx')
    expect(roster.columnCount).toBe(52)
    expect(roster.candidates).toHaveLength(467)
    expect(roster.candidates[0]).toMatchObject({ education: expect.stringMatching(/학사|석사|박사/) })
  })

  it('팀 회신을 기존 엔진의 8세션 4조 경로로 편성한다', async () => {
    // Given: 취합파일 명단과 실제 팀 회신 픽스처들
    const roster = await readRoster(fileOf(resolve(FIXTURE_ROOT, '취합파일.xlsx')))
    const files = readdirSync(FIXTURE_ROOT)
      .filter(name => name.startsWith('희망지원자_'))
      .sort()
      .map(name => fileOf(resolve(FIXTURE_ROOT, name)))

    // When: 라이트 데모에서 팀 회신을 편성하면
    const schedule = await buildSchedule(roster, files)

    // Then: 본제품 기본 격자와 하드 제약 계약을 지킨다
    expect(schedule.sourceCount).toBe(files.length)
    expect(schedule.result.cfg).toMatchObject({ rooms: 4, sessions: 8, amSessions: 4 })
    expect(schedule.result.placed).toHaveLength(schedule.payload.apps.length)
    expect(schedule.result.placed.length).toBeGreaterThan(0)
    expect(schedule.hardViolations).toBe(0)
  })
})
