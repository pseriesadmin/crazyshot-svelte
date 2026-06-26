import { browser } from '$app/environment';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type {
  AtomicReserveAssetArgs,
  BatchAtomicReserveArgs,
  CalculateCartTotalArgs,
  ProcessPaymentAndCreateOrderArgs,
} from '$lib/types/database';
import type { Session } from '@supabase/supabase-js';

// PUBLIC_ 우선, VITE_ fallback (Vercel 기존 env 호환)
// 로컬 + Preview → crazyshot-stage 테스트 DB (ezyvffjvuwmtuhpxdjrw)
const supabaseUrl = PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = PUBLIC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env: set PUBLIC_SUPABASE_URL/KEY or VITE_SUPABASE_URL/KEY (crazyshot DB)',
  );
}

const isSSR = !browser;

// Singleton Supabase client instance (typed against v5.46 schema)
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: !isSSR,
    autoRefreshToken: !isSSR,
    detectSessionInUrl: true,
  },
});

// =============================================================================
// Auth helpers
// =============================================================================
export const auth = {
  signUp: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  },

  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  signInWithOAuth: async (provider: 'google' | 'kakao') => {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) throw error;
    return data;
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  getCurrentUser: async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  },

  getSession: async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  },

  onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  },
};

// =============================================================================
// Internal RPC helper — bypasses Supabase's strict generic inference for
// custom function Args types (Supabase v2.106.2 + TypeScript 6 compatibility)
// =============================================================================
type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;

function callRpc<T>(fn: string, args?: Record<string, unknown>): RpcResult<T> {
  return supabase.rpc(fn as never, args as never) as unknown as RpcResult<T>;
}

// =============================================================================
// RPC wrapper functions — v5.46 schema (UUID IDs throughout)
// =============================================================================
export const rpc = {
  /**
   * ensure_user_profile
   * Auth 가입 트리거로 자동 호출되지만, 수동 호출도 지원
   */
  ensureUserProfile: async (): Promise<string> => {
    const { data, error } = await callRpc<string>('ensure_user_profile');
    if (error) throw new Error(error.message);
    return data ?? '';
  },

  /**
   * atomic_reserve_asset
   * 단일 자산 원자적 예약 (hold 상태, 10분 만료)
   * §13: SELECT ... FOR UPDATE SKIP LOCKED, EXCLUDE gist 적용
   */
  atomicReserveAsset: async (args: AtomicReserveAssetArgs): Promise<{
    success: boolean;
    reservation_id: string | null;
    asset_id: string | null;
    error_message: string | null;
  }> => {
    const { data, error } = await callRpc<Array<{
      success: boolean;
      reservation_id: string | null;
      asset_id: string | null;
      error_message: string | null;
    }>>('atomic_reserve_asset', args as unknown as Record<string, unknown>);
    if (error) throw new Error(error.message);
    return data?.[0] ?? { success: false, reservation_id: null, asset_id: null, error_message: 'No result' };
  },

  /**
   * batch_atomic_reserve
   * 복수 자산 일괄 원자적 예약 — 중간 실패 시 전체 롤백
   */
  batchAtomicReserve: async (args: BatchAtomicReserveArgs): Promise<Array<{
    success: boolean;
    reservation_id: string | null;
    asset_id: string | null;
    product_id: string | null;
    error_message: string | null;
  }>> => {
    const { data, error } = await callRpc<Array<{
      success: boolean;
      reservation_id: string | null;
      asset_id: string | null;
      product_id: string | null;
      error_message: string | null;
    }>>('batch_atomic_reserve', args as unknown as Record<string, unknown>);
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  /**
   * calculate_cart_total
   * 9단계 할인 순서 적용 (§13): 멤버십 → 쿠폰 → 학생 → 배송비
   */
  calculateCartTotal: async (args: CalculateCartTotalArgs): Promise<{
    subtotal: number;
    option_fees: number;
    shipping_cost: number;
    discount_amount: number;
    coupon_discount: number;
    tax_amount: number;
    final_total: number;
    deposit_required: number;
    deposit_percentage: number;
  }> => {
    const { data, error } = await callRpc<Array<{
      subtotal: number;
      option_fees: number;
      shipping_cost: number;
      discount_amount: number;
      coupon_discount: number;
      tax_amount: number;
      final_total: number;
      deposit_required: number;
      deposit_percentage: number;
    }>>('calculate_cart_total', args as unknown as Record<string, unknown>);
    if (error) throw new Error(error.message);
    return data?.[0] ?? {
      subtotal: 0, option_fees: 0, shipping_cost: 0,
      discount_amount: 0, coupon_discount: 0, tax_amount: 0,
      final_total: 0, deposit_required: 0, deposit_percentage: 0.3,
    };
  },

  /**
   * process_payment_and_create_order
   * TossPayments v2 결제 + 주문 생성 원자적 처리
   * idempotency_key: 중복 결제 방지
   */
  processPaymentAndCreateOrder: async (args: ProcessPaymentAndCreateOrderArgs): Promise<{
    success: boolean;
    order_id: string | null;
    payment_transaction_id: string | null;
    error_message: string | null;
  }> => {
    const { data, error } = await callRpc<Array<{
      success: boolean;
      order_id: string | null;
      payment_transaction_id: string | null;
      error_message: string | null;
    }>>('process_payment_and_create_order', args as unknown as Record<string, unknown>);
    if (error) throw new Error(error.message);
    return data?.[0] ?? { success: false, order_id: null, payment_transaction_id: null, error_message: 'No result' };
  },
};
