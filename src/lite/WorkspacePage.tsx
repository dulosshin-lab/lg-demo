import { useEffect, useState } from 'react'
import { ollamaChat } from './ollama'

type Interview = {
  readonly id: string
  readonly time: string
  readonly group: string
  readonly degree: string
  readonly major: string
  readonly job: string
  readonly award: string
}

/** 블라인드 원칙에 맞춰 이름 없이 지원자 번호만 쓴다. */
const INTERVIEWS: readonly Interview[] = [
  { id: '087', time: '09:00', group: '2조, AI솔루션팀', degree: '학사', major: '전자공학', job: 'R&D, AI 응용', award: '교내 AI 경진 대상 외 1건' },
  { id: '112', time: '09:30', group: '2조, 합동 (미래혁신)', degree: '박사', major: 'AI/ML', job: 'R&D, AI 플랫폼', award: '국제 학회 논문 2편' },
  { id: '134', time: '10:00', group: '2조, AI솔루션팀', degree: '학사', major: '컴퓨터공학', job: 'R&D, 로보틱스 SW', award: '로봇 경진 입상' },
]

const CRITERIA = ['직무 역량', '문제 해결', '커뮤니케이션', '조직 적합', '종합'] as const
const POINTS = [1, 2, 3, 4, 5] as const
const RECOS = ['적극 추천', '추천', '보류', '비추천'] as const

const OFFLINE = '로컬 Qwen 모델에 연결하지 못했습니다. Ollama 실행 여부를 확인해 주세요.'

const DRAFT_SYSTEM = [
  '너는 면접관을 돕는 보조다.',
  '아래 지원자 정보(전공, 학력, 지원 직무)만 근거로 직무면접 질문 5개를 만든다.',
  '번호를 붙인 목록으로 쓰고, 각 질문은 한 문장으로 쓴다.',
  '질문은 지원자에게 직접 묻는 존댓말(예: "~해 주시겠습니까?", "~은 무엇입니까?")로 쓴다.',
  '개인 신상에 관한 질문은 하지 않는다.',
].join(' ')

type Scores = Partial<Record<(typeof CRITERIA)[number], number>>
type Saved = { scores: Scores; reco: string; mbti: string; note: string; savedAt: string }

const keyOf = (id: string) => `lite.eval.${id}`

const readEval = (id: string): Saved | null => {
  try {
    const raw = localStorage.getItem(keyOf(id))
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}

const writeEval = (id: string, value: Saved): boolean => {
  try {
    localStorage.setItem(keyOf(id), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const hhmm = (iso: string): string => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

const ACCESS = 'Webex 2조 상설룸 https://webex.example/demo-2jo, 접속코드 2026'

/** 클립보드 API 가 막힌 브라우저에서도 복사가 되도록 예전 방식으로 한 번 더 시도한다. */
const copyText = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // 아래 대체 경로로 넘어간다
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const done = document.execCommand('copy')
    document.body.removeChild(area)
    return done
  } catch {
    return false
  }
}

type WorkspacePageProps = {
  readonly onNotify?: (text: string) => void
}

export function WorkspacePage({ onNotify }: WorkspacePageProps = {}) {
  const [picked, setPicked] = useState(INTERVIEWS[0].id)
  const [scores, setScores] = useState<Scores>({})
  const [reco, setReco] = useState('')
  const [mbti, setMbti] = useState('')
  const [note, setNote] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [drafting, setDrafting] = useState(false)

  const interview = INTERVIEWS.find(each => each.id === picked) ?? INTERVIEWS[0]

  // 지원자를 바꾸면 그 지원자의 저장분을 불러온다. SSR 에는 효과가 돌지 않아 빈 값이 그대로 나온다.
  useEffect(() => {
    const stored = readEval(picked)
    setScores(stored?.scores ?? {})
    setReco(stored?.reco ?? '')
    setMbti(stored?.mbti ?? '')
    setNote(stored?.note ?? '')
    setSavedAt(stored?.savedAt ?? '')
  }, [picked])

  const toggleScore = (label: (typeof CRITERIA)[number], point: number) => {
    setScores(current => ({ ...current, [label]: current[label] === point ? undefined : point }))
  }

  const save = () => {
    const at = new Date().toISOString()
    if (writeEval(picked, { scores, reco, mbti, note, savedAt: at })) setSavedAt(at)
  }

  const generate = async () => {
    if (drafting) return
    setDrafting(true)
    try {
      const asked = `전공: ${interview.major}\n학력: ${interview.degree}\n지원 직무: ${interview.job}`
      const reply = await ollamaChat([
        { role: 'system', content: DRAFT_SYSTEM },
        { role: 'user', content: asked },
      ])
      setDrafts(current => ({ ...current, [interview.id]: reply || OFFLINE }))
    } catch {
      setDrafts(current => ({ ...current, [interview.id]: OFFLINE }))
    } finally {
      setDrafting(false)
    }
  }

  const copyAccess = async () => {
    const done = await copyText(ACCESS)
    onNotify?.(done ? '접속 정보를 복사했습니다.' : `접속 정보입니다. ${ACCESS}`)
  }

  const draft = drafts[interview.id]

  return (
    <div className="demo-page">
      <h1>면접 진행 워크스페이스</h1>
      <p className="caption">오늘 맡은 면접을 고르면 지원자 정보, 질문 초안, 노트, 평가가 한 화면에 열립니다.</p>

      <div className="ws">
        <div>
          <div className="wslabel">오늘의 면접 3건</div>
          {INTERVIEWS.map(each => (
            <button
              className="mtg"
              type="button"
              key={each.id}
              aria-current={each.id === picked ? 'true' : undefined}
              onClick={() => setPicked(each.id)}
            >
              <b>{each.time} 지원자 {each.id}</b>
              <span>{each.group}</span>
            </button>
          ))}
        </div>

        <div>
          <div className="panel">
            <div className="head">
              <h2>지원자 {interview.id}</h2>
              <div className="row">
                <span className="chip">{interview.degree}</span>
                <button className="btn sm" type="button" onClick={() => { void copyAccess() }}>접속 정보 복사</button>
                <button
                  className="btn sm pri"
                  type="button"
                  onClick={() => onNotify?.('면접방 연결은 생략합니다. 본 제품에서 Webex 로 입장합니다.')}
                >면접방 입장</button>
              </div>
            </div>
            <dl className="info">
              <dt>전공</dt><dd>{interview.major}</dd>
              <dt>지원 직무</dt><dd>{interview.job}</dd>
              <dt>수상, 자격</dt><dd>{interview.award}</dd>
            </dl>
            <p className="more">생년월일, 성별, 국적, 병역, 학점, 어학은 이 화면에 표시하지 않습니다.</p>
          </div>

          <div className="panel">
            <div className="head">
              <h2>질문 초안</h2>
              <button className="btn sm" type="button" disabled={drafting} onClick={generate}>
                {drafting ? '생성 중…' : '초안 생성'}
              </button>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--muted)', margin: 0 }}>전공, 학력, 지원 직무만 사용해 생성합니다.</p>
            {draft && <div className="ws-draft">{draft}</div>}
          </div>

          <div className="panel">
            <div className="head"><h2>평가와 면접 노트</h2><span className="sub">5개 기준, 5점 척도, 기본값 없음</span></div>
            {CRITERIA.map(label => (
              <div className="score" key={label}>
                <span className="lbl">{label}</span>
                <span className="pts">
                  {POINTS.map(point => (
                    <button
                      className={scores[label] === point ? 'pt on' : 'pt'}
                      type="button"
                      key={point}
                      aria-label={`${label} ${point}점`}
                      aria-pressed={scores[label] === point}
                      onClick={() => toggleScore(label, point)}
                    >{point}</button>
                  ))}
                </span>
              </div>
            ))}
            <div className="row" style={{ marginTop: '12px' }}>
              <div className="field">
                <label htmlFor="ws-reco">추천</label>
                <select id="ws-reco" style={{ width: '100px' }} value={reco} onChange={event => setReco(event.target.value)}>
                  <option value="">선택</option>
                  {RECOS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ws-mbti">MBTI</label>
                <input id="ws-mbti" placeholder="예: INFP" style={{ width: '80px' }} value={mbti} onChange={event => setMbti(event.target.value)} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <input
                  placeholder="면접 노트, 코멘트"
                  aria-label="면접 노트"
                  style={{ width: '100%' }}
                  value={note}
                  onChange={event => setNote(event.target.value)}
                />
              </div>
              <button className="btn sm pri" type="button" onClick={save}>저장</button>
              {savedAt && <span className="chip">저장됨 {hhmm(savedAt)}</span>}
            </div>
            <p className="more">MBTI는 지원서로 수집하지 않으므로 면접에서 확인한 경우에만 노트에 기록합니다.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
