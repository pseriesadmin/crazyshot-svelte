import { describe, it, expect } from 'vitest'
import { toAvatarLocation } from '../../lib/server/userAvatars'

/**
 * toAvatarLocation — 이전 아바타 정리 대상 해석 (2026-10-03, 서류 비공개 전환 B3a)
 * 완료기준: 아바타 파일(`{uid}/avatar_`)만 삭제 대상이 되고(서류 파일·타 사용자 파일 제외), 신·구 두 버킷 URL을 모두 해석한다
 */
const UID = '6a8f8ee1-ce6e-462f-b7eb-2bd8e0000000'
const OTHER = '11111111-2222-3333-4444-555555555555'
const f = `${UID}/avatar_9f1c0f1e-0000-4000-8000-000000000000.jpg`
const base = 'https://x.supabase.co/storage/v1/object/public'

describe('toAvatarLocation', () => {
  it('신규 버킷(user-avatars)·전환 이전 버킷(user-documents) 아바타 URL을 해석', () => {
    expect(toAvatarLocation(`${base}/user-avatars/${f}`, UID)).toEqual({ bucket: 'user-avatars', path: f })
    expect(toAvatarLocation(`${base}/user-documents/${f}`, UID)).toEqual({ bucket: 'user-documents', path: f })
  })
  it('쿼리·해시 제거', () => {
    expect(toAvatarLocation(`${base}/user-avatars/${f}?t=1#x`, UID)?.path).toBe(f)
  })
  it('서류 파일(identity_/foreign_)은 같은 버킷·같은 사용자라도 삭제 대상이 아니다', () => {
    expect(toAvatarLocation(`${base}/user-documents/${UID}/identity_aaaa.png`, UID)).toBeNull()
    expect(toAvatarLocation(`${base}/user-documents/${UID}/foreign_aaaa.png`, UID)).toBeNull()
  })
  it('타 사용자 폴더·경로 탈출·제어문자·알 수 없는 URL·null은 거부', () => {
    expect(toAvatarLocation(`${base}/user-avatars/${OTHER}/avatar_x.jpg`, UID)).toBeNull()
    expect(toAvatarLocation(`${base}/user-avatars/${UID}/avatar_x/../../${OTHER}/avatar_y.jpg`, UID)).toBeNull()
    expect(toAvatarLocation(`${base}/user-avatars/${UID}/avatar_%00.jpg`, UID)).toBeNull()
    expect(toAvatarLocation(`${base}/product-images/${f}`, UID)).toBeNull()
    expect(toAvatarLocation('https://example.com/a.jpg', UID)).toBeNull()
    expect(toAvatarLocation(null, UID)).toBeNull()
    expect(toAvatarLocation('', UID)).toBeNull()
  })
})
