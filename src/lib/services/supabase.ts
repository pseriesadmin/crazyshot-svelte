import { createClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)');
}

// Singleton Supabase client instance
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Auth helpers
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

// RPC wrapper functions with type safety
export const rpc = {
  // Ensure user profile exists in database (called after signup/signin)
  ensureUserProfile: async () => {
    const { data, error } = await supabase.rpc('ensure_user_profile');
    if (error) throw error;
    return data as string; // Returns user_id
  },

  // Calculate cart total with subscription discount
  calculateCartTotal: async (reservationIds: number[]) => {
    const { data, error } = await supabase.rpc('calculate_cart_total', {
      p_reservation_ids: reservationIds,
    });
    if (error) throw error;
    return data?.[0] || { total_amount: 0, discount_amount: 0, final_amount: 0 };
  },

  // Reserve asset atomically
  atomicReserveAsset: async (productId: number, startDate: string, endDate: string) => {
    const { data, error } = await supabase.rpc('atomic_reserve_asset', {
      p_product_id: productId,
      p_start_date: startDate,
      p_end_date: endDate,
    });
    if (error) throw error;
    return data?.[0] || { success: false, error_message: 'Unknown error' };
  },

  // Batch reserve multiple assets
  batchAtomicReserve: async (productAssets: Array<{ product_id: number; start_date: string; end_date: string }>) => {
    const { data, error } = await supabase.rpc('batch_atomic_reserve', {
      p_product_assets: productAssets,
    });
    if (error) throw error;
    return data || [];
  },

  // Release asset (mark as available after return)
  releaseAsset: async (reservationId: number) => {
    const { data, error } = await supabase.rpc('release_asset', {
      p_reservation_id: reservationId,
    });
    if (error) throw error;
    return data?.[0] || { success: false, error_message: 'Unknown error' };
  },

  // Create order and payment transaction (atomic)
  processPaymentAndCreateOrder: async (
    paymentKey: string,
    amount: number,
    paymentMethod: string,
    reservationIds: number[]
  ) => {
    const { data, error } = await supabase.rpc('process_payment_and_create_order', {
      p_payment_key: paymentKey,
      p_amount: amount,
      p_payment_method: paymentMethod,
      p_reservation_ids: reservationIds,
    });
    if (error) throw error;
    return data?.[0] || { success: false, error_message: 'Unknown error' };
  },

  // Confirm payment (called from webhook)
  confirmPayment: async (orderId: number, paymentKey: string, providerResponse: Record<string, string | number | boolean | null>) => {
    const { data, error } = await supabase.rpc('confirm_payment', {
      p_order_id: orderId,
      p_payment_key: paymentKey,
      p_provider_response: providerResponse,
    });
    if (error) throw error;
    return data?.[0] || { success: false, error_message: 'Unknown error' };
  },

  // Subscribe to plan
  subscribeToPlan: async (planId: number) => {
    const { data, error } = await supabase.rpc('subscribe_plan', {
      p_plan_id: planId,
    });
    if (error) throw error;
    return data?.[0] || { success: false, error_message: 'Unknown error' };
  },

  // Cancel subscription
  cancelSubscription: async (subscriptionId: number) => {
    const { data, error } = await supabase.rpc('cancel_subscription', {
      p_subscription_id: subscriptionId,
    });
    if (error) throw error;
    return data?.[0] || { success: false, error_message: 'Unknown error' };
  },
};
