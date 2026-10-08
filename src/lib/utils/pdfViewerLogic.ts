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

/** iOS(아이폰·아이패드, 데스크톱 모드 아이패드 포함) — 숨은 iframe 인쇄가 불안정해 새 탭으로 대체한다. */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}
