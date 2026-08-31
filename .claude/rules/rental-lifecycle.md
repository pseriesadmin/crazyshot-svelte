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

## 전자계약 발송·서명 흐름 — 전용 문서로 이관 (2026-07-28)

> ⛔ 이 절의 상세 내용(발송 API 흐름·편집 제한 정책·변수 치환 시스템·서명 유효성 판정·만료 처리·
> 관리자 딥링크 라우팅·데이터 모델 등)은 `.claude/rules-ref/contract.md`로 전부 이관되었다.
> 전자계약·서명 관련 작업 시 반드시 `@.claude/rules-ref/contract.md`를 먼저 호출할 것 — 이 문서에는
> 더 이상 최신 내용을 유지하지 않는다(발송 시점 상태 무관 원칙만 아래에 요약 유지).

```
예약 상태 제한 없음 — hold(신청대기) 포함 모든 상태에서 계약서 발송 가능
```

구현 파일 인덱스·API 상세·GATE C 체크리스트는 contract.md 참조.

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

expired (만료됨)
  → STATUS_LABEL: '만료됨' (/cms/reservation/+page.svelte — RSV-A-B1, 2026-08-31 추가)
  → hold 생성 후 30분 경과 시 pg_cron(hold_expiration_cleanup, 매 1분)이 status='expired'로 자동 전환
  → 이 전환 자체가 재고 해제 (별도 해제 로직 없음 — service-operations.md §10)
  → /cms/reservation 목록에서 "만료됨" 필터로 조회 가능
  → STATUS_LABEL이 2026-08-31 이전에는 없어 목록에서 status 원문(expired)이 그대로 노출됐음 — RSV-A-B1로 수정
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
                               ↘ expired (HOLD 30분 pg_cron — service-operations.md §10)

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
| 1 | `hold` | 예약신청 |
| 2 | `confirmed` | 계약완료 |
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

## 채팅 알림 발송 매핑

> 2026-07-27부터 **자동발송(AUTO_NOTIFY)** 과 **수동버튼(NOTIFY_TYPE_MAP)** 이 서로 다른 notify_type을
> 쓰는 상태(`in_use`)가 생겼다 — 반드시 아래 두 표를 구분해서 볼 것.

### 자동발송 (AUTO_NOTIFY) — `cms/reservation/+page.server.ts`

상태 전이(`updateStatus`/`approveReservation` 액션)가 성공하면 관리자 조작 없이 자동으로 발송된다.

| 전이 후 상태 | notifyType | 비고 |
|---|---|---|
| `confirmed` | `reservation_approval` | 승인 완료 알림 (실결제 경로도 동일 타입, 2026-07-27 추가) |
| `shipped` | `shipment_notify` | 반출 알림 |
| `in_use` | `rental_confirm` | **대여확인**(수령확인) 알림 — 2026-07-27 신규. 반납예정 알림(`return_remind`)과는 별개 이벤트 |
| `return_requested` | `return_registration` | 반납 정보 요청 |
| `returned` | `rental_complete` | 대여 종료 알림 |
| `cancelled` | `reservation_cancelled` | 예약 취소 알림 — 2026-08-18 추가(검수로 발견된 공백, Migration 288) |
| `damage_claimed` | `damage_claimed` | 파손 신고 접수 알림 — 2026-08-18 추가(현재 이 상태로 전환하는 CMS 버튼은 없음, `update_reservation_status` 경로가 생기면 자동 발송되도록 미리 매핑만 해둠) |

> HOLD 30분 자동만료(`release_reservation_hold` pg_cron)도 2026-08-18부터 `hold_expired` 알림을
> 발송한다 — 위 표(app 코드 AUTO_NOTIFY 매핑)와 달리 이건 RPC 내부 루프에서 직접 호출된다
> (service-operations.md §10 참고).
>
> ⚠️ **HOLD D-1 타이머 리셋 정책(2026-08-31, Migration 394)**: `release_reservation_hold()`
> D-1 조건이 "계약 발송됐으면 영구 제외(NOT EXISTS)"에서 **"계약 발송 시점에 타이머 리셋"**
> (GREATEST(rr.created_at, cs.sent_at) + 30분)으로 변경됐다.
> - 계약서 미발송 hold → created_at 기준 30분 만료 (기존과 동일)
> - 계약서 발송된 hold → 최신 sent_at 기준으로 리셋된 30분 만료
> - "재발송"(RentalContractViewer 재발송 버튼)할 때마다 sent_at이 갱신돼 타이머가 다시 리셋됨
> - D-3(payment_confirmed_at IS NOT NULL, 결제완료 예외)는 변경 없이 그대로 유지
> Stage DB(ezyvffjvuwmtuhpxdjrw) 적용 대기 중(2026-08-31 기준).
>
> `locker_guide`(무인보관함 1시간 전 안내, 2026-08-20 신설)도 위 표와 마찬가지로 상태 전이가
> 아니라 **Vercel Cron**(`/api/cron/locker-guide`, 10분 간격)이 `claim_reservations_due_for_
> locker_guide` RPC로 방문대여/방문반납 + 영업외시간(23:00~08:59) + 1시간 이내 임박 조건을
> 만족하는 예약을 직접 선점해 발송한다 — `hold_expired`와 달리 순수 SQL(pg_cron)이 아니라
> 앱코드 경유 Vercel Cron이라 채팅카드(`send_rental_chat_notification`)·브라우저 푸시
> (`sendReservationLifecyclePush`)·알리고 SMS(`sendSms`) 세 경로 전부 구조적 제약 없이
> 정상 발송된다.
>
> ⚠️ **채팅카드(위 표) ≠ 브라우저 푸시(FCM) — 2026-08-19 명문화**: 위 표는 `send_rental_chat_
> notification` RPC의 채팅카드 발송만 다룬다. 브라우저 푸시는 `src/lib/server/push.ts`의
> `CUSTOMER_LIFECYCLE_PUSH_COPY`에 별도로 문구를 등록해야만 발송되며, 이 표에 타입을
> 추가한다고 자동으로 따라오지 않는다(`reservation_cancelled`·`damage_claimed`·`hold_expired`
> 3종이 이 문제로 채팅카드만 가고 푸시는 누락됐다가 2026-08-19 수정 — 상세는
> service-operations.md §15 정본).

### 수동버튼 (NOTIFY_TYPE_MAP) — `cms/rentals` `RentalDetailPanel.svelte`

관리자가 "…알림 발송 💬" 버튼을 직접 눌러야 발송된다. 상태 전이와 독립적으로 언제든 재발송 가능.

| 상태 | notifyType | 버튼 텍스트 |
|---|---|---|
| `confirmed` | `shipment_notify` | 반출 알림 발송 💬 |
| `in_use` | `return_remind` | 반납 예정 알림 💬 — 반납일 당일 09:00 자동 발송 + 관리자 수동 재발송 가능 |
| `return_requested` | `return_registration` | 반납 정보 요청 💬 |
| `returned` | `rental_complete` | 대여 종료 알림 💬 |

> `cancelled`, `damage_claimed` 상태에서는 채팅 알림 버튼 미표시.
> `in_use` 진입 시 자동으로는 `rental_confirm`(대여확인)만 발송되고,
> `return_remind`(반납예정)는 **반납일 당일 09:00 pg_cron(`auto-return-remind`)이 자동 발송**(Migration 256)
> 하며, 관리자가 이 표의 수동 버튼으로 언제든 재발송도 가능하다.
> 자동발송 중복 방지: `action_payload->>'action_url'`이 오늘 날짜에 이미 발송된 세션은 스킵.

### `return_remind` 알림 내 고객 반납이력 등록 CTA (2026-08-15 신규)

`return_remind` 메시지의 액션 카드 "반납 등록하기" 버튼:
- `action_payload.action_url = '/account/rental/{reservation_id}/history'` (Migration 255)
- `ActionCard.svelte`에서 `window.open(url, '_blank', 'noopener,noreferrer')` — 새 창(탭)으로 열림
- 착지 화면: `/account/rental/[id]/history` — 고객이 반납 이력(사진+날짜) 직접 등록

**고객 반납이력 등록 화면 (`/account/rental/[id]/history`)**
```
- 기존 로그인 세션 재사용(별도 인증 흐름 없음), window.open(_blank)으로 열림
- 이력 테이블: `product_history_records` (CMS 관리자 이력과 동일 테이블 공유)
- 구분 컬럼: `registered_by TEXT CHECK ('admin','customer')` — Migration 257
- 고객 전용 RPC: get_product_history_for_customer / upsert_product_history_record_customer /
  delete_product_history_record_customer — 전부 SECURITY DEFINER + auth.uid() 소유권 검증
- 고객 전용 업로드 API: /api/account/rental/[id]/history/upload — reservation.user_id 검증 필수
- 고객은 자신의 `registered_by='customer'` 이력만 수정·삭제 가능
  (CMS 관리자가 등록한 'admin' 이력은 읽기 전용)
- Storage 경로: product-images/{product_id}/customer_history/thumb_{uuid}.webp
```

### 상담채팅 세션 상태(chat_sessions.status) — 대기(pending) 재진입 조건

> ⚠️ 위 예약/대여 상태와는 별개 개념. `chat_sessions.status`(open/pending/closed)는 CMS `/cms/chat`
> 상담세션 목록의 진행중/대기/종료 탭 분류 기준이다.

```
2026-07-27 변경: 세션이 대기/종료 상태였다면 새 메시지(고객 발신이든 관리자 발신이든)가 도착하는
  즉시 AI 의도분류 결과와 무관하게 무조건 진행중(open)으로 전환된다(src/routes/api/chat/message/+server.ts).
  대기(pending) 상태는 이제 오직 auto_pending_inactive_sessions RPC(1시간 무응답 자동전환)로만
  재진입한다 — AI가 CS_ESCALATE로 분류해도 더 이상 즉시 대기로 강등되지 않는다.

긴급 배지: 관리자 응답이 아직 없는 상태에서 마지막 고객 메시지가 CS_ESCALATE로 분류된 세션은
  상담세션 목록 카드 제목 우측에 "긴급" 배지로 표시된다(/api/chat/sessions 응답의 is_urgent 필드,
  AdminChatPanel.svelte). 관리자가 답변하면 자동 해제.
```

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

## 예약 1건의 다중 상품 구성 — 옵션상품(reservation_options) (2026-08-14 신설)

> ⛔ 2026-08-14 이전에는 이 규정이 어디에도 문서화되어 있지 않았다 — CMS 대여/예약 관리
> 화면(`RentalDetailPanel`, `get_rental_list`)과 고객용 `/account/rental` 전부 옵션상품을
> 다루지 않았음(체크아웃 카드 노출용으로만 존재, Migration 176). 아래가 최초 규정.

```
예약(rental_reservations) 1건 = 메인상품 1개(product_id, 실물 재고단위 고정) + 옵션상품 0개 이상
  → 옵션상품은 reservation_options 테이블(reservation_id FK)에 별도 저장
  → 컬럼: option_product_id(products FK, nullable) · option_name · qty · unit_price
  → 실물 재고 단위 배정(FOR UPDATE SKIP LOCKED) 대상이 아님 — 수량(qty)만 기록,
    시리얼 단위 추적 안 함(예: "메모리카드 2개"는 개별 카드를 구분하지 않음)
  → option_product_id는 보통 부모 상품을 가리켜 product_code가 정책상 NULL인 경우가 흔함
    (products.md §2-1 — 부모는 영구히 품번 없음). 코드 없는 옵션은 정상 상태.

⛔ 한 고객이 서로 다른 메인상품을 함께 예약(카메라+렌즈 등)하는 것은 옵션상품과 다른 케이스다.
   그 경우 create_hold_reservation이 상품별로 각각 호출돼 별도의 rental_reservations 행이
   생성된다(같은 order_id로만 연결) — CMS 목록에도 별도 행 2개로 표시된다. "한 행에 여러
   메인상품 코드가 몰리는" 시나리오는 존재하지 않는다.
```

### CMS 표시 (2026-08-14 구현)

```
RentalDetailPanel.svelte "대여정보" 탭 → "상품 정보" 섹션 바로 아래에 "옵션상품 (N개)" 섹션
  → GET /api/cms/reservations/{id}/options 로 lazy-fetch(결제정보 탭과 동일 패턴)
  → 옵션 0개면 섹션 자체 미표시(레거시 예약은 대부분 옵션 없음)
  → /cms/rentals·/cms/reservation 두 화면이 이 컴포넌트를 공유하므로 별도 구현 불필요
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
옵션상품 조회   : src/routes/api/cms/reservations/[id]/options/+server.ts

[2026-08-15 신규]
return_remind CTA URL 추가   : supabase/migrations/20260815000255_255_return_remind_action_url.sql
CTA 새 창 열기 수정          : src/lib/components/chat/ActionCard.svelte (window.open _blank)
반납일 자동 알림 cron        : supabase/migrations/20260815000256_256_auto_return_remind_cron.sql
고객 이력 DB 확장            : supabase/migrations/20260815000257_257_product_history_customer_support.sql
고객 반납이력 API            : src/routes/api/account/rental/[id]/history/+server.ts
고객 반납이력 업로드 API     : src/routes/api/account/rental/[id]/history/upload/+server.ts
고객 반납이력 화면           : src/routes/account/rental/[id]/history/ (+page.server.ts, +page.svelte)
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
[ ] 전자계약(발송/편집/서명/딥링크) 관련 GATE C 항목은 contract.md 참조 — 이 문서에서 중복 관리 안 함
[ ] in_use 진입 시 자동발송은 rental_confirm(대여확인)만 — return_remind는 수동 버튼 전용 유지?
[ ] 상담세션이 대기/종료 상태에서 새 메시지 도착 시 AI 판단과 무관하게 진행중으로 전환되는가?
[ ] 옵션상품(reservation_options) 0개인 예약에서 "옵션상품" 섹션이 표시되지 않는가?
[ ] 옵션상품 product_code가 없는 항목(부모 상품 참조 등)에서 코드칩 없이 정상 표시되는가?
[ ] 긴급 배지(is_urgent)가 관리자 응답 후 자동 해제되는가?
[ ] AUTO_NOTIFY 표에 새 notify_type을 추가했다면 push.ts CUSTOMER_LIFECYCLE_PUSH_COPY에도
    동일 타입을 함께 추가했는가? (채팅카드와 브라우저 푸시는 별개 경로 — 위 표 하단 각주,
    service-operations.md §15 참고)
[ ] QR 스캔 경로(rentalQrTransition.ts)와 RentalDetailPanel 수동버튼 경로 둘 다
    log_rental_action RPC 호출이 포함됐는가(fail-soft)? note 값으로 경로를 구분하는가
    ('qr_scan' vs 'manual')? (2026-08-31 — EC-4 검증 대상)
[ ] RentalContractViewer "재발송" 버튼이 /api/cms/contracts/[id]/send-chat을 호출하는가?
    (신규 엔드포인트 생성 없음, 기존 재사용) "폐기" 버튼이 discardSentContract 액션을 통해
    clearIssuedContractHelper.discardSentContract()를 경유하는가?
[ ] 재발송·폐기 버튼 모두 manager 이상 권한 게이트가 적용됐는가? (security-auth.md
    "계약서 양식·발행·발송" 게이트와 동일 수준 — isRentalView=false 전용)
[ ] D-1 타이머 리셋 관련 변경 시(Migration 394) — D-3(payment_confirmed_at IS NOT NULL)
    조건을 건드리지 않았는가? GREATEST(created_at, sent_at) 기준이 "계약 미발송 hold"에서도
    created_at 단독으로 정확히 계산되는가?
[ ] 고객의 탈퇴 신청 차단 조건을 바꿀 때(대여 상태 머신 변경 포함) — hold·confirmed·
    shipped·in_use·return_requested 상태가 모두 "진행중 대여" 범위에 포함돼 있는지 확인했는가?
    (service-operations.md §16 — 탈퇴 신청 시 RPC 레벨 차단 대상 상태)
```

---

*rental-lifecycle.md v1.5 | Harness Flow v3.2 | 2026-07-27 채팅 알림 자동/수동 매핑 분리 + 대기 재진입 조건 문서화 |
2026-07-28 전자계약 발송·서명 상세 내용을 contract.md로 이관(중복 제거) | 2026-08-19 AUTO_NOTIFY
표에 "채팅카드≠브라우저푸시" 각주 추가(신규 알림타입 추가 시 push.ts 동기화 필요, 상세는
service-operations.md §15 정본) + GATE C 체크리스트 1건 추가 | 2026-08-28 GATE C에 탈퇴 신청
차단 상태범위 점검 항목 추가 (service-operations.md §16 탈퇴 기능 신설에 따른 상호참조)*
