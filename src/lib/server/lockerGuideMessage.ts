/**
 * 무인보관함 이용 안내 문장 조립 — 푸시알림 설정의 "공통 안내문장"이 푸시·문자·채팅카드의 정본 (2026-10-11, Stephen 확정)
 * 대상 고객은 항상 그 예약의 소유자(rental_reservations.user_id) 한 명이다. 이 함수는 문장만 만들고 발송 대상은 호출부가 같은 예약에서 정한다.
 * 문장 = CMS 편집 문장(수령=locker_guide, 반납=locker_return_guide — 없으면 각각의 기본 문구) + 변수(고객이름·상품명·예약코드·수령/반납일시·무인함번호·무인함비밀번호·중앙현관비밀번호·반납기한).
 * 조회 실패는 null — 호출부가 기존 고정 문구로 되돌려 안내가 끊기지 않게 한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { getNotifyMessageOverride } from '$lib/server/notifyMessages'
import { getLockerEntrancePassword } from '$lib/server/lockerEntrance'
import { getNotifySpec, renderLockerGuideMessage, type NotifyVars } from '$lib/utils/notifyTemplate'

export interface LockerGuideComposeOverrides {
  /** CMS "시범 발송"처럼 아직 저장되지 않은 입력값 */
  lockerNumber?: string | null
  lockerPassword?: string | null
  /** 어느 단계의 안내인가 — 수령(기본)은 locker_guide, 반납은 locker_return_guide 문장을 쓴다(2026-10-31, Migration #787) */
  leg?: 'pickup' | 'return'
}

const joinDateTime = (date?: string | null, time?: string | null): string => [date ?? '', time ?? ''].filter(Boolean).join(' ')

export async function composeLockerGuideMessage(
  admin: SupabaseClient,
  reservationId: number,
  overrides?: LockerGuideComposeOverrides,
): Promise<string | null> {
  try {
    const { data: resv } = await admin
      .from('rental_reservations')
      .select('user_id, reservation_code, start_date, end_date, pickup_time, return_time, locker_number, locker_password, products!rental_reservations_product_id_fkey(name, parent_product_id)')
      .eq('id', reservationId)
      .maybeSingle()
    const row = resv as {
      user_id?: string
      reservation_code?: string | null
      start_date?: string | null
      end_date?: string | null
      pickup_time?: string | null
      return_time?: string | null
      locker_number?: string | null
      locker_password?: string | null
      products?: { name?: string } | { name?: string }[] | null
    } | null
    if (!row?.user_id) return null

    await applyParentFieldsToRowProducts([row], ['name'], admin)
    const pf = row.products
    const productName = (Array.isArray(pf) ? pf[0]?.name : pf?.name) ?? '상품'

    const { data: profile } = await admin.from('user_profiles').select('full_name').eq('id', row.user_id).maybeSingle()
    const fullName = (profile as { full_name?: string | null } | null)?.full_name

    const lockerNumber = (overrides?.lockerNumber ?? row.locker_number ?? '').toString().trim()
    const lockerPassword = (overrides?.lockerPassword ?? row.locker_password ?? '').toString().trim()
    const entrance = await getLockerEntrancePassword(admin)

    const vars: NotifyVars = {
      상품명: productName,
      ...(fullName ? { 고객이름: fullName } : {}),
      ...(row.reservation_code ? { 예약코드: row.reservation_code } : {}),
      ...(row.start_date ? { 수령일시: joinDateTime(row.start_date, row.pickup_time) } : {}),
      ...(row.end_date ? { 반납일시: joinDateTime(row.end_date, row.return_time), 반납기한: joinDateTime(row.end_date, row.return_time) } : {}),
      ...(lockerNumber ? { 무인함번호: lockerNumber } : {}),
      ...(lockerPassword ? { 무인함비밀번호: lockerPassword } : {}),
      ...(entrance ? { 중앙현관비밀번호: entrance } : {}),
    }

    const notifyType = overrides?.leg === 'return' ? 'locker_return_guide' : 'locker_guide'
    const template = (await getNotifyMessageOverride(admin, notifyType)) ?? getNotifySpec(notifyType)?.defaultMessage
    if (!template) return null
    const text = renderLockerGuideMessage(template, vars)
    return text || null
  } catch {
    return null
  }
}
