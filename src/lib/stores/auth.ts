import { writable, derived } from 'svelte/store';
import type { User, Session } from '@supabase/supabase-js';
import { auth as authService, supabase } from '$lib/services/supabase';

// Store types
interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
}

// Create writable stores
export const authState = writable<AuthState>({
  user: null,
  session: null,
  loading: true,
  error: null,
});

// Derived store for auth status
export const isAuthenticated = derived(authState, ($authState) => {
  return $authState.user !== null && $authState.session !== null;
});

// Initialize auth state on app startup
export const initializeAuth = async () => {
  try {
    authState.update((state) => ({ ...state, loading: true, error: null }));

    const session = await authService.getSession();
    const user = session?.user || null;

    authState.set({
      user,
      session,
      loading: false,
      error: null,
    });

    return { user, session };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to initialize auth';
    authState.set({
      user: null,
      session: null,
      loading: false,
      error: errorMessage,
    });
    throw error;
  }
};

// Auth action functions
export const performSignUp = async (email: string, password: string) => {
  try {
    authState.update((state) => ({ ...state, loading: true, error: null }));

    // 익명 세션 확인: is_anonymous=true이면 updateUser()로 UID 유지 전환
    // (새 auth.users 행을 만드는 signUp() 대신 기존 UID를 보존해 chat_sessions 등 연결 유지)
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    const isAnonymous = !!currentSession?.user &&
      (currentSession.user as { is_anonymous?: boolean }).is_anonymous === true;

    let resultUser: User | null;
    let resultSession: Session | null;

    if (isAnonymous) {
      // 익명→영구 계정 전환: 동일 UID 유지 → chat_sessions.user_id 자동 보존 (GC-1)
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({ email, password });
      if (updateError) throw updateError;
      if (!updateData.user) throw new Error('익명 계정 전환 후 사용자 정보를 가져오지 못했습니다.');
      // 세션 갱신: updateUser() 후 최신 상태 반영
      const { data: { session: refreshedSession } } = await supabase.auth.getSession();
      resultUser = updateData.user;
      resultSession = refreshedSession;
    } else {
      // 완전 신규 회원가입: 기존 signUp() 흐름 그대로 유지
      const data = await authService.signUp(email, password);
      resultUser = data.user;
      resultSession = data.session;
    }

    authState.set({
      user: resultUser,
      session: resultSession,
      loading: false,
      error: null,
    });

    return { user: resultUser, session: resultSession };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Sign up failed';
    authState.set({
      user: null,
      session: null,
      loading: false,
      error: errorMessage,
    });
    throw error;
  }
};

export const performSignIn = async (email: string, password: string) => {
  try {
    authState.update((state) => ({ ...state, loading: true, error: null }));

    const data = await authService.signIn(email, password);

    authState.set({
      user: data.user,
      session: data.session,
      loading: false,
      error: null,
    });

    return { user: data.user, session: data.session };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Sign in failed';
    authState.set({
      user: null,
      session: null,
      loading: false,
      error: errorMessage,
    });
    throw error;
  }
};

export const performSignOut = async () => {
  try {
    authState.update((state) => ({ ...state, loading: true, error: null }));

    await authService.signOut();

    authState.set({
      user: null,
      session: null,
      loading: false,
      error: null,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Sign out failed';
    authState.update((state) => ({
      ...state,
      loading: false,
      error: errorMessage,
    }));
    throw error;
  }
};

// Subscribe to auth state changes
export const subscribeToAuthChanges = (callback?: (user: User | null) => void): (() => void) => {
  const result = authService.onAuthStateChange((event, session) => {
    authState.set({
      user: session?.user || null,
      session: session || null,
      loading: false,
      error: null,
    });

    if (callback) {
      callback(session?.user || null);
    }
  });

  // Supabase onAuthStateChange returns { data: { subscription } }
  const sub = (result as { data?: { subscription?: { unsubscribe: () => void } } })?.data?.subscription
  return () => sub?.unsubscribe()
};
