import { useEffect, useRef } from 'react'

/* 다시 편성하기 전 확인.

   확정한 날짜와 손으로 옮긴 사람은 그대로 두고, 나머지만 엔진이 다시 배치한다.
   무엇이 고정되고 무엇이 움직이는지를 **누르기 전에** 세어 보여 준다 — 누른 뒤에
   "내가 고친 게 어디 갔지"를 찾게 만들면 다시는 안 누른다.

   되돌리기로는 못 되돌린다(사람마다 이전 자리가 다르고 기준선까지 바뀐다). 그래서
   기본 동작은 「그만두기」이고 초점도 거기서 시작한다 — 재업로드 확인 창과 같은 규칙이다. */

type Props = {
  /** 다시 배치할 날짜들 (0부터) */
  readonly openDays: readonly number[]
  readonly confirmedDays: number
  /** 확정돼서 고정되는 사람 수 */
  readonly confirmedPeople: number
  /** 손으로 옮겨서 고정되는 사람 수 */
  readonly touched: number
  /** 다시 배치될 사람 수 */
  readonly replaced: number
  readonly onProceed: () => void
  readonly onCancel: () => void
}

export function ConfirmReschedule({
  openDays, confirmedDays, confirmedPeople, touched, replaced, onProceed, onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const days = openDays.map(d => `${d + 1}일차`).join(' · ')

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="resched-title" aria-describedby="resched-body">
        <h2 id="resched-title">{days || '남은 일자'}를 다시 편성합니다</h2>
        <div id="resched-body">
          <p className="modal-lead">
            확정한 날짜와 손으로 옮긴 사람은 그 자리에 그대로 둡니다. 나머지만 다시 배치합니다.
          </p>
          <ul className="modal-risk">
            <li><b>그대로 두는 {confirmedPeople + touched}명</b>
              {' — '}확정 {confirmedDays}일 {confirmedPeople}명
              {touched > 0 ? ` · 손으로 옮긴 ${touched}명` : ''}
            </li>
            <li><b>다시 배치하는 {replaced}명</b> — 자리가 바뀔 수 있습니다</li>
          </ul>
          <p className="modal-note">다시 편성은 되돌리기로 되돌릴 수 없습니다. 변경 이력에는 한 줄로 남습니다.</p>
        </div>
        <div className="modal-actions">
          <button className="button primary" type="button" onClick={onProceed}>다시 편성</button>
          <button className="button" type="button" ref={cancelRef} onClick={onCancel}>그만두기</button>
        </div>
      </div>
    </div>
  )
}
