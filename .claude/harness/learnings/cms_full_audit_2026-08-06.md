# CMS 백오피스 전역 정밀 검증 (AUDIT v2) — 통합 보고서
# 2026-08-06 | Harness Flow v3.2 | 작성: @harness-executor AUDIT-4

---

## 1. 개요

### 범위
- **검증 화면**: `/cms/` 하위 전체 (11개 화면 + 연관 API 라우트)
  - 클러스터1(고객접점): chat / chat/qna / reservation / reservation/contracts / rentals
  - 클러스터2(상품/재고): products / products/new / codes / mobile / 검색엔진 연동
  - 클러스터3(관리행정): customers+inquiry+membership+score / promotion 6개 / set 5개 / accounts 3개 / login
- **포함 신규 작업스트림 6개**:
  ① 정형답변 매칭엔진+동의어 자동학습, ② MiniSearch 기반 공용 검색엔진,
  ③ 프로모션 KPI 대시보드+쿠폰 DetailPanel+히어로 시각화, ④ FCM 푸시알림 인프라,
  ⑤ products/[id]/edit 삭제→ProductDetailPanel 통합, ⑥ RentalCard 삭제→RentalDetailPanel 통합

### 방법론
- **5분류 프레임**: 고아 데이터 / 기능 이상 / 아키텍처 주의 / 스키마 주의 / 정상 영역
- **코드 수정 없는 순수 읽기 전용 감사** (Read 툴 + grep 전수 확인)
- **Track A**: 소스코드 정적 분석 (완료) / **Track B**: 실DB 대조 (Supabase MCP 인증 대기 중)
- 총 9개 AUDIT 태스크 (AUDIT-2.1~2.5, AUDIT-3.1~3.4) × 각 30분 + AUDIT-4 종합

---

## 2. 5분류 종합 결과

### 고아 데이터 (Orphaned Data)
- **발견 없음**
  - ⑥ RentalCard.svelte 삭제 후 `src/` 전체 잔존 참조: **0건** (빌드 깨짐 위험 없음)
  - ⑤ `/cms/products/[id]/edit` 라우트 삭제 확인: `src/routes/cms/products/` 하위 해당 경로 없음

### 기능 이상 (Functional Defects)
- **Track A 범위 내 발견 없음**
  - 모든 RPC 호출부가 실제 RPC 68종 목록과 일치
  - 상태 전이 매핑(nextStatus/nextLabel)과 rentalTransition.ts 전환표 전 항목 일치
  - AUTO_NOTIFY 자동발송 / NOTIFY_TYPE_MAP 수동버튼 매핑 분리 정확

### 아키텍처 주의 (Architecture Notes)
아래 § 4. BACKLOG 목록에 상세 등록.
요약: BOUNDARY 4건 + ROUTINE 11건 (CRITICAL 0건, 기해결 2건 별도)

### 스키마 주의 (Schema Notes)
- **Track B 대기** — Supabase MCP 미인증으로 실DB 대조 불가
  - 대조 예정: 신규 스트림 참조 테이블(synonym_groups, synonym_learning_settings,
    canned_responses, push_notification_config 등) RLS 정책 확인
  - 기존 AUDIT 선례(2026-07-14) 대비 회귀 확인 포함

### 정상 영역 (Verified OK)
아래 클러스터별로 주요 확인 항목만 기록.

#### 클러스터1 — 고객접점

**chat / chat/qna (AUDIT-2.1)**
- ANTHROPIC_API_KEY → `$env/static/private` 전용 (message/+server.ts) ✅
- Realtime 채널 cleanup: AdminChatPanel 3개 `$effect` 모두 `return unsub` ✅
- 세션 상태 전이(2026-07-27 변경): closed/pending → 새 메시지 즉시 `open` 전환 ✅
- CS_ESCALATE가 더 이상 `pending`을 강제하는 코드 없음 ✅
- `is_urgent` 배지: 마지막 사용자 메시지가 CS_ESCALATE이고 관리자 미응답 세션만 ✅
- `getCmsRoleForAction` 사용: canned-responses CRUD + qna/delete 전부 ✅
- `matchCannedResponse.ts` 하이브리드 스코어링 (MiniSearch + Levenshtein boost) 정상 ✅
- `synonymLearning.ts` 60초 TTL 캐시, FALLBACK_SETTINGS 폴백 ✅
- `normalizeKeywords.ts` trim/빈값/중복 제거, MAX_MATCH_KEYWORDS=10 ✅

**reservation / contracts (AUDIT-2.2)**
- 권한가드 5개 action 전수 (load: parent() / actions: getCmsRoleForAction) ✅
- H-01 준수: update_reservation_status / approve_reservation RPC 경유 ✅
- AUTO_NOTIFY 매핑 5종 전부 정확 (approval/shipment_notify/rental_confirm/return_registration/rental_complete) ✅
- 계약서 소프트삭제: `deleted_at` UPDATE (하드삭제 없음) ✅
- SUPABASE_SERVICE_ROLE_KEY → `$env/static/private` ✅

**rentals (AUDIT-2.3)**
- RentalCard.svelte 잔존 참조: src/ 전체 0건 ✅
- nextStatus/nextLabel 전환표 8항목 전부 정합 ✅
- isRentalView 분기 (승인/거부 버튼 isRentalView=true 시 완전 숨김) ✅
- NOTIFY_TYPE_MAP(수동) vs AUTO_NOTIFY(자동) 분리: in_use 시 자동=rental_confirm, 수동=return_remind ✅
- Realtime cleanup: `supabase.removeChannel(channel)` ✅
- RENTAL_STATUSES 필터: pending/hold/cancelled 제외 정확 ✅

#### 클러스터2 — 상품/재고

**products / products/new (AUDIT-2.4)**
- ⑤ /cms/products/[id]/edit 라우트 삭제 확인 ✅
- childBlockedSections 서버 가드: 8개 section 전부 parent_product_id 체크 후 fail(400) ✅
- QR = product_code: `$effect(() => renderQR(canvas, product.product_code))` ✅
- generate_product_code 3-param 전부 명시 (p_code_id:null) ✅
- sale_only=true → 24h 필수 체크 스킵 (양쪽 등록 경로 모두) ✅
- PAGE-SCOPE-1: rootAssetCount/Total → inventoryList 직접 계산, price → selectedPriceRules 재사용 ✅
- 부모 삭제 cascade: 자식 전체 소프트삭제 ✅
- `$effect` 내 `localBasic.is_active = product.is_active` 재동기화 ✅
- JSONB 파라미터 직접 전달 (JSON.stringify 금지 주석 명시) ✅
- 자가복구 버튼: retryProductCode(§8-G) + retryCodeSeries(§8-F) ✅
- regWarn 6종 처리 ✅

**codes / mobile / 검색엔진 (AUDIT-2.5)**
- codes 20개 액션 권한 전수: 19개 manager+ / 1개(transferCode) superadmin ✅
- codes load(): hasSettingsAccess → redirect 페이지 진입 차단 ✅
- mobile 권한: CMS 레이아웃 위임 체인 + processQrAction getCmsRoleForAction ✅
- QR-CASE-1: `.ilike('product_code', escapeLikePattern(값))` 양쪽 수정 완전 반영 ✅
- productSearchIndex.ts: parent_product_id IS NULL + is_active=true 필터, 60초 TTL ✅
- 하이브리드 전략: RPC 우선 → WEAK_MATCH_THRESHOLD(3) 이하 시 MiniSearch 폴백 ✅
- koreanTokenizer: TRAILING_PARTICLES 긴 조사부터 정렬, 불용어 필터 null 반환 ✅

#### 클러스터3 — 관리행정

**customers (AUDIT-3.1)**
- 5개 action 전수: getCmsRoleForAction + hasSettingsAccess ✅
- deleteCustomer: `['manager','superadmin'].includes(role)` 명시적 화이트리스트 ✅
- RPC 전수: toggle_blacklist/adjust_credit_score/update_customer_info/soft_delete_customer ✅
- SUPABASE_SERVICE_ROLE_KEY: `$env/dynamic/private` ✅

**promotion (AUDIT-3.2)**
- rules CRITICAL 2건 해결 확인: load hasSettingsAccess + 3개 action getCmsRoleForAction ✅
- KPI 표준 컴포넌트: CmsKpiCard/CmsKpiGrid/CmsStatRing/CmsStatBars 5개 화면 전부 import ✅
- columns=3 그리드 통일 ✅, 인라인 `.kpi-card`/`.stat-card` 잔존 없음 ✅
- CouponDetailPanel.svelte + CmsPagination.svelte 존재 확인 ✅

**set (AUDIT-3.3)**
- FCM 서버키(FIREBASE_ADMIN_PRIVATE_KEY 등): `$env/static/private` 완전 격리 ✅
- `src/lib/utils/push.ts`: `$env` import 없음 (클라이언트 safe) ✅
- set/rental 14개 action 세션체크-only: security-auth.md "파트너 ✅ 세션만" 의도된 설계 ✅

**accounts / login (AUDIT-3.4)**
- createAccount CRITICAL 해결 확인: session + getCmsRoleForAction + hasSettingsAccess ✅
- list 6개 action: requireSuperadmin() 적용 ✅
- delete 본인계정 삭제 방지: `if (userId === session.user.id) return fail(400)` ✅
- login setPassword: used_at + expires_at 유효성 체크, TOCTOU 없음 ✅
- `cmsSecurityGuards.test.ts` 7개 케이스 존재 + 통과 ✅

---

## 3. CRITICAL 2건 해결 경과

| 항목 | 파일 | 문제 | 수정일 | 상태 |
|---|---|---|---|---|
| **SEC-1~2: createAccount 미인증** | `src/routes/cms/accounts/+page.server.ts` | `createAccount` action이 `locals`를 받지 않아 세션/역할 체크 전무 — 미인증 상태로 관리자 계정 생성 가능(권한상승) | 2026-08-06 (별도 B-START) | ✅ 해결됨 — session + getCmsRoleForAction + hasSettingsAccess 추가, TDD 7케이스 GREEN |
| **SEC-3~4: promotion/rules 미인증** | `src/routes/cms/promotion/rules/+page.server.ts` | 파일 전체에 safeGetSession/getCmsRoleForAction 임포트 없음 — 미인증 상태로 marketing_rules CRUD 가능 | 2026-08-06 (동일 B-START) | ✅ 해결됨 — load: parent()+hasSettingsAccess, 3개 action getCmsRoleForAction 추가 |

수정 배경: AUDIT-3.2/3.4 재검증 전 별도 B-START로 Stephen 즉시 승인 후 TDD 적용.
테스트 파일: `src/__tests__/server/cmsSecurityGuards.test.ts` (7케이스 — accounts 3 + rules 4)

---

## 4. BACKLOG 목록 (GATE 등급별)

> 코드 수정 없는 순수 감사 결과 — 모든 항목은 Stephen 확인 후 별도 B-START로 처리.
> AUDIT-2.1~3.4 전 결과 취합, 총 15건.

### BOUNDARY (4건) — 서비스 로직에 실질 영향 가능

**AUDIT-BND-01**: `requireSuperadmin()` dual-schema 폴백 미처리 (production DB 위험)
- 출처: AUDIT-3.4
- 파일: `src/routes/cms/accounts/list/+page.server.ts` 내 `requireSuperadmin()` 헬퍼
- 문제: `.eq('id', session.user.id)` 단일 쿼리만 사용. `cmsProfile.ts`의
  `fetchCmsProfileByAuthId`는 stage(`id=auth user ID`)와 v5.46+ production
  (`user_id=auth user ID`, `id=별도 PK`) 이중 폴백 보유. `requireSuperadmin()`은 폴백 없어
  production 스키마에 따라 accounts/list 6개 action 전부 403 반환 위험.
- 확인 필요: production DB `user_profiles` 테이블의 `id` 컬럼이 auth user ID와 동일한지
- 처리 방향: `cmsProfile.ts` 패턴 동일하게 `user_id` → `id` 폴백 추가

**AUDIT-BND-02**: `/api/cms/customers/[id]/*` 6개 sub-routes partner 직접접근 차단 미적용
- 출처: AUDIT-3.1
- 파일: `src/routes/api/cms/customers/[id]/addresses/+server.ts` (외
  `subscriptions`, `credit-audit`, `rentals`, `chat-sessions`, `profile-settings` 5개)
- 문제: "any CMS role" 체크만 있어 partner가 URL 직접 호출 시 고객 주소/구독이력/
  크레이지스코어/대여이력 조회 가능. security-auth.md "고객 관리: partner ❌" 매트릭스 불일치.
  (부모 페이지 `/cms/customers`는 manager+ 제한 정상 적용)
- 처리 방향: 각 sub-route에 `hasSettingsAccess(cmsRole)` 게이트 추가

**AUDIT-BND-03**: `promotion/ad`, `promotion/coupon` 직접 DML — H-01 위반
- 출처: AUDIT-3.2
- 파일: `src/routes/cms/promotion/ad/+page.server.ts`,
  `src/routes/cms/promotion/coupon/+page.server.ts`
- 문제: `banners`/`coupons` 테이블에 INSERT/UPDATE/DELETE 직접 사용. core-rules.md H-01
  "직접 DML 금지 — RPC 경유만 허용" 위반. CMS 68종 RPC 목록에 해당 RPC 없어 불가피했던 것으로
  추정 (promotion/point는 RPC 사용 준수).
- 처리 방향: 신규 RPC (admin_create_banner, admin_update_banner, admin_delete_banner 등) 신설 필요.
  Stephen 우선순위 확인 후 Migration + RPC 추가

**AUDIT-BND-04**: `promotion/analytics` load() `hasSettingsAccess` 누락
- 출처: AUDIT-3.2
- 파일: `src/routes/cms/promotion/analytics/+page.server.ts`
- 문제: `load()`에 `hasSettingsAccess` 체크 없음. CMS 레이아웃은 세션+cms_role 존재만
  확인하므로 partner가 URL 직접 접근 시 수익률/전환율/캠페인 성과 데이터 조회 가능.
  promotion 6개 화면 중 analytics만 manager+ 제한 누락.
- 처리 방향: `const { cmsRole } = await parent(); if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')` 추가

### ROUTINE (11건) — 개선 권고, 즉각적 서비스 영향 없음

**AUDIT-RTN-01**: chat.md §3 세션전이 정책 구버전 기술 (문서 드리프트)
- 출처: AUDIT-2.1
- 파일: `.claude/rules-ref/chat.md` §3
- 문제: "사용자 메시지+CS_ESCALATE → pending" 구버전 기술. 2026-07-27 변경(pending 강제 제거)이
  rental-lifecycle.md에만 반영, chat.md §3 미갱신. 코드는 이미 올바름(문서만 드리프트).
- 처리 방향: chat.md §3 세션 상태 전이 규칙 갱신 (pending 재진입은 1시간 무응답 자동전환으로만)

**AUDIT-RTN-02**: AGENTS.md §도메인 규칙 파일 목록과 실제 배치 불일치 (문서 드리프트)
- 출처: AUDIT v2 사전 확인
- 파일: `AGENTS.md` §도메인 규칙 파일 목록
- 문제: AGENTS.md는 `rental.md`, `payment.md`, `uiux.md`가 `.claude/rules/`에 있다고 명시
  → 실제로는 `.claude/rules-ref/`에 있음.
  반대로 실제 `.claude/rules/`의 `products.md`, `rental-lifecycle.md`, `uiux-index.md`는
  AGENTS.md에 누락.
- 처리 방향: AGENTS.md 파일 목록을 CLAUDE.md "상시 로드" 섹션과 동기화

**AUDIT-RTN-03**: `console.error` 로깅 전략 불통일
- 출처: AUDIT-2.2, 2.3
- 파일: `src/routes/cms/reservation/+page.server.ts:73`,
  `src/routes/cms/rentals/+page.server.ts:32`
- 문제: `console.error` 2건이 프로덕션 서버 로그에 오류 스택 노출 가능.
  core-rules.md 금지 대상은 `console.log`이므로 기술적 위반은 아니나,
  향후 로깅 전략 통일 시 구조화 로거(또는 에러 레벨 구분)로 교체 권고.

**AUDIT-RTN-04**: `RentalDetailPanel.svelte` 내부 `RentalListRow` 타입 delivery_fee 누락 (타입 드리프트)
- 출처: AUDIT-2.3
- 파일: `src/lib/components/cms/RentalDetailPanel.svelte`
- 문제: 파일 내부에 `interface RentalListRow`를 재정의 (routes 크로스-임포트 금지 원칙 준수 목적).
  `src/routes/cms/reservation/+page.server.ts` 정본 타입과 `delivery_fee` 필드 누락 불일치.
  런타임 영향 없으나 향후 필드 추가 시 양쪽 동기화 필요.
- 처리 방향: 공통 타입 파일(`src/lib/types/rental.ts` 등)로 분리 또는 정본과 동기화

**AUDIT-RTN-05**: `/cms/products` 전 액션 세션 체크만 (role 체크 없음) — Stephen 확인 필요 항목
- 출처: AUDIT-2.4 (공통점검 2번에서 이미 확인된 항목)
- 파일: `src/routes/cms/products/+page.server.ts`,
  `src/routes/cms/products/new/+page.server.ts`
- 문제: retryProductCode / retryCodeSeries / cloneProduct / deleteProduct / updateSection /
  toggleStatus 등 전 액션이 `safeGetSession` 체크만 있고 `getCmsRoleForAction` 없음.
  partner가 상품을 수정/삭제할 수 있는 경로.
- Stephen 확인: security-auth.md에 products 화면의 partner 접근 권한이 "✅ 세션만"으로
  의도된 설계인지 확인 필요 (set/rental 처럼 파트너 수정 허용 여부)

**AUDIT-RTN-06**: `api/search/products/+server.ts` `(supabase.rpc as any)` Frozen 파일 any 타입
- 출처: AUDIT-2.5
- 파일: `src/routes/api/search/products/+server.ts` (Frozen 파일)
- 문제: `(supabase.rpc as any)('search_products', ...)` — core-rules.md "any 타입 절대 금지"
  위반. `eslint-disable-next-line` 주석으로 린터 억제. Frozen 파일(api/*) 이므로 수정 시
  Stephen 확인 + CRITICAL 게이트 필요.
- 처리 방향: `database.ts Functions` 맵에 `search_products` RPC 타입 등록 후 `callTypedRpc` 패턴 적용

**AUDIT-RTN-07**: MiniSearch 카테고리 필터 폴백 불일치
- 출처: AUDIT-2.5
- 파일: `src/routes/api/search/products/+server.ts`
- 문제: `p_category` 파라미터 있을 때 MiniSearch 폴백은 category 필터 미적용 → 다른 카테고리
  상품이 최대 limit개 섞일 수 있음. 발생 조건: 카테고리 필터 + RPC 결과 ≤3건.
  서비스 영향도 낮으나 인지 필요.
- 처리 방향: MiniSearch 폴백 시 `filter: (result) => result.category === p_category` 조건 추가

**AUDIT-RTN-08**: canned-response 삭제 경로 이원화 (유지보수 주의)
- 출처: AUDIT-2.1
- 파일: `src/routes/cms/chat/qna/+page.server.ts` (delete form action),
  `src/routes/api/cms/canned-responses/+server.ts` (DELETE 엔드포인트)
- 문제: 두 경로 공존 — `CannedResponsePanel.svelte`는 API fetch, `CmsDeleteButton`은 form action.
  중복은 아니나 유지보수 시 양쪽 권한가드 동기화 주의 필요.

**AUDIT-RTN-09**: `requireSuperadmin()` 함수명 오인 위험
- 출처: AUDIT-3.4
- 파일: `src/routes/cms/accounts/list/+page.server.ts` 내 requireSuperadmin 헬퍼
- 문제: 함수명 "requireSuperadmin"이지만 내부는 `hasSettingsAccess(manager+)` — "superadmin 전용"
  아님. security-auth.md 매트릭스(accounts/list: manager ✅ / superadmin ✅)와 실제 동작은
  일치하나 함수명이 유지보수 오해 유발.
- 처리 방향: `requireManagerOrAbove` 또는 `requireSettingsAccess`로 리네이밍 권고

**AUDIT-RTN-10**: `set/push` admin() 팩토리 URL 헬퍼 불일치
- 출처: AUDIT-3.3
- 파일: `src/routes/cms/set/push/+page.server.ts`
- 문제: `PUBLIC_SUPABASE_URL` (`$env/static/public`) 직접 사용 — 다른 파일들이
  `getSupabaseUrl()` 헬퍼를 사용하는 패턴과 불일치. 서버 전용 파일에서만 호출되므로
  보안 문제 없음. 동작 영향 없음.
- 처리 방향: 헬퍼 함수 패턴으로 통일 (낮은 우선순위)

**AUDIT-RTN-11**: `promotion/ad`, `coupon` action 오류 응답 HTTP 200 패턴
- 출처: AUDIT-3.2
- 파일: `src/routes/cms/promotion/ad/+page.server.ts`,
  `src/routes/cms/promotion/coupon/+page.server.ts`
- 문제: action 오류 시 `return { ok: false, error: ... }` (HTTP 200) 반환.
  SvelteKit 표준인 `fail(401, ...)` / `fail(403, ...)` 미사용.
  실제 차단은 되나 HTTP 상태코드 의미론적 불일치 (promotion/rules/point는 `fail()` 사용).
- 처리 방향: `return { ok: false }` → `return fail(403, { error: ... })` 패턴 통일

---

## 5. GSD_LOG 동기화 갭

아래 TASK.md 완료 체크(`[x]`) 항목이 GSD_LOG.md에 대응 엔트리 없음.
총 **5개 작업스트림 / 17개 세부 태스크**가 누락됨.

| 작업스트림 | 태스크 | TASK.md 섹션 위치 | GSD_LOG 누락 이유 |
|---|---|---|---|
| 프로모션 CMS 대시보드·쿠폰 배포 UI/UX 전면 개편 | T1~T6 (6개) | `## NOW — 프로모션 CMS 대시보드...` | 해당 세션 GSD_LOG 미기록 |
| 쿠폰 발행관리 목록카드+DetailPanel 구조 전환 | BUG-1, FEAT-1, T7 (3개) | `## NOW — 쿠폰 발행관리 목록카드...` | 동일 |
| 프로모션 5개 대시보드 히어로 시각화 | T8~T10 (3개) | `## NOW — 프로모션 5개 대시보드...` | 동일 |
| 프로모션 대시보드 컬러 다양화 + 인터랙티브 요소 보강 | T11~T13 (3개) | `## NOW — 프로모션 대시보드 컬러...` | 동일 |
| /cms/promotion/ad 라우팅 크래시 긴급 수정 | HOTFIX-1, HOTFIX-2 (2개) | `## NOW — /cms/promotion/ad 라우팅...` | 동일 |

**참고**: 이 갭은 GSD_LOG.md에 소급 기록하지 않는다 (이미 완료된 세션, 소급 기록은 혼란 유발).
이후 동일 문제 방지를 위해 세션 종료 전 GSD_LOG 기록을 GATE E 체크리스트에 포함하는 것을 권고.

---

## 6. 문서 드리프트

### 6-1. AGENTS.md 도메인 규칙 파일 목록 불일치

AGENTS.md가 규칙 파일 경로를 `.claude/rules/`로 일괄 명시하나, 실제 배치는 분리됨.

| 파일 | AGENTS.md 기술 위치 | 실제 위치 | 상태 |
|---|---|---|---|
| `rental.md` | `.claude/rules/` | `.claude/rules-ref/` | ❌ 불일치 |
| `payment.md` | `.claude/rules/` | `.claude/rules-ref/` | ❌ 불일치 |
| `uiux.md` | `.claude/rules/` | `.claude/rules-ref/` | ❌ 불일치 |
| `products.md` | 미기재 | `.claude/rules/` | ❌ 누락 |
| `rental-lifecycle.md` | 미기재 | `.claude/rules/` | ❌ 누락 |
| `uiux-index.md` | 미기재 | `.claude/rules/` | ❌ 누락 |

참조: CLAUDE.md "상시 로드 (자동)" 섹션이 정확한 SSOT.

### 6-2. chat.md §3 세션전이 정책 구버전

- 파일: `.claude/rules-ref/chat.md` §3
- 2026-07-27 변경 내용 (rental-lifecycle.md에는 반영됨):
  - 변경 전: "사용자 메시지 + AI가 CS_ESCALATE로 분류 → 즉시 `pending` 전환"
  - 변경 후: "새 메시지 도착 즉시 무조건 `open` 전환 (AI 분류 무관). `pending` 재진입은 오직 `auto_pending_inactive_sessions` RPC(1시간 무응답 자동전환)로만 가능"
- 코드(`src/routes/api/chat/message/+server.ts`)는 이미 변경 후 정책 적용 — 문서만 드리프트

---

## 7. Track B (실DB) 대기 상태

- **상태**: Supabase MCP 인증 대기 중 (이번 세션 실행 불가)
- **진행 순서**: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 먼저 → crazyshot production(vnbpmvxruyciuuaermyh)
- **확인 예정 범위**:
  - 신규 스트림 참조 테이블 RLS 정책 (synonym_groups, synonym_learning_settings, canned_responses, push_notification_config 등)
  - get_advisors (security + performance) 실행
  - 2026-07-14 AUDIT 대비 고아 데이터 회귀 확인
  - BOUNDARY 항목 중 requireSuperadmin dual-schema 관련 user_profiles 스키마 확인

---

## 8. 결론 (전반적 상태 평가)

### Track A 기준 종합 평가: **CMS 코드베이스 전반적으로 안전한 상태**

**긍정 사항:**
- CRITICAL 보안 이슈 2건이 이미 식별되어 TDD로 즉시 수정됨 (createAccount 미인증, rules 미인증)
- 9개 AUDIT 태스크에서 새로운 CRITICAL 이슈 0건 발견 — 주요 권한가드 패턴(getCmsRoleForAction +
  hasSettingsAccess)이 대다수 화면에 정상 적용됨
- RentalCard.svelte → RentalDetailPanel.svelte 통합이 잔존 참조 없이 깔끔하게 완료됨
- 6개 신규 작업스트림의 핵심 보안 요소(API 키 격리, 권한가드) 전부 정상 확인됨
- 코드 품질: console.log 0건, Svelte4 문법 0건, TODO/FIXME 0건 (대상 파일 기준)

**주의 필요 사항 (BACKLOG 등록):**
- BOUNDARY 4건 중 **AUDIT-BND-01**(requireSuperadmin dual-schema)은 production 스키마에 따라
  즉각적 서비스 영향 가능 → Stephen 우선 확인 권장
- BOUNDARY 4건 중 **AUDIT-BND-03**(ad/coupon 직접 DML)은 H-01 위반이나 해당 RPC가 존재하지 않아
  불가피했던 상황 → RPC 신설이 선결 조건
- Track B(실DB 대조)가 완료되지 않아 RLS 레벨 검증은 미완 상태

**다음 액션:**
1. Stephen이 BOUNDARY 4건 중 우선순위 확인 (특히 BND-01 production 스키마)
2. Track B: `/mcp` Supabase 인증 완료 후 별도 세션 진행
3. ROUTINE 문서 드리프트 2건은 다음 관련 작업 시 자연스럽게 갱신 가능

---

*cms_full_audit_2026-08-06.md | AUDIT-4 최종 종합 | Harness Flow v3.2*
*범위: CMS 11개 화면 + 6개 신규 작업스트림 | Track A 완료, Track B 대기*
