/**
 * 상담채팅 중 고객이 입력한 전화번호·이름을 관리대상 명단과 대조한다 (2026-11-25).
 * 서버에서만 사용 — 관리대상 명단(이름·전화번호)은 브라우저로 내려가지 않고, 일치한 건의 최소 정보만 CMS 직원 응답에 담긴다.
 *
 * 명단 = ① 사전 등록 관리대상(managed_persons, 가입 이력 없음) + ② 관리대상으로 지정된 회원(user_profiles.blacklisted = true).
 * 판정:
 *  · 전화번호 — 메시지에서 휴대전화 번호 형태를 추출해 숫자만 비교(강한 일치, 'phone')
 *  · 이름 — 메시지 안에 3글자 이상 이름이 그대로 들어 있으면 의심(약한 일치, 'name' — 동명이인 가능).
 *    2글자 이름은 일반 단어와 겹쳐 오탐이 많아 대조하지 않는다.
 * 고객 본인 계정은 제외한다(본인의 관리대상 지정은 세션 배지·경고 배너가 이미 알려준다).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type ManagedChatMatchBasis = 'phone' | 'name'

export interface ManagedChatMatch {
  basis: ManagedChatMatchBasis
  /** 'registered' = 사전 등록 관리대상(회원 아님), 'member' = 관리대상으로 지정된 회원 */
  source: 'registered' | 'member'
  name: string
  member_code: string | null
}

export interface ManagedCandidate {
  key: string
  source: 'registered' | 'member'
  name: string
  phoneDigits: string
  member_code: string | null
}

const PHONE_RE = /(?<!\d)(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g

/** 문자열에서 휴대전화 번호를 찾아 숫자만 남긴 국내 형식(010…)으로 돌려준다. */
export function extractPhoneDigits(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.match(PHONE_RE) ?? []) {
    let d = m.replace(/\D/g, '')
    if (d.startsWith('82')) d = '0' + d.slice(2)
    else if (!d.startsWith('0')) d = '0' + d
    if (d.length === 10 || d.length === 11) out.add(d)
  }
  return [...out]
}

/** 메시지들과 관리대상 후보를 대조한다(순수 함수). 같은 후보는 전화번호 일치를 우선해 1건만 돌려준다. */
export function matchManagedInTexts(texts: string[], candidates: ManagedCandidate[], selfKey?: string | null): ManagedChatMatch[] {
  const joined = texts.join('\n')
  const phones = new Set(extractPhoneDigits(joined))
  const result: ManagedChatMatch[] = []
  for (const c of candidates) {
    if (selfKey && c.key === selfKey) continue
    let basis: ManagedChatMatchBasis | null = null
    if (c.phoneDigits && phones.has(c.phoneDigits)) basis = 'phone'
    else if (c.name.length >= 3 && joined.includes(c.name)) basis = 'name'
    if (basis) result.push({ basis, source: c.source, name: c.name, member_code: c.member_code })
  }
  return result.sort((a, b) => (a.basis === b.basis ? 0 : a.basis === 'phone' ? -1 : 1))
}

function digitsOf(phone: string | null | undefined): string {
  let d = (phone ?? '').replace(/\D/g, '')
  if (d.startsWith('82') && d.length >= 11) d = '0' + d.slice(2)
  return d
}

/** 해당 고객(userId)의 최근 고객 발화 메시지를 관리대상 명단과 대조한다. 조회 실패는 빈 배열(fail-soft). */
export async function findManagedChatMatches(admin: SupabaseClient, userId: string): Promise<ManagedChatMatch[]> {
  const { data: sessions, error: e1 } = await admin.from('chat_sessions').select('id').eq('user_id', userId)
  if (e1 || !sessions || sessions.length === 0) return []
  const sessionIds = (sessions as Array<{ id: string }>).map((s) => s.id)
  const { data: msgs, error: e2 } = await admin
    .from('chat_messages')
    .select('content')
    .in('session_id', sessionIds)
    .eq('sender_type', 'user')
    .eq('message_type', 'text')
    .eq('admin_only', false)
    .order('created_at', { ascending: false })
    .limit(100)
  if (e2) return []
  const texts = ((msgs ?? []) as Array<{ content: string | null }>).map((m) => m.content ?? '').filter((t) => t.length > 0)
  if (texts.length === 0) return []

  const [reg, mem] = await Promise.all([
    admin.from('managed_persons').select('id, name, phone_digits, member_code').is('deleted_at', null).limit(2000),
    admin.from('user_profiles').select('id, full_name, phone, member_code').eq('blacklisted', true).is('deleted_at', null).limit(2000),
  ])
  const candidates: ManagedCandidate[] = []
  for (const r of (reg.data ?? []) as Array<{ id: string; name: string; phone_digits: string; member_code: string | null }>) {
    candidates.push({ key: `r:${r.id}`, source: 'registered', name: (r.name ?? '').trim(), phoneDigits: r.phone_digits ?? '', member_code: r.member_code })
  }
  for (const p of (mem.data ?? []) as Array<{ id: string; full_name: string | null; phone: string | null; member_code: string | null }>) {
    candidates.push({ key: `m:${p.id}`, source: 'member', name: (p.full_name ?? '').trim(), phoneDigits: digitsOf(p.phone), member_code: p.member_code })
  }
  return matchManagedInTexts(texts, candidates, `m:${userId}`)
}
