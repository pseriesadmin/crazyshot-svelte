// chatMessageWaitRepeat.test.ts — 기본 자동응답(대기 안내)을 연속 고객 대화마다 보낸다(2026-10-20): 반복 억제 코드가 되돌아오지 않게 소스를 점검
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/routes/api/chat/message/+server.ts', 'utf-8')

describe('chat/message 기본 자동응답 반복', () => {
  it('대기 안내 억제 로직(isWaitNoticeStillPending·suppressWait)을 쓰지 않는다', () => {
    expect(src).not.toMatch(/isWaitNoticeStillPending/)
    expect(src).not.toMatch(/suppressWait/)
  })
  it('AI/기본 응답 메시지 저장과 고객 푸시가 조건 없이 실행된다', () => {
    expect(src).toMatch(/sender_type: 'ai'/)
    expect(src).toMatch(/'ai_auto_reply'/)
  })
})
