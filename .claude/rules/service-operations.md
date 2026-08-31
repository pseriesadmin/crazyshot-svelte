# service-operations.md — 통합 서비스 운영 로직 정책
# Harness Flow v3.2 | front(사용자 화면) ↔ cms(관리자 화면) 상호 운영 원칙 인덱스

---

## 이 문서의 성격

```
이 문서는 기술 스택 규칙(core-rules.md)도, 디자인 정책(uiux-index.md)도 아니다.
"front 화면에서 벌어진 일이 cms에 어떻게 반영돼야 하는가 / cms의 조작이 front에 어떻게
보여야 하는가"라는 서비스 운영 관점의 원칙만 다룬다.

⛔ 이 문서는 인덱스다 — 각 원칙의 세부 구현·API 명세·데이터모델은 아래 표가 가리키는
원본 문서가 정본(SSOT)이다. 이 문서에 세부 내용을 복사해 중복 관리하지 않는다.
원본 문서가 갱신되면 이 문서는 손대지 않아도 된다(포인터만 유지).
```

---

## 1. DB 환경 분리 (front·cms 공통 전제)

```
모든 운영 원칙은 stage(ezyvffjvuwmtuhpxdjrw) 검증 → production(vnbpmvxruyciuuaermyh) 적용
순서를 전제로 한다. front 변경이든 cms 변경이든 이 순서를 벗어나지 않는다.
```
→ 상세: `core-rules.md` "Supabase — DB 환경 분리"

---

## 2. 상품 데이터 동기화 — cms 등록 → front 노출

```
cms에서 등록/수정한 상품(가격·재고·품번)이 front 고객 화면에 반영되는 원칙:
  - 부모 가격(price_rules) 변경 → 활성 자식에게 DB 트리거로 자동 UPSERT 동기화(단방향)
  - 자식 재고(is_active) 토글 → front 예약 가능 여부(create_hold_reservation 배정 대상)에
    즉시 반영
  - products RLS는 "부모 + is_active + deleted_at IS NULL"만 anon에 노출 — 자식(재고단위)은
    front에 직접 노출되지 않음
```
→ 상세: `products.md` §2-8(RLS), §5(예약 가능 조건), §8-G(가격 동기화 트리거)

---

## 3. 예약 상태전이 → 알림 자동/수동 매핑

```
cms에서 예약 상태를 변경(승인·반출·반납 등)하면 front 고객 채팅으로 자동 알림이 발송된다.
상태별 자동발송 타입과, cms 관리자가 수동으로 재발송 가능한 버튼은 서로 다른 매핑표를 쓴다
(같은 in_use 상태라도 자동발송은 rental_confirm, 수동버튼은 return_remind — 서로 다른 이벤트).
```
→ 상세: `rental-lifecycle.md` "채팅 알림 발송 매핑"(AUTO_NOTIFY / NOTIFY_TYPE_MAP)

---

## 4. 주문·배치 처리 — 여러 예약을 하나의 결제로 묶기

```
front 장바구니에 여러 상품(또는 동일 상품 여러 대)을 담아 한 번에 예약신청(hold)하면:
  - hold 생성 시점에는 order_id가 비어있다(각 reservation은 독립적으로 재고를 원자 배정받음)
  - 장바구니 체크아웃 제출 시점(cart/+page.svelte)에 create_reservation_order RPC 1회 호출로
    이번 제출에 포함된 reservation 전부를 하나의 order로 묶는다 — 이 지점이 주문 연결이
    생성되는 유일한 지점이다(상품상세 즉시예약 등 다른 지점에서 별도로 주문을 만들지 않는다 —
    같은 결제가 서로 다른 주문으로 쪼개지는 결함을 예방하기 위한 설계)
  - cms 예약현황/대여현황(RentalDetailPanel) "대여정보" 탭은 같은 order로 묶인 상품 전부를
    반복 표시 — 개별 상품의 상태(신청대기/계약완료 등)는 각자 독립적으로 진행된다
  - 예약 승인(④ 단계) 시 배치 채팅알림(send_rental_chat_notification_batch)으로 묶인 상품
    전체를 하나의 알림 카드로 안내 — 이 통합/개별 판단(`resolveApprovalNotifyPlan`)은
    **승인을 일으킨 트리거가 무엇이든(관리자 수동 "승인하기" 버튼이든, 고객의 계약서명
    완료로 인한 자동승인이든) 동일하게 적용된다**(2026-08-18 — 최초엔 관리자 수동승인
    경로에만 있고 고객 자동승인 경로엔 빠져 있던 설계공백을 발견해 통일).
```
→ 상세: `.claude/harness/TASK.md` "예약 신청 시점 주문 연결 + 대여정보 탭 통합 표시"(2026-08-17
  NOW 항목, Migration 280/275) · `rental-lifecycle.md` "옵션상품(reservation_options)" ·
  `reservation-rental-execution.md` §0-4 #7(통합/개별 알림 판단 트리거 통일 경위)

---

## 5. 권한·역할 경계 — cms 역할 vs 고객 세션

```
front 고객 세션(authenticated)과 cms 관리자 역할(cms_role: partner/manager/superadmin)은
완전히 다른 권한 체계다. cms 화면의 특정 액션(전역 설정·코드체계 등)은 manager 이상만 가능하며,
front 고객은 애초에 cms_role 개념 자체가 없다 — 두 체계를 혼동해 권한 검사를 작성하지 않는다.
```
→ 상세: `security-auth.md` "CMS 관리자 역할" · "역할별 CMS 접근 매트릭스"

---

## 6. 에러 분류·에스컬레이션 원칙 (front·cms 공통)

```
front/cms 어느 쪽 작업이든 에러는 4단계로 분류해 대응한다:
  Class A(일시적/네트워크) → 자동 재시도
  Class B(컴파일/테스트 실패) → Self-Correction
  Class C(요구사항 불명확) → Stephen 에스컬레이션(추측 금지)
  Class D(보안 위반·서버키 노출) → 즉시 중단
```
→ 상세: `.claude/harness/ERROR_TAXONOMY.md`

---

## 7. 채팅 세션 상태 — front 발화 vs cms 응대

```
front 고객의 채팅 세션 상태(진행중/대기/종료)는 cms 상담 목록의 탭 분류 기준이 된다.
대기·종료 상태에서 새 메시지가 도착하면(고객이든 관리자든) 무조건 진행중으로 전환되고,
대기 재진입은 오직 1시간 무응답 자동전환(cron)으로만 일어난다 — cms에서 수동으로 대기 상태로
되돌리는 액션은 없다.
```
→ 상세: `chat.md` §2(세션 관리 정책) · §3(상태 머신)

---

## 8. 전자계약 연동 — cms 발송 → front 서명 → cms 확인

```
cms에서 계약서를 발행·발송하면 front 고객 채팅에 서명 액션카드가 전달되고, 고객 서명 완료가
다시 cms 예약 패널의 배지·예약 상태 전환(예: shipped→in_use)에 반영된다. 예약 단계(hold
포함 모든 상태)와 무관하게 계약 발송이 가능하다는 점이 front-cms 연동의 핵심 전제다.
```
→ 상세: `contract.md` "발송 흐름"·"서명 흐름"·"관리자 딥링크 라우팅"

---

## 9. 예약승인(confirmed) 게이팅 — 결제완료 AND 계약서명 완료 (✅ 구현·Stage·Production 전부 검증 완료, 2026-08-17/18)

```
front 고객이 목업/실결제를 완료해도 그 자체만으로는 예약이 "계약완료(confirmed)"로
전환되지 않는다 — cms 관리자가 전자계약을 발송하고 고객이 서명을 완료해야 비로소
confirmed로 전환된다. 결제·서명 중 어느 쪽이 먼저 끝나든 순서와 무관하게, 나중에
끝나는 쪽이 confirmed 전환의 트리거가 된다(payment_confirmed_at 타임스탬프 +
contract_signings.signed_at 둘 다 충족된 시점 — try_confirm_reservation RPC가 매번
AND 조건을 재검증하는 멱등 함수).

예외: cms 관리자의 수동 "승인하기" 버튼(RentalDetailPanel `approveReservation` 액션)은
계약 여부와 무관하게 언제든 즉시 승인 가능한 재량 우회 경로로 그대로 유지한다(Stephen
2026-08-17 확정) — 이 버튼에 계약 체크를 추가하는 것은 금지.
```
→ 상세: `.claude/harness/TASK.md` "계약서 서명 완료를 예약승인(confirmed) 필수조건으로
게이팅"(2026-08-17 NOW 항목, Migration 284) · `rental-lifecycle.md` "예약 단계 정합 검증"
(2026-07-23 문서화된 원 갭) · `contract.md` "발송 흐름"·"서명 흐름" · `reservation-rental-
execution.md` §1 ②④행(실화면 검증 기준 트리거·배지 매핑)

✅ **구현·Stage(ezyvffjvuwmtuhpxdjrw)·Production(vnbpmvxruyciuuaermyh) 전부 적용 완료**
(2026-08-17/18) — 신규 RPC 2종(`try_confirm_reservation`·`mark_reservation_payment_confirmed`,
전부 service_role 전용) + `confirm-mock`·`contracts/[token]/sign` 엔드포인트 반영, TDD 라이브
통합테스트로 대칭성(결제먼저/서명먼저)·관리자 우회 무회귀 확인.

✅ **승인 알림 게이팅·5개 발신지점 동기화 추가 적용 완료(2026-08-31)**:
  - `sendApprovalNotifications()` 공용 헬퍼(`src/lib/server/sendApprovalNotifications.ts`) 신설 —
    `confirm_payment_and_update_reservation`의 `confirmed` 반환값에 연동해 게이팅 결과가
    FALSE(미서명)이면 채팅·푸시 알림을 발송하지 않는다.
  - 5개 발신지점(approveReservation·pay-mock·pay-result·sign·payment/success) 중 활성 4개에
    헬퍼 적용 완료(payment/success는 구코드 — 파일 자체 없음, Stage 0 확인).
  - §4 묶음주문 통합/개별/보류 판정(`resolveApprovalNotifyPlan`) 이후에만 푸시 발송 — 보류
    (mode='hold') 시 채팅·푸시 둘 다 미발송, 확정 시 mode에 따라 통합/개별로 동기화.
  - sign/+server.ts에 누락돼 있던 `reservation_approval` 계열 푸시 추가(NTF-C3 해소).
  - TDD 4/4 GREEN(EC-1/EC-2/EC-3 검증 완료).

⚠️ **배포 순서 사고 이력(2026-08-18, 복구 완료)**: 이 기능의 애플리케이션 코드는 git
커밋·PR 머지를 거쳐 Production에 먼저 배포됐으나, DB 마이그레이션 적용이 별도로 누락돼
한동안 Production 실고객 체크아웃이 전부 실패할 수 있는 상태였다(다행히 실제 피해 없이
발견·긴급 복구). **"코드 배포"와 "Production DB 마이그레이션 적용"은 서로 다른 별도 액션
이며, 하나가 끝났다고 다른 하나도 끝난 것으로 간주하면 안 된다** — CRITICAL 마이그레이션을
동반하는 기능은 두 상태를 항상 함께 확인할 것.

---

## 10. HOLD 자동만료 — 30분 경과 시 status='expired' 자동 전환 (✅ 구현·Stage·Production 전부 검증 완료, 2026-08-18)

```
front 고객이 상품을 예약신청(hold 생성)만 하고 결제·서명 등 후속 절차를 진행하지 않으면,
그 hold는 생성 후 30분이 지나는 시점에 pg_cron(hold_expiration_cleanup, 매 1분 실행)이
자동으로 status='expired'로 전환한다. 별도의 "재고 해제" 로직은 필요 없다 — 날짜 배제
제약(rental_reservations_product_dates_excl)과 create_hold_reservation의 가용성 검사
둘 다 이미 status='expired'인 행을 배제 대상에서 제외하도록 설계돼 있어, status 전환
자체가 곧 재고 해제다.

⚠️ 이 정책은 §9(계약서명 게이팅)와 상호작용한다 — §9 도입으로 결제만 완료된 예약도
계약서명 전까지는 hold에 더 오래 머무르게 됐으므로, 이 30분 자동만료가 정상 동작해야
"계약서명을 하지 않는 고객의 예약이 재고를 무기한 점유"하는 상황을 막을 수 있다. 원래
10분이었으나(Migration 30, 2026-05-29) 고객 체크아웃 시간에 비해 UX상 과도하게 짧아
2026-08-18 Stephen 확정으로 30분으로 변경.
```
→ 상세: `reservation-rental-execution.md` §0-5(부재 발견 경위 — Stage·Production 둘 다
pg_cron 잡 자체가 실존하지 않았음 + status CHECK 제약에 'expired' 값이 애초에 누락돼
있었던 별개 결함 동시 발견) · `supabase/migrations/20260818000285_285_hold_expiration_
restore.sql`(release_reservation_hold RPC) · `rental-lifecycle.md` "전체 상태 머신"

✅ **Stage(ezyvffjvuwmtuhpxdjrw)·Production(vnbpmvxruyciuuaermyh) 둘 다 적용 완료**
(2026-08-18) — Stage는 TDD 검증(경계값·비hold상태 무영향·멱등성 5건 GREEN), Production은
적용 직후 cron이 1분 이내 첫 실행돼 방치돼 있던 hold 29건이 실제로 expired 전환됨을
직접 SQL 조회로 확인(`status='hold'` 잔여 0건).

✅ **D-1 조건 정정(2026-08-31, Migration 394 — Stage DB 적용 완료)**:
  Migration 324의 D-1("계약 발송됐으면 NOT EXISTS로 영구 제외")이 §9 게이팅 도입 이후
  "계약 발송된 미서명 hold가 영구히 재고를 점유"하는 결함을 유발한다는 점이 전역감사에서
  발견됐다. Migration 394로 D-1을 **GREATEST(created_at, sent_at) 기준 타이머 리셋** 방식으로
  교체 — 계약 발송 순간부터 새로 30분을 부여하고, "재발송"할 때마다 sent_at이 갱신돼 타이머가
  다시 리셋된다. D-3(payment_confirmed_at IS NOT NULL, 결제완료 예외)은 변경 없이 유지.
  마이그레이션 파일: `supabase/migrations/20260901050000_394_hold_expiration_d1_greatest_timer.sql`
  Stage(ezyvffjvuwmtuhpxdjrw) 적용 완료, TDD EC-5a/5b/5c 4/4 GREEN 확인 완료(2026-08-31).
  Production(vnbpmvxruyciuuaermyh) 미적용 — Stephen 승인 후 별도 적용.

---

## 11. 관리자 발신 채팅 알림 — 세션조회는 반드시 공유 RPC 경유 (원칙, 2026-08-18 명문화)

```
cms/서버가 고객에게 채팅 메시지(action_card 포함)를 보내는 모든 지점은 세션을 직접
.from('chat_sessions').select(...)로 조회하지 않고 반드시 find_or_create_general_chat_
session(p_user_id, p_reservation_id) RPC를 거쳐야 한다. 이 RPC만이 다음 3가지를 전부
보장한다: ① context_type='general' 세션만 정확히 찾음(엉뚱한 컨텍스트 세션과 혼동 안 됨)
② 찾은 세션이 pending/closed면 자동으로 open 승격 ③ 세션이 아예 없으면 신규 open 세션
생성(메시지 유실 방지).

이 원칙이 이번 세션에서 명문화된 이유: 같은 유형의 버그(①②③ 중 일부 누락)가
send-chat/sign/coupon-gift/late-fee 4개의 서로 다른 파일에서 각각 독립적으로 발견됐다
— 전부 이 공유 RPC 대신 자체 인라인 세션조회를 손으로 재구현했다가 조금씩 다르게 빠뜨린
경우였다. 새로운 관리자 발신 알림 엔드포인트를 추가할 때 이 RPC를 재사용하지 않고 또다시
자체 로직을 구현하면 동일한 버그가 재발할 가능성이 높다.
```
→ 상세: `reservation-rental-execution.md` §3(결함B-2, 최초 수정) · §5-2(coupon-gift) ·
§0-3(late-fee/pay-mock) · `supabase/migrations/20260817090000_282_chat_session_notify_
fix.sql`(RPC 신설) · `chat.md` §2(세션 관리 정책)

---

## 12. 결제 웹훅 — PG(front 결제창) → 서버 → cms 반영

```
front에서 발생한 토스페이먼츠 웹훅은 반드시 즉시 200 OK로 응답(raw_webhook_logs 저장만) 후
pg_cron 백그라운드에서 9단계 금액 계산·상태 갱신을 처리한다 — 웹훅 응답 지연은 PG사 재시도
폭주로 이어지므로 front 결제 흐름과 cms 반영 사이에 반드시 이 비동기 경계를 유지한다.
```
→ 상세: `payment.md` "웹훅 처리 패턴"·"9단계 금액 계산"

---

## 13. 상담 채팅 세션 — 고객 대화 카드 필수 알림(긴급 배지) 및 관리자 알림 수신 요건 (2026-08-18 명문화)

```
front 고객이 보낸 메시지가 AI 의도분류에서 CS_ESCALATE(상담원 개입 필요)로 판정되고 그 이후
아직 관리자 응답이 없는 상태라면, cms 상담세션 목록의 해당 카드 제목 우측에 "긴급" 배지가
필수로 표시된다(`/api/chat/sessions` 응답의 `is_urgent` 필드 기반, `AdminChatPanel.svelte`
렌더링). 관리자가 그 세션에 응답을 남기는 순간 자동 해제된다 — 관리자가 수동으로 끄는 별도
액션은 없다(자동 판정·자동 해제만 존재).

이 "필수 알림"(긴급 배지)이 관리자에게 실제로 도달하려면, 그 자체만으로는 부족하고 아래 두
운영 조건이 먼저 충족돼야 한다 — 배지 로직이 정상이어도 이 전제가 깨지면 관리자가 긴급 대화를
놓칠 수 있다:

  ① 세션이 대기(pending)·종료(closed) 상태로 묶여 있지 않고 진행중(open) 탭에 노출돼야
     한다 — §7의 "새 메시지 도착 시 무조건 open 승격" 규칙이 선행 조건이다. 이 승격이
     안 되면 긴급 배지가 붙은 카드가 관리자가 기본으로 보는 "진행중" 탭이 아니라 "대기"
     탭에 묻혀 발견이 늦어진다.
  ② 그 메시지가 애초에 올바른 세션(context_type='general')에 정확히 연결돼야 한다 —
     세션조회를 공유 RPC(`find_or_create_general_chat_session`) 없이 자체 구현하면
     메시지가 엉뚱한 컨텍스트 세션이나 좌초(orphaned) 세션에 묻혀 긴급 배지 자체가
     뜨지 않는 세션이 생길 수 있다(§11).
  ③ 그 메시지가 실제로 `chat_intent_logs`에 `intent='CS_ESCALATE'`로 기록돼야 한다 —
     빠른답변(canned response) 키워드 매칭이 성공하면 Claude 의도분류 자체를 건너뛰므로
     이 로그가 원천적으로 생성되지 않는다(chat.md §6 "하이브리드 1단계"). 파손·분실 등
     실제로 심각한 문의가 캔드매칭에 먼저 걸리면 자동응답만 나가고 긴급 배지는 절대
     뜨지 않는 결함이 실사용 중 발견됐다(2026-08-19) — `damage`·`cs` 카테고리 캔드응답이
     발송될 때는 그 자동응답과 별개로 `CS_ESCALATE` 인텐트 로그를 명시적으로 남기도록
     수정 완료(`src/routes/api/chat/message/+server.ts`). 새로운 캔드응답 카테고리를
     추가할 때 이 카테고리가 CS_ESCALATE급 민감 주제라면 반드시 같은 목록에 포함시킬 것.
  ④ 긴급판정의 "관리자 응답 완료" 판단은 마지막 메시지의 `sender_type='admin'` 하나만
     보면 안 된다 — 캔드매칭 자동응답도 `sender_type='admin'`으로 저장되므로, 실제 사람이
     한 번도 배정된 적 없는 세션(`chat_sessions.admin_id IS NULL`)은 마지막 메시지가
     admin이어도 여전히 긴급판정 대상에 포함해야 한다(`/api/chat/sessions` 수정 완료,
     2026-08-19). `admin_id`는 `admin-reply`/`admin-attachment`에서 진짜 관리자가 응답할
     때만 채워지는, 자동응답과 인간응답을 구분하는 유일한 신뢰 가능 신호다.

즉 "긴급 배지"는 그 자체로 완결된 기능이 아니라, §7(세션 상태 전환)·§11(RPC 경유 세션조회)·
③(캔드매칭 인텐트로그)·④(admin_id 기반 응답판정)의 운영 보장이 전부 함께 지켜질 때만
신뢰할 수 있는 정책이다. 넷 중 하나만 점검하고 나머지를 놓치면 "배지는 정상 표시되는데
관리자가 못 본다" 또는 "배지 자체가 안 뜬다" 유형의 결함이 재발할 수 있다.
```
→ 상세: `rental-lifecycle.md` "상담채팅 세션 상태(chat_sessions.status) — 대기(pending) 재진입
조건"(긴급 배지 원 정의) · `chat.md` §2-§3·§6(세션 관리 정책·AI 의도분류 CS_ESCALATE·하이브리드
자동답변) · §15 GATE C(캔드매칭 인텐트로그·admin_id 판정 체크항목) ·
`src/lib/components/cms/AdminChatPanel.svelte` · `/api/chat/sessions`(`is_urgent` 필드 산출) ·
`src/routes/api/chat/message/+server.ts`(SENSITIVE_CANNED_CATEGORIES)

---

## 15. 채팅카드(RPC) 발송 ≠ 브라우저 푸시(FCM) 발송 — 별개 시스템, 수동 동기화 필요 (2026-08-19 명문화)

```
고객이 받는 "대화카드" 알림에는 서로 완전히 독립된 두 개의 전달 경로가 있다:
  ① 채팅카드(chat_messages INSERT) — send_rental_chat_notification RPC의 CASE 분기
     (11개 notify_type — tracking_notify가 Migration 406, 2026-08-31 추가됨)에 새 타입을 추가하면 즉시 발송된다.
  ② 브라우저 푸시(FCM) — 앱코드 sendReservationLifecyclePush()가 push.ts의
     CUSTOMER_LIFECYCLE_PUSH_COPY 매핑에서 문구를 찾아 별도로 발송한다.

①에 새 notify_type을 추가해도 ②는 자동으로 따라오지 않는다 — 둘 사이에 어떤 자동 동기화
장치도 없다(DB→외부HTTP 경로 자체가 프로젝트 전체에 없어, chat_messages INSERT 트리거가
push를 대신 쏴주는 구조도 아니다). reservation_cancelled·damage_claimed·hold_expired
3개 신규 타입이 Migration 288로 ①만 구현되고 ②의 문구 매핑을 빠뜨려, 채팅카드는 정상
도착하는데 푸시만 조용히 no-op되는 결함이 실사용 중 발견됐다(2026-08-19, push.ts에
문구 3종 추가로 수정 — `hold_expired`는 release_reservation_hold()가 순수 SQL(pg_cron)
내부에서만 실행돼 앱코드의 push 함수를 호출할 경로 자체가 없어 구조적으로 여전히 미발송,
별도 아키텍처 없이는 해소 안 됨).

`tracking_notify`(운송장 번호 등록 알림)는 2026-08-31 Migration 406(RSV-B-B4)으로 추가됐으며,
① send_rental_chat_notification RPC CASE 분기와 ② push.ts CUSTOMER_LIFECYCLE_PUSH_COPY 양쪽 모두
동시에 추가돼 위의 누락 패턴을 반복하지 않았다. ActionCard.svelte(`tracking_notify` 케이스)와
chat.ts(`ActionCardType` 유니온)도 함께 업데이트됨.

즉 새 예약 라이프사이클 알림 타입을 추가할 때는 항상 두 곳을 세트로 확인한다:
  1. send_rental_chat_notification RPC CASE 분기(채팅카드)
  2. push.ts CUSTOMER_LIFECYCLE_PUSH_COPY(브라우저 푸시)
그리고 그 알림이 순수 SQL(pg_cron 등) 트리거에서만 발생하는지도 확인한다 — 그 경우 앱코드
경유 푸시 함수를 호출할 경로 자체가 없어 문구를 채워도 발송되지 않는다.

추가로, 관리자 CMS 답장·전자계약 발송을 제외한 나머지 대화카드 유형(AI 자유응답, 캔드매칭
자동응답, 쿠폰선물, 연체료 안내, 고객 서명완료 카드)은 애초에 push 호출 자체가 코드에 없었다
(2026-08-19 전역감사로 발견 → 같은 날 5종 전부 sendPushToUser 연결 완료, admin-reply와
동일하게 기존 발신허브 재사용).

⚠️ **iOS Safari 구조적 한계(2026-08-19 진단 → 같은 날 부분 해소)**: iOS 16.4+ Safari는 Web
Push를 "홈 화면에 추가"된 독립형(standalone) 웹앱에서만 허용하며, 일반 브라우저 탭에서는
`Notification.requestPermission()` 자체가 동작하지 않는 플랫폼 제약이다(코드로 우회 불가).
진단 시점엔 `manifest.json`·아이콘 자산·iOS 메타태그가 전부 없어 "홈 화면에 추가" 자체가
정상 유도되지 않는 상태였다.

✅ **1단계 해소 완료**: `static/manifest.json` 신설(name/icons/theme_color/display:standalone) +
`src/app.html`에 매니페스트 링크·apple-touch-icon·`apple-mobile-web-app-capable` 등 메타태그
추가 + Stephen 제공 로고 SVG(`static/app-icons/logo-source.svg`)를 `@resvg/resvg-js`로
래스터화해 16/32/180/192/512px + maskable-512 아이콘 세트 생성(`static/app-icons/`). 이제
iOS Safari에서 "공유 → 홈 화면에 추가"가 정상적인 아이콘·앱 이름으로 동작하고, 홈 화면에서
실행하면(standalone 모드) 웹푸시 등록이 가능한 최소 요건은 충족됐다.

✅ **2단계 해소 완료(같은 날 후속)**: iOS는 안드로이드의 `beforeinstallprompt` 같은 네이티브
설치 유도가 없어 사용자가 "공유 메뉴에서 홈 화면 추가"를 스스로 찾아야 한다 — 이를 안내하는
`IosAddToHomeScreenBanner.svelte` 신설(`src/lib/utils/iosPwa.ts`의 UA/standalone 판별 헬퍼
사용). iOS 기기 + 비-standalone(아직 홈 화면 설치 전)일 때만 진입 2초 후 노출, 앱 아이콘·
2단계 안내("공유 아이콘 → 홈 화면에 추가")를 표시하고 닫으면 `localStorage`(
`cs-ios-a2hs-dismissed`)에 영구 기록해 재노출하지 않는다. `/cms/*`는 제외(PC 전용 화면).

`static/app-icons/` 디렉토리명은 macOS 기본 `.gitignore`의 `Icon?` 패턴(대소문자 무시로
"icons"와 충돌)을 피하기 위해 의도적으로 `icons`가 아닌 `app-icons`로 명명했다 — 향후 관련
파일 추가 시 이 규칙을 그대로 따를 것.
```
→ 상세: `chat.md` §14(웹 푸시 알림 FCM 구현 현황) · `src/lib/server/push.ts`
(`CUSTOMER_LIFECYCLE_PUSH_COPY`) · `src/lib/server/sendReservationLifecyclePush` 호출부
(`cms/reservation/+page.server.ts` 등)

---

## 14. 쿠폰 기준코드 지연채번(Lazy Sequencing) — 생성 시 패턴만 저장, 실사용 시점에 채번 (2026-08-18 구현, Stage 마이그레이션 대기)

```
cms에서 쿠폰을 등록(cms_create_coupon)하거나 배포(distribute_coupon)해도 고객별
실제 쿠폰 코드 번호는 발행되지 않는다. 오직 어떤 번호 체계를 쓸지 패턴(code_series JSONB)만
저장한다. 고객이 장바구니에서 그 쿠폰을 선택해 결제를 확정(use_coupon RPC 호출)하는 순간
비로소 순번이 원자적으로 채번되어 user_coupons.redeemed_code에 기록된다.

이 설계는 products.md §2-1~§2-3 "부모=code_series 저장 / 자식=실채번" 정책과 동일한 원리다:
  coupons.code_series JSONB  ←→  products.code_series JSONB   (패턴 저장)
  user_coupons.redeemed_code ←→  products.product_code       (실채번 결과)
  coupon_code_sequences      ←→  product_code_sequences       (원자 카운터)

채번은 추적·표시용 일련번호일 뿐 — 실제 결제 자격 판정은 user_coupons.id 기준으로
별도 처리된다(코드 문자열 직접 입력 방식이 아님). 결제 로직 자체는 건드리지 않는다.

code_mode 원칙:
  'manual'    (기본값) — 기존 직접 코드입력 쿠폰. 모든 기존 쿠폰이 manual로 유지됨(완전 하위호환).
  'sequenced' — 지연채번 쿠폰. cms_create_coupon 호출 시 code=NULL, code_series에 패턴 저장.

영구고정(products.md §2-2와 동일):
  한 번 user_coupons에 채번된 redeemed_code는 재사용 불가 — coupon_code_sequences.next_seq는
  단조증가(INSERT...ON CONFLICT DO UPDATE SET next_seq = next_seq + 1)하며 절대 되돌아가지 않는다.
  user_coupons.redeemed_code UNIQUE 제약(부분 인덱스 — redeemed_code IS NOT NULL)으로 구조적 보장.

max_sequence 상한 체크:
  code_series.max_sequence가 있으면 그 값 초과 시 'COUPON_SEQ_EXCEEDED:...' EXCEPTION 발생.
  초과 시 카운터를 1 되돌리고 예외를 던져 트랜잭션 롤백 — 카운터 누수 없음.

멱등성:
  user_coupons.redeemed_code가 이미 있으면 generate_user_coupon_redeemed_code()는 재채번 없이
  기존 값을 그대로 반환한다. use_coupon을 두 번 호출해도 첫 번째 코드가 유지된다.

approve_pending_coupon_gift(선물 채팅 카드) 분기:
  sequenced 쿠폰은 배포 시점에 code=NULL이므로 채팅 카드 문구를
  "쿠폰이 발급되었습니다. 결제 시 자동으로 적용됩니다."로 표시한다(코드 직접 노출 금지).
  manual 쿠폰은 기존 COALESCE(code,'') 그대로.
```

구현 파일:
  - 스키마(stage 마이그레이션 대기): `supabase/migrations/20260818040000_291_coupon_lazy_sequencing_schema.sql`
    (B-4 distribute_coupon issued_at 버그 수정 포함)
  - 채번 RPC: `supabase/migrations/20260818050000_292_generate_user_coupon_redeemed_code.sql`
  - use_coupon/cms_create_coupon/approve_pending_coupon_gift 통합: `supabase/migrations/20260818060000_293_coupon_lazy_rpc_integration.sql`
  - 서버 액션: `src/routes/cms/promotion/coupon/+page.server.ts` (createCoupon — CmsCreateCouponPayload 로컬 인터페이스)
  - 타입: `src/lib/types/database.ts` (Coupon.code_series / code_mode / UserCoupon.redeemed_code / generate_user_coupon_redeemed_code 함수)
  - TDD 검증: `src/__tests__/services/couponLazySequencing.test.ts` (13개 시나리오 — Stage DB 연동 라이브 테스트)

✅ **현재 상태(2026-08-18 최종)**: 마이그레이션 291~301(11건) 전부 Stage(ezyvffjvuwmtuhpxdjrw)
  → Production(vnbpmvxruyciuuaermyh) 순서로 적용 완료. TDD 13/13 GREEN. 실사용 검증 중
  발견된 결함 4건(구버전 RPC 오버로드 잔존, 잘못된 인증 체크, 쿠폰 생성 폼의 hidden input
  배선 누락, `get_promotion_analytics` 키 불일치)도 같은 과정에서 함께 수정 완료. "채번내역"
  UX는 Stephen 피드백에 따라 랜딩 대상을 최종적으로 "그 사용자의 최근 예약"(RentalDetailPanel)
  기준으로 확정(migration 301). 상세 경위는 `.claude/harness/TASK.md`의 "쿠폰 기준코드
  지연채번(Lazy Sequencing) 아키텍처 [Part B]" 블록 "세션 종합 요약" 참고.

---

## 16. 회원 자율 탈퇴('탈회') — 30일 보관·이메일기준 자동복구·CMS 배지 (2026-08-28 구현)

```
고객이 마이페이지에서 직접 '탈회 신청'을 할 수 있는 자율 탈퇴 기능. 관리자 즉시삭제
(soft_delete_customer — deleted_at 기록)와 완전히 별개 경로이며, CMS 목록 노출·DB 실데이터
유지라는 점에서 핵심적으로 다르다.

withdrawal_status 3단계:
  'none'      → 정상 상태(기본값)
  'requested' → 탈회 신청 완료, 30일 유예기간 중
  'purged'    → 30일 경과 후 pg_cron(purge_withdrawn_accounts)이 개인정보 자동 마스킹 처리 완료

핵심 원칙:
  ① deleted_at은 변경하지 않는다 — 탈회 신청해도 CMS 고객 목록에서 숨기지 않음(관리자
     즉시삭제와 UI 충돌 방지). ⚠️ request_account_withdrawal RPC는 현재 deleted_at 여부를
     별도로 체크하지 않는다(이미 관리자가 즉시삭제한 계정이 탈회를 신청하는 경로는 현재
     막혀있지 않음 — 실무상 발생 가능성이 낮아 이번 스코프에서 의도적으로 다루지 않았으나,
     향후 실제로 문제가 되면 별도 확인 후 가드 추가 검토).
  ② 진행중 대여(hold·confirmed·shipped·in_use·return_requested)가 있으면 RPC 레벨에서 차단
     — 'active_rental_exists' error_code 반환
  ③ 30일 유예기간(withdrawal_status='requested') 내 동일 이메일로 재로그인(Supabase Auth
     성공 시점)하면 자동복구됨 — +layout.server.ts load()에서 withdrawal_status='requested'
     감지 → restore_withdrawn_account RPC 호출. 유예기간 중에는 phone/email 등 PII를 전혀
     건드리지 않으므로(아래 ④ 참고) 복구는 단순히 withdrawal_status 등 5개 컬럼만 원복하는
     것으로 끝난다.
  ④ PII 스크럽은 유예기간이 끝난 후(purge_withdrawn_accounts, 30일 경과) 딱 한 번만 일어난다
     — phone은 임시번호가 아니라 단순 NULL 처리, email은 NOT NULL 제약 때문에
     `purged-{id}@purged.crazyshot.kr` 형태 익명 placeholder로 대체(§ 위 발견 경위 참고).
     **purged 상태가 되면 restore는 더 이상 동작하지 않는다**(restore RPC는
     withdrawal_status='requested'일 때만 복구, 'purged'는 no-op) — "30일 지나면 복구 불가"
     정책이 이 방식으로 보장된다.
  ⑤ 휴대폰 재사용 차단(별개 시나리오, ③④와 무관): 탈회 유예기간 중인 **다른 계정**이 쓰던
     휴대폰번호로 **제3의 계정**이 새로 인증(verify_and_update_phone)을 시도하면, 병합하지
     않고 안내만 표시하며 차단한다(withdrawal_conflict) — 번호 소유권 혼선 방지 목적.
  ⑥ CMS 고객 목록 배지: withdrawal_status별 "탈회" 배지(레드 계열, `--cs-red-badge` —
     블랙리스트 배지와 동일 색상 언어, 우선순위 탈회>블랙리스트>정상) + CustomerDetailPanel에
     탈회 정보(신청일·삭제예정일) 블록 표시. 관리자가 별도로 취소/복구하는 액션은 없다.

구현 파일:
  - 스키마: supabase/migrations/20260828000000_365_withdrawal_columns.sql
  - 탈퇴신청 RPC: supabase/migrations/20260828010000_366_request_account_withdrawal.sql
  - 자동복구 RPC: supabase/migrations/20260828020000_367_restore_withdrawn_account.sql
  - 자동삭제 RPC+cron: supabase/migrations/20260828030000_368_purge_withdrawn_accounts.sql
  - 휴대폰 차단: supabase/migrations/20260828060000_370_verify_and_update_phone_withdrawal_check.sql
  - CMS 목록 필드: supabase/migrations/20260829030000_376_get_customer_list_withdrawal_status.sql
  - 자동복구 훅: src/routes/+layout.server.ts (load 함수)
  - 탈퇴 UI: src/lib/components/members/profile/WithdrawalTabContent.svelte
  - 마이페이지 배선: src/routes/account/+page.svelte, +page.server.ts
  - 프로필 서버 액션: src/routes/account/profile/+page.server.ts (requestWithdrawal)
  - CMS 배지: src/routes/cms/customers/+page.svelte, +page.server.ts
  - CMS 상세: src/lib/components/cms/CustomerDetailPanel.svelte
  - 타입: src/lib/types/database.ts (withdrawal_status·withdrawal_purge_at 등)

✅ **현재 상태(2026-08-29)**: 마이그레이션 365~370·376(舊373, 파일명 번호충돌로 재명명)·377
  (verify_and_update_phone REVOKE 보강) 7건 Stage(ezyvffjvuwmtuhpxdjrw)·
  Production(vnbpmvxruyciuuaermyh) 양쪽 전부 적용·재검증 완료, TDD 24/24 GREEN. git commit만
  Stephen 직접 실행 대기.

✅ **해소 완료(2026-08-29, Stephen 지시)**: verify_and_update_phone(Migration 132 원본)의
  실행권한에 anon이 포함돼 있던 기존 공백(Stage·Production 공통, CREATE OR REPLACE가 기존
  ACL을 보존해 Migration #370도 그대로 물려받았던 상태)을 Migration #377로 명시적 REVOKE 후
  authenticated만 재부여해 해소. `SignUpModal.svelte`가 이 RPC 호출 전 항상
  `signInAnonymously()`로 authenticated 세션을 먼저 확보함을 코드로 확인 — 순수 anon 상태
  호출 경로가 실제로 없어 REVOKE로 인한 회귀 없음(적용 후 accountWithdrawalPhone.test.ts
  3/3 GREEN 재확인). 함수 본문(로직)은 무변경, 권한만 정정.
```

---

## GATE C 확인 항목 (front-cms 연동 변경 시)

```
[ ] 이 변경이 front에서 발생한 이벤트를 cms에 반영하는가, 반대인가 — 방향을 명확히 인지했는가?
[ ] 주문 연결(order_id) 생성 지점을 장바구니 체크아웃 제출 외의 곳에 추가하지 않았는가? (§4)
[ ] 상태전이 시 자동발송해야 할 채팅알림 타입을 rental-lifecycle.md 매핑표와 대조했는가? (§3)
[ ] cms_role 권한 검사와 front 고객 세션 검사를 혼동하지 않았는가? (§5)
[ ] 요구사항이 불명확한데 추측으로 구현하지 않았는가? (§6 Class C)
[ ] confirmed 전환 게이팅(§9) 관련 변경 시 — 관리자 수동 "승인하기" 우회 경로에 실수로
    계약 체크를 추가하지 않았는가?
[ ] HOLD 만료(§10) 관련 변경 시 — release_reservation_hold의 30분 임계값·hold_expiration_
    cleanup pg_cron 잡이 여전히 존재·활성 상태인가? (`SELECT * FROM cron.job WHERE
    jobname='hold_expiration_cleanup'`로 정기 확인 권장)
[ ] 관리자 발신 채팅 알림 엔드포인트를 새로 추가했다면(§11) — 자체 세션조회 로직을
    새로 짜지 않고 find_or_create_general_chat_session RPC를 재사용했는가?
[ ] CRITICAL 마이그레이션을 동반한 기능이 git 커밋·PR 머지로 Production에 배포됐다면 —
    같은 마이그레이션이 Production DB(vnbpmvxruyciuuaermyh)에도 실제 적용됐는지 직접 SQL
    조회로 별도 확인했는가? (§9 배포 순서 사고 참고 — 코드 배포 ≠ DB 마이그레이션 적용)
[ ] 상담 채팅 세션 상태·알림 관련 변경 시(§13) — 긴급 배지(is_urgent) 로직만 단독으로
    점검하지 않고, 그 전제가 되는 §7(open 승격 규칙)·§11(공유 RPC 경유 세션조회)·
    ③(캔드매칭 히트 시 CS_ESCALATE 인텐트로그)·④(admin_id 기반 응답판정)이 함께
    유지되는지도 같이 확인했는가?
[ ] 새 예약 라이프사이클 알림 타입(notify_type)을 추가했다면(§15) — send_rental_chat_
    notification RPC(채팅카드)뿐 아니라 push.ts의 CUSTOMER_LIFECYCLE_PUSH_COPY(브라우저
    푸시)에도 함께 추가했는가? 그 알림이 순수 SQL(pg_cron 등)에서만 트리거된다면 앱코드
    경유 푸시 함수를 호출할 경로가 아예 없다는 점도 함께 확인했는가?
[ ] 쿠폰 지연채번(§14) 관련 변경 시 — sequenced 모드 쿠폰의 redeemed_code 채번이
    use_coupon RPC 내부에서만 일어나는가? (distribute_coupon·cms_create_coupon 단계에서
    선채번하는 코드를 추가하지 않았는가?)
[ ] sequenced 모드 쿠폰 등록 시 code 필드가 NULL이고 code_series가 채워지는가? (반대는 금지)
[ ] approve_pending_coupon_gift가 sequenced 쿠폰에 code를 직접 노출하지 않는가? (§14)
[ ] 탈퇴(§16) 관련 변경 시 — deleted_at을 절대 변경하지 않는가?
    (탈퇴 신청·삭제 여부를 deleted_at이 아닌 withdrawal_status로만 판별 — CMS 목록에서 숨기지 않음)
[ ] 탈퇴 신청 경로에서 진행중 대여(hold·confirmed·shipped·in_use·return_requested) 차단이
    RPC 레벨에서 유지되고 있는가? 클라이언트 단독 차단으로 대체하지 않았는가?
```

---

*service-operations.md v1.5 | Harness Flow v3.2 | 2026-08-17 신설 — chat.md·contract.md·
payment.md·rental-lifecycle.md·products.md·security-auth.md에 흩어진 front-cms 상호운영
원칙을 인덱스로 통합. 세부 내용은 각 원본 문서가 정본, 이 문서는 포인터만 유지. | 2026-08-17
§9 추가 — 예약승인(confirmed) 게이팅 설계 확정(구현 대기) 반영. | 2026-08-18 §9를 "구현·
Stage 검증 완료"로 갱신(plans/ 경로 참조 제거, TASK.md·Migration 284 참조로 교체) + §4에
통합/개별 알림 트리거 통일 반영 + §10(HOLD 30분 자동만료, 신규) + §11(관리자 발신 채팅
알림 공유 RPC 원칙, 신규) 추가 + 기존 §10(결제 웹훅)을 §12로 재배치 + GATE C 체크리스트
3건 추가. | 2026-08-18(같은 날 후속) §9 — 코드는 Production 배포됐으나 DB 마이그레이션은
누락돼 실고객 체크아웃이 막혀있던 배포 순서 사고 발견·긴급 복구, Production 적용 완료로
갱신 + GATE C에 "코드 배포 ≠ DB 마이그레이션 적용" 확인 항목 추가. | 2026-08-18(같은 날
재후속) §10 — Migration 285 Production 적용 완료로 갱신(적용 직후 cron 첫 실행으로 방치된
hold 29건 expired 전환 확인). | 2026-08-18(같은 날 3차 후속) §13 신설 — 상담 채팅 세션
"긴급 배지"(고객 대화 카드 필수 알림)와 그 전제조건인 §7(open 승격)·§11(공유 RPC 세션조회)
운영 보장을 하나의 정책으로 명문화 + GATE C 체크리스트 1건 추가. | 2026-08-18(같은 날 4차
후속) §14 신설 — 쿠폰 기준코드 지연채번(Lazy Sequencing) 정책(code_series 패턴 저장 /
use_coupon 시점 실채번 / products.md §2 동일 원리) + GATE C 체크리스트 3건 추가. 마이그레이션
291/292/293 작성 완료, Stage 적용 대기 상태. | 2026-08-18(같은 날 5차 후속, 세션 종료 시점)
§14 "현재 상태" 최종 갱신 — 마이그레이션 291~301(11건, 배포 전·중 자체 검증으로 발견한
결함 4건 수정분 포함)까지 전부 Stage+Production 적용 완료, TDD 8개→13개로 확장 후 전부
GREEN. 랜딩 UX(채번내역 목록 클릭 시 이동 대상)는 Stephen 피드백 3회 반영 끝에 "그
사용자의 최근 예약"(RentalDetailPanel) 기준으로 최종 확정. 상세는 TASK.md "세션 종합
요약" 참고. | 2026-08-19 사용자 채팅 회원/비회원 소통 로직
전역감사(4개 병렬 에이전트 실측) 결과 반영 — §13에 ③캔드매칭 히트 시 CS_ESCALATE 인텐트로그
누락·④admin_id 기반 응답판정 2개 신규 전제조건 추가(둘 다 발견 즉시 수정 완료) + §15 신설
(채팅카드 RPC 발송과 브라우저 푸시 FCM 발송은 별개 시스템, 신규 알림타입 추가 시 양쪽 다
동기화 필요 — reservation_cancelled·damage_claimed·hold_expired 3종 누락 발견·문구 추가로
수정, hold_expired는 구조적 한계로 미해소) + GATE C 체크리스트 2건 추가. | 2026-08-19(같은 날
후속) §15에 나머지 대화카드 5종(AI자유응답·캔드매칭·쿠폰선물·연체료안내·서명완료) 푸시 연결
완료 반영 + iOS Safari 구조적 한계 진단 추가(manifest.json·아이콘 자산 부재로 iOS는 "홈 화면
추가" 없이는 웹푸시 자체가 원천적으로 도달 불가, Android Chrome은 정상 — 해소는 별건 승인
대기). | 2026-08-19(같은 날 3차 후속) §15 — Stephen 제공 로고 SVG 기반 아이콘 세트 제작
(`@resvg/resvg-js`) + `manifest.json`·`app.html` 메타태그 적용으로 iOS "홈 화면에 추가" 최소
요건 충족(1단계 해소 완료) — iOS 홈 화면 추가 안내 UI 배너(2단계)는 여전히 별건 승인 대기.
| 2026-08-19(같은 날 4차 후속) §15 — `IosAddToHomeScreenBanner.svelte` 신설로 2단계까지 해소
완료(iOS+비-standalone 한정 노출, localStorage 영구 dismiss, /cms 제외) 반영. | 2026-08-28
§16 신설 — 회원 자율 탈퇴 기능(TASK.md "마이페이지 회원 탈퇴('탈회') 기능 신설" 블록 참고,
마이그레이션 365~370·373, TDD 24/24 GREEN, Stage 적용 완료·Production 미적용)*
