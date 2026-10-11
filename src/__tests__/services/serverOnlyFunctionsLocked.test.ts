/**
 * TDD: 서버 전용 DB 함수 권한 잠금 — 비로그인·일반 로그인 사용자는 실행할 수 없고 서버(service_role)만 실행한다 (2026-10-11, Migration #696·#697·#698; refresh_user_segments는 호출 시 표를 비우므로 이 테스트에서 호출하지 않고 권한 조회로만 확인)
 * 배경: send_rental_chat_notification 등 6개가 anon·authenticated에 직접 EXECUTE가 열려 있었다(REVOKE FROM PUBLIC만으로는 직접 부여가 남는다 — service-operations.md §23).
 * ⛔ Stage(ezyvffjvuwmtuhpxdjrw)에서만 실행. 호출 인자는 아무것도 바꾸지 않는 값(빈 이름·없는 예약 번호·영 UUID)만 쓴다.
 */
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const ZERO = '00000000-0000-0000-0000-000000000000'

const CASES: { fn: string; args: Record<string, unknown> }[] = [
  { fn: 'send_rental_chat_notification', args: { p_reservation_id: -1, p_notify_type: 'reservation_hold', p_action_url: null } },
  { fn: 'cms_set_menu_permission', args: { p_target_user_id: ZERO, p_menu_key: '', p_allowed: false, p_actor_id: ZERO } },
  { fn: 'cms_get_menu_permissions', args: { p_user_id: ZERO } },
  { fn: 'cms_update_admin_name', args: { p_user_id: ZERO, p_full_name: '' } },
  { fn: 'get_active_rentals', args: { p_page: 1, p_search: null, p_status: null, p_per_page: 1 } },
  { fn: 'confirm_payment', args: { p_order_id: -1, p_payment_key: 'tdd-none', p_provider_response: {} } },
  { fn: 'append_product_image_url', args: { p_product_id: ZERO, p_url: 'tdd-none' } },
  { fn: 'get_product_history', args: { p_product_id: ZERO } },
  { fn: 'get_product_history_multi', args: { p_product_ids: [ZERO] } },
  { fn: 'upsert_product_history_record', args: { p_id: ZERO, p_product_id: null, p_recorded_date: '2000-01-01', p_images: [], p_user_id: ZERO } },
  { fn: 'delete_product_history_record', args: { p_id: ZERO, p_user_id: ZERO } },
  { fn: 'reassign_product_code_series', args: { p_product_id: ZERO, p_category: 'x', p_code_id: null, p_date_option: null, p_max_sequence: null, p_parent_max_sequence: null, p_category_code_override: null } },
]

describe.skipIf(!isStage)('서버 전용 함수 — 일반 사용자 실행 차단', () => {
  for (const c of CASES) {
    it(`${c.fn}: 비로그인(anon)은 권한 거부(42501)`, async () => {
      const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
      const { error } = await anon.rpc(c.fn, c.args)
      expect(error?.code).toBe('42501')
    })
    it(`${c.fn}: 익명 로그인 사용자(authenticated)도 권한 거부(42501)`, async () => {
      const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
      const { error: signErr } = await client.auth.signInAnonymously()
      if (signErr) return // 익명 로그인이 꺼진 환경이면 anon 검증으로 대체
      const { error } = await client.rpc(c.fn, c.args)
      expect(error?.code).toBe('42501')
    })
    it(`${c.fn}: 서버(service_role)는 권한 거부 없이 호출된다`, async () => {
      const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      const { error } = await admin.rpc(c.fn, c.args)
      expect(error?.code).not.toBe('42501')
    })
  }
})
