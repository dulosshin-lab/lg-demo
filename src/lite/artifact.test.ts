import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_ROOT = resolve(import.meta.dirname, '../..')

describe('L1 라이트 데모 엔트리', () => {
  it('index.html이 전용 React 엔트리를 로드한다', () => {
    // Given: 단독 프로젝트 루트 (라이트가 곧 기본 엔트리)
    const htmlPath = resolve(APP_ROOT, 'index.html')
    const mainPath = resolve(APP_ROOT, 'src/lite/main.tsx')

    // When: 라이트 데모 엔트리를 확인하면
    const htmlExists = existsSync(htmlPath)
    const mainExists = existsSync(mainPath)

    // Then: HTML과 React 엔트리가 한 경로로 연결되어야 한다
    expect(htmlExists).toBe(true)
    expect(mainExists).toBe(true)
    expect(readFileSync(htmlPath, 'utf8')).toContain('/src/lite/main.tsx')
  })

  it('라이트 데모 데이터 어댑터가 신규 파일로 분리된다', () => {
    // Given: 저장 없는 라이트 데모 소스 경로
    const dataPath = resolve(import.meta.dirname, 'data.ts')

    // When: 데이터 어댑터의 존재를 확인하면
    const exists = existsSync(dataPath)

    // Then: 본제품 파서나 엔진 파일을 수정하지 않는 전용 모듈이어야 한다
    expect(exists).toBe(true)
  })
})
