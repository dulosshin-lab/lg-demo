import { useEffect, useRef } from 'react'

/* 팀 회신을 다시 올리기 전 확인.

   재업로드는 1차 편성을 새로 만드는 일이라, 그 위에 쌓은 수기 조정과 요청 이력이 사라진다.
   미팅 47:21 에서 담당자가 「본인이 원하는 대로 수정하고 추가하고 변경해서」라고 한 대로
   회신이 다시 오는 것은 일상이므로, 말없이 날리지 않고 **무엇이 얼마나** 사라지는지 세어 보여 준다.

   되돌릴 수 없는 일이라 기본 동작은 「그만두기」다 — 초점도 거기서 시작한다. */

type Props = {
  readonly files: number
  readonly atRisk: {
    readonly edits: number; readonly decided: number; readonly waiting: number
    /** 확정해서 이미 통보가 나간 일자 수 — 되돌릴 수 없는 쪽이라 맨 위에 둔다 */
    readonly confirmed: number
  }
  readonly canExport: boolean
  readonly onExport: () => void
  readonly onProceed: () => void
  readonly onCancel: () => void
}

export function ConfirmReupload({ files, atRisk, canExport, onExport, onProceed, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const proposals = atRisk.decided + atRisk.waiting

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="reup-title" aria-describedby="reup-body">
        <h2 id="reup-title">팀 회신을 다시 올리면 지금까지의 조정이 사라집니다</h2>
        <div id="reup-body">
          <p className="modal-lead">
            회신 {files}개로 1차 편성을 새로 만듭니다. 그 위에 쌓은 것은 되살릴 수 없습니다.
          </p>
          <ul className="modal-risk">
            {atRisk.confirmed > 0 && (
              <li><b>확정한 {atRisk.confirmed}일</b> — 이미 통보한 내용입니다. 새 편성은 이 자리를 지키지 않습니다</li>
            )}
            {atRisk.edits > 0 && <li><b>수기 편집 {atRisk.edits}건</b> — 옮기고 바꾸고 뺀 기록</li>}
            {proposals > 0 && (
              <li>
                <b>팀 요청 {proposals}건</b>
                {atRisk.waiting > 0 ? ` — 아직 처리하지 않은 ${atRisk.waiting}건 포함` : ' — 처리한 이력'}
              </li>
            )}
          </ul>
        </div>
        <div className="modal-actions">
          {canExport && <button className="button primary" type="button" onClick={onExport}>내보내고 계속</button>}
          <button className="button" type="button" onClick={onProceed}>그냥 계속</button>
          <button className="button" type="button" ref={cancelRef} onClick={onCancel}>그만두기</button>
        </div>
        {canExport && <p className="modal-note">「내보내고 계속」은 지금 편성표와 변경 요약을 엑셀로 내려받은 뒤 진행합니다.</p>}
      </div>
    </div>
  )
}
