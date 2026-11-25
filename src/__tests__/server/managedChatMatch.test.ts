import { describe, it, expect } from 'vitest'
import { extractPhoneDigits, matchManagedInTexts, type ManagedCandidate } from '$lib/server/managedChatMatch'

/** 상담채팅 중 고객이 입력한 이름·전화번호 ↔ 관리대상 자동 대조 (2026-11-25) */

const CANDS: ManagedCandidate[] = [
  { key: 'r:1', source: 'registered', name: '홍길동', phoneDigits: '01077411234', member_code: 'CSMG2611001' },
  { key: 'm:u1', source: 'member', name: '김민수', phoneDigits: '01068891111', member_code: 'CSBC2610042' },
  { key: 'm:self', source: 'member', name: '이지호', phoneDigits: '01095327081', member_code: 'CSBC2611116' },
  { key: 'r:2', source: 'registered', name: '이상', phoneDigits: '01000000000', member_code: null },
]

describe('extractPhoneDigits', () => {
  it('하이픈·공백·점·국가번호 표기를 숫자만으로 통일한다', () => {
    expect(extractPhoneDigits('010-7741-1234')).toEqual(['01077411234'])
    expect(extractPhoneDigits('연락처 010 7741 1234 입니다')).toEqual(['01077411234'])
    expect(extractPhoneDigits('+82 10-7741-1234')).toEqual(['01077411234'])
    expect(extractPhoneDigits('01077411234, 010.6889.1111')).toEqual(['01077411234', '01068891111'])
  })
  it('번호가 아닌 숫자(날짜·금액)는 잡지 않는다', () => {
    expect(extractPhoneDigits('2026.11.25 10:08 에 150000원')).toEqual([])
  })
})

describe('matchManagedInTexts', () => {
  it('전화번호 일치는 phone, 이름만 같으면 name(약한 일치)으로 돌려주고 phone을 먼저 둔다', () => {
    const r = matchManagedInTexts(['홍길동 이름으로 예약할게요', '제 번호는 010-6889-1111'], CANDS)
    expect(r.map((x) => [x.name, x.basis])).toEqual([['김민수', 'phone'], ['홍길동', 'name']])
  })
  it('같은 후보는 전화번호와 이름이 모두 맞아도 phone 1건만', () => {
    const r = matchManagedInTexts(['홍길동 010-7741-1234'], CANDS)
    expect(r).toHaveLength(1)
    expect(r[0].basis).toBe('phone')
  })
  it('고객 본인 계정은 제외한다', () => {
    expect(matchManagedInTexts(['010-9532-7081 이지호'], CANDS, 'm:self')).toEqual([])
  })
  it('2글자 이름은 일반 단어 오탐을 막기 위해 이름 대조하지 않는다(전화번호는 대조)', () => {
    expect(matchManagedInTexts(['이상 없어요'], CANDS)).toEqual([])
    expect(matchManagedInTexts(['010-0000-0000'], CANDS).map((x) => x.basis)).toEqual(['phone'])
  })
  it('일치가 없으면 빈 배열', () => {
    expect(matchManagedInTexts(['안녕하세요 대여 문의드려요'], CANDS)).toEqual([])
  })
})

import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findManagedChatMatches } from '$lib/server/managedChatMatch'

describe('findManagedChatMatches — 미가입 임시(익명) 계정 상담', () => {
  it('user_profiles 행이 없는 임시 계정의 세션도 메시지를 관리대상과 대조한다', async () => {
    const tables: Record<string, { data: unknown[] | null; error: null }> = {
      chat_sessions: { data: [{ id: 's1' }], error: null },
      chat_messages: { data: [{ content: '제 번호는 010-7741-1234 입니다' }], error: null },
      managed_persons: { data: [{ id: 'p1', name: '홍길동', phone_digits: '01077411234', member_code: 'CSMG2611001' }], error: null },
      user_profiles: { data: [], error: null }, // 임시 계정 본인 프로필 없음 + 블랙리스트 회원 없음
    }
    const admin = {
      from: vi.fn((t: string) => {
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) b[m] = () => b
        b.then = (res: (v: unknown) => void) => res(tables[t])
        return b
      }),
    } as unknown as SupabaseClient
    const r = await findManagedChatMatches(admin, 'anon-user-id')
    expect(r.map((x) => [x.name, x.basis, x.source])).toEqual([['홍길동', 'phone', 'registered']])
  })
})
