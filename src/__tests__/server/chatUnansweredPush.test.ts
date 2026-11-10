import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 미답변 상담 알림(chat_unanswered) — get_and_mark_unanswered_sessions 는 [{ user_id }] 행을 돌려주므로 행의 user_id 를 발송 대상으로 써야 한다(2026-11-10 사고: 행 객체를 그대로 넘겨 발송 기록 0)
describe('/api/chat/sessions 미답변 푸시 배선', () => {
  const src = readFileSync('src/routes/api/chat/sessions/+server.ts', 'utf8')
  const i = src.indexOf("rpc('get_and_mark_unanswered_sessions')")
  const body = src.slice(i, i + 900)
  it('RPC 결과 행의 user_id 로 발송한다', () => {
    expect(i).toBeGreaterThan(-1)
    expect(body).toMatch(/user_id: string/)
    expect(body).toMatch(/sendPushToUser\(row\.user_id, 'chat_unanswered'/)
  })
  it('발송이 끝날 때까지 기다리지 않고 최대 1.5초만 기다린다', () => {
    expect(src).toMatch(/Promise\.race\(\[unansweredTask, new Promise<void>\(\(resolve\) => setTimeout\(resolve, 1500\)\)\]\)/)
  })
})
