// app.d.ts — SvelteKit 전역 타입 선언
// Supabase SSR 서버사이드 locals

/// <reference types="vite/client" />
// ↑ Vite의 애셋 임포트 타입(?url·?raw 등) 전역 활성화 — pdfRasterize.ts의
//   `pdfjs-dist/build/pdf.worker.min.mjs?url` 임포트에 필요 (C-2, 2026-08-14)

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
