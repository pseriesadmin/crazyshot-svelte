/**
 * pdfViewerLogic.ts — 자체 PDF 뷰어(PdfViewer.svelte)의 순수 계산 로직
 *
 * 화면(캔버스·스크롤)과 분리해 테스트할 수 있도록 DOM·pdf.js에 의존하지 않는 함수만 둔다.
 * 용어: zoom = 화면 표시 배율(1 = 100%, 브라우저 PDF 뷰어와 같은 96dpi 기준), pdfScale = pdf.js 렌더 배율(zoom × 1.333).
 */

/** PDF 1pt가 화면 100%에서 차지하는 CSS px (96dpi / 72pt) */
export const CSS_PX_PER_PT = 96 / 72

/** 확대·축소 버튼이 이동하는 단계 — 50% ~ 300% */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const

const MIN_ZOOM = ZOOM_STEPS[0]
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]
const EPS = 1e-6

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** 현재 배율에서 한 단계 확대/축소. 단계 사이 값(가로 맞춤 등)에서는 가장 가까운 다음·이전 단계로 이동한다. */
export function stepZoom(zoom: number, direction: 'in' | 'out'): number {
  if (direction === 'in') {
    const next = ZOOM_STEPS.find((z) => z > zoom + EPS)
    return next ?? MAX_ZOOM
  }
  const prev = [...ZOOM_STEPS].reverse().find((z) => z < zoom - EPS)
  return prev ?? MIN_ZOOM
}

/** 가로 맞춤 배율 — 영역 너비에서 좌우 여백을 뺀 폭에 페이지 폭(pt)을 맞춘다. 측정 전(0)이면 100%. */
export function fitWidthZoom(containerWidthPx: number, pageWidthPt: number, paddingPerSidePx: number): number {
  if (containerWidthPx <= 0 || pageWidthPt <= 0) return 1
  return clampZoom((containerWidthPx - paddingPerSidePx * 2) / (pageWidthPt * CSS_PX_PER_PT))
}

export function toDisplayPercent(zoom: number): number {
  return Math.round(zoom * 100)
}

/** pdf.js getViewport({ scale })에 넘길 값 */
export function pdfScale(zoom: number): number {
  return zoom * CSS_PX_PER_PT
}

export interface PageBox {
  top: number
  height: number
}

/**
 * 스크롤 위치에서 "현재 쪽" 판정 — 뷰포트 세로 중앙선이 걸친 쪽. 쪽 사이 간격이면 더 가까운 쪽(같으면 앞 쪽).
 * pages의 top은 스크롤 컨텐츠 기준 좌표다.
 */
export function currentPageFromScroll(pages: PageBox[], scrollTop: number, viewportHeight: number): number {
  if (pages.length === 0) return 1
  const center = scrollTop + viewportHeight / 2
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < pages.length; i++) {
    const { top, height } = pages[i]
    const distance = center < top ? top - center : center > top + height ? center - (top + height) : 0
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  }
  return best + 1
}

export function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/** 쪽 번호 입력값 → 1~total로 고정. 숫자가 아니면 null(입력을 되돌린다). */
export function clampPage(input: string, total: number): number | null {
  const n = Number.parseInt(input, 10)
  if (!Number.isFinite(n)) return null
  return Math.min(Math.max(n, 1), Math.max(total, 1))
}

/** 썸네일 렌더 배율 — 목표 너비(CSS px)에 페이지 폭(pt)을 맞춘다. 폭을 모르면 0.2. */
export function thumbnailScale(pageWidthPt: number, targetWidthPx: number): number {
  if (pageWidthPt <= 0) return 0.2
  return targetWidthPx / pageWidthPt
}

/** 서버가 사용자에게 보여 줘도 되는 안내 문구를 JSON `error`로 주는 응답 상태 — 이 상태에서만 그 문구를 그대로 쓴다(그 외 500 등 내부 오류 문구는 노출하지 않는다) */
export const SERVER_MESSAGE_STATUSES = [409, 422, 429] as const
const MAX_SERVER_MESSAGE_CHARS = 200

/** PDF를 가져오는 응답이 실패했을 때 화면에 보여 줄 문구 */
export function pickLoadErrorMessage(status: number, serverError: unknown): string {
  if (status === 401 || status === 403) return '로그인이 필요해요. 다시 로그인한 뒤 열어 주세요.'
  if (status === 404) return '계약서 사본(PDF)을 준비 중이에요. 잠시 후 다시 열어 주세요.'
  if ((SERVER_MESSAGE_STATUSES as readonly number[]).includes(status) && typeof serverError === 'string') {
    const msg = serverError.trim()
    if (msg.length > 0 && msg.length <= MAX_SERVER_MESSAGE_CHARS) return msg
  }
  return '계약서를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
}

/** iOS(아이폰·아이패드, 데스크톱 모드 아이패드 포함) — 숨은 iframe 인쇄가 불안정해 새 탭으로 대체한다. */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}
