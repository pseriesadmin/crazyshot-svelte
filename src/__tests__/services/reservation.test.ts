import { describe, it, expect } from 'vitest';
import { supabase } from '$lib/services/supabase';

/**
 * S1-M2 Reservation Flow Tests (TDD)
 * Schema: Migration 166(reservation_redesign_child_products) 이후 기준 — BIGINT reservation id,
 *         자식 상품(부모 parent_product_id 하위 재고 단위)을 직접 배정하는 방식
 *
 * 2026-08-05 재작성 사유:
 *   기존 테스트는 atomic_reserve_asset(p_product_id, p_start_date, p_end_date, p_user_id) +
 *   assets 테이블 기반이었으나, 이 RPC/흐름은 어디에서도 호출되지 않는 고아 코드로 확인됨
 *   (S1-M3 결제 통합 BLOCKED 당시 만들어진 /api/checkout/initiate 전용, 프론트 미연결).
 *   실제 살아있는 예약 생성 경로는 create_hold_reservation RPC(products/[id]/+page.svelte)로 대체.
 *
 * ⚠️ 알려진 제약: create_hold_reservation은 p_user_id 파라미터를 받지 않고 내부에서
 *   auth.uid()를 직접 읽는 SECURITY DEFINER 함수로 변경됨 — 로그인 세션 없이는
 *   블랙리스트·신용점수·재고배정 등 인증 이후 분기를 재현할 수 없음. 이 프로젝트에는
 *   시드 테스트 계정(이메일/비밀번호) 및 로그인 기반 통합테스트 인프라가 아직 없어
 *   해당 케이스는 it.skip으로 남겨두고 사유를 각 테스트에 명시함.
 *   (다른 최신 테스트 confirmMock/productNew 등은 전부 Supabase mock 방식 — 이 파일은
 *    라이브 DB에 실제로 붙는 예전 통합테스트 스타일을 유지하되 인증 불필요 범위로 축소)
 */

const SEED_PRODUCT_ID = '00000000-0000-0000-0000-000000000001'; // 실제 존재 보장 없음 — 인증 필요 케이스에서만 사용(현재 skip)

const dateStr = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
};

// create_hold_reservation(p_product_id uuid, p_start_date date, p_end_date date)
//   → TABLE(success boolean, reservation_id bigint, asset_id bigint, error_message text)
// asset_id는 하위호환 목적으로 반환 shape에 남아있으나 항상 NULL — 실제 배정은
// rental_reservations.product_id(자식 상품 UUID)로 저장되고 호출자에게 반환되지 않음.
type CreateHoldReservationRow = {
  success: boolean;
  reservation_id: number | null;
  asset_id: number | null;
  error_message: string | null;
};
type CreateHoldReservationFn = (
  name: 'create_hold_reservation',
  args: { p_product_id: string; p_start_date: string; p_end_date: string }
) => Promise<{ data: CreateHoldReservationRow[] | null; error: { message: string } | null }>;

async function callCreateHoldReservation(productId: string, startDate: string, endDate: string) {
  const { data, error } = await (supabase.rpc as unknown as CreateHoldReservationFn)(
    'create_hold_reservation',
    { p_product_id: productId, p_start_date: startDate, p_end_date: endDate }
  );
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

describe('Reservation System (create_hold_reservation 기준)', () => {
  describe('create_hold_reservation — 인증 없는 호출', () => {
    it('RED: 비로그인 상태 → success=false + "로그인이 필요합니다."', async () => {
      // supabase는 vitest(Node) 환경의 신규 클라이언트라 활성 세션이 없음 — auth.uid() IS NULL 경로
      const row = await callCreateHoldReservation(SEED_PRODUCT_ID, dateStr(1), dateStr(3));

      expect(row?.success).toBe(false);
      expect(row?.error_message).toBe('로그인이 필요합니다.');
      expect(row?.reservation_id).toBeNull();
    });
  });

  describe('create_hold_reservation — 인증 필요 케이스 (현재 검증 불가)', () => {
    // 아래 케이스들은 함수 내부에서 auth.uid()로 로그인 유저를 판별하므로,
    // p_user_id 파라미터로 유저를 흉내내던 예전 방식이 더 이상 통하지 않음.
    // 실제 검증하려면 (1) 시드 테스트 계정 생성 + signInWithPassword() 로그인,
    // (2) credit_score/blacklisted 상태를 아는 user_profiles row, (3) 예약 가능한
    // 자식 상품(parent_product_id 하위 is_active=true, 미예약)이 필요 — 현재 프로젝트에
    // 이 셋 중 어느 것도 시드/픽스처로 존재하지 않아 skip 처리함.

    it.skip('블랙리스트 계정 → "서비스 이용이 제한된 계정입니다." (로그인 세션 필요 — 미구현)', () => {});

    it.skip('credit_score < 30 계정 → "신용점수가 낮아 예약이 제한됩니다." (로그인 세션 필요 — 미구현)', () => {});

    it.skip('가용 자식 상품 있음 → success=true + reservation_id(bigint) 반환, rental_reservations.status=hold (로그인 세션 필요 — 미구현)', () => {});

    it.skip('해당 기간 예약 가능 재고 없음 → "해당 기간에 예약 가능한 재고가 없습니다." (로그인 세션 필요 — 미구현)', () => {});

    it.skip('동일 기간 중복 예약 시도 → 서로 다른 자식 상품 배정 또는 재고소진 실패 (로그인 세션 필요 — 미구현)', () => {});
  });

  describe('날짜 검증 (순수 로직 — DB 불필요)', () => {
    it('GREEN: 날짜 형식(YYYY-MM-DD) 검증', () => {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      expect(dateRegex.test(dateStr(0))).toBe(true);
      expect(dateRegex.test('06/01/2026')).toBe(false);
    });

    it('REFACTOR: end_date >= start_date 검증 (서버 CHECK 제약 전 클라이언트 선검증)', () => {
      const start = '2026-06-10';
      const end = '2026-06-05';

      expect(new Date(end) >= new Date(start)).toBe(false);
    });
  });

  describe('대여 라이프사이클 상태 머신 (rental-lifecycle.md 기준)', () => {
    it('REFACTOR: 유효한 상태 전환 검증', () => {
      // rental-lifecycle.md 확정 상태 머신 + nextStatus()(RentalDetailPanel.svelte) 분기 반영:
      //   confirmed → in_use는 방문수령(pickup_method='visit')일 때만 shipped를 건너뜀
      //   in_use → returned는 방문반납(return_method='visit')일 때만 return_requested를 건너뜀
      //   damage_claimed는 대여가 실제 진행 중인 단계(confirmed 이후)에서 어느 시점이든 가능
      const validTransitions: Record<string, string[]> = {
        pending:          ['hold', 'cancelled'],
        hold:             ['confirmed', 'cancelled'],
        confirmed:        ['shipped', 'in_use', 'cancelled', 'damage_claimed'],
        shipped:          ['in_use', 'damage_claimed'],
        in_use:           ['return_requested', 'returned', 'damage_claimed'],
        return_requested: ['returned', 'damage_claimed'],
        returned:         ['completed'],
        completed:        [], // Terminal
        cancelled:        [], // Terminal
        damage_claimed:   [], // Terminal — 별도 파손처리 플로우로 이관
      };

      expect(validTransitions.hold).toContain('confirmed');
      expect(validTransitions.confirmed).not.toContain('hold');
      expect(validTransitions.confirmed).toContain('in_use'); // 방문수령 시 shipped 스킵
      expect(validTransitions.in_use).toContain('returned');   // 방문반납 시 return_requested 스킵
      expect(validTransitions.returned).toEqual(['completed']);
      expect(validTransitions.completed).toEqual([]);
      expect(validTransitions.cancelled).toEqual([]);
    });
  });

  describe('Cart Total 연동 (calculate_cart_total) — 현재 검증 불가', () => {
    // calculate_cart_total(p_reservation_ids bigint[])도 유효한 reservation_id가 필요하고,
    // 그 reservation_id는 위와 동일하게 로그인 세션 하에서만 생성 가능 — 동일 사유로 skip.
    it.skip('예약 후 cart total 계산 → final_total > 0 (로그인 세션 필요 — 미구현)', () => {});
    it.skip('할인 적용 후 final_total ≤ subtotal (로그인 세션 필요 — 미구현)', () => {});
  });
});
