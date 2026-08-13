import type { ContentBlock } from '$lib/types/content-editor'
import type { TiptapDocBlock } from '$lib/types/contract-document'
import type { ContractSubstitutionData } from '$lib/types/contract-module'
import { substituteTiptapDoc } from '$lib/utils/tiptapRender'

function applySubstitution(text: string, data: ContractSubstitutionData): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim() as keyof ContractSubstitutionData
    return data[trimmed] ?? match
  })
}

/** content_blocks 배열에 포함될 수 있는 블록 타입 (레거시 + TipTap) */
export type AnyContentBlock = ContentBlock | TiptapDocBlock

/**
 * content_blocks 배열의 변수 치환.
 * - 레거시 ContentBlock(text/html): {{변수명}} 정규식 치환
 * - tiptap-doc 블록: mergeField 노드를 실제 값으로 치환 (substituteTiptapDoc 위임)
 * - 기타 블록(divider 등): 그대로 반환
 */
export function substituteVariables(
  blocks: AnyContentBlock[],
  data: ContractSubstitutionData
): AnyContentBlock[] {
  return blocks.map((block): AnyContentBlock => {
    if (block.type === 'tiptap-doc') {
      return { ...block, doc: substituteTiptapDoc(block.doc, data) }
    }
    if (block.type === 'text') {
      return { ...block, html: applySubstitution(block.html, data) }
    }
    if (block.type === 'html') {
      return { ...block, content: applySubstitution(block.content, data) }
    }
    return block
  })
}
