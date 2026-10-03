import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * 본인증명·외국인증명 "필수 서류 등록 → 관리자 승인요청 카드/푸시 → 관리자 승인" 엔드투엔드 흐름 — 라이브 통합 테스트
 * (2026-10-03, 김하솔 건 "1개만 등록해도 승인요청 카드가 나간다" 제보 검증)
 *
 * 실제 핸들러(upload-doc · delete-doc-item · approve-doc)를 Stage DB(ezyvffjvuwmtuhpxdjrw)에 직접 연결해 호출한다.
 * 푸시(FCM)와 CMS 역할 조회만 mock — 푸시는 실제 기기로 나가지 않게 하고, 호출 여부만 검증한다.
 */

vi.mock('$lib/server/push', () => ({
  sendPushToAdmins: vi.fn(async () => undefined),
  sendPushToUser: vi.fn(async () => undefined),
}))
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn(async () => 'manager'),
}))

import { sendPushToAdmins } from '$lib/server/push'
import { POST as uploadDoc } from '../../routes/api/profile/upload-doc/+server'
import { POST as deleteDocItem } from '../../routes/api/profile/delete-doc-item/+server'
import { POST as approveDoc } from '../../routes/api/cms/approve-doc/+server'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const pushSpy = sendPushToAdmins as unknown as ReturnType<typeof vi.fn>

interface Actor { id: string; client: SupabaseClient }
const actors: Actor[] = []

async function makeActor(): Promise<Actor> {
  const email = `tdd-doc-flow-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signErr } = await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  if (signErr) throw new Error(`로그인 실패: ${signErr.message}`)
  const actor = { id: data.user.id, client }
  actors.push(actor)
  // user_profiles 행이 트리거로 없을 수 있어 보장
  await admin.from('user_profiles').upsert({ user_id: actor.id, full_name: '테스트고객' }, { onConflict: 'user_id' })
  return actor
}

function locals(a: Actor) {
  return {
    supabase: a.client,
    safeGetSession: async () => ({ session: { user: { id: a.id } } }),
  } as never
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
function uploadForm(type: 'identity' | 'foreign', docTypes: string[], opts: { merge?: boolean; stay?: string } = {}) {
  const f = new FormData()
  f.set('type', type)
  if (opts.merge) f.set('merge', 'true')
  if (opts.stay) f.set('foreign_stay_type', opts.stay)
  for (const t of docTypes) {
    f.append(type === 'identity' ? 'identity_type' : 'foreign_type', t)
    f.append('file', new File([PNG], `${t}.png`, { type: 'image/png' }))
  }
  return new Request('http://localhost/api/profile/upload-doc', { method: 'POST', body: f })
}

async function upload(a: Actor, type: 'identity' | 'foreign', docTypes: string[], opts: { merge?: boolean; stay?: string } = {}) {
  const res = await uploadDoc({ request: uploadForm(type, docTypes, opts), locals: locals(a) } as never)
  return res as unknown as { status: number; data?: unknown } & Response
}
async function statusOf(res: unknown): Promise<number> { return (res as Response).status }

async function approve(a: Actor, type: 'identity' | 'foreign') {
  const req = new Request('http://localhost/api/cms/approve-doc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: a.id, type }),
  })
  const res = await approveDoc({ request: req, locals: locals(a) } as never)
  return { status: await statusOf(res), body: await (res as Response).json() as { ok: boolean; error?: string } }
}

async function removeItem(a: Actor, type: 'identity' | 'foreign', docType: string) {
  const req = new Request('http://localhost/api/profile/delete-doc-item', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, docType }),
  })
  const res = await deleteDocItem({ request: req, locals: locals(a) } as never)
  return statusOf(res)
}

async function reviewCardCount(a: Actor): Promise<number> {
  const { data } = await admin.from('chat_messages')
    .select('id, chat_sessions!inner(user_id)')
    .eq('chat_sessions.user_id', a.id)
    .eq('action_payload->>type', 'identity_review_request')
  return data?.length ?? 0
}
async function profileOf(a: Actor) {
  const { data } = await admin.from('user_profiles')
    .select('identity_type, foreign_type, identity_verified_at, identity_approved_at, foreign_verified_at, foreign_approved_at')
    .eq('user_id', a.id).single()
  return data as {
    identity_type: string[] | null; foreign_type: string[] | null
    identity_verified_at: string | null; identity_approved_at: string | null
    foreign_verified_at: string | null; foreign_approved_at: string | null
  }
}

afterAll(async () => {
  for (const a of actors) {
    const { data: files } = await admin.storage.from('user-documents').list(a.id)
    if (files?.length) await admin.storage.from('user-documents').remove(files.map(f => `${a.id}/${f.name}`))
    const { data: sess } = await admin.from('chat_sessions').select('id').eq('user_id', a.id)
    for (const s of sess ?? []) await admin.from('chat_messages').delete().eq('session_id', (s as { id: string }).id)
    await admin.from('chat_sessions').delete().eq('user_id', a.id)
    await admin.from('user_profiles').delete().eq('user_id', a.id)
    await admin.auth.admin.deleteUser(a.id)
  }
})

describe('본인증명 — 필수 조합((주민등록증|운전면허증) + 주민등록등본) 흐름', () => {
  let a: Actor
  beforeAll(async () => { a = await makeActor() })

  it('① 운전면허증 1개만 등록 → 카드·푸시 없음, 승인 거절(400)', async () => {
    pushSpy.mockClear()
    const r = await upload(a, 'identity', ['driver'])
    expect((r as unknown as { status: number }).status).toBe(200)
    expect(await reviewCardCount(a)).toBe(0)
    expect(pushSpy).not.toHaveBeenCalled()
    const ap = await approve(a, 'identity')
    expect(ap.status).toBe(400)
  })

  it('② 주민등록등본을 추가(병합) → 필수 조합 완성: 카드 1건 + 푸시 1회, 승인 성공', async () => {
    pushSpy.mockClear()
    await upload(a, 'identity', ['resident_copy'], { merge: true })
    expect(await reviewCardCount(a)).toBe(1)
    expect(pushSpy).toHaveBeenCalledTimes(1)
    const ap = await approve(a, 'identity')
    expect(ap.body.ok).toBe(true)
    const p = await profileOf(a)
    expect(p.identity_approved_at).toBeTruthy()
  })

  it('③ 승인 후 고객의 추가 등록·삭제는 잠금(403)', async () => {
    const r = await upload(a, 'identity', ['driver'], { merge: true })
    expect((r as unknown as { status: number }).status).toBe(403)
    expect(await removeItem(a, 'identity', 'driver')).toBe(403)
  })
})

describe('본인증명 — 주민등록등본만 단독 등록 / 등록 후 일부 삭제', () => {
  it('④ 주민등록등본만 1개 → 카드 없음, 승인 거절', async () => {
    const a = await makeActor()
    pushSpy.mockClear()
    await upload(a, 'identity', ['resident_copy'])
    expect(await reviewCardCount(a)).toBe(0)
    expect(pushSpy).not.toHaveBeenCalled()
    expect((await approve(a, 'identity')).status).toBe(400)
  })

  it('⑤ 한 번에 2종(운전면허증+등본) 업로드 → 카드 1건, 이후 1개 삭제하면 승인 거절', async () => {
    const a = await makeActor()
    pushSpy.mockClear()
    await upload(a, 'identity', ['driver', 'resident_copy'])
    expect(await reviewCardCount(a)).toBe(1)
    expect(await removeItem(a, 'identity', 'resident_copy')).toBe(200)
    expect((await approve(a, 'identity')).status).toBe(400)
  })

  it('⑥ 필수 조합 완성 후 파일 1개만 교체(병합) → 카드가 한 번 더 나간다(현재 동작 고정: 중복 발송)', async () => {
    const a = await makeActor()
    await upload(a, 'identity', ['driver', 'resident_copy'])
    expect(await reviewCardCount(a)).toBe(1)
    await upload(a, 'identity', ['driver'], { merge: true })
    expect(await reviewCardCount(a)).toBe(2)
  })

  it('⑦ 학생증 등 필수 조합에 속하지 않는 서류만 → 카드 없음', async () => {
    const a = await makeActor()
    pushSpy.mockClear()
    await upload(a, 'identity', ['student'])
    expect(await reviewCardCount(a)).toBe(0)
    expect(pushSpy).not.toHaveBeenCalled()
  })
})

describe('외국인증명 — 체류유형별 4종 전부 필요', () => {
  it('⑧ 단기체류: 3종 → 카드·푸시 없음·승인 거절, 4종째 추가(병합) → 카드 1건·승인 성공', async () => {
    const a = await makeActor()
    pushSpy.mockClear()
    await upload(a, 'foreign', ['passport_photo', 'accommodation_reservation', 'entry_eticket'], { stay: 'short' })
    expect(await reviewCardCount(a)).toBe(0)
    expect(pushSpy).not.toHaveBeenCalled()
    expect((await approve(a, 'foreign')).status).toBe(400)

    await upload(a, 'foreign', ['exit_eticket'], { merge: true, stay: 'short' })
    expect(await reviewCardCount(a)).toBe(1)
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect((await approve(a, 'foreign')).body.ok).toBe(true)
  })

  it('⑨ 장기체류: 4종 한 번에 → 카드 1건·승인 성공 / 단기·장기 서류가 섞인 3+1은 조합 불충족', async () => {
    const a = await makeActor()
    await upload(a, 'foreign', ['arc_front', 'arc_back', 'passport_photo', 'foreign_fact_cert'], { stay: 'long' })
    expect(await reviewCardCount(a)).toBe(1)
    expect((await approve(a, 'foreign')).body.ok).toBe(true)

    const b = await makeActor()
    pushSpy.mockClear()
    await upload(b, 'foreign', ['arc_front', 'arc_back', 'passport_photo', 'exit_eticket'], { stay: 'long' })
    expect(await reviewCardCount(b)).toBe(0)
    expect(pushSpy).not.toHaveBeenCalled()
    expect((await approve(b, 'foreign')).status).toBe(400)
    // DB(Migration #495)는 파일 4개 이상이면 유형 구성과 무관하게 등록완료 시각을 기록한다 — 구성 검증은 앱 게이트(카드·승인) 몫
    const p = await profileOf(b)
    expect(p.foreign_verified_at).toBeTruthy()
  })
})

describe('DB 기록 — 부분 등록의 verified_at', () => {
  it('⑩ 본인증명 1개만 등록해도 identity_verified_at은 기록된다(카드 게이트는 앱코드·승인 게이트로 분리됨)', async () => {
    const a = await makeActor()
    await upload(a, 'identity', ['driver'])
    const p = await profileOf(a)
    expect(p.identity_verified_at).toBeTruthy()
    expect(await reviewCardCount(a)).toBe(0)
  })
})
