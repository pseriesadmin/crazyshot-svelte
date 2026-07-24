# rental-lifecycle.md — 대여 라이프사이클 상태 머신 & 버튼·스텝퍼 정책
# Harness Flow v3.2 | 2026-07-23 확정

---

## ⛔ 예약 단계 정합 검증 — 2026-07-23

### Stephen의 목표 예약 3단계 흐름

```
1단계 예약신청
  → 상품 대여 모든 옵션 + 결제정보 반영된 신청
  → 즉시 예약코드 발행

2단계 예약대기
  → 관리자가 예약신청정보 확인 + 전자계약 발행·발송
  → 예약신청 단계와 엄격히 구분

3단계 예약승인
  → 사용자 전자계약 서명 완료 + 결제 완료 동시 충족
  → 자동 승인 처리 (관리자 수동 승인 없음)
```

### 현재 시스템 vs 목표 흐름 정합 여부 (2026-07-23 기준)

| 단계 | 목표 | 현재 구현 | 정합 여부 |
|---|---|---|---|
| 1단계 예약신청 | 옵션+결제정보 신청 → 즉시 예약코드 | 장바구니 담기 → `hold` + 예약코드 발행 | ✅ 코드 발행 시점 일치 |
| 2단계 예약대기 | 관리자 계약 발행·발송 | `hold` 상태에서 전자계약 발송 가능 (2026-07-23 구현) | ✅ 기능은 가능 |
| 3단계 예약승인 | 서명 + 결제 완료 → 자동 승인 | 결제 완료만으로 자동 `confirmed` (서명 여부 무관) | ❌ 미구현 |

### 현재 시스템의 핵심 불일치 3가지 (재설계 필요 항목)

```
① 결제 시점
   - 목표: 결제는 3단계 (서명 완료 후)
   - 현재: 결제는 체크아웃 직후 (장바구니 → Toss → 즉시 confirmed)

② 상태 미분리
   - 목표: 1단계(신청)와 2단계(계약 대기) 엄격 구분
   - 현재: 둘 다 hold(신청대기) 단일 상태
            → pending(접수)은 코드에 정의되어 있으나 실제로 사용 안 됨

③ 자동 승인 트리거
   - 목표: 서명 완료 AND 결제 완료 동시 충족 → confirmed 자동 전환
   - 현재: 결제만 완료되면 자동 confirmed (서명 여부 미확인)
            OR 관리자 수동 "승인하기" 버튼 (hold 상태에서 직접 승인 가능)
```

> ⚠️ 위 재설계는 결제 흐름(Toss API), DB 상태값, RPC를 모두 수정하는 🔴 CRITICAL 작업.
> 별도 플랜 수립 필요. 현재 시범서비스는 현행 hold→confirmed 단순 흐름으로 운영.

---

## 전자계약 발송 흐름 (2026-07-23 구현 완료)

### 발송 가능 시점

```
예약 상태 제한 없음 — hold(신청대기) 포함 모든 상태에서 계약서 발송 가능
contractId null → init-contract API가 즉시 생성 후 발송
contractId 존재 → 기존 계약서에 내용 덮어쓰기 후 발송
```

### 계약서 양식 편집 제한 정책 (2026-07-23 확정)

```
편집(btn-tpl-edit) 표시 조건:
  signingsentAt = null  AND  customerSignedAt = null
  → 계약서가 한 번도 발송되지 않은 경우에만 편집 허용

편집 숨김 조건 (둘 중 하나라도 해당):
  ① signingsentAt 있음  → 계약서가 발송된 이후 (내용 변경 혼란 방지)
  ② customerSignedAt 있음 → 고객 서명 완료 이후

미리보기 & 발송 버튼: 모든 상태에서 항상 표시 (재발송 필요 시 사용)

PDF 뷰어 · PDF 다운로드:
  contractPdfUrl 있음 AND customerSignedAt 있음 → 표시
  서명 완료 전에는 숨김 (서명된 최종본만 표시)

서명 링크 확인 ↗:
  signingUrl 있음 AND customerSignedAt = null → 표시 (서명 완료 후 자동 숨김)
```

구현 파일: `src/lib/components/cms/RentalContractViewer.svelte`

```svelte
{#if !signingsentAt && !customerSignedAt}
  <button class="btn-tpl-edit" ...>편집</button>
{/if}
<!-- 미리보기 & 발송 버튼은 조건 없이 항상 렌더링 -->
<button class="btn-tpl-preview" ...>미리보기 &amp; 발송</button>

<!-- PDF 뷰어·다운로드: 서명 완료 후에만 -->
{#if contractPdfUrl && customerSignedAt}
  <div class="pdf-wrap">...</div>
  <a ...>PDF 다운로드</a>
{/if}
```

### 전자계약 발송 API 흐름

```
1. [CMS] "미리보기 & 발송" 버튼 클릭
   → ContractTemplatePreviewModal 오픈
   → GET /api/cms/contract-templates       : 활성 양식 목록 로드
   → GET /api/cms/reservations/[id]/contract-data : 치환 데이터 로드
   → substituteVariables() : {{변수명}} → 실데이터 치환 후 미리보기 렌더링

2. [CMS] "채팅으로 발송" 버튼 클릭
   → contractId가 null이면:
       POST /api/cms/reservations/[id]/init-contract
         → contracts INSERT (idempotent — 기존 있으면 재사용)
         → 반환: { contractId: string }
   → PATCH /api/cms/contracts/[contractId]/content
         body: { title, content_blocks(원본 미치환), specifications, template_id }
         → contracts.template_id 업데이트 포함
   → POST /api/cms/contracts/[contractId]/send-chat
         → contract_signings에 signing_token 생성
         → 고객 채팅으로 서명 링크 발송
         → contracts.signing_sent_at 업데이트
   → 성공: 배너 "계약서 발송됨 · 서명 대기 중" 전환
```

### 주요 파일

| 역할 | 파일 |
|---|---|
| 미리보기·발송 모달 | `src/lib/components/cms/ContractTemplatePreviewModal.svelte` |
| 계약서 탭 뷰어 | `src/lib/components/cms/RentalContractViewer.svelte` |
| 계약서 즉시 생성 | `src/routes/api/cms/reservations/[id]/init-contract/+server.ts` |
| 치환 데이터 조회 | `src/routes/api/cms/reservations/[id]/contract-data/+server.ts` |
| 양식 목록 | `src/routes/api/cms/contract-templates/+server.ts` |
| 내용 저장 | `src/routes/api/cms/contracts/[id]/content/+server.ts` |
| 채팅 발송 | `src/routes/api/cms/contracts/[id]/send-chat/+server.ts` |

### 변수 치환 시스템

```
저장: DB에 {{변수명}} 원본 보존
렌더링: substituteVariables() 호출 시점에 실데이터로 치환

유틸: src/lib/utils/contract-substitution.ts
타입: src/lib/types/contract-module.ts (CONTRACT_VARIABLES)
```

| 변수 | 소스 |
|---|---|
| `{{고객이름}}` | `user_profiles.full_name` |
| `{{연락처}}` | `user_profiles.phone` |
| `{{이메일}}` | `user_profiles.email` |
| `{{주소}}` | `user_shipping_addresses` (is_default=true) |
| `{{예약코드}}` | `rental_reservations.reservation_code` |
| `{{상품명}}` | `products.name` |
| `{{상품코드}}` | `products.product_code` |
| `{{수령형태}}` / `{{수령일시}}` | pickup_method(레이블 치환) / pickup_time |
| `{{반납형태}}` / `{{반납일시}}` | return_method(레이블 치환) / return_time |
| `{{기본대여요금}}` | `orders.base_amount` |
| `{{할인금액}}` | `orders.discount_amount` (쿠폰+포인트 통합) |
| `{{부가세}}` | `orders.tax_amount` |
| `{{최종합계}}` | `orders.final_amount` |

---

## pending vs hold — 상태 실제 사용 관계 (2026-07-23 확인)

```
pending (접수)
  → STATUS_LABEL에 정의됨
  → 실제 플로우에서 사용 여부: 미확인 (사용 안 됨으로 추정)
  → /cms/reservation 목록: 신청대기(hold) 필터만 존재, pending 필터 없음

hold (신청대기)
  → 고객이 상품을 장바구니에 담는 순간 생성
  → 체크아웃 진행 중 = hold (인벤토리 HOLD 보유 상태)
  → 결제 실패 → cancel_payment_and_release_hold RPC → HOLD 해제 + cancelled
  → 결제 성공 → confirm_payment_and_update_reservation RPC → confirmed 자동 전환
  → 관리자가 CMS에서 "승인하기" 클릭 → update_reservation_status → confirmed (수동 경로)
```

> ⚠️ hold가 "장바구니 담기 상태"와 "결제 완료 대기 상태" 둘 다를 의미함.
> Stephen의 목표 흐름에서는 이를 예약신청(step1)/예약대기(step2)로 분리해야 하나 현재 미구현.

---

## CMS 최소 뷰포트

```
CMS 전체: min-width 1280px (PC 전용)
1280px 미만 접속 시 toast 경고 노출 (레이아웃 차단 없음)

/cms/reservation 패널: 1280px에서 730px 너비
  → 4개 탭(대여정보·고객정보·결제정보·계약서) 각 182px — 모두 표시 정상
  → 1280px 미만 뷰포트에서는 패널이 오른쪽으로 오버플로우 (설계 의도)
```

---

## 화면 컨텍스트 분기 (isRentalView)

```
/cms/reservation  → isRentalView = false  (예약 + 대여 전체 관리)
/cms/rentals      → isRentalView = true   (대여 라이프사이클 전용)
```

> `RentalDetailPanel`의 모든 조건부 UI는 이 prop 기준으로 분기됨.
> `isRentalView=true` 시 예약 단계 버튼(승인/거부/취소) 완전 숨김.

---

## 전체 상태 머신

```
[예약 단계]       pending → hold → confirmed
                               ↘ cancelled
                               ↘ expired (HOLD 10분 pg_cron)

[대여 라이프사이클]
  confirmed ──────────────────────────────────┐
      ↓ (방문 수령)         (택배·퀵·기타 수령) ↓
   in_use ◄──────────────── shipped
      ↓ (방문 반납)         (택배·퀵·기타 반납) ↓
   returned ◄──────────── return_requested
      ↓
   completed

  * 어느 단계든 → damage_claimed (파손 신고)
```

---

## RentalJourneyStepper — 스텝 매핑

> 컴포넌트: `src/lib/components/common/RentalJourneyStepper.svelte`

| 순서 | status | 레이블 |
|---|---|---|
| 1 | `hold` | 신청 |
| 2 | `confirmed` | 승인완료 |
| 3 | `shipped` | 반출중 |
| 4 | `in_use` | 대여중 |
| 5 | `return_requested` | 반납중 |
| 6 | `returned` | 반납완료 |

### 스텝 활성화 규칙

```
done   (●–보라) : currentStepIndex보다 앞 인덱스
active (○–보라) : 현재 상태와 status 일치하는 인덱스
inactive        : 나머지

completed → 마지막 스텝(returned)에 done 처리
cancelled / damage_claimed → 취소 UI (✕ 아이콘 + 빨간 텍스트)
```

### steps 필터 prop

```svelte
<!-- 전체 6단계 (기본 — reservation 뷰) -->
<RentalJourneyStepper status={row.status} />

<!-- 필터링 예시 — 필요 시 특정 단계만 표시 -->
<RentalJourneyStepper status={row.status} steps={['confirmed','shipped','in_use','return_requested','returned']} />
```

---

## nextStatus() — 수령·반납 방식별 상태 전환표

> 구현 파일: `src/lib/components/cms/RentalDetailPanel.svelte`

| 현재 상태 | pickup_method | return_method | 다음 상태 | 비고 |
|---|---|---|---|---|
| `confirmed` | `visit` | — | `in_use` | shipped 스킵 (현장 출고) |
| `confirmed` | 기타 | — | `shipped` | 택배·퀵·크레이지배송 |
| `shipped` | — | — | `in_use` | 고객 수령 확인 |
| `in_use` | — | `visit` | `returned` | return_requested 스킵 (현장 반납) |
| `in_use` | — | 기타 | `return_requested` | 택배·퀵 반납 접수 |
| `return_requested` | — | — | `returned` | 반납 확인 처리 |
| `returned` | — | — | `completed` | 대여 종료 |
| terminal\* | — | — | null | 버튼 미표시 |

\* terminal = `completed`, `cancelled`, `damage_claimed`

---

## nextLabel() — 버튼 텍스트 분기표

| 현재 상태 | pickup_method | return_method | 버튼 텍스트 |
|---|---|---|---|
| `confirmed` | `visit` | — | 방문 출고 처리 |
| `confirmed` | 기타 | — | 택배 출고 처리 |
| `shipped` | `visit` | — | 방문수령 확인 |
| `shipped` | 기타 | — | 택배수령 확인 |
| `in_use` | — | `visit` | 방문 반납 처리 |
| `in_use` | — | 기타 | 반납 접수 |
| `return_requested` | — | — | 반납 처리 |
| `returned` | — | — | 완료 처리 |

---

## log_rental_action RPC — action_type 매핑

> Migration 154 (`20260723000154_154_fix_log_rental_action_visit_pickup.sql`)
> RPC: `public.log_rental_action(p_reservation_id, p_action_type, p_admin_id, p_note)`

| action_type | 전환 후 status | 설명 |
|---|---|---|
| `visit_pickup` | `in_use` | 방문 수령: 현장 확인 → 즉시 대여중 (shipped 스킵) |
| `crazy_delivery_pickup` | `shipped` | 크레이지배송 반출: 배송 중 (고객 수령 확인 별도) |
| `visit_return` | `returned` | 방문 반납: 현장 반납 → 반납완료 |
| `crazy_delivery_return` | `returned` | 크레이지배송 반납 완료 |
| 기타 | 변경 없음 | 로그만 기록 (status 유지) |

> ⛔ `visit_pickup → 'shipped'`는 구 로직 (Migration 149). Migration 154에서 `in_use`로 수정 완료.
> Stage + Production 양쪽 적용 확인: 2026-07-23

---

## 예약 단계 버튼 (isRentalView=false 전용)

| 상태 | 버튼 | action |
|---|---|---|
| `hold` | 승인하기 | `/cms/reservation?/approveReservation` |
| `hold` | 거부 | `/cms/reservation?/updateStatus` → `cancelled` |
| non-terminal + non-hold | 예약 취소 | `/cms/reservation?/updateStatus` → `cancelled` |

> `/cms/rentals`(`isRentalView=true`)에서는 위 버튼 전부 숨김.

---

## 채팅 알림 발송 매핑 (NOTIFY_TYPE_MAP)

| 상태 | notifyType | 버튼 텍스트 |
|---|---|---|
| `confirmed` | `shipment_notify` | 반출 알림 발송 💬 |
| `in_use` | `return_remind` | 반납 예정 알림 💬 |
| `return_requested` | `return_registration` | 반납 정보 요청 💬 |
| `returned` | `rental_complete` | 대여 종료 알림 💬 |

> `cancelled`, `damage_claimed` 상태에서는 채팅 알림 버튼 미표시.

---

## 화면별 사용 RPC 요약

| 동작 | RPC | 호출 위치 |
|---|---|---|
| 상태 변경 (라이프사이클·예약) | `update_reservation_status` | `/cms/reservation?/updateStatus` (절대 URL 고정) |
| 예약 승인 | `approve_reservation` | `/cms/reservation?/approveReservation` |
| 채팅 알림 | `send_rental_chat_notification` | `/cms/rentals?/sendChatNotify` |
| 액션 로그 기록 | `log_rental_action` | 현장 출고·반납 처리 시 |
| 목록 조회 | `get_rental_list` | `/cms/rentals/+page.server.ts` |

> H-01 원칙: 직접 DML 절대 금지. 모든 상태 변경은 RPC 경유.

---

## /cms/rentals 필터 정책

```typescript
// 대여 라이프사이클 전용 상태만 노출 (예약 단계 제외)
const RENTAL_STATUSES = new Set([
  'confirmed', 'shipped', 'in_use',
  'return_requested', 'returned', 'completed', 'damage_claimed'
])
// pending, hold, cancelled → /cms/reservation에서 관리
```

---

## 구현 파일 참조

```
버튼·상태 분기  : src/lib/components/cms/RentalDetailPanel.svelte
스텝퍼          : src/lib/components/common/RentalJourneyStepper.svelte
대여현황 목록   : src/routes/cms/rentals/+page.svelte
대여현황 서버   : src/routes/cms/rentals/+page.server.ts
예약목록 서버   : src/routes/cms/reservation/+page.server.ts (RentalListRow 타입 정본)
액션 로그 RPC   : supabase/migrations/20260723000154_154_fix_log_rental_action_visit_pickup.sql
```

---

## GATE C 확인 항목

```
[ ] confirmed + visit pickup → shipped 없이 in_use로 직행?
[ ] confirmed + 기타 pickup → shipped 경유?
[ ] in_use + visit return → return_requested 없이 returned로 직행?
[ ] in_use + 기타 return → return_requested 경유?
[ ] /cms/rentals에서 hold/pending 행이 목록에 노출되지 않음?
[ ] isRentalView=true 시 승인/거부/예약취소 버튼 완전 숨김?
[ ] completed/cancelled/damage_claimed → 다음 단계 버튼 미표시?
[ ] log_rental_action visit_pickup → in_use (shipped 아님)?
[ ] 스텝퍼 completed 상태 → returned 스텝에 done 처리?
[ ] 스텝퍼 cancelled/damage_claimed → 취소 UI 표시?
[ ] 채팅 알림 버튼 cancelled/damage_claimed에서 숨김?
[ ] 계약서 편집 버튼: signingsentAt 또는 customerSignedAt 있으면 숨김?
[ ] 계약서 미리보기 & 발송 버튼: 모든 상태에서 항상 표시?
[ ] PDF 뷰어·다운로드: customerSignedAt 없으면 숨김 (서명 완료 후에만 표시)?
[ ] 서명 링크 확인 ↗: customerSignedAt 있으면 숨김?
```

---

*rental-lifecycle.md v1.2 | Harness Flow v3.2 | 2026-07-23 편집 제한 정책 추가*
