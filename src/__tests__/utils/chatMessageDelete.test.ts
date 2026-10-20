// chatMessageDelete.test.ts — 대화카드 개별 삭제 규칙: 삭제 가능 범위·막힌 카드 종류(DB 함수와 일치)·오류 문구
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isChatMessageDeletable, isDeletedChatMessage, chatDeleteErrorMessage, NON_DELETABLE_CARD_TYPES, DELETED_MESSAGE_TEXT,
} from '$lib/utils/chatMessageDelete'

const msg = (over: Partial<{ sender_type: string; message_type: string; action_payload: { type?: string } | null; deleted_at: string | null }> = {}) =>
  ({ sender_type: 'admin', message_type: 'text', action_payload: null, deleted_at: null, ...over })

describe('isChatMessageDeletable', () => {
  it('관리자·AI·시스템이 보낸 일반 대화와 안내 카드는 삭제 가능', () => {
    expect(isChatMessageDeletable(msg())).toBe(true)
    expect(isChatMessageDeletable(msg({ sender_type: 'ai' }))).toBe(true)
    expect(isChatMessageDeletable(msg({ message_type: 'action_card', action_payload: { type: 'reservation_approval' } }))).toBe(true)
    expect(isChatMessageDeletable(msg({ message_type: 'action_card', action_payload: { type: 'identity_request' } }))).toBe(true)
  })
  it('고객이 보낸 메시지는 삭제 불가', () => {
    expect(isChatMessageDeletable(msg({ sender_type: 'user' }))).toBe(false)
  })
  it('결제·계약·쿠폰 카드는 삭제 불가', () => {
    for (const type of NON_DELETABLE_CARD_TYPES) {
      expect(isChatMessageDeletable(msg({ message_type: 'action_card', action_payload: { type } }))).toBe(false)
    }
  })
  it('이미 삭제된 메시지는 다시 삭제 불가', () => {
    expect(isChatMessageDeletable(msg({ deleted_at: '2026-10-20T00:00:00Z' }))).toBe(false)
    expect(isChatMessageDeletable(msg({ message_type: 'system', action_payload: { type: 'message_deleted' } }))).toBe(false)
    expect(isDeletedChatMessage({ deleted_at: null, action_payload: { type: 'message_deleted' } })).toBe(true)
  })
})

describe('DB 함수(Migration #733)와 막힌 카드 종류 목록 일치', () => {
  it('마이그레이션 파일의 IN 목록 == NON_DELETABLE_CARD_TYPES', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261020030000_733_chat_message_soft_delete.sql'), 'utf-8')
    const m = sql.match(/v_type IN \(([^)]*)\)/)
    expect(m).not.toBeNull()
    const inSql = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
    expect(inSql).toEqual([...NON_DELETABLE_CARD_TYPES].sort())
  })
  it('삭제 표시 문구가 DB 함수와 같다', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261020030000_733_chat_message_soft_delete.sql'), 'utf-8')
    expect(sql).toContain(`'${DELETED_MESSAGE_TEXT}'`)
  })
})

describe('chatDeleteErrorMessage', () => {
  it('DB 오류 코드를 상태·문구로 바꾼다', () => {
    expect(chatDeleteErrorMessage('CARD_TYPE_NOT_DELETABLE:contract_link').status).toBe(409)
    expect(chatDeleteErrorMessage('CUSTOMER_MESSAGE_NOT_DELETABLE').status).toBe(403)
    expect(chatDeleteErrorMessage('ALREADY_DELETED').status).toBe(409)
    expect(chatDeleteErrorMessage('MESSAGE_NOT_FOUND').status).toBe(404)
    expect(chatDeleteErrorMessage('뭔가 다른 오류').status).toBe(500)
  })
})
