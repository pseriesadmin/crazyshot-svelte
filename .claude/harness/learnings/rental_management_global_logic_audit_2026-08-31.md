# CMS 대여관리(`/cms/reservation`·`/cms/rentals`) 전역 기능 로직 정밀 작동 검증 — 2026-08-31

> ⚠️ **상태 업데이트(2026-09-01)**: 이 문서의 CRITICAL 미해결 항목(NTF-*·RLA-C1·HOLD-D2-GAP·
> RLS 역할혼동)은 CMS 전역 정밀 검증 v5에서 전수 재검증됐다 — 최신 판정은
> `cms_global_verification_v5_synthesis_2026-08-31.md`(A절) 참고. RLS 역할혼동은 재검증 결과
> 실제 미해소로 확정돼 Migration #408로 수정(적용 대기). 이 문서는 원본 그대로 보존한다.

감사 범위: 대여 라이프사이클 전체 — 상태전이(nextStatus/nextLabel/스텝퍼) · 채팅/푸시 알림 매핑 ·
예약승인(confirmed) 게이팅·HOLD 자동만료·목록조회 정합성 · 권한검사·RPC경유 원칙. `/cms/reservation`·
`/cms/rentals` 두 화면과 그 하위 API 엔드포인트, 그리고 이 화면들이 호출하는 모든 RPC/마이그레이션.

감사 방법: 직전 세션(`rental_settings_cart_integration_audit_2026-08-30.md`)에서 확립한 4-way
병렬 read-only 정적 코드 감사 방법론을 그대로 재사용 — general-purpose 에이전트 4개를 기능군별로
나눠 병렬 실행(코드 수정 없음), 각각 정본 규칙 문서(rental-lifecycle.md·service-operations.md·
security-auth.md·core-rules.md)를 "설계 의도"로 놓고 **지금 이 순간의 실제 코드**를 파일:라인
단위로 대조해 문서-코드 불일치 및 신규 결함을 판정했다.

배경: Stephen이 직전 세션 종료 시 "동일 방법론을 `/cms/reservation` 전역에도 적용해달라"고 요청한
후속 세션(계획 문서: `floofy-hopping-nebula.md` §6 "다음 세션 감사 시작점 제안"). 이번 세션은 그
제안대로 대여관리 전역을 4개 기능군(A~D)으로 나눠 감사했다.

---

## 종합 요약

```
🔴 CRITICAL(즉시 확인 필요) : 5건
🟡 BOUNDARY(운영 리스크)    : 7건
🟢 ROUTINE(참고/잠재)       : 3건
✅ 정합 확인               : 50개 지점 이상(4개 감사 각각의 "정합 확인 전체 목록" 참고)
```

**가장 시급한 것은 NTF-C1** — 실결제(Toss) 확정 처리(`payment/success/+page.server.ts`)가
`service-operations.md §9`의 "결제완료 AND 계약서명 완료" 게이팅을 알림 발신 로직에서는
확인하지 않아, 아직 계약서명 전(hold)인 예약에도 "예약이 승인되었습니다" 채팅카드·푸시가
나갈 수 있다. DB 상태(`rental_reservations.status`) 자체는 게이팅이 정확히 지켜지고 있어
**실제 예약 확정에는 영향 없지만, 고객에게 잘못된 정보를 전달**하는 리스크다. 단, 이 경로가
현재 실사용자 트래픽에서 도달 가능한지(구코드 여부)는 Stephen 확인이 필요하다(아래 참고).

그다음은 **HOLD-D2-GAP** — 계약서를 발송했지만 고객이 서명하지 않고 방치한 hold는 30분
자동만료에서 영구 제외되는데, 그 대체 정리 메커니즘(설계 당시 "D-2, 별도 아젠다로 보류"라고
명시된 항목)이 아직 구현되지 않아 재고가 무기한 묶일 수 있다.

**RLA-C1**은 rental-lifecycle.md 문서가 QR 반출입 기록의 근거로 서술하는 `log_rental_action`
RPC가 실제로는 앱 코드 어디에서도 호출되지 않는 완전한 죽은 코드라는 발견이다 — 실제 QR
처리는 `processRentalQrTransition`이라는 별도 경로를 탄다.

**NTF-C2·C3**은 같은 근본 원인(승인 알림 발신 로직이 5곳에 복붙되며 조금씩 다르게 구현됨)의
두 갈래다 — 관리자 수동승인 등 3개 경로는 §4(묶음주문 통합알림) 보류 조건을 무시하고 푸시를
과다발송하고(C2), 반대로 고객 서명완료 자동승인 경로는 푸시 자체가 아예 누락된다(C3).

---

## 🔴 CRITICAL

### [B] NTF-C1: `/payment/success`(실결제 Toss 확정) — 계약서명 완료 여부 확인 없이 `reservation_approval` 채팅+푸시 무조건 발송

```
지점: src/routes/payment/success/+page.server.ts:71-83
RPC : supabase/migrations/20260819040000_303_checkout_use_points.sql:71-138
      confirm_payment_and_update_reservation() — 115행에서 try_confirm_reservation()을
      PERFORM으로 호출해 반환값(TRUE/FALSE)을 그대로 버림. RPC 최종 리턴은
      payment_transactions INSERT 성공 여부(success)뿐 — "confirmed로 전환됐는가"와 무관.
게이팅 자체: Migration 284 try_confirm_reservation()은 서명이 없으면 즉시 FALSE 반환하고
      아무것도 바꾸지 않음(§9 AND 조건은 DB 레벨에서 정확히 구현돼 있음 — 문제는 호출부가
      그 결과를 무시한다는 점).
```

`+page.server.ts` 73-77행이 `result.idempotent`(재확정 시도 여부)만 보고 채팅+푸시를 무조건
발송한다. 같은 파일 102-106행 주석은 이 정확한 갭을 이미 인지해 **화면 UI 문구는 올바르게
수정**했지만, 71-83행의 알림 발신 로직은 그 수정에서 빠졌다 — 같은 파일 안에서 "화면은
정직한데 알림은 거짓말하는" 상태. 이 파일은 §4(묶음주문 통합/개별 알림) 로직도 쓰지 않아
묶음주문에서도 상품별 개별 카드가 나간다.

**영향**: 계약서명 전(아직 `hold`)에 실결제만 완료한 고객이 "대여가 확정됐어요" 알림을
받아 실제로는 안 끝난 절차를 끝났다고 오인할 수 있다.

**⚠️ 도달 가능성 미확정(Stephen 확인 필요)**: 이 페이지의 유일한 진입 경로
`/api/checkout/initiate`를 호출하는 코드가 `src/routes`·`src/lib` 전체에 grep 0건 —
카트 체크아웃은 `confirm-mock`(§9 정상 반영)을, 계약서명 후 실결제는 신규
`/contract/[token]/pay-result`(이번 세션 중 신설된 uncommitted 파일)를 쓰는 것으로 보인다.
즉 **현재 실트래픽에서 도달 불가능한 구코드일 가능성**이 있으나, 라우트 자체는 살아있어
북마크·직접 URL 접근으로 여전히 실행될 수 있다.

---

### [B] NTF-C2: `reservation_approval` 푸시가 3개 지점에서 §4 묶음주문 보류(`notifyPlan.mode==='hold'`)를 무시하고 무조건 발송

```
지점 1: src/routes/cms/reservation/+page.server.ts:133-155 (approveReservation, 관리자 수동승인)
지점 2: src/routes/api/contracts/[token]/pay-mock/+server.ts:89-109 (계약서명 후 모의결제 확정)
지점 3: src/routes/contract/[token]/pay-result/+page.server.ts:185-203 (계약서명 후 신규 실결제)
```

세 곳 모두 `sendReservationLifecyclePush()`가 `resolveApprovalNotifyPlan()`(묶음주문
통합/개별/보류 판정) 계산보다 **먼저** 조건 없이 호출된다 — 채팅카드는 `mode==='hold'`면
보류하는데 푸시는 그 판정 자체를 하기 전에 이미 나간다.

**영향**: 서로 다른 메인상품 2개 이상을 한 주문으로 묶어 예약한 고객은 상품 A만 먼저
확정돼도 곧바로 푸시를 받고, 이후 B까지 확정되면 채팅카드(통합 1건)가 오면서 B에 대한
푸시가 한 번 더 나간다 — 같은 주문에 대해 푸시 2번+채팅카드 1번으로, §4가 의도한 "통합
안내" 경험이 푸시 채널에서만 깨진다.

---

### [B] NTF-C3: 고객 서명완료로 자동승인되는 경로(`sign/+server.ts`)에서 `reservation_approval` 푸시가 아예 발송되지 않음

```
지점: src/routes/api/contracts/[token]/sign/+server.ts:100-220
      110-138행: try_confirm_reservation 성공 시 채팅카드(batch/single)는 §4대로 정상 발송
      206-210행: 'contract_signed_customer'("서명이 완료됐어요") 푸시만 발송,
                 reservation_approval 계열 푸시 호출은 파일 전체에 0건
```

**영향**: `§9` 확정 이후 가장 흔한 confirmed 전환 트리거는 "결제 먼저 → 계약서명 나중"인데,
이 경로로 확정되는 고객은 채팅카드로는 "예약이 승인되었습니다"를 받지만 푸시로는 대여
확정 사실을 전혀 통지받지 못한다 — NTF-C2(과다발송)와 정반대로 "과소발송" 비대칭.

> NTF-C1~C3 공통 원인: 승인 알림 발신 로직이 5개 파일(payment/success, approveReservation,
> pay-mock, pay-result, sign)에 복붙되며 조금씩 다르게 구현됨. 공용 헬퍼로 통합하지 않는 한
> 신규 발신 지점이 추가될 때마다 같은 클래스의 결함이 재발할 위험이 높다.

---

### [A] RLA-C1: rental-lifecycle.md가 근거로 삼는 `log_rental_action` RPC(Migration 154)가 현재 앱 코드 어디에서도 호출되지 않는 죽은 코드

```
문서 근거: rental-lifecycle.md "log_rental_action RPC — action_type 매핑"
RPC 정의 : supabase/migrations/20260723000154_154_fix_log_rental_action_visit_pickup.sql:8-57
          (함수 자체는 문서 서술과 완전히 일치 — 존재는 함)
호출 지점 전수 grep: "log_rental_action"·"rental_action_logs"·"visit_pickup" 등 문자열
          앱코드 참조 0건(마이그레이션 파일 제외)
실제 QR 반출입 경로: cms/mobile/qr/[product_id]/+page.server.ts:88-124(processQrAction)
          → src/lib/server/rentalQrTransition.ts:25-68(processRentalQrTransition)
          → update_reservation_status RPC만 호출. 상품 이력은 upsert_product_history_record로
          별도 기록(rental_action_logs 테이블 아님).
```

**영향**: 관리자가 감사 목적으로 `rental_action_logs` 테이블을 조회하면, QR 스캔이 매일
발생함에도 그 테이블은 항상 비어 있음을 발견하게 된다 — "기록되고 있다고 믿었던 로그가
실제로는 한 번도 쌓인 적 없다"는 형태의 공백. 코드 수정 없이 리포트만 하며, 이 RPC·테이블을
실제로 폐기할지 QR 자동화 경로에 다시 연결할지는 Stephen 확인 필요.

---

### [C] HOLD-D2-GAP: 계약서를 발송했지만 서명을 완료하지 않은 hold는 30분 자동만료에서 영구 제외되는데, 그 대체 정리 메커니즘(D-2)이 미구현

```
DB: supabase/migrations/20260821010000_324_hold_expiration_payment_contract_guard.sql:32-46
    (release_reservation_hold — contract_signings.sent_at IS NOT NULL인 hold를 30분 타이머
    WHERE절에서 완전히 제외)
파일 자체 주석(2-16행): "D-2 서명링크 만료 후 미서명 hold 정리 크론은 별도 아젠다로 보류"
확인: contract_signings.expires_at을 소비하는 지점은 고객이 서명링크를 직접 열 때의
    온디맨드 체크(contract/[token]/+page.server.ts:70, contracts/[token]/sign/+server.ts:28)
    뿐 — 이 만료를 기준으로 hold를 정리하는 pg_cron/RPC는 전수 grep 결과 어디에도 없음.
```

Migration 324의 D-1 조건(`sent_at IS NOT NULL`)은 "서명 완료"가 아니라 "발송 여부"만
본다 — **관리자가 계약서를 발송한 순간부터, 고객이 영원히 서명하지 않아도 그 hold는
30분 타이머 대상에서 완전히 빠진다.** 이 30분 정책이 존재하는 이유(§10) 자체가 "계약서명을
하지 않는 고객의 예약이 재고를 무기한 점유하는 상황을 막기 위함"인데, 정확히 그 케이스가
자동만료 범위 밖에 있다.

**영향**: 그 재고(자식 상품)는 해당 기간 동안 다른 고객에게 배정될 수 없는 상태로 무기한
묶인다.

**완화 요소**: `/cms/reservation`에 "계약대기"(발송됐지만 미서명) 전용 필터칩이 이미
존재해(`+page.svelte:17-22`) 관리자가 수동으로 발견·취소는 가능하다 — 완전한 silent
failure는 아니지만, 자동 정리·자동 알림은 전혀 없고 관리자가 능동적으로 확인해야만 발견된다.

---

## 🟡 BOUNDARY

### [D] B1: `/cms/rentals` Realtime 구독이 고객 등급 `is_admin()` RLS에 걸려 CMS 관리자 세션에서 사실상 항상 무동작할 가능성

```
구독: cms/rentals/+page.svelte:74-85 — 브라우저 supabase 클라이언트(anon key)로 직접
     postgres_changes 구독(이 리포트의 다른 감사 대상은 전부 service_role로 RLS 우회하지만
     이 Realtime 구독만 예외).
RLS : rental_reservations "관리자 전체" 정책 USING (is_admin())
is_admin() 정의: user_profiles.membership_grade = 'admin' (고객 등급 컬럼) —
     CMS 직원 등급(cms_role: partner/manager/superadmin)과 완전히 별개 개념.
확인: cms/accounts/+page.server.ts 전수 grep — createAccount가 membership_grade를 세팅하는
     코드 0건. 신규 CMS 계정은 이 컬럼이 기본값 'none'으로 남음.
```

products.md §2-8이 이미 동일 혼동(고객 등급 `is_admin()` vs CMS `is_cms_user()`)을 products
RLS에서 발견·수정한 전례가 있다 — 같은 패턴이 여기 재발했을 가능성.

**영향**: "다른 관리자가 상태를 바꾸면 자동 새로고침"되는 라이브 갱신 기능이 조용히
동작하지 않을 수 있다. **fail-safe(차단) 방향이라 데이터 유출 등 보안 리스크는 아님** —
기능적 BOUNDARY. 실측 검증(브라우저 콘솔에서 이벤트 실제 도달 여부)은 하지 않음.

---

### [D] B2: 두발히어로(외부 배송사) 실물 API 트리거 4개 엔드포인트가 partner 등급도 허용 — 환불·잠금비밀번호가 manager+로 격상된 것과 대비

```
GET/POST /api/cms/reservations/[id]/dhero/+server.ts
PUT      /api/cms/reservations/[id]/dhero/cancel/+server.ts
POST     /api/cms/reservations/[id]/dhero/return/+server.ts
```

세 엔드포인트 모두 `hasSettingsAccess` 게이트가 없어 partner도 실제 배송사 API(비용 발생)를
호출할 수 있다. 단, 이건 새로 발견된 "게이트 누락"이 아니라 `updateStatus` 액션 자체가
이미 같은 기준(cmsRole 존재만 체크)으로 설계돼 있어 **전역적으로 일관됨** — 다만 환불·
잠금장치 비밀번호만 유독 manager+로 격상된 전례가 있어, 같은 기준을 적용해야 하는지
Stephen 재확인 필요.

---

### [D] B3: `init-contract/+server.ts`가 `contracts` 테이블에 RPC 없이 직접 `.insert()` — H-01 문언과 불일치하나 계약서 서브시스템 전역 관행과는 일치

core-rules.md는 "직접 DML 절대 금지"를 조건 없이 명시하지만, `contracts` 테이블은 저장소
전역에서 처음부터 `+server.ts` 직접 DML로 관리되는 기존 관행이다(계약 content 수정·서명
API 등 동일 패턴). 권한 게이트는 manager+로 정상 보호돼 있어 보안 문제는 아니고, 문서상
표현 차이(H-01이 "직접 DML 절대 금지" vs rental-lifecycle.md는 "**예약 상태** 변경은 RPC
경유"로 더 좁게 서술)만 참고로 보고.

---

### [B] NTF-B1: `auto_send_return_remind()`(매일 09:00 자동 cron) — 채팅카드만 발송, 브라우저 푸시는 구조적으로 미발송(hold_expired와 동일 클래스, 문서 미기재)

```
cron: supabase/migrations/20260815000256_256_auto_return_remind_cron.sql:12-45
     — send_rental_chat_notification만 PERFORM. 순수 SQL pg_cron 함수라 앱코드의
     sendReservationLifecyclePush를 호출할 경로 자체가 없음(§15가 hold_expired에 대해
     이미 명시한 것과 동일한 구조적 제약).
push.ts 'return_remind' 문구는 등록돼 있으나 실제로는 수동버튼 경로(cms/rentals
     sendChatNotify)에서만 호출됨.
vercel.json crons에도 return-remind 관련 경로 없음 — locker_guide처럼 앱코드 경유로
     우회할 구조도 아직 없음.
```

**영향**: 관리자 수동 "반납 예정 알림 💬" 버튼은 채팅+푸시 모두 나가지만, 매일 자동으로
나가는 return_remind는 채팅카드만 가고 푸시는 조용히 누락된다. §15는 3종(reservation_
cancelled·damage_claimed·hold_expired)만 이 결함으로 명시돼 있고 return_remind는
언급이 없다 — 실제로는 동일 갭이 이미 존재하는데 문서화가 안 돼 있었다.

---

### [A] RLA-B1: 상태전이 규칙이 문서가 언급하지 않는 세 번째 위치(SQL RPC)에도 이중 구현돼 있음 — 향후 rentalTransition.ts만 수정하면 서버가 조용히 거부할 위험

```
문서: rental-lifecycle.md "전이 규칙을 바꿀 땐 이 파일 하나만 수정하면 양쪽에 반영됨"
     (rentalTransition.ts ↔ RentalDetailPanel.svelte + QR 스캔 화면 2곳만 언급)
실제 3번째 사본: Migration 187(update_reservation_status_validation.sql:62-71) — 서버측
     재검증용 CASE문이 SQL로 별도 구현됨(의도적 설계, 주석에도 명시)
현재 상태: 두 구현의 값은 지금 시점 완전히 일치 — 당장 버그는 아님
```

**영향**: 실사용 영향 없음(정합). 다만 향후 전이 정책을 바꿀 때 이 SQL 사본을 놓칠 위험이
실재하며, 문서에 이 사실이 반영돼 있지 않아 놓치기 쉽다.

---

### [A] RLA-B2: RentalDetailPanel의 QR 자동확인 하이브리드 경로(QR_AUTO_STATUSES)가 rental-lifecycle.md·products.md §2-7 어디에도 문서화되지 않음

```
코드: RentalDetailPanel.svelte:100-137 — QR_AUTO_STATUSES=Set(['confirmed','return_requested'])
     일 때 확인 탭 없이 즉시 상태전이(공유 유틸 재사용, fail-soft 알림 등 기존 패턴은 준수)
```

**영향**: 기능 자체는 정상 동작하는 것으로 보이나, 어느 정본 문서에도 반영되지 않아 향후
이 조건을 변경·제거할 때 의도를 오인할 위험.

---

### [C] REFUND-SCOPE-UX: "환불 처리" 버튼의 확인창·완료 토스트가 "같은 주문의 다른 상품도 함께 취소됨"을 고지하지 않음

```
RPC: Migration 379 cancel_reservation_payment — order_items로 묶인 주문 전체 예약을
    순회하며 전부 cancelled 전환(주문 전체 전액환불이 Stephen 확정 설계, 버그 아님)
UI : RentalDetailPanel.svelte:151 confirm 문구 — "이 예약(상품)"만 취소된다고 오인하기
    쉬움. 완료 토스트도 cancelledIds(응답에 포함됨)를 화면에 노출하지 않음.
```

**영향**: 관리자가 하나의 상품만 환불할 의도로 눌렀다가 같은 주문의 다른 상품까지
의도치 않게 취소시킬 수 있다. 설계 자체는 변경 불필요 — 고지 문구 보완만 필요.

---

## 🟢 ROUTINE / 참고

### [A] RLA-R1: 마이그레이션 파일명 번호 충돌(154) — 기능 충돌 없음, 명명 위생 문제만(조치 불필요)
### [A] RLA-R2: RentalContractViewer.svelte도 isRentalView를 자체 소비 — 원 취지와 일치, contract.md 영역이라 이 문서 범위 밖(문제 아님)
### [D] R1: `tracking/+server.ts` PATCH가 partner도 허용 — 이미 코드 주석으로 의도가 명시된 기존 결정(변경 필요 여부는 Stephen 판단)

---

## 정합 확인 요약 (4개 감사 전체 커버리지 — 상세는 각 하위 리포트 참고)

| 감사군 | 정합 확인 지점 수 | 대표 항목 |
|---|---|---|
| A. 상태전이 로직 | 15개 | nextStatus/nextLabel 전환표, isRentalView 분기, RENTAL_STATUSES 필터, 스텝퍼 6단계, AUTO_NOTIFY/NOTIFY_TYPE_MAP 매핑값 자체 |
| B. 알림 매핑 | 12개 | AUTO_NOTIFY 6종 채팅+푸시 동기발송, §11 인라인 세션조회 0건, locker_guide 3채널 정상, dhero fail-soft 격리 |
| C. 승인게이팅·HOLD만료 | 15개 | try_confirm_reservation AND조건, HOLD 30분 임계값·cron 활성, get_rental_list 3중 dedup, 주문연결 단일지점, §4 알림트리거 통일 |
| D. 권한·RPC원칙 | 20개 엔드포인트 | getCmsRoleForAction 헬퍼 전수 사용(구버그 패턴 0건), 직접 DML 우회 0건, security-auth.md 매트릭스와 role체크 수준 전부 합치 |

---

## 권장 조치 우선순위 (종합)

```
1순위(§9 정책 준수 확인) : NTF-C1 — /payment/success 도달 가능성부터 확인(구코드인지
                          여전히 유효한지). 유효하다면 게이팅 결과를 알림 발신 조건에
                          반영하는 수정 필요.
2순위(알림 동기화 리팩터): NTF-C2·C3 — 5개 발신 지점(approveReservation·pay-mock·
                          pay-result·sign·payment/success)의 "채팅 성공 시에만 동일
                          조건으로 푸시도 발송"하는 공용 헬퍼 통합 검토.
3순위(설계의도 확인)     : RLA-C1 — log_rental_action RPC·rental_action_logs 테이블을
                          폐기할지 QR 자동화 경로에 재연결할지 확정.
4순위(정책 확정)         : HOLD-D2-GAP — 계약발송 후 미서명 방치 hold의 정리 정책을
                          명시적으로 확정(자동 재도입 vs D-2 별도 크론 vs 관리자 수동관리).
5순위(운영 점검)         : B1 — /cms/rentals Realtime 라이브갱신이 실제로 동작하는지
                          브라우저에서 직접 확인, is_admin()→is_cms_user() 전환 필요 여부 판단.
6순위(문서 보완)         : RLA-B1·B2, NTF-B1 — 정본 문서에 누락된 세부 사실 반영.
7순위(UX 보완)           : REFUND-SCOPE-UX, B2 — 코드/문구 변경, 별도 아젠다로 진행 권장.
참고만                   : RLA-R1·R2, D-R1 — 조치 불필요.
```

---

## 검증 방법론 메모 (다음 세션 재사용용)

이번에도 직전 세션과 동일하게 general-purpose 에이전트 4개를 **기능군별**(상태전이/알림/
게이팅·목록/권한)로 나눠 병렬 실행했다. 직전 세션(화면 섹션별 분할)과 달리 이번엔 "하나의
화면을 종적으로 관통하는 로직"을 감사 대상으로 삼았는데, 그 결과 각 에이전트가 원래
지정된 파일 범위를 넘어 실제 발신/소비 지점을 추적하는 경우가 많았다(예: NTF 에이전트는
`confirmed→reservation_approval` 알림의 실제 발신 지점 5곳을 CMS 밖 체크아웃/계약서명
API까지 확장해서 찾아냄). **"화면"이 아니라 "로직 흐름" 단위로 감사할 때는 에이전트에게
파일 목록을 고정해서 주기보다 "이 로직의 실제 호출 지점을 grep으로 끝까지 추적하라"는
지시를 명시적으로 포함하는 것이 검진 누락을 줄이는 데 더 효과적이었다.**

---

*rental_management_global_logic_audit_2026-08-31.md | 감사 대상: `/cms/reservation`·
`/cms/rentals` 전역(상태전이·알림·승인게이팅·권한 4개 기능군) | read-only 정적 코드 감사
(4개 병렬 에이전트) | 코드 수정 없음 — 발견사항 전부 Stephen 확인·판단 대기*
