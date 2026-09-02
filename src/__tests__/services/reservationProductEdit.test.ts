import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

/**
 * Stage 1 — CMS 예약상품 편집 RPC 6종 TDD 통합 테스트
 * Harness Flow v3.2 — Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트
 *
 * 대상: Migration 428(cms_reservation_product_edit_rpcs) + Migration 430(REVOKE 보강,
 * 원래 423으로 생성됐으나 428 재작성 후 리플레이 순서 정합을 위해 재번호됨, 2026-09-03) +
 * Migration 429(게이트 거부 메시지 상태별 세분화)
 * 플랜: /Users/stevenmac/.claude/plans/cms-cms-reservation-selected-7972-sprightly-quilt.md
 *
 * 검증 RPC 6종:
 *   ① cms_add_reservation_product_unit    — 메인상품 유닛 추가 (재고 원자배정)
 *   ② cms_remove_reservation_product_unit — 메인상품 유닛 소프트 취소
 *   ③ cms_add_reservation_option          — 옵션상품 추가
 *   ④ cms_update_reservation_option_qty   — 옵션상품 수량 수정
 *   ⑤ cms_delete_reservation_option       — 옵션상품 삭제
 *   ⑥ cms_reassign_reservation_product_code — 상품코드(실물 재고단위) 재배정
 *
 * 이 테스트는 holdExpiration.test.ts / paymentContractOrderRedesign.test.ts와 동일한
 * 라이브 통합테스트 관례를 따른다 — 테스트 전용 부모/자식 상품·예약·주문 픽스처를
 * 직접 INSERT로 생성하고 afterEach/afterAll에서 정리한다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

let sharedUserId: string;

beforeAll(async () => {
  const email = `tdd-rpe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  sharedUserId = data.user.id;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(sharedUserId).catch(() => undefined);
});

// ── 픽스처 헬퍼 ────────────────────────────────────────────────────────────────

let seq = 0;
function nextTag(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq}${Math.random().toString(36).slice(2, 6)}`;
}

async function createParentProduct(label: string): Promise<string> {
  const tag = nextTag();
  const { data, error } = await admin
    .from('products')
    .insert({
      category: 'camera',
      name: `TDD-RPE ${label} ${tag}`,
      slug: `tdd-rpe-${tag}-${label.toLowerCase()}`,
      is_active: true,
      parent_product_id: null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`parent product 생성 실패(${label}): ${error?.message}`);
  return data.id as string;
}

async function createChildUnit(parentId: string, label: string): Promise<string> {
  const tag = nextTag();
  const { data, error } = await admin
    .from('products')
    .insert({
      category: 'camera',
      name: `TDD-RPE ${label} child ${tag}`,
      slug: `tdd-rpe-${tag}-${label.toLowerCase()}-child`,
      is_active: true,
      parent_product_id: parentId,
      product_code: `TDDRPE${tag.toUpperCase()}`.slice(0, 20),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`child product 생성 실패(${label}): ${error?.message}`);
  return data.id as string;
}

async function insertPriceRule(parentId: string, price: number): Promise<void> {
  const { error } = await admin.from('price_rules').insert({
    product_id: parentId,
    duration_type: '24h',
    price,
    is_active: true,
  });
  if (error) throw new Error(`price_rules 생성 실패: ${error.message}`);
}

function futureRange(offsetDays: number): { start: string; end: string } {
  const base = Date.UTC(2032, 0, 1) + offsetDays * 86400000;
  const start = new Date(base);
  const end = new Date(base + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createReservation(
  productId: string,
  status: string,
  range: { start: string; end: string },
  opts?: { paymentConfirmedAt?: string | null; trackingNumber?: string | null }
): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: sharedUserId,
      product_id: productId,
      status,
      start_date: range.start,
      end_date: range.end,
      pickup_method: 'visit',
      return_method: 'visit',
      duration_type: '24h',
      payment_confirmed_at: opts?.paymentConfirmedAt ?? null,
      tracking_number: opts?.trackingNumber ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  return data.id as number;
}

async function updateReservation(
  reservationId: number,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await admin.from('rental_reservations').update(patch).eq('id', reservationId);
  if (error) throw new Error(`reservation 갱신 실패: ${error.message}`);
}

async function getReservation(
  reservationId: number
): Promise<{ status: string; product_id: string; payment_confirmed_at: string | null; tracking_number: string | null } | null> {
  const { data } = await admin
    .from('rental_reservations')
    .select('status, product_id, payment_confirmed_at, tracking_number')
    .eq('id', reservationId)
    .single();
  return (
    (data as {
      status: string;
      product_id: string;
      payment_confirmed_at: string | null;
      tracking_number: string | null;
    } | undefined) ?? null
  );
}

async function linkOrder(reservationIds: number[]): Promise<number> {
  const { data, error } = await admin.rpc('create_reservation_order', {
    p_user_id: sharedUserId,
    p_reservation_ids: reservationIds,
  });
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`);
  const row = (data as Array<{ order_id: number }> | null)?.[0];
  if (!row) throw new Error('create_reservation_order 빈 응답');
  return row.order_id;
}

async function getOrderItem(
  reservationId: number
): Promise<{ order_id: number; product_id: string; unit_price: number; line_total: number } | null> {
  const { data } = await admin
    .from('order_items')
    .select('order_id, product_id, unit_price, line_total')
    .eq('reservation_id', reservationId)
    .maybeSingle();
  return (
    (data as { order_id: number; product_id: string; unit_price: number; line_total: number } | undefined) ?? null
  );
}

async function insertOption(
  reservationId: number,
  optionName: string,
  qty: number
): Promise<number> {
  const { data, error } = await admin
    .from('reservation_options')
    .insert({ reservation_id: reservationId, option_name: optionName, qty, unit_price: 1000 })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation_options 생성 실패: ${error?.message}`);
  return data.id as number;
}

async function getOption(
  optionId: number
): Promise<{ qty: number } | null> {
  const { data } = await admin.from('reservation_options').select('qty').eq('id', optionId).maybeSingle();
  return (data as { qty: number } | undefined) ?? null;
}

// ── RPC 호출 헬퍼 (테이블 반환 함수 — 배열의 첫 행 추출) ──────────────────────────

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(`${name} 호출 실패: ${error.message}`);
  const rows = data as T[] | null;
  if (!rows || rows.length === 0) throw new Error(`${name} 빈 응답`);
  return rows[0];
}

type AddUnitResult = { success: boolean; new_reservation_id: number | null; error_message: string | null };
type SimpleResult = { success: boolean; error_message: string | null };
type AddOptionResult = { success: boolean; option_id: number | null; error_message: string | null };

// ── 정리 대상 레지스트리 ──────────────────────────────────────────────────────
// products(children)는 rental_reservations.product_id FK를 갖고 있어 예약행 삭제가
// 선행돼야 한다 — 항상 order_items → rental_reservations(옵션은 CASCADE) → products(child)
// → products(parent) → orders 순서로 정리한다.

function registerCleanup(fn: Cleanup): void {
  cleanups.push(fn);
}

async function deleteOrderItemsByReservation(reservationIds: number[]): Promise<void> {
  if (reservationIds.length === 0) return;
  await admin.from('order_items').delete().in('reservation_id', reservationIds);
}

async function deleteReservations(reservationIds: number[]): Promise<void> {
  if (reservationIds.length === 0) return;
  await admin.from('rental_reservations').delete().in('id', reservationIds);
}

async function deleteProducts(productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  await admin.from('products').delete().in('id', productIds);
}

async function deletePriceRules(parentIds: string[]): Promise<void> {
  if (parentIds.length === 0) return;
  await admin.from('price_rules').delete().in('product_id', parentIds);
}

async function deleteOrders(orderIds: number[]): Promise<void> {
  if (orderIds.length === 0) return;
  await admin.from('orders').delete().in('id', orderIds);
}

// ═══════════════════════════════════════════════════════════════════════════
// 공통 게이트 — status='hold' AND payment_confirmed_at IS NULL 재검증 (①~⑤)
// ═══════════════════════════════════════════════════════════════════════════
describe('공통 게이트 — status≠hold 또는 payment_confirmed_at 존재 시 전부 차단', () => {
  // Migration 429(2026-09-03): 거부 사유를 상태별로 세분화 — 실사용 중 "만료"와 "결제/계약
  // 진행"이 하나의 문구로 뭉뚱그려져 혼동을 유발한 것을 발견해 수정. 시나리오별 정확한
  // 메시지를 기대값으로 검증한다(플랜 문서 §Stage1과 무관, 별도 QA 발견 수정).
  const CONTRACT_MSG = '이미 계약이 진행되어 상품 구성을 수정할 수 없습니다.';
  const PAID_MSG = '이미 결제가 진행되어 상품 구성을 수정할 수 없습니다.';
  const EXPIRED_MSG = '예약이 만료되어 상품 구성을 수정할 수 없습니다.';
  const CANCELLED_MSG = '취소된 예약은 상품 구성을 수정할 수 없습니다.';

  it('① cms_add_reservation_product_unit — status=confirmed면 차단', async () => {
    const parent = await createParentProduct('GATE-ADD-A');
    const child = await createChildUnit(parent, 'GATE-ADD-A');
    const range = futureRange(1);
    const resId = await createReservation(child, 'confirmed', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<AddUnitResult>('cms_add_reservation_product_unit', {
      p_reservation_id: resId,
      p_product_id: parent,
    });
    expect(result.success).toBe(false);
    expect(result.new_reservation_id).toBeNull();
    expect(result.error_message).toBe(CONTRACT_MSG);
  });

  it('① cms_add_reservation_product_unit — status=hold이지만 payment_confirmed_at 존재 시 차단', async () => {
    const parent = await createParentProduct('GATE-ADD-B');
    const child = await createChildUnit(parent, 'GATE-ADD-B');
    const range = futureRange(2);
    const resId = await createReservation(child, 'hold', range, {
      paymentConfirmedAt: new Date().toISOString(),
    });
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<AddUnitResult>('cms_add_reservation_product_unit', {
      p_reservation_id: resId,
      p_product_id: parent,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(PAID_MSG);
  });

  it('① cms_add_reservation_product_unit — status=expired면 "만료" 메시지로 차단(계약/결제 문구 아님)', async () => {
    const parent = await createParentProduct('GATE-ADD-EXP');
    const child = await createChildUnit(parent, 'GATE-ADD-EXP');
    const range = futureRange(70);
    const resId = await createReservation(child, 'expired', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<AddUnitResult>('cms_add_reservation_product_unit', {
      p_reservation_id: resId,
      p_product_id: parent,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(EXPIRED_MSG);
  });

  it('① cms_add_reservation_product_unit — status=cancelled면 "취소" 메시지로 차단', async () => {
    const parent = await createParentProduct('GATE-ADD-CXL');
    const child = await createChildUnit(parent, 'GATE-ADD-CXL');
    const range = futureRange(71);
    const resId = await createReservation(child, 'cancelled', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<AddUnitResult>('cms_add_reservation_product_unit', {
      p_reservation_id: resId,
      p_product_id: parent,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(CANCELLED_MSG);
  });

  it('② cms_remove_reservation_product_unit — status=confirmed면 차단', async () => {
    const parent = await createParentProduct('GATE-REM');
    const child = await createChildUnit(parent, 'GATE-REM');
    const range = futureRange(3);
    const resId = await createReservation(child, 'confirmed', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_remove_reservation_product_unit', {
      p_target_reservation_id: resId,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(CONTRACT_MSG);
  });

  it('② cms_remove_reservation_product_unit — status=expired면 "만료" 메시지로 차단', async () => {
    const parent = await createParentProduct('GATE-REM-EXP');
    const child = await createChildUnit(parent, 'GATE-REM-EXP');
    const range = futureRange(72);
    const resId = await createReservation(child, 'expired', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_remove_reservation_product_unit', {
      p_target_reservation_id: resId,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(EXPIRED_MSG);
  });

  it('③ cms_add_reservation_option — status=confirmed면 차단', async () => {
    const parent = await createParentProduct('GATE-OPT-ADD');
    const child = await createChildUnit(parent, 'GATE-OPT-ADD');
    const range = futureRange(4);
    const resId = await createReservation(child, 'confirmed', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<AddOptionResult>('cms_add_reservation_option', {
      p_reservation_id: resId,
      p_option_product_id: null,
      p_option_name: '메모리카드',
      p_qty: 1,
      p_unit_price: 5000,
    });
    expect(result.success).toBe(false);
    expect(result.option_id).toBeNull();
    expect(result.error_message).toBe(CONTRACT_MSG);
  });

  it('④ cms_update_reservation_option_qty — 예약이 confirmed로 전환된 이후 차단', async () => {
    const parent = await createParentProduct('GATE-OPT-UPD');
    const child = await createChildUnit(parent, 'GATE-OPT-UPD');
    const range = futureRange(5);
    const resId = await createReservation(child, 'hold', range);
    const optionId = await insertOption(resId, '삼각대', 1);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    await updateReservation(resId, { status: 'confirmed' });

    const result = await callRpc<SimpleResult>('cms_update_reservation_option_qty', {
      p_option_id: optionId,
      p_qty: 2,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(CONTRACT_MSG);
    expect((await getOption(optionId))?.qty).toBe(1);
  });

  it('⑤ cms_delete_reservation_option — 예약이 confirmed로 전환된 이후 차단', async () => {
    const parent = await createParentProduct('GATE-OPT-DEL');
    const child = await createChildUnit(parent, 'GATE-OPT-DEL');
    const range = futureRange(6);
    const resId = await createReservation(child, 'hold', range);
    const optionId = await insertOption(resId, '건전지', 2);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    await updateReservation(resId, { status: 'confirmed' });

    const result = await callRpc<SimpleResult>('cms_delete_reservation_option', {
      p_option_id: optionId,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(CONTRACT_MSG);
    expect(await getOption(optionId)).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ① cms_add_reservation_product_unit
// ═══════════════════════════════════════════════════════════════════════════
describe('① cms_add_reservation_product_unit', () => {
  it('정상: 가용 자식이 있으면 새 rental_reservations + order_items 행이 생성된다', async () => {
    const parent = await createParentProduct('ADD-OK');
    const childMain = await createChildUnit(parent, 'ADD-OK-main');
    const childFree = await createChildUnit(parent, 'ADD-OK-free');
    await insertPriceRule(parent, 15000);
    const range = futureRange(10);
    const mainRes = await createReservation(childMain, 'hold', range);
    const orderId = await linkOrder([mainRes]);

    let newResId: number | null = null;
    registerCleanup(async () => {
      const ids = [mainRes, ...(newResId ? [newResId] : [])];
      await deleteOrderItemsByReservation(ids);
      await deleteReservations(ids);
      await deletePriceRules([parent]);
      await deleteProducts([childMain, childFree, parent]);
      await deleteOrders([orderId]);
    });

    const result = await callRpc<AddUnitResult>('cms_add_reservation_product_unit', {
      p_reservation_id: mainRes,
      p_product_id: parent,
    });
    expect(result.success).toBe(true);
    expect(result.error_message).toBeNull();
    expect(result.new_reservation_id).not.toBeNull();
    newResId = result.new_reservation_id as number;

    const newRow = await getReservation(newResId);
    expect(newRow?.status).toBe('hold');
    expect(newRow?.product_id).toBe(childFree);

    const orderItem = await getOrderItem(newResId);
    expect(orderItem).not.toBeNull();
    expect(orderItem?.order_id).toBe(orderId);
    expect(orderItem?.product_id).toBe(childFree);
    expect(Number(orderItem?.unit_price)).toBe(15000);
    expect(Number(orderItem?.line_total)).toBe(15000);
  });

  it('재고소진: 가용 자식이 0개면 명확한 에러를 반환한다', async () => {
    const parent = await createParentProduct('ADD-EXHAUST');
    const child1 = await createChildUnit(parent, 'ADD-EXHAUST-1');
    const child2 = await createChildUnit(parent, 'ADD-EXHAUST-2');
    const range = futureRange(20);
    const mainRes = await createReservation(child1, 'hold', range);
    const occupyRes = await createReservation(child2, 'hold', range);
    registerCleanup(async () => {
      await deleteReservations([mainRes, occupyRes]);
      await deleteProducts([child1, child2, parent]);
    });

    const result = await callRpc<AddUnitResult>('cms_add_reservation_product_unit', {
      p_reservation_id: mainRes,
      p_product_id: parent,
    });
    expect(result.success).toBe(false);
    expect(result.new_reservation_id).toBeNull();
    expect(result.error_message).toBe('해당 기간에 예약 가능한 재고가 없습니다.');
  });

  it('동시성: 가용 자식이 정확히 1개일 때 동시 추가 시도는 1건만 성공한다', async () => {
    const parent = await createParentProduct('ADD-RACE');
    const soleChild = await createChildUnit(parent, 'ADD-RACE-sole');
    const otherParent = await createParentProduct('ADD-RACE-anchor');
    const anchorChild = await createChildUnit(otherParent, 'ADD-RACE-anchor-child');
    const range = futureRange(30);
    const anchorRes = await createReservation(anchorChild, 'hold', range);

    const createdIds: number[] = [];
    registerCleanup(async () => {
      const ids = [anchorRes, ...createdIds];
      await deleteOrderItemsByReservation(ids);
      await deleteReservations(ids);
      await deleteProducts([soleChild, parent, anchorChild, otherParent]);
    });

    const [r1, r2] = await Promise.all([
      callRpc<AddUnitResult>('cms_add_reservation_product_unit', {
        p_reservation_id: anchorRes,
        p_product_id: parent,
      }),
      callRpc<AddUnitResult>('cms_add_reservation_product_unit', {
        p_reservation_id: anchorRes,
        p_product_id: parent,
      }),
    ]);

    const results = [r1, r2];
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    for (const s of successes) {
      if (s.new_reservation_id) createdIds.push(s.new_reservation_id);
    }

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0]?.error_message).toBe('해당 기간에 예약 가능한 재고가 없습니다.');
    expect(successes[0]?.new_reservation_id).not.toBeNull();

    const wonRow = await getReservation(successes[0].new_reservation_id as number);
    expect(wonRow?.product_id).toBe(soleChild);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ② cms_remove_reservation_product_unit
// ═══════════════════════════════════════════════════════════════════════════
describe('② cms_remove_reservation_product_unit', () => {
  it('정상: 형제 상품이 있는 order에서 1개 삭제 시 소프트취소 + order_items 삭제', async () => {
    const parentA = await createParentProduct('REM-OK-A');
    const childA = await createChildUnit(parentA, 'REM-OK-A');
    const parentB = await createParentProduct('REM-OK-B');
    const childB = await createChildUnit(parentB, 'REM-OK-B');
    const range = futureRange(40);
    const resA = await createReservation(childA, 'hold', range);
    const resB = await createReservation(childB, 'hold', range);
    const orderId = await linkOrder([resA, resB]);

    registerCleanup(async () => {
      await deleteOrderItemsByReservation([resA, resB]);
      await deleteReservations([resA, resB]);
      await deleteProducts([childA, parentA, childB, parentB]);
      await deleteOrders([orderId]);
    });

    const result = await callRpc<SimpleResult>('cms_remove_reservation_product_unit', {
      p_target_reservation_id: resA,
    });
    expect(result.success).toBe(true);
    expect(result.error_message).toBeNull();

    expect((await getReservation(resA))?.status).toBe('cancelled');
    expect(await getOrderItem(resA)).toBeNull();
    // 형제(resB)의 order_items는 그대로 남아있어야 함
    expect(await getOrderItem(resB)).not.toBeNull();
  });

  it('마지막 상품 차단: order 내 유일한 상품이면 삭제를 거부한다', async () => {
    const parent = await createParentProduct('REM-LAST');
    const child = await createChildUnit(parent, 'REM-LAST');
    const range = futureRange(41);
    const resOnly = await createReservation(child, 'hold', range);
    const orderId = await linkOrder([resOnly]);

    registerCleanup(async () => {
      await deleteOrderItemsByReservation([resOnly]);
      await deleteReservations([resOnly]);
      await deleteProducts([child, parent]);
      await deleteOrders([orderId]);
    });

    const result = await callRpc<SimpleResult>('cms_remove_reservation_product_unit', {
      p_target_reservation_id: resOnly,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(
      '예약에 남은 상품이 없어 삭제할 수 없습니다. 예약 자체를 취소해주세요.'
    );

    // 차단됐으므로 상태·order_items 둘 다 그대로 유지돼야 함
    expect((await getReservation(resOnly))?.status).toBe('hold');
    expect(await getOrderItem(resOnly)).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ③④⑤ 옵션상품 CRUD
// ═══════════════════════════════════════════════════════════════════════════
describe('③ cms_add_reservation_option', () => {
  it('정상: qty>0이면 옵션이 추가된다', async () => {
    const parent = await createParentProduct('OPT-ADD-OK');
    const child = await createChildUnit(parent, 'OPT-ADD-OK');
    const range = futureRange(50);
    const resId = await createReservation(child, 'hold', range);
    let optionId: number | null = null;
    registerCleanup(async () => {
      if (optionId) await admin.from('reservation_options').delete().eq('id', optionId);
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<AddOptionResult>('cms_add_reservation_option', {
      p_reservation_id: resId,
      p_option_product_id: null,
      p_option_name: 'ND필터',
      p_qty: 2,
      p_unit_price: 3000,
    });
    expect(result.success).toBe(true);
    expect(result.option_id).not.toBeNull();
    optionId = result.option_id;
    expect((await getOption(optionId as number))?.qty).toBe(2);
  });

  it('qty<=0이면 차단된다', async () => {
    const parent = await createParentProduct('OPT-ADD-QTY0');
    const child = await createChildUnit(parent, 'OPT-ADD-QTY0');
    const range = futureRange(51);
    const resId = await createReservation(child, 'hold', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<AddOptionResult>('cms_add_reservation_option', {
      p_reservation_id: resId,
      p_option_product_id: null,
      p_option_name: 'ND필터',
      p_qty: 0,
      p_unit_price: 3000,
    });
    expect(result.success).toBe(false);
    expect(result.option_id).toBeNull();
    expect(result.error_message).toBe('수량은 1 이상이어야 합니다.');
  });

  it('option_name이 공백이면 차단된다', async () => {
    const parent = await createParentProduct('OPT-ADD-BLANK');
    const child = await createChildUnit(parent, 'OPT-ADD-BLANK');
    const range = futureRange(52);
    const resId = await createReservation(child, 'hold', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<AddOptionResult>('cms_add_reservation_option', {
      p_reservation_id: resId,
      p_option_product_id: null,
      p_option_name: '   ',
      p_qty: 1,
      p_unit_price: 1000,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe('옵션상품 이름을 입력해주세요.');
  });
});

describe('④ cms_update_reservation_option_qty', () => {
  it('정상: qty를 수정할 수 있다', async () => {
    const parent = await createParentProduct('OPT-UPD-OK');
    const child = await createChildUnit(parent, 'OPT-UPD-OK');
    const range = futureRange(53);
    const resId = await createReservation(child, 'hold', range);
    const optionId = await insertOption(resId, '보조배터리', 1);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_update_reservation_option_qty', {
      p_option_id: optionId,
      p_qty: 5,
    });
    expect(result.success).toBe(true);
    expect((await getOption(optionId))?.qty).toBe(5);
  });

  it('qty<=0이면 차단된다', async () => {
    const parent = await createParentProduct('OPT-UPD-QTY0');
    const child = await createChildUnit(parent, 'OPT-UPD-QTY0');
    const range = futureRange(54);
    const resId = await createReservation(child, 'hold', range);
    const optionId = await insertOption(resId, '보조배터리', 1);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_update_reservation_option_qty', {
      p_option_id: optionId,
      p_qty: -1,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe('수량은 1 이상이어야 합니다.');
    expect((await getOption(optionId))?.qty).toBe(1);
  });
});

describe('⑤ cms_delete_reservation_option', () => {
  it('정상: 옵션을 삭제할 수 있다', async () => {
    const parent = await createParentProduct('OPT-DEL-OK');
    const child = await createChildUnit(parent, 'OPT-DEL-OK');
    const range = futureRange(55);
    const resId = await createReservation(child, 'hold', range);
    const optionId = await insertOption(resId, '렌즈클리너', 1);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([child, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_delete_reservation_option', {
      p_option_id: optionId,
    });
    expect(result.success).toBe(true);
    expect(await getOption(optionId)).toBeNull();
  });

  it('존재하지 않는 option_id면 명확한 에러를 반환한다', async () => {
    const result = await callRpc<SimpleResult>('cms_delete_reservation_option', {
      p_option_id: 999999999,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe('옵션상품을 찾을 수 없습니다.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⑥ cms_reassign_reservation_product_code
// ═══════════════════════════════════════════════════════════════════════════
describe('⑥ cms_reassign_reservation_product_code — 게이트 매트릭스', () => {
  it('status=hold면 재배정 가능하다', async () => {
    const parent = await createParentProduct('REASSIGN-HOLD');
    const childA = await createChildUnit(parent, 'REASSIGN-HOLD-A');
    const childB = await createChildUnit(parent, 'REASSIGN-HOLD-B');
    const range = futureRange(60);
    const resId = await createReservation(childA, 'hold', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([childA, childB, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
      p_reservation_id: resId,
      p_new_unit_id: childB,
    });
    expect(result.success).toBe(true);
    expect((await getReservation(resId))?.product_id).toBe(childB);
  });

  it('status=confirmed AND tracking_number=NULL이면 재배정 가능하다', async () => {
    const parent = await createParentProduct('REASSIGN-CONF-NOTRACK');
    const childA = await createChildUnit(parent, 'REASSIGN-CONF-NOTRACK-A');
    const childB = await createChildUnit(parent, 'REASSIGN-CONF-NOTRACK-B');
    const range = futureRange(61);
    const resId = await createReservation(childA, 'confirmed', range, { trackingNumber: null });
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([childA, childB, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
      p_reservation_id: resId,
      p_new_unit_id: childB,
    });
    expect(result.success).toBe(true);
    expect((await getReservation(resId))?.product_id).toBe(childB);
  });

  it('status=confirmed AND tracking_number 존재하면 차단된다', async () => {
    const parent = await createParentProduct('REASSIGN-CONF-TRACK');
    const childA = await createChildUnit(parent, 'REASSIGN-CONF-TRACK-A');
    const childB = await createChildUnit(parent, 'REASSIGN-CONF-TRACK-B');
    const range = futureRange(62);
    const resId = await createReservation(childA, 'confirmed', range, {
      trackingNumber: '1234567890',
    });
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([childA, childB, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
      p_reservation_id: resId,
      p_new_unit_id: childB,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(
      '운송장 등록 후 또는 대여 진행 중인 예약은 재고를 재배정할 수 없습니다.'
    );
    expect((await getReservation(resId))?.product_id).toBe(childA);
  });

  it('status=in_use 등 그 외 상태면 차단된다', async () => {
    const parent = await createParentProduct('REASSIGN-INUSE');
    const childA = await createChildUnit(parent, 'REASSIGN-INUSE-A');
    const childB = await createChildUnit(parent, 'REASSIGN-INUSE-B');
    const range = futureRange(63);
    const resId = await createReservation(childA, 'in_use', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([childA, childB, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
      p_reservation_id: resId,
      p_new_unit_id: childB,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe(
      '운송장 등록 후 또는 대여 진행 중인 예약은 재고를 재배정할 수 없습니다.'
    );
  });

  // Migration 429(2026-09-03): 'expired'/'cancelled'는 위 "운송장 등록 후 또는 대여 진행 중"
  // 문구가 아니라 각자 구분된 메시지를 반환해야 한다 — 실사용 중 발견된 혼동(만료를 마치
  // "대여 진행 중"처럼 안내)을 방지.
  it('status=expired면 "만료" 메시지로 차단된다(대여 진행 중 문구 아님)', async () => {
    const parent = await createParentProduct('REASSIGN-EXPIRED');
    const childA = await createChildUnit(parent, 'REASSIGN-EXPIRED-A');
    const childB = await createChildUnit(parent, 'REASSIGN-EXPIRED-B');
    const range = futureRange(67);
    const resId = await createReservation(childA, 'expired', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([childA, childB, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
      p_reservation_id: resId,
      p_new_unit_id: childB,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe('예약이 만료되어 재고를 재배정할 수 없습니다.');
    expect((await getReservation(resId))?.product_id).toBe(childA);
  });

  it('status=cancelled면 "취소" 메시지로 차단된다', async () => {
    const parent = await createParentProduct('REASSIGN-CANCELLED');
    const childA = await createChildUnit(parent, 'REASSIGN-CANCELLED-A');
    const childB = await createChildUnit(parent, 'REASSIGN-CANCELLED-B');
    const range = futureRange(68);
    const resId = await createReservation(childA, 'cancelled', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([childA, childB, parent]);
    });

    const result = await callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
      p_reservation_id: resId,
      p_new_unit_id: childB,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe('취소된 예약은 재고를 재배정할 수 없습니다.');
  });

  it('다른 부모 상품의 유닛으로는 재배정할 수 없다', async () => {
    const parentF = await createParentProduct('REASSIGN-XPARENT-F');
    const childF = await createChildUnit(parentF, 'REASSIGN-XPARENT-F');
    const parentG = await createParentProduct('REASSIGN-XPARENT-G');
    const childG = await createChildUnit(parentG, 'REASSIGN-XPARENT-G');
    const range = futureRange(64);
    const resId = await createReservation(childF, 'hold', range);
    registerCleanup(async () => {
      await deleteReservations([resId]);
      await deleteProducts([childF, parentF, childG, parentG]);
    });

    const result = await callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
      p_reservation_id: resId,
      p_new_unit_id: childG,
    });
    expect(result.success).toBe(false);
    expect(result.error_message).toBe('같은 상품의 다른 재고단위로만 재배정할 수 있습니다.');
    expect((await getReservation(resId))?.product_id).toBe(childF);
  });

  it('재배정 성공 시 rental_reservations.product_id와 order_items.product_id 둘 다 갱신된다', async () => {
    const parent = await createParentProduct('REASSIGN-SYNC');
    const childA = await createChildUnit(parent, 'REASSIGN-SYNC-A');
    const childB = await createChildUnit(parent, 'REASSIGN-SYNC-B');
    const range = futureRange(65);
    // order_items 연동을 위해 처음엔 hold 상태로 생성 → 주문 연결 → 그 후 confirmed로 전환
    const resId = await createReservation(childA, 'hold', range);
    const orderId = await linkOrder([resId]);
    await updateReservation(resId, { status: 'confirmed', tracking_number: null });

    registerCleanup(async () => {
      await deleteOrderItemsByReservation([resId]);
      await deleteReservations([resId]);
      await deleteProducts([childA, childB, parent]);
      await deleteOrders([orderId]);
    });

    const result = await callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
      p_reservation_id: resId,
      p_new_unit_id: childB,
    });
    expect(result.success).toBe(true);
    expect((await getReservation(resId))?.product_id).toBe(childB);
    const orderItem = await getOrderItem(resId);
    expect(orderItem?.product_id).toBe(childB);
  });

  it('동시성: 가용 유닛이 1개일 때 두 confirmed 예약의 동시 재배정 시도는 1건만 성공한다', async () => {
    const parent = await createParentProduct('REASSIGN-RACE');
    const childA = await createChildUnit(parent, 'REASSIGN-RACE-A');
    const childB = await createChildUnit(parent, 'REASSIGN-RACE-B');
    const soleFree = await createChildUnit(parent, 'REASSIGN-RACE-free');
    const range = futureRange(66);
    const resA = await createReservation(childA, 'confirmed', range, { trackingNumber: null });
    const resB = await createReservation(childB, 'confirmed', range, { trackingNumber: null });
    registerCleanup(async () => {
      await deleteReservations([resA, resB]);
      await deleteProducts([childA, childB, soleFree, parent]);
    });

    const [r1, r2] = await Promise.all([
      callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
        p_reservation_id: resA,
        p_new_unit_id: soleFree,
      }),
      callRpc<SimpleResult>('cms_reassign_reservation_product_code', {
        p_reservation_id: resB,
        p_new_unit_id: soleFree,
      }),
    ]);

    const results = [r1, r2];
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0]?.error_message).toBe('선택한 재고가 이미 다른 예약에 배정되었습니다.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 권한 검증 — anon 클라이언트는 6개 함수 중 하나라도 직접 호출 불가해야 한다
// ═══════════════════════════════════════════════════════════════════════════
describe('권한 검증 — service_role 전용 (Migration 430 REVOKE 보강 재확인)', () => {
  it('anon 클라이언트로 cms_add_reservation_product_unit 호출 시 거부된다', async () => {
    const { data, error } = await anon.rpc('cms_add_reservation_product_unit', {
      p_reservation_id: 999999999,
      p_product_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});
