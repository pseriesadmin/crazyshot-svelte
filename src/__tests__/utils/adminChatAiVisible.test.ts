/**
 * adminChatAiVisible.test.ts — 2026-11-27 (Stephen 지시 "채팅창에도 AI 자동응답 표시")
 * 상담 카드 미리보기(서버·실시간)는 sender_type='ai' 메시지(AI 자동응답)를 마지막 대화로 쓴다.
 * 관리자 채팅창이 같은 메시지를 숨기면 카드와 채팅창의 마지막 내용이 어긋나므로, 기본 보기에서도 AI 메시지를 숨기지 않는다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/lib/components/chat/AdminChatPanel.svelte', 'utf8')
const start = src.indexOf('let filteredMessages = $derived(')
const block = src.slice(start, src.indexOf('// 고객 기본정보 요약', start))

describe('관리자 채팅창 기본 보기 — AI 메시지 표시', () => {
  it('AIV-1: 기본 보기가 sender_type 이 ai 인 메시지를 걸러내지 않는다', () => {
    expect(start).toBeGreaterThan(0)
    expect(block).not.toContain("sender_type !== 'ai'")
    expect(block).not.toContain("sender_type === 'ai'")
  })

  it('AIV-2: 중요 카드만 보기 필터는 그대로 유지된다', () => {
    expect(block).toContain('showImportantOnly')
    expect(block).toContain('IMPORTANT_ACTION_TYPES')
  })
})
