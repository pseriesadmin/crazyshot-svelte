import { writable, derived } from 'svelte/store';
import type { User, Session } from '@supabase/supabase-js';
import { auth as authService } from '$lib/services/supabase';

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

    const data = await authService.signUp(email, password);

    authState.set({
      user: data.user,
      session: data.session,
      loading: false,
      error: null,
    });

    return { user: data.user, session: data.session };
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
