// 채팅카드 본문이 푸시알림 설정의 커스텀 안내문장을 따르는지 (2026-11-16, Migration #835)
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCardContent } from '$lib/server/cardMessage'
import { clearNotifyMessageCache } from '$lib/server/notifyMessages'
import { clipAnswerVar, MAX_ANSWER_VAR_CHARS, getNotifySpec } from '$lib/utils/notifyTemplate'

function fakeAdmin(rows: { notify_type: string; extra_config: unknown }[], fail = false): SupabaseClient {
  return {
    from: () => ({
      select: async () => (fail ? { data: null, error: { message: 'x' } } : { data: rows, error: null }),
    }),
  } as unknown as SupabaseClient
}

const read = (p: string) => readFileSync(p, 'utf8')

describe('resolveCardContent', () => {
  beforeEach(() => clearNotifyMessageCache())

  it('등록한 안내문장이 있으면 변수를 치환해 쓴다', async () => {
    const admin = fakeAdmin([{ notify_type: 'inspection_pass', extra_config: { message: '[{{상품명}}] 검수 완료\n{{예약코드}}' } }])
    const out = await resolveCardContent(admin, 'inspection_pass', { 상품명: 'FX3', 예약코드: 'CS1' }, '기본 문구')
    expect(out).toBe('[FX3] 검수 완료\nCS1')
  })

  it('등록한 문장이 없으면 기존 고정 문구를 그대로 쓴다', async () => {
    const admin = fakeAdmin([{ notify_type: 'inspection_pass', extra_config: {} }])
    expect(await resolveCardContent(admin, 'inspection_pass', { 상품명: 'FX3' }, '기본 문구')).toBe('기본 문구')
  })

  it('치환 결과가 비면 기본 문구', async () => {
    const admin = fakeAdmin([{ notify_type: 'chat_unanswered', extra_config: { message: '{{고객이름}}' } }])
    expect(await resolveCardContent(admin, 'chat_unanswered', {}, '기본 문구')).toBe('기본 문구')
  })

  it('조회 실패는 던지지 않고 기본 문구', async () => {
    expect(await resolveCardContent(fakeAdmin([], true), 'inspection_pass', {}, '기본 문구')).toBe('기본 문구')
  })
})

describe('답변내용 변수 길이', () => {
  it('300자까지는 그대로, 넘으면 잘라 … 를 붙인다', () => {
    expect(clipAnswerVar('a'.repeat(MAX_ANSWER_VAR_CHARS))).toHaveLength(MAX_ANSWER_VAR_CHARS)
    expect(clipAnswerVar('a'.repeat(MAX_ANSWER_VAR_CHARS + 1))).toBe(`${'a'.repeat(MAX_ANSWER_VAR_CHARS)}…`)
  })
})

describe('변수 보강·표시 보정', () => {
  it('계약서·연체료 알림에서 상품명·예약코드 변수를 쓸 수 있다', () => {
    expect(getNotifySpec('contract_sent')?.vars).toEqual(expect.arrayContaining(['상품명', '예약코드']))
    expect(getNotifySpec('contract_signed_customer')?.vars).toContain('상품명')
    expect(getNotifySpec('late_fee_request')?.vars).toEqual(expect.arrayContaining(['상품명', '예약코드', '연체료']))
    expect(getNotifySpec('late_fee_paid')?.vars).toEqual(expect.arrayContaining(['상품명', '예약코드', '연체료']))
  })
})

describe('카드 발송 지점이 같은 정본을 쓴다(소스 가드)', () => {
  const files = [
    'src/routes/api/cron/return-notice/+server.ts',
    'src/lib/server/inspection.ts',
    'src/lib/server/priorIssue.ts',
    'src/lib/server/lateFeeNotify.ts',
    'src/routes/api/cms/approve-doc/+server.ts',
    'src/routes/api/contracts/[token]/sign/+server.ts',
    'src/routes/api/cms/contracts/[id]/send-chat/+server.ts',
    'src/routes/api/cms/chat/coupon-gift/direct-send/+server.ts',
    'src/routes/api/cms/chat/identity-request/direct-send/+server.ts',
  ]
  for (const f of files) {
    it(`${f} 는 resolveCardContent 를 거친다`, () => {
      expect(read(f)).toContain('resolveCardContent(')
    })
  }

  const sql = read('supabase/migrations/20261116170000_835_card_text_follows_custom.sql')
  it('DB 카드 함수 3종이 card_text_override 를 호출한다', () => {
    expect((sql.match(/private\.card_text_override\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(sql).toContain("IF p_notify_type <> 'locker_guide' THEN")
  })
  it('보조 함수는 anon·authenticated 실행 권한을 회수한다', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION private\.apply_notify_template[^;]*anon, authenticated/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION private\.card_text_override[^;]*anon, authenticated/)
  })
})
