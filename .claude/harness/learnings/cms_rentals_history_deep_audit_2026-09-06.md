# CMS `/cms/rentals` · `/cms/rental/history` 정밀 재검증 (A2 트랙, 2026-09-06)

> 순수 읽기 전용 조사(Read + Supabase MCP `execute_sql`/`list_migrations`만 사용, Edit/Write 없음
> — 이 문서 자체만 예외). 대상: `src/routes/cms/rentals/`, `src/routes/cms/rental/history/`,
> `RentalContractViewer.svelte`, Realtime 구독 코드.

## 요약 (3줄)

1. **신규 CRITICAL 후보 발견**: `/cms/rentals`가 `/cms/reservation`에 이미 적용된 RSV-A-C1
   수정("필터 밖으로 벗어난 row는 패널 자동 close")을 여전히 누락 — 이 화면의 기본 진입 필터가
   `confirmed`라서, 관리자가 이 화면에서 하는 **가장 기본적인 다음단계 처리 액션 자체가 매번**
   이 버그를 재현시킨다.
2. Realtime `is_admin()`→`is_cms_user()` 교체(Migration #408)는 Stage DB에 실제로 적용되어
   있고, `rental_reservations`가 `supabase_realtime` publication에 포함 + `REPLICA IDENTITY
   FULL`(`f`)로 설정돼 있어 Realtime 구독 자체는 논리적으로 정상 동작 조건을 충족한다.
3. `isRentalView` 플래그 전달·게이팅(예약단계 버튼 숨김, 계약서 뷰어 읽기전용화, 스텝퍼
   6단계→5단계 필터)은 두 화면 모두 rental-lifecycle.md·security-auth.md 기준과 정확히 일치.
   CART-C2(대여기간 제한 미연동)는 내 담당 파일 범위 밖(cart/CMS 설정 화면)이라 재현 확인은
   생략하고 기존 v5 synthesis 문서의 "의도적 보류 확정" 판정을 그대로 신뢰함.

---

## 항목별 검증결과

### 1. `/cms/rentals` 목록 stale 여부 — 🔴 미해소 확인 (아래 신규발견 참고)

`cms_global_verification_v5_synthesis_2026-08-31.md`(§A, RSV-A-C1 행)가 "원 감사문서가
`/cms/rentals`에도 동일 패턴이 있다고 언급했으나 이번 재검증(2026-09-01)은 `/cms/reservation`만
스코프였다"고 명시적으로 남긴 미확인 항목을 이번에 코드 대조로 직접 확인했다. **`/cms/reservation/
+page.svelte`(66-77행)는 RSV-A-C1 수정으로 `selectedRow` 동기화 `$effect`에 `else { closePanel()
}` 분기가 있지만, `/cms/rentals/+page.svelte`(65-70행)의 동일 구조 `$effect`에는 이 분기가 아예
없다** — `shallow_routing_invalidateall_stale_2026-08-25.md`에 나온 것과 같은 계열(반응형 상태가
`invalidateAll()` 이후의 서버 데이터와 어긋나는 문제)이지만 원인 메커니즘은 다르다(그쪽은 Svelte
내부 `page.state` 타이밍 문제, 이쪽은 단순히 "필터에서 사라진 row를 처리하는 else 분기 누락").
상세는 아래 신규발견 #1.

### 2. Realtime `is_admin()` vs `is_cms_user()` — ✅ Stage 정상 확인

- `pg_policy` 직접 조회(project: ezyvffjvuwmtuhpxdjrw): `rental_reservations`의 "관리자 전체"
  정책 `USING`/`WITH CHECK` 식이 `is_cms_user()` — Migration #408
  (`20260901185910_408_rental_reservations_rls_cms_user_fix.sql`)이 실제로 적용된 상태.
- `rental_reservations`는 `supabase_realtime` publication에 포함(`in_realtime_pub: true`),
  `relreplident = 'f'`(FULL) — UPDATE 시 old row 전체가 Realtime으로 브로드캐스트되는 조건 충족.
- 위 두 조건(RLS가 CMS 세션을 SELECT 허용 + publication 포함 + REPLICA IDENTITY FULL)이 전부
  충족돼 있어, `/cms/rentals`의 `supabase.channel('cms-rentals-realtime').on('postgres_changes',
  {event:'*', schema:'public', table:'rental_reservations'}, invalidateAll)` 구독은 논리적으로
  정상 수신 가능한 상태다(브라우저 실측은 이 세션 스코프 밖).
- 다만 이 구독은 `event: '*'` + 필터 없음이라 이 테이블에 대한 **모든** INSERT/UPDATE/DELETE에
  반응해 `invalidateAll()`을 호출한다 — 트래픽이 많아지면 화면이 잦은 재조회로 깜박이거나(특히
  패널이 열려 있을 때 위 신규발견 #1과 겹쳐 더 자주 stale 상태를 만든다) 불필요한 RPC 호출이
  누적될 수 있다. 기능결함은 아니고 성능/UX 관찰사항으로만 기록.

### 3. `isRentalView` props 전달 정확성 — ✅ 정합 확인

- `/cms/rentals/+page.svelte` → `<RentalDetailPanel ... isRentalView={true} stepFilter={['confirmed',
  'shipped','in_use','return_requested','returned']} cmsRole={data.cmsRole} />`
- `RentalDetailPanel.svelte` 내부: `row.status === 'hold' && !isRentalView`(1738행, 승인/거부
  버튼), `!isTerminal(row.status) && row.status !== 'hold' && !isRentalView`(1803행, 예약취소
  버튼) — 둘 다 `isRentalView=true`일 때 정확히 숨겨짐. rental-lifecycle.md "예약 단계 버튼
  (isRentalView=false 전용)" 표와 완전히 일치.
- `RentalJourneyStepper status={row.status} steps={stepFilter}`(1211행) — `/cms/rentals`가
  넘기는 5단계 필터(`hold` 제외)가 그대로 반영됨. `/cms/reservation/+page.svelte`는 `isRentalView`
  자체를 넘기지 않아 컴포넌트 기본값(`false`) 사용 — 정상.
- `RentalContractViewer.svelte`(2087행에서 `isRentalView` prop 그대로 전달됨, RentalDetailPanel
  내부 확인)는 `!isRentalView` 가드로 발행/편집/삭제/재발송/폐기 버튼 및 서명링크 노출을 전부
  차단하고, `isRentalView=true`일 때는 "서명완료 목록"(고객 서명 완료건만) + 보기 전용
  (`viewOnly={isRentalView}` → `ContractTemplatePreviewModal`)만 허용 — contract.md/rental-
  lifecycle.md 원칙과 일치. `discardSentContract` 액션은 `/cms/reservation/+page.server.ts`에만
  존재하고 `/cms/rentals/+page.server.ts`에는 없는데, 그 버튼 자체가 `!isRentalView` 가드 뒤에
  있어 `/cms/rentals`에서는 애초에 렌더링되지 않으므로 액션 부재가 문제되지 않음(정상 설계).
- `/cms/rental/history` 화면은 `CustomerDetailPanel`을 아예 사용하지 않고(`ProductDetailPanel
  tabs={['history']}`만 사용), `RentalDetailPanel`도 사용하지 않는다 — 순수 상품 이력 조회
  전용 화면이라는 파일 상단 주석과 실제 구현이 일치.

### CART-C2 스팟체크

담당 파일(`/cms/rentals/`, `/cms/rental/history/`) 어디에도 CART-C2 관련 코드(대여기간 제한 UI)가
없어 코드 재현 확인은 스코프 밖. `cms_global_verification_v5_synthesis_2026-08-31.md`의 "STILL
OPEN(의도적 보류)" 판정을 그대로 신뢰 — Stephen이 "통합편집기 미완성이라 의도적 보류"로 이미
확정한 사항이며 이번 조사에서 이를 뒤집을 근거를 찾지 못했다(재조사하지 않음, 지시 준수).

---

## 신규 발견

### #1. `/cms/rentals` 상세 패널 stale — RSV-A-C1 수정이 이 화면에는 미적용 (제안 등급: CRITICAL 후보, 최소 BOUNDARY)

- **파일:라인**: `src/routes/cms/rentals/+page.svelte:65-70`
  ```js
  $effect(() => {
    if (selectedId != null) {
      const updated = data.rentals.find(r => r.reservation_id === selectedId)
      if (updated) selectedRow = updated
      // ← else 분기 없음. /cms/reservation/+page.svelte(66-77행)에는
      //    `else { closePanel() }`(RSV-A-C1 수정)가 있음.
    }
  })
  ```
- **재현조건**(DB로 직접 검증 완료 — `get_rental_list` 함수 정의를 Stage에서 직접 조회):
  `get_rental_list`의 WHERE절은 `(p_status IS NULL OR rr.status = p_status)`로, `/cms/rentals`가
  기본 진입 시 항상 `p_status='confirmed'`를 넘긴다(`+page.server.ts:22`, "화면 최초진입 기본값").
  즉 **관리자가 이 화면(기본 탭)에서 아무 예약이나 골라 "다음 단계 처리" 버튼을 눌러 상태를
  `confirmed → shipped`로 전환하는 것만으로**(가장 흔한 정상 워크플로우), `onrefresh={invalidateAll}`
  → `load()` 재실행 → 새 `data.rentals`에는 그 row가 더 이상 없음(필터가 `confirmed` 고정) →
  위 `$effect`가 `if (updated)`만 있고 else가 없어 **`selectedRow`가 전환 이전의 옛 상태로 영구
  고정된 채 패널이 계속 열려있음**. 같은 상황은 다른 관리자의 조작이나 Realtime 이벤트로도
  동일하게 재현된다(위 검증사항 #2로 Realtime 구독 자체는 정상 동작 확인됨 — 즉 이 stale 조건은
  실사용 빈도가 낮지 않다).
- **영향범위**: 패널이 옛 `status`·옛 픽업/반납 방식 등 stale 데이터를 계속 보여주는 동안,
  `RentalDetailPanel`의 다음단계 버튼(`nextStatus`/`nextLabel`)은 옛 `row.status` 기준으로
  라벨을 다시 그려 관리자에게 "아직 처리 전"인 것처럼 보이는 버튼을 다시 노출할 가능성이 높다
  (`row` prop이 `selectedRow` 그대로 전달됨, 1211행 등). 관리자가 이를 보고 같은 액션을
  재클릭하면 `update_reservation_status`/`log_rental_action` RPC가 이미 전환된 상태에 대해
  다시 호출되는 상황이 발생한다 — 이 RPC들이 "현재 상태 기준 검증"을 서버단에서 얼마나
  엄격히 하는지는 이번 조사 스코프(RentalDetailPanel 내부 로직은 A1 트랙 담당)에서 확인하지
  않았다. **RPC가 멱등적으로 막아주지 않는다면 중복 채팅알림 발송(AUTO_NOTIFY 재발송)·중복
  `log_rental_action` 로그·이중 상태전이 시도로 이어질 수 있어 CRITICAL로 격상될 소지가 있다** —
  이 부분은 A1 트랙(또는 RentalDetailPanel 담당) 확인을 권장.
- **수정 제안**: `/cms/reservation/+page.svelte:66-77`과 동일하게 `else { closePanel() }` 한 줄
  추가(이미 검증된 동일 패턴, 최소 침습적 수정).

### #2. Realtime 구독 필터 부재로 인한 불필요한 전체 재조회 (부가발견, ROUTINE)

`/cms/rentals/+page.svelte:73-86`의 `postgres_changes` 구독이 `event:'*'` + 테이블 전체(필터 없음)
라서 `rental_reservations`의 **모든** 행 변경(다른 고객·다른 상태의 예약 포함)마다 이 화면 전체가
`invalidateAll()`된다. 기능 결함은 아니지만 트래픽이 늘어날수록 신규발견 #1의 stale 윈도우가
열리는 빈도도 함께 늘어난다(패널이 열려있는 동안 매번 재조회가 되기 때문) — #1을 고치면 이 자체는
문제가 안 되지만, 참고용으로 기록.

---

## 부가 발견 (고치지 말고 기록만)

- `RentalContractViewer.svelte`의 "발송 목록"(비-`isRentalView`) 섹션은 `cms_global_verification_
  v5_synthesis_2026-08-31.md`가 언급한 RSV-C-C2(PARTIALLY FIXED)와 무관하게, `isRentalView=true`
  경로 자체는 이미 `viewOnly={isRentalView}`로 정확히 읽기전용 처리돼 있다 — `/cms/rentals`
  화면에서는 RSV-C-C2의 잔여 리스크(모달이 여전히 편집모드로 열림)가 애초에 발생하지 않는다
  (그 리스크는 `/cms/reservation` 쪽 시나리오).
- `/cms/rental/history/+page.server.ts`는 `products` 목록 조회 시 `.limit(200)`로 상한을 두고
  있고 화면에 "최대 200개 로드됨" 안내가 있어(UI 확인) 설계상 의도된 제한으로 보임 — 이슈 아님.
- `/cms/rentals`와 `/cms/reservation`이 `RentalListRow` 타입을 공유(`export type { RentalListRow }`)
  하는 구조라 스키마 드리프트 위험은 낮음 — 참고로만 기록.

---

## 자체 오인점검

- `misidentifications.md`에서 "타입 정의 파일보다 실제 DB를 우선 신뢰하라"는 교훈을 확인하고,
  이번 조사의 핵심 판정(#1 stale 버그, #2 RLS 함수)은 코드 읽기에만 의존하지 않고 Supabase MCP
  `execute_sql`로 `pg_policy`·`pg_publication_tables`·`get_rental_list` 함수 정의를 Stage DB에서
  직접 조회해 교차검증했다 — 문서(rules-ref)나 커밋 코멘트만 믿고 "적용 완료"로 오판할 위험을
  줄였다.
- 신규발견 #1은 "다른 화면(`/cms/reservation`)에 있는 수정이 이 화면에 없다"는 **대조 기반** 판단이라
  확실성이 높지만, 그 결과로 발생하는 다운스트림 영향(RPC 재호출 시 실제로 안전한지)은 내
  담당 범위(A1이 맡은 `RentalDetailPanel` 내부)를 벗어나므로 등급을 CRITICAL로 확정하지 않고
  "CRITICAL 후보"로 보수적으로 표기했다 — 과잉 확신에 의한 오판을 피하기 위함.
- CART-C2는 재현 시도 자체를 하지 않고 기존 문서 판정을 인용만 했음을 명시해, "내가 직접
  확인했다"는 착각을 만들지 않도록 별도 절로 구분해 기록했다.
