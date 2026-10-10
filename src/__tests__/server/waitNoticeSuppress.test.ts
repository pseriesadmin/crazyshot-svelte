/**
 * TDD: 대기 안내 반복 억제는 "마지막 답변(사람·자동 포함)이 대기 안내일 때만" 적용한다 (2026-10-10).
 * 이전 규칙(5분 안에 같은 안내가 있었으면 무조건 억제)은 그 사이 빠른답변·관리자 답변이 나간 뒤 새 질문에도 아무 응답을 안 줬다.
 */
import { describe, it, expect } from 'vitest'
import { isWaitNoticeStillPending, WAIT_REPLY } from '$lib/server/cannedAutoReply'

const now = new Date('2026-10-10T04:40:00.000Z')
const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()

describe('WAIT_REPLY 문구(2026-10-10)', () => {
  it('매칭 실패 공통 안내에 영업시간 외 지연 안내가 포함된다', () => {
    expect(WAIT_REPLY).toBe('정확한 답변을 위해 담당자가 확인 후 안내드릴게요. 잠시만 기다려 주세요. 영업 시간 외인 경우 지연될 수 있습니다.')
  })
  it('배포 전에 이미 보낸 옛 문구의 대기 안내도 억제 판정에서 같은 안내로 본다', () => {
    const old = '정확한 답변을 위해 담당자가 확인 후 안내드릴게요. 잠시만 기다려 주세요.'
    expect(isWaitNoticeStillPending({ sender_type: 'ai', content: old, created_at: at(1) }, now)).toBe(true)
  })
})

describe('isWaitNoticeStillPending', () => {
  it('마지막 답변이 5분 이내의 대기 안내면 억제(연달아 보낸 질문에 같은 안내를 쌓지 않음)', () => {
    expect(isWaitNoticeStillPending({ sender_type: 'ai', content: WAIT_REPLY, created_at: at(1) }, now)).toBe(true)
  })
  it('마지막 답변이 빠른답변·관리자 답변이면 새 질문에는 다시 안내한다(이번 사고 상황)', () => {
    expect(isWaitNoticeStillPending({ sender_type: 'admin', content: '📌 예약 취소·환불 안내', created_at: at(1) }, now)).toBe(false)
  })
  it('대기 안내라도 5분이 지났으면 다시 안내한다', () => {
    expect(isWaitNoticeStillPending({ sender_type: 'ai', content: WAIT_REPLY, created_at: at(6) }, now)).toBe(false)
  })
  it('이전 답변이 없거나 시각을 못 읽으면 억제하지 않는다(응답 누락보다 중복 안내가 낫다)', () => {
    expect(isWaitNoticeStillPending(null, now)).toBe(false)
    expect(isWaitNoticeStillPending({ sender_type: 'ai', content: WAIT_REPLY, created_at: 'x' }, now)).toBe(false)
  })
})
