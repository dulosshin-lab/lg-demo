import { useEffect, useMemo, useState } from 'react'
import type { Result } from '@/core/schedule'
import type { EditState } from './edit'
import { iGa } from './hangul'
import {
  KIND_LABEL, STATUS_LABEL, createProposal, replyText,
  type NewProposal, type Proposal, type ProposalKind,
} from './proposals'

/* 팀 담당자 화면 — 우리 팀 면접을 보고, 고쳐 달라고 제안하고, 회신을 읽는다.

   지금은 이 왕복이 전부 메일이다(미팅 40:14 "지금 메일로 모든 걸").
   여기서 보내면 간사의 큐에 바로 쌓이고, 승인되면 편성표에 반영된 결과가 이 화면에 돌아온다. */

type Props = {
  readonly team: string
  readonly who: string
  readonly base: Result | null
  readonly state: EditState | null
  readonly proposals: readonly Proposal[]
  readonly onSend: (p: Proposal) => void
  readonly onGoSchedule: () => void
  /** 이 화면을 열면 도착한 회신을 본 것으로 적는다 — 종 알림에서 빠진다 */
  readonly onSeen?: () => void
}

const hhmm = (ts: string) => `${ts.slice(5, 10).replace('-', '/')} ${ts.slice(11, 16)}`

export function TeamSchedulePage({ team, who, base, state, proposals, onSend, onGoSchedule, onSeen }: Props) {
  const [pick, setPick] = useState<number | null>(null)
  const [kind, setKind] = useState<ProposalKind>('move')
  const [toDay, setToDay] = useState(0)
  const [toSlot, setToSlot] = useState(0)
  const [toRoom, setToRoom] = useState(0)
  const [peer, setPeer] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)

  // 화면을 여는 순간 회신을 읽은 것으로 친다
  useEffect(() => { onSeen?.() }, [onSeen])

  const mine = useMemo(
    () => (state?.placed ?? []).filter(p => p.teams.includes(team))
      .slice().sort((a, b) => a.day - b.day || a.slot - b.slot || a.room - b.room),
    [state, team],
  )
  const ours = useMemo(() => proposals.filter(p => p.fromTeam === team).slice().reverse(), [proposals, team])
  const chosen = mine.find(p => p.app.id === pick) ?? null

  /* 어느 칸이 비어 있나 — 팀이 이미 찬 자리를 제안하면 간사가 거절할 수밖에 없다.
     고르는 자리에서 미리 알려 주는 편이 왕복을 한 번 줄인다. */
  const taken = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of state?.placed ?? []) m.set(`${p.day}|${p.slot}|${p.room}`, p.app.name)
    return m
  }, [state])
  const freeRooms = (d: number, slot: number) => {
    if (!base) return 0
    let n = 0
    for (let r = 0; r < base.cfg.rooms; r++) {
      const who = taken.get(`${d}|${slot}|${r}`)
      if (!who || who === chosen?.app.name) n++
    }
    return n
  }

  if (!base || !state) {
    return (
      <section className="page" aria-labelledby="team-title">
        <h1 id="team-title">우리 팀 면접 일정</h1>
        <p className="caption">편성이 끝나면 우리 팀 면접과 수정 요청 창구가 여기에 표시됩니다.</p>
        <div className="panel empty" role="status">
          아직 편성표가 없습니다. <button className="switch" type="button" onClick={onGoSchedule}>편성 화면 열기</button>
        </div>
      </section>
    )
  }

  const send = () => {
    if (!chosen) { setErr('요청할 면접을 먼저 고르세요.'); return }
    if (!reason.trim()) { setErr('요청 사유를 적어 주세요. 간사가 판단하는 근거가 됩니다.'); return }
    if (kind === 'swap' && peer === null) { setErr('자리를 바꿀 상대를 고르세요.'); return }
    if (kind === 'move') {
      if (toDay === chosen.day && toSlot === chosen.slot && toRoom === chosen.room) {
        setErr('지금 있는 자리와 같습니다. 옮길 자리를 고르세요.')
        return
      }
      const at = taken.get(`${toDay}|${toSlot}|${toRoom}`)
      if (at && at !== chosen.app.name) {
        setErr(`그 자리에는 ${at}${iGa(at)} 있습니다. 빈 자리를 고르거나 「자리 교환」으로 요청하세요.`)
        return
      }
    }

    const peerRec = mine.find(p => p.app.id === peer)
    const input: NewProposal = {
      fromTeam: team, fromName: who, kind,
      appId: chosen.app.id, appName: chosen.app.name,
      from: { day: chosen.day, slot: chosen.slot, room: chosen.room },
      to: kind === 'move' ? { day: toDay, slot: toSlot, room: toRoom } : null,
      peerAppId: kind === 'swap' ? peer ?? undefined : undefined,
      peerAppName: kind === 'swap' ? peerRec?.app.name : undefined,
      reason: reason.trim(),
    }
    onSend(createProposal(proposals, input))
    setPick(null); setReason(''); setPeer(null); setErr(null)
  }

  return (
    <section className="page" aria-labelledby="team-title">
      <h1 id="team-title">우리 팀 면접 일정</h1>
      <p className="caption">
        {team}이 참여하는 면접입니다. 바꾸고 싶은 것이 있으면 아래에서 요청하세요 —
        메일 대신 간사에게 바로 전달되고, 처리 결과가 이 화면으로 돌아옵니다.
      </p>

      <div className="panel summary">
        <span className="chip"><span className="dot" />우리 팀 면접 <b>{mine.length}건</b></span>
        <span className="chip">보낸 요청 <b>{ours.length}건</b></span>
        <span className="chip">대기 중 <b>{ours.filter(p => p.status === 'pending').length}건</b></span>
      </div>

      <div className="panel">
        <h2 className="v-sub" style={{ marginTop: 0 }}>우리 팀 면접</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>일자</th><th>시간</th><th>조</th><th>지원자</th><th>면접관</th><th /></tr></thead>
            <tbody>
              {mine.map(p => (
                <tr key={p.app.id} className={pick === p.app.id ? 'picked' : undefined}>
                  <td>{base.dates[p.day]?.label}</td>
                  <td>{base.times[p.slot]?.label}</td>
                  <td>{p.room + 1}조</td>
                  <td><b>{p.app.name}</b><br /><small>{p.edu} · {p.teams.join(' + ')}</small></td>
                  <td>{p.interviewers.join(', ')}</td>
                  <td>
                    <button type="button" className="switch" onClick={() => {
                      setPick(p.app.id); setErr(null); setKind('move')
                      setToDay(p.day); setToSlot(p.slot); setToRoom(p.room)
                    }}>수정 요청</button>
                  </td>
                </tr>
              ))}
              {mine.length === 0 && <tr><td colSpan={6}>우리 팀 면접이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {chosen && (
        <div className="panel prop-compose">
          <h2 className="v-sub" style={{ marginTop: 0 }}>
            수정 요청 — {chosen.app.name} ({base.dates[chosen.day]?.label} {base.times[chosen.slot]?.label} {chosen.room + 1}조)
          </h2>

          <div className="compose-row">
            <label>무엇을
              <select value={kind} aria-label="요청 종류" onChange={e => setKind(e.target.value as ProposalKind)}>
                {(['move', 'swap', 'remove'] as ProposalKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>

            {kind === 'move' && (
              <>
                <label>일자
                  <select value={toDay} aria-label="옮길 일자" onChange={e => setToDay(Number(e.target.value))}>
                    {base.dates.map((d, i) => <option key={d.iso} value={i}>{i + 1}일차 {d.label}</option>)}
                  </select>
                </label>
                <label>시간
                  <select value={toSlot} aria-label="옮길 시간" onChange={e => setToSlot(Number(e.target.value))}>
                    {base.times.map((t, i) => {
                      const free = freeRooms(toDay, i)
                      return <option key={t.i} value={i}>{t.label}{free ? ` · 빈 조 ${free}` : ' · 자리 없음'}</option>
                    })}
                  </select>
                </label>
                <label>조
                  <select value={toRoom} aria-label="옮길 조" onChange={e => setToRoom(Number(e.target.value))}>
                    {Array.from({ length: base.cfg.rooms }, (_, r) => {
                      const who = taken.get(`${toDay}|${toSlot}|${r}`)
                      const busy = who && who !== chosen?.app.name
                      return <option key={r} value={r}>{r + 1}조{busy ? ` — ${who} 있음` : ' — 빈 자리'}</option>
                    })}
                  </select>
                </label>
              </>
            )}

            {kind === 'swap' && (
              <label>바꿀 상대
                <select value={peer ?? ''} aria-label="교환 상대" onChange={e => setPeer(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">고르세요</option>
                  {mine.filter(p => p.app.id !== chosen.app.id).map(p => (
                    <option key={p.app.id} value={p.app.id}>
                      {p.app.name} · {base.dates[p.day]?.label} {base.times[p.slot]?.label} {p.room + 1}조
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="compose-reason">요청 사유 — 간사가 판단하는 근거가 됩니다
            <textarea rows={2} value={reason} aria-label="요청 사유"
              placeholder="예: 박팀장이 그날 오전 임원회의가 잡혀 오후로 옮겨야 합니다."
              onChange={e => { setReason(e.target.value); setErr(null) }} />
          </label>

          {err && <p className="prop-warn" role="alert">{err}</p>}
          <div className="prop-actions">
            <button type="button" className="button primary" onClick={send}>간사에게 보내기</button>
            <button type="button" className="button" onClick={() => { setPick(null); setErr(null) }}>그만두기</button>
          </div>
        </div>
      )}

      <div className="panel">
        <h2 className="v-sub" style={{ marginTop: 0 }}>보낸 요청과 회신 {ours.length}건</h2>
        {ours.length === 0
          ? <p className="drawer-empty">아직 보낸 요청이 없습니다.</p>
          : <ul className="prop-list done">
              {ours.map(p => (
                <li key={p.id} className={p.status === 'rejected' ? 'needs-action' : undefined}>
                  <div className="prop-head">
                    <span className={`prop-status ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                    <span>{KIND_LABEL[p.kind]} · {p.appName}</span>
                    <span className="prop-meta">{hhmm(p.createdAt)}</span>
                  </div>
                  <p className="prop-reason">보낸 사유 — “{p.reason}”</p>
                  <p className={p.status === 'rejected' ? 'prop-warn' : 'prop-reply'}>회신 — {replyText(p)}</p>
                </li>
              ))}
            </ul>}
      </div>
    </section>
  )
}
