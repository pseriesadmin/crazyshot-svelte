import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { signDocPath, DOC_BUCKET } from '../../lib/server/userDocs'
import { AVATAR_BUCKET } from '../../lib/server/userAvatars'

/**
 * 서류 비공개 전환 이후(#638) — Stage 라이브 통합 테스트 (2026-10-04)
 * 완료기준: ① user-documents 서류는 로그인 없이 공개 URL로 열리지 않는다 ② 서버가 발급한 서명 URL로만 열린다
 *          ③ user-avatars(아바타 전용)는 계속 공개 URL로 열린다 ④ 버킷 설정 자체가 의도대로다(서류 비공개·아바타 공개)
 * 테스트 파일은 종료 시 제거한다.
 */
// Stage 전용 — 실수로 Production 키·URL로 실행돼 파일을 올리고 지우는 일을 막는다
if (!PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')) {
  throw new Error('docBucketPrivateLive는 Stage(ezyvffjvuwmtuhpxdjrw) 전용입니다.')
}
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const uid = crypto.randomUUID()
const docPath = `${uid}/identity_${crypto.randomUUID()}.png`
const avatarPath = `${uid}/avatar_${crypto.randomUUID()}.png`
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

afterAll(async () => {
  await admin.storage.from(DOC_BUCKET).remove([docPath])
  await admin.storage.from(AVATAR_BUCKET).remove([avatarPath])
})

describe('서류 버킷 비공개(#638)', () => {
  it('버킷 설정: user-documents 비공개, user-avatars 공개', async () => {
    const { data: docs } = await admin.storage.getBucket(DOC_BUCKET)
    const { data: avatars } = await admin.storage.getBucket(AVATAR_BUCKET)
    expect(docs?.public).toBe(false)
    expect(avatars?.public).toBe(true)
  })

  it('서류: 공개 URL은 로그인 없이 열리지 않고, 서명 URL로만 열린다', async () => {
    const { error } = await admin.storage.from(DOC_BUCKET).upload(docPath, PNG, { contentType: 'image/png', upsert: false })
    expect(error).toBeNull()

    const publicUrl = `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/${DOC_BUCKET}/${docPath}`
    const anon = await fetch(publicUrl, { credentials: 'omit' })
    expect(anon.status).not.toBe(200)
    expect(anon.ok).toBe(false)

    const signed = await signDocPath(admin, docPath, { expiresIn: 60 })
    expect(signed?.url).toBeTruthy()
    const viaSigned = await fetch(signed!.url)
    expect(viaSigned.status).toBe(200)
    expect(viaSigned.headers.get('content-type')).toContain('image/png')
  })

  it('아바타: user-avatars는 공개 URL로 계속 열린다', async () => {
    const { error } = await admin.storage.from(AVATAR_BUCKET).upload(avatarPath, PNG, { contentType: 'image/png', upsert: false })
    expect(error).toBeNull()
    const url = admin.storage.from(AVATAR_BUCKET).getPublicUrl(avatarPath).data.publicUrl
    const res = await fetch(url, { credentials: 'omit' })
    expect(res.status).toBe(200)
  })
})
