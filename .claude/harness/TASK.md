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
- S1-M2: Reservation Flow (TDD)
  - Unit tests for atomic_reserve_asset RPC
  - Conflict detection (date overlap checking)
  - Reservation status state machine (pending→confirmed→active→completed)
  - Implement proper error handling for double-booking

## NEXT
- S1-M3: Payment Integration (TDD)
  - TossPayments v2 webhook handler
  - Payment confirmation flow
  - Order tracking and status updates
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
- S0-2: Database Schema
  - ✅ 5 migrations (001-005)
  - ✅ 10 tables with RLS enabled
  - ✅ 9 RPC functions (atomic_reserve_asset, calculateCartTotal, processPaymentAndCreateOrder 등)
  - ✅ 3 subscription plans seeded
- S0-3: Supabase-JS Client
  - ✅ Singleton client with RPC wrappers
  - ✅ Auth store (performSignUp/SignIn/SignOut)
  - ✅ Auth state auto-initialization
  - ✅ ESLint v10 migration
- S1-M1: Products Module
  - ✅ Product listing with search/filter
  - ✅ Product detail page
  - ✅ Asset availability display
  - ✅ 8 products + 9 assets seeded

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
