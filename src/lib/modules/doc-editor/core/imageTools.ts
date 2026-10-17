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

/** 화면에서 실제로 보이는 세로 범위 — 위는 sticky 서식 도구줄 아래, 아래는 화면 끝 */
export function visibleBandOf(stickyBottom: number, innerHeight: number): VisibleBand {
  return { visTop: Math.max(stickyBottom + 8, 0), visBottom: innerHeight - 8 }
}

export const IMAGE_BAR_HEIGHT = 48

/** 선택 도구줄 위치: 대상 위 → 아래 → (화면을 가득 채우면) 보이는 영역 맨 위 안쪽 순으로 닿을 수 있는 곳 */
export function barPlacementOf(r: { top: number; bottom: number }, band: VisibleBand, barH = IMAGE_BAR_HEIGHT): { topV: number; inside: boolean } {
  const above = r.top - barH - 4
  const below = r.bottom + 12
  if (above >= band.visTop) return { topV: above, inside: false }
  if (below + barH <= band.visBottom) return { topV: below, inside: false }
  return { topV: Math.max(band.visTop, r.top) + 8, inside: true }
}

/** 손잡이 세로 위치(화면 기준). 대상이 보이는 영역 밖이면 null — 높은 묶음도 닿을 수 있게 보이는 영역 안으로 당긴다 */
export function handleSpanOf(r: { top: number; bottom: number }, band: VisibleBand, barH = IMAGE_BAR_HEIGHT): { yTop: number; yBottom: number } | null {
  if (r.bottom < band.visTop || r.top > band.visBottom) return null
  const bar = barPlacementOf(r, band, barH)
  const topLimit = bar.inside ? bar.topV + barH + 14 : band.visTop + 14
  const yTop = Math.max(r.top, topLimit)
  const yBottom = Math.max(Math.min(r.bottom, band.visBottom - 14), yTop + 24)
  return { yTop, yBottom }
}

/**
 * 손잡이 가로 위치(화면 기준). 폭 100% 묶음처럼 모서리가 화면 가장자리·밖(가로 스크롤된 페이지)에 걸려도 잡을 수 있게
 * 보이는 가로 범위 안(margin)으로 당긴다. 두 점 사이는 최소 24px을 유지한다.
 */
export function handleSpanXOf(r: { left: number; right: number }, viewportWidth: number, margin = 14): { xL: number; xR: number } {
  const lo = margin
  const hi = Math.max(viewportWidth - margin, lo + 24)
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
