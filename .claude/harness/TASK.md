# .claude/harness/TASK.md — 활성 태스크 (Harness Flow v3.2)

> ⛔ **2026-09-24 인덱싱 분리**: 이 파일은 "진행중·상시(BLOCKED/BACKLOG/NEXT/GATE C)·최근 3일 완료" 블록만 보관한다.
> 전체 블록 목록·검색은 **`TASK_INDEX.md`** → 월별 `archive/TASK_ARCHIVE_*.index.md` → 본문 `archive/TASK_ARCHIVE_*.md` 순으로 찾는다.
> 완료 판정 기준은 기존과 동일 — 헤더 접두사(`## NOW` / `## DONE`)만이 유일한 기준. 새 태스크는 이 파일 최상단에 추가하고, 완료 즉시 `## DONE`으로 바꿔 쓴 뒤 정리 시점에 아카이브로 이동한다.

## DONE — 🟢 ROUTINE: 상품 화면 PC 반응형 정비 — /products 히어로 슬라이드 부드러운 전환 + /products/[id] 결합목록 title-card 아래 배치 (2026-09-24, 이 세션'만', ✅ sp3-qa-agent 조건부 통과 — 블로킹 결함 0건, git commit만 Stephen 대기)

### 구현 내역
1. `src/routes/products/+page.svelte` — PC 히어로 슬라이더에 `svelte/transition` `fly`(x ±80, 300ms) + `{#key dPage}` 적용, `dDirection` 상태로 이전/다음/도트 방향 결정, `.d-slider-cards`를 absolute 겹침 구조로 변경(모바일 슬라이드는 무변경).
2. `src/routes/products/[id]/+page.svelte` — 결합상품(`bundleSection()` 스니펫, 이름+썸네일만·요금/수량 없음)을 PC에서 `.info-left`의 title-card 바로 아래 `.bundle-pc-slot`(≥641px 전용, `bundleItems.length>0`일 때만 렌더)로 이동하고 `.info-right`의 PC 사본 제거. 모바일은 `.options-mobile-slot` 내 기존 위치·비율 유지.

### QA 결과(sp3-qa-agent)
조건부 통과. Svelte5 문법·모바일 회귀·0개 시 빈 간격·요금/수량 미노출·범위 외 수정 모두 통과. 정정: 1번(/products 슬라이더)은 이미 커밋 e831ad8에 포함돼 이번 working tree diff 없음. 2번 파일은 결합상품 Phase1·2의 타 변경과 한 파일에 섞여 있어 분리 커밋 불가(함께 커밋). 경미: 죽은 클래스 `.bundle-mobile-only` → 제거 완료.

### 검증
svelte-check 신규 오류 0건(기존 vite.config.ts 1건 무관). 슬라이드 부드러움·결합목록 실화면은 Stephen 직접 확인 대기. DB·RPC·로직 무변경. git commit은 Stephen 직접 실행.

## DONE — CMS DetailPanel 버튼·입력 UI 표준화 일괄 정비(고객상세·대여상세) (2026-09-24, 이 세션'만')

### 배경
Stephen이 `<launch-selected-element>`로 CustomerDetailPanel·RentalDetailPanel의 버튼/입력 영역을 순차 선택하며 "cms 표준 디자인 시스템 지침 반영" 요청. 매 건 cms-uiux.md §0-10를 실제 Read해 값을 복사·대조(CLAUDE.md UI 5단계). 순수 CSS/마크업 변경 — DB·RPC·로직 무변경.

### 구현 내역
**CustomerDetailPanel.svelte**
- 본인증명·외국인증명 "승인"(`.btn-approve`): 초록 틴트 사각 → 회색 채움 라운드 사각형(`--cms-radius-sm` 10px, 12px/700, padding 8px 14px, min-width 78px, 우측 끝 `margin-left:auto`, 호버 배경↔글자 반전). 배지("승인완료")와 구분되는 규격을 **cms-uiux.md §0-10-F "DetailPanel 실행 버튼"으로 신규 등록**
- 기본정보 "생년월일"·"가입일": 브라우저 기본 `input[type=date]` → 표준 달력 `CmsDatePicker`(name 지정 시 hidden input 동반이라 저장·dirty 비교 무변경), 미사용 `.info-input[type="date"]` CSS 제거
- "회원 삭제"(`.act-del-account`): §0-10 danger 규격(40px·radius 8px·0 20px·14px/700, 배경 danger-50 `--cs-chat-in-bg`/글자 `--cs-red-badge`, 호버 시 짙은 레드↔흰 글자 반전). 공유 `.act-del`은 건드리지 않고 복합 셀렉터로 명시도 확보
- 구독이력 카드: "구독상품 상세 →" 링크를 배지 줄에서 분리해 "결제내역 보기" 위 별도 줄로 이동, "결제내역 보기"(좌)·"구독 취소"(우)를 `.sub-footer-row`(align-items:center)로 수직 중앙 정렬(토글의 기존 `align-self:flex-start` 오버라이드)

**RentalDetailPanel.svelte**
- "운송장 저장"(`.btn-tracking-save--sm`): pill → §0-10-F 규격, "운송장 정보" 제목행↔입력박스 사이 12px 분리 여백(`.rental-shipping-group .section-title-row`)
- 예약 단계 "승인하기"(`.btn-primary`) 36→44px(ctaPrimaryPurple), "거부"(`.btn-danger-sm`)를 승인 버튼과 동일 규격(44px/radius 15px/14px/700)으로 통일 — **최초에 danger 행(40px/8px)을 적용해 짝 버튼과 불일치했던 것은 제 판단 실수, 이후 정정**. 전역 `.cms-shell .btn-primary`(네이비·padding 30px)가 스코프 규칙과 명시도 동률로 이겨 퍼플 토큰이 무효화되던 것을 `.action-section .btn-primary`로 명시도 상승(!important 미사용)해 기존 퍼플 유지. hold 상태 승인/거부 그룹만 `class:action-section-end`로 우측 정렬(다른 상태 액션행 무영향), 행 `align-items:center`

**cms-uiux.md**: §0-10-F "DetailPanel 실행 버튼" 신설, §0-10에 "짝 CTA 규칙"(나란히 놓이는 CTA 쌍은 색만 다르고 높이·반경·폰트·패딩 동일) 추가

### GATE C 체크리스트
```
[x] 지침 파일(cms-uiux.md §0-10/0-10-C/0-10-D)을 실제 Read해 값 복사, 추론 값 미사용
[x] 공유 클래스(.act-del, .action-section, .section-title-row) 직접 변경 대신 복합 셀렉터·모디파이어로 범위 한정
[x] 컬러 토큰 하드코딩 없음(기존 변수만), !important 미사용
[x] 각 변경마다 getComputedStyle/getBoundingClientRect·실제 hover로 실측
[x] svelte-check 신규 에러 0건(기존 vite.config.ts 1건 무관)
[x] 삭제 안전 토스트·저장 폼 등 로직 무변경 확인
```

**git commit**: 아직 없음 — Stephen 직접 실행 대기

---

## NOW — 🔴 CRITICAL: CMS 상품 '결합상품'(패키지 구성) 탭 신설 + 고객 상품상세 노출 + 계약서 파싱 + 결합상품 재고 연동 (2026-09-24, @promptor 작성, ✅ GATE B 승인 완료 — Phase 1 착수)

```
생성일: 2026-09-24
아젠다: ProductDetailPanel '옵션상품' 탭 우측에 '결합상품' 탭 신설 → 패키지 상품의 결합상품 목록 구성,
        고객 상품상세 '결합 상품' 목록 노출, 전자계약 '상품 목록' 파싱 반영(요금·수량 미적용),
        패키지 예약 시 결합상품 재고도 함께 점유.

[GATE B 확정 답변 — Stephen 2026-09-24]
Q1 결합상품 재고 함께 차감 / Q2 조건 버튼 3종 제외 / Q3 계약서 패키지 줄 아래 나열(수량·금액 '-')
Q-B 결합상품 1개라도 재고 없으면 패키지 예약 차단 / Q-M 1·2단계 함께 Production 오픈(Phase 1은 Stage만)
Q-E 신규 등록 화면에도 결합상품 입력 포함(P1-5 복원) / Q-F 복제 시 결합상품 복제 포함(P1-6 복원)
Q-H·Q-I 2단계에서 대여정보 탭·계약서에 실제 배정 장비번호 표시(1단계는 이름만)
나머지(Q-A·Q-C·Q-D·Q-G·Q-J·Q-K)는 추천안으로 진행: 패키지와 동일 기간(휴무일 연장 포함) 점유 / 패키지 중첩 차단 /
  같은 패키지 내 옵션·결합 중복 차단 / 고객 화면 옵션 목록 바로 위 배치(클릭 이동 없음) / 장바구니 결합목록 미표시 /
  반출·반납 스캔은 패키지 단위(결합상품 개별 스캔은 후속)

[CONTEXT BRIDGE]
plan_source: 직접 아젠다 (Stephen 원문 + GATE 사전확정 Q1~Q3)
핵심제약: ① 결합상품에는 요금·수량 개념이 없다 — 패키지 자신의 대여요금만 적용, 결합상품 수량 변경 불가
          ② 결합상품 재고 연동(Phase 2)은 TDD 필수 + 메인상품 배정 로직(create_hold_reservation /
             promote_draft_reservation)과 같은 트랜잭션에서 원자 처리
TDD도메인: P1-8(계약서 상품목록 빌더), Phase 2 전체(P2-1~P2-7: 예약·재고·가용성·HOLD)
절대금지: 기존 옵션상품(product_option_links·reservation_options·set_reservation_options) 동작 변경 금지 /
          요금 계산(compute_reservation_line_amount 등) 변경 금지 / 기존 마이그레이션 파일 수정 금지 /
          Production에 Stage 미검증 마이그레이션 적용 금지 / git 쓰기 금지
실패롤백: Phase 1 = 신규 테이블·RPC만 추가(기존 객체 무변경)라 DROP 롤백 마이그레이션으로 원복 가능.
          Phase 2 = create_hold_reservation·promote_draft_reservation·get_available_stock_counts를
          Migration 501/421(현행 정의) 본문으로 되돌리는 롤백 마이그레이션을 착수 전 미리 작성해 둔다.
GATE C 강화: YES (Phase 2 — 예약·재고·이중예약)
```

### 착수 전 사전 확인 (P1 첫 작업 직전 필수)
```
- 최신 마이그레이션 번호 재확인: 현재 최신 #543(20260924010000_543_...). 병렬 세션 존재 → 신규 번호
  (#544~) 착수 직전 `ls supabase/migrations | tail` 재확인, 충돌 시 재번호.
- create_hold_reservation / promote_draft_reservation 현행 정의 = Migration 501(2026-09-15).
  Phase 2 착수 직전 Stage·Production 실제 함수 정의를 DB에서 직접 재조회해 501과 일치하는지 대조
  (DRIFT_CHECK_PROCEDURE.md).
- 로드 지침: products.md(§2-1·§2-13·§4-1·§5), rental-lifecycle.md(옵션상품 절), contract.md,
  cms-uiux.md(§0-10-A·§0-10-D·§0-10-E·§7-7-1), front-uiux.md(§7·§8, 필요 시 §23).
```

### 현황 파악 결과 (2026-09-24 코드 직접 확인)
```
- 옵션상품 탭(ProductDetailPanel.svelte L988~1176 로직, L1634~1771 마크업): OptionLink 파싱 →
  localOptions($state) → isDirtyOptions($derived, display_order=목록 index) → CmsSimilarNameInput
  (source=product_search, activeOnly) + 검색 결과 모달(.option-modal, aria-modal) + 선택 카드
  (.selected-option-card, ✕ .remove-btn) + btn-save-inline → fetch('?/updateSection',
  section_type='options'). 드래그 재정렬 UI는 없음(순서 = 추가 순서).
  ⚠️ 옵션 검색은 자기 자신을 제외하지 않는다(서버 upsert_product_option_links도 자기참조·자식·삭제
  검증 없음) — 결합상품에서는 화면·서버 양쪽에서 막는다(옵션 쪽은 범위 밖, 손대지 않음).
- 서버 저장: cms/products/+page.server.ts L826 childBlockedSections, L1057 options 분기(JSONB는 JS 배열
  그대로 전달). 복제: L1530/L1635(new_product), L1396(add_inventory 자식에도 옵션링크 복사).
- 권한: get_product_option_links = anon/authenticated 허용(Migration 262), upsert_* = service_role
  전용(Migration 263). 결합상품 RPC도 동일 패턴.
- 고객 상세: products/[id]/+page.server.ts L166~204(get_product_option_links + 12h 요금 + 가용재고),
  +page.svelte L690 optionsSection 스니펫(모바일·PC 2곳 렌더).
- 계약서: contractLineItems.ts buildLineItems(메인 (이름+품번) 그룹 → 옵션 행). 호출부
  contract-data/+server.ts 두 경로(주문 묶음 L245~342 / 단독 L348~395), 구성품은 부모 기준
  해석 헬퍼(L100~123) 존재. 테스트: src/__tests__/services/contractDataLineItems.test.ts.
- 재고: 메인 = create_hold_reservation / promote_draft_reservation이 자식 실물을 휴무일 연장 반영
  날짜(daterange 겹침) + FOR UPDATE SKIP LOCKED로 배정(Migration 501). 옵션 = reservation_options.qty
  (날짜 무관, Migration 428 가드). 가용재고 표시 = get_available_stock_counts(날짜 무관, Migration 421).
  ⚠️ 관찰(범위 밖, 수정 안 함): 옵션 qty 점유는 메인상품 단독 배정 쿼리에 반영되지 않는 기존 구조.
```

---

### Phase 1 — 결합상품 구성·노출·계약서 (재고 연동 없음) | GSD 위주 + 계약서 TDD

- [x] **P1-1 DB: 결합상품 연결 테이블 + RPC 2종** | GSD | 예상 30분
      파일: 신규 `supabase/migrations/2026092xxxxxxx_544_product_bundle_links.sql`(번호 재확인)
      내용: `product_bundle_links`(product_id=패키지 부모, bundle_product_id=결합 부모, display_order,
        created_at/updated_at, UNIQUE(product_id,bundle_product_id), CHECK(product_id<>bundle_product_id)),
        RLS 활성+정책 없음(RPC 전용).
        `upsert_product_bundle_links(p_product_id, p_bundle_links jsonb)` SECURITY DEFINER, service_role 전용
        — 서버 검증: 자기 자신 / 자식(재고) 상품 / 삭제 상품 / 패키지 중첩(결합상품이 자체 결합목록을
        가짐, 또는 이 패키지가 다른 패키지의 결합상품) 전부 EXCEPTION. 전체 교체(하드삭제+INSERT)로
        멱등 처리(Migration 162 교훈). option_only 여부는 검사하지 않음.
        `get_product_bundle_links(p_product_id)` anon+authenticated — id·name·image_url·components·
        display_order 반환, deleted 상품 제외.
      완료기준: Stage 적용 → 함수 오버로드 1개·권한(anon/authenticated/service_role) 직접 조회 확인 →
        Production은 Phase 배포 결정(Q-M)에 따름.
      GATE C: [ ] 자기참조·자식·중첩 서버 차단 [ ] REVOKE/GRANT 262·263 패턴 일치 [ ] 기존 객체 무변경

- [x] **P1-2 타입** | GSD | 예상 15분
      파일: `src/lib/types/database.ts`(RPC 2종 + 테이블 타입)
      완료기준: svelte-check 0 error, `as unknown` 캐스팅 신규 추가 없음.

- [x] **P1-3 CMS 서버: 저장·조회** | GSD | 예상 30분
      파일: `src/routes/cms/products/+page.server.ts`(updateSection `section_type='bundles'` 분기 +
        childBlockedSections에 'bundles' 추가, getCmsRoleForAction 패턴 유지),
        `src/lib/server/products/loadSelectedProductDetail.ts`(bundle_links를 항상 부모 기준 조회)
      완료기준: 자식 상품 대상 저장 요청 서버 차단, RPC 검증 오류가 짧은 한국어 메시지로 반환.

- [x] **P1-4 CMS UI: '결합상품' 탭** | GSD | 예상 30분×2
      파일: `src/lib/components/cms/ProductDetailPanel.svelte`
      내용: TabKey/validTabs/ALL_TABS에 'bundles'(label '결합상품')를 'options' 바로 뒤에 추가,
        switchTab dirty 경고(L409)·다중탭 미저장 경고 목록(L483)에 '결합상품' 추가.
        옵션 탭 구조를 그대로 복제: section-header + btn-save-inline(cms-uiux §0-10-D) /
        child-readonly-notice + blockChildInputFocus / CmsSimilarNameInput(§7-7-1, excludeId=product.id) /
        검색 결과 모달(aria-modal="true" — §0-10-E ② sticky 겹침 규칙 충족) / 선택 카드 + ✕ 제거
        (§0-10-A close 계열, ✕ 문자) / isDirtyBundles($derived, display_order=index).
        제외: 일괄 적용 행·필수선택·최소1개·배송대여불가 버튼(Q2 확정), 가격·재고 표시.
        검색 결과에서 자기 자신·이미 추가된 상품·이 패키지의 옵션상품(Q-D 확정 시) 제외,
        중첩 위반은 추가 버튼 클릭 시점 사전 차단 토스트(§0-10-E ①).
        CSS는 옵션 탭 클래스 재사용(신규 팔레트·보더 장식 금지).
      완료기준: 검색→추가→제거→저장→새로고침 후 유지, 저장 후 버튼 비활성 복귀, 자식 선택 시 읽기전용.
      GATE C: [ ] Svelte 5 문법 [ ] $state(prop) 직접 초기화 시 $effect/{#key} 재동기화 확인
              [ ] 하드코딩 색상 없음 [ ] 옵션 탭 동작 회귀 없음

- [x] **P1-5 신규 상품 등록 화면 결합상품 입력** | GSD | 예상 30분 (Q-E=포함 확정으로 BACKLOG→복원)
      파일: `src/routes/cms/products/new/+page.svelte`(옵션상품 입력 영역과 동일 구조, 조건 버튼 제외),
        `src/routes/cms/products/new/+page.server.ts`(부모 INSERT 후 upsert_product_bundle_links 호출,
        실패 시 regWarn 코드 'bundles' 추가 — products.md §2-10①)
      완료기준: 신규 등록 시 결합상품이 저장되고 상세패널 결합상품 탭에 그대로 보임.
- [x] **P1-6 '새 상품으로 복제' 결합상품 복제** | GSD(+기존 productClone 테스트 보강) | 예상 30분 (Q-F=포함 확정)
      파일: `src/routes/cms/products/+page.server.ts` cloneProduct new_product 분기(옵션상품 복제 직후
        get_product_bundle_links → upsert_product_bundle_links, 실패는 경고 토스트 — products.md §2-13 R6),
        `src/__tests__/services/productClone.test.ts`
      완료기준: 복제본 결합상품 탭에 원본과 동일 목록.

- [x] **P1-7 고객 상품상세 '결합 상품' 목록** | GSD | 예상 30분
      파일: `src/routes/products/[id]/+page.server.ts`(get_product_bundle_links 조회, 부모 기준),
        `src/routes/products/[id]/+page.svelte`(bundlesSection 스니펫 — optionsSection 헤더·카운트
        배지·펼침 구조 재사용, 썸네일+상품명만. 가격·수량 스테퍼·필수 배지 없음. 결합상품 0개면 미표시.
        위치는 Q-G 확정값, 모바일·PC 두 렌더 위치 모두)
      적용 근거: front-uiux.md §7 체크리스트·§8 금지사항(CMS 토큰 혼용 금지, box-shadow 금지),
        PC 폰트 다운스케일(§23)은 Stephen 요청 시에만.
      완료기준: 패키지 상세에 목록 노출, 일반 상품 화면 변화 없음, 예약·장바구니 금액 변화 없음.

- [x] **P1-8 계약서 상품목록 빌더 — 결합상품 줄** | TDD | 15분×3
      파일: `src/lib/utils/contractLineItems.ts`, `src/__tests__/services/contractDataLineItems.test.ts`
      RED(15분): 패키지 줄 바로 아래 결합상품 줄 순서 / 결합 줄 수량·금액 '-' / 비고=formatComponentsText /
        같은 패키지 2건 그룹화 시 결합 줄 1회만 / 결합 0개면 기존 출력과 완전 동일(회귀).
      GREEN(15분): ReservationForLineItems에 `bundles?: {name, product_code, components}[]` 추가,
        메인 줄 → 결합 줄 → 옵션 줄 순서.
      REFACTOR(15분).
- [x] **P1-9 contract-data 결합상품 주입** | GSD | 예상 30분
      파일: `src/routes/api/cms/reservations/[id]/contract-data/+server.ts`(주문 묶음·단독 두 경로 모두,
        예약의 자식 product_id → 부모 id로 해석 후 get_product_bundle_links 일괄 조회 — N+1 금지)
      ⚠️ Phase 1은 "계약서 생성 시점의 현재 결합 구성"을 읽는다(예약 후 구성이 바뀌면 계약서도 바뀜) —
        Phase 2 P2-6에서 예약 시점 배정 기록 기준으로 전환.
      완료기준: 패키지 예약 계약서 미리보기에 결합 줄 표시, 비패키지 계약서 출력 무변경.

- [x] **P1-10 지침 갱신** | GSD | 예상 30분
      products.md §2-14 신설(결합상품 정의·부모 전용·중첩 금지·요금/수량 없음·복제 범위) + §4-1 탭 표 행 추가,
      contract.md(상품목록 결합 줄 규칙), rental-lifecycle.md(옵션상품 절 옆 "결합상품" 절 — Phase 2 반영 예정 표기),
      cms-uiux.md(§0-10-D 적용 화면 목록에 결합상품 탭 언급 불필요 시 생략 — 판단 후 보고)

[Phase 1 구현 후 메인 세션 재검증·수정 (2026-09-24)]
- 계약서 결합상품 조회가 예약의 자식(재고) id로 조회해 항상 빈 목록이던 결함 → contract-data에
  resolveBundlesMap(자식→부모 해석 + product_bundle_links 단일 쿼리) 신설, `as unknown as` 캐스팅 제거.
- #544: upsert REVOKE를 PUBLIC만→PUBLIC·anon·authenticated로 보강(Supabase 기본권한 — Migration 262 교훈),
  빈 배열 저장(결합목록 비우기)이 BUNDLE_IS_NESTED로 막히던 조건 수정, SET search_path 추가,
  image_urls가 JSONB라 `[1]`(두 번째 요소)이던 것을 `->>0`으로 수정.
- ProductDetailPanel saveBundles: fail()이 HTTP 200으로 와 실패도 "저장됐습니다"로 뜨던 판정을 deserialize로 교체.
- ✅ Stage(ezyvffjvuwmtuhpxdjrw) #544 적용 완료 + 실측: 권한(upsert=service_role만 / get=anon·authenticated·service_role),
  롤백 트랜잭션 스모크(저장·조회·이미지·자기참조/중첩 양방향 차단·비우기) 전부 통과. Production 미적용(Q-M: Phase 2와 함께).
- npm run check: 기존 vite.config.ts 1건 외 에러 0 / vitest 4파일 69건 통과.

[QA 1차 지적 수정 — 2026-09-24]
- [B-1] new/+page.svelte 결합상품 검색 UI 신설 + +page.svelte REG_WARN_MSG에 'bundles' 추가.
- [B-2] +page.server.ts updateSection bundles 분기에 getCmsRoleForAction 권한 체크 추가.
- [B-3] cloneProduct get_product_bundle_links fetch 에러 캡처(bundleFetchErr → cloneWarnings 'bundles'),
  loadSelectedProductDetail.ts bundleLinksError 플래그 전파 → ProductDetailPanel 저장 비활성화 + 에러 안내문.
- [M-1] ProductDetailPanel addBundleProduct: 자기 자신·이미 추가된 항목·옵션상품 중복 제외 + excludeId prop 전달.
- [M-2] Migration #545(supabase/migrations/20260924030000_545_drop_bundle_links_public_read_policy.sql) 신설 —
  product_bundle_links 공개 읽기 정책 제거.
- [L-2] contract-data resolveBundlesMap: bundleErr 명시 캡처 + 에러 시 조기 반환(빈 catch 제거).
- [M-3] products.md §2-14 장바구니 미표시(Q-J) 서술 정정, rental-lifecycle.md 결합상품 절 추가(Phase 2 예정 명시).
- [L-6] products/[id]/+page.svelte bundleItems each 블록에 key (bundle.bundle_product_id) 추가.
- npm run check: 기존 1건 외 신규 에러 없음 / vitest 4파일 82건 통과(+13건: contractDataLineItems 32, productClone 24, productNew 7, cloneProductPartnerCodeComboMerge 13).
- 신규 마이그레이션: supabase/migrations/20260924030000_545_drop_bundle_links_public_read_policy.sql

- [x] **P1-11 sp3-qa-agent 독립 검수** (Phase 1 GATE E) — ✅ 2차 재검수 조건부 통과(BLOCKING 0), MEDIUM 2건(M-A 복제 경고 문구 한국어화·M-B products.md §2-14 ④ 정정) 메인 세션 즉시 수정 완료. #545 Stage 적용·검증(policies=0, RLS on). Production(#544·#545)은 Phase 2와 함께(Q-M). Stephen 확인 대기: M-4(패키지 2대 예약 시 결합 줄 각 메인 줄 아래 반복), 기존 권한 구멍(updateSection 타 섹션·신규등록 로그인만 확인 → 별도 태스크 칩 task_924af511)

### Phase 2 — 결합상품 재고 연동 | TDD 전체 (Phase 1 GATE E 후, Q-A·Q-B 답변 후 착수)

**후보 비교 (추천: A안)**
```
A안(추천) 실물 단위 배정 — 신규 기록표(예약 1건 ↔ 결합상품별 실물 1개)를 두고, 패키지 hold 생성/
  draft→hold 승격과 같은 트랜잭션에서 결합상품마다 자식 1개를 메인과 동일 기준(휴무일 연장 반영
  날짜 겹침 + FOR UPDATE SKIP LOCKED)으로 배정. 하나라도 없으면 전체 실패·롤백.
  단독 배정 쿼리(create_hold_reservation·promote_draft_reservation)의 "이미 점유된 실물" 조건에
  "비종결 예약에 결합으로 배정된 실물 + 날짜 겹침"을 추가 → 결합상품 단독 대여와 상호 차단.
  해제는 예약 status 조인으로 판정 → 취소·만료·반납·완료 시 별도 해제 로직 없이 자동 해제.
  장점: 날짜 정확, 이중예약 구조적 차단, 실물 품번 확보(계약서·반출 확인에 활용 가능).
B안 옵션과 같은 수량 방식(날짜 무관) — 단순하지만 메인 단독 배정이 수량 점유를 보지 않아
  이중예약 구멍이 그대로 남고, 날짜 무관이라 과차단. 비추천.
C안 결합상품마다 0원짜리 예약 행 생성 — 기존 배정 로직 재사용 가능하나 CMS 목록·주문·결제·알림·
  상태전이·계약서 전부에 가짜 예약이 노출돼 파급 최대. 비추천.
날짜 기준: 메인상품 기준(휴무일 연장 포함 effective 기간)으로 통일 추천(Q-A).
```

- [~] **P2-0 롤백 마이그레이션 초안 + 현행 함수 정의 드리프트 확인** | TDD 준비 | 15분 — 롤백 초안 완료(#547 하단 주석). ⚠️ Stage 라이브 pg_get_functiondef 대조는 TDD Worker에 SQL 실행 도구(MCP)가 없어 미수행 — 메인 세션이 실행 필요
- [x] **P2-1 RED: 재고 연동 시나리오 테스트** | TDD | 15분×2 — bundleInventoryHold.test.ts 16건 중 14 FAIL·2 PASS(EC-4 비겹침·옵션 무회귀는 원래 통과 대상) 확인
      파일: 신규 `src/__tests__/services/bundleInventoryHold.test.ts`(Stage 라이브)
      EC-1 패키지 hold 시 결합상품 실물 각 1개 배정 / EC-2 결합상품 1종 재고 0 → 패키지 hold 실패,
      메인 실물도 점유 안 됨 / EC-3 결합상품 단독 예약이 패키지 점유 기간과 겹치면 다른 실물 배정·없으면 실패 /
      EC-4 기간 안 겹치면 정상 / EC-5 패키지 취소·만료 → 결합 실물 즉시 가용 / EC-6 draft→hold 승격 경로 동일 /
      EC-7 동시 요청 2건이 마지막 결합 실물 경합 → 1건만 성공
- [~] **P2-2 GREEN: 배정 기록표 + hold 2경로 재정의** | TDD | 15분×3 — 20260924050000_547_bundle_inventory_hold.sql 작성 완료, Stage 미적용(GREEN 미확인)
      파일: 신규 마이그레이션(#54x) — 기록표(RLS 활성·정책 없음) + create_hold_reservation·
        promote_draft_reservation CREATE OR REPLACE(시그니처 무변경, 501 본문 기반)
- [~] **P2-3 GREEN: 가용재고 표시 반영** | TDD | 15분×2 — #547에 포함, Stage 미적용
      get_available_stock_counts에 결합 점유 반영 + 패키지 가용 = min(패키지, 각 결합상품)
- [x] **P2-4 상품상세·장바구니 수량 상한 반영** | GSD | 30분 — 상품상세 stock 조회에 결합상품 id 포함 + 구성품 부족 안내 문구 구분(RPC 실패 메시지는 그대로 토스트). 장바구니는 RPC가 min을 반환해 별도 수정 없음
      파일: `products/[id]/+page.server.ts`·`+page.svelte`, `cart/+page.server.ts`(가용재고 조회 대상에 결합상품 포함)
      재고 부족 문구: "구성품 재고가 부족해 예약할 수 없습니다."(Q-B 확정 시)
- [x] **P2-5 옵션 수량 가드 무변경 확인** | TDD | 15분 — set_reservation_options 무변경, 회귀 케이스 bundleInventoryHold.test.ts에 포함(Stage GREEN 확인은 #547 적용 후)
- [x] **P2-6 계약서 결합 줄을 예약 시점 배정 기록 기준으로 전환(+품번 표기 Q-I)** | TDD | 15분×2 — contractLineItems.ts(BundleLink.product_code, 실물 단위 dedupe) + contract-data resolveAssignedBundles(없으면 resolveBundlesMap 폴백). contractDataLineItems 43건 통과. 대여정보 탭 결합상품 섹션(RentalDetailPanel + GET /api/cms/reservations/[id]/bundles) 추가(Q-H)
- [ ] **P2-7 (Stage 적용·GREEN·권한 실측 대기 — 메인 세션 실행 필요) REFACTOR + Stage 적용·TDD GREEN → Production 적용 → 드리프트 실측 대조 + sp3-qa-agent**
      GATE C: [ ] 이중예약 불가(EC-3·EC-7) [ ] 종결 상태 자동 해제(EC-5) [ ] draft는 점유 안 함
              [ ] 요금·결제 금액 무변경 [ ] 옵션상품 동작 무회귀 [ ] 코드 배포와 DB 적용 둘 다 확인
      지침: rental-lifecycle.md 결합상품 절 확정, products.md §5 "예약 가능 조건"에 결합 점유 추가,
            service-operations.md 인덱스 포인터 1줄(필요 시)

[Phase 2 메인 세션 검증 (2026-09-24)]
- Stage 드리프트 대조: create_hold_reservation·promote_draft_reservation 라이브 정의가 #501 본문과 일치, get_available_stock_counts는 #421 본문(JOIN 방식) — 드리프트 없음.
- ✅ #547 Stage(ezyvffjvuwmtuhpxdjrw) 적용. 권한 실측: assign_bundle_assets=service_role만 / create_hold=anon·authenticated·service_role / promote=authenticated·service_role(anon 회수) / get_available_stock_counts=anon·authenticated·service_role.
- ✅ bundleInventoryHold.test.ts 16/16 GREEN(EC-1~7 동시경합 포함). 무회귀: reservation·createHoldReservationWithShipment·holdExpiration·holdExpirationContractTimer·setReservationOptionsStockGuard·cartReservationGrouping·checkoutReissueReservation·setReservationShipmentMethodHolidayExtension 통과.
- ⚠️ 기존(비관련) 실패 — 제 변경 이전부터: getAvailableStockCounts 4건 = Stage 픽스처 상품 자식(12361ae3…)에 2026-09-19 생성된 hold 예약 #16252가 남아 있어 "점유 0" 가정이 깨짐(구 #421 공식으로도 동일 결과, Stage 테스트 데이터라 삭제 안 함). reservationProductEdit 7건 = cms_add/remove_reservation_product_unit(미수정 RPC)의 안내문구가 테스트 기대문구와 다름(타 세션 문구 변경 추정). 그 외 memberCodeCombo·contractSigningGate·deliveryCutoffHolidays(휴무일 픽스처 중복키)·accountWithdrawalPhone도 무관 영역 실패.
- Production(#544·#545·#547) 미적용 — Stephen 오픈 시점 확인 대기(Q-M).

[이 세션 수정 내역 최종 기록 (2026-09-24, 이 세션'만')]
■ 결합상품 Phase 1 (GATE E 2차 조건부 통과 → MEDIUM 2건 즉시 수정)
  - 신규: supabase/migrations/…_544_product_bundle_links.sql, …_545_drop_bundle_links_public_read_policy.sql (Stage 적용·실측 완료)
  - 수정: ProductDetailPanel.svelte(결합상품 탭·saveBundles), cms/products/+page.server.ts(bundles 저장·복제·역할게이트),
    cms/products/new/+page.svelte·+page.server.ts(신규등록 입력), cms/products/+page.svelte(REG_WARN_MSG),
    loadSelectedProductDetail.ts, products/[id]/+page.server.ts·+page.svelte(고객 '결합 상품'), contractLineItems.ts,
    contract-data/+server.ts(resolveBundlesMap 자식→부모 해석), database.ts, 테스트(contractDataLineItems·productClone), 지침(products.md §2-14 등)
■ 3:7 레이아웃 (ROUTINE, QA 대상)
  - cms/products/+page.svelte `.list-pane.narrow` 420px→30% / ProductDetailPanel.svelte `.tab-nav` safe center+overflow-x:auto, `.tab-btn` nowrap·flex-shrink:0
  - 실측: 뷰포트 1132px에서 목록 372 : 상세 852, 탭 10개 한 줄
■ 결합상품 Phase 2 (GATE E 조건부 통과, BLOCKING 0)
  - 신규: …_547_bundle_inventory_hold.sql(Stage 적용), bundleInventoryHold.test.ts(16건), api/cms/reservations/[id]/bundles/+server.ts
  - 수정: contractLineItems.ts·contract-data(배정 품번), RentalDetailPanel.svelte(결합상품 섹션), products/[id] 재고부족 안내, 지침(products.md §5·rental-lifecycle.md·contract.md)
  - 미결(Stephen 판단): ① 확정 후 기간·수령방식 변경(#508) 결합 실물 겹침 재검사 없음 ② EC-7 동시성 테스트 검증력 보강 ③ Production(#544·#545·#547) 오픈 시점
- ✅ 최종 GATE E(sp3-qa-agent, 2026-09-24): 조건부 통과, BLOCKING 0. 5개 스위트 88건 통과, 신규 RPC 에러처리 위반 0, 3:7 레이아웃 지침 위반 없음(1280px 실화면은 코드 정독 기준).
  Production 전 Stephen 결정: #508 겹침 재검사 / EC-7 테스트 보강(QA 권장) / 오픈 시점(#544→#545→#547 + 코드 배포, DRIFT_CHECK 대조) / task_924af511 선처리 여부.
- 별건 등록: task_924af511(CMS 상품 저장 액션 역할 게이트 부재, 🔴 CRITICAL)

### 리스크
```
동시성 🔴: 패키지와 결합상품 단독 예약이 같은 실물 경합 → A안 SKIP LOCKED + 단일 트랜잭션(EC-7)
데이터 정합성 🔴: Phase 1만 운영 반영 시 패키지 예약이 결합 실물을 안 묶음 → Q-M
                 결합 구성 변경 후 기존 예약 계약서 내용 변동(Phase 1 한정) → P2-6에서 해소
결제 🟡: 요금 로직 무변경 원칙 — 결합상품은 금액 합산 대상 아님(검증 항목으로만)
보안 🟡: upsert RPC service_role 전용 + CMS 서버 액션 세션·역할 체크, 자식 저장 서버 차단
```

### 엣지케이스
```
EC-A 자기 자신을 결합상품으로 추가 → 화면 검색 결과 제외 + 서버 거절
EC-B 패키지 A에 B, B에 A(순환)·패키지 안 패키지 → 서버 거절(1단계 구성만 허용, Q-C)
EC-C 결합상품이 이후 삭제됨 → CMS·고객 목록에서 빠짐, Phase 2 예약 시 해당 항목은 배정 대상 아님(Q-B와 함께 확인)
EC-D 결합상품이 옵션 전용(option_only) 상품 → 허용(무관)
EC-E 자식(재고) 상품 선택 상태에서 결합상품 탭 → 읽기전용, 서버 저장 차단
EC-F 패키지 2대 예약 → 계약서 결합 줄 1회 표기, Phase 2에서는 결합 실물 2세트 배정
```

## NEXT
- [ ] Phase 2 착수(P2-0~P2-7) — Phase 1 GATE E + Q-A·Q-B·Q-M 답변 후

## BLOCKED
- (없음)

## BACKLOG (Default-Exclude — Stephen 명시 승인 시 NOW 이동)
- 신규 상품 등록 화면(`cms/products/new`)에서 결합상품 선택: 미확인(Q-E) — 포함 시 +30분
- "새 상품으로 복제" 시 결합상품 연결 복사(products.md §2-13 R6 확장): 미확인(Q-F, 추천 포함) — +15분. 재고 추가(add_inventory)에는 복사 안 함(부모 기준 조회)
- CMS 예약/대여 상세 '대여정보' 탭 결합상품 표시: 미확인(Q-H) — Phase 2 이후 +30분
- 장바구니 화면 결합상품 표시: 미확인(Q-J)
- 결합 실물의 반출·반납·QR 스캔 개별 처리, 상품 목록 상태별 재고 칩 반영: 미확인(Q-K)
- 결합상품 드래그 순서 변경: 옵션 탭에도 없음 — 요청 시
- (관찰) 옵션 qty 점유가 메인 단독 배정에 반영 안 되는 기존 구조 — 별건 검토

### GATE B 질문 (Stephen — 서비스 의도)
```
Q-A 결합상품도 패키지와 "똑같은 대여 날짜(휴무일로 늘어난 날 포함)"만큼 묶어두면 될까요? (추천: 예)
Q-B 결합상품 중 하나라도 그 날짜에 남은 재고가 없으면 패키지 예약 자체를 막을까요? (추천: 예)
Q-C 패키지 안에 또 다른 패키지를 넣는 건 막아도 될까요? (추천: 막기)
Q-D 같은 상품을 한 패키지의 옵션상품과 결합상품에 동시에 넣는 건 막을까요? (추천: 막기)
Q-E 결합상품은 등록 후 상세 패널의 '결합상품' 탭에서만 구성해도 될까요, 신규 등록 화면에도 필요할까요? (추천: 탭에서만)
Q-F "새 상품으로 복제"할 때 결합상품 목록도 같이 복사할까요? (추천: 예)
Q-G 고객 상품 상세에서 결합 상품 목록은 옵션 상품 목록 바로 위에 두고, 눌러도 다른 화면으로 이동하지 않게 할까요? (추천: 예)
Q-H 관리자 예약/대여 상세 '대여정보' 탭에도 결합상품(실제로 나갈 장비 번호 포함)을 보여줄까요? (추천: 2단계에서 예)
Q-I 계약서 결합상품 줄의 상품코드 칸에 실제로 나갈 장비 번호를 적을까요? (2단계에서만 가능, 추천: 예)
Q-J 장바구니 화면에도 결합상품 목록을 보여줄까요? (추천: 이번엔 제외)
Q-K 결합상품 장비의 출고·반납 확인은 이번엔 패키지 본체 처리로 갈음하고, 개별 스캔 확인은 다음으로 미룰까요? (추천: 예)
Q-M 1단계(탭·화면 노출·계약서)만 먼저 실서비스에 올리면, 그 사이 패키지 예약 시 결합상품 재고가 안 묶입니다. 1·2단계를 함께 올릴까요? (추천: 1단계는 테스트 서버에만, 실서비스는 2단계와 함께)
```

예상: GSD 9개×30분 + TDD 18개×15분 ≈ 9시간 (Phase 1 ≈ 4시간 / Phase 2 ≈ 5시간)

---

## DONE — 🟡 BOUNDARY: `/cms/set/rental` UI 그룹핑 정비 + 우대설정 드래그 재정렬 + 휴무일 달력형 전환·임시 휴무일 더블클릭 등록 (Migration #543, 2026-09-23~24, 이 세션'만', ✅ GATE E 통과 — sp3-qa-agent 독립검수 완료, git commit만 Stephen 대기)

```
※ 상세 인계 문서: .claude/plan/세션 리뷰 — CMS 대여관리 설정(cms-set-rental) 개선(2026-09-21~24).md
변경 파일: src/routes/cms/set/rental/+page.svelte, +page.server.ts,
  신규 src/lib/components/cms/CmsHolidayCalendar.svelte,
  신규 supabase/migrations/20260924010000_543_delivery_fee_discount_tier_display_order.sql

[UI — 전부 +page.svelte, Stephen 실화면 지시 순차 반영]
  · 그룹핑: 대여방식 등록 폼(.add-form--method)·요금 3행(.fee-grid)·대여옵션 그룹박스
    (.bulk-delivery-section--group-start)·휴무일 제어 박스(.sf-row.holiday-toggle-row)에
    "배경색 없이 아주 옅은 회색 아웃라인(#F3F4F6 neutral-gray-250, CSS 변수 미정의)+라운드
    (--cms-radius-sm)+패딩 16px 20px". 첫 시도에서 요청 안 한 bg를 넣어 지적받고 제거.
  · 안내문 저장 버튼 2곳(배송 안내문·배송 휴무일 안내문): textarea 내부 겹침 → 섹션 헤더 우측
    btn-save-inline 표준(cms-uiux.md §0-10-D)으로 이전, 죽은 CSS(.textarea-save-btn,
    .guide-textarea--has-save-btn) 삭제.
  · 타이틀 신설: "대여 방법 조건 설정"(대여옵션 그룹박스 바깥 상단, 상단 60px 여백 이전),
    "배송 휴무일 포함 설정"(이력: 휴무일 공통 제어 옵션→개명; 라벨 "휴무일 제어 옵션"은 유지 —
    라벨 교체가 아니라 그 위에 별도 타이틀을 추가하라는 지시).
  · 휴무일 제어 박스: 라벨 "휴무일 제어 옵션"+칩 3개를 세로 좌측정렬(.sf-row 후행 정의가
    align-items를 덮어써 .sf-row.holiday-toggle-row로 우선순위 상향, .sf-label의 flex:0 0 210px은
    column에서 높이로 해석돼 flex:0 0 auto로 복원), 아웃라인은 칩 그룹이 아니라 행 전체에 적용,
    "배송 휴무일 안내문" 헤더(저장 버튼)+textarea를 박스 안 칩 아래로 이동(saveCutoffSettings
    폼 안 유지 — 안내문 저장 시 enable_* hidden도 함께 제출).
  · 개수 배지 우측 끝 정렬(.section-badge--end): 대여 기간 제한 옵션·대여 방식 옵션·지점 정보
    등록·필수 동의문 항목 4곳(배송료 우대설정은 기존부터 우측 → 5개 전부 통일).
  · 안내문구 입력 20→30자는 별도 블록(아래) 참고.

[배송료 우대설정]
  · 목록 행 상하 패딩 10px(height auto), 행간 9px(.discount-tier-block :global(.drag-list-wrap)),
    이중 래퍼(.tier-input-row div) 제거 → 폼 modifier .add-form--tier로 행 레이아웃 이전.
  · 드래그 재정렬(Migration #543, Stage→Production 순서 적용, 양쪽 오버로드 1개·권한·순서값 직접
    재조회 확인): delivery_fee_discount_tiers.display_order 컬럼(created_at 순 백필) +
    reorder_delivery_fee_discount_tiers RPC + upsert_delivery_fee_discount_tier INSERT 시 맨 끝
    순서. 서버 load 정렬(display_order→created_at)·reorderDiscountTiers 액션, UI는 CmsDragList
    표준. 요금 계산(가장 유리한 1개만 적용)엔 순서가 영향 없음.

[휴무일 달력형 — 신규 CmsHolidayCalendar.svelte]
  · 법정공휴일 목록 → 3개월 병렬 달력: 좌우 화살표(ChevronIcon)+마우스 드래그 슬라이드(양끝
    저항), 시작 월·오늘은 KST 고정 계산(SSR 하이드레이션 불일치 방지), 월 카드 높이 통일.
  · 셀: 날짜 아래 공휴일명 글자단위 2줄+말줄임, 셀 높이 44→66px(+50%), 일요일·법정공휴일 빨간
    숫자, 임시 휴무일은 --cs-red-xlight 원형 배지(28px)+범례, 비활성 국경일 흐림+취소선.
  · 단일 클릭=정보 레이어(280px, 긴 이름·유형·비활성 사유), 더블클릭/Enter=임시 휴무일
    등록·편집·삭제 레이어(340px): 상단 "YYYY년 M월 D일 (요일)", 사유(20자, 카운터), 연필 라운드
    정사각 아이콘 버튼(등록/수정 저장, Enter 제출), 삭제 아이콘(CmsDeleteButton 2단계 확인 재사용,
    폼 중첩 회피). 법정공휴일 날짜는 등록 불가(정보 레이어), 오늘 이전 날짜 비활성.
  · 페이지: saveManualHoliday()가 fetch+deserialize로 addManualHoliday/updateManualHoliday 호출,
    임시 휴무일 표시명은 note||name(upsert_manual_holiday UPDATE 분기가 name을 갱신하지 않아
    수정 후 name이 낡음 — 필요 시 별도 마이그레이션 선택지). 달력은 휴무일 0건이어도 항상 표시.
  · 삭제: 목록형 마크업, "임시 휴무일 관리" 등록 폼(날짜+사유+추가)+상태변수 3개,
    죽은 CSS(.list-row-inactive, .inactive-badge). 소제목 "임시 휴무일 관리"→"임시 휴무일",
    임시 휴무일 목록 행 상하 패딩 15px(실질 10px의 +50%, 행 높이 44→58px), 빈 목록 안내문 보강.
  · 서버: updateManualHoliday 신설(DB 변경 없음), 사유 길이 100→20자(등록·수정 통일).

검증: npm run check 베이스라인 유지(1에러 vite.config.ts 기존, 신규 없음), cartShippingFee 69/69.
  Stephen 진행 중 브라우저 세션(CLAUDE.md 조건 ①)에서 실화면 검증 — 달력 렌더·공휴일 정보
  레이어·화살표/드래그 이동·등록→편집(Enter 저장)→삭제 전 과정·20자 제한·우대설정 드래그 핸들·
  박스 재배치·배지 정렬(rightGap 0px ×5). 검증용 임시 휴무일은 매번 삭제(Stage 잔여 0건 확인,
  기존 9/10 창립기념일 Stage 데이터는 보존).
QA: ✅ sp3-qa-agent 독립검수 GATE E 통과(BLOCKING 0건). 정적 검토 범위 — 마이그레이션 #543은 직전 정의(#415)와
  라인 단위 대조해 검증 로직 전부 보존 확인(DB 미접근이라 적용 상태는 세션이 직접 재조회한 결과 인용), 서버 액션
  권한 게이트 정상, 요금·휴무일 판정 무영향(/cart는 자체 정렬, calcShippingDiscountRate는 순서 무관).
  발견 → 같은 날 수정·재검증:
    · M-1(MEDIUM) 임시 휴무일 사유를 비워 저장하면 표시명이 낡은 name으로 되돌아감 → 표시를 note||'임시휴무일'로
      변경(달력·목록 모두), 실화면에서 비움 저장 시 "임시휴무일" 표시 확인. (RPC가 name을 갱신하지 않는 근본 원인은
      그대로 — 필요 시 별도 마이그레이션)
    · L-1 window 리스너 정리: pointercancel 처리+onDestroy 정리 추가. ⚠️ 이 수정 직후 SSR에서 onDestroy가
      실행돼 window 참조로 /cms/set/rental만 500 발생 → typeof window 가드로 해결(200 복구 확인). 교훈: onDestroy는
      서버 렌더에서도 호출됨.
    · L-2 Enter 등록이 마지막 드래그의 dragMoved 잔재로 무시될 수 있음 → keydown에서 초기화.
    · L-3 서버 날짜 검증 없음 → validateManualHolidayDate(형식+KST 오늘 이전 금지) 추가, 등록·수정 액션에 적용,
      실요청으로 형식오류/과거날짜 거절 한글 메시지 확인.
    · L-4 낡은 주석 정리. I-1(재정렬 fetch 결과 미검사)은 기존 3개 재정렬 함수와 동일 패턴이라 유지.
  최종: npm run check 베이스라인(1에러/402경고) 유지, cartShippingFee 통과, 드래그·pointercancel·등록·편집·삭제 실화면 확인,
  테스트 행 삭제(Stage 잔여 0건).

재검수(sp3-qa-agent, 후속 수정+장바구니 연동 대상): ✅ GATE E 통과(BLOCKING 0건). 한계 — DB 접근 불가(정적 검토), (B) 체인은
  cart/+page.server.ts→loadCourierClosedDates까지만 직접 추적(cart/+page.svelte·CalendarGrid·calcHolidayExtension 내부는 미확인 →
  그 구간은 세션의 실측(아래)으로만 확인됨). L-1(SSR 가드·리스너 참조 짝)·L-2·M-1 표시·폼 중첩 통과, 타임존은 UTC 서버에서 오히려
  하루 넓게 조회돼 누락 없음. 지적 → 조치:
    · LOW 존재하지 않는 날짜(2026-02-30 등)가 Date.parse를 통과 → 왕복 변환 판정으로 교체, 등록·수정 모두 "존재하지 않는 날짜입니다." 확인.
    · LOW 지난 임시 휴무일의 사유 수정 불가 → updateManualHoliday가 기존 행 날짜를 조회해 날짜가 바뀔 때만 과거 검증(사유만
      수정은 허용), 형식·실존 검증은 항상 수행. (삭제는 별도 액션이라 원래 영향 없음)
    · MEDIUM M-1 잔존 → ✅ 해소(2026-09-24, Stephen "A안" 지시): Migration #546(20260924040000_546_upsert_manual_holiday_name_sync.sql)
      — upsert_manual_holiday의 UPDATE·ON CONFLICT 두 분기 모두 name=COALESCE(NULLIF(p_note,''),'임시휴무일') 동기화 + 기존 manual 행 멱등 백필.
      Stage→Production 순서 적용, 양쪽 pg_get_functiondef(두 분기 name 갱신)·오버로드 1개·권한(authenticated/postgres/service_role)·
      어긋난 행 0건 직접 재조회 확인. Stage 실측: 사유 수정 → DB name 및 /cart courierClosedDates 사유 동시 변경, 사유 비움 → '임시휴무일'.
      테스트 행(2026-10-16 [T546]…)은 내가 만든 것만 삭제(Stage 기존 2건 무변경, 잔여 0건). 표시 폴백(note||'임시휴무일')은 그대로 유효.
    · INFO 빈 사유 항목 편집 시 입력란에 '임시휴무일' 기본값이 채워짐(저장 시 note에 그 문구 기록) — 실질 영향 없음.
장바구니 연동 검증(2026-09-24, 코드 수정 없음 — Stephen이 Stage에 등록한 임시 휴무일 "테스트 휴일" 2026-09-28 기준):
  · 로직 체인: cart/+page.server.ts → loadCourierClosedDates(courierClosedDates.ts) → cart/+page.svelte courierClosedSet →
    CalendarGrid deliveryClosedDates(표시) / calcHolidayExtension(연장 계산, is_courier_dependent 방식만).
    반영 조건 = enable_prev_day_check(마스터) ON + enable_manual_holidays ON + is_active + date>=오늘 + 방식이 택배의존.
  · Stage 설정 확인: 마스터·고정·임시 토글 모두 ON, is_courier_dependent는 crazydelivery만 true.
  · 실측: /cart/__data.json의 courierClosedDates에 {2026-09-28,"테스트 휴일"} 사유 그대로 포함, 지난 9/10 제외, 총 85건(법정+일요일 포함).
    크레이지샷배송 선택 시 달력 9/28이 추석·일요일과 동일한 휴무일 표시(rgb 255,53,53), 9/29 수령일 선택 시 "+휴무일 5일 포함"
    (24~26 추석·27 일요일·28 임시). calcHolidayExtension 직접 대조: 수령 9/29 → 임시 포함 5일 / 제외 0일, 반납 9/27 → 포함 1일 / 제외 0일.
    방문대여(비택배의존)는 9/28이 표시만 되고 연장 배지 없음. Stage 설정·데이터는 변경하지 않음.
```

---

## DONE — 🟢 ROUTINE: 대여방식 수령/반납 안내문구 입력 길이 20자→30자 상향 (2026-09-23, 이 세션'만')

```
Stephen이 CMS 대여방식 인라인 수정 아코디언(수령방식/반납방식 안내문구)을 지목해 입력
가능 글자수를 30자로 늘려달라고 요청. DB 컬럼(deadline_time·return_deadline_time)이
TEXT라 별도 마이그레이션 불필요 — 앱 레벨 3곳만 20→30 동기화:
  1. src/routes/cms/set/rental/+page.svelte — 공유 필터 함수 filterMethodDeadlineInput()
     slice(0,20)→slice(0,30), 입력 3곳(신규등록 행 1개+수정 아코디언 2개) maxlength·
     placeholder 동일 변경.
  2. src/routes/cms/set/rental/+page.server.ts — addMethod·updateMethodDeadline
     서버측 length>20 검증 3곳을 length>30으로 동기화(클라이언트 우회 방지 원칙 유지).
npm run check 베이스라인(1에러/401경고) 그대로, 신규 이슈 0건.
```

git commit은 Stephen 직접 실행 대기.

---

## DONE — 고객 '분류' 배지 오인 여부 검증 + user_profiles.grade(죽은 GENERATED 컬럼) 삭제 (2026-09-23, 이 세션'만')

### 배경

Stephen이 CMS 고객상세의 "분류"(일반/학생/구독) 배지를 `<launch-selected-element>`로 선택하며
"이 배지가 정책상 존재하지 않는 계정 고정 '등급' 개념을 잘못 쓰고 있는 게 아닌지" 검증을
요청 — ①계정 자체엔 등급이 없음(추후 구매누적 쿠폰차등은 미구현 예정 사항일 뿐) ②구독은
등급이 아니라 3개 구독상품 각각의 그룹 소속 ③분류 배지가 고객목록 필터 칩과 같은 기준을
써야 함, 4가지 전제 조건 제시.

### 조사 결과 (Explore 서브에이전트 2회 실행 후 직접 grep 재검증)

- **분류 배지 판정**: `classificationsOf()` 함수가 `CustomerDetailPanel.svelte`·
  `cms/customers/+page.svelte` 양쪽에 동일 로직으로 존재 — `is_student`(학생증 인증)와
  `membership_grade !== 'NONE'`(구독상품 구독중)의 조합 파생값일 뿐, 계정 고정 등급 컬럼을
  직접 읽지 않음.
- **필터 칩과의 일치**: 목록 필터 칩(`일반`/`학생`/`구독`)이 `get_customer_list` RPC에
  전달하는 `p_classifications` WHERE 조건도 동일하게 `is_student`+`membership_grade`
  기준 — 배지와 필터 사이 불일치 없음 확인.
- **"등급" 개념 자체**: `membership_grade`는 오직 구독상품(EASY/POP/CRAZY) 구독 상태만
  나타내며, 구매이력 누적형 계정 등급 같은 별도 개념은 코드베이스 어디에도 없음 — Stephen
  전제와 정확히 일치, 오인 사항 없음(**수정 불필요로 결론**).
- **부수 발견**: 조사 중 `user_profiles.grade`(Migration 03,
  `GENERATED ALWAYS AS (membership_grade) STORED`) 컬럼이 앱 코드 어디에서도 SELECT/참조
  되지 않는 죽은 컬럼임을 확인(CSS `.grade-*` 클래스명은 `membership_grade` 파생값,
  `LegacyMemberVerifyModal`의 `grade` 필드는 API 응답 하드코딩 `'NONE'` 문자열로 이
  GENERATED 컬럼과 무관함을 소스로 확인) — Stephen이 삭제 명시 지시.

### 구현 — 죽은 컬럼 삭제 (Stephen 명시 요청)

- 신규 마이그레이션 `supabase/migrations/20260923200000_535_drop_dead_grade_column.sql`
  (`DROP COLUMN IF EXISTS grade` — 기존 마이그레이션 파일 직접수정 금지 원칙 준수)
- `src/lib/types/database.ts` — `UserProfile.grade` 필드 선언 + `UserProfileInsert`의
  Omit 목록에서 `'grade'` 제거(같은 죽은 컬럼의 타입 정의라 동일 범위로 판단)
- Stage(`ezyvffjvuwmtuhpxdjrw`) 적용 → 컬럼 소멸 SQL 재확인 → Production
  (`vnbpmvxruyciuuaermyh`) 동일 적용 → 컬럼 소멸 SQL 재확인, 순서 준수

### GATE C 체크리스트

```
[x] 기존 마이그레이션 파일을 직접 수정하지 않고 신규 ADD만 했는가?
[x] 삭제 전 앱 코드 전수 grep으로 실사용 여부 재확인했는가? (CSS class-name 오탐·API 응답
    필드명 우연 일치 두 경우를 실제 소스까지 열어 배제)
[x] Stage 먼저 적용·검증 후 Production 적용했는가?
[x] 타입 정의(database.ts)도 DB 스키마와 함께 정리했는가?
[x] svelte-check 신규 에러 0건 확인했는가?
```

### 검증

```
svelte-check: 신규 에러 0건(기존 vite.config.ts 1건은 무관, 계속 확인됨)
Stage/Production 둘 다 information_schema.columns 직접 재조회로 컬럼 소멸 확인
```

**git commit**: 아직 없음 — Stephen 직접 실행 대기

---

## DONE — 🔴 CRITICAL: 본인증명/외국인증명 등록 → 관리자 승인 채팅카드 3단 플로우 (Migration #526, 2026-09-23, 이 세션'만')

### 배경

```
Stephen 요청(플랜모드 승인 완료, /Users/stevenmac/.claude/plans/effervescent-dancing-kettle.md):
고객이 /account/profile에서 본인증명/외국인증명 서류를 등록하면 ①관리자 채팅(고객 세션 내
admin_only 카드)으로 알림 → ②관리자가 카드 클릭 시 /cms/customers?selected=로 이동해 신규
"승인" 버튼으로 처리 → ③승인 시 고객에게 확인 카드 발송, 3단계 흐름 구현.

핵심 설계(Stephen 확인 완료): admin_only=true(Migration #404, refund_failed와 동일 패턴)
재사용 — service-operations.md §17의 "관리자 전용은 chat_messages 금지" 원칙보다 하루
늦게 신설된 admin_only 컬럼이 이미 이 문제를 해결하는 정식 경로로 운영 중임을 확인.
```

### 구현 (코드 전체 완료 + Stage 마이그레이션 적용 완료, Production 적용 대기)

```
1. Migration #526(supabase/migrations/20260923020000_526_identity_doc_approval.sql) —
   user_profiles.identity_approved_at/foreign_approved_at TIMESTAMPTZ 신설(기존
   *_verified_at은 "제출시각" 의미 그대로 유지, 절대 재정의 안 함) + approve_customer_doc(
   p_user_id, p_doc_type) RPC 신설(SECURITY DEFINER, service_role 전용, 제출 이력 없으면
   실패) + get_customer_list DROP+재생성(반환컬럼 2개 추가 — 베이스는 최신본인 Migration
   #486, #410 아님 — REVOKE ALL FROM PUBLIC/anon/authenticated 재적용까지 정확히 복제해
   Migration #364 PII노출 재발 방지) + push_notification_config 'identity_approved' 시드.
   ✅ Stage(ezyvffjvuwmtuhpxdjrw) 적용 완료(2026-09-23, Stephen 지시로 이 세션이 Supabase
   MCP로 직접 적용) — 적용 직후 컬럼 2개 존재·get_customer_list/approve_customer_doc
   proacl에 PUBLIC/anon/authenticated 없음(service_role만) 직접 SQL 재조회로 확인,
   security advisor에 이 마이그레이션 관련 신규 경고 0건, approveDocRpcGuard.test.ts
   3/3 RED→GREEN 전환 재확인 완료. Production(vnbpmvxruyciuuaermyh) 적용은 아직 대기 —
   Stephen 승인 후 별도 진행.
2. src/routes/api/profile/upload-doc/+server.ts — 업로드 성공 후 fail-soft로
   find_or_create_general_chat_session + admin_only=true 'identity_review_request'
   카드 발송 추가(§11 준수, cms/upload-doc 관리자 대리등록 경로는 미변경 — 노이즈 방지).
3. src/routes/api/cms/approve-doc/+server.ts(신규) — getCmsRoleForAction+hasSettingsAccess
   (manager+) 게이트 → approve_customer_doc RPC → 성공 시 같은 핸들러에서 고객에게
   'identity_approved' 카드(admin_only 아님) + 푸시 발송.
4. src/lib/types/chat.ts — ActionCardType에 identity_review_request/identity_approved 추가.
5. src/lib/components/chat/ActionCard.svelte — ctaDefaults() 2건 + handleCta() isAdmin
   분기에 identity_review_request 전용 케이스 신설(다른 카드류와 달리 onctamodal이 아닌
   실제 goto() 페이지이동 — 요구사항 자체가 CMS 고객목록 이동이므로).
6. src/lib/components/cms/CustomerDetailPanel.svelte — 본인증명/외국인여부 두 info-row에
   "승인"버튼+"승인완료"뱃지 추가(needsDocApproval() 판정, 기존 .btn-reupload와 동일하게
   중첩폼 문제로 REST fetch 방식), CustomerRow에 신규 필드 2개.
7. src/routes/cms/customers/+page.server.ts — CustomerRow에 신규 필드 2개 추가.
8. 테스트 5개 신설(src/__tests__/services/) — identityReviewRequestChatCard·
   identityApprovedChatCard(카드 shape/RLS, 마이그레이션 무관 — 이미 GREEN 6/6 확인)·
   approveDocPermissionGate·uploadDocNotifyFailSoft(mock 기반, 이미 GREEN 7/7 확인)·
   approveDocRpcGuard(RPC 직접 호출 — Migration #526 Stage 미적용 상태에서는 RED 3/3였으나
   Stage 적용 후 GREEN 3/3 전환 재확인 완료, refundAdminChatCard.test.ts와 동일한 TDD
   RED→GREEN 관례).
9. svelte-check 전수 실행 — 기존 vite.config.ts 무관 에러 1건 외 신규 에러 0건 확인.
```

### QA 결과 (sp3-qa-agent, 2026-09-23)

```
GATE C/E 3단계 검수 완료 — §17/§11/security-auth.md 권한게이트·PII노출 방지(Migration #364
재발 방지)·p_user_id 정합성(handle_new_user 트리거)·admin_only 구분·fail-soft 경계·
ActionCard.svelte 회귀·중첩폼 회피·CSS 토큰 전부 "이슈 없음" 확인.
⚠️ 발견·수정 완료(BOUNDARY): uploadDocNotifyFailSoft.test.ts의 mockFrom 타입이 인자 0개로
   추론돼 npm run check(tsc)에서 신규 에러 1건 발생 — vi.fn((_table?: string) => ...)로
   정정 + 105행 mockImplementation 파라미터도 optional로 통일해 해소. 재검증: npx tsc
   --noEmit 클린 확인 + 관련 4개 테스트파일 10/10 GREEN 재확인(회귀 없음).
GATE E 통과.
```

### Production 적용 (2026-09-23, Stephen 지시로 이 세션이 Supabase MCP 직접 적용)

```
✅ Migration #526을 Production(vnbpmvxruyciuuaermyh)에 적용 완료 — 적용 전 fn_exists/
   new_cols 사전조회로 미적용 상태 확인(배포순서 사고 예방) → 적용 → 사후 재조회로
   컬럼 2개 존재·backfilled_rows=0(백필 없음)·get_customer_list/approve_customer_doc
   proacl 둘 다 postgres/service_role만(PUBLIC·anon·authenticated 없음) 확인 →
   get_customer_list(1,1) 실호출로 39컬럼 정상 반환 확인 → list_migrations로
   "526_identity_doc_approval"이 최종 목록에 반영됨을 확인. Stage와 Production 상태 일치.
```

### 남은 작업

```
⛔ git add/commit/push는 Stephen 직접 실행(커밋 메시지 텍스트 제안은 위 대화 참고).
```

## DONE — 🟡 BOUNDARY: 대여방식 옵션에 "반납방식 노출용 안내문구"(return_deadline_time) 신설 (Migration #524, 2026-09-23, 이 세션'만')

### 배경

```
Stephen이 CMS "대여방식" 안내문구 인라인 수정 아코디언(선택영역)을 지목하며, 기존
deadline_time 입력폼(수령방식용)은 유지하고 그 아래에 "반납방식 노출용 안내문" 입력폼을
하나 더 추가해달라고 요청. 조사 결과 기존 deadline_time은 /cart의 수령(pickup) 탭·반납
(return) 탭이 deliveryTabs 배열 하나를 그대로 공유해 항상 동일한 문구를 노출하고
있었음(computeReturnVisibleTabs는 필터링만 할 뿐 deadline 필드를 분리하지 않음) — Stephen이
기존 필드를 "수령방식 노출용"이라고 명시적으로 지칭한 것 자체가 이 설계 공백을 드러냄.
```

### 구현

```
1. Migration #524 — rental_method_options.return_deadline_time TEXT 컬럼 신설 +
   upsert_rental_method_option RPC를 5-param→6-param(p_return_deadline_time 추가)으로
   재정의. deadline_time과 동일하게 COALESCE 없이 무조건 덮어쓰기(Migration #522 원칙
   유지), method_key만 기존대로 COALESCE. 옛 5-param 오버로드 DROP + REVOKE/GRANT
   하드닝 재적용. Stage(ezyvffjvuwmtuhpxdjrw)→Production(vnbpmvxruyciuuaermyh) 순서
   적용, 양쪽 다 pg_get_functiondef·컬럼·권한 직접 재조회로 확인 완료.
2. src/routes/cms/set/rental/+page.server.ts — RentalMethodOption 인터페이스에
   return_deadline_time 추가, load() select에 컬럼 추가, addMethod(신규 등록 시엔
   null 명시 전송 — 입력폼 없음, 등록 후 인라인 수정으로 설정)·updateMethodDeadline
   (두 필드 모두 20자 검증 후 RPC에 전달) 갱신.
3. src/routes/cms/set/rental/+page.svelte — 아코디언에 "수령방식"/"반납방식" 두 개
   라벨+입력행을 세로로 배치(기존 가로 1행 폼을 column 레이아웃으로 재구성), 하나의
   <form>으로 함께 제출(부분필드 전송 위험 방지 — 직전 QA 재검토에서 확인한 "무조건
   덮어쓰기 RPC는 항상 전체 필드 재전송" 원칙 그대로 적용). editingReturnDeadlineValue
   상태 신설, startEditDeadline/cancelEditDeadline에서 두 값 함께 seed/clear.
4. cart/+page.server.ts·+page.svelte — deliveryOptions 조회에 return_deadline_time
   추가, 반납(return) leg 전용 탭 소스(returnDeliveryTabs)를 신설해 deadline 필드를
   return_deadline_time에서 가져오도록 분리 — returnVisibleTabsFor가 이제
   returnDeliveryTabs를 사용(기존 pickupVisibleTabs/deliveryTabs는 deadline_time
   그대로 유지, 무변경).
```

### 검증

```
npm run check — 베이스라인(1 에러/401 경고) 그대로, 신규 에러/경고 0건.
cartShippingFee.test.ts 69/69 GREEN(computeReturnVisibleTabs 순수함수 자체는 무변경).
customerSelfCancel.test.ts·createHoldReservationWithShipment.test.ts(rental_method_
option 참조 테스트) 22/22 GREEN.
✅ Stephen이 선택영역(<launch-selected-element>)으로 진행 중이던 Claude Browser 세션 컨텍스트
안에서(CLAUDE.md 조건 ① 충족) /cart 실화면 검증 완료 — "크레이지샷배송 대여" 방식의
수령 탭엔 "15:00 마감"(deadline_time), 반납 탭엔 "그래그래"(return_deadline_time, Stephen이
CMS에서 미리 저장해둔 테스트값)가 서로 다르게 노출되는 것 확인. Stephen 본인이 "정상 노출
확인되었음"으로 최종 확인.
```

git commit은 Stephen 직접 실행 대기.

---

## DONE — 🟡 BOUNDARY: `cart/+page.svelte` 외 11개 파일 커밋 성사 확인 + GATE E 검수 착수 (2026-09-22, 이 세션'만')

### 배경

이 세션이 다른(병행) 세션들의 미커밋 작업(장바구니 쿠폰 정산 버그 수정·수령/반납 UX 개편·
sub-gnb_navi_b 축소·PC 반응형 폰트 다운스케일 등, 2026-09-21자)을 발견해 파일 구성을
분류하고 통합 커밋 메시지 초안을 제안(텍스트 제안만, 실행 없음) → Stephen이 직접 터미널에서
`git commit`(`886c39d fix(cart): 쿠폰 할인 계산 버그 수정 + 장바구니 UX·UI 전면 정비`)
실행 완료를 확인.

### 확인 사항

```
git log --oneline -3 → 886c39d가 HEAD로 정상 반영됨(Author: Stephen Cconzy).
git status → 제안한 12개 파일 전부 정상 커밋 반영, src/lib/utils/toast.ts만 여전히
  미커밋(의도적으로 이번 배치에서 제외한 항목, 그대로 잔존).
```

### 다음 단계 — GATE E 검수 착수

```
이 commit(886c39d)은 이 세션이 작성한 코드가 아니라 다른 세션들의 산출물을 그대로
커밋한 것이라 아직 어떤 세션의 GATE E 검수도 거치지 않은 상태 — 하네스 원칙("모든 NOW
완료 → sp3-qa-agent 자동 호출")에 따라 sp3-qa-agent 독립검수를 백그라운드로 실행(아래
별도 기록 예정).
```

---

## DONE — 🔴 CRITICAL: `/cms/set/rental` 배송요금 0원 표기 결함 — DB 데이터손실 버그 + 화면 순간깜빡임 버그 2건 수정 + 전체 23-RPC 정밀감사 (2026-09-22, 이 세션'만', ✅ GATE E 통과 — sp3-qa-agent 독립검수 완료, git commit만 Stephen 대기)

### 배경

```
Stephen 신고: "/cms/set/rental" 배송 설정에서 안내문구를 바꿔 저장했더니 왕복요금·배송요금·
반납요금이 0원으로 표시되고, 사이트(/cart)에는 예전 값이 그대로 남아있음.
"대여관리(/cms/set/rental) 설정 로직을 전부 정밀 탐색하고 테스트해서 이렇게 숨겨진 오류를
무조건 찾아. 사용자 장바구니 결제에 핵심 설정이야. 무조건 100% 정합되도록 해!" 지시에 따라
이 화면이 쓰는 RPC 23개 전체를 감사.
```

### ① CRITICAL 데이터손실 버그 — `upsert_rental_shipping_settings` (Migration #523)

```
원인: UPDATE 문이 round_trip_fee = CASE WHEN p_enable_round_trip THEN p_round_trip_fee
     ELSE NULL END 형태로, "이 요금 사용" 토글이 꺼져 있으면 저장된 금액 자체를 NULL로
     지워버렸음. 이 화면의 요금 3종·안내문·토글이 폼 하나를 공유해 서로 다른 버튼(요금
     입력 blur / 토글 클릭 / "안내문 저장")이 전부 같은 폼을 제출하다 보니, 안내문만
     바꾸려 저장해도 그 순간 토글 상태에 따라 다른 요금이 함께 지워질 수 있었음.
수정 근거: 실제 요금 계산(cartShippingFee.ts calcShippingFee)은 enable_* 플래그만
     독립적으로 먼저 확인해 false면 0을 반환 — 저장된 요금 값 자체는 참조하지 않음.
     즉 "토글 끄면 값을 지운다"는 동작은 실제 계산에 아무 영향이 없으면서 부작용만 있었음.
수정: CASE...NULL 제거, 항상 값 그대로 저장(shipping_guide와 동일 패턴).
적용: Stage(ezyvffjvuwmtuhpxdjrw)→Production(vnbpmvxruyciuuaermyh) 순서 적용,
      각 환경 pg_get_functiondef로 CASE WHEN 제거 확인 + 실데이터 무손상 확인.
```

### ② 전체 23-RPC 정밀감사 — 동일 결함 패턴 추가 발견 여부 확인

```
/cms/set/rental이 쓰는 RPC 23개 전체를 pg_get_functiondef로 일괄 조회해 라인 단위 검토.
동일 "조건부 NULL 지우기" 패턴이 있던 곳은 위 ①(upsert_rental_shipping_settings)과
별도로 이미 이전 태스크에서 수정된 upsert_rental_method_option(deadline_time COALESCE
버그, Migration #522) 단 2건뿐 — 나머지 21개는 전부 안전(단순 토글·무조건 덮어쓰기·
비변경 조회)함을 확인. 회귀 테스트(deliveryCutoffHolidays.test.ts 등) 재실행, 무관
사전 결함 1건(별건, 이미 별도 트래킹) 제외 전부 GREEN.
```

### ③ 저장 직후 "0원 순간 깜빡임" 화면 버그 — 클라이언트 렌더링 타이밍 결함

```
①번 DB 수정 후에도 Stephen이 재보고: "여전히 배송요금 수정 시 자동 저장 되면서 0원으로
표기 오류중, 새로 고침 시 정상 보이지만 이건 분명한 오류!!!" — DB 값은 이미 정상(새로고침
하면 맞게 보임)인데, 저장 직후 화면에 잠깐 0원이 번쩍이는 별개의 클라이언트 버그.

원인: SvelteKit use:enhance 콜백에서 update()를 인자 없이 호출하면 기본값이
     { reset: true }라, invalidateAll() 실행보다 먼저 브라우저 네이티브 form.reset()이
     실행됨. 이 화면 요금 입력칸은 bind:value가 아니라 value={...}로 Svelte 상태를 직접
     반영하는 방식이라, 네이티브 reset이 먼저 실행되면 순간 빈칸(placeholder "0")으로
     보였다가 뒤이어 정상값으로 돌아오는 깜빡임이 발생.

수정: src/routes/cms/set/rental/+page.svelte 전체에서 await update()(인자 없음) 15곳
     전부를 await update({ reset: false })로 일괄 변경(addPeriod·addMethod·
     updateMethodDeadline·saveShipping·toggleBulkDelivery·toggleCourierDependent·
     toggleDeliveryType·addDiscountTier·saveCutoffSettings·syncHolidaysNow·
     addManualHoliday·addBranch·updateBranch·saveGuide·addConsent).

회귀 검증: "새 항목 추가" 폼 6개(addPeriod·addMethod·addDiscountTier·addManualHoliday·
     addBranch·addConsent)는 네이티브 reset에 의존해 입력칸을 비웠을 가능성이 있어
     전부 개별 확인 — 6개 전부 success 분기에서 자신이 전송하는 모든 필드를 수동으로
     초기화(`inputValue = ''` 등)하고 있어 reset:false로 바뀌어도 회귀 없음. "저장·토글"
     계열 9개 폼은 애초에 저장 후 값이 유지돼야 정상이라 수동 리셋 로직이 없는 게 맞음.
```

### GATE E 검수 결과 (sp3-qa-agent 독립검수)

```
✅ GATE E 통과 — 요청 범위 외 수정 0건(diff 15줄 정확히 update({reset:false})만),
   console.log/any타입/TODO 0건, npm run check 베이스라인 변화 없음(1 에러/401 경고
   그대로), 6개 add-폼 수동클리어 로직 전수 확인 완료, 실패(failure) 경로 회귀 없음
   확인. 발견된 이슈 없음.
```

### ④ Stephen 재검토 지시("매번 오류 나는 건 정밀검토 안했다는 소리") — 독립 재감사 실행

```
배경: Stephen이 정상 작동을 확인한 뒤에도 "왜 매번 반복되냐"며 위 ①~③ 수정과 점검 항목
자체를 재검토하라고 지시. 기존 결론을 그대로 재확인하는 방식이 아니라 아래 2가지를
새로 실행:

1. RPC 목록 자체를 기억/이전 요약이 아니라 코드에서 grep으로 재도출 →
   실제로는 "23개"가 아니라 25개였음(+page.server.ts untypedRpc 호출 24개 + +page.svelte
   경유 holidaySync.ts의 sync_national_holidays 1개, 이전 감사에서 누락됐던 RPC).
   25개 전부를 Production(vnbpmvxruyciuuaermyh)에서 pg_get_functiondef로 직접 재조회 —
   신규 발견된 sync_national_holidays 포함 25개 전부 안전 확인(조건부 NULL 지우기 패턴
   없음). 이전 감사가 "23개"라고 잘못 셌던 것 자체가 이번 재검토로 드러난 절차 허점.

2. 새로운 결함 클래스 추가 점검 — "일부 필드만 담아 보내 나머지가 덮어써지는 위험"
   (RPC 자체엔 CASE/COALESCE가 없어도, 클라이언트가 폼 일부 값만 보내면 RPC의
   "무조건 덮어쓰기" 특성상 나머지가 빈 값으로 사라질 수 있는 구조적 위험 — ①번과는
   다른 각도의 결함 유형). saveShipping(단일 폼 hidden input 전체 반영 확인)·
   updateBranch(branchForms가 $effect로 서버 최신값에서 매번 재시딩되는 것 확인)·
   updateMethodDeadline(name/display_order/method_key를 현재값 그대로 hidden 재전송하는
   것 확인) 등 "무조건 덮어쓰기" RPC를 호출하는 모든 폼을 개별 추적 — 전부 안전, 추가
   결함 없음.

결론: 추가 결함 발견 없음(현재 상태 정상 작동 재확인과 일치) — 다만 "RPC 23개"라는 이전
집계 자체가 부정확했던 절차적 허점은 인정·기록. Stephen에게 재발 방지책으로
scripts/check-rpc-error-handling.mjs(기존 RPC 에러처리 누락 자동감지 스크립트)를
확장해 "조건부 NULL 지우기" 패턴도 자동 탐지하도록 하는 방안을 제안(Stephen 승인 대기,
아직 미착수 — 요청범위 외 신규 작업이라 임의 실행 금지 원칙 준수).
```

git commit은 Stephen 직접 실행 대기.

---

## DONE — 🟡 BOUNDARY: `deliveryCutoffHolidays.test.ts` GATE E 검수 통과 + 검수 중 Stage `holiday_guide_text` 재훼손·즉시복구(2026-09-22, 이 세션'만')

### GATE E 검수 결과 (sp3-qa-agent 독립검수)

```
✅ GATE E 통과 — 검수 대상 diff(deliveryCutoffHolidays.test.ts, 17 insertions/2 deletions)
   코드 결함 0건, 회귀 0건. npx vitest 재실행 17/17 GREEN(대상 테스트 포함), 무관 실패
   1건(delete_manual_holiday, §3 describe 블록의 오프셋 230~234가 실동기화된 법정공휴일과
   우연히 재충돌 — git stash 대조로 이번 diff 이전부터 존재한 사전 결함임을 재확인, 비차단
   권고로 기록: §1/§4처럼 완전 격리 오프셋으로 이관 권장).
```

### ⚠️ 검수 절차 중 발생한 부수 사고 — Stage `holiday_guide_text` 재훼손 → 즉시 복구 완료

```
sp3-qa-agent가 "무관 실패가 diff 이전부터 있었는지" 대조하려고 git stash로 수정 전(버그
있는) 코드를 라이브 Stage DB에 대고 재실행 → 정확히 이 버그(p_holiday_guide_text 미전달
→ RPC가 DEFAULT ''로 무조건 덮어씀) 그대로 재현되어, Stage delivery_cutoff_settings.
holiday_guide_text가 다시 빈 문자열로 초기화됨(실측: updated_at 2026-09-22 00:04:07 UTC).
Production은 무관(.env.local이 Stage 전용 연결이라 그쪽 테스트가 Production에 닿을 방법
자체가 없음 — 직접 SQL 재조회로 Production 원문 그대로 보존 확인).

복구: Production(vnbpmvxruyciuuaermyh)의 현재 holiday_guide_text 원문("배송 휴무일이
포함되는 대여일 또는 반납일 선택 경우 / 배송휴무일 이전 또는 이후 날 수령배송 혹은
반납되며 / 50% 대여요금이 추가됩니다.")을 그대로 Stage에 UPDATE로 복구, 재조회로 정상
반영 확인. 스키마 변경 없는 순수 데이터 복구(마이그레이션 파일 불필요).

역설적으로 이 사고 자체가 이번 diff(round-trip 방식으로 왕복 전달)가 왜 필요한지를
실시간으로 재입증한 사례 — 수정된 코드로 이 테스트를 실행하면 더 이상 재발하지 않음.
```

git commit은 Stephen 직접 실행 대기.

---

## NOW — 🟡 BOUNDARY: 장바구니(cart) 예약 달력 UX — 세로 스크롤/드래그 연속 전환 재설계 (2026-09-21) — ⛔ GATE B 승인 대기

> 생성: promptor(대형 아젠다 분석 에이전트) — Stephen 승인 플랜모드 대화 + Explore 조사 +
> Plan 설계(opus) 종합 결과를 그대로 태스크로 이관. 실행은 GATE B 승인 후 `@harness-executor`.
> 등급 판단 근거: 공유 컴포넌트 3곳(CMS·마이페이지·장바구니) 영향 + 결제 연결 화면(장바구니)
> 포함 다중파일 변경 → CLAUDE.md 기준 최소 🟡 BOUNDARY, 실질적으로는 GATE B 승인 필요.

### [CONTEXT BRIDGE]

```
plan_source     : Stephen 플랜모드 대화(2026-09-21) + Explore 에이전트 2개 조사 + Plan 에이전트
                  (opus) 설계 종합 문서 — 별도 plan-output.md 없이 이 TASK.md가 원문 그대로 반영.
핵심제약        : 공유 컴포넌트(CalendarGrid.svelte) 3개 사용처(CMS/마이페이지/장바구니) 중
                  어느 하나도 회귀 없이 동시에 새 UX를 반영해야 함. 기존 셀 상태 로직(선택·과거·
                  휴무일차단·range 3-레이어 스태킹 등)은 "이동/재배치만 허용, 수정 절대 금지".
TDD도메인       : 순수 로직(calendarWindow.ts — 월 행수 계산·윈도우 구성·오프셋 계산·스크롤
                  보정값 계산)은 TDD 유닛테스트 대상. 최종 TDD/GSD 분리 판단은 harness-executor.
절대금지        : ① range 밴드 스태킹 레이어(::before z-index:-2 / ::after z-index:-1) 셀 CSS
                  수정 ② 새 컨테이너에 transform/contain/content-visibility/isolation/
                  will-change 부여(스태킹 붕괴 재발) ③ touch-action:none 사용(터치 스크롤 파괴)
                  ④ 장바구니 maxDate prop 누락(재고 미확인 180일 이후 구간 노출 위험)
                  ⑤ 기존 3곳 Prop 시그니처(value/onselect/disablePast/minDate/rangeStart/
                  rangeEnd/rangeStartLabel/rangeEndLabel/isDateDisabled/onDisabledClick/
                  highlightDates/warnSelected) 변경
실패롤백        : `continuousScroll?: boolean`(기본 false) 플래그로 신규 엔진을 감싸 구현 —
                  플래그 꺼짐 상태에서 기존 3곳 100% 동일 동작 유지가 되는 시점까지는 언제든
                  플래그만 꺼서 구 UX로 즉시 복귀 가능. 최종 정리(플래그 삭제)는 장바구니
                  활성화까지 전부 검증된 뒤 마지막 단계에서만 수행.
```

### ⚠️ 현재 git 상태 (혼동 방지용 — 반드시 먼저 확인)

```
src/lib/components/common/CalendarGrid.svelte는 현재 브랜치(stage)에 이미 미커밋 상태로
수정되어 있음(이번 태스크가 만든 변경이 아니라 이전 세션의 잔여 작업) — diff는 순수
타이포그래피 변경(달력 숫자 서체를 --font-en-display(Tilt Warp)로 전환, "월"/"년" 접미사
제거, PC/모바일 반응형 폰트크기 분리)이며 레이아웃 구조·셀 로직은 전혀 건드리지 않는다.
이번 태스크(세로 스크롤 재설계)와 코드 레벨 충돌은 없다고 판단되나, 이 폰트 변경을
"이번 태스크가 되돌려야 할 대상"으로 오인하지 말 것 — 별개 작업이며 그대로 둔다.

아래 3개도 이번 태스크와 무관한 별개 진행 중 작업이므로 건드리지도, 되돌리지도 말 것:
  - src/lib/components/common/TimePickerGrid.svelte (신규, 미커밋)
  - static/fonts/D-DINExp-Bold.woff2 / D-DINExp-Italic.woff2 / D-DINExp.woff2 (신규, 미커밋)

기존 TASK.md 상단부(2026-09-21 최근 세션들)에 CalendarGrid.svelte 관련 DONE 블록이 다수
있으나(폰트·헤더타이틀·연월접미사 제거 등) 전부 완료 처리된 별개 작업이며, 이번 "세로
스크롤/드래그 재설계"와 주제가 겹치는 미해결 NOW 블록은 확인되지 않았다(promptor 사전
확인 완료 — 상세는 세션 보고 참고).
```

### 배경(왜 필요한가)

현재 장바구니 예약(수령일/반납일) 달력은 한 번에 한 달만 보여주고, 다음 달로 가려면
"다음달" 화살표를 눌러야 한다. 수령일을 이번 달에서 고르고 반납일이 다음 달에 있으면,
화면 연속성이 끊기고 클릭 횟수가 늘어나는 불편함이 있다 — 이게 이번 재설계의 실제 동기다.

요청 사항(원문 요구 5가지)을 그대로 반영한다:
1. 목적: 수령일(이번 달) 선택 후 반납일(다음 달) 선택 시 UX 개선.
2. 세로 스크롤 + 드래그 가능한 미려한 인터랙션.
3. 기존 내재된 조건 로직(휴무일 강조·범위선택 밴드·비활성 처리 등) 절대 보존.
4. 이 달력(`CalendarGrid.svelte`)이 시스템 공통 컴포넌트임을 감안.
5. 실제 구현은 하네스플로 경유.

**Stephen 확정 사항(플랜모드 대화에서 직접 확인):**
- 적용 범위: 공유 컴포넌트를 쓰는 3곳(장바구니 예약, CMS 일반 날짜입력, 마이페이지
  생년월일) 전부에 새 UX 적용.
- "드래그"의 의미: 화면(달력 표면) 자체를 세로로 스크롤/드래그해서 월을 전환하는 것 —
  시작일→종료일을 손가락으로 이어긋는 "범위 드래그 선택" 제스처가 아니다. 날짜 선택
  자체는 기존처럼 탭/클릭 유지.
- 상단 "이전달/다음달" 화살표 버튼: 유지하되 "한 달치 스크롤 이동" 버튼으로 용도만
  변경(페이지네이션 폐지, 완전 삭제 아님).
- 실제 구현은 반드시 하네스 플로(`@promptor` → TASK.md → GATE B → `@harness-executor`)
  경유 — 이 블록이 바로 그 절차의 산출물.

### 대상 컴포넌트 · 현재 동작 (절대 보존 대상)

`src/lib/components/common/CalendarGrid.svelte` (757줄) — 공유 컴포넌트, 사용처 3곳 전부
grep으로 확인·확정됨(다른 사용처 없음):

| # | 파일 | 쓰는 기능 |
|---|---|---|
| 1 | `src/lib/components/cms/CmsDatePicker.svelte:59` | `value`/`onselect`/`disablePast`만 — 최소 기능 |
| 2 | `src/lib/components/members/profile/ProfileTabContent.svelte:1096-1100` | 위와 동일 + `disablePast={false}` — 생년월일이라 **수십 년 전으로 점프**가 중요 |
| 3 | `src/routes/cart/+page.svelte`(`RentalForm` 스니펫, leg당 1회씩 2회 렌더) | **전체 기능 사용**: `minDate`/`rangeStart`/`rangeEnd`/`highlightDates`/`warnSelected`/`isDateDisabled`/`onDisabledClick` |

**반드시 그대로 유지해야 하는 로직(수정 절대 금지, 순수 이동/재배치만 허용):**
- `calDays()`/`isPastDay()`/`fmtDate()` — 순수 함수, `(year,month)`만 받으므로 월별
  섹션에 그대로 재사용 가능.
- 날짜 셀(`<button class="cal-day">`) 마크업·클래스·조건 전부: `cal-day-sel`(선택,
  흰글자+보라 `!important`) / `cal-day-past`(과거, disabled) / `cal-day-holiday`(휴무일
  차단, 클릭은 되고 `onDisabledClick`만 발동) / `cal-day-sun`/`cal-day-sat`(요일색) /
  `cal-day-adj-holiday`(휴무일 흡수 경계일 하이라이트, purple-10 배경 — 2026-09-16에
  4번 색상 조정 끝에 확정된 값, 절대 되돌리지 말 것) / `cal-day-warn`(자동연장 유발 시
  빨강, `cal-day-sel`과 `::after` 원 둘 다 덮어써야 함) / range 3-레이어(`::before` 밴드
  `z-index:-2` → `::after` 원 `z-index:-1` → 숫자) — 이 레이어링은 2026-08-18에 실측으로
  발견·수정된 두 가지 스태킹 버그(자기 배경이 음수 z-index 자식보다 항상 아래 / 인접
  셀 밴드가 시작·종료 셀을 덮음)를 피하기 위한 것으로, **어떤 새 CSS도 이 셀 레벨 규칙을
  건드리면 안 됨** — 셀 위쪽(컨테이너) 레이아웃만 바꾼다.
- `measureCalGrid` 액션(2026-09-16 추가) — 실측 셀 크기 기반 `--cal-min-h` 계산.
  "하드코딩 대신 실측"이라는 원칙을 확장해서 재사용(아래 설계 개요 참고).
- `viewYear`/`viewMonth`를 `value`/`minDate` 변경 시 동기화하는 `$effect`(77-85줄) —
  `core-rules.md`/`ui-mobile.md`에 "올바른 패턴"의 정본 예시로 인용된 코드. 그대로
  유지하고, 스크롤 앵커 이동만 그 안에 추가.
- 연/월 빠른이동 오버레이(가로 스크롤+마스크 페이드+`scrollIntoView` 점프, 150ms
  idle-timer 페이드) — 그대로 유지, 세로 스크롤 설계의 직접적인 참고 원형으로 재사용.

### 설계 개요

**1. 레이아웃 구조**

```
.cal-root
├─ .cal-range-summary   (그대로)
├─ .cal-header          (연/월 버튼 그대로, 화살표는 "한 달 스크롤 이동"으로 용도 변경)
├─ .cal-dow-header      [신규] 요일 라벨 7개를 그리드 밖으로 분리, 스크롤 영역 위에 고정
└─ .cal-date-area       height: var(--cal-min-h)  (기존 min-height → 고정 height로 전환)
   ├─ {#if showYearPicker}  .cal-year-panel      (완전히 그대로)
   ├─ {:else if showMonthPicker} .cal-month-grid  (완전히 그대로)
   └─ {:else} .cal-scroll-viewport               [신규]
        └─ {#each windowMonths as {y,m} (`${y}-${m}`)}   ← 반드시 keyed each
              .cal-month-section
              ├─ .cal-month-label (예: "2026년 9월")
              └─ .cal-grid  ← 기존 날짜 셀 마크업을 {#snippet DayCell(y,m,day)}로
                              추출해 그대로 재사용 (셀 자체는 1바이트도 안 바뀜)
```

연/월/일 그리드 3자 중 하나만 보인다는 기존 성질은 그대로 유지한다(모달 높이가 갑자기
안 변함).

**2. 월 윈도우(가상화) 전략 — 라이브러리 없이 직접 구현**

이 프로젝트엔 드래그·가상스크롤·달력 라이브러리가 전혀 없음(package.json 확인 완료) —
순수 Pointer/Scroll 이벤트 + CSS로 구현.

- **실측 대신 산술 계산**: `measureCalGrid`가 이미 읽는 셀 높이(`cellH`)·행간(`rowGap`)·
  요일헤더 높이를 재사용해 `sectionHeight(rows) = labelH + rows*cellH + (rows-1)*rowGap`을
  계산. `rows`는 `calDays(y,m).length/7`로 렌더 없이 미리 알 수 있는 순수값 — 그래서 각
  월 섹션을 실제로 마운트하지 않고도 오프셋을 정확히 계산 가능(월별 `ResizeObserver` N개를
  두는 방식은 프리펜드/프루닝 때마다 순간적으로 어긋난 오프셋이 보여 스크롤이 튀는 부작용이
  있어 피함).
- **윈도우 크기**: 앵커 월 기준 앞뒤 2개월(총 5개월)만 항상 마운트 — 빠른 플릭에도
  마운트가 못 따라가지 않을 정도의 여유.
- **경계**: 기존 `YEAR_LIST_PAST=100`/`YEAR_LIST_FUTURE=30` 상수를 그대로 재사용해
  연도피커·세로피드가 "갈 수 있는 범위"에 대해 서로 다른 말을 하지 않게 함.
- **스크롤 위치 보정**: 위쪽에 월을 붙이거나 뗄 때 발생하는 높이 변화를, `tick()` 이후
  `scrollTop`을 직접 DOM에 써서(=상태 아님) 보정 — 아래 "드래그 기법"과 동일한 원칙.

**3. 연/월 빠른이동 ↔ 세로 스크롤 공존 (생년월일 케이스의 핵심)**

생년월일처럼 수십 년을 점프해야 하는 화면에서는 "실제로 스크롤해서 이동"이 아니라
**연/월 피커로 즉시 순간이동(teleport)** 해야 한다:
- 연/월 피커 자체(가로 스크롤+마스크 페이드+`scrollIntoView`)는 완전히 그대로.
- `pickYear`/`pickMonth` 선택 시, 스크롤 윈도우를 그 연/월 기준으로 **다시 세팅**(중간
  수십 년을 실제로 스크롤하지 않음) — `scrollTop`을 `behavior:'auto'`로 즉시 이동.
- 탭 횟수는 기존과 동일(년→월→끝). 연/월 버튼 자체 위치·모양도 그대로 — 화면별 별도
  모드 없음.

**4. 스크롤/드래그 인터랙션**

- **네이티브 스크롤이 기반**: `.cal-scroll-viewport`에 `overflow-y:auto`만 줘도 터치
  드래그(관성·바운스 포함), 휠, 스크롤바, 그리고 **터치에서 스크롤과 탭을 브라우저가
  알아서 구분**(스크롤로 판정되면 합성 클릭이 자동 취소됨)까지 전부 공짜로 얻는다 —
  직접 만드는 관성 스크롤은 오히려 iOS 네이티브보다 나쁘다.
- **데스크톱 마우스 드래그**는 이 프로젝트에 이미 있는 패턴을 그대로 이식:
  `src/lib/components/cms/ContractTemplatePanel.svelte:466-537`의 "드래그 중엔 `$state`를
  쓰지 않고 DOM에 직접 `transform`/`scrollTop`만 쓰고, 4px 임계값으로 클릭과 드래그를
  구분, 손을 뗄 때만 커밋" 기법 — Svelte 5 룬 모드에서 매 프레임 `$state` 갱신 시 생기는
  끊김을 피하는, 이 코드베이스의 검증된 house pattern.
  - `pointerdown` 시 `e.pointerType !== 'mouse'`면 그대로 리턴(터치는 절대 가로채지
    않음) — 이 한 줄이 제일 중요.
  - 드래그 종료 시 그 위치의 `.cal-day` 클릭이 잘못 발동하지 않도록 캡처 단계 클릭 억제
    필요(4px 임계값 재사용).
  - `touch-action:none`은 **절대 금지**(터치 스크롤 자체가 죽음) — `SignatureCanvas.svelte`
    등 캔버스류만 쓰는 속성.
- **스크롤 스냅**: v1은 자유 스크롤(스냅 없음) — Airbnb류 "연속된 느낌"의 핵심. 나중에
  원하면 `scroll-snap-type: y proximity`(이 프로젝트 기존 관례, `mandatory` 아님) 추가 검토.
- **호버 미리보기 스트로빙 방지**: 스크롤 중 마우스가 고정된 채 셀들이 지나가면
  `onmouseenter`가 난사됨 — 연도피커에 이미 있는 150ms idle-timer 기법을 그대로 재사용해
  스크롤 중엔 호버 미리보기를 끔.
- **가로 3px 밴드 번짐 클리핑 주의**: `overflow-y:auto`를 걸면 `overflow-x`도 강제로
  clip 계열이 되어, range 밴드의 `-3px` 번짐(`cal-day-in-range::before`)이 맨 왼쪽
  열에서 잘릴 수 있음 — 뷰포트에 최소 4px 여유 패딩 필요(기존 `.cal-layer padding:20px`
  안쪽에서 확보 가능).
- **화살표 버튼**: (사용자 확정) 삭제하지 않고, `scrollBy({top: ±한달높이,
  behavior:'smooth'})`로 용도 변경.

**5. Prop 계약 — 기존 3곳 무변경 원칙**

`value`/`onselect`/`disablePast`/`minDate`/`rangeStart`/`rangeEnd`/`rangeStartLabel`/
`rangeEndLabel`/`isDateDisabled`/`onDisabledClick`/`highlightDates`/`warnSelected` —
**전부 시그니처·동작 무변경**. 어느 월 섹션에서 렌더되든 동일한 셀 로직이 동일한 값을
받는 구조라 캐치사이트 코드 수정이 필요 없다.

**단, 장바구니(3번 사용처)에 신규 prop 1개 추가 필요 — 선택이 아니라 필수 안전장치:**

```
maxDate?: string   // 기본값 '' = 기존 동작 그대로. 지정 시 그 이후 월은 cal-day-past로 비활성 표시.
```

**왜 필수인가**: `src/routes/cart/+page.svelte:1493`에 확인된 사실 — 재고 가용성 조회
(`get_unavailable_dates_for_cart`)가 **오늘부터 180일까지만** 조회되고(
`AVAILABILITY_WINDOW_DAYS = 180`), `isDateDisabled`는 그 결과 `Set`의 `.has(iso)`만 본다.
180일을 넘는 날짜는 "조회된 적이 없어서" 무조건 `false`(=선택 가능)로 보인다. 지금은
화살표를 6번 넘게 눌러야 그 지점에 닿아서 사실상 아무도 발견 못 하는 결함이지만,
**세로 스크롤이 생기면 몇 초 플릭 한 번으로 그 지점에 도달** — 재고 미확인 날짜로 실제
예약이 성립될 수 있는 데이터 정합성 리스크가 새로 노출된다. 장바구니 호출부에
`maxDate={addDays(todayIso(), AVAILABILITY_WINDOW_DAYS)}`(이미 있는 두 값 재사용)만
추가하면 해결됨. CMS/생년월일 두 곳은 이 prop을 안 넘기므로 영향 없음.

### 리스크 (8개 항목 — 전부 구현 단계에서 실측 검증 필수)

| 리스크 | 내용 | 대응 |
|---|---|---|
| **R1 — 재고 미확인 구간 노출** | 장바구니에서 180일 이후 날짜가 "선택 가능"처럼 보임 | `maxDate` prop 추가 (필수) |
| **R2 — range 밴드 스태킹 붕괴** | 새 컨테이너에 `transform`/`contain`/`content-visibility`/`isolation`/`opacity`/`will-change`를 걸면 `::before`(-2)/`::after`(-1) 레이어 순서가 깨짐 — 2026-08-18에 이미 한 번 겪은 버그 클래스 | 월 섹션·스크롤뷰포트에 위 속성 절대 금지. 소스텍스트 검증 테스트로 고정(아래 검증) |
| **R3 — 드래그 종료 시 오선택** | 마우스로 200px 드래그 후 놓으면 그 위치 날짜가 클릭된 것처럼 처리될 위험 | 4px 임계값 + 캡처단계 클릭 억제(ContractTemplatePanel 패턴) |
| **R4 — 터치 스크롤 파괴** | `touch-action:none`이나 커스텀 터치 핸들러가 네이티브 스크롤을 죽임 | `pointerType!=='mouse'`면 즉시 return, `touch-action:none` 사용 금지 |
| **R5 — 스크롤 위치 튐** | 월 윈도우 앞쪽에 붙이기/떼기 시 보정 타이밍이 틀리면 한 프레임 튐 | 오프셋 계산·`scrollTop` 보정을 순수함수로 분리해 유닛테스트 |
| **R6 — cal-day-warn 이중 오버라이드** | `.cal-day-sel`과 `::after` 원 둘 다 빨강이어야 하는데, 리마운트(스크롤 밖→안) 후에도 유지되는지 재검증 필요 | 실브라우저로 스크롤 아웃→인 재확인 |
| **R7 — 카트 안내문 위치(`measureCalLayer`)** | `src/routes/cart/+page.svelte:502-509,2974,3024`가 달력 팝업 실제 높이를 재서 안내문 위치를 잡음 — 고정 높이 뷰포트로 바뀌면 오히려 안정화되어야 하나 재검증 필요 | 열림 애니메이션 중/후 위치 확인 |
| **탭 순서 폭증** | 셀 수가 ~35개→~175개로 늘어 키보드 탭 순서 부담 증가(이 컴포넌트는 원래 화살표키 네비게이션이 없음 — 기존에도 없던 기능이라 "회귀"는 아님) | 앵커 월 밖 셀에 `tabindex="-1"` |

### 단계별 진행 순서 (권장)

```
1. 순수 로직 추출 + 테스트 — src/lib/utils/calendarWindow.ts(월 행수 계산, 윈도우 구성,
   오프셋 계산, 스크롤 보정값 계산) — DOM 없는 순수함수, vitest로 전부 커버. 컴포넌트는
   아직 안 건드림 → 회귀 위험 0.
2. 플래그 뒤에서 엔진 구현 — CalendarGrid.svelte에 continuousScroll?: boolean(기본
   false) 추가. 요일헤더 분리, DayCell 스니펫 추출, 스크롤뷰포트/드래그레이어 구현,
   measureCalGrid를 산술 계산으로 확장. 플래그 꺼진 상태에선 기존 3곳 전부 동작 100%
   동일 — npm run check 그린 확인.
3. 개발자 검증(장바구니 기준) — 로컬에서만 플래그 켜고 위 리스크 표 전부 실브라우저로
   대조 확인. 아직 배포 안 함.
4. 생년월일·CMS 먼저 활성화 — 두 곳은 위험도 낮고(결제 무관) 연/월 순간이동 케이스
   (생년월일)를 실사용으로 조기 검증하기 좋음.
5. 장바구니 활성화(maxDate 포함) — 결제 연결된 화면이라 가장 마지막, 가장 신중하게.
6. 플래그·구(舊) 경로 삭제 — 5번과 같은 스프린트 내 정리(두 렌더링 경로를 영구
   공존시키지 않음).
```

### 검증 방법

```
- 정적: npm run check(svelte-check) 클린, 프로젝트 lint(any 금지 등) 클린.
- 신규 유닛테스트: calendarWindow.ts의 월별 행수(4/5/6행 경계 월 포함)·윈도우 클램핑·
  오프셋 왕복 계산.
- 신규 회귀가드 테스트: 기존 contractSign.test.ts류의 "소스 텍스트 직접 검사" 패턴을
  재사용해 CalendarGrid.svelte 안에 transform/contain/content-visibility/isolation/
  touch-action:none이 새로 들어가지 않았는지, z-index:-2/-1/2 선언이 그대로 남아있는지 고정.
- 실브라우저 수동 검증(3곳 전부, 플래그 on/off 비교):
  · 셀 상태 매트릭스(선택/과거/휴무차단/요일색/경계일하이라이트/경고빨강/범위밴드)
    월별·PC·모바일 폭 대조.
  · 수령 9/28→반납 10/3처럼 월 경계를 넘는 범위 선택 — 헤드라인 시나리오.
  · 마우스 드래그 후 오선택 안 됨 / 짧은 클릭은 정상 선택됨 / 터치 플릭은 스크롤만
    되고 선택 안 됨.
  · 30개월 이상 빠르게 스크롤 후 document.querySelectorAll('.cal-day').length가
    일정하게 유지되는지(DOM 무한증가 안 함).
  · 생년월일에서 연→월 순간이동이 즉시 되는지, 340px 좁은 패널에서 높이 계산이 맞는지.
  · 장바구니에서 오늘+181일 이후 전부 비활성 처리되는지(maxDate 동작).
  · 640px 브레이크포인트를 스크롤 중에 넘나들 때 앵커 월이 안 튀는지.
```

### 하네스 플로 반영 (요청 5번)

이 플랜 승인 후 실제 구현은 Claude 네이티브 실행이 아니라 `@promptor` → `TASK.md` 생성
(분석, 완료) → GATE B → `@harness-executor` 실행 경로를 따른다(AGENTS.md 확정 문구).
공유 컴포넌트 3곳에 영향을 주는 다중파일 변경이라 CLAUDE.md 등급 기준상 최소 🟡
BOUNDARY, 실질적으로는 결제 연결 화면(장바구니)까지 포함하므로 GATE B 승인 대상. TDD
도메인 여부(순수 로직 유닛테스트 부분)는 `@sp2-tdd-agents` 위임 대상이 될 수 있음 —
최종 판단은 harness-executor.

### GATE B 확인 항목

```
[ ] NOW 태스크(위 전체 계획)가 Stephen 의도와 맞는가?
[ ] 범위 밖 항목(TimePickerGrid.svelte·D-DINExp 폰트 3종·CalendarGrid 기존 미커밋
    폰트 변경)이 이번 태스크에 섞여 들어가지 않았는가?
[ ] 단계별 진행 순서(1~6단계) 그대로 진행해도 되는가, 아니면 순서 조정이 필요한가?
[ ] maxDate prop 추가(리스크 R1 대응) 방식에 이견이 없는가?
[ ] TDD 대상 범위(calendarWindow.ts 순수 로직)에 대한 이견이 없는가?
```

→ 승인: "GATE B 승인. NOW 실행해."
→ 수정: TASK.md 직접 수정 후 "GATE B: 내가 고쳤어. NOW 실행해."
→ 반려: "GATE B 반려. [이유]. 다시 작성해."

---

## NOW — 서버 액션 보안 공백: rental.change_cancel 계정별 권한 미집행 수정 (2026-09-15)

### 아젠다

Stephen 지시: CMS 예약현황 서버 액션(`changeReservation`, `updateStatus` cancelled 분기)에서
`rental.change_cancel` 메뉴 권한이 클라이언트 버튼 disabled만 막고 서버 액션 자체는 체크하지
않아, DevTools로 버튼을 활성화하면 권한 없는 매니저도 예약 변경·취소가 가능한 보안 공백을 수정.

TDD 필수(예약·보안 도메인). `updateStatus`의 partner 폴백 경로는 이번 범위 밖.

### 구현

```
src/routes/cms/reservation/+page.server.ts — 두 곳에 hasMenuAccess 체크 추가
  1. changeReservation 액션: admin 클라이언트 생성 직후, formData 파싱 전에
     cms_menu_permissions 조회 → hasMenuAccess(cmsRole, overrides, 'rental.change_cancel')
     → false이면 fail(403, { message: '이 계정은 예약변경·취소 권한이 없습니다.' })
  2. updateStatus 액션 — hasSettingsAccess(cmsRole) 분기(manager+) 진입 직후,
     payment_key 조회 전에 동일한 3줄 패턴으로 추가.
  partner/else 분기는 변경 없음(role 게이트에서 이미 차단).

src/__tests__/services/cmsMenus.test.ts — 6개 TDD 케이스 신규 추가
  describe('rental.change_cancel — 서버 액션 권한 체크 정합성 (2026-09-15)')
  · manager 오버라이드 없음 → 허용
  · superadmin 오버라이드 없음 → 허용
  · partner → role 레벨 차단(requiresSettingsAccess)
  · manager/superadmin + allowed=false 오버라이드 → 차단(서버 fail(403) 트리거 조건)
  · 다른 menu_key 차단은 rental.change_cancel에 영향 없음
  · partner + allowed=true 오버라이드 → 여전히 차단(좁히기 전용 불변)
```

### 검증

```
npx svelte-check — 신규 에러 0건(무관한 기존 vite.config.ts 에러 1건만 유지).
npx vitest run src/__tests__/services/cmsMenus.test.ts — 57/57 PASS (신규 6개 포함).
git commit은 Stephen 직접 실행 대기.
```

## NOW — 🔴 CRITICAL: CMS 예약변경/예약취소 헤더 버튼 + 재고구성 편집 결함 수정 (2026-09-14, 이 세션, GATE B 승인됨)

### 배경

Stephen이 `RentalDetailPanel.svelte` 헤더 영역에 '예약변경'·'예약취소' 버튼 신설을 요청.
조사 중 핵심 전제 확인: **하나의 예약 코드 = 여러 `rental_reservations` 행 = 항상 하나의
예약 건으로 취급**. 기존 "예약 취소" 버튼이 단일 `reservation_id`만 처리해 형제 행을
방치하는 버그(주문 전체 취소가 안 됨)도 함께 수정.

### 설계 요약 (플랜: `/Users/stevenmac/.claude/plans/launch-selected-element-element-tag-div-lexical-wand.md`)

**Priority A**:
1. 신규 RPC `revert_reservation_order_to_hold` — hold 되돌리기 + 결제취소 + 계약 sent_at 리셋(cron 회귀 방지)
2. `updateStatus` 액션 확장(order-wide cancel) + 신규 `changeReservation` 액션
3. `payment_transactions.pg_cancelled_at` 신규 컬럼
4. `send_rental_chat_notification` — `payment_cancelled_reissue` notify_type 추가
5. `RentalDetailPanel.svelte` 헤더 버튼 추가 + "환불 처리" 버튼 제거

**Priority B**:
6. `sync_order_after_composition_change` RPC + `cms_add_reservation_product_unit` / `cms_remove_reservation_product_unit` 결함 수정

### 마이그레이션 순서

```
#492 — revert_reservation_order_to_hold RPC (Stage → Production)
#493 — payment_transactions.pg_cancelled_at 컬럼 (Stage → Production)
#494 — send_rental_chat_notification payment_cancelled_reissue 추가 (Stage → Production)
#496 — sync_order_after_composition_change + cms_add/remove 수정 (Stage → Production)
   ⚠️ 2026-09-14 번호 정정: #495는 이 세션과 별도로 동시 진행 중이던 "본인증명·외국인증명
   개별 삭제/수정" 태스크가 이미 선점·적용 완료(foreign_verified_at 콤보완성 조건부 기록,
   Migration #495_foreign_verified_at_combo_complete_only.sql, Stage+Production 적용됨) —
   충돌 방지를 위해 이 태스크의 계획 번호를 #495→#496으로 정정(@sp3-qa-agent 지적으로 발견,
   실제 적용 전 단계라 파일 충돌은 발생하지 않았음).
```

### TDD 도메인 — 3개 테스트 파일 (모두 신규)

```
1. src/__tests__/services/revertReservationOrderToHold.test.ts
   - EC-1: 형제 2개 이상 주문 → 전부 hold + payment_confirmed_at NULL + contract_signings 리셋
   - EC-2: 형제 중 cancelled인 것은 건드리지 않음
   - EC-3: cron 회귀 — 리셋 직후 release_reservation_hold() 호출해도 hold 유지(가장 중요)
   - EC-4: 단건(형제 없음) 주문도 정상 동작

2. src/__tests__/services/updateStatusOrderWideCancel.test.ts
   - EC-1: 형제 2개 주문 "예약취소" → 전부 cancelled + 전액환불 + 계약 status=cancelled
   - EC-2: 미결제 hold "거부" → 형제 전체 cancelled, 환불·계약취소는 스킵
   - EC-3: 권한별 분기(매니저 이상만 환불·계약취소, 그 외는 상태전환만)

3. src/__tests__/services/syncOrderAfterCompositionChange.test.ts
   - EC-1: "+ 추가" 후 신규 행 reservation_code = 형제와 동일
   - EC-2: 총액이 compute_reservation_line_amount 결과를 반영해 재계산
   - EC-3: "✕ 삭제" 후 총액이 줄어듦
   - EC-4: 쿠폰·포인트·배송비 보존 재계산
```

### 진행 상태

- [x] TASK.md 등록
- [x] RED-1: revertReservationOrderToHold.test.ts 작성 (4/4 GREEN, Migration #492 Stage 적용 완료)
- [x] Migration #492: revert_reservation_order_to_hold RPC (Stage 적용 완료)
- [x] GREEN-1: 테스트 통과 (4/4 GREEN)
- [x] RED-2: updateStatusOrderWideCancel.test.ts 작성 (2 FAIL / 1 PASS — EC-1 contracts.status 미갱신, EC-2 PAYMENT_NOT_FOUND 형제 미취소)
- [x] Migration #493: pg_cancelled_at 컬럼 (Stage 적용 완료, 2026-09-14)
- [x] Migration #494: payment_cancelled_reissue notify_type (Stage 적용 완료, 2026-09-14)
- [x] tossPaymentCancel.ts 신규 헬퍼 + changeReservation 액션 + updateStatus 확장 (이전 서브세션 완료)
- [x] GREEN-2: updateStatusOrderWideCancel.test.ts 3/3 GREEN (Migration #496 포함, 2026-09-14)
- [x] RED-3: syncOrderAfterCompositionChange.test.ts 작성 (이전 서브세션 완료)
- [x] Migration #497: sync_order_after_composition_change + cms_add/remove 수정 (Stage 적용 완료, 2026-09-14)
- [x] GREEN-3: syncOrderAfterCompositionChange.test.ts 4/4 GREEN (2026-09-14)
- [x] RentalDetailPanel.svelte 클라이언트 변경 (§5 완료):
      - 헤더 `panel-header-actions` — '예약변경'(changeReservation)·'예약취소'(updateStatus+cancelled) 버튼 신설
      - 노출조건: canManagePaymentAndLocker(manager+) && !isTerminal && status !== 'hold'
      - 결제정보 탭 '취소 환불시간' 행 신설 (pg_cancelled_at 있을 때만)
      - '환불 처리' 버튼·handleRefund() 완전 제거
      - 본문 action-section의 단독 '예약 취소' 블록 제거
- [x] 전체 테스트 12/12 GREEN (revertReservationOrderToHold 4+updateStatusOrderWideCancel 4+syncOrderAfterCompositionChange 4, 2026-09-14)
- [x] svelte-check: 에러 1건 (vite.config.ts — vitest 설정 타입, 이번 작업과 무관한 기존 문제)
- [ ] Stage 수동검증 3가지(형제주문 예약변경 전체hold+전액취소 / 1~2분 내 expired 미발생 / 재고구성 편집 후 총액 정확성) — Stephen 또는 QA 담당자 직접 CMS 화면 조작 필요
- [ ] Production(`vnbpmvxruyciuuaermyh`) 마이그레이션 적용 — Stage 수동검증 완료 후
- [ ] sp3-qa-agent GATE E

### sp3-qa-agent GATE E 1차 반려 — 결함 3건 수정 중 (2026-09-14 후속 서브세션)

**반려 항목 3건 + 권고 1건 (전부 처리 완료, Migration #499 Stage 적용 대기)**

#### Defect 1 (CRITICAL) — updateStatus cancelled 분기: cancel_reservation_payment RPC만 호출하고 Toss API 미호출
- **수정 완료**: `src/routes/cms/reservation/+page.server.ts`
  - `cancelled` 분기 전체 재작성 (구 340번대 라인)
  - manager/superadmin(`hasSettingsAccess`) 경로: payment_key 2단계 조회 → `tossPaymentCancel()` 먼저 호출 → 성공 시 `pg_cancelled_at` 기록 → `cancel_reservation_payment` RPC 호출
  - PAYMENT_NOT_FOUND(hold 거부) 경로: Toss API 건너뛰고 RPC만 호출 (기존 동작 유지)

#### Defect 2 (HIGH) — cancelled 분기: hasSettingsAccess 게이트 부재로 partner도 환불+계약취소 가능
- **수정 완료**: 동일 파일
  - `hasSettingsAccess(cmsRole)` = true → 전체 Toss+RPC 경로
  - `hasSettingsAccess(cmsRole)` = false(partner) → `update_reservation_status` 상태전환만 (환불·계약취소 없음)
  - `cancelledSiblingIds` 변수를 분기 앞에 선언해 AUTO_NOTIFY 배치알림 블록에서 재사용

#### 권고(알림 배치) — cancelled 시 단일 reservationId에만 알림 발송
- **수정 완료**: `send_rental_chat_notification_batch` 사용으로 `cancelledSiblingIds.length > 1` 시 배치 발송

#### Defect 3 (HIGH) — revert_reservation_order_to_hold step 4: terminal 형제의 contract_signings.sent_at 미리셋 → 만료 위험
- **신규 마이그레이션 작성 완료**: `supabase/migrations/20260914070000_499_revert_reservation_order_to_hold_cron_fix.sql`
  - `CREATE OR REPLACE FUNCTION` — 기존 #492 직접 수정 금지 원칙 준수
  - `v_all_order_ids BIGINT[]` 추가 (terminal 포함 전체 order 형제)
  - step 3(rental_reservations UPDATE)은 `v_target_ids` 유지 (비terminal만)
  - step 4(contract_signings sent_at/signed_at/expires_at=NULL, token 갱신)은 `v_all_order_ids` 사용
  - **Stage 적용 대기**: project_id `ezyvffjvuwmtuhpxdjrw` — 상위 세션(Supabase MCP)이 적용 필요

#### TDD 보강
- `revertReservationOrderToHold.test.ts` — EC-5 추가: terminal 형제(old sent_at) + revert 후 release_reservation_hold() 호출 → hold 유지 검증
  - **현재 RED** (예상): Migration #499 Stage 미적용 상태 — 적용 후 GREEN 전환됨
- `updateStatusOrderWideCancel.test.ts` — EC-4 추가: partner 경로 시뮬레이션 → update_reservation_status만 → contracts.status=active 유지, payment_transactions=done 유지
  - **GREEN** 확인됨

#### 현재 검증 상태 (2026-09-14 기준)
```
revertReservationOrderToHold.test.ts : 4 PASS / 1 FAIL (EC-5 — Migration #499 대기)
updateStatusOrderWideCancel.test.ts  : 4 PASS (EC-1~EC-4 전부 GREEN)
syncOrderAfterCompositionChange.test.ts: 4 PASS (변경 없음)
svelte-check: 에러 0건(이 작업 기인) + 기존 vite.config.ts 1건(무관)
```

**최종 검증 완료 (2026-09-14 Migration #499 Stage 적용 후)**:
```
revertReservationOrderToHold.test.ts : 5/5 PASS ✅ (EC-1~EC-5 전부 GREEN)
updateStatusOrderWideCancel.test.ts  : 4/4 PASS ✅ (EC-1~EC-4 회귀 없음)
syncOrderAfterCompositionChange.test.ts: 4/4 PASS ✅ (회귀 없음)
svelte-check: 에러 0건(이 작업 기인) + 기존 vite.config.ts 1건(무관, 기존 문제)
총 테스트 13건 전부 GREEN, 회귀 없음.
```

**Stage 최종 적용 마이그레이션 전체 목록**: #492·#493·#494·#496·#497·#499 (6건)
**Production(`vnbpmvxruyciuuaermyh`)**: 여전히 미적용 — Stage 수동검증 + sp3-qa-agent 재검수 통과 후 적용 예정
**git 커밋**: 아직 없음 — Stephen 직접 실행 대기

**다음 단계**: sp3-qa-agent 재검수 → GATE E 통과 → Stephen git commit → Production 마이그레이션 적용

### sp3-qa-agent 2차 재검수 신규 결함 2건 수정 (2026-09-14 후속)

Stephen 확정: 결함 A(필수)·결함 B(권고) 둘 다 지금 수정. 1차 검수 통과분(Defect 1·2·3 + 이중확인 토스트) 건드리지 않음.

**Defect A (필수 — 취소 환불시간 항상 비어있음)**
- 원인: `findOrderPaymentTransaction()` `selectCols`에 `pg_cancelled_at` 미포함 → API가 이 필드를 반환 안 함 → `RentalDetailPanel.svelte`의 "취소 환불시간" 행이 항상 `undefined`
- 수정: `src/routes/api/cms/reservations/[id]/payment/+server.ts` → `selectCols` 마지막에 `pg_cancelled_at` 추가 (1줄 수정, DB 마이그레이션 불필요 — 컬럼은 Migration #493으로 이미 존재)

**Defect B (권고 — 결제 무결성: RPC 재시도+fail-soft 패턴 누락)**
- 원인: `changeReservation` 액션의 `revert_reservation_order_to_hold` RPC, `updateStatus` cancelled manager 경로의 `cancel_reservation_payment` RPC 둘 다 1회만 호출 — Toss 취소 성공 후 RPC 실패 시 결제는 환불됐는데 DB가 hold/active로 남는 정합성 결함
- 수정:
  - **신규 파일** `src/lib/server/rpcRetryWithFailSoftLog.ts` — 기존 PUT 핸들러의 재시도+fail-soft 패턴(3회 재시도 + DB fail 기록 + 관리자 push + admin_only 채팅카드)을 제네릭 헬퍼로 추출
  - `src/routes/api/cms/reservations/[id]/payment/+server.ts` PUT 핸들러 — 기존 ~100줄 인라인 블록을 헬퍼 호출 ~25줄로 교체
  - `src/routes/cms/reservation/+page.server.ts` — import 추가 + `changeReservation` revert 블록 교체 + `updateStatus` cancel 블록 교체
  - **신규 테스트** `src/__tests__/services/rpcRetryWithFailSoftLog.test.ts` — TC-1~TC-4 4/4 GREEN

**검증 결과**
```
svelte-check: 신규 에러 0건 (기존 vite.config.ts 1건은 무관, 기존 문제)
rpcRetryWithFailSoftLog.test.ts : 4/4 GREEN
approvalNotifications.test.ts   : 관련 테스트 GREEN (회귀 없음)
holdExpiration.test.ts          : GREEN (회귀 없음)
```

### sp3-qa-agent 3차 재검수 GATE E 통과 (2026-09-14, 이 세션 최종)

#### UI 최종 정합 — `src/lib/components/cms/RentalDetailPanel.svelte` (Stephen 실화면 피드백 다회 반영)

**헤더 버튼 스타일 + 이중확인 안전장치**
- `.btn-header-action`(퍼플 채움, '예약변경') / `.btn-header-action--danger`(레드 채움, '예약취소') — 44px, `--radius-md`(15px), scoped 로컬 클래스, outline/border 없음
- 이중확인 패턴 — `ProductDetailPanel.svelte` `deletePending`/`isDeleting` + `use:enhance cancel()` 게이팅 패턴 그대로 재현:
  - `changePending`/`isChanging` → 1차 클릭: `cancel()` 제출 차단 + `csToast.warning('한 번 더 클릭하면 예약이 변경됩니다')`, 2차 클릭: 실제 changeReservation 제출
  - `cancelPending`/`isCancelling` → 1차 클릭: `cancel()` 제출 차단 + `csToast.warning('한 번 더 클릭하면 예약이 취소됩니다')`, 2차 클릭: 실제 updateStatus cancelled 제출
  - 타이머 없음 (두 번째 클릭이 올 때까지 pending 유지)
- 노출조건: `canManagePaymentAndLocker(manager+)` && `!isTerminal` && `status !== 'hold'`

**기존 UI 정리**
- 본문 action-section 단독 '예약 취소' 블록 완전 제거 (헤더 버튼으로 대체)
- 결제정보 탭 '취소 환불시간' 행 신설 (`pg_cancelled_at` 있을 때만 노출)
- '환불 처리' 버튼 + `handleRefund()` 함수 완전 제거

**버튼 레이아웃 표준 정합 (`cms-uiux.md §0-10-C` 기준)**
- "재배정" 버튼(`.btn-reassign-small`) — `--cs-surface-gray` 배경 + `--cs-text-mid` 텍스트, 호버 시 배경↔텍스트 반전, `--radius-full`(pill), border 없음
- "운송장 저장" 버튼(`.btn-tracking-save--sm`) — 동일 스펙, 위치를 "운송장 정보" 제목 우측(`.section-title-row`/`.section-title-btns` 패턴)으로 재배치
- "반출 알림 발송" 버튼을 별도 `.notify-section`에서 `.action-section` 행으로 병합 (방문 출고 처리·파손 신고 접수 처리·반출 알림 발송 3버튼 한 행 정렬)
- `.action-section` 상단 여백 4px → 32px (`spacing-4xl`, DetailPanel 레이아웃 표준 통일)
- `.panel-tabs` 탭바 상하 패딩 16px 8px 신설 (`CustomerDetailPanel.svelte`와 동일 표준, 이 파일만 미반영이었던 것 해소)

**동반 정정 — `src/lib/components/cms/ProductDetailPanel.svelte`**
- "상품정보 삭제" 버튼 반경 `--radius-xl`(30px) → `--radius-md`(15px) 정정 (§0-10 44px CTA 브래킷 기준, `RentalDetailPanel` 헤더 버튼과 일치)

#### 지침 문서 — `.claude/rules-ref/cms-uiux.md` 갱신

- §0-10에 `ctaPrimaryPurple` 패턴 신규 등록: 44px 대형 CTA 퍼플 계열, Detail Panel 헤더 인라인 전용, `--radius-md`(15px), `--cs-purple` 채움, `#fff` 텍스트, hover `--cs-purple-dark`
- `closeCircle`(24×24 원형, 존재하지 않는 값) 폐기 표시
- §0-10-A를 강조형(`close-red`, A-1: 28×28, ✕ 문자, hover `--cs-red-badge`)와 일반형(`close-normal`, A-2: 24×24, ✕ 문자, 6px 반경 하드코딩, `RentalDetailPanel` 실제값 기반) 2종으로 재구성
- (§0-10-C "초소형 라운드 버튼형"은 이미 등록돼 있던 것을 이번 세션이 발견해 정확히 적용만 함, 신설 아님)

#### GATE E 최종 검증 결과 (3차 QA, 통과)

```
revertReservationOrderToHold.test.ts     : 5/5 GREEN (EC-1~EC-5)
updateStatusOrderWideCancel.test.ts      : 4/4 GREEN (EC-1~EC-4)
syncOrderAfterCompositionChange.test.ts  : 4/4 GREEN (EC-1~EC-4)
rpcRetryWithFailSoftLog.test.ts          : 4/4 GREEN (TC-1~TC-4)
총 TDD 17건 전부 GREEN, 회귀 없음.
svelte-check: 신규 에러 0건 (기존 vite.config.ts 1건은 무관)
```

**Stage(`ezyvffjvuwmtuhpxdjrw`) 적용 완료 마이그레이션**: #492·#493·#494·#496·#497·#499 (6건)
**Production(`vnbpmvxruyciuuaermyh`)**: 미적용 — Stephen 실사용 수동검증 후 별도 적용 예정
**git 커밋**: 아직 없음 — Stephen 직접 실행 대기

### 4차 후속 — `/cms/rentals` 대여현황 화면 CRITICAL 결함 해소 (2026-09-15, 이 세션)

**배경**: 직전 sp3-qa-agent 3차 검수 GATE E 통과 직후 추가 CRITICAL 지적 —
`/cms/rentals`(대여현황) 화면에서도 '예약변경'·'예약취소' 버튼이 노출·작동하여, 이미
출고/대여중/반납 처리된 예약(`shipped`·`in_use`·`return_requested`·`returned`)을 실수로
되돌리거나 취소하는 것이 가능했다. Stephen이 "화면 자체를 숨기지 말고, 상태별
비활성화 + 계정별 세부권한 + 서버측 강제"로 해결 방향을 확정.

#### 수정 내역

**1. 상태 기반 버튼 비활성화** — `src/lib/components/cms/RentalDetailPanel.svelte`
- `RESERVATION_CHANGE_CANCEL_LOCKED_STATUSES = new Set(['shipped', 'in_use', 'return_requested', 'returned'])` 신설
- '예약변경'·'예약취소' 버튼 `disabled` 조건에 이 상태 체크 추가 + 사유 설명 `title` 속성 추가
- `completed`/`cancelled`/`damage_claimed`/`expired`(기존 `isTerminal()`로 이미 버튼 숨김)와 `hold`는 기존 로직 그대로 커버 — 추가 불필요
- "대여기간 경과"(연체) 시간 기반 조건은 Stephen 명시적 보류(추후 별도 처리)

**2. 계정별 세부 권한 토글 신설 — `rental.change_cancel`** — `src/lib/constants/cmsMenus.ts`
- `CmsSubMenuDef.href`를 optional로 변경, "대여" 그룹에 `rental.change_cancel`(라벨 "예약변경 및 취소", `requiresSettingsAccess: true`) 항목 신설
- `roleAllowsMenuByDefault`/`hasMenuAccess` 함수가 href 없는(비라우트) 메뉴 키도 올바르게 판정하도록 수정
- `/cms/set/admin` 계정 상세 "권한설정" 탭의 "대여" 그룹에 ON/OFF 토글 자동 노출(SSOT 기반 렌더링, 별도 UI 코드 불필요)
- `src/routes/cms/rentals/+page.server.ts`, `src/routes/cms/reservation/+page.server.ts` `load()`에서 `cms_menu_permissions` 오버라이드를 조회해 `canChangeOrCancelReservation` boolean 계산 → `+page.svelte` → `RentalDetailPanel` prop 전달. false이면 버튼 `disabled`

**3. 서버측 강제 (보안 공백 해소, CRITICAL)** — `src/routes/cms/reservation/+page.server.ts`
- `changeReservation`, `updateStatus` manager 분기 양쪽에 `hasMenuAccess(cmsRole, menuOverrides, 'rental.change_cancel')` AND 조건 추가(역할 게이트 통과 후 계정별 세부권한 재검증). 권한 없으면 `fail(403, { message: '이 계정은 예약변경·취소 권한이 없습니다.' })`
- `updateStatus` partner 폴백 경로(형제 전체 상태전환만)는 이 세부권한과 무관하게 그대로 유지(애초에 매니저 전용 기능이 아님)

**4. 부수 수정 — dhero API 불필요 요청 제거** — `src/lib/components/cms/RentalDetailPanel.svelte`
- 두발히어로(dhero) 정보 조회 `$effect`가 계정 등급 무관 무조건 실행 → 파트너 계정에서 매번 403 콘솔 오류 발생하던 것 발견
- `canManagePaymentAndLocker`(매니저 이상) 체크를 `$effect` 최상단에 추가 — 매니저 이상에서만 요청(dhero API 자체는 원래부터 매니저 이상 전용으로 정상 동작 중이었음, 클라이언트의 불필요한 요청만 제거)

#### 변경 파일

```
src/lib/components/cms/RentalDetailPanel.svelte — RESERVATION_CHANGE_CANCEL_LOCKED_STATUSES 신설,
  disabled 조건 추가, dhero $effect 불필요 요청 제거
src/lib/constants/cmsMenus.ts — CmsSubMenuDef.href optional 변경,
  rental.change_cancel 항목 신설, hasMenuAccess 비라우트 메뉴 판정 수정
src/routes/cms/rentals/+page.server.ts — load()에 canChangeOrCancelReservation 추가
src/routes/cms/reservation/+page.server.ts — load()에 canChangeOrCancelReservation 추가
  + changeReservation·updateStatus 서버 세부권한 강제(fail 403)
```

#### 검증

```
src/__tests__/services/cmsMenus.test.ts: rental.change_cancel 서버 액션 권한 체크 정합성
  신규 6건 포함, 57/57 GREEN (상위 세션이 직접 재실행해 재확인 완료)
npx svelte-check: 신규 에러 0건 (기존 vite.config.ts 1건만 무관 기존 문제,
  상위 세션이 직접 재실행해 재확인 완료)
```

**현황**: Stage 수동검증 + Production 마이그레이션 + git commit 여전히 Stephen 직접 실행 대기
**다음 단계**: sp3-qa-agent 재검수(4차) → GATE E 통과 → Stephen git commit → Production 마이그레이션 적용

---

## NOW — 🔴 CRITICAL(신규 발견, 코드 결함): 웹훅 서명 검증 로직이 Toss 실제 사양과 불일치 — 심사 통과 여부와 무관하게 웹훅 안전망 상시 작동불가 (2026-09-14, Stephen 질문에 답하며 Toss 공식 문서 직접 조사로 발견)

```
[CONTEXT BRIDGE]
plan_source: Stephen이 "심사가 통과된 상태라면 지금 설정 그대로 결제 테스트 시 정상 결제가
  되는지" 질문 → 답변 조사 중 Toss 공식 문서(docs.tosspayments.com/reference/using-api/
  webhook-events)를 WebFetch로 직접 확인하며 발견. 코드 수정은 아직 안 함(발견·보고만,
  Stephen 지시 대기).
GATE 등급: 🔴 CRITICAL — 결제 도메인, 웹훅 안전망(대사 처리) 전체가 대상.
```

### 확인된 사실 (Toss 공식 문서 원문 인용, docs.tosspayments.com/reference/using-api/webhook-events)

```
"tosspayments-webhook-signature - payout.changed, seller.changed 웹훅 헤더에만
  포함되는 웹훅 서명입니다."
"{WEBHOOK_PAYLOAD}:{tosspayments-webhook-transmission-time} 값을 보안 키로
  HMAC SHA-256 해싱하세요."
"웹훅 헤더에서 v1: 뒤에 오는 2개의 값을 모두 base64로 디코딩하세요."
```

즉:
  1. 서명 헤더는 `payout.changed`·`seller.changed` 이벤트에만 포함됨 —
     우리가 등록 권장한 `PAYMENT_STATUS_CHANGED`(TASK.md 위 블록, 2026-09-10)에는
     Toss가 애초에 서명을 보내지 않는다.
  2. 헤더 이름도 다름: Toss `tosspayments-webhook-signature` vs 코드
     `src/routes/api/webhooks/toss/+server.ts:39`의 `toss-payments-signature`.
  3. HMAC 원문도 다름: Toss는 `{payload}:{transmission-time}` 결합 문자열, 코드는
     `rawBody` 단독 해싱(`+server.ts:14-28` verifyTossSignature).
  4. 서명에 쓰는 키는 시크릿 키가 아니라 별도 "보안 키"(`/guides/v2/payouts#보안-키`
     문서에 링크됨) — payment.md·TASK.md의 2026-08-30 결정("보안 키는 정산지급대행
     전용이라 불필요")은 이 맥락에서는 정확했음(payout.changed/seller.changed는
     실제로 안 쓰는 이벤트이므로).

### 실제 영향

```
현재 핸들러(+server.ts:19,42)는 `if (!signature) return false` → 401 반환 구조라,
서명이 아예 없는 PAYMENT_STATUS_CHANGED 웹훅은 Toss 가맹점 심사 통과 여부와 무관하게
100% 401로 거부된다 — raw_webhook_logs에 영원히 기록 안 됨, process_pending_toss_
webhooks(2분 cron) 안전망은 대사할 데이터 자체가 없어 사실상 죽은 상태.

⚠️ 이건 "결제 성공 자체"는 막지 않는다 — payment.md에 이미 문서화된 대로 실제 결제확정은
/contract/[token]/pay-result가 Toss confirm API를 동기 직접 호출 + RPC 갱신하는 구조라
웹훅과 무관하다. 영향받는 건 안전망(고객이 결제 후 정상 리다이렉트되지 않는 이탈 케이스를
잡아주는 대사 로직)뿐 — 이런 케이스는 지금 그대로면 영구히 미탐지·미교정됨.
```

### 조치 방향(코드 수정 필요, Stephen 지시 대기 — 아직 미착수)

```
옵션 A: PAYMENT_STATUS_CHANGED처럼 서명이 없는 이벤트 타입은 서명 검증을 스킵하고
  raw_webhook_logs에 그대로 기록(신뢰 확보는 process_pending_toss_webhooks가 Toss
  결제조회 API로 payload의 orderId·paymentKey를 재조회해 대조하는 방식으로 보완 —
  Toss도 서명 없는 이벤트는 "결제 API로 재조회해 신뢰성 확보" 패턴을 권장하는 것으로
  보임, 명시적 가이드 문장은 이번 조사에서 못 찾음 — 문의 필요할 수 있음).
옵션 B: payout.changed/seller.changed 웹훅도 함께 등록해 그쪽은 정식 서명검증(헤더명
  tosspayments-webhook-signature·payload:time 결합·보안 키)을 별도 구현하고,
  PAYMENT_STATUS_CHANGED는 옵션 A와 동일하게 처리.
→ 둘 다 코드 변경(+server.ts) 필요 — 이 세션은 아직 수정하지 않음, Stephen 확인 후 진행.
```

GATE C: CRITICAL — 발견·문서화 완료, 코드 수정 미착수(Stephen 지시 대기). git 조치 없음.

---

## NOW — 🔴🔴 CRITICAL(진짜 근본원인 확정): Toss 가맹점(crazysfc8s·bill_crazyhevr) 심사 미완료 — 코드/설정 문제 아님 (2026-09-14, Stephen 제공 Toss 콘솔 캡처로 확정)

```
[CONTEXT BRIDGE]
plan_source: Stephen이 "실서버 결제 연동 로직 확인해" 재요청 → 4일간(2026-09-10~14) 실거래 0건
  지속 확인 후, Stephen이 Toss 개발자센터 콘솔 캡처 2장을 직접 제공해 근본원인이 밝혀짐.
GATE 등급: 🔴 CRITICAL — 결제 도메인, 외부(Toss) 의존 이슈로 코드 수정 불가능한 종류.
```

### 확정된 근본원인 — 아래 NOW 블록(2026-09-10)의 "미검증 상태" 진단을 대체

```
Toss 개발자센터 콘솔(Stephen 제공 캡처) 확인 결과:

  MID              용도(코드 매핑)                    Toss 계약 상태
  crazysfc8s       단건결제(.widgets(), 계약서명결제)   심사중 ⚠️
  bill_crazyhevr   정기결제/빌링(.payment())            심사중 ⚠️
  link_crazy5vdb   (코드 미사용)                        계약완료
  crazyswpjb       (코드 미사용)                        심사중

crazysfc8s의 "API 개별 연동 키" 섹션(라이브 탭)에 Toss가 직접 표시한 경고:
  "계약이 완료되지 않은 상점은 라이브 환경에서 결제를 할 수 없어요. 계약 전 결제
  테스트를 원하시면 '테스트 키'로 연동해주세요."

→ 이 서비스가 실결제에 쓰는 두 MID(crazysfc8s·bill_crazyhevr) 모두 Toss 가맹점 심사가
  끝나지 않은 상태 — Vercel에 올바른 라이브 키를 등록하고 웹훅·서명검증·코드 로직이
  전부 정상이어도, Toss 서버 자체가 API 호출 단계에서 결제를 거부한다(가맹점 심사 미완료
  라이브 요청 자체를 차단하는 Toss 측 정책). 2026-09-10~14 payment_transactions·
  raw_webhook_logs가 4일 내내 0건이었던 것은 이 때문일 가능성이 매우 높음 — 코드·
  Vercel 설정 문제가 아니라 이 외부 승인 절차가 유일한 남은 블로커.
```

### 이전 진단과의 관계 (2026-09-10 블록 폐기 아님 — 여전히 유효, 다만 원인 규명이 완성됨)

```
2026-09-10 블록의 ①(env var 등록 해소)·③(DB 실거래 0건) 관찰 자체는 그대로 유효하다 —
다만 "왜 0건인가"에 대한 결론이 "미검증 상태(장애 아님)"에서 "Toss 가맹점 심사
미완료로 인해 구조적으로 라이브 결제가 불가능한 상태"로 명확해졌다. 즉 지난 세션이
제안한 "실카드 E2E 테스트"·"위젯 마운트 확인" 등은 심사가 완료되기 전까지는 시도해도
Toss 측에서 거부될 가능성이 높아 우선순위가 낮아짐 — 심사 완료가 선행 조건.
```

### 다음 조치 — Stephen 직접 필요(코드로 해결 불가)

```
1. Toss 개발자센터 또는 담당 영업 채널을 통해 crazysfc8s·bill_crazyhevr 두 상점의 심사
   진행 상황을 확인·독촉.
2. 심사에 필요한 서류(사업자등록증·통장사본·대표자 신분증 등, Toss가 요구하는 항목)가
   누락되지 않았는지 콘솔에서 직접 확인.
3. 심사 완료("계약완료") 확인 후에만 지난 세션들이 준비해둔 나머지 절차(라이브 웹훅
   등록·crazyshot.kr DNS 전환·실카드 E2E 테스트)를 이어서 진행 — 순서상 이게 먼저.
4. 심사 완료 후 재검증 요청 시, 이 세션이 실제 라이브 결제(소액) 성공 여부를
   payment_transactions·raw_webhook_logs INSERT 발생으로 즉시 확인 가능.
```

GATE C: CRITICAL — 근본원인 확정(외부 Toss 심사 이슈, 코드/DB 변경 없음). git 관련 조치 없음.

---

## NOW — 🔴 CRITICAL: 실서버(Production) 토스페이먼츠 PG API 라이브 상태 재검증 (2026-09-10, 이 세션 단독 진단·코드 변경 없음)

```
[CONTEXT BRIDGE]
plan_source: Stephen "실서버(Production) 토스페이먼츠 PG API 라이브 상태 재검증" 요청.
배경: 2026-09-01 세션이 "Production PG(Toss) 연동 전면 장애 — Vercel 환경변수 5종 전부
  미등록"을 진단(위 아카이브/이전 블록 참고)하고 Stephen에게 등록·재배포를 요청한 채로
  종료됨 — 그 이후 재확인 기록이 TASK.md·GSD_LOG.md 어디에도 없어 이번 세션이 처음부터
  다시 실측 검증함.
GATE 등급: 🔴 CRITICAL — 결제 도메인 실서비스 상태 확인(실측, 코드/DB 변경 없음).
```

### ① 환경변수 등록 여부 — ✅ 해소됨(2026-09-01 CRITICAL 진단 해결 확인)

```
`vercel env ls production`(scope=pseries, project=crazyshot-svelte) 직접 조회 결과, 5개
변수(TOSS_SECRET_KEY / TOSS_BILLING_SECRET_KEY / PUBLIC_TOSS_CLIENT_KEY /
PUBLIC_TOSS_BILLING_CLIENT_KEY / VITE_TOSS_CLIENT_KEY) 전부 Production에 등록돼 있음을
확인(생성일 "9d ago" ≈ 2026-09-01 진단 직후로 추정 — Stephen이 그 직후 등록한 것으로 보임).
등록 이후 Production 재배포가 수십 건 발생(가장 최근 28분 전)해, "새 env var가 기존 빌드에
반영 안 된 상태"는 아님 — 신규 빌드는 전부 이 값을 포함해 배포됨.

라이브 확인: `/api/webhooks/toss`에 서명 없는 POST 요청 전송 → HTTP 401 정상 응답
(HMAC 서명 검증 로직이 살아있고 라우트가 정상 배포돼 있음을 실측 확인).
```

### ② ⚠️⚠️ 신규 발견 — 클라이언트 키 3종이 "test_" 접두사(테스트 키) — Production에 실서비스(live) 키가 아님

```
`vercel env pull`로 Production 값을 로컬 임시파일에 받아 "접두사(5자)+길이"만 확인 후
즉시 파일 삭제(전체 값은 이 세션이 열람하지 않음 — API 키 세션 안전규칙 준수):

  PUBLIC_TOSS_CLIENT_KEY          → 접두사 test_ (37자)
  PUBLIC_TOSS_BILLING_CLIENT_KEY  → 접두사 test_ (36자)
  VITE_TOSS_CLIENT_KEY            → 접두사 test_ (37자)

  TOSS_SECRET_KEY / TOSS_BILLING_SECRET_KEY → Vercel "Sensitive" 값으로 등록돼 있어
  CLI pull 자체가 마스킹된 placeholder만 반환(이 세션이 값을 볼 수 없음 — 보안상 정상).
  다만 Toss는 클라이언트키·시크릿키를 상점(MID) 단위로 쌍으로 발급하므로, 클라이언트 키가
  test_이면 짝을 이루는 시크릿 키도 test_일 가능성이 매우 높음(확정은 Stephen이 Toss
  개발자센터에서 직접 대조해야 함 — 이 세션은 값 열람 불가).

→ 2026-09-01 진단 당시 이미 "테스트 키를 Production에 등록하면 실카드 결제 자체가 Toss
  측에서 거부됨"이라고 경고했던 리스크가 실제로 발생한 상태로 판단됨 — 화면상 SDK 에러는
  해소됐어도, 실카드로 결제를 시도하면 Toss가 테스트 모드로 처리(또는 거부)할 가능성이 높아
  "라이브(실서비스) 상태"라고 보기 어려움.
```

### ③ Production DB 실측 — 실연동 전환(2026-08-29~30) 이후 실거래 0건

```
crazyshot(vnbpmvxruyciuuaermyh) 직접 조회(SELECT만, 변경 없음):
  payment_transactions           총 0행
  raw_webhook_logs(source='toss') 총 0행
  cron.job('toss-webhook-reconcile') active=true, */2 * * * * — 정상 등록·가동 중

  user_subscriptions 3건 / subscription_payment_logs 3건 존재하나 전부 created_at=
  2026-08-28(mock=1 시절 데이터, 2026-08-29~30 실연동 전환 이전) — 실카드 처리 기록 아님.

→ 결론: 인프라(웹훅 라우트·서명검증·cron 대사)는 살아있지만, ①Production 자격증명이
  테스트 키이고 ②실연동 전환 이후 지금(2026-09-10)까지 단 1건의 실제 결제 승인·웹훅도
  발생한 적이 없어, "실서비스 라이브 결제가 실제로 작동 확인됨"이라고 판정할 근거가 없음
  (장애는 아니나 미검증 상태).
```

### 복원/확인 조치 — Stephen 직접 필요(이 세션은 시크릿 열람·교체 불가)

```
1. Toss 개발자센터에서 crazysfc8s(단건)·bill_crazyhevr(빌링) 두 상점의 "라이브(운영)" 클라이언트/
   시크릿 키 쌍을 직접 확인.
2. 현재 Vercel Production에 등록된 5개 값이 그 라이브 키와 일치하는지 대조 — 불일치하면
   `vercel env rm <key> production` 후 `vercel env add <key> production`으로 라이브 키로
   교체(이 세션은 값 입력 대행 불가 — API 키 세션 안전규칙).
3. 교체 후 재배포(`vercel --prod` 또는 대시보드 Redeploy) 필수.
4. 가능하면 소액 실카드 1건으로 /contract/[token] 결제위젯 end-to-end 실거래 테스트를
   Stephen이 직접 진행해 payment_transactions·raw_webhook_logs에 실제 행이 생기는지 확인
   (이 세션은 실카드 결제를 대행하지 않음 — Prohibited action 원칙).
```

GATE C: CRITICAL — 재검증 완료(환경변수 등록은 해소, 테스트키 사용은 신규 발견). 코드/DB
변경 없음(순수 조회). git 관련 조치 없음.

### 후속 — Stephen이 라이브 키 채팅 제공 → 매핑 확정 + 등록은 Stephen 직접(이 세션 값 미기록)

```
⛔ 이 세션은 API 키/시크릿 값을 어떤 필드에도 입력·기록하지 않는다는 절대 규칙에 따라,
Stephen이 채팅으로 제공한 실제 키 값은 이 파일을 포함한 어떤 파일에도 기록하지 않는다.
아래는 "어떤 값을 어디에 넣어야 하는가"에 대한 매핑 결정만 기록.

코드 실측(contract/[token]/+page.svelte:221 `.widgets()` 사용 / subscribe/[planId]/
+page.svelte:73 `.payment()` 사용) 근거로 매핑 확정:
  - "주문서형·결제창형 연동 키"(결제위젯 계열) → crazysfc8s(단건) →
    PUBLIC_TOSS_CLIENT_KEY·VITE_TOSS_CLIENT_KEY(클라이언트)·TOSS_SECRET_KEY(시크릿)
  - "API 개별 연동 키" → bill_crazyhevr(빌링) →
    PUBLIC_TOSS_BILLING_CLIENT_KEY(클라이언트)·TOSS_BILLING_SECRET_KEY(시크릿)
  - "보안 키" → 등록 불필요(2026-08-30 기존 결정 유지 — 정산지급대행·현금영수증 등
    미사용 기능 전용, live/test 전환과 무관)

실제 Vercel 값 교체·재배포는 Stephen이 `vercel env rm/add <NAME> production` + `vercel --prod`
로 직접 실행. 웹훅: `/api/webhooks/toss`가 TOSS_SECRET_KEY(crazysfc8s 전용) 하나로만 서명
검증하므로 bill_crazyhevr 웹훅은 등록 대상 아님 — crazysfc8s 라이브에 `PAYMENT_STATUS_CHANGED`
1개만 등록 권장.

⛔ **URL 정정(같은 세션, 등록 직후 발견)**: 최초 안내한 `https://crazyshot.kr/api/webhooks/toss`는
**틀린 정보였음** — `vercel alias ls` 실측 결과 `crazyshot.kr`/`www.crazyshot.kr`은 이 Vercel
프로젝트(crazyshot-svelte)와 전혀 연결돼 있지 않고 IMWEB(임웹) 별도 호스팅으로 응답함(nginx +
IMWEBVSSID 쿠키로 확인). 이 프로젝트의 실제 Production 도메인은 `crazyshot-svelte.vercel.app`
(alias 확인됨) — Stephen 확인 결과 **"crazyshot.kr로 DNS 전환 예정이나 아직 미변경"** 상태.
→ 웹훅은 지금 당장은 `https://crazyshot-svelte.vercel.app/api/webhooks/toss`로 등록하고,
향후 crazyshot.kr DNS 전환이 완료되면 그 시점에 웹훅 URL을 crazyshot.kr 기준으로 재등록
(또는 추가 등록) 필요 — 잊지 않도록 다음 세션에서도 이 항목 확인할 것.

### ✅ 등록·재배포 완료 확인(같은 세션, 2026-09-10)

Stephen이 5개 변수(PUBLIC_TOSS_CLIENT_KEY·VITE_TOSS_CLIENT_KEY·TOSS_SECRET_KEY·
PUBLIC_TOSS_BILLING_CLIENT_KEY·TOSS_BILLING_SECRET_KEY) 전부 `rm`→`add`(Sensitive 저장)로
교체 후 `vercel --prod` 재배포 완료(터미널 로그로 순서·성공 확인). 이 세션이 재확인:
  - `vercel env ls production` — 5개 전부 재등록 시각 최신(35~39분 전)으로 갱신 확인
  - `curl -X POST https://crazyshot-svelte.vercel.app/api/webhooks/toss`(서명 없는 요청) →
    재배포 후에도 401 정상 응답(서명검증 로직 정상 동작 유지)

미완료: Toss 라이브 웹훅 등록(crazyshot-svelte.vercel.app 기준으로 정정 필요)·실카드 E2E
검증·crazyshot.kr DNS 전환 후 웹훅 URL 재확인 — 전부 Stephen 직접 진행 대기.
```

---

## NOW — 🔴 CRITICAL: Toss 라이브 웹훅 등록 — crazyshot.kr DNS 전환 완료 후 반드시 실행 (2026-09-10 예약, 착수 조건 미충족으로 대기)

```
⛔ 착수 조건: crazyshot.kr(커스텀 도메인) DNS가 이 Vercel 프로젝트(crazyshot-svelte)로
전환 완료된 이후에만 실행. 그 전까지는 아래 "임시(현재)" 절차만 유효.

배경: 2026-09-10 "실서버 토스페이먼츠 PG API 라이브 상태 재검증" 세션에서 Production
env var 5종 라이브 키 교체·재배포까지 완료했으나, 이 시점 `crazyshot.kr`은 이 Vercel
프로젝트와 연결돼 있지 않고(IMWEB 별도 호스팅으로 확인, `vercel alias ls` 실측)
Stephen이 "곧 DNS 전환 예정, 아직 미변경"이라고 확인함. 웹훅은 도메인이 확정된 뒤에만
정확히 등록할 수 있어 별도 후속 항목으로 분리.
```

### 지금(DNS 전환 전) 임시로 등록해야 할 웹훅

```
Toss 개발자센터 → 웹훅 → 상점아이디(MID) 검색창에 "crazysfc8s" 입력 → 탭을 "라이브"로 전환
→ "+ 웹훅 등록하기" 클릭 → 모달에서:
  이름  : 임의(예: "crazyshot-svelte-prod")
  URL   : https://crazyshot-svelte.vercel.app/api/webhooks/toss
  이벤트: PAYMENT_STATUS_CHANGED 1개만 체크(나머지 DEPOSIT_CALLBACK·METHOD_UPDATED·
          CUSTOMER_STATUS_CHANGED·payout.changed·seller.changed·BILLING_DELETED·
          ORDER_PAYMENT_STATUS_CHANGED·ars-reservation.changed는 가상계좌·브랜드페이·
          지급대행·링크페이·ARS 등 이 서비스가 쓰지 않는 기능 — 체크 안 함)
→ "등록하기"

⛔ bill_crazyhevr(빌링) MID에는 웹훅을 등록하지 않는다 — `/api/webhooks/toss`
(src/routes/api/webhooks/toss/+server.ts)가 서명검증에 TOSS_SECRET_KEY(crazysfc8s 전용)
하나만 쓰므로, bill_crazyhevr에서 온 웹훅은 서명 불일치로 전부 401 거부됨(등록해도 무의미).
```

### DNS 전환 완료 후 반드시 할 일 (이 블록의 진짜 목적)

```
1. 위에서 crazyshot-svelte.vercel.app으로 등록한 웹훅의 URL을
   https://crazyshot.kr/api/webhooks/toss (또는 실제 확정된 서비스 도메인)로 수정
   — Toss 개발자센터 웹훅 목록에서 기존 항목 "수정" 또는 삭제 후 재등록.
2. 이벤트 타입(PAYMENT_STATUS_CHANGED)·MID(crazysfc8s)는 그대로 유지.
3. 수정 후 실카드 결제 1건 또는 Toss 대시보드의 "웹훅 테스트 발송" 기능으로 실제 수신
   확인 — 확인 방법: crazyshot(Production, vnbpmvxruyciuuaermyh) DB에서
   `select count(*) from raw_webhook_logs where source='toss'`가 0에서 증가하는지 확인
   (2026-09-10 재검증 시점 기준 0건이었음 — 이 수가 늘면 웹훅이 정상 도달한 것).
4. 확인되면 이 블록 헤더를 `## DONE`으로 변경.
```

GATE C: CRITICAL(결제 도메인) — 착수 대기(DNS 전환 조건 미충족). 코드 변경 없음, Toss
대시보드 설정 작업만(Stephen 직접 실행 — 이 세션은 Toss 대시보드 접근 권한 없음).

---

## BACKLOG — 확정되지 않은 세부 가정 (실행 중 Stephen 확인 필요, 블로킹 아님)
- ~~[sp3-qa-agent 발견, 2026-08-21] 3개 신규 관리모달의 입력창이 §0-A 표준 `cms-field`(44px
  min-height)를 그대로 쓰지 않고 각자 로컬 커스텀 클래스(32~40px)로 재정의됨~~ → **✅ 해소
  (2026-08-26)**: Stephen이 `ProductCategoryModal`(`#kw-picker`)과 `HomeCategoryProductsModal`
  (`#hcp-search-camera`)의 SuggestPicker 입력창 UI가 서로 다르게 보인다고 직접 지적 →
  `cms-uiux.md §7-7/§12`에 이미 정본으로 문서화돼 있던 `.f-input`(gray-fill·테두리없음·
  radius 8px·outline focus) 스펙을 기준으로 `HomeThemeGroupModal.tg-search-input`,
  `HomeCategoryProductsModal.hcp-input`을 전부 `.f-input`으로 교체·통일. 재발 방지를 위해
  `uiux-index.md` SuggestPicker 항목에 `.f-input` 강제 사용 경고를 명시적으로 추가(기존엔
  cms-uiux.md §12 상세문서에만 있어 놓치기 쉬웠음).

- **"검색 중…" 안내문 위치 통일 (2026-08-26, 같은 세션 후속)** — Stephen 지적: 비동기 검색
  피커(`noFilter`+디바운스 RPC)의 "검색 중…"/"불러오는 중…" 텍스트가 `SuggestPicker` 여는
  태그 위(앞)에 있어 입력창보다 먼저 보임 → `SuggestPicker` 닫는 태그 아래(뒤)로 통일 이동.
  대상 4곳 전부 수정: `HomeCategoryProductsModal.svelte`, `ProductHeroModal.svelte`,
  `HypePackBannerModal.svelte`, `CrazylogBannerModal.svelte`(`HomeThemeGroupModal`/
  `HypePackThemeGroupModal`은 애초에 이 안내문 자체가 없어 대상 아님). `npm run check` 신규
  ERROR 0건. `uiux-index.md` SuggestPicker 항목에 위치 규칙 명문화(신규 피커 추가 시 재발 방지).

- **`SuggestPicker` 선택 후 입력창 자동 비움 — `clearOnSelect` prop 신설 (2026-08-26, 같은
  세션 후속)** — Stephen 지적: `HomeCategoryProductsModal`에서 상품을 검색·선택할 때마다
  선택한 상품명이 입력창에 그대로 남아 다음 검색 전에 매번 직접 지워야 하는 불편 존재, "컴포넌트
  에도 적용해"(공통 컴포넌트 레벨 수정) 요청. **주의**: 전체 15개 소비처를 조사한 결과 절반가량
  (`cms/promotion/coupon`의 `f_type`/`f_discount_type`/`f_user_grade`, `onGroupPickerSelect`
  계열, `/products/search` 등)은 `<select>` 대체용 **단일값 선택기**라 선택한 라벨을 입력창에
  계속 보여주는 현재 동작이 오히려 정답이라, 컴포넌트 기본값을 무조건 바꾸면 그쪽이 회귀함 —
  그래서 `clearOnSelect?: boolean`(기본값 `false`, 기존 동작 100% 보존) opt-in prop으로 설계.
  `selectOption()`에서 `clearOnSelect` true일 때만 `selectedId=null; query=''`로 즉시 초기화.
  "검색→추가→재검색" 반복 패턴인 10개 SuggestPicker 인스턴스에 `clearOnSelect` 명시 적용:
  `HomeCategoryProductsModal`·`HomeThemeGroupModal`·`HypePackThemeGroupModal`·
  `ProductHeroModal`·`HypePackBannerModal`(상품피커+키워드피커 2개)·`CrazylogBannerModal`·
  `ProductCategoryModal`(카테고리피커+키워드피커 2개)·`CrazylogKeywordModal`. 단일값 선택기
  9곳은 기본값 유지로 무수정. `npm run check`: 신규 ERROR 0건(vite.config.ts 기존 무관 에러
  1건만 잔존). `cms-uiux.md §12-3` Props 표에 `noFilter`(기존 누락분 포함)·`clearOnSelect`
  추가, `uiux-index.md`에 사용 기준(반복추가용 vs 단일값선택기) 명문화.

- **`HomeThemeGroupModal` 아코디언 토글 버튼 스타일을 `HypePackThemeGroupModal`과 통일
  (2026-08-26, 같은 세션 후속)** — Stephen이 두 "테마그룹 관리" 모달의 그룹 카드 레이아웃을
  직접 스크린샷 비교로 대조 지적. 실제 CSS를 전수 대조한 결과 `.tg-group-card`/`.tg-group-row`/
  `.tg-title-input`/`.tg-del-btn`/`.tg-subcopy-input`/`.tg-add-btn`는 이미 두 파일이 완전히
  동일한 수치였고, 유일한 실제 차이는 `.tg-expand-btn`(상품편집 아코디언 토글) — HypePack은
  `ChevronIcon` SVG 컴포넌트(+flex 중앙정렬 CSS)를 쓰는데 Home은 `▲`/`▼` 유니코드 텍스트 글자를
  그대로 렌더링(중앙정렬 CSS도 누락)해 시각적으로 다르게 보였음. `HomeThemeGroupModal.svelte`에
  `ChevronIcon` import 추가 + 텍스트 글리프를 `<ChevronIcon direction/size={8}/color>`로 교체 +
  `.tg-expand-btn`에 `display:flex;align-items:center;justify-content:center` 추가로 통일.
  **명시적으로 유지**: 그룹 대표 썸네일은 Home=원형(`border-radius:50%`) 그대로 유지, HypePack의
  정사각 라운드(`var(--radius-sm)`)로 바꾸지 않음(Stephen 명시 지시). HypePack에만 있는
  "노출(is_active) 토글" 체크아이콘 버튼은 이번 요청이 "레이아웃 스타일"에 한정돼 기능 이식은
  하지 않음(범위 외 — 필요시 별도 요청). `npm run check` 신규 ERROR 0건.

  ⛔ **1차 수정 불충분 — Stephen 재지적("레이아웃 스타일이 전혀 반영되지 않았어")**: 알려진
  선택자 이름만 grep으로 대조하는 방식으로 접근해 진짜 원인을 놓침. `<style>` 블록 전체를
  `diff`로 재대조한 결과 **`.tg-body > :global(.drag-list) { gap: 30px }`**(그룹 카드 사이
  간격) 규칙이 HypePack에는 있고 Home에는 통째로 빠져 있었음 — `CmsDragList` 기본 gap이
  8px라 Home의 카드가 훨씬 빽빽하게 붙어 보인 것이 스크린샷에서 가장 두드러진 실제 차이였음
  (버튼 아이콘 차이는 부차적이었음). `HomeThemeGroupModal.svelte`에 동일 규칙(그룹카드
  30px + 상품편집 아코디언 내부 상품목록은 8px 유지, `.tg-products-area :global(.drag-list)`로
  분리)을 추가해 해소. `npm run check` 신규 ERROR 0건 재확인.
  **교훈**: 두 파일 레이아웃 비교 시 알고 있는 선택자만 골라 대조하지 말고 `<style>` 블록
  전체를 `diff`로 대조할 것 — 예상 못한 선택자(이번 경우 부모 `.tg-body`에 걸린 자식결합자
  규칙)가 실제 원인일 수 있음.

  ⛔ **2차 재지적("그룹카드 목록 별 노출 체크아이콘 버튼 UI 누락, 상품목록 별 제목명 줄임
  누락")**: 1차 수정에서 "노출(is_active) 토글은 레이아웃 스타일 요청 범위 밖"이라고 판단해
  의도적으로 제외했던 것이 Stephen 기준에서는 틀린 판단이었음 — 이번엔 명시적으로 두 항목
  전부 포함해 재작업. **DB 구조 문제 발견**: `home_theme_groups`는 Migration #322 설계 당시
  이미 `is_active` 컬럼을 갖고 있었으나, 관리자 편집모달(`groups` prop)이 공개용
  `get_home_theme_groups_with_products()`(is_active=true만 반환)를 그대로 재사용하고
  있어서, 토글 UI만 이식하면 "비노출로 바꾼 그룹이 관리자 목록에서도 사라져 다시 켤 수
  없는" 함정이 있었음 — HypePack 쪽(Migration #343, 같은 세션 중 동시 진행 중이던 다른
  작업)이 이미 `get_hype_pack_theme_groups_admin()`(비노출 포함 전체 조회, 관리자 전용)
  분리로 해결한 선례를 그대로 재사용. **구현**: Migration #355
  (`20260826060000_355_home_theme_groups_visibility_toggle.sql`, hype-pack #343과 동일
  패턴) — `cms_create_theme_group`/`cms_update_theme_group`에 `p_is_active` 파라미터 추가
  (5-param 오버로드 DROP 후 6-param 재생성, PGRST203 방지) + 신규 `get_home_theme_groups_
  admin()`(관리자 전용, is_active 무관 전체 조회) RPC. `src/routes/+page.server.ts`에
  `themeGroupsAdmin`(isCms일 때만 조회) 추가 + 가격 조회 대상 상품ID를 admin 데이터 우선
  사용하도록 조정 + `withDualPrice` admin 배열에도 적용 + load 반환값에 `themeGroupsAdmin`
  추가. `src/routes/+page.svelte`의 `<HomeThemeGroupModal groups={...}>`를 `data.themeGroups`
  → `data.themeGroupsAdmin`로 교체(비관리자에게는 애초에 로드 안 됨). `HomeThemeGroupModal.
  svelte`에 `is_active` 필드·`toggleActive()`·노출 체크아이콘 버튼(HypePack과 동일 SVG+CSS)
  + `truncateName()`(MAX_NAME_LEN=20, `title={p.name}` 툴팁 포함, HypePack과 동일) 추가.
  Stage(ezyvffjvuwmtuhpxdjrw) 적용 완료 — 함수 시그니처 재조회로 6-param 정상 등록 확인,
  `npm run check` 신규 ERROR 0건. **production 적용은 Stephen 승인 대기 중.**

- **원형탭 "3개 초과 시 가로 스크롤" — PC 실측 검증 + 모바일 미구현 발견 → 모바일도 PC와
  동일 구조로 신규 구현 (2026-08-26, 같은 세션 후속)** — Stephen 요청: "3개 이상 그룹 생성 시
  가로 스크롤 UX 로직 작동 정상 확인, 모바일 반응형에도 반영 확인." Stage DB에 QA검증용 4번째
  그룹을 임시 INSERT해 실측 → **PC: 정상 확인**(4개일 때 좌우 화살표 노출, 클릭 시 3개 노출
  구간이 정확히 슬라이드, 검증 후 임시 데이터 즉시 DELETE로 원복). **모바일: 애초에 미구현
  발견** — PC는 "원형 탭 1개 선택 → 공유 상품슬라이드 1개만 전환"(`activeThemeId`/
  `activeThemeProducts`) 구조인데, 모바일은 `{#each data.themeGroups as tg}`로 전체 그룹을
  세로로 나열하고 그룹마다 독립 슬라이드를 반복하는 완전히 다른 구조라 캡핑·화살표 개념 자체가
  없었음(탭 전환이 아니므로). Stephen 확인 후 **모바일도 PC와 동일한 탭 구조로 변경** 결정.
  **구현**: `mThemeTabsEl`/`scrollMThemeTabs()`(PC의 `themeTabsEl`/`scrollThemeTabs`와 동일
  패턴, 별도 DOM 참조) 신규 추가. 모바일 마크업을 그룹별 반복 슬라이드 구조에서 PC와 동일한
  원형 탭 목록(`.m-theme-circle-tabs-wrap`, 3개 초과 시 화살표, `activeThemeId` 공유) + 공유
  상품슬라이드(`activeThemeProducts`, 기존 `.m-prod-card`/`.m-snap-slider` 재사용) 구조로
  교체. CSS는 PC(`.theme-circle-tabs` 180px 원형·gap 30px·max-width 600px)를 모바일
  규격(140px 원형·gap 20px·max-width 460px = 140×3+20×2)으로 축소해 신규 작성
  (`.m-theme-circle-tabs`/`.m-theme-tabs-arrow`). 그룹 0개일 때의 샘플 자리표시 블록(단일
  원형, 캡핑 불필요)은 변경 없이 유지. 실제 브라우저(모바일 375px 뷰포트)로 탭 클릭 시
  슬라이드 전환 확인 완료.
  ⛔ **검증 중 부가 발견·수정(회귀 아님, 기존 결함)**: `.theme-hl-card--m`(모바일 축소
  변형, `border-radius:28px`)이 CSS 소스 순서상 `.theme-hl-card--circle`(50%)보다 뒤에
  선언돼 있어 단일클래스 동률 특이성으로 후자를 덮어씀 — 모바일 테마 아바타가 코드 주석의
  의도("원형 아바타 스타일")와 달리 완전한 원이 아닌 28px 둥근 사각형으로 렌더링되고 있던
  기존 결함(이번 세션 변경 이전부터 존재, 이번 작업 중 실측하다 발견). 복합 선택자
  `.theme-hl-card--m.theme-hl-card--circle { border-radius: 50% }`로 명시적 우선순위를
  부여해 해소, `getComputedStyle`로 50% 반영 확인.
  DB 변경 없음(순수 프론트) — `npm run check` 신규 ERROR 0건(기존 vite.config.ts 무관 에러
  1건만 잔존).

- **원형탭 캡핑 슬라이드 좌우 끝 페이드 처리 (2026-08-26, 같은 세션 후속)** — Stephen 지적:
  3개 초과 캡핑 시 스크롤 컨테이너 경계에서 카드가 뚝 잘려나가는 느낌이 있어 배경으로
  부드럽게 스며드는 페이드 처리 요청. `.theme-circle-tabs--capped`(PC)·
  `.m-theme-circle-tabs--capped`(모바일) 둘 다에 `mask-image`/`-webkit-mask-image:
  linear-gradient(to right, transparent 0, black Npx, black calc(100% - Npx), transparent 100%)`
  추가(PC 30px, 모바일 24px — 각 원형 크기(180px/140px)에 비례). 배경색에 의존하지 않는
  마스크 방식이라 별도 오버레이 DOM 없이 순수 CSS로 해결. Stage에 QA검증용 그룹을 5개까지
  임시로 늘려 실제로 `scrollWidth(1230px) > clientWidth(600px)`로 오버플로우가 발생하는
  상태에서 `getComputedStyle`로 `mask-image` 정상 적용 확인 후 임시 데이터 삭제로 원복
  (테스트 중 동시 진행 중이던 다른 세션이 추가한 정식 그룹 "모험가"는 건드리지 않고 내가
  넣은 행만 정확히 골라 삭제). DB 변경 없음 — `npm run check` 신규 ERROR 0건.

- **카테고리 메뉴 커스텀 아이콘 PC에서 매우 작게 보이는 결함 원인분석·수정 + 모바일 부재
  확인 (2026-08-26, 같은 세션 후속)** — Stephen 지적: "중고품" 카테고리 탭 아이콘이 PC에서
  매우 작게 보임. **원인**: 업로드된 커스텀 아이콘 SVG 3개(`lens`/`camera`/`used-item`)를
  전부 직접 fetch해 대조한 결과, 셋 다 동일하게 **100x100 캔버스에 자체 배경(`#E1DEF3`,
  `rx=30` — `.cat-tab-icon`의 비활성 배경색·radius와 완전히 동일)을 이미 포함한 "완결형
  타일"**로 제작돼 있었음. 그런데 프론트 CSS(`.cat-tab-custom-icon`)는 이걸 40x40으로
  욱여넣고 있어서, 아이콘 파일 자체의 여백까지 함께 축소돼 실제 그림 부분이 40px의 절반
  이하(체감 18px 수준)로 쪼그라들어 보였음(내장 SVG 폴백 아이콘들은 24-unit viewBox를
  40x40에 꽉 채우는 방식이라 이 문제가 없었음 — 커스텀 아이콘만 유독 작아 보인 이유).
  **수정**: `.cat-tab-custom-icon`을 부모 `.cat-tab-icon`과 동일한 100x100(+radius 30px)로
  확대해 아이콘 파일을 있는 그대로 꽉 채움. 실측(getBoundingClientRect)으로 정상 크기 확인.
  ⚠️ **부작용 발견 → ✅ 해소(2026-08-26, 같은 세션 후속)**: 커스텀 아이콘 3개가 전부 비활성
  배경색을 정적으로 baked-in하고 있어(활성 상태 색 배리언트 없음), 크기를 100%로 키우면
  부모의 활성/비활성 배경색 전환이 완전히 가려짐 — 커스텀 아이콘 탭은 클릭해도 활성 표시가
  사라지는 부작용이 있음을 Stephen에게 보고, 처음엔 보완 여부를 물어 "응답 보류 — 다음 지시
  대기" 상태였으나 이후 Stephen이 명시적으로 해결 요청 → `.cat-tab.active .cat-tab-icon:has(
  .cat-tab-custom-icon)`에 `box-shadow: 0 0 0 3px var(--cs-purple)` 보라색 링 추가로 해소.
  `:has()` 선택자로 커스텀 아이콘 탭에만 정확히 스코프해 내장 SVG 아이콘 탭(이미 배경색
  전환만으로 충분)에는 중복 표시 없음 — 실측(getComputedStyle)으로 "중고품"(커스텀) 활성
  시 링 정상 적용 확인. `npm run check` 신규 ERROR 0건.
  **모바일 확인**: 이 카테고리 아이콘 탭 섹션(`.d-cat-section`) 자체가 `<div class="desktop-
  wrap">` 안에만 존재하고 `<div class="mobile-wrap">`에는 대응 마크업이 없음 — 모바일에는
  이 UI가 아예 렌더링되지 않아 "작게 보이는지" 확인할 대상 자체가 없음(PC 전용 기능, 별도
  버그 아님). DB 변경 없음 — `npm run check` 신규 ERROR 0건.

- **cat-tabs(카테고리 아이콘 탭) ↔ "미·칠 PICK!" 헤딩 사이 여백 확보 + 모바일 반영
  (2026-08-26, 같은 세션 후속)** — Stephen 지적: 두 영역 사이가 너무 붙어 보임. PC는
  `.michil-heading`에 `margin-top:24px` 국소 추가(부모 `.d-cat-section`의 공용 flex
  gap 32px는 다른 형제 요소 간격에도 영향을 주므로 건드리지 않고, 이 지점에만 국소
  적용 — 실측 결과 cat-tabs 하단↔michil-heading 상단 간격 정확히 56px(32+24) 확인).
  **모바일**: 이 카테고리 아이콘 탭이 없어 동일한 두 요소 페어링 자체가 존재하지 않으므로,
  가장 가까운 대응 관계인 이전 섹션(취향직격 테마그룹, `.m-theme-section`) → "미칠 PICK"
  섹션(`.m-michil-section`) 경계에 PC와 동일한 증분(+24px)을 반영 — `padding-top: 40px`
  → `64px`. 브라우저(1280px PC / 375px 모바일)로 실측 스크린샷 대조해 양쪽 다 여백 확대
  확인. DB 변경 없음 — `npm run check` 신규 ERROR 0건.

- **"Package" 타이틀 바를 "미·칠 PICK!" 헤딩 아래로 재배치 — PC 전용
  (2026-08-26, 같은 세션 후속)** — Stephen 지적: `.pkg-bar`("Package" 라벨+화살표)가
  카테고리 아이콘 탭보다 위에 있던 걸 "미·칠 PICK!" 헤딩 바로 아래로 옮겨달라는 요청.
  `.d-cat-section`(PC `desktop-wrap` 전용, 모바일에는 대응 마크업 자체가 없어 "PC
  반응형만 해당" 조건이 자동 충족됨) 내 직계 자식 순서를 `pkg-bar → cat-tabs →
  michil-heading → ...`에서 `cat-tabs → michil-heading → pkg-bar → ...`로 재배치(마크업
  블록을 통째로 이동, 스타일·로직 변경 없음 — `.d-cat-section`이 flex-column+gap이라
  DOM 순서만 바꾸면 시각적 순서도 그대로 따라옴). 브라우저 스크린샷으로 카테고리 아이콘 탭
  → "미·칠 PICK!" → "Package" 바 → 상품카드 순서 확인. DB 변경 없음 — `npm run check`
  신규 ERROR 0건.

- **모바일 초기화면 "카테고리 슬라이드 메뉴 영역" → "MD 추천" 영역으로 대체 +
  /products와 관리기능 완전 공유 (2026-08-26, 같은 세션 후속)** — Stephen 요청: `/products`
  페이지의 "MD 추천" 레이아웃을 홈페이지 모바일 초기화면에 노출하되, ①관리기능을 동기화
  공유하고 ②모바일에서는 기존 카테고리 슬라이드 메뉴 영역(`.m-michil-section`, "미칠
  PICK!" 카테고리 탭 연동 상품슬라이드)을 가리고 이 레이아웃으로 대체할 것.
  **조사(Explore 서브에이전트)**: `/products`의 "MD 추천"은 `cms_settings` 키
  `product_page_md_picks`(`{products:[{id,order}], mode}`)를 `get_product_page_settings()`
  RPC로 읽고, 관리 모달은 `ProductMdPickModal.svelte`(`ProductHeroModal.svelte`를
  `settingKey="product_page_md_picks"`로 파라미터화한 얇은 래퍼) → 저장 시
  `upsert_product_page_setting(p_key:'product_page_md_picks', ...)` 호출 — 이미 확립된
  5개 화이트리스트 키(`product_page_hero`/`categories`/`grid`/`md_picks`/`keywords`) 중
  하나. **구현**: 별도 신규 기능을 만들지 않고 **동일한 키·동일한 모달 컴포넌트를 홈페이지에
  그대로 재사용**해 요구사항 ①(관리기능 동기화)을 근본적으로 충족(어느 화면에서 편집해도
  같은 `cms_settings` 행을 공유하므로 "동기화"를 위한 별도 배선이 필요 없음). `src/routes/
  +page.server.ts`에 `product_page_md_picks` 조회(기존 `Promise.all` 배치에 4번째 항목
  추가) + `mdPickIds`를 기존 `get_products_by_ids` 일괄조회에 병합(중복 RPC 호출 방지) +
  `mdProducts` 파생(정렬·random 모드 셔플) + `priceProductIds`/`withDualPrice`에 포함 +
  `mdPicksRaw`(모달 편집용 원본)·`mdProducts`(표시용 해석값) 분리 반환(§0-A #12 편집
  초기값 오염 방지 패턴 재사용). `src/routes/+page.svelte`에 `ProductMdPickModal` import +
  `showMdPickModal` state + "✦ MD 추천 설정" 버튼. **요구사항 ②**: 모바일 마크업에서 기존
  `.m-michil-section` 블록(카테고리 탭 연동 상품슬라이드, activeCatProds 기반)을 완전히
  제거하고 `.md-picks-section`(신규, `/products`의 `.md-picks-*` 디자인을 모바일 폭에
  맞게 이식 — 카드 200px→160px, 이미지박스 200px→160px로 축소, 나머지 레이아웃 동일)으로
  교체 — PC의 카테고리 탭+미칠PICK 섹션(`.d-cat-section`)은 이 요청 범위 밖이라 전혀
  손대지 않음(모바일에는 애초에 대응 마크업이 없어 "모바일 전용" 조건 자동 충족).
  **동반 데드코드 정리**: 제거된 블록에서만 쓰이던 `mpickIdx`/`mpickSliderEl`/
  `onMpickScroll`(JS)과 `.m-michil-section`/`.m-michil-head`/`.m-prod-dots`/
  `.cat-empty-notice--mobile`(CSS)를 함께 삭제(내가 이번 편집으로 직접 orphan시킨
  코드라 정리 — 이전 세션이 남긴 `.m-pkg-*`/`pkgIdx` 등 무관한 기존 BACKLOG 데드코드는
  건드리지 않음). 텍스트 클래스는 기존 `.m-prod-name`(흰 글자, 이미지 오버레이용 — 다른
  용도로 이미 사용 중)과 이름이 겹치지 않도록 `.md-pick-name`/`.md-pick-price` 등 전용
  클래스로 분리(색상 반전 버그 방지). 실측: `cms_settings.product_page_md_picks`에 이미
  등록된 실제 데이터(Sony FX6-12·SONY PXW-Z90)로 모바일 뷰포트(375px)에서 이미지·가격
  정상 렌더링 확인 + "✦ MD 추천 설정" 버튼 클릭 시 `/products`와 완전히 동일한 상품
  목록이 뜨는 모달 확인(진짜 공유 검증) + PC(1280px)에서 기존 카테고리 탭 섹션이 전혀
  변경되지 않았음을 재확인. DB 변경 없음(기존 `product_page_md_picks` 키·RPC 재사용) —
  `npm run check` 신규 ERROR 0건.

- **모바일 취향직격 원형탭 그룹 좌측 정렬 → 중앙 정렬 (2026-08-26, 같은 세션 후속)** —
  Stephen 지적: 모바일 반응형 전환 시 `.m-theme-circle-tabs-wrap`(원형탭 그룹, 좌우
  화살표 포함) 내용이 좌측에 쏠려 보임. 원인: `.m-theme-circle-tabs-wrap`이
  `position:relative`만 있고 `display:flex`/정렬 속성이 없어, 자식 `.m-theme-circle-tabs`
  (3개 초과 시 `max-width:460px`로 캡핑됨)가 일반 블록 흐름대로 좌측에 붙어 렌더링되던
  것. `.m-theme-circle-tabs-wrap`에 `display:flex; justify-content:center` 추가로 해소 —
  화살표 버튼(`.m-theme-tabs-arrow`)은 `position:absolute`라 flex 정렬의 영향을 받지 않고
  기존 좌우 끝 배치 그대로 유지됨. 모바일(375px) 브라우저 실측으로 탭 그룹이 정중앙에
  배치되고 화살표가 좌우 대칭으로 유지되는 것 확인. DB 변경 없음 — `npm run check` 신규
  ERROR 0건.

- **PC 반응형에도 동일 중앙 정렬 적용 (2026-08-26, 같은 세션 후속)** — Stephen 요청:
  방금 모바일에 적용한 원형탭 중앙 정렬을 PC에도 동일하게. PC `.theme-circle-tabs-wrap`에도
  동일한 `display:flex; justify-content:center` 추가. 실측 결과 PC는 `.theme-pick-row`가
  이미 `justify-content:center`로 (제목+탭그룹)을 한 덩어리로 중앙 정렬하고 있었고, 캡핑된
  탭 그룹(600px)이 래퍼 자체 폭과 정확히 일치해(`getBoundingClientRect`로 wrap=tabs=600px,
  leftGap=rightGap=0 확인) 육안상 이미 중앙에 있었음 — 이번 추가는 향후 래퍼 폭이 콘텐츠보다
  커지는 경우에도 안전하게 중앙을 보장하는 방어적 적용(모바일과 동일 패턴 유지, 회귀 없음).
  ⚠️ **환경 이슈, 별도 보고**: 이번 검증 중 Claude Browser 패널이 반복적으로 정지/빈 화면
  (동일 프레임 고착)을 반환해 스크린샷으로 최종 확인은 못함 — 대신 `read_page`(접근성
  트리)로 탭 5개(Idol/크리에이터/여행가/모험가/감성리스트)·화살표·상품슬라이드·카테고리탭
  ·미칠PICK·Package 순서가 전부 정상 렌더링됨을 확인했고, `getBoundingClientRect`로 정렬
  수치까지 직접 검증함 — 코드 자체의 정상 동작은 확인됐으나 픽셀 단위 스크린샷 재확인은
  브라우저 도구 복구 후 필요 시 추가 진행. `npm run check` 신규 ERROR 0건.

- **모바일 "취향직격 PICK" 섹션 아이콘을 PC와 동일한 스파클 아이콘으로 교체
  (2026-08-26, 같은 세션 후속)** — Stephen 지적: PC `.theme-pick-title-wrap`의 스파클
  아이콘(`viewBox 0 0 38 21`, 채워진 별 모양)이 모바일에는 반영 안 되고, 다른 여러 섹션과
  공용인 일반 물결 곡선 아이콘(`M2 8 Q8.5 2 17 8 Q25.5 14 32 8`)이 대신 쓰이고 있었음 —
  모바일 "취향직격 PICK" 헤더만 PC와 동일한 아이콘으로 교체하고 비율(38:21)을 유지한 채
  모바일 규격(34x19)으로 축소. 다른 모바일 섹션(헬프·크레이지로그 등)의 물결 아이콘은
  그대로 유지(공용 자산이라 범위 밖). `npm run check` 신규 ERROR 0건.

- **`HomeBannerModal` 3종 검수(기능·CMS 표준·히어로 샘플이미지 처리) (2026-08-26, 같은
  세션 후속)** — Stephen 요청: "홈 히어로 배너 관리" 모달의 기능 정상 작동 여부, CMS 표준
  디자인시스템 위배 요소, 초기화면 히어로 BG 이미지가 하드코딩인지 샘플인지 확인.
  **① 기능 검증**: 코드 리뷰(`save()`/`saveBannerSlot()`/`onImageChange()`) + 브라우저 실측
  (행 추가→텍스트 입력 반영→✕ 삭제) 정상 확인 — 삭제된 배너 소프트삭제, 신규/기존 배너
  생성·수정 분기, `home_hero_banner_settings` 저장까지 로직 정상. 단, 이 개발서버 브라우저
  세션의 로그인 세션이 실제로는 만료돼 있어(`/account` 접근 시 로그인 페이지로 리다이렉트
  확인) 실제 이미지 업로드→저장 전체 라운드트립까지는 검증 못함 — 모달 코드 문제 아니라
  이 세션의 인증 상태 문제.
  **② CMS 표준 위배 발견·수정**: `.cms-field` 클래스가 이름은 §0-A #8 표준("cms-field")을
  따르는 것처럼 보이나 실제 값은 딴판이었음 — `height:32px`(표준: `min-height:44px`),
  `padding:0 10px`(표준: `12px 16px`), `background:var(--cs-white)`(표준: `var(--cs-
  surface-gray)`), `border:1px solid var(--cs-lilac)`(표준: `border:none`). §0-A #8은
  "배너 헤더카피/서브카피/링크" 필드를 명시 대상으로 지정하고 있어 바로 이 모달이 원래
  적용 대상이었음. 표준값 그대로 수정, 브라우저 실측으로 44px 이상 회색채움 무테두리
  입력창 정상 반영 확인.
  **③ 히어로 샘플이미지 처리 확인**: `/home/desktop/1fbafe64...png`·`1bbde5f7...png`(PC),
  `/home/mobile/ac4438...png`(모바일)는 `{#if pcCarousel.length > 0}...{:else}`(모바일도
  동일 패턴)의 `{:else}` 분기에서만 렌더링되도록 이미 정확히 게이팅돼 있음 — 실제 배너를
  추가하면 `pcCarousel`/`mobileCarousel`이 채워지며 `{#if}` 분기로 전환돼 샘플이 자동으로
  가려짐(이미 올바르게 구현됨, 버그 아님). 현재 등록된 배너가 0개라 샘플이 보이는 것이
  정상 상태. `npm run check` 신규 ERROR 0건.

### 세션 종합 요약 (Phase 4 후속, 2026-08-26 — GATE E 검수 요청 시점까지)

이 세션에서 Phase 4 완료 이후 Stephen이 실사용 중 발견한 결함·요청을 순차 처리한 전체 목록
(각 항목 상세는 위 개별 bullet 참고, 전부 `npm run check` 신규 ERROR 0건 확인 완료):

1. [x] `SuggestPicker.svelte` 연속 검색+추가 불가 버그 — `closeSuggest()`의 `isFocused` 강제
   초기화가 원인, 드롭다운만 닫도록 분리해 해소
2. [x] `SuggestPicker.svelte` 선택 직후 유사상품이 뜬금없이 재검색되는 버그 —
   `selectOption()`의 불필요한 `oninput` 재호출 제거
3. [x] `SuggestPicker.svelte` `clearOnSelect` prop 신설(opt-in, 기본값 false) — "검색→추가→
   재검색" 반복 패턴 10개 인스턴스(8개 파일)에 적용, 단일값 선택기 9곳은 무수정
4. [x] `HomeCategoryProductsModal`/`HomeThemeGroupModal` SuggestPicker 입력창을 §7-7/§12
   표준 `.f-input`으로 통일(기존 `.hcp-input`/`.tg-search-input` 커스텀 클래스 제거)
5. [x] 비동기 검색 피커 4곳("검색 중…" 안내문)을 `SuggestPicker` 닫는 태그 아래로 위치 이동
6. [x] `HomeThemeGroupModal` 아코디언 토글 아이콘을 `HypePackThemeGroupModal`과 동일한
   `ChevronIcon`으로 통일 + 그룹 카드 간 여백(30px) 정상화(진짜 원인은 `.tg-body >
   :global(.drag-list) { gap: 30px }` 누락이었음, 1차 아이콘 수정은 불충분했음)
7. [x] `HomeThemeGroupModal`에 "노출(is_active) 토글" 체크아이콘 버튼 + `truncateName()`
   추가 — Migration #355(`get_home_theme_groups_admin` 신설, 관리자 전용 전체조회) +
   `+page.server.ts`의 `themeGroupsAdmin` 배선 포함(Stage+Production 적용 완료)
8. [x] 한글 초성(chosung) 검색 지원 — Migration #354(`hangul_chosung()` 함수 +
   `products.name_chosung`/`brand_chosung` 생성열 + `search_products` RPC 확장), 영문↔한글
   상호 매핑은 없음(Stephen 확정), Stage+Production 적용 완료
9. [x] 취향직격 원형탭 "3개 초과 시 가로 스크롤" — PC 실측 검증 완료 + 모바일에 동일 구조
   신규 구현(기존엔 탭 전환 개념 자체가 없었음) + 좌우 끝 페이드(mask-image) 추가
10. [x] 카테고리 메뉴 커스텀 아이콘이 PC에서 매우 작게 보이던 버그 — 아이콘 파일 자체가
    100x100 완결형 타일인데 40x40으로 욱여넣던 것이 원인, 100x100로 확대 수정 + 활성화 시
    시각 표시가 사라지는 부작용을 보라색 링(`:has()` 스코프)으로 해소
11. [x] `cat-tabs`↔"미·칠 PICK!" 헤딩 사이 여백 확보(PC+모바일 동일 증분 반영)
12. [x] "Package" 타이틀 바를 "미·칠 PICK!" 헤딩 아래로 재배치(PC 전용)
13. [x] 모바일 초기화면 "카테고리 슬라이드 메뉴 영역" → `/products`와 **완전히 동일한
    `product_page_md_picks` 키·모달을 공유**하는 "MD 추천" 영역으로 대체(관리기능 동기화
    요구사항 충족) — DB 마이그레이션 없이 기존 인프라 재사용
14. [x] 모바일 취향직격 원형탭 그룹 좌측 정렬 → 중앙 정렬(PC도 동일 적용, 방어적 조치)
15. [x] 모바일 "취향직격 PICK" 섹션 아이콘을 PC와 동일한 스파클 아이콘으로 교체(기존엔
    공용 물결 아이콘 오용)
16. [x] `HomeBannerModal` 3종 검수 — 기능 정상(코드리뷰+실측), `.cms-field`가 §0-A #8 표준과
    괴리돼 있던 것을 수정, 히어로 샘플이미지 게이팅은 이미 정상 구현 확인(버그 아님)

신규 마이그레이션(전부 Stage+Production 적용 완료): #354(초성검색), #355(테마그룹
노출토글). DB 변경 없는 순수 프론트 수정 다수. 동시 진행 중이던 다른 세션의 변경분(예:
`HypePackThemeGroupModal`의 is_active/초성검색 자체 구현, `hype-pack/+page.server.ts`,
Migration #343/#356 등)은 이 세션 작업물이 아니므로 위 목록에서 제외.

**GATE E(@sp3-qa-agent) 검수 결과 — ✅ 통과 (2026-08-26)**: 검수1(공통 보안·도메인 규칙)·
검수2(기술부채: console.log/any타입/TODO 신규 0건, `npm run check` 이 세션 관련 신규 ERROR
0건)·검수3(시범오픈 기준: 마이그레이션 rollback 포함·RLS 격리·N+1 쿼리 없음·가격병합 누락
없음·PC `.d-cat-section` 무영향·비밀키 안전) 전 항목 통과. 개별 확인: ①`clearOnSelect`
opt-in 유지로 단일값 선택기(coupon f_type/f_discount_type, products/search 등) 회귀 없음
②Migration #354/#355 함수 시그니처 충돌 없음·권한 적절 ③`+page.server.ts` N+1/가격병합
문제 없음 ④모바일 MD추천과 PC 카테고리 섹션 완전 독립 ⑤범위 외 수정·타 세션 작업물 침범
없음. 블로킹 수정 0건 — 비블로킹 권고 1건(`.m-pkg-*` 죽은 코드, 기존 BACKLOG 항목과 동일,
이번 세션 범위 아님). **커밋은 Stephen이 직접 실행.**

- [sp3-qa-agent 발견, 2026-08-21] `HomeCategoryProductsModal.svelte`의 상품검색 결과 매핑이
  `search_products` RPC에 없는 필드(`image_urls`, 실제는 `image_url` 단수)를 참조해 항상 null로
  귀결되는 죽은 필드 참조 — 화면에 렌더링되지 않아 실사용 영향 없음
- [sp3-qa-agent 발견, 2026-08-21] PICK써클→테마그룹 대체 과정에서 남은 죽은 코드: `PACKAGES`
  배열·`pkgIdx`/`pkgSliderEl`/`onPkgScroll`(JS), `.m-pkg-*` CSS 8개 셀렉터(`src/routes/+page.svelte`)
  — `npm run check` WARNING으로 실제 검출됨, 기능 영향 없으나 정리 권장
- 크레이지로그 슬롯 병합 방식: slot1+2+3 전체 풀링 후 중복제거로 가정 — 실제 화면 확인 후 Stephen
  피드백 있으면 조정
- FAQ 데스크탑/모바일 통합: 서로 다른 하드코딩 세트를 하나의 상위5(usage_count 전역 기준)로 통합
  가정 — 데스크탑/모바일에 서로 다른 기준이 필요하면 별도 조정
- help_hero_bg_images 재사용 해석: `.faq-brand-box` 배경이미지로 문자 그대로 재사용 가정 — 다른
  위치/용도 재사용을 원하면 별도 조정
- 카테고리 슬라이드 빈 상태: 큐레이션 안 된 카테고리는 섹션을 숨김 처리(대체쿼리 없음) 가정 —
  폴백 UI가 필요하면 별도 조정
- 홈페이지 카테고리 "탭 목록"(어떤 카테고리가 노출되는지·순서·아이콘) 자체는 아직
  `product_page_categories` 설정을 반영하지 않음(Phase 4, 2026-08-21) — 상품 큐레이션은
  100% 동기화됐으나 탭 목록은 여전히 `code_mapping_groups` 전체 노출 유지. 탭 목록까지
  완전 동기화하려면 `+page.server.ts`의 categories 조회 로직을 `product_page_categories`
  필터/정렬 반영하도록 별도 후속 작업 필요(의도적으로 범위 보수적 제한, 버그 아님)

### Phase 4 후속 — 상품검색 SuggestPicker 버그 3건 수정 (2026-08-26, 같은 세션)

Stephen이 `HomeCategoryProductsModal`/`HomeThemeGroupModal`의 상품 검색 UI 실사용 중 발견한
결함 3건. 전부 진단→수정 완료.

1. **"1개 이상 상품 추가 불가" 버그** (`HomeCategoryProductsModal`에서 최초 재현) — 원인:
   공용 `SuggestPicker.svelte`의 `selectOption()`이 `closeSuggest()`를 호출해 `isFocused`를
   강제로 `false`로 만드는데, 옵션 클릭 시 `onmousedown preventDefault`로 실제 DOM 포커스는
   입력창에 남아있어 "실제 포커스 상태"와 어긋남. 이후 비동기 검색결과(`options` prop 갱신)가
   도착해도 `$effect`의 `isFocused` 분기가 else로 빠져 드롭다운이 다시 열리지 않아, 첫 상품
   추가 후 두 번째 검색부터 결과가 전혀 안 뜨는 것으로 나타남. **수정**: `selectOption()`에서
   `closeSuggest()` 대신 드롭다운만 닫음(`suggestOpen=false; suggestIdx=-1`), `isFocused`는
   건드리지 않음.
2. **"검색 한 번에 다른 상품이 줄줄이 딸려오는" 버그** (`HomeThemeGroupModal`에서 재현, 1번
   수정 직후 드러남) — 원인: `selectOption()`이 선택 직후 `oninput?.(query)`를 호출하는데
   이때 `query`가 방금 선택한 상품명 그대로라, 부모의 디바운스 검색 콜백이 그 상품명으로
   몰래 재검색을 실행 → 유사한 이름의 다른 상품이 뜬금없이 드롭다운에 다시 나타남(1번 수정
   전에는 `isFocused`가 죽어있어 이 재검색 결과가 화면에 반영되지 못해 숨겨져 있던 버그).
   **수정**: `selectOption()`에서 `oninput?.(query)` 호출 제거 — 선택 통지는 `onselect`만으로
   충분, `oninput`은 실제 타이핑(`handleNativeInput`) 시에만 호출.
   → 두 수정 모두 `SuggestPicker.svelte`(전역 공용 컴포넌트)에 적용되어 동일 검색+선택
   패턴을 쓰는 모든 소비처(`ProductHeroModal`·`HypePackBannerModal`·`/products/search`·
   `CrazylogBannerModal`·`cms/promotion/coupon`·`cms/subscriptions/new`·`cms/products/new`
   등)에 공통 반영됨.
3. **초성 검색 미지원** (`search_products` RPC 자체의 기존 한계, 이 세션에서 신규 지원 추가) —
   Postgres FTS(`'simple'` config)+`pg_trgm` 유사도만 쓰던 기존 로직은 한글 초성(예: "ㅇㅅㅌㅅ")
   만으로는 매칭이 안 됨. Stephen 확인(2026-08-26): "영문 한글 초성을 넣었을때 해당 상품이
   노출되면 돼, 영문을 한글로 or 한글을 영문으로 매핑할 필요 없어" — 즉 한글 상품명/브랜드에
   대한 한글 초성 검색만 지원하면 되고, 영문↔한글 상호 매핑(예: "Manfrotto"를 한글 초성으로
   찾기)은 불필요. **구현**: `hangul_chosung(text) RETURNS text IMMUTABLE` 함수(완성형 한글
   음절만 초성으로 치환, 그 외 문자는 그대로 통과) 신설 → `products.name_chosung`/
   `brand_chosung` 생성열(GENERATED ALWAYS AS ... STORED) 추가 + trigram GIN 인덱스 2개 →
   `search_products` 본문에 초성 LIKE 매칭 조건 추가(함수 시그니처·반환타입 불변, 호출부 TS
   무수정). 이 RPC는 `/products` 검색 등 사이트 전역 상품검색이 공유하므로 전체 영향범위.

   수정 파일: `src/lib/components/common/SuggestPicker.svelte`(1·2번),
   `src/lib/components/home/admin/HomeThemeGroupModal.svelte`(상품 썸네일 제거 요청 포함),
   `supabase/migrations/20260826050000_354_search_products_chosung_support.sql`(신규, 3번)

   ✅ **stage(ezyvffjvuwmtuhpxdjrw) 적용·검증 완료(2026-08-26)** — 라이브 SQL로 4가지 확인:
   ① 한글 초성 부분검색(`'ㅇㅅㅌㅅ'` → "인스탁스 와이드필름 10매") 정상 매칭, ② 영문 전체
   검색(`'Manfrotto'` → "Manfrotto 055") 회귀 없음, ③ 한글 전체단어 검색(`'인스탁스'`) 회귀
   없음, ④ 빈 문자열/공백 쿼리 회귀 없음(전체 목록 정상 반환).
   ✅ **production(vnbpmvxruyciuuaermyh) 적용 완료(2026-08-26, Stephen 승인)** — 적용 전
   pg_trgm 존재·`search_products` 현재 정의가 stage와 동일함을 재확인 후 진행. 적용 후
   직접 재조회로 검증: 활성 부모상품 53/53 전부 `name_chosung` 백필 정상(생성열이므로
   ALTER 시점에 자동 계산), 실제 한글 상품명("SAMSUNG S26 울트라...") 초성 부분검색
   (`'ㅇㅌㄹ'`)으로 2건 정확히 매칭 확인.

   1·2번(SuggestPicker) 수정은 순수 프론트 로직이라 DB 마이그레이션 없음 — `npm run check`
   신규 ERROR 0건(기존 a11y warning만 잔존, 전부 사전 존재).

---


## BACKLOG — CMS 상담(채팅) Phase 4 대형 아젠다 검토 3건 (2026-08-12) — ⛔ GATE B 대기 (Stephen 승인 + 열린 질문 답변 선행 필요, 정식 실행 태스크 아님)

plan_source: /Users/stevenmac/.claude/plans/users-stevenmac-downloads-crazyshot-bac-compiled-willow.md
  §"Phase 4 — 대형/보류 검토 항목" (P4-1·P4-2·P4-3). 원 문서는 `/cms/chat`(상담세션) 기능 백로그
  전수조사 결과이며, Phase 0~3(버그검증·정책보완·정보고도화·세션도구)은 이번 분석 대상이 아님 —
  Phase 4 3건만 "DB 설계 전체·복수 목적·벤더/정책 결정 선행 필요"로 판단해 `@promptor` 대형 아젠다
  분석 대상으로 선정, TASK.md에 계획만 등록함(코드·마이그레이션 미작성).

아젠다(총괄): 상담채팅 시스템(PRD.1.7)에 ① 세션 태그 시스템 ② 예약·트리거 메시지 자동발송
  스케줄러 ③ 전화상담 녹음 STT 자동 텍스트화 3개 기능을 추가하는 대형 아젠다 3건. 3건 모두
  Stephen의 정책/벤더 결정이 선행되어야 실행 가능한 상태 — 이번 세션은 분석·TASK.md 등록까지만
  수행하고 구현은 시작하지 않는다.

⛔ CRITICAL — 3건 모두 GATE B는 Stephen 승인 필수 (DB 스키마 신규 + 다중 파일 연동 + 아래 각 항목의
  열린 질문 답변 필요). GATE B 승인과 열린 질문 답변이 모두 완료되기 전까지 `@harness-executor`
  또는 `@sp2-tdd-agents`로 넘기는 NOW/NEXT 태스크를 생성하지 않는다.

[CONTEXT BRIDGE]
핵심제약(3건 공통):
  - 기존 정본 `.claude/rules-ref/chat.md`(PRD.1.7 채팅 도메인) 및 `.claude/rules/rental-lifecycle.md`
    "채팅 알림 발송 매핑" 표와 충돌 없이 확장할 것 — 기존 4개 테이블(chat_sessions/chat_messages/
    chat_intent_logs/cs_records) 구조와 AUTO_NOTIFY/NOTIFY_TYPE_MAP 발송 체계를 재사용
  - pg_cron 기반 스케줄 잡을 신설할 경우 기존 사례(`supabase/migrations/20260529000030_30_cron_jobs.sql`
    — HOLD 만료 처리, `supabase/migrations/20260627100038_38_chat_auto_pending.sql` —
    `auto_pending_inactive_sessions`)의 패턴(SQL 함수 + `cron.schedule` 등록, RPC 경유 상태변경)을
    그대로 참고할 것 — 신규 잡 구조를 임의로 재설계하지 않는다
  - CMS 신규 화면/액션은 `security-auth.md` 역할별 접근 매트릭스 원칙을 따라 manager 이상 게이트
    (partner는 세션 열람만, 설정성 CRUD는 차단) — `/cms/codes` QR-CASE-2 사례와 동일 원칙 적용
  - 직접 DML 금지, RPC 경유 원칙(H-01) 3건 모두 동일 적용
TDD도메인: 아래 각 항목 판별 참조(P4-1 GSD 명확 / P4-2 조건부 TDD — Stephen 확인 필요 /
  P4-3 GSD, 단 벤더 선정 선행)
절대금지:
  - git 자율 실행
  - 3건 중 어느 것도 GATE B 승인 없이 마이그레이션 파일·API 라우트·컴포넌트 코드 작성 착수
  - 기존 마이그레이션 파일 직접 수정(GP-10) — 전부 신규 ADD 파일로만
  - chat.md에 없는 새로운 세션 상태값·알림 타입을 이번 3건 구현 중 임의로 도입(도입이 필요하면
    먼저 chat.md/rental-lifecycle.md 갱신 여부를 Stephen에게 확인)
  - Phase 0~3(버그검증·정책보완 등) 항목을 이번 3건과 함께 묶어 범위 확장
frozen_files (해당 시 Claude Code 전용 — Cursor 수정 금지, GATE C 필수):
  - src/routes/api/**/* (P4-1 태그 API, P4-2 트리거 관리 API, P4-3 STT 업로드 API 전부 해당)
  - supabase/migrations/** (3건 모두 신규 ADD만 허용)
  - $env import가 있는 모든 파일 (P4-3 벤더 API 키 도입 시 $env/static/private 전용)

---

### P4-1. 상담 태그 시스템

목표: CMS 채팅목록패널에서 세션별로 상황 태그("예약 전 상담·금액문의·스케줄문의·계약서 진행·
  결제 진행·예약완료" 등)를 부여/해제하고 태그 기준으로 목록을 필터링할 수 있게 한다.
GATE 등급: 🔴 CRITICAL (신규 DB 스키마 + `/cms/chat` 다중 파일 연동)

의존성:
  - 선행 완료 필요: 없음 (현재 `/cms/chat` 3패널 구조·채팅목록패널은 이미 구현 완료 상태 — 이 위에
    얹는 확장)
  - 신규 필요
    - DB: `chat_sessions.tags`(text[]) 컬럼 확장 **또는** `chat_session_tags`(session_id FK,
      tag_label, created_by, created_at) 신규 테이블 — 아래 GATE B 질문 답변에 따라 스키마 방향이
      갈림(고정 목록이면 컬럼+CHECK, 커스텀이면 태그 마스터 테이블+조인 테이블 구조가 더 적합)
    - ENV: 없음
    - API: 태그 부여/해제 액션(세션 상세 or 목록 인라인), 목록 조회 시 tags 필터 파라미터 추가
    - mdc: `.claude/rules-ref/chat.md`에 태그 시스템 섹션 신규 추가 필요

TDD/GSD 판별: GSD (AGENTS.md GSD 키워드 "데이터관리: CRUD/목록/등록/수정/삭제" 매치, TDD 강제
  키워드 결제·예약·보안·크레이지스코어 어느 것도 미해당) — 30분 단위 분해 대상

리스크(간략, GSD): 태그 CRUD 권한을 partner까지 열면 CS 분류 체계가 무분별하게 늘어날 위험 —
  manager 이상 게이트로 통제

엣지케이스:
  - EC-1: 같은 세션에 동일 태그를 중복 지정 시도 → 예상 동작: UNIQUE 제약 또는 프론트 중복 필터로
    무시(에러 없이 조용히 no-op)
  - EC-2(커스텀 방식 채택 시): 관리자가 이미 세션에 적용된 태그를 마스터 목록에서 삭제 →
    예상 동작: 기존 적용분 유지 여부(방치 vs CASCADE 삭제) 결정 필요 — Stephen 확인
  - EC-3: partner 등급 관리자가 태그 부여/해제 API를 직접 호출 → 예상 동작: 403 차단
    (security-auth.md `getCmsRoleForAction` 패턴)

구현 범위 후보(Default-Exclude — 전부 미확인, GATE B 승인 전까지 BACKLOG 유지):
  - 미확인: 태그 목록 커스텀(관리자 자유 추가/삭제) vs 고정 6종 목록 — 스키마 설계 방향을 가르는
    핵심 결정, 포함 시 공수: 커스텀은 태그 마스터 관리 화면(+CRUD API)까지 추가로 필요(공수 大),
    고정 목록은 컬럼+CHECK 제약만으로 단순화 가능(공수 小) / 제외 시 영향: 결정 전까지 마이그레이션
    설계 자체를 시작할 수 없음

GATE B 질문:
  - [ ] 태그 목록을 관리자가 자유롭게 추가/삭제하는 커스텀 방식으로 할지, 고정된 목록(예약 전
    상담/금액문의/스케줄문의/계약서 진행/결제 진행/예약완료 6종)으로 고정할지?

---

### P4-2. 예약메세지 & 트리거 메세지 스케줄러

목표: 시간·이벤트 기반 조건(예: "예약 시작 30분 전 무인보관함 안내", "반납 2시간 전 리마인드")을
  충족하면 채팅 메시지를 자동으로 삽입·발송하는 스케줄러를 신설한다.
GATE 등급: 🔴 CRITICAL (신규 테이블 2개 이상 + 백그라운드 잡 + 관리 UI — 원 문서에서도 "별도
  미니 프로젝트로 분리 권장" 표기된 대형 항목)

의존성:
  - 선행 완료 필요: 없음(기존 예약/대여 상태값·알림 매핑 체계는 이미 확정돼 있어 그대로 참조 가능
    — `.claude/rules/rental-lifecycle.md` AUTO_NOTIFY/NOTIFY_TYPE_MAP 표)
  - 신규 필요
    - DB: `chat_trigger_rules`(트리거 타입, 오프셋 분/시간, 대상 이벤트, 메시지 템플릿, 이미지,
      CTA 설정, is_active) + 발송 이력/중복방지용 테이블(예: `chat_trigger_dispatch_logs` —
      예약ID+트리거타입+오프셋 조합 UNIQUE로 idempotency 보장)
    - ENV: 기존 FCM 푸시 연동 재사용 가능 여부 확인 필요(신규 키가 필요할 수 있음 — 미확인)
    - API: 트리거 규칙 관리 CMS 화면(`/cms/chat/triggers` 등, CRUD) + `pg_cron` 스캔 잡(SQL 함수,
      Migration 30·38 패턴 재사용)
    - mdc: `chat.md` + `rental-lifecycle.md` 알림 발송 매핑표에 자동 트리거 발송 유형 추가 필요

TDD/GSD 판별: ⚠️ 조건부 — 아젠다 제목("예약메세지")에 AGENTS.md TDD 강제 키워드 "예약"이 문자열로
  포함되어 기계적 키워드 스캔으로는 TDD 판정. 다만 실제 도메인은 예약재고 배정·이중예약 방지 같은
  핵심 예약 로직이 아니라 "이미 확정된 예약 데이터를 읽어 알림을 발송하는" 스케줄러라 GSD
  성격에 더 가까움 — promptor 원칙("모호하면 TDD 보수적 판정")에 따라 잠정 TDD로 표기하되,
  최종 판단은 GATE B에서 Stephen 확인 필요(아래 질문 참고). TDD로 확정되면 15분 단위,
  GSD로 확정되면 30분 단위 분해.

리스크(TDD 조건부 대비 필수 포함):
  - 동시성 리스크: pg_cron 스캔 잡이 겹쳐 실행되거나 재시도되어 동일 알림이 중복 발송될 위험 /
    처리: (예약ID, 트리거타입, 오프셋) UNIQUE 제약의 dispatch_logs로 중복 INSERT 자체를 차단
  - 데이터 정합성: 스캔 이후 실제 발송 사이에 예약이 취소·변경됐는데도 예정된 트리거가 그대로
    발송되는 위험 / 처리: 발송 직전 해당 예약 상태를 RPC로 재확인, 취소/종료 상태면 skip
  - 보안: 트리거 규칙 CRUD를 낮은 권한이 수정해 전체 고객에게 임의 메시지를 대량 발송하는 위험 /
    처리: manager 이상 게이트(security-auth.md 패턴)

엣지케이스:
  - EC-1: 한 예약에 여러 오프셋 조건이 동시에 해당되는 경우(예: 30분 전+10분 전 모두 도래) →
    예상 동작: 각 규칙별 독립 발송 vs 통합 1건 발송 — 정책 결정 필요
  - EC-2: 서버 다운타임 등으로 pg_cron이 예정 시각을 지나서야 스캔하는 경우 → 예상 동작: 유효기간
    초과분은 스킵할지, 즉시 지연 발송할지 결정 필요
  - EC-3: 트리거 대상 세션이 이미 종료(closed) 상태인 경우 → 예상 동작: 종료된 세션에는 발송하지
    않거나, 발송 시 세션을 자동 재오픈할지 결정 필요(현재 chat.md §3 재진입 조건과 정합성 확인 필요)

구현 범위 후보(Default-Exclude — 전부 미확인, GATE B 승인 전까지 BACKLOG 유지):
  - 미확인: 1차 범위를 고정 이벤트 몇 종(반납 임박·예약 임박 등)으로 한정할지, 완전 커스텀 규칙
    빌더(관리자가 오프셋·조건·메시지를 자유 정의)로 만들지 — 포함 시 공수: 커스텀 빌더는 조건식
    파서·미리보기 UI까지 필요(공수 大), 고정 이벤트는 이벤트별 하드코딩 오프셋 + 템플릿 저장만으로
    가능(공수 中) / 제외 시 영향: 결정 전까지 `chat_trigger_rules` 스키마의 유연성 수준을 정할 수 없음

GATE B 질문:
  - [ ] 1차 범위를 "고정 이벤트 몇 종"(예: 반납 2시간 전 리마인드, 예약 시작 30분 전 안내)으로
    한정할지, 완전 커스텀 규칙 빌더로 만들지?
  - [ ] 제목에 "예약"이 포함돼 TDD 강제 키워드 스캔에 걸리는데(위 TDD/GSD 판별 참고), 실제
    도메인은 예약재고 로직이 아닌 알림 발송 스케줄러입니다 — TDD 경로(15분 분해)로 강제 진행할지,
    GSD 경로(30분 분해)로 진행할지?

---

### P4-3. 전화상담 녹음파일 자동 STT 텍스트화

목표: 통화 녹음파일을 업로드하면 자동으로 텍스트 변환 후 음성파일과 함께 보관하고, 변환 결과를
  채팅 내 "시스템 카드 메시지"(복사·접기/펼치기·관리자 수정 가능)로 삽입한다.
GATE 등급: 🔴 CRITICAL (신규 스키마 + 3rd-party 벤더 연동 + 개인정보 음성데이터 취급) — 단
  원문 요구사항 자체가 "가능하다면" 수준의 낮은 확신으로 기재돼 있어 **3건 중 최하위 우선순위**로
  표기.

의존성:
  - 선행 완료 필요: **3rd-party STT 벤더 선정** — 코드 작성보다 먼저 결정돼야 하는 전제조건
    (후보: Clova Speech, OpenAI Whisper API, Google STT 등 — 비용·정확도·한국어 지원 비교 필요)
  - 신규 필요
    - DB: 통화녹음 메타(업로드 URL, STT 상태, 변환 텍스트, 벤더명) 저장 — 기존 `chat_messages`에
      system 카드 전용 message_type을 확장하는 방식과, 별도 `chat_call_recordings` 테이블을 두는
      방식 중 선택 필요(벤더 선정 이후 응답 스키마에 따라 결정하는 것이 합리적)
    - ENV: 벤더 결정 후 `{VENDOR}_STT_API_KEY` 신규 — 반드시 `$env/static/private` 전용(H-05)
    - API: 통화녹음 업로드 엔드포인트, STT 변환 트리거(동기/비동기), 변환 결과를 시스템 카드로
      삽입하는 처리
    - mdc: 벤더 확정 후 필요 시 `chat.md`에 STT 연동 섹션 추가

TDD/GSD 판별: GSD (AGENTS.md TDD 강제 키워드 결제·예약·보안·크레이지스코어 어느 것도 미해당 —
  단순 업로드+변환+메시지삽입 흐름) — 30분 단위 분해 대상. 단, 착수 자체가 벤더 선정 완료 이후로
  후행되어야 함.

리스크(간략, GSD이나 개인정보 이슈로 보안 항목 포함):
  - 보안: 통화 녹음에 고객 음성(개인정보) 포함 — Storage 접근권한/RLS 설계 필요, 3rd-party 벤더로
    음성데이터를 외부 전송하는 것에 대한 고지·동의 정책 필요(법무 확인 별도 권장)
  - 데이터 정합성: STT 변환 실패·타임아웃 시 시스템 카드가 빈 텍스트로 남는 경우 재시도/실패표시
    정책 필요

엣지케이스:
  - EC-1: STT 변환 정확도가 낮아 오역 텍스트가 시스템 카드로 그대로 노출 → 예상 동작: 관리자가
    직접 수정 가능한 UI로 정정(요구사항에 이미 명시된 기능 — 수정 가능해야 함)
  - EC-2: 장시간 통화 녹음파일 업로드 시 처리 지연/타임아웃 → 예상 동작: 비동기 처리 + "처리중"
    상태 표시, 완료 시 알림
  - EC-3: 벤더 API 요금 한도 초과 또는 에러 응답 → 예상 동작: 변환 실패 상태로 표시하되 원본
    음성파일은 보존(텍스트만 실패, 음성 유실 없음)

구현 범위 후보(Default-Exclude — 전부 미확인, GATE B 승인 전까지 BACKLOG 유지):
  - 미확인: 이 기능 자체를 지금 우선순위에 넣을지 여부(원문이 "가능하다면" 수준으로 낮은 확신) —
    포함 시 공수: 벤더 조사·비교 세션이 코드 작업 이전에 별도로 선행돼야 함(공수 大, 코드 외
    리서치 비중 높음) / 제외 시 영향: 통화상담 이력이 텍스트 검색·아카이빙 불가한 현재 상태 유지
    (기능 부재로 인한 실사용 불편은 낮음 — 전화상담 자체가 보조 채널)

GATE B 질문:
  - [ ] STT 벤더 후보(Clova Speech / OpenAI Whisper API / Google STT) 중 어떤 것을 우선 검토할지,
    또는 이 기능 자체를 지금 우선순위에서 제외하고 보류할지?

---


## GATE C 확인 항목 (6건 전체 NOW 완료 후 필수)

- [ ] frozen 경로(`src/routes/api/**`) 수정분 전부 GATE C 통과했는가?(core-rules.md Frozen 파일 목록)
- [ ] 신규 마이그레이션 4건(P3-1/P3-2/P3-5 스키마 변경분) 전부 crazyshot-stage 선적용 후
  Stephen 승인 거쳐 crazyshot(production) 반영했는가?(마이그레이션 필수 순서, CLAUDE.md)
- [ ] P1-3 reopen/pending API가 RPC 경유인가?(직접 UPDATE 금지, H-01)
- [ ] P2-1 통합 조회가 단일 RPC(N+1 아님)인가? 승인 범위 외 필드(통합 KYC/디바이스·유입경로/
  쿠폰·포인트 이용내역)를 임의로 추가하지 않았는가?
- [ ] P3-1 manual_mode=true 세션에서 자동응답이 실제로 스킵되는가? manual_mode=false 세션은 기존
  자동응답 흐름이 회귀 없이 그대로 동작하는가?
- [ ] P3-2 북마크 RLS가 고객/비로그인 접근을 차단하는가?(`is_cms_user()` 패턴)
- [ ] P3-3 product_link 액션카드가 기존 결제/예약/반납 액션카드 렌더링과 충돌 없이 별도
  서브타입으로 분기되는가?
- [ ] P3-5 이미지/CTA 미설정 캔드 응답은 기존과 동일하게 텍스트로만 표시되는가?(회귀 없음)
- [ ] 6건 전부 `.claude/rules-ref/chat.md` 기존 세션 상태·알림 매핑 체계와 충돌 없이 확장됐는가?
- [ ] console.log 잔존 없음, Svelte 5 Runes 문법 준수(on:event 미사용) 확인?

---


## GATE C 확인 항목 (전체 NOW/NEXT 완료 후 필수)

- [ ] RLS 정책 고객 A/B 격리 확인, `is_cms_user()` 관리자 전용 쓰기 확인
- [ ] `/cms/subscriptions` 접근: superadmin/manager 정상 진입, partner 403/redirect 확인
- [ ] 구독등록 → 목록 자동선택(`?selected=`) → DetailPanel 5개 탭 저장 동작 확인
- [ ] `/members` 카드 클릭 → 하단 스펙 영역 반영 확인(PC 하이라이트/모바일 탭 동기화)
- [ ] `CRON_SECRET` 미검증 요청 401 확인(RED 단계 필수 테스트)
- [ ] Toss 테스트 키로 카드등록→최초청구→크론 강제실행 End-to-End 확인 후 production 반영
- [ ] npm run check 통과

---


## GATE C 확인 항목 (전체 NOW/NEXT 완료 후 필수) — 전체 통과

- [x] `generate_product_code` 기존 2/3/5-param 오버로드 시그니처 무변경 — stage+production 양쪽
      curl/SQL 크로스체크로 4개 오버로드(2/3/5/6-param) 전부 존재 확인
- [x] `generate_inventory_product_code` 시그니처 무변경(내부 로직만 분기) — 2-param 1종만 존재
- [x] 순번1·순번2 둘 다 1부터 시작 — Stephen 정정 반영, production 실채번 테스트로 실증
- [x] 순번1/순번2 슬롯별 독립 자릿수 지원 — `comboPreviewFmt`에서 각 슬롯 자릿수 독립 계산
- [x] 기존 1개-순번 모드(순번1 미설정) 회귀 없음 — migration 216 "기존 모드" 분기가 migration
      194와 로직 동일(qa 검수 확인), production 테스트에서도 `CSFSH001` 형태로 회귀 없음 실증
- [x] "+"/"−" 클릭 시 순번2 UI 생성/제거 정상 동작, 순번 슬롯 최대 2개 상한 유지
- [x] 콤보 편집 카드 레이아웃 재배치 시 기존 색상·보더·타이포 토큰 변경 없음(배치·패딩만 조정)
- [x] products.md §2-2 영구고정 정책(재사용 불가, 단조증가) 신규 카운터 2종 모두 준수 — PK
      기반 INSERT...ON CONFLICT DO UPDATE 원자적 패턴, 동시성 시나리오 정적 분석 완료
- [x] stage(ezyvffjvuwmtuhpxdjrw) 마이그레이션 4건 적용·검증 완료 → production
      (vnbpmvxruyciuuaermyh)도 Stephen 승인 후 2026-08-10 적용·검증 완료
- [x] `npx svelte-check` 통과(수정 대상 파일 신규 에러 0건) / TDD 테스트 4/4 통과

---


## NEXT
- [x] S1-M3 T5: 결제 UI | GSD | 결제 결과 페이지 구현 완료
  - src/routes/payment/success/+page.server.ts — Toss confirm API + confirm_payment_and_update_reservation RPC
  - src/routes/payment/success/+page.svelte — Figma 2361:6425 1:1 구현 (비대칭 radius 카드)
  - src/routes/payment/fail/+page.server.ts — cancel_payment_and_release_hold RPC + 파라미터 파싱
  - src/routes/payment/fail/+page.svelte — Figma 2361:6407 1:1 구현
  - svelte-check: 결제 관련 에러 0건 (기존 pre-existing 2건 유지)


## NEXT — 우선순위 로드맵 (2026-07-09 확정)

### ① T9 AdminChatPanel (현재 진행 중 — 위 참조)
- 사유: PRD.1.7 채팅 시스템 API·컴포넌트 완료, 관리자 화면만 미구현
- 시범서비스 오픈 시 고객 CS 대응 불가 → 즉시 해제 필요

### ② S1-M5 Shipments (T9 완료 후)
- 배송방법 선택(epost/CJ/quick/locker/pickup/두발히어로) + 마감시간 UI
- 예약 플로우 완성에 직결 — rental.md 배송 마감 기준 적용
- 배송비 계산 (CRAZY 등급 무료) + 운송장 추적 연동

### ③ S1-M4 Subscriptions (M5 완료 후)
- 멤버십 등급(CRAZY/PRO/BASIC) + 크레이지스코어 보증금 감면
- 구독 결제 흐름 + TossPayments 정기결제 연동
- 가장 복잡도 높음 → M5 이후 충분한 컨텍스트 확보 후 진행

---


## BLOCKED
~~T9: AdminChatPanel~~ → NOW로 이동 (2026-07-09 해제)

---


## BACKLOG

### 🟡 BOUNDARY — 민감 액션 재인증(비밀번호 재확인) — CMS 관리자 계정 상세패널 Q8(iii) (2026-08-25 등록)

- **AUTH-REAUTH-1: 등급변경·삭제 등 민감 액션 실행 시 비밀번호 재확인 단계** | BOUNDARY |
  하네스 편입 대기(별도 아젠다)
  - 출처: 파일 최상단 "CMS 관리자 계정 목록(`/cms/accounts/list`) → 계정 정보설정 상세패널"
    아젠다 블록, GATE B 답변 확정 Q8 — "(iii) 등급변경·삭제 등 민감 액션 실행 시 현재 로그인
    세션과 별개로 비밀번호 재확인을 한 번 더 요구하는 재인증 단계"는 Stephen이 명시적으로
    이번 스코프 제외(원문 그대로 승인, "감사로그+마지막마스터 보호까지만 포함") — 필요 시
    별도 아젠다로 착수.
  - 제외 사유: UX 비용이 크고(추가 모달·재인증 흐름 신규 구현) 이번 CMS 규모(관리자 수 적음)에
    과잉설계일 가능성.
  - 착수 시 참고: 같은 블록의 Stage 2(`requireTrueSuperadmin`)·Stage 7(`cms_admin_audit_log`)가
    선행 완료돼 있어야 "어떤 액션이 민감 액션인지" 판정 기준을 재사용하기 쉬움.

### 📋 계획 등록 — 상담채팅 고도화 플랜 (2026-07-27, 하네스 편입 대기)

- **PLAN-CHAT-UPGRADE: 채팅 시스템 고도화 플랜 v4.1** | 계획 문서(코드 미착수) | 하네스 편입 대기
  - 위치: `/Users/stevenmac/.claude/plans/enumerated-wandering-bentley.md`
  - 내용: 채널톡(channel.io) 공식 운영문서 심층분석 → 렌탈 커머스 엄선(채택/보류 판단) →
    이전 정밀감사 미해결 결함(Phase 0) → Phase 1(오퍼레이터 UX) → Phase 2(양방향 알림) →
    Phase 3(렌탈 컨텍스트 통합) → Phase 4(마케팅 인텔리전스) 전체 구현 스펙(스키마·코드 포함)
  - 규모: 신규 마이그레이션 10건(#180~189, 최신 번호 재확인 후 실제 번호 확정 필요), 신규
    테이블 4개(canned_responses/tag_definitions·session_tags/chat_session_followers/chat_proactive_log),
    신규 컴포넌트·API 다수
  - **GATE/TDD 사전 분류 완료**(문서 §9): 20개 항목 중 CRITICAL 14건(대부분 DB 마이그레이션
    동반) / BOUNDARY 5건 / TDD 후보 4건(Phase 0 C3·C4·B4, Phase 3-2 — 전부 예약 도메인 관련)
  - ⛔ **아직 `@harness-executor`를 거치지 않음** — AGENTS.md 원칙상 Claude 네이티브 Plan
    산출물은 TASK.md·GATE 구조를 생성하지 않으므로, 착수 시 Phase 0부터 `@harness-executor`에게
    이 플랜 파일을 B-START 아젠다로 전달해 정식 NOW 섹션으로 재입력해야 함
  - 우선 착수 권장: Phase 0(BL-CHAT-C3/C4/B1~B5/R1~R3 — 이전 감사에서 발견된 채팅 알림 기반
    결함 정리, 새 기능을 얹기 전 선행 필수)

### 🔴 CRITICAL — 대여 라이프사이클 결함 (감사 2026-07-26)

- **BL-LC-C1: 결제 CTA — Mock 자동 예약승인 임시 구현** | CRITICAL | S1-M3 연계 (BLOCKED)
  - ✅ 2026-07-27: `/api/checkout/confirm-mock` API 신규 생성. hold→confirmed 자동 전환 + reservation_approval 채팅 알림
  - `src/routes/checkout/+page.svelte`: alert() → async fetch('/api/checkout/confirm-mock') 교체 완료
  - 최종: TossPayments SDK `requestPayment` 구현 → S1-M3 Payment Integration 해제 시 처리

- **BL-LC-C3: Production DB return_method 컬럼 누락 (예약신청 전체 불가)** | CRITICAL | ✅ 완료 (2026-07-27)
  - 증상: 실서비스에서 예약신청 시 "column return_method does not exist" 에러 (로컬/Stage 재현 안 됨)
  - 원인: `147b_add_return_method_to_rentals` 마이그레이션이 과거 Stage DB에 직접 실행되고 파일로 저장 안 됨
    → Production 배포 절차에서 누락 → Stage/Production 스키마 드리프트
  - 해결: `supabase/migrations/20260727000169_169_add_return_method_column.sql` 신규 생성
    → Stage(idempotent) + Production(Stephen 승인 후) 양쪽 적용 완료 · 컬럼 생성 검증 완료
  - 재발 방지: DB 변경은 반드시 마이그레이션 파일 선(先) 저장 → MCP apply_migration 적용 원칙 재확인 필요
    (SQL 편집기/execute_sql 직접 실행 후 파일 누락 사례 추가 발견: 159b/159c/159e_create_hold_reservation_* — 단, 최종 함수는 Production과 동일하여 실질 영향 없음)

- **BL-LC-C4: send_rental_chat_notification Production 드리프트 (채팅 알림 100% 실패)** | CRITICAL | ✅ 완료 (2026-07-27)
  - 증상: Production 함수가 sender_type='system'으로 INSERT → chat_sender_type_enum에 'system' 값 없음(user/admin/ai만 존재)
    → 채팅 알림 발송 시도 시 매번 enum 오류로 실패 (이전에 추가한 CMS 자동알림 포함 전부 무효)
  - 추가 문제: content(text)에 JSONB 직접 삽입 + action_payload 미사용 → ActionCard.svelte 기대 구조 불일치로 카드 렌더링 불가
  - 해결: `supabase/migrations/20260727000170_170_sync_send_rental_chat_notification.sql` 생성
    → Stage 정본 함수를 Production에 이식 (sender_type='admin' + action_payload 사용) → 양쪽 적용 + 검증 완료
  - 후속 백로그 등록: BL-LC-R6(update_reservation_status 반환타입 Stage jsonb vs Production void),
    BL-LC-R7(set_reservation_shipment_method 오버로드 개수 불일치 정리)

- **BL-LC-R6: update_reservation_status 반환타입 드리프트 (CMS 예약승인·상태변경 100% 실패)** | ✅ 완료 (2026-07-27, CRITICAL로 재분류)
  - 증상: Production 함수가 RETURNS void → cms/reservation/+page.server.ts의 approveReservation·updateStatus
    action이 result.ok 검사 → result 항상 null → 조건 항상 거짓 → CMS 승인/상태변경 버튼이 Production에서 100% "처리 실패" 응답
  - 해결: `supabase/migrations/20260727000171_171_sync_reservation_status_and_shipment_rpcs.sql`
    → CREATE OR REPLACE로 반환타입 변경 시도 시 Postgres 오류(42P13) 발생
      → DROP FUNCTION 후 재생성으로 처리 (Stage는 원래 jsonb라 OR REPLACE로 정상 처리됨)
    → Production 적용 후 반환타입 jsonb 확인 완료
  - 권한 재확인: DROP 후 재생성으로 GRANT 초기화 우려 → anon/authenticated/service_role 모두 EXECUTE 가능 확인
    → Stage도 동일 상태로 확인되어 회귀 아님(기존부터 존재하던 상태) — 별도 이슈로 백로그 남김

- **BL-LC-R7: set_reservation_shipment_method(3-arg) 내부 role 체크 방식 통일** | ✅ 완료 (2026-07-27)
  - 차이: Stage `current_setting('role')='service_role'` vs Production `auth.jwt()->>'role'='service_role'`
  - 확인: 클라이언트는 5-arg 오버로드만 호출(products/[id], checkout) → 3-arg 오버로드는 현재 미사용 경로, 실질 영향 없음
  - 해결: Stage 기준으로 Production 통일 (동일 마이그레이션 171에 포함)

- **BL-SEC-1: 서버 전용 RPC 4종 anon/authenticated 노출 (소유자 검증 우회 가능)** | ✅ 완료 (2026-07-27)
  - 발견 경위: R6 수정 중 GRANT 확인 과정에서 update_reservation_status에 소유자 검증이 없고
    anon/authenticated도 EXECUTE 가능함을 발견 → 유사 RPC 전수 재조사
  - 확인 결과 (grep으로 실사용 호출부 전수 검사):
    · update_reservation_status / send_rental_chat_notification /
      confirm_payment_and_update_reservation / cancel_payment_and_release_hold
      → 코드베이스 전체에서 100% admin.rpc()(service_role)로만 호출, 클라이언트 직접 호출 경로 전혀 없음
    · 그런데 실제 DB 권한은 anon/authenticated에게도 EXECUTE 허용된 상태(Postgres 기본 PUBLIC 권한 미회수)
    · confirm_payment_and_update_reservation / cancel_payment_and_release_hold는 p_user_id를
      파라미터로 직접 신뢰(auth.uid() 미검증) → 노출 시 타인 명의 결제 확정·취소 임의 호출 가능한 심각한 취약점
    · create_hold_reservation은 제외 — 클라이언트 직접 호출이 의도된 설계이며 내부 auth.uid() 검증 존재 확인
  - 해결: `supabase/migrations/20260727000172_172_lock_server_only_rpcs_to_service_role.sql` 신규 생성
    → REVOKE EXECUTE FROM PUBLIC,anon,authenticated + GRANT TO service_role (4개 함수)
    → Stage 적용 + 검증(anon/authenticated=false, service_role=true) → Production 적용(Stephen 승인) + 검증 완료
    → create_hold_reservation 권한 변경 없음(anon/authenticated=true 유지) 확인

- **BL-LC-C2: Vercel Production 빌드 실패 (env var 36개 누락)** | CRITICAL | Stephen 직접 조치 필요
  - 빌드 에러: `PUBLIC_SUPABASE_URL`, `ANTHROPIC_API_KEY` 등 MISSING_EXPORT
  - 조치: Vercel Dashboard → Settings → Environment Variables → Production 체크박스 활성화
  - Preview는 정상. Production만 미설정 상태.

### 🟡 BOUNDARY — 대여 라이프사이클 결함 (감사 2026-07-26)

- **BL-LC-B1: log_rental_action RPC 전체 미사용** | BOUNDARY
  - Migration 154에 정의된 RPC — 코드베이스 어디서도 호출 없음
  - 방문 출고/반납 등 중요 행위 DB 로그 누락
  - 해결: `cms/rentals/+page.server.ts` 상태 전환 action에 `log_rental_action` RPC 추가

- **BL-LC-B2: 채팅 알림 수동 전용 (자동화 연결 없음)** | BOUNDARY | ✅ COMPLETE
  - ✅ 2026-07-27 커밋 605f660: `updateStatus` + `approveReservation` action 완료 후 `send_rental_chat_notification` 자동 호출
    - 파일: `src/routes/cms/reservation/+page.server.ts`
    - AUTO_NOTIFY 맵: confirmed→reservation_approval / shipped→shipment_notify / in_use→return_remind / return_requested→return_registration / returned→rental_complete
  - ✅ 2026-07-27 커밋 605f660: 예약신청(hold) 채팅 알림 신규 구현
    - `src/routes/api/checkout/notify-hold/+server.ts` 신규 생성 (본인 예약 검증 + RPC 호출)
    - `src/routes/products/[id]/+page.svelte`: hold 생성 후 notify-hold API fire-and-forget 호출
    - `src/lib/components/chat/ActionCard.svelte`: reservation_hold 케이스 추가 ("예약 신청 확인")
  - ✅ 2026-07-27 커밋 605f660: 체크아웃 더미 sub-items 제거
    - `src/routes/checkout/+page.svelte`: sd.isServerLoaded 시 subItems = [] (fixture 차단)
  - ✅ 2026-07-27 이후: account/rental orders 조인 버그 수정
    - 원인: rental_reservations → orders PostgREST 관계 없음
    - 해결: product_id FK → products 직접 조인만 사용
    - 브라우저 검증: 마이페이지 3개 카드 정상 표시

- **BL-LC-B3: 마이페이지 대여 카드 — hold 상태 상품명** | BOUNDARY
  - ✅ 2026-07-27: `rental_reservations.product_id FK → products(name, category)` 직접 JOIN fallback 추가
  - 기존 `orders(order_items(products(...)))` 경로 1순위 유지, direct JOIN을 2순위 fallback으로 사용
  - 파일: `src/routes/account/rental/+page.server.ts`

- **BL-LC-B7: 예약 카트(/checkout) 더미상품·합계금액·단일상품 결제불가 수정** | BOUNDARY | ✅ COMPLETE (2026-07-27)
  - ✅ 더미상품 표시: asset_id 경유(구조) → product_id 직접 조회로 교체 — `src/routes/checkout/+page.server.ts`
  - ✅ 합계금액: `calculate_cart_total` RPC 전면 재작성(price_rules 12h/24h 기준) — Migration 173, Stage+Production 적용 완료
  - ✅ 단일상품 결제불가: `datesSet`·`otDeliveryFee`가 카드2(p2) 존재 여부 확인하도록 수정 — `src/routes/checkout/+page.svelte`
  - 상세: `.claude/harness/GSD_LOG.md` 2026-07-27 CRITICAL FIX 항목 참조
  - ✅ 2026-07-27 후속: 카드1/카드2 고정 2개 제한 폐기 → 무제한 동적 리스트로 전면 재설계 완료
    (Stephen 확정: "여러 상품 동시 담기 가능해야 함" — 자동취소 정책 거부)
    - `src/routes/checkout/+page.svelte`: `itemsState`(배열) 기반 카드 렌더링(`{#each}` + `OrderCard` 스니펫)
    - `src/routes/checkout/+page.server.ts`: `cartLineItems` 신규 반환(예약↔상품↔요금 1:1 매핑, 인덱스 불일치 위험 제거)
    - `+page.ts`: `isDevMode` 하드코딩(`true`) 제거 → 서버가 실 예약 존재 여부로 판단(실 예약 시 confirm-mock 경로 보장)
    - 브라우저 검증: 서로 다른 상품 3건(Manfrotto 055·DJI RS4 Pro·Canon RF) 동시 예약 → 전부 카드 노출 +
      합계(50,000+40,000+25,000=115,000원) 정확 → 결제 완료까지 통과
    - 발견(범위 외, 별도 확인 필요): Manfrotto 055의 배정된 자식 재고(2e5af80c...) price_rules가
      부모 상품 화면에 표시되는 가격(20,000/14,000)과 다름(24h=50,000/12h=30,000) — products.md §9에
      이미 문서화된 "자식 price_rules 드리프트" 현상 실사례. 체크아웃/RPC는 실제 배정된 자식 기준으로
      일관되게 계산 중이라 버그는 아니나, 카탈로그 데이터 정합성 점검 필요.

### 🟢 ROUTINE — 대여 라이프사이클 결함 (감사 2026-07-26)

- **BL-LC-R1: 결제 경로 이중화 정리** | ROUTINE (M3 Payment 구현 시 처리)
  - `/api/payment/confirm` (완전) vs `/payment/success` (파라미터 누락) 병존
  - `/payment/success` 경로를 `/api/payment/confirm`으로 통일 또는 deprecate 처리 필요

- **BL-LC-R2: 계약서 서명 상태 전환 조건 확장** | ROUTINE
  - 파일: `src/routes/api/contracts/[token]/sign/+server.ts:67`
  - `status='shipped'`에서만 `in_use` 자동 전환 — hold/confirmed 상태 서명 시 무반응
  - Stephen과 업무 흐름 재확인 후 조건 확장 여부 결정 필요

- **BL-LC-R3: 상품 상세 배송 방식 하드코딩 수정** | ROUTINE | ✅ 완료 (2026-07-27)
  - 파일: `src/routes/products/[id]/+page.svelte`
  - `set_reservation_shipment_method` 호출 시 `p_pickup_method: 'visit'` 하드코딩되던 것을
    `selectedMethod?.method_key ?? 'visit'`로 수정 — CalendarTimePicker 선택값이 RPC에 정상 전달됨
  - 브라우저+DB 실검증: 크레이지샷배송 선택 시 pickup_method='crazydelivery' 정상 저장 확인

- **BL-LC-B6: Toss 성공 페이지 redirect 경로 오류** | BOUNDARY
  - 파일: `src/routes/payment/success/+page.svelte`
  - `goto('/mypage/reservations')` → 미존재 라우트 (올바른 경로: `/account/rental`)
  - S1-M3 Payment Integration 구현 시 함께 수정 필요

- **BL-LC-B7: 체크아웃 예약완료 랜딩 화면 오류** | ✅ 완료 + 브라우저 실검증 완료 (2026-07-27)
  - Stephen 지적: /account/rental(마이페이지 목록)로 랜딩되는 건 잘못된 설계
    → 정상 랜딩은 /payment/success/dev (결제완료 UI, PG 승인 단계는 임시 스킵)
  - 해결: confirm-mock API가 confirmedReservations(id, reservationCode) 반환하도록 확장
    → checkout onclick에서 실 예약 데이터로 /payment/success/dev?productName=...&orderNumber=...&amount=... 이동
    → 기존 isDevMode(예약 0건) 분기와 동일한 URLSearchParams 패턴 재사용
  - 파일: `src/routes/api/checkout/confirm-mock/+server.ts`, `src/routes/checkout/+page.svelte`
  - 실검증(Stephen 직접 클릭, localhost:5173): 랜딩 URL의 productName/orderNumber(실 reservation_code
    CSREV260700019)/startDate·endDate/amount(22,000원) 전부 실DB 데이터와 일치 확인. 더미값 노출 없음.
  - 트러블슈팅 경과: "아무 반응 없음" 최초 보고 시 원인 오판(Production 미배포 문제로 착각) →
    재확인 결과 실제 원인은 "등록한 대여 조건에 모두 동의합니다" 체크박스 미체크로 인한
    canProceed=false(버튼 disabled) — 정상 가드 동작이었음. 체크 후 정상 작동 확인.

- **BL-LC-R4: CMS RentalDetailPanel 액션 경로 하드코딩** | ROUTINE
  - 파일: `src/lib/components/cms/RentalDetailPanel.svelte`
  - `action="/cms/reservation?/updateStatus"`, `action="/cms/reservation?/approveReservation"` 절대경로 하드코딩
  - `/cms/rentals` 뷰에서 `/cms/reservation` 서버 액션 호출 — 라우트 변경 시 파손 위험

- **BL-LC-R5: 예약 생성 RPC 이중화** | ROUTINE
  - `create_hold_reservation` (상품 상세 → 직접 사용) vs `atomic_reserve_asset` (`/api/checkout/initiate` — UI 미연결)
  - 실제 사용 경로: create_hold_reservation. atomic_reserve_asset 정리 또는 통일 필요

### 🔴 CRITICAL — 채팅 알림 정합성 결함 (감사 2026-07-27)

- **BL-CHAT-C1: 실결제(Toss) 확인 경로에서 예약승인 알림 미발송** | CRITICAL | ✅ 완료 (2026-07-27)
  - 원인: `confirm_payment_and_update_reservation` RPC 및 호출부 어디에도 `send_rental_chat_notification` 호출 없음
    → `reservation_approval`은 CMS 수동승인 + `confirm-mock`(Mock)만 발송 — 실결제 붙으면 사용자가 승인 알림을 못 받는 상태였음
  - 해결: 실결제 확인 경로 2곳에 `confirm-mock`과 동일 패턴으로 `send_rental_chat_notification(reservation_approval)` 추가
    - `src/routes/api/payment/confirm/+server.ts`: RPC 성공 응답(`data.success`) 직후, 최종 `return json(...)` 이전에 추가
    - `src/routes/payment/success/+page.server.ts`: RPC 성공 확인(`result.success`) 직후, 예약/상품 조회 이전에 추가
  - 두 경로 모두 알림 실패가 결제 확정 자체를 막지 않도록 `await`만 하고 에러는 무시(confirm-mock과 동일 설계)
  - 참고: 두 경로 모두 현재 UI에서 체크아웃 CTA가 호출하지 않는 미연결(dead) 코드 상태(BL-LC-R1/BL-CHAT-C4 관련) —
    S1-M3에서 실제 Toss 연동을 이 경로들에 다시 붙일 때 이 알림 로직이 이미 포함되어 있음
  - svelte-check: 신규 에러 0건 (기존 11 errors 그대로 유지, 수정 파일 무관)

- **BL-CHAT-C2: "대여확인"(수령확인) 전용 알림 타입 부재** | CRITICAL | ✅ 완료 (2026-07-27, Stage+Production 적용)
  - 원인: `in_use` 진입 시 자동 발송되는 유일한 타입이 `return_remind`("반납 예정")뿐 — 수령/대여시작 확인 카드 없음
  - 해결: 신규 notify_type `rental_confirm` 추가 (기존 4종 분기 무변경, `rental_confirm` 분기만 추가)
    - `supabase/migrations/20260727000174_174_add_rental_confirm_notify_type.sql` 신규 생성
    - `src/routes/cms/reservation/+page.server.ts`: `AUTO_NOTIFY['in_use']` = `'return_remind'` → `'rental_confirm'` 교체
      (return_remind는 `cms/rentals`의 수동 "반납 예정 알림 💬" 버튼용으로 그대로 유지 — NOTIFY_TYPE_MAP 미변경)
    - `src/lib/components/chat/ActionCard.svelte`: `case 'rental_confirm'` 추가 ("대여 정보 확인" 라벨)
  - DB 적용: Stage(ezyvffjvuwmtuhpxdjrw) ✅ 적용+검증 완료 / Production(vnbpmvxruyciuuaermyh) ✅ Stephen 승인 후 적용+검증 완료 (2026-07-27)
  - svelte-check: 신규 에러 0건 (기존 11 errors 유지)
  - 부수 효과: BL-CHAT-B6("return_remind가 대여시작 즉시 발송되어 라벨과 불일치")도 자동 해소됨
    — in_use 자동발송이 이제 의미가 맞는 rental_confirm으로 발송되고, return_remind는 관리자가
    실제 반납 임박 시점에 수동으로만 보내는 용도로 정리됨

- **BL-CHAT-C3: 계약서명 완료 시 rental_reservations 직접 UPDATE(H-01 위반) + 알림 유실** | CRITICAL
  - 파일: `src/routes/api/contracts/[token]/sign/+server.ts:66-69`
  - `shipped→in_use` 상태전이를 RPC 미경유 직접 UPDATE로 처리 — H-01 원칙 위반, AUTO_NOTIFY 맵도 안 탐(정상 in_use 진입 알림 누락)
  - 알림 대상 세션이 `status='open'`만 조회(88-95행) — pending/closed뿐이면 서명완료 알림 자체가 조용히 유실됨

- **BL-CHAT-C4: confirm-mock이 무관한 hold 예약까지 일괄 승인** | CRITICAL (Mock 한정, 실결제 전환 시 재검토 필수)
  - 파일: `src/routes/api/checkout/confirm-mock/+server.ts:15-35`
  - 현재 카트와 무관하게 유저의 모든 hold 예약을 조회해 일괄 confirmed 전환 + 알림 발송

### 🟡 BOUNDARY — 채팅 알림 정합성 결함 (감사 2026-07-27)

- **BL-CHAT-B1: reservation_hold/reservation_approval 콘텐츠 CASE 미매핑** | BOUNDARY
  - `supabase/migrations/20260727000170...sql`의 `v_content` CASE가 4종(shipment_notify/return_remind/return_registration/rental_complete)만 처리
  - 가장 빈번한 reservation_hold/reservation_approval은 제네릭 "상품명 알림" 텍스트로 발송됨

- **BL-CHAT-B2: 택배/배송 추적 알림 부재** | BOUNDARY
  - Stephen 요청 "택배알림"에 대응하는 송장/배송상태 추적 알림 없음. `shipment_notify`는 출고 시점 1회성일 뿐

- **BL-CHAT-B3: send_rental_chat_notification이 context_type 무시하고 세션 재사용** | BOUNDARY
  - 알림 발송 시 해당 유저의 아무 open/pending 세션에나 카드 삽입(context_type 구분 없음)
  - product_inquiry로 연 세션에 반납알림이 섞여 들어갈 수 있음 — chat.md 컨텍스트 분리 설계 위반

- **BL-CHAT-B4: 계약 발송/서명 경로가 세션 재사용 정책 위반** | BOUNDARY
  - `api/cms/contracts/[id]/send-chat`: open만 찾고 없으면 재활성화 없이 신규 세션 생성(chat.md "신규 세션 생성 금지" 위반)
  - `api/contracts/[token]/sign`: 마찬가지로 open만 찾고 없으면 알림 유실(BL-CHAT-C3과 동일 근본원인)

- **BL-CHAT-B5: 수동 알림버튼과 자동발송 알림 중복 발송 가능 (멱등성 없음)** | BOUNDARY
  - `cms/rentals` 수동 버튼과 `cms/reservation` AUTO_NOTIFY가 동일 notify_type 독립 발송 가능, "이미 발송됨" 표시 없음

- **BL-CHAT-B6: return_remind 발송 시점이 라벨과 불일치** | BOUNDARY | ✅ 절반 완료 (2026-07-27, BL-CHAT-C2 부수 해결)
  - 원인: `AUTO_NOTIFY['in_use']='return_remind'`가 대여 시작 즉시 발송 — "반납 예정 알림" 라벨과 실제 동작(반납일 임박 아님) 불일치
  - 해결: BL-CHAT-C2 처리로 `AUTO_NOTIFY['in_use']`가 `rental_confirm`으로 교체되며 자동으로 해소
    — return_remind는 이제 `cms/rentals` 관리자가 실제 반납 임박 시점에 수동 발송하는 용도로만 사용됨
  - 잔여: 반납일 임박 자동 리마인드(cron 기반 스케줄 발송)는 여전히 없음 — 별도 기능 구현 필요(범위 외, 미해결)

### 🟢 ROUTINE — 채팅 알림 정합성 결함 (감사 2026-07-27)

- **BL-CHAT-R1: /api/chat/action-card 죽은 코드** | ROUTINE
  - 존재하지 않는 `user_profiles.is_admin` 컬럼 참조(실제는 cms_role) — 호출부도 없음

- **BL-CHAT-R2: CMS 세션목록 페이지네이션 없음 + N+1 쿼리** | ROUTINE
  - `api/chat/sessions/+server.ts` `.limit(100)` 고정 + 세션별 마지막 메시지 개별 쿼리

- **BL-CHAT-R3: AUTO_NOTIFY['confirmed'] 도달 불가능한 데드 코드** | ROUTINE
  - `cms/reservation/+page.server.ts:129` — nextStatus()가 confirmed를 targeting하는 경로 없음(무해)

- **BL-CHAT-R4: rental-lifecycle.md 문서에 AUTO_NOTIFY 자동발송 매핑 누락** | ROUTINE
  - 문서는 수동 NOTIFY_TYPE_MAP만 기술, cms/reservation의 자동 AUTO_NOTIFY 트리거 미기재 → 갱신 필요

상세 근거·표·정상구현 확인 목록: `.claude/harness/learnings/chat_notification_lifecycle_audit_2026-07-27.md`

### 🖼️ 누락 UI 화면 — BACKLOG (감사 2026-07-27)

- **BL-UI-M1: QR 스캔 사용자 랜딩 페이지 없음** | BOUNDARY
  - 경로: `/qr/product/[id]` — `+page.svelte` 미존재
  - 현재: QR 스캔 시 CMS 화면으로 이동 (사용자 화면 없음)
  - 필요: 상품 상세 또는 예약 화면으로 이동하는 USER 랜딩 페이지 구현

- **BL-UI-M2: 상품 상세 사양(스펙) 탭 미연동** | BOUNDARY
  - 파일: `src/routes/products/[id]/+page.svelte:593`
  - "사양 정보가 준비 중입니다." 플레이스홀더 — DB `products.specifications` JSONB 연동 미구현

- **BL-UI-M3: PAYMENT_REQUEST_CARD 발송 메커니즘 없음** | BOUNDARY (M3 연계)
  - `src/lib/components/chat/ActionCard.svelte`에 `payment_request` 타입 정의됨 ("대여 계약 결제하기" 버튼)
  - 이 카드를 발송하는 API/RPC 없음 — S1-M3 Payment Integration 구현 시 함께 처리 필요

### 소규모 (즉시 처리 가능)
- BL-① category_taxonomy_map 기본 매핑 입력 | SPT/MON/PWR/MED/STD/VID product_category 연결 — 현재 null로 Fallback 2 적용 중 | Migration으로 일괄 처리 필요
- BL-② edit/+page.server.ts category 변경 시 품번 재발행 정책 결정 | Stephen 결정 필요 | 현재 최초 등록 시만 발행
- BL-③ M3 예약코드 구현 시 cms_settings product_code_format 키 분리 | 현재 reservation_code_format 공용
- BL-④ combo_keywords → 상품 검색 태그 자동 제안 연동 (products/new 미활용 상태)
- BL-CRAZYLOG-SUBMIT: crazylog 작성 폼 실제 서버 제출 로직 구현 (현재 handleSubmit 빈 함수)
- BL-ALIGO-SMS: SignUpModal 알리고 SMS 실연동 (현재 더미 OTP — line ~73, ~102 TODO 표시)
- BL-SUPABASE-SMTP: Supabase 커스텀 SMTP 설정 (내장 이메일 서비스는 프로덕션 Rate Limit 있음)

### 기타
- 카카오 알림톡 fallback (PRD.1.7.7)
- 프로모션/쿠폰 비활성화 알림 (이관 후 자동 처리)

- BL-CO-DELIVERY-KEY: checkout `DeliveryMethod` 타입에 'delivery'(외부택배) 값 부재 | 발견 2026-08-03
  (draft 임시예약 FE-4 작업 중 확인, 이번 작업 범위 밖이라 미수정)
  - 상품상세 `data.rentalMethods`의 `method_key`는 'delivery'(외부 택배)·'epost'·'crazydelivery'(자체배송)
    등을 구분해서 쓰지만, checkout의 `DeliveryMethod` 타입은
    `'crazydelivery' | 'quick' | 'locker' | 'visit' | 'epost'` 뿐이라 'delivery' 값을 표현할 방법이 없음
    (`toDeliveryMethod()`가 알 수 없는 값이면 기본값으로 대체)
  - 영향: checkout에서 pickup_method가 'delivery'로 저장된 항목은 화면에 다른 방식으로 표시되거나,
    2일 리드타임 재검증(`TWO_DAY_LEADTIME_KEYS_CO`)이 'epost'만 걸리고 'delivery'는 걸리지 않을 수 있음
    (crazydelivery는 원래도 2일 리드타임 대상 아님 — 정상)
  - 이번 draft 기능(promote_draft_reservation) 자체의 결함이 아니라 checkout 기존 타입 설계의
    사전 한계 — 별도 확인·기획 결정 후 수정 필요

---


## BLOCKED (AUDIT — Track B)

- [ ] Track B-1: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 실DB 대조 감사 — Supabase MCP 미인증으로
  이번 세션 실행 불가
  - Stephen이 `/mcp` 인증 완료 후 진행: get_advisors(security+performance) + 고아 데이터 재점검
    (2026-07-14 AUDIT 선례 대비 회귀 확인) + AUDIT-1~3에서 발견된 각 RPC의 실제 배포 시그니처 대조
  - 순서: crazyshot-stage 먼저 → crazyshot Production(vnbpmvxruyciuuaermyh) 다음
- [ ] Track B-2: crazyshot Production(vnbpmvxruyciuuaermyh) 실DB 대조 감사 — 위 Track B-1 완료 후
  진행, Stephen 명시 승인 필요(실서비스 DB 직접 조회이므로 신중 진행)


## BACKLOG (AUDIT 결과 등록 대기)

> AUDIT-2.1~3.4 (총 9개 태스크) 결과 취합 완료 — AUDIT-4 2026-08-06 종합 등록.
> **CRITICAL 0건 (기해결 2건 별도), BOUNDARY 4건, ROUTINE 11건.**
> 전 항목 코드 수정 없이 Stephen 확인 후 별도 B-START로 처리할 것.
> 상세 보고서: `.claude/harness/learnings/cms_full_audit_2026-08-06.md`

### BOUNDARY (4건) — 서비스 로직에 실질 영향 가능

- [ ] **AUDIT-BND-01**: `requireSuperadmin()` dual-schema 폴백 미처리 (production DB 6개 action 403 위험)
  - 파일: `src/routes/cms/accounts/list/+page.server.ts` 내 requireSuperadmin 헬퍼
  - 확인: production DB `user_profiles.id`가 auth user ID와 동일한지 확인 후 `cmsProfile.ts` 패턴과 동일한 폴백 추가
  - 출처: AUDIT-3.4 | 별도 B-START 필요

- [x] **AUDIT-BND-02**: `/cms/customers/*` 6개 sub-routes partner 직접접근 차단 미적용 — **수정 완료(2026-08-24)**
  - 실제 파일 위치는 `/api/cms/customers/[id]/*`가 아니라 `src/routes/cms/customers/{addresses,
    chat-sessions,credit-audit,profile-settings,rentals,subscriptions}/+server.ts` 6개(STAGE 4에서
    정정 확인)
  - 문제: "any CMS role" 체크만 → partner URL 직접 호출 시 고객 주소/구독/크레이지스코어/대여이력/
    채팅상담이력/알림설정 조회 가능 (security-auth.md "고객관리: partner ❌" 불일치)
  - 처리: 6개 파일 전부 `fetchCmsProfileByAuthId` 이후 `hasSettingsAccess(profile?.cms_role ?? '')`
    게이트 추가(기존 "CMS 권한 없음" 메시지를 표준 문구 "권한 없음"으로 통일). 부모 페이지
    (`/cms/customers`)는 이미 hasSettingsAccess로 막혀있어 UI 경로 영향 없음(manager+ 계정의
    정상 사용 무회귀) — 이번 수정은 오직 직접 HTTP 호출 우회 경로만 차단.
  - 검증: 신규 `src/__tests__/server/customersDetailApiGuards.test.ts`(12건, partner→403/
    manager→통과 6개 라우트×2 각각) 전부 GREEN, `eslint`·`svelte-check` 신규 에러 0건.
  - 출처: AUDIT-3.1 | 별도 B-START 필요

- [ ] **AUDIT-BND-03**: `promotion/ad`, `promotion/coupon` 직접 DML — H-01 위반
  - 파일: `src/routes/cms/promotion/ad/+page.server.ts`, `src/routes/cms/promotion/coupon/+page.server.ts`
  - 문제: `banners`/`coupons` 테이블 INSERT/UPDATE/DELETE 직접 사용 (H-01: RPC 경유 원칙 위반). CMS 68종 RPC 목록에 해당 RPC 없어 불가피. promotion/point는 RPC 준수.
  - 처리: 신규 RPC(admin_create_banner 등) 신설 → Migration → RPC 교체
  - 출처: AUDIT-3.2 | 별도 B-START 필요 (RPC 신설 선결)

- [ ] **AUDIT-BND-04**: `promotion/analytics` load() `hasSettingsAccess` 누락
  - 파일: `src/routes/cms/promotion/analytics/+page.server.ts`
  - 문제: partner URL 직접 접근 시 수익률/전환율/캠페인 성과 조회 가능 (promotion 6개 중 analytics만 manager+ 제한 누락)
  - 처리: `const { cmsRole } = await parent(); if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')` 추가
  - 출처: AUDIT-3.2 | 단일 파일 1줄, 별도 B-START 필요

### ROUTINE (11건) — 개선 권고, 즉각적 서비스 영향 없음

- [ ] **AUDIT-RTN-01**: chat.md §3 세션전이 정책 구버전 기술 (문서 드리프트)
  - 파일: `.claude/rules-ref/chat.md` §3
  - 문제: 2026-07-27 변경(pending 강제 제거)이 미반영. 코드는 정상, 문서만 드리프트.
  - 처리: §3 세션 상태 전이 규칙 갱신 (pending 재진입 조건 수정)
  - 출처: AUDIT-2.1

- [ ] **AUDIT-RTN-02**: AGENTS.md §도메인 규칙 파일 목록 실제 배치 불일치 (문서 드리프트)
  - 파일: `AGENTS.md` §도메인 규칙 파일 목록
  - 문제: rental.md/payment.md/uiux.md → rules-ref/에 있으나 rules/로 기술. products.md/rental-lifecycle.md/uiux-index.md → rules/에 있으나 누락.
  - 처리: CLAUDE.md "상시 로드" 섹션 기준으로 AGENTS.md 동기화
  - 출처: AUDIT v2 사전 확인

- [ ] **AUDIT-RTN-03**: console.error 로깅 전략 불통일
  - 파일: `src/routes/cms/reservation/+page.server.ts:73`, `src/routes/cms/rentals/+page.server.ts:32`
  - 문제: 프로덕션 서버 로그에 오류 스택 노출 가능 (console.log 아니라 기술적 위반 아님)
  - 처리: 향후 로깅 전략 정립 시 구조화 로거 교체 고려
  - 출처: AUDIT-2.2, 2.3

- [ ] **AUDIT-RTN-04**: `RentalDetailPanel.svelte` 내부 `RentalListRow` 타입 delivery_fee 누락 (타입 드리프트)
  - 파일: `src/lib/components/cms/RentalDetailPanel.svelte`
  - 문제: 정본(reservation/+page.server.ts)과 delivery_fee 필드 불일치. 런타임 영향 없음.
  - 처리: 공통 타입 파일 분리 또는 정본과 동기화
  - 출처: AUDIT-2.3

- [ ] **AUDIT-RTN-05**: `/cms/products` 전 액션 세션 체크만 (role 체크 없음) — Stephen 확인 필요
  - 파일: `src/routes/cms/products/+page.server.ts`, `src/routes/cms/products/new/+page.server.ts`
  - 문제: retryProductCode~cloneProduct 등 전 액션에 getCmsRoleForAction 없음. partner가 상품 수정/삭제 가능.
  - 처리: Stephen 확인 — partner 상품 수정 허용 여부 결정 후 필요 시 getCmsRoleForAction 추가
  - 출처: AUDIT-2.4 (공통점검 2번 기확인 항목)

- [ ] **AUDIT-RTN-06**: `api/search/products/+server.ts` `(supabase.rpc as any)` Frozen 파일 any 타입
  - 파일: `src/routes/api/search/products/+server.ts` (Frozen — 수정 시 Stephen 확인 + CRITICAL 게이트)
  - 문제: `(supabase.rpc as any)('search_products', ...)` core-rules.md "any 타입 절대 금지" 위반
  - 처리: database.ts Functions 맵에 search_products 타입 등록 → callTypedRpc 패턴 적용
  - 출처: AUDIT-2.5

- [ ] **AUDIT-RTN-07**: MiniSearch 카테고리 필터 폴백 불일치
  - 파일: `src/routes/api/search/products/+server.ts`
  - 문제: p_category 있을 때 MiniSearch 폴백에 category 필터 미적용 → 다른 카테고리 상품 섞일 수 있음 (발생조건: 카테고리 필터 + RPC ≤3건)
  - 처리: MiniSearch 폴백에 `filter: (r) => r.category === p_category` 조건 추가
  - 출처: AUDIT-2.5

- [ ] **AUDIT-RTN-08**: canned-response 삭제 경로 이원화 (유지보수 주의)
  - 파일: `src/routes/cms/chat/qna/+page.server.ts`, `src/routes/api/cms/canned-responses/+server.ts`
  - 문제: form action 경로와 API fetch 경로 양쪽에서 삭제 처리 — 권한가드 동기화 주의 필요
  - 처리: 중복 아님, 유지보수 시 양쪽 동기화 인지 메모로만 등록
  - 출처: AUDIT-2.1

- [ ] **AUDIT-RTN-09**: `requireSuperadmin()` 함수명 오인 위험
  - 파일: `src/routes/cms/accounts/list/+page.server.ts` 내 requireSuperadmin 헬퍼 (실제는 manager+ 권한)
  - 처리: `requireManagerOrAbove` 또는 `requireSettingsAccess`로 리네이밍 권고
  - 출처: AUDIT-3.4

- [ ] **AUDIT-RTN-10**: `set/push` admin() 팩토리 URL 헬퍼 불일치 (동작 영향 없음)
  - 파일: `src/routes/cms/set/push/+page.server.ts`
  - 문제: PUBLIC_SUPABASE_URL 직접 사용 vs getSupabaseUrl() 헬퍼 패턴 불일치
  - 출처: AUDIT-3.3

- [ ] **AUDIT-RTN-11**: `promotion/ad`, `coupon` action 오류 응답 HTTP 200 패턴
  - 파일: `src/routes/cms/promotion/ad/+page.server.ts`, `src/routes/cms/promotion/coupon/+page.server.ts`
  - 문제: `return { ok: false }` (HTTP 200) — SvelteKit `fail()` 표준 미사용 (실 차단은 됨)
  - 처리: AUDIT-BND-03 H-01 수정 시 함께 통일 (RPC 신설 후 리팩터링)
  - 출처: AUDIT-3.2

---

---

### 🔁 2026-08-06 연속 세션 — sp3-qa-agent 검수 후속 개선 2건 (GATE E PASS 후 즉시 반영)

> 배경: "/cms/products 품번·QR·재고 정합성 최종 검증 및 후속 결함 수정" 섹션(위 §QR-CASE-1/2 포함
> 전체 태스크군) 완료 후 sp3-qa-agent로 GATE C 최종 검수 실행 — 결과 PASS, 비차단 개선사항 2건
> 발견 → Stephen 요청으로 즉시 처리.

- [x] QR-CASE-1-FOLLOWUP: `.ilike('product_code', ...)` 전환 시 LIKE 와일드카드(`%`/`_`) 미이스케이프 | GSD | 🟡 BOUNDARY — ✅ 완료
  - QA 발견: 카테고리 코드에 `#%&@` 허용(`addCode` 액션)이라 `%`가 섞인 카테고리의 품번을 스캔하면
    ilike 와일드카드로 오동작해 `.maybeSingle()`/`.single()`이 다중행 에러를 던질 수 있는 엣지케이스
  - 수정: `src/lib/server/escapeLikePattern.ts` 신규(`value.replace(/[\\%_]/g, '\\$&')`) →
    QR-CASE-1의 3개 지점(`src/routes/cms/mobile/qr/[product_id]/+page.server.ts` 2곳,
    `src/routes/qr/[entity]/[id]/+server.ts` 1곳) 전부 `escapeLikePattern()` 적용
- [x] QR-CASE-2-FOLLOWUP: `/cms/codes` 서버는 manager+로 막혀있으나 페이지 UI는 role 무관 항상 노출 | GSD | 🟡 BOUNDARY — ✅ 완료
  - QA 발견: 액션만 막혀있고 화면 자체는 partner에게도 그대로 보여서 모든 버튼 클릭 시에만 403 —
    기능·보안 결함은 아니나 UX 혼란
  - 수정: `src/routes/cms/codes/+page.server.ts` `load()`에 `accounts/customers` 등 기존 manager+
    전용 페이지와 동일한 `const { cmsRole } = await parent(); if (!hasSettingsAccess(cmsRole ?? ''))
    throw redirect(303, '/cms?notice=access_denied')` 패턴 추가 — 페이지 진입 자체를 차단

문서 반영: `products.md`(v2.4→v2.5), `security-auth.md`(v3.4→v3.5) 동기화 완료.
svelte-check: 1117 FILES(escapeLikePattern.ts 신규 1개 증가), 11 ERRORS(= baseline), 289 WARNINGS |
신규 에러 0건.


## BACKLOG
- return_remind(반납 예정 알림) 날짜 기준 자동발송 pg_cron 스케줄러 신설 — 타 세션 조사 결과와
  중복 확인됨, Stephen 우선순위 판단 대기
- SVG 아이콘 하드코딩 색상 → currentColor+CSS변수 패턴 통일 (선택, 차단 아님) — sp3-qa-agent 권고


## BACKLOG 추가 — any 타입 41개 파일 + database.ts 근본 구조 문제 [CRITICAL] (2026-08-17, Stephen 지정)

**배경**: 프로젝트 전체 코드 심각도 정량화(STEP E) 중 `any` 타입 41개 파일 정리를 시도하다
근본 원인이 예상보다 훨씬 큼을 발견 — Stephen 지시로 CRITICAL로 기록만 하고 작업은 보류.

**발견 사실**:
- `src/lib/types/database.ts`(869줄)는 Supabase 자동생성 파일이 아니라 **손으로 유지보수하는
  커스텀 타입 파일**(`Coupon`/`UserCoupon` 등 자체 타입 별칭 방식). core-rules.md 파일경로
  규칙에 "database.ts는 생성 파일"이라 명시돼 있으나 실제로는 수동 관리 상태와 자동생성 기대가
  불일치.
- 실제 `generate_typescript_types`(Supabase MCP)로 stage에서 뽑아보면 형식이 완전히 다른
  약 15만자 규모의 정식 `Database` 인터페이스가 나옴 — 그대로 교체하면 이 타입을 참조하는
  프로젝트 전체 코드가 깨질 수 있는 대형 마이그레이션 작업.
- **RPC 함수 타입(`Functions` 맵)이 현재 파일에 전혀 없음** — `.rpc(...)` 호출은 테이블 타입
  유무와 무관하게 전부 타입 안전성이 없어, 프로젝트 전역에서 `locals.supabase as unknown as any`
  캐스팅이 반복 발생(그때그때 "타입 생성 전 캐스트"라는 동일 설명 주석과 함께) — 이게 41개
  파일 any-타입의 실질 근본 원인.
- 표본 확인한 `cms/promotion` 7개 파일 전부 이 패턴(`as unknown as any`)이었고, `api/chat/**`는
  ESLint 설정에서 아예 "RPC 마이그레이션 완료 후 제거 예정" 코멘트와 함께 통째로 lint 제외돼
  있어 currently 검증 자체가 안 되는 상태.

**필요한 작업(범위가 커서 이번 세션에서 미착수 — 별도 B-START 필요)**:
1. `database.ts`를 수동 관리 방식에서 `supabase gen types typescript` 기반 자동생성 방식으로
   전환할지, 아니면 현재 수동 방식을 유지하되 최소한 자주 쓰는 RPC들만 `Functions` 타입을
   보강할지 설계 결정 필요(Stephen 확인 필요)
2. 전환 시 프로젝트 전역 타입 임포트 방식이 바뀔 가능성 커서 파급범위 사전 조사 필수
3. `eslint.config.js`의 `api/chat/**` ignore 조건("RPC 마이그레이션 완료")이 실제로 충족됐는지
   확인 후 ignore 해제 여부 결정

**현재 상태**: 조치 없음(코드 미변경). 표본 확인한 promotion 7개 파일의 `as any`는 그대로 유지.


## NOW — 휴대폰 OTP 발송 서버측 재발송 최소 간격 추가 (2026-09-10, 이 세션 단독 수행)

**배경**: Stephen이 "알리고 키만 등록하면 사용 가능한 상태인가?" 질의 → 조사 결과 코드는
이미 완전 구현(§ 알리고 SMS OTP, `phone_otps`/`verify_and_update_phone`)돼 있고 키 3개
(`ALIGO_API_KEY`/`ALIGO_USER_ID`/`SMS_SENDER_PHONE`)만 Vercel Production에 등록하면
바로 동작함을 확인·보고. 이 과정에서 `/api/profile/send-otp`에 **서버측 재발송 제한이
전혀 없다**는 점(클라이언트 5분 카운트다운은 UI 단속일 뿐, API 직접 호출 시 무제한
재발송 가능 — 실과금 SMS 남용 노출)을 발견해 보고했고, Stephen이 "서버측 재발송 최소
간격 추가해줘"로 확정 지시.

**구현**: `src/routes/api/profile/send-otp/+server.ts` — 기존 미인증 OTP 만료처리 단계
직전에, 같은 (user_id, phone) 조합으로 아직 만료되지 않은(=클라이언트 5분 카운트다운과
동일 기준) 미인증 `phone_otps` 행이 있으면 신규 발송을 차단(`429` + 남은 초 안내) 하는
쿼리를 추가. 새 하드코딩 간격값을 도입하지 않고 기존 5분 만료 규칙을 서버에서도 그대로
재사용 — 클라이언트·서버 규칙이 divergence 없이 항상 일치.

이 엔드포인트는 마이페이지 휴대폰 수정(`ProfileTabContent.svelte`)과 회원가입 모달
(`SignUpModal.svelte`) 둘 다 공유하므로, 별도 수정 없이 회원가입 경로도 함께 보호됨.

**검증**: `npx svelte-check` — 대상 파일 신규 에러·경고 0건. DB 스키마/RPC 변경 없음
(기존 `phone_otps` 테이블 컬럼만 조회하는 SELECT 추가).

**git commit은 Stephen 직접 실행.**

---

## NOW — 마이페이지 개인정보 동의 체크박스를 표준 '체크아이콘' 버튼으로 교체 (2026-09-11, 이 세션 단독 수행)

**요청(Stephen)**: "선택영역 '체크박스'를 front 표준디자인시스템 지침의 아이콘 중 '체크
아이콘' 버튼 UI로 수정. 1. 적정 사이즈와 텍스트와 수평 중앙 유지. 2. pc & mobile
반응형 비율 적용할 것." — 이번엔 `<launch-selected-element>` 스크린샷이 첨부되지 않아,
uiux-index.md "체크아이콘(CheckIcon) 버튼" 표준 문서가 "`<input type=\"checkbox\">`
신규 작성 금지"라고 명시한 점과 "front 표준디자인시스템"(front-uiux.md 대상, CMS 아님)
한정 표현을 근거로 대상을 특정 — `grep`으로 "개인정보 수집 및 이용 동의"/"개인정보 제
3자 제공" 텍스트를 검색해 CMS(`CustomerDetailPanel.svelte`)와 front(`ProfileTabContent.
svelte`) 2곳만 존재함을 확인, "front" 한정으로 후자만이 유일하게 해당함을 확정(고유명사
추정 금지 원칙 — 텍스트 검색으로 실제 위치를 먼저 확인 후 진행).

**발견**: `ProfileTabContent.svelte`의 "동의 항목" 2개 버튼(개인정보 수집·제3자 제공)이
독자적인 커스텀 SVG 사각형 체크박스(둥근 모서리 사각형, 채워짐/빈 테두리 2종 분기)를
쓰고 있었고, 같은 파일의 "체류기간 선택"(외국인증명 탭, `checkbox-btn checkbox-btn-terms`)
버튼은 이미 uiux-index.md 표준 체크아이콘(체크마크 path, `currentColor` + `.checked`
클래스 토글)을 정확히 쓰고 있어 같은 파일 안에 신구 두 패턴이 공존하고 있었다.

**구현**: 커스텀 사각형 SVG 2벌(각 if/else 분기, 총 4개 SVG)을 제거하고, 같은 파일에
이미 있던 표준 `checkbox-btn checkbox-btn-terms` 패턴(체크마크 path, `class:checked`)을
그대로 복사해 적용 — 신규 CSS 없이 기존 `.checkbox-btn`/`.checkbox-btn-terms`
클래스(반응형: 모바일 22×15px → PC(≥768px) 18×12px, 이미 이 파일에 정의돼 있던 값)를
그대로 재사용해 PC·모바일 비율 요구사항을 별도 작업 없이 자동 충족. 버튼 자체의
`flex items-center gap-[12px]`(기존 Tailwind 유틸리티, 무변경)가 아이콘·텍스트 수직중앙
정렬을 그대로 유지 — 아이콘 크기가 바뀌어도 정렬 로직 자체는 영향받지 않음.

**검증**: `npx svelte-check` — 대상 파일 신규 에러 0건(경고도 기존 패턴만, 신규 없음).
DB/RPC/마이그레이션 변경 없음. CMS(`CustomerDetailPanel.svelte`)는 요청 범위(front 한정)
밖이라 미수정.

**git commit은 Stephen 직접 실행.**

---

## NOW — 마이페이지 본인증명·외국인증명 등록완료 목록 "보기" 버튼 임시 감춤 (2026-09-11, 이 세션 단독 수행)

**요청(Stephen)**: "선택영역 보기 버튼UI 및 기능 감춤. 개인정보 보안 우려를 고려한 임시
조치: 추후 중요정보 자동 가림 기능 보완해 재사용 예정." — 선택된 `.btn-doc-view`
버튼이 본인증명·외국인증명 등록완료 목록 두 곳(`ProfileTabContent.svelte`)에 동일 클래스로
각각 존재해, GATE B 성격 질문(AskUserQuestion)으로 범위를 확인 — "본인증명+외국인증명 둘 다
감춤"으로 확정(보안 우려가 양쪽에 동일 적용되므로, 한쪽만 가리면 다른 쪽에 보안 공백이
남는다는 판단).

**구현(삭제가 아니라 주석처리 — 복원 전제)**:
- `<button class="btn-doc-view" onclick={() => openIdentityDoc(url)}>보기</button>`,
  동일 패턴의 `openForeignDoc(url)` 버전 2곳 전부 HTML 주석(`<!-- -->`)으로 처리(마크업
  삭제 아님) — 각 위치에 감춤 사유·복원 시점(중요정보 자동 가림 기능 보완 후) 명시.
- `openIdentityDoc`/`openForeignDoc` 함수 자체는 그대로 유지(재사용 예정이므로 삭제 안 함).
- 마크업 주석처리로 `.btn-doc-view`/`:hover` CSS가 미사용 상태가 되어 svelte-check
  unused-selector 경고가 새로 뜨는 것을 확인 → 해당 CSS 블록도 함께 `/* */` 주석처리(마크업과
  세트로 항상 같이 복원되도록).
- `.doc-file-list-item`이 `justify-content` 없는 단순 `flex + gap`이라 버튼 제거 후에도
  레이아웃 깨짐 없음(아이콘+라벨만 좌측 정렬로 남음).

**검증**: `npx svelte-check` — 신규 에러·경고 0건(unused-selector 포함). DB/RPC/마이그레이션
변경 없음.

**git commit은 Stephen 직접 실행.**

---

## NOW — 마이페이지 본인증명 개별 파일 수정 + 추가 등록(병합 업로드) 신설 (2026-09-14, 이 세션 단독 수행)

**요청(Stephen)**: "1. 등록된 본인 증명정보파일 목록 UI 내 우측 끝에 개별 수정 버튼 UI 배치:
기존 업로드 파일 재업로드 수정 기능. 2. 미등록 증명파일 업로드 카드 UI를 등록완료 카드
아래에 노출배치: 추가 등록가능하게 UI 노출할 것."

**핵심 기술 문제(사전 검토로 확인)**: `update_user_doc_url` RPC(Migration #360)의 identity
분기는 `identity_doc_url = p_doc_url`로 배열을 통째로 덮어쓴다 — 기존 "재등록" 흐름은
이 전체교체 특성에 맞게 설계돼 있었다(전부 새로 고름). 그런데 이번 요청 2가지("개별
수정"·"추가 등록")는 정반대로 **다른 유형은 그대로 두고 이번에 고른 유형만 바꿔야** 하므로,
그대로 구현하면 매번 나머지 등록분이 통째로 사라지는 데이터 유실 버그가 된다.

**해결 — RPC/스키마 변경 없이 엔드포인트에서 병합 계산**: `/api/profile/upload-doc/+server.ts`에
`merge`(identity 전용) 플래그를 추가 — merge=true일 때 기존 `identity_doc_url`/`identity_type`을
함께 조회해 (url,type) 짝으로 복원한 뒤, "이번 제출 유형"과 겹치는 기존 짝만 교체 대상으로
분리하고 나머지는 그대로 보존 → 보존분+신규분을 합친 "최종 배열"을 RPC에 그대로 넘긴다(RPC
자체는 여전히 단순 대입이지만, 이미 합쳐진 배열을 받으므로 결과적으로 upsert처럼 동작).
스토리지 정리(`oldPaths` 삭제)도 "실제 교체된 것"만 대상으로 좁혀 보존 파일이 삭제되지
않도록 별도 처리. 비병합(foreign 전체, identity 재등록) 경로는 코드·동작 전혀 무변경.

**클라이언트(`ProfileTabContent.svelte`)**:
- 등록완료 목록(`doc-file-list`) 각 행 우측에 "수정" 버튼 추가(`identityDocTypeAt(i)`로
  그 행의 유형값을 얻어 `startIdentitySingleEdit(type)` 호출) — 요청 1.
- 등록완료 카드(`.doc-registered`) 바로 아래에 새 "병합 업로드" 영역(`doc-merge-wrap`) 신설
  — 기본은 "추가 증명서 등록"(아직 등록 안 된 유형 전체 슬롯 노출), 특정 행 "수정" 클릭 시
  "OO 재업로드"로 전환(그 유형 1개 슬롯만 노출 + 취소 버튼) — 요청 2 + 요청 1의 실제 업로드
  UI. 슬롯 UI는 기존 §22-5 슬롯형 컴포넌트를 그대로 재사용(신규 CSS 최소화 — 헤더/구분선만
  추가).
- 제출은 `submitIdentityMerge()` — `merge=true`로 서버에 위임, 응답 성공 시 `invalidateAll()`로
  등록완료 카드·목록 자동 갱신.

**검증**: `npx svelte-check` — 대상 2개 파일 신규 에러·경고 0건. DB/RPC/마이그레이션 변경 없음
(순수 엔드포인트 로직 확장). 외국인증명(foreign) 섹션은 요청 범위 밖이라 전혀 미수정.

**git commit은 Stephen 직접 실행.**

---

## NOW — 외국인증명 최초등록/재등록도 "버튼 없는 자동 등록"으로 통합 (2026-09-14, 이 세션 단독 수행)

**요청(Stephen)**: 외국인증명 최초등록 화면(체류기간 선택 + 4슬롯, 아직 아무 것도 등록 안 된
상태)에 파일 1개를 선택해도 "자동 목록 등록" 인터랙션이 동작하지 않는다는 리포트 —
"본인증명처럼 업로드 카드에 파일 등록 시 자동 목록 등록이 되야 해!!!!"

**배경(왜 이전에 안 됐는지)**: 이번 세션에서 외국인증명에 이미 두 차례 "버튼 없는 자동
등록"을 적용했으나(① "등록하기" 버튼 제거 + 콤보 4개 전부 채워지면 자동제출, ② 등록완료
후의 "추가 등록"/"개별 수정" 병합 슬롯), ①은 여전히 **"4개 전부 채워야" 자동제출되는
"전체 콤보 필수"** 제약이 남아있어 슬롯 1개만 선택하면 아무 반응이 없었다 — 본인증명의
"파일 1개 선택 = 그 1개만 즉시 등록"과는 본질적으로 다른 동작이었다. Stephen이 이번에
이 제약 자체를 폐기하도록 명시적으로 지시.

**수정 — 최초등록/재등록 폼을 병합(merge) 자동제출 패턴으로 완전 통합**:
- `autoSubmitForeignMergeFile`에 `foreign_stay_type`을 매 요청마다 명시적으로 포함하도록
  변경(기존엔 RPC의 COALESCE로 기존값 보존에 의존 — 최초등록 시점엔 DB에 기존값 자체가
  없어 COALESCE만으론 채워지지 않으므로 명시적 전송 필수). 성공 시 `showForeignForm = false`
  추가(최초등록/재등록 슬롯에서 호출된 경우 즉시 "등록완료" 화면으로 전환).
- 최초등록/재등록 폼의 슬롯 마크업·트리거를 병합 슬롯과 완전히 동일한 패턴으로 교체
  (`handleForeignMergeSlotFileChange` 재사용) — 로컬 스테이징(선택 후 제거 가능한 미리보기)
  개념 자체를 제거, 파일 선택 즉시 그 1건만 자동 병합 제출.
- 이제 불필요해진 구코드 전부 제거: `foreignSlotFiles`/`foreignSlotPreviews`/
  `foreignDragOverSlot`/`isUploadingForeign`/`foreignError`/`resetForeignSlots`/
  `setForeignSlotFile`/`handleForeignSlotFileChange`(구버전)/`removeForeignSlotFile`/
  `handleForeignSlotDragOver`/`handleForeignSlotDragLeave`/`handleForeignSlotDrop`/
  `uploadForeignDoc`(콤보 일괄제출 함수) — 전부 병합 함수 하나로 대체됐으므로 삭제.
- `requestForeignReRegister()` 확인 토스트("기존 정보를 삭제합니다") 제거 — 이제 "재등록"을
  눌러도 즉시 아무것도 삭제되지 않고(슬롯이 열릴 뿐), 실제로 파일을 선택한 슬롯만 그 자리에서
  개별 교체되므로 기존 "전체 삭제" 경고 문구가 더 이상 사실과 맞지 않아 문구째로 제거(다른
  유형은 그대로 보존됨 — 개별 수정과 동일 안전성).

**⚠️ 알려진 한계(신규 도입, 문서화 후 보류)**: 이미 특정 체류기간(예: 단기)으로 콤보가
등록된 상태에서 "재등록"을 누른 뒤 체류기간을 다른 쪽(장기)으로 전환해 그 슬롯에 파일을
채우면, 병합 로직상 반대 체류기간의 기존 항목이 자동으로 정리되지 않는다(예전 배치제출
방식은 전체교체라 이 경우 자동 정리됐음 — 이번 통합으로 상실된 안전장치). 다만 완전히
방치되는 것은 아니다 — 기존 항목(최대 4개) + 새 체류기간 항목이 합쳐지면 서버의
`MAX_FOREIGN_FILES(4)` 초과 체크가 걸려 "최대 4개까지 등록할 수 있어요" 에러로 자동
차단되므로(데이터 침묵 오염 없음, 명확한 에러로 안내), 사용자는 반대 체류기간의 기존
항목을 먼저 개별삭제해야 한다는 사실을 에러로 알게 된다 — 완벽한 UX는 아니나 데이터
무결성은 안전. 필요 시 "체류기간 전환 시 자동 안내/정리" 별도 개선 검토 가능.

**검증**: `npx svelte-check` — 신규 에러 0건, 경고 총 개수 동일(404). 삭제한 식별자 전체
재검색으로 잔여 참조 0건 확인. Claude Browser 실사용 검증(Stage DB 직접 SQL 조회로 최종
데이터까지 확인):
1. 기존 등록된 외국인증명(1건)에서 "재등록" 클릭 → 확인 토스트 없이 즉시 슬롯 노출 →
   1개 슬롯만 파일 선택 → 자동 등록 → 등록완료 화면 전환 확인(나머지 3개는 "추가 등록"에).
2. 전체 삭제로 완전 첫 등록 상태 재현 → 슬롯 1개만 파일 선택 → 자동 등록 →
   `SELECT foreign_stay_type, foreign_type, foreign_doc_urls FROM user_profiles`로 DB
   직접 조회해 `foreign_stay_type:"long"`이 정확히 저장됐음을 실측 확인(COALESCE만으론
   불가능했던 부분 — 명시적 전송이 실제로 필요했음을 검증).

**git commit은 Stephen 직접 실행.**

---

## NOW — 구독 "혜택관리" 5종 실적용 여부 + 프로모션 쿠폰 구독등급 배포 중복 검증 (2026-09-23)

[CONTEXT BRIDGE]
plan_source: Stephen이 `/cms/subscriptions?selected=448` "혜택관리" 탭을 launch-selected-element로
지정 후 두 가지 검증 요청 — ① 혜택관리 5종(할인쿠폰·무료배송·무료렌탈·보험면제·적립포인트)이
실제 로직에 반영되는지 ② 프로모션 쿠폰(/cms/promotion/coupon)의 "구독등급 배포" 옵션이 구독
자체 할인쿠폰 혜택과 중복 발급되는지.
수행: Explore 에이전트 2개 병렬 조사(혜택 5종 소비처 전수 grep / 쿠폰 배포 RPC 대조) +
chargeSubscription.ts·distribute_coupon RPC 최신본(migration 525) 직접 재확인으로 검증.
CRITICAL 판정 근거: 결제(구독료)의 대가로 고객에게 명시적으로 약속하는 혜택 항목이 실제로는
전혀 지급되지 않는 서비스 신뢰성 문제 — 코드 변경 없이 조사만 수행(요청이 "검증"이었음).

### 조사 결과

**① 혜택관리 5종 — 전부 "UI만 있고 실행 로직 없음"(죽은 기능)으로 판정**
- `tier_benefits` 테이블을 참조하는 코드는 전체 저장소에 6곳뿐이며, 그중 CMS 저장(쓰기) 2곳을
  제외한 나머지(구독 상세페이지·CMS 상세·멤버스 비교표) 3곳은 전부 설정값을 문자열 설명
  문구로 화면에 "보여주기"만 함(`formatBenefitForDisplay`).
- 정기 재청구 크론의 실제 결제 처리 함수(`chargeSubscription.ts`)를 직접 grep 재확인 —
  `tier_benefit`/`coupon`/`point`/`shipping`/`free_rental`/`insurance` 키워드 0건 매치.
  즉 "매 결제주기 자동 할인쿠폰 발급"이라는 화면 설명 문구와 달리 실제 발급 코드가 없음.
- 카트 배송비 계산(`cart/+page.server.ts`)은 별도 배송 설정 테이블만 참조, 혜택관리의
  무료배송 월한도를 전혀 확인하지 않음 — 배송비는 혜택 ON/OFF와 무관하게 그대로 청구됨.
- 예약 생성 로직·포인트 적립 로직 어디에도 무료렌탈/보험면제/적립포인트를 소비하는 코드 없음.

**② 프로모션 쿠폰 구독등급 배포 — 현재 시점 중복발급 없음(자동발급 자체가 미구현이므로),
단 향후 리스크 잠재**
- `/cms/promotion/coupon` 배포 탭에서 "특정 등급"(BASIC/PRO/CRAZY) 선택 시
  `distribute_coupon` RPC(최신본 migration 525)가 `user_profiles.membership_grade` 기준으로
  대상자를 뽑아 1회성 수동 배포함(pg_cron 등록 없음 — 관리자가 버튼을 눌러야만 실행).
- 이 경로와 혜택관리의 DISCOUNT_COUPON은 완전히 분리된 별개 시스템 — 후자가 미구현이라
  현재는 이중지급이 구조적으로 발생할 수 없음.
- 다만 향후 DISCOUNT_COUPON을 실제로 구현하면, 프로모션 쿠폰 등급별 배포 화면에 "이 등급은
  이미 구독 혜택으로 할인쿠폰을 받고 있습니다" 같은 경고·중복확인 로직이 전혀 없어 관리자가
  실수로 중복 발행할 위험은 남아있음(설계 공백으로 기록만 해둠).

### 다음 조치 — Stephen 확인 대기 (선택 필요, 스코프 큰 CRITICAL 작업)

혜택 5종을 실제로 동작하게 만들려면 각각 서로 다른 시스템(정기결제 크론·카트 배송비 계산·
예약가격 계산·포인트 적립)에 새 로직을 추가해야 하는 별도의 큰 개발 작업이다 — 이번 NOW
블록에서는 코드 변경 없이 "검증"만 완료. 어느 범위까지, 어떤 우선순위로 실제 구현에
착수할지는 Stephen 확인 후 별도 NOW 블록으로 진행.

---

## NOW — CMS 날짜 선택 팝업 결함 수정 + 쿠폰 "신규 배포" 중단/재개 기능 신설 (2026-09-23)

[CONTEXT BRIDGE]
plan_source: 두 건 모두 Stephen이 launch-selected-element로 화면 요소를 직접 지정하며 순차
지시. ①CmsDatePicker(쿠폰 만료일 등 CMS 전역 날짜선택 공용 컴포넌트)의 달력 팝업 마지막 줄
선택 불가 버그 리포트 → 원인 조사 후 수정 → 후속 피드백 2회(여백·스크롤 방식) 반영 →
"여전히 스크롤 막힘" 재지적으로 진짜 원인(전체화면 backdrop) 재조사·재수정. ②CouponDetailPanel
"상태" 영역 선택 후 "자동발행 활성/비활성 토글 추가" 요청 → 실행 엔진 부재 발견해 AskUserQuestion
2회로 정확한 동작범위 합의(관리자의 '신규 배포' 액션만 차단, 이미 배포받은 고객은 영향 없음) →
구현 → UI 통합 피드백 2회(토글을 '상태' 행에 결합, 목록 상태컬럼도 동기화) 반영 → 최종
"완벽하게 재검증" 지시로 전체 체인 재검증.

### ① CmsDatePicker 달력 팝업 — 마지막 줄 선택 불가 + 스크롤 차단 결함 수정 (3라운드)

**결함 원인**: `.dp-popup`이 `position:absolute`로 트리거 바로 아래 고정 배치돼, CMS 우측
슬라이드 패널(`.panel-body`, overflow-y:auto)처럼 스크롤되는 조상 안에서 쓰일 때 그 조상의
가시 영역 아래로 넘치는 부분이 그대로 잘렸다 — 절대배치 요소는 조상의 scrollHeight를 늘리지
않아 "더 스크롤해서 본다"는 시도 자체가 불가능했음(실사용 버그 — 말일 근처 날짜 클릭 불가).

**1차 수정**: 트리거 위치를 JS로 측정해 `position:fixed` 뷰포트 기준 배치로 전환 — 아래로
공간 부족 시 위로 자동 반전(flip-up), 그래도 부족하면 팝업 자체 `max-height`+`overflow-y:auto`
로 안전망. `visibility:hidden`으로 시작해 위치 계산 후에만 노출해 깜빡임 방지.

**2차 수정**(Stephen 피드백 — 여백 과다·스크롤 시 닫힘): 트리거-팝업 간격 4px→2px 축소.
스크롤 시 팝업을 닫던 기존 동작을 "스크롤마다 위치 재계산"(트리거를 계속 따라감)으로 교체.

**3차 수정**(Stephen 재지적 — "여전히 스크롤 막힘", 진짜 원인 재조사): 실측 결과(JS로 스크롤
전후 `scrollTop` 직접 대조) 진짜 원인은 팝업이 열릴 때마다 뷰포트 전체를 덮던
`.dp-backdrop`(position:fixed, inset:0, 바깥클릭 감지용)이 화면 어디서 휠을 굴려도 스크롤
신호 자체를 배경으로 전달하지 않고 가로채고 있었음(2차 수정과는 별개의 독립적 결함).
`.dp-backdrop` 완전 제거 → 대신 `document`에 `pointerdown` 캡처 리스너를 달아 클릭 지점이
팝업·트리거 바깥일 때만 닫는 방식으로 교체 — 뷰포트를 덮는 요소 자체가 없어져 배경 스크롤을
전혀 가로채지 않음.

**검증**: 실제 CMS 쿠폰 화면에서 재현(패널 바닥에 붙은 날짜 필드 클릭) → 마지막 줄까지
전부 보이고 클릭 선택됨. `elementFromPoint`+`scrollTop` 직접 대조로 배경 스크롤 정상 전달
확인. 스크롤 중 팝업이 트리거를 따라 위치 재계산되는 것도 확인. 5곳(쿠폰·홍보·포인트 등
CMS 날짜선택 전체)에 공용 컴포넌트라 한 번에 반영.

### ② 쿠폰 목록 "코드" 컬럼 — sequenced 모드 프리뷰 표시 완전화

sequenced(지연채번) 모드 쿠폰의 코드 프리뷰가 `CSUCPED*`처럼 날짜부·순번부를 전부 `*`
한 글자로 뭉개 표시하던 것을, `coupon/new` 생성화면의 `buildComboPreview()`와 동일 규칙으로
완전히 풀어 표시(`CSUCPED2026090000` — 날짜부는 현재 연월, 순번부는 실제 자릿수만큼 0패딩)
하도록 `codeDisplay()`를 확장. 실제 Production 데이터 2건으로 계산값 직접 확인. 쿠폰
목록·만료관리·사용량리포트 3개 탭이 이 함수 하나를 공유해 전부 동시 반영됨.

### ③ 쿠폰 "신규 배포" 중단/재개 기능 신설 (Migration #525)

**배경**: Stephen이 "자동발행 활성/비활성 토글"을 요청했으나, 조사 결과 `auto_issue_enabled`/
`auto_issue_schedule`을 실제로 읽어 발행을 집행하는 pg_cron·RPC·Vercel Cron이 프로젝트
어디에도 없음을 발견(설정만 저장되고 실행 엔진 자체가 없는 죽은 기능) — 그대로 토글을
만들면 관리자에게 "동작하는 척"하는 오해 유발 기능이 되므로, 구현 전 AskUserQuestion으로
방향 확인 후, 두 번째 질문으로 정확한 차단 범위(관리자의 '신규 배포' 액션만 차단 vs
장바구니·마이페이지 목록에서도 숨김)를 Stephen이 직접 선택(전자로 확정)했다.

**구현**:
- `coupons.distribution_enabled BOOLEAN NOT NULL DEFAULT true` 컬럼 신설
- `distribute_coupon` RPC(파라미터 개수 불변 — DROP 없이 REPLACE)에 `IF NOT
  v_coupon.distribution_enabled THEN RETURN 'DISTRIBUTION_PAUSED'` 체크 추가 — 관리자
  수동 배포(CMS "배포" 탭)와 `approve_pending_coupon_gift`(채팅 쿠폰선물 승인, 내부적으로
  distribute_coupon 호출)가 이 단일 지점을 공유해 두 경로 모두 자동으로 차단됨
- `cms_toggle_coupon_distribution(p_id)` 신규 RPC(is_cms_user 게이트 + anon REVOKE, 기존
  `cms_toggle_coupon`과 동일 권한 패턴) — 토글 전용
- `is_active`(쿠폰 자체 사용가능 여부)와는 완전히 별개 축 — 이미 배포받은 고객의 장바구니·
  마이페이지 쿠폰 목록 조회 로직 4곳(cart·account·account/profile·contract)은 이 컬럼을
  전혀 참조하지 않음(의도적, grep으로 재확인 완료)

**UI 반영**(Stephen 피드백 2회로 최종 형태 확정):
- 최초: CouponDetailPanel "현황" 섹션에 "신규 배포" 별도 행 추가
- 1차 피드백: 별도 행을 없애고 기존 "상태" 행 하나로 토글 통합, 텍스트도 "배포 활성"/
  "배포 중지"로 배포상태를 직접 표현하도록 변경
- 2차 피드백("선택영역에 상태값 동기화"): 목록 테이블의 기존 "상태" 컬럼(원래 is_active
  토글)도 동일하게 distribution_enabled 기준으로 전환 — 목록·상세 패널 양쪽이 이제 같은
  의미의 "상태"를 표시

**부수 발견·수정(재검증 중 발견)**:
- CouponDetailPanel "배포 실행" 폼이 `result.type==='success'`만 확인하고 실제 응답의
  `ok` 필드를 확인하지 않아, 배포가 서버에서 진짜로 막혔는데도(DB에 배포 기록 자체가 생성
  안 됨을 직접 확인) 화면엔 "배포되었습니다." 성공 토스트가 뜨던 기존 버그 발견·수정 —
  이번 기능의 차단이 실제로 작동하는지 신뢰성 있게 보여주는 데 필수적이라 같이 수정.
- 원문 에러코드 `DISTRIBUTION_PAUSED`가 그대로 노출되던 2개 지점(CMS 배포 액션 + 채팅
  쿠폰선물 승인 API)을 사람이 읽을 수 있는 한국어 안내문으로 치환.

**최종 재검증**(Stephen "완벽하게 재검증" 지시): DB 컬럼·양쪽 진입점(수동배포/쿠폰선물승인)
차단·권한(anon 제외)·성공/실패 양쪽 실제 동작(DB 배포기록 생성 여부까지 대조)·목록↔상세
패널 동기화·타 쿠폰과의 격리(cross-contamination 없음)·고객 화면 미참조 4곳 재확인까지
전부 실측 완료. svelte-check 전체 재실행 — 이번 작업 관련 신규 에러 0건(vite.config.ts의
기존 무관 에러 1건은 그대로 존재, 미수정).

### 상태

Stage(ezyvffjvuwmtuhpxdjrw)에 전부 적용·검증 완료. **Production(vnbpmvxruyciuuaermyh)
미반영** — Stephen "Production에 반영해!" 지시 대기(이 세션의 기존 패턴과 동일). git commit
미실행 — Stephen 직접 실행 대기.

수정/신규 파일(이 세션 한정):
```
supabase/migrations/20260923010000_525_coupon_distribution_pause.sql (신규)
src/lib/components/cms/CmsDatePicker.svelte
src/lib/components/cms/CouponDetailPanel.svelte
src/lib/types/database.ts
src/routes/cms/promotion/coupon/+page.server.ts
src/routes/cms/promotion/coupon/+page.svelte
src/routes/api/cms/chat/coupon-gift/[messageId]/approve/+server.ts
```

### GATE E — sp3-qa-agent 검수 완료 (2026-09-23)

**판정: 통과(CRITICAL 결함 없음)**, BOUNDARY 등급 2건 발견 — 그중 1건은 검수 직후 즉시 수정,
1건은 Stephen 확인 대기로 남김.

## NOW — [마스터플랜] 구독 "혜택관리" 4종 실적용 + 쿠폰 다중중첩 체크아웃 전환 (2026-09-23)

[CONTEXT BRIDGE]
plan_source: Plan Mode로 상세 설계·승인 완료. 전체 설계 원문은
`/Users/stevenmac/.claude/plans/ancient-pondering-salamander.md` 참고(6-Phase 구성).
배경: 구독 혜택관리 5종(할인쿠폰·무료배송·무료렌탈·보험면제·적립포인트)이 전수조사 결과
전부 CMS 표시용 문구로만 존재하고 실제 로직 미구현임을 확인(위 별도 검증 NOW 블록 참고).
Stephen 확정 범위: 보험료면제(INSURANCE_WAIVE)는 제외, 적립포인트는 적립+만료 둘 다 포함,
할인쿠폰은 프로모션 쿠폰과 완전한 다중 중첩 사용을 허용(장바구니 쿠폰 선택을 전체 시스템
차원에서 라디오→체크박스 다중선택으로 전환, 전체 고객·전체 쿠폰 종류에 영향을 주는
가장 리스크 큰 변경).

⚠️ **주의**: 이 TASK.md에 병행 기록된 다른(이전) NOW/DONE 블록에서 확인되듯, 쿠폰 시스템
(`CouponDetailPanel.svelte`, `distribute_coupon`, migration 525 `coupon_distribution_pause`
등)에 **다른/이전 세션이 최근 동시에 작업**한 흔적이 있음 — Phase 1 착수 전 그 변경사항과
충돌하지 않는지(특히 `distribution_enabled`·`is_active` 관련 필드) 직접 대조 확인 필수.

우선순위(6-Phase, 순서 고정 — Phase 1이 나머지의 선행조건):
  Phase 1(선행 필수) 쿠폰 다중중첩 체크아웃 구조 전환 → Phase 2 공용 월간사용량 추적 테이블
  → Phase 3 할인쿠폰 자동발급 → Phase 4 적립포인트 적립+만료 → Phase 5 무료배송 →
  Phase 6 무료렌탈(가장 마지막 — 공용 요금계산 RPC 직접 수정으로 회귀 리스크 최대)

TDD도메인 판정: 전 Phase가 결제(쿠폰·포인트)·예약(요금계산) 로직 변경 — AGENTS.md TDD 강제
키워드 해당. 전부 `@sp2-tdd-agents`에 위임(GSD 아님).

### 현재 착수 — Phase 1: 쿠폰 다중중첩 체크아웃 구조 전환

상세 설계는 plan 파일 "Phase 1" 섹션 그대로 적용:
- 신설 테이블 `order_coupons`(order_id, user_coupon_id, coupon_id, discount_amount,
  UNIQUE(order_id, user_coupon_id)) — RLS는 SELECT만 본인 것, 쓰기는 RPC 경유만.
- `use_coupon` 검증 로직을 내부함수로 추출(기존 시그니처·테스트 불변) + 신규
  `use_coupons(p_user_id, p_order_id, p_user_coupon_ids UUID[])`(id 오름차순 정렬 후 순차
  FOR UPDATE 잠금 → all-or-nothing 검증).
- `create_reservation_order`/`sync_order_after_composition_change`를 배열 파라미터로 확장 +
  할인 순차산식 반영(고정액 전부 차감 → 정률 순차적용 → 무료배송은 배송비에만 → 하한 0원).
- `cart/+page.svelte` 쿠폰선택 라디오 강제 해제(순수 다중토글) + `otCouponDiscount` 산식 교체
  + 제출 시 배열 전송.
- 마이그레이션 4개 분리 적용(Stage 우선): ①테이블+RLS ②use_coupons RPC ③create_reservation_
  order 배열화 ④정산 순차산식 — ④까지 Stage 검증 완료 후에만 앱코드 배포.

담당: `@sp2-tdd-agents`(RPC/마이그레이션 TDD) + 이어서 카트 UI 클라이언트 부분은
`@harness-executor`. Supabase 마이그레이션 적용(stage→production)은 이번 세션(메인)이
직접 수행(서브에이전트 Supabase MCP 미보유 원칙 유지).

1. **(수정 완료)** `codeDisplay()` sequenced 프리뷰의 순번 자릿수를 `max_sequence` 값의
   길이로 계산하던 부분 — 실채번 RPC(`generate_user_coupon_redeemed_code`, Migration #292)는
   `max_sequence`를 상한 체크에만 쓰고 패딩 자릿수는 항상 `seq_digits`만 사용
   (`LPAD(v_seq::TEXT, v_seq_digits, '0')`)한다는 점을 QA가 지적 — `max_sequence`가 3자리가
   아닌 코드조합(예: 50, 1500)에서 프리뷰와 실채번 결과가 어긋날 수 있던 결함이라 즉시
   `seq_digits ?? 3` 단순 사용으로 수정, 재검증 완료.
2. **(Stephen 확인 완료 — 2026-09-23, 현재 상태 그대로 확정)** 쿠폰 목록·상세패널의 "상태"
   토글을 `distribution_enabled` 전용으로 통합하면서, 기존 `is_active`(이미 배포된 쿠폰을
   전면 사용중지시키는 기능 — `use_coupon` RPC가 `is_active=false`면 이미 배포받은 고객도
   차단함)를 조작할 UI 수단이 완전히 사라졌다는 지적에 대해, Stephen이 "이미 배포된 쿠폰
   통째로 정지 기능은 필요 없다 — 그 경우 엄청난 CS가 발생할 것"이라는 이유로 현재 상태
   유지를 명시적으로 확정함. `toggleCoupon` 서버 액션·`cms_toggle_coupon` RPC는 의도적으로
   손대지 않은 고아 코드로 그대로 둔다(요청 없이 임의 삭제 금지 원칙 — 필요 시 별도 지시).

### ➕ 이 세션 추가 작업 — 발행관리 "배포" 탭에 사용 채번 목록 병합 (2026-09-23)

Stephen이 발행관리(manage 컨텍스트) 쿠폰 상세패널의 "배포" 탭을 launch-selected-element로
지정하며 "사용된 코드품번 적용(카운팅) 목록 정렬이 미구현"이라고 지적. 조사 결과 그 목록
자체(`사용 채번 목록`, `get_coupon_redemptions` RPC — 이미 `used_at DESC`로 정렬됨)는
2026-08-18에 이미 구현돼 있었으나, "사용량 리포트" 탭 컨텍스트(`context='report'`)에서만
단독 뷰로 노출되고 "발행 관리" 탭 컨텍스트(`context='manage'`)의 "배포" 탭에서는 접근할
방법이 아예 없었음(설계 당시 "정보 탭 중복 방지" 목적으로 의도적으로 분리했던 것 —
2026-08-18 기록 참고, 이번 지적으로 사용성 문제였음이 드러남).

**수정**: `CouponDetailPanel.svelte`에서 목록 렌더링 부분을 `{#snippet redemptionsList()}`로
추출해 report 컨텍스트 단독 탭과 manage 컨텍스트 "배포" 탭(배포 폼 바로 아래) 양쪽에서
`{@render}`로 공유. `selectTab()`이 'distribute' 선택 시에도 `loadRedemptions()`를
호출하도록 조건 추가(지연 로드 유지). 서버 쿼리·RPC는 무변경(이미 정렬돼 있었음).

**검증**: 실제 사용 이력이 있는 TEST-NORMAL 쿠폰으로 manage "배포" 탭에서 배포 폼 아래에
사용 채번 목록(2건, used_at DESC 정렬)이 정상 표시되는 것을 확인. report 컨텍스트 단독
탭도 회귀 없이 동일하게 정상 동작 확인(스냅샷 재사용이라 로직 변경 없음). svelte-check
신규 에러 0건.

**Stephen이 함께 제시한 재검증 항목 중 미해결 — 다음 응답에서 확인 필요**:
"① 발행 쿠폰의 배포 기준 — 조건 충족 사용자에게 기본 노출된 쿠폰을 사용자가 확인 즉시
배포로 간주"라는 서술은, 이번 세션에서 구축·검증한 배포 구조(관리자가 `distribute_coupon`
RPC를 명시적으로 실행해야만 `user_coupons` 행이 생성됨 — 자동 노출·확인시점 배포 전환
메커니즘 자체가 현재 코드에 없음)와 맞지 않아 그대로 "검증 완료"로 단정하지 않고 Stephen에게
재확인 요청함(다른 개념을 가리키는 것인지, 신규로 만들어야 할 기능인지 불명확).

### ➕ 이 세션 추가 작업 — 쿠폰 "자동배포" 엔진 신설(Migration #527, CRITICAL) + 수동배포 UI 재설계

Stephen이 위 "① 발행 쿠폰의 배포 기준" 재확인 요청에 "자동 노출 개념이 맞다, 신규 기능으로
만들어달라"고 답하며 launch-selected-element로 3가지 구체 지시를 추가 제시:
1. "상태" 행 토글이 "자동배포" 기능으로 대체되어야 함
2. "배포 대상"(전체회원/특정등급/특정사용자UUID) 라디오 + "배포 실행" 버튼은 "정보" 탭의
   "필수 회원 등급(선택)"과 중복이므로 제거
3. (② 확인용) "특정 등급" 배포와 "필수 회원 등급"이 동일 기능인지 재확인

CRITICAL 등급(자동으로 다수 회원에게 쿠폰을 뿌리는 새 백그라운드 엔진, 잘못 설계하면 대량
오배포 사고 위험)이라 구현 전 AskUserQuestion 2회로 핵심 설계를 확정:
- **자동배포 방식**: "계속 감시"(추천, 확정) — 토글 ON인 동안 새로 가입하거나 등급이
  바뀌어 조건을 충족하게 된 회원에게도 계속 자동 지급(1회성 스냅샷이 아님) → pg_cron
  주기 실행 방식으로 구현.
- **"특정 사용자 UUID" 수동 지급**: "유지 필요"(확정) — 채팅과 무관하게 관리자가 특정
  고객 1명에게 예외적으로 지급하는 용도라 자동배포와 완전히 별개 경로로 존속.

**구현(Migration #527)**:
- `coupons.distribution_enabled` 컬럼을 `auto_distribute_enabled`로 RENAME(의미가 완전히
  바뀌므로 이름도 재정의 — 아직 Production 미반영·미커밋 상태라 안전하게 이름 변경 가능)
- `distribute_coupon` RPC — Migration #525에서 추가했던 DISTRIBUTION_PAUSED 차단 체크
  제거(특정 사용자 수동 지급은 자동배포 토글과 무관하게 항상 가능해야 하므로)
- `cms_toggle_coupon_distribution` DROP → `cms_toggle_coupon_auto_distribute(p_id)` 신설
  (동일 권한 패턴 — is_cms_user 게이트, anon REVOKE)
- **`auto_distribute_eligible_coupons()` 신규 — 엔진 본체**: `auto_distribute_enabled=true`
  AND `is_active=true` AND `deleted_at IS NULL`인 쿠폰마다, `user_grade_required`(필수
  회원 등급, NULL=전체) 조건을 충족하는 `user_profiles`를 대상으로
  `INSERT ... ON CONFLICT DO NOTHING`(기존 distribute_coupon과 동일 패턴) — 이미 받은
  사람은 건드리지 않고 새로 조건을 충족한 사람만 매번 추가로 잡힘. `coupon_distributions`
  에는 기록하지 않음(그 테이블 `admin_id`가 NOT NULL FK라 시스템 기동을 귀속시킬 사람이
  없음 — 실제 지급 결과는 `user_coupons`에 정확히 남으므로 기능상 문제 없음, "배포 이력"
  아코디언에는 자동배포 건이 안 보인다는 제약만 있음).
- pg_cron 등록: `auto-distribute-eligible-coupons`, `*/30 * * * *`(30분 간격 — 다른 잡들
  1분~3시간 스펙트럼 대비 쿠폰 자동배포는 시간 민감도가 낮아 중간값 선택).

**UI 재설계**:
- CouponDetailPanel "상태" 행: "배포 활성/배포 중지" → "자동배포 활성/자동배포 중지"로
  문구 변경, 액션 `?/toggleDistribution` → `?/toggleAutoDistribute`
- "배포" 탭: "배포 대상" 라디오(전체회원/특정등급) + "배포 실행" 버튼 완전 제거. 섹션을
  "특정 사용자 수동 지급"으로 재정의(이메일/UUID 줄바꿈 입력만 남김, target_type은
  hidden input으로 'specific_user' 고정) + 왜 이 기능만 남았는지 설명하는 안내문 추가.
  기존 "사용 채번 목록"(직전 작업에서 병합)은 그대로 유지.
- 목록 테이블 "상태" 컬럼도 동일하게 `auto_distribute_enabled` 기준 + `toggleAutoDistribute`
  액션으로 통일(상세패널과 계속 동기화 유지).
- `distributeCoupon` 액션의 DISTRIBUTION_PAUSED 친화 메시지 매핑 제거(더 이상 반환될 수
  없는 에러코드라 삭제) — `coupon-gift/[messageId]/approve/+server.ts`의 동일 매핑도 함께 제거.

**검증(Stage, 실측 완료)**:
- 컬럼 rename·함수 rename(구 함수 DROP 확인)·GRANT(anon 제외) 전부 라이브 재확인
- `auto_distribute_eligible_coupons()` 실행 → 대상 6개 쿠폰 전부 처리, 미보유 회원에게만
  신규 배포(총 2540건) → 즉시 재실행 시 `total_issued:0`으로 멱등성 확인(중복 지급 없음)
- 토글 OFF인 쿠폰은 엔진이 건너뛰는 것 확인(`coupons_processed` 6→5로 정확히 감소)
- 자동배포 OFF 상태에서도 "특정 사용자 수동 지급"이 정상 성공하는 것을 실제 CMS 세션으로
  확인(구 DISTRIBUTION_PAUSED 차단이 완전히 풀렸음을 실증)
- 상세패널·목록 토글 UI 문구·동기화 전부 실제 화면으로 재확인, svelte-check 신규 에러 0건

**상태**: Stage 전부 적용·검증 완료. Production 미반영, git commit 미실행(Stephen 대기,
기존 패턴과 동일). Migration #525(구 로직)와 #527(재설계)이 순서대로 함께 커밋·배포되어야
최종 스키마가 일치함 — 둘 중 하나만 적용하면 안 됨.

### ➕ 이 세션 추가 작업 — "필수 회원 등급" BASIC/PRO 하드코딩 결함 발견·수정(정책 오해 교정)

Stephen이 "전체 회원에 정기구독 회원 포함 여부"를 질문해 확인하던 중, 이 드롭다운의
선택지(BASIC/PRO/CRAZY)가 `user_profiles.membership_grade`의 실제 CHECK 제약(NONE/EASY/
POP/CRAZY)과 다르다는 것을 라이브 DB 조회로 발견 — BASIC·PRO는 애초에 존재할 수 없는 값이라
관리자가 그걸 선택하면 자동배포가 영원히 0명에게 나가는 조용한 결함이었다(직전 작업에서
신설한 auto_distribute_eligible_coupons 엔진의 핵심 조건이라 파급력이 큼).

Stephen이 후속으로 정책 자체를 정정: **"회원 등급" 개념 자체가 이 서비스에 없다**(추후
구매 이력 누적 기준으로 별도 도입 예정 — 지금 이 기능과는 무관). 실제로 membership_grade에
들어가는 값은 **정기구독 플랜 3종**(subscription_plans 테이블: Easy pack=EASY, Pop
pack=POP, Crazy pack=CRAZY — DB 조회로 확인)뿐이며, 이는 "등급(계층)"이 아니라 "구독
그룹(분류)" 개념이다. "연관 로직에도 같은 구조가 있으면 고치라"는 지시에 따라 전수 검색
(`grep 'BASIC'|'PRO'`)으로 영향 범위를 확정 — CouponDetailPanel.svelte·coupon/new/+page.svelte
단 2개 파일, 총 3곳(수정 폼 드롭다운, 생성 폼 SuggestPicker, 생성 폼 내 죽은 자동발행
"배포 대상·특정등급" 드롭다운)이 전부였다.

**수정**: 하드코딩 대신 `subscription_plans`(status='active', category='membership')을
그대로 소스로 사용하도록 전환(coupon/+page.server.ts·coupon/new/+page.server.ts에 동일
쿼리 추가, "적용 카테고리" 드롭다운이 code_mapping_groups를 쓰는 것과 동일 원칙 — 향후
플랜이 추가·변경돼도 저절로 맞게 유지됨). 라벨 텍스트도 "필수 회원 등급" → "필수 구독
그룹"으로 교정(사용자에게 보이는 안내문 1곳 포함)해 "등급" 표현으로 인한 오해 재발 방지.

**검증**: 두 화면(수정 패널·생성 폼) 전부 실제 브라우저에서 드롭다운을 열어 "전체 회원 /
Easy pack (EASY) / Pop pack (POP) / Crazy pack (CRAZY)"로 정확히 나오는 것을 확인,
svelte-check 신규 에러 0건(기존 lint 패턴과 동일한 경고 1건만 추가, 이 파일에 이미
광범위한 기존 관례).

**상태**: Stage 반영 완료(DB 스키마 변경 없음 — 순수 앱 코드 수정이라 Production 배포는
git merge만으로 충분, 별도 마이그레이션 적용 불필요). git commit 미실행(Stephen 대기).

### ➕ 이 세션 추가 작업 — 위 수정도 오답이었음 발견·재교정(Migration #528, 3차 수정)

Stephen이 직전 수정 결과 화면(구독 티어 SuggestPicker)과 `/cms/customers` 상세패널의
"분류: 일반" 배지를 나란히 지정하며 "이 드롭다운 값이 하드코딩이 아니라 고객 화면의
회원 분류 DB값 반영 로직과 정합해야 한다"고 지적. 조사 결과 `CustomerDetailPanel.svelte`
(2026-09-01 재구성, 주석 인용): "easy/pop/crazy(membership_grade)는 고객등급이 아니라
정기구독 상품 티어이므로, 실제 고객 분류는 인증 상태 기준 3종으로 별도 정의한다" —
즉 직전 수정(subscription_plans 구독 티어 기준)도 틀렸었다. 진짜 기준은
`classificationsOf()`가 정의한 일반(general)/학생(student)/구독(subscriber) 3태그
(is_student · membership_grade!='NONE' 조합, 학생이면서 동시에 구독자일 수 있어 복수
태그 허용)이며 `/cms/customers` 목록·상세 양쪽이 이미 이 로직을 공유하고 있었다.

**수정(Migration #528)**:
- `auto_distribute_eligible_coupons()` 매칭 로직을 membership_grade 단순 동등비교에서
  일반/학생/구독 3분기 조건으로 교정(REPLACE, 컬럼명 user_grade_required는 그대로 유지 —
  세 번째 재정의라 rename 대신 COMMENT ON COLUMN으로 정확한 의미만 문서화)
- `distribute_coupon`의 'grade' 분기(현재 UI에서 호출 경로 없는 죽은 코드이나 방치 시
  향후 재사용 함정)도 동일 기준으로 함께 교정
- `coupon/+page.server.ts`·`coupon/new/+page.server.ts`: subscription_plans 동적 쿼리를
  제거하고 `/cms/customers`와 동일한 고정 3값(general/일반, student/학생, subscriber/구독)
  으로 교체(이 분류는 DB enum 드리프트 위험이 있는 값이 아니라 앱 로직이 이미 하드코딩한
  안정적 고정 태그라 동적 로드 불필요 — CustomerDetailPanel.svelte의 CLASSIFICATION_LABEL과
  동일 상수를 재사용)
- 라벨 "필수 구독 그룹" → "필수 회원 분류"로 재교정(사용자 노출 안내문 포함 전체 반영)

**검증**: 두 화면 드롭다운이 "전체 회원/일반/학생/구독"으로 정확히 뜨는 것을 브라우저로
재확인. 매칭 로직 자체도 실측 — 테스트 쿠폰 1개를 `user_grade_required='student'`로
설정, 특정 테스트 계정 1명만 `is_student=true`로 표시한 뒤 엔진 실행 → **그 계정
1명에게만** 정확히 배포되고 나머지 미보유 계정(약 45명)은 배포 안 됨을 직접 확인(분기별
격리 검증 완료) → 테스트 후 원상복구. svelte-check 신규 에러 0건.

**상태**: Stage 전부 적용·검증 완료. Production 미반영, git commit 미실행(Stephen 대기).
Migration #525→#527→#528이 순서대로 함께 커밋·배포되어야 함(중간 단계 건너뛰면 안 됨).

---

## DONE — Phase 1: 쿠폰 다중중첩 체크아웃 구조 전환 (2026-09-23)

[마스터플랜 "구독 '혜택관리' 4종 실적용 + 쿠폰 다중중첩 체크아웃 전환"(같은 날 상단 NOW 블록,
plan 파일 `ancient-pondering-salamander.md`) Phase 1/6 — 완료]

### 구현 내역
- 신규 마이그레이션 4개(Stage·Production 둘 다 적용 완료):
  - #531 `order_coupons` 다대다 연결 테이블(RLS: 본인조회 + `is_cms_user()` 관리자전체 —
    서브에이전트 초안이 `is_admin()`(레거시 고객등급 개념, products.md §2-8에서 이미 CMS
    권한과 무관하다고 확정된 함수)을 잘못 참조한 것을 메인 세션이 적용 전 직접 발견·수정)
  - #532 `use_coupon` 검증+소진 로직을 `private._validate_and_consume_coupon`(신규 `private`
    스키마, PUBLIC/anon/authenticated 접근 차단)으로 추출 + 신규 `use_coupons(p_user_id,
    p_order_id, p_user_coupon_ids[])`(오름차순 정렬 후 순차 잠금, all-or-nothing 롤백)
  - #533 `create_reservation_order`에 `p_selected_coupon_ids UUID[]` 6번째 파라미터 추가
    (products.md §2-3 PGRST203 교훈대로 구 5-param 오버로드는 DROP)
  - #534 `sync_order_after_composition_change`(주문 정산 정본, 3곳 공유)를 `order_coupons`
    기준 다중쿠폰 순차산식(fixed 합산→percentage 순차적용→free_shipping 배송비캡)으로 전환 +
    레거시 단일쿠폰 주문 하위호환 폴백 포함
- 클라이언트: `cart/+page.svelte` 쿠폰 선택 라디오→다중체크박스 전환 + 순차 할인산식 적용,
  `contract/[token]/+page.svelte`·`+page.server.ts`(전자계약 결제 페이지)도 동일하게 다중쿠폰
  대응(단, 이 페이지 자체 UI는 2026-09-07 Stephen 확정에 따라 읽기전용 유지 — 체크박스
  피커 신규 추가 안 함), `pay-mock`/`pay-result`/`confirm-mock` 결제확정 3곳 전부
  `use_coupons` 배열 호출로 교체 + 공용 헬퍼 `src/lib/server/coupons/consumeCoupons.ts` 신설
- 부가 발견·수정: CMS 계약서 미리보기(`/api/cms/reservations/[id]/contract-data`)의 쿠폰
  할인액 표시가 옛 `selected_coupon_id` 존재 여부로 가드돼 있어 다중쿠폰 주문에서 항상
  "할인 없음"으로 잘못 표시되던 결함을 메인 세션이 직접 발견·수정(`coupon_discount_amount
  > 0` 기준으로 교체)

### 검증
- TDD RED→GREEN 확인: `couponMultiStacking.test.ts` 5개 시나리오(fixed 2장 합산·fixed+
  percentage 혼합·percentage 2장 순차감쇠·부적격 1건 시 all-or-nothing 롤백·free_shipping
  배송비 캡) 마이그레이션 적용 전 5/5 RED → 적용 후 5/5 GREEN
- 회귀 확인: `couponEligibilityValidation`·`couponLazySequencing`·`confirmMock`·
  `reservationApprovalNotify`·`tossPaymentGroupRpc` 등 관련 스위트 67/67 GREEN(2회 반복
  실행으로 안정성 재확인)
- 테스트 자체 결함 1건 발견·수정: `couponMultiStacking.test.ts`의 `afterEach` cleanup이
  FK 의존순서(order_coupons→user_coupons→order_items→orders)를 지키지 않아 실패 시 잔여
  테스트 데이터가 남아 다음 실행이 날짜충돌로 연쇄 실패하던 문제 — 메인 세션이 순서 교정
- `syncOrderAfterCompositionChange.test.ts` EC-2 실패 1건은 `cms_remove_reservation_product_
  unit`이 sync 함수를 아예 호출하지 않는 기존 별개 결함(테스트 파일 자체에 이미 "🔴 RED"로
  주석 표기된 기지 이슈, 이번 Phase가 건드린 함수가 아님) — 무관함을 확인하고 그대로 둠
- `npx svelte-check`: 신규 에러 0건(기존 vite.config.ts 1건만 잔존)
- Stage 4개 전부 적용 후 Production 적용 — 3개(531~533)까지는 자동승인, 4번째(534)는
  "Production Deploy" 자동분류기가 차단해 Stephen에게 직접 승인 요청 후 적용 완료. 적용 후
  `pg_proc`/`to_regclass` 직접 조회로 stage와 동일한 함수·테이블 상태(6-param
  `create_reservation_order`, `private._validate_and_consume_coupon`, `order_coupons` 등)를
  production에서 재확인함

### 잔여 참고사항
- `orders.selected_coupon_id` 컬럼은 하위호환을 위해 삭제하지 않고 유지(레거시 단일쿠폰
  주문 폴백 경로가 계속 참조) — 완전 제거는 이번 스코프 밖, 필요 시 후속 세션에서 검토
- git commit/push는 이번 세션에서 실행하지 않음(다른 세션 통합 커밋 예정) — 위 다른 병행
  세션 작업(Migration #525~528 쿠폰 배포/자동엔진)과 파일 충돌 없음을 착수 전 확인함

### 다음 조치 (갱신) — Phase 1 코드 되돌림, QA 스킵하고 Phase 2로 진행
Stephen이 직전 커밋(`31910f5`)을 배포 직후 직접 `git revert`로 되돌림(코드 14개 파일 원상복구,
`903bbba`, stage 푸시 완료 — Vercel 프리뷰 재배포 READY 확인). **DB 마이그레이션(531~534)은
Stephen 명시적 선택("코드만 되돌림")에 따라 stage·production 양쪽에 그대로 유지** —
하위호환 설계라 현재 배포된(되돌려진) 앱 코드는 이 신규 테이블/함수를 전혀 참조하지 않으므로
안전한 비활성 상태. 이에 따라 Phase 1 sp3-qa-agent 검수는 보류(코드가 라이브에 없어 검수
실익 낮음) — Phase 1 코드를 나중에 재작업할 때 이 DB 백엔드를 그대로 재사용하면 됨.
Stephen 지시로 Phase 2(공용 월간 혜택사용량 추적 테이블)로 바로 진행.

---

## DONE — Phase 2: 공용 인프라 — 혜택 월간 사용횟수 추적 테이블 (2026-09-23)

[마스터플랜 Phase 2/6 — 완료]

- 신규 마이그레이션 `#536_subscription_benefit_usage_table`(Stage·Production 둘 다 적용
  완료) — `subscription_benefit_usage(id, user_subscription_id, benefit_type CHECK IN
  (DISCOUNT_COUPON/FREE_SHIPPING/FREE_RENTAL), ref_id, used_month, created_at)` +
  `(user_subscription_id, benefit_type, used_month)` 복합 인덱스.
- RLS 활성화 + 정책 0개 = anon/authenticated 접근 전면 차단, service_role(SECURITY DEFINER
  RPC)만 접근 가능 — Migration 223 설계 당시 유보됐던 "혜택 소진 추적 테이블 없음(YAGNI)"
  공백을 채움.
- `ref_id`는 혜택 종류마다 대상 테이블이 다른(쿠폰 UUID vs 주문/예약 BIGINT) 다형 참조라
  FK 제약 없이 순수 참조값으로만 저장 — 해석은 benefit_type과 조합해 애플리케이션(다음
  Phase 3/5/6) 레벨에서 수행.
- 이 테이블은 아직 어떤 앱 코드에서도 소비하지 않음(Phase 3/5/6에서 실사용 예정) — 신규
  테이블 추가만이라 기존 로직 영향 없이 안전하게 선배포됨. `to_regclass`로 stage·production
  양쪽 존재 직접 재확인.

### 다음 조치
Phase 3(할인쿠폰 DISCOUNT_COUPON 자동발급) 착수 대기 — 단, Phase 3는 원래 계획상 Phase 1
(다중쿠폰 체크아웃)이 라이브 코드로 존재함을 전제로 설계됐으나, 현재 Phase 1 코드는
되돌려진 상태(DB 백엔드만 존재)다. Phase 3 착수 시 이 전제 차이를 Stephen과 먼저 확인
필요 — "발급된 구독쿠폰이 프로모션 쿠폰과 동시 중첩 사용"이라는 요구사항은 Phase 1 코드가
다시 배포돼야 실현되므로, Phase 3(발급 로직)만 먼저 만들고 Phase 1 코드 재배포는 나중에
별도로 할지, Phase 1 코드부터 재작업할지 판단이 필요함.

---

## DONE — 쿠폰 자동배포 대상 분류(필수 회원 분류) SuggestPicker 전환 + 실사용 UI 종단 검증 (2026-09-23)

[별개 병행 세션 — 위 Phase 1/2(다중쿠폰 체크아웃) 세션과 무관, Migration #525/527/528
자동배포 엔진 후속 마무리]

### 배경
직전 작업(Migration #528, 등급→분류 3단계 재설계)에서 "필수 회원 등급" 드롭다운을 실제
분류 체계(`CustomerDetailPanel.classificationsOf()`의 일반/학생/구독)로 교체했으나, 값
선택 UI가 `coupon/new`(신규 발행 화면)는 SuggestPicker인 반면 `CouponDetailPanel`(발행관리
상세)은 plain `<select>`로 남아 스타일이 불일치했음(Stephen 지적, "SuggestPicker 스타일
반영해").

### 이번 세션 작업
- `CouponDetailPanel.svelte`의 `<select id="uc-grade">` → `SuggestPicker` 컴포넌트로 전환
  (`coupon/new`의 `fc-grade`와 동일 패턴). 값 브리지용 `_sel_grade` state 신설(`'__all__'`
  = 전체회원, 나머지는 분류값 그대로) + `<input type="hidden" name="user_grade_required">`
  병행.
- **실사용 UI 종단 검증** (Stephen: "선택영역 선택 분류대로 배포 로직 확인해.") — SQL
  시뮬레이션이 아니라 실제 브라우저에서 SuggestPicker로 "학생" 선택 → "정보 저장" 클릭 →
  실제 서버 액션(`?/updateCoupon`) 실행까지 전 과정 확인:
  1. 테스트 쿠폰(TEST-EXHAUSTED)에 대상 테스트 유저 1명만 `is_student=true`로 준비,
     기존 `user_coupons` 행 삭제해 "미보유" 상태로 초기화
  2. 실 브라우저 UI에서 SuggestPicker "학생" 선택 → "정보 저장" 클릭 →
     DB 직접 조회로 `coupons.user_grade_required = 'student'` 저장 확인
  3. `SELECT public.auto_distribute_eligible_coupons();` 수동 실행(cron 1틱 시뮬레이션)
     → `total_issued:1` 반환, 실제로 준비해둔 테스트 유저 1명에게만 `user_coupons` 신규
     지급 확인(다른 553명 미대상 확인)
  4. 재실행 시 `total_issued:0`(멱등성 확인 — 중복 지급 없음)
  5. 테스트 데이터 전부 원복(신규 지급 행 삭제, `is_student=false`, `user_grade_required=NULL`)
- 결론: SuggestPicker에서 고른 분류값이 DB에 정확히 저장되고, 자동배포 엔진이 그 값을
  읽어 정확히 해당 분류(±student flag) 사용자에게만 배포함을 실사용 흐름으로 확정 검증.

### 추가 UI 정리 (Stephen 스크린샷 지시 2건, 같은 세션)
- "필수 회원 분류" SuggestPicker와 바로 아래 "제한 기간/무제한/첫 확인일로부터 N일" 라디오
  그룹 사이가 붙어 있어 기능 구분이 안 된다는 지적 → `.radio-group`에 `margin-top: 30px`
  추가로 시각적 분리(`CouponDetailPanel.svelte` 스타일 블록).
- "관리자 메모(고객에게 노출되지 않음)" 입력란이 "정보" 탭 상단부(사용조건 섹션 바로 위)에
  있던 것을 "가장 마지막에 선택할 옵션"이라는 지시에 따라 "정보 저장" 버튼 바로 위로 재배치
  (폼 마크업 순서만 이동, 필드명·바인딩·서버 액션 무변경).

### 변경 파일
- `src/lib/components/cms/CouponDetailPanel.svelte` (SuggestPicker 전환 + 여백 + 필드 재배치)

### 잔여 참고사항
- git commit/push는 이번 세션에서 실행하지 않음(Stephen 직접 실행 대기)
- Production 미반영 — Migration #525/527/528 및 이번 UI 변경 전부 Stage에서만 검증 완료,
  Stephen 승인 후 별도 배포 필요

### 추가 UI 그룹핑 (같은 세션, Stephen 스크린샷 지시 후속)
- 위 여백/재배치 작업 후, "제한 기간/무제한/N일 + 시작일/종료일" 묶음에 적용한 테두리 박스
  스타일(`.validity-group`)을 "핵심 정보 수정"(쿠폰이름·할인방식·할인값·발급한도·필수 회원
  분류) 영역에도 동일하게 적용 — 같은 클래스 재사용으로 두 영역이 동일한 레이아웃(테두리
  박스)으로 통일됨. 별도 신규 클래스 없이 기존 `.validity-group` 그대로 재사용.

---

## DONE — Phase 3: 할인쿠폰(DISCOUNT_COUPON) 자동발급 (2026-09-23) — Stage 검증까지만, 배포 보류

[마스터플랜 Phase 3/6 — Stephen 지시: "3단계(발급 로직)만 먼저 개발해. 모두 개발완료 후
배포할 것." → 이번 라운드는 개발+**stage 검증까지만** 완료, **production 마이그레이션 적용과
git commit/push는 의도적으로 보류** — 나머지 단계까지 마저 개발한 뒤 한 번에 배포 예정]

### 구현 내역
- 신규 마이그레이션 `#537_issue_subscription_benefit_coupon`(**stage만 적용, production
  미적용**) — `issue_subscription_benefit_coupon(p_user_subscription_id BIGINT) RETURNS
  JSONB` RPC 신설: `user_subscriptions`→`plan_id` 조회 → `tier_benefits`(DISCOUNT_COUPON,
  is_enabled) 확인 → `subscription_benefit_usage`(Phase 2, Migration 536)로 이번 달
  발행횟수(`coupon_frequency`) 한도 확인 → 한도 내면 신규 `coupons` row(type='subscription',
  discount_type='fixed', 발급 즉시 1인 전용) 생성 + `user_coupons` 발급 + 사용기록 남김.
  서비스롤 전용 가드(REVOKE ALL FROM PUBLIC/anon/authenticated, GRANT TO service_role만).
- `chargeSubscription.ts`(최초가입 결제 `/subscribe/success` + 정기청구 크론 공유 진입점)
  성공 분기에서 fail-soft로 위 RPC 호출 — 시그니처 무변경, 호출부 2곳 전부 무수정으로 자동
  적용됨.
- 메인 세션 독립 재검증에서 서브에이전트 초안의 사실오류 2건 발견·수정:
  ① `coupons.code_mode='manual'`은 `coupons_code_mode_chk` 제약상 `code NOT NULL` 필수 —
     서브에이전트가 이미 정확히 채번 로직(`v_code`)으로 반영했음을 직접 제약조건 조회로 재확인
  ② 서브에이전트 주석이 "user_coupons에 issued_at 컬럼이 없다"고 잘못 서술 — 직접 스키마
     조회 결과 issued_at은 실제로 존재(nullable, DEFAULT now())함을 확인, 동작 자체는
     무해했으나(둘 다 DEFAULT now()) 마이그레이션 파일 주석을 정정해 향후 세션이 잘못된
     전제를 참고하지 않도록 수정
  ③ `user_subscriptions.plan_id`/`tier_benefits.plan_id` 타입(둘 다 BIGINT) 직접 대조 확인

### 검증
- TDD RED(마이그레이션 적용 전, PGRST202 함수없음)→ stage 적용 후 GREEN 전환:
  `subscriptionBenefitCouponIssuance.test.ts` 6/6 GREEN(정상발급·필드정합성·혜택비활성/
  없음·월한도초과·잘못된금액·구독없음)
- 회귀 확인: `subscriptionBillingCron.test.ts`·`subscriptionBilling.test.ts` 포함 24/24 GREEN
- `npx svelte-check`: 신규 에러 0건(기존 vite.config.ts 1건만 잔존)

### 다음 조치
Phase 4(적립포인트 적립+만료) 이어서 개발 예정. **Stephen이 "모두 개발완료 후 배포"를
명시했으므로, 남은 Phase 4·5·6까지 개발 완료할 때까지 이번 Phase 3을 포함해 production
마이그레이션 적용·git commit/push 전부 보류** — 배포는 전 단계 개발 완료 후 Stephen 지시
시 일괄 진행.

### 추가 UI 그룹핑 2차 (같은 세션, Stephen 스크린샷 지시 재후속)
- "사용 조건"(최소 구매금액·최소 대여금액·최소 대여기간·1인당 사용 횟수) `form-grid`에도
  동일한 `.validity-group` 테두리 박스 스타일 적용 — "정보" 탭 내 3개 섹션(핵심 정보 수정 /
  제한 기간+시작·종료일 / 사용 조건)이 전부 동일 레이아웃으로 통일됨. `section-title`
  라벨은 기존 패턴대로 박스 바깥에 유지(핵심 정보 수정 섹션과 동일 구조).

### 그룹핑 보정 (같은 세션, Stephen 지적 — 타이틀 분리 문제)
- "사용 조건" 타이틀이 박스(`.validity-group`) 바깥에 남아 있어 박스와 30px 간격으로
  떨어져 보이는 문제 지적("두 선택영역이 하나로 붙여야해") — `section-title`을 박스
  바깥에서 안쪽 첫 자식으로 이동해 타이틀+입력필드가 하나의 테두리 박스 안에서 붙어
  보이도록 수정. "핵심 정보 수정" 타이틀은 폼 진입 전(`<form>` 태그 밖)이라 이 문제와
  무관 — 그대로 유지.

### 그룹핑 보정 2차 (같은 세션, Stephen 재지적 — "핵심 정보 수정" 타이틀도 동일 문제)
- "사용 조건"과 동일한 문제가 "핵심 정보 수정" 타이틀에도 있었음(제목이 `<form>` 태그
  바깥에 있어 박스와 분리돼 보임) — 제목을 `<form>` 안으로, `.validity-group` 박스의
  첫 자식으로 이동해 제목+입력필드가 하나의 박스로 붙어 보이도록 수정. 이제 "정보" 탭
  3개 섹션 전부(핵심 정보 수정 / 제한 기간+날짜 / 사용 조건) 제목이 박스 안에 포함된
  동일 패턴으로 통일됨.

### 그룹핑 확장 3차 (같은 세션) — "전용 조건" · "결합 옵션"
- 위 두 섹션의 타이틀+태그버튼(s-chip-group)+연동 hidden input을 각각 별도의
  `.validity-group` 박스로 그룹핑(전용 조건 1개 박스, 결합 옵션 1개 박스로 분리 — 서로
  다른 의미 단위라 하나로 합치지 않음). "정보" 탭 전 섹션이 동일한 테두리 박스 레이아웃
  패턴으로 통일됨.

### 여백 정리 4차 (같은 세션) — 결합옵션 박스 / 관리자 메모 / 정보 저장 버튼 3단 간격
- "결합 옵션" 박스 → "관리자 메모" 입력란 → "정보 저장" 버튼 사이가 붙어 보이던 것을
  각각 30px 이상 여백으로 분리. `.admin-memo-field`(관리자 메모 wrapper 전용 클래스)와
  `.panel-actions-spaced`(정보 탭의 panel-actions만 — 배포 탭의 별도 panel-actions는
  영향 없도록 클래스 분리)에 각 `margin-top: 30px` 추가.

### "정보 저장" 버튼 변경사항 유무 연동(isDirty) 추가 (같은 세션, Stephen 지시)
- "저장할 변경 내용 미감지 시 비활성, 감지 시 활성" 요청에 따라 `products.md §4 isDirty`
  패턴과 동일 원리로 구현. `origInfo`($derived) — coupon prop의 원본값 스냅샷 22개 필드
  + `isDirtyInfo`($derived) — 현재 편집 상태(u_*) 전부를 원본과 비교(배열 필드
  `applicable_categories`는 정렬 후 JSON 직렬화로 비교). "정보 저장" 버튼
  `disabled={updateLoading || !isDirtyInfo}`로 변경(기존 `disabled={updateLoading}`만
  있던 것에 추가).
- 실 브라우저에서 검증: (1) 최초 진입 시 비활성 확인 (2) 필드 값 변경 시 즉시 활성 전환
  확인 (3) 원본값으로 되돌리면 다시 비활성 전환 확인(단순 "손댐" 플래그가 아니라 실제
  원본 대비 차이를 매번 재계산하는 diff 방식임을 확인).
- "배포" 탭의 "지급 실행" 버튼(distTargetMeta 기반)은 이번 변경과 무관, 그대로 유지.

### CMS 표준 디자인 시스템 지침 대조 — "정보 저장" 버튼 로컬 CSS 결함 발견·수정 (같은 세션)
- Stephen 지적("저장 버튼 UI가 cms bds 위반해 보임")으로 `cms-uiux.md §7-3 ①`
  (ctaPrimary — height 44px / padding 0 30px / border-radius var(--radius-md) 15px)와
  `CouponDetailPanel.svelte`의 로컬 `.btn-primary` CSS를 직접 대조.
- 확인 결과: 화면에 실제 렌더링되는 값(44px·15px 라운드)은 `app.css`의 전역 규칙
  `.cms-shell .btn-primary`가 우선 적용돼 지침과 일치하고 있었으나, 이 컴포넌트 자체의
  로컬 `.btn-primary` 정의는 지침과 다른 값(height 36px, padding 8px 16px,
  border-radius var(--radius-sm) 8px)으로 작성돼 있어 — 현재는 전역 규칙에 가려져
  우연히 문제없이 보이지만, 향후 전역 규칙 순서·특이도가 바뀌면 즉시 지침 위반 값이
  그대로 노출될 수 있는 잠재적 결함이었음.
- 로컬 CSS를 지침 값 그대로 정정(height:44px, padding:0 30px,
  border-radius:var(--radius-md), letter-spacing:-0.5px, box-shadow:none 등 §7-3 ①
  전체 스펙 반영). 같은 클래스를 공유하는 "배포" 탭의 "지급 실행" 버튼도 함께 정정됨.
  실 화면 스크린샷으로 변경 전/후 시각적 회귀 없음 확인.

### "정보 저장" 버튼 → CMS 표준 인라인 저장 버튼 UI로 전면 전환 + 전체 CMS 화면 결함 검색 (같은 세션)
- Stephen이 ProductDetailPanel/SubscriptionDetailPanel 등에서 쓰는 `.btn-save-inline`
  (작은 알약형, 섹션 제목 옆, 미변경 시 회색 비활성/변경 시 보라색)을 "현재 cms 저장
  버튼 표준 UI"로 명시하고, 다른 `.btn-primary` 사용 CMS 화면 전체에 같은 결함이
  있는지 검색 요청.
- 전체 검색 결과(`.btn-primary` 쓰는 CMS 화면 18개 파일 전수 확인):
  - **동일 결함 확인**: `CouponDetailPanel.svelte`(정보 저장), `CustomerDetailPanel.svelte`
    (변경사항 저장) — 둘 다 "여러 필드를 묶어 저장하는 탭"인데 큰 CTA 버튼을 하단에
    배치한 케이스.
  - **무관(단일 실행 액션, 비교 대상 아님)**: `InquiryReplyForm`(답변 저장) ·
    `CannedResponsePanel`(등록/저장, 단일 모달 폼) · `RentalDetailPanel`(승인하기, 상태
    전이 액션) · `CustomerDetailPanel`의 "스코어 조정"·"포인트 추가"(별도 단일 액션) —
    전부 필드묶음 저장이 아닌 1회성 실행 버튼이라 인라인 저장 표준과 무관.
  - Stephen 확인 후 **CouponDetailPanel만 전환**(CustomerDetailPanel은 이번 세션
    스코프 밖으로 보류).
- 전환 내용: "정보" 탭 최상단에 `.section-header`(제목 "핵심 정보 수정" + 인라인
  저장 버튼) 신설, `<form>`에 `id="form-coupon-info"` 부여 + 버튼은 `form="form-coupon-info"`
  속성으로 폼 바깥에서 연결(ProductDetailPanel 정본 패턴과 동일). 기존 하단
  `.panel-actions`(큰 보라색 버튼, "정보 저장" 문구)는 완전히 제거. `.btn-save-inline`
  CSS를 이 파일에 신규 추가(ProductDetailPanel과 동일 스펙: padding 5px 14px, border
  1.5px `--cs-border`, radius `--radius-sm`, 비활성 시 회색 텍스트+투명배경, `.dirty`
  클래스 시 `--cs-purple` 배경). 기존 `isDirtyInfo`($derived, 직전 작업에서 신설)를
  그대로 재사용 — 새 diff 로직 불필요.
- 실 브라우저 검증: 초기 비활성(회색) → 필드 변경 시 즉시 활성(보라색, dirty 클래스) →
  값 원복 시 다시 비활성, 3단계 전부 확인. "배포" 탭 "지급 실행" 버튼은 이번 변경과
  무관, 큰 CTA(`.btn-primary`) 그대로 유지(단일 실행 액션이라 인라인 표준 대상 아님).

### 인라인 저장 버튼 전환 후 재발한 "타이틀 분리" 결함 수정 (같은 세션)
- 원인: 인라인 저장 버튼이 `form="form-coupon-info"` 속성으로 폼 바깥(section-header)에서
  폼과 연결되는 구조라 "핵심 정보 수정" 제목+버튼이 다시 `<form>` 바깥의 독립 요소가 됐고,
  바로 아래 첫 번째 `.validity-group` 박스에 걸려있던 공용 `margin-top:30px` 규칙이 그대로
  적용돼 제목이 박스와 떨어져 보이는 문제가 재발.
- `.validity-group-attached`(margin-top:0) 클래스를 이 첫 번째 박스에만 추가로 부여해
  해결 — 다른 4개 박스(제한기간/사용조건/전용조건/결합옵션)는 서로 다른 섹션 간 분리가
  여전히 필요하므로 기존 30px 그대로 유지.

### 오해로 인한 재작업 — "저장" 버튼과 제목을 한 줄로 묶은 게 원인 (같은 세션)
- 직전 작업에서 "핵심 정보 수정" 제목과 "저장" 버튼을 같은 section-header 줄에 나란히
  배치했는데, 이는 Stephen 의도와 달랐음 — "저장" 버튼은 본문 전체를 포괄하는 액션이라
  현재 위치(우측 정렬, 단독)에 그대로 있으면 되고, 제목은 원래대로 박스 안에 포함돼
  하나의 그룹으로 붙어 있어야 했음.
- 수정: `.section-header`에서 title을 제거하고 버튼만 남긴 `.section-header-solo`
  (justify-content: flex-end, 버튼 단독 우측 정렬)로 전환. "핵심 정보 수정" 제목은
  다시 `.validity-group-attached` 박스 안 첫 자식으로 이동(§ 이전 "사용 조건" 수정과
  동일 패턴 재적용).

### 여백 정리 5차 (같은 세션) — 현황 박스 / 저장 버튼 / 핵심정보 박스 3단 간격
- "현황"(사용/한도·상태 토글) 박스 → 단독 "저장" 버튼 → "핵심 정보 수정" 박스 3개 영역
  사이가 붙어 보이던 것을 각각 30px 여백으로 분리. `.section-header-solo`와
  `.validity-group-attached`에 `margin-top: 30px` 추가(직전 "재작업" 커밋에서 0으로
  줄였던 것을 이번 요청에 맞춰 30px로 재조정).

### 재확인 2건 (같은 세션, Stephen 지적)
1. "배포" 탭 점검 — "특정 사용자 수동 지급"(안내문+textarea+"지급 실행" 버튼) + "사용
   채번 목록" 섹션 구조 확인. 이 탭은 "정보" 탭과 달리 박스 그룹핑 대상이 아니었고
   (Stephen이 이전에 인라인 저장 전환도 "정보" 탭만 지시), 타이틀 분리·여백 붕괴 등
   이번 세션에서 발견된 유형의 결함 없음을 확인. "지급 실행" 버튼(`.btn-primary`)은
   앞서 정정한 공용 CSS 블록을 그대로 상속받아 스펙과 일치.
2. "정보 저장" 버튼 비활성/활성 재검증 — Stephen이 공유한 스크린샷은 실제로 필드값이
   저장된 값과 다른 상태(수정 중)였음을 확인(테스트 쿠폰 TEST-EXHAUSTED에 남아있던
   이전 테스트 흔적 값 "ㅌ스트"/972 자체가 이미 DB에 저장된 상태였고, 그 시점 이후
   추가 수정이 있었던 것으로 판단). 페이지를 새로 열면 저장된 값과 화면 값이 일치해
   정상적으로 비활성(disabled) 상태임을 재확인. 추가로 실 브라우저에서 값 변경→활성
   →원복→비활성 3단계를 다시 실행해 재검증 완료 — 로직 자체는 정상.

---

## DONE — CouponDetailPanel "정보" 탭 UI 레이아웃 정리 + 표준 인라인 저장버튼 전환 (2026-09-23, 이 세션 단독 수행)

> 위 "DONE — 쿠폰 자동배포 대상 분류(필수 회원 분류) SuggestPicker 전환 + 실사용 UI 종단
> 검증"(2026-09-23) 블록에서 시작된 작업의 직접 연속이다. 파일 뒤쪽에 병행 세션(Phase
> 2/3, 다중쿠폰 체크아웃·구독 혜택관리 마스터플랜)의 별도 DONE 블록이 중간에 끼어들어
> 있어, 그 사이사이 시간순으로 기록된 "(같은 세션)" 표기 서브섹션들(그룹핑 보정 1~3차·
> 여백 정리 4~5차·isDirty 연동·CMS 표준 디자인 대조·인라인 저장버튼 전면 전환·재작업·
> 재확인 2건)이 실제로는 전부 이 세션(CouponDetailPanel 단독) 범위임을 이 헤더로
> 명확히 재확인한다 — Phase 2/3 작업과는 무관.

### 세션 요약 (변경 파일 1개만)
`src/lib/components/cms/CouponDetailPanel.svelte` 단독 수정:
- "필수 회원 분류" plain `<select>` → `SuggestPicker`로 전환(coupon/new 화면과 스타일 통일),
  실사용 UI로 분류→저장→자동배포 엔진 실동작까지 종단 검증(위 앞선 DONE 블록에 상세 기록).
- "정보" 탭 5개 섹션(핵심 정보 수정/제한기간+날짜/사용조건/전용조건/결합옵션) 전부
  동일한 테두리 박스(`.validity-group`) 레이아웃으로 통일 + 각 박스·필드·버튼 사이
  30px 여백 표준화(수 차례 시행착오 끝에 확정).
- "정보 저장" 버튼: (1) isDirty 기반 활성/비활성 연동 추가 → (2) CMS 표준 디자인
  지침(cms-uiux.md §7-3) 대조 중 로컬 CSS가 지침과 다른 값(36px/8px라운드)으로 잠재
  결함 상태였음을 발견·정정 → (3) Stephen이 ProductDetailPanel 방식의 `.btn-save-inline`
  (섹션 제목 옆 작은 알약형 인라인 버튼)을 "현재 CMS 저장버튼 표준"으로 명시, 다른
  `.btn-primary` 사용 CMS 화면 18개 전수 검색(동일 결함 CustomerDetailPanel 1곳 추가
  발견, 이번 세션 스코프에서는 보류) → CouponDetailPanel만 인라인 표준 버튼으로 최종
  전환(`form="form-coupon-info"` 속성으로 폼 바깥 section-header에서 연결).
- 실 브라우저(Claude Browser)로 매 단계 스크린샷·JS 콘솔 검증 반복 수행, 최종적으로
  "값 변경 시 활성화(보라) / 미변경 시 비활성화(회색) / 원복 시 재비활성화" 3단계와
  "배포" 탭 무결함을 재확인.

### 잔여 참고사항
- git commit/push 미실행 — Stephen 직접 실행 대기.
- Production 미반영 — Stage(ezyvffjvuwmtuhpxdjrw)에서만 UI 확인(이번 작업은 DB
  마이그레이션 없이 프런트엔드 컴포넌트 수정만 해당).
- CustomerDetailPanel.svelte의 동일 결함(변경사항 저장 버튼)은 Stephen이 이번 세션
  스코프 밖으로 명시적으로 보류 — 후속 세션에서 별도 요청 시 처리.

### @sp3-qa-agent 검수 결과 (2026-09-23) — GATE E 통과
- 검수 범위: `CouponDetailPanel.svelte` 단독(이번 세션 diff, +303/-149). 병행 세션 파일
  (cms-uiux.md·SubscriptionDetailPanel.svelte·chargeSubscription.ts·set/rental/+page.svelte·
  vercel.json·마이그레이션 536~540)은 명시적으로 검수 범위 제외.
- 검수1(규칙 정합성): $state(prop) 초기화 금지 준수($effect 재동기화 확인) · any 신규
  없음 · 요청범위 외 파일 미수정 · cms bds(.btn-save-inline·.btn-primary) 스펙 1:1 일치 ·
  SuggestPicker 공용 패턴 재사용(신규 창작 아님) — 전부 통과.
- 검수2(기술부채): console.log 0 · 신규 any 0 · TODO 0 · svelte-check 에러 0건(경고
  10건은 전부 프로젝트 전역 기존 패턴 재인스턴스, 신규 결함 아님).
- 검수3(요청 리스크 포인트): form="form-coupon-info" 폼외부 버튼 정상 연결 확인 ·
  isDirtyInfo 22개 필드 1:1 대응·categories 정렬비교 일관성·nullable 필드 처리·타입
  불일치 false-positive 가능성 전부 문제없음 확인 · isDirtyInfo 연산 비용은 ROUTINE
  (CMS 내부도구라 무시 가능) · 5개 박스 개폐태그 전수 추적 결과 전부 균형·타이틀
  전부 소속 박스 내부 정상 포함(반복됐던 "타이틀 분리" 결함 재발 없음 확인) ·
  svelte-check 신규 에러 0건.
- 발견 이슈 2건 전부 ROUTINE, CRITICAL/BOUNDARY 없음:
  ① "적용 카테고리" 섹션만 5개 박스 통일 디자인에서 제외(이 세션 이전부터 존재,
     이번 diff 미변경 — git show HEAD로 확인) → 필요 시 별도 후속 작업 권장, 차단 아님
  ② isDirtyInfo의 JSON.stringify 반복계산 → 무시 가능 수준, 차단 아님

**→ GATE E 통과. 커밋 대상 승인 가능(git add 시 이 파일 + 이미 QA완료된 마이그레이션
525/527/528만 명시적으로 포함하도록 주의 — 병행 세션 변경분과 섞이지 않게).**

---

## DONE — Phase 4: 적립포인트(LOYALTY_POINTS) 적립 + 만료 (2026-09-23) — Stage 검증까지만, 배포 보류

[마스터플랜 Phase 4/6 — Phase 3와 동일 원칙: **stage 검증까지만 완료, production 적용·git
commit/push는 의도적으로 보류**(Phase 4·5·6까지 전부 개발 완료 후 일괄 배포 예정)]

### 구현 내역
- 신규 마이그레이션 3개(**stage만 적용, production 미적용**):
  - `#538_point_transactions_expires_at_column` — `point_transactions.expires_at`
    (TIMESTAMPTZ, nullable) 컬럼 + 부분 인덱스. 만료개념 있는 적립(구독 혜택)만 값이 있고
    기존 적립(대여완료 적립 등)은 NULL(영구 유효) — 하위호환 무영향.
  - `#539_award_subscription_points(p_user_subscription_id, p_amount)` — tier_benefits
    LOYALTY_POINTS(`points_rate`/`min_purchase_amount`/`max_points_per_order`/
    `points_expiry_days`) 조회 → 적립액 계산·상한클램프 → `point_transactions`에
    `expires_at` 포함 기록. 멱등키는 "구독ID:날짜"(하루 1회 정기청구 전제).
  - `#540_expire_due_points()` — **핵심 설계: 기존 결제 크리티컬 RPC(`use_points`, Migration
    303/498)를 절대 수정하지 않고**, 유저별 `point_transactions` 전체 이력을 시간순으로
    재생(replay)해 "만료개념 있는 적립분 중 아직 실제로 소비되지 않은 잔량"만 그때그때
    계산하는 FIFO 방식 채택(실시간 잔량 컬럼 관리 방식은 `use_points` 동시수정이 불가피해
    의도적으로 배제). `amount<0`인 모든 거래(use/admin_deduct/expire 전부 포함 — expire
    자신도 재생 대상에 포함시켜야 재실행 시 이중만료 방지)를 오래된 적립 lot부터 순서대로
    소진시킨 뒤, 만료시점 지난 미소진 lot만 실제 만료 처리.
- `chargeSubscription.ts` — Phase 3(`issue_subscription_benefit_coupon`)과 같은
  `chargeSucceeded && result.success` 분기에 `award_subscription_points`를 나란히
  fail-soft로 추가(서로 독립적 try/catch — 하나 실패해도 다른 하나·결제결과 무영향).
- 신규 Vercel Cron `/api/cron/point-expiry`(매일 새벽 1시, 정기결제 크론 자정보다 뒤)
  — `expire_due_points()` 1회 호출. `vercel.json` crons 배열에 등록.

### 메인 세션 독립 재검증
서브에이전트 초안 SQL의 스키마 가정(user_profiles.id 기준·point_transactions.type enum
5종·ref_id TEXT·tier_benefits benefit_params 키 이름)을 전부 라이브 DB 직접 조회로
재대조 — **전부 정확했음**(Phase 3와 달리 이번엔 서브에이전트 스스로도 사전 재검증을
수행해 정확도가 높았음). `user_profiles.points` CHECK(>=0) 제약 존재를 직접 확인해
`expire_due_points()`의 `GREATEST(points - remaining, 0)` 방어적 클램프가 정당함을 검증.

### 검증
- TDD RED(마이그레이션 적용 전, PGRST202)→ stage 적용 후 GREEN 전환: 11/11 GREEN
  (정상적립·최소구매미달·상한클램프·당일중복차단·혜택없음/비활성·전액만료·**부분사용 후
  잔여분만 정확히 만료(FIFO 핵심 검증)**·재실행 멱등성·2개 lot 순차소진)
- 회귀 확인: `subscriptionBillingCron`·`subscriptionBilling`·`subscriptionBenefitCoupon
  Issuance` 포함 35/35 GREEN
- `npx svelte-check`: 신규 에러 0건(기존 vite.config.ts 1건만 잔존)
- `use_points`(Migration 303/498) 무변경 확인 — git diff 없음

### 다음 조치
Phase 5(무료배송) 착수 대기. Phase 3·4 전부 stage 전용 상태 유지, production 적용·git
commit/push는 Phase 5·6까지 마저 개발 완료 후 Stephen 지시 시 일괄 진행.

### Production DB 마이그레이션 적용 완료 (2026-09-23, Stephen 지시)
- Stage(ezyvffjvuwmtuhpxdjrw)에서 이미 검증된 3개 마이그레이션(#525→#527→#528)을
  Production(vnbpmvxruyciuuaermyh)에 동일 순서로 적용.
- 적용 전 Production 상태 직접 조회로 미적용 확인(distribution_enabled/
  auto_distribute_enabled 컬럼 둘 다 없었음) → 순서대로 3개 전부 적용 성공.
- 적용 후 재조회로 Stage와 정확히 동일한 최종 상태 확인: `auto_distribute_enabled`
  컬럼(boolean, default true) · `auto_distribute_eligible_coupons()` 함수 정의가
  Stage와 문자 그대로 일치(일반/학생/구독 분류 기준) · `auto-distribute-eligible-coupons`
  pg_cron 잡 30분 주기로 활성화.
- 이 마이그레이션들은 DB 스키마·RPC 변경만이며 앱 코드 배포(CouponDetailPanel.svelte 등)는
  git commit/push가 아직 실행되지 않아 Production에는 반영되지 않은 상태 — 코드 배포와
  DB 마이그레이션 적용이 서로 다른 별개 액션이라는 점(service-operations.md §9 배포
  순서 사고 교훈) 유의하여, 코드도 커밋·배포될 때까지는 CMS 화면에 새 UI(자동배포 토글
  등)가 Production에 보이지 않음 — 이는 정상(DB만 선반영된 상태).

### Vercel 배포 상태 점검 — Stage & Production 둘 다 READY (2026-09-23)
- 최근 커밋 `338e114`(stage 브랜치, "feat(cms/coupon): 쿠폰 자동배포 엔진 신설 + 발행관리
  UI 표준화") Vercel 배포 상태를 Vercel MCP로 직접 조회(팀 `pseries`,
  프로젝트 `crazyshot-svelte`) — 두 환경 모두 READY 확인:
  - Stage(preview): `dpl_3HUXqv9aPABBLMg1me6FVb8cG3Ur` — READY
  - Production: `dpl_GwxUyTEKJwfK8wfPp2c5PcFpQNwk` — READY, PR #339("stage → main" 머지
    커밋 `66f4d2c`)를 통해 Production에도 이미 병합·배포 완료된 상태 확인
- 즉 코드 배포도 이미 완료됨 — 직전 "DB만 선반영, 코드는 커밋 대기" 기록은 이 시점
  이후 Stephen이 커밋+PR 머지를 직접 완료해 갱신됨. 이제 DB 마이그레이션(#525/#527/#528)과
  앱 코드(CouponDetailPanel.svelte 등) 둘 다 Stage·Production 양쪽에 정합 상태로 반영 완료.

---

## DONE — Phase 5: 무료배송(FREE_SHIPPING) (2026-09-23) — Stage 검증까지만, 배포 보류

[마스터플랜 Phase 5/6 — Phase 3·4와 동일 원칙: **stage 검증까지만 완료, production 적용·git
commit/push는 의도적으로 보류**(Phase 6까지 마저 개발 완료 후 일괄 배포 예정)]

### 설계 변경 (원 계획 대비 단순화, Stephen 확정)
원 마스터플랜은 "서버가 배송비 전체를 재계산"하는 방식이었으나, 실제 배송비 계산
(`cartShippingFee.ts`)이 대여금액 구간별 할인 조합(최대 5개)·쿠폰 상호배제 등으로 이미
복잡해졌고, 무엇보다 **현재의 "클라이언트 계산값을 서버가 그대로 신뢰"하는 방식이 의도적
설계**(Migration 395 — "장바구니 표시금액≠결제금액" 불일치 버그 재발 방지 목적)임을 확인.
Stephen 지시로 범위를 좁힘 — 서버는 배송비를 재계산하지 않고, "이 주문에 구독 무료배송
혜택을 적용해도 되는가"만 별도 판정해 해당되면 최종 배송비를 0원으로 덮어쓰기만 한다.
"배송 방식(왕복/편도)" 제한 조건은 간단 처리 대신 **정확히 검사**(Stephen 확정).

### 부수 발견·즉시 수정 — Phase 2 설계 오류
`subscription_benefit_usage.ref_id`(Migration 536)가 UUID로 선언돼 있어 예약/주문 ID
(BIGINT)를 담을 수 없었음(쿠폰 ID만 UUID) — `point_transactions.ref_id`가 동일한 이유로
TEXT 전환된 선례(Migration 407)와 동일하게, 신규 `#541_subscription_benefit_usage_ref_id_
text`로 즉시 수정. **이 수정은 Phase 2가 이미 stage·production 양쪽에 배포된 상태였으므로
(Phase 3 이후처럼 보류 대상이 아님) 즉시 양쪽에 반영**(적용 시점 두 환경 모두 0 rows로
데이터 손실 위험 없음을 직접 확인 후 적용).

### 구현 내역
- 신규 마이그레이션 `#542_apply_subscription_free_shipping(p_user_id, p_reservation_ids)`
  (**stage만 적용, production 미적용**) — 활성 구독 확인 → tier_benefits FREE_SHIPPING
  (`shipping_type`/`monthly_limit`) 조회 → 예약묶음의 실제 수령·반납 방식이
  `rental_method_options.is_delivery_type`(+`deleted_at IS NULL`, Migration #479 선례
  재사용)로 배송형인지 판정해 round_trip/one_way/배송아님 3분류 → 설정된 shipping_type과
  일치할 때만 월 한도 확인 후 적용(`subscription_benefit_usage` 기록, 예약묶음 최소ID
  기준 멱등성).
- `create-order/+server.ts` — `deliveryFee` 계산 직후 위 RPC로 판정해 해당 시 0원으로
  덮어쓰기만 추가(쿠폰·포인트 사전선택 캐시 로직 등 기존 코드 완전 무변경, diff 19줄로
  완전히 격리된 삽입 확인).

### 검증
- TDD RED(마이그레이션 적용 전, PGRST202)→ stage 적용 후 GREEN 전환: 8/8 GREEN(왕복적용·
  편도적용·배송형불일치·배송아님·월한도초과·활성구독없음·혜택비활성·멱등성)
- 회귀 확인: Phase 3·4 테스트 포함 31/31 GREEN
- `npx svelte-check`: 신규 에러 0건
- `git diff create-order/+server.ts` 직접 대조 — 쿠폰/포인트 로직 0줄 변경 확인

### 다음 조치
Phase 6(무료렌탈, 마지막 단계 — 공용 요금계산 RPC 직접 수정으로 회귀 리스크 최대) 착수 대기.
Phase 3·4·5 전부 stage 전용 상태 유지, production 적용·git commit/push는 Phase 6까지
마저 개발 완료 후 Stephen 지시 시 일괄 진행.
