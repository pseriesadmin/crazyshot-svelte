# GSD_LOG.md — 크레이지샷 실행 이력
# 형식: [YYYY-MM-DD HH:MM] 타입 | 태스크명 | 파일 | 소요 | 결과

[2026-08-10] ⚡GSD | 크레이지로그 배너 카드 선택 UI + CMS 콘텐츠 탭 (plan_source: hazy-honking-willow.md)
  | 신규 10개·수정 3개 파일 | GATE B·C 전부 통과 (stage+production DB 적용 완료)
  배경: `/crazylog` 메인 3개 배너 카드(Flash Deals·채널홍보·Release)가 완전 하드코딩(정적 이미지·
  제목, 전부 `/crazylog/view/1` 고정 링크 버그 포함)이라 관리자가 실제 게시물을 노출시킬 방법이
  없었음. `/products` 페이지의 `ProductHeroModal`+`cms_settings` jsonb 픽커 패턴을 재사용해 이식.
  ── DB (GATE B: stage 검증 → GATE C: production 적용, Stephen 승인 하에 순차 진행) ──
    - `supabase/migrations/20260809000210_210_crazylog_banner_settings.sql`: `cms_settings`에
      슬롯 3개 시드(`crazylog_banner_slot1/2/3`) + RPC 4종(`get_crazylog_banner_settings`,
      `upsert_crazylog_banner_setting`[is_cms_user 게이트+풀 최대 8개 제한],
      `get_crazylog_posts_by_ids`, `search_crazylog_posts`)
    - `supabase/migrations/20260809000211_211_crazylog_content_stats.sql`: CMS 대시보드용
      `get_crazylog_content_stats()` RPC(총 게시물·게시됨·조회수·카테고리별 건수·TOP10)
    - stage(ezyvffjvuwmtuhpxdjrw) 적용·검증 → production(vnbpmvxruyciuuaermyh) 적용·검증 순서 준수
  ── `/crazylog` 서버·렌더링 ──
    - `src/lib/utils/crazylogBanner.ts` 신규(TDD): `pickBannerItems`(fixed=order순/random=shuffle,
      최대 3개) + `deriveBadgeLabel`(노출된 최대 3개 중 다수 log_type, 동률 시 0번 인덱스) 순수 함수.
      `src/__tests__/server/crazylogBanner.test.ts` 8개 테스트 전부 통과
    - `src/routes/crazylog/+page.server.ts`: `loadBannerSlots()` 추가 — 슬롯 설정 조회 →
      전체 post id 배치 하이드레이션(N+1 금지) → 슬롯별 선택·배지 도출 → `bannerSlots` 반환.
      기존 30개 랜덤 셔플 로직과 독립적 병렬 쿼리
    - `src/routes/crazylog/+page.svelte`: PC 3카드(`d-shotlog`/1/2) + 모바일 `M_LISTS` 하드코딩
      배열을 `data.bannerSlots` 바인딩으로 교체. 풀이 비어있으면 기존 정적 이미지/텍스트로 폴백.
      전체 카드가 `/crazylog/view/1`로 고정되던 버그도 함께 수정(`/crazylog/view/{item.id}`)
  ── 관리자 픽커 UI ──
    - `src/lib/components/crazylog/admin/CrazylogBannerModal.svelte` 신규 — `ProductHeroModal`
      로직 이식(SuggestPicker 검색 + CmsDragList 드래그정렬 + fixed/random 모드), 단 비주얼은
      front-uiux 톤 적용(CTA `--cs-red-badge`, 패널 radius `--radius-xl`) — `/crazylog`가 USER
      라우트이므로 CMS 퍼플/15px 대신 사용자 화면 토큰 사용(Stephen 확정)
    - `data.isCms` 조건부 "✦ 목록 선택" 트리거 버튼 3개, `activeModal` 상태로 모달 전환
    - 저장은 `upsert_crazylog_banner_setting` RPC(서버에서 `is_cms_user()` 재검증 — 클라이언트
      `isCms`는 UI 노출용일 뿐 실제 보안 경계 아님, `/products`와 동일 패턴)
  ── CMS `/cms/promotion/content` 신규 탭 ──
    - `src/routes/cms/promotion/content/+page.server.ts`: `hasSettingsAccess`(manager+) 게이트 +
      `get_crazylog_content_stats` 로드
    - `src/routes/cms/promotion/content/+page.svelte`: 기존 `CmsKpiGrid`/`CmsStatRing`/
      `CmsStatBars` 재사용(신규 컴포넌트 없음) + TOP10 인기 게시물 테이블
    - `src/routes/cms/+layout.svelte` MENU '분석' 뒤에 '콘텐츠' 탭 항목 1줄 추가
  검증: `npx svelte-check` 신규/수정 파일 0 에러(products/search 사전 존재 에러 1건은 무관),
  `npx vitest run` crazylogBanner.test.ts 8/8 통과(기존 productClone.test.ts 실패 2건은 stage
  브랜치 기준 무관한 pre-existing 이슈, git stash로 회귀 확인 완료).
  Stephen 확인 완료: SSR 랜덤 로테이션 O, 모바일 포함 O, 슬롯별 log_type 자유선택 O, front-uiux
  모달 톤 O, stage 적용 승인 → production 적용 승인.
  미완료: 브라우저 수동 QA(Claude_Browser 사용 금지 규칙상 미실시) — Stephen 직접 확인 필요.
  git commit/push 미실행(자율 실행 금지, Stephen 진행 대기).

  ── @sp3-qa-agent 1차 검수 (2026-08-10) → 재검수 필요 판정, 3건 발견·즉시 수정 ──
    - #1 (버그, 우선순위 높음): `+page.svelte`의 `M_LISTS`가 `$derived`가 아닌 일반 `const`라서
      관리자가 배너 편집 저장(`invalidateAll()`) 후에도 모바일 캐러셀은 갱신 안 됨(PC 3카드는
      `data.bannerSlots` 직접 참조라 정상 반영). `const M_LISTS = data.bannerSlots.map(...)` →
      `const M_LISTS = $derived(data.bannerSlots.map(...))`로 수정
    - #2 (H-06 위반): `+page.server.ts` `loadBannerSlots(supabase: any)` — 함수 시그니처 자체가
      any. `SupabaseClient<Database>`로 명시하고, database.ts에 아직 없는 신규 RPC 2건
      (get_crazylog_banner_settings/get_crazylog_posts_by_ids) 호출부만 `(supabase.rpc as any)`
      국소 캐스트 + 사유 주석으로 축소(ProductHeroModal.svelte와 동일 기존 관례)
    - #3 (S2 기준): 마이그레이션 210/211에 rollback 섹션 없음 → 두 파일 상단에 DROP
      FUNCTION/DELETE 롤백 주석 블록 추가(이미 stage+production 적용 완료된 함수라 재적용 불필요,
      문서화만)
    - 수정 후 npx svelte-check 0 에러, npx vitest run crazylogBanner.test.ts 8/8 재확인 완료

  ── @sp3-qa-agent 재검수 (2026-08-10) → GATE E 통과 ✅ ──
    - 3건 전부 정상 반영 확인(M_LISTS $derived 문법 정상, loadBannerSlots 함수 시그니처 any 제거+
      국소 캐스트 2건만 잔존, migration 210/211 rollback 섹션이 실제 정의된 오브젝트 전부 커버)
    - npx svelte-check 대상 파일 0 에러, npx vitest run crazylogBanner.test.ts 8/8 재확인
    - 1차 통과 항목(H-01/보안/N+1/Svelte5 문법/$state prop 초기화/도메인 무영향)은 재확인 생략
    - GATE E 통과 — commit은 Stephen 직접 실행 대기

[2026-08-09] ⚡GSD | NLSearch: CMS 상품검색 연동(§K) + 검색학습 루프 빈틈 수정(§L) + 500 에러 긴급
  핫픽스 | 6개 파일(신규 2·수정 4) | GATE C 전부 승인 완료
  배경: 메인 세션이 NLSearch 3개 화면(상품검색·상담채팅·CMS 상품목록)을 production 실데이터로 정밀
  검증한 결과 (1) `/cms/products` 목록 검색창이 NLSearch와 무관한 별도 단순 ilike 필터였음을 발견,
  (2) `/products/search`에서 RPC 0건→자연어 폴백 발동 시 `search_log_id`가 null이 되어 그 결과의
  클릭이 §J 학습 데이터로 못 쌓이는 구조적 빈틈 발견(실제 재현으로 확정). Stephen이 두 가지를 지시.
  ── §K CMS 상품검색 NLSearch 연동 (K-1~K-4, 전부 GATE C 승인) ──
    - K-1: `src/routes/api/cms/products/search-suggestions/+server.ts` 신규 — ilike(productSearchOrFilter)
      1차 + NLSearch(productSearchIndex.ts) 폴백(3건 이하일 때만) 하이브리드. 응답은 SimilarNameItem
      형태(id/name/brand/category/product_code/match_label)
    - K-2: `src/lib/components/cms/CmsSimilarNameInput.svelte`의 `source==='product_search'` 분기만
      K-1 API 호출로 교체 — 디바운스·overlay·키보드 내비 등 기존 추천 드롭다운 UX 100% 무변경.
      `source==='brand'`/기본(product_name 중복확인) 분기는 0줄 수정(요청 범위 엄격 준수)
    - K-3: `src/routes/cms/products/+page.server.ts` 목록 필터(countQ/listQ)에도 동일 하이브리드
      적용 — ilike 약할 때 NLSearch 매칭 id를 `.or()`에 병합, totalCount/totalPages 정합 유지
    - K-4: `src/__tests__/server/cmsProductSearchSuggestions.test.ts` 신규 23개 테스트 전부 통과,
      brand/product_name 소스 회귀 없음(0줄 변경) 확인
    - Stephen 확인 완료: 구성품·사양 전용 검색어 매칭 반영 O, 4건 이상이면 자연어 보강 생략 방식 O
  ── §L 검색학습 루프 빈틈 수정 (L-1~L-2, GATE C 승인) ──
    - L-1: `src/routes/api/search/products/+server.ts`에 `fetchRecentSearchLogId(query)` 헬퍼 추가 —
      RPC 0건+검색어 2자 이상일 때 service_role로 `search_logs`에서 최근 10초 이내 동일 검색어 로그를
      후속 조회해 `search_log_id`에 채움(실패 시 null 폴백, 검색 자체는 안 막음). RPC(migration 203)
      시그니처는 무변경 — TS 레이어에서만 해결
    - L-2: `src/__tests__/server/searchEngine/searchLogIdFallback.test.ts` 신규 14개 테스트 전부 통과
    - Stephen 확인 완료: 자연어 폴백 결과 클릭이 학습 데이터로 정상 축적 O, 10초 기준 적절 O
  ── 🔴 긴급 핫픽스: `/products/search` 검색 시 500 에러 (2026-08-09, 메인 세션 직접 진단·수정) ──
    Stephen이 launch-selected-element로 실제 500 에러를 보고(검색어 입력 시마다 재현). 메인 세션이
    직접 원인 진단: L-1의 `fetchRecentSearchLogId`가 `+server.ts`에 **`export`** 상태로 추가돼 있었음
    — SvelteKit은 `+server.ts`에서 GET/POST 등 정해진 이름 외 export를 전부 거부(`Invalid export`
    런타임 에러)하므로, 검색어와 무관하게 **이 라우트로 오는 모든 요청이 500으로 실패** 중이었음
    (RPC·MiniSearch 각각은 격리 재현으로 정상 확인 — fresh vite dev 프로세스로 재현·스택트레이스
    확보해 원인 특정). 수정: `export` 키워드 제거(로컬 함수 전환) — `searchLogIdFallback.test.ts`는
    이 함수를 직접 import하지 않고 로직만 재현하는 구조라 테스트 영향 없음. 재현했던 두 검색어
    재테스트 → 200 + `search_log_id` non-null 정상. 검색엔진 테스트 스위트 139/139 통과.
    ⚠️ production/stage 배포엔 영향 없었음(L-1이 아직 미커밋 상태에서만 존재하던 버그)
  종합: DB 마이그레이션 추가 없음(순수 TS 로직 변경, 신규 마이그레이션 0건) — stage/production DB
  적용 자체가 불필요한 작업. 코드(TS)는 아직 미커밋 상태 — Stephen 커밋 대기 중.

[2026-08-09] CRITICAL | 내정보 프로필 사진(아바타) 업로드 기능 신규 구축 + 로그인정보카드 이메일 전체노출 | 신규 마이그레이션 1개 + 5개 파일 | ✅ Stage+Production 적용 완료
  배경: Stephen이 launch-selected-element로 /account/profile 개인정보 탭 상단 "로그인 정보 카드"
  (이메일ID+가입일+아바타)와 /account 메인 인사카드를 함께 선택하며 "기능성 점검 후 account와
  중복되면 제거" 지시. 조사 결과 두 카드는 표시 데이터가 달라(이름+혜택+QR vs 이메일+가입일+
  아바타) 완전 중복이 아니었고, 유일한 겹침은 이메일ID 부분이 같은 컴포넌트 내 바로 아래 편집
  가능한 이메일 필드와 겹치는 정도였음. UI 삭제 오인 방지 지침(과거 학습기록)에 따라 삭제
  전 대상을 명확히 확인받는 과정에서 Stephen이 "DB 기능이 있었어(사진 업로드)"라며 방향 전환 —
  전체 마이그레이션 이력 조사 결과 avatar_url 등 프로필사진 관련 컬럼은 DB에 전혀 존재한 적
  없음(신규 기능 확정, AskUserQuestion으로 Stephen 재확인 완료).
  DB 변경 + 다중 파일이라 CRITICAL 게이트로 분류, 서비스 의도 확인 질문 후 진행.
  구현:
    · supabase/migrations/20260809000212_212_user_profiles_avatar_url.sql (신규) —
      user_profiles.avatar_url TEXT 컬럼 + update_user_avatar(p_avatar_url) RPC
      (SECURITY DEFINER, WHERE id = auth.uid() — Migration #135 정정 패턴 준수, user_id 아님)
    · src/lib/types/database.ts — UpdateUserAvatarArgs 타입 + Functions 맵 등록
    · src/routes/account/+page.server.ts, src/routes/account/profile/+page.server.ts —
      avatar_url을 각각 AccountProfile/UserProfile 인터페이스 + select 쿼리에 추가
    · src/routes/api/profile/upload-avatar/+server.ts (신규) — upload-doc과 동일 패턴
      (user-documents 버킷 재사용, 세션 검증, callTypedRpc 경유) 단 이미지 전용(PDF 제외) MIME
      검증만 별도 배열로 분리
    · src/lib/components/members/profile/ProfileTabContent.svelte — 로그인 정보 카드:
      이메일 표시를 split('@')[0] → 전체 이메일로 변경(word-break 추가로 모바일 줄바꿈 대응),
      아바타를 비활성 div → 클릭 가능 button으로 전환(avatar_url 있으면 이미지, 없으면 기존
      이니셜 폴백 유지) + 클릭 시 간단한 업로드 모달(미리보기+저장, 기존 kakao-modal/doc-upload
      CSS 클래스 재사용, 오버레이만 avatar-modal-overlay로 분리해 카카오 주소검색 모달의
      모바일 바텀시트 강제 스타일과 결합 방지)
  검증: svelte-check 신규 에러 0건(11→1건 기준 변동 없음)
  [2026-08-09 후속1] 마이그레이션 #212 stage(ezyvffjvuwmtuhpxdjrw) 적용 완료(Stephen 지시) —
  avatar_url text 컬럼 + update_user_avatar RPC 존재 SQL로 직접 확인.
  [2026-08-09 후속2] Production(vnbpmvxruyciuuaermyh) 적용 완료(Stephen 지시) — avatar_url
  text 컬럼 존재 SQL로 직접 확인. Stage/Production 양쪽 DB 반영 완료.

[2026-08-09] GSD | CMS 상담(/cms/chat) 관리자 답장 FCM 푸시 미작동 검증 + 신규 연결 |
  수정파일: src/routes/api/chat/admin-reply/+server.ts, src/routes/api/chat/admin-attachment/+server.ts |
  신규 마이그레이션: supabase/migrations/20260809000208_208_push_notification_config_admin_chat_reply.sql |
  결과: 진단 — push.ts 발신 허브·인프라(토큰 4건 활성)는 정상, admin-reply/admin-attachment
  두 API에 sendPushToUser 호출 자체가 없었음(미구현, 버그 아님) + push_notification_config에
  채팅용 notify_type 부재. Stephen 승인 하에 admin_chat_reply notify_type 신규 등록(신규
  옵트인 컬럼 없이 기존 allow_rental_alert 재사용) + 두 API에 발송 연결. stage 적용·검증 →
  Stephen 승인 → production(vnbpmvxruyciuuaermyh) 적용 완료. svelte-check 터치 파일 신규
  에러 0건. git 커밋 미실행(Stephen 요청 대기)

[2026-08-09 14:35] ⚡GSD  | K-1: /api/cms/products/search-suggestions 신설 | src/routes/api/cms/products/search-suggestions/+server.ts | ~25분 | GATE C:자동(BOUNDARY)
[2026-08-09 14:35] ⚡GSD  | K-2: CmsSimilarNameInput product_search 분기 → API fetch 교체 | src/lib/components/cms/CmsSimilarNameInput.svelte | ~15분 | GATE C:자동(BOUNDARY)
[2026-08-09 14:35] ⚡GSD  | K-3: /cms/products/+page.server.ts 하이브리드 NLSearch 폴백 적용 | src/routes/cms/products/+page.server.ts | ~20분 | GATE C:CRITICAL 대기
[2026-08-09 14:35] ⚡GSD  | K-4: 유닛테스트 23개 신규 + 116개 회귀 통과 | src/__tests__/server/cmsProductSearchSuggestions.test.ts | ~10분 | GATE C:자동(BOUNDARY)
[2026-08-09] BOUNDARY | /account 개인정보 미등록 안내(경고토스트+'고객'님 플레이스홀더) | src/routes/account/+page.server.ts, src/routes/account/+page.svelte | ✅ DONE
  Stephen 요청: 이메일 최초 가입 후 /account 상단 이름 노출 영역이 비어보이는 문제 해소.
  기존: data.user.name이 session.user_metadata.full_name → 이메일 앞부분 → '회원' 순 폴백이라
  user_profiles.full_name(실제 개인정보 등록 원본, /account/profile에서 편집)과 무관하게 표시되던
  구조 — 신규가입자는 이메일 파편이 이름처럼 노출되는 어색한 상태였음.
  수정: +page.server.ts user.name을 profile.full_name(user_profiles 테이블, 단일 소스) 기준으로
  교체, 미등록 시 폴백을 '고객'으로 변경. +page.svelte에 $effect + toastShown 플래그(기존
  cms/login/+page.svelte 패턴 재사용)로 profile.full_name 미등록 상태일 때만 진입 시 1회
  csToast.warning('상세 개인정보를 등록해주세요.') 노출 — 30초 간격 rental-status invalidate로
  인한 재발송 없음. /account/profile에서 이름 저장(update_user_profile RPC) 후 재진입하면
  full_name이 채워져 토스트·플레이스홀더 모두 자연 해제(별도 "최초 1회" 플래그/컬럼 불필요).
  svelte-check: 신규 에러 0건(11→1건 기준 변동 없음, 남은 1건은 무관한 기존 이슈)

[2026-08-09 14:33] ⚡GSD | §L-1 §J 학습루프 빈틈 수정 — RPC 0건 시 search_log_id 후속 조회 |
  src/routes/api/search/products/+server.ts | 25분 | GATE C 대기
  변경요약: fetchRecentSearchLogId(service_role, 10초 window) 헬퍼 추가,
  const searchLogId → let searchLogId 변경, rpcResults.length===0 && q.length>=2 조건에서
  후속 조회 발동. 후속 조회 실패 시 null 폴백 유지(검색 차단 없음). svelte-check 오류 0건.

[2026-08-09 14:33] ⚡GSD | §L-2 테스트 신설 — searchLogIdFallback 14개 테스트 |
  src/__tests__/server/searchEngine/searchLogIdFallback.test.ts (신규) | 20분 | GATE C 대기
  테스트 그룹: L-1-A(발동조건)·L-1-B(후속조회성공)·L-1-C(실패폴백)·L-1-D(스킵케이스)·L-1-E(§J 전체흐름)
  vitest run: 7개 파일 116개 테스트 전부 통과, 회귀 없음.

[2026-08-07 19:20] ⚡GSD | CMS 대여현황(/cms/rentals)↔예약목록(/cms/reservation) 정합성 정밀
  검증 + get_rental_list 페이지네이션 버그 발견·수정(Stage+Production) |
  검증파일: src/lib/utils/rentalTransition.ts, src/lib/components/cms/RentalDetailPanel.svelte,
  src/lib/components/cms/RentalContractViewer.svelte,
  src/lib/components/common/RentalJourneyStepper.svelte, src/routes/cms/rentals/+page.server.ts,
  src/routes/cms/rentals/+page.svelte, src/routes/cms/reservation/+page.server.ts,
  src/routes/cms/mobile/qr/[product_id]/+page.server.ts |
  수정파일: src/routes/cms/rentals/+page.server.ts, src/routes/cms/reservation/+page.server.ts |
  신규 마이그레이션: supabase/migrations/20260807000201_201_get_rental_list_scope_filter.sql,
  20260807000202_202_drop_get_rental_list_old_overload.sql |
  결과: 상태전이(nextStatus/update_reservation_status RPC)·알림(AUTO_NOTIFY/NOTIFY_TYPE_MAP)·
  계약서 노출조건·스텝퍼·QR반출입 전부 rental-lifecycle.md와 정합 확인(불일치 0건).
  🔴 CRITICAL 1건 발견: get_rental_list가 화면 스코프(RENTAL_STATUSES/RENTAL_VIEW_STATUSES)
  적용 전 total_count·LIMIT/OFFSET을 계산해 "전체" 상태칩(기본 진입)에서 총건수·페이지네이션이
  실제 표시 목록과 어긋남 — Stephen 승인 후 p_include_statuses/p_exclude_statuses 파라미터
  추가(migration 201)로 수정. 배포 직후 CREATE OR REPLACE가 신규 오버로드를 별도 추가함을
  자체 발견(PGRST203 위험, products.md generate_product_code 사례와 동일 패턴) → migration
  202로 구 6-인자 오버로드 DROP, 단일 8-인자 함수로 확정. Stage(confirmed26+shipped1=27,
  cancelled26+hold1=27) · Production(confirmed3→rentals=3/reservation=0) 양쪽 실측 SQL로
  total_count 정확성 검증 완료. svelte-check 신규 에러 0건. TASK.md 동일 항목 기록,
  git 커밋 미실행(Stephen 요청 대기)
  GATE C: 승인 완료 (Stephen "페이지네이션 버그 지금 고쳐줘" → "production까지 적용해줘")

[2026-08-07 18:30] ⚡GSD | NLSearch 확장 아젠다(§G~§J, §I) 전체 완료 — DB 적용 이력 소급기록 |
  대상: 이번 세션(2026-08-06~07) NLSearch 신설 + 확장 전체 마이그레이션(198~200, 203~205)의
  stage·production 적용 이력이 GSD_LOG에 누락되어 있어 TASK.md/실제 DB 상태 기준으로 소급 기록함.
  ── §D MIGRATION-198(search_vector에 keywords·product_caption·content_blocks 반영) ──
    stage 적용·검증 완료(2026-08-06, 메인 세션 Supabase MCP 직접 적용) |
    production 적용·검증 완료(2026-08-06, Stephen 명시 승인 후 메인 세션 직접 적용)
  ── §E SYN-2(synonym_groups/synonym_group_members 테이블+RPC 2종+'파손' 시드) ──
    stage 적용·검증 완료(2026-08-06) | production 적용·검증 완료(2026-08-06, SYN-7-PROD, Stephen 승인)
  ── §E SYN-13(synonym_learning_settings 튜닝 테이블, migration 200) ──
    stage 적용·검증 완료(2026-08-06) | production 적용·검증 완료(2026-08-06, Stephen 승인)
  ── §F FIX-1(상품검색 캐시 무효화 6곳 연결, cms/products/+page.server.ts·new/+page.server.ts) GATE C:승인 ──
  ── §F FIX-2(로그인 세션 조회 event.locals.safeGetSession() 전환, api/search/products/+server.ts) GATE C:승인 ──
  ── §F FIX-3(loadSynonymGroups 60초 TTL 캐시, synonymLearning.ts) GATE C:승인 ──
  ── §F FIX-4(buildCannedResponseIndex 60초 TTL 캐시+keySignature, cannedResponseSearchIndex.ts) GATE C:승인 ──
  ── §F FIX-6(상담세션 closed 재활성화 중복 UPDATE 제거, api/chat/message/+server.ts) GATE C:승인 ──
  ── §G G-1~G-4(search_products RPC result_count 실매칭 재계산 + search_log_id 반환 + recordSearchClick
     실배선, migration 203) ── stage 적용·검증 완료(2026-08-07, "Canon" 검색 result_count=3 실측 확인) |
     production 적용·검증 완료(2026-08-07, Stephen 승인). ⚠️ RETURNS TABLE 컬럼 추가는 Postgres
     42P13(반환타입 변경)로 CREATE OR REPLACE 불가 — DROP FUNCTION 선행 필요함을 실제 적용 중 확인,
     마이그레이션 파일에도 반영해둠(향후 RETURNS TABLE 확장 시 참고)
  ── §H H-1(productSearchIndex.ts에 components·specifications 색인 추가, boost=3) GATE C:승인 ──
  ── §H H-2(search_vector 트리거에 components·specifications 반영, migration 204) ── stage 적용·검증
     완료(2026-08-07, 임시 components={"배터리":"2개"} → search_vector 매칭 확인 후 ROLLBACK) |
     production 적용·검증 완료(2026-08-07, Stephen 승인)
  ── §I I-1~I-4(크레이지로그 검색엔진 신설 — crazylogSearchIndex.ts, api/search/crazylog/+server.ts,
     crazylog/list 검색 UI, 유닛테스트 17개) GATE C:불필요(전부 BOUNDARY, 자동완료) ──
  ── §J J-1(search_learning_settings 싱글턴 튜닝 테이블, migration 205) ── stage 적용·검증
     완료(2026-08-07, promote_threshold=3 기본값 확인) | production 적용·검증 완료(2026-08-07, Stephen 승인)
  ── §J J-2~J-3(product_search_stats 클릭통계 기반 검색어→상품 키워드 자동승격,
     productSearchIndex.ts + searchLearning.test.ts 24개) GATE C:승인(위 상단 항목의 최종 승인 상태) ──
  ── DOC-1(.claude/rules-ref/nlsearch.md v1.1 갱신 — 크레이지로그 어댑터·§G~§J 반영) GATE C:불필요 ──
  종합: 이번 아젠다 전 태스크(§D 후속 SYN 시리즈 포함 총 30여개) stage+production 양쪽 DB 적용·검증
  완료. Vercel 배포(stage dpl_3bPLtBz5.../production dpl_9TpGFphb...) 둘 다 READY 확인됨(별도 배포
  점검 기록 참고). 코드(TS) 커밋은 부분적으로 완료(150da4f 등) — 이번 §G~§J 신규 코드는 아직 커밋 전.

[2026-08-07 16:20] GSD | J-2: productSearchIndex.ts 학습 검색어 확장 |
  src/lib/server/searchEngine/adapters/productSearchIndex.ts |
  loadPromoteThreshold(service_role TTL60s) + loadLearnedSearchTerms(anon) 신설,
  getProductSearchIndex() 병렬 조회 + keywords_text 병합, invalidateProductSearchCache() 확장 |
  GATE C: 승인 완료 (Stephen 확인 — 임계값 3회, MiniSearch 폴백 전용 반영 둘 다 의도대로)
[2026-08-07 16:20] GSD | J-3: searchLearning.test.ts 유닛테스트 신설 |
  src/__tests__/server/searchEngine/searchLearning.test.ts |
  24개 테스트 (promote_threshold 분기·keyword 병합·extractJsonbKeyValues·캐시·폴백) 전원 통과 |
  GATE C: 승인 완료
[2026-08-06] AUDIT | AUDIT-4 최종 종합 — CMS 백오피스 전역 정밀 검증(AUDIT v2) 전체 완료 |
  산출: .claude/harness/learnings/cms_full_audit_2026-08-06.md(신규), TASK.md BACKLOG 15건 등록 |
  총괄: CRITICAL 0건(기해결 2건), BOUNDARY 4건, ROUTINE 11건
  - 9개 AUDIT 태스크(클러스터1·2·3) Track A 소스코드 정적 감사 완료 (코드 수정 없음)
  - CRITICAL 기해결 2건: accounts/createAccount 미인증(SEC-1~2), promotion/rules 미인증(SEC-3~4) — TDD 7케이스 GREEN
  - BOUNDARY 4건: BND-01(requireSuperadmin dual-schema), BND-02(customers API sub-routes 6개 role 누락),
      BND-03(ad/coupon 직접 DML H-01), BND-04(analytics hasSettingsAccess 누락)
  - ROUTINE 11건: RTN-01~11 (문서드리프트 2건 포함, 타입드리프트·any타입·로깅불통일 등)
  - GSD_LOG 동기화 갭: 프로모션 관련 5개 작업스트림 17개 세부태스크 미기록 확인 (소급기록 없음)
  - 문서 드리프트 2건: AGENTS.md 규칙파일 목록 불일치, chat.md §3 세션전이 구버전
  - Track B(실DB 대조): Supabase MCP 인증 대기 — 별도 세션 진행 예정

[2026-08-06] AUDIT | 클러스터3(관리행정) AUDIT-3.1/3.2/3.3/3.4 검증 완료 | 검증파일: src/routes/cms/customers/+page.server.ts, customers/inquiry/+page.server.ts, membership/+page.server.ts, score/+page.server.ts, customers/addresses/+server.ts(외 5개 API sub-routes), src/routes/cms/promotion/rules/+page.server.ts, ad/+page.server.ts, coupon/+page.server.ts, point/+page.server.ts, segment/+page.server.ts, analytics/+page.server.ts, src/lib/utils/cmsPermissions.ts, src/routes/cms/set/push/+page.server.ts, src/lib/server/push.ts, src/lib/utils/push.ts, src/routes/cms/set/rental/+page.server.ts, src/routes/cms/accounts/+page.server.ts, accounts/list/+page.server.ts, accounts/codes/+page.server.ts, src/routes/cms/login/+page.server.ts, src/__tests__/server/cmsSecurityGuards.test.ts | 결과: CRITICAL 후보 2건 "해결됨" 확인 ✅, 아키텍처 주의 6건, 정상 영역 다수
  - AUDIT-3.1(customers): CRITICAL 전무. 5개 action getCmsRoleForAction+hasSettingsAccess 전수 ✅, deleteCustomer 명시적 역할 화이트리스트 ✅, inquiry 2개 action ✅, membership/score read-only ✅, H-01(RPC) ✅. 아키텍처 주의: customers API sub-routes(6개) partner 직접 URL 접근 차단 미적용(manager+ 매트릭스 불일치)
  - AUDIT-3.2(promotion): CRITICAL — rules 3개 action(createRule/toggleRule/deleteRule) 해결됨(정상 영역) ✅. ad/coupon 권한가드 ✅. KPI 표준 컴포넌트(CmsKpiGrid/CmsKpiCard/CmsStatRing/CmsStatBars) 5개 화면 전부 import+사용 ✅, columns=3 ✅, 인라인 kpi-card 없음 ✅, CouponDetailPanel+CmsPagination ✅. 아키텍처 주의: analytics load() hasSettingsAccess 누락(partner 수익 데이터 접근 가능), ad/coupon `return{ok:false}` HTTP200 패턴(fail() 미사용), ad/coupon banners/coupons 직접 DML(H-01)
  - AUDIT-3.3(set): push action 2개 getCmsRoleForAction+hasSettingsAccess ✅, FCM 서버키(FIREBASE_ADMIN_PRIVATE_KEY 등) $env/static/private 완전 격리 ✅, push.ts server/client 분리 ✅, set/rental 14개 action 세션체크-only(security-auth.md partner✅세션만 의도된 설계) ✅. 아키텍처 주의: push admin() 팩토리 URL 헬퍼 불일치(동작 무관)
  - AUDIT-3.4(accounts/login): CRITICAL — accounts createAccount 해결됨(정상 영역) ✅. list 6개 action requireSuperadmin() ✅, 본인계정 삭제 방지 ✅, login setPassword 토큰 재사용/만료 체크 ✅, TOCTOU 없음 ✅, cmsSecurityGuards.test.ts 7케이스 존재 ✅. 아키텍처 주의: requireSuperadmin 명칭 오인(실제 manager+), dual-schema 폴백 미처리(v5.46+ production 위험)

[2026-08-06] AUDIT | 클러스터2(상품/재고) AUDIT-2.4/2.5 검증 완료 | 검증파일: src/routes/cms/products/+page.server.ts, products/new/+page.server.ts, src/lib/components/cms/ProductDetailPanel.svelte, src/routes/cms/codes/+page.server.ts, src/routes/cms/mobile/qr/[product_id]/+page.server.ts, mobile/+layout.server.ts, mobile/+page.server.ts, src/lib/server/searchEngine/adapters/productSearchIndex.ts, src/lib/server/searchEngine/core/koreanTokenizer.ts, src/routes/api/search/products/+server.ts | 결과: 이슈 0건(CRITICAL/BLOCK), 아키텍처 주의 3건, GATE C 미확인 3건(렌더링 템플릿), 정상 영역 다수 ✅
  - AUDIT-2.4(products/new, ProductDetailPanel): /cms/products/[id]/edit 삭제 ✅, childBlockedSections 서버 8개 섹션 가드 ✅, 클라이언트 읽기전용 이중차단 ✅, QR=product_code ✅, generate_product_code 3-param ✅, sale_only 분기 ✅, PAGE-SCOPE-1 ✅, 자가복구 버튼 ✅, is_active $effect 재동기화 ✅. 주의: 전 액션 세션체크만(role 없음, 기존확인항목), as unknown as 캐스팅. GATE C 미확인: QR-HIDE-1/HIST-1/QR-AUTO-1(템플릿 코드).
  - AUDIT-2.5(codes, mobile, search): codes 20개 권한 전수 ✅(19 manager+ / 1 superadmin), mobile 권한 위임체인 ✅, QR-CASE-1(.ilike+escapeLikePattern 양쪽) ✅, productSearchIndex 조회 필터·TTL·invalidate ✅, 하이브리드 전략 ✅, Korean tokenizer ✅. 주의: search/products/+server.ts (supabase.rpc as any)(Frozen), MiniSearch 카테고리 필터 폴백 불일치.

[2026-08-06] AUDIT | 클러스터1(고객접점) AUDIT-2.1/2.2/2.3 검증 완료 | 검증파일: src/routes/cms/chat/+page.server.ts, chat/qna/+page.server.ts, src/lib/components/chat/AdminChatPanel.svelte, src/lib/server/matchCannedResponse.ts, synonymLearning.ts, normalizeKeywords.ts, src/routes/api/cms/canned-responses/*, src/routes/api/chat/message/+server.ts, sessions/+server.ts, admin-reply/+server.ts, src/routes/cms/reservation/+page.server.ts, reservation/contracts/+page.server.ts, src/routes/cms/rentals/+page.server.ts, +page.svelte, src/lib/components/cms/RentalDetailPanel.svelte, src/lib/utils/rentalTransition.ts | 결과: 이슈 0건(CRITICAL/BLOCK), 아키텍처 주의 4건(문서드리프트 1건 포함), 정상 영역 다수 ✅
  - AUDIT-2.1(chat/qna): ANTHROPIC_API_KEY private-env ✅, Realtime cleanup ✅, 세션전이 정합 ✅, is_urgent ✅, 권한가드 전수 ✅, 정형답변엔진 로직 ✅. 문서드리프트: chat.md §3 구버전 기술(2026-07-27 변경 미반영).
  - AUDIT-2.2(reservation/contracts): 권한가드 5개 action 전부 ✅, RPC H-01 ✅, AUTO_NOTIFY 매핑 ✅, 계약서 소프트삭제 ✅. 주의: console.error 2건, atomic_reserve/HOLD는 CMS 범위 밖.
  - AUDIT-2.3(rentals+RentalCard): RentalCard 잔존참조 0건 ✅ 빌드 안전, nextStatus/nextLabel 전환표 전 항목 ✅, isRentalView 분기 ✅, NOTIFY_TYPE_MAP auto/manual 분리 ✅. 주의: RentalDetailPanel 내부 RentalListRow 타입 delivery_fee 누락(타입 드리프트).

[2026-08-06 22:17] 🔴TDD | CRITICAL FIX — CMS 보안 허점 2건 긴급 수정 (SEC-1~4) | 수정: src/routes/cms/accounts/+page.server.ts(createAccount auth guard), src/routes/cms/promotion/rules/+page.server.ts(load+createRule+toggleRule+deleteRule auth guard) | 신규: src/__tests__/server/cmsSecurityGuards.test.ts | 테스트 7개 RED→GREEN PASS | tsc 에러 0건 | 회귀 없음(56/56)
  - accounts/createAccount: ({ request }) → ({ request, locals }) + session 401 + cmsRole 403 + hasSettingsAccess 403 가드 추가
  - rules/load: parent() + hasSettingsAccess → redirect(303) 가드 추가
  - rules/createRule·toggleRule·deleteRule: 동일 패턴 3개 action 전부 적용
  - 변수명 충돌 해결: 기존 form.get('cms_role') → newAccountRole로 명확화 (관리자 인증역할 cmsRole과 분리)
[2026-08-06 20:31] ⚡GSD | FIX-3: loadSynonymGroups() 60초 TTL 캐시 | src/lib/server/synonymLearning.ts | 20분 | GATE C:승인
[2026-08-06 20:31] ⚡GSD | FIX-4: buildCannedResponseIndex() 60초 TTL 캐시 + keySignature 충돌방지 | src/lib/server/searchEngine/adapters/cannedResponseSearchIndex.ts | 25분 | GATE C:승인
[2026-08-06 20:31] ⚡GSD | FIX-5: matchCannedResponse.ts 상단 주석 SYN-9 반영 정정 | src/lib/server/matchCannedResponse.ts | 5분 | ROUTINE 자동완료
[2026-08-06 20:31] ⚡GSD | FIX-6: 상담 세션 closed 재활성화 중복 UPDATE 제거 | src/routes/api/chat/message/+server.ts | 10분 | BOUNDARY 자동완료
[2026-08-06] BUGFIX | CustomerDetailPanel 3종 버그 수정 (채팅상담 미노출·빠른문의 500·채팅 딥링크) |
  src/lib/components/cms/CustomerDetailPanel.svelte,
  src/routes/api/cms/customers/[id]/inquiries/+server.ts,
  src/routes/cms/chat/+page.server.ts,
  src/routes/cms/chat/+page.svelte,
  src/lib/components/chat/AdminChatPanel.svelte | ✅ DONE
  ① 채팅 상담 목록 미노출 — $effect 무한루프(length===0 && !loading 조건이 빈배열/에러 시 재실행)
     → chatSessionsLoaded 플래그로 최초 1회만 호출, 에러 처리(else csToast.error + catch) 추가
  ② 빠른문의 500 에러 + 무한루프 — PostgREST 임베디드 조인(cs_inquiries 관계 자동탐지 실패)
     → /api/cms/customers/[id]/inquiries: 2단계 쿼리(cs_posts→cs_inquiries JS merge)로 교체
     → inquiryPostsLoaded 플래그 추가, 에러 처리 추가
  ③ 채팅 카드 클릭 시 상담채팅 창 빈 화면 — href="/cms/chat"(세션ID 없음)
     → href="/cms/chat?session={cs.id}" 딥링크 추가
     → +page.server.ts: url.searchParams.get('session')→initialSessionId 반환
     → +page.svelte: initialSessionId prop AdminChatPanel에 전달
     → AdminChatPanel: initialSessionId prop 신규, 초기화 $effect에서 자동 필터탭 전환 + handleSelectSession 호출

[2026-08-06 20:22] 🔴TDD | §E SYN-13: 학습 파라미터 DB 설정 테이블 기반 전환 | 파일: supabase/migrations/20260806000200_200_synonym_learning_settings.sql, src/lib/server/synonymLearning.ts, src/__tests__/services/synonymLearning.test.ts | 테스트: 48개 통과 (기존 41개 유지 + SYN-13 신규 6개 + 기존 1개 재카운트) | GATE C:대기
  - synonym_learning_settings 싱글턴 테이블(promote_threshold·similarity_edit_distance_divisor·usage_weight_tiers) 신설
  - RLS service_role 전용, 60초 TTL 캐시(productSearchIndex.ts 패턴 재사용)
  - isSimilarTerm(divisor 옵셔널 파라미터), getOccurrenceWeight(tiers 옵셔널 파라미터) 하위호환 확장
  - FALLBACK_SETTINGS(기존 하드코딩 상수와 동일값) 추가 — DB 조회 실패 시 학습 기능 보호
  - recordSynonymLearning이 loadSynonymSettings()로 DB값 주입 (promote_threshold·divisor·tiers 모두)

[2026-08-06] BOUNDARY FIX | 계정(Account) RPC 타입 에러 10건 수정 | src/lib/types/database.ts,
  src/routes/account/+page.server.ts, src/routes/account/profile/+page.server.ts,
  src/routes/api/profile/upload-doc/+server.ts, src/routes/api/wishlist/+server.ts,
  src/lib/components/members/profile/NotificationTabContent.svelte | ✅ DONE
  배경: Stephen이 svelte-check 사전존재 에러 11건 목록 전달 → 계정 관련 10건(RPC 9종) 확인 후 수정 지시.
  최초 진단(9개 RPC가 database.ts Functions 맵에 미등록)은 부분 원인이었고, 실제 근본 원인은
  src/lib/utils/rpc.ts 주석에 이미 문서화된 별도 기존 이슈였음: supabase-js v2 + TypeScript 6
  조합에서 SupabaseClient<Database>.rpc()의 제네릭 오버로드 해석이 실패 — 정상 동작 중인 다른 RPC
  (register_push_token 등)는 전부 이 우회용 callTypedRpc(client, fn, args) 헬퍼를 통해 호출되고
  있었음. 문제의 10곳은 이 헬퍼 없이 .rpc()를 직접 호출해서 에러가 난 것.
  수정 내용:
    1) database.ts: 마이그레이션 #109/#132~137/#158 기준 9개 RPC(update_user_consent,
       add_shipping_address, delete_shipping_address, set_default_shipping_address,
       update_user_profile, verify_and_update_phone, update_user_doc_url,
       toggle_product_wishlist, update_notification_settings)의 Args/Returns 타입을
       Functions 맵에 신규 등록 (AccountRpcResult/ToggleProductWishlistResult 등)
    2) 위 5개 파일의 10개 직접 .rpc() 호출부를 기존 프로젝트 표준 patturn인
       callTypedRpc(client, 'rpc_name', args)로 교체 — 런타임 로직(파라미터·응답 처리) 무변경,
       타입 해석 방식만 기존 헬퍼 패턴에 맞춤
  범위 외 11번째 항목(products/search/+page.svelte의 noCatIcons prop 타입 불일치)은 계정과 무관한
  별개 사안으로 확인되어 이번 수정에서 제외(Stephen에게 사전 고지 완료)
  검증: npx svelte-check 11 errors → 1 errors (계정 관련 10건 전부 해소, 남은 1건은 위 제외 항목)

[2026-08-06] ⚡GSD | MIGRATION-198-1 | supabase/migrations/20260806000198_198_products_search_vector_extend.sql | GATE C:완료(파일 작성 완료, stage 적용은 Supabase MCP로 Stephen/parent agent 직접 적용 필요)
[2026-08-06] ⚡GSD | PROD-SEARCH-1~4 | adapters/productSearchIndex.ts · /api/search/products/+server.ts · /products/search/+page.svelte · __tests__/server/searchEngine/productSearchLogic.test.ts | GATE C:승인 (§C 전체 완료)
[2026-08-06] ⚡GSD | CORE-1~3 + CHAT-MATCH-1~3 | core/types.ts · core/koreanTokenizer.ts · core/miniSearchProvider.ts · core/createIndex.ts · adapters/cannedResponseSearchIndex.ts · matchCannedResponse.ts | GATE C:승인 (§A §B 전체 완료)
[2026-08-06 18:45] ⚡GSD | SYN-1 (BOUNDARY) | ChatInput.svelte:101 selectCanned() 위치 확인 | 완료
[2026-08-06 18:45] ⚡GSD | SYN-2 | supabase/migrations/20260806000199_199_synonym_groups.sql | GATE C:완료(파일 작성 완료, stage 적용은 Stephen 직접)
[2026-08-06 18:45] ⚡GSD | SYN-3+SYN-4 | synonymLearning.ts(신규), use/+server.ts, ChatInput.svelte, AdminChatPanel.svelte | GATE C:승인
[2026-08-06 18:45] ⚡GSD | SYN-5 | cannedResponseSearchIndex.ts, matchCannedResponse.ts | GATE C:승인
[2026-08-06 19:12] ⚡GSD | SYN-8 | use/+server.ts(학습 제거), ChatInput.svelte(pendingCannedId), AdminChatPanel.svelte(canned_response_id 전달), admin-reply/+server.ts(학습 훅 이동) | GATE C:완료
[2026-08-06 19:12] ⚡GSD | SYN-9 | message/+server.ts(loadSynonymGroups+3번째 arg), synonymLearning.test.ts(SYN-9 3케이스 추가, 총 23개 통과) | GATE C:완료
[2026-08-06 19:36] ⚡GSD | SYN-10+SYN-11 | synonymLearning.ts(isSimilarTerm·levenshtein·USAGE_WEIGHT_TIERS·getOccurrenceWeight 추가, recordSynonymLearning 업데이트), synonymLearning.test.ts(SYN-10 7케이스+SYN-11 6케이스+SYN-4 1케이스 추가, 총 37개 통과) | GATE C:완료
[2026-08-06 20:07] ⚡GSD | SYN-12 | synonymLearning.ts(하드 4자 게이트→길이비례 공식, SIMILARITY_EDIT_DISTANCE_DIVISOR=3 상수 추가), synonymLearning.test.ts(SYN-12 4케이스 추가, 총 41개 통과) | GATE C:완료
[2026-08-06 18:45] ⚡GSD | SYN-6 | src/__tests__/services/synonymLearning.test.ts(신규, 20개 테스트 통과) | GATE C:승인

[2026-08-06] BUGFIX | 채팅 AI 의도분류 모델ID 오류 | src/routes/api/chat/message/+server.ts | ✅ DONE
  Stephen이 stage에서 자동답변 실사용 테스트 중 매칭이 전혀 안 되고 항상 기본 안내문만 나가는 것
  확인. chat_intent_logs 조회 결과 테스트 메시지 3건 전부 intent=CS_ESCALATE/confidence=0(내용과
  무관하게 동일) — Claude API 호출이 매번 실패해 catch 블록의 기본값이 찍히고 있었던 것으로 진단.
  원인: model:'claude-haiku-4-5' → 날짜 접미사 누락(올바른 ID: claude-haiku-4-5-20251001).
  자동답변 기능 자체의 결함이 아니라 그 전 단계인 AI 의도분류 시스템의 기존 버그로 추정 — 맞다면
  자동답변뿐 아니라 이 채팅의 AI 자유응답 전체가 계속 기본 문구만 나가고 있었을 가능성.
  실키 부재로 로컬에서 직접 API 검증은 못함 — 배포 후 재검증 필요.
  [2026-08-06 후속] 로컬 재테스트도 동일 실패 → .env.local의 ANTHROPIC_API_KEY가 12자 플레이스홀더
  값으로 확인(정상 키는 100자+) — 로컬 Claude 호출은 애초에 인증 실패. Stephen에게 실키 교체 안내.

[2026-08-06] REDESIGN | 자동답변 하이브리드 아키텍처 전환 | matchCannedResponse.ts,
  api/chat/message/+server.ts, api/chat/sessions/+server.ts, types/chat.ts, MessageBubble.svelte |
  ✅ DONE (Stephen 지시)
  기존 설계(Claude 의도분류 성공 → 카테고리 스코핑 → 키워드 매칭)를 하이브리드로 전환: 키워드
  매칭을 Claude 호출보다 먼저 실행(1단계, AI/API키 상태와 완전 무관) → 매칭 실패 시에만 기존 AI
  파이프라인(2단계, 원본 로직 그대로)으로 폴백. 근본 문제(자동답변이 AI 분류 성공에 구조적으로
  의존)를 해소 — Claude API 장애 중에도 키워드 매칭 자동답변은 항상 동작.
  matchCannedResponse()에서 intent/카테고리 스코핑 제거(2-인자 순수함수로 단순화), 더 이상
  생성되지 않는 auto_fallback_reply 관련 코드(sessions/+server.ts의 isFallbackPending 긴급배지,
  types/MessageBubble의 타입·분기) 정리.
  트레이드오프 고지: 1단계는 AI 긴급성 판단 이전에 실행되므로 CS_ESCALATE 제외를 구조적으로 적용
  불가 — 파손 카테고리 응답 자체가 안전한 1차 안내문이라 실질 위험 낮다고 판단, Stephen에게 고지.
  검증: vitest 6/6 pass, svelte-check 11 errors/289 warnings(신규 0건). 배포·실키 교체 후 재검증 필요.

[2026-08-06] FEATURE | 고객 매칭 전용 키워드 필드 분리 + 간단 자연어 매칭 | matchCannedResponse.ts,
  CannedResponsePanel.svelte, api/cms/canned-responses/*, normalizeKeywords.ts,
  migrations/197_canned_responses_match_keywords.sql | ✅ DONE (Stephen 지시)
  단축키(관리자 '/' 자동완성 겸용, 값 1개)와 분리된 "매칭 키워드"(다중, 최대 10개) 필드 신설 —
  canned_responses.match_keywords TEXT[] 컬럼 추가(마이그레이션 #197, 파일만 생성·DB 미적용).
  CannedResponsePanel.svelte에 CmsContentEditor 키워드 태그 패턴(IME-safe) 재현.
  매칭 알고리즘에 키워드 신호(+5, 최우선) 추가 + 조사제거·편집거리1 오타허용 완화매칭 도입(순수
  JS, 외부 의존성 없음). 기존 시드 5건은 키워드 없이도 shortcut 신호로 계속 동작(회귀 없음).
  검증: vitest 9/9 pass, svelte-check 11 errors/289 warnings(신규 0건).
  [2026-08-06 후속] 마이그레이션 #197 stage+production 적용 완료(Stephen 지시).
  Stephen이 실제 FAQ 원문 18건(렌탈/회원/파손·분실/기타/결제·환불 라벨) 전달 → DB 5종 카테고리로
  매핑(렌탈 대부분→reservation, 반납지연 1건만 return, 회원·기타→general, 파손·분실→damage,
  결제·환불→payment) 후 항목별 매칭 키워드 2~3개씩 부여해 stage+production 양쪽에 데이터 삽입
  완료(총 23건 = 기존 시드 5 + 신규 18). 스키마 변경 아닌 데이터 삽입이라 마이그레이션 파일
  없이 직접 INSERT로 처리.

[2026-08-06] GSD | QR-1+QR-CONTENT-1+QR-3+QR-4+BND-7+BND-13 일괄 구현 |
  src/routes/cms/mobile/qr/[product_id]/+page.server.ts (QR-1 정렬 수정, QR-CONTENT-1 UUID폴백, QR-3 이력자동기록),
  src/routes/cms/mobile/+page.svelte (QR-CONTENT-1 extractProductId 하위호환),
  src/lib/components/cms/ProductDetailPanel.svelte (QR-CONTENT-1 product_code 렌더링, BND-7 부모QR 블록),
  src/routes/cms/products/+page.svelte (QR-4 다건선택+일괄인쇄),
  .claude/harness/TASK.md (6개 태스크 완료 체크) |
  svelte-check 신규 에러 0건 | GATE C: BOUNDARY — 자동 진행

[2026-08-06] GSD | CODE-SERIES-1~5: 품번 체계 재설계 (부모=code_series 구조저장, 자식=실채번) |
  supabase/migrations/20260806000193_193_code_series_column_and_functions.sql (신규),
  src/routes/cms/products/+page.server.ts (CODE-SERIES-5 게이트 변경) |
  GATE C: CRITICAL — Stephen 확인 대기
  SQL: products.code_series JSONB 컬럼 추가 + generate_product_code 3종 재작성(순번미소모·code_series저장)
       + generate_inventory_product_code 재작성(code_series 기반 순번소모·실채번)
       + auto_create_inventory_for_product 게이트 변경(product_code→code_series)
  TS: cloneProduct add_inventory 게이트 — product_code→code_series 체크, 에러 메시지 정정
  svelte-check 신규 에러 0건 (기존 11건은 미변경 파일의 pre-existing)
  다음: CODE-SERIES-STAGE (stage 적용 + 4종 시나리오 검증 — 메인 세션 처리)

[2026-08-05] GSD | cms/products 정합성 감사 후속조치 완료 — BND-1~12(BND-7/13 보류 제외), RTN-2/3/4/8 |
  +page.server.ts(cms/products), +page.svelte(cms/products), new/+page.server.ts,
  new/+page.svelte, ProductDetailPanel.svelte, CmsSimilarNameInput.svelte,
  migration/20260805000189_189_sync_price_rules_parent_to_children.sql |
  GATE C: BOUNDARY/ROUTINE 자동 완료
  BND-1: 부모 삭제 시 자식 cascade 소프트삭제. BND-2: deleted_at 필터 2곳 추가.
  BND-3: 페이지네이션 count-first → page clamp → range 순서 수정.
  BND-4: toggleStatus 서버 fail(500) + 클라이언트 toast+rollback.
  BND-5: 검색 count/list 쿼리 productSearchOrFilter()로 통일.
  BND-6: 다중 탭 dirty 상태 저장 후 경고 toast.
  BND-8/9: 가격 범위 서버 검증 + 24h 필수 강제(양쪽 등록 경로).
  BND-10: 이미지 업로드 후 autoSave() 제거 → invalidateAll()로 통일.
  BND-11: Storage.move() temp→productId 이관 + URL 갱신.
  BND-12: Migration #189 파일 생성 (stage 적용 Stephen 액션 필요).
  RTN-2: AbortController + signal.aborted 체크.
  RTN-3: add_inventory 모드 slug while-loop 중복 체크.
  RTN-4: assetTotal ?? 0 null-safety.
  RTN-8: updateShippingOptions 중복 액션 제거.
  RTN-1/5: .claude/rules/ 파일 classifier 차단 — Stephen 수동 편집 필요.
  RTN-7: rm -rf classifier 차단 — Stephen 수동 삭제 필요.
  svelte-check: 우리 파일 기준 신규 에러 0건 (기존 11건은 타 파일 pre-existing).

[2026-08-05] GSD | BND-COUNT-1: 상품목록·상세 배지에 상태별 재고 카운트 추가 |
  +page.server.ts(cms/products), +page.svelte(cms/products), ProductDetailPanel.svelte |
  GATE C: BOUNDARY 자동 완료
  rental_reservations 단일 집계 쿼리(N+1 없음) → 자식 id 전체 in() 조건. 버킷: hold=예약중,
  confirmed/shipped=반출중, in_use=대여중, return_requested=반납중, returned/completed=반납완료.
  기존 assetCount/assetTotal 필드 불변. svelte-check 오류 0(내 파일 기준), vitest 회귀 없음.

[2026-08-05] GSD | CMS 상담 QnA 이관+재구축 + 자동답변 신규 | cms/chat/qna/*, api/chat/message,
  api/chat/sessions, api/cms/auto-reply-settings, types/chat.ts, MessageBubble/List/AdminChatPanel |
  ✅ DONE (plan mode 승인: cms-chat-qna-wise-lantern.md)
  빠른답변 화면을 CMS 설정 → 상담 QnA 서브메뉴로 이관, master-detail 구조로 전면 재구축(검색·정렬·
  전체내용 미리보기·단축키 미리보기 추가). 자동답변 신규: 전역 스위치(매니저 이상만 조작) ON +
  CS_ESCALATE 아니면 고객 메시지를 canned_responses와 키워드 스코어링 매칭(score>=3 임계값, AI 추가
  호출 없음) → 매칭 시 즉시 발송, 미매칭 시 안내문 발송+긴급배지.
  오케스트레이터 재검증 중 발견·수정한 문제: (1) 초안 구현이 자동답변을 기존 free-form AI 응답에
  "추가"로 붙여보내 고객이 봇 메시지 2건을 받는 상태였음 → 단일 insert로 대체하도록 재작성(플랜의
  "대체이지 병행 아님" 원칙 복원), (2) usage_count 증가가 비원자적 read-then-write로 구현돼 Phase
  1-1에서 만든 race-condition 방지 RPC를 무력화 → RPC 호출로 복원, (3) CSS 하드코딩 rgba 2건 →
  기존 토큰(--cs-purple-op10)으로 교체 + position:relative 누락으로 인한 배지 레이아웃 버그 수정,
  (4) qna/+page.server.ts가 security-auth.md 문서화된 load 함수 컨벤션(parent() 사용)과 다르게
  locals.cmsRole을 직접 참조하던 것 정정.
  matchCannedResponse.ts 순수함수에 단위테스트 7건 신규 추가(고객에게 확인 없이 바로 나가는
  자동화 로직이라 GSD임에도 안전망으로 작성).
  검증: npx svelte-check 11 errors(베이스라인 동일)/299 warnings(+3, 동시 진행 중인 별도 세션의
  무관 파일 증가로 인한 스캔대상 확대분 — 실질 문제 아님 확인), vitest 7/7 pass.
  [2026-08-05 후속] 마이그레이션 #186 stage 적용 완료(Stephen 지시), 싱글톤 행 확인. Production
  미적용 — 별도 확인 후 진행.

[2026-08-05] GSD | Phase 1-1 캔드 리스폰스(빠른답변 라이브러리) | canned_responses 테이블 +
  api/cms/canned-responses + ChatInput.svelte + cms/set/canned-responses | ✅ DONE
  Stephen GATE B 승인 사항: 카테고리 5종(반납/결제/예약/파손/일반) 확정, 편집권한은 파트너 포함
  전체 cms_role(매니저 제한 없음)로 확정
  구현: canned_responses 테이블+RLS(is_cms_user())+시드5건, CRUD API 3개 라우트,
  ChatInput.svelte isAdmin prop(기본 false — 사용자 화면 무영향)로 `/` 트리거 드롭다운(단축키
  우선매칭→텍스트검색, 키보드 탐색), 선택 시점에 usage_count 증가, CMS 관리화면
  오케스트레이터 재검증 중 발견·수정한 문제 3건:
    · 마이그레이션 번호 충돌 — 동시 진행 중이던 별도 세션(push notification 기능)이 이미
      #181~184를 선점해 #184에서 충돌 → #185로 재번호
    · CMS 경로 컨벤션 불일치 — 플랜 원문 `/cms/settings/*`가 기존 `/cms/set/*` 컨벤션과
      어긋나 `/cms/set/canned-responses`로 이동 정정
    · 카테고리 배지 하드코딩 hex 5종 → CSS 변수(--cs-orange/--cs-info/--cs-purple/--cs-error/
      --cs-text-mid)로 치환
  검증: npx svelte-check 11 errors/296 warnings(베이스라인과 동일, 신규 0건)
  미완료: 마이그레이션 #185 stage/production 미적용(Stephen 확인 대기)

[2026-08-05] ⚡GSD | 체크아웃 대여예약옵션 통합 단일 정책 전환 (TASK-A~F) | src/routes/checkout/+page.svelte | GATE C: 정적검증 완료
  TASK-A: bulkApplied/resetBulkSettings/CardAccordion/toggleAcc/selectedCartItemId/detailOpenAcc 전체 제거
  TASK-B: RentalOptionsEditor 스니펫 추출 (클로저 기반, 인자 없음)
  TASK-C: PC detail-pane 조건 panelOpen→hasItems, ItemDetailPanel 삭제→RentalOptionsEditor 교체
  TASK-D: OrderCard 개별 아코디언 제거, bulk-panel {#if hasItems} 래핑, 제목 "대여예약옵션"
  TASK-E: .accordions.bulk-locked CSS 삭제, .bulk-panel PC hide 미디어쿼리 추가, 죽은 CSS 3건 삭제
  TASK-F: 결제 확정 핸들러 코드 무변경, 정합 정독 완료
  svelte-check: 11 errors / 296 warnings (기준선 동일, 신규 에러 없음)
  계획과 다른 점: selectedCartItemId = item.id 대입이 ItemListCard onclick에 잔존(계획서 "이미 없음"과 달리) → TASK-C4에서 함께 제거

[2026-08-04] GSD+TDD | 채팅 시스템 고도화 플랜 Phase 0 — 채팅 알림 기반 결함 9건 정리 | 상세 아래 | ✅ DONE (마이그레이션 stage 적용 대기)
  배경: `/Users/stevenmac/.claude/plans/enumerated-wandering-bentley.md` Phase 0 착수 지시 →
    @harness-executor로 B-START 편입(TASK.md NOW 섹션 생성) → GATE B(CRITICAL 3건) Stephen 승인 후
    sp2-tdd-agents 2세션 + harness-executor 1세션 병렬 실행(각기 다른 파일 담당, TASK.md 충돌
    방지 위해 오케스트레이터가 사후 일괄 반영)
  🔴 CRITICAL (TDD, sp2-tdd-agents):
    - BL-CHAT-C3: src/routes/api/contracts/[token]/sign/+server.ts — 계약서명 완료 시
      rental_reservations 직접 UPDATE(H-01 위반) → update_reservation_status RPC 경유로 수정
      (상태 조회 후 shipped일 때만 호출, 기존 가드 보존) + 채팅세션 조회 pending→open→
      closed재활성화→신규생성 4단계로 확장(알림 유실 방지). RED 5케이스(contractSign.test.ts 신규)
    - BL-CHAT-C4: src/routes/api/checkout/confirm-mock/+server.ts — reservationIds 미전달 시
      무관한 과거 hold 예약까지 일괄승인되는 하위호환 fallback 제거, 즉시 400 반환으로 변경.
      실호출부(checkout/+page.svelte) 항상 reservationIds 전달 확인, 회귀 없음. RED 5케이스
      (confirmMock.test.ts 신규)
    - BL-CHAT-B4: 계약 발송/서명 세션 재사용 정책 위반 — send-chat 쪽은 재조사 결과 이전
      세션에서 이미 4단계 폴백이 구현되어 있어 수정 불필요, sign 쪽은 C3 수정으로 해결
  🟡 BOUNDARY (GSD):
    - BL-CHAT-B1+B3: supabase/migrations/20260804000180_180_fix_send_rental_chat_notification_
      content_context.sql(신규, DB 미적용) — send_rental_chat_notification RPC CREATE OR REPLACE:
      reservation_hold/reservation_approval/rental_confirm 알림 본문 텍스트 추가(B1) +
      context_type 우선 매칭 세션탐색 4단계(1순위 context일치→2순위 any open/pending 폴백→
      3순위 closed재활성화→4순위 신규생성, B3)
    - BL-CHAT-B5: src/lib/components/cms/RentalDetailPanel.svelte — 수동 알림버튼 5분 TTL
      중복발송 가드(window.confirm 경고, 완전차단 아닌 관리자 인지형)
  🟢 ROUTINE (GSD):
    - BL-CHAT-R1: api/chat/action-card/+server.ts 삭제(존재하지 않는 is_admin 컬럼 참조 죽은
      코드) + chatService.ts sendActionCard()/types/chat.ts SendActionCardRequest 함께 제거
    - BL-CHAT-R2: api/chat/sessions/+server.ts — page/limit 페이지네이션 추가 + 세션별 개별쿼리
      N+1 → 단일 .in() 쿼리로 해소
    - BL-CHAT-R3: cms/reservation/+page.server.ts — AUTO_NOTIFY['confirmed'] 도달불가 데드코드 제거
  검증(오케스트레이터 재확인): `npx svelte-check` 11 errors/296 warnings(베이스라인과 동일, 신규 0건),
    `npx vitest run contractSign.test.ts confirmMock.test.ts` 10/10 pass
  [2026-08-04 후속] 마이그레이션 #180 stage→production 적용 완료(Stephen 지시). stage 적용 중
    실제 런타임 버그 발견: v_context_type(TEXT) vs chat_context_type_enum 컬럼 직접 비교 시
    "operator does not exist" 오류 → `::chat_context_type_enum` 명시 캐스트 추가로 수정(로컬
    마이그레이션 파일 동기화 완료). stage/production 양쪽 BEGIN/ROLLBACK으로 실호출 검증 후 적용.
    플랜 Phase 1~4는 여전히 미착수(범위 밖)

[2026-07-27] PLANNING | 채팅 시스템 고도화 플랜 최종검증 + 하네스/디자인시스템 보완 반영 | 계획 문서만 수정, 코드 미착수 | ✅ DONE
  배경: 채널톡 심층분석·엄선 반영한 플랜(v4)이 "하네스 플로 시스템" 및 "CMS 표준 디자인 시스템"
    기준으로 실행 준비가 됐는지 최종 검증 요청 → 검증 결과 2가지 보완점 발견 후 즉시 반영
  검증 결과:
    - 하네스 편입 공백: 플랜이 `.claude/plans/*.md`(Claude 네이티브 Plan 산출물)로만 존재해
      AGENTS.md 원칙상 TASK.md·GATE 구조 미생성 상태였음 확인
    - GATE 등급·TDD/GSD 도메인 분류 누락 확인
    - 디자인시스템 대조: 태그 색상 6종·세그먼트 뱃지 조합은 실제 --cs-* 토큰과 전부 일치 확인(문제 없음)
    - 3패널 레이아웃(Phase 3-1) 확장 시 cms-uiux.md의 필수 CSS 구조 체크리스트 미언급 확인
    - 이번 세션에서 이미 구현한 "긴급" 배지(.urgent-badge)가 문서화된 표준 .badge-* 패턴
      (ProductDetailPanel.svelte .badge-active에서 실사용 확인)을 따르지 않는 것 확인
  반영 내용 (plan 파일 `/Users/stevenmac/.claude/plans/enumerated-wandering-bentley.md` v4→v4.1):
    - §4-1-2(태그 시스템)에 "`.urgent-badge` 폐기 → 표준 `.badge-*` 패턴 재사용" 명시 추가
    - §4-3-1(컨텍스트 패널)에 3패널 레이아웃 필수 CSS 체크리스트 4항목 추가
    - 신규 §9 "하네스 플로 GATE·TDD/GSD 분류표" 추가 — 20개 항목 전체 사전 분류(CRITICAL 14 /
      BOUNDARY 5 / TDD 후보 4) + 하네스 편입 다음 단계 절차 명시
  하네스 시스템 반영:
    - TASK.md BACKLOG에 "PLAN-CHAT-UPGRADE" 항목 신규 등록(플랜 위치·규모·GATE분류 요약·
      @harness-executor 편입 필요 안내 포함) — 향후 세션에서 이 플랜이 발견 가능하도록 함
  본 작업은 계획 문서 보완 및 하네스 등록뿐이며, 실제 코드/DB 변경은 없음. Phase 0부터
  @harness-executor를 통한 정식 착수가 다음 단계.

[2026-07-28] BOUNDARY | /payment/success/dev 다중 상품 목록 + 요금 분해 카드 재구현 | 3개 파일 수정 | ✅ DONE
  checkout CTA: items JSON + 요금 분해 6개 파라미터 전송 (구 단일상품 파라미터 제거)
  success/dev/+page.ts: SuccessItem 인터페이스 + items 파싱 + 구 폴백 유지
  success/dev/+page.svelte: {#each data.items} 상품 카드 × N + 결제내역 분해 카드 + option-chip
  수정 파일: src/routes/checkout/+page.svelte · src/routes/payment/success/dev/+page.ts · src/routes/payment/success/dev/+page.svelte

[2026-07-28] BOUNDARY | /cms/rentals 대여현황 Realtime 실시간 갱신 | 2개 파일 수정 + 마이그레이션 1개 | ✅ DONE
  rental_reservations 테이블 supabase_realtime 퍼블리케이션 등록 + REPLICA IDENTITY FULL 설정
  Migration 177 — stage(ezyvffjvuwmtuhpxdjrw) 적용 완료 · production 대기 (Stephen 확인 필요)
  +page.svelte: supabase.channel('cms-rentals-realtime').on('postgres_changes') 구독 추가
  $effect cleanup: supabase.removeChannel(channel) 처리
  수정 파일: src/routes/cms/rentals/+page.svelte
  신규 파일: supabase/migrations/20260728000177_177_enable_realtime_rental_reservations.sql

[2026-07-27] BOUNDARY | CMS 계약서 탭 편집 제한 정책 + PDF 뷰어 조건 보강 + Dead CSS 정리 | 1개 파일 수정 | ✅ DONE
  편집 버튼 조건: !signingsentAt && !customerSignedAt — 발송 또는 서명 완료 시 숨김
  미리보기 & 발송 버튼: 조건 없이 항상 표시 (재발송 용도 유지)
  PDF 뷰어·다운로드: contractPdfUrl && customerSignedAt — 서명 완료 후에만 표시
  서명 링크 확인 ↗: signingUrl && !customerSignedAt — 서명 완료 후 자동 숨김 (기존 동일)
  Dead CSS 5개 선택자 제거: .pdf-placeholder / .pdf-placeholder p / .btn-action 계열 3개
  rental-lifecycle.md: 편집 제한 정책 섹션 추가 + GATE C 4개 항목 추가 (v1.2)
  sp3-qa-agent GATE C 검수: PASS, GATE E 통과
  수정 파일: src/lib/components/cms/RentalContractViewer.svelte

[2026-07-27] CRITICAL FIX+BOUNDARY | CMS 자식 패널 데이터 정합 보완 (부모 기준 전면 통일) + 헤더 패딩 버그 수정 | src/lib/components/cms/ProductDetailPanel.svelte, src/routes/cms/products/+page.server.ts | ✅ DONE
  배경: "CMS 대표/자식 상품 ProductDetailPanel 정보 관리 전면 정비"(bd36b8a, 이미 stage→main 배포 완료)
    커밋 이후, 동일 세션에서 Stephen이 이어서 발견·요청한 후속 3건
  ① 자식 패널 헤더 패딩 누락 버그: 과거 리팩터링에서 ph-code-row/ph-body를 감싸던
     .panel-header 래퍼(padding 16px 20px 14px + border-bottom)가 마크업에서 빠졌는데
     CSS 규칙만 고아로 남아 실제 패딩이 전혀 적용되지 않고 있었음 — 썸네일·제목·QR이
     카드 가장자리에 딱 붙어 렌더링되던 것을 발견해 수정. 패딩을 ph-code-row(상단)와
     ph-body(하단+구분선)로 분리 이관, 죽은 .panel-header 규칙 삭제.
  ② 자식 패널 데이터가 여전히 자식 자신의 행을 조회하던 버그(핵심): 옵션상품 탭에서
     "부모가 수정한 옵션이 자식에 반영 안 됨"을 Stephen이 발견. 원인은 편집은 이미
     부모에서만 가능하도록 잠갔는데(이전 커밋), 조회 로직은 여전히 자식 자신의 id로
     get_product_option_links/price_rules/allowed_*_ids/shipping_*/sale_*/content_blocks/
     keywords/components/specifications를 가져오고 있었던 것 — 이미지(image_urls)만
     예외적으로 부모 기준이었고 나머지는 전부 누락 상태였음.
     수정: +page.server.ts에서 자식 선택 시 parent_product_id로 부모 행을 한 번에 조회해
     위 전 항목을 부모 데이터로 override. 자산(assets)은 재고 단위 고유값이라 그대로
     selectedId(자식 자신) 기준 유지.
  ③ Stephen 후속 지시 "이력 탭 제외 전부 부모 정보 반영"에 따라 기본정보 탭의 이름·
     브랜드·카테고리·상품카피·슬러그까지 동일 원칙으로 확장(parentRow select에 컬럼 추가
     + selectedProduct override). 단 노출상태(is_active)는 AskUserQuestion으로 Stephen께
     직접 확인 후 자식 고유값으로 유지 확정 — 아코디언 토글 스위치가 실제로 조작하는
     자식 자신의 재고가용 상태이기 때문에 부모 값으로 덮으면 패널 배지와 토글 스위치가
     서로 다른 상태를 보여주는 모순이 생김. 품번·QR·자산·이력도 기존과 동일하게 유지.
  검증: 실브라우저(SONY PXW-Z90 부모 / CSCMRall007 자식)로 옵션 2건·가격(25,000/30,000)·
    사양 11건·대여정책·상품설명·기본정보(이름/브랜드/카테고리/슬러그)가 전부 부모 값으로
    자식 패널에 동일 반영되는 것 확인, 노출상태만 자식 자신의 값(true)으로 분리 유지됨을 확인.
  svelte-check: 신규 ERROR 0건 (기존 11 errors 그대로 유지)

[2026-07-27] QA | sp3-qa-agent GATE C 검수 — QA 후속 4건 처리분 | 8개 파일 | ✅ 통과 (GATE E 진행 가능)
  검수 대상: 결제 알림 idempotent 가드, 카드 승인번호 표시, 긴급 배지, chat_intent_logs
    service_role 수정, 타입 정의 보강, rental-lifecycle.md 문서 갱신
  결과: console.log/any/TODO/빈catch 0건, svelte-check 신규 에러 0건, 보안·RLS 문제 없음,
    지정 확인사항 5건 전부 이상 없음. 참고용 비차단 권고 1건(세션 목록 조회 쿼리 수 증가 —
    세션 규모 커지면 단일 쿼리/뷰로 통합 검토 권장, 지금은 문제 아님)
  수정 필요 항목: 없음

[2026-07-27] BOUNDARY FIX | QA 후속 개선 4건 + 숨어있던 의도분류 로그 미적재 버그 발견·수정 | 8개 파일 수정 | ✅ DONE
  배경: 직전 QA 검수에서 나온 후속 권장 4건을 Stephen이 전부 진행 지시
  1) 결제 승인 알림 중복 발송 방지 + 카드 승인번호 노출
    - src/routes/api/payment/confirm/+server.ts, src/routes/payment/success/+page.server.ts:
      RPC가 idempotent(재시도) 응답 시 채팅 알림 재발송하지 않도록 가드 추가
    - src/lib/components/cms/RentalDetailPanel.svelte: 결제정보 탭에 "카드 승인번호"
      (Toss 응답의 card.approveNo) 행 추가 — 기존 주문번호·승인시간·Toss 승인코드 옆에 배치
  2) 상담세션 "긴급" 배지
    - src/routes/api/chat/sessions/+server.ts: 관리자 응답 없이 마지막 고객 메시지가
      CS_ESCALATE로 분류된 세션에 is_urgent 플래그 계산 추가
    - src/lib/components/chat/AdminChatPanel.svelte: 카드 제목 우측에 "긴급" 배지 노출
    - src/lib/types/chat.ts: ChatSession.is_urgent 필드 추가
    - 구현 중 발견: chat_intent_logs 테이블이 서비스 계정 전용 RLS로 잠겨 있는데
      /api/chat/message가 일반 세션 클라이언트로 INSERT를 시도해 지금까지 단 한 건도
      적재되지 않고 있었음(테이블 row count 0, 에러도 조용히 무시됨) — 이 기능의
      직접적인 선행 결함이라 이번에 함께 수정: src/routes/api/chat/message/+server.ts에서
      해당 INSERT만 service_role 클라이언트로 교체
  3) rental-lifecycle.md 문서 갱신
    - 자동발송(AUTO_NOTIFY) 표 신규 추가 + 수동버튼(NOTIFY_TYPE_MAP) 표와 명확히 분리
    - in_use 상태에서 자동(rental_confirm) vs 수동(return_remind)이 다른 이유 명시
    - 상담채팅 세션 대기 재진입 조건(1시간 무응답 전용) + 긴급 배지 로직 문서화
    - GATE C 체크리스트 3항목 추가, 문서 버전 v1.2 → v1.3
  4) 타입 정의 누락 해결
    - src/lib/types/chat.ts ActionCardType 유니언에 'reservation_hold', 'rental_confirm' 추가
  검증:
    - svelte-check 신규 에러 0건 (기존 11 errors 유지)
    - 브라우저 실측: CS_ESCALATE 유발 메시지 전송 → chat_intent_logs 적재 확인(DB 직접 조회) →
      상담세션 목록에 "긴급" 배지 정상 노출 확인
    - 결제정보 탭(결제 전 예약) 정상 렌더링 확인 — 카드 승인번호 행은 실 결제 데이터 없어
      코드 경로만 확인(기존 승인코드 행과 동일 패턴 재사용이라 위험 낮음)

[2026-07-27] BOUNDARY | /cms/set/rental 대여방식 method_key 선택 UI 구현 + Migration #175 | 3개 파일 수정/신규 | ✅ DONE
  파일:
    NEW  supabase/migrations/20260727000175_175_add_method_key_to_upsert_rpc.sql
    MOD  src/routes/cms/set/rental/+page.server.ts
    MOD  src/routes/cms/set/rental/+page.svelte
  내용:
    - Migration #175: upsert_rental_method_option RPC에 p_method_key TEXT DEFAULT NULL 파라미터 추가
      (INSERT 시 method_key 저장, UPDATE 시 COALESCE로 기존 값 보존, 빈 문자열→NULL 처리)
    - +page.server.ts: RentalMethodOption.method_key 필드 추가, select 쿼리 확장, addMethod 액션 파싱
    - +page.svelte: METHOD_KEYS(5종) 콤보칩 선택 UI, usedMethodKeys $derived 비활성 처리,
      기존 방식 목록에 method_key 배지(METHOD_KEY_LABELS 변환) 표시, epost→'택배(구)' 레거시 대응
  DB 적용: Stage(ezyvffjvuwmtuhpxdjrw) ✅ → Production(vnbpmvxruyciuuaermyh) ✅ (Stephen 명시 승인)
  svelte-check: 신규 ERROR 0건

[2026-07-27] BOUNDARY FIX | 전자계약 서명 완료 알림 세션 선택 pending 우선순위 적용 | 1개 파일 수정 | ✅ DONE
  파일: src/routes/api/contracts/[token]/sign/+server.ts
  원인: 서명 완료 채팅 알림이 open 세션만 조회 → pending(관리자 대화 중) 세션에 알림 미전달
  수정: send-chat API와 동일한 pending → open 2단계 우선순위 쿼리로 교체 (88-109행)
  Vercel 배포: e428c9f stage ✅

[2026-07-27] BOUNDARY FIX | CMS 상담채팅 목록카드 점멸 애니메이션 재검증 + 강화 | 1개 파일 수정 | ⚠️ Stephen 재확인 대기
  배경: Stephen이 목록카드 점멸 애니메이션이 동작하지 않는다고 재보고
  검증: 새 메시지 도착 시 카드에 flash 클래스가 정확한 시점에 붙었다 떨어지는지 브라우저
    DOM 변화 감지(MutationObserver)로 직접 확인 → 클래스 부착·해제 자체는 정상 동작 확인.
    CSS 애니메이션 설정(지속시간·반복횟수·키프레임 매칭)도 브라우저 계산 스타일로 직접 대조해
    전부 정상 연결 확인. 코드 레벨에서는 결함을 찾지 못함.
  조치: 원인이 "색상 대비가 옅어 놓치기 쉬움" 가능성이 높다고 판단 → 애니메이션을
    배경색 변화 단독 → 배경색 + 좌측 강조 보더(기존 CMS "child-readonly-notice"에서
    쓰던 것과 동일한 옅은보라 배경 + 보라 보더 조합) 2중 신호로 강화, 지속시간도
    0.5초→0.6초(총 1.5초→1.8초)로 소폭 연장
  파일: src/lib/components/chat/AdminChatPanel.svelte
  svelte-check: 신규 에러 0건 (기존 11 errors 유지)
  Stephen 실환경 재확인 요청 — 여전히 안 보이면 다른 원인(예: 다른 탭/창에 가려짐 등) 추가 확인 필요

[2026-07-27] VERIFY | CMS 상담채팅 종료 탭 실시간 반영 확인 | 코드 수정 없음 | ✅ DONE (정상 확인)
  확인 방법: 관리자 브라우저 세션 2개로 재현 — 한쪽에서 세션 종료 처리, 다른 쪽 화면을
    새로고침 없이 관찰
  결과: 종료 처리한 세션이 새로고침 없이 다른 관리자 화면의 "종료" 탭 최상단에 즉시 노출,
    탭 숫자(진행중/대기/종료)도 함께 정확히 갱신됨을 확인. 기존에 이미 구현되어 있던
    세션 상태 실시간 구독 로직이 종료 탭에도 그대로 적용되고 있어 별도 수정 불필요.

[2026-07-27] BOUNDARY FIX | CMS 상담채팅 대기→진행중 자동 이동 + 카드 점멸 애니메이션 | 3개 파일 수정 | ✅ DONE (브라우저 실검증 완료)
  요청: 대기 탭 목록도 실시간 반영되는지 확인 + 대기 탭 세션에 새 메시지(수신/발신) 발생 시
    진행중 탭으로 자동 이동 + 목록카드에 옅은 색상 점멸 애니메이션(3회) 적용 + 진행중 탭 숫자 반영
  해결:
    - src/routes/api/chat/message/+server.ts: 세션이 대기/종료 상태였다면 새 메시지 도착 시
      AI 판단과 무관하게 무조건 진행중(open)으로 전환하도록 수정. 대기 상태는 이제
      1시간 무응답 자동전환(auto_pending_inactive_sessions) 경로로만 재진입.
    - src/lib/components/chat/AdminChatPanel.svelte: 새 세션 등장·새 메시지 도착 시
      해당 카드에 옅은 보라 점멸 애니메이션(0.5초 x 3회) 적용, 1.5초 후 자동 해제
  검증 중 추가 발견·수정: 최초 구현 시 "진행중으로 이동은 되지만 바로 다음 메시지에서
    AI가 다시 담당자연결 필요로 판단하면 즉시 대기로 되돌아가는" 충돌 확인 →
    새 메시지 도착 시 진행중 유지가 항상 우선하도록 로직 정리해 재검증 완료
  svelte-check: 신규 에러 0건 (기존 11 errors 유지)
  검증: 브라우저 2개 세션으로 실제 메시지 송수신 → 대기(17→16)·진행중(5→6) 카운트 정확히 반영,
    세션이 대기 목록에서 사라지고 진행중 목록 최상단에 새 내용으로 즉시 노출됨을 확인.
    재전송 테스트로 진행중 유지(되돌아가지 않음)도 재확인 완료.

[2026-07-27] BOUNDARY FIX | CMS 상담채팅 세션 목록 실시간 미반영 수정 | 2개 파일 수정 | ✅ DONE (브라우저 실검증 완료)
  증상: /cms/chat 좌측 "상담 세션" 목록에서 새 메시지가 오가도 목록의 마지막 메시지 미리보기·
    순서가 그 자리에서 갱신되지 않음. 우측 대화창(선택된 세션 내부)은 정상 실시간 반영됨.
  원인: 세션 목록은 세션 상태 변경에는 실시간 반응하도록 연결돼 있었으나, 그 처리 로직이
    마지막 메시지 미리보기·발신자 정보는 화면 진입 시 불러온 값 그대로 유지하도록 되어 있었음
    (메시지가 와도 목록 카드 내용·정렬 순서는 5분 주기 자동 새로고침 전까지 갱신되지 않던 상태).
  해결: 우측 대화창에 이미 쓰던 "새 메시지 실시간 수신" 방식을 좌측 목록에도 동일하게 연결 —
    새 메시지가 도착하면 해당 세션 카드의 미리보기 문구를 즉시 갱신하고 목록 맨 위로 올리도록 처리.
    - src/lib/services/chatService.ts: 전체 메시지 실시간 구독 함수 추가
    - src/lib/stores/chat.svelte.ts: 새 메시지로 세션 미리보기 갱신 + 재정렬 함수 추가
    - src/lib/components/chat/AdminChatPanel.svelte: 위 구독을 화면에 연결
  svelte-check: 신규 에러 0건 (기존 11 errors 유지)
  검증: 브라우저에서 실제 관리자 답변 전송 → 좌측 목록 카드의 미리보기 문구·시간이 새로고침 없이
    즉시 갱신됨을 DOM 상태로 직접 확인 완료

[2026-07-27] CRITICAL FIX | "대여확인" 채팅 알림 타입 신규 추가 (BL-CHAT-C2) | 신규 마이그레이션 1개 + 2개 파일 수정 | ✅ DONE (Stage+Production 적용 완료)
  배경: 직전 감사에서 발견한 4개 CRITICAL 중 두 번째로 Stephen이 지목한 BL-CHAT-C2 처리 요청.
    Stephen이 요청한 알림 시퀀스(예약신청→승인→계약발송→대여확인→택배→반납요청→반납완료)에서
    "대여확인"(상품 수령·대여시작 확인) 단계에 대응하는 알림 타입이 코드에 아예 없었음 —
    in_use 진입 시 자동 발송되는 유일한 타입은 return_remind("반납 예정")뿐이었음.
  해결:
    · supabase/migrations/20260727000174_174_add_rental_confirm_notify_type.sql 신규 생성
      → send_rental_chat_notification RPC의 v_content CASE에 'rental_confirm' 분기만 추가
        (기존 4개 분기 무변경, CREATE OR REPLACE 전체 재발행 — 기존 마이그레이션 파일 직접 수정 아님)
      → v_card_type은 기존 ELSE p_notify_type 경로를 그대로 타서 별도 분기 불필요
        (reservation_hold/reservation_approval과 동일한 패턴)
    · src/routes/cms/reservation/+page.server.ts: AUTO_NOTIFY['in_use']를 'return_remind' →
      'rental_confirm'로 교체. cms/rentals의 수동 "반납 예정 알림 💬" 버튼(NOTIFY_TYPE_MAP)은
      그대로 return_remind를 사용하도록 미변경 — 대여시작 확인과 반납예정 리마인드를 별개 이벤트로 분리
    · src/lib/components/chat/ActionCard.svelte: case 'rental_confirm' 추가 ("대여 정보 확인" 라벨)
  부수 해결: BL-CHAT-B6(return_remind가 대여시작 즉시 발송되어 "반납 예정" 라벨과 실제 동작이
    불일치하던 문제)도 AUTO_NOTIFY 교체로 함께 해소됨 — return_remind는 이제 관리자가 실제
    반납 임박 시점에 수동으로만 보내는 용도로 의미가 정리됨. (단, 반납일 임박 자동 cron 리마인드
    자체는 여전히 없음 — 별도 미해결 항목으로 남김)
  DB 적용: Stage(ezyvffjvuwmtuhpxdjrw) ✅ 적용 + pg_get_functiondef로 rental_confirm 포함 검증 완료
    Production(vnbpmvxruyciuuaermyh) ✅ Stephen 승인 후 적용 + 동일 방식 검증 완료 (2026-07-27)
  svelte-check: 신규 에러 0건 (기존 11 errors 유지, 수정 파일 무관)
  TASK.md BACKLOG BL-CHAT-C2/B6 항목 갱신

[2026-07-27] CRITICAL FIX | 실결제(Toss) 확인 경로 예약승인 채팅 알림 누락 수정 (BL-CHAT-C1) | src/routes/api/payment/confirm/+server.ts, src/routes/payment/success/+page.server.ts | ✅ DONE
  배경: 직전 "CMS 상담채팅 대여 라이프사이클 알림 정합성 정밀 감사"에서 발견한 4개 CRITICAL 항목 중
    Stephen이 최우선으로 지목한 BL-CHAT-C1 처리 요청
  원인: `confirm_payment_and_update_reservation` RPC 및 이를 호출하는 두 실결제 경로 어디에도
    `send_rental_chat_notification` 호출이 없어, 실제 Toss 결제가 성공해도 사용자에게
    "예약 승인" 채팅 알림이 전혀 발송되지 않는 상태였음(현재 Mock 체크아웃 경로에만 존재).
  해결: `api/checkout/confirm-mock/+server.ts`가 이미 쓰고 있던 패턴(RPC 성공 직후
    `send_rental_chat_notification(reservation_approval)` 호출, 알림 실패는 결제 확정 성공 여부에
    영향 주지 않도록 await만 하고 에러 무시)을 실결제 경로 2곳에 동일하게 이식:
    · `api/payment/confirm/+server.ts` — `confirm_payment_and_update_reservation` 성공 응답 직후 추가
    · `payment/success/+page.server.ts` — 동일 RPC 성공 확인 직후, 예약/상품 상세 조회 이전에 추가
  비고: 두 경로 모두 현재 체크아웃 UI가 호출하지 않는 미연결 상태(실 Toss SDK 연동은 M3 예정,
    현재는 confirm-mock 경로만 라이브)라 즉시 사용자 영향은 없으나, S1-M3에서 실 결제를 이
    경로들에 다시 연결하는 순간 알림 로직이 이미 준비되어 있도록 선제 수정.
  svelte-check: 신규 에러 0건 (기존 11 errors 그대로 유지, 수정 파일 무관)
  TASK.md BACKLOG BL-CHAT-C1 항목 완료로 갱신

[2026-07-27] BOUNDARY | 예약 카트(/checkout) 체크박스 기본 체크 + 체크 해제 시 결제 확정 대상에서도 제외 | src/routes/checkout/+page.svelte, src/routes/api/checkout/confirm-mock/+server.ts | ✅ DONE
  배경: Stephen 요청 2건 (연속) — ① 상품별 선택 체크박스 기본 체크 상태 + 체크 해제 시 "약정요금" 합계에서
    제외, ② 체크 해제 시 실제 결제 확정(confirm-mock) 대상에서도 제외
  해결:
    · `newItemState()` 기본값 `checked: false` → `checked: true`
    · 약정요금 관련 계산(대여료 소계·멤버십 할인·배송비·보증금·총 대여기간)을 전부
      `!it.deleted && it.checked` 조건으로 재작성 — 서버 RPC 합계(sd.calcTotal 등, 체크 상태를
      알 수 없음) 대신 카드에 이미 표시 중인 것과 동일한 방식(itemRate24h/12h + cardRate)으로
      체크된 항목만 클라이언트에서 합산
    · `hasItems`/`datesSet` 조건도 checked 기준으로 정합화 — 체크 해제한 상품은 카트에 남아있어도
      "선택된 상품 없음"/날짜 필수 조건에서 제외되도록 수정 (그대로 두면 화면 합계·CTA 상태가
      실제 제출 대상과 어긋나는 모순이 생김)
    · footer CTA 클릭 시 `checkedIds = itemsState.filter(!deleted && checked).map(id)`를
      `/api/checkout/confirm-mock`에 `{ reservationIds }`로 전송하도록 변경
    · `confirm-mock/+server.ts`: `reservationIds` 파라미터를 받아 해당 목록만
      `.in('id', ids)`로 필터링 후 confirmed 처리 (미전달 시 하위호환으로 전체 hold 확정 유지,
      빈 배열 전달 시 즉시 0건 응답)
  검증: svelte-check 에러 0건(신규 없음). 브라우저 자동화 도구가 이번 세션 후반부터 간헐적으로
    응답 없음("Browser pane is currently hidden")을 반복해 체크박스 클릭 → 합계 변화 → 결제 확정
    시 실제로 체크된 예약만 confirmed로 바뀌는지의 실측 클릭 검증은 완료하지 못함. 로직은 기존에
    실측 검증된 `deleted` 배제 패턴과 동일한 구조로 작성해 정확성에 대한 확신은 높으나,
    Stephen 직접 확인 권장(특히: 2개 이상 담고 1개만 체크 해제 후 결제 → 체크 해제한 건은
    hold로 남고 나머지만 confirmed로 바뀌는지).

[2026-07-27] RESEARCH | CMS 상담채팅 대여 라이프사이클 알림 정합성 정밀 감사 (전체 → 14개 결함 목록화) | 수정 파일 없음 · 학습파일 1건 생성 | ✅ DONE
  감사 범위: /cms/chat 상담세션 목록 연동 + 상품선택~반납완료 전 구간 사용자 채팅 알림 정합성
    (결제 PG 미구현 — Stephen 지시로 "예약신청→예약승인" 직행 Mock으로 간주하고 그 위에서 검증)
  감사 방법: Explore 에이전트 2개 병렬(①체크아웃/예약/결제mock/승인/상태머신 ②채팅알림 트리거/CMS세션목록/전자계약)
  발견 결함 14건:
    🔴 CRITICAL (4): 실결제(Toss) 경로 예약승인 알림 미발송 / "대여확인" 알림 타입 부재 /
      계약서명 시 상태 직접 UPDATE(H-01 위반)+알림 유실 / confirm-mock 무관 hold 예약 일괄승인
    🟡 BOUNDARY (6): reservation_hold·approval 콘텐츠 텍스트 미매핑 / 택배·배송 추적 알림 부재 /
      알림 세션선택 context_type 무시 / 계약발송·서명 세션재사용 정책 위반 / 수동·자동 알림 중복발송
      가능(멱등성 없음) / return_remind 발송시점-라벨 불일치
    🟢 ROUTINE (4): /api/chat/action-card 죽은 코드 / CMS 세션목록 페이지네이션·N+1 없음 /
      AUTO_NOTIFY['confirmed'] 도달불가 데드코드 / rental-lifecycle.md AUTO_NOTIFY 매핑 문서 누락
  정상 구현 재확인: AUTO_NOTIFY 배선 정상 연결 / send_rental_chat_notification 스키마 정합 /
    nextStatus·nextLabel 상태머신 문서 100% 일치 / chat_sessions 사용자 연동 정상 / 예약↔대여 목록 정합
  결과 파일:
  - .claude/harness/learnings/chat_notification_lifecycle_audit_2026-07-27.md ← 상세 내용(항목별 file:line 근거)
  - .claude/harness/TASK.md ← BACKLOG에 BL-CHAT-C1~C4/B1~B6/R1~R4 14개 항목 신규 추가 + NOW 섹션 완료 기록
  본 감사는 코드 수정 없이 정적 분석만으로 진행 — 발견 항목은 전부 Stephen 확인 후 별도 세션에서 처리 예정

[2026-07-27] BOUNDARY+CRITICAL FIX | CMS 대표/자식 상품 ProductDetailPanel 정보 관리 전면 정비 | src/lib/components/cms/ProductDetailPanel.svelte, src/routes/cms/products/+page.server.ts, src/routes/cms/products/+page.svelte | ✅ DONE
  배경: "CMS 자식 상품 수정 제한 전면 적용" 완료 후 동일 세션에서 Stephen이 이어서 요청한 7건
  ⓪ 부모(대표) 상품 목록 UI 구조 개선: 상세 뷰어 패널을 "대표 상품정보 등록관리"(rep-section,
     부모 전용) / "실 상품코드 반영 목록"(inv-accordion, 자식 전용) 2개 섹션으로 완전 분리.
     panelOpen 판정 기준을 selectedProduct 존재 → rootProduct(자식 선택 시에도 부모 정보를
     함께 로드) 존재로 교체. +page.server.ts에 rootProduct 로드 로직 신규 추가(자식 선택 시
     parent_product_id로 부모 이름·브랜드·카테고리·이미지·가격·품번·재고 카운트 별도 조회).
  ① 저장 버튼 disabled → 완전 숨김: basic(기본정보+슬러그)·options·pricing·rental·content·components·specs
     7개 탭 8개 저장 버튼을 {#if !isChildProduct} 래핑으로 자식 패널에서 아예 제거
  ② 입력 필드 포커스 즉시 차단: blockChildInputFocus(e) 신규 함수 — 위 7개 탭 section에
     onfocusin으로 연결, INPUT/TEXTAREA/SELECT/contentEditable 포커스 시 blur() +
     csToast.warning('대표 상품정보에서 수정하세요.')
  ③ 상품정보 삭제 버튼: 기존 모달(확인/취소) 방식 → CmsDeleteButton.svelte와 동일한
     "1차 클릭(csToast.warning 경고 + 제출 취소) → 2차 클릭(실제 삭제)" 패턴으로 교체.
     부모·자식 패널이 같은 컴포넌트를 쓰므로 양쪽에 자동 적용.
     추가로 deleteProduct 서버 액션에 로직 보강: 자식 삭제로 부모의 남은 재고(soft-delete
     안 된 자식)가 0개가 되면 부모 is_active를 자동으로 false 전환 — 재고 없는 상품이
     사용자 화면에 그대로 노출되는 것 방지. 자식 삭제는 여전히 자기 자신의 행만 삭제.
  ④ 자식 상품 '이력' 탭 — 유일하게 편집 가능한 탭인데 이미지 추가가 전혀 동작하지 않는
     버그 발견 및 수정:
     - 근본 원인: handleHistoryFileSelect()에서 `input.value = ''`를 `Array.from(files)`보다
       먼저 실행. FileList는 input의 live 참조라 value를 비우면 그 즉시 참조 중인 files도
       함께 비워져 항상 빈 배열로 처리됨 — 파일을 선택해도 업로더가 실행되지 않는 원인
       (이미지 탭의 handleFileSelect는 순서가 반대로 되어 있어 정상 동작 중이었음)
     - 수정: Array.from(files)로 먼저 복사 후 value 초기화하도록 순서 교체
     - 부수 수정: {#each historyRecords as rec}에 키가 없어 add/delete 후 목록 순서가
       바뀌면 수정 폼·업로드 인풋 바인딩이 잘못된 행에 붙을 위험 → (rec.id) 키 추가
     - 검증 방법: Claude_Browser의 순수 JS DataTransfer 주입으로는 이 샌드박스에서
       input.files 할당이 반영되지 않아(환경 제약) 신뢰 불가 → chrome-devtools-mcp의
       네이티브 파일 업로드(upload_file, 실제 OS 파일 선택 경로 사용)로 전환해 재현·검증
     - 결과: 업로드 → 저장 → 목록 반영 → 삭제 확인 모달 → 삭제까지 전체 라이프사이클
       실제 브라우저에서 통과 확인, Stephen 본인 브라우저에서도 정상 동작 재확인 완료 ✅
  ⑤ '빠른 재고 등록' 버튼 자식 상품에서 제외: 이 기능·버튼 UI는 부모(대표) ProductDetailPanel
     에만 존재·작동해야 정합하다는 요청 — summary-bar의 status-cta-btn을
     {#if !isChildProduct}로 래핑해 자식 패널에서 완전히 숨김. openCloneModal 호출부가
     이 버튼 하나뿐임을 grep으로 확인해 자식 쪽 다른 진입 경로가 없음을 검증.
  ⑥ 자식 패널 '닫기' 버튼을 토글 우측 끝으로 이동: 기존에는 ProductDetailPanel 내부
     ph-code-row(품번 행)에 붙어있던 close-btn(✕)을 제거하고(품번 표시는 유지),
     +page.svelte의 inv-acc-header에서 노출 토글(form) 바로 뒤에 신규 .inv-acc-close-btn
     으로 재배치 — 해당 아코디언 행이 펼쳐진 상태(isActive)일 때만 노출. 클릭 시 호출하는
     closePanel() 함수는 그대로 유지해 기능 변화 없음. 실브라우저에서 클릭 시 URL의
     ?selected= 파라미터가 제거되며 패널이 정상적으로 닫히는 것까지 확인.
  svelte-check: 신규 ERROR 0건 (기존 11 errors 그대로 유지 — account/profile RPC 타입 이슈, 무관)
  참고: 상품 삭제 2차 클릭(실제 soft-delete 실행)까지는 스테이지 DB 실 데이터 보호를 위해
    자동 실행하지 않음 — 1차 클릭(경고 토스트 노출)까지만 실측, 필요 시 Stephen 확인 요망

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

[2026-08-05 세션2] GSD | CMS QnA 이관+재구축+자동답변 전체 | 15개 파일 | GATE E 대기
  MENU-1:  src/routes/cms/+layout.svelte — consulting에 QnA 추가, settings에서 빠른답변 제거
  QNA-1:   src/lib/constants/cannedResponseCategories.ts 신규 (카테고리 5종 상수)
  QNA-2:   src/routes/cms/chat/qna/+page.server.ts 신규 (load + delete action)
  QNA-3:   src/lib/components/cms/CannedResponsePanel.svelte 신규
  QNA-4:   src/routes/cms/chat/qna/+page.svelte 신규 (master-detail 셸)
  QNA-5:   src/routes/cms/set/canned-responses/ 삭제 (파일 2개)
  AUTO-1:  supabase/migrations/20260805000186_186_auto_reply_settings.sql 신규 (DB 미적용)
  AUTO-2:  src/routes/api/cms/auto-reply-settings/+server.ts 신규 (GET+PATCH)
  AUTO-3:  src/lib/server/matchCannedResponse.ts 신규 (순수함수 매칭 엔진)
  AUTO-4:  src/lib/types/chat.ts — ActionCardType + ActionPayload 확장
  AUTO-5:  src/routes/api/chat/message/+server.ts — admin 클라이언트 앞당기기 + 6b 자동답변 분기
  AUTO-6:  src/routes/api/chat/sessions/+server.ts — action_payload 추가 + isFallbackPending OR
  AUTO-7:  src/lib/components/chat/MessageBubble.svelte — isAdmin prop + auto-badge
  AUTO-8:  src/lib/components/chat/MessageList.svelte — isAdmin prop 관통
  AUTO-9:  src/lib/components/chat/AdminChatPanel.svelte — isAdmin=true + 자동답변 pill
  svelte-check: 11 errors (= baseline) / 299 warnings | 0 신규 에러

[2026-08-06 연속 세션] GSD | /cms/products 품번·QR·재고 정합성 최종 검증 및 후속 결함 수정 | 5개 파일 | GATE E 대기
  QR-CASE-1:  src/routes/cms/mobile/qr/[product_id]/+page.server.ts, src/routes/qr/[entity]/[id]/+server.ts
              — product_code 조회 .eq(toUpperCase()) → .ilike() 3곳 (대소문자 불일치로 정상 품번 스캔 실패)
  QR-CASE-2:  src/routes/cms/codes/+page.server.ts — 20개 액션 전부 hasSettingsAccess(manager+)/
              checkSuperadmin 게이트 통일(19개+1개, 이전엔 saveFormat 등 19개 세션체크만 있었음)
  QR-RETRY-1~3: src/routes/cms/products/+page.server.ts, ProductDetailPanel.svelte — 자식 "품번 채번"/
              부모 "품번 체계 설정" 자가복구 버튼 + 레거시 프리픽스 불일치 자동우회 + deserialize 에러노출
  QR-HIDE-1(BND-7 폐기): ProductDetailPanel.svelte, +page.svelte — 부모 QR 완전 숨김, 텍스트 기준품번
              (baseCodeDisplay, 실채번 자식 품번과 혼동 방지용 순번0 패딩 예시) 대체
  QR-AUTO-1:  +page.server.ts, +page.svelte, ProductDetailPanel.svelte — 빠른재고등록 QR 자동노출(체크박스
              선택), 팝업 자동오픈은 사용자제스처 만료로 항상 차단돼 제거(기존 인쇄버튼 클릭에 위임)
  QR-STALE-1: +page.svelte — 대표상품 전환 시 selectedInvIds 미초기화 버그 수정
  INV-DEL-1:  +page.server.ts, +page.svelte — 인벤토리 선택 일괄삭제(deleteSelectedInventory) 신설,
              기존 2클릭 안전삭제 패턴 재사용
  PAGE-SCOPE-1: +page.server.ts — 대표카드 페이지네이션 범위밖 상품 선택 시 재고/가격/예약상태 부정확 버그
  JSONB 이중직렬화: +page.server.ts, new/+page.server.ts — upsert_product_option_links 2곳 JSON.stringify 제거
  가격 중복노출 제거: +page.svelte, ProductDetailPanel.svelte — 인벤토리 목록/요약바 자식 가격 배지 제거
  QR-STICKY-1/2: +page.svelte — 선택 액션바 최하단 재배치+sticky, BG박스 제거, cms-uiux.md §7-3 표준
              버튼 토큰(.btn-action/btn-danger-sm) 적용
  문서: products.md(v2.1→v2.4), security-auth.md(v3.2→v3.4) 동기화
  svelte-check: 11 errors (= baseline) / 289 warnings | 0 신규 에러

[2026-08-06 연속 세션] GSD | sp3-qa-agent GATE C 검수 후속 개선 2건 | 4개 파일 | GATE E 대기
  QR-CASE-1-FOLLOWUP: src/lib/server/escapeLikePattern.ts(신규) — ilike LIKE 와일드카드(%/_)
              이스케이프 헬퍼, mobile/qr/[product_id]/+page.server.ts 2곳 + qr/[entity]/[id]/
              +server.ts 1곳 적용
  QR-CASE-2-FOLLOWUP: src/routes/cms/codes/+page.server.ts load() — hasSettingsAccess 페이지
              진입 게이트 추가(기존 accounts/customers 패턴 재사용), partner UI 노출 갭 해소
  문서: products.md(v2.4→v2.5), security-auth.md(v3.4→v3.5) 동기화
  svelte-check: 11 errors (= baseline) / 289 warnings | 0 신규 에러 (1117 files, escapeLikePattern.ts 신규)

[2026-08-06 연속 세션] GSD | /cms/products 인벤토리·대표카드 레이아웃 미세조정 | 2개 파일 | GATE E 대기
  UI-SPACE-1: +page.svelte — .card-list gap 10→30px, .inv-accordion gap 4→12→20px
  UI-SPACE-2: +page.svelte — .inv-acc-header padding 없음→25px 20px→20px(균일) 확정
  UI-SPACE-3: ProductDetailPanel.svelte — .tab-content padding 20px 20px 50px→26px 26px 65px(30%↑)
  UI-SPACE-4: +page.svelte — .rep-card-thumb* 48→72→108px, .rep-card gap 12→18→27px,
              thumbUrl() Cloudinary 소스 64→72→108px 동반 상향
  svelte-check: 대상 파일 신규 에러 0건 (동시 진행 중인 타 세션 변경으로 전체 카운트는 계속 변동)

[2026-08-07] GSD | 테스트 예약 데이터 정리 (Stage + Production DB) | DB 전용 — 코드 파일 변경 0건 | 부분 완료 (Stage 잔여 54건 확인 대기)
  - Stage(ezyvffjvuwmtuhpxdjrw): 가짜 예약 8건(id 2,4,6,7,8,19,76,77) 삭제
    · FK 선삭제: order_items 4건(NO ACTION) + contracts 5건(RESTRICT)
    · CASCADE 자동 삭제: reservation_options, rental_action_logs, contract_signings
    · 검증: 잔존 0건
  - Production(vnbpmvxruyciuuaermyh): Stephen(steven@pseries.net)/운영관리자(crazyshothq@gmail.com)
    명의 예약 8건(id 3,5,6,7,8,9,10,11 / CS2607003,005~011) 삭제
    · FK 선삭제: contracts 2건(RESTRICT) / CASCADE 자동: reservation_options 4건
    · 검증: 잔존 3건(id 1,2,4, 이기성/mublues@gmail.com)
  - Production 이기성(mublues@gmail.com) 잔여 3건: Stephen 지시로 보존("큰 문제 없으면 그대로 냅둬~")
  - 안전장치 확인: 실서비스 DB DELETE 시도마다 Claude Code 자동실행 classifier가 실제로 차단됨 →
    Stephen 채팅 재확인("네, 삭제해줘.") 수령 후에만 재시도해 정상 완료 — 의도대로 동작
  - BACKLOG: Stage 잔여 54건(cconzy@daum.net·mublues@gmail.com 명의 이기성 2계정 + 이용희) 정리 여부

[2026-08-07] DEPLOY | /cms/products 품번·QR·권한게이트 세션 배포 검증 (커밋 0f5d4aa) | 코드 변경 0건 — Vercel MCP 실측 조회 | 완료
  - stage: dpl_9RWmMt5cjiWxGauHt5SxaeMDc6Ch (0f5d4aa) → READY
  - production: dpl_GRMtmjUzYwb4ddkUdoxsT6GgMMmR (PR#87 머지 de1a0ae) → READY(재조회로 확정, 빌드 ~38초, 에러 0건)
  - SSOT: Vercel API 상태(GitHub Actions 상태 아님) 기준 검증 원칙 재적용
    Stephen 확인 필요 → TASK.md DATA-4 참고

[2026-08-07] GSD | CMS 예약(계약서) 정합성 검증 + 계약서 에디터 스크롤·기능 보완 | 6개 파일 | GATE E 대기
  검증(정합성): RentalDetailPanel/rentalTransition.ts의 nextStatus·nextLabel·AUTO_NOTIFY·
    NOTIFY_TYPE_MAP·계약서 편집버튼 노출조건 모두 rental-lifecycle.md 문서와 일치(불일치 0건).
  BUG-1(데이터 자동삽입): contract-data/+server.ts — {{부가세}} 가 orders.tax_amount 실컬럼
    존재(Stage DB information_schema로 실측 확인)에도 항상 '-' 하드코딩돼 있던 버그 수정
    (select에 tax_amount 추가 + formatAmount 적용). rental-lifecycle.md 변수표도 함께 정정
    (기본대여요금 소스가 존재하지 않는 orders.base_amount로 잘못 기재돼 있던 것 → total_amount).
  BUG-2(스크롤): ContractEditorModal.svelte .modal-body — flex:1인데 min-height:0 누락으로
    콘텐츠가 90vh를 넘으면 스크롤 대신 부모 overflow:hidden에 잘려 안 보이던 버그(형제 컴포넌트
    ContractTemplatePreviewModal은 min-height:0 있어 정상이었음, 대조로 확정) → 한 줄 수정.
  FEAT-1(HTML 붙여넣기): CmsContentEditor.svelte HTML 블록 — 기본 textarea 붙여넣기는 클립보드
    text/plain만 사용해 외부 웹페이지 복사 시 태그·표·스타일이 전부 사라지던 문제 → onpaste에서
    clipboardData의 text/html을 직접 읽어 원문 삽입하도록 수정(handleHtmlPaste).
  FEAT-2(표 삽입): CmsContentEditor.svelte 툴바에 "표" 버튼 신규 — 행/열 입력 모달로 커스텀
    편집 가능 표를 삽입(ContractModuleBar 프리셋 2종과 별개로 임의 표 작성 가능해짐).
  FEAT-3(문서형 미리보기): ContractTemplatePreviewModal.svelte 미리보기 패널을 종이 문서 카드
    스타일로 개편(회색 배경+흰 카드+그림자+여백). CmsContentEditor.svelte에는 옵트인
    documentStyle prop 추가(기본 false=기존 동작 무변화) → ContractEditorModal·
    ContractTemplatePanel 두 계약서 에디터 진입점에만 documentStyle 적용, 상품설명·크레이지로그
    에디터는 영향 없음.
  svelte-check: 터치 파일 기준 신규 에러 0건(전체 1건은 미터치 파일 products/search/+page.svelte 기존 이슈)

[2026-08-07] FIX | 계약서 스크롤 버그 재조사 — Stephen 재현 확인 후 실제 원인 추가 수정 | 2개 파일 | GATE E 대기
  1차 수정(ContractEditorModal.svelte)은 실재하는 버그였으나 Stephen이 실제로 열어본 화면은
  /cms/reservation/contracts(계약서 양식 관리, "데이터 자동 삽입" 모듈바가 있는 화면)였음 —
  거기서 여전히 재현됨을 보고받고 flex 조상 체인을 처음부터 끝까지 다시 추적해 진짜 원인 확정.
  BUG(진짜 원인): contracts/+page.svelte .detail-pane — display:flex 가 누락돼 있어 자식인
    ContractTemplatePanel의 .template-panel(flex:1)이 flex 아이템으로 인식되지 않고 그냥
    height:auto로 내용만큼 늘어난 뒤 .detail-pane의 overflow:hidden에 잘림(스크롤 자체가
    발생할 수 없는 상태) → display:flex; flex-direction:column; min-height:0 추가.
  BUG(2단계): ContractTemplatePanel.svelte form — flex:1인데 min-height:0 누락(1차 수정 때
    발견한 ContractEditorModal .modal-body와 동일 패턴의 버그, 이 컴포넌트에서도 별도로 존재)
    → min-height:0 추가. 이 두 개가 함께 있어야 실제로 스크롤이 동작함.
  검증: /cms/+layout.svelte(.cms-main) → contracts/+page.svelte(.contracts-page→.master-detail→
    .detail-pane) → ContractTemplatePanel(.template-panel→form) 전체 체인을 min-height:0/
    display:flex 기준으로 재점검 — 이제 끊긴 구간 없음. "+ 작성"(.editor-full 경로)은 원래도
    정상이었으나 form의 min-height:0 누락은 그 경로에도 있었으므로 같이 해소됨.
  svelte-check: 신규 에러 0건

[2026-08-09] GSD | CMS 상품목록(/cms/products) 선택·패널 전환 로딩 지연 근본 해결 | 5개 파일(2개 신규) | GATE E 대기
  배경: 카드 선택/패널 닫기 시 3~5초 로딩 지연 — `selectProduct()`/`closePanel()`이 goto()로
    `?selected=` 파라미터만 바꿔도 +page.server.ts의 load() 전체(선택 무관 ①그룹 9~10쿼리 +
    선택상세 ②그룹 8~10쿼리)가 매번 재실행되던 구조적 문제. Plan Mode로 정밀 설계 후 GATE B
    사전승인(plan 파일: streamed-jumping-gray.md) 받아 진행.
  PERF-1(병렬화): +page.server.ts — childRows/rules24h/rules12h 3개 쿼리를 Promise.all 병렬
    실행으로 전환(rentalRows만 childIdToParentId 완성 후 순차 실행 유지), 반환 데이터 구조 무변경.
  PERF-2(캐싱): +page.server.ts — `loadProductsMetadata()` 신설, categories/categoryLabels/
    partnerComboItems/rentalPeriods/rentalMethods/pickupPoints/shippingSettings 7종 전역
    메타데이터를 모듈 스코프 60초 TTL 인메모리 캐시로 전환(rentalPeriods 등은 selectedId 조건부
    조회에서 상시 캐시 조회로 이동 — 선택 여부와 무관하게 항상 최신값 서빙).
  PERF-3(헬퍼 추출): 신규 src/lib/server/products/loadSelectedProductDetail.ts — 기존
    "선택된 상품 상세 데이터 로드"(② 그룹: selectedProduct/selectedPriceRules/rootProduct/
    inventoryList) 로직을 로직 변경 없이 그대로 이관. assetCount/assetTotal(선택상품 자신
    기준, products.md §9 Q2 확인 결과 실제 렌더링에 미사용되는 죽은 필드)만 0 고정으로 대체.
    rentalStatusCounts 페이지 집계 맵 의존을 rootRentalStatusCounts 단일값 반환으로 분리해
    +page.server.ts/신규 API 양쪽에서 재사용 가능하게 함.
  PERF-4(신규 API): 신규 src/routes/cms/products/[id]/detail/+server.ts(GET) — PERF-3 헬퍼
    재사용, assets/[id]/+server.ts와 동일 인증 패턴(safeGetSession→401, cms_role→403).
    frozen 경로 src/routes/api/** 를 피해 /cms/products 하위에 배치(AskUserQuestion으로
    Stephen 확인 후 확정).
  PERF-5(타입): src/app.d.ts — App.PageState에 selectedId?: string | null 추가.
  PERF-6/7(클라이언트 전환): +page.svelte — selectProduct()/closePanel()을 goto() → SvelteKit
    shallow routing(pushState)으로 교체. `activeSelectedId`($derived, page.state 우선·없으면
    data.selectedId)와 `activeDetail`($derived, 서버 데이터와 일치 시 data 직접 사용·다르면
    fetch 결과) 도입, `$effect`로 `/cms/products/[id]/detail`을 필요할 때만 fetch(동일 id
    중복 fetch 가드 + 늦게 도착한 stale response 가드 포함). panelOpen/QR-STALE-1
    effect(lastRootProductId)/printSelectedQR/카드 선택 하이라이트/두 ProductDetailPanel
    호출부(대표·자식) 전체를 activeSelectedId/activeDetail 기준으로 전환.
    rentalPeriods/rentalMethods/pickupPoints/categories/partnerComboItems/shippingSettings/
    initialTab은 선택과 무관해 data.* 그대로 유지(불필요한 재조회 없음).
  설계 핵심: 탭 저장·토글·삭제·복제·품번재시도 등 기존 invalidateAll() 기반 흐름은 전혀
    건드리지 않음 — ProductDetailPanel.svelte(4229줄, invalidateAll 호출 13곳 이상) 0줄 수정.
    invalidateAll() 이후에도 activeSelectedId===data.selectedId 분기라 activeDetail이 자동으로
    최신 data를 반영하므로 저장 직후 패널 갱신도 기존과 동일하게 동작.
  svelte-check: 터치 파일(신규 2개 + 기존 3개) 기준 신규 에러·경고 0건, 베이스라인(1 error/308
    warnings, products/search/+page.svelte 기존 무관 이슈)과 3회 반복 확인으로 동일함을 검증.
  잔여: 실브라우저 동작 검증(카드 선택 전환·닫기 체감속도, 전체 탭 저장/토글/삭제/복제/재시도,
    정렬·검색·카테고리·페이지 이동 시 선택 해제, 딥링크·새로고침)은 Claude Browser 사용 금지
    원칙에 따라 Stephen 직접 수행 필요 — 완료 후 git 커밋 진행 예정.

[2026-08-09] FIX | 위 항목 Stephen 요청 재검증("잠재오류 여부 정밀 검증") — 회귀 1건 발견·수정 | 2개 파일 | GATE E 대기
  history 회귀(🔴): +page.svelte selectProduct/closePanel을 pushState로 구현했었는데, 원본
    코드가 `goto(url, {replaceState:true})`를 쓴 이유(카드를 여러 번 클릭할 때마다 브라우저
    히스토리 항목이 쌓이면 "뒤로가기" 한 번으로 목록을 벗어날 수 없고 클릭 횟수만큼 눌러야
    하는 문제)를 승계하지 못하고 있었음 — pushState → replaceState로 수정(import도 교체).
  상태 불일치 방지(🟡): 선택 상세 fetch 실패 시 URL(?selected=)만 남고 패널은 빈 채로 열린
    상태가 될 수 있어, catch 핸들러에서 closePanel() 호출해 실패 시 URL·화면을 함께 정리하도록
    보강.
  확인·정리(ℹ️ 코드 변경 아님): +page.server.ts에 이번 세션과 무관한 NLSearch 하이브리드 검색
    폴백 기능(WEAK_MATCH_THRESHOLD 등)이 세션 시작 시점부터 이미 uncommitted 상태로 섞여
    있었음을 git diff HEAD 라인 단위 대조로 재확인 — 구조적 충돌·덮어쓰기 없음(신규 파일
    src/lib/server/products/, src/routes/cms/products/[id]/는 이번 세션 산출물만 존재, 다른
    작업과 충돌 없음). 다만 +page.server.ts의 diff를 커밋할 때는 두 작업이 섞여 있다는 점을
    반드시 인지 필요 — Stephen에게 별도 안내.
  검토했으나 미수정(버그 아님): 선택 전환 fetch 대기 중 패널이 짧게 비었다 채워지는 미세한
    깜빡임 — 이전 상품 데이터를 유지하며 전환하는 대안도 검토했으나 "하이라이트는 새 상품인데
    내용은 이전 상품"이라는 더 나쁜 오인 위험이 있어 현재(짧은 공백) 방식 유지, 원본(3~5초 고정
    표시 후 전환)보다 나쁘지 않음.
  svelte-check: 수정 후 재실행, 신규 에러·경고 0건 재확인.

[2026-08-09] GATE E | @sp3-qa-agent 검수 — CMS 상품목록 로딩 지연 근본 해결(PERF-1~9) | 1개 파일 수정 | GATE E 통과
  검수 대상 5개 파일 표준 3단계 검수(규칙 정합성·기술부채·시범오픈 기준) 전부 통과 — 보안·
    frozen 경로·ProductDetailPanel.svelte 0줄 수정·loadSelectedProductDetail.ts 로직 동등성
    전부 정적 대조로 재확인.
  🔴 발견·즉시수정: `eslint --max-warnings=0`(lint-staged/husky pre-commit 실조건) 기준
    `src/lib/server/products/loadSelectedProductDetail.ts:186` `no-useless-assignment` 에러
    — `let inventoryList: InventoryUnit[] = []` 초기값이 항상 무조건 재할당돼 미사용이던 것을
    `const inventoryList: InventoryUnit[] = (invData ?? []).map(...)`로 병합 수정.
    eslint --max-warnings=0 재검증 통과.
  ℹ️ 참고(미조치, 세션 범위 밖): +page.server.ts(13건)·+page.svelte(1건)에 세션 시작 전부터
    있던 기존 ESLint 위반(security/detect-object-injection, no-useless-escape)이 있어 이
    두 파일 커밋 시 lint-staged가 걸릴 수 있음 — Stephen 처리방침 결정 필요.
  GATE E 통과 — 커밋은 Stephen이 직접 실행.
