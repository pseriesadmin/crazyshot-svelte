# 대여 라이프사이클 정밀 감사 — 2026-07-26

감사 범위: 상품 상세 → 예약신청 → 예약승인 → 대여확인 → 반납요청 → 반납완료
감사 방법: Explore 에이전트 전체 코드베이스 탐색 + 빌드 로그 분석

---

## 🔴 CRITICAL — 즉시 해결 필요

### C-1: 결제 CTA 완전 미구현 (사용자 결제 불가)
파일: `src/routes/checkout/+page.svelte:1117`
```svelte
onclick={() => { if (canProceed) alert('결제 시뮬레이션 — 실제 TossPayments 연동은 M3에서 구현됩니다.'); }}
```
- TossPayments SDK `requestPayment` 호출 없음
- 현재 사용자는 체크아웃 화면에서 실제 결제 진행 불가
- 관련 태스크: S1-M3 Payment Integration (BLOCKED)

### C-2: Vercel Production 빌드 실패 (36 env var 누락)
빌드 에러: `PUBLIC_SUPABASE_URL`, `ANTHROPIC_API_KEY` 등 36개 MISSING_EXPORT
- Preview 빌드: ✅ 성공 (Preview env vars 설정됨)
- Production 빌드: ❌ 실패 (Production env vars 미설정)
- 조치: Vercel Dashboard → Settings → Environment Variables에서 Production 체크 추가

---

## 🟡 BOUNDARY — 주요 로직 결함

### B-1: log_rental_action RPC 전체 미사용
파일: codebase 전체 grep 확인
- Migration 154에 정의된 `log_rental_action(p_reservation_id, p_action_type, p_admin_id, p_note)` RPC
- 대여 이력 감사 로그 기록 목적이나 프론트엔드 어디서도 호출 없음
- 결과: 방문 출고/반납, 현장 처리 등 중요 행위가 DB에 기록되지 않음

### B-2: 채팅 알림 수동 전용 (자동화 단절)
파일: `src/routes/cms/rentals/+page.server.ts` (sendChatNotify action)
- 상태 전환(update_reservation_status RPC) 완료 후 알림이 자동 발송되지 않음
- 관리자가 패널에서 별도 버튼 클릭 필요
- `hold` 상태(신청 접수)와 `shipped` 상태(배송 출발)에 해당하는 NOTIFY_TYPE_MAP 없음
  → 해당 상태에서 알림 버튼 자체가 미표시됨

NOTIFY_TYPE_MAP 누락 현황:
```typescript
// RentalDetailPanel.svelte — 현재 구현
const NOTIFY_TYPE_MAP: Partial<Record<ReservationStatus, string>> = {
  confirmed: 'shipment_notify',     // 출고 알림
  in_use: 'return_remind',          // 반납 예정 알림
  return_requested: 'return_registration', // 반납 정보 요청
  returned: 'rental_complete',      // 대여 종료 알림
  // hold: ??? → 신청 접수 알림 없음
  // shipped: ??? → 배송 출발 알림 없음
}
```

### B-3: 결제 경로 이중화 (데이터 불완전 경로 존재)
- 경로 A: `/api/payment/confirm` — 완전한 파라미터(포인트/쿠폰/보증금 포함) ✅
- 경로 B: `/payment/success/+page.server.ts` — Toss 리다이렉트 fallback, 포인트/쿠폰/보증금 미전달 ⚠️
- checkout CTA 미구현으로 현재 어느 경로도 실사용 안 됨
- 경로 A로 통일하고 B는 deprecated 처리 필요

### B-4: 마이페이지 대여 카드 상품명 null (hold 단계)
파일: `src/routes/account/rental/+page.server.ts`
```typescript
// orders(order_items(products(name, category))) 조인
// → hold 예약에는 order가 없음 → product_name = null
```
- `create_hold_reservation`으로 생성된 예약은 결제 전 orders 레코드 없음
- 마이페이지 대여 카드에서 hold 상태 상품명이 null로 표시됨
- 해결 방안: rental_reservations.asset_id → assets.product_id → products 직접 조인 추가

### B-5: 계약서 서명 후 상태 전환 조건 제한
파일: `src/routes/api/contracts/[token]/sign/+server.ts:67~68`
```typescript
// shipped 상태에서만 in_use로 자동 전환
.eq('status', 'shipped')
```
- hold/confirmed 상태에서 서명 시 상태 변경 없음
- 업무 흐름: hold 상태에서도 계약서 발송 가능 → 서명 완료해도 status 미변경

---

## 🟢 ROUTINE — 구조적 개선 필요

### R-1: cms/rentals → cms/reservation action 경로 의존
파일: `src/lib/components/cms/RentalDetailPanel.svelte`
```svelte
action="/cms/reservation?/updateStatus"  <!-- 하드코딩 -->
action="/cms/reservation?/approveReservation"  <!-- 하드코딩 -->
```
- `/cms/rentals` 뷰에서 상태 전환이 `/cms/reservation` 서버에 POST
- 라우트 변경 시 파손 위험

### R-2: 두 가지 예약 생성 RPC 병존
- `create_hold_reservation` — 상품 상세 페이지에서 직접 사용
- `atomic_reserve_asset` — `/api/checkout/initiate/+server.ts`에서 사용 (UI 미연결)
- 두 RPC의 동작 차이 및 필드 정합 검토 필요

### R-3: 상품 상세 페이지 배송 방식 하드코딩
파일: `src/routes/products/[id]/+page.svelte`
```typescript
// set_reservation_shipment_method 호출 시
p_pickup_method: 'visit'  // 하드코딩 — 사용자 선택 반영 안 됨
```
- CalendarTimePicker에서 선택한 배송 방식이 RPC에 전달되지 않음

---

## ✅ 정상 구현 확인

- 상품 상세 → create_hold_reservation RPC 호출 ✅
- 비로그인 예약신청 → /auth/login?next= 리다이렉트 ✅
- 체크아웃 서버 데이터 로드 (hold 예약 → assets → products) ✅
- calculate_cart_total RPC 연동 ✅
- CMS cms/reservation 예약 목록 + 승인/거부 actions ✅
- CMS cms/rentals 대여 현황 + 상태 전환 buttons ✅
- 전자계약 발송·서명·PDF 전체 흐름 ✅
- 채팅 시스템 (세션·메시지·Realtime·읽음 처리) ✅
- RentalJourneyStepper 상태 매핑 ✅
- cancel_payment_and_release_hold RPC (실패·취소 경로) ✅

---

## 상태별 알림 발송 현황 (목표 vs 실제)

| 단계 | 목표 알림 | 실제 발송 트리거 | 상태 |
|---|---|---|---|
| 예약신청(hold) | 신청 접수 알림 | ❌ 없음 | ❌ |
| 예약승인(confirmed) | 승인 완료 알림 | 관리자 수동 버튼 | ⚠️ |
| 반출(shipped) | 배송 출발 알림 | ❌ 없음 | ❌ |
| 대여확인(in_use) | 대여 시작 알림 | 관리자 수동 버튼 | ⚠️ |
| 반납요청(return_requested) | 반납 정보 요청 | 관리자 수동 버튼 | ⚠️ |
| 반납완료(returned) | 대여 종료 알림 | 관리자 수동 버튼 | ⚠️ |
| 전자계약 서명 완료 | 서명 완료 알림 | 직접 chat_messages INSERT | ✅ |

---

*감사일: 2026-07-26 | 담당: Claude Code + Explore 에이전트*
