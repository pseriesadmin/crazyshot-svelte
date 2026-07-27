# CMS 상담채팅 — 대여 라이프사이클 알림 정합성 정밀 감사 — 2026-07-27

감사 범위: 상품상세(전체상품) → 예약신청 → (결제 PG 미구현·Mock으로 임시 스킵) → 예약승인 → 대여확인 → 반납요청 → 반납완료 전 구간의 **사용자 채팅 알림** + `/cms/chat` 상담세션 목록 연동
감사 방법: Explore 에이전트 2개 병렬(① 체크아웃/예약/결제mock/승인/라이프사이클 상태머신, ② 채팅알림 트리거·CMS 세션목록·전자계약) 전체 코드베이스 정적 분석 + 최근 마이그레이션(169~173) 대조
선행 감사: [[rental_lifecycle_audit_2026-07-26]] (전일, 상태전이 중심) — 이번 감사는 그 결과 위에서 "채팅 알림" 축으로 재검증. 커밋 605f660(예약승인·채팅알림 자동화)으로 일부는 해결되었고 일부는 이번에 새로 발견됨.

---

## 전일 감사(BL-LC-B2) 대비 갱신 현황

- **해결됨**: hold 생성 시 `reservation_hold` 자동발송(`api/checkout/notify-hold`), CMS 승인/상태변경 시 `AUTO_NOTIFY` 맵을 통한 자동발송(`cms/reservation/+page.server.ts`) — 전일 "수동 버튼 전용" 문제는 CMS 주도 전이에 한해 해소됨.
- **여전히 미해결/신규 발견**: 아래 CRITICAL/BOUNDARY 항목 참조. 특히 실결제 경로 알림 누락, 대여확인 알림 타입 부재는 전일 감사에서도 표로는 지적됐으나(`❌`) 이번 감사에서 원인 파일:라인까지 구체화됨.

---

## ② 사용자 채팅모달 알림 시퀀스 — 요청 시퀀스 대비 실제 구현

| 요청 시퀀스 | notify_type | 발송 트리거 | 상태 |
|---|---|---|---|
| 예약신청 알림 | `reservation_hold` | `products/[id]/+page.svelte:258` → `api/checkout/notify-hold/+server.ts:28` (hold 생성 직후 자동) | ✅ 발송됨, 본문 텍스트 제네릭 (BL-CHAT-B1) |
| 예약승인 알림 | `reservation_approval` | `cms/reservation/+page.server.ts:101`(승인) / `api/checkout/confirm-mock/+server.ts:32`(mock 결제) | ⚠️ mock·CMS수동승인만 발송, 실결제 경로 미발송 (BL-CHAT-C1) |
| 계약 발송(서명요청) | `contract_link` (RPC 미경유 직접 DML) | `api/cms/contracts/[id]/send-chat/+server.ts:62-106` | ⚠️ 세션 재사용 정책 위반 (BL-CHAT-B4) |
| 대여확인 알림 | — | **없음** — in_use 진입 시 발송되는 것은 `return_remind`(반납예정)뿐 | ❌ 격차 (BL-CHAT-C2) |
| 택배(배송) 알림 | — | **없음** — `confirmed→shipment_notify`("반출 알림")가 유일, 실제 송장/추적 연동 아님 | ❌ 격차 (BL-CHAT-B2) |
| 반납요청 알림 | `return_registration` | in_use→return_requested 자동(AUTO_NOTIFY) + 수동 버튼(`cms/rentals`) | ✅ |
| 반납완료 알림 | `rental_complete` | return_requested→returned 자동(AUTO_NOTIFY) + 수동 버튼 | ✅ |

---

## 🔴 CRITICAL

### BL-CHAT-C1: 실결제(Toss) 확인 경로에서 예약승인 알림 미발송
파일: `src/routes/api/payment/confirm/+server.ts`, `supabase/migrations/20260705000059_59_payment_tables.sql`
- `confirm_payment_and_update_reservation` RPC 내부에 `send_rental_chat_notification` 호출 없음, 호출부에서도 별도로 부르지 않음.
- 현재 유일하게 `reservation_approval`을 발송하는 경로는 CMS 수동승인 + `confirm-mock`(임시 Mock)뿐 — 실서비스에서 실제 결제가 붙으면 사용자가 승인 알림을 아예 못 받는 기능 누락.
- 결제 모듈 정식 연동 시 반드시 함께 처리 필요 (S1-M3 연계).

### BL-CHAT-C2: "대여확인"(수령확인) 전용 알림 타입 부재
파일: `src/routes/cms/reservation/+page.server.ts`(AUTO_NOTIFY 맵), `src/lib/components/cms/RentalDetailPanel.svelte:188-193`(NOTIFY_TYPE_MAP)
- Stephen이 요청한 시퀀스의 "대여확인 알림"(상품 수령/대여시작 확인)에 대응하는 notify_type이 존재하지 않음.
- `in_use` 진입 시 자동 발송되는 유일한 타입은 `return_remind`("반납 예정 알림")뿐이며, 라벨과 실제 발송 시점(대여 시작 즉시)이 불일치(BL-CHAT-B6과 연관).
- 계약서명으로 `shipped→in_use` 전환되는 경로(아래 C3)는 이마저도 타지 않아 `contract_signed` 메시지만 발송됨.

### BL-CHAT-C3: 계약서명 완료 시 상태 직접 UPDATE(H-01 위반) + 알림 유실 가능
파일: `src/routes/api/contracts/[token]/sign/+server.ts:56-119`
- 고객 서명 완료 시 `rental_reservations.status`를 `shipped→in_use`로 **RPC 미경유 직접 UPDATE**(66-69행) — `rental-lifecycle.md`의 "H-01: 직접 DML 절대 금지" 원칙 위반.
- 이 경로는 `cms/reservation/+page.server.ts`의 `AUTO_NOTIFY` 맵을 타지 않으므로, 정상 in_use 진입 시 발송되는 알림이 발송되지 않고 별도의 `contract_signed` 메시지만 감.
- 알림 대상 세션을 `status='open'`인 것만 조회(88-95행) — `pending`/`closed`뿐이면 이 서명완료 알림 자체가 **조용히 유실**됨(에러도 로그도 없음).

### BL-CHAT-C4: confirm-mock이 무관한 hold 예약까지 일괄 승인
파일: `src/routes/api/checkout/confirm-mock/+server.ts:15-35`
- 현재 장바구니와 무관하게, 호출 시점에 해당 유저의 **모든** `hold` 예약을 조회해 전부 `confirmed`로 전환 + 알림 발송.
- 사용자가 과거에 만든 무관한 hold 예약(예: 이전 세션의 미완료 시도)이 있으면 이번 체크아웃과 함께 의도치 않게 승인됨.
- Mock 임시 구현이지만, 실결제 전환 시 동일 패턴을 이어받지 않도록 반드시 재검토 필요.

---

## 🟡 BOUNDARY

### BL-CHAT-B1: reservation_hold/reservation_approval 콘텐츠 CASE 미매핑
파일: `supabase/migrations/20260727000170_170_sync_send_rental_chat_notification.sql`
- `send_rental_chat_notification`의 `v_content` CASE 문이 `shipment_notify`/`return_remind`/`return_registration`/`rental_complete` 4종만 명시 처리.
- 가장 빈번하게 발송되는 `reservation_hold`/`reservation_approval`은 ELSE 분기로 떨어져 제네릭 "상품명 알림" 텍스트만 생성됨 — `ActionCard.svelte`는 이 두 타입의 카드 라벨("예약 신청 확인"/승인 확인)은 이미 구분해 렌더링하고 있어 본문 텍스트만 어울리지 않는 상태.

### BL-CHAT-B2: 택배/배송 추적 알림 부재
- Stephen이 요청한 "택배알림"에 대응하는 실제 송장/배송상태 추적 알림이 없음. `confirmed→shipment_notify`("반출 알림")가 유일하며 이는 출고 시점 1회성 알림일 뿐, 택배사 API 연동이나 배송 상태 업데이트 알림 체계는 미구현.

### BL-CHAT-B3: send_rental_chat_notification이 context_type 무시하고 세션 재사용
파일: `supabase/migrations/20260727000170...sql:57-61`
- 알림 대상 세션을 찾을 때 `context_type`(`general`/`product_inquiry`/`reservation`/`payment`/`return`) 구분 없이 해당 유저의 아무 open/pending 세션에나 카드 삽입.
- 예: 상품 문의로 열어둔 세션에 반납 알림이 섞여 들어갈 수 있음 — `.claude/rules-ref/chat.md`가 명시하는 컨텍스트별 분리 설계 의도와 배치.

### BL-CHAT-B4: 계약 발송/서명 경로가 세션 재사용 정책 위반
파일: `src/routes/api/cms/contracts/[id]/send-chat/+server.ts:62-106`, `src/routes/api/contracts/[token]/sign/+server.ts:88-95`
- `send-chat`: `status='open'`인 세션만 찾고, 없으면 `pending`/`closed` 재활성화 없이 **신규 세션을 새로 생성** — `chat.md`의 "신규 세션 생성 금지, 기존 세션 재활성화 우선" 정책 위반.
- `sign`: 마찬가지로 `open`만 찾고, 없으면 폴백 없이 알림이 유실됨(BL-CHAT-C3과 동일 근본 원인).

### BL-CHAT-B5: 수동 알림버튼과 자동발송 알림 중복 발송 가능 (멱등성 없음)
- `cms/rentals`의 수동 "…알림 발송 💬" 버튼(`RentalDetailPanel.svelte` NOTIFY_TYPE_MAP)과 `cms/reservation`의 자동 AUTO_NOTIFY가 동일 notify_type을 독립적으로 발송 가능.
- 관리자가 상태변경 직후(자동발송 이미 됨) 수동 버튼을 다시 누르면 동일 카드가 중복 발송됨 — "이미 발송됨" 표시나 발송 이력 조회 UI가 CMS에 없어 관리자가 인지하기 어려움.

### BL-CHAT-B6: return_remind 발송 시점이 라벨과 불일치
- `AUTO_NOTIFY['in_use'] = 'return_remind'`가 `in_use` **진입 즉시**(대여 시작 시점) 발송됨 — 라벨 "반납 예정 알림"이 암시하는 "반납일 임박 알림"과 실제 동작이 다름.
- 반납 예정일 임박 자동 리마인드(스케줄/cron 기반)는 별도로 존재하지 않고, 이후 재알림은 관리자가 수동 버튼을 다시 누르는 것에만 의존.

---

## 🟢 ROUTINE

### BL-CHAT-R1: `/api/chat/action-card` 죽은 코드
파일: `src/routes/api/chat/action-card/+server.ts:18-22`
- 존재하지 않는 `user_profiles.is_admin` 컬럼으로 권한 체크(실제 컬럼은 `cms_role`) — 호출 시 오류 또는 항상 falsy. UI 호출부(`chatService.ts:132`의 `sendActionCard()`) 자체도 아무 곳에서도 사용되지 않음.

### BL-CHAT-R2: CMS 세션목록 페이지네이션 없음 + N+1 쿼리
파일: `src/routes/api/chat/sessions/+server.ts:36`(`.limit(100)`), `:50-67`(세션별 마지막 메시지 개별 쿼리)
- 세션 100건 초과 시 오래된 open/pending 세션이 목록에서 사라짐. 마지막 메시지 조회가 세션당 1쿼리라 세션 수 증가 시 성능 저하.

### BL-CHAT-R3: `AUTO_NOTIFY['confirmed']` 도달 불가능한 데드 코드
파일: `src/routes/cms/reservation/+page.server.ts:129`
- `updateStatus` 액션의 `nextStatus()` 로직상 `confirmed`를 다음 상태로 targeting하는 경로가 없음(hold→confirmed는 별도의 `approveReservation`/`confirm-mock` 경로로만 발생) — 혼란 유발 가능성 있는 무해한 데드 코드.

### BL-CHAT-R4: `rental-lifecycle.md` 문서에 AUTO_NOTIFY 자동발송 매핑 누락
파일: `.claude/rules/rental-lifecycle.md` "채팅 알림 발송 매핑" 섹션
- 현재 문서는 CMS 수동 버튼 매핑(`NOTIFY_TYPE_MAP`)만 기술 — `cms/reservation/+page.server.ts`의 자동 `AUTO_NOTIFY` 트리거(예약승인 포함)는 문서에 없음. 향후 세션 혼선 방지를 위해 갱신 필요.

---

## ③ 상담세션 목록 — 사용자 계정별 연동 확인

- `chat_sessions.user_id` 기반 계정 연동 자체는 정상 동작.
- 그러나 알림 타입/컨텍스트 구분이 전혀 없어(BL-CHAT-B3), 한 유저의 세션 목록만으로는 "이 세션이 어떤 라이프사이클 단계의 알림을 받았는지" 구분 불가 — 자동발송 카드(`sender_type='admin'`)와 관리자의 실제 수동 답변이 목록 UI상 시각적으로 동일함.

## ⑥ 백오피스(예약목록/대여목록) 연동 확인

- `/cms/reservation` ↔ `/cms/rentals`의 상태 분리(`RENTAL_STATUSES` 필터)는 문서/코드 일치. 두 화면 모두 동일 `update_reservation_status` RPC + `nextStatus()`를 공유하므로 목록 조회 자체의 정합성 문제는 없음. 이번 감사에서 발견된 문제는 전부 "알림" 축에 한정됨.

---

## ✅ 정상 구현 확인 (채팅 알림 축)

- `send_rental_chat_notification` RPC — service_role 전용 잠금(migration 172), sender_type/action_payload 스키마 정합(migration 170) 정상.
- `hold`/`shipped`/`in_use`/`return_requested`/`returned` 상태전이의 AUTO_NOTIFY 자동발송 배선 자체는 정상 연결됨(어떤 타입을 어떤 내용으로 보내느냐가 문제일 뿐, 발송 자체는 됨).
- `nextStatus()`/`nextLabel()` 상태머신은 `rental-lifecycle.md` 문서와 100% 일치(전일 감사에서 확인, 이번에 재확인).

---

*감사일: 2026-07-27 | 담당: Claude Code + Explore 에이전트 2개 병렬 | 결제(PG) 단계는 Stephen 지시에 따라 Mock으로 스킵하고 "예약신청→예약승인" 흐름으로 간주하여 검증*
