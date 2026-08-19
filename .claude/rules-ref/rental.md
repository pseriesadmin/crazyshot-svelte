# rental.md — 렌탈·예약·가용성 도메인 규칙
# Harness Flow v3.1 | M2 Reservation 도메인

---

## 핵심 원칙

```
예약 생성 = atomic_reserve_asset RPC 경유 (직접 INSERT 절대 금지 — H-01)
가용성 조회 = expires_at 필터 필수 (누락 시 만료 HOLD가 재고로 잡힘 — H-04)
HOLD = 10분 타임아웃 (pg_cron 자동 해제)
이중예약 = DB 레벨 UNIQUE 제약으로 물리 차단 (앱 레벨 체크만으론 불충분)
```

---

## RPC 함수 참조

```typescript
// 예약 생성 (HOLD → confirmed)
await supabase.rpc('atomic_reserve_asset', {
  p_product_id: string,
  p_asset_id: string,
  p_user_id: string,
  p_start_date: string,   // YYYY-MM-DD
  p_end_date: string,     // YYYY-MM-DD
  p_idempotency_key: string
})
// 반환: { success: boolean, reservation_id: string | null, error: string | null }

// 가용성 조회 (항상 expires_at 필터 포함)
await supabase.rpc('check_asset_availability', {
  p_product_id: string,
  p_start_date: string,
  p_end_date: string
})
```

---

## 가용성 쿼리 패턴 (직접 쿼리 필요 시)

```typescript
// ✅ 올바른 패턴 (만료 HOLD 제외)
const now = new Date().toISOString()
.or(`status.eq.confirmed,and(status.eq.temp,expires_at.gt.${now})`)

// ❌ 금지 패턴 (만료 HOLD가 재고로 잡힘)
.in('status', ['temp', 'confirmed'])
```

---

## 렌탈 기간 분류

```
일간  : 1 ~ 7일    (dailyRate × 일수)
주간  : 8 ~ 30일   (weeklyRate × 주수, 나머지는 일간)
월간  : 31일+      (monthlyRate × 월수, 나머지는 주간/일간)
```

---

## 할인 적용 순서

```
기본 렌탈료
→ 멤버십 할인 (CRAZY: 15% / PRO: 10% / BASIC: 0%)
→ 쿠폰 할인 (정액 또는 정률)
→ 포인트 차감
→ VAT 역산 (부가세 포함 여부 상품별 설정)
→ 배송비 (CRAZY 등급만 무료)
```

---

## 크레이지스코어 → 보증금 매핑

```
score ≥ 85  → 보증금 0%
score 70~84 → 보증금 30%
score 50~69 → 보증금 50%
score < 50  → 보증금 100%

공식: 70 + 대여횟수×2 - 연체일수×8 - 파손건수×15
```

---

## 예약 상태 머신

```
HOLD (10분) → confirmed (결제 완료) → active (대여 시작) → returned (반납)
         ↘ expired (pg_cron 자동 만료)
confirmed → cancelled (환불)
active    → overdue (연체)
```

---

## 예약 대상 = 가입 완료 계정 (2026-08-18 확정 — 게스트 자동 익명계정 생성 폐기)

```
⛔ 과거 정책(폐기): 비회원이 예약 시도 시 supabase.auth.signInAnonymously()로 화면에
   안 보이는 임시 손님계정을 자동 생성해 그대로 예약을 진행시켰다("게스트도 회원과
   동일하게 예약 가능"). 2026-08-18부터 이 자동 손님계정 생성은 완전히 폐기됐다.

✅ 현재 정책: 실제 가입 완료(또는 로그인) 세션만 예약 실행 가능. 판별 함수:
   isRealMemberSession(session) — src/lib/utils/authGuard.ts
   (세션 없음 → false / user.is_anonymous === true인 익명세션 → false / 그 외 → true)

게이트 지점: src/routes/products/[id]/+page.svelte handleReserve() 최상단
  - 비회원/익명세션이면 예약을 진행하지 않고 토스트 노출:
    "크레이지샷 로그인 또는 5초 가입만 진행해주세요" (확인 버튼 포함)
  - '확인' 클릭 → src/lib/components/auth/SignUpModal.svelte를 initialMode="login"으로
    오픈(같은 화면 위 오버레이 — 페이지 이동 없음)
  - 로그인/가입 성공 → 예약 시도 당시 인자(e)를 그대로 보관해뒀다가 handleReserve()
    재호출로 예약을 이어서 진행(sessionStorage 등 별도 영속화 불필요 — 페이지 이동이
    없으므로 컴포넌트 로컬 $state 유지만으로 충분)

연관 화면 — /cart(장바구니)도 동일 원칙 적용: 비회원·익명세션은 src/routes/cart/
  +page.server.ts에서 /auth/login?redirect=/cart로 리다이렉트(더 이상 빈 장바구니를
  보여주지 않음) — /account(내정보)·찜(위시리스트)은 이미 이 원칙대로 동작 중이었음
  (별도 수정 불필요, 확인만 함).

⚠️ 이 정책 변경 대상에서 명시적으로 제외된 것 — 판단 근거는 service-operations.md 참고:
  - 채팅 상담(ChatWindow.svelte): 익명 로그인 유지 필수(RLS auth.uid() 의존,
    회원가입 시 동일 UID로 전환돼 대화이력 보존)
  - 콘텐츠(크레이지로그) 댓글 / 상품 리뷰: 애초에 익명 로그인에 의존하지 않고 이미
    실제 로그인만 허용 — 무수정
```

---

## TDD 필수 케이스 (M2 테스트 작성 시)

```
Happy:
- 정상 예약: 가용 자산 1개, 2명 순차 예약 → 1명 성공 1명 실패
- HOLD 생성 → 결제 완료 → confirmed 전환

Edge:
- 동일 날짜 겹치는 예약 시도 (종료일 = 다음 시작일은 허용)
- HOLD 10분 직전 결제 완료 시도
- 예약 가능 수량 정확히 0일 때

Error:
- 만료된 HOLD로 결제 시도 → reservation_not_found 에러
- 존재하지 않는 asset_id → 에러 메시지 명확화
- 동시 예약 10명 → exactly 1명만 성공 (동시성 테스트)
```

---

## GATE C 확인 항목 (M2 관련)

```
[ ] 이중예약이 물리적으로 불가능한가? (DB UNIQUE 제약 확인)
[ ] HOLD 10분 후 pg_cron 자동 해제되는가?
[ ] 만료된 HOLD가 가용 재고로 집계되지 않는가?
[ ] atomic_reserve_asset RPC 경유 (직접 INSERT 없음)?
[ ] 예약 폼에서 날짜 유효성 검증이 서버사이드에도 있는가?
[ ] 예약 실행(handleReserve) 진입점에 signInAnonymously() 폴백을 다시 추가하지 않았는가?
    (게스트 자동계정 생성은 2026-08-18부로 폐기 — isRealMemberSession() 게이트로 대체됨)
```

---

*rental.md v3.1 | Harness Flow v3.1 | M2 Reservation Domain*
