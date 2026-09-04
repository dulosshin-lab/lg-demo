import { useState, type ChangeEvent } from 'react'
import { blindColumns, type LiteRoster } from './data'

type RosterPageProps = {
  readonly roster: LiteRoster | null
  readonly busy: boolean
  /** PDF 를 읽는 동안의 진행 — 몇 장 중 몇 장을 읽었나. 안 읽을 때는 null */
  readonly progress: { readonly done: number; readonly total: number } | null
  readonly onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  readonly onUploadResumes: (event: ChangeEvent<HTMLInputElement>) => void
  readonly onNext: () => void
}

/** 가린 값 자리에 놓는 표시. 원본 데이터는 그대로 두고 화면에서만 바꾼다. */
const MASK = '●●'

/** React 의 input 타입에 없는 폴더 선택 속성 — 크롬·사파리·엣지가 지원한다 */
const FOLDER_INPUT = { webkitdirectory: '', directory: '' } as Record<string, string>

export function RosterPage({ roster, busy, progress, onUpload, onUploadResumes, onNext }: RosterPageProps) {
  const [blind, setBlind] = useState(true)
  const masked = blindColumns(roster?.headers ?? [])
  const rest = roster ? roster.candidates.length - roster.rows.length : 0
  const fromPdf = roster?.source === 'pdf'
  /* 첫 줄은 「몇 개에서 몇 명」 요약이라 칩에 이미 있다. 그 아래가 파일별 사정이다 */
  const notes = fromPdf ? roster!.parsed.warnings.slice(1) : []

  return (
    <section className="page" aria-labelledby="roster-title">
      <h1 id="roster-title">지원자 명단 등록</h1>
      <p className="caption">취합파일이나 이력서 PDF 폴더를 올리면 이 전형의 명단이 됩니다.</p>

      <div className="panel upload-panel">
        <div>
          <h2>취합파일로 올리기</h2>
          <div className="chip-row">
            <span className="chip"><span className="dot" />{roster && !fromPdf ? <>{roster.fileName}, <b>{roster.candidates.length}명</b>, {roster.columnCount}열</> : '업로드 대기'}</span>
          </div>
        </div>
        <input className="file-input" aria-label="명단 엑셀 업로드" type="file" accept=".xlsx" disabled={busy} onChange={onUpload} />
      </div>

      <div className="panel upload-panel">
        <div>
          <h2>이력서 PDF 폴더로 올리기</h2>
          <div className="chip-row">
            <span className="chip"><span className="dot" />
              {progress
                ? <>PDF 읽는 중 <b>{progress.done}</b> / {progress.total}</>
                : roster && fromPdf
                  ? <>{roster.fileName}, <b>{roster.candidates.length}명</b>, {roster.columnCount}열</>
                  : '폴더를 고르면 PDF 마다 지원자 번호·성명·학력을 읽어 명단을 만듭니다'}
            </span>
          </div>
        </div>
        <input className="file-input" aria-label="이력서 PDF 폴더 업로드" type="file" accept=".pdf" multiple disabled={busy} onChange={onUploadResumes} {...FOLDER_INPUT} />
      </div>

      <div className="sample-path"><b>샘플 파일</b> tests/sample_data/취합파일.xlsx · <b>샘플 폴더</b> data/lg_resumes_pdf/</div>

      <div className="panel">
        <div className="panel-head">
          <h2>올린 데이터 확인</h2>
          {roster && (
            <div className="chip-row">
              <button className="switch" type="button" aria-pressed={blind} onClick={() => setBlind(!blind)}>
                <span className="sw" aria-hidden="true" />
                블라인드 채용 <b>{blind ? '켜짐' : '꺼짐'}</b>
              </button>
              <span className="chip">가림 <b>{masked.size}항목</b></span>
              <span className="chip">전체 <b>{roster.columnCount}열</b></span>
            </div>
          )}
        </div>
        {roster ? (
          <>
            <p className="table-note">평가자 화면에는 가림 항목이 표시되지 않습니다.</p>
            {notes.length > 0 && (
              <details className="roster-notes">
                <summary>읽으면서 확인한 것 {notes.length}건</summary>
                <ul>{notes.map((n, k) => <li key={k}>{n}</li>)}</ul>
              </details>
            )}
            <div className="table-wrap roster-table" tabIndex={0}>
              <table>
                <thead>
                  <tr>{roster.headers.map(header => <th key={header} className={blind && masked.has(header) ? 'blind-col' : undefined}>{header}</th>)}</tr>
                </thead>
                <tbody>
                  {roster.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, column) => {
                        const hidden = blind && masked.has(roster.headers[column])
                        return <td key={roster.headers[column] ?? column} className={hidden ? 'blind-col' : undefined}>{hidden ? MASK : cell}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rest > 0 && <p className="table-note">외 {rest}명</p>}
            <div className="next-panel">
              <span>명단 {roster.candidates.length}명이 준비됐습니다. 팀 회신을 올려 편성할 수 있습니다.</span>
              <button className="button primary" type="button" onClick={onNext}>면접 일정 편성 열기</button>
            </div>
          </>
        ) : (
          <p className="empty" role="status">취합파일.xlsx 나 이력서 PDF 폴더를 올리면 명단이 표로 표시됩니다.</p>
        )}
      </div>
    </section>
  )
}
