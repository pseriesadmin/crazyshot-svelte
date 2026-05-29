import { beforeAll } from 'vitest';
import ws from 'ws';

// Polyfill WebSocket for Node.js environment
if (typeof globalThis.WebSocket === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = ws;
}

// Import after WebSocket polyfill
import { supabase } from '$lib/services/supabase';

// Global test user for integration tests
const TEST_USER = {
  email: `test-${Date.now()}@example.com`,
  password: 'Test1234!@#$',
};

beforeAll(async () => {
  try {
    // Sign up test user
    const { error: signUpError } = await supabase.auth.signUp({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });

    if (signUpError && !signUpError.message.includes('already registered')) {
      console.warn('Test user signup warning:', signUpError);
    }

    // Sign in test user
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });

    if (signInError) {
      console.error('Failed to authenticate test user:', signInError);
      throw signInError;
    }

    // Store session for tests
    if (signInData?.session) {
      // Session is now available to Supabase client
      console.log('Test user authenticated:', signInData.user?.id);
    }
  } catch (error) {
    console.error('Test setup failed:', error);
  }
});
