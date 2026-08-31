# PG 결제 연동 세션 종합 수정 리포트 (2026-08-31)

> ⚠️ **상태 업데이트(2026-09-01)**: 참고용 체인지로그 문서 — CMS 전역 정밀 검증 v5의
> `cms_global_verification_v5_synthesis_2026-08-31.md`가 이후 상태의 정본이다. 이 문서는 원본
> 그대로 보존한다.

> 이 문서는 "이 세션에서 무엇을 왜 어떻게 고쳤는가"에 집중한 실행 요약이다. 발견된 버그
> 목록 자체(4-agent 감사 원본)는 `.claude/harness/learnings/pg_screens_global_audit_2026-08-31.md`
> 를 참조 — 이 문서는 그 뒤 진행된 재구조화 작업까지 포함해 세션 전체를 정리한다.

---

## 1. 세션 개요

시작 요청: "[cms 9 PG API] 전역 기능 로직" 정밀 검증 실행(첨부 플랜 리뷰 기반).

검증 중 발견된 1차 문제 3건(F1 결제상태 표시 오류·F2 죽은 결제 코드·F3 웹훅 대사 편도
판정)을 Stephen이 승인해 수정했다. 이후 F1을 다시 들여다보라는 지시와 함께 Stephen이
근본 원칙을 명확히 했다:

> "예약단위가 장바구니 '개별 상품' 단위를 가르키는 것이라면 명칭적 착오임, '예약'단위는
> 상품이 몇개가 담기든 최종 '예약신청' 실행으로 '예약코드품번'이 발행 등록된 상태를
> 명칭해야 함! '예약' 단위와 '주문'단위는 동일어임, 형제 예약단위는 현재는 없어야 함,
> 그래서 '예약' 단위 건에 대한 전자계약이 생성되야 함."

이 원칙에 따라 배송비 합산(§2 Migration 395)과 계약을 주문 단위로 재사용하는 수정을
진행했는데, 그 결과 4개 화면/RPC에서 "형제 예약"(같은 주문의 다른 상품)을 인식하지 못하는
연쇄 회귀가 발견되어 함께 수정했다(§2 항목 a~d). 이 수정 과정에서 스스로 작성한 TDD가
결제-서명 게이팅의 위험한 부작용(§2 a)을 잡아냈다.

이후 "현재 대여관리·계정화면 전역"에 대한 종합 감사·리포트 요청으로 스코프가 한 번 더
확장되어 4-agent 병렬 감사를 실행(`pg_screens_global_audit_2026-08-31.md`), 그 결과를
바탕으로 Stephen이 마지막으로 지시한 것이 이 문서의 최종 항목이다:

> "형제 예약이라는 개념이 아닌 장바구니에 몇개의 상품을 담아도 하나의 예약(주문)건으로
> 예약품번코드가 발행되어 하나의 전자계약 + 결제건으로 정리 통일 되어 수정되었는지 확인해."

즉 "형제 예약을 인식하게 만드는" 미봉책이 아니라, `reservation_code` 자체를 주문 단위로
공유하도록 근본 재설계하라는 지시(§2 마지막 항목, Migration 400).

---

## 2. 적용된 수정 전체 목록

> 마이그레이션 번호순. Stage=`ezyvffjvuwmtuhpxdjrw`, Production=`vnbpmvxruyciuuaermyh`.

| # | 내용 | 파일/마이그레이션 | Stage | Production |
|---|---|---|---|---|
| F1 | `get_rental_list`의 `payment_status`를 `orders.status`(항상 pending 고정)가 아닌 `payment_transactions.status` 기준으로 수정, 형제경유 폴백 포함 | Migration 387 | ✅ | ✅ |
| F3 | 웹훅 대사 — `done`인데 웹훅이 `CANCELED/PARTIAL_CANCELED/ABORTED/EXPIRED`인 역방향 불일치 탐지 추가 | Migration 388 | ✅ | ✅ |
| F2 | 죽은 결제 라우트 4개 파일 삭제(라이브 호출자 0건 확인) — `/payment/success`, `/payment/fail`, `/api/payment/confirm`, `/api/checkout/initiate`(`/payment/success/dev`는 카트 체크아웃이 실사용 중이라 존치) | 코드 삭제 | — | — |
| — | 구독 결제 카드등록 `method: '카드'` → `'CARD'`(Toss v2 SDK enum 요구사항) | `subscribe/[planId]/+page.svelte` | — | — |
| — | 배송비를 `orders.final_amount`(실결제 금액)에 합산 | Migration 395 — `create_reservation_order` 재정의, `orders.delivery_fee` 컬럼 추가 | ✅ | ✅ |
| — | 고아 RPC 3종 삭제(`confirm_payment_and_update_reservation`·`cancel_payment_and_release_hold`·`atomic_reserve_asset`) — `calculate_cart_total`은 타입캐스팅 호출 패턴 때문에 최초 grep에서 누락돼 삭제대상 오판됐다가 재확인으로 존치 확정 | Migration 396 | ✅ | ✅ |
| — | 계약을 "예약(개별 상품)" 단위가 아닌 "주문" 단위로 재사용하도록 `init-contract` 수정 — 같은 주문의 다른 상품에 이미 계약이 있으면 재사용 | `api/cms/reservations/[id]/init-contract/+server.ts` | — | — |
| a | **[연쇄회귀 발견·수정]** 결제확정 게이팅(`try_confirm_reservation`)이 주문 내 형제 예약의 서명 여부를 못 봐서 발생하던 문제 → 주문단위로 확장 | Migration 397 → **398로 재수정** | ✅ | ✅ |
| b | **[연쇄회귀 발견·수정]** `get_rental_list`의 계약/서명 조회가 형제 예약 몫으로 걸린 계약을 못 찾던 문제(예약정보 탭에서 계약 상태 오표시) — 주문단위 LATERAL 조인으로 확장 + delivery_fee 서브쿼리 결정론 보정 | Migration 399 | ✅ | ✅ |
| c | **[연쇄회귀 발견·수정]** 고객 마이페이지(`/account/rental/[id]/contract`)가 형제 예약 몫 계약을 못 찾아 "계약 없음"으로 잘못 표시되던 문제 | `loadRentalContractStatus.ts`(재작성), `account/rental/[id]/contract/+page.server.ts` | — | — |
| d | **[연쇄회귀 발견·수정]** CMS 결제정보 탭(`/cms/reservation`)이 형제 예약 몫 결제 트랜잭션을 못 찾아 결제정보·환불버튼이 빈 상태로 표시되던 문제 | `api/cms/reservations/[id]/payment/+server.ts` — `findOrderPaymentTransaction` 헬퍼 신설(GET/PUT 공용) | — | — |
| — | `reservation_code` 자체를 주문 단위로 공유하도록 재설계(Stephen 최종 확정안) | **Migration 400** — 아래 §5 참고 | ✅ **(방금 적용)** | ❌ **미적용** |

### 2-a. CRITICAL 자체발견·수정 — 결제확정 부작용 분리 (Migration 397→398)

Migration 397 최초 구현은 `try_confirm_reservation_order`가 내부적으로
`mark_reservation_payment_confirmed`(결제 시각을 무조건 `NOW()`로 채우는 부작용 있는 함수)를
루프 호출하도록 짰다. `sign/+server.ts`가 **서명이 일어날 때마다** 이 주문단위 RPC를 호출하기
때문에, 이 상태로는 **결제 없이 서명만 해도 결제확정으로 잘못 전환**될 위험이 있었다.

이 문제는 기존에 작성해둔 TDD("EC-1: 서명 완료 후 결제 전 상태로 재접속")가 서명 후에도
상태가 `hold`로 유지돼야 하는데 `confirmed`로 튀는 것을 잡아내면서 세션 내에서 즉시 발견됐다.
Migration 398로 즉시 분리 수정:

- `try_confirm_reservation_order` — 순수 체크 전용(`try_confirm_reservation` 루프, 결제 부작용 없음) → `sign/+server.ts`가 사용
- `mark_reservation_payment_confirmed_order`(신규) — 실제 결제확정 마킹(`mark_reservation_payment_confirmed` 루프) → `pay-mock/+server.ts`가 사용

---

## 3. TDD 커버리지 요약

| 테스트 파일 | 검증 대상 | 상태 |
|---|---|---|
| `payment.test.ts` | 고아 RPC 삭제 후 잔존 스펙(웹훅 라우트·raw_webhook_logs·deposit_holds 등) — 7개로 축소 | ✅ GREEN |
| `tossPaymentGroupRpc.test.ts` | 배송비 합산(Migration 395) 3건 + `get_rental_list` 계약 주문단위 조회(Migration 399) 3건 추가 | ✅ GREEN |
| `paymentContractOrderRedesign.test.ts` | 결제확정 게이팅 주문단위 통일(Migration 397/398) — "G: 형제 예약 결제확정 게이팅" 4건(결제선행/서명선행 대칭성, 부작용 없음 검증 포함) | ✅ GREEN |
| `contractOrderLevelDedup.test.ts`(신규) | `init-contract` 주문단위 계약 재사용 3건 | ✅ GREEN |
| `loadRentalContractStatus.test.ts`(신규) | 형제 예약 계약상태 조회 5건 | ✅ GREEN |
| `accountRentalContractPage.test.ts`(신규) | 고객 마이페이지 형제 계약 열람(실 RLS 세션) 1건 | ✅ GREEN |
| `cmsReservationPaymentSiblingFallback.test.ts`(신규) | CMS 결제정보 탭 형제 결제건 폴백 GET 3건 | ✅ GREEN |
| `contractAuthGates.test.ts` | 기존 목(mock) 스텁에 `.in()` 메서드 누락 발견·보강 | ✅ GREEN |

> **Migration 400(reservation_code 주문단위 통일)은 아직 TDD 미작성** — §6 참고.

---

## 4. 문서 갱신

`.claude/rules-ref/payment.md`를 v4.0으로 전면 재작성 — 실제 TossPayments v2 아키텍처
반영(단건결제 `crazysfc8s`/구독 `bill_crazyhevr` 2개 상점ID 분리, `.widgets()` 임베드 패턴,
웹훅 대사 로직, 환불 흐름, 삭제된 레거시 라우트 명시).

---

## 5. 현재 상태 및 Production 배포 갭 ⚠️

```
Migration 387~399  → Stage 검증 → Production 적용 완료
Migration 400       → Stage(ezyvffjvuwmtuhpxdjrw)만 적용 — Production 미적용
```

Migration 400 내용(reservation_code 주문단위 통일):
- `rental_reservations_reservation_code_key` UNIQUE 제약 제거
- `create_reservation_order`가 예약들을 주문으로 묶을 때, 그 주문에 속한 예약 전체의
  `reservation_code`를 대표값(주문 내 최소 id 예약의 코드)으로 통일(멱등)
- 코드 단건조회 지점(`/api/cms/reservations/resolve/+server.ts`)에 결정론적 정렬
  (`order by id asc limit 1`)을 추가해 여러 행이 같은 코드를 공유해도 항상 같은 행으로 귀결되게 보정

⚠️ **이번 세션에서 수정한 앱 코드 전체가 아직 git commit 전이다** — DB 마이그레이션
(397~400 등)은 이미 Stage/일부 Production에 반영됐지만, 이를 소비하는 엔드포인트 코드
(`sign/+server.ts`, `pay-mock/+server.ts`, `init-contract/+server.ts`,
`loadRentalContractStatus.ts`, `account/rental/[id]/contract/+page.server.ts`,
`api/cms/reservations/[id]/payment/+server.ts`, `resolve/+server.ts` 등)는 커밋되지 않은
로컬 변경 상태다. git 쓰기는 Stephen 직접 실행 원칙(core-rules.md)에 따라 AI가 임의로
커밋하지 않았다 — **Production DB에 이미 적용된 397~399 마이그레이션이 앱코드 배포 전까지는
실제 서비스 동작에 반영되지 않는다**는 점을 인지할 것(service-operations.md §9의 "코드
배포≠DB마이그레이션 적용" 사고 사례와 정확히 반대 방향의 갭 — 이번엔 DB가 앞서고 코드가
뒤처진 상태).

---

## 6. 남은 작업(Pending)

- [ ] Migration 400에 대한 TDD 작성(다건 예약 → 동일 코드 공유 검증, 멱등성 검증,
      `resolve` 엔드포인트 결정론적 정렬 검증) → Stage 회귀 통과 확인 → Production 적용
- [ ] `reservation_code` 유일성을 가정하는 다른 지점이 더 있는지 재점검 — 이번엔
      `resolve/+server.ts`의 `.eq('reservation_code', ...)` 1곳만 확인·수정함, 채팅 알림
      생성·검색·CMS 목록 중복제거 로직 등 추가 스캔 필요
- [ ] 구독 카드등록(`method:'CARD'`) 수정 후 재시도 결과 — Stephen 미보고 상태
- [ ] `process_payment_and_create_order` RPC(Postgres 힌트·frozen 파일 내 죽은 래퍼에서
      발견) 실사용 여부 확인 — 미조사
- [ ] `pg_screens_global_audit_2026-08-31.md` §3의 MEDIUM/LOW 5건(레이블 표기·주문번호
      포맷 불일치·frozen 파일 내 죽은 rpc 래퍼 정리·계약 만료 미검사·HOLD만료 예약 마이페이지
      비노출) — Stephen 결정 대기, 착수 안 함
- [ ] **git commit — Stephen 직접 실행 필요** (§5 배포 갭 참고, 최우선 권장)

---

*작성: 2026-08-31 | 관련 문서: `pg_screens_global_audit_2026-08-31.md`(4-agent 감사 원본),
`payment.md` v4.0, `service-operations.md` §4(주문 연결)·§9(결제확정 게이팅)*
