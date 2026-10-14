// cannedContentBlocks.ts — 빠른답변 서식 본문 저장 검증(서버 전용)
// 화면이 보낸 content_blocks를 고객 화면용 허용 목록으로 정화하고, content(순수 텍스트)는 그 파생값으로 서버가 직접 만든다
// (화면이 보낸 content는 서식 본문이 있을 때 신뢰하지 않는다 — 채팅·검색이 읽는 텍스트와 서식 본문이 어긋나는 것 방지).
import { sanitizeContentBlocks } from '$lib/server/sanitizeContentHtml'
import { blocksToPlainText } from '$lib/utils/cannedBlocks'
import type { ContentBlock } from '$lib/types/content-editor'

/** 서식 본문 JSON 크기 상한(문자 수) — 이미지는 주소만 담기므로 충분히 넉넉한 값 */
const MAX_BLOCKS_JSON = 200_000

export type ResolvedCannedBlocks =
  | { ok: true; blocks: ContentBlock[] | null; content: string | null }
  | { ok: false; error: string }

/**
 * - raw가 undefined → 서식 본문 변경 없음({ blocks: null, content: null })
 * - raw가 null 또는 빈 배열 → 서식 본문 해제(blocks=null, content는 호출자가 넘긴 값 사용)
 * - raw가 배열 → 정화 후 검증, content는 blocks의 텍스트 파생값
 */
export function resolveCannedBlocks(raw: unknown): ResolvedCannedBlocks | { ok: true; unchanged: true } {
  if (raw === undefined) return { ok: true, unchanged: true }
  if (raw === null || (Array.isArray(raw) && raw.length === 0)) return { ok: true, blocks: null, content: null }
  if (!Array.isArray(raw)) return { ok: false, error: '서식 본문 형식이 올바르지 않습니다.' }
  const blocks = sanitizeContentBlocks(raw)
  if (JSON.stringify(blocks).length > MAX_BLOCKS_JSON) return { ok: false, error: '내용이 너무 깁니다. 이미지·표를 줄여주세요.' }
  const content = blocksToPlainText(blocks)
  if (!content) return { ok: false, error: '글자 내용을 입력해주세요. (이미지·동영상만으로는 채팅 답변을 보낼 수 없습니다.)' }
  return { ok: true, blocks, content }
}
