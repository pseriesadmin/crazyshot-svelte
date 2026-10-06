/**
 * contentAudit.ts — 저장된 content_blocks를 새 변환기로 왕복시켜 보는 전수 점검 로직(읽기 전용).
 * scripts/audit-content-roundtrip.mjs 가 사용한다. DOM이 필요하다(브라우저 또는 jsdom).
 */
import type { ContentBlock } from '$lib/types/content-editor'
import { blocksToDoc, classifyBlockFidelity, docToBlocks, blocksTextEqual } from '$lib/utils/contentBlocksTiptap'

export interface BlockAudit {
  textBlocks: number
  htmlBlocks: number
  mediaBlocks: number
  convertible: number
  preserved: number
  /** 변환 가능으로 판정됐는데 글자가 달라진 블록 수 — 반드시 0이어야 한다(합격 기준) */
  mismatchConvertible: number
  /** 보존으로 분류된 블록이 원본과 바이트 단위로 달라진 수 — 반드시 0 */
  preservedAltered: number
  reasons: Record<string, number>
}

export function auditBlocks(blocks: unknown): BlockAudit {
  const out: BlockAudit = { textBlocks: 0, htmlBlocks: 0, mediaBlocks: 0, convertible: 0, preserved: 0, mismatchConvertible: 0, preservedAltered: 0, reasons: {} }
  if (!Array.isArray(blocks)) return out
  for (const raw of blocks as ContentBlock[]) {
    if (!raw || typeof raw !== 'object') continue
    if (raw.type === 'text') {
      out.textBlocks++
      if (!raw.html || !raw.html.trim()) { out.convertible++; continue }
      const r = classifyBlockFidelity(raw.html)
      const back = docToBlocks(blocksToDoc([raw]))
      if (r.convertible) {
        out.convertible++
        if (!blocksTextEqual([raw], back)) out.mismatchConvertible++
      } else {
        out.preserved++
        const key = (r.reason ?? 'unknown').split(':').slice(0, 2).join(':')
        out.reasons[key] = (out.reasons[key] ?? 0) + 1
        const same = back.length === 1 && back[0].type === 'text' && back[0].html === raw.html
        if (!same) out.preservedAltered++
      }
    } else if (raw.type === 'html') {
      out.htmlBlocks++
      out.preserved++
      const back = docToBlocks(blocksToDoc([raw]))
      const same = back.length === 1 && back[0].type === 'html' && back[0].content === raw.content
      if (!same && (raw.content ?? '').trim()) out.preservedAltered++
    } else if (raw.type === 'image' || raw.type === 'youtube' || raw.type === 'divider') {
      out.mediaBlocks++
    }
  }
  return out
}
