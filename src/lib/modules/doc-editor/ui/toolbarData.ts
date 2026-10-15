/**
 * toolbarData.ts — 툴바 선택지·보조 함수 (doc-editor ui, 호스트 비의존)
 *
 * 이관 원본: src/lib/components/editor/RichContentEditor.svelte 의 FONTS·SIZE_PRESETS·COLORS·EMOJI_LIST·normalizeUrl
 * (원본은 무변경 유지). 서체 목록 뒤의 3개(Verdana·Arial·Courier New)는 기존 계약서 편집기의 선택지로,
 * 이미 저장된 계약서 양식이 쓰고 있을 수 있어 그대로 보존한다.
 */

export interface FontOption {
  label: string
  value: string
}

export const FONTS: FontOption[] = [
  { label: '기본 서체', value: '' },
  { label: 'Noto Sans KR', value: "'Noto Sans KR', sans-serif" },
  { label: '맑은 고딕', value: "'Malgun Gothic', '맑은 고딕', sans-serif" },
  { label: '나눔고딕', value: "'NanumGothic', '나눔고딕', sans-serif" },
  { label: '나눔명조', value: "'NanumMyeongjo', '나눔명조', serif" },
  { label: '굴림', value: "'Gulim', '굴림', sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  // 기존 계약서 편집기 선택지(저장 호환)
  { label: 'Verdana', value: 'Verdana' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Courier New', value: 'Courier New' },
]

export const SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 28, 32]
export const DEFAULT_SIZE = 16

export const COLORS = [
  '#000000', '#444444', '#777777', '#aaaaaa', '#ffffff',
  '#cf0000', '#ff3535', '#ff4500', '#ff9800', '#ffc107',
  '#2e7d32', '#4caf50', '#00897b', '#0288d1', '#1565c0',
  '#3b2f8a', '#553fe0', '#8e24aa', '#d81b60', '#795548',
]

export const EMOJI_LIST = [
  '😀', '😂', '🥰', '😎', '🤔', '😭', '😡', '🥳',
  '👍', '👎', '👏', '🙏', '💪', '🤝', '✌️', '👋',
  '❤️', '💔', '💯', '🔥', '⭐', '✨', '🎉', '🎊',
  '📷', '🎬', '🎵', '🎮', '📚', '✏️', '💡', '🔑',
  '🌸', '🌊', '⛅', '🌙', '🌈', '🍕', '☕', '🍀',
]

/** 링크 주소 정규화 — 스킴이 없으면 https:// 를 붙이고, http(s)·mailto·tel 만 허용한다. */
export function normalizeUrl(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  return /^(https?:|mailto:|tel:)/i.test(withScheme) ? withScheme : null
}
