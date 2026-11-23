// 상담 자동응답(AI·빠른답변) 대화창 본문이 푸시알림 설정 안내문장을 따르는지 (2026-11-16)
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { wrapAutoReply } from '$lib/server/cardMessage'
import { clearNotifyMessageCache } from '$lib/server/notifyMessages'

function fakeAdmin(message: string | null, fullName = '홍길동'): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'push_notification_config') {
        return { select: async () => ({ data: [{ notify_type: 'ai_auto_reply', extra_config: message == null ? {} : { message } }], error: null }) }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: fullName }, error: null }) }) }) }
    },
  } as unknown as SupabaseClient
}

describe('wrapAutoReply', () => {
  beforeEach(() => clearNotifyMessageCache())

  it('머리말·꼬리말이 있는 안내문장 안에 답변을 그대로 넣는다', async () => {
    const admin = fakeAdmin('[AI 자동응답💬]\n{{답변내용}}\n\n💡 AI 자동응답으로 먼저 답변드렸습니다.')
    expect(await wrapAutoReply(admin, 'ai_auto_reply', '안녕하세요.\n  들여쓴  줄', 'u1')).toBe('[AI 자동응답💬]\n안녕하세요.\n  들여쓴  줄\n\n💡 AI 자동응답으로 먼저 답변드렸습니다.')
  })
  it('안내문장이 없으면 답변 원문', async () => {
    expect(await wrapAutoReply(fakeAdmin(null), 'ai_auto_reply', '답변', 'u1')).toBe('답변')
  })
  it('{{답변내용}} 변수가 없는 안내문장이면 답변이 사라지지 않게 원문', async () => {
    expect(await wrapAutoReply(fakeAdmin('지연되어 죄송합니다.'), 'ai_auto_reply', '답변', 'u1')).toBe('답변')
  })
  it('고객이름 변수도 치환한다', async () => {
    expect(await wrapAutoReply(fakeAdmin('{{고객이름}}님\n{{답변내용}}'), 'ai_auto_reply', '답변', 'u1')).toBe('홍길동님\n답변')
  })
  it('길이가 4000자를 넘으면 답변 원문', async () => {
    expect(await wrapAutoReply(fakeAdmin(`${'가'.repeat(100)}\n{{답변내용}}`), 'ai_auto_reply', '나'.repeat(4000), 'u1')).toBe('나'.repeat(4000))
  })
})

describe('채팅 메시지 라우트 배선(소스 가드)', () => {
  const src = readFileSync('src/routes/api/chat/message/+server.ts', 'utf8')
  it('빠른답변·AI 자동응답 저장이 wrapAutoReply 를 거친다', () => {
    expect(src).toContain("wrapAutoReply(admin, 'canned_auto_reply'")
    expect(src).toContain("wrapAutoReply(admin, 'ai_auto_reply'")
  })
})
