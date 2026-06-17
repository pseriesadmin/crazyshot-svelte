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
```

---

*rental.md v3.1 | Harness Flow v3.1 | M2 Reservation Domain*
