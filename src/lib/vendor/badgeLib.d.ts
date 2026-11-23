// badgeLib.js(크레이지샷 배지 편집기 v1.0 원본) 타입 선언

export interface BadgeEditorParams {
  tpl: string
  small: string
  main: string
  sub: string
  /** 본체 색 */
  c1: string
  /** 테두리·포인트 색 */
  c2: string
  /** 메인 글자색 */
  tc: string
  scale: number
  /** 그림자·그라데이션(플랫 계열 모양만 영향) */
  fx?: boolean
  sm?: number
  mm?: number
  sb?: number
  dx?: number
  dy?: number
  tr?: number
}

export interface BadgeBuildOptions {
  id?: string
  scale?: number
  fontCss?: string
}

export interface BadgeLibApi {
  TPL: Record<string, { name: string }>
  build: (p: BadgeEditorParams, o?: BadgeBuildOptions) => string
  DEFAULTS: { key: string; v: BadgeEditorParams }[]
  FONT: string
}

export const BadgeLib: BadgeLibApi
