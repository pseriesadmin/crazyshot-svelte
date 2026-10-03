import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/profile/upload-avatar — 전용 버킷 저장 + 이전 아바타 정리 (2026-10-03, 서류 비공개 전환 B3a)
 * 완료기준: user-avatars 버킷에 올리고, DB 반영 성공 뒤에만 이전 아바타(신·구 버킷)를 삭제하며 서류 파일은 절대 지우지 않는다. HEIC는 거부.
 */
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'service-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://example.supabase.co' }))

const rpcRef: { result: { data: unknown; error: { message: string } | null } } = { result: { data: { ok: true }, error: null } }
vi.mock('$lib/utils/rpc', () => ({ callTypedRpc: async () => rpcRef.result }))

const calls: { bucket: string; op: string; arg: unknown }[] = []
const uploadErr: { error: { message: string } | null } = { error: null }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => { calls.push({ bucket, op: 'upload', arg: path }); return uploadErr },
        remove: async (paths: string[]) => { calls.push({ bucket, op: 'remove', arg: paths }); return { error: null } },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    },
  }),
}))

const UID = '6a8f8ee1-ce6e-462f-b7eb-2bd8e0000000'
const prevRef: { url: string | null } = { url: null }
const locals = {
  safeGetSession: async () => ({ session: { user: { id: UID } } }),
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { avatar_url: prevRef.url }, error: null }) }) }) }) },
}

const { POST } = await import('../../routes/api/profile/upload-avatar/+server')
type R = { status: number; data: { ok: boolean; avatarUrl?: string; error?: string } }
function call(type = 'image/webp', name = 'avatar.webp') {
  const fd = new FormData()
  fd.set('file', new File(['x'], name, { type }))
  return POST({ request: { formData: async () => fd }, locals } as unknown as Parameters<typeof POST>[0]) as unknown as Promise<R>
}
const pub = (bucket: string, p: string) => `https://example.supabase.co/storage/v1/object/public/${bucket}/${p}`

describe('POST /api/profile/upload-avatar', () => {
  beforeEach(() => {
    calls.length = 0
    uploadErr.error = null
    rpcRef.result = { data: { ok: true }, error: null }
    prevRef.url = null
  })

  it('user-avatars 버킷에 올리고 공개 URL을 돌려준다(첫 업로드는 삭제 없음)', async () => {
    const r = await call()
    expect(r.status).toBe(200)
    expect(calls[0]).toMatchObject({ bucket: 'user-avatars', op: 'upload' })
    expect(r.data.avatarUrl).toContain('/object/public/user-avatars/')
    expect(calls.some(c => c.op === 'remove')).toBe(false)
  })

  it('교체 성공 후 이전 아바타(전환 이전 user-documents 버킷)를 삭제 — 아바타 파일만', async () => {
    prevRef.url = pub('user-documents', `${UID}/avatar_old.jpg`)
    await call()
    expect(calls.find(c => c.op === 'remove')).toEqual({ bucket: 'user-documents', op: 'remove', arg: [`${UID}/avatar_old.jpg`] })
  })

  it('이전 아바타가 신규 버킷이면 그 버킷에서 삭제', async () => {
    prevRef.url = pub('user-avatars', `${UID}/avatar_old.webp`)
    await call()
    expect(calls.find(c => c.op === 'remove')).toEqual({ bucket: 'user-avatars', op: 'remove', arg: [`${UID}/avatar_old.webp`] })
  })

  it('avatar_url이 서류 파일(또는 타 사용자 파일)을 가리켜도 삭제하지 않는다', async () => {
    prevRef.url = pub('user-documents', `${UID}/identity_a.png`)
    await call()
    expect(calls.some(c => c.op === 'remove')).toBe(false)
    calls.length = 0
    prevRef.url = pub('user-avatars', `11111111-2222-3333-4444-555555555555/avatar_x.jpg`)
    await call()
    expect(calls.some(c => c.op === 'remove')).toBe(false)
  })

  it('DB 반영 실패 시 방금 올린 파일만 롤백하고 이전 아바타는 지우지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    prevRef.url = pub('user-documents', `${UID}/avatar_old.jpg`)
    rpcRef.result = { data: { ok: false }, error: null }
    const r = await call()
    expect(r.status).toBe(500)
    const removes = calls.filter(c => c.op === 'remove')
    expect(removes).toHaveLength(1)
    expect(removes[0].bucket).toBe('user-avatars')
    err.mockRestore()
  })

  it('HEIC/HEIF·PDF는 400(버킷 허용 형식과 일치)', async () => {
    expect((await call('image/heic', 'a.heic')).status).toBe(400)
    expect((await call('image/heif', 'a.heif')).status).toBe(400)
    expect((await call('application/pdf', 'a.pdf')).status).toBe(400)
    expect(calls.some(c => c.op === 'upload')).toBe(false)
  })
})
