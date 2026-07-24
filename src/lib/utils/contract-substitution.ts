import type { ContentBlock } from '$lib/types/content-editor'
import type { ContractSubstitutionData } from '$lib/types/contract-module'

function applySubstitution(text: string, data: ContractSubstitutionData): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim() as keyof ContractSubstitutionData
    return data[trimmed] ?? match
  })
}

export function substituteVariables(
  blocks: ContentBlock[],
  data: ContractSubstitutionData
): ContentBlock[] {
  return blocks.map((block): ContentBlock => {
    if (block.type === 'text') {
      return { ...block, html: applySubstitution(block.html, data) }
    }
    if (block.type === 'html') {
      return { ...block, content: applySubstitution(block.content, data) }
    }
    return block
  })
}
