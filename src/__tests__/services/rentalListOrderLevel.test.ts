import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'

/**
 * get_rental_list "주문 1건 = 목록 1행" — TDD (2026-10-02, Migration #618)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 완료기준(B-START):
 *   정상 동작   : p_group_by_order=true면 같은 주문(order_items)의 예약들이 대표 1행(주문 내 MIN(예약 id))으로
 *                묶여 반환되고, order_item_count·own_status·status_mixed가 채워진다. 총건수(total_count)도 주문 기준.
 *   막아야 할 것 : 기본값(p_group_by_order 미지정)의 기존 동작(예약 1건 = 1행)이 바뀌면 안 된다
 *                (간트차트·단건 조회 등 기존 호출부 무회귀). 주문에 속하지 않은 예약은 자기 자신이 1행.
 *   실패했을 때  : 묶음이 깨지면 장바구니 다중 상품이 목록에서 다시 상품 수만큼 여러 행으로 쪼개진다.
 *
 * 상태 규칙(Q2): 주문 상태 = 취소·만료를 제외한 형제 중 가장 덜 진행된 단계. 전부 취소·만료면 대표(MIN id) 상태.
 * 상태·검색·날짜 필터는 주문 단위(형제 어느 하나라도 일치)로 판정한다.
 *
 * 주의: Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합 테스트 — Migration #618 적용 전에는 전부 실패하는 것이 정상.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const productIds: string[] = [];
const createdUserIds: string[] = [];
const createdReservationIds: number[] = [];

const _slotBase = Date.now() % 1000;
let _slotCounter = 0;
function randomFutureDateRange(): { start: string; end: string } {
  _slotCounter += 1;
  const slot = _slotBase * 50 + _slotCounter;
  const start = new Date(Date.UTC(2041, 0, 1) + slot * 5 * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createEphemeralUser(): Promise<{ id: string; email: string }> {
  const email = `tdd-orderlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true });
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function createReservation(userId: string, productId: string, status = 'hold'): Promise<number> {
  const { start, end } = randomFutureDateRange();
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({ user_id: userId, product_id: productId, start_date: start, end_date: end, status, pickup_method: 'visit', return_method: 'visit' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  createdReservationIds.push(data.id as number);
  return data.id as number;
}

async function bindOrder(userId: string, ids: number[]): Promise<void> {
  const { error } = await admin.rpc('create_reservation_order', { p_user_id: userId, p_reservation_ids: ids });
  if (error) throw new Error(`주문 묶기 실패: ${error.message}`);
}

interface ListRow {
  reservation_id: number
  status: string
  own_status: string
  order_item_count: number
  status_mixed: boolean
  order_id: number | null
  user_id: string
  total_count: number
}

async function list(params: Record<string, unknown>): Promise<ListRow[]> {
  const { data, error } = await admin.rpc('get_rental_list', { p_page: 1, p_per_page: 200, ...params });
  if (error) throw new Error(`get_rental_list 실패: ${error.message}`);
  return (data ?? []) as ListRow[];
}

beforeAll(async () => {
  const { data, error } = await admin.from('products').select('id').is('parent_product_id', null).eq('is_active', true).limit(2);
  if (error || !data || data.length < 2) throw new Error('테스트용 부모 상품 2개가 필요합니다.');
  for (const p of data) {
    productIds.push((p as { id: string }).id);
    await ensure24hPriceRule(admin, (p as { id: string }).id);
  }
});

afterAll(async () => {
  if (createdReservationIds.length > 0) {
    await admin.from('order_items').delete().in('reservation_id', createdReservationIds);
    await admin.from('rental_reservations').delete().in('id', createdReservationIds);
  }
  for (const uid of createdUserIds) {
    await admin.from('orders').delete().eq('user_id', uid);
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
  }
});

describe('get_rental_list — p_group_by_order (Migration #618)', () => {
  it('Happy: 같은 주문의 예약 2건이 대표 1행(MIN id)으로 묶이고 order_item_count=2·total_count=1', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);

    const rows = await list({ p_search: u.email, p_group_by_order: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].reservation_id).toBe(Math.min(r1, r2));
    expect(rows[0].order_item_count).toBe(2);
    expect(rows[0].status).toBe('hold');
    expect(rows[0].own_status).toBe('hold');
    expect(rows[0].status_mixed).toBe(false);
    expect(Number(rows[0].total_count)).toBe(1);
  });

  it('무회귀: p_group_by_order 미지정(기본)이면 기존처럼 예약 1건 = 1행', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);

    const rows = await list({ p_search: u.email });
    expect(rows.map(r => r.reservation_id).sort((a, b) => a - b)).toEqual([r1, r2].sort((a, b) => a - b));
    expect(Number(rows[0].total_count)).toBe(2);
  });

  it('주문에 속하지 않은 예약(레거시)은 자기 자신이 1행, order_item_count=1', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);

    const rows = await list({ p_search: u.email, p_group_by_order: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].reservation_id).toBe(r1);
    expect(rows[0].order_item_count).toBe(1);
    expect(rows[0].order_id).toBeNull();
  });

  it('Q2 상태 혼합: 형제 중 가장 덜 진행된 단계가 주문 상태, status_mixed=true, own_status는 대표 자신의 상태', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);
    const rep = Math.min(r1, r2);
    const other = Math.max(r1, r2);
    // 대표는 in_use, 나머지는 confirmed → 주문 상태는 confirmed(덜 진행)
    await admin.from('rental_reservations').update({ status: 'in_use' }).eq('id', rep);
    await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', other);

    const rows = await list({ p_search: u.email, p_group_by_order: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].reservation_id).toBe(rep);
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].own_status).toBe('in_use');
    expect(rows[0].status_mixed).toBe(true);
  });

  it('상태 필터는 주문 상태 기준: 주문 상태가 confirmed면 in_use 포함 목록에는 나오지 않고 confirmed 필터에는 나온다', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);
    await admin.from('rental_reservations').update({ status: 'in_use' }).eq('id', Math.min(r1, r2));
    await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', Math.max(r1, r2));

    const inUseOnly = await list({ p_search: u.email, p_group_by_order: true, p_status: 'in_use' });
    expect(inUseOnly).toHaveLength(0);
    const confirmedOnly = await list({ p_search: u.email, p_group_by_order: true, p_status: 'confirmed' });
    expect(confirmedOnly).toHaveLength(1);
    const excluded = await list({ p_search: u.email, p_group_by_order: true, p_exclude_statuses: ['confirmed'] });
    expect(excluded).toHaveLength(0);
  });

  it('취소·만료된 형제는 상태 계산에서 제외: hold + cancelled 주문은 hold로 보인다', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', Math.min(r1, r2));

    const rows = await list({ p_search: u.email, p_group_by_order: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('hold');
  });

  it('주문 전체 취소: 형제 모두 cancelled면 1행(cancelled)으로 취소 탭에 나온다', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);
    await admin.from('rental_reservations').update({ status: 'cancelled' }).in('id', [r1, r2]);

    const rows = await list({ p_search: u.email, p_group_by_order: true, p_include_statuses: ['cancelled', 'expired'] });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('cancelled');
    expect(Number(rows[0].total_count)).toBe(1);
  });

  it('p_reservation_id에 비대표 형제 id를 주면 묶음 모드에서는 대표 행을 반환', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);
    const rep = Math.min(r1, r2);
    const other = Math.max(r1, r2);

    const rows = await list({ p_reservation_id: other, p_group_by_order: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].reservation_id).toBe(rep);

    const ungrouped = await list({ p_reservation_id: other });
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0].reservation_id).toBe(other);
  });

  it('검색어가 비대표 형제 상품명에만 일치해도 그 주문(대표 행)이 검색된다', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);
    const rep = Math.min(r1, r2);
    const otherRid = Math.max(r1, r2);
    const { data: otherRes } = await admin.from('rental_reservations').select('product_id').eq('id', otherRid).single();
    const { data: prod } = await admin.from('products').select('name').eq('id', (otherRes as { product_id: string }).product_id).single();
    const otherName = (prod as { name: string }).name;

    const rows = (await list({ p_search: otherName, p_group_by_order: true })).filter(r => r.user_id === u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].reservation_id).toBe(rep);
  });

  it('페이지네이션·총건수는 주문 단위: 주문 2건(상품 2+1)이면 total_count=2', async () => {
    const u = await createEphemeralUser();
    const a1 = await createReservation(u.id, productIds[0]);
    const a2 = await createReservation(u.id, productIds[1]);
    const b1 = await createReservation(u.id, productIds[0]);
    await bindOrder(u.id, [a1, a2]);
    await bindOrder(u.id, [b1]);

    const rows = await list({ p_search: u.email, p_group_by_order: true, p_per_page: 1 });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].total_count)).toBe(2);
    const page2 = await list({ p_search: u.email, p_group_by_order: true, p_per_page: 1, p_page: 2 });
    expect(page2).toHaveLength(1);
    expect(page2[0].reservation_id).not.toBe(rows[0].reservation_id);
  });

  it('M-2 대표 선정: 주문 내 가장 작은 id가 취소됐으면 활성 형제 중 가장 작은 id가 대표가 된다', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);
    const dead = Math.min(r1, r2);
    const alive = Math.max(r1, r2);
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', dead);

    const rows = await list({ p_search: u.email, p_group_by_order: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].reservation_id).toBe(alive);
    expect(rows[0].own_status).toBe('hold');
    // 취소된 형제 id로 단건 조회해도 같은(활성) 대표 행이 나온다
    const byDead = await list({ p_reservation_id: dead, p_group_by_order: true });
    expect(byDead).toHaveLength(1);
    expect(byDead[0].reservation_id).toBe(alive);
  });

  it('단건 조회(p_reservation_id)는 다른 주문의 행을 섞지 않는다', async () => {
    const u = await createEphemeralUser();
    const a1 = await createReservation(u.id, productIds[0]);
    const a2 = await createReservation(u.id, productIds[1]);
    const b1 = await createReservation(u.id, productIds[0]);
    await bindOrder(u.id, [a1, a2]);
    await bindOrder(u.id, [b1]);

    const rows = await list({ p_reservation_id: b1, p_group_by_order: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].reservation_id).toBe(b1);
    expect(rows[0].order_item_count).toBe(1);
  });

  it('실제 상태 전이(update_reservation_status): 상품 하나만 승인하면 주문은 hold + 일부 진행, 모두 승인하면 confirmed + 혼합 해소', async () => {
    const u = await createEphemeralUser();
    const r1 = await createReservation(u.id, productIds[0]);
    const r2 = await createReservation(u.id, productIds[1]);
    await bindOrder(u.id, [r1, r2]);
    const rep = Math.min(r1, r2);
    const other = Math.max(r1, r2);

    const a1 = await admin.rpc('update_reservation_status', { p_reservation_id: rep, p_new_status: 'confirmed' });
    expect(a1.error).toBeNull();
    expect((a1.data as { ok: boolean }).ok).toBe(true);
    let rows = await list({ p_search: u.email, p_group_by_order: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('hold');
    expect(rows[0].own_status).toBe('confirmed');
    expect(rows[0].status_mixed).toBe(true);

    const a2 = await admin.rpc('update_reservation_status', { p_reservation_id: other, p_new_status: 'confirmed' });
    expect(a2.error).toBeNull();
    expect((a2.data as { ok: boolean }).ok).toBe(true);
    rows = await list({ p_search: u.email, p_group_by_order: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].status_mixed).toBe(false);

    // 대여현황 스코프(confirmed 이후)에는 주문이 모두 승인된 뒤에만 노출된다
    const rentalScope = await list({ p_search: u.email, p_group_by_order: true, p_include_statuses: ['confirmed', 'shipped', 'in_use'] });
    expect(rentalScope).toHaveLength(1);
  });
});
