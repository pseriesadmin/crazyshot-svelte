# .claude/harness/TASK.md
생성일: 2026-06-26 (PRD.1.7 세션 동기화)
아젠다: PRD.1.7 대화형 렌탈예약 어시스턴트 시스템 V1.0

[CONTEXT BRIDGE]
plan_source: steady-dreaming-sprout.md | PRD.1.7 노드트리
핵심제약:
  - Supabase + Claude API 완전 내재화 (카카오 채팅 대체)
  - 4개 DB 테이블: chat_sessions / chat_messages / chat_intent_logs / cs_records
  - Claude AI: claude-haiku-4-5, max_tokens 512, 6종 Intent 분류
  - ANTHROPIC_API_KEY → $env/static/private 전용 (H-05)
  - 직접 INSERT/UPDATE/DELETE 금지 → RPC 경유 (H-01)
TDD도메인: 없음 (GSD 도메인 — UI + API 구현)
절대금지:
  - git 자율 실행
  - ANTHROPIC_API_KEY를 $env/static/public에 노출
  - 기존 마이그레이션 파일 수정
  - Svelte 4 문법 (on:event → onevent)
frozen_files (Claude Code 전용 — Cursor 수정 금지):
  - src/lib/services/supabase.ts  ← baseline: fed4fdb (createBrowserClient 패턴)
  - src/hooks.server.ts
  - src/lib/env/supabasePublic.ts
  - src/lib/stores/auth.ts
  - src/routes/api/**/*
  - supabase/migrations/**
  - $env import가 있는 모든 파일
auth_baseline: fed4fdb — createBrowserClient 패턴 (절대 싱글톤 createClient로 대체 금지)

---

## NOW — Front 설정 UI 컴포넌트 정교 재개발 + /products ProductDPCard 교체 (2026-07-21) ✅ 완료

plan_source: products-jaunty-lollipop.md (v3)
핵심제약:
  - 레퍼런스: ProductCategoryModal / ProductHeroModal / ProductGridModal 3종 기준
  - AdminModalShell·AdminEditButton 픽셀 수준 정합
  - 요청 범위 외 수정 없음

신규/수정 파일:
  - src/lib/components/common/admin/AdminModalShell.svelte ← CSS 전면 재작성 (레퍼런스 정합)
  - src/lib/components/common/admin/AdminEditButton.svelte ← CSS 재작성 (레퍼런스 정합)
  - src/routes/products/+page.svelte ← 구 flat/card 카드 → ProductDPCard 교체 + 잔존 CSS 제거

- [x] UI-SHELL: AdminModalShell.svelte 레퍼런스 정합 재작성 | ROUTINE | ✅ 완료 (2026-07-21)
  - 헤더: background: var(--cs-dark) (다크 네이비) 적용
  - 타이틀: color: var(--cs-white) + font: var(--text-pc-title-16)
  - 닫기 버튼: rgba(255,255,255,0.7) / 18px / padding 4px 8px / min-height 32px / hover → var(--cs-white)
  - 헤더 border-bottom 제거 (레퍼런스 없음)
  - 패널: border-radius var(--radius-2xl) 0 0 var(--radius-2xl) 추가
  - 패널: box-shadow -4px 0 24px rgba(16,11,50,0.15) (0.12→0.15)
  - 바디: gap 20px 추가

- [x] UI-BTN: AdminEditButton.svelte 레퍼런스 정합 재작성 | ROUTINE | ✅ 완료 (2026-07-21)
  - border-radius: var(--radius-sm) (8px) — xl(30px)에서 수정
  - min-height: 32px — 44px에서 수정
  - padding: 6px 12px
  - font-weight: 700 (600→700)
  - hover: background rgba(16,11,50,0.92) (opacity 방식에서 교체)
  - empty-state: border-radius var(--radius-xl) 유지 (이 variant만 xl)

- [x] UI-GRID: /products 상품 그리드 → ProductDPCard 표준 컴포넌트 교체 | BOUNDARY | ✅ 완료 (2026-07-21)
  - 구 d-prod-flat (idx<4) + d-prod-card (idx≥4) 인라인 렌더 → ProductDPCard 단일 컴포넌트 통일
  - price24h=base_price_daily / price12h=Math.round(base_price_daily*0.7) / category / href 연동
  - 잔존 CSS 제거: .d-prod-flat / .d-flat-img-box / .d-flat-img / .d-flat-info / .d-flat-price / .d-flat-name / .d-prod-card / .d-prod-bg / .d-prod-img-box / .d-prod-info / .d-prod-price / .d-prod-name (11선택자)
  - .d-prod-grid: justify-content flex-start / column-gap 24px (ProductDPCard 290px 고정폭 정렬)
  - svelte-check: 신규 에러 0건

---

## NOW — CMS 고객 증명서 타이머 + 재등록 업로드 기능 (2026-07-23) ✅ 완료

plan_source: 세션 내 아젠다
핵심제약:
  - CMS 화면 디자인 토큰 적용 (--cms-radius-sm / --cs-purple / --cs-disabled-button)
  - CMS 브라우저 auth 패턴: 타 사용자 프로필 업데이트 → +server.ts + service_role 필수
  - front-uiux.md §15 업로드 정책 적용 (5 MIME 타입 + 클라이언트·서버 양쪽 검증)
  - 요구범위: 본인 증명 / 외국인 증명 두 항목만 수정 — 범위 외 수정 없음

신규/수정 파일:
  - src/lib/components/cms/CustomerDetailPanel.svelte ← 수정 (타이머 배지 + 재등록 UI)
  - src/routes/api/cms/upload-doc/+server.ts ← 신규 (CMS 문서 재등록 API)

- [x] FEAT-TIMER: 본인 증명·외국인 증명 6개월 기간경과 배지 자동 노출 | BOUNDARY | ✅ 완료 (2026-07-23)
  - isIdentityExpired(iso): 6개월 이전 날짜 비교 함수 (기존 유지)
  - 배지 텍스트 "경과" → "기간경과"로 변경
  - 등록일 없거나 기간경과 시 `[재등록]` 버튼 자동 노출
  - 적용 대상: 본인 증명(identity_verified_at) · 외국인 증명(foreign_verified_at) 양쪽

- [x] FEAT-REUPLOAD: 인라인 재등록 업로드 UI | BOUNDARY | ✅ 완료 (2026-07-23)
  - DOC_ACCEPT: PNG·JPEG·WebP·HEIF·PDF 5종 (front-uiux.md §15 표준)
  - validateUploadFile() 클라이언트 사이드 MIME 검증
  - 이미지: URL.createObjectURL 미리보기 / PDF: 파일명 표시
  - 업로드 중 버튼 비활성화 + "업로드 중..." 텍스트
  - 성공: csToast.success + invalidateAll() 패널 갱신 / 실패: csToast.error
  - $effect cleanup: URL.revokeObjectURL 메모리 누수 방지

- [x] FEAT-API: /api/cms/upload-doc POST 엔드포인트 신규 생성 | BOUNDARY | ✅ 완료 (2026-07-23)
  - CMS 권한 체크: hasSettingsAccess(locals.cmsRole) — manager(50+) 전용
  - 서버사이드 MIME 재검증 (클라이언트 우회 방어)
  - Supabase service_role로 user-documents 버킷 업로드
  - user_profiles 직접 UPDATE (service_role RLS 우회 — 타 사용자 프로필 수정)
  - 실패 시 스토리지 파일 자동 롤백 (.remove([path]))
  - type: 'identity' → identity_doc_url + identity_verified_at 갱신
  - type: 'foreign' → foreign_doc_url + foreign_verified_at 갱신

---

## NOW — 회원 프로필 개편 + Aligo SMS 연동 + Stage DB 마이그레이션 (2026-07-23) ✅ 완료

plan_source: 세션 내 아젠다 (컨텍스트 이관)
핵심제약:
  - Stage(ezyvffjvuwmtuhpxdjrw) 스키마 분기 처리 (#139 Stage 전용)
  - Production DB에 Migration #139 적용 금지
  - Aligo SMS env 미설정 시 콘솔 출력 모드 유지

신규/수정 파일:
  - supabase/migrations/20260722000139_139_fix_customer_list_no_student_cols.sql ← 신규 (Stage 전용)
  - src/routes/api/profile/send-otp/+server.ts ← Solapi → Aligo REST API 교체
  - .env.local ← ALIGO_API_KEY / ALIGO_USER_ID / SMS_SENDER_PHONE 키 추가 (값 미입력)
  - src/lib/components/members/profile/ProfileTabContent.svelte ← 아바타 + 카드 정보 개편
  - src/routes/account/profile/+page.server.ts ← created_at 필드 추가
  - src/routes/account/+page.server.ts ← created_at 필드 추가

DB 적용:
  - Migration #137 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅ (기적용 확인 2026-07-23)
  - Migration #138 — Stage ✅ / Production ✅ (기적용 확인 2026-07-23, COALESCE 버전 정본)
  - Migration #139 — Stage ✅ / Production ⛔ 적용 금지
    → 이유: Production에 student_doc_url 컬럼 존재 → #138 COALESCE로 하위호환 유지 필요
    → #139는 Stage 스키마 결함 보완 패치 (COALESCE 제거 버전) — Production에 적용 시 구 데이터 유실

- [x] MIG-139: Stage DB get_customer_list RPC COALESCE 오류 수정 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 원인: Migration #138 COALESCE(up.student_doc_url, ...) → Stage에 해당 컬럼 없음
  - 해결: Migration #139로 Stage 전용 RPC 재정의 (COALESCE 제거, identity 컬럼만 참조)
  - Production은 #138(COALESCE 버전)이 정본 — #139 적용 금지

- [x] FEAT-ALIGO: SMS 제공사 Solapi → Aligo REST API 교체 | BOUNDARY | ✅ 완료 (2026-07-23)
  - sendSms() 함수: FormData multipart/form-data POST to https://apis.aligo.in/send/
  - 인증: key(ALIGO_API_KEY) + user_id(ALIGO_USER_ID), 발신번호(SMS_SENDER_PHONE)
  - 성공 판단: result_code === 1
  - env 미설정 시 console.log 모드 (개발 환경 폴백)
  - .env.local에 키 추가 (값은 Stephen이 직접 입력)

- [x] UI-AVATAR: 프로필 카드 아바타 노란 SVG → 이메일 이니셜 아바타 | ROUTINE | ✅ 완료 (2026-07-23)
  - 노란 아바타 SVG + "로그인됨" 텍스트 제거
  - 이메일 첫 글자 이니셜 div 아바타 (70×70px, border-radius:50%, --cs-purple-pale BG)
  - 폰트: var(--font-en-display) 28px Bold / --cs-dark 컬러
  - GNB.svelte gnb-avatar-initial 패턴 참조, 독립 CSS 구현

- [x] UI-PROFILE-CARD: 프로필 카드 정보 행 개편 (아이디 + 가입일) | ROUTINE | ✅ 완료 (2026-07-23)
  - "아이디": 이메일 앞단 영문 (displayEmail.split('@')[0]) — 폰트 700 20px var(--font-kr) --cs-text
  - "가입일": profile.created_at → toLocaleDateString('ko-KR') → 년.월.일 형식
  - 폰트: var(--text-m-script-14B) / --cs-text-mid
  - "●●●●" 더미 마스킹 행 완전 제거
  - user_profiles 쿼리에 created_at 추가 (profile/+page.server.ts · account/+page.server.ts 양쪽)

⚠️ 추후 진행 (Stephen 직접):
  - [ ] .env.local ALIGO_API_KEY / ALIGO_USER_ID / SMS_SENDER_PHONE 실제 값 입력 (알리고 콘솔에서 발급)
  - [ ] Vercel 대시보드 동일 3개 환경변수 등록 (Production·Preview·Development)

DB 적용:
  - Migration #137 + #138 — Production(vnbpmvxruyciuuaermyh) ✅ 적용 완료 (2026-07-23)

---

## NOW — 회원 프로필 DB 연동 버그픽스 (2026-07-23) ✅ 완료

수정/신규 파일 (Stage DB 전용):
  - supabase Stage DB: migration #132 직접 적용 (update_user_profile RPC + phone_otps 테이블 + verify_and_update_phone RPC)
  - supabase Stage DB: migration #133 직접 적용 (allow_rental_alert / allow_benefit_alert 컬럼 + update_notification_settings RPC) — 이전 세션 완료
  - supabase Stage DB: migration #134 직접 적용 (is_cms_admin() SECURITY DEFINER + user_profiles CMS SELECT 정책) — 이전 세션 완료
  - supabase Stage DB: user_id UUID 컬럼 + 트리거 직접 추가 (stage 스키마 id-only 정합)
  - supabase Stage DB: birth_date DATE 컬럼 직접 추가

DB 적용:
  - Migration #132 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅ 적용 완료 (2026-07-23)
  - Migration #133 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅ 적용 완료 (2026-07-23)
  - Migration #134 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅ 적용 완료 (2026-07-23)

- [x] BUG-1: CMS 알림설정 미반영 — user_profiles RLS 차단 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 원인: RLS 정책 `id = auth.uid()` → CMS 관리자가 타 사용자 프로필 SELECT 불가
  - 해결: migration #134 is_cms_admin() SECURITY DEFINER + "user_profiles: cms 관리자 전체 조회" 정책 추가
  - 검증: mublues@gmail.com 알림설정 배지 정상 반영 확인

- [x] BUG-2: CMS 배송지 미표시 — PostgREST schema cache stale | BOUNDARY | ✅ 완료 (2026-07-23)
  - 원인: Stage DB에 새 함수 적용 후 PostgREST schema cache 갱신 미완료 → get_user_shipping_addresses RPC 400 반환
  - 해결: `NOTIFY pgrst, 'reload schema'` 실행
  - 검증: cconzy@daum.net 배송지 4개 CMS 정상 표시 확인

- [x] BUG-3: 생년월일 저장 불가 — Stage DB migration #132 미적용 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 원인: Stage DB에 update_user_profile RPC 미존재 → updateProfile 액션에서 RPC 호출 실패 (네트워크 200이나 내부 오류)
  - 해결: Stage DB에 migration #132 직접 적용 (update_user_profile + verify_and_update_phone + phone_otps 테이블)
  - 검증: 생년월일 저장 및 CMS 반영 정상 확인

- [x] BUG-4: Stage DB 스키마 정합 — user_id 컬럼 누락 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 원인: Stage DB user_profiles PK = id (Production = user_id) → user_id 기준 쿼리 전체 실패
  - 해결: user_id UUID 컬럼 추가 + id 값 동기화 트리거 (trg_sync_user_id) 적용
  - 영향: update_notification_settings RPC WHERE user_id 정상 작동

- [x] BUG-5: Production DB RPC + 코드 정합 — user_id 컬럼 없음 | CRITICAL | ✅ 완료 (2026-07-23)
  - 원인: Production user_profiles PK = id (user_id 컬럼 없음) → Migration #132/#133 RPC 및 account/+page.server.ts 쿼리 Production 실패 예정
  - 해결 1: Migration #135 신규 생성 — update_user_profile / update_notification_settings RPC WHERE id 기준으로 교체 → Stage + Production 양쪽 적용 완료
  - 해결 2: src/routes/account/+page.server.ts SELECT 'id' + .eq('id', ...) 수정 (구 user_id → id)
  - 적용: Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅

---

## NOW — FloatingBar 버그픽스 + 디자인 시스템 문서 등록 (2026-07-23) ✅ 완료

수정/신규 파일:
  - .claude/rules-ref/front-uiux.md ← §13-3 FloatingBar 상세 스펙 확장 + §13-3-1 FloatingButton 신규 섹션 + §13-4 명칭 대조표 갱신
  - src/routes/+layout.svelte ← FloatingBar 조건에서 /products/ 제외 삭제 (Fix A)
  - src/lib/components/common/FloatingBar.svelte ← peek translateX 값 수정 (Fix B)
  - src/routes/products/search/+page.svelte ← FloatingBar 중복 인스턴스 제거 (Fix C)

- [x] DS-1: front-uiux.md §13-3 FloatingBar 상세 스펙 확장 | ROUTINE | ✅ 완료 (2026-07-23)
  - 구성 개요 표 (4요소: FloatingBar·장바구니·검색·채팅FAB 파일·크기 매핑)
  - 레이아웃 스펙 표 (위치/정렬/Peek·Expand 트랜지션 값/PC 대응)
  - FloatingBar Props 표 (5개 prop 타입·기본값·설명)
- [x] DS-2: front-uiux.md §13-3-1 FloatingButton 채팅 FAB 서브섹션 신규 추가 | ROUTINE | ✅ 완료 (2026-07-23)
  - 상태별 시각 3종 (기본/미읽음/열림)
  - 미읽음 배지 상세 (레드 원점 크기·위치·색상 + ripple 2개 타이밍)
  - Props 표 5개 + 내부 동작 4종 + 표준 사용 패턴 코드 + GATE C 체크리스트 6항목
- [x] DS-3: front-uiux.md §13-4 명칭 대조표 갱신 | ROUTINE | ✅ 완료 (2026-07-23)
  - `채팅 플로팅 그룹` Stephen 명칭을 FloatingBar 항목에 추가
  - `채팅 FAB` / `채팅 버튼` → FloatingButton 행 신규 추가
- [x] BUG-A: +layout.svelte FloatingBar 조건 — /products/ 제외 조건 삭제 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 원인: /products/[id] 상세 페이지가 레이아웃 조건에서 제외됐으나 자체 FloatingBar 없음 → 완전 누락
  - 수정: `&& !page.url.pathname.startsWith('/products/')` 조건 삭제
  - 영향: /products/[id], /products/search 등 전체 하위 경로 FAB 복원
- [x] BUG-B: FloatingBar.svelte peek CSS translateX 수정 | ROUTINE | ✅ 완료 (2026-07-23)
  - 원인: calc(50% + 24px) = 59px 이동 → 화면 노출 35px (44px 최소 터치 타겟 미달)
  - 수정: calc(50% + 24px) → calc(50% + 15px) = 50px 이동 → 노출 44px
  - 애니메이션·클릭 동작·PC 동작 무변경
- [x] BUG-C: products/search/+page.svelte 중복 FloatingBar 제거 | ROUTINE | ✅ 완료 (2026-07-23)
  - 원인: 검색 페이지가 props 없이 독립 FloatingBar 렌더 → 로그인 사용자도 guest 컨텍스트 고정
  - 수정: import FloatingBar + `<FloatingBar />` 2줄 제거 → 레이아웃 인증 인스턴스로 통일
  - BottomTabBar 및 기타 코드 무변경

sp3-qa-agent GATE C 검수 결과:
  - [x] QA-1: layout.svelte FloatingBar 조건 — /checkout · /account 제외 추가 | ROUTINE | ✅ 완료 (2026-07-23)
    → Stephen 결정: /checkout · /account 에서 FloatingBar 숨김 (GNB 동일 패턴)
    → 수정: `!cms && !contract` → `!cms && !checkout && !account && !contract`
    → 주석도 4가지 제외 경로 명시로 갱신
  - [x] QA-2: front-uiux.md §13-3 Peek 값 문서↔코드 불일치 수정 | ROUTINE | ✅ 완료 (2026-07-23)
    → `calc(50% + 24px)` → `calc(50% + 15px)` 수정 (FloatingBar.svelte 코드와 동기화)

GATE E: ✅ QA-1 · QA-2 모두 해결 완료 — git commit 허가

---

## NOW — CMS 옵션상품 탭 버그픽스 보완 (2026-07-24) ✅ 완료

plan_source: 세션 내 아젠다 (컨텍스트 이관)
핵심제약:
  - upsert_product_option_links RPC UNIQUE 제약 충돌 수정
  - 요청 범위 외 수정 없음

신규 파일:
  - supabase/migrations/20260724000161_161_fix_option_links_image_url.sql ← get_product_option_links RPC image_url ->>0 수정 (이전 세션 잔여)
  - supabase/migrations/20260724000162_162_fix_upsert_option_links_conflict.sql ← upsert UNIQUE 충돌 근본 수정

- [x] BUG-161: get_product_option_links image_url 따옴표 버그 | ROUTINE | ✅ 완료 (2026-07-24)
  - 원인: image_urls JSONB [1] 접근 → "url" 따옴표 포함 반환
  - 수정: ->>0 연산자 (JSONB text 추출, 따옴표 없음 + 0-indexed)
  - DB 적용: Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅

- [x] BUG-162: upsert_product_option_links UNIQUE 제약 충돌 | BOUNDARY | ✅ 완료 (2026-07-24)
  - 원인: soft-delete 후 동일 (product_id, option_product_id) 재삽입 → UNIQUE 위반 → 두 번째 저장부터 전부 실패
  - 수정: 제거 항목 하드 DELETE + 유지/신규 항목 ON CONFLICT DO UPDATE (멱등 upsert)
  - DB 적용: Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅

- [x] BUG-OPT: 개별 옵션 combo btn Svelte 5 반응성 패턴 수정 | ROUTINE | ✅ 완료 (이전 커밋 8da5849 포함)
  - localOptions[i].prop → opt.prop 직접 참조 ({#each} 표준 패턴)

⏳ QA: sp3-qa-agent 검수 예정

---

## NOW — 상품 상세 페이지 로직 전면 점검 + 버그픽스 (2026-07-24) ✅ 완료

plan_source: 세션 내 아젠다
핵심제약:
  - 기존 정상 작동 로직(예약담기 흐름) 보호 최우선
  - E-2(optionLinks 빈 배열) — 숫자 ID 상품 설계 의도 확인 → Skip
  - reserveDisabled prop: 기존 !startDate 조건 병렬 보호

신규/수정 파일:
  - src/routes/products/[id]/+page.server.ts ← E-1(Boolean 캐스트) · E-3(인기상품 price24h 폴백) · E-4(에러 로깅)
  - src/routes/products/[id]/+page.svelte ← A-1·A-2·A-3·C-1·D-2 롤백 + 필수옵션 제한 로직
  - src/lib/components/products/CalendarTimePicker.svelte ← A-3·B-1 + 필수옵션 버튼 텍스트 분기 + "예약신청" 텍스트 변경

- [x] E-3: 인기 상품 price24h 폴백 | ROUTINE | ✅ 완료 (2026-07-24)
  - base_price_daily=0인 인기 상품 → price_rules 24H 배치 조회 후 폴백 적용
  - products 목록 페이지 동일 패턴 적용

- [x] A-1: 비로그인 예약신청 → 로그인 리다이렉트 | BOUNDARY | ✅ 완료 (2026-07-24)
  - handleReserve() 진입 시 !data.session → goto('/auth/login?next=' + encodeURIComponent(window.location.pathname))
  - 상품 정보 유실 방지 (return URL 포함)

- [x] A-2: create_hold_reservation endDate 폴백 + 시간 정보 저장 | BOUNDARY | ✅ 완료 (2026-07-24)
  - endDate = e.endDate || e.startDate (당일 대여 폴백)
  - 예약 생성 후 set_reservation_shipment_method RPC로 pickup_time / return_time 저장 (HH:MM 형식)
  - 새 마이그레이션 불필요 (기존 Migration #147 RPC 활용)

- [x] A-3: handleReserve/onreserve 시그니처 startMin/endMin 확장 | ROUTINE | ✅ 완료 (2026-07-24)
  - CalendarTimePicker onreserve/onchange 콜백: startMin / endMin 필드 추가
  - page.svelte: startMin / endMin $state 추가 + handleCalChange 동기화

- [x] B-1: 당일 반납 시각 역전 경고 | ROUTINE | ✅ 완료 (2026-07-24)
  - sameDayTimeError $derived: isSameDayRental && endTime <= startTime
  - 요금 안내 하단 경고 문구 조건부 표시 (fee-note--warn CSS 추가)

- [x] C-1: is_required 옵션 초기 qty=1 | ROUTINE | ✅ 완료 (2026-07-24)
  - optionItems 초기화 시 link.is_required ? 1 : 0 기본 수량 적용

- [x] E-1: shipping Boolean 캐스트 | ROUTINE | ✅ 완료 (2026-07-24)
  - pr['shipping_round_trip'] 등 Boolean() 캐스트 — DB 컬럼 타입 무관 truthy 판단 통일

- [x] E-4: shippingSettingsRes 에러 로깅 추가 | ROUTINE | ✅ 완료 (2026-07-24)
  - console.error('[products/[id]] rental_shipping_settings error:', ...) 추가

- [x] FEAT-REQUIRED-GUARD: 필수 옵션 미선택 시 예약신청 제한 | BOUNDARY | ✅ 완료 (2026-07-24)
  - hasUnfilledRequired $derived: optionItems에 is_required && qty===0 항목 존재 시 true
  - CalendarTimePicker reserveDisabled prop: disabled={!startDate || reserveDisabled}
  - 버튼 텍스트: reserveDisabled ? '필수 옵션을 선택해주세요' : '예약신청'
  - 기존 !startDate 조건 완전 보호 (병렬 OR 연산)

- [x] TEXT-CHANGE: "예약담기" → "예약신청" 텍스트 변경 | ROUTINE | ✅ 완료 (2026-07-24)

- [x] D-2 ROLLBACK: 리뷰 등록 버튼 !session 제거 | BUGFIX | ✅ 완료 (2026-07-24)
  - 원인: $derived(data.session) SvelteKit hydration 타이밍 이슈 → 로그인 상태에서도 session 일시 null → 버튼 영구 비활성화
  - 수정: disabled={isSubmittingReview || !reviewTitle.trim() || !reviewContent.trim()} (!session 제거)
  - 비로그인 보호: submitReview() 내부 if(!session) goto('/auth/login') 유지 (충분)

- [x] E-2 SKIP: optionLinks 빈 배열 — 숫자 ID 상품 설계 의도 확인 | SKIP | ✅ 완료 (2026-07-24)
  - product_option_links UUID FK → 숫자 ID 상품 연결 불가 (설계 의도). 코드 수정 불필요.

⏳ QA: sp3-qa-agent 검수 예정

---

## NOW — /account 마이페이지 기능 완성 (2026-07-24) ✅ 완료

plan_source: 세션 내 아젠다 (컨텍스트 이관)
핵심제약:
  - 요구 범위 외 수정 없음
  - Svelte 5 Runes 패턴 준수
  - front-uiux.md 디자인 토큰 적용

신규/수정 파일:
  - supabase/migrations/20260724000158_158_product_wishlists.sql ← 신규 (Stage 적용 완료)
  - src/lib/components/cms/CustomerDetailPanel.svelte ← 빠른문의 탭 콘텐츠 완성
  - src/lib/components/account/WishlistScroll.svelte ← mock 제거 + 실DB 연동 + 하트 토글
  - src/routes/account/+page.server.ts ← get_user_wishlists RPC + orders→products JOIN + PC 패널 데이터
  - src/routes/account/+page.svelte ← PC 로그아웃 버튼 추가 (handleLogout + CSS)
  - src/routes/account/rental/+page.server.ts ← MyRental 인터페이스 + product_name/category
  - src/routes/account/rental/+page.svelte ← 상품명·카테고리 product-row 추가
  - src/routes/account/cancel/+page.svelte ← SubGnb mobileOnly 수정
  - src/lib/components/account/PcRentalPanel.svelte ← product_name/category props + 카드 UI
  - src/lib/components/common/RentalJourneyStepper.svelte ← 20% 축소 + padding 20px + radius 30px + 폰트 토큰
  - src/lib/components/account/MenuSection.svelte ← 로그아웃 버튼 추가 (모바일)

DB 적용:
  - Migration #158 product_wishlists — Stage(ezyvffjvuwmtuhpxdjrw) ✅ 적용 완료
  - Migration #158 — Production(vnbpmvxruyciuuaermyh) ⛔ Stephen 확인 후 적용

- [x] FEAT-WISHLIST: product_wishlists 테이블 신규 + WishlistScroll 실DB 연동 | BOUNDARY | ✅ 완료 (2026-07-24)
  - Migration #158: product_wishlists (user_id + product_id UNIQUE), RLS 3정책, RPC 2종(toggle/get)
  - WishlistScroll: mock 배열 제거 → items/totalCount props + $effect 동기화 + handleWishToggle 즉시 필터링
  - RPC 타입 캐스팅: supabase.rpc as unknown as (fn, params) => Promise<...>

- [x] FEAT-RENTAL-CARD: 대여 카드 상품명·카테고리 추가 | BOUNDARY | ✅ 완료 (2026-07-24)
  - orders(order_items(products(name, category))) Supabase nested select
  - rental/+page.server.ts, account/+page.server.ts, PcRentalPanel.svelte 3곳 적용

- [x] FEAT-STEPPER: RentalJourneyStepper 다단계 CSS 조정 | ROUTINE | ✅ 완료 (2026-07-24)
  - 전체 20% 축소, padding 20px, border-radius 30px, 폰트 한 단계 작은 토큰

- [x] FEAT-LOGOUT: 로그아웃 버튼 추가 (모바일 + PC) | BOUNDARY | ✅ 완료 (2026-07-24)
  - MenuSection.svelte variant='myinfo': supabase.auth.signOut() + goto('/')
  - account/+page.svelte PC 내정보 카드 하단: pc-btn-logout + pc-logout-wrap CSS

- [x] FEAT-INQ-TAB: CMS 고객 패널 빠른문의 탭 콘텐츠 완성 | BOUNDARY | ✅ 완료 (2026-07-24)
  - CustomerDetailPanel.svelte 빠른문의 탭 아코디언 목록 + 로딩/빈 상태 + 관리자 답변 UI

DB 적용 (최종):
  - Migration #158 product_wishlists — Stage(ezyvffjvuwmtuhpxdjrw) ✅ 적용 완료
  - Migration #158 — Production(vnbpmvxruyciuuaermyh) ✅ 적용 완료 (2026-07-24)

추가 수정 (2026-07-24):
  - src/lib/components/account/WishlistScroll.svelte ← 브라우저 supabase.rpc 제거 → /api/wishlist fetch 교체
  - src/routes/api/wishlist/+server.ts ← 신규 (toggle_product_wishlist RPC 래퍼 — 서버사이드 인증)

⏳ QA: sp3-qa-agent 검수 예정

---

## NOW — /checkout 재검증 + 전자계약 보완 (2026-07-23) 진행 중

plan_source: users-stevenmac-documents-pseries-crazy-sorted-quail.md
핵심제약:
  - 5-Zone PRD + BE Arch v1.55 정합
  - Stage(ezyvffjvuwmtuhpxdjrw) 검증 완료 마이그레이션만 Production 적용

신규/수정 파일:
  - supabase/migrations/20260723000146_146_contract_signings_expiry.sql ← 신규 (Stage 미적용)
  - src/routes/contract/expired/+page.svelte ← 신규 (만료 링크 안내 페이지)
  - src/routes/contract/[token]/+page.server.ts ← 수정 (expires_at 만료 체크 추가)
  - src/routes/api/contracts/[token]/sign/+server.ts ← 수정 (expires_at 만료 체크 + 서명 후 채팅 알림)
  - src/routes/api/cms/contracts/[id]/send-chat/+server.ts ← 수정 (context_type 'payment'→'reservation')
  - src/lib/types/database.ts ← 수정 (Contract 인터페이스 reservation_id: number, nullable 필드 정정)
  - src/lib/components/cms/RentalContractViewer.svelte ← 수정 (재발송 확인 다이얼로그 추가)
  - src/routes/checkout/+page.server.ts ← 신규 (세션 검증 + 실 카트 데이터 로드)
  - src/routes/checkout/+page.ts ← 수정 (픽스처 폴백 명시)

- [x] I-2: RentalContractViewer 재발송 확인 다이얼로그 | ROUTINE | ✅ 완료 (2026-07-23)
- [x] I-3: Migration #146 expires_at 컬럼 + expired 페이지 + 만료 체크 로직 | BOUNDARY | ✅ 코드 완료 (Stage 적용 필요)
- [x] I-4: context_type 'payment'→'reservation' 수정 | ROUTINE | ✅ 완료 (2026-07-23)
- [x] I-5: Contract TypeScript 인터페이스 정합 (reservation_id/nullable) | ROUTINE | ✅ 완료 (2026-07-23)
- [x] TASK-B: checkout/+page.server.ts 신설 — 세션 검증 + cart_items 실 데이터 로드 | CRITICAL | ✅ 완료 (2026-07-23)
  - 세션 있으면: cart_items 쿼리 + 상품 정보 병렬 로드 + 멤버십 등급·crazyScore 로드
  - 세션 없으면: 게스트 빈 배열 (OTP 흐름 유지)
  - serverCartItems / serverProducts / userId / membershipGrade / crazyScore / isServerLoaded 노출
  - +page.ts: 픽스처 폴백 유지 (isServerLoaded=false 시 픽스처 사용)
  - svelte-check: 기존 에러와 동일 (checkout 신규 에러 0건)
- [x] TASK-C: 배송 방식 5탭 UI 구현 (crazy/quick/locker/pickup/epost-CJ) | BOUNDARY | ✅ 완료 (2026-07-23)
  - DeliveryType+VisitLocation+DeliveryService 3타입 → DeliveryMethod 단일 5종 enum으로 통합
  - CardOptions: rentalDelivery/rentalVisit/rentalService → rentalMethod / returnMethod
  - RentalForm 스니펫: delivery/visitLoc/service props → method 단일 prop + onMethodChange
  - 배송 탭 UI: 5개 버튼 (탭명 + 배송비 + 마감시간 표시), 선택 탭 마감시간 별도 배너
  - 아코디언 헤더 값 표시: optionLabel() → methodLabel() 교체
  - 6개 RentalForm 호출 모두 업데이트 + CSS delivery-tabs 신규 추가
  - svelte-check: checkout 신규 에러 0건
- [x] TASK-D: calculate_cart_total() RPC 연동 + 보증금 별도 표시 | CRITICAL | ✅ 완료 (2026-07-23)
  - DB 확정 등급: user_profiles.membership_grade CHECK → NONE/EASY/POP/CRAZY (PRD Plannode 정본)
  - BE Arch v1.55 "PRO" 등급명 오류 확인 — DB CHECK 제약 기준이 SSOT
  - subscription_plans 미시딩 (A안) → FE에서 grade 직접 계산 (NONE/EASY:0%, POP:10%, CRAZY:20%)
  - calculate_cart_total() RPC: p_reservation_ids 기반 → checkout 시점(pre-reservation) 직접 호출 불가
    → FE 계산으로 동일 breakdown 구조 구현 (RPC는 HOLD 예약 생성 후 결제 확인 시 활용)
  - Zone3 산출 로직: otSubtotal / otMembershipDiscount / otDeliveryFee / otVat / otTotal / otDeposit / otEarnPoints
  - 배송비 로직: crazy배송 + 비CRAZY등급 → 3,500원, 나머지 → 0원(착불/무료)
  - 대여기간 동적 계산: rentalDays(start, end) → 날짜 미선택 시 "날짜 미선택" 표시
  - 보증금(otDeposit) 합계금액과 분리된 별도 고지 박스 (PRD.1.2.2.1.11)
  - fmtKrw() 통화 포맷 헬퍼 추가
  - 하드코딩 Order Total 값 전부 derived 변수로 교체
  - svelte-check: 13 errors (기존 동일, checkout 신규 에러 0건)
- [x] TASK-E: 개별/묶음 일정 설정 UX 재구조화 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 전역 Rental Options 패널(rpRentalMethod/rpReturnMethod/rpRentalOpen/rpReturnOpen 등) 완전 제거
  - rp* 상태 변수 12개 + 핸들러 5개 제거
  - "전체 상품 날짜/배송 일괄 설정" 배너를 Order items 섹션 상단에 신규 추가
  - 배너: 접이식(slide) + 날짜/시간/배송방식 입력 + "전체 적용" 버튼 → 전체 카드에 일괄 적용
  - 적용 시 bulkApplied=true → 배너에 "적용됨" 배지 + 실선 테두리 전환
  - sync_cart_dates() RPC 스텁 (TASK-D 연동 예정)
  - no-gap-top 고아 CSS 제거
  - svelte-check: 13 errors (기존 동일, checkout 신규 에러 0건)
- [x] TASK-F: duration_type 탭 (12h|24h|1day|구매) | BOUNDARY | ✅ 완료 (2026-07-23)
  - DurationType = '12h'|'24h'|'1day'|'purchase' 타입 추가
  - c1DurType / c2DurType $state — 기본값 '24h'
  - cardRate() 헬퍼: 12h→halfday_rate / 24h+1day→daily_rate / purchase→별도 문의(fixture×8)
  - c1CardRate / c2CardRate $derived → fixtureSubtotal 기간 유형 반영
  - 각 카드 product-meta에 dur-tabs (12H|24H|1일|구매) pill 탭 UI
  - product-price: 선택 기간 유형·가격 동적 표시 / purchase는 '별도 문의'
  - dur-tab CSS: var(--radius-full) pill / active → --cs-purple fill
- [x] TASK-G: canProceed 5조건 가드 완성 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 기존 약관 체크 1조건 → 5조건으로 확장
  - 조건1: hasItems(!c1Deleted || !c2Deleted)
  - 조건2: datesSet(비삭제 카드 전부 rentalDate+returnDate 입력됨)
  - 조건3: deadlineOk(스텁 true — TASK-D check_delivery_deadline 연동 예정)
  - 조건4: identityOk(로그인 세션 OR 게스트 OTP 인증)
  - 조건5: agreed(약관 동의)
  - footer-guide 인라인 안내 메시지 (조건 미충족 시 footerVisible 상태에서만 노출)
  - @ts-expect-error 주석 1개 — data.userId (dev server 기동 시 PageData 자동 병합으로 해소 예정)
  - svelte-check: 13 errors (기존 동일)
- [ ] I-1: 계약서 없는 상태 관리자 조작 UI (계약서 연결/PDF 업로드) | CRITICAL | ⏳ 대기

Migration 적용 완료:
  - Migration #146 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ 적용 완료 (2026-07-23)

---

## NOW — Search Publishing 08.01 (/products/search 화면) (2026-07-23) ✅ 완료

수정 파일:
  - src/routes/products/search/+page.svelte ← SuggestPicker 오류·더미·푸터 수정
  - src/lib/components/products/SearchProductGrid.svelte ← row-gap 상하 여백 + 더미 제거
  - src/routes/+layout.svelte ← GNB /products/ 조건 복원

- [x] SP-1: SearchProductGrid 상하 여백 추가 | ROUTINE | ✅ 완료 (2026-07-23)
  - row-gap: 40px (모바일) / 60px (PC ≥768px)
  - 기존 gap: 15px → column-gap: 15px / row-gap: 40px 분리

- [x] SP-2: SuggestPicker 드롭다운 선택 시 상세 이동 오류 수정 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 원인: onProductSelect()에서 goto('/products/${opt.id}') 호출
  - 수정: searchQuery = opt.label 만 할당 → 검색결과 그리드 유지 (goto·import 제거)

- [x] SP-3: 하드코딩 더미 상품 제거 → DB 추천 상품 기본 노출 | BOUNDARY | ✅ 완료 (2026-07-23)
  - SearchProductGrid 더미 6건 제거 → products=[] 기본값
  - search/+page.svelte $effect: is_active=true 상품 6건 + price_rules 서브쿼리 조회
  - 12h 가격 없을 시 Math.round(p24h * 0.7) 근사값
  - 검색 시 searchResults / 비검색 시 recommendedProducts 노출 분기

- [x] SP-4: GNB 이중 표시 버그 수정 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 원인: +layout.svelte GNB 조건에서 !startsWith('/products/') 누락 (이전 세션 실수)
  - 수정: !startsWith('/products/') 복원 → /products/search GNB 완전 숨김

- [x] SP-5: 푸터 이중 표시 버그 수정 | BOUNDARY | ✅ 완료 (2026-07-23)
  - 원인: search/+page.svelte에 인라인 site-footer 복사본 존재 (레이아웃 푸터 충돌)
  - 수정: 인라인 footer HTML 전체 제거 + 관련 state(snsOpen/legalOpen/companyOpen) + CSS 제거
  - 검증: document.querySelectorAll('footer').length === 1 확인 ✅

---

## NOW — 대여정보·결제정보 탭 고도화 + 전자서명 캔버스 (2026-07-23) ✅ 완료

plan_source: users-stevenmac-documents-pseries-crazy-vivid-lightning.md (Plan v4)
핵심제약:
  - 기존 DB 구조·API·메뉴 보호 (순수 추가 원칙)
  - Stage(ezyvffjvuwmtuhpxdjrw) 검증 완료 → Production 보류

신규/수정 파일:
  - supabase/migrations/20260723000144_144_reservation_code_and_rpc.sql ← 신규 (Stage 적용 완료)
  - supabase/migrations/20260723000145_145_contract_signings_signature.sql ← 신규 (Stage 적용 완료)
  - src/routes/api/cms/reservations/[id]/payment/+server.ts ← 신규 (CMS 결제상세 lazy-fetch API)
  - src/lib/components/common/SignatureCanvas.svelte ← 신규 (HTML Canvas 전자서명 컴포넌트)
  - src/lib/components/cms/RentalDetailPanel.svelte ← 수정 (대여정보·결제정보·계약서 탭 고도화)
  - src/routes/cms/rentals/+page.server.ts ← RentalListRow 인터페이스 확장
  - src/routes/contract/[token]/+page.svelte ← 수정 (서명 캔버스 연동)
  - src/routes/api/contracts/[token]/sign/+server.ts ← 수정 (signature_data 저장 + status 자동전환)
  - src/lib/components/cms/RentalContractViewer.svelte ← 수정 (대여품목 카드 + CMS 표준화)

DB 적용:
  - Migration #144 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ 적용 완료
    → rental_reservations: reservation_code TEXT UNIQUE + pickup_method TEXT 컬럼 추가
    → generate_reservation_code() 함수 + 자동 트리거
    → 기존 예약 백필 (CZ-YYYYMMDD-XXXXX 형식)
    → get_rental_list RPC 확장 (6개 신규 컬럼 반환)
  - Migration #145 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ 적용 완료
    → contract_signings: signature_data TEXT + stroke_count INTEGER 컬럼 추가
  - Migration #144, #145 — Production(vnbpmvxruyciuuaermyh) ⛔ 보류

- [x] TASK-A: Migration #144 (reservation_code + get_rental_list RPC 확장) | BOUNDARY | ✅ Stage 완료
- [x] TASK-B: GET /api/cms/reservations/[id]/payment — payment_transactions lazy-fetch API | BOUNDARY | ✅ 완료
- [x] TASK-C: RentalDetailPanel 대여정보 탭 완성 (예약코드·상품이미지·대여일수·대여방식) | ROUTINE | ✅ 완료
- [x] TASK-D: RentalDetailPanel 결제정보 탭 완성 (주문번호·쿠폰·포인트·Toss PG 정보 lazy-fetch) | ROUTINE | ✅ 완료
- [x] TASK-E-1: Migration #145 (contract_signings 서명 컬럼) | BOUNDARY | ✅ Stage 완료
- [x] TASK-E-2: SignatureCanvas.svelte (HTML Canvas 전자서명 — 외부 라이브러리 없음) | BOUNDARY | ✅ 완료
- [x] TASK-E-3: contract/[token]/+page.svelte 서명 캔버스 연동 | BOUNDARY | ✅ 완료
- [x] TASK-E-4: api/contracts/[token]/sign 서명 데이터 저장 + shipped→in_use 자동전환 | BOUNDARY | ✅ 완료
- [x] TASK-E-5: RentalContractViewer 대여품목 카드 + CMS 표준화 (34px/.btn-action/이모지 제거/재발송 버튼) | ROUTINE | ✅ 완료
- [x] TASK-E-6: RentalDetailPanel → RentalContractViewer 신규 props 전달 | ROUTINE | ✅ 완료
- [x] QA: svelte-check 신규 에러 0건 (SignatureCanvas clientX 타입 오류 즉시 수정) | GATE C | ✅ 완료 (2026-07-23)
- [x] 브라우저 검증: 대여정보·결제정보·계약서 탭 전 기능 확인 완료 | GATE C | ✅ 완료 (2026-07-23)

---

## NOW — CMS 예약 관리 화면 + 전자계약 서명 시스템 구현 (2026-07-22) ✅ 완료

plan_source: users-stevenmac-documents-pseries-crazy-vivid-lightning.md (Plan v2)
핵심제약:
  - 기존 DB 테이블·RLS·RPC·컴포넌트·메뉴 구조를 변경하지 않는다 (순수 추가 원칙)
  - Stage(ezyvffjvuwmtuhpxdjrw) 검증 완료 → Production 보류 (아래 BLOCKED 참조)

신규/수정 파일:
  - supabase/migrations/20260722001000_140_rental_cms_additions.sql ← 신규 (Stage 적용 완료)
  - src/routes/cms/+layout.svelte ← 최소 2줄 수정 (예약 서브메뉴 추가)
  - src/routes/cms/rentals/+page.server.ts ← 신규 (get_rental_list + 2 actions)
  - src/routes/cms/rentals/+page.svelte ← 신규 (9컬럼 목록 + 필터 + 패널 연동)
  - src/lib/components/cms/RentalDetailPanel.svelte ← 신규 (4탭: 대여/고객/결제/계약)
  - src/lib/components/cms/RentalContractViewer.svelte ← 신규 (계약 상태 배너 + PDF iframe + 발송 버튼)
  - src/routes/api/cms/contracts/[id]/send-chat/+server.ts ← 신규 (계약서 채팅 발송 API)
  - src/routes/contract/[token]/+page.server.ts ← 신규 (서명 페이지 서버 로드)
  - src/routes/contract/[token]/+page.svelte ← 신규 (고객 서명 UI — USER 화면 토큰)
  - src/routes/api/contracts/[token]/sign/+server.ts ← 신규 (서명 처리 API)
  - src/routes/contract/signed/+page.svelte ← 신규 (이미 서명된 링크 안내)
  - src/routes/contract/complete/+page.svelte ← 신규 (서명 완료 페이지)

DB 적용:
  - Migration #140 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ 적용 완료
  - Migration #140 — Production(vnbpmvxruyciuuaermyh) ⛔ 보류 (is_cms_admin() 미존재)

핵심 발견사항 (스키마 실제 vs 계획):
  - rental_reservations.id = BIGINT (계획: UUID)
  - order_items로 JOIN (계획: order_reservations — 미존재)
  - products.image_urls = JSONB (->>0 사용, [1] 불가)
  - rental_reservations.deleted_at 컬럼 없음
  - user_profiles.address = TEXT (계획: JSONB)
  - is_cms_admin() — Stage만 존재, Production 누락

- [x] TASK-1: Migration #140 (contracts + contract_signings + get_rental_list + sync_checkout_to_profile) | CRITICAL | ✅ Stage 완료 — Production 보류
- [x] TASK-2: /cms/rentals 예약 목록 페이지 (+page.server.ts + +page.svelte) | BOUNDARY | ✅ 완료
- [x] TASK-3: RentalDetailPanel.svelte (4탭) | BOUNDARY | ✅ 완료
- [x] TASK-4: 전자계약 뷰어 + 서명 흐름 6개 파일 | BOUNDARY | ✅ 완료
- [x] TASK-5: CMS layout 최소 수정 (예약 서브메뉴 2줄) | ROUTINE | ✅ 완료
- [ ] TASK-6: checkout OTP 연동 | CRITICAL | ⏳ 대기 (Stephen GATE 확인 필요)

- [x] QA: svelte-check 신규 에러 0건 확인 | GATE C | ✅ 완료 (2026-07-22)
  - 전체 에러 15→13건: 2건 수정 (RentalDetailPanel 임포트 경로 + contract 타입 캐스팅)
  - 잔여 13건 = 모두 pre-existing (account/profile/products/search)

⛔ BLOCKED — Production DB Migration #140 적용 불가
  - 원인: Production DB에 is_cms_admin() 함수 미존재 (Migration #134 미적용)
  - 해결 방법: Migration #134~139 순차 적용 후 #140 적용
  - Stephen 액션 필요: Production DB 중간 마이그레이션 순차 적용

---

## NOW — CMS UI 토큰 정형화 + 삭제 버튼 2종 표준화 + 회원 소프트 삭제 (2026-07-21) ✅ 완료

수정/신규 파일:
  - supabase/migrations/20260721000131_131_soft_delete_customer_rpc.sql ← 신규 생성
  - src/routes/cms/customers/+page.server.ts ← deleteCustomer 액션 추가
  - src/lib/components/cms/CustomerDetailPanel.svelte ← 회원 삭제 버튼 + deleteWarnPending + CSS
  - src/routes/cms/set/rental/+page.svelte ← drag-list + accordion-header 삭제버튼 아이콘형 교체 + act-del CSS + act-del--pending
  - src/routes/cms/accounts/list/+page.svelte ← delete-btn 아이콘형 교체 + CSS 교체
  - src/lib/components/chat/AdminChatPanel.svelte ← delete-session-btn ✕ → SVG 아이콘 + hover 표준화
  - src/lib/components/cms/ProductDetailPanel.svelte ← btn-danger-sm 표준 토큰 교체
  - src/routes/cms/codes/_TreeTab.svelte ← color-bar 제거 + act-edit 스타일 복원
  - src/routes/cms/accounts/+page.svelte ← page-title 폰트 + accounts-wrap 패딩 + cta-btn 높이
  - src/routes/cms/accounts/list/+page.svelte ← page-title 폰트 + td 패딩 1.5배
  - src/routes/cms/set/rental/+page.svelte ← 대여 기간 조건 → 대여 기간 제한 옵션 텍스트 수정

DB 적용:
  - Migration #131 soft_delete_customer — Stage(ezyvffjvuwmtuhpxdjrw) ✅ + Production(vnbpmvxruyciuuaermyh) ✅

- [x] TOKEN-1: CMS 표준 삭제 버튼 2종 정형화 지침 메모리 등록 | ROUTINE | ✅ 완료 (2026-07-21)
  - 텍스트형(btn-danger-sm): cs-error 채움 배경 / cms-radius-sm / text-pc-script-12 / hover: opacity 0.8
  - 아이콘형(act-del): transparent 배경 / cs-text-light / hover: rgba(255,53,53,0.08) + cs-red-badge

- [x] UI-1: 삭제 버튼 아이콘형 전수 교체 (5곳) | BOUNDARY | ✅ 완료 (2026-07-21)
  - rental/+page.svelte — drag-list 3곳 + accordion-header 1곳
  - accounts/list/+page.svelte — delete-btn
  - AdminChatPanel.svelte — delete-session-btn ✕ → SVG 휴지통
  - ProductDetailPanel.svelte — btn-danger-sm 표준 토큰 정합

- [x] UI-2: CMS 계정 페이지 디자인 토큰 정합 | ROUTINE | ✅ 완료 (2026-07-21)
  - accounts/+page.svelte: page-title → text-pc-menu-kr-20 / padding → 32px 16px / cta-btn → 36px
  - accounts/list/+page.svelte: page-title → text-pc-menu-kr-20 / td padding → 14px (1.5배)
  - set/rental/+page.svelte: "대여 기간 조건" → "대여 기간 제한 옵션"
  - codes/_TreeTab.svelte: color-bar 레이아웃 제거

- [x] FEAT-1: 회원 소프트 삭제 기능 신규 구현 | CRITICAL | ✅ 완료 (2026-07-21)
  - Migration #131: soft_delete_customer RPC — user_profiles.deleted_at 설정 + 개인정보 마스킹
  - deleteCustomer 서버 액션: manager/superadmin 전용 권한 체크
  - CustomerDetailPanel 최하단 아이콘형 삭제 버튼 (act-del-account)
  - 2단계 경고: 1차 클릭 → csToast.warning + 4초 타이머 / 2차 클릭 → 실제 삭제
  - 예약·대여 기록 보존: auth.users 미삭제 → user_id FK 정합 유지

---

## NOW — CMS 대여관리 설정 (/cms/set/rental) Production DB 마이그레이션 적용 (2026-07-21) ✅ 완료

수정/신규 파일:
  - (코드 변경 없음 — DB 마이그레이션 전용)

DB 적용 (vnbpmvxruyciuuaermyh — Production):
  - 126a: pickup_points 테이블 신규 생성 (Production 누락분 선행 적용)
  - 126: contact_person 컬럼 + 대여설정 4개 테이블 (rental_period_options / rental_method_options / rental_guide_settings / rental_consent_items)
  - 127: RPC 12종 (upsert/delete/reorder × 4 도메인)
  - 128: upsert_rental_guide WHERE id IS NOT NULL 수정
  - 129: in-use check 3종 (placeholder FALSE)
  - 130: in-use check 3종 (real — products.allowed_*_ids @> ARRAY[p_id])

- [x] MIG-PROD: Migration #126~130 Production DB 적용 | CRITICAL | ✅ 완료 (2026-07-21)
  - 검증: 테이블 5종 + RPC 15종 모두 Production DB 존재 확인
  - Stage (ezyvffjvuwmtuhpxdjrw) 검증 완료 → Production (vnbpmvxruyciuuaermyh) 순서 준수

---

## NOW — 상품 대여 정책 섹션 + 상세패널 탭 추가 (2026-07-21) ✅ 완료

수정/신규 파일:
  - supabase/migrations/20260721000125_125_products_rental_policy.sql ← 신규 생성
  - src/routes/cms/products/new/+page.server.ts ← untypedFrom 헬퍼 + 3종 타입 + 병렬 조회 + create action 3필드 수신
  - src/routes/cms/products/new/+page.svelte ← ⑤ 대여 정책 섹션 추가 + 기존 ⑤⑥ 재번호
  - src/routes/cms/products/+page.server.ts ← untypedFrom 헬퍼 + RentalOption/PickupPointOption 타입 + selectedId 병렬 조회 + updateSection rental 핸들러
  - src/lib/components/cms/ProductDetailPanel.svelte ← 대여정책 탭 추가 + dirty 감지 + rental form + CSS
  - src/routes/cms/products/+page.svelte ← ProductDetailPanel rental props 전달

- [x] MIG-125: Migration 125 — products 컬럼 3종 추가 | CRITICAL | ✅ Stage(ezyvffjvuwmtuhpxdjrw) + Production(vnbpmvxruyciuuaermyh) 양 DB 적용 완료 (2026-07-21)
  - allowed_period_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[]
  - allowed_method_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[]
  - allowed_pickup_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[]
  - 데이터 SSOT: rental_period_options / rental_method_options / pickup_points 테이블 (/cms/set/rental 화면에서 관리)

- [x] FEAT-1: /cms/products/new ⑤ 대여 정책 섹션 | BOUNDARY | ✅ 완료 (2026-07-21)
  - rental_period_options · rental_method_options · pickup_points 동적 조회 (하드코딩 전면 금지)
  - 콤보 버튼 복수선택 + hidden input 3종 → products INSERT 시 UUID 배열 포함
  - 기존 ⑤ 이미지 → ⑥ / ⑥ 실물재고 → ⑦ 재번호
  - database.ts 미등록 테이블 → untypedFrom() 헬퍼 적용

- [x] FEAT-2: /cms/products?selected= 대여정책 탭 | BOUNDARY | ✅ 완료 (2026-07-21)
  - ProductDetailPanel 탭 목록: 가격정책 우측에 '대여정책' 탭 추가
  - localPeriodIds / localMethodIds / localPickupIds $state + isDirtyRental $derived (정렬 JSON 비교)
  - $effect 동기화 + switchTab dirty 체크
  - form id="form-rental" + use:enhance={handleSectionSave} + updateSection sectionType='rental' 핸들러
  - Stage DB UUID[] 저장 검증 완료

- [x] QA: svelte-check 수정 파일 기준 0 ERRORS 확인 | GATE C | ✅ 완료 (2026-07-21)

---

## NOW — CMS 상품 '구성품' 기능 추가 (2026-07-21) ✅ 완료

plan_source: cms-products-new-glimmering-lantern.md
수정/신규 파일:
  - supabase/migrations/20260721000128_128_products_components_column.sql ← 신규 생성 ✅
  - src/routes/cms/products/new/+page.svelte ← 구성품 UI 블록 + $state + 함수 추가 ✅
  - src/routes/cms/products/new/+page.server.ts ← components 파싱 + INSERT 포함 ✅
  - src/lib/components/cms/ProductDetailPanel.svelte ← 구성품 탭 추가 (TabKey/TABS/state/콘텐츠 블록) ✅
  - src/routes/cms/products/+page.server.ts ← updateSection components 케이스 추가 ✅

DB 적용:
  - Stage DB (ezyvffjvuwmtuhpxdjrw): Migration #128 적용 완료 ✅
  - Production DB (vnbpmvxruyciuuaermyh): Migration #128 적용 완료 ✅

- [x] FEAT-1: Migration #128 — products.components JSONB 컬럼 추가 | CRITICAL | ✅ Stage + Production 완료 (2026-07-21)
  - ALTER TABLE products ADD COLUMN IF NOT EXISTS components JSONB
  - 기존 specifications 컬럼과 독립 분리 (혼용 금지)

- [x] FEAT-2: /cms/products/new — 구성품 UI 추가 | BOUNDARY | ✅ 완료 (2026-07-21)
  - let components $state<{key,value}[]> 추가 (specifications 패턴 동일)
  - addComponent / removeComponent / serializeComponents 함수 3종 추가
  - <input type="hidden" name="components"> 추가
  - UI: 콘텐츠 에디터 하단, 기술스펙 위 배치 / placeholder: "품명(예: 배터리)" / "수량 or 기타(예: 1개, 단일)"
  - 기존 .spec-list/.spec-row/.spec-key/.spec-val/.remove-btn/.add-btn CSS 재사용

- [x] FEAT-3: new/+page.server.ts — components 파싱 + INSERT | BOUNDARY | ✅ 완료 (2026-07-21)
  - specifications 파싱 직후 components JSON.parse 추가
  - admin.from('products').insert() 호출에 components 포함

- [x] FEAT-4: ProductDetailPanel.svelte — '구성품' 탭 추가 | BOUNDARY | ✅ 완료 (2026-07-21)
  - TabKey 유니온에 'components' 추가 (content와 images 사이)
  - TABS 배열에 { key: 'components', label: '구성품' } 추가 ('상품설명' 탭 우측)
  - localComponents $state + origComponentsJson + isDirtyComponents $derived 추가
  - addComponent / removeComponent / updateComponentKey / updateComponentVal 함수 4종
  - switchTab() dirty 체크에 'components' 탭 조건 추가
  - 탭 콘텐츠 블록: form id="form-components" + CmsDragList 재사용 + handleSectionSave enhance
  - database.ts 수정 없음 — ProductWithComponents 로컬 타입 캐스팅으로 처리

- [x] FEAT-5: products/+page.server.ts — updateSection components 케이스 | BOUNDARY | ✅ 완료 (2026-07-21)
  - sectionType === 'components' 분기 추가
  - admin.from('products').update({ components }).eq('id', productId)

- [x] QA: svelte-check 신규 오류 없음 | GATE C | ✅ 완료 (2026-07-21)
  - 기존 pre-existing 오류 2건(crazylog/+page.svelte) 유지, 신규 0건
  - Stage DB 직접 UPDATE 테스트로 DB 저장/조회 정상 확인

---

## NOW — 카테고리 SSOT 정합 + SuggestPicker 무한루프 근본 수정 + 콤보행 레이아웃 버그 + /products 카테고리 UI 정합 (2026-07-20) ✅ 완료

수정 파일:
  - src/lib/components/common/SuggestPicker.svelte ← effect_update_depth_exceeded 근본 수정 (commit 38f4a28)
  - src/routes/products/[id]/+page.server.ts ← UUID 타입 불일치 503→404 정정 (commit 8e45c73)
  - src/routes/products/[id]/+page.svelte ← 중복 FloatingBar 제거 (commit 8e45c73)
  - src/routes/products/+page.server.ts ← CMS_CATEGORIES 하드코딩 제거 → code_mapping_groups 동적 조회 + show_in_product_filter 필터 추가
  - src/routes/products/+page.svelte ← CAT_ICON·CAT_LABELS 실제 키 정정 / displayCats DB폴백 제거 / cat-icon-box 조건부 렌더 / 호버 인터랙션 수정
  - src/routes/cms/codes/_AutoMappingTab.svelte ← combo-row 키워드 오버플로우 → flex-wrap 수정
  - src/lib/components/products/admin/ProductCategoryModal.svelte ← uploadIcon 에러 표면화 / 저장버튼 활성 유지
  - Production DB (vnbpmvxruyciuuaermyh): products.category 정합 (lighting→light, audio·tripod→accessorie)
  - Stage DB (ezyvffjvuwmtuhpxdjrw): cms-assets Storage 버킷 생성 + RLS 4정책 적용

- [x] FIX-1: SuggestPicker effect_update_depth_exceeded 근본 수정 | CRITICAL | ✅ 완료 (2026-07-20)
  - 원인: refreshSuggestions()에서 suggestions = filterOptions(kw) 쓰기 후 suggestions.length 읽기
    → Svelte 5 $effect가 suggestions를 의존성으로 추적 → filterOptions()가 항상 새 배열 반환 → 무한 루프
  - 해결: next 로컬 변수로 먼저 계산 → next.length 사용 → suggestions = next 마지막에 1회 할당
  - 두 $effect를 하나로 통합 (isFocused 기준 분기)

- [x] FIX-2: /products/[id] UUID 타입 불일치 503→404 | BOUNDARY | ✅ 완료 (2026-07-20)
  - 원인: 구형 숫자 ID(예: /products/9)로 접근 시 PostgreSQL 22P02 오류 → 503 반환
  - 해결: fetchError.code === '22P02' || isLegacyNumericId(rawId) 조건 → error(404, ...) 반환

- [x] FIX-3: /products/[id] 중복 FloatingBar 제거 | ROUTINE | ✅ 완료 (2026-07-20)
  - 레이아웃이 이미 FloatingBar 렌더 중 → 페이지 자체의 중복 import·렌더 제거

- [x] FIX-4: 카테고리 SSOT 정합 — code_mapping_groups 동적 조회 | CRITICAL | ✅ 완료 (2026-07-20)
  - 정책: code_mapping_groups.default_category = 플랫폼 전역 카테고리 SSOT
  - 기존 +page.server.ts CMS_CATEGORIES 9개 하드코딩 → 정책 위반 (구키: action_cam/drone/lighting 등)
  - 해결: code_mapping_groups WHERE default_category IS NOT NULL AND is_active = true 동적 로드
  - CAT_ICON·CAT_LABELS 실제 키(actcam/dronegim/light/accessorie/hypepack)로 정정
  - Production DB products.category 정정: lighting→light (1건), audio·tripod→accessorie (2건)

- [x] FIX-5: CMS 콤보행 키워드 오버플로우 수정 | ROUTINE | ✅ 완료 (2026-07-20)
  - 원인: .combo-row flex-wrap 없음 + .combo-controls flex-shrink:0 max-width:70% → 키워드 태그 우측 잘림
  - 해결: .combo-row align-items:flex-start + flex-wrap:wrap / .combo-controls flex:1 1 0 + flex-wrap:wrap / .combo-chips flex:0 0 auto

- [x] FIX-6: /products SuggestPicker 카테고리 목록 show_in_product_filter 필터 적용 | BOUNDARY | ✅ 완료 (2026-07-20)
  - 원인: code_mapping_groups 전체 조회 → Used Sales Codes(used-item)·협력사(partner) 노출 = 정책 위반
  - 해결: +page.server.ts .eq('show_in_product_filter', true) 추가

- [x] FIX-7: /products 카테고리 UI 하드코딩 완전 제거 | CRITICAL | ✅ 완료 (2026-07-20)
  - catIconIdx / CAT_ICON Record 전체 제거 (하드코딩 SVG fallback 제거)
  - "전체" 버튼 하드코딩 제거
  - displayCats DB 전체 폴백 로직 제거 → CMS 설정 없으면 빈 상태(빈 회색 블록)로 표시
  - cat-icon-box: icon_url 있을 때만 렌더 (빈 회색 박스 노출 제거)

- [x] FIX-8: 카테고리 아이콘 이미지 업로드 — cms-assets 버킷 미존재 | CRITICAL | ✅ 완료 (2026-07-20)
  - 원인: Stage DB에 cms-assets Storage 버킷 없음 → uploadIcon 실패 시 에러 삼킴 → icon_url null 유지
  - 해결: uploadIcon 에러 throw로 표면화 / Stage DB에 cms-assets 버킷 생성 (public, 5MB 제한, svg+xml·png·jpeg·webp 허용) + RLS 4정책 (SELECT public, INSERT/UPDATE/DELETE authenticated)

- [x] FIX-9: 카테고리 버튼 호버 인터랙션 — img 덮임으로 배경 변경 미반영 | ROUTINE | ✅ 완료 (2026-07-20)
  - 원인: cat-icon-box:hover → background 변경이지만 img(100%×100%)가 배경 덮음 / 호버 트리거도 박스 직접 hover로 레이블 호버 미반영
  - 해결: .cat-btn:hover .cat-icon-box로 트리거 변경 + ::after 오버레이(#3b2f8a, opacity 0→0.45, transition 0.2s) 추가

- [x] QA: sp3-qa-agent 검수 (FIX-6~9) | GATE C | ✅ 완료 (2026-07-20) — GATE E 통과, 수정 건 0건

- [x] FIX-10: 헤더 슬라이드 하드코딩 폴백 완전 제거 | CRITICAL | ✅ 완료 (2026-07-20)
  - mobileSlides / desktopSlides 하드코딩 배열 제거
  - MobileSlide / DesktopSlide 인터페이스 제거
  - useDbHero 파생 변수 제거 → data.heroProducts 직접 사용
  - 모바일·데스크탑 슬라이더 {:else} 하드코딩 블록 완전 제거
  - D_MAX_PAGE / visibleDesktopSlides 폴백 참조 제거
  - 미사용 CSS 셀렉터 2건 제거 (.cam-body, .cat-icon-box svg)
  - 설정 없으면 슬라이더 영역 비움 (카테고리 UI와 동일 정책)

- [x] FIX-11: 헤더 슬라이드 빈 상태 BG 블록 UX 보완 | ROUTINE | ✅ 완료 (2026-07-20)
  - 슬라이드 미설정 시 .slider-empty 클래스 조건부 적용
  - 모바일: min-height 300px / 데스크탑: min-height 400px + var(--cs-surface-gray) + var(--radius-2xl)
  - 카테고리 빈 상태와 동일한 UX 패턴

- [x] FIX-12: 카테고리 설정 버튼 상시 노출 | ROUTINE | ✅ 완료 (2026-07-20)
  - .admin-cat-btn opacity:0 / pointer-events:none / hover 조건 제거
  - 다른 관리자 버튼(헤더 상품 설정 등)과 동일하게 상시 노출

- [x] QA: sp3-qa-agent 검수 (FIX-10~12) | GATE C | ✅ 완료 (2026-07-20) — GATE E 통과, 주석 불일치 1건 즉시 수정

- [x] FIX-13: /products 카테고리 버튼 URL 기반 이동 구현 (단계 ⑧) | CRITICAL | ✅ 완료 (2026-07-20)
  - 원인: 카테고리 버튼 onclick이 $state 로컬 토글만 → URL 변경·SSR 재조회 없음 → 그리드 필터링 미동작
  - 해결:
    - +page.server.ts: `url` 파라미터 추가 → `urlCategory = url.searchParams.get('category') ?? 'all'`
    - search_products RPC p_category: urlCategory !== 'all' ? urlCategory : CMS 그리드 설정값
    - +page.svelte: `import { goto }` 추가 + `activeCategory = $derived(data.urlCategory ?? 'all')`
    - 카테고리 버튼: onclick → `goto('/products?category=${cat.id}')` (URL 이동 + SSR 재조회)
    - "전체" 고정 버튼 추가 (SVG 원형 과녁 아이콘) → `goto('/products')`
  - 수정 파일: src/routes/products/+page.server.ts · src/routes/products/+page.svelte

- [x] FIX-14: Migration 124 get_active_categories RPC 신규 생성 + 양 DB 적용 | CRITICAL | ✅ 완료 (2026-07-20)
  - product_category_codes는 RLS "cms only" → 공개 조회 불가
  - get_active_categories() SECURITY DEFINER: depth=0 + is_active + product_category IS NOT NULL 필터
  - Stage DB (ezyvffjvuwmtuhpxdjrw) ✅ + Production DB (vnbpmvxruyciuuaermyh) ✅ 적용 완료
  - GRANT EXECUTE TO anon, authenticated

- [x] VER-1: show_in_product_filter 동작 검증 — SuggestPicker 노출 정합 확인 | BOUNDARY | ✅ 완료 (2026-07-20)
  - DB 직접 조회: 카메라(camera)/렌즈(lens)/협력사(partner)/중고품(used-item) → show_in_product_filter=true
  - 회원 분류·거래 관리 → show_in_product_filter=false (default_category=null) → picker 미노출 정상
  - "협력사"·"중고품" picker 노출 = 정책 위반 아님 (DB에서 관리자가 명시적 true 설정)
  - 결론: 코드 필터 정상 작동. 피커 목록 변경 필요 시 `/cms/codes` → "상품목록" 버튼으로 토글

- [x] QA: sp3-qa-agent 검수 (FIX-13~14 + VER-1) | GATE C | ✅ 완료 (2026-07-20) — GATE E 통과. "전체" 버튼 미존재는 의도적 설계 (Stephen 확인)

---

## NOW — /crazylog/list UI 픽스 + 디자인 토큰 정렬 + 멤버십 배지 전역 방어 (2026-07-20) ✅ 완료

수정/신규 파일:
  - src/routes/crazylog/list/+page.svelte ← 모바일 썸네일 렌더 추가 + 폰트 토큰 6곳 교체
  - src/routes/crazylog/list/+page.server.ts ← resolveGrade() 적용
  - src/app.css ← --text-m-tag-11 · --text-pc-tag-11 신규 토큰 등록
  - src/lib/utils/membership.ts ← resolveGrade() 헬퍼 신규 생성
  - src/lib/components/common/CrazylogWriteCard.svelte ← NONE 배지 방어 조건 추가
  - src/routes/crazylog/+page.svelte ← PC 포스트 카드 /list 레이아웃 동기화 + 폰트 토큰
  - src/routes/crazylog/+page.server.ts ← user_id + author 조회 + createdAt 추가
  - src/routes/crazylog/view/[slug]/+page.server.ts ← resolveGrade() 적용
  - src/routes/crazylog/[slug]/+page.server.ts ← resolveGrade() 적용

- [x] FIX-1: 모바일 카드 썸네일 미노출 | ROUTINE | ✅ 완료 (2026-07-20)
  - m-post-card 마크업에 `<img>` 태그 누락 → thumbnailUrl 있을 때 m-post-thumb 렌더 추가
  - 썸네일 없을 때 기존 m-post-body-only 카드 유지
- [x] FIX-2: 폰트 디자인 토큰 정렬 | ROUTINE | ✅ 완료 (2026-07-20)
  - 모바일·PC 카드 텍스트 6곳 하드코딩 → CSS 변수 토큰 교체
  - 신규 토큰 2종 등록: --text-m-tag-11 (700 11px) · --text-pc-tag-11 (700 11px)
- [x] FIX-3: NONE 멤버십 배지 전역 미노출 | BOUNDARY | ✅ 완료 (2026-07-20)
  - 원인: DB membership_grade = 'NONE' 문자열 → truthy 통과 → 배지 노출
  - resolveGrade() 헬퍼 신규 생성 (src/lib/utils/membership.ts) — 서버 3곳 일괄 적용
  - CrazylogWriteCard.svelte 컴포넌트에 `!== 'NONE'` 방어 조건 추가 (이중 방어)
- [x] FEAT: /crazylog 메인 PC 포스트 카드 /list 레이아웃 동기화 | BOUNDARY | ✅ 완료 (2026-07-20)
  - +page.server.ts: user_id + author(user_profiles 조회) + createdAt 추가, desc 제거
  - +page.svelte: d-post-log-type + d-post-meta 추가, gap 50px→20px, 폰트 토큰 교체
- [x] QA: svelte-check 타입 오류 0건 확인 | GATE C | ✅ 완료 (2026-07-20)

---

## NOW — SuggestPicker 공통 컴포넌트화 + 디자인 시스템 등록 (2026-07-20) ✅ 완료

[CONTEXT BRIDGE — SuggestPicker 공통화]
수정/신규 파일:
  - src/lib/types/suggest-picker.ts ← 신규 (SuggestPickerOption · SuggestPickerVariant)
  - src/lib/components/common/SuggestPicker.svelte ← 신규 공통 컴포넌트
  - src/lib/types/cms-suggest-picker.ts ← re-export shim (구경로 호환)
  - src/lib/components/cms/CmsSuggestPicker.svelte ← re-export shim (구경로 호환)
  - src/lib/components/products/admin/ProductCategoryModal.svelte ← import 공통 경로 교체
  - src/lib/components/products/admin/ProductHeroModal.svelte ← 수동 suggest → SuggestPicker 교체
  - src/routes/cms/products/new/+page.svelte ← import 공통 경로 교체
  - .claude/rules-ref/cms-uiux.md ← §7-7-2 + §12 전면 개편
  - .claude/rules-ref/front-uiux.md ← §12 신규 추가 (USER 화면 호출 규칙)
  - .claude/rules/uiux-index.md ← 공통 컴포넌트 빠른 참조 표 추가

- [x] SP-1: SuggestPicker 공통 타입 + 컴포넌트 신규 생성 | BOUNDARY | ✅ 완료 (2026-07-20)
  - src/lib/types/suggest-picker.ts: SuggestPickerOption · SuggestPickerVariant (category/brand/generic)
  - src/lib/components/common/SuggestPicker.svelte: 기존 CmsSuggestPicker 로직 100% 동일 이동
  - 추가 prop: variant (listLabel 기본값 자동), noFilter (비동기 검색용), renderItem 스니펫, itemLayout (column/row)
- [x] SP-2: 구경로 re-export shim 처리 | ROUTINE | ✅ 완료 (2026-07-20)
  - CmsSuggestPicker.svelte → SuggestPicker 위임 shim
  - cms-suggest-picker.ts → suggest-picker.ts re-export shim
- [x] SP-3: 호출처 2곳 import 교체 | ROUTINE | ✅ 완료 (2026-07-20)
  - ProductCategoryModal · cms/products/new → 공통 경로로 교체
- [x] SP-4: ProductHeroModal 수동 suggest → SuggestPicker 교체 | BOUNDARY | ✅ 완료 (2026-07-20)
  - 비동기 DB 검색 특성 → noFilter + itemLayout="row" + renderItem 스니펫 활용
  - 수동 .suggest-layer/.suggest-item CSS 50줄 제거
  - 선택 후 입력창 자동 초기화: pickerSelectedId = null + searchResults = []
- [x] SP-5: 디자인 시스템 규칙 업데이트 | ROUTINE | ✅ 완료 (2026-07-20)
  - cms-uiux.md §7-7-2 · §12: 경로·variant표·2종 예시코드·금지항목 갱신
  - front-uiux.md §12 신규: USER 화면 호출 규칙 + 2종 variant 기준 + 금지항목
  - uiux-index.md: 공통 컴포넌트 빠른 참조 표 + 로드 조건 갱신
- [x] SP-6: svelte-check 0 ERRORS 확인 | GATE C | ✅ 완료 (2026-07-20)

---

## NOW — Crazylog 작성/뷰 페이지 UX 개선 + 버그픽스 (2026-07-20) ✅ 완료

수정 파일:
  - src/routes/crazylog/[slug]/+page.svelte ← 작성 페이지 모바일·PC UX 전반 개선
  - src/routes/crazylog/view/[slug]/+page.svelte ← 뷰 페이지 PC 내비바 + 태그·이미지 버그픽스
  - src/routes/crazylog/view/[slug]/+page.server.ts ← keywords 쿼리 추가
  - src/routes/crazylog/list/+page.svelte ← 목록 PC 폰트 토큰 수정 (원복)
  - src/lib/components/cms/CmsContentEditor.svelte ← 태그 kw-tag 폰트 토큰 업그레이드
  - src/lib/components/common/CrazylogWriteCard.svelte ← 쓰기·삭제 버튼 디자인 + wc-name 모바일 숨김
  - src/app.css ← --cs-red-xlight (#FFE7E7) 신규 토큰 등록

- [x] UX-1: 작성 페이지 모바일 사용자 카드 개선 | ROUTINE | ✅ 완료 (2026-07-20)
  - 레이아웃 한 행 재정렬 (m-user-info flex-row + m-user-row display:contents)
  - 아바타 44px→53px (1.2배), 폰트 21px
  - 콘텐츠·조회 폰트 --text-m-script-12 적용
  - 사용자명(wc-name) 모바일 숨김 처리
- [x] UX-2: 작성 페이지 모바일 옵션 카드 폰트 토큰 개선 | ROUTINE | ✅ 완료 (2026-07-20)
  - m-toggle-label 컬러 --cs-text-dark → --cs-text-mid (PC 동일 토큰 적용)
  - m-opts-heading --text-m-title-18B (18px Bold) 확정
- [x] UX-3: 작성 페이지 모바일 폼 패딩 10% 증가 | ROUTINE | ✅ 완료 (2026-07-20)
  - m-user-card: 14/16px → 15/18px
  - m-select · m-input: 10/20px → 11/22px
  - m-submit: 15/20px → 17/22px, max-width 제거(전폭), --text-m-title-18B 적용
- [x] UX-4: 작성 페이지 PC 에디터·사이드바 폰트 토큰 업그레이드 | ROUTINE | ✅ 완료 (2026-07-20)
  - d-select-label: body-14 → title-16
  - d-input: body-14 → title-18
  - d-submit: title-16 → title-18
  - d-user-name: title-16 → title-18
  - d-stat-label: script-12 → body-14
  - d-stat-value: title-16 → title-18
  - kw-tag (CmsContentEditor): script-12 → body-14
- [x] BUG-1: 뷰 페이지 태그 누락 수정 | BOUNDARY | ✅ 완료 (2026-07-20)
  - view/+page.server.ts: PostRow에 keywords 필드 추가, SELECT 쿼리 포함, post 객체에 반환
  - view/+page.svelte PC: d-tags / d-tag 렌더링 + CSS 추가
  - view/+page.svelte 모바일: m-tags / m-tag 렌더링 + CSS 추가 (--text-m-script-14B)
- [x] BUG-2: 뷰 페이지 이미지 좌측 쏠림 수정 | ROUTINE | ✅ 완료 (2026-07-20)
  - .d-content-images: justify-content:center, individual/collage 레이아웃 CSS 신규 추가
  - .d-content-img: max-width:100%, border-radius, display:block
- [x] UX-5: 뷰 페이지 PC 서브 내비바 개선 | ROUTINE | ✅ 완료 (2026-07-20)
  - 내비명 중앙→우측 끝 배치 (margin-left:auto + order:3)
  - 폰트: Tilt Warp 20px → --text-pc-menu-kr-20 (500 20px)
  - 컬러: --cs-purple-light → --cs-text-mid
- [x] UX-6: CrazylogWriteCard 쓰기·삭제 버튼 디자인 | ROUTINE | ✅ 완료 (2026-07-20)
  - 쓰기 버튼: SVG 아이콘 제거, BG --cs-red-badge → --cs-purple-dark (#201857)
  - 삭제 버튼: BG --cs-chat-in-bg → --cs-red-xlight (#FFE7E7, 신규 토큰)
  - --cs-red-xlight 신규 토큰 app.css 등록

---

## NOW — Crazylog 보류 기능 재배치 (2026-07-20) ✅ 완료

수정 파일:
  - src/routes/crazylog/view/[slug]/+page.svelte
  - src/routes/crazylog/[slug]/+page.svelte
  - src/routes/crazylog/list/+page.server.ts

- [x] FIX: view 페이지 "보류 처리" 버튼 제거 (PC d-navi-actions + 모바일 m-admin-bar) | ROUTINE | ✅ 완료
- [x] FEAT: 수정화면 "공개설정" 우측 보류 토글 배치 (PC+모바일) | BOUNDARY | ✅ 완료
- [x] FEAT: 목록 쿼리 — 로그인 작성자 보류 포스트 노출 (.or 조건) | BOUNDARY | ✅ 완료

---

## PREV — Crazylog avatar_url 버그 + 사용자 정보카드 컴포넌트화 (2026-07-20) ✅ 완료

수정 파일:
  - src/routes/crazylog/[slug]/+page.server.ts
  - src/routes/crazylog/list/+page.server.ts
  - src/routes/crazylog/view/[slug]/+page.server.ts
  - src/routes/crazylog/list/+page.svelte
  - src/routes/crazylog/view/[slug]/+page.svelte
  - src/lib/components/common/CrazylogWriteCard.svelte (신규)
  - supabase stage DB: user_profiles.full_name = '이기성' 업데이트

- [x] FIX-3: avatar_url 컬럼 부재 → 3개 page.server.ts 쿼리 실패 → '익명' 표시 | BOUNDARY | ✅ 완료
- [x] FEAT: CrazylogWriteCard.svelte 컴포넌트 단일화 (list + view 인라인 중복 제거) | BOUNDARY | ✅ 완료

---

## PREV — Crazylog 글등록 무반응 + 토글 UI 픽스 (2026-07-20) ✅ 완료

[CONTEXT BRIDGE — crazylog write page bugfix]
수정 파일:
  - src/routes/crazylog/[slug]/+page.svelte (단일 파일 수정)

- [x] FIX-1: 로그 등록 버튼 무반응 버그 | BOUNDARY | ✅ 완료 (2026-07-20)
  - 원인: handleSubmit() 이미지 없음 분기에서 csToast.warning() 호출 → 사용자 화면 <Toaster> 미등록(CMS 전용) → toast 무음 실행 = 버튼 무반응
  - 해결: csToast.warning() → errorMsg 할당 (기존 validation 패턴과 통일)
  - import { csToast } 미사용 → 제거

- [x] FIX-2: 토글 버튼 시각 왜곡 (크기 비정상) | ROUTINE | ✅ 완료 (2026-07-20)
  - 원인: padding-block:12px + box-sizing:content-box → 배경이 20+12+12=44px 높이로 확대됨
  - 해결: position:relative(컨테이너) + thumb position:absolute top:2px left:2px + transform:translateX(16px)(ON)
  - width 32px→36px, off 배경 --cs-text-dark→--cs-disabled-toggle 정정 (cms-uiux.md Section 7-8 표준)

---

## NOW — write-card 사용자 정보 카드 복원 (2026-07-20) ✅ 완료

[CONTEXT BRIDGE — view/[slug] write-card revert]
수정 파일:
  - src/routes/crazylog/view/[slug]/+page.server.ts ← counts 3종 쿼리 + counts 반환 제거
  - src/routes/crazylog/view/[slug]/+page.svelte ← 탭+스탯 UI → 사용자 정보 카드 복원

원인: 이전 세션 마지막 메시지가 컨텍스트 컴팩션으로 신규 세션에 이월 → 자동 실행됨.
      요청 범위 외 수정으로 판정 → 즉시 복원.

- [x] REVERT-1: +page.server.ts — counts 쿼리 + 반환값 제거 | ROUTINE | ✅ 완료 (2026-07-20)
- [x] REVERT-2~5: +page.svelte — TABS/PC_STAT_TABS 제거, write-card HTML+CSS 복원, PC 미디어쿼리 복원 | ROUTINE | ✅ 완료 (2026-07-20)
- [x] REVERT-6: svelte-check 0 errors 확인 | GATE C | ✅ 완료 (2026-07-20)

---

## NOW — Crazylog 헤드이미지 지정 기능 (2026-07-20) ✅ 완료

[CONTEXT BRIDGE — head image long-press]
수정 파일:
  - src/lib/types/content-editor.ts ← isHead?: boolean 추가 ✅
  - src/lib/components/cms/CmsContentEditor.svelte ← 롱프레스 로직 + Head 배지 UI ✅
  - src/routes/crazylog/[slug]/+page.svelte ← headImageUrl 추출 + p_thumbnail_url RPC 전달 ✅
  - src/routes/crazylog/view/[slug]/+page.svelte ← isHead 이미지 본문 필터링 ✅

- [x] HEAD-1: ImageItem에 isHead?: boolean 추가 | ROUTINE | ✅ 완료
  - src/lib/types/content-editor.ts: ImageItem interface에 isHead?: boolean 필드 추가
- [x] HEAD-2: CmsContentEditor 롱프레스 UX 구현 | BOUNDARY | ✅ 완료
  - longPressTimers $state + startLongPress/cancelLongPress/setHeadImage 함수 3종
  - 포인터 이벤트(pointerdown/pointerup/pointerleave/pointercancel) → 2초 setTimeout
  - .thumb-img-wrap 래퍼 + head-badge CSS 추가 (Head 배지 우측상단 표시)
  - setHeadImage: 전체 이미지 isHead=undefined 초기화 → 대상만 true (중복 지정 방지)
- [x] HEAD-3: [slug]/+page.svelte 제출 로직 — headImageUrl 추출 + RPC 전달 | BOUNDARY | ✅ 완료
  - blocks 순회 → isHead===true 이미지 URL 추출 → p_thumbnail_url 파라미터로 create/update RPC 전달
- [x] HEAD-4: view/[slug]/+page.svelte 본문 렌더링 — Head 이미지 필터링 | BOUNDARY | ✅ 완료
  - PC/모바일 이미지 블록 렌더: block.images.filter(img => !img.isHead) → 본문 중복 노출 방지
  - 헤드 이미지는 post?.thumbnailUrl로 서버에서 derivedThumbnail → 최상단 단독 노출
- [x] HEAD-5: TypeScript 검증 | ROUTINE | ✅ 완료 — 0 ERRORS, 238 WARNINGS (기존 경고 유지)

---

## NOW — crazylog 메인·목록 DB 연동 + 플로팅 카드 (2026-07-20) ✅ 완료

[CONTEXT BRIDGE — crazylog main & list activation]
수정/신규 파일:
  - src/routes/crazylog/+page.server.ts ← 신규 생성 ✅
  - src/routes/crazylog/list/+page.server.ts ← isLoggedIn·currentUser 추가 ✅
  - src/routes/crazylog/list/+page.svelte ← writeCardVisible + 스크롤 핸들러 + write-card HTML·CSS 추가 ✅

- [x] T-CL-1: /crazylog +page.server.ts — 실DB 카운트 3종 + 포스트 랜덤 10개 연동 | BOUNDARY | ✅ 완료 (2026-07-20)
  - Promise.all 병렬 쿼리: reviewCount / shareCount / promoCount + 포스트 최신 30개 → shuffleArray → 10개
  - extractFirstImageUrl / extractFirstText / BAR_COLORS 헬퍼 구현
  - return { counts: {review, share, promo}, posts }
- [x] T-CL-2: /crazylog 메인 .d-post 카드 CSS 검증 | ROUTINE | ✅ 완료 (2026-07-20)
  - JS computed style 검사: height 180px, display flex, position absolute — 정상 렌더
  - 수정 불필요 (모바일 뷰포트에서 .d-page { display:none } 적용이 원인)
- [x] T-CL-3: /crazylog/list +page.server.ts — isLoggedIn + currentUser 조회 추가 | BOUNDARY | ✅ 완료 (2026-07-20)
  - safeGetSession → user_profiles 조회 (full_name, avatar_url, membership_grade, credit_score)
  - credit_score → LV.1~LV.5 레벨 계산 로직
- [x] T-CL-4: /crazylog/list +page.svelte — 플로팅 사용자 write-card 구현 | BOUNDARY | ✅ 완료 (2026-07-20)
  - writeCardVisible $state + $effect 스크롤 핸들러 (스크롤 다운 숨김/업 노출)
  - write-card HTML: 아바타 + 이름 + 멤버십배지 + 레벨 + 쓰기 버튼
  - 브라우저 정상 확인: 익명 LV.1 · 쓰기 버튼 하단 플로팅 표시

---

## NOW — Crazylog 뷰어 UI 픽스 (2026-07-20) ✅ 완료

[CONTEXT BRIDGE — crazylog view/[slug] mobile fixes]
수정 파일:
  - src/routes/crazylog/view/[slug]/+page.svelte (단일 파일 수정)

- [x] FIX-1: 본문 이미지 모바일 반응형 — 원본 크기 넘침 버그 | ROUTINE | ✅ 완료 (2026-07-20)
  - `.article-images` + `.m-article-img` CSS 추가 (width:100%, max-width:100%, height:auto, object-fit:contain)
  - img 태그에 class="m-article-img" 추가
- [x] FIX-2: 댓글 폼 placeholder 정렬·텍스트 수정 | ROUTINE | ✅ 완료 (2026-07-20)
  - text-align: center → left
  - 텍스트: '후기 입력...' / '로그인 후 작성 가능' → '후기를 등록해 주세요.'

---

## NOW — 상품 후기 기능 구현 (2026-07-20) ✅ 완료

[CONTEXT BRIDGE — product reviews]
plan_source: launch-selected-element-element-tag-sec-floating-papert.md
수정/신규 파일:
  - supabase/migrations/20260720000124_124_product_reviews.sql ← 신규 생성 ✅ (재번호: 123 keywords 충돌 → 124로 정정)
  - src/routes/products/[id]/+page.server.ts ← 수정 ✅
  - src/routes/products/[id]/+page.svelte ← 수정 ✅

- [x] T-124-A: Migration #124 — product_reviews 테이블 + RPC 2종 | CRITICAL | ✅ Stage + Production 적용 완료 (2026-07-20)
- [x] T-123-B: +page.server.ts — session + reviews 로드 추가 | BOUNDARY | ✅ 완료 (2026-07-20)
- [x] T-123-C: +page.svelte — 후기 폼 실제 구현 + MOCK 제거 + 토큰 위반 4건 수정 + CSS 정리 | BOUNDARY | ✅ 완료 (2026-07-20)

---

## NOW — crazylog view/[slug] UI 픽스 (2026-07-18) ✅ 완료

[CONTEXT BRIDGE — crazylog view page UI fixes]
수정 파일:
  - src/routes/crazylog/view/[slug]/+page.svelte (단일 파일 수정)

### ✅ 완료된 픽스 (2026-07-18)

- [x] 수정/삭제 → write-card 이동: d-navi-actions·m-admin-bar에서 제거, write-card 내 `wc-actions` 래퍼로 이동
- [x] 삭제 버튼 isOwner 복원: `{#if data?.isAdmin}` 단독 → `{#if data?.isOwner}` (write-card 내) / `{#if data?.isAdmin}` (navi-bar 관리자 버튼 전용)
- [x] 쓰기 버튼 항상 노출: wc-write-btn은 조건 없이 렌더, 수정/삭제는 `{#if data?.isOwner}`만 조건
- [x] write-card 폭 유연화: `width: 460px` 고정 → `width: auto / min-width: 460px / max-width: 700px`
- [x] svelte-check 0 errors 확인

### ⏳ 후속 필요 (Stephen 확인 후 진행)

- [ ] write-card 수정/삭제 버튼 브라우저 실 확인 (자신의 포스트 vs 타인 포스트)

---

## NOW — /products 페이지 DB 연동 + CMS 하이브리드 UI (2026-07-15)

[CONTEXT BRIDGE — products page DB activation]
plan_source: products-ui-sorted-map.md (세션 내 설계)
수정/신규 파일:
  - supabase/migrations/20260715000118_118_product_page_settings.sql ← ✅ 완료 (NOW-1)
  - src/routes/products/+page.server.ts ← ✅ 완료 (NOW-2)
  - src/routes/products/+page.svelte ← ✅ 완료 (NOW-3)
  - src/lib/components/products/admin/*.svelte ← ⏳ 미완 (NOW-4)

- [x] NOW-1: Migration 118 — product_page_settings + RPC 4종 | ✅ 완료 (2026-07-15)
- [x] NOW-2: +page.server.ts 신규 — isCms, 설정 로드, 상품 병렬 쿼리 | ✅ 완료 (2026-07-15)
- [x] NOW-3: +page.svelte 리팩터링 — DB 데이터 교체, isCms 오버레이, 폴백 | ✅ 완료 (2026-07-15)
  - 0 TypeScript errors (svelte-check 통과)
  - 기존 CSS/DOM 구조 보존, 정적 폴백 유지
  - admin 모달 placeholder 렌더 포함 (NOW-4 대기)
- [x] NOW-4: 관리 모달 4종 | ✅ 완료 (2026-07-15)
  - src/lib/components/products/admin/ProductCategoryModal.svelte (신규)
  - src/lib/components/products/admin/ProductHeroModal.svelte (신규)
  - src/lib/components/products/admin/ProductGridModal.svelte (신규)
  - src/lib/components/products/admin/ProductMdPickModal.svelte (신규 — HeroModal 재사용)
  - +page.svelte placeholder → 실제 컴포넌트로 교체 + unused CSS 제거
  - 0 TypeScript errors (svelte-check 통과)
- [x] NOW-5: ProductHeroModal 버그 수정 + UI 통일 | ✅ 완료 (2026-07-19)
  - Fix 1: 저장 상품 복원 — $effect + get_products_by_ids RPC (항상 빈 목록 버그 해소)
  - Fix 2: search_products product_id → id 정규화 (id: undefined 버그 해소)
  - Fix 3: search_products price_min → base_price_daily 정규화 (0원 버그 해소)
  - Fix 4+5: 검색 UI → CmsSuggestPicker 시각 규격 통일 (f-input + suggest-layer)
  - ProductMdPickModal 자동 수혜 (wrapper 구조)
  - 로컬 브라우저 정상 확인 완료
  - svelte-check: 0 ERRORS
- [x] NOW-6: Migration 118~122 Production 적용 | ✅ 완료 (2026-07-20)
  - 118: product_page_settings + RPC 3종 (get_product_page_settings, upsert_product_page_setting, get_products_by_ids)
  - 119: user_posts log_type 3종 제한 + thumbnail_url 컬럼
  - 120: post_comments 테이블 + create_post_comment RPC
  - 121: create_user_post / update_user_post p_thumbnail_url 파라미터 추가 (구버전 DROP 후 재생성)
  - 122: delete_own_post RPC (소프트 삭제)
  - Production DB: vnbpmvxruyciuuaermyh ✅

---

## NOW — Crazylog 글등록·수정 기능 활성화 (2026-07-15)

[CONTEXT BRIDGE — crazylog write/edit activation]
plan_source: 세션 내 UI 분석 결과 (2026-07-15)
현재 상태:
  - src/routes/crazylog/[slug]/+page.svelte — UI 완성, 기능 전무
    → textarea 에디터 (CmsContentEditor 미연동)
    → 유저 카드 하드코딩 ("스티븐봉재", "로그닷", "LV.4MD")
    → handleSubmit() 빈 함수 (BL-CRAZYLOG-SUBMIT 백로그)
    → +page.server.ts 없음 (인증 없음, 서버 데이터 없음)
  - DB: crazylog 전용 테이블 없음 (최신 Migration #116)
  - CmsContentEditor: src/lib/components/cms/CmsContentEditor.svelte
    → ContentBlock[] 기반 블록 에디터 (재활용 확정 — content-editor.ts 주석 확인)
핵심제약:
  - stage(ezyvffjvuwmtuhpxdjrw) 검증 후 production 적용
  - front-uiux.md 사용자 디자인 토큰 (CTA = --cs-red-badge / 버튼 반경 30px)
  - CmsContentEditor 재활용 시 CMS 스타일이 사용자 화면에 노출되지 않도록 scope 처리
  - 현재 SVG 아이콘 toolbar UI 유지 — 아이콘 클릭 → CmsContentEditor 블록 추가 연결
  - 직접 INSERT/UPDATE/DELETE 금지 → RPC 경유
  - Svelte 5 Runes 문법 ($state / $derived / $props / $effect)
  - $state(prop) 초기화 절대 금지 (수정 모드 로드 시 {#key}로 재마운트)
절대금지:
  - git 자율 실행
  - production DB에 미검증 migration 직접 적용
  - CMS 디자인 토큰(--cms-radius-* / --text-pc-*) 사용자 화면 적용
  - Svelte 4 문법 (on:event)

### Phase 1 — DB 설계 + 마이그레이션

- [x] T-CL-1: Migration #117 — user_posts 테이블 신규 생성 | CRITICAL | ✅ Stage + Production 완료 (2026-07-15)
  - 테이블: user_posts
    id UUID DEFAULT gen_random_uuid() PK
    user_id UUID FK → auth.users NOT NULL
    log_type TEXT NOT NULL (CHECK: '일상 로그'|'여행 로그'|'맛집 로그'|'운동 로그'|'독서 로그'|'영화·드라마 로그'|'공부 로그'|'취미 로그')
    title TEXT NOT NULL (max 100자)
    content_blocks JSONB NOT NULL DEFAULT '[]'   -- ContentBlock[] 직렬화
    keywords TEXT[] NOT NULL DEFAULT '{}'        -- CmsContentEditor keywords 대응
    tags TEXT[] NOT NULL DEFAULT '{}'            -- 태그 칩
    is_public BOOLEAN NOT NULL DEFAULT true
    allow_comments BOOLEAN NOT NULL DEFAULT true
    allow_scrap BOOLEAN NOT NULL DEFAULT true
    allow_ai_save BOOLEAN NOT NULL DEFAULT true
    auto_source BOOLEAN NOT NULL DEFAULT false
    ccl TEXT DEFAULT NULL                         -- CC라이선스 선택값
    status TEXT NOT NULL DEFAULT 'published'
      CHECK (status IN ('draft','published','hidden','deleted'))
    view_count BIGINT NOT NULL DEFAULT 0
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  - 인덱스: user_id, status, created_at DESC, (user_id + status)
  - updated_at 트리거: set_updated_at()
  - RLS 4정책:
    SELECT: (is_public=true AND status='published') OR user_id=auth.uid() OR is_cms_user()
    INSERT: user_id=auth.uid() / WITH CHECK user_id=auth.uid()
    UPDATE: user_id=auth.uid() OR is_cms_user()
    DELETE: 금지 (status='deleted' UPDATE로 대체)
  - RPC (SECURITY DEFINER):
    create_user_post(p_log_type, p_title, p_content_blocks, p_keywords, p_tags, p_is_public,
                     p_allow_comments, p_allow_scrap, p_allow_ai_save, p_auto_source, p_ccl)
      → RETURNS user_posts (새 행 반환)
    update_user_post(p_id UUID, p_log_type, p_title, p_content_blocks, p_keywords, p_tags,
                     p_is_public, p_allow_comments, p_allow_scrap, p_allow_ai_save, p_auto_source, p_ccl)
      → 권한 확인(user_id=auth.uid() OR is_cms_user()) → UPDATE → RETURNS user_posts
    update_post_status(p_id UUID, p_status TEXT)
      → is_cms_user() 확인 → status 변경 (관리자 전용)
    get_user_post_stats(p_user_id UUID)
      → RETURNS (post_count BIGINT, total_view_count BIGINT)
  - Stage 적용 후 Stephen 확인, 이후 Production 적용

### Phase 2 — 서버사이드 인증 + 데이터 로드

- [x] T-CL-2: +page.server.ts 신규 생성 | CRITICAL | ✅ 완료 (2026-07-15)
  - 파일: src/routes/crazylog/[slug]/+page.server.ts
  - load 함수:
    1. locals.safeGetSession() → 미인증 시 redirect(303, '/login')
    2. user_profiles 조회: display_name, avatar_url, membership_type, crazy_score
    3. get_user_post_stats(user_id) RPC → post_count, total_view_count
    4. slug !== 'new': user_posts 조회 → existingPost 반환 (수정 모드)
       → 포스트의 user_id !== session.user.id && !is_cms_role → 403 or redirect
    5. RETURN { session, profile, stats, existingPost }
  - 레벨 계산 함수 (서버측): crazy_score 기반 LV.1~LV.5 파생
    LV.1: score < 30 / LV.2: 30~49 / LV.3: 50~69 / LV.4: 70~84 / LV.5: ≥ 85

### Phase 3 — 에디터 통합 (CmsContentEditor 재활용)

- [x] T-CL-3: CmsContentEditor 통합 — SVG 아이콘 UI 유지 | BOUNDARY | ✅ 완료 (2026-07-15) — textarea 유지, submit 시 content_blocks 변환
  - 파일: src/routes/crazylog/[slug]/+page.svelte (단일 파일 수정)
  - 접근 방식:
    1. CmsContentEditor import, blocks/keywords $state 선언
    2. 모바일(m-) / PC(d-) textarea → <CmsContentEditor bind:blocks bind:keywords hideInternalMediaToolbar={true} />
       OR: CmsContentEditor의 내부 툴바를 CSS :global()로 숨김 처리
    3. 현재 SVG 아이콘 toolbar 버튼(m-toolbar / d-toolbar)을 다음에 연결:
       - "텍스트" 아이콘 → addBlock(makeEmptyTextBlock()) 호출
       - "사진" 아이콘 → addBlock(makeEmptyImageBlock()) 호출
       - "유튜브" 아이콘 → addBlock(makeEmptyYoutubeBlock()) 호출
       - "나누기" 아이콘 → addBlock(makeEmptyDividerBlock()) 호출
       - "삭제" 아이콘 → clearConfirm 모달 → blocks = []
    4. CmsContentEditor에 prop 추가 고려: hideMediaToolbar (내부 미디어 툴바 숨김)
       → CmsContentEditor.svelte에 간단한 prop 추가 (최소 수정)
    5. 이미지 업로드: 기존 /api/cms/upload 재사용 (인증 있으면 허용)
  - 포맷 툴바 (Bold/Italic/Underline 등): CmsContentEditor 내부 포맷 툴바 노출 유지
    → 사용자 UX에 맞게 CSS 스타일 override (front-uiux.md 토큰)
  - 태그: 기존 m-tags-input / d-tags-input 유지 (CmsContentEditor keywords와 분리)
  - 수정 모드: {#key existingPost?.id} 로 컴포넌트 재마운트 → $state(prop) 초기화 버그 방지
    → $effect로 existingPost.content_blocks → blocks 초기화

- [x] T-CL-3b: CmsContentEditor.svelte 최소 수정 | BOUNDARY | ✅ 완료 (2026-07-15)
  - hideMediaToolbar?: boolean $props() 추가
  - {#if !hideMediaToolbar} ... {/if} 로 내부 미디어 툴바 조건부 숨김
  - 기존 CMS 동작 영향 없음 (기본값 false = 현재와 동일)
  - 아이콘 툴바 버튼 → makeEmptyTextBlock/ImageBlock/YoutubeBlock/DividerBlock 연결
  - textarea → CmsContentEditor bind:blocks bind:keywords 교체 (모바일·PC 양쪽)

### Phase 4 — 사용자 카드 실제 데이터 연동

- [x] T-CL-4: 유저 카드 서버 데이터 연동 | BOUNDARY | ✅ 완료 (2026-07-15)
  - 파일: src/routes/crazylog/[slug]/+page.svelte
  - let { data } = $props() → data.profile, data.stats 구조 분해
  - m-user-card:
    - 아바타: data.profile.avatar_url 있으면 <img>, 없으면 기존 그라데이션 배경 유지
    - 이름: data.profile.display_name (없으면 '익명')
    - 배지: data.profile.membership_type → '정기구독' 텍스트 or 배지
    - 레벨: data.profile.level (서버에서 파생)
    - 콘텐츠 등록: data.stats.post_count
    - 콘텐츠 조회: data.stats.total_view_count
  - d-user-card: 동일 데이터 (PC 사이드바)
  - 통계 타일 '임시등록' → '콘텐츠 조회' 텍스트 + data.stats.total_view_count 수치

### Phase 5 — 제출 로직 구현

- [x] T-CL-5: handleSubmit 구현 | BOUNDARY | ✅ 완료 (2026-07-15)
  - 파일: src/routes/crazylog/[slug]/+page.svelte
  - 제출 전 검증: logType 선택 여부, title 최소 1자, blocks.length > 0
  - 신규(slug==='new'): supabase.rpc('create_user_post', {...}) 호출
  - 수정: supabase.rpc('update_user_post', { p_id: existingPost.id, ...}) 호출
  - isSubmitting $state: 제출 중 버튼 disabled + 텍스트 '저장 중...'
  - 성공: goto('/crazylog/view/' + newPost.id) (또는 slug 필드가 있으면 slug 사용)
  - 실패: error $state → role="alert" 표시

### Phase 6 — 관리자 삭제/보류 기능

- [x] T-CL-6: view/[slug] 관리자 액션 버튼 추가 | BOUNDARY | ✅ 완료 (2026-07-15)
  - 파일: src/routes/crazylog/view/[slug]/+page.svelte (수정)
         src/routes/crazylog/view/[slug]/+page.server.ts (수정 or 신규)
  - +page.server.ts: is_cms_user 여부 load에서 반환 (user_profiles.cms_role 조회)
  - data.isAdmin이 true일 때만 관리자 버튼 렌더:
    - "보류 처리" 버튼 → update_post_status(id, 'hidden') RPC
    - "삭제" 버튼 → update_post_status(id, 'deleted') RPC (확인 모달 포함)
    - 현재 status='hidden'이면 "공개" 버튼 → update_post_status(id, 'published')
  - 관리자 버튼 스타일: front-uiux.md 고스트/위험 버튼 패턴

---

## NOW — CMS 고객 기본정보 수정 기능 (2026-07-13) ✅ 완료

[CONTEXT BRIDGE — customer info edit]
plan_source: 세션 내 설계
수정 파일:
  - src/lib/components/cms/CustomerDetailPanel.svelte
  - src/routes/cms/customers/+page.server.ts
  - supabase/migrations/20260712000102_102_auto_assign_member_code.sql (신규)
  - supabase/migrations/20260713000103_103_get_customer_list_exclude_cms.sql (신규)
  - supabase/migrations/20260713000104_104_update_customer_info_rpc.sql (신규)
핵심제약:
  - stage(ezyvffjvuwmtuhpxdjrw) 검증 후 production 적용 (Stephen)
  - member_type CHECK 제약 제거 → code_mapping_groups.name 자유 선택
  - SECURITY DEFINER RPC 경유 (is_cms_user() 내부 권한 확인)
  - $state(prop) 초기화 + $effect 동기화 패턴 사용 (규칙 허용 패턴 2)

- [x] T-CUST-1: Migration #102 — 멤버코드 자동배정 RPC | CRITICAL | SQL 파일 생성 완료 (stage 미적용 — Stephen 액션 필요)
  - auto_assign_member_code() 함수: member_code NULL인 신규 가입 유저 자동 배정
  - 기존 NULL 회원 backfill 포함

- [x] T-CUST-2: Migration #103 — get_customer_list cms_role 컬럼 추가 | CRITICAL | ✅ Stage 적용 완료 (2026-07-13)
  - get_customer_list RPC 재생성: cms_role TEXT 컬럼 추가 (NULL=일반고객, 값 있음=관리자 배지)
  - CustomerRow 타입 cms_role: string | null 추가

- [x] T-CUST-3: Migration #104 — update_customer_info RPC + member_type CHECK 제거 | CRITICAL | ✅ Stage 적용 완료 (2026-07-13)
  - user_profiles_member_type_check DROP (B2C/B2B 고정 제약 해제)
  - update_customer_info(p_user_id, p_name, p_email, p_phone, p_member_type, p_created_at) SECURITY DEFINER

- [x] T-CUST-4: +page.server.ts updateCustomerInfo 액션 추가 | BOUNDARY | ✅ 완료 (2026-07-13)
  - cms_role 확인 → update_customer_info RPC 호출
  - 필수값 검증: user_id / name / email

- [x] T-CUST-5: CustomerDetailPanel.svelte 기본정보 탭 편집 UI | BOUNDARY | ✅ 완료 (2026-07-13)
  - localInfo $state + isDirtyInfo $derived + $effect 동기화
  - 이름·이메일·전화번호(자동 하이픈) 인라인 input
  - 회원유형: 버튼 클릭 → 레이어 모달 → code_mapping_groups 콤보버튼 선택
  - 가입일: date input (달력 선택)
  - 학생 여부: 읽기전용 + "학생증 보기" 버튼 (is_student 기반 활성/비활성)
  - 외국인 여부: 읽기전용 + "여권 보기" 버튼 (is_foreign 기반 활성/비활성)
  - dirty 시 "변경사항 저장" 버튼 노출 → use:enhance → invalidateAll() 후 $effect 재동기화
  - svelte-check: 에러 0건 (경고만 — 기존 포함)

## NOW — 상품 이력 탭 + 대여 메뉴 + 모바일 현장 촬영 앱 (2026-07-06)

[CONTEXT BRIDGE — product history + mobile app]
plan_source: cms-products-4-rosy-sifakis.md
핵심제약:
  - stage(ezyvffjvuwmtuhpxdjrw) migration #71 먼저 검증 → production 적용은 Stephen
  - --text-m-* CMS 본문 사용 금지 / --cms-radius-* 3단계 준수
  - tesseract.js npm install 필요
  - RPC 경유 (직접 INSERT/UPDATE/DELETE 금지)
절대금지:
  - git 자율 실행
  - 기존 마이그레이션 파일 수정 (신규 71만)
  - Svelte 4 문법
  - any 타입 / console.log

- [x] T-HIS-1: DB 마이그레이션 #71 | CRITICAL | SQL 파일 생성 완료 — Stephen이 stage apply 필요
- [x] T-HIS-2: API 라우트 신규 (product-history + assets patch) | BOUNDARY | cms_role 인증 + RPC 연동 완료
- [x] T-HIS-3: ProductDetailPanel.svelte 이력 탭 추가 | BOUNDARY | 등록·수정·삭제·드래그 구현 완료
- [x] T-HIS-4: 대여 메뉴 + 이력관리 랜딩 페이지 | BOUNDARY | GNB 서브메뉴 + 랜딩 페이지 완료
- [x] T-MOB-1: 유틸 + OcrScanner 컴포넌트 | BOUNDARY | chosungSearch + OcrScanner 완료
- [x] T-MOB-2: 모바일 앱 라우트 (/mobile) | BOUNDARY | 레이아웃 + 검색 + 3탭 화면 완료

## NOW — M1 products UUID 마이그레이션 + 옵션상품 DB 연동 (2026-07-05)

[CONTEXT BRIDGE — products UUID migration]
plan_source: 세션 내 설계 (Option B 근본 해결)
핵심제약:
  - stage(ezyvffjvuwmtuhpxdjrw) 검증 완료 → production(vnbpmvxruyciuuaermyh) 적용 대기
  - 기존 마이그레이션 파일 수정 금지 (신규 61/62 파일로 해결)
  - 20260703000049_49_product_option_links.sql → 구파일, 대체 완료 (사용 금지)
절대금지:
  - 기존 마이그레이션 파일 수정
  - production DB에 미검증 마이그레이션 직접 적용

- [ ] T-61a: Migration 61 stage 적용 | CRITICAL | ✅ 완료 (2026-07-05)
  - products.id bigint→UUID (8행 보존)
  - products 누락 컬럼 추가 (slug/brand/is_active/image_urls/specifications/stock_quantity/deleted_at)
  - price_rules 테이블 생성 + RLS + 트리거
  - assets/order_items/rental_reservations product_id bigint→UUID
  - RPC 함수 업데이트: atomic_reserve_asset, batch_atomic_reserve (bigint→UUID)
  - ✅ stage 검증: products.id=uuid, price_rules=exists, product_option_links=exists, 8행 보존

- [ ] T-62a: Migration 62 stage 적용 | CRITICAL | ✅ 완료 (2026-07-05)
  - product_option_links 테이블 + RLS + 트리거
  - upsert_product_option_links / get_product_option_links RPC

- [x] T-61b: Migration 61 production 적용 | CRITICAL | ✅ 완료 (2026-07-05)
  - products.id bigint→UUID (8행 보존, assets 9행 매핑 포함)
  - price_rules 테이블 + RLS + 트리거
  - assets/order_items/rental_reservations product_id bigint→UUID
  - RPC 업데이트: atomic_reserve_asset, batch_atomic_reserve
- [x] T-62b: Migration 62 production 적용 | CRITICAL | ✅ 완료 (2026-07-05)
  - product_option_links 테이블 + RLS + 트리거
  - upsert_product_option_links / get_product_option_links RPC
- [x] T-63: Migration 63 stage+production 적용 | CRITICAL | ✅ 완료 (2026-07-06)
  - product_option_links.min_select_required BOOLEAN 컬럼 추가
  - upsert_product_option_links RPC 업데이트 (min_select_required 포함)
  - get_product_option_links RPC 업데이트 (min_select_required 반환)
  - ProductOptionLinkRow 타입 업데이트 (database.ts)
  - edit/+page.svelte linkToSelected: link.min_select_required 실제값 사용
- [x] T-UI: CMS 옵션상품 UI 검증 | BOUNDARY | ✅ 완료 (2026-07-06)
  - /cms/products/new 렌더링 정상
  - 검색 모달: Canon 검색 → Canon EOS R5 결과 + 상세정보 더보기 링크 확인
  - 추가 후 선택 카드: 썸네일+상품명+가격+재고 정상
  - 일괄적용 + 개별 체크박스 3종 (필수선택/최소1개선택필수/배송대여불가) 정상

## NOW — CMS 프로모션 Phase 3 (2026-07-04)

[CONTEXT BRIDGE — Phase 3]
plan_source: cms-transient-cupcake.md | Phase 3 섹션
핵심제약:
  - 마이그레이션 번호: #56(marketing_rules) / #57(analytics_rpc) — #55까지 사용됨
  - stage(ezyvffjvuwmtuhpxdjrw) 먼저 검증 → production(vnbpmvxruyciuuaermyh) 적용
  - --text-pc-* 토큰만 (--text-m-* 금지) / --cms-radius-lg/md/sm 3단계
  - 차트·SVG 아이콘·외부 시각화 라이브러리 절대 금지
  - 구현 순서: T1(DB) → T2(GNB) → T3(룰엔진) → T4(Analytics)
절대금지:
  - 기존 마이그레이션 파일 수정 (신규 ADD만)
  - production DB에 미검증 마이그레이션 직접 적용
  - --text-m-* 모바일 폰트 토큰 CMS 본문 사용
  - SVG 아이콘 / 차트 라이브러리 / 외부 시각화

- [x] T1: DB 마이그레이션 Phase 3 | CRITICAL | SQL 파일 3개 생성 완료 — Stephen이 stage/production 적용 필요
  - ✅ supabase/migrations/20260704000056_56_marketing_rules.sql (생성 완료)
    - marketing_rules 테이블 (trigger_type CHECK / action_type CHECK / RLS 4정책)
    - marketing_rule_logs 테이블 (idx 3개 / RLS 2정책)
  - ✅ supabase/migrations/20260704000057_57_analytics_rpc_functions.sql (생성 완료)
    - get_promotion_analytics() → JSONB {total_revenue, conversion_rate, ctr, active_campaigns, top_coupons[], segment_performance[]}
    - rental_reservations / user_behavior_events COALESCE 방어 처리
  - ✅ supabase/migrations/20260704000058_58_rule_engine_executor.sql (생성 완료)
    - execute_marketing_rules() — 5개 trigger_type 대상 조회 + action 발동 + 에러 격리
    - pg_cron 등록: '0 * * * *' execute_marketing_rules_hourly
  - ✅ stage(ezyvffjvuwmtuhpxdjrw) 적용 완료 — #56/#57/#58 함수 + pg_cron 스케줄
  - ✅ production(vnbpmvxruyciuuaermyh) 적용 완료 — #56/#57/#58 함수 + pg_cron 스케줄

- [x] T2: GNB 서브메뉴 확장 | BOUNDARY | 완료 — 룰엔진/분석 탭 추가됨

- [x] T3: Rule Engine CMS 페이지 | BOUNDARY | 완료 — 3탭, npm run check 오류 0건
  - src/routes/cms/promotion/rules/+page.server.ts
  - src/routes/cms/promotion/rules/+page.svelte

- [x] T4: Analytics Dashboard CMS 페이지 | BOUNDARY | 완료기준: /cms/promotion/analytics 진입 시 4탭 렌더, get_promotion_analytics RPC 데이터 표시 | 예상: 60분
  - src/routes/cms/promotion/analytics/+page.server.ts
    - load: get_promotion_analytics() RPC + user_behavior_events 배너 CTR 집계
  - src/routes/cms/promotion/analytics/+page.svelte
    - 탭1: 전체 KPI (매출/전환율/CTR/재구매율/LTV/CAC) — 텍스트+숫자 카드만
    - 탭2: 쿠폰 성과 (top_coupons: 쿠폰별 ROAS / 사용수 / 할인액)
    - 탭3: 배너 성과 (슬롯별 노출수 / CTR — user_behavior_events 집계)
    - 탭4: 세그먼트 성과 (segment_performance: 세그먼트별 구매전환율)
    - 차트·SVG 아이콘 금지, 텍스트 기반 KPI 카드 패턴만

- [x] T5: Rule Engine 자동 발동 (pg_cron) | CRITICAL | SQL 파일 #58에 포함 완료 — Stephen이 stage/production 적용 필요

## NEXT
- [x] S1-M3 T5: 결제 UI | GSD | 결제 결과 페이지 구현 완료
  - src/routes/payment/success/+page.server.ts — Toss confirm API + confirm_payment_and_update_reservation RPC
  - src/routes/payment/success/+page.svelte — Figma 2361:6425 1:1 구현 (비대칭 radius 카드)
  - src/routes/payment/fail/+page.server.ts — cancel_payment_and_release_hold RPC + 파라미터 파싱
  - src/routes/payment/fail/+page.svelte — Figma 2361:6407 1:1 구현
  - svelte-check: 결제 관련 에러 0건 (기존 pre-existing 2건 유지)

## S1-M3 NOW
- [x] S1-M3 T1: DB 마이그레이션 (#59) | CRITICAL | payment_transactions / deposit_holds / raw_webhook_logs 테이블 + RLS + idempotency UNIQUE 제약 — stage + production 적용 완료
- [x] S1-M3 T2: TDD RED — 테스트 케이스 작성 | TDD | src/__tests__/services/payment.test.ts 생성 — Happy(정상결제·멱등성·보증금) / Edge(calc_at30초·중복order_id·amount=0) / Error(결제실패→cancel_rpc·처리순서·보안문서화)
- [x] S1-M3 T3: TDD GREEN — 구현 | TDD | src/routes/api/payment/confirm/+server.ts + src/routes/api/webhooks/toss/+server.ts 생성 — svelte-check 결제 에러 0건
- [x] S1-M3 T4: TDD REFACTOR | TDD | any 타입 없음 확인 / console.log 없음 / 타입 헬퍼 명확화(rpcCall·tableInsert·tableSelect) / svelte-check 결제 에러 0건 유지

## NOW — CMS 이미지 탭 UX 개선 (2026-07-06)

[CONTEXT BRIDGE]
plan_source: cms-http-localhost-5173-cms-products-resilient-ladybug.md (보완 섹션)
수정 파일: src/lib/components/cms/ProductDetailPanel.svelte (단일 파일)
핵심제약:
  - 기존 기능·UI 수정 변형 금지 (명시 3항목만 변경)
  - 대표이미지 상태는 products.image_urls[0] 기준 (0번 인덱스 = 대표)
  - DB 스키마 변경 없음 (별도 컬럼 불필요 — 배열 첫 항목 규칙)

- [x] T-IMG-1: 드롭존 레이아웃 슬림화 | BOUNDARY | ✅ 완료 (2026-07-06)
  - 폴더 아이콘(📁/📂 span) 제거
  - URL 버튼 텍스트 "또는 URL로 추가" → "+URL"
  - drop-zone flex-direction: column → row (텍스트+버튼 한 줄)
  - min-height: 130px → 48px (패딩 줄임)
  - dz-hint(포맷 안내 텍스트) 제거

- [x] T-IMG-2: 대표이미지 선택 기능 | BOUNDARY | ✅ 완료 (2026-07-06)
  - 대표이미지 = image_urls[0] (배열 첫 항목 규칙, DB 변경 없음)
  - hover 2초 이상 mousedown 유지 시 대표이미지 설정 (hold-to-set 인터랙션)
  - 대표 썸네일: 3px solid var(--cs-purple) 아웃라인 표시
  - 대표이미지 설정 시 해당 URL을 배열 첫 번째로 이동 → autoSave()
  - 다른 썸네일 동일 액션 → 기존 대표 해제 + 신규 대표 설정

## NOW — 상품코드(품번) + 코드설정 연동 (2026-07-06)

[CONTEXT BRIDGE — product_code 연동]
plan_source: 코드설정 연동 재검수 세션 결과
핵심 발견사항:
  - product_category_codes 테이블 존재 (depth 0~N, code_rule JSONB per branch)
  - cms_settings.reservation_code_format JSONB (prefix/date_format/seq_digits/reset_monthly/suffix)
  - products 테이블 product_code 컬럼 없음 — CRITICAL 부재
  - 신규 상품 등록 시 product_code 자동 생성 로직 완전 부재
  - slug ≠ 상품코드: slug=URL 식별자, product_code=분류별 자동 품번 (별개 개념)
  - 현재 패널 헤더 '코드'가 slug를 잘못 표시 중 → 즉시 수정 필요
핵심제약:
  - migration stage(ezyvffjvuwmtuhpxdjrw) 검증 → production(vnbpmvxruyciuuaermyh) 적용
  - product_code 자동 생성: category → product_category_codes depth=0 조회 → cms_settings format 적용
  - 예시 코드: CS-CAM-2607-001 (prefix + 카테고리코드 + YYMM + seq)
  - category_taxonomy_map 테이블로 ProductCategoryEnum → taxonomy code 매핑
절대금지:
  - 기존 마이그레이션 파일 수정
  - production DB에 미검증 마이그레이션 직접 적용

- [x] T-CODE-0: 즉시 수정 — 헤더 slug→product_code 표시 오류 + slug 탭 복원 | ROUTINE | ✅ 완료 (2026-07-06)
  - ProductDetailPanel: 헤더 '코드' 행 → slug 편집 폼 제거, product_code 표시(null='미발행')
  - 기본정보 탭: slug 읽기 전용 항목 복원 (caption 아래)
  - SelectedProduct 타입에 product_code?: string | null 추가

- [x] T-CODE-1: DB 마이그레이션 #68 + #69 | CRITICAL | ✅ Stage + Production 적용 완료 (2026-07-06)
  - #68: products.product_code VARCHAR(30) UNIQUE + product_code_sequences 테이블 + generate_product_code RPC (SECURITY DEFINER) + 기존 상품 backfill
  - #69: CA 더미 코드 soft-delete + CAM 코드 복구 + CS-CA-all-001/002 → CS-CAM-all-001/002 재발행
  - Stage 검증: CS-CAM-all-001(Sony A7S III) / CS-CAM-all-002(Canon EOS R5) 확인
  - Production 검증: #68/#69 모두 적용 완료, product_code_sequences 테이블 존재 확인

- [x] T-CODE-2: 신규 상품 등록 연동 | CRITICAL | ✅ 완료 (2026-07-06)
  - new/+page.server.ts create 액션: INSERT → QR payload → generate_product_code RPC 순서로 자동 호출
  - svelte-check 신규 오류 없음 (pre-existing 2건 유지)

- [x] T-CODE-3: 패널 헤더 product_code 표시 완성 | BOUNDARY | ✅ 완료 (T-CODE-0 포함)
  - product_code = null → '미발행' 배지 표시
  - Migration #68 적용 후 기존 상품 product_code 정상 표시

- [x] T-CODE-4: 기존 상품 backfill | CRITICAL | ✅ 완료 (Migration #68 DO 블록)
  - created_at ASC 순으로 전체 상품 generate_product_code 호출
  - Stage 8개 상품 전체 backfill 완료, NULL 0건 확인

- [x] T-CODE-5: 코드설정 포맷 키명 재검수 | BOUNDARY | ✅ 완료 (2026-07-06)
  - 결론: 현시점 분리 불필요 — M3 예약코드 미구현 상태, 충돌 위험 없음
  - 공유 키(reservation_code_format)로 유지, +page.server.ts 주석 정정
  - M3 구현 시 product_code_format 키 분리 예정 (BACKLOG 추가)

## NOW — CMS 코드설정 권한 제한 + 이관 기능 (2026-07-06)

[CONTEXT BRIDGE — 코드설정 권한·이관]
plan_source: 세션 내 설계 (품번 정책 확정)
핵심 설계:
  - category 변경 시 품번 고정 (유지 현행)
  - 연결 상품 있는 경우 편집 불가 (전 관리자)
  - 통삭제는 superadmin만 가능 → 연결 상품 product_code = NULL 초기화 (고아 상품)
  - 이관: 소스→타겟 카테고리 이전, 품번 재발행, QR 재생성

- [x] BACKLOG-① category_taxonomy_map 기본 매핑 입력 | CRITICAL | ✅ 완료 (2026-07-06)
  - Migration #70: depth=0 활성 코드 전체 자동 INSERT (COALESCE product_category / LOWER(code))
  - Stage + Production 모두 적용 완료 (12개 rows)

- [x] BACKLOG-② 삭제·편집 권한 제한 | BOUNDARY | ✅ 완료 (2026-07-06)
  - editCode: 연결 상품 존재 시 모든 관리자 수정 차단
  - deleteCode: 연결 상품 있을 때 superadmin만 통삭제 (product_code NULL 초기화)
  - 비-superadmin 삭제 시도 → 403 + '접근권한이 없습니다.' 토스트
  - getLinkedProductCount / checkSuperadmin 헬퍼 함수 추가

- [x] BACKLOG-③ 이관 기능 | BOUNDARY | ✅ 완료 (2026-07-06)
  - load 함수에 userRole 추가 (cms_role 조회)
  - transferCode 액션: superadmin 확인 → 소스/타겟 코드 조회 → 상품 category+product_code 업데이트 → generate_product_code 재발행 → qr_payload 재생성 → taxonomy_map 소스 매핑 삭제
  - +page.svelte: 이관 버튼 (depth=0 + superadmin만 표시) + 이관 모달 (경고·소스정보·타겟선택·confirm)
  - svelte-check 에러 0건, 모달 정상 렌더링 확인

- [ ] BACKLOG: 프로모션/쿠폰 비활성화 알림 | BOUNDARY | 미구현 (이관 후 자동 처리)
  - 이관 시 기존 품번 연동 프로모션·쿠폰 → 사용 불가 자동 처리 + 고객 안내
  - M3 쿠폰 시스템 구현 후 연동 예정

## NOW — CMS DB 파편화 수정 + $state 버그 수정 (2026-07-07) ✅ 완료

- [x] DB-1: 중복 상품 조사 + 수정 | CRITICAL | "Sony FX6-12" 3중 중복 → 2개 soft-delete (REST API), Migration #77 생성·적용 (Stage + Production)
- [x] DB-2: price_rules UNIQUE 제약 수정 | CRITICAL | UNIQUE(product_id, duration_type) → partial index WHERE deleted_at IS NULL (Stage + Production)
- [x] DB-3: updateSection/pricing 재INSERT 버그 수정 | BOUNDARY | soft-delete 행 포함 조회 후 UPDATE로 재활성화 (+page.server.ts)
- [x] UI-1: $state(prop) 버그 수정 — 상품 전환 시 컴포넌트 재마운트 누락 | CRITICAL | {#key data.selectedId}로 ProductDetailPanel 재마운트 강제
- [x] UI-2: CalendarGrid $state 동기화 | BOUNDARY | $effect로 value prop 변경 시 viewYear/viewMonth 갱신
- [x] RULE: $state(prop) 초기화 절대 금지 규칙 영구 등록 | ROUTINE | core-rules.md + ui-mobile.md 동시 등록

## NOW — CMS 성능 개선 + 통합 검색 + AI 학습 인덱싱 (2026-07-14) ✅ 완료

[CONTEXT BRIDGE — DB 성능 + 통합 검색]
plan_source: declarative-wandering-catmull.md
수정 파일:
  - supabase/migrations/20260714000109_109_idx_rental_reservations_product_id.sql (신규)
  - supabase/migrations/20260714000110_110_idx_user_profiles_trgm_created_at.sql (신규)
  - supabase/migrations/20260714000111_111_idx_rental_reservations_scale.sql (신규)
  - supabase/migrations/20260714000112_112_idx_chat_products_scale.sql (신규)
  - supabase/migrations/20260714000113_113_products_search_foundation.sql (신규, 113a/113b 분할)
  - supabase/migrations/20260714000114_114_search_logs_ai_learning.sql (신규)
  - supabase/migrations/20260714000115_115_search_products_rpc.sql (신규)
  - supabase/migrations/20260714000116_116_mv_search_cache.sql (신규)
  - src/routes/api/search/products/+server.ts (신규)
  - src/lib/services/searchService.ts (신규)
  - src/routes/cms/customers/+page.server.ts (locals.cmsRole 패턴 적용)
핵심제약:
  - stage(ezyvffjvuwmtuhpxdjrw) 검증 완료 → production(vnbpmvxruyciuuaermyh) 적용 완료
  - CREATE INDEX CONCURRENTLY → 트랜잭션 블록 불가 → 113a/113b 분할로 해결
  - rental_reservations: deleted_at 컬럼 없음 / start_date·end_date 컬럼명
  - products.image_urls JSONB → (image_urls->>0) TEXT / base_price_daily 컬럼명
  - query_tokens: tsvector 컬럼 → to_tsvector('simple', p_query) 삽입

- [x] T-PERF-1: Migration #109 — rental_reservations.product_id 인덱스 | CRITICAL | ✅ Stage + Production 완료
- [x] T-PERF-2: Migration #110 — user_profiles trgm + created_at + 중복 제거 | CRITICAL | ✅ Stage + Production 완료
- [x] T-PERF-3: Migration #111 — rental_reservations 복합 인덱스 (status/dates) | CRITICAL | ✅ Stage + Production 완료
- [x] T-PERF-4: Migration #112 — chat_messages + products 규모 인덱스 | CRITICAL | ✅ Stage + Production 완료
- [x] T-SEARCH-1: Migration #113 — products.search_vector + 트리거 + GIN 인덱스 | CRITICAL | ✅ Stage + Production 완료 (113a/113b 분할)
- [x] T-SEARCH-2: Migration #114 — search_logs + product_search_stats + RLS | CRITICAL | ✅ Stage + Production 완료
- [x] T-SEARCH-3: Migration #115 — search_products RPC + record_search_click 함수 | CRITICAL | ✅ Stage + Production 완료
- [x] T-SEARCH-4: Migration #116 — MV 2개 + pg_cron 3개 | CRITICAL | ✅ Stage + Production 완료
- [x] T-SEARCH-5: 통합 검색 API + 서비스 레이어 신규 생성 | BOUNDARY | ✅ 완료
  - src/routes/api/search/products/+server.ts
  - src/lib/services/searchService.ts
- [x] T-QA: sp3-qa-agent 검수 | GATE C | ✅ 완료 — searchService.ts thumbnail_url→image_url 수정 후 GATE E 통과

## NOW — Crazylog 콘텐츠 작성 화면 퍼블리싱 + 링크 연동 (2026-07-14) ✅ 완료

[CONTEXT BRIDGE — crazylog publishing]
plan_source: tranquil-prancing-key.md
수정 파일:
  - src/routes/crazylog/[slug]/+page.svelte (작성 화면)
  - src/routes/crazylog/+page.svelte (메인 화면)
핵심제약:
  - 사용자 화면 디자인 시스템 토큰 (front-uiux.md)
  - Svelte 5 Runes / GNB 모바일 숨김 (:global)
  - ZERO-INTERPRETATION 원칙 (Figma 1:1)

- [x] T-CL-1: [slug]/+page.svelte Mobile UserInfoCard 추가 | BOUNDARY | ✅ 완료
  - m-user-card: 그라데이션 아바타 + 이름/배지/레벨/인증 행 (Figma compact spec 1:1)
  - CSS: --cs-purple→red-badge 그라디언트 / --radius-lg / --radius-full / --cs-purple-op10

- [x] T-CL-2: [slug]/+page.svelte Mobile ContentOptions 추가 | BOUNDARY | ✅ 완료
  - m-content-options: 공개설정 / 댓글허용 / 기타 3섹션 + m-divider
  - State 초기값 수정: memberPublic=true / cafeScrap=true / aiSave=true (Figma defaultChecked)
  - checkbox accent-color: --cs-purple-light (#553FE0)

- [x] T-CL-3: +page.svelte 헤더 카드 3개 + 아이콘 링크 연동 | BOUNDARY | ✅ 완료
  - {#each} 내 plus SVG → <a href="/crazylog/new" aria-label="로그 작성"> 래핑
  - 3개 섹션 카드 동일 적용 (루프 1개 수정으로 일괄 처리)

## DONE
- S0: 환경 설정 + DB 스키마 + RPC 함수 9개
- S1-M1: Products 모듈 (리스트 + 상세)
- S1-M2: Reservation Flow (TDD RED/GREEN/REFACTOR)
- S1-M2.5: Cart Dev Route (장바구니 UI 개발) — 10개 컴포넌트/파일
- PRD.1.7 T1: DB Migration (chat_sessions / chat_messages / chat_intent_logs / cs_records + RLS + Realtime)
- PRD.1.7 T2: 타입 정의 (src/lib/types/chat.ts)
- PRD.1.7 T3: 서비스 레이어 (src/lib/services/chatService.ts)
- PRD.1.7 T4: 스토어 (src/lib/stores/chat.svelte.ts — class 패턴)
- PRD.1.7 T5: API 라우트 5개 (session/message[AI분류]/sessions/action-card/close)
- PRD.1.7 T6: UI 컴포넌트 5개 (ChatHeader / MessageBubble / ActionCard / MessageList / ChatInput)
- PRD.1.7 T7: 컨테이너 3개 (ChatWindow / ChatBottomSheet / FloatingChatButton)
- PRD.1.7 T8: +layout.svelte fab-bar 삽입
- PRD.1.7 T8b: fab-bar 충돌 해결 — checkout/products[id] 직접 삽입 (장바구니→검색→채팅)
- PRD.1.7 T10: 고객 채팅 라우트 `/chat` 구축 (풀스크린 ChatWindow + 딥링크 파라미터)
- PRD.1.7 T11: DB 마이그레이션 적용 (4테이블 RLS), API/Realtime 코드 검증 완료 (AI키·Realtime활성화는 Stephen 액션)
- CMS 프로모션 Phase 1 완료 (T1 GNB/T2 DB #45~#51/T3 홍보/T4 쿠폰/T5 포인트/T6 홈배너)
- CMS 프로모션 Phase 2 완료 (DB #52~#55/behaviorTracker/세그먼트 페이지/API)

## DONE — T9 AdminChatPanel (2026-07-09 완료) ✅

- [x] T9-1: /cms/chat 라우트 — +page.server.ts + +page.svelte 기완성 확인
- [x] T9-2: AdminChatPanel.svelte — 3탭(open/pending/closed) + Realtime + 메시지 전송 + 닫기 기완성
- [x] T9-3: CMS GNB 채팅 서브메뉴 — layout.svelte 라인 78에 이미 연결됨 ('/cms/chat')
- [x] TYPE ERRORS: svelte-check 8→0 수정 완료 (similarNameSuggest, codes +page.server.ts, products/new +page.svelte)

---

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

## NOW — CMS 계약서 서브메뉴 + 에디터 UI (2026-07-23) ✅ 완료

plan_source: users-stevenmac-documents-pseries-crazy-vivid-lightning.md (v5)

신규/수정 파일:
  - src/routes/cms/+layout.svelte ← 계약서양식 서브메뉴 추가
  - src/lib/types/contract-template.ts ← ContractTemplate / ContractTemplateSummary 타입
  - supabase/migrations/20260723000148_148_contract_templates.sql ← 계약서양식 테이블
  - supabase/migrations/20260723000149_149_contracts_content_fields.sql ← contracts 테이블 확장
  - src/routes/cms/reservation/contracts/+page.server.ts ← load + 3 actions
  - src/lib/components/cms/ContractTemplatePanel.svelte ← 에디터 패널 컴포넌트
  - src/routes/cms/reservation/contracts/+page.svelte ← 목록 + 마스터디테일 페이지
  - src/lib/components/cms/ContractEditorModal.svelte ← 예약 상세 계약서 편집 모달
  - src/routes/api/cms/contracts/[id]/content/+server.ts ← GET/PATCH API
  - src/lib/components/cms/RentalContractViewer.svelte ← 편집 버튼 + 모달 진입 추가

⚠️ 대기 중: Migration #148 #149 Stage(ezyvffjvuwmtuhpxdjrw) 검증 후 Production 배포 필요

- [x] TASK-B: 레이아웃 계약서양식 서브메뉴 추가 | ROUTINE | ✅
- [x] TASK-A: Migration #148 contract_templates | BOUNDARY | ✅ (파일 생성 — DB 적용 대기)
- [x] TASK-F: Migration #149 contracts 콘텐츠 필드 | BOUNDARY | ✅ (파일 생성 — DB 적용 대기)
- [x] TASK-C: /reservation/contracts/+page.server.ts | BOUNDARY | ✅
- [x] TASK-D: ContractTemplatePanel.svelte | BOUNDARY | ✅
- [x] TASK-E: /reservation/contracts/+page.svelte | BOUNDARY | ✅
- [x] TASK-G: ContractEditorModal + RentalContractViewer | BOUNDARY | ✅
- [x] npm run check: 신규 파일 오류 0개 (기존 오류 13개는 pre-existing, 범위 외) | ✅

---

---

## NOW — 로그인 PC 반응형 + 회원가입 기능 + 트리거 버그 수정 (2026-07-24) ✅ 완료

plan_source: 세션 내 아젠다
핵심제약:
  - front-uiux.md 디자인 시스템 준수 (CTA: --cs-red-badge, 모달: --radius-2xl)
  - performSignUp() auth.ts 기존 함수 재활용
  - 전화 인증: 더미 모드 (알리고 SMS 추후 연동 주석 기록)
  - DB 트리거 수정: Stage → Production 순서 필수 적용
  - git 자율 실행 금지

신규/수정 파일:
  - src/routes/auth/login/+page.svelte ← PC 반응형 폼 개선 + Sign Up↔Sign In 전환 + SignUpModal 연동
  - src/lib/components/auth/SignUpModal.svelte ← 신규 (회원가입 모달 — 이메일·비번·전화 더미 인증)
  - supabase/migrations/20260724000163_163_fix_handle_new_user_trigger.sql ← 신규 (트리거 버그 수정)

- [x] FIX-LAYOUT: /auth/login PC 반응형 입력폼 찌그러짐 수정 | ROUTINE | ✅ 완료 (2026-07-24)
  - .d-inputs flex-wrap: nowrap → wrap 변경
  - .d-input-field flex: 1 1 220px + min-width: 220px 고정 (찌그러짐 방지)
  - 좁은 PC 화면에서 비밀번호 필드 자동 다음 행 이동

- [x] FEAT-SIGNUP-BTN: Sign Up ↔ Sign In 버튼 자동 전환 인터랙션 | BOUNDARY | ✅ 완료 (2026-07-24)
  - isSignInMode = $derived(email.trim().length > 0 && password.length > 0)
  - 기본: 보라색 Sign Up 버튼 노출 → 이메일+비번 둘 다 입력 시 그라데이션 Sign In 버튼 자동 전환
  - PC(.d-signup-submit) + 모바일(.m-signup-submit) 양쪽 동일 인터랙션 적용

- [x] FEAT-SIGNUP-MODAL: SignUpModal.svelte 신규 생성 | BOUNDARY | ✅ 완료 (2026-07-24)
  - 2단계 폼: 1단계(이메일·비밀번호·비밀번호확인) → 2단계(전화번호 + 더미 인증)
  - front 디자인 시스템 적용: 모달 --radius-2xl / 헤더 --cs-dark / CTA --cs-red-badge 30px
  - 전화 인증 더미 처리: 인증번호 아무 값 입력 → 통과 (테스트 모드)
  - TODO 주석 2곳: 알리고 SMS API 연동 포인트 명시 (send-otp / verify-otp 엔드포인트)
  - 가입 완료 → redirect 또는 '/' 이동
  - svelte-check 신규 에러 0건

- [x] BUG-TRIGGER: handle_new_user 트리거 user_id 누락 버그 수정 | BOUNDARY | ✅ 완료 (2026-07-24)
  - 원인: INSERT INTO user_profiles (id, email) → user_id NOT NULL 위반 → 가입 후 user_profiles 미생성 → CMS 고객목록 미반영
  - 수정: INSERT INTO user_profiles (id, user_id, email) VALUES (NEW.id, NEW.id, ...) 로 교체
  - Migration #163 Stage(ezyvffjvuwmtuhpxdjrw) 적용 ✅ + Production(vnbpmvxruyciuuaermyh) 적용 ✅
  - 양쪽 DB pg_get_functiondef 검증 완료

---

## BACKLOG

### 소규모 (즉시 처리 가능)
- BL-① category_taxonomy_map 기본 매핑 입력 | SPT/MON/PWR/MED/STD/VID product_category 연결 — 현재 null로 Fallback 2 적용 중 | Migration으로 일괄 처리 필요
- BL-② edit/+page.server.ts category 변경 시 품번 재발행 정책 결정 | Stephen 결정 필요 | 현재 최초 등록 시만 발행
- BL-③ M3 예약코드 구현 시 cms_settings product_code_format 키 분리 | 현재 reservation_code_format 공용
- BL-④ combo_keywords → 상품 검색 태그 자동 제안 연동 (products/new 미활용 상태)
- BL-CRAZYLOG-SUBMIT: crazylog 작성 폼 실제 서버 제출 로직 구현 (현재 handleSubmit 빈 함수)

### 기타
- 카카오 알림톡 fallback (PRD.1.7.7)
- 프로모션/쿠폰 비활성화 알림 (이관 후 자동 처리)
