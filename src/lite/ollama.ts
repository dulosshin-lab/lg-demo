/** 라이트 데모가 쓰는 로컬 Ollama 호출을 한 곳에 모았다. 외부 전송이 없다. */

export const OLLAMA_URL = 'http://localhost:11434/api/chat'
export const OLLAMA_TAGS = 'http://localhost:11434/api/tags'
export const MODEL = 'qwen3:8b'

/** qwen3 는 think:false 를 줘도 가끔 사고 블록을 흘린다 — 보여 주기 전에 지운다. */
const strip = (content: string): string => content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

export type OllamaMessage = { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }

export async function ollamaChat(messages: readonly OllamaMessage[]): Promise<string> {
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      think: false,
      options: { num_ctx: 16384 },
    }),
  })
  if (!response.ok) throw new Error(`ollama ${response.status}`)
  const data = await response.json()
  return strip(data?.message?.content ?? '')
}
