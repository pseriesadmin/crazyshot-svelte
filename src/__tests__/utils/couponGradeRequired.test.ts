import { describe, it, expect } from 'vitest'
import { matchesUserGradeRequired, isCouponUserEligible, type CouponEligibilityFields, type CouponEligibilityContext } from '$lib/server/coupons/couponEligibility'

const u = (over: Partial<{ isStudent: boolean; membershipGrade: string | null; hasActiveSubscription: boolean }> = {}) =>
  ({ isStudent: false, membershipGrade: 'NONE', hasActiveSubscription: false, ...over })

describe('필수 회원 분류 판정 — Migration #528 의미(general/student/subscriber)', () => {
  it('미설정이면 누구나 통과', () => {
    expect(matchesUserGradeRequired(null, u())).toBe(true)
    expect(matchesUserGradeRequired('', u({ isStudent: true }))).toBe(true)
  })
  it('general: 학생도 구독도 아닌 회원만', () => {
    expect(matchesUserGradeRequired('general', u())).toBe(true)
    expect(matchesUserGradeRequired('general', u({ isStudent: true }))).toBe(false)
    expect(matchesUserGradeRequired('general', u({ hasActiveSubscription: true }))).toBe(false)
  })
  it('student / subscriber', () => {
    expect(matchesUserGradeRequired('student', u({ isStudent: true }))).toBe(true)
    expect(matchesUserGradeRequired('student', u())).toBe(false)
    expect(matchesUserGradeRequired('subscriber', u({ hasActiveSubscription: true }))).toBe(true)
    expect(matchesUserGradeRequired('subscriber', u({ membershipGrade: 'POP' }))).toBe(true)
    expect(matchesUserGradeRequired('subscriber', u())).toBe(false)
  })
  it('알 수 없는 옛 값은 membership_grade와 같을 때만 통과(하위호환)', () => {
    expect(matchesUserGradeRequired('POP', u({ membershipGrade: 'POP' }))).toBe(true)
    expect(matchesUserGradeRequired('POP', u())).toBe(false)
  })
})

describe('사용자 의존 자격만 판정(isCouponUserEligible) — 주문 조건은 보지 않는다 (B-1)', () => {
  const coupon: CouponEligibilityFields = {
    min_purchase_amount: 0, min_rental_amount: 100000, min_rental_days: 3, is_first_rental_only: false,
    is_student_only: false, is_subscription_only: false, is_walk_in_only: true, per_user_limit: 1, type: 'all', applicable_categories: null,
  }
  const ctx: CouponEligibilityContext = {
    orderAmount: null, minRentalDaysInOrder: null, allWalkIn: null, isFirstRental: true, isStudent: false,
    hasActiveSubscription: false, usedCountForCoupon: 0, cartCategories: null,
  }
  it('주문 컨텍스트가 없어도(draft 카트) 최소금액·일수·방문 전용 쿠폰이 제외되지 않는다', () => {
    expect(isCouponUserEligible(coupon, ctx).ok).toBe(true)
  })
  it('사용자 의존 조건(1인당 한도)은 그대로 적용', () => {
    expect(isCouponUserEligible(coupon, { ...ctx, usedCountForCoupon: 1 })).toEqual({ ok: false, reason: 'PER_USER_LIMIT_EXCEEDED' })
  })
})
