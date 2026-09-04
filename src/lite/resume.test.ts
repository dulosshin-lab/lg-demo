/* 이력서 PDF → 명단. 실제 PDF 467장을 Node 에서 pdf.js(legacy) 로 읽어 취합파일과 대조한다.

   ⚠ 이 PDF 들은 취합파일에서 만든 합성본이라 「전부 일치」는 파서가 양식을 제대로 읽는다는
     증거이지 실제 이력서에서도 맞는다는 증거가 아니다. LG 양식이 오면 그 파일로 다시 잰다. */
import { readFileSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseMaster } from '@/core/ingest'
import { readFileAsSheet } from '@/io/xlsx'
import { readRosterFromResumes } from './data'
import { buildMaster, linesOf, nameOfFile, parseResume, RESUME_COLUMNS, type TextItem } from './resume'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const PDF_DIR = resolve(REPO_ROOT, 'data/lg_resumes_pdf')
const MASTER = resolve(REPO_ROOT, 'data/취합파일.xlsx')

const pdfFiles = readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf')).sort()
const fileOf = (path: string) => new File([readFileSync(path)], basename(path))

/** pdfText.ts 와 같은 조각을 Node 에서 만든다 — 브라우저 워커 없이 legacy 빌드로 */
async function itemsOf(file: File): Promise<TextItem[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0 })
  const doc = await task.promise
  const page = await doc.getPage(1)
  const height = page.getViewport({ scale: 1 }).height
  const content = await page.getTextContent()
  const out: TextItem[] = []
  for (const it of content.items) {
    if (!('str' in it)) continue
    out.push({ str: it.str, x: it.transform[4], y: height - it.transform[5], w: it.width, h: it.height })
  }
  await task.destroy()
  return out
}

const cache = new Map<string, TextItem[]>()
const cachedItems = async (name: string) => {
  let v = cache.get(name)
  if (!v) { v = await itemsOf(fileOf(resolve(PDF_DIR, name))); cache.set(name, v) }
  return v
}

describe('이력서 PDF 한 장 읽기', () => {
  it('합성 양식을 알아보고 편성에 필요한 세 값을 읽는다', async () => {
    // Given: 첫 번째 이력서 (3200370 마초롱)
    const parse = parseResume(await cachedItems('3200370_마초롱.pdf'.normalize('NFD')))

    // Then: 양식을 알아봤고, 번호·성명·학력 코드가 취합파일과 같은 꼴로 나온다
    expect(parse.form).toBe('lg-synthetic-v1')
    expect(parse.fields['지원자 번호']).toBe(3200370)
    expect(parse.fields['한글성명']).toBe('마초롱')
    expect(parse.fields['최종학력_학교유형']).toBe('과정1')
    expect(parse.warnings).toEqual([])
  })

  it('화면에 실을 부가 항목도 표에서 열 위치로 집는다', async () => {
    const f = parseResume(await cachedItems('3200370_마초롱.pdf'.normalize('NFD'))).fields
    expect(f['생년월일']).toBe('1998-11-10')
    expect(f['성별']).toBe('남성')
    expect(f['1지망_조직']).toBe('제1기술원')
    expect(f['1지망_직무']).toBe('직무라')
    expect(f['1지망_지역']).toBe('가상시 별빛구')
    expect(f['최종학력_학교명']).toBe('아라대학교')
    expect(f['최종학력_주전공']).toBe('마루품질학과')
    expect(f['최종학력_환산학점']).toBe('3.97 / 4.5')
  })

  it('셀 안에서 줄바꿈된 행 — 복수전공이 위아래로 찍혀도 같은 행으로 읽는다', async () => {
    // Given: 3630819 는 부·복수전공 칸이 두 줄이라 학교명 줄 위에 한 줄이 더 있다
    const f = parseResume(await cachedItems('3630819_바나윤.pdf'.normalize('NFD'))).fields
    expect(f['최종학력_학교명']).toBe('빛솔대학교')
    expect(f['최종학력_주전공']).toBe('단비공정학부')
    expect(f['최종학력_환산학점']).toBe('3.85 / 4.5')
  })

  it('모르는 양식이면 값을 지어내지 않는다', () => {
    // Given: 제목만 비슷한 아무 문서
    const items: TextItem[] = [
      { str: '이력서', x: 100, y: 50, w: 40, h: 12 },
      { str: '홍길동 010-0000-0000', x: 40, y: 80, w: 120, h: 10 },
    ]
    const parse = parseResume(items)
    expect(parse.form).toBeNull()
    expect(parse.fields).toEqual({})
    expect(parse.warnings[0]).toMatch(/양식이 아님/)
  })

  it('줄 묶기 — 같은 높이의 조각이 한 줄이 되고 공백 조각이 띄어쓰기를 만든다', () => {
    const items: TextItem[] = [
      { str: '성명', x: 10, y: 100, w: 16, h: 10 }, { str: ' ', x: 26, y: 100, w: 5, h: 0 },
      { str: '홍길동', x: 31, y: 101, w: 30, h: 10 },
      { str: '다음줄', x: 10, y: 120, w: 30, h: 10 },
    ]
    expect(linesOf(items).map(l => l.text)).toEqual(['성명 홍길동', '다음줄'])
  })

  it('파일명에서 번호와 이름 — 자소가 갈라진(NFD) 이름도 NFC 로 맞춘다', () => {
    expect(nameOfFile('3200370_마초롱.pdf'.normalize('NFD'))).toEqual({ id: 3200370, name: '마초롱' })
    expect(nameOfFile('sub/3200370_마초롱.PDF')).toEqual({ id: 3200370, name: '마초롱' })
    expect(nameOfFile('3200370.pdf')).toEqual({ id: 3200370, name: null })
    expect(nameOfFile('이력서.pdf')).toEqual({ id: null, name: null })
  })
})

describe('이력서 묶음 → 지원자 마스터', () => {
  it('실제 PDF 467장 전부 — 번호·성명·학력이 취합파일과 한 명도 빠짐없이 같다', async () => {
    // Given: 취합파일이 곧 정답
    const master = parseMaster(await readFileAsSheet(fileOf(MASTER)))

    // When: PDF 폴더 전체를 읽으면
    const records = []
    for (const name of pdfFiles) records.push({ file: name, parse: parseResume(await cachedItems(name)) })
    const built = buildMaster(records)

    // Then: 사람 수가 같고, 엔진이 쓰는 세 값이 전원 일치한다
    expect(built.rows.size).toBe(master.rows.size)
    const mismatch: string[] = []
    for (const [id, row] of built.rows) {
      const m = master.rows.get(id)
      if (!m) { mismatch.push(`${id}: 취합파일에 없음`); continue }
      for (const col of ['한글성명', '최종학력_학교유형'] as const)
        if (String(row[col]) !== String(m[col])) mismatch.push(`${id} ${col}: PDF「${row[col]}」 ≠ 엑셀「${m[col]}」`)
    }
    expect(mismatch).toEqual([])
    // 화면용 부가 항목도 전원 채워진다 — 비면 그 양식 배치를 못 읽은 것이다
    const blank: string[] = []
    for (const [id, row] of built.rows)
      for (const col of RESUME_COLUMNS) if (row[col] === null || row[col] === '') blank.push(`${id} ${col}`)
    expect(blank).toEqual([])
    // 파일별 경고가 하나도 없어야 한다 — 첫 줄은 요약이다
    expect(built.warnings.slice(1)).toEqual([])
    expect(built.warnings[0]).toBe('이력서 PDF 467개에서 지원자 정보를 읽었습니다 (467명)')
    expect([...built.columns]).toEqual(RESUME_COLUMNS)
  }, 60_000)

  it('양식이 아닌 파일은 건너뛰고, 번호가 겹치면 먼저 읽은 것을 쓰고, 파일명 번호를 키로 삼는다', async () => {
    const good = parseResume(await cachedItems(pdfFiles[0]))
    const built = buildMaster([
      { file: pdfFiles[0], parse: good },
      { file: '메모.pdf', parse: { form: null, fields: {}, warnings: ['아는 이력서 양식이 아님'] } },
      { file: pdfFiles[0], parse: good },
      { file: '9999999_다른이.pdf', parse: good },       // 본문은 3200370 인데 파일명은 9999999
      { file: '이름없음.pdf', parse: { ...good, fields: { ...good.fields, '지원자 번호': null } } },
    ])
    const ids = [...built.rows.keys()]
    expect(ids).toEqual([3200370, 9999999])
    expect(built.rows.get(9999999)?.['한글성명']).toBe('마초롱')   // 본문 이름을 쓴다
    expect(built.warnings).toContainEqual(expect.stringMatching(/메모\.pdf.*건너뜀/))
    expect(built.warnings).toContainEqual(expect.stringMatching(/겹쳐 먼저 읽은/))
    expect(built.warnings).toContainEqual(expect.stringMatching(/9999999_다른이\.pdf.*파일명을 따름/))
    expect(built.warnings).toContainEqual(expect.stringMatching(/이름없음\.pdf.*번호가 파일명에도 본문에도 없어/))
    expect(built.warnings[0]).toMatch(/5개.*\(2명 · 건너뜀 2\)/)
  })

  it('명단 어댑터 — 취합파일로 만든 명단과 같은 모양이고 후보 학력이 글자로 풀린다', async () => {
    const files = pdfFiles.slice(0, 5).map(n => fileOf(resolve(PDF_DIR, n)))
    let ticks = 0
    const roster = await readRosterFromResumes(files, itemsOf, (done, total) => { ticks++; expect(total).toBe(5); expect(done).toBe(ticks) })
    expect(ticks).toBe(5)
    expect(roster.source).toBe('pdf')
    expect(roster.fileName).toBe('이력서 PDF (PDF 5개)')
    expect(roster.candidates).toHaveLength(5)
    expect(roster.candidates[0]).toMatchObject({ id: '3200370', name: '마초롱', education: '학사', major: '마루품질학과', job: '직무라' })
    expect(roster.headers).toEqual(RESUME_COLUMNS)
    expect(roster.rows[0]).toHaveLength(RESUME_COLUMNS.length)
  })

  it('PDF 가 아니거나 이력서로 읽힌 것이 없으면 이유를 말하고 멈춘다', async () => {
    await expect(readRosterFromResumes([new File(['x'], 'a.txt')], itemsOf)).rejects.toThrow('PDF 가 없습니다')
    const junk = new File([readFileSync(MASTER)], '취합파일.pdf')
    await expect(readRosterFromResumes([junk], itemsOf)).rejects.toThrow('이력서로 읽힌 것이 없습니다')
  })
})
