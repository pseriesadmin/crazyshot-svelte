// '팀 정책' 저장 전 정리 — 문서 편집기가 남기는 앞뒤 빈 문단을 지우고, 내용이 전혀 없으면 빈 배열로 만든다 (2026-10-24)
import type { ContentBlock } from '$lib/types/content-editor'

function isEmptyText(b: ContentBlock): boolean {
  if (b.type !== 'text') return false
  const plain = b.html.replace(/<br\s*\/?>/gi, '').replace(/<\/?[a-z][^>]*>/gi, '').replace(/&nbsp;/gi, ' ').trim()
  return plain === ''
}

export function trimEmptyBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const filled = blocks.map((b, i) => (isEmptyText(b) ? -1 : i)).filter((i) => i >= 0)
  if (filled.length === 0) return []
  return blocks.slice(filled[0], filled[filled.length - 1] + 1)
}

/**
 * 서버에서 '팀 정책' 값이 다시 내려왔을 때 편집기를 어떻게 할지 판단한다.
 * 같은 화면의 다른 저장(동의문 추가 등)도 화면 데이터를 다시 불러오므로, 서버 값이 그대로이거나 쓰던 내용(미저장)이 있으면
 * 편집기를 다시 만들지 않는다 — 다시 만들면 입력 중이던 내용이 사라진다.
 */
export function nextTeamEditorSync(applied: string, incoming: string, dirty: boolean): { action: 'keep' | 'reset'; applied: string } {
  if (incoming === applied) return { action: 'keep', applied }
  if (dirty) return { action: 'keep', applied: incoming }
  return { action: 'reset', applied: incoming }
}
