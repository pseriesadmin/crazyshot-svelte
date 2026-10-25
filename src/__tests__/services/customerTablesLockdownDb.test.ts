import { describe, it, expect, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * Migration #761·#762 라이브 통합테스트 (Stage DB — ezyvffjvuwmtuhpxdjrw)
 *  #761 고객 직접 쓰기 잠금: 후기·댓글·크레이지로그·문의·외국인 표 직접 쓰기 차단 / chat_messages 'ai' 위조·내용 수정 차단(읽음 표시는 허용) / chat_sessions 생성 제한
 *  #762 cms_login_failures: 서버 전용(비로그인·로그인 사용자 접근 불가, service_role 가능)
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterAll(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => undefined)
})

const denied = (err: { code?: string; message?: string } | null): boolean =>
  !!err && (err.code === '42501' || /permission denied|row-level security/i.test(err.message ?? ''))

async function login(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-761-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`시험 계정 생성 실패: ${error?.message}`)
  const userId = data.user.id
  cleanups.push(async () => {
    await admin.from('chat_messages').delete().in('session_id', (await admin.from('chat_sessions').select('id').eq('user_id', userId)).data?.map((r) => r.id) ?? [])
    await admin.from('chat_sessions').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId)
  })
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signErr } = await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  if (signErr) throw new Error(`로그인 실패: ${signErr.message}`)
  return { client, userId }
}

describe('#761 고객 직접 쓰기 잠금', () => {
  it.each(['product_reviews', 'post_comments', 'user_posts', 'cs_posts', 'foreign_users'])('%s — 로그인 사용자 직접 INSERT 는 권한 오류', async (table) => {
    const { client, userId } = await login()
    const { error } = await client.from(table).insert({ user_id: userId } as never)
    expect(denied(error), `${table}: ${error?.code} ${error?.message}`).toBe(true)
  })

  it('chat_sessions — 정상 생성은 되고, 관리자 배정·닫힌 상태로 만들기는 막힌다', async () => {
    const { client, userId } = await login()
    const ok = await client.from('chat_sessions').insert({ user_id: userId, context_type: 'general', status: 'open' }).select('id').single()
    expect(ok.error, `정상 생성: ${ok.error?.message}`).toBeNull()

    const withAdmin = await client.from('chat_sessions').insert({ user_id: userId, context_type: 'general', status: 'open', admin_id: userId })
    expect(withAdmin.error).not.toBeNull()
    const closed = await client.from('chat_sessions').insert({ user_id: userId, context_type: 'general', status: 'closed' })
    expect(closed.error).not.toBeNull()
  })

  it('chat_messages — user 발신은 되고 ai 위조는 막히며, 내용 수정은 막히고 읽음 표시는 된다', async () => {
    const { client, userId } = await login()
    const s = await client.from('chat_sessions').insert({ user_id: userId, context_type: 'general', status: 'open' }).select('id').single()
    expect(s.error).toBeNull()
    const sid = (s.data as { id: string }).id

    const user = await client.from('chat_messages').insert({ session_id: sid, sender_type: 'user', content: '안녕', message_type: 'text' }).select('id').single()
    expect(user.error, `user 메시지: ${user.error?.message}`).toBeNull()
    const ai = await client.from('chat_messages').insert({ session_id: sid, sender_type: 'ai', content: '위조', message_type: 'text' })
    expect(ai.error).not.toBeNull()

    // 서버(서비스 롤)가 관리자 메시지를 넣었다고 가정 — 고객은 내용을 바꿀 수 없다
    const adminMsg = await admin.from('chat_messages').insert({ session_id: sid, sender_type: 'admin', content: '원본', message_type: 'text' }).select('id').single()
    expect(adminMsg.error).toBeNull()
    const mid = (adminMsg.data as { id: string }).id
    const edit = await client.from('chat_messages').update({ content: '변조' }).eq('id', mid)
    expect(denied(edit.error), `${edit.error?.code} ${edit.error?.message}`).toBe(true)
    const { data: still } = await admin.from('chat_messages').select('content').eq('id', mid).single()
    expect((still as { content: string }).content).toBe('원본')

    const read = await client.from('chat_messages').update({ is_read: true }).eq('id', mid)
    expect(read.error).toBeNull()
    const { data: after } = await admin.from('chat_messages').select('is_read').eq('id', mid).single()
    expect((after as { is_read: boolean }).is_read).toBe(true)
  })
})

describe('#762 cms_login_failures 서버 전용', () => {
  it('비로그인·로그인 사용자는 접근할 수 없고 service_role 은 쓸 수 있다', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    expect(denied((await anon.from('cms_login_failures').select('id').limit(1)).error)).toBe(true)
    expect(denied((await anon.from('cms_login_failures').insert({ email_hash: 'x', ip_address: 'x' })).error)).toBe(true)
    const { client } = await login()
    expect(denied((await client.from('cms_login_failures').select('id').limit(1)).error)).toBe(true)

    const hash = `tdd-762-${Date.now()}`
    const ins = await admin.from('cms_login_failures').insert({ email_hash: hash, ip_address: '9.9.9.9' })
    expect(ins.error).toBeNull()
    const del = await admin.from('cms_login_failures').delete().eq('email_hash', hash)
    expect(del.error).toBeNull()
  })
})

describe('#761·#763 추가 확인 — 직접 수정·삭제 차단, 위조 액션 카드 차단, 정상 첨부 허용', () => {
  it.each(['product_reviews', 'post_comments', 'user_posts', 'cs_posts', 'foreign_users'])('%s — 로그인 사용자 직접 UPDATE·DELETE 는 권한 오류', async (table) => {
    const { client } = await login()
    const upd = await client.from(table).update({ id: '00000000-0000-0000-0000-000000000000' } as never).eq('id', '00000000-0000-0000-0000-000000000000')
    expect(denied(upd.error), `${table} update: ${upd.error?.code} ${upd.error?.message}`).toBe(true)
    const del = await client.from(table).delete().eq('id', '00000000-0000-0000-0000-000000000000')
    expect(denied(del.error), `${table} delete: ${del.error?.code} ${del.error?.message}`).toBe(true)
  })

  it('chat_messages — 고객이 액션 카드·payload·관리자 전용 표시를 직접 넣을 수 없고, 이미지 첨부는 된다', async () => {
    const { client, userId } = await login()
    const s = await client.from('chat_sessions').insert({ user_id: userId, context_type: 'general', status: 'open' }).select('id').single()
    const sid = (s.data as { id: string }).id
    const card = await client.from('chat_messages').insert({ session_id: sid, sender_type: 'user', content: 'x', message_type: 'action_card', action_payload: { type: 'fake' } })
    expect(card.error).not.toBeNull()
    const payload = await client.from('chat_messages').insert({ session_id: sid, sender_type: 'user', content: 'x', message_type: 'text', action_payload: { type: 'fake' } })
    expect(payload.error).not.toBeNull()
    const adminOnly = await client.from('chat_messages').insert({ session_id: sid, sender_type: 'user', content: 'x', message_type: 'text', admin_only: true })
    expect(adminOnly.error).not.toBeNull()
    const image = await client.from('chat_messages').insert({ session_id: sid, sender_type: 'user', content: 'a.png\nhttps://example.com/a.png', message_type: 'image' })
    expect(image.error, image.error?.message).toBeNull()
  })
})
