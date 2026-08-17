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
    반복 표시 — 개별 상품의 상태(신청대기/승인완료 등)는 각자 독립적으로 진행된다
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
front 고객이 목업/실결제를 완료해도 그 자체만으로는 예약이 "승인완료(confirmed)"로
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

즉 "긴급 배지"는 그 자체로 완결된 기능이 아니라, §7(세션 상태 전환)·§11(RPC 경유 세션조회)의
운영 보장이 함께 지켜질 때만 신뢰할 수 있는 정책이다. 셋 중 하나만 점검하고 나머지를 놓치면
"배지는 정상 표시되는데 관리자가 못 본다" 또는 "배지 자체가 안 뜬다" 유형의 결함이 재발할
수 있다.
```
→ 상세: `rental-lifecycle.md` "상담채팅 세션 상태(chat_sessions.status) — 대기(pending) 재진입
조건"(긴급 배지 원 정의) · `chat.md` §2-§3(세션 관리 정책·AI 의도분류 CS_ESCALATE) ·
`src/lib/components/cms/AdminChatPanel.svelte` · `/api/chat/sessions`(`is_urgent` 필드 산출)

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
    점검하지 않고, 그 전제가 되는 §7(open 승격 규칙)과 §11(공유 RPC 경유 세션조회)이
    함께 유지되는지도 같이 확인했는가?
```

---

*service-operations.md v1.4 | Harness Flow v3.2 | 2026-08-17 신설 — chat.md·contract.md·
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
운영 보장을 하나의 정책으로 명문화 + GATE C 체크리스트 1건 추가.*
