/* 편성표를 그림 한 장으로.

   화면을 캡처하지 않고 canvas 에 직접 그린다. 그래야
   - 스크롤 밖에 있는 날짜까지 **전 일자**가 한 장에 들어가고,
   - 사이드바·업로드 패널 같은 화면 껍데기가 섞이지 않으며(담당자 요청: 편성표만),
   - 화면 크기·확대율과 무관하게 같은 그림이 나온다.

   폰트는 public/fonts 의 Noto Sans KR 을 쓴다. 문서에 이미 실려 있으므로
   document.fonts.ready 를 기다린 뒤 그리면 한글이 깨지지 않는다. */
import type { Placed, Result } from '@/core/schedule'
import type { EditState } from './edit'
import type { Finding } from './violations'

const FONT = '"Noto Sans KR", -apple-system, BlinkMacSystemFont, sans-serif'

/* 지면 규격 — 화면 CSS 와 따로 둔다. 그림은 인쇄·메신저 공유가 목적이라 조금 더 크다. */
const PAD = 28
const TIME_W = 74
const CELL_W = 236
const CELL_H = 66
const HEAD_H = 30
const DAY_GAP = 26
const TITLE_H = 62

const INK = '#1b1b1b'
const MUTED = '#7a7a7a'
const LINE = '#e3e3e3'
const SOFT = '#f6f6f6'
const LG = '#a50034'          // LG 레드 — 화면과 같은 값
const ALERT_BG = '#fff1f5'

export type ImageOptions = {
  /** 이 날짜만 그린다. 비우면 전 일자 */
  readonly day?: number
  readonly title?: string
  /** 카드에 표식을 함께 그릴지 */
  readonly marks?: boolean
}

const markKindOf = (list: readonly Finding[]): 'alert' | 'new-notice' | 'base-notice' | null => {
  if (!list.length) return null
  if (list.some(f => f.severity === 'alert')) return 'alert'
  return list.some(f => !f.sinceBase) ? 'new-notice' : 'base-notice'
}

/** 좌표별 표식 — 화면의 marksBySpot 과 같은 규칙 */
export function marksBySpot(findings: readonly Finding[], placed: readonly Placed[]): Map<string, Finding[]> {
  const m = new Map<string, Finding[]>()
  for (const f of findings) {
    if (f.day === undefined || f.slot === undefined) continue
    for (const p of placed) {
      if (p.day !== f.day || p.slot !== f.slot) continue
      if (f.appId !== undefined && p.app.id !== f.appId) continue
      if (f.team && !p.teams.includes(f.team)) continue
      const k = `${p.day}|${p.slot}|${p.room}`
      const list = m.get(k)
      if (list) list.push(f)
      else m.set(k, [f])
    }
  }
  return m
}

/** 폭을 넘는 글자는 끝을 …로 줄인다 */
function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1)
  return `${cut}…`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function planImage(base: Result, opts: ImageOptions = {}) {
  const days = opts.day === undefined ? base.dates.map((_, i) => i) : [opts.day]
  const rooms = base.cfg.rooms
  const width = PAD * 2 + TIME_W + CELL_W * rooms
  const dayH = HEAD_H + 26 + base.times.length * CELL_H
  const height = PAD * 2 + TITLE_H + days.length * dayH + (days.length - 1) * DAY_GAP
  return { days, rooms, width, height, dayH }
}

/** 편성표를 그린 캔버스를 만든다. 그리기만 하고 내려받지는 않는다(테스트에서도 쓴다). */
export function drawSchedule(
  canvas: HTMLCanvasElement,
  base: Result,
  state: EditState,
  findings: readonly Finding[],
  opts: ImageOptions = {},
): HTMLCanvasElement {
  const { days, rooms, width, height } = planImage(base, opts)
  const scale = Math.min(2, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)))
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('그림을 그릴 수 없습니다 (canvas 미지원)')
  ctx.scale(scale, scale)
  ctx.textBaseline = 'top'

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const grid = new Map(state.placed.map(p => [`${p.day}|${p.slot}|${p.room}`, p]))
  const marks = opts.marks === false ? new Map<string, Finding[]>() : marksBySpot(findings, state.placed)

  /* 머리글 */
  let y = PAD
  ctx.fillStyle = INK
  ctx.font = `700 20px ${FONT}`
  ctx.fillText(opts.title ?? '면접 일정 편성표', PAD, y)
  y += 27
  ctx.fillStyle = MUTED
  ctx.font = `400 12px ${FONT}`
  const stamp = new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
  ctx.fillText(
    `${base.cfg.sessions}세션 × ${rooms}조 · 배정 ${state.placed.length}명` +
    (state.unplaced.length ? ` · 미배정 ${state.unplaced.length}명` : '') +
    ` · ${stamp} 기준`,
    PAD, y,
  )
  y = PAD + TITLE_H

  for (const d of days) {
    const date = base.dates[d]
    ctx.fillStyle = INK
    ctx.font = `700 14px ${FONT}`
    ctx.fillText(`${d + 1}일차  ${date?.label ?? ''}`, PAD, y)
    y += 26

    /* 열 머리 */
    ctx.fillStyle = SOFT
    ctx.fillRect(PAD, y, TIME_W + CELL_W * rooms, HEAD_H)
    ctx.fillStyle = MUTED
    ctx.font = `500 12px ${FONT}`
    ctx.fillText('시간', PAD + 10, y + 9)
    for (let r = 0; r < rooms; r++) ctx.fillText(`${r + 1}조`, PAD + TIME_W + CELL_W * r + 12, y + 9)
    y += HEAD_H

    for (let slot = 0; slot < base.times.length; slot++) {
      const top = y + slot * CELL_H
      ctx.strokeStyle = LINE
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD, top + 0.5)
      ctx.lineTo(PAD + TIME_W + CELL_W * rooms, top + 0.5)
      ctx.stroke()

      ctx.fillStyle = MUTED
      ctx.font = `400 12px ${FONT}`
      ctx.fillText(base.times[slot].label.split('–')[0], PAD + 10, top + 12)

      for (let r = 0; r < rooms; r++) {
        const p = grid.get(`${d}|${slot}|${r}`)
        if (!p) continue
        const x = PAD + TIME_W + CELL_W * r
        const kind = markKindOf(marks.get(`${d}|${slot}|${r}`) ?? [])

        if (kind) {
          ctx.fillStyle = kind === 'alert' ? ALERT_BG : SOFT
          roundRect(ctx, x + 4, top + 4, CELL_W - 8, CELL_H - 8, 6)
          ctx.fill()
          ctx.strokeStyle = kind === 'alert' ? LG : LINE
          ctx.stroke()
        }

        ctx.fillStyle = INK
        ctx.font = `700 13px ${FONT}`
        ctx.fillText(clip(ctx, p.app.name, CELL_W - 34), x + 12, top + 11)

        ctx.fillStyle = MUTED
        ctx.font = `400 11px ${FONT}`
        ctx.fillText(clip(ctx, `${p.edu} · ${p.teams.join(' + ')}`, CELL_W - 22), x + 12, top + 30)
        ctx.fillText(clip(ctx, p.interviewers.join(' · '), CELL_W - 22), x + 12, top + 46)

        if (kind) {
          ctx.fillStyle = kind === 'alert' ? LG : kind === 'new-notice' ? INK : '#c9c9c9'
          ctx.font = `400 9px ${FONT}`
          ctx.fillText(kind === 'alert' ? '▲' : '●', x + CELL_W - 22, top + 12)
        }
      }
    }
    y += base.times.length * CELL_H + DAY_GAP
  }

  /* 세로 칸선 */
  ctx.strokeStyle = LINE
  let gy = PAD + TITLE_H
  for (let i = 0; i < days.length; i++) {
    const topOfGrid = gy + 26
    const bottom = topOfGrid + HEAD_H + base.times.length * CELL_H
    for (let r = 0; r <= rooms; r++) {
      const x = PAD + TIME_W + CELL_W * r + 0.5
      ctx.beginPath()
      ctx.moveTo(x, topOfGrid)
      ctx.lineTo(x, bottom)
      ctx.stroke()
    }
    ctx.strokeRect(PAD + 0.5, topOfGrid + 0.5, TIME_W + CELL_W * rooms, HEAD_H + base.times.length * CELL_H)
    gy += 26 + HEAD_H + base.times.length * CELL_H + DAY_GAP
  }
  return canvas
}

export function imageNameOf(at: Date = new Date(), day?: number): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const tail = day === undefined ? '전체' : `${day + 1}일차`
  return `면접편성_${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}_${tail}.png`
}

/** 그림을 내려받는다. 폰트가 실릴 때까지 기다렸다 그린다. */
export async function exportImage(
  base: Result, state: EditState, findings: readonly Finding[], opts: ImageOptions = {},
): Promise<string> {
  if (document.fonts?.ready) await document.fonts.ready
  const canvas = drawSchedule(document.createElement('canvas'), base, state, findings, opts)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('그림을 만들지 못했습니다')
  const name = imageNameOf(new Date(), opts.day)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}
