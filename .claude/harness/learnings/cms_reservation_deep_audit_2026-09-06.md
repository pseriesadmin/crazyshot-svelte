# CMS 예약 관리(`/cms/reservation`) 심층 재검증 — 2026-09-06 (트랙 A1)

> read-only 정적 코드감사 + Supabase MCP(Stage `ezyvffjvuwmtuhpxdjrw`/Production
> `vnbpmvxruyciuuaermyh`) 실측 조회. 코드/DB 수정 없음.

## 요약

CS2654 전자계약 변수 미치환은 **Production에 최소 6건**(전부 `authoring_mode='spreadsheet'`,
그중 3건은 이미 고객이 열람+서명 완료)으로 확인됐고, 근본 원인은 단일 계약서 양식
("2026임대차계약서양식", 여전히 수정 안 됨)에 손으로 입력한 변수명이 실제 지원 키와
어긋난 것 — 치환엔진 자체는 정상. RSV-C-C2(재발송 모달 편집모드 노출)는 "실피해 없음"이
여전히 사실이나(PATCH·send-chat 둘 다 `signed_at` 서버가드로 차단됨, 코드로 재확인),
그 가드들에 대한 회귀테스트는 지금도 0건. HOLD D-1 타이머(Migration 394)는 Stage·
Production 양쪽 DB에서 함수 정의를 직접 조회해 실제 적용을 재확인했다.

---

## 1. CS2654 전자계약서 변수 미치환 — Production 6건 확인, 근본원인 규명

### 확인 방법
Supabase MCP `execute_sql`로 `contracts.content_blocks/spreadsheet_document/canvas_document`
(html_document는 Production에 컬럼 자체가 없어 제외, 아래 4번 참고)에 `{{` 패턴이
남아있는지 Stage·Production 양쪽에서 직접 SELECT.

### 실제 확인 결과
- **Stage(`ezyvffjvuwmtuhpxdjrw`)**: 0건. 미치환 계약 없음.
- **Production(`vnbpmvxruyciuuaermyh`)**: **6건**, 전부 `authoring_mode='spreadsheet'`.
  - `reservation_id`: 12, 46, 47, 100, 102, 107
  - `contract_signings` 대조 결과: 12/102/107은 이미 `viewed_at`+`signed_at` 존재(고객이
    실제로 미치환 원문을 보고 서명까지 완료), 100은 발송됐으나 아직 미열람, 46/47은
    `contract_signings` 행 자체가 없어(발송 전) 아직 고객 노출 없음.
  - 6건 전부 **동일한 `contract_templates` 레코드**("2026임대차계약서양식",
    id `7e635b02-ab80-4125-99a4-3784c8911d0e`, 생성 2026-08-19, 최종수정 2026-09-03)를
    적용해 만들어진 것으로 확인 — `contract_templates.spreadsheet_document`를 직접 조회한
    결과 지금 이 순간도 동일한 깨진 변수명이 그대로 남아있다(**아직 수정되지 않은 활성
    템플릿** — 지금 이 템플릿으로 새 계약을 발행하면 7번째 사고가 그대로 재현된다).

### 근본원인
`substituteSpreadsheetDocument()`(`src/lib/utils/contract-substitution.ts:192-199` →
`applySubstitution()`)는 `{{키}}`가 `ContractSubstitutionData`의 실제 키와 일치하지 않으면
**원문을 그대로 두고 조용히 통과**하도록 설계돼 있다(주석에 명시된 의도된 폴백 동작).
문제의 템플릿은 `ContractFieldPanel.svelte`의 공식 변수 칩(`{{수령일시}}`/`{{반납일시}}` 등,
94·96행)을 쓰지 않고 셀에 직접 손으로 타이핑한 변수명을 썼는데, 그 이름들이 실제
`contract-data/+server.ts`(344-357행)가 제공하는 키와 전부 다르다:

| 템플릿이 쓴 이름(미치환) | 실제 지원 키 | 비고 |
|---|---|---|
| `{{수령일}}` | `수령일자` | 이름 자체가 다름 |
| `{{반납일}}` | `반납일자` | 이름 자체가 다름 |
| `{{수령시간}}` | `수령일시` | 이름 자체가 다름 |
| `{{반납시간}}` | `반납일시` | 이름 자체가 다름 |
| `{{구성품내역}}` | `구성품` | 이름 자체가 다름 |
| `{{할인차감금액}}` | `할인차감` | 이름 자체가 다름 |
| `{{총사용시간}}`/`{{이용기간금액}}`/`{{총 정상 대여가}}`/`{{지점옵션}}`/`{{계약서발행일}}`/`{{할인반영금액}}` | (대응 키 없음) | 지원되지 않는 변수명을 임의로 발명해 사용 |
| `{{차감포인트}}` | `차감포인트`(이름은 일치) | 이름이 일치하는데도 미치환 — 원인 미규명(아래 참고) |

`{{차감포인트}}`만은 이름이 정확히 일치하는데도 6건 전부 미치환 상태였다. `contract-data`
쪽 `formatAmount()`는 항상 문자열을 반환하므로 타입 불일치는 아닌 것으로 보이나, 정확한
원인(예: 이 특정 셀 치환 경로에서만 발생하는 별도 결함)은 이번 세션에서 확정하지
못했다 — 다만 위 표의 압도적 다수(11개 중 10개)가 명백한 "변수명 자체가 틀림" 케이스이므로,
그것만으로도 이번 사고의 지배적 원인으로 충분히 설명된다. `{{차감포인트}}` 건은 별도
후속조사 대상으로 남긴다.

더 근본적인 구조적 문제: **파이프라인 어디에도 "발송 직전 콘텐츠에 미치환 `{{}}`가
남아있는지" 검사하는 가드가 없다.** `applySelectedTemplate()`(치환) → PATCH(저장) →
send-chat(발송) 전 구간에 이런 검증이 전혀 없어, 템플릿 작성자가 변수명을 잘못 입력해도
아무 경고 없이 그대로 고객에게 발송된다. 게다가 "existing 모드는 재치환하지 않는다"는
2026-08-13 확정 정책(편집 내용 보존 목적, `contract.md` "발송 모드 불변식") 때문에, 한 번
깨진 상태로 저장된 계약은 이후 몇 번을 "재발송"해도 절대 재치환되지 않는다 — 이 두 설계가
겹쳐 이번 사고가 최소 4차례(12·100·102·107) 반복될 때까지 아무도 눈치채지 못했다.

### 결론 / 등급 제안
🔴 **CRITICAL** — 실고객 PII 노출은 아니지만(오히려 반대로 노출되어야 할 실데이터가
빠짐), 법적 효력이 있는 계약서 내용이 결함 있는 상태로 3명의 실고객에게 이미 서명까지
완료됐고, 원인이 된 템플릿이 아직도 수정되지 않아 **지금 당장 재현 가능**하다.
- 즉시 조치 후보(코드 미수정, Stephen 확인 후 진행 권장): ① 해당 `contract_templates`
  레코드의 깨진 변수명을 공식 키로 수정 ② 발송 전(`send-chat` 또는 `applySelectedTemplate`
  완료 시점) 콘텐츠에 미치환 `{{...}}` 패턴이 남아있으면 경고/차단하는 서버측 가드 신설
  ③ 이미 서명 완료된 3건(12·102·107)은 계약 내용 정정이 사실상 불가하므로(서명완료 후
  PATCH 차단, RSV-C-C3) 고객 안내·재계약 필요 여부를 Stephen이 별도 판단.

---

## 2. RSV-C-C2 — "재발송 모달이 서명완료 후에도 편집모드로 열리는 문제" 재확인

### 확인 방법
`RentalContractViewer.svelte`·`ContractTemplatePreviewModal.svelte`·
`content/+server.ts`·`send-chat/+server.ts` 코드 직접 대조 (2026-08-31 감사 대비 diff 확인).

### 실제 확인 결과
- **UI 자체는 여전히 미수정** — `RentalContractViewer.svelte:310`
  `viewOnly={isRentalView}` — `customerSignedAt`이 조건에 포함돼 있지 않다. 버튼 라벨만
  `customerSignedAt`일 때 "보기"로 바뀔 뿐(226행), 실제로 열리는
  `ContractTemplatePreviewModal`은 `!isRentalView`(즉 `/cms/reservation` 화면)에서는
  여전히 `viewOnly=false`로 열려 좌측 템플릿 목록·"편집"·"채팅으로 발송" 버튼이 전부
  살아있다.
- **그러나 서버단 이중가드는 둘 다 실제로 존재·정상 동작**(2026-08-31 이후 신규 확인 —
  당시엔 "차단 있음"만 언급되고 두 곳 다 코드로 직접 대조되지는 않았음):
  - `content/+server.ts` PATCH — `contract_signings.signed_at` 존재 시 400
    `'서명이 완료된 계약서는 내용을 수정할 수 없습니다.'` (89-97행)로 차단.
  - `send-chat/+server.ts` POST — `existingTyped?.signed_at` 존재 시 400
    `'이미 서명이 완료된 계약서는 재발송할 수 없습니다.'` (66-69행)로 차단.
  - 따라서 관리자가 "보기" 버튼 → 다른 템플릿 클릭 → 덮어쓰기 확인 → "채팅으로 발송"까지
    시도해도, `applySelectedTemplate()`이 호출하는 PATCH에서 400이 반환돼 `send()`가
    catch 블록에서 에러 토스트만 띄우고 끝난다. "existing 모드 그대로 재발송"(PATCH 없이
    바로 send-chat) 경로도 `send-chat` 자체의 `signed_at` 체크로 별도 차단된다.

### 결론
"서버단 재발송 차단은 있어 실피해는 없다"는 서술은 **여전히 사실**로 재확인. UI가 여전히
편집 가능한 모습으로 열리는 것은 순수 UX 결함(관리자가 시도 후 에러를 봐야 알게 됨)이며,
데이터 정합성이나 실고객 피해로 이어지는 경로는 없다.

### 등급 제안
🟡 **BOUNDARY** — 실피해 없음, UX 개선 사항. `viewOnly={isRentalView || !!customerSignedAt}`
로 한 줄 수정하면 근본 해소 가능(별도 확인 후 진행 권장, 이번 세션은 수정하지 않음).

---

## 3. 서명가드(RSV-C-C1/C2/C3, RSV-C-B1) 회귀테스트 부재 — 재확인

### 확인 방법
`src/__tests__/server/contractAuthGates.test.ts` 전체 `describe`/`it` 목록 확인 +
"서명이 완료된 계약서는 내용을 수정할 수 없습니다"/"이미 서명이 완료된 계약서는 재발송할
수 없습니다" 두 에러 문구로 테스트 스위트 전체 grep.

### 실제 확인 결과
- `contractAuthGates.test.ts`의 `[P7-4]`(292-428행)·`[P7-5]`(430-465행) 블록은 **역할
  기반 403**(partner 차단/manager 통과)과 **GET의 서명완료건 열람 허용**(P7-4, 2026-08-20
  로직)만 테스트한다.
- PATCH가 `signed_at` 존재 시 **내용 편집 자체**를 400으로 막는 시나리오(RSV-C-C3),
  send-chat이 `signed_at` 존재 시 **재발송 자체**를 400으로 막는 시나리오(RSV-C-B1)를
  검증하는 테스트는 저장소 전체에 **0건**(두 에러 문구로 전수 grep해도 테스트 파일에서
  히트 없음).

### 결론
2026-09-01 종합문서의 지적("계약 서명가드 신규코드에 대응하는 회귀테스트가 전무함")은
**지금도 그대로 유효** — 갭이 해소되지 않았다.

### 등급 제안
🟡 **BOUNDARY** — 지금 당장 회귀가 발생한 것은 아니나, 이 두 가드가 실수로 제거/완화돼도
잡아낼 안전망이 없는 상태. TDD 케이스 추가 권장(신규 기능이 아니라 기존 동작의 회귀
방지용이라 별도 태스크로 스핀오프하기 적절).

---

## 4. 최근 정책 반영 여부

### 4-a. HOLD D-1 타이머(Migration 394, GREATEST(created_at, sent_at))

Supabase MCP로 `pg_get_functiondef('public.release_reservation_hold')`를 **Stage와
Production 양쪽에서 직접 조회**(문서·이전 세션 서술에 의존하지 않고 독립 재검증):

- Stage(`ezyvffjvuwmtuhpxdjrw`): `GREATEST(rr.created_at, COALESCE((SELECT MAX(cs.sent_at)
  ... WHERE cs.sent_at IS NOT NULL ...), rr.created_at)) < NOW() - INTERVAL '30 minutes'`
  + `rr.payment_confirmed_at IS NULL`(D-3) 조건 그대로 확인.
- Production(`vnbpmvxruyciuuaermyh`): **동일한 함수 정의**(문자 그대로 일치) 확인.

→ `rental-lifecycle.md`/`service-operations.md`의 "Stage·Production 둘 다 적용 완료"
서술이 **정확함을 직접 DB 조회로 재확인**(이전 sp3-qa-agent가 도구 한계로 못했던 부분을
이번에 완료). D-1 타이머는 이제 예약 단위가 아니라 **같은 주문(order_items)으로 묶인
전체 예약 중 어느 하나라도 계약 발송(sent_at)이 있으면 그 시각 기준으로 리셋**되도록
구현돼 있음도 확인(`order_items` self-join으로 order 단위 최댓값을 취함 — 문서에는
명시적으로 "order 단위"라고 적혀있지 않으나 실제 SQL은 그렇게 동작함, 참고 사항으로 기록).

### 4-b. HTML 작성모드 XSS 이스케이프

`substituteHtmlDocument()`(`applyHtmlSubstitution`/`applyHtmlItemSubstitution`,
`contract-substitution.ts:244-278`) 전부 `escapeHtml()`을 거쳐 값을 삽입함을 코드로 확인
— contract.md 서술과 일치. 단, HTML모드는 미치환 변수를 **빈 문자열로 치환**하고(244-252행
주석 "치환 불가 변수 → 빈 문자열(원문 제거)"), spreadsheet/flow 모드는 **원문 `{{}}`를
그대로 남기는** 서로 다른 폴백 정책을 쓴다는 점을 확인 — 두 모드 간 불일치이나 문서에 이미
암시돼 있고 보안·데이터 정합성 문제는 아니므로 정보성으로만 기록.

### 4-c. 3플래그(is_bulk_delivery/is_courier_dependent/is_delivery_type) 독립성 — CMS 예약 화면 범위

`/cms/reservation`·`RentalDetailPanel.svelte`·`/cms/reservation/contracts` 전체에서
`is_delivery_type`/`is_courier_dependent`는 전혀 참조되지 않고, `is_bulk_delivery`만
`RentalDetailPanel.svelte:993-995`에서 **두발히어로(dhero) 배송 자동화 UI 분기 여부**
판정에 단독으로 쓰인다(장바구니의 요금/배송비 판정 로직과는 완전히 별개 용도). CMS 예약
관리 화면 범위 내에서는 이 3플래그가 혼동되거나 재통합된 흔적이 없음을 확인.

---

## 부가 발견 (범위 밖, 기록만 — 수정하지 않음)

1. **Production `contracts` 테이블에 `html_document` 컬럼 자체가 없음**(Migration 447
   미적용) — `information_schema.columns`로 직접 확인. `authoring_mode`가 이미 `'html'`을
   지원하는지 여부는 확인하지 않았으나, 코드(`ContractTemplatePreviewModal.svelte` 등)는
   `html_document`를 무조건 참조하므로 Production에서 관리자가 "HTML형" 모드를 시도하면
   즉시 에러가 날 가능성이 있다. service-operations.md §9의 "코드 배포 ≠ DB 마이그레이션
   적용" 사고 패턴과 동일한 유형 — CRITICAL로 단정하기엔 신규 기능(2026-09-04 도입)이라
   아직 안내/배포 계획 중일 수 있음, Stephen 확인 필요.
2. **`contract.md`의 데이터 모델 표가 언급하는 `contracts.signing_sent_at` 컬럼이 Stage·
   Production 둘 다 실제로 존재하지 않음**(SQL 직접 실행 시 `column does not exist` 에러로
   확인). 실제 발송 시각은 `contract_signings.sent_at`에서 온다 — 문서의 컬럼명이 스테일한
   것으로 보이나 이번 범위(코드 동작)에는 영향 없음, 문서 정정 후보로만 기록.
3. CS2654 조사 중 발견한 `{{차감포인트}}`(이름이 정확히 일치함에도 미치환) 건은 원인을
   확정하지 못했다 — 후속 세션에서 `contract-data`/`contract-substitution.ts`를 대상으로
   좁혀서 재조사 권장.

---

## 자체 오인점검 (misidentifications.md 대조)

- membership_grade 오인: 해당 없음(이번 조사에서 membership/grade 컬럼 다루지 않음).
- enum 비교 시 `database.ts` 대신 실측 확인: `authoring_mode` 값은 `information_schema`가
  아니라 실제 로우의 `authoring_mode` 컬럼값(`'spreadsheet'`)을 직접 SELECT로 확인했음 —
  타입 정의 파일을 근거로 삼지 않음.
- 과거 마이그레이션 기억 인용 금지: HOLD D-1 관련 서술은 마이그레이션 파일을 인용하지
  않고 `pg_get_functiondef`로 **현재 DB의 실제 함수 정의**를 양쪽 프로젝트에서 직접
  조회해 근거로 삼았음 — 기억이나 이전 세션 서술을 그대로 인용하지 않음.
- UNIQUE 제약 성급 단정 금지: 이번 조사에서 UNIQUE 제약을 근거로 쓴 판단 없음(해당 없음).
- 병렬세션 충돌: `.claude/harness/TASK.md` 최상단의 "고객 셀프 예약신청취소" CRITICAL
  진행중 태스크는 이 조사 범위(계약서·서명가드)와 무관함을 확인, 혼동해 다루지 않음.

---

*작성: read-only 정적 코드감사 + Supabase MCP(Stage/Production) 실측 조회 병행,
2026-09-06. 코드·DB 변경 없음.*
