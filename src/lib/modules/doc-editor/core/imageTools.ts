/**
 * imageTools.ts — 이미지 도구 공통 순수 로직 (이식형 모듈 core, 프로젝트 비종속)
 *
 * 계약서 편집기(DocEditor)와 상품설명 편집기(RichContentEditor)가 같은 규칙을 한 곳에서 쓰도록 모은다.
 * 화면 그리기(DOM·Svelte 상태)는 각 편집기가 맡고, 여기에는 "계산"만 둔다 — 단위(% / px)·저장 방식은 편집기마다 다르다.
 *   · 손잡이 모서리 정의, 정렬별 허용 모서리
 *   · 끌기 거리 계산(정렬 기준)
 *   · 화면 보이는 영역 안에서의 도구줄·손잡이 위치
 *   · 손잡이 표시 선호 저장(localStorage, 실패해도 동작)
 */

export type ImageAlignKey = 'left' | 'center' | 'right'

export interface ResizeCorner {
  id: 'nw' | 'ne' | 'sw' | 'se'
  side: 'l' | 'r'
  cx: 0 | 1
  cy: 0 | 1
  cursor: 'nwse-resize' | 'nesw-resize'
}

export const IMAGE_RESIZE_CORNERS: readonly ResizeCorner[] = [
  { id: 'nw', side: 'l', cx: 0, cy: 0, cursor: 'nwse-resize' },
  { id: 'ne', side: 'r', cx: 1, cy: 0, cursor: 'nesw-resize' },
  { id: 'sw', side: 'l', cx: 0, cy: 1, cursor: 'nesw-resize' },
  { id: 'se', side: 'r', cx: 1, cy: 1, cursor: 'nwse-resize' },
]

/** 정렬에 맞는 손잡이 쪽: 가운데=양쪽(중심 기준 대칭), 왼쪽=오른쪽 모서리, 오른쪽=왼쪽 모서리. 겹치기(overlay)는 오른쪽만 */
export function allowedHandleSide(side: 'l' | 'r', align: ImageAlignKey, overlay = false): boolean {
  if (overlay) return side === 'r'
  return align === 'center' ? true : align === 'left' ? side === 'r' : side === 'l'
}

/** 끄는 위치로 구한 이미지 가로 길이(rect와 같은 화면 px). 호출자가 기준(폭 100%의 px 또는 확대 배율)으로 나눠 단위를 맞춘다 */
export function pointerExtent(align: ImageAlignKey, overlay: boolean, clientX: number, rect: { left: number; right: number; width: number }): number {
  if (!overlay && align === 'center') return 2 * Math.abs(clientX - (rect.left + rect.width / 2))
  if (!overlay && align === 'right') return rect.right - clientX
  return clientX - rect.left
}

export interface VisibleBand { visTop: number; visBottom: number }

/** 화면 좌표 기준 사각 영역 */
export interface ClipBox { top: number; bottom: number; left: number; right: number }

/**
 * 여러 "잘라 보이는" 조상 영역(스크롤 상자 등)의 교집합. 크기가 0인 영역은 의미 없는 값(레이아웃 없는 환경)이라 무시한다.
 * 겹치는 부분이 없으면 비어 있는 상자(top>=bottom)를 돌려준다.
 */
export function intersectClipBoxes(boxes: ClipBox[]): ClipBox | null {
  const real = boxes.filter((b) => b.bottom - b.top > 0 && b.right - b.left > 0)
  if (real.length === 0) return null
  return real.reduce((a, b) => ({
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom),
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
  }))
}

/**
 * 화면에서 실제로 보이는 세로 범위 — 위는 sticky 서식 도구줄 아래, 아래는 화면 끝.
 * clip(편집기를 감싼 스크롤 상자들의 보이는 영역)이 있으면 그 안으로 더 좁힌다 — 점·도구줄이 스크롤 상자 밖(화면 아래 푸터 위 등)에 놓여 가려지는 것을 막는다.
 */
export function visibleBandOf(stickyBottom: number, innerHeight: number, clip?: ClipBox | null): VisibleBand {
  const top = Math.max(stickyBottom + 8, 0, clip ? clip.top + 8 : 0)
  const bottom = Math.min(innerHeight - 8, clip ? clip.bottom - 8 : Infinity)
  return { visTop: top, visBottom: bottom }
}

export const IMAGE_BAR_HEIGHT = 48
/** 크기 조절 점의 한 변(px) — CSS .rc-resize 와 같은 값 */
export const HANDLE_SIZE = 14
/** 점과 도구줄 사이 최소 간격(점 절반 + 여유) — 도구줄이 점을 가리지 않게 */
const HANDLE_CLEAR = HANDLE_SIZE / 2 + 8

/**
 * 선택 도구줄 위치(점을 가리지 않는 곳). 우선순위:
 *  ① 이미지 위쪽 바깥(위쪽 점 위) → ② 이미지 아래쪽 바깥(아래쪽 점 아래) → ③ 이미지가 화면을 가득 채우면 이미지 안쪽, 위쪽 점 바로 아래
 * 작은 이미지는 ①·②로 점과 겹치지 않고, 큰 이미지만 ③으로 안쪽에 놓이되 위쪽 점 아래에 놓인다.
 */
export function barPlacementOf(r: { top: number; bottom: number }, band: VisibleBand, barH = IMAGE_BAR_HEIGHT): { topV: number; inside: boolean } {
  // 점이 실제로 놓이는 위치(보이는 영역 안으로 당겨진 값)를 기준으로 간격을 둔다 — 이미지가 거의 화면 밖이어도 점을 가리지 않게
  const span = handleSpanOf(r, band)
  const topPoint = span ? span.yTop : r.top
  const bottomPoint = span ? span.yBottom : r.bottom
  const above = topPoint - barH - HANDLE_CLEAR
  const below = bottomPoint + HANDLE_CLEAR
  if (above >= band.visTop) return { topV: above, inside: false }
  if (below + barH <= band.visBottom) return { topV: below, inside: false }
  return { topV: topPoint + HANDLE_CLEAR, inside: true }
}

/**
 * 크기 조절 점의 세로 위치(화면 기준) — 이미지의 실제 모서리(위·아래)에 놓고, 보이는 영역 밖으로 나가는 경우만 영역 안으로 당긴다.
 * 도구줄 위치와 무관하다(도구줄이 점을 피해 놓이므로 점을 도구줄 때문에 밀지 않는다). 대상이 보이는 영역 밖이면 null.
 */
export function handleSpanOf(r: { top: number; bottom: number }, band: VisibleBand, _barH = IMAGE_BAR_HEIGHT): { yTop: number; yBottom: number } | null {
  void _barH
  if (r.bottom < band.visTop || r.top > band.visBottom) return null
  const yTop = Math.max(r.top, band.visTop + HANDLE_SIZE)
  const yBottom = Math.max(Math.min(r.bottom, band.visBottom - HANDLE_SIZE), yTop + 24)
  return { yTop, yBottom }
}

/**
 * 선택 도구줄의 가로 위치(화면 기준 왼쪽 끝). 기본은 대상(이미지·표) 왼쪽 끝에 맞추되, 오른쪽 정렬한 작은 이미지처럼 대상이 오른쪽에 있어
 * 도구줄(폭이 큼)이 보이는 영역 오른쪽을 넘으면 그만큼 왼쪽으로 당긴다. 보이는 영역보다 도구줄이 더 넓으면 왼쪽 끝을 우선 보이게 한다.
 * bounds는 창과 스크롤 상자(clip)의 교집합 가로 범위.
 */
export function barLeftOf(anchorLeft: number, barWidth: number, bounds: { left: number; right: number }, margin = 8): number {
  const maxLeft = bounds.right - margin - barWidth
  return Math.max(Math.min(anchorLeft, maxLeft), bounds.left + margin)
}

/**
 * 손잡이 가로 위치(화면 기준). 폭 100% 묶음처럼 모서리가 화면 가장자리·밖(가로 스크롤된 페이지)에 걸려도 잡을 수 있게
 * 보이는 가로 범위 안(margin)으로 당긴다. 두 점 사이는 최소 24px을 유지한다.
 */
export function handleSpanXOf(r: { left: number; right: number }, viewportWidth: number, margin = 14, clip?: ClipBox | null): { xL: number; xR: number } {
  const lo = Math.max(margin, clip ? clip.left + margin : 0)
  const hi = Math.max(Math.min(viewportWidth - margin, clip ? clip.right - margin : Infinity), lo + 24)
  const xL = Math.min(Math.max(r.left, lo), hi - 24)
  const xR = Math.max(Math.min(r.right, hi), xL + 24)
  return { xL, xR }
}

/** 손잡이 표시 선호(기본 표시). 저장소를 못 써도(사생활 보호 모드 등) 예외 없이 동작 */
export function createHandlePref(key: string): { read: () => boolean; write: (on: boolean) => void } {
  return {
    read() {
      try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'off') return false
      } catch { /* 저장소 접근 불가 → 기본값(표시) */ }
      return true
    },
    write(on: boolean) {
      try { localStorage.setItem(key, on ? 'on' : 'off') } catch { /* 저장 불가여도 이번 화면에서는 동작 */ }
    },
  }
}
