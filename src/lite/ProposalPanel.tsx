import { useEffect, useRef, useState } from 'react'
import type { Result } from '@/core/schedule'
import type { EditState } from './edit'
import {
  KIND_LABEL, STATUS_LABEL, effectOf, isApplicable, proposalText, replyText,
  type Proposal,
} from './proposals'

/* HR 간사가 팀의 수정 제안을 처리하는 큐 — 오른쪽에서 밀려나오는 서랍.

   편성표를 덮지 않고 옆에 서는 것이 요점이다. 승인하면 왼쪽 격자가 그 자리에서 바뀌므로,
   간사가 「이 요청을 받으면 표가 어떻게 되나」를 화면을 옮기지 않고 확인할 수 있다.
   승인하면 편성표에 바로 반영되고, 거절하면 사유가 팀에게 회신된다.
   사유 없는 거절은 막는다 — 그것이 다시 메일 왕복을 만드는 원인이다. */

type Props = {
  readonly base: Result
  readonly state: EditState
  readonly proposals: readonly Proposal[]
  readonly onApprove: (p: Proposal, note: string) => void
  readonly onReject: (p: Proposal, note: string) => void
  readonly onGo: (day: number) => void
  readonly onClose: () => void
  /** 팀 담당자 화면으로 — 요청이 어떻게 들어오는지 바로 보여 주려는 지름길 */
  readonly onGoTeam?: () => void
}

const hhmm = (ts: string) => `${ts.slice(5, 10).replace('-', '/')} ${ts.slice(11, 16)}`

export function ProposalPanel({ base, state, proposals, onApprove, onReject, onGo, onClose, onGoTeam }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<'approve' | 'reject'>('reject')
  const [err, setErr] = useState<string | null>(null)
  const shell = useRef<HTMLDivElement>(null)

  // 열리면 초점을 서랍으로 옮기고, ESC 로 닫는다
  useEffect(() => {
    shell.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pending = proposals.filter(p => p.status === 'pending')
  const done = proposals.filter(p => p.status !== 'pending').slice().reverse()

  const start = (id: string, next: 'approve' | 'reject') => {
    setOpen(id); setMode(next); setNote(''); setErr(null)
  }

  const submit = (p: Proposal) => {
    if (mode === 'reject' && !note.trim()) {
      setErr('거절 사유를 적어 주세요. 팀에게 그대로 회신됩니다.')
      return
    }
    if (mode === 'approve') onApprove(p, note.trim())
    else onReject(p, note.trim())
    setOpen(null); setNote(''); setErr(null)
  }

  return (
    <aside className="slideover" ref={shell} tabIndex={-1} role="dialog" aria-modal="false" aria-label="팀이 보낸 수정 요청">
      <div className="slideover-head">
        <h2>받은 요청 <b>{pending.length}</b></h2>
        <button type="button" className="slideover-close" aria-label="닫기" onClick={onClose}>✕</button>
      </div>
      <div className="slideover-body">
      {/* 빈 화면에 회색 한 줄만 두면 「고장났나」로 읽힌다 — 무엇을 기다리는 자리인지 적는다 */}
      {pending.length === 0 && (
        <div className="inbox-empty">
          <p className="inbox-empty-title">기다리는 요청이 없습니다.</p>
          <p>
            팀 담당자가 <b>「우리 팀 면접 일정」</b>에서 자리 이동·교환·취소를 요청하면 여기에 쌓입니다.
          </p>
          <ul>
            <li><b>승인</b>하면 왼쪽 편성표에 바로 반영되고, 변경 이력에 남습니다.</li>
            <li><b>거절</b>하면 사유가 팀에게 그대로 회신됩니다.</li>
          </ul>
          {onGoTeam && (
            <button type="button" className="button" onClick={onGoTeam}>
              팀 담당자 화면에서 보내 보기
            </button>
          )}
        </div>
      )}

      <ul className="prop-list">
        {pending.map(p => {
          const can = isApplicable(state, p)
          const effect = can.ok ? effectOf(base, state, p) : null
          return (
            <li key={p.id}>
              <div className="prop-head">
                <span className="prop-kind">{KIND_LABEL[p.kind]}</span>
                <button type="button" className="prop-go" onClick={() => p.from && onGo(p.from.day)}>
                  {proposalText(base, p)}
                </button>
                <span className="prop-meta">{p.fromTeam} {p.fromName} · {hhmm(p.createdAt)}</span>
              </div>
              <p className="prop-reason">“{p.reason}”</p>
              {!can.ok && <p className="prop-warn">{can.why}</p>}
              {/* 막지 않고 알리기만 한다 — 승인·거절이 하는 일은 그대로다 */}
              {effect && (effect.alerts.length > 0 || effect.linkDelta > 0) && (
                <div className="prop-effect">
                  <span className="prop-effect-head">승인하면</span>
                  <ul>
                    {effect.alerts.map(t => <li key={t}>{t}</li>)}
                    {effect.linkDelta > 0 && <li>면접방 이동이 {effect.linkDelta}건 늘어납니다</li>}
                  </ul>
                </div>
              )}

              {open === p.id ? (
                <div className="prop-form">
                  <label>
                    {mode === 'approve' ? '팀에 함께 보낼 말 (선택)' : '거절 사유 — 팀에게 그대로 갑니다'}
                    <textarea
                      value={note} rows={2} autoFocus
                      aria-label={mode === 'approve' ? '승인 메모' : '거절 사유'}
                      placeholder={mode === 'approve'
                        ? '예: 요청대로 오후로 옮겼습니다.'
                        : '예: 그 시간에는 김총이 면접관이 AI솔루션팀 면접에 들어가 있어 옮길 수 없습니다. 14:10 이후로 다시 제안해 주세요.'}
                      onChange={e => { setNote(e.target.value); setErr(null) }}
                    />
                  </label>
                  {err && <p className="prop-warn" role="alert">{err}</p>}
                  <div className="prop-actions">
                    <button type="button" className="button primary" onClick={() => submit(p)}>
                      {mode === 'approve' ? '승인하고 회신' : '거절하고 회신'}
                    </button>
                    <button type="button" className="button" onClick={() => setOpen(null)}>그만두기</button>
                  </div>
                </div>
              ) : (
                <div className="prop-actions">
                  <button type="button" className="button" disabled={!can.ok} onClick={() => start(p.id, 'approve')}>
                    승인
                  </button>
                  <button type="button" className="button" onClick={() => start(p.id, 'reject')}>거절</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {done.length > 0 && (
        <details className="v-old">
          <summary>처리한 요청 {done.length}건</summary>
          <ul className="prop-list done">
            {done.map(p => (
              <li key={p.id}>
                <div className="prop-head">
                  <span className={`prop-status ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                  <span>{proposalText(base, p)}</span>
                  <span className="prop-meta">{p.fromTeam} · {p.decidedAt ? hhmm(p.decidedAt) : ''}</span>
                </div>
                <p className="prop-reason">회신 — {replyText(p)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      </div>
    </aside>
  )
}
