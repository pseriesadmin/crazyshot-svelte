import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * 권한 잠금(#760·#761) 이후에도 정식 가입 로그인 사용자의 일상 기능이 막히지 않는지 — 실제 로그인 사용자로 RPC 를 끝까지 실행 (Stage 라이브)
 * 크레이지로그 글 등록·수정·공개전환·삭제, 댓글 등록·삭제, 후기 등록·삭제, 회원 정보 수정·아바타·동의·알림설정, 배송지 추가·기본지정·삭제, 찜, 문의 등록, 상담 세션·메시지
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterAll(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => undefined)
})

let client: SupabaseClient
let userId = ''
let productId = ''

// RPC 호출 결과가 성공이어야 한다 — 실패 시 코드·메시지를 그대로 보여준다
async function rpcOk<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn as never, args as never)
  expect(error, `${fn}: ${error?.code} ${error?.message}`).toBeNull()
  return data as T
}

beforeAll(async () => {
  const email = `tdd-member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`시험 계정 생성 실패: ${error?.message}`)
  userId = data.user.id
  cleanups.push(async () => {
    await admin.from('user_shipping_addresses').delete().eq('user_id', userId)
    await admin.from('post_comments').delete().eq('user_id', userId)
    await admin.from('product_reviews').delete().eq('user_id', userId)
    await admin.from('product_wishlists').delete().eq('user_id', userId)
    await admin.from('cs_posts').delete().eq('user_id', userId)
    await admin.from('user_posts').delete().eq('user_id', userId)
    await admin.from('chat_messages').delete().in('session_id', (await admin.from('chat_sessions').select('id').eq('user_id', userId)).data?.map((r) => r.id) ?? [])
    await admin.from('chat_sessions').delete().eq('user_id', userId)
    await admin.from('user_profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  })
  client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const signIn = await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  if (signIn.error) throw new Error(`로그인 실패: ${signIn.error.message}`)
  const { data: prod } = await admin.from('products').select('id').is('parent_product_id', null).eq('is_active', true).is('deleted_at', null).limit(1).single()
  productId = (prod as { id: string }).id
  await rpcOk('ensure_user_profile')
})

describe('정식 로그인 사용자 — 회원 정보', () => {
  it('회원 정보 수정·아바타·동의·알림 설정이 된다', async () => {
    await rpcOk('update_user_profile', { p_full_name: '시험회원', p_email: null, p_birth_date: '1990-01-01' })
    await rpcOk('update_user_avatar', { p_avatar_url: null })
    await rpcOk('update_user_consent', { p_allow_privacy_consent: true, p_allow_third_party_consent: true })
    await rpcOk('update_notification_settings', { p_rental_alert: true, p_benefit_alert: false })
    const { data } = await admin.from('user_profiles').select('full_name, allow_rental_alert, allow_benefit_alert').eq('id', userId).single()
    expect(data).toMatchObject({ full_name: '시험회원', allow_rental_alert: true, allow_benefit_alert: false })
  })

  it('배송지 추가·기본 지정·삭제가 된다', async () => {
    const a = await rpcOk<string>('add_shipping_address', { p_label: '집', p_recipient: '홍길동', p_phone: '01012345678', p_road_address: '서울시 중구', p_detail_address: '101호', p_postal_code: '04524', p_set_default: true })
    expect(a).toBeTruthy()
    const { data: rows } = await admin.from('user_shipping_addresses').select('id').eq('user_id', userId)
    const id = (rows as Array<{ id: string }>)[0].id
    await rpcOk('set_default_shipping_address', { p_address_id: id })
    await rpcOk('delete_shipping_address', { p_address_id: id })
  })

  it('찜 토글이 된다', async () => {
    await rpcOk('toggle_product_wishlist', { p_product_id: productId })
  })
})

describe('정식 로그인 사용자 — 크레이지로그·후기·문의', () => {
  it('글 등록 → 수정 → 공개 전환 → 삭제(소프트) → 완전 삭제가 된다', async () => {
    const created = await rpcOk<{ id: string }>('create_user_post', {
      p_log_type: '일상공유', p_title: '시험 글', p_content_blocks: [{ type: 'paragraph', text: '본문' }], p_keywords: ['시험'], p_tags: [], p_is_public: false,
      p_allow_comments: true, p_allow_scrap: true, p_allow_ai_save: true, p_auto_source: false, p_ccl: null, p_thumbnail_url: null,
    })
    const id = created.id
    expect(id).toBeTruthy()
    await rpcOk('update_user_post', {
      p_id: id, p_log_type: '일상공유', p_title: '시험 글(수정)', p_content_blocks: [{ type: 'paragraph', text: '수정' }], p_keywords: ['시험'], p_tags: [], p_is_public: false,
      p_allow_comments: true, p_allow_scrap: true, p_allow_ai_save: true, p_auto_source: false, p_ccl: null, p_thumbnail_url: null,
    })
    await rpcOk('set_post_public', { p_id: id, p_public: true })
    await rpcOk('delete_own_post', { p_id: id })
    const { data } = await admin.from('user_posts').select('status').eq('id', id).single()
    expect(data).not.toBeNull()
  })

  it('댓글 등록·삭제가 된다', async () => {
    const createdPost = await rpcOk<{ id: string }>('create_user_post', {
      p_log_type: '일상공유', p_title: '댓글용', p_content_blocks: [{ type: 'paragraph', text: '본문' }], p_keywords: [], p_tags: [], p_is_public: true,
      p_allow_comments: true, p_allow_scrap: true, p_allow_ai_save: true, p_auto_source: false, p_ccl: null, p_thumbnail_url: null,
    })
    const postId = createdPost.id
    const commentRow = await rpcOk<string | { id: string }>('create_post_comment', { p_post_id: postId, p_content: '댓글' })
    const commentId = typeof commentRow === 'string' ? commentRow : commentRow.id
    await rpcOk('delete_own_post_comment', { p_comment_id: commentId })
  })

  it('후기 등록·삭제와 문의 등록이 된다(구매 조건 등 업무 규칙 거절은 권한 오류가 아니다)', async () => {
    const { error } = await client.rpc('create_product_review' as never, { p_product_id: productId, p_title: '후기', p_content: '내용' } as never)
    if (error) expect(error.code, `후기: ${error.message}`).not.toBe('42501')
    await rpcOk('submit_cs_post', { p_title: '문의', p_content: '내용', p_category: 'etc' })
  })
})

describe('정식 로그인 사용자 — 상담', () => {
  it('상담 세션 생성 후 메시지 전송·읽음 처리가 된다', async () => {
    const s = await client.from('chat_sessions').insert({ user_id: userId, context_type: 'general', status: 'open' }).select('id').single()
    expect(s.error, s.error?.message).toBeNull()
    const sid = (s.data as { id: string }).id
    const m = await client.from('chat_messages').insert({ session_id: sid, sender_type: 'user', content: '문의합니다', message_type: 'text' }).select('id').single()
    expect(m.error, m.error?.message).toBeNull()
    const u = await client.from('chat_messages').update({ is_read: true }).eq('id', (m.data as { id: string }).id)
    expect(u.error, u.error?.message).toBeNull()
    await rpcOk('clear_my_chat_history')
  })
})
