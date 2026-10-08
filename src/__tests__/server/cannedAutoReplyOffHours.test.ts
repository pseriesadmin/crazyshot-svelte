/**
 * cannedAutoReplyOffHours.test.ts — decideAutoReply가 매처에 질문을 넘기기 전에 영업 외 표식(OFF_HOURS_MARKER)을 붙인다 (2026-10-08)
 *  · 영업 외 시각·단어가 있으면 매처가 받는 질문 끝에 표식이 붙는다(숫자 시각은 매처가 버리므로)
 *  · 영업 중 시각·무관한 질문·촬영 맥락이면 원문 그대로 넘긴다(기존 동작 불변)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const seen: string[] = []
vi.mock('$lib/server/matchCannedResponse', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/matchCannedResponse')>('$lib/server/matchCannedResponse')
  return {
    ...actual,
    evaluateCannedMatch: (message: string, ...rest: unknown[]) => {
      seen.push(message)
      return (actual.evaluateCannedMatch as (m: string, ...r: unknown[]) => unknown)(message, ...rest)
    },
  }
})

import { decideAutoReply } from '$lib/server/cannedAutoReply'
import { OFF_HOURS_MARKER } from '$lib/server/offHoursTime'

const CANDS = [
  { id: 'c1', title: '영업시간 및 영업시간 외 이용 안내', content: '운영시간 09:00 ~ 22:00', category: 'general', shortcut: null, match_keywords: [OFF_HOURS_MARKER, '새벽', '대여'], usage_count: 0 },
]

describe('decideAutoReply — 영업 외 표식', () => {
  beforeEach(() => { seen.length = 0 })

  it('영업 외 숫자 시각이면 표식을 붙여 매처에 넘긴다', () => {
    decideAutoReply('밤 11시에 대여 가능해요?', CANDS, [])
    expect(seen).toEqual([`밤 11시에 대여 가능해요? ${OFF_HOURS_MARKER}`])
  })
  it('영업 외 단어면 표식을 붙인다', () => {
    decideAutoReply('새벽에 대여도 가능해요?', CANDS, [])
    expect(seen).toEqual([`새벽에 대여도 가능해요? ${OFF_HOURS_MARKER}`])
  })
  it('영업 중 시각이면 원문 그대로', () => {
    decideAutoReply('오후 3시에 대여 가능해요?', CANDS, [])
    expect(seen).toEqual(['오후 3시에 대여 가능해요?'])
  })
  it('시간 표현이 없으면 원문 그대로', () => {
    decideAutoReply('보증금은 얼마예요?', CANDS, [])
    expect(seen).toEqual(['보증금은 얼마예요?'])
  })
  it('표기 정규화가 먼저 적용된다(퀵→퀵배송, 몇 시→몇시)', () => {
    decideAutoReply('퀵으로 받을 수 있나요', CANDS, [])
    decideAutoReply('몇 시까지 해요', CANDS, [])
    expect(seen).toEqual(['퀵배송으로 받을 수 있나요', '몇시까지 해요'])
  })
  it('정규화와 영업 외 표식이 함께 적용된다', () => {
    decideAutoReply('새벽에 퀵으로 받을 수 있나요', CANDS, [])
    expect(seen).toEqual([`새벽에 퀵배송으로 받을 수 있나요 ${OFF_HOURS_MARKER}`])
  })
  it('촬영 맥락의 새벽·야간은 영업 외 질문이 아니다', () => {
    decideAutoReply('새벽 촬영하기 좋은 카메라 추천해줘', CANDS, [])
    expect(seen).toEqual(['새벽 촬영하기 좋은 카메라 추천해줘'])
  })
})
