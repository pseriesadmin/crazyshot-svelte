// app.d.ts — SvelteKit 전역 타입 선언
// Supabase SSR 서버사이드 locals

import type { SupabaseClient, Session } from '@supabase/supabase-js'
import type { Database } from '$lib/types/database'

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient<Database>
      safeGetSession: () => Promise<{ session: Session | null; user: Session['user'] | null }>
      cmsRole?: string | null
    }
    // PERF-5: /cms/products 상품 선택 shallow routing(replaceState)용 페이지 상태
    interface PageState {
      selectedId?: string | null
    }
  }
}

export {}
