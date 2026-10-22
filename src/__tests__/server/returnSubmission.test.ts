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
  const courierAll = [photo('body'), photo('accessories'), photo('package')]
  const lockerAll = [photo('locker'), photo('device')]

  it('택배: 사진 항목마다 1장씩 + 체크리스트 전부 필요', () => {
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: courierAll }).ok).toBe(true)
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [] }).ok).toBe(false)
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked.slice(1), media: courierAll }).ok).toBe(false)
    // CMS '검수 항목 등록' 기준 목록(고객검수 ON 항목)으로 검증 — 항목이 2개면 2개만 체크해도 통과, 목록 밖 키는 무시
    const custom = [{ key: 'body' }, { key: 'i_new' }]
    expect(validateReturnSubmit('courier', 5, { checklist: ['body', 'i_new'], media: courierAll }, custom).ok).toBe(true)
    expect(validateReturnSubmit('courier', 5, { checklist: ['body'], media: courierAll }, custom).ok).toBe(false)
    expect(validateReturnSubmit('courier', 5, { checklist: ['body', 'packed'], media: courierAll }, custom).ok).toBe(false)
    // CMS '사진등록 항목' 기준 사진 카드 — 목록에 있는 키만 허용(택배), 다른 방식은 고정 항목
    const photos = [{ key: 'p_abcdefgh' }]
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [photo('p_abcdefgh')] }, undefined, photos).ok).toBe(true)
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [photo('body')] }, undefined, photos).ok).toBe(false)
  })

  it('택배: 사진 항목 중 하나라도 비어 있으면 거절한다(전 항목 필수)', () => {
    const missingOne = validateReturnSubmit('courier', 5, { checklist: allChecked, media: [photo('body'), photo('accessories')] })
    expect(missingOne.ok).toBe(false)
    if (!missingOne.ok) expect(missingOne.error).toContain('모든 사진 항목')
    // 한 항목에 여러 장을 올려도 다른 항목이 비어 있으면 거절
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [photo('body'), photo('body'), photo('body')] }).ok).toBe(false)
    // 항목마다 1장 이상이면 통과(항목당 여러 장도 허용)
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [...courierAll, photo('body')] }).ok).toBe(true)
  })

  it('택배: 허용되지 않은 항목·남의 예약 경로·장수 초과를 거절한다', () => {
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [...courierAll, photo('locker')] }).ok).toBe(false)
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [...courierAll, { item_key: 'body', path: `6/body/${UUID}.jpg`, kind: 'photo' }] }).ok).toBe(false)
    const six = Array.from({ length: 6 }, () => photo('body'))
    expect(validateReturnSubmit('courier', 5, { checklist: allChecked, media: [...six, photo('accessories'), photo('package')] }).ok).toBe(false)
  })

  it('무인함: 사진 항목마다 1장씩 + 번호(1~10자)·비밀번호(4~10자, 숫자·특수문자)', () => {
    const ok = validateReturnSubmit('locker', 5, { media: lockerAll, locker_number: '12', locker_password: '*8821' })
    expect(ok.ok).toBe(true)
    expect(validateReturnSubmit('locker', 5, { media: lockerAll, locker_number: '12', locker_password: '12' }).ok).toBe(false)
    expect(validateReturnSubmit('locker', 5, { media: lockerAll, locker_number: 'ab', locker_password: '1234' }).ok).toBe(false)
    expect(validateReturnSubmit('locker', 5, { media: [], locker_number: '12', locker_password: '1234' }).ok).toBe(false)
    // 사진 항목 하나만 올리면 거절
    expect(validateReturnSubmit('locker', 5, { media: [photo('locker')], locker_number: '12', locker_password: '1234' }).ok).toBe(false)
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

describe('이용 평가(feedback) 검증 — 반납등록 미션 3단계', () => {
  const base = { checklist: allChecked, media: ['body', 'accessories', 'package'].map((k) => ({ item_key: k, path: `5/${k}/${UUID}.jpg`, kind: 'photo' })) }

  it('미입력·공백만이면 null (선택 입력)', () => {
    const none = validateReturnSubmit('courier', 5, base)
    expect(none.ok && none.value.feedback).toBeNull()
    const blank = validateReturnSubmit('courier', 5, { ...base, feedback: '   ' })
    expect(blank.ok && blank.value.feedback).toBeNull()
  })

  it('앞뒤 공백은 제거하고 저장 값으로 돌려준다', () => {
    const r = validateReturnSubmit('courier', 5, { ...base, feedback: '  배송이 빨라서 좋았어요  ' })
    expect(r.ok && r.value.feedback).toBe('배송이 빨라서 좋았어요')
  })

  it('정확히 100자는 통과, 101자는 거절', () => {
    expect(validateReturnSubmit('courier', 5, { ...base, feedback: 'ㄱ'.repeat(100) }).ok).toBe(true)
    const over = validateReturnSubmit('courier', 5, { ...base, feedback: 'ㄱ'.repeat(101) })
    expect(over.ok).toBe(false)
  })

  it('문자열이 아니면 무시(null)', () => {
    const r = validateReturnSubmit('courier', 5, { ...base, feedback: 123 })
    expect(r.ok && r.value.feedback).toBeNull()
  })
})

describe('이용 평가 점수(rating) 검증 — 1~5 선택 입력', () => {
  const base = { checklist: allChecked, media: ['body', 'accessories', 'package'].map((k) => ({ item_key: k, path: `5/${k}/${UUID}.jpg`, kind: 'photo' })) }

  it('미입력이면 null', () => {
    const r = validateReturnSubmit('courier', 5, base)
    expect(r.ok && r.value.rating).toBeNull()
    const n = validateReturnSubmit('courier', 5, { ...base, rating: null })
    expect(n.ok && n.value.rating).toBeNull()
  })

  it('1~5 정수는 그대로 통과', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      const r = validateReturnSubmit('courier', 5, { ...base, rating: v })
      expect(r.ok && r.value.rating).toBe(v)
    }
  })

  it('0·6·소수·문자열은 거절', () => {
    for (const v of [0, 6, 3.5, '4', -1, NaN]) {
      expect(validateReturnSubmit('courier', 5, { ...base, rating: v }).ok).toBe(false)
    }
  })
})
