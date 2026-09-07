# CMS 전역 정밀 재검증 — 트랙 B(메뉴횡단 연동) 감사 (2026-09-06)

## 요약

8개 연동 체인 중 6개는 실제 코드 경로 추적 결과 정상 배선 확인. 2개 체인에서 신규 결함
발견: ① 두발히어로(dhero) 자동 반납완료 경로가 대여완료 포인트 적립(Migration #407)에서
누락된 CRITICAL 등급 공백, ② `/cms/customers` 문의내역 탭이 `/cms/chat` 긴급배지(is_urgent)
정보를 아예 조회하지 않아 두 화면 간 정보 비대칭이 있는 BOUNDARY 등급 공백. 부가적으로
`confirm-mock` 엔드포인트가 승인알림 5개 발신지점 공식 목록에 없는 6번째 활성 발신지점으로
독자 로직을 중복 구현 중임을 발견(BOUNDARY, 문서 공백 + 유지보수 리스크).

## 8개 체인 검증 결과

| # | 시작점 | 검증 포인트 | 실제 확인 결과 | 등급 |
|---|---|---|---|---|
| 1 | 예약승인→채팅→푸시→포인트 | 승인 5개 발신지점의 알림 순서/타이밍, returned 전이 시 포인트 중복/누락 | `sendApprovalNotifications()`(채팅+푸시 통합 헬퍼)가 4개 발신지점(cms/reservation, pay-result, sign, pay-mock)에 정상 적용. `awardRentalCompletePoints`는 `newStatus==='returned'` 전이 시에만 발화하도록 두 경로(QR/수동)에 정확히 배선되고 RPC 자체에 멱등가드(예약ID 기준) 있어 중복지급 위험 없음. **단, 세 번째 `returned` 전이 경로인 `dheroAutoAdvance.ts`(두발히어로 배송완료 자동전이)는 포인트 적립 호출이 아예 없음 — 신규 결함, 아래 참고** | **CRITICAL(신규발견 1)** |
| 2 | option_only 제외 | 검색/홈/하이프팩/NLSearch 등 고객노출 경로에서 실제 제외되는지 | `search_products`(#390)·`get_products_by_ids`(#391)·홈테마(#392)·하이프팩테마(#393) RPC 4종 전부 `option_only=false` 필터 적용 확인. 앱코드 측 NLSearch 인덱스(`productSearchIndex.ts:249`)와 검색페이지 클라이언트 쿼리(`products/search/+page.svelte:40`)도 동일하게 `.eq('option_only', false)` 적용 확인. 기능적으로 정상 작동 | 정상 |
| 3 | 고객탈퇴→진행중대여차단 | RPC 차단 상태 5종과 CMS 탈회배지 표시 동기화 | `request_account_withdrawal`(#366)이 hold/confirmed/shipped/in_use/return_requested 5개 상태를 정확히 차단(`active_rental_exists`). `get_customer_list`(#376)가 `withdrawal_status`를 반환하고 `deleted_at IS NULL` 필터를 유지해 `requested` 상태 회원이 계속 목록에 노출됨 — `/cms/customers/+page.svelte:259-260`에서 `withdrawal_status !== 'none'`이면 "탈회" 배지 정상 렌더링. 두 화면(RPC 차단 vs CMS 배지)이 동일 컬럼(`withdrawal_status`)을 정본으로 삼아 일관됨 | 정상 |
| 4 | 쿠폰지연채번→결제확정→선물카드 | `use_coupon` 채번 시점, `approve_pending_coupon_gift`의 코드 노출 여부 | `use_coupon`(#348)이 `generate_user_coupon_redeemed_code`(#292, 멱등)를 호출해 sequenced 모드만 실채번. `approve_pending_coupon_gift`(#293 B-6)는 `code_mode='sequenced'`일 때 `v_coupon_code`(NULL) 대신 안내문구로 분기해 `null` 문자열이 채팅카드에 노출되던 과거 결함이 이미 수정 완료 상태. 채번 시점(결제확정)과 선물카드 발송 시점(배포 시점, 결제 이전)이 서로 다른 이벤트임이 코드로 명확히 분리돼 있어 코드 불일치 위험 없음 | 정상 |
| 5 | AUTO_NOTIFY↔push.ts 동기화 | notify_type 값 상호 일치, confirm-mock 활성/중복 여부 | `rentalQrTransition.ts`·`dheroAutoAdvance.ts`·`cms/reservation/+page.server.ts`의 AUTO_NOTIFY 매핑 4종(`shipment_notify`/`rental_confirm`/`return_registration`/`rental_complete`)이 `push.ts`의 `CUSTOMER_LIFECYCLE_PUSH_COPY`에 전부 대응 문구 존재. **`confirm-mock/+server.ts`는 죽은 코드가 아니라 cart 1단계 체크아웃의 살아있는 활성 엔드포인트이며, `sendApprovalNotifications()`/`resolveApprovalNotifyPlan()` 공용 헬퍼를 쓰지 않고 배치알림+푸시 로직을 자체 재구현 중** — service-operations.md §9가 문서화한 "5개 발신지점"(approveReservation·pay-mock·pay-result·sign·payment/success) 목록에 없는 6번째 활성 발신지점. `create_checkout_order`가 `create_reservation_order`(Migration #280)에 위임하는 멱등 함수로 재정의되어 주문 중복생성 위험은 없음을 확인했으나, 승인알림 로직 자체의 코드 중복은 유지보수 리스크로 남아있음 | **BOUNDARY(신규발견 2)** |
| 6 | 긴급배지 화면간 일관성 | `/cms/chat`과 `/cms/customers`(문의내역) 두 화면에서 일관 표시되는지 | `/api/chat/sessions`(AdminChatPanel 데이터원)만 `is_urgent` 필드를 계산(`urgentIds` 기반). `/cms/customers/chat-sessions/+server.ts`(CustomerDetailPanel "문의내역" 탭의 데이터원)는 `id, status, context_type, context_id, created_at, updated_at, closed_at`만 select — `is_urgent` 계산 로직 자체가 없어 상태 칩(open/pending/closed)만 표시되고 긴급 여부는 전혀 알 수 없음. 동일 세션이 두 화면에서 다른 정보량으로 노출됨 | **BOUNDARY(신규발견 3)** |
| 7 | RentalDetailPanel/CustomerDetailPanel invalidateAll 동기화 | `shallow_routing_invalidateall_stale_2026-08-25.md`와 동일 계열 결함 재발 여부 | `/cms/reservation`·`/cms/rentals`·`/cms/customers` 3개 화면 전부 `selectedId`가 `page.state` 기반 shallow-routing 파생값이 아니라 순수 `$state` 지역변수이고, 선택은 클릭 핸들러가 직접 대입(`selectedId = row.reservation_id`)한다 — `/cms/products`가 겪은 버그(`page.state`를 원천으로 삼는 `$derived`가 `invalidateAll()` 도중 일시적으로 비는 문제)의 전제조건 자체가 없음. `/cms/reservation`은 한 걸음 더 나아가 `$effect`로 `data.rentals`가 갱신될 때 `selectedRow`를 재동기화하고, 필터 밖으로 사라진 행이면 패널을 자동으로 닫는 방어(RSV-A-C1)까지 구현돼 있음. 3개 화면 모두 동일 계열 결함 재발 없음 | 정상 |
| 8 | `/cms/set/rental` 3플래그 전파 경로 | 설정변경이 예약(cart)/대여(RentalDetailPanel) 화면까지 실제로 도달하는 배관 자체 | `is_bulk_delivery`/`is_courier_dependent`/`is_delivery_type` 3개 플래그 모두 `rental_method_options` 단일 테이블의 컬럼이며, 쓰기(`/cms/set/rental/+page.server.ts`)와 읽기(`cart/+page.server.ts`, `isBulkDeliveryMethod.ts`, `RentalDetailPanel.svelte`→dhero API) 양쪽 다 이 테이블을 캐시 레이어 없이 매 요청 직접 SELECT — 중간에 값이 복제·캐시되는 지점이 없어 CMS 저장 즉시 다른 화면에도 반영되는 배관 구조 자체는 건전함. (요금 계산 산식의 정확성 자체는 A1/A7 트랙 범위이므로 판정 제외) | 정상(배관만) |

## 신규 발견 (상세)

### [CRITICAL] 두발히어로 자동 반납완료 시 대여완료 포인트 미적립

- **파일:라인**: `src/lib/server/dheroAutoAdvance.ts` (`maybeAutoAdvanceOnDheroDelivered` 함수 전체, `awardRentalCompletePoints` import·호출 없음)
- **재현조건**: 고객이 택배(두발히어로 연동 배송방식)로 반납 → 두발히어로 배송상태가 5(배송완료)로 갱신되는 시점에 `dheroAutoAdvance.ts`가 `return_requested → returned`로 **자동** 전이. 이 경로는 `/api/cron/dhero-sync/+server.ts`(정기 동기화) 또는 `/api/cms/reservations/[id]/dhero/+server.ts` GET(관리자 수동 새로고침)에서 호출됨.
- **근거**: Migration `20260901090000_407_award_rental_complete_points.sql` 파일 상단 주석이 "호출 위치: `rentalQrTransition.ts`(QR 반납 경로) → `cms/reservation/+page.server.ts` updateStatus 액션(수동 반납 경로) 두 경로 모두"라고 명시적으로 스코프를 2곳으로 한정하고 있으며, 실제로 이 두 파일에만 `awardRentalCompletePoints` 호출이 존재함(grep 전수 확인). `dheroAutoAdvance.ts`는 동일하게 `returned` 상태로 전이시키고 `AUTO_NOTIFY`(`rental_complete`) 채팅카드·푸시까지는 정확히 발송하면서 포인트 적립 호출만 빠져 있음 — 세 번째 `returned` 전이 경로가 애초에 Migration #407 설계 시점에 고려되지 않았던 것으로 보임(구현 당시 근거인 `cms_global_verification_v5_synthesis_2026-08-31.md`가 dhero 자동전이 경로를 포함해 감사했는지는 미확인).
- **영향범위**: 택배(두발히어로) 반납이 자동으로 완료 처리되는 모든 예약 건에서 고객이 대여완료 포인트를 받지 못함. `award_rental_complete_points` RPC 자체는 멱등(예약ID 기준 중복지급 방지)이라 이후 관리자가 수동으로 같은 예약에 `updateStatus`를 다시 눌러도 이미 `returned` 상태라 액션 자체가 노출되지 않아(rental-lifecycle.md nextStatus 표 — terminal 상태에서 버튼 미표시) 사후 보정 경로도 없음. 고객 관점에서는 "포인트를 못 받았는데 알 방법이 없는" 조용한 손실.
- **권고**: `dheroAutoAdvance.ts`의 `update_reservation_status` 성공 후 `newStatus === 'returned'`일 때 `awardRentalCompletePoints(admin, reservationId)`를 fail-soft로 추가(다른 두 경로와 동일 패턴). RPC가 멱등이므로 회귀 위험 낮음.

### [BOUNDARY] `/cms/customers` 문의내역 탭에 긴급배지(is_urgent) 정보 없음

- **파일:라인**: `src/routes/cms/customers/chat-sessions/+server.ts:37-42`(select 컬럼 목록에 urgency 판정 로직 부재), 렌더링부 `src/lib/components/cms/CustomerDetailPanel.svelte:1669-1687`(상태 칩만 표시, urgent 배지 없음)
- **재현조건**: 고객이 CS_ESCALATE로 분류되는 문의를 보내 `/cms/chat`(AdminChatPanel)에서는 "긴급" 배지가 뜨는 상태에서, 같은 고객을 `/cms/customers`에서 조회 후 "문의내역" 탭을 열면 해당 세션이 상태 칩(진행중/대기/종료)만 표시되고 긴급 여부는 UI 어디에도 나타나지 않음.
- **영향범위**: 관리자가 `/cms/chat` 목록을 거치지 않고 `/cms/customers`에서 고객을 먼저 찾아 응대 여부를 판단하는 워크플로우(예: 고객이 전화로 문의해 CMS에서 이름 검색부터 시작하는 경우)에서 긴급 상태를 놓칠 수 있음. 다만 `/cms/chat`이 여전히 1차 채널로 정상 작동하므로 배지 자체가 소실되는 것은 아님(표시 매체가 하나로 좁혀지는 것).
- **권고**: `/cms/customers/chat-sessions`에도 `/api/chat/sessions`와 동일한 urgency 판정 로직(마지막 메시지 CS_ESCALATE + admin_id 미배정 등, service-operations.md §13 ③④ 조건)을 재사용해 `is_urgent` 필드를 추가하고 CustomerDetailPanel에 동일한 배지를 렌더링하는 것을 검토. (A3/A5 트랙이 각자 화면을 더 깊게 보고 있으므로 이 결함은 두 트랙 교차점에서만 드러나는 성격 — 어느 한쪽 단일화면 검증만으로는 발견되지 않음)

### [BOUNDARY] `confirm-mock`이 승인알림 공용 헬퍼를 우회한 6번째 미문서화 발신지점

- **파일:라인**: `src/routes/api/checkout/confirm-mock/+server.ts:64-95`
- **재현조건**: 항상(이 엔드포인트가 호출될 때마다) — `sendApprovalNotifications()`/`resolveApprovalNotifyPlan()`을 호출하지 않고 `send_rental_chat_notification_batch` RPC + `sendReservationLifecyclePush(..., 'reservation_approval')`을 직접 인라인으로 재구현.
- **근거**: `service-operations.md` §9는 "5개 발신지점(approveReservation·pay-mock·pay-result·sign·payment/success) 중 활성 4개에 헬퍼 적용 완료"라고 명시하는데, 실제 코드에서 `sendApprovalNotifications(` 호출부는 `cms/reservation/+page.server.ts`·`contract/[token]/pay-result/+page.server.ts`·`api/contracts/[token]/sign/+server.ts`·`api/contracts/[token]/pay-mock/+server.ts` 4곳뿐이며(grep 확인), `confirm-mock`은 목록에 아예 없음에도 살아있는 코드로 동일한 승인알림 책임(배치판정+채팅+푸시)을 수행 중.
- **영향범위**: 현재는 기능적 결함으로 이어지지 않음(cart 체크아웃 시점엔 통상 계약서명 전이라 `mark_reservation_payment_confirmed`가 대부분 false를 반환해 `confirmedReservations`가 비어 이 로직 자체가 드물게만 실행됨, `create_checkout_order`도 `create_reservation_order`에 위임하는 멱등 함수라 주문 중복생성 위험 없음). 다만 향후 `resolveApprovalNotifyPlan`의 배치판정 조건(예: 취소/만료 형제 제외 로직)이 바뀌면 `confirm-mock`은 그 변경을 따라가지 못해 두 발신지점의 배치 알림 결과가 어긋날 수 있는 잠재 리스크.
- **권고**: `confirm-mock`의 확정 루프도 `resolveApprovalNotifyPlan`+`sendApprovalNotifications` 공용 헬퍼로 교체하거나, 최소한 service-operations.md §9의 "5개 발신지점" 목록에 6번째 지점으로 등재해 향후 세션이 헬퍼 변경 시 이 파일을 빠뜨리지 않도록 문서화.

## 부가 발견

- `dheroAutoAdvance.ts`·`rentalQrTransition.ts`·`cms/reservation/+page.server.ts` 3곳의 `AUTO_NOTIFY` 매핑 상수가 각 파일에 개별 하드코딩돼 있음(공유 상수 파일 없음) — 현재는 값이 서로 일치하지만, 신규 notify_type 추가 시 3곳 모두 수동으로 동기화해야 하는 구조적 위험이 있음(이번 감사에서는 3곳 전부 일치함을 직접 대조 확인함). 별도 리팩터링 과제로 남겨둠(이번 세션 스코프 외 — 요청범위 외 수정 금지 원칙에 따라 수정하지 않음).
- `get_customer_list`(#376)와 CMS 탈회배지(§3)는 정상이지만, `restore_withdrawn_account`가 유예기간(30일) 내 재로그인 시 자동복구되는 흐름(`+layout.server.ts`)과 CMS 배지가 즉시 사라지는지는 이번 세션에서 실측하지 않음(로그인 이벤트 기반이라 정적 코드 추적만으로는 100% 검증 불가 — RPC가 5개 컬럼을 정상적으로 원복하는 것은 마이그레이션 파일로 확인했으나 CMS 화면 쪽 반영은 새로고침 시점 문제라 별도 이슈 아님).

## 자체 오인점검

- confirm-mock을 처음 grep했을 때 "PG 미연동 임시" 주석 문구만 보고 죽은 코드로 오판할 뻔했으나, `cart/+page.svelte`·`contract/[token]/+page.svelte`의 실제 참조와 git log(최근 3개 커밋에 포함)를 대조해 활성 엔드포인트임을 확인 후 결론을 뒤집음 — misidentifications.md의 "결론이 옳아도 근거를 코드로 직접 확인할 것" 교훈과 동일한 함정을 피함.
- `create_checkout_order`가 §4(주문연결 유일 지점 원칙)를 위반하는 두 번째 주문 생성 지점처럼 보여 CRITICAL로 분류할 뻔했으나, Migration #280 원문을 직접 읽어 `create_checkout_order`가 `create_reservation_order`에 위임하는 멱등 함수로 이미 재정의됐음을 확인하고 오판을 피함(문서만 믿지 않고 마이그레이션 SQL 원문 대조).
