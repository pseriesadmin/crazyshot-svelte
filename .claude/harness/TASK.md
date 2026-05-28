# .claude/harness/TASK.md
생성일: 2026-05-29
아젠다: CRAZYSHOT 렌탈플랫폼 S0-S1 개발 (Harness Flow v3.0)

[CONTEXT BRIDGE]
핵심제약: TDD 강제 (payment, reservation, auth, scoring), RLS 모든 테이블, RPC 기반 비즈니스로직, 절대금지 패턴 (H-01~H-06)
TDD도메인: M3 rental_reservations atomic_reserve, M4 payment flow, subscription discount calc
절대금지: 직접 INSERT/UPDATE (RPC만), client-side 가격계산, blocking webhooks, expired row filter 누락, server key 노출
실패롤백: ROLLBACK_LOG 기록, 실패 시 GATE B/C/E 재진입

---

## NOW
- S0-2: Database Schema 구축 (DONE)
  - ✅ 5개 마이그레이션 적용 (001~005)
  - ✅ 10개 테이블 생성 (products, assets, user_profiles, subscriptions, rental_reservations, orders, order_items, payment_transactions, shipments, subscription_plans)
  - ✅ RLS 정책 24개 설정
  - ✅ RPC 함수 9개 구현 (atomic_reserve_asset, calculate_cart_total, batch_atomic_reserve, process_payment_and_create_order, confirm_payment 등)
  - ✅ TypeScript types 생성 (src/lib/types/database.ts)
  - ✅ Subscription plans seed 데이터 3개 (Basic, Premium, Pro)

## NEXT
- S0-3: Supabase-JS 클라이언트 설정
  - Client configuration (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
  - Auth integration (signUp, signIn, signOut)
  - RPC call wrapper functions
- S1-M1: Products 모듈 (GSD)
  - Product listing page
  - Product detail page
  - Asset availability check
- S1-M2: Reservation flow (TDD - RED→GREEN→REFACTOR)
  - Unit tests for atomic_reserve_asset RPC
  - Reservation form component
  - Date picker & conflict detection
- S1-M3: Payment integration (TDD)
  - TossPayments v2 webhook handler
  - Payment confirmation flow
  - Order tracking

## DONE
- S0-1: Environment setup
  - ✅ SvelteKit 5 + TypeScript
  - ✅ Git repo init with Husky pre-commit
  - ✅ ESLint H-01 to H-06 rules
  - ✅ .env.local with real Supabase credentials
- S0-2: Database Schema (THIS SESSION)
  - ✅ All migrations applied successfully

## BLOCKED
(None)

## BACKLOG
- S1-M4: Subscriptions (GSD)
  - Plan selection UI
  - Subscription management
  - Discount calculation integration
- S1-M5: Shipments (GSD)
  - Tracking number integration
  - Return flow
  - Logistics API integration
- Admin dashboard
- Analytics dashboard
- Image/asset management via Cloudinary
