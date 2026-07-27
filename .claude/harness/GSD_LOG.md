# GSD_LOG.md — 크레이지샷 실행 이력
# 형식: [YYYY-MM-DD HH:MM] 타입 | 태스크명 | 파일 | 소요 | 결과

[2026-07-27] BOUNDARY | 예약 카트(/checkout) 미로그인 게스트 예약 허용 + 완료 버튼 문구 회원/비회원 분기 | src/routes/products/[id]/+page.svelte, src/routes/checkout/+page.server.ts, +page.svelte, 삭제 checkout/+page.ts | ✅ DONE
  배경: Stephen 요청 3건
    ① 미로그인 사용자도 실제 예약 후 /checkout에 로그인 사용자와 동일한 UI·실 데이터로 랜딩
    ② 미로그인 사용자의 대여 예약 자체를 허용 — 임시 계정 자동 생성 로직 필요
    ③ 기존 "비로그인 시 데모 미리보기 노출" 설계 제거
  해결:
    · `products/[id]/+page.svelte` handleReserve(): 비로그인 시 로그인 페이지로 리다이렉트하던 로직을
      제거하고 `supabase.auth.signInAnonymously()`로 실 UUID를 가진 임시(익명) 세션을 투명하게 생성한
      뒤 동일한 create_hold_reservation 플로우로 진행. 이 패턴은 신규 도입이 아니라 채팅 위젯
      (`ChatWindow.svelte` ensureAuth())에서 이미 쓰던 것과 동일 — DB 확인 결과 해당 방식으로 생성된
      익명 계정이 이미 20건 존재해 실사용 검증된 방식임을 확인.
    · RLS 재확인: rental_reservations/products/price_rules 정책이 전부 auth.uid() 또는 공개조회 기준이라
      익명 세션도 실회원과 동일하게 동작(별도 예외 처리 불필요).
    · `+page.server.ts`/`+page.svelte`: fixture 데모 분기(fixtureLineItems, sampleSubItems, priceConfig,
      isDevMode, `/payment/success/dev` 미리보기 분기) 전면 제거 — 이제 예외 없이 실 DB 데이터만 사용.
      `checkout/+page.ts`(fixture 로더) 파일 자체를 삭제.
  후속 요청 — 완료 버튼 문구 회원/비회원 분기:
    · `+page.server.ts`: `session.user.is_anonymous`를 `isGuest`로 반환.
    · `+page.svelte`: `confirmLabel = isGuest ? '비회원 예약신청완료' : '예약신청완료'`로 기존 고정 문구
      ("가입하고 지금 예약하세요") 대체.
  검증: 로그인 회원 계정으로 실측 — 버튼 문구 "예약신청완료" 정상 노출, svelte-check 에러 0건 확인.
    게스트(비회원) 라벨은 로그아웃 클릭이 브라우저 자동화 도구에서 반복적으로 반응하지 않아
    (환경/툴 문제로 추정 — 콘솔 에러 없음, 좌표상 정상 클릭은 기록되나 페이지 상태 불변) 실측하지 못함.
    로직은 대칭적인 삼항 조건이라 코드 검토 및 타입체크로 정확성 확인 — Stephen 직접 확인 권장.

[2026-07-27] CRITICAL FIX | 전자계약 채팅 발송 세션 오선택 — pending 우선순위 적용 | src/routes/api/cms/contracts/[id]/send-chat/+server.ts | ✅ DONE
  증상: mublues@gmail.com 기준 CMS "채팅으로 발송" 클릭 시 사용자 채팅에 '전자계약 보기' 카드가 수신되지 않음
         '예약 승인 확인' 등 다른 알림은 정상 수신 → Realtime 문제가 아님
  근본 원인: 해당 유저의 채팅 세션이 3개 존재
    · Session A (cb94b7d9, open, reservation): send-chat이 반복 발송 → updated_at이 가장 최신
    · Session B (2b2cbaa0, pending, general): 실제 사용자-관리자 대화가 있는 세션 (예약승인 알림 등 수신됨)
    · Session C (e7da0640, pending, reservation): 또 다른 pending 세션
  오선택 메커니즘: 기존 코드 `.in('status', ['open', 'pending']).order('updated_at', DESC)` →
    send-chat이 Session A를 선택해 발송 → trigger가 Session A의 updated_at 갱신 →
    다음 발송에도 Session A가 최신 → 반복 오선택
  해결: 세션 선택 우선순위를 pending → open → closed 재활성화 → 신규생성 순으로 변경
    · pending 세션(관리자 핸드오프 중인 실제 대화)이 open(상품탐색)보다 항상 우선
    · 검증: Stephen이 발송 재테스트 → mublues@gmail.com 채팅(Session B)에서 '전자계약 보기' 카드 수신 확인 ✅

[2026-07-27] BOUNDARY | CMS 자식 상품 수정 제한 전면 적용 | 수정 2파일 | ✅ DONE
  수정: src/lib/components/cms/ProductDetailPanel.svelte
    - isChildProduct $derived 추가 (parent_product_id 존재 여부)
    - handleSectionSave / handleFilesUpload / removeImageAndSave / saveContent / saveOptions: 자식 차단
    - basic·slug·pricing·content·components·specs 저장 버튼 disabled={isChildProduct || ...}
    - 8개 탭(history 제외) 최상단 child-readonly-notice 배너 추가 / options·rental·images 기존 메시지 통일
    - CSS: .child-readonly-notice (lilac bg + purple 왼쪽 보더)
  수정: src/routes/cms/products/+page.server.ts
    - updateSection 자식 차단 블록 통합: childBlockedSections (basic·slug·pricing·content·components·specs·options·rental)
    - 기존 options/rental 개별 체크 → 통합 블록으로 교체
  svelte-check: 신규 ERROR 0건 (기존 WARNING/ERROR 동일 유지)

[2026-07-27] CRITICAL+BOUNDARY | /checkout CTA → TossPayments PG 연동 + 결제완료 화면 PC 반응형 | 신규 6파일·수정 2파일 | ✅ DONE
  신규: src/routes/api/checkout/initiate/+server.ts (HOLD 예약+금액계산+Toss 파라미터)
  신규: src/routes/payment/success/dev/+page.ts (URL 파라미터 → PageData)
  신규: src/routes/payment/success/dev/+page.svelte (DEV 배너 + 완료 UI + PC 반응형)
  수정: src/routes/checkout/+page.svelte (CTA devMode 분기 + Toss SDK handlePay)
  수정: src/routes/payment/success/+page.server.ts (reservationId UUID string + confirm 플로우)
  수정: src/routes/payment/success/+page.svelte (PC 반응형 CSS ≥768px)
  수정: .env.local (PUBLIC_TOSS_CLIENT_KEY 추가)
  핵심 수정:
    - atomic_reserve_asset → calculate_cart_total → Toss requestPayment 전체 플로우 구현
    - isDevMode=true: API·Toss 건너뜀 → /payment/success/dev?쿼리스트링 우회
    - reservationId Number→string UUID 타입 버그 수정
    - declare global 불가 → type TossWindow 캐스팅 패턴 (TS 에러 0건)
    - 날짜 미선택 시 preflight 검증 (API 400 방지)
  검증: svelte-check 신규 에러 0건 (기존 warning 1건만 잔존)

[2026-07-27] CRITICAL FIX | 예약 카트(/checkout) 삭제 버튼 미반영 + 빈 카트 더미상품 노출 수정 | src/routes/checkout/+page.svelte, 신규 src/routes/api/checkout/remove-item/+server.ts | ✅ DONE
  배경: Stephen이 "상품 삭제가 정상 반영되는지" + "더미 상품 재노출 의심" 검수 요청
  발견 2건 (직전 다중상품 리스트 재설계에서 미처 다루지 않은 부분):
    ① 삭제 버튼이 로컬 UI 상태(`deleted: true`)만 바꾸고 서버에는 전혀 반영되지 않음
      → 카드는 화면에서 사라지지만 합계 금액(`calculate_cart_total` 결과)은 삭제된 상품 값을
        그대로 포함한 채 안 바뀜(실측: 2건 65,000원 → 1건 삭제해도 65,000원 그대로)
      → 새로고침하면 삭제했던 상품이 다시 나타남(서버에 hold 상태로 남아있으므로)
    ② 로그인 사용자의 실 카트가 "0건"일 때 `isServerLoaded`(=hold 예약 존재 여부) 기준으로
      데모(fixture) 상품을 노출하도록 되어 있어, 정상적으로 카트를 비운 로그인 사용자에게도
      "Sony FX6-12·SONY PXW-Z90" 더미가 다시 나타남 — Stephen이 의심한 "더미 재노출"이 실제로 발생 중이었음
  해결:
    · `src/routes/api/checkout/remove-item/+server.ts` 신규 생성 — POST로 reservationId 수신,
      본인 소유 + status='hold'인지 서버에서 검증 후 service_role로 `update_reservation_status`
      RPC 호출해 'cancelled'로 전환 (confirm-mock/notify-hold와 동일한 소유권 검증 패턴)
    · `+page.svelte`: `removeItem()` 함수 추가 — 낙관적으로 즉시 숨김 → API 호출 → 성공 시
      `invalidateAll()`로 `+page.server.ts` 재로드(합계·목록 전부 서버 기준으로 재동기화),
      실패 시 숨김 취소 + 에러 토스트. 실 예약 없는 데모(fixture) 카드는 기존처럼 로컬 숨김만 유지.
    · `effectiveLineItems` 데이터 소스 분기 기준을 `sd.isServerLoaded`(예약 존재 여부) →
      `data.userId != null`(로그인 여부)로 변경. 로그인 + 카트 진짜 빈 상태 → "장바구니가
      비어 있습니다" 정상 표시, 비로그인 방문자만 데모 데이터 노출.
  검증: 실 예약 2건(Canon RF 25,000 + DJI RS4 Pro 40,000, 합계 65,000) → DJI 삭제 →
    카드 사라짐 + 합계 25,000으로 정확히 재계산 확인 → DB 조회로 해당 예약 status='cancelled'
    실제 반영 확인 → 남은 1건도 삭제 → "장바구니가 비어 있습니다" 정상 표시(더미 미노출) 확인.
    콘솔 에러 없음. svelte-check 신규 에러 0건.

[2026-07-27] CRITICAL FIX | 예약 카트(/checkout) 카드1/카드2 고정 2개 제한 폐기 → 무제한 동적 리스트 재설계 | src/routes/checkout/+page.server.ts, +page.svelte, +page.ts | ✅ DONE
  배경: 직전 수정(더미상품/합계금액) 검증 중 Stephen이 "여전히 엉뚱한 상품 노출" 재보고
    → 재조사 결과 반복 테스트로 같은 계정에 hold 예약이 여러 건 누적되어 있었고,
      카트 조회가 오래된 순 정렬이라 최신 예약이 아닌 옛 예약이 1번 카드에 뜨던 것으로 확인(원 버그 재발 아님)
    → 정렬을 최신순으로 교체 + stale 테스트 데이터 정리(Stephen 승인)
    → Stephen에게 "새 예약 시 기존 hold 자동취소 여부"를 확인한 결과 거부(여러 상품 동시 소지 가능해야 함)
      → 즉 "카드 2개까지만 노출" 백로그가 실사용 시나리오에서 실제로 발생하는 문제로 격상됨
    → 추가로 `+page.ts`의 `isDevMode: true`가 서버 데이터로 덮어써지지 않는 하드코딩 값임을 발견
      → 실 예약이 있어도 결제 버튼이 항상 DB 미반영 정적 미리보기(`/payment/success/dev`)로 새고
        있었음(직전 세션 다른 작업자가 해당 dev 미리보기 페이지를 신규 추가하며 도입된 회귀로 추정)
  해결:
    · `+page.server.ts`: `cartLineItems` 신규 반환 — 예약↔상품↔요금(12h/24h/보증금)을 예약 1건당 1개씩
      1:1로 매핑(상품 미해결 예약도 누락 없이 포함, 기존 `cartProducts`의 필터링으로 인한 인덱스
      불일치 위험 제거). `isDevMode`도 서버가 계산해 반환(`rawReservations.length === 0`)하도록 변경.
    · `+page.ts`: `isDevMode: true` 하드코딩 제거 — 이제 서버 값이 항상 사용됨.
    · `+page.svelte`: `c1*`/`c2*` 개별 변수 전체를 `itemsState`($state 배열)로 통합.
      - `newItemState()`/`updateItem()`으로 아이템 단위 생성·갱신
      - `effectiveLineItems`(서버 실데이터 우선, 없으면 fixture 데모 데이터) ↔ `itemsState` 동기화는
        `$effect` + `untrack()`으로 처리(로컬 UI 상태를 덮어쓰지 않으면서 목록 개수 변화에 대응 —
        itemsState를 effect 안에서 읽고 쓰면 무한루프가 되므로 untrack 필수)
      - `hasItems`/`datesSet`/`fixtureSubtotal`/`otTotalDays`/`otDeliveryFee`/`allowedMethodIds` 전부
        `itemsState.reduce(...)` 방식으로 재작성 — 아이템 개수 제한 없음
      - 카드 템플릿을 `{#snippet OrderCard(item, line, index)}` 하나로 통합해 `{#each itemsState as item, i}`
        로 렌더링 (기존 카드1 단순형 + 카드2 dur-tabs형 두 종류를 dur-tabs 포함 단일 디자인으로 통일)
      - fixture 전용 하위 옵션상품(subItems)은 index===0 && !isServerLoaded일 때만 표시(데모 전용 유지)
  검증: 브라우저에서 서로 다른 실 상품 3건(Manfrotto 055 24h=50,000 · DJI RS4 Pro 24h=40,000 ·
    Canon RF 24-70mm 24h=25,000)을 순서대로 예약 → 체크아웃에 3장 모두 카드로 노출, 합계 115,000원
    정확히 일치 → 약관 동의 → 결제 완료 → 마이페이지에 3건 전부 "승인완료"로 반영 확인. 콘솔 에러 없음.
  발견(범위 외, 별도 확인 필요): Manfrotto 055 예약에 배정된 자식 재고(2e5af80c-ced5-47ff-be59-c01c0aa31fab)의
    price_rules(24h=50,000/12h=30,000)이 부모 상품 상세 화면에 표시되는 가격(20,000/14,000)과 다름.
    products.md §9에 이미 문서화된 "자식 price_rules 드리프트" 현상의 실사례. 체크아웃·RPC는 실제로
    배정된 자식 기준 가격을 일관되게 사용 중이라 버그는 아니지만, 카탈로그 데이터 정합성 점검 필요.

[2026-07-27] CRITICAL FIX | 예약 카트(/checkout) 더미상품 표시 + 합계금액 계산 오류 + 단일상품 결제불가 버그 수정 | src/routes/checkout/+page.server.ts, +page.svelte, DB 마이그레이션 1개 | ✅ DONE
  발견 경위: Stephen 리포트 — /products에서 어떤 상품을 예약하든 /checkout에 항상
    "Sony FX6-12" 더미상품만 노출되고 실제 선택 상품 누락 + 체크아웃 진행 불가
  근본 원인 3건:
    ① create_hold_reservation RPC는 예약 시 실제 배정된 자식상품 UUID를
       rental_reservations.product_id에 직접 저장하는데(신 부모/자식 재고 구조),
       checkout/+page.server.ts는 구 방식대로 asset_id→assets.product_id 경유로
       상품을 찾음. asset_id는 항상 NULL이라 조회가 매번 실패 → cartProducts=[]
       → 화면이 개발용 fixture(cartFixtures.ts P1=Sony FX6-12)로 폴백되던 것.
    ② calculate_cart_total RPC — 호출부가 보내는 p_user_id 파라미터가 함수
       시그니처에 없어 매번 PGRST202로 호출 자체가 실패(조용히 무시됨). 반환
       컬럼명도 불일치(total_amount vs subtotal 등)했고, 내부 계산도 폐기된
       상품 컬럼(base_price_daily 등) 참조 — 사실상 한번도 정상 작동한 적 없음.
    ③ (검증 중 추가 발견) 체크아웃 화면이 "카드1·카드2" 2개 고정이라고 가정 —
       실 예약이 1건뿐이면 카드2용 날짜값이 항상 비어있어 datesSet 조건이
       영구 false → 결제 버튼이 계속 비활성화되던 구조적 버그.
  해결:
    · +page.server.ts: product_id로 products 직접 조회(+ price_rules 12h/24h 조인)로 교체,
      asset_id/service_role admin client 경로 제거 (products RLS가 status='active' 기준이라
      일반 세션으로도 조회 가능함을 DB 확인 후 단순화)
    · supabase/migrations/20260727000173_173_fix_calculate_cart_total.sql 신규 생성
      → 상품상세 렌탈요금 계산기(CalendarTimePicker.svelte estimatedFee)와 동일한
        알고리즘(당일 12h/24h 분기, 다일 잔여시간 12h 이상 시 반일 추가)으로 재작성
      → Stage 적용 후 실제 예약 4건으로 합계 일치 확인(115,000원) → Production 적용(Stephen 승인)
    · +page.svelte: datesSet·otDeliveryFee가 p2(2번째 실 상품) 존재 여부를 확인하도록 수정
    · p1Rate/p1Rate12h 등 단가 표시를 productPriceRules(DB 실데이터) 우선으로 변경(fixture는 폴백)
    · 이제 불필요해진 @ts-expect-error 6곳 제거 (npm run check 에러 0 확인)
  검증: 브라우저로 2개 시나리오 실행 확인 — (a) 기존 hold 4건 → 결제 완료 → 마이페이지 4건
    전부 정상 반영, (b) 신규 상품(Canon RF 24-70mm) 1건만 예약 → 실제 상품/가격 표시 →
    결제 완료 → 마이페이지 반영까지 콘솔 에러 없이 end-to-end 통과.
  BACKLOG(범위 외, 미해결):
    · 체크아웃 화면이 예약 2건까지만 카드로 표시(3건 이상은 합계엔 포함되나 카드 UI 미노출)
      — "카드1/카드2" 고정 구조를 동적 리스트로 재설계해야 함(더 큰 작업, 별도 확인 필요)
    · 체크아웃 화면에서 날짜 재조정 시 DB 미반영(TASK-D, 기존에 이미 인지된 백로그)

  [추가 수정 — 같은날] Stephen 재테스트 중 "여전히 엉뚱한 상품 노출" 재보고 → 재조사:
    원인: 위 수정과 무관한 별개 문제. 반복 테스트로 같은 계정에 미완료(hold) 예약이
      3건(SONY PXW-Z90 1건 + Canon RF 2건, 서로 다른 시각 생성) 누적되어 있었는데,
      카트 조회 쿼리가 `created_at ascending`(오래된 것부터) 정렬이라 방금 예약한
      최신 건이 아니라 가장 오래된 예약이 1번 카드에 뜨고 있었음. 합계도 3건 전체
      합산이라 방금 본 계산기 값과 달라 보였던 것(더미상품 버그의 재발 아님).
    해결:
      · +page.server.ts: 정렬을 `created_at descending`(최신 우선)으로 변경
      · Stage DB: 테스트 계정의 stale hold 2건 status='cancelled'로 정리(Stephen 승인)
    정책 확인(Stephen): "새 예약신청 시 기존 hold 자동취소" 여부 질문 → **거부**
      (여러 상품을 동시에 담을 수 있어야 하므로 자동취소 금지) → 즉, 체크아웃 화면의
      "카드1/카드2 고정, 3건째부터 미노출" 백로그가 edge case가 아니라 실사용 시나리오
      (다중상품 동시 hold)에서 실제로 발생하는 문제로 격상됨 — 우선순위 재검토 필요.

[2026-07-27] BUG FIX | 체크아웃 예약완료 랜딩 화면 오류 수정 (account/rental → payment/success/dev) | 2개 파일 수정 | ✅ DONE
  Stephen 지적: "예약완료" 랜딩이 /account/rental(마이페이지 목록)로 가는 건 잘못된 설계
    → 정상 랜딩은 /payment/success/dev (결제완료 UI 화면, PG 승인 단계는 임시 스킵)
  확인: checkout/+page.svelte에 이미 isDevMode(예약 0건) 분기는 /payment/success/dev로
    실더미 없이 파라미터 전달하며 정상 이동 중이었음 — 문제는 정상 케이스(hold 예약 존재)
    분기가 confirm-mock 성공 후 /account/rental로 보내던 부분
  해결:
    · src/routes/api/checkout/confirm-mock/+server.ts 수정
      · holds 조회 시 reservation_code 컬럼 추가 SELECT
      · 응답에 confirmedReservations: [{id, reservationCode}] 배열 추가 반환
    · src/routes/checkout/+page.svelte 수정
      · confirm-mock 성공 시 /account/rental → /payment/success/dev?productName=...&orderNumber=...
        (orderNumber는 실 reservation_code, 없으면 CZ{id} fallback)
      · amount는 otTotal(실 서버 계산 최종금액), startDate/endDate/notes는 itemsState 첫 항목 실데이터
      · 기존 isDevMode(예약 0건) 분기와 동일한 URLSearchParams 패턴 재사용 — 코드 중복 최소화
  svelte-check: 신규 에러 0건 (기존 17→11건, 무관한 감소 — 수정 파일에 새 에러 없음 확인)
  DB 변경 없음(순수 라우팅/파라미터 로직) — 마이그레이션 불필요

  [검증 완료 — Stephen 직접 클릭, localhost:5173]
  랜딩 URL: /payment/success/dev?productName=Sony+FX6-12&orderNumber=CSREV260700019&
    startDate=2026-07-26&endDate=2026-07-27&amount=22000&paymentMethod=카드(테스트)&notes=
  화면 렌더링 확인: DEV 배너 "실 결제·DB 연동 없음" 노출 + 상품명·주문번호(실 reservation_code)·
    대여일정·결제요금(22,000원)·결제수단 전부 실DB 데이터로 정상 표시. 더미값(테스트 상품/CZ99999) 없음.
  트러블슈팅: 최초 "아무 반응 없음" 보고 → git 미커밋으로 Production 미반영 문제로 오판
    → Stephen이 localhost:5173/checkout에서 재확인 요청 → 실제 원인은 동의 체크박스 미체크로
    인한 canProceed=false(버튼 정상 disabled) → 체크 후 정상 작동 확인으로 결론

[2026-07-27] SECURITY FIX | 서버 전용 RPC 4종 anon/authenticated 노출 차단 (BL-SEC-1) | DB 마이그레이션 + 1개 신규 파일 | ✅ DONE
  발견: R6 GRANT 확인 중 update_reservation_status에 소유자 검증이 전혀 없음을 확인
    → 유사 RPC 3종(send_rental_chat_notification, confirm_payment_and_update_reservation,
      cancel_payment_and_release_hold) 실사용 호출부 전수 grep 검사
    → 4개 함수 전부 코드베이스에서 100% admin.rpc()(service_role) 전용으로만 호출되는데
      DB 권한은 anon/authenticated에도 EXECUTE 열려있는 상태(Postgres 기본 PUBLIC 권한 미회수)로 확인
    · confirm_payment_and_update_reservation/cancel_payment_and_release_hold는 p_user_id를
      파라미터로 신뢰(auth.uid() 미검증) → 노출 시 타인 명의 결제 확정·취소 임의 호출 가능(심각)
    · create_hold_reservation은 대조군으로 확인 — 클라이언트 직접 호출이 의도된 설계이며
      내부 auth.uid() 검증 존재 → 수정 대상에서 제외
  해결:
    · supabase/migrations/20260727000172_172_lock_server_only_rpcs_to_service_role.sql 신규 생성
    · REVOKE EXECUTE FROM PUBLIC,anon,authenticated + GRANT TO service_role (4개 함수)
    · Stage 적용 → 권한 재조회로 anon/authenticated=false, service_role=true 검증
    · Production 적용(Stephen 승인 후) → 동일 검증 완료
    · create_hold_reservation 권한 무변경 확인(anon/authenticated=true 유지 — 회귀 없음)

[2026-07-27] CRITICAL FIX | update_reservation_status + set_reservation_shipment_method Production 드리프트 동기화 | DB 마이그레이션 + 1개 신규 파일 | ✅ DONE
  발견: BL-LC-R6/R7 백로그 처리 중 실사용 코드 grep으로 심각도 재평가
    · cms/reservation/+page.server.ts 92·119행 approveReservation·updateStatus 둘 다
      result.ok 검사 → Production 함수가 RETURNS void라 result 항상 null
      → CMS 예약승인·상태변경 버튼이 Production에서 100퍼센트 처리 실패 응답 중이었음 (ROUTINE에서 CRITICAL로 재분류)
  해결:
    · supabase/migrations/20260727000171_171_sync_reservation_status_and_shipment_rpcs.sql 신규 생성
    · Stage 적용: CREATE OR REPLACE 정상 처리 (원래 jsonb 반환이라 타입 변경 없음)
    · Production 적용 1차 시도: Postgres 42P13 에러 (반환타입 변경은 OR REPLACE 불가)
      → DROP FUNCTION 후 CREATE로 재시도 → 성공
    · 권한 유실 우려 검증: 함수 실행 권한 보유 롤 목록 확인
      → Stage 대조 결과 동일 상태 확인 → 회귀 아님, 기존부터 존재하던 상태로 판명
  신규 발견(미해결, 범위 외): update_reservation_status에 소유자 검증 로직 없음
    → BL-SEC-1로 백로그 등록, Stephen 확인 후 별도 처리 필요

[2026-07-27] CRITICAL FIX | send_rental_chat_notification 함수 Production 드리프트 동기화 | DB 마이그레이션 + 1개 신규 파일 | ✅ DONE
  발견 경위: return_method 컬럼 이슈 조사 중 예약·결제 RPC 6종 Stage/Production 전수 비교
  발견 사항 (심각도 순):
    · send_rental_chat_notification: Production 버전이 sender_type='system'으로 INSERT 시도
      → chat_sender_type_enum 실제 값은 user/admin/ai 뿐 → 'system' 값 자체가 없어
        호출할 때마다 enum 오류로 100% 실패하는 잠재 버그 (이전 세션에서 CMS 자동알림
        추가한 것도 Production에서는 계속 조용히 실패 중이었을 것으로 추정)
      → 또한 content 컬럼(text)에 JSONB를 직접 삽입 + action_payload 컬럼 미사용
        → ActionCard.svelte가 기대하는 payload 구조(type/reservation_no/product_name/
          return_deadline)와 불일치 → 카드 자체가 렌더링 불가능한 구조였음
    · set_reservation_shipment_method: Production 3개 오버로드 vs Stage 2개 (기능상 문제 없음, 정리 필요)
    · update_reservation_status: Production void 반환 vs Stage jsonb 반환 (클라이언트 응답 처리 차이, 별도 확인 필요)
    · create_hold_reservation / confirm_payment_and_update_reservation / cancel_payment_and_release_hold: 양쪽 동일 확인
  해결 (send_rental_chat_notification):
    · chat_messages 테이블 스키마 확인 — Stage/Production 컬럼 구조 동일(message_type, action_payload 모두 존재) 확인
    · chat_sender_type_enum 값 확인 — user/admin/ai (system 없음, Stage 버전이 유효한 이유 재확인)
    · supabase/migrations/20260727000170_170_sync_send_rental_chat_notification.sql 신규 생성
    · Stage 적용(idempotent) → Production 적용(Stephen 승인) → 함수 정의 재조회로 admin/action_payload 반영 검증 완료
  후속 필요: BL-LC-R6(update_reservation_status 반환타입 차이) / BL-LC-R7(set_reservation_shipment_method 오버로드 정리) 로 백로그 등록 예정

[2026-07-27] CRITICAL FIX | 실서비스 예약신청 불가 — return_method 컬럼 Production 누락 수정 | DB 마이그레이션 + 1개 신규 파일 | ✅ DONE
  증상: crazyshot-svelte.vercel.app 실서비스에서 예약신청 시
    "column 'return_method' of relation 'rental_reservations' does not exist" 에러
    로컬(Stage DB 연결)에서는 재현 안 됨
  원인 분석 (Supabase MCP로 Stage/Production 스키마 직접 비교):
    · Stage DB(ezyvffjvuwmtuhpxdjrw): return_method 컬럼 존재 (text, nullable)
    · Production DB(vnbpmvxruyciuuaermyh): return_method 컬럼 완전 누락
    · Stage 마이그레이션 이력에 `147b_add_return_method_to_rentals` 존재 확인
      → 그러나 로컬 supabase/migrations/ 폴더에 해당 파일 없음
      → Production 마이그레이션 이력에도 없음
      → 과거 세션에서 Stage DB에 SQL 직접 실행(정식 마이그레이션 파일 미저장) →
        "Stage 검증 → Production 배포" 절차에서 완전히 누락된 것으로 확인
    · create_hold_reservation RPC 함수는 양쪽 DB 동일 코드 확인 (INSERT 시 return_method 참조)
    · 부수 확인: 159b/159c/159e_create_hold_reservation_* 등도 로컬 파일 없이 Stage 이력에만 존재
      → 단, 최종 함수 정의는 Production과 100% 동일하여 실질 영향 없음
  해결:
    · supabase/migrations/20260727000169_169_add_return_method_column.sql 신규 생성
      (ALTER TABLE rental_reservations ADD COLUMN IF NOT EXISTS return_method TEXT)
    · Stage 적용 (idempotent, 마이그레이션 이력 정합화 목적)
    · Production 적용 — Stephen 명시적 승인 후 실행 (auto mode 분류기 1차 차단 → 재승인 후 진행)
    · Production 컬럼 생성 검증 완료 (information_schema 조회로 text/nullable 확인)
  프로세스 개선 필요 사항: 향후 DB 변경은 반드시 supabase/migrations/ 파일로 먼저 저장 후
    MCP apply_migration으로 적용 — SQL 편집기/MCP execute_sql 직접 실행 후 파일 누락 재발 방지

[2026-07-27] BUG FIX | account/rental 마이페이지 대여 내역 빈 화면 수정 | 1개 파일 수정 | ✅ DONE (브라우저 테스트 확인)
  원인: rental_reservations → orders 조인이 PostgREST 스키마 캐시에 관계 없음
    → "Could not find a relationship between 'rental_reservations' and 'orders'" 에러
    → if (error) return [] 분기 → 빈 화면 표시
  수정: src/routes/account/rental/+page.server.ts
    · orders(order_items(products(...))) 조인 제거
    · product_id FK → products(name, category) 직접 조인만 사용
  검증: 브라우저 직접 테스트 → 3개 대여카드 정상 표시 (Sony FX6-12·Canon RF · 승인완료·스텝퍼 정상)

[2026-07-27] FEAT | 대여 라이프사이클 — 전체 채팅 알림 자동화 + 체크아웃 실데이터 정상화 | 5개 파일 수정 + 2개 신규 | ✅ DONE
  구현 내용 (BL-LC-B2 + checkout fixture):
    BL-LC-B2 완전 해결: 채팅 알림 전 단계 자동화
      - src/routes/api/checkout/notify-hold/+server.ts 신규 생성
        · hold 예약 소유 검증 → send_rental_chat_notification(reservation_hold)
      - src/routes/products/[id]/+page.svelte 수정
        · create_hold_reservation 성공 후 notify-hold API fire-and-forget 호출 (goto 직전)
      - src/lib/components/chat/ActionCard.svelte 수정
        · case 'reservation_hold': "예약 신청 확인" 추가
      - src/routes/cms/reservation/+page.server.ts 수정
        · approveReservation: 승인 완료 후 reservation_approval 자동 발송
        · updateStatus: AUTO_NOTIFY 맵 기반 상태별 알림 자동 발송
          (confirmed/shipped/in_use/return_requested/returned 5종)
    체크아웃 fixture sub-items 차단:
      - src/routes/checkout/+page.svelte 수정
        · subItems: sd.isServerLoaded 시 [] (더미 구성품 2건 제거)
  svelte-check: 기존 17 errors 유지 (신규 에러 0건)

[2026-07-27] FEAT | 대여 라이프사이클 — Mock 자동 예약승인 + 채팅 알림 구현 | 3개 파일 수정 + 1개 신규 | ✅ DONE
  구현 내용 (C-1 + C-2 + B-4):
    C-1 해결: 체크아웃 CTA alert() 더미 → /api/checkout/confirm-mock 연결
      - src/routes/api/checkout/confirm-mock/+server.ts 신규 생성
        · hold 예약 전체 조회 → update_reservation_status(confirmed) → send_rental_chat_notification(reservation_approval)
        · service_role admin client 사용 (RPC REVOKE PUBLIC 대응)
      - src/routes/checkout/+page.svelte 수정 (goto import + isConfirming $state + onclick 교체)
        · 성공: goto('/account/rental') / 실패: csToast.error()
    C-2 해결: 예약승인 채팅 알림 (send_rental_chat_notification fallback 활용)
        · reservation_approval 타입 → ActionCard "예약 승인 확인" 렌더링 (신규 마이그레이션 불필요)
    B-4 해결: 마이페이지 hold 예약 상품명 null
      - src/routes/account/rental/+page.server.ts 수정
        · SELECT에 product_id, products(name, category) 추가
        · orders 경로 1순위 유지 → direct product FK를 2순위 fallback으로 추가
  재검증 결과:
    누락 추가 확인: B-6(redirect 경로 오류) / R-4(CMS 경로 하드코딩) / R-5(RPC 이중화) / UI-M1~M3
    TASK.md BACKLOG 업데이트: BL-LC-B6, R4, R5, UI-M1~M3 추가
  svelte-check: 기존 17 errors 유지 (신규 에러 0건, 수정 파일 오류 없음)
  보존 로직: 기존 orders JOIN 1순위 유지 / canProceed 5조건 완전 보존 / 기존 API 라우트 무변경

[2026-07-26] RESEARCH | 대여 라이프사이클 정밀 감사 (전체 플로우 → 8개 결함 목록화) | ✅ DONE
  감사 범위: 상품 상세→예약신청→예약승인→대여확인→반납요청→반납완료
  발견 결함 8건:
    🔴 CRITICAL (2): 결제 CTA alert 더미(체크아웃 실결제 불가) / Vercel Production env var 36개 누락
    🟡 BOUNDARY (3): log_rental_action RPC 미사용 / 채팅 알림 수동 전용 / 마이페이지 hold 상품명 null
    🟢 ROUTINE (3): 결제 경로 이중화 / 계약서 서명 전환 조건 제한 / 배송방식 하드코딩
  정상 구현 확인: create_hold_reservation / 비로그인리다이렉트 / 체크아웃서버로드 / 전자계약 / 채팅시스템 등
  결과 파일:
  - .claude/harness/learnings/rental_lifecycle_audit_2026-07-26.md ← 상세 내용
  - .claude/harness/TASK.md ← BACKLOG에 BL-LC-C1~R3 7개 항목 추가

[2026-07-25] FEAT+BUG FIX | 상품 상세 구성품(components) 정보탭 노출 + CMS 이미지·isDirty 버그 수정 | 5개 파일 수정 | ✅ DONE
  수정 파일 3종:
  - src/routes/products/[id]/+page.svelte ← 구성품 정보탭 최상단 노출 + CSS 추가
      · productComponents $derived.by() — (product as unknown as {components?}).components → [string, string][] 변환
      · 정보 탭: comp-section 최상단 배치 (구성품 → 상품설명 순서)
      · empty state 오탐 방지: !productComponents 조건 추가
      · CSS: .comp-section/.comp-heading/.comp-list/.comp-item/.comp-item-key/.comp-item-val + 반응형
  - src/routes/cms/products/+page.server.ts ← 자식 상품 선택 시 이미지 업로드 부모 기준 저장 버그 수정
      · sectionType==='images' + selectedProduct.parent_product_id → 부모 ID로 image_urls UPDATE
      · 연관 selectedProduct 로드 로직 조정 (+page.svelte 4줄, new/+page.server.ts 3줄)
  - src/lib/components/cms/ProductDetailPanel.svelte ← 저장 후 isDirty 즉시 비활성 버그 수정
      · origComponentsJson: const → $derived (저장 후 prop 재수신 시 자동 재계산)
      · origSpecsJson: const → $derived (동일 패턴)
  비고: SONY PXW-Z90 구성품 DB 데이터 없음 → CMS 구성품 탭 입력 후 사용자 화면 표시됨
  svelte-check: 기존 기준선 유지 (신규 에러 0건)

[2026-07-23] FEAT | 회원 프로필 개편 + Aligo SMS 연동 + Stage DB 마이그레이션 (#137~#139) | 6개 파일 수정/신규 | ✅ DONE
  수정/신규 파일:
  - supabase/migrations/20260722000139_139_fix_customer_list_no_student_cols.sql ← 신규 (Stage 전용)
  - src/routes/api/profile/send-otp/+server.ts ← Solapi → Aligo REST API 교체
  - .env.local ← ALIGO_API_KEY / ALIGO_USER_ID / SMS_SENDER_PHONE 키 추가 (값 미입력)
  - src/lib/components/members/profile/ProfileTabContent.svelte ← 아바타 + 카드 정보 개편
  - src/routes/account/profile/+page.server.ts ← UserProfile 인터페이스 + SELECT에 created_at 추가
  - src/routes/account/+page.server.ts ← AccountProfile 인터페이스 + SELECT에 created_at 추가
  QA 수정 (sp3-qa-agent):
  - send-otp/+server.ts:15 console.log 제거 (GATE E 기준)
  - ProfileTabContent.svelte:29 KakaoPostcodeCtor 타입 확장 (width/height 옵션 + embed() 메서드)
  DB:
  - Migration #137 Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅ (기적용 확인)
  - Migration #138 Stage ✅ / Production ✅ (기적용 확인)
  - Migration #139 Stage ✅ / Production ⛔ 적용 금지 (Stage 전용 COALESCE 제거 패치)
  미완: ALIGO_API_KEY 등 환경변수 실값 입력 및 Vercel 등록 (Stephen 직접)
  svelte-check: 13 errors (기준선 유지, 신규 0건)

[2026-07-23] MIGRATION | Production DB Migration #132~#135 순차 적용 완료 | supabase/migrations/ | ✅ DONE
  - Migration #132: birth_date 컬럼(IF NOT EXISTS) + phone_otps 테이블 + update_user_profile / verify_and_update_phone RPC (WHERE id 기준) → Production(vnbpmvxruyciuuaermyh) ✅
  - Migration #133: allow_rental_alert / allow_benefit_alert 컬럼(IF NOT EXISTS) + update_notification_settings RPC (WHERE id 기준) → Production ✅
  - Migration #134: is_cms_admin() SECURITY DEFINER + "user_profiles: cms 관리자 전체 조회" RLS 정책 → Production ✅
  - Migration #135: update_user_profile / update_notification_settings RPC WHERE id 교체 (Production 스키마 정합) → Stage + Production ✅
  - account/+page.server.ts: SELECT user_id → id, .eq('user_id') → .eq('id') 코드 수정

[2026-07-23] BUG FIX | Production DB RPC + 코드 정합 (Migration #135 + account/+page.server.ts) | supabase/migrations/20260723000135_135_fix_rpcs_for_production_id_column.sql · src/routes/account/+page.server.ts | ✅ DONE
  - Production user_profiles PK=id (user_id 컬럼 없음) 발견 → RPC 및 클라이언트 쿼리 Production 실패 예방 수정
  - Migration #135: update_user_profile / update_notification_settings RPC WHERE user_id → WHERE id 교체 → Stage + Production 양쪽 적용
  - account/+page.server.ts: SELECT user_id → id, .eq('user_id') → .eq('id') 수정

[2026-07-24] BUG FIX | CMS 옵션상품 탭 upsert UNIQUE 충돌 + image_url 따옴표 수정 | 2개 마이그레이션 신규 | ✅ DONE
  신규 파일 2종:
  - supabase/migrations/20260724000161_161_fix_option_links_image_url.sql
      get_product_option_links RPC: image_urls[1] → image_urls->>0 (JSONB text 추출, 따옴표 제거)
  - supabase/migrations/20260724000162_162_fix_upsert_option_links_conflict.sql
      upsert_product_option_links: soft-delete+재INSERT(UNIQUE 충돌) → 하드DELETE+ON CONFLICT DO UPDATE 멱등 패턴
  코드 변경 (이전 커밋 8da5849 포함):
  - ProductDetailPanel.svelte: 개별 옵션 combo btn localOptions[i].prop → opt.prop (Svelte 5 #{each} 표준)
  - cms/products/+page.server.ts: option_links 로드(get_product_option_links RPC) + save(upsert RPC) 연동
  DB 적용:
  - Migration #161 Stage ✅ / Production ✅
  - Migration #162 Stage ✅ / Production ✅
  "No img" 분석: Manfrotto 055 image_urls=[] (이미지 미등록) → 코드 정상 동작 확인

[2026-07-24] FEAT | 관심상품(찜) 실DB 연동 — WishlistScroll + API 엔드포인트 신규 | 2개 파일 수정/신규 | ✅ DONE
  수정/신규 파일:
  - src/lib/components/account/WishlistScroll.svelte ← 브라우저 supabase.rpc 직접 호출 제거 → /api/wishlist POST fetch 패턴으로 교체 (CMS 브라우저 auth 패턴 준수)
  - src/routes/api/wishlist/+server.ts ← 신규 생성 (toggle_product_wishlist RPC 서버사이드 래퍼 — safeGetSession 인증 + error 반환)
  DB:
  - Migration #158 product_wishlists — Stage(ezyvffjvuwmtuhpxdjrw) ✅ RPC 재적용 완료
  - Migration #158 — Production(vnbpmvxruyciuuaermyh) ✅ 테이블 기존재 확인 + RPC 신규 적용 완료
  배경: account/+page.server.ts(get_user_wishlists) + +page.svelte(items/totalCount 전달)는 이전 세션 완료 상태 확인. 이번 세션은 보안 패턴 수정 + Production DB 적용 완료.

[2026-07-24] BUG FIX + FEAT | 상품 상세 페이지 로직 전면 점검 + 버그픽스 (10개 항목) | products/[id]/+page.svelte · +page.server.ts · CalendarTimePicker.svelte | ✅ DONE
  수정 파일 3종:
  - src/routes/products/[id]/+page.server.ts ← E-1 Boolean캐스트 · E-3 인기상품 price24h 폴백 · E-4 에러로깅
  - src/routes/products/[id]/+page.svelte ← A-1 비로그인 리다이렉트 · A-2 endDate폴백+시간저장 · A-3 startMin/endMin · C-1 is_required qty=1 · D-2롤백(!session 제거) · 필수옵션 hasUnfilledRequired
  - src/lib/components/products/CalendarTimePicker.svelte ← A-3 콜백시그니처 · B-1 sameDayTimeError · reserveDisabled prop · "예약신청" 텍스트
  주요 내용:
  - E-3: 인기 상품 base_price_daily=0 → price_rules 24H 배치 조회 폴백
  - A-1: 비로그인 예약신청 → /auth/login?next=pathname 리다이렉트
  - A-2: endDate 폴백(e.startDate) + set_reservation_shipment_method RPC로 pickup_time/return_time HH:MM 저장
  - B-1: 당일 대여 반납 시각 역전 경고 (sameDayTimeError $derived)
  - C-1: is_required 옵션 초기 qty=1 자동 설정
  - 필수 옵션 미선택 시 예약신청 버튼 비활성화 + 안내 텍스트 분기
  - D-2 롤백: 리뷰 submit disabled에서 !session 제거 (hydration 타이밍 버그 수정)
  - E-2 Skip: optionLinks 빈 배열 = 숫자 ID 상품 설계 의도 (수정 불필요)
  svelte-check: 기존 기준선 유지 (신규 에러 0건 예상, QA 검수 중)

[2026-07-24] FEAT | /account 마이페이지 기능 완성 (찜·대여카드·스텝퍼·로그아웃) | 11개 파일 수정/신규 | ✅ DONE
  수정/신규 파일:
  - supabase/migrations/20260724000158_158_product_wishlists.sql ← 신규 (Stage 적용 완료)
  - src/lib/components/cms/CustomerDetailPanel.svelte ← 빠른문의 탭 콘텐츠 완성
  - src/lib/components/account/WishlistScroll.svelte ← 실DB 연동 + 하트 토글
  - src/routes/account/+page.server.ts ← get_user_wishlists RPC + nested JOIN
  - src/routes/account/+page.svelte ← PC 로그아웃 버튼 추가
  - src/routes/account/rental/+page.server.ts ← product_name/category
  - src/routes/account/rental/+page.svelte ← product-row UI
  - src/routes/account/cancel/+page.svelte ← SubGnb mobileOnly
  - src/lib/components/account/PcRentalPanel.svelte ← product 정보 추가
  - src/lib/components/common/RentalJourneyStepper.svelte ← CSS 다단계 조정
  - src/lib/components/account/MenuSection.svelte ← 로그아웃 버튼 (모바일)
  DB: Migration #158 Stage ✅ / Production ⛔ 보류
  svelte-check: 기존 기준선 유지 (신규 에러 0건)

[2026-07-23] MIGRATION | Migration #146 Stage DB 적용 + TASK-F duration_type 탭 UI | checkout/+page.svelte | ✅ DONE
  - Migration #146: contract_signings.expires_at TIMESTAMPTZ + 기본값 30일 + 인덱스 — Stage DB(ezyvffjvuwmtuhpxdjrw) 적용 완료
  - TASK-F: DurationType='12h'|'24h'|'1day'|'purchase' 타입 추가
  - c1DurType / c2DurType $state (기본값 '24h')
  - cardRate() 헬퍼: 12h→halfday / 24h+1day→daily / purchase→별도 문의(fixture임시)
  - c1CardRate / c2CardRate $derived → fixtureSubtotal 기간유형 반영
  - 두 카드 product-meta: dur-tabs (12H|24H|1일|구매) pill 탭 + 선택 단가 동적 표시
  - purchase 선택 시 가격 '별도 문의' 표시 (실 DB price_rules 연동 예정)
  - svelte-check: 신규 에러 0건 (기존 13건 유지)

[2026-07-21] UI | Front 설정 UI 컴포넌트 정교 재개발 + /products ProductDPCard 교체 | AdminModalShell.svelte · AdminEditButton.svelte · routes/products/+page.svelte | ✅ DONE
  - UI-SHELL: AdminModalShell.svelte CSS 전면 재작성 — 헤더 var(--cs-dark) 배경·흰색 타이틀/닫기, 패널 border-radius(radius-2xl 0 0 radius-2xl)·box-shadow(0.15), 바디 gap 20px
  - UI-BTN: AdminEditButton.svelte CSS 재작성 — border-radius radius-sm(8px), min-height 32px, padding 6px 12px, font-weight 700, hover rgba(16,11,50,0.92)
  - UI-GRID: /products 그리드 d-prod-flat/d-prod-card 인라인 카드 → ProductDPCard 단일 컴포넌트 교체. 잔존 CSS 11선택자 완전 제거. .d-prod-grid justify-content flex-start / gap 24px
  - svelte-check: 신규 에러 0건

[2026-07-23] FEAT | CMS 고객 증명서 타이머 + 재등록 업로드 기능 | CustomerDetailPanel.svelte · api/cms/upload-doc/+server.ts(신규) | ✅ DONE
  - FEAT-TIMER: 본인 증명·외국인 증명 6개월 기간경과 배지 자동 노출
    · 배지 텍스트 "경과" → "기간경과" 변경
    · 등록파일 없거나 기간경과 시 [재등록] 버튼 자동 노출 (양쪽 항목 동일 패턴)
  - FEAT-REUPLOAD: 인라인 재등록 업로드 UI (form 중첩 없이 fetch+FormData 방식)
    · DOC_ACCEPT: PNG·JPEG·WebP·HEIF·PDF 5종 (front-uiux.md §15)
    · validateUploadFile() 클라이언트 MIME 검증 + 이미지 미리보기(createObjectURL)
    · $effect cleanup으로 revokeObjectURL 메모리 누수 방지
    · 성공: csToast.success + invalidateAll() / 실패: csToast.error
  - FEAT-API: /api/cms/upload-doc POST 신규 (CMS manager 전용)
    · hasSettingsAccess() 권한 체크 (50+ manager)
    · service_role 클라이언트 — user-documents 버킷 업로드 + user_profiles 직접 UPDATE
    · 서버사이드 MIME 재검증 (front-uiux.md §15-4)
    · 실패 시 업로드 파일 자동 롤백
  - svelte-check: 신규 에러 0건 (기존 13건 유지)

[2026-07-23] BUG FIX | 회원 프로필 DB 연동 버그픽스 3종 — Stage DB 스키마 정합 | Stage DB(ezyvffjvuwmtuhpxdjrw) 직접 적용 | ✅ DONE
  - BUG-1 CMS 알림설정 미반영: user_profiles RLS `id=auth.uid()` → CMS 관리자 타계정 조회 불가
    · 해결: migration #134 is_cms_admin() SECURITY DEFINER + CMS 전체 SELECT 정책 추가
    · 검증: CMS 알림설정(대여예약/혜택) 배지 정상 반영 확인
  - BUG-2 CMS 배송지 미표시: PostgREST schema cache stale → get_user_shipping_addresses RPC 400
    · 해결: `NOTIFY pgrst, 'reload schema'` 실행
    · 검증: cconzy@daum.net 배송지 4개 CMS 정상 표시 확인
  - BUG-3 생년월일 저장 불가: Stage DB에 migration #132(update_user_profile RPC) 미적용
    · 해결: migration #132 Stage DB 직접 적용 (update_user_profile + verify_and_update_phone + phone_otps 테이블)
    · 검증: 생년월일 저장·CMS 반영 정상 확인
  - BUG-4 Stage DB 스키마 정합: user_profiles PK=id (vs Production PK=user_id) → user_id 기준 쿼리 전체 실패
    · 해결: user_id UUID 컬럼 추가 + id 값 동기화 트리거(trg_sync_user_id) 적용
  - 참고: #132~#134는 Stage에만 직접 적용. Production 마이그레이션은 별도 진행 필요.

[2026-07-21] MIGRATION | CMS 대여관리 설정 Migration #126~130 Production DB 적용 | vnbpmvxruyciuuaermyh | ✅ DONE
  - 126a: pickup_points 테이블 신규 생성 (Production 자체 누락 확인 후 선행 적용)
  - 126: pickup_points.contact_person VARCHAR(10) + rental_period_options / rental_method_options / rental_guide_settings / rental_consent_items 4개 테이블 생성 + RLS + 트리거
  - 127: RPC 12종 (upsert_rental_period_option / delete / reorder × 3 도메인, upsert_pickup_point / delete, upsert_rental_guide, upsert_rental_consent_item / delete / reorder)
  - 128: upsert_rental_guide — UPDATE rental_guide_settings WHERE id IS NOT NULL (PostgREST WHERE 없는 UPDATE 차단 수정)
  - 129: check_rental_period/method/pickup_in_use 3종 (placeholder RETURN FALSE)
  - 130: 동 3종 실제 구현 — products.allowed_period/method/pickup_ids @> ARRAY[p_id] UUID 배열 포함 체크
  - 최종 검증: 테이블 5종 + RPC 15종 Production DB 존재 확인 완료

[2026-07-21] FEAT | CMS 상품 '구성품' 기능 추가 (Migration #128 + 5개 파일) | supabase/migrations/20260721000128_128_products_components_column.sql · cms/products/new/+page.svelte · cms/products/new/+page.server.ts · lib/components/cms/ProductDetailPanel.svelte · cms/products/+page.server.ts | ✅ DONE
  - Migration #128: products.components JSONB 컬럼 추가 → Stage + Production 양 DB 적용 완료
  - new/+page.svelte: components $state + addComponent/removeComponent/serializeComponents 함수 + hidden input + UI 블록 (기술스펙 위 배치, .spec-list/.spec-row CSS 재사용)
  - new/+page.server.ts: components JSON.parse + INSERT 포함
  - ProductDetailPanel.svelte: TabKey/TABS에 'components' 추가 ('상품설명' 탭 우측), localComponents $state + isDirtyComponents $derived + 4종 함수, CmsDragList 재사용 탭 콘텐츠, ProductWithComponents 로컬 타입 캐스팅(database.ts 미수정)
  - products/+page.server.ts: updateSection sectionType==='components' 케이스 추가
  - svelte-check 신규 오류 0건 / Stage DB 직접 테스트로 저장·조회 정상 확인

[2026-07-20] FIX+UX | Crazylog 작성/뷰 페이지 UX 개선 + 태그·이미지 버그픽스 | crazylog/[slug]/+page.svelte · view/[slug]/+page.svelte · view/[slug]/+page.server.ts · CmsContentEditor.svelte · CrazylogWriteCard.svelte · src/app.css | ✅ DONE
  - UX-1: 작성 모바일 사용자 카드 한 행 재정렬, 아바타 1.2배(53px), 폰트 토큰 정렬, wc-name 모바일 숨김
  - UX-2: 모바일 옵션 카드 m-toggle-label 컬러 → --cs-text-mid (PC 동일)
  - UX-3: 모바일 폼(m-user-card/m-select/m-input/m-submit) 패딩 10% 증가, 제출버튼 전폭+18B
  - UX-4: PC 에디터·사이드바 폰트 토큰 7곳 업그레이드 (d-select-label/d-input/d-submit/d-user-name/d-stat-label/d-stat-value/kw-tag)
  - BUG-1: 뷰 페이지 태그 누락 — server.ts keywords 쿼리 추가 + PC·모바일 태그 렌더링 신규 추가
  - BUG-2: 뷰 페이지 이미지 좌측 쏠림 — .d-content-images/.d-content-img CSS 신규 추가
  - UX-5: 뷰 PC 내비바 내비명 우측 끝 배치 (order:3), --text-pc-menu-kr-20, --cs-text-mid
  - UX-6: CrazylogWriteCard 쓰기 버튼 아이콘 제거+--cs-purple-dark BG, 삭제 버튼 --cs-red-xlight(신규 토큰 #FFE7E7)

[2026-07-20] FIX+FEAT | /crazylog/list UI 픽스 + 디자인 토큰 정렬 + 멤버십 배지 전역 방어 | list/+page.svelte · list/+page.server.ts · src/app.css · membership.ts(신규) · CrazylogWriteCard.svelte · crazylog/+page.svelte · crazylog/+page.server.ts · view/[slug]/+page.server.ts · [slug]/+page.server.ts | ✅ DONE
  - FIX-1: 모바일 카드 썸네일 미노출 → m-post-thumb + m-post-thumb-img 추가
  - FIX-2: 폰트 하드코딩 6곳 → CSS 토큰 교체 + --text-m-tag-11 · --text-pc-tag-11 신규 등록
  - FIX-3: NONE 배지 노출 → resolveGrade() 헬퍼(membership.ts) 신규 생성, 서버 3곳 + 컴포넌트 이중 방어
  - FEAT: /crazylog 메인 PC 카드 → /list 구조 동기화 (log-type 레이블 + 날짜·작성자 + gap 20px + 토큰)

[2026-07-20] FEAT | SuggestPicker 공통 컴포넌트화 + 디자인 시스템 등록 | src/lib/types/suggest-picker.ts(신규) · src/lib/components/common/SuggestPicker.svelte(신규) · CmsSuggestPicker.svelte(shim) · cms-suggest-picker.ts(shim) · ProductCategoryModal.svelte · ProductHeroModal.svelte · cms/products/new/+page.svelte · .claude/rules-ref/cms-uiux.md · .claude/rules-ref/front-uiux.md · .claude/rules/uiux-index.md | ✅ DONE
  - 신규: SuggestPickerOption · SuggestPickerVariant 타입 → suggest-picker.ts 단일 소스
  - 신규: SuggestPicker.svelte 공통 컴포넌트 (noFilter / renderItem 스니펫 / itemLayout / variant props 추가)
  - re-export shim: CmsSuggestPicker.svelte → SuggestPicker 위임 / cms-suggest-picker.ts → suggest-picker.ts re-export (구경로 호환)
  - 호출처 2곳 import 공통 경로 교체: ProductCategoryModal · cms/products/new
  - ProductHeroModal: 수동 .suggest-layer/.suggest-item 구조 → SuggestPicker(noFilter+itemLayout="row"+renderItem) 교체, ~50줄 수동 CSS 제거
  - 디자인 시스템 업데이트: cms-uiux.md §7-7-2+§12 / front-uiux.md §12 신규 / uiux-index.md 공통 컴포넌트 표 추가
  - svelte-check: 0 ERRORS (기존 crazylog/[slug] pre-existing 5건 제외 확인)

[2026-07-20] FIX+FEAT | Crazylog 보류 기능 재배치 — view 버튼 제거 + 수정화면 토글 이동 | crazylog/view/[slug]/+page.svelte · crazylog/[slug]/+page.svelte · crazylog/list/+page.server.ts | ✅ DONE
  - view/[slug]: d-navi-actions + m-admin-bar 내 "보류 처리" 버튼 제거
  - [slug] 수정화면 PC: "공개설정" 헤딩 우측에 보류 토글 배치 (d-opts-heading-row)
  - [slug] 수정화면 모바일: "로그 공개" 토글 → "보류(목록 숨김)" 토글로 교체
  - 보류 ON = isPublic=false → p_is_public:false 전달 (기존 create/update RPC 그대로 활용)
  - list/+page.server.ts: 로그인 작성자 본인 보류 포스트 목록 노출 (.or() 조건 추가)

[2026-07-20] FIX+FEAT | Crazylog avatar_url 버그 수정 + 사용자 정보카드 컴포넌트화 | crazylog/[slug]/+page.server.ts · list/+page.server.ts · view/[slug]/+page.server.ts · list/+page.svelte · view/[slug]/+page.svelte · CrazylogWriteCard.svelte(신규) | ✅ DONE
  - FIX-3: 3개 page.server.ts SELECT에 존재하지 않는 avatar_url 컬럼 포함 → PostgREST 쿼리 전체 실패 → profileRaw=null → '익명' fallback 표시
  - 해결: 3개 파일 모두 avatar_url 제거, avatarUrl: null 고정 반환
  - Stage DB: user_profiles.full_name 'Stephen' → '이기성' 업데이트 (steven@pseries.net)
  - FEAT: CrazylogWriteCard.svelte 신규 생성 (src/lib/components/common/)
    Props: currentUser / isLoggedIn / visible / postId? / isOwner? / deleteBusy? / onDelete?
    list/+page.svelte + view/[slug]/+page.svelte 인라인 마크업·CSS 225줄 제거 → 컴포넌트 1줄 호출로 단일화

[2026-07-20] FIX | Crazylog 글등록 무반응 버그 + 토글 UI 픽스 | src/routes/crazylog/[slug]/+page.svelte | ✅ DONE
  - FIX-1(무반응): handleSubmit() 내 csToast.warning() → errorMsg 할당으로 교체 (사용자 화면에 <Toaster> 미등록 → toast 무음 실행 = 무반응)
  - FIX-2(토글 크기): .m-toggle content-box + padding-block:12px + negative-margin 터치 타겟 핵(배경이 44px 높이로 늘어나는 시각 왜곡) → border-box + position:relative / thumb absolute top:2px left:2px + translateX(16px) 패턴으로 교체 (cms-uiux.md Section 7-8 표준)
  - 토글 width 32px→36px, off 배경 --cs-text-dark→--cs-disabled-toggle 정정
  - unused import { csToast } 제거

[2026-07-20] FEAT | Crazylog 헤드이미지 지정 기능 (롱프레스 2초) | content-editor.ts · CmsContentEditor.svelte · crazylog/[slug]/+page.svelte · crazylog/view/[slug]/+page.svelte | ✅ DONE
  - content-editor.ts: ImageItem.isHead?: boolean 추가
  - CmsContentEditor: longPressTimers + startLongPress/cancelLongPress/setHeadImage 3종 함수, .thumb-img-wrap + head-badge CSS
  - [slug]/+page.svelte: blocks 순회 → headImageUrl 추출 → create/update RPC p_thumbnail_url 전달
  - view/[slug]/+page.svelte: PC/모바일 이미지 블록 filter(!img.isHead) → 본문 중복 방지
  - svelte-check: 0 ERRORS, 238 WARNINGS (기존 유지)

[2026-07-20] FEAT | crazylog 메인·목록 DB 연동 + 플로팅 write-card | +page.server.ts(crazylog) · list/+page.server.ts · list/+page.svelte | ✅ DONE
  - crazylog/+page.server.ts 신규 생성: Promise.all 병렬(카운트 3종 + 포스트 30개) → shuffleArray → 10개 슬라이스
  - extractFirstImageUrl / extractFirstText / BAR_COLORS 헬퍼 (content_blocks JSONB 파싱)
  - list/+page.server.ts: safeGetSession → user_profiles 조회 → LV.1~LV.5 계산 → isLoggedIn/currentUser 반환
  - list/+page.svelte: writeCardVisible $state + $effect 스크롤 핸들러 + write-card HTML(아바타·이름·레벨·쓰기버튼) + CSS
  - 브라우저 정상 확인: 인덱스 바(상품리뷰:2/일상공유:1/채널홍보:0) + 포스트 카드 + 플로팅 카드

[2026-07-20] FIX | Migration 재번호 #123→#124 (product_reviews) | supabase/migrations/ | ✅ DONE
  - 20260720000123_123_product_reviews.sql 삭제 (product_page_keywords #123과 번호 충돌)
  - 20260720000124_124_product_reviews.sql 신규 생성 (동일 내용, 번호만 변경)
  - Production(vnbpmvxruyciuuaermyh) product_reviews 존재 확인 (이전 세션에서 이미 적용됨)
  - TASK.md T-123-A → T-124-A 참조 수정

[2026-07-20] FEAT | Migration #123 + 상품 키워드 설정 (ProductCategoryModal) | migration #123 · ProductCategoryModal · +page.svelte | ✅ DONE
  - 123: cms_settings product_page_keywords 기본값 + upsert/get RPC 확장
  - ProductCategoryModal.svelte: 키워드 설정 UI 추가 (CmsSuggestPicker, 최대 10개)
  - products/+page.svelte: displayKeywords $derived (DB 우선, fallback 폴백)
  - Stage + Production 적용 완료

[2026-07-20] FIX | Crazylog view/[slug] 모바일 이미지 리사이징 + 댓글폼 수정 | src/routes/crazylog/view/[slug]/+page.svelte | ✅ DONE
  - FIX-1: 본문 이미지 원본 크기 넘침 버그 → .article-images + .m-article-img CSS 추가 (width:100%, height:auto, object-fit:contain)
  - FIX-2: 댓글 폼 placeholder text-align: center → left / 텍스트 → '후기를 등록해 주세요.'
  - /crazylog 카드 목록: 최신 30개 셔플 → 10개 슬라이스 + view/{id} 링크 연동 완료 (이전 세션 완료)

[2026-07-20] FEAT | Migration #123 + 상품 후기 기능 구현 | +page.server.ts · +page.svelte · migration #123 | ✅ DONE
  - 123: product_reviews 테이블 + RLS 2정책 + create_product_review RPC (SECURITY DEFINER) + get_product_reviews RPC
  - Stage(ezyvffjvuwmtuhpxdjrw) + Production(vnbpmvxruyciuuaermyh) 적용 완료
  - +page.server.ts: safeGetSession + get_product_reviews RPC 로드 → session/reviews 반환
  - +page.svelte: MOCK_REVIEWS 제거, 실제 reviews 연결, 단일 textarea 폼 (제목 자동추출 10자), 낙관적 업데이트
  - 비로그인 클릭 → /auth/login 리다이렉트
  - 토큰 위반 4건 수정: #e1def3→var(--cs-purple-op10), #553FE0→var(--cs-purple-light), 하드코딩 font→var(--text-m-body-16L)
  - 고아 CSS 정리: .review-inputs-col / .review-title-input (폼 개편 후 미사용)

[2026-07-20] MIGRATION | Migration 118~122 Production 반영 | vnbpmvxruyciuuaermyh | ✅ DONE
  - 118: product_page_settings + RPC 3종 (get_product_page_settings, upsert_product_page_setting, get_products_by_ids)
  - 119: user_posts log_type 3종 제한 CHECK + thumbnail_url 컬럼 추가
  - 120: post_comments 테이블 생성 + RLS + create_post_comment RPC
  - 121: create_user_post / update_user_post p_thumbnail_url 파라미터 추가 (구버전 DROP+재생성)
  - 122: delete_own_post RPC (소프트 삭제, SECURITY DEFINER)

[2026-07-19] FIX | ProductHeroModal 버그 수정 + UI 통일 | ProductHeroModal.svelte | ✅ DONE
  - Fix 1: $effect + get_products_by_ids → 저장 상품 복원 (항상 빈 목록 버그)
  - Fix 2+3: doSearch 내 product_id→id, price_min→base_price_daily 정규화
  - Fix 4+5: 검색 UI → f-input + suggest-layer (CmsSuggestPicker 시각 규격 통일)
  - ProductMdPickModal 자동 수혜 (wrapper) / svelte-check 0 ERRORS / 로컬 확인 완료

[2026-07-15] GSD | /products 페이지 DB 연동 + CMS 하이브리드 UI | migration 118 · +page.server.ts · +page.svelte | ✅ NOW-1~3 DONE
  - NOW-1: supabase/migrations/20260715000118_118_product_page_settings.sql (신규)
    * cms_settings 4키 기본값 삽입 (ON CONFLICT DO NOTHING)
    * get_product_page_settings() RPC (STABLE, SECURITY DEFINER, anon 허용)
    * upsert_product_page_setting(TEXT, JSONB) RPC (is_cms_user() 검증)
    * get_products_by_ids(UUID[]) RPC (anon 허용)
  - NOW-2: src/routes/products/+page.server.ts (신규)
    * isCms: user_profiles.cms_role 확인
    * 병렬 로드: categories + heroProducts + gridProducts + mdProducts
    * TypeScript 에러 0 (svelte-check 통과)
  - NOW-3: src/routes/products/+page.svelte (리팩터링)
    * 기존 UI/CSS/DOM 구조 100% 보존
    * DB 데이터 교체 + 정적 폴백 유지
    * admin 오버레이 버튼 4종 + 모달 placeholder 추가
    * 0 TypeScript errors (224 warnings — 기존 파일)
  - NOW-4 완료: src/lib/components/products/admin/ 4종 신규
    * ProductCategoryModal.svelte — 카테고리 목록 + 활성 상태 표시
    * ProductHeroModal.svelte — 상품 검색/CmsDragList + mode 라디오
    * ProductGridModal.svelte — 카테고리 칩 + 수량/정렬 라디오
    * ProductMdPickModal.svelte — HeroModal 재사용 (settingKey prop 전달)
    * +page.svelte: placeholder → 실제 컴포넌트 + unused CSS 제거
    * 최종 svelte-check: 0 ERRORS, 231 WARNINGS

[2026-07-14] ROUTINE | PRD v1.7 작성 + 하네스 연동 | CRAZYSHOT_PRD_v1.7.md · CLAUDE.md · HANDOFF.md | ✅ DONE
  - PRD v1.6 → v1.7 업그레이드: plannode v1.44(205노드) → v1.60(552노드), DB 24→53 테이블
  - S1-M2.5·PRD.1.7 완료 반영, S1-M3 BLOCKED(Realtime WebSocket SSR) 기록
  - CMS 모듈(accounts·codes·login·chat) + 검색 인프라 + Members 모듈 추가
  - 위험 항목 2개 신규: Realtime SSR 블로커, database.ts 타입 갭(25/53 테이블)
  - CLAUDE.md 현재 진행 상태 업데이트, HANDOFF.md 참조 문서 섹션 추가

[2026-05-29 14:30] SETUP | S0-2 Database Schema | migrations 001-005 | 15m | ✅ SUCCESS
  - 001_initial_schema: 10 테이블 생성 (DDL)
  - 002_rls_policies: 24 RLS 정책 (모든 테이블)
  - 003_rpc_functions: 9 RPC 함수 (atomic ops, payment, subscription)
  - 004_rpc_search_path_fix: Security advisor 경고 수정
  - 005_seed_subscription_plans: 3 subscription plans 시드
  - Supabase TypeScript types 생성 → src/lib/types/database.ts

[2026-05-29 15:00] SETUP | S0-3 Supabase Client | src/lib/services, src/lib/stores | 20m | ✅ SUCCESS
  - Supabase client singleton (src/lib/services/supabase.ts) with RPC wrappers
  - Auth state store (src/lib/stores/auth.ts) with performSignUp/In/Out
  - Auth state auto-initialization in +layout.svelte
  - ESLint v10 migration (.eslintrc.cjs → eslint.config.js)
  - All H-01~H-06 harness rules compliance verified
  - npm run harness:check ✅ (ESLint + TypeScript passing)

[2026-05-29 15:30] GSD | S1-M1 Products Module | src/routes/products/ | 15m | ✅ SUCCESS
  - Product listing page (src/routes/products/+page.svelte) with search/category filter
  - Product detail page (src/routes/products/[id]/+page.svelte) with reservation form
  - Database migration 006: 8 products, 9 assets seeded (cameras, lenses, audio, lighting, tripod)
  - Asset availability counter & condition badges
  - RPC-based reservation (H-01 compliant: no direct INSERT)
  - Responsive grid layout with pricing display
  - All H-01~H-06 harness rules verified ✅

[2026-05-29 16:00] TDD | S1-M2 Reservation Flow | src/__tests__/, src/lib/services/ | 25m | ✅ RED/GREEN PHASE
  - Reservation helper functions (src/lib/services/reservationHelper.ts)
  - 27 passing unit tests (RED/GREEN phase complete)
  - Date validation: Format, range, overlap detection
  - Rental period classification (daily 1-7d, weekly 8-30d, monthly 31+d)
  - State machine: Valid transitions, terminal states
  - Input validation: Product ID, dates, comprehensive error messages
  - Price calculation: Daily/weekly/monthly with flexible discounts
  - Integration test framework (src/__tests__/services/reservation.test.ts)
  - All H-01~H-06 harness rules verified ✅

[2026-05-29 17:30] REFACTOR | S1-M2 Reservation Flow Integration | src/routes/products/[id]/+page.svelte | 45m | ⏳ IN PROGRESS
  - Integrated reservation helper functions into product detail page
  - Added real-time price breakdown display with rental period classification
  - Implemented validation using validateReservationInput() helper
  - Price display shows: rental days, subtotal, discount (if applicable), final amount
  - Button state management: disabled until valid dates selected
  - Enhanced date input with min/max constraints
  - Fixed linting errors (unused imports in product detail page)
  - Created vitest setup for test user authentication (src/vitest.setup.ts)
  - 🔴 BLOCKED: Supabase Realtime WebSocket issue in SSR environment
  - Node.js 20 requires ws package as transport, but not provided during Vite SSR
  - Unable to test UI changes due to 500 Internal Server Error on dev server
  - Attempted fixes: hooks.server.ts polyfill, conditional initialization - all failed
  - Recommend: Implement lazy client initialization or provide ws transport at startup

[2026-06-28] FIX | Cursor AI 손상 복구 + CMS 초대링크 완성 | 20+ 파일 | ✅ SUCCESS (커밋 fed4fdb, 7f3dd76)
  - [복구] supabase.ts: createBrowserClient 복원 (browser 분기 패턴)
  - [복구] API 라우트 5개: PUBLIC_SUPABASE_URL 원복 (chat/session·message·admin-reply·admin-attachment·sessions)
  - [복구] auth.ts onAuthStateChange cleanup 복원
  - [마이그레이션] Migration 49: handle_new_user anon 500 수정 → Stage DB 적용 완료 / Production 미적용
    · 파일: supabase/migrations/20260628010049_49_fix_handle_new_user_anon.sql
    · 주의: Stage 적용 버전 20260627151934 ≠ 파일 타임스탬프 20260628010049 (MCP 먼저 적용)
  - [CMS] 초대링크 흐름 완성: accounts(초대링크 정보 화면) + login(비밀번호 설정 폼 + setPassword 액션)
  - [UI] CMS 영역 채팅 FAB 제거 (/cms/* 경로 조건 추가)
  - [UI] FAB z-index 200 상향 → checkout 하단바 가림 해소
  - [UI] 계정목록 컬럼 퍼센트 기반 균등 배분 (col-email auto → 22%)
  - [학습] .claude/harness/learnings/migration_schema_2026-06-28.md 생성
  - [학습] .claude/harness/SUPABASE_DB.md 현행화 (마이그레이션 현황 + 이슈 이력 추가)

[2026-06-27] INCIDENT | Cursor AI 손상 — supabase.ts createBrowserClient 교체 | src/lib/services/supabase.ts | ❌ ROLLBACK
  - 커밋 89e427b: Cursor가 createBrowserClient → createClient 싱글톤으로 변경
  - 증상: 채팅 세션 401 Unauthorized (쿠키 세션 공유 단절)
  - 원인: frozen boundary 미설정, Cursor가 설계 맥락 없이 "통일" 판단
  - 조치: fed4fdb 원복 (createBrowserClient 복원 + API 라우트 PUBLIC_SUPABASE_URL 원복)
  - 학습: learnings/misidentifications.md HOOK-7 기록

[2026-06-28] FIX | 혼성 AI 협업 정합 — SSOT 통합 + Frozen Boundary 설정 | .claude/harness/, .cursor/ | ✅ SUCCESS
  - AI_COLLAB_PROTOCOL.md 신규 (A~F 원칙 + frozen 목록 + 커밋 체크리스트)
  - HANDOFF.md 신규 (5필드 초기화)
  - CURSOR_START.md 경로 교체 (.cursor/harness/* → .claude/harness/*)
  - crazyshot-system.mdc SSOT 통합 ("독립 운영" 제거)
  - PORTABILITY.md crazyshot 예외 절 추가
  - domain-frozen-boundary.mdc 신규 (Cursor frozen 파일 접근 차단)
  - ROLLBACK_LOG.md 3건 소급 기록
  - misidentifications.md 1건 기록
  - TASK.md CONTEXT BRIDGE frozen 목록 + baseline 추가

[2026-07-14] AUDIT | CMS 전역 DB 고아·로직 이상 정밀 진단 | Production DB (vnbpmvxruyciuuaermyh) | ✅ 완료
  - 7개 영역 전수 검사 (상품/예약/주문/프로모션/코드/채팅/계정)
  - 고아 데이터: product_code_sequences TRI·LIG 2건 삭제 (production)
  - 기능 이상 3종 확인 (콘텐츠 미완성, 구조 이상 아님):
    · 상품 8건 slug = NULL (상품 상세 URL 불가)
    · 상품 8건 price_rules 없음 (예약·결제 불가)
    · 자산 9건 asset_code = NULL (QR 코드 연동 불가)
  - 아키텍처 주의: products.category(소문자) ↔ product_category_codes.code(대문자) 별개 운영
  - 스키마 주의: payment_transactions.order_id TEXT — Toss order key 저장 설계, 실데이터 0건
  - 정상 영역: 예약/주문/프로모션/채팅(anon 23건 정상)/계정 고아 0건

  Migration 109~116 (CMS 성능 + 통합 검색) Stage→Production 적용 완료:
  - 109: rental_reservations.product_id 인덱스
  - 110: user_profiles trgm 인덱스 + created_at 정렬
  - 111: rental_reservations 복합 인덱스 (created_at / status_dates / user_created)
  - 112: chat_messages·products 복합 인덱스
  - 113: products search_vector (FTS) + trgm 인덱스 + 백필
  - 114: search_logs·product_search_stats 테이블 생성
  - 115: search_products RPC (3단계 검색 + AI 학습 루프)
  - 116: mv_active_products_by_category·mv_top_search_terms MV + pg_cron 3개
  수정 파일:
  - src/lib/services/searchService.ts (신규): image_url 필드명 수정 (thumbnail_url→image_url)
  - src/routes/api/search/products/+server.ts (신규): 통합 검색 API 엔드포인트
  BACKLOG:
  - supabase gen types 재생성 (searchService.ts (supabase.rpc as any) 해소)
  - migrations 113~116 ROLLBACK 주석 추가
  - Stephen git commit/push + Vercel 배포

[2026-07-15] PUBLISHING | Crazylog view/[slug] QA 재검수 통과 | src/routes/crazylog/view/[slug]/+page.svelte | ✅ GATE E PASS
  - m-post-more <div> → <button> + min 44×44px 터치 타겟 (최종 잔류 이슈 해결)
  - PC 후기(댓글) 섹션 추가 (.d-comments — 목록 3개 + 입력폼)
  - 모바일 히어로 재생버튼 중앙 정렬 + hover scale 트랜지션 추가
  - PC hover scale 트랜지션 <svelte:head> global CSS 정합 완료
  - PC 댓글 섹션 max-width 1240px 오버플로우 버그 수정
  - CSS 변수 전환 (5종 하드코딩 hex 제거)
  - list/+page.svelte :global() → $effect + body class + <svelte:head> 패턴 교체
  - TS 에러 0 / console.log 0 / :global() scoped 0

[2026-07-14] BOUNDARY | Crazylog 작성 화면 퍼블리싱 | src/routes/crazylog/ | ✅ GATE E PASS
  - [slug]/+page.svelte: Mobile UserInfoCard(m-user-card) + ContentOptions(m-content-options) 추가
    · State 초기값 수정: memberPublic/cafeScrap/aiSave = true (Figma defaultChecked)
    · CSS 토큰: --cs-purple→red-badge 그라디언트 / --cs-purple-op10 / --cs-purple-light / --radius-lg / --radius-full
    · 터치 타겟: m-check-row min-height 44px / plus 아이콘 a 태그 44px
    · TODO 주석 제거 → BACKLOG(BL-CRAZYLOG-SUBMIT) 이관
  - +page.svelte: 헤더 카드 plus SVG → <a href="/crazylog/new" aria-label="로그 작성"> 래핑 (3개 섹션)

[2026-06-26] GSD | PRD.1.7 T5~T8 | src/routes/api/chat/, src/lib/components/chat/, src/routes/+layout.svelte | ✅ SUCCESS
  - T5: API 라우트 5개 (session / message[Claude AI 의도분류] / sessions / action-card / close)
    · ANTHROPIC_API_KEY → $env/static/private (H-05 준수)
    · const db = locals.supabase as any (chat 테이블 미생성 타입 우회)
    · claude-haiku-4-5, confidence < 0.6 → CS_ESCALATE 강제
  - T6: UI 컴포넌트 5개 (ChatHeader / MessageBubble / ActionCard / MessageList / ChatInput)
    · Svelte 5 Runes ($props, $state, $derived, $effect)
    · CSS 변수 전용 (--cs-purple, --cs-lilac, --cs-points 등)
  - T7: 컨테이너 3개 (ChatWindow / ChatBottomSheet / FloatingChatButton)
    · FloatingChatButton: fab-btn 패턴 (dev/cart 동일), 커스텀 SVG 아이콘
    · ChatBottomSheet: mobile bottom-up / PC bottom-right 반응형
  - T8: +layout.svelte fab-bar 삽입
    · SSR 오류 수정: chat.ts → chat.svelte.ts (class 패턴 $state 필드)
    · $authState.user 조건부 렌더링 (비로그인 시 숨김)
    · FloatingChatButton SVG Stephen 확정 디자인 적용
