import { useEffect, useRef, useState } from 'react'
import type { Placed } from '@/core/schedule'
import { detailOf, restOf, type DetailRole } from './applicantCard'

/* 지원자 상세 창.

   편성표·면접관 일정·팀 화면 어디서든 같은 창이 뜬다. 보여 주는 것은 취합파일의 원본 행이고,
   역할에 따라 인적 항목이 빠진다(applicantCard.ts).

   「원본보기」는 이력서 PDF 원본을 같은 창에서 보여 준다. 파일은 개발 서버가 `/resumes/{지원자번호}`
   로 내어 주고(vite.config.ts), **번호로만** 찾는다 — 맥에서 만든 한글 파일명은 자소가 분리돼 있어
   이름으로 맞추면 어긋난다. 원본이 없는 지원자는 단추가 아예 안 뜬다(눌러 놓고 빈 화면을 보여
   주는 것보다 낫다).

   PDF 는 브라우저 내장 뷰어에 맡긴다 — 라이브러리가 없다. 인쇄도 그 뷰어 것을 쓰면 된다.
   상세 쪽은 창만 남기는 인쇄 규칙(styles.css `@media print`)이 있어 Cmd+P 로 그대로 찍힌다. */

type Props = {
  readonly p: Placed
  readonly role: DetailRole
  /** 화면에 함께 보여 줄 배정 자리 — 「지금 언제 어디서 보는 사람인가」 */
  readonly placementText?: string
  readonly onClose: () => void
}

/** 이 지원자의 이력서 원본이 있나 — 있을 때만 「원본보기」를 띄운다 */
function useResume(appId: number) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const at = `/resumes/${appId}`
    fetch(at, { method: 'HEAD' })
      .then(r => { if (alive) setUrl(r.ok ? at : null) })
      .catch(() => { if (alive) setUrl(null) })
    return () => { alive = false }
  }, [appId])
  return url
}

export function ApplicantModal({ p, role, placementText, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [showRest, setShowRest] = useState(false)
  const [showPdf, setShowPdf] = useState(false)
  const sections = detailOf(p.app.attrs, role)
  const rest = restOf(p.app.attrs, role)
  const resume = useResume(p.app.id)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop applicant-back" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal applicant" role="dialog" aria-modal="true" aria-labelledby="app-title">
        <div className="applicant-head">
          <div>
            <h2 id="app-title">{p.app.name}</h2>
            <p className="applicant-sub">
              {p.edu} · {p.teams.join(' + ')}
              {placementText ? ` · ${placementText}` : ''}
            </p>
          </div>
          <div className="applicant-actions">
            {resume && (
              <button className="button" type="button" onClick={() => setShowPdf(o => !o)}>
                {showPdf ? '상세보기' : '원본보기'}
              </button>
            )}
            <button className="button" type="button" ref={closeRef} onClick={onClose}>닫기</button>
          </div>
        </div>

        {showPdf && resume ? (
          <div className="applicant-pdf">
            <iframe src={resume} title={`${p.app.name} 이력서 원본`} />
            <p className="modal-note">
              이력서 원본입니다. 내려받기·인쇄는 뷰어 오른쪽 위 단추를 쓰세요.
            </p>
          </div>
        ) : (
        <div className="applicant-body">
          {sections.length === 0 && (
            <p className="drawer-empty">이 지원자의 취합 데이터가 없습니다. 명단을 다시 올리면 채워집니다.</p>
          )}
          {sections.map(s => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <dl>
                {s.fields.map(f => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          {p.interviewers.length > 0 && (
            <section>
              <h3>면접관</h3>
              <p className="applicant-iv">{p.interviewers.join(' · ')}</p>
            </section>
          )}

          {rest.length > 0 && (
            <details className="fold" open={showRest} onToggle={e => setShowRest(e.currentTarget.open)}>
              <summary>원본 값 더 보기 <span className="badge">{rest.length}개</span></summary>
              <dl>
                {rest.map(f => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
        )}

        {!showPdf && (
          <p className="modal-note">
            {resume
              ? '취합파일 항목입니다. 자기소개서·경력기술서는 「원본보기」에서 확인하세요.'
              : '취합파일에 있는 항목만 보여 줍니다 — 이 지원자는 이력서 원본이 없습니다.'}
          </p>
        )}
      </div>
    </div>
  )
}
