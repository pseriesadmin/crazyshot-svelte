# reservation-rental-execution.md — 예약대여 단계 실행 로직 & 정보
# Harness Flow v3.2 | 2026-08-17/18 실화면 전수 검증 확정본

---

## 이 문서의 성격

```
"고객 예약신청 → 결제 → 계약발송 → 서명 → 계약완료 → 반출 → 대여중 → 반납요청 → 반납완료"
전 구간에서 각 단계가 실제로 어떤 파일·RPC를 트리거하고, CMS 3개 화면(/cms/chat,
/cms/reservation, /cms/rentals)에 정확히 어떤 배지·카드·버튼 상태로 나타나야 하는지를
"코드 조사 + Claude Browser 실화면 대조"로 검증해 확정한 문서다.

검증 방법: Stage DB(ezyvffjvuwmtuhpxdjrw)에 격리된 테스트 예약(회원 mublues@gmail.com +
세션이력 0건 신규 회원 2계정)을 만들어 실제 트리거 파일이 호출하는 것과 동일한 RPC/API를
직접 호출(또는 관리자·고객 로그인 세션에서 실제 fetch)로 실행하며 매 단계 스크린샷으로 대조.
테스트 데이터는 검증 후 전부 삭제, 실 고객(mublues) 기존 대화 이력은 보존.

⛔ 이 문서는 검증 시점(2026-08-17/18)의 실제 코드 동작을 그대로 기록한 것이다 — 이후 코드가
바뀌면 이 문서도 갱신 필요. "예상"이나 "설계 의도"가 아니라 "실제로 이렇게 동작했다"만 적는다.
```

---

## 0. 사전 확인 — Stephen 기대와 실제 코드가 다른 지점 (중요, 먼저 읽을 것)

이번 검증 지시문에 서술된 기대 동작 중 아래 항목들은 **실제 코드와 다름**이 확인됐다. 착오 방지를
위해 가장 먼저 정리한다.

| # | Stephen 기대 | 실제 확인된 동작 |
|---|---|---|
| 1 | 예약현황 상태배지 "예약 대기" or "예약 신청" | 실제 배지 문구는 **"신청대기"**(hold). "예약 대기"/"예약 신청"이라는 문자열은 코드베이스에 없음. |
| 2 | 계약발송 시 예약현황 상태배지가 "계약 발송" or "계약 대기"로 전환 | "계약발송"이라는 문자열은 코드베이스 어디에도 없음. 실제로는 상세패널 헤더에 **"결제완료 · 계약대기"**(발송 전) 배지가 있고, 계약서 발송 후에는 계약서 탭 안에 **"계약서 발송됨 · 서명 대기 중"** 텍스트로만 표시됨(목록 배지 자체는 안 바뀜, 계약서 전용 별도 표시). |
| 3 | "예약 승인 확인" 알림 발송 시 RentalDetailPanel의 운송장저장·출고처리·반출알림 버튼이 "비활성→활성"으로 전환 | **코드에 그런 게이팅이 존재하지 않는다.** 이 버튼들은 `status`(및 pickup_method/return_method)만으로 렌더 여부가 결정되고, `disabled` 조건은 전송 중 로딩 상태뿐이다. `confirmed` 상태에 진입하는 순간(계약서명 여부와 완전히 무관하게) 이미 전부 활성 상태다 — "이전까지 비활성"이라는 전제 자체가 실제 코드와 다름. |
| 4 | "반납 등록하기"(고객 채팅 CTA) 클릭이 반납요청 발송을 자동/수동으로 트리거 | 고객이 "반납 등록하기" 카드를 클릭하면 `/account/rental/[id]/history`(조회 전용 페이지)로 이동할 뿐, **예약 status를 바꾸는 코드가 없다.** `return_requested` 전환은 오직 관리자가 RentalDetailPanel의 "반납 접수" 버튼을 눌러야만 발생한다. |
| 5 | "반납등록·방문반납처리·반납완료" 버튼이 "대여중" 진입 시 비활성 → 이후 활성 전환 | 항목 3과 동일 — 실제로는 `in_use` 상태 진입 즉시 "반납 접수" 버튼이 바로 활성 상태로 나타난다. 별도의 비활성 구간은 코드에 없다. |

> 위 5건 모두 "버그"가 아니라 **애초에 그런 로직이 구현돼 있지 않다**는 사실 확인이다. 게이팅
> 로직을 실제로 넣을지는 이번 문서 범위 밖 — 별도로 Stephen 확인 후 결정할 사안.

### 0-1. 추가 확인 필요 문항 (이번 검증 범위 밖 — 미검증, 2026-08-18 제안)

> §0의 5건은 전부 **단일상품·단건예약·happy path** 시나리오에서만 나온 결과다. §4(참고 파일
> 인덱스)와 연동 규칙 파일(service-operations.md·rental-lifecycle.md·contract.md 인덱스)을
> 대조하면 이번 검증 범위 밖이라 "기대 vs 실제"가 아직 확인 안 된 지점이 있다. 우선순위는
> #6·#11 — 둘 다 "결제 안 됐는데 승인되거나, 관리자가 보낸 알림을 고객이 못 보는" 직접적
> 사고로 이어질 수 있는 지점이라 가장 리스크가 크다.

| # | Stephen이 기대할 만한 동작 | 확인 필요 사유 (근거) |
|---|---|---|
| 6 | 결제 없이 계약서명만 하면 승인(confirmed)이 안 될 것 | `try_confirm_reservation`이 "hold+결제완료 조건 재검증" 후 전환한다고만 적혀있고, **서명만 하고 결제 전인 상태에서 sign API를 호출했을 때 실제로 confirmed가 안 되는지**는 이번 검증에서 별도로 실증되지 않음(§1 ④행은 "hold+결제완료"를 전제로만 서술) |
| 7 | 장바구니에 여러 상품을 담아 한 번에 결제해도(주문묶음) 이 문서의 흐름표가 동일하게 적용될 것 | 검증은 CSREVTESTMEM01/GUEST1 **단건 예약**으로만 진행됨. service-operations.md §4에 따르면 `create_reservation_order`로 묶인 주문은 승인 시 `send_rental_chat_notification_batch`(배치 알림)로 별도 경로를 탄다 — 이 문서의 ④~⑨ 단건 알림 매핑표가 배치 케이스에도 그대로 적용되는지 미검증 |
| 8 | 계약서 발송은 예약이 어느 상태든(confirmed·shipped 등) 가능할 것 | service-operations.md §8 "예약 단계와 무관하게 계약 발송 가능" 원칙이 있으나, 이번 실화면 검증은 **hold 상태에서의 발송만** 실행함(§2-1/2-2 둘 다 hold 시점). confirmed 이후 상태에서 발송 시 find_or_create_general_chat_session 경로·배지 동작이 동일한지 미확인 |
| 9 | 옵션상품(reservation_options)이 포함된 예약도 같은 알림·배지 흐름을 탈 것 | rental-lifecycle.md "옵션상품" 섹션 — 테스트 예약(CSREVTESTMEM01/GUEST1)에 옵션상품이 포함됐는지 문서에 명시 없음. 옵션상품 유무가 이 문서의 단계별 트리거에 영향 없는지 별도 확인 필요 |
| 10 | 계약서 발행·발송 액션은 manager 이상 권한에서만 성공하고, partner 계정으로는 차단될 것 | security-auth.md 접근 매트릭스상 계약서 발행/발송 5개 파일 9곳이 manager 이상 게이트. 이번 검증에 쓰인 "관리자 실 로그인 세션"의 cms_role이 무엇이었는지 문서에 미기재 — partner 계정으로 동일 흐름 시도 시 의도대로 차단되는지 미검증 |
| 11 | admin-reply·admin-attachment·coupon-gift 외의 다른 관리자 발신 경로(반출/수령/반납 알림 등 AUTO_NOTIFY 5종)도 대기/종료 세션을 진행중으로 정상 승격시킬 것 | §5-2에서 coupon-gift 1건은 승격 로직 누락이 발견·수정됐음 — **같은 유형의 버그가 다른 발신 경로에도 있는지 전수 점검했다는 근거가 문서에 없음**(§1 ⑤~⑨는 정상 흐름만 확인, "대기 세션에 반출알림이 도착할 때도 진행중 전환되는가"는 별도 케이스로 실증 안 됨) |
| 12 | 결제 취소·HOLD 만료(10분 pg_cron) 시에도 채팅 세션·알림 상태가 꼬이지 않을 것 | 이번 문서는 승인까지 가는 happy path만 다룸 — `cancelled`/`expired` 경로의 알림·세션 처리는 범위 밖으로 명시적으로 배제됐는지, 아니면 단순 누락인지 §0에 명확히 해둘 필요 |
| 13 | §5-1에서 정리한 "좌초 세션" 패턴이 향후 재발하지 않을 것 | 이번 조치는 Stage의 기존 데이터 2건을 1회성으로 `closed` 처리한 것뿐 — **재발 감지 방법(모니터링/쿼리)이 문서화되지 않음**. "이 문서가 확정된 이후에도 세션 라우팅 로직이 바뀌면 동일 패턴이 다시 생길 수 있다"는 전제를 §0에 명시할지 검토 |

### 0-2. 우선순위 항목(#6·#11) 실증 결과 (2026-08-18)

**#6 — ✅ 실증 완료(정상 동작 확인)**: `src/__tests__/services/contractSigningGate.test.ts`의
"결제완료 없이 서명만 완료 — hold 유지(막아야 할 것)" 케이스를 Stage DB(ezyvffjvuwmtuhpxdjrw)
대상 실제 `/api/contracts/[token]/sign` POST 핸들러 호출로 재실행(직접 fetch가 아닌 핸들러
import 방식이나, 이 문서의 §2 방법론이 명시한 "실제 트리거 파일이 호출하는 것과 동일한
RPC/API를 직접 호출" 기준을 그대로 충족) — `payment_confirmed_at IS NULL`인 hold 예약에
서명만 완료시켜도 `try_confirm_reservation`의 AND 조건(결제완료 AND 서명완료)에서 결제완료
쪽이 막혀 `status`가 `confirmed`로 전환되지 않고 `hold`로 유지됨을 재확인(4/4 GREEN, 결제
먼저/서명 먼저 대칭성 케이스 포함).

**#11 — ✅ 실증 완료(정상 동작 확인, 단 인접 신규 결함 1건 발견 — 아래 §0-3 참고)**: Stage DB에서
`send_rental_chat_notification`·`send_rental_chat_notification_batch`(⑤~⑨ AUTO_NOTIFY 5종 +
①④도 이 RPC 경유) 두 RPC의 실제 정의를 `pg_get_functiondef`로 직접 조회 — 둘 다 내부에서
`public.find_or_create_general_chat_session(v_user_id, ...)`를 호출함을 확인했다. 이 헬퍼
자체도 정의를 직접 조회해 재검증: `context_type='general'`로만 필터링하고, 찾은 세션의
`status <> 'open'`이면(즉 pending이든 closed든) 무조건 `open`으로 승격시킨 뒤 반환하며,
없으면 신규 `open` 세션을 생성한다 — §3에서 결함B-2를 고친 것과 동일한 안전한 패턴이다.
저장소 전체에서 이 두 RPC를 호출하는 지점(`checkout/notify-hold`·`checkout/confirm-mock`·
`api/payment/confirm`·`payment/success`·`cms/reservation`·`cms/rentals`·`contracts/[token]/sign`
7곳)이 전부 이 RPC를 경유하므로, §1의 AUTO_NOTIFY 5종(⑤반출·⑥수령·⑦반납예정·⑧반납접수·
⑨반납완료)은 coupon-gift가 갖고 있던 유형의 버그(승격 로직 자체 부재)에 애초에 해당하지
않는다 — 처음부터 공유 헬퍼 위에 구현돼 있었음.

### 0-3. #11 점검 중 발견한 인접 신규 결함 — `late-fee/[id]/pay-mock` (✅ 같은 세션에서 Stephen 승인 후 수정·재검증 완료, 2026-08-18)

> ⚠️ §0-1 표에 명시적으로 나열되지 않았던 파일이나, #11("다른 관리자 발신 경로 전수 점검")을
> 실제로 수행하는 과정에서 발견됨. 발견 즉시 코드는 건드리지 않고 사실만 기록해 Stephen에게
> 보고 → "네, 지금 수정해줘" 승인 → 같은 세션에서 §3·§5-2와 동일 패턴으로 즉시 수정·재검증.

`src/routes/api/checkout/late-fee/[id]/pay-mock/+server.ts`(연체료 결제완료 채팅 안내, 관리자
발신 경로 중 하나)는 `find_or_create_general_chat_session` RPC를 쓰지 않고 **자체 인라인
세션조회**를 갖고 있다:

```ts
const { data: sessionData } = await admin
  .from('chat_sessions')
  .select('id')
  .eq('user_id', session.user.id)
  .in('status', ['open', 'pending'])   // ← context_type 필터 없음 + closed 세션 미조회
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle()

if (sessionData) {
  // pending이어도 status를 open으로 승격시키는 코드가 없음 — 메시지만 삽입
  await admin.from('chat_messages').insert({ session_id: chatSession.id, sender_type: 'admin', ... })
}
// sessionData가 없으면(전부 closed거나 세션 자체가 없으면) 메시지가 조용히 유실됨 —
// find_or_create_general_chat_session과 달리 신규 세션 생성 폴백도 없음
```

§5-2 coupon-gift 버그와 **같은 계열의 문제 2가지 + 그보다 더 심각한 문제 1가지**를 동시에 가짐:
1. `context_type` 필터 없음(결함B-2 문제①과 동일 계열)
2. `pending` 세션을 찾아도 `open`으로 승격하지 않음(coupon-gift 버그와 동일 계열)
3. **coupon-gift보다 심각**: 세션이 전부 `closed`이거나 아예 없으면 `sessionData`가 `null`이라
   `if (sessionData)` 블록 자체를 건너뛰어 **연체료 결제완료 안내 메시지가 어떤 세션에도
   남지 않고 완전히 유실**된다(coupon-gift는 최소한 세션을 찾기는 했음 — 이 파일은 신규 세션
   생성 폴백조차 없음).

**영향 범위**: 연체료(late fee) 결제 기능 자체가 시범서비스 범위인지, 실사용 트래픽이 있는지는
이번 §0-3 조사 범위 밖 — 확인 필요.

### 0-4. 나머지 항목(#7·#8·#9·#10·#13) 실증 결과 (2026-08-18)

**#7 — ✅ 발견 즉시 수정·재검증 완료(같은 세션, Stephen 승인)**: `resolveApprovalNotifyPlan()`
(`src/lib/server/reservationApprovalNotify.ts`) — 같은 주문 형제 예약이 전부 `confirmed`일
때만 batch, 그 전엔 `hold`(알림 보류) — 로직을 코드로 직접 확인. 최초 조사 시점엔 이 함수가
**관리자 수동 "승인하기"(`approveReservation`) 액션에서만 호출**되고, 이번 NOW 항목(계약서명
게이팅)에서 새로 만든 **고객 서명완료 자동승인 경로(`contracts/[token]/sign/+server.ts`)는
호출하지 않아 항상 단건 발송**이었다 — 즉 묶음주문(order_items로 연결된 다중상품)을 개별
계약서로 순서대로 서명하면, 관리자 수동승인과 달리 **상품별로 "예약이 승인되었습니다" 카드가
여러 건** 나가는 설계공백이 있었다. Migration 284로 결제완료 후에도 계약서명 전까지는
confirmed로 안 넘어가게 바뀌면서 이 자동승인 경로가 앞으로 더 흔한 트리거가 될 것으로 판단해,
Stephen 승인 후 **`sign/+server.ts`의 `justConfirmed===true` 분기에도 동일한
`resolveApprovalNotifyPlan`을 적용해 batch/single/hold 세 모드를 관리자 경로와 동일하게
판단하도록 수정**했다.

**재검증(RED→GREEN, `contractSigningGate.test.ts`에 3건 추가)**: ① 형제 예약이 미승인 상태면
이번 서명 건은 알림 보류(카드 0건) ② 마지막 형제까지 서명완료되면 개별 카드가 아닌 통합
카드 정확히 1건 ③ 형제 없는 단건 예약은 기존과 동일하게 즉시 단건 카드(회귀 없음). 수정 전
코드로 되돌려 재실행 → ①②는 정확히 예상대로 실패(①: 카드 0건 기대했으나 1건 발송됨,
②: 통합 1건 기대했으나 개별 2건 발송됨), ③은 원래도 정상이라 그대로 pass → 원복 후 3건
전부 GREEN(전체 `contractSigningGate.test.ts` 7/7 pass). `npx eslint`·`npx svelte-check`
신규 에러 0건.

**#8 — ✅ 실증 완료(정상 동작 확인)**: `init-contract/+server.ts`·`send-chat/+server.ts` 소스를
직접 재확인 — 둘 다 `rental_reservations.status`를 조회하거나 조건으로 사용하는 코드가
전혀 없다(예약 존재 여부·`cms_role`·계약 존재 여부만 확인). 즉 hold든 confirmed든 shipped든
계약 생성·발송 API 자체의 동작은 완전히 동일 — service-operations.md §8 원칙이 코드 수준에서
그대로 보장됨을 확인. (배지 표시는 `RentalDetailPanel.svelte`가 `status==='hold'` 조건일
때만 "결제완료·계약대기"를 보여주므로, confirmed 이후 상태에서 계약을 보내도 그 배지는 뜨지
않고 계약서 탭의 "발송됨·서명 대기 중" 텍스트만 나타남 — 이는 배지 조건이 hold 전용으로
설계된 결과이지 API 제약이 아님.)

**#9 — ✅ 실증 완료(정상 동작 확인)**: 저장소 전체(`src/`·`supabase/migrations/`)에서
`reservation_options`를 상태전이·알림·트리거 관련 코드에서 참조하는 곳을 검색 — **0건.**
`try_confirm_reservation`·`update_reservation_status`·`send_rental_chat_notification`(_batch
포함)·`resolveApprovalNotifyPlan` 어디에도 옵션상품 존재 여부를 확인하는 분기가 없다.
rental-lifecycle.md의 "옵션상품은 재고 배정 대상이 아니며 수량만 기록"이라는 설계와 일치 —
옵션상품 유무는 이 문서의 단계별 트리거에 어떤 영향도 주지 않음을 코드로 확인.

**#10 — ✅ 실증 완료(정상 동작 확인)**: `init-contract/+server.ts`·`send-chat/+server.ts` 둘 다
`getCmsRoleForAction(locals)` 조회 후 `!cmsRole || !hasSettingsAccess(cmsRole)`이면 즉시
403을 반환하는 코드가 현재도 그대로 있음을 재확인(historical 기록인 security-auth.md의 주장이
아니라 **지금 이 순간의 소스코드**로 직접 대조). `hasSettingsAccess`는
`getRoleLevel(role) >= 50`이고 partner의 레벨은 10이므로, partner 계정으로 이 두 API를
호출하면 결정적으로 403이 반환된다(로직상 예외 분기 없음 — 별도 라이브 로그인 세션 없이도
코드만으로 100% 확정 가능한 케이스).

**#13 — ✅ 반영 완료(모니터링 쿼리 제공)**: 좌초 세션 재발 감지용 쿼리를 아래에 확정하고
Stage에서 직접 실행해 현재 0건임을 확인(§5-1 정리 이후 재발 없음):
```sql
-- 좌초 세션 탐지: context_type='reservation'인데 pending/open으로 남아있으면 §3 수정 이후
-- 어떤 새 알림으로도 다시 선택되지 않는 좌초 상태 — 정기 점검 시 0건이어야 정상
SELECT id, user_id, status, created_at, updated_at
FROM chat_sessions
WHERE context_type = 'reservation' AND status IN ('pending', 'open');
```
2026-08-18 Stage 재실행 결과: **0건**(정상). 이 쿼리를 CMS 운영 점검 루틴(또는 향후 헬스체크
스크립트)에 등록할지는 이번 §0-4 범위 밖 — Stephen 판단 필요.

### 0-5. 🔴 #12 점검 중 발견 — HOLD 만료(pg_cron) 메커니즘이 Stage·Production 둘 다에 실존하지 않음 (✅ Stage·Production 둘 다 수정·재검증 완료)

> ⚠️ 이 문서 전체가 전제하고 있던 "HOLD 10분 pg_cron 자동만료"(rental-lifecycle.md 상태
> 머신, CLAUDE.md 등 여러 문서가 참조하는 기본 전제)가 **애초에 동작하지 않고 있었다.** #12는
> 원래 "만료 시 채팅 세션이 꼬이지 않는가"를 묻는 작은 문항이었으나, 실제로 확인해보니 채팅과
> 무관하게 만료 자체가 발생하지 않는 더 근본적인 문제였다. 세션조회 로직 버그(§0-3)와는
> 완전히 다른 성격.
>
> ✅ **2026-08-18 Stephen 확정 정책 + 후속 수정**: "10분은 UX상 너무 짧다 — 30분으로 변경"
> 지시에 따라 Migration 285로 복구. 아래 발견 내용은 원 조사 시점 그대로 보존하고, 수정
> 내역은 맨 아래 별도로 기록한다.

**실증(read-only, 양쪽 DB 직접 조회)**:
- `release_reservation_hold()` 함수 — Stage(ezyvffjvuwmtuhpxdjrw)·Production
  (vnbpmvxruyciuuaermyh) **둘 다 존재하지 않음**(`pg_get_functiondef` 조회 결과 0건).
- `cron.job` 테이블 — 양쪽 다 hold 관련 스케줄 잡 **0건**(Stage에 현재 활성 8개 잡 중
  hold 관련 없음, Production도 동일 쿼리로 0건 확인).
- **Production 실측**: 현재 `status='hold'`인 예약 **29건**, 그중 생성된 지 **30분 이상
  지난 건이 29건 전부**(즉 hold 상태인 예약은 예외 없이 전부 "10분 만료" 정책을 이미
  넘겼는데도 hold로 남아있음).
- Migration 30(`20260529000030_30_cron_jobs.sql`, 2026-05-29 최초 등록)에는
  `hold_expiration_cleanup` 잡이 1분마다 `release_reservation_hold()`를 호출하도록
  등록돼 있었으나, 현재 시점 두 DB 어디에도 이 잡·함수가 없음 — 마이그레이션 히스토리
  중 이를 명시적으로 `DROP`/`unschedule`한 파일은 발견되지 않음(원인 미상 — 별도 조사
  필요, 이번 §0-5 범위 밖).
- Migration 263(`20260815000263`, 2026-08-15)의 REVOKE 대상 함수 목록에
  `release_reservation_hold`가 여전히 등재돼 있어, 그 마이그레이션 작성 시점엔 이 함수가
  존재한다고 전제하고 있었다(그 스크립트 자체는 존재하지 않는 함수를 "missing"으로 건너뛰는
  방어 로직이 있어 에러 없이 조용히 넘어갔을 가능성이 높음 — 즉 마이그레이션 실행 실패로
  드러나지 않았을 수 있음).

**영향(중요)**: 이번 NOW 작업(계약서 서명 게이팅, Migration 284)으로 결제완료만으로는
더 이상 즉시 confirmed 전환되지 않고 hold에 더 오래 머무는 예약이 늘어나는 구조로
바뀌었다 — HOLD 만료가 실제로 동작하지 않는 상태에서 이 변경이 겹치면, 계약서명을 하지
않는 고객의 예약이 **재고를 무기한 점유한 채 영구히 hold로 남을 위험**이 구조적으로
커진다(이전에는 만료가 됐든 안 됐든 결제만 하면 어차피 금방 confirmed로 빠졌지만, 이제는
hold 체류 시간 자체가 늘어남).

**아직 하지 않은 것(Stephen 확인 후 진행)**: 코드 수정·신규 마이그레이션·cron 재등록 전부
미수행. 이 사안은 단순 세션조회 로직 교체(§0-3 패턴)와 달리 "만료 처리가 실제로 무엇을
해야 하는가"(단순 status='expired' 전환인지, 재고 배정 해제까지 포함하는지, 만료 알림을
고객에게 보낼지 등)에 대한 서비스 의도 확인이 선행돼야 하는 별도의 CRITICAL 아젠다로 판단—
이 문서(§0-5)에는 발견 사실만 기록.

#### 수정 내역 (2026-08-18, Stephen 승인 후 같은 세션에서 완료)

**Stephen 확정 정책**: "10분은 UX상 매우 짧아 고객 선택권에 제약이 크다 — 30분으로 변경."
만료 처리 자체는 "재고 배정 해제"(단순 status 전환만으로 충분 — 아래 참고)·"고객 알림 발송"
(이번엔 범위에 넣지 않음, 필요시 별도 논의) 둘 중 전자만으로 확정.

**마이그레이션**: `supabase/migrations/20260818000285_285_hold_expiration_restore.sql`
- `release_reservation_hold() RETURNS jsonb` 신규(Migration 30에 있었던 것과 동일 함수명 —
  service_role 전용, `status='hold' AND created_at < NOW() - INTERVAL '30 minutes'`인 행만
  `status='expired'`로 UPDATE, 만료시킨 행 수를 `expired_count`로 반환).
- pg_cron 잡 `hold_expiration_cleanup` 재등록(Migration 30과 동일 이름·주기 1분마다, 함수
  내부 임계값만 10분→30분).
- **재고 해제는 별도 로직 불필요**: `rental_reservations_product_dates_excl`(GiST 배제
  제약)와 `create_hold_reservation` RPC의 가용성 검사(`rr.status NOT IN ('cancelled',
  'returned', 'completed', 'expired')`) 둘 다 이미 `expired`를 배제 대상에서 빼고 있었다
  (코드로 직접 확인) — status만 `expired`로 바꾸면 그 순간 재고가 자동으로 풀린다.
- **실행 중 추가로 발견한 별개 스키마 결함**: `rental_reservations_status_check` CHECK
  제약에 애초에 `'expired'`가 등록돼 있지 않았다(draft/pending/hold/confirmed/active/
  shipped/in_use/return_requested/returned/completed/cancelled/damage_claimed 12개뿐).
  배제 인덱스·`create_hold_reservation`·이 문서·products.md §5·rental-lifecycle.md 상태
  머신은 전부 `expired`를 이미 존재하는 값처럼 다뤄왔으나, 실제 제약에는 처음부터 빠져
  있었던 것으로 보인다(그래서 cron이 있었어도 언젠가부터는 `UPDATE ... SET status=
  'expired'`가 CHECK 위반으로 실패했을 가능성도 있음 — 원인불명 미스터리의 일부를 설명할
  수 있는 단서). 같은 마이그레이션에서 `expired`를 허용값에 추가.

**Stage(ezyvffjvuwmtuhpxdjrw) 적용·검증**: `apply_migration` 2건(함수+cron / CHECK 제약)
적용 완료. `has_function_privilege`로 `anon=false/authenticated=false/service_role=true`
확인, `cron.job`에서 `hold_expiration_cleanup` 활성·`* * * * *` 스케줄 확인.

**TDD 재검증**: 신규 `src/__tests__/services/holdExpiration.test.ts`(라이브 Stage DB,
`contractSigningGate.test.ts`와 동일 ephemeral 픽스처 패턴) 5건 — ① 30분 초과 hold →
expired 전환 ② 30분 이내 hold → 미전환(경계 회귀 방지) ③ hold가 아닌 상태(confirmed)는
30분이 지나도 미전환 ④ `expired_count`가 실제 전환 건수를 정확히 반영 ⑤ 멱등성(이미
expired인 행을 다시 호출해도 에러 없음). 최초 실행 시 CHECK 제약 미비로 ①④⑤ 3건이
`23514 violates check constraint` 에러로 실패 → 제약 수정 후 5/5 GREEN. 인접 회귀 확인:
`reservationHelper.test.ts`·`confirmMock.test.ts`·`contractSigningGate.test.ts` 포함
6개 파일 88/88 pass. `npx eslint`·advisors(release_reservation_hold 관련 신규 항목 0건)
확인.

**✅ Production(vnbpmvxruyciuuaermyh) 적용 완료(2026-08-18, Stephen 승인)**: CHECK 제약
수정 + 함수·cron 등록 2건 모두 적용. `has_function_privilege`(anon=false/authenticated=false/
service_role=true)·cron.job 활성·스케줄(`* * * * *`)·CHECK 제약 정의(`expired` 포함) 전부
재확인. **적용 직후 cron이 실제로 1분 이내 첫 실행돼, 방치돼 있던 hold 29건 전부가
정상적으로 expired 전환됨을 직접 확인**(`status='hold'` 잔여 0건, `status='expired'` 29건).

**수정**: 위 인라인 세션조회+INSERT 블록을 `admin.rpc('find_or_create_general_chat_session',
{ p_user_id, p_reservation_id: validation.lateFee.reservation_id })` 호출로 교체(§3·§5-2와
동일 패턴). RPC 에러 시 `console.error`로 로그만 남기고 결제 완료 응답(200) 자체는 막지
않음(채팅 안내는 부가 기능 — 세션 조회 실패가 이미 완료된 결제 처리 결과를 가려서는 안 됨).

**재검증(RED→GREEN)**: 신규 `src/__tests__/services/lateFeePayMockSession.test.ts`(mock 기반,
`confirmMock.test.ts`와 동일한 POST 핸들러 직접 import 패턴) 5건 —
① 정상: `find_or_create_general_chat_session`을 `{p_user_id, p_reservation_id}`로 정확히
호출 + 반환된 session_id로 메시지 삽입, `chat_sessions` 테이블 직접 조회는 더 이상 발생하지
않음을 확인 ② RPC 에러 시에도 결제 응답은 여전히 200(부가기능 실패가 주 흐름을 막지 않음)
③ 세션이 아예 없어 신규 생성되는 경우(기존 버그의 "완전 유실" 케이스)도 정상적으로 새
session_id에 메시지가 들어감 ④⑤ 인증·검증 가드 회귀 없음. 수정 전 코드로 임시 되돌려
재실행 → 3/5 정확히 RED(`unexpected table: chat_sessions` — 옛 코드가 여전히 `chat_sessions`를
직접 조회하려 함을 확인) → 원복 후 5/5 GREEN. `npx tsc --noEmit`·`npx eslint`(수정 파일+
신규 테스트 파일) 신규 에러·경고 0건.

### 0-6. 🔴 sp3-qa-agent GATE E 검수 중 CRITICAL 신규 발견 — `resolveApprovalNotifyPlan`이 `expired`를 `cancelled`와 다르게 취급 (✅ 발견 즉시 수정·재검증 완료, 2026-08-18)

> ⚠️ Migration 285(HOLD 30분 자동만료)에 대한 정식 GATE E 검수 과정에서 sp3-qa-agent가
> 실증까지 마쳐 발견한 CRITICAL 결함 — §0-1~0-5 어디에도 명시적으로 나열되지 않았던
> 지점이나, "HOLD 만료"(#12/§0-5)와 "묶음주문 통합알림"(#7/§0-4) 두 수정이 상호작용하며
> 생긴 새로운 실패모드였다.

`src/lib/server/reservationApprovalNotify.ts`의 `resolveApprovalNotifyPlan()`은 같은 주문
(order_items)으로 묶인 형제 예약 중 `cancelled`만 판단 대상에서 제외했다(`relevant = rows
.filter(r => r.status !== 'cancelled')`). Migration 285 적용 이전에는 형제 예약이 `cancelled`
아니면 결국 언젠가는 `confirmed`가 될 잠재력이 있어 큰 문제가 아니었으나, **Migration 285
이후로는 `expired`도 `cancelled`와 마찬가지로 다시는 `confirmed`가 될 수 없는 영구 종결
상태**가 됐다. 그런데 이 함수는 `expired`를 여전히 "언젠가 confirmed될 수 있는 미완료 상태"
취급해 `relevant`에 남겼고, 그 결과 `allConfirmed = relevant.every(r => r.status ===
'confirmed')`가 **영원히 `false`로 고정**된다.

**실사고 시나리오**: 고객이 여러 상품을 한 주문으로 신청 → A상품은 결제·서명까지 완료해
`confirmed` 전환됐지만 B상품은 30분 내에 완료하지 못해 `expired` → **A상품의 "예약이
승인되었습니다" 알림이 영구히 발송되지 않는다**(285 적용 이전에는 고객이 늦게라도 B를
완료하면 뒤늦게라도 알림이 나갔지만, 285 이후 B는 만료되면 다시는 confirmed가 될 수
없으므로 이 알림 발송 기회 자체가 사라짐 — Migration 285가 이 실패모드를 "가능"에서
"확정"으로 바꿔놓았다).

**왜 즉시 위험했는가**: `resolveApprovalNotifyPlan`은 이미 `origin/main`에 커밋·배포된
`cms/reservation/+page.server.ts`(`approveReservation`, 커밋 `ef3ec3b`)에서 실사용 중이었고,
Migration 285도 이미 Production에 적용돼 실제로 hold 29건을 expired로 전환한 상태 — 즉
두 조건이 발견 시점 이미 Production에서 동시에 살아있었다.

**실증**: sp3-qa-agent가 Stage DB에 order_items로 묶인 2건(하나는 `confirmed`, 하나는
`expired`)을 만들어 `resolveApprovalNotifyPlan(admin, confirmedId)`를 직접 호출 →
`{"mode":"hold"}` 반환 확인(검증 후 정리, 저장소에 흔적 없음).

**수정**: `relevant` 필터를 `r.status !== 'cancelled' && r.status !== 'expired'`로 확장 —
취소와 만료 둘 다 "더 이상 이 형제를 기다리지 않음" 취급으로 통일.

**재검증(RED→GREEN)**: `src/__tests__/services/reservationApprovalNotify.test.ts`에 2건
추가(① 형제 1건 expired + 1건 confirmed → batch 반환 + expired는 reservationIds에서 제외
② 형제 전부 expired고 confirmed 없음 → hold 반환, 잘못된 배치알림 방지). 수정 전 코드로
되돌려 재실행 → ①이 정확히 RED(`expected 'hold' to be 'batch'`) → 원복 후 7/7 GREEN.
인접 회귀(`holdExpiration`·`contractSigningGate`·`confirmMock`) 포함 5개 파일 31/31 pass.
`npx eslint`·`npx svelte-check` 신규 에러 0건. ⚠️ 이 수정도 아직 git 미커밋(§4 참고).

---

## 1. 전체 흐름 요약표

| 단계 | 고객/관리자 행동 | 실제 트리거 파일·RPC | `/cms/reservation`·`/cms/rentals` 배지 | `/cms/chat` 알림(notify_type / action_payload.type) |
|---|---|---|---|---|
| ① 예약신청 | 고객 체크아웃(hold 생성) | `POST /api/checkout/notify-hold` → `send_rental_chat_notification(id,'reservation_hold')` | 신청대기 | `reservation_hold` — "예약 신청 확인" |
| ② 결제 등록 | 고객 결제(dev: confirm-mock) | `mark_reservation_payment_confirmed(id)` RPC(hold 유지, `payment_confirmed_at`만 기록 — 계약서명 전까지는 confirmed 전환 안 됨, Migration 284) | 신청대기 + **결제완료**(추가 배지) | (알림 없음 — payment_confirmed_at만 기록) |
| ③ 계약발송 | 관리자 "계약서 양식 선택·편집→발행" | `POST /api/cms/reservations/[id]/init-contract` → `POST /api/cms/contracts/[id]/send-chat` (RPC 미경유, `chat_messages` 직접 INSERT) | 신청대기(변화 없음). 상세패널 헤더: **"결제완료 · 계약대기"**, 계약서 탭: **"계약서 발송됨 · 서명 대기 중"** | `contract_link` — "전자계약 보기" |
| ④ 서명 완료 | 고객 `/contract/[token]`에서 서명 | `POST /api/contracts/[token]/sign` → `try_confirm_reservation(id)`(hold+결제완료 조건 재검증 후 confirmed 전환) + `send_rental_chat_notification(id,'reservation_approval')` **+** 자체 인라인 로직으로 `contract_signed` 메시지 INSERT(RPC 미경유) | **계약완료**로 전환, 목록이 `/cms/reservation`→`/cms/rentals`로 즉시 이동 | `reservation_approval`("예약 승인 확인") **+** `contract_signed`("전자계약 확인") — 별도 발송(⚠️ §2-4 결함 참고, 서로 다른 세션에 갈 수 있음) |
| ⑤ 반출 처리 | 관리자 "택배 출고 처리"/"방문 출고 처리" | `update_reservation_status(id,'shipped')` (updateStatus 액션, AUTO_NOTIFY) | 반출중(rentals) / 배송중(reservation) | `shipment_notify` — "반출 안내" |
| ⑥ 수령 확인 | 관리자 "택배수령 확인"/"방문수령 확인" | `update_reservation_status(id,'in_use')` | 대여중 | `rental_confirm` — "수령 확인" |
| ⑦ 반납예정 알림(수동) | 관리자 "반납 예정 알림 💬" 버튼 | `send_rental_chat_notification(id,'return_remind')`(NOTIFY_TYPE_MAP 수동 발송, 상태 전환 없음) | 대여중(변화 없음) | `return_remind` — "반납 등록하기" |
| ⑧ 반납 접수 | 관리자 "반납 접수" 버튼(⚠️ 고객 클릭이 아님, §0-4) | `update_reservation_status(id,'return_requested')` | 반납중(rentals) / 반납요청(reservation) | `return_registration` — "반납 정보 등록" |
| ⑨ 반납완료 | 관리자 "반납 처리" 버튼 | `update_reservation_status(id,'returned')` | 반납완료 | `rental_complete` — "대여 완료" |

---

## 2. 실화면 검증 로그 (2026-08-17/18, Stage DB)

### 2-1. 회원(mublues@gmail.com, 상담 이력 있음) — 결함A 재검증 포함

```
사전조건: 실 대화이력이 있는 이 계정의 기존 general 세션을 일부러 pending으로 전환해
         결함A(대기 탭 갇힘) 전제조건 재현

① hold 생성(CSREVTESTMEM01) → mark_reservation_payment_confirmed → false 반환,
  status='hold' 유지 + payment_confirmed_at 기록 확인
  → /cms/reservation 배지: "신청대기" + "결제완료" 실화면 확인

③ init-contract + send-chat(관리자 실 로그인 세션 fetch) 실행
  → 상세패널 배지 "신청대기"+"결제완료 · 계약대기", 계약서 탭 "계약서 발송됨 · 서명 대기 중"
    실화면 확인
  → ⚠️ 발송된 "전자계약 보기" 카드가 mublues의 진행중(general) 세션이 아니라, 완전히
    별도의 오래된 'reservation' 컨텍스트 pending 세션(2026-07-27에 생성된 것)으로 감 —
    /cms/chat "대기" 탭에 갇힌 채로 실화면 확인(§2-4 결함B-2 참고)

④ 고객 세션(tab-2, 실 로그인)에서 sign API 직접 호출(signature_data 포함)
  → rental_reservations.status: hold → confirmed 자동 전환 실화면(DB) 확인
  → reservation_approval 알림은 mublues의 general(진행중) 세션에 정상 도착(수정된
    find_or_create_general_chat_session 사용 — 정상)
  → contract_signed 알림은 위 별도 pending 세션에 도착, 여전히 "대기" 탭 — 두 알림이
    서로 다른 채팅창으로 쪼개짐을 /cms/chat 실화면으로 확인
  → /cms/rentals로 카드 즉시 이동, "계약완료" 초록 배지 실화면 확인

⑤~⑨ RentalDetailPanel 실제 버튼(운송장 저장 / 택배 출고 처리 / 택배수령 확인 / 반납
  예정 알림 💬 / 반납 접수 / 반납 처리)을 전부 실클릭으로 순서대로 실행
  → 매 단계 목록 배지 전환(반출중→대여중→반납중→반납완료) + /cms/chat 알림 도착
    (반출 안내 → 수령 확인 → 반납 예정 알림 → 반납 정보 등록 → 대여 완료) 전부 실화면 확인
  → §0-3/5 확인: 어느 단계에서도 버튼이 비활성 상태로 보인 적 없음(전환 즉시 항상 활성)
```

### 2-2. 신규 회원(상담 이력 0건) — 결함B 재검증 포함

```
① hold(CSREVTESTGUEST1) → mark_reservation_payment_confirmed → false, 신청대기+결제완료
③ init-contract + send-chat → "전자계약 보기" 카드가 대기 탭을 거치지 않고 곧바로
  "진행중" 탭에 신규 세션으로 노출(실화면 확인) — 상담 이력이 없으면 send-chat도
  신규 세션을 만들어 open으로 생성하므로 문제 없음(§2-4 결함B-2는 "기존 pending
  세션이 있을 때만" 발현되는 조건부 결함임을 대조 확인)
④ sign API 호출 → confirmed 전환, /cms/rentals에 "계약완료"(고객명 "-" — 이름정보
  없는 신규가입자라 정상 표시) 즉시 노출 실화면 확인
  → reservation_approval + contract_signed 두 알림이 이번엔 우연히 같은 general
  세션에 모임(§2-4 결함B-2 참고 — 신규 고객이라 결과적으로 문제가 드러나지 않았을 뿐,
  근본 원인은 여전히 존재)
```

---

## 3. 신규 발견 결함 — 검증 중 발견, **같은 세션에서 즉시 수정 완료** (2026-08-18)

> ✅ Stephen 승인("네, 함께 수정해줘") 후 같은 세션에서 수정 및 재검증까지 완료.

### 결함B-2 — 계약발송·서명완료 알림이 세션 상태단절(결함A)·세션분산 문제를 그대로 가짐 (수정 완료)

`src/routes/api/cms/contracts/[id]/send-chat/+server.ts`와
`src/routes/api/contracts/[token]/sign/+server.ts` 둘 다, 이번 세션 초반에 고친
`find_or_create_general_chat_session()` 헬퍼를 쓰지 않고 **각자 독자적인 세션탐색 로직**을
갖고 있었다(pending→open→closed→신규 순차 조회). 이 로직에는 두 가지 문제가 함께 있었다:

1. **context_type 필터가 없음** — `find_or_create_general_chat_session`은 반드시
   `context_type='general'`만 찾지만, 이 두 엔드포인트는 status만으로 아무 컨텍스트의
   세션이나 찾았다. 그 결과 완전히 별개 용도(예: 오래된 'reservation' 컨텍스트)의 세션과
   'general' 세션 사이에서 알림이 **예측 불가능하게 분산**됐다(§2-1 실증: 같은 서명 이벤트의
   두 알림이 서로 다른 두 세션으로 쪼개짐).
2. **pending 세션을 찾아도 open으로 승격하지 않음** — `send-chat`·`sign` 둘 다
   `if (pendingSession) { sessionId = pendingSession.id }`처럼 그대로 사용만 하고 상태
   전환 코드가 없었다. 이번 세션에서 고친 3개 함수(결함A)와 **완전히 동일한 유형의 버그**가
   이 두 파일에 미수정 상태로 남아있었다(§2-1 실증: 계약발송 카드가 "대기" 탭에 갇힘).

**수정**: 두 파일의 자체 세션탐색 블록(각각 40여 줄)을 `find_or_create_general_chat_session
(p_user_id, p_reservation_id)` RPC 호출 한 줄로 교체. `sign/+server.ts`의 이제 미사용이 된
`findChatSessionByStatus` 헬퍼 함수도 함께 제거(죽은 코드 방지).

**재검증(RED→GREEN, 실화면+DB 대조)**: mublues 계정의 general 세션을 pending으로,
별도 'reservation' 컨텍스트 pending 세션(스트레이)도 함께 만들어 원래 버그 조건을 재현한 뒤
동일 흐름(계약발송→서명)을 실제 API로 재실행.
- 계약발송 메시지가 정확히 mublues의 general 세션에 도착 + `status`가 `pending→open`으로
  자동 승격 + `context_reservation_id`도 신규 예약ID로 자동 채워짐을 DB로 확인
- 스트레이 'reservation' 세션은 전혀 건드려지지 않음(메시지 0건 유지) 확인
- 서명 완료 후 `reservation_approval`("예약이 승인되었습니다") + `contract_signed`("전자계약
  서명이 완료되었습니다") **두 알림이 동일한 general 세션에 순서대로** 쌓이는 것을 DB·
  `/cms/chat` 실화면 양쪽으로 확인(수정 전엔 두 세션으로 쪼개졌던 것과 대조)
- `npx tsc --noEmit`·`npx eslint` 두 파일 모두 신규 에러·경고 0건

---

## 4. 참고 — 관련 파일 인덱스

```
예약신청 트리거      : src/routes/api/checkout/notify-hold/+server.ts
결제확인(mock)       : src/routes/api/checkout/confirm-mock/+server.ts (mark_reservation_payment_confirmed RPC)
계약 생성            : src/routes/api/cms/reservations/[id]/init-contract/+server.ts
계약 발송            : src/routes/api/cms/contracts/[id]/send-chat/+server.ts (✅ §3 결함B-2 수정완료)
서명 처리            : src/routes/api/contracts/[token]/sign/+server.ts (✅ §3 결함B-2 수정완료·배포됨, try_confirm_reservation RPC / ⚠️ §0-4 #7 통합알림 부분은 코드수정완료이나 git 미커밋 — Production 미배포, 2026-08-18 감사 확인)
예약승인(단건/배치)   : src/routes/cms/reservation/+page.server.ts (approveReservation, updateStatus 액션)
배치알림 판단로직     : src/lib/server/reservationApprovalNotify.ts (resolveApprovalNotifyPlan,
                       ✅ §0-6 expired 처리 수정완료, ⚠️ git 미커밋 — Production 미배포,
                       2026-08-18 sp3-qa-agent GATE E 발견·즉시수정)
상태전이별 자동알림   : rental-lifecycle.md "채팅 알림 발송 매핑" AUTO_NOTIFY
RentalDetailPanel    : src/lib/components/cms/RentalDetailPanel.svelte, src/lib/utils/rentalTransition.ts
예약현황 배지         : src/routes/cms/reservation/+page.svelte STATUS_LABEL(§26-37), contractBadge()(§114-119)
대여현황 배지         : src/routes/cms/rentals/+page.svelte STATUS_LABEL(§26-34, 계약배지 없음)
알림 세션단절 수정본 : supabase/migrations/20260817090000_282_chat_session_notify_fix.sql
                       (find_or_create_general_chat_session RPC 신설 — send-chat/sign 두
                       파일도 2026-08-18 동일 헬퍼로 교체 완료, §3 참고)
쿠폰 직접발송         : src/routes/api/cms/chat/coupon-gift/direct-send/+server.ts (✅ §5-2 코드수정완료, ⚠️ git 미커밋 — Production 미배포, 2026-08-18 감사 확인)
연체료 결제완료 안내  : src/routes/api/checkout/late-fee/[id]/pay-mock/+server.ts (✅ §0-3 코드수정완료, ⚠️ git 미커밋 — Production 미배포, 2026-08-18 감사 확인)
HOLD 30분 자동만료    : supabase/migrations/20260818000285_285_hold_expiration_restore.sql
                       (release_reservation_hold RPC + hold_expiration_cleanup pg_cron,
                       ✅ §0-5 수정완료, Stage·Production 둘 다 적용 완료)
```

---

## 5. 후속 발견 결함 — 좌초(orphaned) 세션 + coupon-gift 미수정 버그 (2026-08-18, 후속 조사)

> ✅ Stephen 제보("대기 탭 세션이 여전히 진행중으로 이동 안 됨") → 원인분석 → 승인
> ("네, 둘 다 진행해줘") → 같은 세션에서 조치·재검증까지 완료.

### 5-1. 좌초 세션 — §3 결함B-2 수정 이전에 생성된 잔재 (데이터 문제, 코드 결함 아님)

§3 수정(계약발송·서명 API가 `find_or_create_general_chat_session`으로 세션을 통일하기 전)에
만들어진 `context_type='reservation'` 세션은, 수정 이후 **어떤 새 알림으로도 다시는 선택되지
않는 좌초 상태**가 된다 — 모든 새 알림이 이제 `general` 세션으로만 라우팅되기 때문이다.

**실증(Stage DB)**: mublues 계정의 pending 세션 4건 중 2건(`0b2a4af7`, `62f55bb5`,
둘 다 `context_type='reservation'`)이 같은 고객의 정상 `general` 세션(`2b2cbaa0`)과 별개로
존재 — 아무리 새 예약승인·계약발송을 보내도 이 2건은 "대기"에서 영원히 안 움직임을 확인.

**영향범위 확인**: Production(vnbpmvxruyciuuaermyh) 교차조회 결과 `status IN
('pending','open') AND context_type='reservation'`인 세션 **0건** — 이 좌초 패턴은 Stage
(테스트 이력이 쌓인 환경)에서만 발현되고 Production에는 없음을 직접 조회로 확인.

**조치(Stage 데이터 정리, 코드 변경 아님)**: 좌초 세션 2건을 `UPDATE chat_sessions SET
status='closed'`로 정리 — 메시지는 삭제하지 않고 "종료" 탭에서 그대로 조회 가능하게 보존.
재현 가능한 스키마 변경이 아닌 1회성 상태값 정정이라 마이그레이션 파일화하지 않음(QA 검수
시 이 판단 자체가 합리적이라는 코멘트 확인됨).

**검증**: `/cms/chat` 실화면 — 대기 5→2, 종료 27→29로 정확히 반영(남은 대기 2건은 실제로
응답을 기다리는 정상 `general` 세션). DB 직접 재조회로 두 세션 모두 `status='closed'` +
메시지 보존(1건/4건, 삭제 0건) 확인.

### 5-2. coupon-gift/direct-send — 별도의 미수정 세션단절 버그 (수정 완료)

`src/routes/api/cms/chat/coupon-gift/direct-send/+server.ts`(관리자가 채팅창에서 쿠폰을
직접 선택해 즉시 발급하는 기능)는 세션 `status`를 조회만 하고, `admin-reply`·
`admin-attachment`와 달리 **대기/종료 세션을 진행중으로 승격시키는 코드가 아예 없었다.**
이 경로로 쿠폰을 보내면 세션은 영원히 원래 탭(대기/종료)에 남는다 — §3의 결함B-2와는
독립적으로 발견된, 완전히 별개의 파일·별개의 원인을 가진 버그.

**수정**: `admin-reply/+server.ts`와 동일한 조건(`if (status === 'closed' || status ===
'pending') → status: 'open'`)을 세션 조회 직후, 쿠폰 조회·`distribute_coupon` RPC 호출보다
먼저 실행되도록 추가. (참고, 비차단) `admin-reply`는 승격 시 `admin_id`도 함께 배정하지만
coupon-gift는 애초에 `admin_id`를 select하지 않아 세팅하지 않음 — 쿠폰발송은 담당자 배정
개념이 불필요해 기능상 문제는 없으나 완전한 패턴 일치는 아님.

**검증**: 격리된 pending 테스트 세션에 실제 API로 쿠폰 발송 → `status`가 `open`으로 정상
승격됨을 DB 재조회로 확인. `npx tsc --noEmit`·`npx eslint` 신규 에러·경고 0건. 테스트
세션·발급된 테스트 쿠폰 전부 정리.

---

*reservation-rental-execution.md v1.5 | Harness Flow v3.2 | 2026-08-17/18 Claude Browser 실화면
전수 검증으로 확정 — 회원/신규회원 2계정으로 예약신청~반납완료 전 구간(9단계) 실제 트리거
파일·API·RPC를 실행하며 CMS 3개 화면(상담·예약현황·대여현황) 배지·카드·버튼 상태 대조.
Stephen 기대와 실제 코드가 다른 5개 지점(§0) + 신규 발견 결함 2건(§3 세션 2개 파일, §5-2
coupon-gift 1개 파일 — 전부 같은 세션에서 Stephen 승인 받아 수정·재검증 완료) + 후속 데이터
정리 1건(§5-1, Stage 전용 좌초 세션) 정확히 기록. | 2026-08-18 §0-1(추가 확인 필요 문항
#6~13) 신설 + 우선순위 #6·#11 Stage 재검증 완료(§0-2, 둘 다 정상 동작 확인) + #11 점검 중
발견한 인접 신규 결함 1건(§0-3, late-fee/pay-mock 세션단절 — 같은 세션에서 Stephen 승인 받아
수정·TDD 재검증 완료) + 나머지 #7·#8·#9·#10·#13 실증 완료(§0-4 — #7은 묶음주문 자동승인
경로의 통합알림 정책 누락을 발견해 같은 세션에서 Stephen 승인 받아 즉시 수정·TDD 재검증까지
완료) + **#12 점검 중 CRITICAL 신규 발견 + Stage·Production 둘 다 수정 완료**(§0-5, HOLD
만료 pg_cron 메커니즘이 Stage·Production 둘 다에 실존하지 않았고 상태 CHECK 제약에도
'expired'가 누락돼 있던 것을 함께 발견 — Stephen 승인으로 "10분→30분" 정책 확정 +
Migration 285로 Stage 복구·TDD 재검증(88/88 pass) 후 Production에도 적용, 적용 직후 cron
첫 실행으로 방치된 hold 29건이 정상적으로 expired 전환됨을 직접 확인) + **Migration 284
Production 배포 순서 사고 발견·긴급 복구**(코드는 PR #154/#155로 이미 Production 배포됐으나
DB 마이그레이션이 누락돼 실고객 체크아웃이 막혀있던 상태 — Stephen 긴급 승인 후 즉시
Production 적용 완료, 실제 피해 없이 복구) + **배포상태 전수감사로 미배포 3건 발견**(§4,
sign.ts #7 부분·coupon-gift·late-fee — 코드·테스트는 맞으나 git 미커밋으로 Production
미반영 확인, 조치는 Stephen 직접 처리) + **sp3-qa-agent GATE E 검수 중 CRITICAL 신규
발견·즉시수정**(§0-6, `resolveApprovalNotifyPlan`이 `expired`를 `cancelled`와 다르게
취급해 Migration 285 이후 묶음주문 중 한 상품 만료 시 다른 상품 승인알림이 영구 보류되던
결함 — Stage 실증 후 필터 수정·TDD 재검증 완료, 이 수정도 git 미커밋 상태).*
