import { useState } from 'react'
import type { Applicant } from '@/core/schedule'
import {
  DEFAULT_SETUP, PRESETS, daysNote, lastSetup, previewOf, warningsOf,
  type EduBoundary, type FirstSlotMode, type Setup,
} from './setup'

/* 전형 설정 — 기본값은 펴 두고 나머지는 접는다.

   미팅: "HR 은 최대한 많이 범위를 열어줘야 튜닝도 할 수 있고 … 면접관은 최소화하는 게 좋아요."
   우리가 「허들이라서 뺐다」고 한 판단이 미스였다는 지적을 받은 자리라, 항목을 숨기지 않고
   **자주 만지는 것을 위에, 나머지를 상세 설정 접기에** 둔다.

   입력칸보다 중요한 것이 **바로 옆의 계산 결과**다. 담당자는 「면접 25분」이 아니라
   「몇 시에 끝나나 · 하루 몇 자리 · 며칠 걸리나」로 판단한다. 그래서 고칠 때마다 다시 센다.

   확정한 날짜가 있으면 시간표 항목은 잠근다 — 좌표는 그대로인데 가리키는 시각이 달라져
   이미 나간 통보와 조용히 어긋나기 때문이다(setup.ts TIME_KEYS). */

type Props = {
  readonly setup: Setup
  readonly onChange: (next: Setup) => void
  /** 편성된 지원자 — 「왜 N일인가」와 용량 검산에 쓴다 */
  readonly apps?: readonly Applicant[]
  /** 확정된 일자 수. 0 보다 크면 시간표 항목을 잠근다 */
  readonly confirmedDays?: number
  /** 이미 1차 편성이 있으면 저장할 때 재편성이 필요하다고 알린다 */
  readonly hasSchedule?: boolean
  readonly onNext?: () => void
  readonly onNotify?: (text: string) => void
}

const Num = ({
  label, value, onChange, min = 0, max = 999, unit, disabled, hint,
}: {
  readonly label: string
  readonly value: number
  readonly onChange: (v: number) => void
  readonly min?: number
  readonly max?: number
  readonly unit?: string
  readonly disabled?: boolean
  readonly hint?: string
}) => (
  <label className={`s-field${disabled ? ' locked' : ''}`}>
    <span>{label}</span>
    <span className="s-input">
      <input type="number" value={value} min={min} max={max} disabled={disabled}
        onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
      {unit && <i>{unit}</i>}
    </span>
    <small>{hint ?? ''}</small>
  </label>
)

const Text = ({
  label, value, onChange, type = 'text', disabled, placeholder, wide,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (v: string) => void
  readonly type?: string
  readonly disabled?: boolean
  readonly placeholder?: string
  readonly wide?: boolean
}) => (
  <label className={`s-field${wide ? ' wide' : ''}${disabled ? ' locked' : ''}`}>
    <span>{label}</span>
    <span className="s-input">
      <input type={type} value={value} disabled={disabled} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
    </span>
    <small />
  </label>
)

const Toggle = ({
  label, on, onChange, hint,
}: {
  readonly label: string
  readonly on: boolean
  readonly onChange: (v: boolean) => void
  readonly hint?: string
}) => (
  <label className="s-toggle">
    <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} />
    <span className="s-toggle-text">
      <b>{label}</b>
      {hint && <small>{hint}</small>}
    </span>
  </label>
)

export function SetupPage({
  setup, onChange, apps = [], confirmedDays = 0, hasSchedule = false, onNext, onNotify,
}: Props) {
  const [open, setOpen] = useState(false)
  const [holiday, setHoliday] = useState('')
  const preview = previewOf(setup)
  const warnings = warningsOf(setup, apps.length)
  const note = daysNote(apps, setup)
  const locked = confirmedDays > 0
  const set = <K extends keyof Setup>(k: K, v: Setup[K]) => onChange({ ...setup, [k]: v })

  const addHoliday = () => {
    if (!holiday || setup.holidays.includes(holiday)) return
    set('holidays', [...setup.holidays, holiday].sort())
    setHoliday('')
  }

  return (
    <section className="page" aria-labelledby="setup-title">
      <h1 id="setup-title">전형 설정</h1>
      <p className="caption">
        면접 기간·일일 슬롯·팀 회신 마감일·편성 규칙을 정합니다. 여기서 정한 값으로 1차 편성이 돌아갑니다.
      </p>

      {locked && (
        <p className="panel s-lock" role="status">
          <b>확정한 날짜가 {confirmedDays}일 있어 시간표는 바꿀 수 없습니다.</b>
          {' '}면접 시간이나 세션 수를 바꾸면 같은 자리가 다른 시각을 가리켜 이미 나간 통보와 어긋납니다 —
          바꾸려면 편성 화면에서 확정을 먼저 푸세요.
        </p>
      )}

      <div className="panel s-panel">
        <Text label="전형 이름" value={setup.name} onChange={v => set('name', v)} wide
          placeholder="예: 2026 하반기 신입 2차 직무면접" />
        <p className="s-note">내보내는 파일 이름과 편성표 머리글에 이 이름이 실립니다.</p>
      </div>

      {/* A. 면접 기간 */}
      <div className="panel s-panel">
        <h2 className="s-head"><i>A</i> 면접 기간</h2>
        <div className="s-row">
          <Text label="시작일" type="date" value={setup.startDate} onChange={v => set('startDate', v)} />
          <Num label="일수" value={setup.days} min={0} max={30} unit="일"
            onChange={v => set('days', v)} hint="0 = 필요한 만큼 자동" />
          <Toggle label="주말 건너뛰기" on={setup.skipWeekend} onChange={v => set('skipWeekend', v)} />
        </div>
        <div className="s-row">
          <label className="s-field">
            <span>쉬는 날 추가</span>
            <span className="s-input">
              <input type="date" value={holiday} onChange={e => setHoliday(e.target.value)} />
            </span>
            <small />
          </label>
          <button className="button s-add" type="button" onClick={addHoliday} disabled={!holiday}>추가</button>
          <div className="s-chips">
            {setup.holidays.length === 0 && <span className="s-empty">공휴일·회사 휴무일을 넣으면 그날을 건너뜁니다.</span>}
            {setup.holidays.map(d => (
              <button key={d} type="button" className="s-chip" title="지우기"
                onClick={() => set('holidays', setup.holidays.filter(x => x !== d))}>
                {d} ×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* B. 일일 슬롯 */}
      <div className="panel s-panel">
        <h2 className="s-head"><i>B</i> 일일 슬롯</h2>
        <div className="s-row s-presets">
          <span className="s-empty">자주 쓰는 조합</span>
          {PRESETS.map(p => (
            <button key={p.label} className="button" type="button"
              disabled={locked}
              onClick={() => onChange({ ...setup, sessions: p.sessions, rooms: p.rooms })}>
              {p.label}
            </button>
          ))}
          <span className="s-empty">세션 × 조</span>
        </div>
        <div className="s-row">
          <Num label="하루 세션 수" value={setup.sessions} min={1} max={30} disabled={locked}
            onChange={v => set('sessions', v)} />
          <Num label="조 수" value={setup.rooms} min={1} max={12} unit="조"
            onChange={v => set('rooms', v)} hint="동시에 여는 면접방 수" />
          <Num label="면접 시간" value={setup.sessionMin} min={5} max={180} unit="분" disabled={locked}
            onChange={v => set('sessionMin', v)} />
          <Num label="휴식 시간" value={setup.breakMin} min={0} max={60} unit="분" disabled={locked}
            onChange={v => set('breakMin', v)} />
          <Text label="시작 시각" type="time" value={setup.startTime} disabled={locked}
            onChange={v => set('startTime', v)} />
        </div>
        <div className="s-row">
          <Text label="점심 시작" type="time" value={setup.lunchStart} disabled={locked}
            onChange={v => set('lunchStart', v)} />
          <Num label="점심 길이" value={setup.lunchMin} min={0} max={180} unit="분" disabled={locked}
            onChange={v => set('lunchMin', v)} />
          <Num label="오전 세션 수" value={setup.amSessions} min={0} max={setup.sessions} disabled={locked}
            onChange={v => set('amSessions', v)} hint="나머지는 점심 뒤" />
        </div>

        <div className="s-preview" aria-live="polite">
          <b>{preview.times[0]?.label.split('–')[0] ?? '—'} 시작 · 마지막 면접 {preview.endTime} 종료</b>
          <span>하루 {preview.seatsPerDay}자리 ({setup.sessions}세션 × {setup.rooms}조)</span>
          {note && <span>{note}</span>}
        </div>
      </div>

      {/* C. 팀 회신 마감일 */}
      <div className="panel s-panel">
        <h2 className="s-head"><i>C</i> 팀 회신 마감일</h2>
        <div className="s-row">
          <Text label="마감일" type="date" value={setup.replyDue} onChange={v => set('replyDue', v)} />
          <span className="s-empty">편성에는 쓰이지 않습니다 — 취합이 늦은 팀을 가리는 데 씁니다.</span>
        </div>
      </div>

      {/* D. 편성 규칙 */}
      <div className="panel s-panel">
        <h2 className="s-head"><i>D</i> 편성 규칙</h2>
        <div className="s-row">
          <Toggle label="학력 분리" on={setup.separateEdu} onChange={v => set('separateEdu', v)}
            hint="학사·석사·박사를 섞지 않습니다" />
          <label className="s-field s-wide-hint">
            <span>분리 단위</span>
            <span className="s-input">
              <select value={setup.eduBoundary} disabled={!setup.separateEdu}
                onChange={e => set('eduBoundary', e.target.value as EduBoundary)}>
                <option value="session">시간축 연속 — 학사 다음 세션부터 석사</option>
                <option value="day">날짜 통째로 — 하루에 한 학력만</option>
              </select>
            </span>
            <small>{setup.eduBoundary === 'session'
              ? '한 날에 학사·석사가 이어질 수 있습니다. 날짜를 아낍니다'
              : '학력이 날짜를 나눠 씁니다. 면접관 소집이 깔끔한 대신 하루가 더 듭니다'}</small>
          </label>
          <Toggle label="면접관 중복 검사" on={setup.checkInterviewer} onChange={v => set('checkInterviewer', v)}
            hint="한 면접관을 같은 시각에 두 곳에 넣지 않습니다" />
          <label className="s-field s-wide-hint">
            <span>첫 타임 회피</span>
            <span className="s-input">
              <select value={setup.avoidFirstSlot}
                onChange={e => set('avoidFirstSlot', e.target.value as FirstSlotMode)}>
                <option value="off">끔 — 아침 첫 타임도 그대로 씁니다</option>
                <option value="soft">되도록 피함 — 자리가 없으면 씁니다</option>
                <option value="hard">반드시 피함 — 자리를 비워 둡니다</option>
              </select>
            </span>
            <small>지원자가 많은 팀을 아침 첫 면접에 넣지 않으려는 규칙입니다</small>
          </label>
        </div>
        <div className="s-row s-only-toggles">
          <Toggle label="팀 연속 배치 정리" on={setup.contiguous} onChange={v => set('contiguous', v)}
            hint="같은 팀을 같은 방에서 이어 앉힙니다. 면접관이 하루에 두 번 나오는 일이 줄어듭니다" />
        </div>
      </div>

      {/* 상세 설정 — 조별 링크 */}
      <details className="panel s-panel fold" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
        <summary>
          <span>조별 화상 링크</span>
          <span className="badge">{setup.links.filter(Boolean).length}/{setup.rooms}조 입력됨</span>
        </summary>
        <div className="fold-body">
          <p className="s-note">조가 곧 면접방이라 링크도 조에 붙습니다. 편성표와 내보내기에 함께 실립니다.</p>
          <div className="s-row">
            {Array.from({ length: setup.rooms }, (_, i) => (
              <Text key={i} label={`${i + 1}조`} value={setup.links[i] ?? ''} placeholder="https://…"
                onChange={v => {
                  const next = Array.from({ length: setup.rooms }, (_, k) => setup.links[k] ?? '')
                  next[i] = v
                  set('links', next)
                }} />
            ))}
          </div>
        </div>
      </details>

      {warnings.length > 0 && (
        <div className="panel s-warn" role="status">
          <b>확인해 주세요</b>
          <ul>{warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="panel s-actions">
        <button className="button" type="button" onClick={() => {
          const last = lastSetup()
          if (!last) { onNotify?.('저장된 지난 설정이 없습니다.'); return }
          onChange(last)
          onNotify?.('지난 설정을 불러왔습니다.')
        }}>지난 설정 불러오기</button>
        <button className="button" type="button" onClick={() => {
          onChange(DEFAULT_SETUP)
          onNotify?.('기본값으로 되돌렸습니다.')
        }}>기본값으로</button>
        {onNext && (
          <button className="button primary" type="button" onClick={onNext}>
            {hasSchedule ? '편성 화면으로' : '지원자 명단 등록으로'}
          </button>
        )}
      </div>

      {hasSchedule && (
        <p className="s-note">
          이미 1차 편성이 있습니다. 바꾼 설정은 <b>다음 편성부터</b> 적용됩니다 —
          지금 편성표에 반영하려면 팀 회신을 다시 올려 새로 편성해야 하고, 그때 수기 조정과 확정은 사라집니다.
        </p>
      )}
    </section>
  )
}
