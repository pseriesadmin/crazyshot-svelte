# /account(대여관리)·전자계약·PG결제 연동 종합 검수 리포트 — 2026-08-31

> ⚠️ **상태 업데이트(2026-09-01)**: 이 문서와 겹치는 CRITICAL 항목(계약 서명가드 등)은 CMS
> 전역 정밀 검증 v5에서 CMS 관리자측 재검증이 이뤄졌다 — 최신 판정은
> `cms_global_verification_v5_synthesis_2026-08-31.md`(A절, RSV-C-*) 참고. 이 문서의 고객화면
> (/account) 대상 발견사항은 별도 재검증 대상이 아니었다. 이 문서는 원본 그대로 보존한다.

Stephen 요청: "현재 세션의 수정항목은 물론 PG 결제 연동되는 사용자 정보(/account) 화면 내
레이아웃 정보를 중심으로 대여관리(/cms/reservation, /account/rental/2654/contract 등)
화면 전역의 기능 로직과 연동성을 파악 후 코드파일들을 완벽하게 리뷰하고 잠재적 오류와
버그, 미작동 고아 코드 로직을 테스트하고 검수 후 종합 리포트 작성."

**검수 방법**: ① 이번 세션이 직접 수정한 6개 파일 재검토(§1) ② `/account/rental/2654/contract`
등 실제 URL을 Claude Browser로 라이브 렌더링해 데이터까지 실측(§2 — 가장 중요한 발견)
③ Stage DB(ezyvffjvuwmtuhpxdjrw) 직접 쿼리로 데이터 정합성 검증(§2, §3) ④ 이미 오늘
같은 날 다른 병렬 세션이 완료한 두 건의 대형 정적 코드 감사(`rental_management_global_
logic_audit_2026-08-31.md`, `toss_payments_pg_integration_2026-08-30.md`)를 중복 재수행하지
않고 인용·요약(§4) — 그 감사들은 "read-only 정적 코드 대조"만 했고 **실브라우저 라이브
렌더링 검증은 하지 않았다**는 방법론적 공백이 있어, 이번 세션은 그 공백(라이브 검증)에
집중했다.

---

## 종합 요약

```
🔴 CRITICAL(신규 발견, 즉시 확인 필요) : 1건 — CS2654 계약서 변수 미치환(실고객 노출 중)
✅ BOUNDARY(신규 발견 → 이 리포트 작성 중 타 세션이 즉시 수정) : 형제예약 계약접근 사각지대
   — loadRentalContractStatus.ts에 order_items 경유 형제예약 확장 로직 추가로 해소,
   신규 TDD 5/5 GREEN 직접 재확인(§1-수정 참고)
✅ 이번 세션 6개 파일 자체            : GATE E 통과 재확인(§sp3-qa-agent, 신규 결함 0건)
✅ 오늘 이미 완료된 타 세션 감사 2건   : CRITICAL 5건·BOUNDARY 7건 별도 존재 — §4에 인용
✅ 고아 RPC 3종 삭제 재확인            : confirm_payment_and_update_reservation·
                                        cancel_payment_and_release_hold·atomic_reserve_asset
                                        Stage DB 직접 재조회로 0건(실제 삭제) 확인
```

---

## 🔴 CRITICAL — CS2654 전자계약서 본문 변수 미치환 (실고객에게 노출 중)

**발견 경위**: Stephen이 지정한 URL `/account/rental/2654/contract`을 Claude Browser로 실제
로그인 세션에서 라이브 렌더링해 확인.

**증상**: 계약서 헤더(예약코드·상품명·대여기간·예약자)는 정상 표시되나, **스프레드시트
본문 안의 변수 전부가 치환되지 않고 `{{...}}` 원문 그대로 노출**된다 — 고객이름
`{{고객이름}}`, 주소 `{{주소}}`, 이메일 `{{이메일}}`, 상품명 `{{상품명}}{{상품명}}`,
수량 `{{수량}}`, 수령형태 `{{수령형태}}`, 수령일시 `{{수령일시}}`, 최종합계
`{{최종합계}}` 전부. 본문 중 대여·반납 일시 표기(`2026.07.21 ~ 2026.07.22`)도 실제
예약기간(2026-08-30~08-31)과 다른 값 — 템플릿 샘플 데이터가 그대로 남아있는 것으로 보임.

**DB 실측 근거**(Stage DB 직접 쿼리):
```sql
SELECT authoring_mode,
  (spreadsheet_document::text LIKE '%{{%') as live_has_placeholder,
  signed_content_snapshot IS NOT NULL as has_snapshot
FROM contracts c JOIN contract_signings cs ON cs.contract_id=c.id
WHERE c.reservation_id = 2654;
→ {"authoring_mode":"spreadsheet","live_has_placeholder":true,"has_snapshot":false}
```
`contracts.spreadsheet_document`(라이브 저장 원본) 자체에 `{{`가 문자 그대로 남아있다 —
뷰어 화면의 렌더링 버그가 아니라 **발송 시점에 변수 치환 자체가 실행되지 않은 채로
DB에 저장됐다**. `signed_content_snapshot`(2026-08-21 도입된 "서명 시점 스냅샷" 기능)이
없는 이유는 이 계약이 스냅샷 기능 도입 전날(2026-08-20)에 서명 완료됐기 때문 — 이 자체는
정상(스냅샷 없는 구서명 건은 라이브 컬럼 폴백, contract.md 기존 설계 그대로).

**격리 여부 확인** — 같은 문제가 다른 계약에도 있는지 확인:
```sql
SELECT authoring_mode, (spreadsheet_document::text LIKE '%{{%') as ph, signed, reservation_id
FROM contracts LEFT JOIN contract_signings ... WHERE spreadsheet_document IS NOT NULL LIMIT 20;
→ reservation_id=2655(3건, 재발송 이력) 전부 정상 치환(false)
→ reservation_id=2150(미서명) 정상 치환(false)
→ reservation_id=2654만 유일하게 미치환(true)
```
**현재 확인 가능한 스프레드시트 모드 계약 5건 중 2654 단 1건만 문제** — 전면적인 현재
활성 버그라기보다 **특정 발송 시점(2026-08-20)의 개별 결함이 그 계약 데이터에 영구
고착된 것**으로 보인다(계약.md 원칙상 발송 시점 치환 완료본이 저장되고 이후 재치환 없이
그대로 렌더링되므로, 최초 저장이 잘못되면 영구히 그 상태로 남음 — "재발송"하지 않는 한
스스로 고쳐지지 않음). 다만:
- **근본원인(왜 이 1건만 치환이 빠졌는지)은 이번 세션에서 특정하지 못했다** — 스프레드시트
  모드 변수치환 유틸(`contract-substitution.ts`)이 특정 조건(예: "existing 모드로 재발송"
  경로, 또는 이 계약이 최초 발행됐던 시점의 구버전 로직)에서 실패할 수 있는지는 별도 코드
  추적이 필요하며, 재현 불가능한 과거 1회성 이벤트일 수도 있다.
- **지금 이 순간도 실고객(reservation_id=2654 소유자)이 `/account/rental/2654/contract`에
  접속하면 깨진 계약서를 그대로 보게 된다** — 법적 임대차계약서 문서에 본인 이름·주소·
  최종 결제금액이 아니라 플레이스홀더 문자열이 노출되는 상태.

**권고(미실행 — 결제/계약 CRITICAL 도메인, Stephen 확인 후 진행)**:
1. 즉시: reservation_id=2654의 `contracts.spreadsheet_document`를 실제 데이터로
   재치환(백필)해 이 특정 고객의 열람 화면을 정상화.
2. 후속: 다른 과거 계약 중 동일 패턴(미치환 `{{`)이 남아있는 건이 더 있는지 전수 스캔
   (이번 검수는 최근 20건만 표본 확인 — `spreadsheet_document::text LIKE '%{{%' `
   조건으로 `contracts` 테이블 전체 스캔 권장).
3. 근본원인 확인: 스프레드시트 모드 발송 흐름(`ContractTemplatePreviewModal.svelte`
   `existing`/`template` 모드 분기, `contract-substitution.ts`)이 이 케이스를 재현할 수
   있는 경로가 여전히 남아있는지 코드 추적.

---

## ✅ BOUNDARY(발견 즉시 해소됨) — 형제예약(같은 주문, 다른 상품) 계약 접근 사각지대

**상태 갱신**: 아래 발견 내용을 이 리포트에 기록하는 도중, **다른 병렬 세션이
`loadRentalContractStatus.ts`를 직접 수정해 즉시 해소했다**(이 세션이 손댄 것 아님 —
파일 diff를 이 세션이 직접 재검토·검증만 수행). 수정 내용: 입력 예약들의 `order_id`를
조회 → 같은 주문에 묶인 형제 예약 전체를 역으로 조회 → 계약 조회 대상을
"입력 예약 ∪ 형제 예약 전체"로 확장. 신규 테스트
`src/__tests__/services/loadRentalContractStatus.test.ts`(5케이스) 이 세션이 직접
`npx vitest run`으로 재실행해 **5/5 GREEN 확인**. 아래는 발견 당시 원문(경위 기록용 보존).

**배경**: 오늘 다른 병렬 세션(`toss_payments_pg_integration_2026-08-30.md` §6 "공백 B")이
Stephen 지적에 따라 `init-contract`에 "1주문=계약서 정확히 1건" 정책을 신설했다(같은 주문의
형제 예약(상품) 중 하나에서 이미 계약이 발행돼 있으면 새로 만들지 않고 재사용). 이 정책
자체는 Stephen이 명시적으로 확정한 올바른 설계다.

**이번 세션이 발견한 부수 영향**: `contracts.reservation_id`는 여전히 단일 값 컬럼이라,
계약은 주문에 묶인 여러 예약(reservation) 중 **대표 1건에만** 연결된다. 그런데 이 대표
reservation_id를 직접 조회하는 지점이 **고객 화면과 CMS 화면 양쪽에 동일하게** 존재한다:

```
고객측: src/lib/server/account/loadRentalContractStatus.ts(이번 세션 신규)
  .from('contracts').select(...).in('reservation_id', reservationIds)
  → 형제 reservation_id는 in() 목록에는 있어도 실제 contracts 행이 없어 매칭 안 됨

CMS측 : supabase/migrations/20260828040000_369_get_rental_list_dedupe_contract_signings.sql:149
  LEFT JOIN ... WHERE c2.reservation_id = rr.id  (get_rental_list RPC, contract_id 컬럼 산출부)
  → 동일하게 reservation_id 직접 매칭만 수행, order_items 경유 형제 확장 없음
```

**실증(코드 대조, 실데이터 사례는 아직 없음)**: 같은 주문에 상품 2개 이상 묶인 예약
10건(`order_items` 그룹핑, count>1)을 Stage DB에서 조회했으나, 이 신규 "1주문=계약1건"
로직 자체가 미커밋 상태로 오늘 막 추가된 것이라 아직 이 경로로 생성된 실제 계약 데이터가
없다(표본 10건 전부 `contracts` 미연결) — **현재는 이론적으로 확정된 코드 경로이지 아직
실데이터로 재현된 사례는 아니다.**

**영향(예상)**: 고객이 카메라+렌즈를 한 주문으로 묶어 예약하고 관리자가 계약서를 발송·
서명 완료해도, `contracts.reservation_id`가 가리키지 않는 쪽(예: 렌즈) 예약 카드에는
`/account/rental`에서도 `/cms/reservation`에서도 계약 관련 정보(확인/서명 버튼, 배지)가
전혀 뜨지 않는다 — 대표 상품(카메라) 카드에서만 접근 가능. **완전한 데이터 유실은
아니고(계약 자체는 정상 존재) UI 노출 사각지대**이며, 두 화면(고객·CMS)이 서로 다르게
동작하는 비대칭 버그가 아니라 **시스템 전역에 걸친 동일한 설계 한계**임을 확인했다 —
이번 세션이 새로 만든 결함이 아니라 오늘 신설된 정책과 기존 스키마(단일 FK)가 만나며
생기는 구조적 부작용이다.

**권고**: 우선순위는 낮음(현재 실데이터 없음, 발생 시 "안 보임"이지 "잘못 보임"이 아니라
안전한 방향). 다중상품 주문 발송·서명이 실제로 발생하면 재확인 필요 — 그때 필요하면
`loadRentalContractStatus`와 `get_rental_list` 양쪽에 order_items 경유 형제 확장을
동시에 추가하는 방식으로 해소 가능(두 곳 다 이미 유사한 order_items 조인 패턴을 다른
목적으로 쓰고 있어 구현 자체는 어렵지 않음).

---

## §1. 이번 세션 6개 파일 재검토 (GATE E 재확인)

`@sp3-qa-agent` 독립검수 통과 완료(별도 기록: TASK.md 최신 블록, GSD_LOG.md). 이번 재검토에서
추가로 확인한 것: 위 BOUNDARY 항목 외에는 신규 결함 없음. `loadRentalContractStatus.ts`의
`.in('reservation_id', reservationIds)` — reservationIds가 빈 배열이면 조기 반환(정상),
타입 캐스팅(`String(row.reservation_id)`)도 문제없음(BIGINT→string 일관 처리).

---

## §2. 실브라우저 라이브 검증 (Claude Browser, 실로그인 세션)

| 화면 | 검증 결과 |
|---|---|
| `/account/rental` (모바일) | 정상 — signed/pending 두 케이스 모두 정확히 분기 렌더링(2026-08-31 앞선 턴에서 확인) |
| `/account`→PC 대여 패널 | 정상 — 채팅버튼·계약버튼 신규 이식분 정상 동작, 예약 컨텍스트 채팅 정상 오픈 |
| `/account/rental/2654/contract` | **🔴 렌더링 자체는 성공하나 본문 데이터가 깨짐(위 CRITICAL 참고)** |
| 콘솔/네트워크 | 이번 세션 관련 신규 에러 없음(기존 무관 HMR 노이즈만) |

---

## §3. 고아 코드 재확인 (Stage DB 직접 조회)

```sql
SELECT proname FROM pg_proc WHERE proname IN (
  'confirm_payment_and_update_reservation','cancel_payment_and_release_hold','atomic_reserve_asset'
);
→ [] (0건 — 3종 전부 실제로 DROP 완료 확인)
```
`toss_payments_pg_integration_2026-08-30.md` F2가 "삭제 완료"로 기록한 내용을 독립적으로
재확인 — 문서와 실제 DB 상태 일치.

---

## §4. 이미 완료된 타 세션 감사 인용 (재수행 없이 요약만 — 원본이 정본)

### `rental_management_global_logic_audit_2026-08-31.md` (`/cms/reservation`·`/cms/rentals` 전역)
```
🔴 CRITICAL 5건: NTF-C1(실결제 확정 경로가 §9 게이팅 무시하고 알림 발송, 도달가능성 미확정)·
  NTF-C2(승인알림 푸시 3곳 중복발송)·NTF-C3(고객서명 자동승인 경로 푸시 누락)·
  RLA-C1(log_rental_action 완전 고아)·HOLD-D2-GAP(계약발송 후 미서명 hold 정리 크론 미구현)
🟡 BOUNDARY 7건: Realtime 구독 RLS 오매칭 가능성·dhero 권한격상 불일치·contracts 직접DML
  관행·return_remind 푸시 구조적 누락·상태전이 SQL 이중구현·QR자동확인 문서화 누락·
  환불 UX 고지 부족
```
이번 세션은 이 감사를 재검증하지 않았다 — 원본 리포트가 상세 근거·파일:라인을 이미
포함하므로 그대로 참고할 것. **1순위 권고(NTF-C1 도달가능성 확인)가 아직 미해결 상태.**

### `toss_payments_pg_integration_2026-08-30.md` (PG 결제 전역)
```
F1(orders.status 영구 pending 오표시)         → ✅ 수정 완료(Migration 387)
F2(레거시 결제 라우트 4개+고아 RPC 3종)        → ✅ 삭제 완료(이번 세션 §3에서 재확인)
F3(웹훅 대사 편도 판정)                        → ✅ 확장 완료(Migration 388)
공백A(배송비 누락)                             → ✅ 수정 완료(Migration 395)
공백B(계약 형제예약 중복 생성 가능)             → ✅ 수정 완료 — 단, 이번 세션이 그 부수영향
                                                   1건을 §"BOUNDARY" 위에서 신규 확인
```

---

## 최종 우선순위 권고

```
1순위(즉시, CRITICAL) : CS2654 계약서 변수 미치환 — 해당 고객 데이터 백필 + 동일 패턴
                        전수 스캔(다른 과거 계약 오염 여부 확인)
2순위(이미 알려짐)     : rental_management 감사의 NTF-C1 — /payment/success 도달가능성부터
                        확인(이번 세션 §3에서 관련 4파일 삭제 확인했으나 NTF-C1이 지목한
                        /payment/success 자체가 그 삭제 대상 4파일 중 하나 — 즉 이미
                        해소됐을 가능성이 높음, Stephen 최종 확인만 남음)
완료됨                 : 형제예약 계약 사각지대 — 리포트 작성 중 즉시 수정·재검증 완료(위 참고)
3순위                  : rental_management 감사의 나머지 CRITICAL/BOUNDARY 10건(원본 리포트 참고)
```

---

*account_rental_contract_payment_review_2026-08-31.md | 검수 범위: 이번 세션 6개 파일 +
`/account/rental/2654/contract` 실측 + 고아RPC 재확인 + 타 세션 감사 2건 인용 통합 |
이 세션 자체는 코드 수정 없음(순수 검수) — CRITICAL 1건 신규 발견(Stephen 확인·판단 대기),
BOUNDARY 1건은 검수 중 타 세션이 즉시 수정·이 세션이 재검증 완료*

---

## 🟡 후속 재검토(같은 날, 별도 세션) — CS2654 "CRITICAL" 재분류 + 근본원인·재발가능성 확정

> Stephen 지시: "아마도 테스트를 임시로 해서 발생한 문제 같은데, '스프레드시트(엑셀), 워드'
> 모드 편집기 변수 치환 문제가 발생할 수 있는지 점검" — Stage DB 실측 쿼리 + 코드 추적으로
> 확인 완료.

### ① CS2654는 실고객 데이터가 아니라 내부 QA 테스트 계정 — 심각도 하향

```sql
SELECT rr.id, rr.status, rr.created_at, u.email FROM rental_reservations rr
LEFT JOIN auth.users u ON u.id = rr.user_id WHERE rr.id = 2654;
→ user_id=6c80778c-... / email=mublues@gmail.com / created_at=2026-08-20 06:29:42+00
```
`mublues@gmail.com`은 이 프로젝트 전자계약 기능 개발 내내 반복 사용된 **내부 QA 검증 계정**이다
(TASK.md 2026-07-23 "/checkout 재검증 + 전자계약 보완" 항목에 이미 동일 계정으로 "전자계약
보기 카드 정상 수신 확인" 기록이 있음 — 이번이 처음 쓰인 계정이 아님). 원 리포트의 "지금 이
순간도 실고객이 깨진 계약서를 본다"는 서술은 사실관계상 **"실고객"이 아니라 "내부 QA 계정"**
으로 정정한다 — 접속하면 깨진 화면이 보이는 것 자체는 사실이지만, 실제 유료 고객에게 노출된
사례가 아니다(원 리포트의 표본 스캔에서도 이 1건 외 전부 정상이었다는 점과 정합).

### ② 전수 스캔 — 정말 이 1건뿐인지 재확인(원 리포트는 표본 20건만 확인)

```sql
SELECT count(*) FROM contracts
WHERE (spreadsheet_document::text LIKE '%{{%') OR (content_blocks::text LIKE '%{{%');
→ 1건 (CS2654/reservation_id=2654 그 자체) — contracts 테이블 전체 스캔, 표본이 아님
```
원 리포트가 권고한 "전수 스캔"을 실제로 실행 — **CS2654가 유일한 오염 건**임을 테이블
전체 조회로 확정(다른 과거 계약 오염 없음, 백필 대상은 이 1건뿐).

### ③ 근본원인 — "재현 불가능한 과거 1회성 이벤트"라는 원 리포트의 추정을 코드로 확정

`contract-substitution.ts`(스프레드시트)와 `tiptapRender.ts`(워드/문서형) 양쪽의 치환 함수를
직접 대조했다:

```ts
// contract-substitution.ts — applySubstitution() (스프레드시트 스칼라 치환)
if (typeof value === 'string') return value
return match   // ← value가 string이 아니면(undefined/null) {{키}} 원문을 그대로 반환

// tiptapRender.ts — substituteMergeFieldNode() (워드/문서형 mergeField 치환)
const textValue = typeof scalarValue === 'string' ? scalarValue : null
return { type: 'text', text: textValue != null ? textValue : `{{${varKey}}}` }
// ← 동일하게 string이 아니면 {{키}} 원문으로 폴백
```

**두 모드(스프레드시트/워드) 모두 완전히 동일한 "치환 실패 시 조용히 원문 유지" 정책을
공유한다** — Stephen이 우려한 대로 이 문제는 스프레드시트 전용이 아니라 두 편집기 공통의
설계 패턴이다. 이 자체는 "알 수 없는 변수명(오타 등)을 빈 값으로 지워버리지 않고 그대로
남겨 관리자가 눈치채게 한다"는 의도된 안전장치이기도 하다 — 문제는 **"알려진 정상 변수인데
값이 비정상적으로 비어있는 경우"까지 똑같이 조용히 통과시킨다는 것**이다.

**그런데 현재(2026-08-31 기준) `/api/cms/reservations/[id]/contract-data/+server.ts`를
직접 읽어 전수 확인한 결과, 16개 스칼라 필드 전부가 예외 없이 `?? '-'`(또는 `formatAmount()`
내부의 동일 폴백) 처리되어 있어 **`undefined`/`null`이 반환될 코드 경로가 현재는 존재하지
않는다** — 즉 지금 이 순간의 정상 CMS "계약서 발송" 플로우로는 이 실패가 재현되지 않는다.

이 엔드포인트는 이 계약이 생성된 2026-08-20 이후 **2026-08-28에 Stage 1(반복행 변수치환
기능, 주문 단위 다중 reservation 조회로 전면 재작성)로 완전히 다시 쓰였다**(TASK.md "계약서
스프레드시트 '다중 상품 반복행' 변수치환" Stage 1 참고) — 즉 2026-08-20 당시 존재했던 구버전
엔드포인트 코드는 이미 사라졌고, 그 버전에 `?? '-'` 폴백이 전 필드에 걸쳐 있었는지는 git
히스토리 추적 없이는 확정할 수 없다. 다만 이 날짜(2026-08-20)는 TASK.md 기록상 xlsx 임포트·
스프레드시트 에디터 자체가 "라운드" 단위로 격렬하게 반복 수정되던 절정기(2026-08-15~21,
같은 파일들이 하루에도 여러 차례 재작성됨)와 정확히 겹친다 — **Stephen의 "임시 테스트 중
발생" 가설과 정합적이며, 반증하는 증거는 없다.**

### ④ 결론 — 재발 가능성 평가 (Stephen 요청의 핵심 질문에 대한 답)

```
Q. 스프레드시트/워드 모드 변수 치환 문제가 "발생할 수 있는지"?

A. ① 오늘 당장, 정상적인 CMS 발송 플로우로는 재현되지 않는다 — contract-data 엔드포인트가
     16개 필드 전부 문자열 폴백을 보장해, applySubstitution()/substituteMergeFieldNode()에
     undefined/null이 들어갈 경로가 없다(코드 직접 대조로 확인, 추측 아님).
   ② 하지만 두 편집기(스프레드시트·워드) 모두 "치환 실패 시 침묵 통과"라는 동일한 설계를
     그대로 유지하고 있다 — contract-data 응답 스키마가 앞으로 필드를 추가하면서 새 필드에
     폴백을 빠뜨리거나, 향후 다른 호출부(§ 원 리포트가 지적한 "existing 모드 재발송" 등)가
     이 엔드포인트를 거치지 않고 다른 경로로 subData를 조립하게 되면 동일 클래스의 결함이
     재발할 수 있는 구조적 여지는 여전히 남아있다.
   ③ 특히 "existing 모드"(ContractTemplatePreviewModal.svelte `send()`)는 한번 저장된
     content/spreadsheet_document를 재치환 없이 그대로 재발송한다(의도된 "편집 내용 보존"
     설계) — 즉 **최초 저장 시점에 한 번이라도 이 실패가 발생하면, 그 계약은 "재발송"으로도
     스스로 복구되지 않고 영구 고착된다.** CS2654가 8/20 이후 지금까지 고쳐지지 않고 그대로
     남아있던 이유가 바로 이것이다.
```

**권고(우선순위 재조정)**:
- CS2654 자체의 백필(실데이터 재치환)은 **더 이상 CRITICAL이 아니라 LOW**로 하향 —
  실고객이 아닌 QA 계정이라 실질 피해 없음, 백필은 "테스트 잔재 정리" 수준의 선택사항.
- 대신 **구조적 안전장치 신설을 MEDIUM으로 신규 권고**: `applyContractTemplate()` 저장
  직전(또는 `applySelectedTemplate()` 치환 직후) 결과 문자열/문서에 `{{[^}]+}}` 패턴이
  남아있으면 저장을 막거나 최소한 경고 토스트를 띄우는 검증을 추가하면, 향후 어떤 경로로든
  subData가 불완전해지는 상황에서도 "조용히 깨진 계약서가 발송·영구고착"되는 최악의 결과를
  원천 차단할 수 있다 — 이번 세션은 코드 변경 없이 발견·설계 방향만 기록(범위 외 수정 금지
  원칙, Stephen 확인 후 별도 진행 권장).

*추가 조사: mublues@gmail.com 계정 확인(TASK.md 교차대조) · contracts 테이블 전체 스캔(표본
아님) · contract-substitution.ts + tiptapRender.ts 치환 함수 대조 · contract-data
엔드포인트 전체 읽고 16개 필드 폴백 전수 확인 · Stage 1 재작성 일자(2026-08-28) 확인 — 코드
변경 없음(순수 조사), Stage DB(ezyvffjvuwmtuhpxdjrw) 조회 전용*

---

## ✅ 백필 완료 (2026-08-31, Stephen 지시 — "CS2654 백필해서 정상 표시되게 해줘")

**방법**: `contract-data` 엔드포인트가 오늘 이 예약 기준으로 반환할 실제 값을 SQL로 직접
조회(`rental_reservations`·`products`·`user_profiles`·`orders`·`user_shipping_addresses`
JOIN, contract-data/+server.ts의 필드 매핑과 1:1 동일 로직 수동 재현) → 셀 좌표는 추측이
아니라 `jsonb_array_elements` 순회로 `{{`가 남은 셀 9개를 SQL로 전수 추출(수동 눈대중
파싱 금지) → 각 셀을 `jsonb_set`으로 정확히 그 좌표만 UPDATE(다른 셀·서식·병합·colWidths
전혀 건드리지 않음, `substituteSpreadsheetDocument()`가 `rows`만 치환하고 나머지는
그대로 두는 것과 동일한 범위).

**치환 결과 (9개 셀, contract-data 로직과 동일 값)**:
```
(8,5)  {{고객이름}}                     → 이기성
(9,5)  {{주소}}                         → 경기 성남시 분당구 서판교로 32 323-12
(10,5) {{이메일}}                       → mublues@gmail.com
(17,1) {{상품명}}{{상품명}}             → Sony FX6-12Sony FX6-12
(17,8) {{수량}}                         → 1
(17,9) {{수령형태}}                     → 본점 방문수령
(17,12){{수령일시}}                     → 12:00
(18,1) {{상품명}}                       → Sony FX6-12
(38,3) ...(▣VAT포함){{최종합계}}        → ...(▣VAT포함)50,000원
```

**검증**: UPDATE 직후 이 계약 단독 재조회 + `contracts` 테이블 전체 재스캔(`spreadsheet_
document::text LIKE '%{{%' OR content_blocks::text LIKE '%{{%'`) 둘 다 0건 — 이 세션이
직접 실행해 확인(로그·추정 아님).

**⚠️ 백필 범위 밖으로 남긴 것 (별도 판단 필요, 이번엔 건드리지 않음)**:
1. `(17,1)` 셀이 "Sony FX6-12Sony FX6-12"로 상품명이 중복 표시됨 — 이건 치환 버그가
   아니라 **원본 템플릿 자체에 `{{상품명}}` 변수 칩이 실수로 두 번 삽입돼 있던 저작 오류**다
   (셀 원문이 `{{상품명}}{{상품명}}`). 실제 발송 로직을 그대로 재현한 것이라 "치환은
   정확히" 됐지만 결과가 어색하다 — 셀 내용 자체를 하나만 남기도록 편집하려면 별도 지시
   필요(템플릿 콘텐츠를 임의로 고치는 범위 밖 수정이라 이번엔 손대지 않음).
2. `▣대여 및 반납시간` 섹션의 "2026.07.21~2026.07.22 / 12:00(PM)~00:00(AM)"은 애초에
   `{{}}` 변수가 아니라 **템플릿에 리터럴로 타이핑된 샘플 날짜**라(§③에서 이미 확인)
   이번 변수치환 백필로는 손댈 수 없다 — 실제 예약기간(2026-08-30~08-31)으로 바꾸려면
   그 두 셀도 별도로 직접 텍스트 수정해야 한다(변수 백필과 무관한 별개 조치, 지시 없어
   보류).

두 항목 모두 진행을 원하시면 별도로 말씀해 주세요 — 이번 백필은 원 리포트가 지적한 CRITICAL
항목(변수 미치환) 자체만 정확히, 최소 범위로 해소했습니다.

---

## ✅ 잔여 2건 처리 완료 (2026-08-31, Stephen 지시 — "두 개 다 처리해줘")

**① 상품명 중복 표시 정리**: `(17,1)` "Sony FX6-12Sony FX6-12" → "Sony FX6-12" (템플릿
저작 오류로 중복 삽입됐던 변수 칩 중 하나의 치환 결과를 제거, 셀 자체를 단일 값으로 정리).

**② 대여·반납 일시 리터럴 값을 실제 예약기간으로 교정**: `rental_reservations.start_date/
end_date/pickup_time/return_time`(2026-08-30 / 2026-08-31 / 12:00 / 13:00) 기준으로 교정.
```
(13,0) 대여일  "2026.07.21" → "2026.08.30"
(13,7) 반납일  "2026.07.22" → "2026.08.31"
(14,0) 대여시각 "12:00 (PM)" → "12:00 (PM)"(24h 12:00=정오, 우연히 기존 표기와 동일값)
(14,7) 반납시각 "00:00 (AM)" → "01:00 (PM)"(24h 13:00=오후1시, 기존 템플릿의 HH:MM (AM/PM)
                                            2자리 표기 관례를 그대로 따름)
```
검증: UPDATE 직후 5개 셀 전부 재조회해 의도한 값과 정확히 일치함을 확인.

**의도적으로 손대지 않은 것**: 같은 행(13열 인덱스14)의 "12Hours\n(Day-half)"(대여기간 유형
요약 텍스트)는 이번 지시(상품명 중복·일시 리터럴 2건)에 명시적으로 포함되지 않았고, 정확한
교정값을 알려면 이 예약의 실제 요금 유형(12h/24h/월간)을 추가로 확인해야 해 범위를 임의로
넓히지 않고 그대로 두었다 — 필요시 별도 지시 요망.

이로써 CS2654(reservation_id=2654) 스프레드시트 계약서는 변수 치환·상품명 중복·날짜/시각
리터럴 3가지 문제 전부 해소되어 `/account/rental/2654/contract`에서 정상 표시된다.

---

## ✅ 요금 유형 라벨("12Hours(Day-half)") 교정 완료 (2026-08-31, Stephen 지시)

**확인**: `rental_reservations.duration_type = '24h'`(2654 실측값). 이 셀도 `{{}}` 변수가
아니라 리터럴 텍스트임을 재확인 — 같은 템플릿으로 만들어진 다른 계약(2655, duration_type
무관)도 정확히 동일한 "12Hours\r\n(Day-half)" 문구를 갖고 있어(전수 대조), 애초에 계약별로
달라지도록 설계된 필드가 아니라 템플릿 작성 시점의 고정 텍스트임을 확인했다. 코드베이스
전체를 검색해도 "Day-half"/"Day-full" 같은 라벨을 정의한 상수·매핑은 없다 — 이 문구는
템플릿 저작자가 직접 타이핑한 자유 텍스트다.

**교정**: 템플릿이 이미 확립한 "N Hours\r\n(Day-X)" 표기 관례를 그대로 따라 12h=half →
24h=full로 대응시켜 `(13,14)` 셀을 `"12Hours\r\n(Day-half)"` → `"24Hours\r\n(Day-full)"`로
수정(개행문자 포함 서식 그대로 유지). 이 라벨 자체가 코드에서 자동 산출되는 값이 아니라
이번 대응은 "그 계약의 실제 요금유형에 맞춰 같은 표기 스타일로 손으로 정정"한 것 — 향후
동일 템플릿으로 발행되는 다른 계약에도 구조적으로 자동 반영되는 수정은 아님(그 계약들은
각자 손대지 않는 한 여전히 "12Hours(Day-half)" 고정 텍스트를 그대로 가짐 — 애초에 이 필드가
변수화돼 있지 않다는 구조적 한계는 남아있음, 별도 개선 대상으로 남겨둠).

이것으로 CS2654 계약서에서 발견된 문제(변수 미치환·상품명 중복·날짜/시각 리터럴·요금유형
라벨) 전부 해소 완료.

---

## ✅ 템플릿 자체를 요금유형 변수 사용으로 전환 완료 (2026-08-31, Stephen 지시 —
## "템플릿도 요금유형 변수 쓰도록 바꿔줘")

**대상 전수 확인**: `contract_templates`(활성·미삭제) 중 "12Hours"/"Day-half" 리터럴 텍스트를
가진 템플릿을 스프레드시트·문서형(flow)·캔버스 3개 authoring_mode 전부 대상으로 스캔.

```
스프레드시트 3건: "계약서 스프레드시트"·"[수정] 엑셀 테스트"·"[수정2] 엑셀 계약 문서양식"
  → 전부 동일 좌표 (sheets,0,rows,13,14) — 같은 원본에서 복제된 템플릿이라 좌표까지 동일
문서형(flow) 1건: "엑셀 계약 양식"
  → content_blocks[0].doc 안의 TipTap 노드 트리 깊숙이 위치, 좌표 기반이 아니라
    재귀 CTE로 정확한 JSON 경로를 먼저 특정(jsonb_path_query의 `$.**.text` 방식은 동일
    텍스트가 2건으로 중복 집계되는 아티팩트가 있어 신뢰하지 않고, 고유 경로만 도는 재귀
    walk 쿼리로 재검증 — 실제로는 1곳뿐이었음)
캔버스: 대상 0건(캔버스 템플릿 자체에 이 리터럴 텍스트 없음)
```

**교정**: 4개 템플릿 전부 `"12Hours\r\n(Day-half)"` → `"{{요금유형}}"`로 치환(스프레드시트는
`jsonb_set` 좌표 지정, flow는 재귀 CTE로 찾은 정확한 경로로 `jsonb_set`). 매 UPDATE 직후
재조회로 검증 + 마지막에 `contract_templates` 테이블 전체를 3개 컬럼(spreadsheet_document·
content_blocks·canvas_document) 전부 대상으로 "12Hours" 재스캔 — 0건 확인.

**효과**: 이제 이 4개 템플릿으로 신규 발행되는 모든 계약서는 실제 예약의 `duration_type`에
맞는 요금유형 라벨(12시간/24시간(1일)/1일/월간)이 자동으로 채워진다 — 이번에 고친 CS2654처럼
발행 때마다 수동 백필이 필요했던 구조적 원인 자체가 해소됨.

Stage DB(ezyvffjvuwmtuhpxdjrw) 템플릿 데이터 수정 완료. Production 템플릿은 별개 데이터라
미적용(필요 시 Stephen 확인 후 동일 절차로 별도 적용).
