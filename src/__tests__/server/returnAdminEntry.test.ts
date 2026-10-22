import { describe, it, expect } from 'vitest'
import { ADMIN_RETURN_STATUSES, validateAdminReturnEntry } from '$lib/server/returnAdminEntry'
import { buildEvidencePath } from '$lib/server/returnSubmission'
import { INSPECTION_MEDIA_MAX, INSPECTION_NOTE_MAX } from '$lib/utils/inspection'

const UUID = '123e4567-e89b-12d3-a456-426614174000'
const photo = (rid: number, folder = 'admin') => ({ path: `${rid}/${folder}/${UUID}.jpg`, kind: 'photo' as const })

describe('반납정보 관리자 등록 검증', () => {
  it('활성 검수 항목 목록을 넘기면 그 키만 허용한다', () => {
    const r = validateAdminReturnEntry(5, { memo: 'x', checklist: ['i_new', 'body'] }, [{ key: 'i_new' }])
    expect(r.ok && r.value.checklist).toEqual(['i_new'])
  })

  it('사진 또는 메모가 하나는 있어야 한다', () => {
    expect(validateAdminReturnEntry(5, { memo: '', checklist: [], media: [] }).ok).toBe(false)
    expect(validateAdminReturnEntry(5, { memo: '  ', media: [] }).ok).toBe(false)
    expect(validateAdminReturnEntry(5, { memo: '정상 반납', media: [] }).ok).toBe(true)
    expect(validateAdminReturnEntry(5, { media: [photo(5)] }).ok).toBe(true)
  })

  it('체크리스트는 허용 키만 남기고 중복을 제거한다', () => {
    const r = validateAdminReturnEntry(5, { memo: 'x', checklist: ['body', 'body', 'evil'] })
    expect(r.ok && r.value.checklist).toEqual(['body'])
  })

  it('다른 예약·다른 폴더·조작된 경로의 사진은 거절한다', () => {
    expect(validateAdminReturnEntry(5, { media: [photo(6)] }).ok).toBe(false)
    expect(validateAdminReturnEntry(5, { media: [photo(5, 'body')] }).ok).toBe(false) // 고객 제출 폴더
    expect(validateAdminReturnEntry(5, { media: [{ path: `5/../6/admin/${UUID}.jpg`, kind: 'photo' }] }).ok).toBe(false)
    expect(validateAdminReturnEntry(5, { media: [{ path: buildEvidencePath(5, 'admin', 'image/jpeg', UUID), kind: 'photo' }] }).ok).toBe(true)
  })

  it('개수·글자수 상한', () => {
    const many = Array.from({ length: INSPECTION_MEDIA_MAX + 1 }, () => photo(5))
    expect(validateAdminReturnEntry(5, { media: many }).ok).toBe(false)
    expect(validateAdminReturnEntry(5, { memo: 'a'.repeat(INSPECTION_NOTE_MAX + 1) }).ok).toBe(false)
  })

  it('등록 가능한 예약 상태', () => {
    expect([...ADMIN_RETURN_STATUSES].sort()).toEqual(['in_use', 'return_requested', 'returned'])
  })
})
