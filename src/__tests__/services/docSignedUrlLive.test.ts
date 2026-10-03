import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { signDocPath, toDocPath, DOC_BUCKET } from '../../lib/server/userDocs'

/**
 * 서류 서명 URL — Stage 라이브 통합 테스트 (2026-10-03, 서류 비공개 전환 B1)
 * 완료기준: 실제 user-documents 버킷의 파일에 서명 URL이 발급되어 열리고(200), download 옵션이 Content-Disposition으로 내려오며,
 *          공개 URL(전환 전 저장값)도 같은 경로로 해석되어 서명된다. 테스트 파일은 종료 시 제거한다.
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const uid = crypto.randomUUID()
const path = `${uid}/identity_${crypto.randomUUID()}.png`
// 1x1 투명 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

afterAll(async () => {
  await admin.storage.from(DOC_BUCKET).remove([path])
})

describe('signDocPath — 실제 스토리지', () => {
  it('업로드한 파일에 서명 URL이 발급되고 열린다 + download 옵션이 첨부 헤더로 내려온다', async () => {
    const { error } = await admin.storage.from(DOC_BUCKET).upload(path, PNG, { contentType: 'image/png', upsert: false })
    expect(error).toBeNull()

    const plain = await signDocPath(admin, path, { expiresIn: 60 })
    expect(plain?.url).toBeTruthy()
    const r1 = await fetch(plain!.url)
    expect(r1.status).toBe(200)
    expect(r1.headers.get('content-type')).toContain('image/png')

    const dl = await signDocPath(admin, path, { expiresIn: 60, download: 'M1_identity_1.png' })
    const r2 = await fetch(dl!.url)
    expect(r2.status).toBe(200)
    expect(r2.headers.get('content-disposition') ?? '').toContain('M1_identity_1.png')
  })

  it('전환 전 공개 URL 저장값도 같은 경로로 해석되어 서명된다', async () => {
    const publicUrl = admin.storage.from(DOC_BUCKET).getPublicUrl(path).data.publicUrl
    expect(toDocPath(publicUrl, uid)).toBe(path)
    const signed = await signDocPath(admin, toDocPath(publicUrl, uid)!)
    expect(signed?.url).toBeTruthy()
  })

  it('존재하지 않는 경로는 null', async () => {
    const r = await signDocPath(admin, `${uid}/identity_missing.png`)
    expect(r).toBeNull()
  })
})
