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
  - 결제 완료(cms 수동승인 포함) 시 배치 채팅알림(send_rental_chat_notification_batch)으로
    묶인 상품 전체를 하나의 알림 카드로 안내
```
→ 상세: `.claude/harness/TASK.md` "예약 신청 시점 주문 연결 + 대여정보 탭 통합 표시"(2026-08-17
  NOW 항목, Migration 280/275) · `rental-lifecycle.md` "옵션상품(reservation_options)"

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

## 9. 결제 웹훅 — PG(front 결제창) → 서버 → cms 반영

```
front에서 발생한 토스페이먼츠 웹훅은 반드시 즉시 200 OK로 응답(raw_webhook_logs 저장만) 후
pg_cron 백그라운드에서 9단계 금액 계산·상태 갱신을 처리한다 — 웹훅 응답 지연은 PG사 재시도
폭주로 이어지므로 front 결제 흐름과 cms 반영 사이에 반드시 이 비동기 경계를 유지한다.
```
→ 상세: `payment.md` "웹훅 처리 패턴"·"9단계 금액 계산"

---

## GATE C 확인 항목 (front-cms 연동 변경 시)

```
[ ] 이 변경이 front에서 발생한 이벤트를 cms에 반영하는가, 반대인가 — 방향을 명확히 인지했는가?
[ ] 주문 연결(order_id) 생성 지점을 장바구니 체크아웃 제출 외의 곳에 추가하지 않았는가? (§4)
[ ] 상태전이 시 자동발송해야 할 채팅알림 타입을 rental-lifecycle.md 매핑표와 대조했는가? (§3)
[ ] cms_role 권한 검사와 front 고객 세션 검사를 혼동하지 않았는가? (§5)
[ ] 요구사항이 불명확한데 추측으로 구현하지 않았는가? (§6 Class C)
```

---

*service-operations.md v1.0 | Harness Flow v3.2 | 2026-08-17 신설 — chat.md·contract.md·
payment.md·rental-lifecycle.md·products.md·security-auth.md에 흩어진 front-cms 상호운영
원칙을 인덱스로 통합. 세부 내용은 각 원본 문서가 정본, 이 문서는 포인터만 유지.*
