import { useEffect, useState, type FormEvent } from 'react'
import { MessageCircle, X, Send } from 'lucide-react'
import { buildContext } from './chatContext'
import { OLLAMA_TAGS, ollamaChat } from './ollama'
import type { LiteRoster, LiteSchedule } from './data'

const PROBE_MS = 1500

const SYSTEM = [
  '너는 면접 AX 데모 화면을 함께 보는 도우미다.',
  '아래에 지금 사용자가 보고 있는 화면의 내용이 그대로 주어진다.',
  '질문에는 그 화면 데이터를 근거로 간결한 한국어로 답한다.',
  '화면 데이터에 없는 값은 절대 지어내지 말고, 모르면 모른다고 말한 뒤 어느 화면에서 확인하면 되는지 알려 준다.',
].join(' ')

const OFFLINE = '로컬 Qwen 모델에 연결하지 못했습니다. Ollama 실행 여부를 확인해 주세요.'

type Msg = { readonly role: 'user' | 'assistant'; readonly content: string }

type ChatBotProps = {
  readonly role: string
  readonly page: string
  readonly roster: LiteRoster | null
  readonly schedule: LiteSchedule | null
}

export function ChatBot({ role, page, roster, schedule }: ChatBotProps) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<readonly Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // Ollama 가 없는 시연 장비에서는 버튼째 감춘다. SSR 에는 효과가 돌지 않아 기본값(있음)이 그대로 나온다.
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), PROBE_MS)
    fetch(OLLAMA_TAGS, { signal: abort.signal })
      .then(response => { if (!response.ok) setAvailable(false) })
      .catch(() => setAvailable(false))
      .finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); abort.abort() }
  }, [])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const asked = text.trim()
    if (!asked || busy) return
    const history = [...msgs, { role: 'user', content: asked } as const]
    setMsgs(history)
    setText('')
    setBusy(true)
    try {
      const system = `${SYSTEM}\n\n${buildContext({ role, page, roster, schedule })}`
      const reply = await ollamaChat([{ role: 'system', content: system }, ...history])
      setMsgs([...history, { role: 'assistant', content: reply || OFFLINE }])
    } catch {
      setMsgs([...history, { role: 'assistant', content: OFFLINE }])
    } finally {
      setBusy(false)
    }
  }

  if (!available) return null

  return (
    <>
      {open && (
        <div className="chatpanel">
          <div className="hd">
            <span>도움말 챗봇<small className="chat-chip">Qwen3 8B · 로컬</small></span>
            <button type="button" aria-label="닫기" onClick={() => setOpen(false)}><X size={15} /></button>
          </div>
          <div className="msgs">
            {msgs.length === 0 && <div className="bubble a">이 화면에 대해 물어보세요. 예: 지금 화면에서 미배정은 몇 명인가요?</div>}
            {msgs.map((msg, index) => (
              <div className={msg.role === 'user' ? 'bubble q' : 'bubble a'} key={index}>{msg.content}</div>
            ))}
            {busy && <div className="bubble a">…</div>}
          </div>
          <form className="in" onSubmit={send}>
            <input
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder="이 화면의 데이터에 대해 물어보세요"
              aria-label="질문"
            />
            <button className="chat-send" type="submit" disabled={busy} aria-label="보내기"><Send size={14} />보내기</button>
          </form>
        </div>
      )}
      <div className="fab">
        <button className="chatfab" type="button" aria-label="도움말 챗봇" onClick={() => setOpen(value => !value)}>
          <MessageCircle size={22} />
        </button>
      </div>
    </>
  )
}
