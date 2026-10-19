import { describe, it, expect } from 'vitest'
import {
  buildEvidencePath,
  isOwnedEvidencePath,
  mediaKindFromMime,
  validateMediaFile,
  validateReturnSubmit,
} from '$lib/server/returnSubmission'
import { RETURN_CHECKLIST_ITEMS } from '$lib/utils/returnNotice'

const UUID = '123e4567-e89b-12d3-a456-426614174000'
const allChecked = RETURN_CHECKLIST_ITEMS.map((i) => i.key)

describe('반납 증빙 파일 검증', () => {
  it('사진·영상 구분과 허용 형식', () => {
    expect(mediaKindFromMime('image/jpeg')).toBe('photo')
    expect(mediaKindFromMime('video/mp4')).toBe('video')
    expect(mediaKindFromMime('application/pdf')).toBeNull()
    expect(mediaKindFromMime('image/gif')).toBeNull()
  })

  it('용량 상한: 사진 10MB / 영상 100MB', () => {
    expect(validateMediaFile('image/jpeg', 10 * 1024 * 1024).ok).toBe(true)
    expect(validateMediaFile('image/jpeg', 10 * 1024 * 1024 + 1).ok).toBe(false)
    expect(validateMediaFile('video/mp4', 100 * 1024 * 1024).ok).toBe(true)
    expect(validateMediaFile('video/mp4', 100 * 1024 * 1024 + 1).ok).toBe(false)
    expect(validateMediaFile('image/jpeg', 0).ok).toBe(false)
  })
})

describe('증빙 경로 소유 확인', () => {
  it('본인 예약 폴더의 경로만 인정한다', () => {
    const p = buildEvidencePath(77, 'body', 'image/jpeg', UUID)
    expect(p).toBe(`77/body/${UUID}.jpg`)
    expect(isOwnedEvidencePath(p, 77)).toBe(true)
    expect(isOwnedEvidencePath(p, 78)).toBe(false) // 다른 예약
    expect(isOwnedEvidencePath(`77/../78/body/${UUID}.jpg`, 77)).toBe(false) // 경로 조작
    expect(isOwnedEvidencePath(`77/body/${UUID}.exe`, 77)).toBe(false)
  })
})

describe('제출 본문 검증 (방식별 요건 서버 재집행)', () => {
  const photo = (key: string) => ({ item_key: key, path: `5/${key}/${UUID}.jpg`, kind: 'photo' })

  it('택배: 사진 1장 이상 + 체크리스트 전부 필요', () => {
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [photo('body')] }).ok).toBe(true)
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [] }).ok).toBe(false)
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked.slice(1), media: [photo('body')] }).ok).toBe(false)
  })

  it('택배: 허용되지 않은 항목·남의 예약 경로·장수 초과를 거절한다', () => {
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [photo('locker')] }).ok).toBe(false)
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [{ item_key: 'body', path: `6/body/${UUID}.jpg`, kind: 'photo' }] }).ok).toBe(false)
    const six = Array.from({ length: 6 }, () => photo('body'))
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: six }).ok).toBe(false)
  })

  it('무인함: 사진 + 번호(1~10자)·비밀번호(4~10자, 숫자·특수문자)', () => {
    const ok = validateReturnSubmit('locker', 5, { media: [photo('locker')], locker_number: '12', locker_password: '*8821' })
    expect(ok.ok).toBe(true)
    expect(validateReturnSubmit('locker', 5, { media: [photo('locker')], locker_number: '12', locker_password: '12' }).ok).toBe(false)
    expect(validateReturnSubmit('locker', 5, { media: [photo('locker')], locker_number: 'ab', locker_password: '1234' }).ok).toBe(false)
    expect(validateReturnSubmit('locker', 5, { media: [], locker_number: '12', locker_password: '1234' }).ok).toBe(false)
  })

  it('퀵: 아무 입력 없이 제출할 수 있다', () => {
    const r = validateReturnSubmit('quick', 5, {})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.media).toEqual([])
      expect(r.value.locker_number).toBeNull()
    }
  })
})
