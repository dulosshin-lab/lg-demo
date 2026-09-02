/* 한글 조사 — 「온타래이(가)」 같은 문장이 나오지 않게.

   담당자 요청은 「워딩만 조금 AI스럽지 않게」였다(미팅 49:23).
   이름이 값으로 들어오는 문장에서 조사를 괄호로 둘러 도망가면 딱 그 느낌이 난다. */

const FIRST = 0xac00
const LAST = 0xd7a3

/** 마지막 글자에 받침이 있나. 한글이 아니면 null(판단 못 함). */
export function hasFinal(word: string): boolean | null {
  const last = word.trim().slice(-1)
  if (!last) return null
  const code = last.charCodeAt(0)
  if (code < FIRST || code > LAST) return null
  return (code - FIRST) % 28 !== 0
}

/** 받침에 따라 조사를 고른다. 한글이 아니면 받침 없는 쪽을 쓴다. */
export function particle(word: string, withFinal: string, withoutFinal: string): string {
  return hasFinal(word) ? withFinal : withoutFinal
}

/* 자주 쓰는 것들 — 부르는 쪽이 읽기 쉽게 이름을 붙여 둔다 */
export const iGa = (w: string) => particle(w, '이', '가')
export const eunNeun = (w: string) => particle(w, '은', '는')
export const eulReul = (w: string) => particle(w, '을', '를')
export const gwaWa = (w: string) => particle(w, '과', '와')

/** 「온타래가」처럼 이름과 조사를 붙여 준다 */
export const withIGa = (w: string) => `${w}${iGa(w)}`
export const withEunNeun = (w: string) => `${w}${eunNeun(w)}`
export const withEulReul = (w: string) => `${w}${eulReul(w)}`
