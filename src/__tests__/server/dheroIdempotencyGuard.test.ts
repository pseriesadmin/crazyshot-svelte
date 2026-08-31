import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Stage 3 TDD: RSV-B-C3 — POST /api/cms/reservations/[id]/dhero 멱등성 가드
 *
 * 문제: tracking_number가 이미 있는 예약에 다시 POST → 중복 배송 접수 위험.
 * 수정: tracking_number가 있으면 즉시 409 반환.
 *
 * EC-3: tracking_number 존재 → 409
 * EC-3b: tracking_number 없음 → createDelivery 호출 → 200
 */

const mockEnv = vi.hoisted(() => ({
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
}));
vi.mock('$env/static/private', () => mockEnv);
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }));
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data; },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }),
}));
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}));

const mockGetReservation = vi.fn();
vi.mock('$lib/server/getReservationForDhero', () => ({
  getReservationForDhero: (...args: unknown[]) => mockGetReservation(...args),
}));

const mockIsBulk = vi.fn().mockResolvedValue(true);
vi.mock('$lib/server/isBulkDeliveryMethod', () => ({
  isBulkDeliveryMethod: (...args: unknown[]) => mockIsBulk(...args),
}));

const mockCreateDelivery = vi.fn();
vi.mock('$lib/server/dhero', () => ({
  createDelivery:      (...args: unknown[]) => mockCreateDelivery(...args),
  getDeliveryByBookId: vi.fn(),
  DHERO_STATUS_LABEL:  { 0: '배송접수' },
  DheroApiError:       class extends Error { statusCode = 0 },
}));
vi.mock('$lib/server/dheroAutoAdvance', () => ({
  maybeAutoAdvanceOnDheroDelivered: vi.fn(),
}));

const { POST } = await import('../../routes/api/cms/reservations/[id]/dhero/+server');

function makeLocals() {
  return { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin' } } }) };
}

describe('RSV-B-C3: POST dhero 멱등성 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBulk.mockResolvedValue(true);
  });

  it('EC-3: tracking_number 존재 → 409 반환 (중복 배송 접수 차단)', async () => {
    mockGetReservation.mockResolvedValue({
      trackingNumber: 'BOOK-ALREADY-123',   // 이미 배송 접수됨
      pickupMethod:   'crazy_delivery',
      address:        '서울시 강남구',
      postalCode:     '12345',
      customerName:   '홍길동',
      customerPhone:  '01012345678',
      productName:    '카메라',
    });

    const res = await POST({
      params:  { id: '1' },
      locals:  makeLocals(),
      request: {} as Request,
      url:     new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/이미.*배송/);
    expect(mockCreateDelivery).not.toHaveBeenCalled();
  });

  it('EC-3b: tracking_number 없음 → createDelivery 호출 → 200', async () => {
    mockGetReservation.mockResolvedValue({
      trackingNumber: null,   // 아직 배송 접수 안 됨
      pickupMethod:   'crazy_delivery',
      address:        '서울시 강남구',
      postalCode:     '12345',
      customerName:   '홍길동',
      customerPhone:  '01012345678',
      productName:    '카메라',
      reservationCode: 'CS-0001',
    });
    mockCreateDelivery.mockResolvedValue({ bookId: 'NEW-BOOK-456', dongGroup: '강남구' });

    const res = await POST({
      params:  { id: '1' },
      locals:  makeLocals(),
      request: {} as Request,
      url:     new URL('http://localhost'),
    } as never) as { status: number; json: () => Promise<unknown> };

    expect(res.status).toBe(200);
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1);
    const body = await res.json() as { ok: boolean; bookId: string };
    expect(body.ok).toBe(true);
    expect(body.bookId).toBe('NEW-BOOK-456');
  });
});
