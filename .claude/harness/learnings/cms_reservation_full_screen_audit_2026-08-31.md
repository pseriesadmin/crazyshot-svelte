# CMS 예약관리(`/cms/reservation`) 화면 전역 완전 정밀검수 — 2026-08-31

> ⚠️ **상태 업데이트(2026-09-01)**: 이 문서의 CRITICAL 미해결 항목(RSV-A-C1·RSV-B-*·RSV-C-*)은
> CMS 전역 정밀 검증 v5에서 전수 재검증됐다 — 최신 판정은 `cms_global_verification_v5_synthesis_
> 2026-08-31.md`(A·B절) 참고. 이 문서는 최초 발견 시점 원본 그대로 보존한다(갱신 없음).

감사 범위: `/cms/reservation` 화면 전체(목록·필터·페이지네이션) + 계약서양식 관리(`/cms/reservation/
contracts`) + `RentalDetailPanel.svelte`(2078줄, 4개 탭: 대여정보·고객정보·결제정보·계약서) +
`RentalContractViewer.svelte` + 관련 API 엔드포인트 13종 + 이 모두와 연결된 RPC/마이그레이션.
직전 세션(대여관리 CRITICAL 4건 통합수정, GATE E 통과 완료)의 후속으로, **이번 세션 자체의 수정
내역뿐 아니라 화면 전역의 기존 로직·잠재 버그·고아 코드까지 완전히 훑는 것**이 목적.

감사 방법: read-only 정적 코드 감사, general-purpose 에이전트 4개 병렬(코드 수정 없음) — 각각
"목록·계약서양식 화면" / "고객정보·결제정보 탭" / "계약서 탭 전체(이번 세션 신규 로직 포함)" /
"고아 코드 전수 스윕"을 담당. 전부 "지금 이 순간의 코드"를 grep·직접 읽기로 근거 삼아 판정했으며
추측성 보고를 배제했다.

---

## 종합 요약

```
🔴 CRITICAL(즉시 확인 필요) : 8건 — 그중 2건은 자금(환불) 정합성 직결
🟡 BOUNDARY(운영 리스크)    : 13건
🟢 ROUTINE(참고/정리 후보)  : 다수(각 섹션 하단 참고)
✅ 정합 확인               : 4개 감사 각각의 커버리지 표 참고(원본 서브리포트에 상세 기록)
```

**가장 시급한 것은 결제정보 탭의 두 건(RSV-B-C1·C2)** — 환불 RPC가 내부적으로 실패해도 서버가
그 실패를 확인하지 않아 **"Toss 결제취소는 실제로 나갔는데 DB는 그대로인 상태"가 관리자에게
"환불 완료"로 보고될 수 있다.** 같은 주문의 이미 종료된(완료/파손신고) 형제 예약까지 "취소됨"으로
잘못 집계돼 고객에게 앞뒤 안 맞는 취소 알림이 오발송될 수 있는 결함도 함께 발견됐다.

**두 번째로 시급한 것은 목록 화면의 상세패널 stale-state 버그(RSV-A-C1)** — 이 화면의 핵심
업무(hold 예약 승인/거부)를 수행할 때마다 사실상 매번 재현될 수 있는 구조적 결함으로, 방금
승인 처리한 예약이 여전히 "승인하기/거부" 버튼이 달린 hold 상태로 화면에 남는다.

**세 번째로 계약서 탭의 세 건(RSV-C-C1·C2·C3)** — C1은 **이번 세션에 신규 구현한 "승인 이력"
표시 로직 자체의 버그**(관리자 수동승인 예외 경로를 고려하지 않아 잘못된 시각을 표시할 수 있음),
C2·C3은 사전부터 있던 문제로 이미 서명 완료된 계약서의 내용을 관리자가 실수로 덮어쓸 수 있는
체인이다.

두발히어로(배송사) 연동에도 CRITICAL 2건(RSV-B-C3·C4, 멱등성 부재·취소 후 재접수 불가)이
발견됐다. 고아 코드 스윕(RSV-D)은 심각한 항목 없이 대부분 정리 후보 수준(미사용 props 14개,
2개 화면에서 도달 불가능한 `clearIssuedContract` 액션, 미사용 목록 필드 4개)이었다.

---

## 🔴 CRITICAL

### RSV-B-C1: 환불 RPC 내부 실패(`success:false`)가 서버에서 체크되지 않아 "환불 성공"으로 위장됨

```
파일: src/routes/api/cms/reservations/[id]/payment/+server.ts:109-118
RPC : supabase/migrations/20260830010000_384_payment_transactions_cancel_audit.sql
      (EXCEPTION WHEN OTHERS·PAYMENT_NOT_FOUND 두 실패 경로 모두 예외를 던지지 않고
      {success:false, error, error_code}를 정상 반환값으로 리턴)
```

서버는 `rpcErr`(전송계층 에러)만 체크하고 `result.success`는 한 번도 확인하지 않는다. **Toss
결제취소 API는 RPC 호출 이전에 이미 성공적으로 끝나 고객에게 실제로 환불이 나간 뒤**이므로,
RPC가 내부적으로 실패해도(예: 루프 도중 예외 → savepoint 롤백) 서버는 200 성공 응답을 반환하고
`RentalDetailPanel.svelte:164`는 "환불이 완료되었습니다" 성공 토스트를 띄운다. 실제로는
`payment_transactions.status`도 `rental_reservations.status`도 그대로 남아 **돈은 나갔는데
시스템은 아무것도 모르는 상태**가 되고, 이를 관리자에게 알릴 방법이 코드 어디에도 없다.

**영향**: 자금(환불) 데이터 무결성 직결 — 최우선 확인 필요.

---

### RSV-B-C2: 같은 주문의 이미 종료된 형제 예약이 실제 상태변경 없이 "취소됨"으로 잘못 집계 → 오발송 알림

```
RPC: 20260830010000_384_...sql:87-99 — update_reservation_status 반환값을 PERFORM으로 버림
```

`update_reservation_status`(Migration 187)는 `completed`/`cancelled`/`damage_claimed` 예약의
전환을 명시적으로 거부하지만, RPC가 그 반환값을 버려 실제 전환 성공 여부와 무관하게
`v_cancelled_ids`에 포함된다. 서버(`+server.ts:121-158`)는 이 배열을 순회하며 **전부에
`reservation_cancelled` 알림을 발송** — 이미 반납 완료(`completed`)한 고객이 다른 상품 환불
처리 시 "예약이 취소되었습니다"라는 앞뒤 안 맞는 알림을 받을 수 있고, 그 상품의 실제 DB
상태는 안 바뀌었는데도 주문 전체(§4/§9 "주문 전체 전액환불" 확정설계) Toss 결제는 그 완료
상품 몫까지 포함해 전액 환불된다.

---

### RSV-B-C3: 두발히어로 배송접수(POST)에 멱등성 가드가 없어 중복 접수 위험

```
파일: src/routes/api/cms/reservations/[id]/dhero/+server.ts:123-175
```

POST 핸들러는 `res.trackingNumber`가 이미 있는지 확인하지 않고 바로 `createDelivery()`를
호출한다(GET 핸들러는 이 체크를 하는 것과 대비). 클라이언트 로딩 가드는 단일클릭만 막고,
네트워크 재시도·이중 탭 등 경쟁 상황에서 서버측 방어가 전혀 없어 **비용이 발생하는 배송이
두 번 생성**되고 `tracking_number`가 새 값으로 조용히 덮어써져 첫 배송이 시스템에서 유실된다.

---

### RSV-B-C4: 두발히어로 배송취소 성공 후 DB가 갱신되지 않아 재접수 UI가 영구 고착

```
파일: src/routes/api/cms/reservations/[id]/dhero/cancel/+server.ts:40-42
```

취소 성공 후 `tracking_number`/`dhero_status`를 갱신하는 RPC 호출이 전혀 없다. 화면은
`row.tracking_number` 존재 여부로 분기하므로 취소 후에도 계속 "접수됨" 상태로 보이고,
"배송접수" 버튼은 영원히 노출되지 않아 **관리자가 UI로 재접수할 방법이 없다.** 게다가 같은
엔드포인트를 두 번째로 누르면 "이미 배송이 시작돼 취소할 수 없습니다"라는 사실과 다른 안내가
뜨고, 이 412 응답을 `payment/+server.ts`는 정반대("이미 취소됨, 무시 가능")로 해석하고 있어
두 지점의 412 의미부여가 서로 모순된다.

---

### RSV-A-C1: 상태변경·필터변경·페이지이동 후 상세패널이 갱신되지 않고 "가짜 데이터"를 계속 표시

```
파일: src/routes/cms/reservation/+page.svelte:64-69(동기화 $effect), 71-84(applyFilters),
      86-94(setStatus), 96-100(goPage)
```

`RentalDetailPanel`은 `row` prop만 신뢰하며 자체 재조회를 하지 않는다. 화면의 기본 필터는
`hold`이고 RPC가 `confirmed` 이상 상태를 항상 제외하므로: ① hold 행 선택 → 패널 오픈 ②
"승인하기" 클릭 → 성공(`hold→confirmed`) → `invalidateAll()`만 호출, 패널은 안 닫힘 ③ 방금
`confirmed`로 바뀐 그 예약은 새 목록에서 제외됨 ④ `$effect`가 못 찾으므로 `selectedRow`는
승인 이전(hold) 상태 그대로 유지 ⑤ 오른쪽 패널은 여전히 "승인하기/거부" 버튼과 `hold` 배지를
계속 보여줌. **거부·취소·필터전환·페이지이동에도 동일하게 재현** — 이 화면의 핵심 업무를 수행할
때마다 사실상 매번 트리거되는 경로. `/cms/rentals/+page.svelte`에도 동일 패턴 존재(이번 세션
스코프 밖, 참고 기록).

부수 문제: `applyFilters`는 URL의 `selected` 파라미터를 보존하지 않아(`setStatus`/`goPage`는
보존) 검색·날짜필터 사용 시 URL과 클라이언트 상태가 추가로 어긋난다.

---

### RSV-C-C1: "승인확정" 시각이 결제·서명 중 하나만 있어도 표시됨 — 관리자 수동승인 경로에서 사실과 다른 날짜 노출 ⚠️ 이번 세션 신규 구현 버그

```
파일: src/lib/components/cms/RentalDetailPanel.svelte:393-400
```

```ts
let approvalConfirmedAt = $derived.by((): string | null => {
  if (!APPROVAL_HISTORY_STATUSES.has(row.status)) return null
  const candidates = ([approvalSignedAt, approvalPaymentAt] as (string | null)[])
    .filter((v): v is string => v != null)
  if (candidates.length === 0) return null
  return [...candidates].sort().at(-1) ?? null   // ← length===1이어도 그대로 반환
})
```

주석은 "try_confirm_reservation이 서명+결제 둘 다 만족했을 때만 실행됨"을 전제하지만, 이
전제는 관리자 "승인하기" 버튼(계약·결제 여부와 무관하게 즉시 confirmed 전환하는 §9 예외
경로)에는 적용되지 않는다. 결제만 완료(서명 없음)된 hold를 관리자가 수동승인하면
`approvalSignedAt=null`, `approvalPaymentAt=T`, candidates 길이 1 → "결제 확인"과
"승인확정"이 **같은 시각**으로 나란히 표시돼, 실제로는 서명 없이 관리자가 나중에(때로는 수일
뒤) 수동 승인한 사실이 정상적인 자동승인처럼 보인다.

**수정 방향**: `candidates.length === 2`(서명·결제 둘 다 존재)일 때만 값을 반환하도록 가드
추가 — 관리자 수동승인 시각을 추적할 별도 컬럼이 없으므로 표시하지 않는 것이 fabrication보다
안전.

---

### RSV-C-C2: "미리보기 & 발송" 버튼이 서명완료 상태에서도 숨겨지지 않음

```
파일: src/lib/components/cms/RentalContractViewer.svelte:219-226
```

이 버튼은 서명 여부와 무관하게 항상 렌더링된다(편집/폐기/재발송 버튼만 조건부). 이미 서명
완료된 계약서에도 여전히 "미리보기 & 발송" 클릭이 가능하고, 클릭 시 열리는 모달의 "채팅으로
발송" 버튼도 서명 여부를 검사하지 않아 그대로 활성 상태다. 서버(`send-chat/+server.ts`)도
서명 여부를 검사하지 않으므로, 클릭하면 이미 서명 완료된 고객에게 "서명을 등록해주세요" 액션
카드+푸시가 **재발송**되고 `sent_at`/`expires_at`이 불필요하게 갱신된다(고객이 링크를 열면
409로 막히지만, 잘못된 알림은 이미 나간 뒤). 전용 "재발송" 버튼이 이미 별도로 존재하는 것으로
보아 설계 의도상 명백한 누락으로 판단됨.

---

### RSV-C-C3: PATCH `/api/cms/contracts/[id]/content`가 서명완료 후 계약 내용 편집을 막지 않음

```
파일: src/routes/api/cms/contracts/[id]/content/+server.ts:60-147
```

`authoring_mode` 변경 시에만 `sent_at`/`signed_at` 재검증 가드가 있고, `content_blocks`/
`canvas_document`/`spreadsheet_document`/`title` 자체를 갱신하는 본 로직에는 서명·발송 상태
검증이 전혀 없다. `clearIssuedContractContent`/`discardSentContract`는 각각 엄격히
재검증해 삭제·폐기를 차단하는데, **정작 내용을 덮어쓰는 PATCH 경로만 아무 가드가 없다** —
삭제는 막고 변조는 허용하는 비대칭. RSV-C-C2와 결합하면, 서명완료 계약서도 "미리보기&발송" →
"다른 양식으로 교체" → "채팅으로 발송" 경로로 **이미 고객이 서명한 계약서 레코드의 라이브
콘텐츠가 완전히 다른 내용으로 덮어써질 수 있다**(서명 시점 스냅샷은 보존되어 법적 증빙 자체는
안전하나, CMS 화면에 노출되는 콘텐츠가 실제 서명본과 달라지는 정합성 문제 발생).

**수정 방향**: PATCH 핸들러 초입에 `signed_at` 존재 시 400 차단(`clearIssuedContractContent`와
동일 패턴 재사용) + RSV-C-C2의 버튼 가시성도 서명완료 시 "보기"로 전환.

---

## 🟡 BOUNDARY

### RSV-A-B1: `expired`(HOLD 30분 자동만료) 상태가 목록 배지 매핑에서 누락 — 영어 원문 노출
`STATUS_LABEL`/`STATUS_STYLE`(`+page.svelte:27-51`)에 `expired` 항목이 없어 한글 라벨 대신
"expired" 원문이 그대로 노출되고 색상도 `pending` 회색으로 대체 표시됨. `RentalContractViewer`는
이미 "만료된"으로 번역해두고 있어 컴포넌트 간 라벨링 불일치.

### RSV-A-B2: `discardSentContract`의 2단계 DML이 원자적이지 않음
`clearIssuedContractHelper.ts:85-111` — `contract_signings` UPDATE와 `contracts` UPDATE 사이
트랜잭션 경계 없음. 첫 번째만 성공하면 "미발송 초안처럼 보이지만 실제로는 폐기가 반쯤만 적용된"
불일치 상태 가능.

### RSV-A-B3: `p_search`가 LIKE 와일드카드(`%`,`_`)를 이스케이프하지 않음
`get_rental_list`(Migration 387) 검색어 파라미터. SQL Injection 위험은 없음(파라미터 바인딩)이나
`escapeLikePattern` 미적용(products.md §2-7의 QR 조회 지점들과 동일 클래스, 이쪽은 미해결).

### RSV-B-B1: REFUND-SCOPE-UX — 직전 감사(2026-08-30) 지적 사항 재확인, 아직 미해결
확인창·성공 토스트 모두 "같은 주문의 다른 상품도 함께 취소됩니다"를 언급하지 않음.

### RSV-B-B2: 환불 성공 후 같은 패널 세션에서 "PG 결제 정보" 섹션이 새로고침되지 않음
`fetchedForId` 캐시 때문에 `reservation_id`가 안 바뀌면 재조회 안 됨 — 환불 버튼 자체는
`row.status` 체크로 이중환불 방지되나(안전), 결제정보 섹션 표시는 패널을 닫았다 열기 전까지 스테일.

### RSV-B-B3: `canManageLockerPassword` 변수가 환불 버튼 권한 게이트로도 재사용(네이밍 혼선)
현재는 둘 다 manager+ 기준이라 기능은 정확하나, 향후 분리 필요 시 의도치 않은 결합 위험.

### RSV-B-B4: 운송장번호 저장 성공 시 고객에게 어떤 채널로도 알림이 안 나감
`shipped` 전이 시 1회 발송되는 `shipment_notify`와 달리, 운송장번호 사후 입력/정정은 고객에게
전달되지 않음.

### RSV-B-B5: 운송장/무인보관함 비밀번호 PATCH에 형식·자리수 검증 없음
무인보관함 비밀번호는 실물 기기 PIN인데 자리수 검증이 없어 오탈자가 그대로 저장될 수 있음.

### RSV-B-B6: 두발히어로 4개 엔드포인트가 여전히 partner 등급 허용 — 직전 감사 재확인, 미해결
환불·잠금비밀번호는 manager+로 격상됐는데 실비용 발생하는 배송 API는 그대로 partner 허용.

### RSV-B-B7: `row.payment_status` 원문 영문이 그대로 노출('done'/'ready'/'cancelled' 등)
한글 라벨 매핑 테이블 없음.

### RSV-C-B1: `send-chat` 재발송이 "이미 서명됨" 상태를 서버단에서 차단하지 않음
`isContractIssueBlocked`만 검사, `signed_at` 존재 여부 미확인 — UI 가드(RSV-C-C2) 우회 시 방어선 없음.

### RSV-C-B2: "편집" 버튼·PATCH 경로가 취소/만료/파손신고 상태를 검사하지 않음
발송·발행은 막혀 있어 실질 피해는 제한적이나, "취소된 예약은 계약서 작업을 막는다"는 원칙과 불일치.

### RSV-C-B3: "승인 이력" 섹션이 §9 게이팅 완료 전(hold+결제완료) 상태에서도 표시됨
주석("§9 게이팅 완료 후만 표시")과 실제 구현(`hasApprovalHistory`가 하나라도 있으면 true) 불일치.
버그로 단정하긴 어려우나(실사용상 유용할 수 있음) 문서·주석 정정 권장.

---

## 🟢 ROUTINE / 참고 (조치 불필요 또는 저우선 정리 후보)

```
[A] R-1: security-auth.md 계약서 권한 매트릭스 "9곳" 집계가 실제(12곳)보다 적음 — 문서 갱신 누락,
         코드 자체는 이미 안전하게 게이트됨.
[A] R-2: 계약서양식 목록 카운트 배지가 로컬 검색 필터를 반영 안 함(항상 전체 개수).
[A] R-3: 날짜 필터는 "겹침"이 아니라 "완전 포함" 조건 — aria-label 확인 결과 의도된 설계.
[A] R-4: expired가 TERMINAL Set에 미포함돼 "예약 취소" 버튼 노출되나 RPC가 허용해 무해.
[C] R-1: clearIssuedContractContent vs discardSentContract — 조건 상호배타적으로 정확히 분리(정상).
[C] R-2: init-contract의 "예약=주문 단위 계약 1건" 정책 정상 동작 확인.
[C] R-3: authoring_mode 불변 원칙은 정확히 구현됨(단 본문 자체엔 미적용 — RSV-C-C3과 대조).
[C] R-4: discardSentContract가 hold(예약) 자체는 건드리지 않음 확인(HOLD-D2-GAP 정책과 일치).
[C] R-5: isRentalView 쓰기 액션 차단은 전수 확인 결과 정상(RSV-C-C2/C3 문제는 !isRentalView 한정).
[C] R-6: /api/contracts/[token]/sign 이중서명 방어는 견고(신선도체크+DB가드 이중).
[D] 미사용 props 14개(RentalContractViewer.svelte) — autoSignedAt·productName 등 리팩터링 잔재.
[D] clearIssuedContract 액션이 /cms/rentals·/cms/mobile/rentals 2곳에서 도달 불가능(UI 트리거 없음,
    보안 문제 아님 — 직접 호출해도 manager+ 게이트 정상 작동).
[D] RentalListRow의 미사용 필드 4개(contract_status·duration_type·delivery_fee·tax_amount) —
    조회는 되나 렌더링 안 됨.
```

---

## 정합 확인 총평 (4개 서브 에이전트 커버리지 요약 — 상세는 세션 로그 참고)

- **목록/계약서양식**: RPC 파라미터 10개 전수 일치, count-필터 정합, N+1 없음, 고아 액션 없음,
  권한 게이트 전수 일치.
- **고객/결제정보**: 환불 이중가드(상태·이미취소) 정상, dhero fail-soft 격리 정상, 무인보관함
  권한게이트 정상, `payment_status` 소스가 과거 버그(orders.status 항상 pending)에서 이미
  탈피(Migration 387).
- **계약서 탭**: 상태별 버튼 노출 매트릭스 전수 작성 — 데드엔드(버튼 없는 상태) 없음, isRentalView
  차단 전수 정상, discardSentContract가 hold를 안 건드림 확인.
- **고아코드**: 심각한 죽은 로직 없음 — `log_rental_action`(직전 세션 재연결) 정상 작동 재확인,
  `release_reservation_hold`가 앱코드에 없는 것도 pg_cron 전용 설계와 일치(정상).

---

## 권장 조치 우선순위

```
1순위(자금정합성)   : RSV-B-C1·C2 — 환불 RPC 반환값 검증 추가, 형제예약 실제 전환여부 확인 후
                      알림 발송하도록 수정.
2순위(핵심업무 UX)  : RSV-A-C1 — 상세패널 stale-state, 상태변경 성공 시 패널 자동 닫기 또는
                      selectedRow 재조회 fallback 추가.
3순위(데이터 정합성) : RSV-C-C1(이번 세션 신규버그, 즉시 확인 권장)·C2·C3 — 승인이력 표시 가드
                      + 서명완료 계약서 편집/재발송 차단.
4순위(운영비용/UX)  : RSV-B-C3·C4 — 두발히어로 멱등성 가드 + 취소 후 DB 갱신.
5순위(기존 미해결)  : RSV-B-B1(REFUND-SCOPE-UX)·B6(dhero partner 허용) — 이전 감사에서 이미
                      지적됐으나 아직 미조치.
6순위(UX/문서 보완)  : 나머지 BOUNDARY 전부, ROUTINE은 별도 정리 아젠다로 진행 권장.
```

---

*cms_reservation_full_screen_audit_2026-08-31.md | 감사 대상: `/cms/reservation` 전역(목록·
계약서양식·고객정보·결제정보·계약서 탭·고아코드) | read-only 정적 코드 감사(4개 병렬 에이전트) |
코드 수정 없음 — 발견사항 전부 Stephen 확인·판단 대기*
