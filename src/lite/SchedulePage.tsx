import { useEffect, useState, type ChangeEvent } from 'react'
import type { LiteRoster, LiteSchedule } from './data'

type SchedulePageProps = {
  readonly roster: LiteRoster | null
  readonly schedule: LiteSchedule | null
  readonly busy: boolean
  readonly onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  readonly onBack: () => void
}

export function SchedulePage({ roster, schedule, busy, onUpload, onBack }: SchedulePageProps) {
  const [day, setDay] = useState(0)
  useEffect(() => setDay(0), [schedule])
  const result = schedule?.result ?? null

  return (
    <section className="page" aria-labelledby="schedule-title">
      <h1 id="schedule-title">면접 일정 편성</h1>
      <p className="caption">팀 회신을 올리면 본제품과 같은 엔진 경로로 8세션 × 4조 편성표를 만듭니다.</p>

      <div className="panel upload-panel">
        <div>
          <h2>팀 회신 올리기</h2>
          <div className="chip-row">
            <span className="chip">명단 <b>{roster ? `${roster.candidates.length}명` : '필요'}</b></span>
            {schedule && <span className="chip">회신 <b>{schedule.sourceCount}개</b></span>}
          </div>
        </div>
        {roster ? (
          <input className="file-input primary-file" aria-label="팀 회신 엑셀 업로드" type="file" accept=".xlsx" multiple disabled={busy} onChange={onUpload} />
        ) : (
          <button className="button" type="button" onClick={onBack}>지원자 명단 먼저 등록</button>
        )}
      </div>

      <div className="sample-path"><b>샘플 파일</b> tests/sample_data/희망지원자_*_re.xlsx · 여러 파일을 한 번에 선택하세요.</div>

      {schedule && result ? (
        <>
          <div className="panel summary" aria-label="편성 요약">
            <span className="chip"><span className="dot" />편성 완료 <b>{result.placed.length}명</b></span>
            <span className="chip">일수 <b>{result.totalDays}일</b></span>
            <span className="chip">하드 위반 <b>{schedule.hardViolations}</b></span>
            <span className="chip">미배정 <b>{result.unplaced.length}명</b></span>
          </div>

          <div className="day-tabs" aria-label="면접 일자">
            {result.dates.map((date, index) => (
              <button key={date.iso} type="button" aria-pressed={day === index} onClick={() => setDay(index)}>
                {index + 1}일차 {date.iso.slice(5).replace('-', '/')}({date.wd})
              </button>
            ))}
          </div>

          <div className="table-wrap schedule-table" tabIndex={0}>
            <table>
              <thead><tr><th>시간</th>{Array.from({ length: result.cfg.rooms }, (_, room) => <th key={room}>{room + 1}조</th>)}</tr></thead>
              <tbody>
                {result.times.map((time, slot) => (
                  <tr key={time.i}>
                    <th>{time.label.split('–')[0]}</th>
                    {Array.from({ length: result.cfg.rooms }, (_, room) => {
                      const placed = result.grid[`${day}|${slot}|${room}`]
                      return (
                        <td className={placed?.teams.length && placed.teams.length > 1 ? 'joint' : undefined} key={room}>
                          {placed ? <><b>{placed.app.name}</b><span>{placed.edu} · {placed.teams.join(' + ')}</span><small>{placed.interviewers.join(' · ')}</small></> : null}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="more">{result.cfg.sessions}세션 × {result.cfg.rooms}조 · 기존 Sched 엔진 배치</p>
        </>
      ) : (
        <div className="panel empty" role="status">{roster ? '팀 회신 엑셀을 올리면 일자 탭과 편성 격자가 표시됩니다.' : '먼저 지원자 명단을 등록하세요.'}</div>
      )}
    </section>
  )
}
