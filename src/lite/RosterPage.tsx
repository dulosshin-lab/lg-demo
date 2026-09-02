import { useState, type ChangeEvent } from 'react'
import { blindColumns, type LiteRoster } from './data'

type RosterPageProps = {
  readonly roster: LiteRoster | null
  readonly busy: boolean
  readonly onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  readonly onNext: () => void
}

/** 가린 값 자리에 놓는 표시. 원본 데이터는 그대로 두고 화면에서만 바꾼다. */
const MASK = '●●'

export function RosterPage({ roster, busy, onUpload, onNext }: RosterPageProps) {
  const [blind, setBlind] = useState(true)
  const masked = blindColumns(roster?.headers ?? [])
  const rest = roster ? roster.candidates.length - roster.rows.length : 0

  return (
    <section className="page" aria-labelledby="roster-title">
      <h1 id="roster-title">지원자 명단 등록</h1>
      <p className="caption">취합파일을 올리면 이 전형의 명단이 됩니다.</p>

      <div className="panel upload-panel">
        <div>
          <h2>명단 올리기</h2>
          <div className="chip-row">
            <span className="chip"><span className="dot" />{roster ? <>{roster.fileName}, <b>{roster.candidates.length}명</b>, {roster.columnCount}열</> : '업로드 대기'}</span>
          </div>
        </div>
        <input className="file-input" aria-label="명단 엑셀 업로드" type="file" accept=".xlsx" disabled={busy} onChange={onUpload} />
      </div>

      <div className="sample-path"><b>샘플 파일</b> tests/sample_data/취합파일.xlsx</div>

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
          <p className="empty" role="status">취합파일.xlsx를 올리면 명단이 표로 표시됩니다.</p>
        )}
      </div>
    </section>
  )
}
