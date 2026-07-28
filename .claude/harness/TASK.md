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

## NOW — CMS 자식 상품 수정 제한 전면 적용 (2026-07-27) ✅ 완료

plan_source: cms-ticklish-storm.md
핵심제약:
  - history 탭만 수정 허용 / 나머지 탭 읽기 전용 + 토스트 경고
  - 사용자 화면(/products/) 영향 없음 (부모 기준 조회 — 자식 수정과 무관)
  - 요청 범위 외 수정 없음

수정 파일:
  - src/lib/components/cms/ProductDetailPanel.svelte ← isChildProduct + 저장 차단 + 배너 + CSS
  - src/routes/cms/products/+page.server.ts ← updateSection 자식 차단 통합 블록
  - src/routes/cms/products/+page.svelte ← 부모 상품 목록 UI 구조 개선 (대표 상품정보 등록관리 / 실 상품코드 반영 목록 섹션 분리)

- [x] TASK-CMS-PARENT-RESTRUCTURE: 부모(대표) 상품 목록 UI 구조 개선 | BOUNDARY | ✅ 완료 (2026-07-27)
  - 상세 뷰어 패널을 "대표 상품정보 등록관리"(부모, rep-section) / "실 상품코드 반영 목록"(자식, inv-accordion) 2개 섹션으로 완전 분리
  - panelOpen 판정 기준: data.selectedId+selectedProduct 존재 → data.rootProduct 존재로 교체 (자식 선택 시에도 부모 rep-section이 항상 함께 표시되도록)
  - +page.server.ts: rootProduct 신규 로드 로직 — 자식 선택 시 parent_product_id로 부모 정보(이름·브랜드·카테고리·이미지·가격·품번·재고 카운트) 별도 조회, 부모 선택 시 selectedProduct를 그대로 rootProduct로 사용
  - rep-section: 미니 카드(썸네일·카테고리·재고배지·이름·브랜드·가격) + 펼침/접힘(repBodyOpen) + 부모 ProductDetailPanel 인라인 렌더
  - inv-accordion(실 상품코드 반영 목록): 기존 아코디언 로직 그대로 유지, 섹션 타이틀만 신규 추가
  - svelte-check: 신규 에러 0건

- [x] TASK-CMS-CHILD-LOCK: 자식 상품 수정 제한 전면 적용 | BOUNDARY | ✅ 완료 (2026-07-27)
  - isChildProduct = $derived(!!product.parent_product_id) 파생값 추가
  - handleSectionSave / handleFilesUpload / removeImageAndSave / saveContent / saveOptions: 자식 차단
  - basic·slug·pricing·content·components·specs 저장 버튼 disabled 조건 추가
  - 8개 탭(history 제외) child-readonly-notice 배너 삽입 / 기존 child-image-notice 통일
  - CSS: .child-readonly-notice (lilac bg + purple 왼쪽 보더)
  - +page.server.ts: childBlockedSections 통합 블록으로 서버 사이드 차단

추가 수정 (동일 세션 연속 요청, 2026-07-27):
  - src/lib/components/cms/ProductDetailPanel.svelte ← 저장버튼 완전 숨김 전환 + 입력 포커스 가드 + 삭제 버튼 토스트 패턴 교체 + 이력 탭 업로드 버그 수정
  - src/routes/cms/products/+page.server.ts ← deleteProduct 액션에 부모 자동 비노출 로직 추가

- [x] TASK-CMS-CHILD-HIDE: 자식 상품 저장 버튼 disabled → 완전 숨김 전환 | ROUTINE | ✅ 완료 (2026-07-27)
  - basic(기본정보+슬러그)·options·pricing·rental·content·components·specs 7개 탭 8개 저장 버튼
  - disabled={isChildProduct || ...} → {#if !isChildProduct}...{/if} 래핑으로 버튼 자체 제거

- [x] TASK-CMS-CHILD-FOCUS-GUARD: 자식 상품 입력 필드 포커스 시 즉시 차단 | ROUTINE | ✅ 완료 (2026-07-27)
  - blockChildInputFocus(e) 함수 추가 — INPUT/TEXTAREA/SELECT/contentEditable 포커스 시 blur() + csToast.warning('대표 상품정보에서 수정하세요.')
  - 위 7개 탭 section에 onfocusin={blockChildInputFocus} 적용

- [x] TASK-DELETE-TOAST: 상품정보 삭제 버튼 모달 → 토스트 2단계 확인 패턴 교체 | BOUNDARY | ✅ 완료 (2026-07-27)
  - 기존 showDeleteConfirm 모달 방식 제거
  - CmsDeleteButton.svelte와 동일한 "1차 클릭 → csToast.warning('한번 더 누르면 삭제됩니다') + cancel() → 2차 클릭 → 실제 제출" 패턴 적용
  - deletePending $state 추가, handleDeleteProduct() enhance 콜백 재작성
  - 부모·자식 패널 공용 컴포넌트라 양쪽에 자동 적용됨

- [x] TASK-CHILD-DELETE-PARENT-OFF: 자식 삭제 시 부모 재고 0개면 부모 자동 비노출 | BOUNDARY | ✅ 완료 (2026-07-27)
  - +page.server.ts deleteProduct 액션: 삭제 대상의 parent_product_id 조회 → soft-delete 후 해당 부모의 남은 재고(deleted_at IS NULL) count 조회 → 0이면 부모 is_active=false 자동 전환
  - 자식 삭제는 여전히 자기 자신의 행만 soft-delete (부모 정보 자체는 미변경) — 코드 검토로 확인

- [x] BUG-HISTORY-UPLOAD: 자식 상품 이력 탭 이미지 추가 기능 미작동 버그 수정 | CRITICAL FIX | ✅ 완료 (2026-07-27)
  - 증상: 자식 패널의 유일한 편집 가능 탭인 '이력'에서 이미지 추가 클릭 시 업로더가 실행되지 않음
  - 원인: handleHistoryFileSelect()에서 input.value = '' 초기화를 Array.from(files) 변환보다 먼저 실행
    → FileList는 input의 live 참조라 value 초기화 시 즉시 파일 목록도 함께 비워짐 → 항상 빈 배열로 처리되어 업로드 자체가 실행되지 않음
  - 수정: Array.from(files)로 먼저 복사한 뒤 input.value 초기화 (이미지 탭 handleFileSelect와 동일 순서로 통일)
  - 부수 수정: {#each historyRecords as rec} 언키드 → (rec.id) 키 추가 (add/delete 후 목록 재정렬 시 수정폼·업로드 인풋 바인딩 오귀속 방지)
  - 검증: 실제 브라우저(Chrome DevTools MCP) 네이티브 파일 업로드로 재현 확인 후 수정 → 업로드→저장→목록반영→삭제 전체 라이프사이클 재검증 완료, Stephen 실측 확인 ✅

- [x] TASK-CMS-CHILD-HIDE-QUICKADD: '빠른 재고 등록' 버튼 자식 상품에서 제외 | ROUTINE | ✅ 완료 (2026-07-27)
  - 정합 원칙: 빠른 재고 등록 기능·버튼 UI는 부모(대표) ProductDetailPanel에만 존재·작동해야 함
  - summary-bar 내 status-cta-btn을 {#if !isChildProduct}로 래핑 — 자식 패널에서 버튼 완전 숨김
  - openCloneModal 호출부가 이 버튼 하나뿐임을 grep으로 확인 — 자식 진입 경로 없음

- [x] TASK-CMS-CLOSE-BTN-MOVE: 자식 패널 '닫기' 버튼 위치를 토글 우측 끝으로 이동 | ROUTINE | ✅ 완료 (2026-07-27)
  - ProductDetailPanel.svelte: ph-code-row 내 close-btn(✕) 제거 (품번 표시는 유지), 이제 사용되지 않는 .close-btn CSS도 함께 정리
  - +page.svelte: inv-acc-header의 노출 토글(form) 바로 뒤에 신규 .inv-acc-close-btn 추가 (해당 아코디언 행이 펼쳐진 상태(isActive)일 때만 노출), 기존과 동일한 closePanel() 호출
  - 기능 변경 없음 — 위치만 ProductDetailPanel 내부 → 상위 아코디언 헤더로 이동
  - 실브라우저 클릭 검증: URL에서 ?selected= 파라미터 제거되며 패널 정상 닫힘 확인

- [x] BUG-PH-PADDING: 자식 패널 헤더(품번·썸네일·QR) 좌우상하 패딩 누락 수정 | ROUTINE | ✅ 완료 (2026-07-27)
  - 원인: 과거 리팩터링에서 ph-code-row/ph-body를 감싸던 .panel-header 래퍼(padding: 16px 20px 14px + border-bottom)가
    마크업에서 제거됐으나 CSS 규칙만 고아 상태로 남아있었음 — 두 행이 패딩 없이 카드 가장자리에 붙어 렌더링됨
  - 수정: .panel-header 삭제, 패딩을 .ph-code-row(16px 20px 0)·.ph-body(10px 20px 14px + border-bottom)에 직접 분리 이관
  - 실브라우저 확인: 썸네일·제목·QR 영역이 카드 안쪽으로 정상 인셋됨

- [x] TASK-CMS-CHILD-DATA-MIRROR: 자식 패널 전 탭 데이터를 부모 기준으로 통일 (이력 제외) | CRITICAL FIX | ✅ 완료 (2026-07-27)
  - 증상: 옵션상품 탭에서 부모가 수정한 옵션 정보가 자식 패널에 반영되지 않음 (Stephen 발견) — 편집은 이미 부모에서만
    가능하도록 잠겨있는데, 조회는 여전히 자식 자신의 행/관계를 보고 있어 부모 수정분이 자식에 반영 안 됨
  - +page.server.ts 수정: 자식 선택 시 parent_product_id로 부모 행을 조회해 아래 항목을 전부 부모 기준으로 override
    · 옵션상품(get_product_option_links → policySourceId=부모ID)
    · 가격정책(price_rules → 부모ID, 판매금액/판매전용 포함)
    · 대여정책(allowed_period_ids/method_ids/pickup_ids, 배송정책 3종)
    · 상품설명(content_blocks/keywords) · 구성품(components) · 사양(specifications)
    · 이미지(image_urls) — 기존 별도 부모조회 로직을 이번 쿼리에 통합
  - 자산(assets)·이력은 selectedId(자식 자신) 기준 그대로 유지
  - 실브라우저 검증(SONY PXW-Z90/CSCMRall007): 부모 옵션 2건(Sony FX6-12·Manfrotto 055)·가격(25,000/30,000)·
    사양 11건·대여정책·상품설명 에디터 전부 자식 패널에 동일 반영 확인

- [x] TASK-CMS-CHILD-BASICINFO-MIRROR: 기본정보 탭(이름·브랜드·카테고리·카피·슬러그)도 부모 기준 통일 | BOUNDARY | ✅ 완료 (2026-07-27)
  - Stephen 후속 요청: "이력 탭 제외 전부 부모 정보 반영" — 위 CHILD-DATA-MIRROR에 이어 기본정보 탭 식별 필드까지 확장
  - parentRow select에 name·brand·category·product_caption·slug 추가, selectedProduct 구성 시 src(부모 데이터) 기준으로 override
  - ⛔ is_active(노출 상태)는 예외 — AskUserQuestion으로 Stephen 확인: 자식 고유값 유지 확정
    (이유: 아코디언 토글 스위치가 실제로 조작하는 자식 자신의 재고가용 상태라 부모 값으로 덮으면 배지↔토글 상태 불일치 발생)
  - 품번(product_code)·QR(qr_payload)·자산·이력도 기존과 동일하게 자식 고유값 유지
  - 실브라우저 검증: 자식 CSCMRall007의 기본정보 탭이 부모(SONY PXW-Z90/SONY/lens/cam-zo-2607) 값으로 표시,
    노출상태만 자식 자신의 값(true) 유지 확인

svelte-check: 신규 ERROR 0건 (기존 11 errors 그대로 — account/profile RPC 타입 무관 이슈)

⚠️ TASK-CMS-PARENT-RESTRUCTURE 관련 하네스 기록 누락 원인 분석: 이 항목(부모 상품
목록 UI 구조 개선)은 커밋 준비 단계에서 Stephen이 TASK.md에 대응 기록이 없음을
지적해 발견됨 — 세션 시작 시 하네스 문서 점검(TASK.md/HANDOFF.md) 절차를 생략하고
바로 코드 diff만 확인한 것이 1차 원인. 상세 원인 분석·재발 방지 원칙:
`.claude/harness/learnings/task_md_documentation_gap_cms_products_2026-07-27.md` 참조

⏳ QA: sp3-qa-agent 검수 예정

---

## NOW — /checkout CTA → TossPayments PG 연동 + 결제완료 화면 PC 반응형 (2026-07-27) ✅ 완료

plan_source: 세션 내 아젠다
핵심제약:
  - TossPayments v2 CDN SDK (클라이언트 동적 로드)
  - PUBLIC_TOSS_CLIENT_KEY: $env/static/public (클라이언트 공개 허용)
  - SUPABASE_SERVICE_ROLE_KEY: $env/dynamic/private (서버 전용)
  - isDevMode=true 구간: API·Toss 건너뜀 → /payment/success/dev 우회 경로
  - reservationId 타입: UUID string (기존 Number 변환 버그 수정)
  - Svelte 5 Runes / Svelte 4 문법 금지

신규/수정 파일:
  - src/routes/api/checkout/initiate/+server.ts ← 신규 (HOLD 예약 생성 + 금액 계산 + Toss 파라미터 반환)
  - src/routes/checkout/+page.svelte ← 수정 (CTA onclick devMode 분기 + Toss SDK 연동 handlePay)
  - src/routes/payment/success/+page.server.ts ← 수정 (reservationId string 타입 + Toss confirm API + RPC)
  - src/routes/payment/success/+page.svelte ← 수정 (PC 반응형 CSS ≥768px 추가)
  - src/routes/payment/success/dev/+page.ts ← 신규 (URL 파라미터 → PageData 반환)
  - src/routes/payment/success/dev/+page.svelte ← 신규 (DEV 배너 + 동일 UI + PC 반응형)
  - .env.local ← PUBLIC_TOSS_CLIENT_KEY 추가 (test_ck_live_xxxxx)

- [x] FEAT-INITIATE: POST /api/checkout/initiate 신규 엔드포인트 | CRITICAL | ✅ 완료 (2026-07-27)
  - atomic_reserve_asset RPC → HOLD 예약 생성 (UUID reservationId 반환)
  - calculate_cart_total RPC → 최종 결제금액 산출
  - orderId: CZ-{timestamp}-{uuid8} / idemKey: uuid 멱등키 생성
  - 세션 미존재 401 / 파라미터 누락 400 / 재고 없음 409 처리

- [x] FEAT-TOSS-SDK: checkout CTA → TossPayments SDK requestPayment 연동 | CRITICAL | ✅ 완료 (2026-07-27)
  - type TossWindow 패턴 (declare global 불가 → 타입 별칭 캐스팅)
  - loadTossScript() CDN 동적 로드 (중복 방지)
  - successUrl: /payment/success?reservationId=...&idemKey=...
  - failUrl: /payment/fail?reservationId=...
  - PAYMENT_CANCEL 코드 사용자 취소 → 에러 미표시

- [x] FIX-RESERVATION-ID: reservationId Number 변환 → UUID string 유지 | BOUNDARY | ✅ 완료 (2026-07-27)
  - 기존: Number(url.searchParams.get('reservationId') ?? '0') → UUID 파싱 시 NaN
  - 수정: url.searchParams.get('reservationId') ?? '' (string 그대로 유지)

- [x] FEAT-DEV-BYPASS: isDevMode=true 시 API·Toss 없이 /payment/success/dev 우회 | BOUNDARY | ✅ 완료 (2026-07-27)
  - checkout CTA onclick devMode 분기 추가 (canProceed 검증 후 즉시 분기)
  - URLSearchParams: productName / orderNumber / startDate / endDate / amount / paymentMethod / notes
  - /payment/success/dev/+page.ts: URL 파라미터 → PageData (isDev: true)
  - /payment/success/dev/+page.svelte: 오렌지 배너 "🛠 DEV 테스트 모드" + 동일 완료 화면 UI

- [x] UI-SUCCESS-PC: /payment/success PC 반응형 CSS | ROUTINE | ✅ 완료 (2026-07-27)
  - ≥768px: .gnb-wrap display:none / .title-bar + .body max-width:900px 중앙정렬
  - .confirm-btn max-width:480px 중앙정렬
  - dev 완료 화면 동일 패턴 적용

- [x] FIX-400: checkout 날짜 미선택 시 API 400 → 클라이언트 preflight 검증 | ROUTINE | ✅ 완료 (2026-07-27)
  - productId / startDate / endDate 미충족 시 alert() 후 early return (API 호출 차단)

- [x] UI-SUCCESS-MULTI: /payment/success/dev 다중 상품 목록 + 요금 분해 카드 재구현 | BOUNDARY | ✅ 완료 (2026-07-28)
  - 배경: 단일 productName 노출 구조 → 다중 아이템 카드 + 통합 결제내역 카드로 전면 재구현
  - checkout/+page.svelte CTA: URLSearchParams 구조 변경
      · items: JSON.stringify(activeItems) — 아이템별 {name, code, startDate, endDate, pickupMethod, returnMethod, price, options[]}
      · pickupMethod/returnMethod: DELIVERY_LABELS 한국어 레이블로 변환 후 전송
      · price: itemCardRate(line, it.durType) × qty (수량 반영 단가)
      · 요금 분해 파라미터 추가: subtotal / membershipDiscount / couponDiscount / deliveryFee / vat / pointsUsed / confirmedAt
      · 구 단일 파라미터(productName/orderNumber/startDate/endDate/notes) 제거
  - /payment/success/dev/+page.ts: SuccessItem 인터페이스 추가 + items JSON 파싱
      · items[] 파싱 실패 시 구 단일상품 파라미터 폴백 (하위호환)
      · 요금 분해 6개 필드 파싱: subtotal/membershipDiscount/couponDiscount/deliveryFee/vat/pointsUsed
  - /payment/success/dev/+page.svelte: 전면 재구현
      · {#each data.items} 반복 → 상품 카드 × N개 (상품명 / 예약코드 / 대여일정 / 수령방식 / 반납방식 / 개별 대여요금 / 옵션 칩)
      · 결제 내역 카드: 대여요금·멤버십할인·쿠폰할인·배송요금·부가세·포인트사용·합계 + 결제일시·수단
      · option-chip: 퍼플 pill 스타일 (--cs-purple-op10 배경)
      · 날짜 구분자 Svelte 화이트스페이스 버그 수정: detail-dash span → '{startDate} — {endDate}' 단순 문자열
      · price-divider 구분선 + detail-row--total 합계 강조 (--text-m-title-18B, --cs-purple-dark)

✅ QA: sp3-qa-agent GATE C 통과 (2026-07-28) — Dead CSS 1건(.detail-dash) 정리 완료 → GATE E 진행 가능

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
  - src/routes/api/cms/contracts/[id]/send-chat/+server.ts ← 수정 (context_type 'payment'→'reservation' + 세션 선택 우선순위 pending→open 변경)
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
- [x] BUG-SEND-CHAT: send-chat 세션 오선택 — pending 세션 우선순위 적용 | CRITICAL FIX | ✅ 완료 (2026-07-27)
  - 원인: 사용자에게 open·pending 세션이 혼재할 때 `updated_at DESC` 정렬이 open(상품탐색) 세션을 선택
          → 실제 대화가 있는 pending(관리자 핸드오프) 세션 대신 잘못된 세션에 contract_link 발송
  - 수정: 세션 선택 순서를 pending → open → closed 재활성화 → 신규생성으로 명시적 우선순위화
  - 검증: mublues@gmail.com — '전자계약 보기' 카드 pending 세션(실 대화)에서 정상 수신 확인 ✅
- [x] BUG-SIGN-CHAT: sign API 서명 완료 알림 세션 선택 불일치 수정 | BOUNDARY FIX | ✅ 완료 (2026-07-27)
  - 파일: src/routes/api/contracts/[token]/sign/+server.ts (88-109행)
  - 원인: 서명 완료 후 관리자 채팅 알림 발송 시 open 세션만 조회 → pending(관리자 대화 중) 세션이
          있을 때 '서명 완료' 카드가 해당 세션에 전달되지 않던 버그 (BUG-SEND-CHAT와 동일 계열)
  - 수정: BUG-SEND-CHAT 수정 패턴과 동일하게 pending → open 2단계 우선순위 쿼리로 교체
  - 검증: Vercel 배포 완료 (e428c9f) ✅ — 수동 서명 테스트는 Stephen 확인 권장
- [ ] I-1: 계약서 없는 상태 관리자 조작 UI (계약서 연결/PDF 업로드) | CRITICAL | ⏳ 대기

- [x] TASK-H: 예약 카트 더미상품 노출 + 합계금액 계산 오류 근본 수정 | CRITICAL | ✅ 완료 (2026-07-27)
  - 원인: create_hold_reservation은 rental_reservations.product_id에 배정된 자식(재고) 상품 UUID를
    직접 저장하는데, checkout/+page.server.ts는 구 방식(asset_id→assets.product_id 경유)으로 상품을
    찾아 항상 실패 → 화면이 fixture 더미(cartFixtures.ts)로 폴백되던 것
  - src/routes/checkout/+page.server.ts: product_id 직접 조회로 교체(asset_id/service_role admin
    client 경로 제거 — products RLS가 status='active' 기준이라 일반 세션으로도 조회 가능함을 확인)
  - calculate_cart_total RPC 전면 재작성 — 존재하지 않는 p_user_id 파라미터로 호출되어 매번 조용히
    실패했고 반환 컬럼명도 불일치, 내부 계산도 폐기된 컬럼(base_price_daily 등) 참조 상태였음
    → 상품상세 렌탈요금 계산기(CalendarTimePicker.svelte estimatedFee)와 동일한 알고리즘으로
    price_rules(12h/24h) 기준 재작성. Migration 173, Stage(ezyvffjvuwmtuhpxdjrw)+Production
    (vnbpmvxruyciuuaermyh) 양쪽 적용 완료
  - 단일상품 결제불가 버그: datesSet·otDeliveryFee가 "카드2(p2) 존재"를 하드코딩 가정 → 실 예약
    1건뿐일 때 canProceed가 영구 false로 막히던 구조적 버그 동시 수정
  - 검증: 브라우저 실측 — 실 예약 4건 결제완료(합계 115,000원 계산기와 원 단위 일치), 신규 상품
    1건만 예약 시에도 정상 결제완료까지 통과

- [x] TASK-I: 카드1/카드2 고정 2개 제한 폐기 → 무제한 동적 리스트 재설계 | CRITICAL | ✅ 완료 (2026-07-27)
  - Stephen 확정: "여러 상품 동시 담기 가능해야 함" — 새 예약 시 기존 hold 자동취소 정책은 거부
    → 카드 2개 제한이 실사용 시나리오(다중상품 동시 hold)에서 실제로 발생하는 문제로 확인
  - +page.server.ts: cartLineItems 신규 반환(예약↔상품↔요금 1:1 매핑, 상품 미해결 예약도 누락
    없이 포함 — 기존 필터링 방식의 인덱스 불일치 위험 제거)
  - +page.svelte: c1*/c2* 개별 변수 전체를 itemsState($state 배열)로 통합, {#snippet OrderCard}
    하나로 카드 템플릿 통일(기존 카드1 단순형 + 카드2 dur-tabs형 → dur-tabs 포함 단일 디자인),
    hasItems/datesSet/합계 전부 itemsState.reduce 방식으로 재작성(개수 제한 없음)
  - 부수 발견(카탈로그 데이터 이슈, 버그 아님): 자식 재고의 price_rules가 부모 상품 화면 가격과
    다른 사례 확인(products.md §9 문서화된 드리프트 현상 실사례) — 체크아웃 계산은 실제 배정된
    자식 기준으로 일관되게 동작 중, 카탈로그 데이터 정합성 점검은 별도 필요
  - 검증: 서로 다른 실 상품 3건 동시 예약 → 3장 모두 카드 노출 + 합계 정확 일치 → 결제 완료까지 통과

- [x] TASK-J: 삭제 버튼 서버 미반영 + 로그인 사용자 빈 카트 더미상품 재노출 수정 | CRITICAL | ✅ 완료 (2026-07-27)
  - 삭제 버튼이 로컬 UI 상태만 변경하고 서버에 미반영 → 카드는 사라져도 합계는 삭제 상품 값을
    그대로 포함(새로고침 시 삭제한 상품 재노출)
  - 신규 src/routes/api/checkout/remove-item/+server.ts: 본인 소유+status='hold' 검증 후
    update_reservation_status(cancelled) 호출. +page.svelte removeItem(): 낙관적 숨김 → API
    호출 → 성공 시 invalidateAll()로 서버 기준 재동기화
  - 로그인 사용자가 카트를 완전히 비우면 isServerLoaded(예약 존재 여부) 기준으로 fixture 데모가
    다시 노출되던 버그 확인·수정 — 이번 세션 후속 작업(TASK-K)에서 fixture 자체를 제거하며 해결됨
  - 검증: 실 상품 2건 중 1건 삭제 → 카드 삭제+합계 25,000원으로 정확 재계산 → DB status='cancelled'
    반영 확인 → 남은 1건도 삭제 → "장바구니가 비어 있습니다" 정상 표시(더미 미노출) 확인

- [x] TASK-K: 미로그인 게스트 예약 허용 + fixture 데모 미리보기 설계 전면 제거 | CRITICAL | ✅ 완료 (2026-07-27)
  - Stephen 요청 3건: ① 미로그인도 실 상품목록+로그인과 동일 UI로 /checkout 랜딩 ② 미로그인 대여
    예약 자체 허용(임시 계정 자동생성) ③ "비로그인 시 데모 미리보기" 설계 제거
  - products/[id]/+page.svelte handleReserve(): 비로그인 시 로그인 페이지 리다이렉트 제거 →
    supabase.auth.signInAnonymously()로 실 UUID 임시 세션 투명 생성 후 동일 create_hold_reservation
    플로우 진행. 신규 도입 아님 — 채팅 위젯(ChatWindow.svelte ensureAuth())에서 이미 쓰던 동일
    패턴, DB 확인 결과 해당 방식 익명 계정 20건 기존 존재로 실사용 검증됨을 확인
  - RLS 재확인: rental_reservations/products/price_rules 전부 auth.uid() 또는 공개조회 기준 —
    익명 세션도 실회원과 동일하게 동작(예외 처리 불필요)
  - fixture 데모 분기(fixtureLineItems, sampleSubItems, priceConfig, isDevMode,
    /payment/success/dev 미리보기 강제 분기) 전면 제거. checkout/+page.ts(fixture 로더) 파일 삭제
  - 완료 버튼 문구 회원/비회원 분기 추가: +page.server.ts가 session.user.is_anonymous를 isGuest로
    반환 → 비회원("비회원 예약신청완료") / 회원("예약신청완료") 텍스트 분기
  - 검증: 로그인 회원 계정 버튼 문구 실측 확인. 게스트(익명) 분기는 브라우저 자동화 도구가 세션
    후반 간헐적 응답 없음("Browser pane is currently hidden")을 반복해 실측 클릭 검증 미완료 —
    Supabase 프로젝트에 기존 익명 계정 20건 존재로 메커니즘 자체는 실사용 검증됨, 코드·타입체크만 확인

- [x] TASK-L: 상품 체크박스 기본 체크 + 체크 해제 시 약정요금·결제 확정 대상에서 제외 | BOUNDARY | ✅ 완료 (2026-07-27)
  - newItemState() 기본값 checked: false → true. 약정요금 관련 계산(소계·멤버십 할인·배송비·
    보증금·총 대여기간) 전부 "!deleted && checked" 조건으로 재작성(서버 RPC 합계는 체크 상태를
    모르므로 카드에 이미 표시 중인 방식과 동일하게 클라이언트에서 체크 항목만 합산)
  - hasItems/datesSet도 checked 기준 정합화 — 체크 해제 상품은 카트에 남아도 필수 조건에서 제외
  - footer CTA: checkedIds만 /api/checkout/confirm-mock에 전송 → confirm-mock/+server.ts가
    reservationIds 파라미터로 필터링 후 해당 목록만 confirmed 처리(미전달 시 하위호환 유지)
  - 검증: svelte-check 신규 에러 0건. 실측 클릭 검증은 TASK-K와 동일한 브라우저 도구 응답 없음
    문제로 미완료 — Stephen 직접 확인 권장(2건 담고 1건만 체크 해제 후 결제 시 체크 해제 건은
    hold로 남고 나머지만 confirmed로 전환되는지)

⚠️ 다음 세션 QA 필요 항목(브라우저 자동화 도구 문제로 미완료된 실측):
  - TASK-K 게스트(비회원) 라벨/예약 플로우 실제 클릭 검증
  - TASK-L 체크박스 해제 → 합계 감소 → 결제 확정 시 해당 건만 hold 유지 확인

Migration 적용 완료:
  - Migration #146 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ 적용 완료 (2026-07-23)
  - Migration #173 (calculate_cart_total 재작성) — Stage + Production 양쪽 ✅ 적용 완료 (2026-07-27)

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

## NOW — 상품 상세 페이지 구성품(components) 노출 + 이미지 버그픽스 + isDirty 버그 수정 (2026-07-25) ✅ 완료

plan_source: 세션 내 아젠다
핵심제약:
  - CMS ProductDetailPanel의 모든 필드 → 사용자 화면 노출 검증 완료 기반
  - $state(prop) 초기화 금지 원칙 준수 ($effect 재동기화 패턴)
  - components 필드 TypeScript 타입 미등록 → unknown 캐스트 패턴 적용
  - 요청 범위 외 수정 없음

신규/수정 파일:
  - src/routes/products/[id]/+page.svelte ← 구성품 정보탭 노출 (핵심 수정)
  - src/routes/cms/products/+page.server.ts ← 자식 상품 선택 시 image_urls 부모 기준 저장 버그 수정
  - src/lib/components/cms/ProductDetailPanel.svelte ← isDirty 저장 후 즉시 비활성 버그 수정

- [x] FEAT-COMPONENTS-DISPLAY: 사용자 화면 정보탭 구성품 노출 | BOUNDARY | ✅ 완료 (2026-07-25)
  - productComponents $derived.by() 추가 (unknown 캐스트 → [string, string][] 반환)
  - 정보 탭: comp-section 최상단 배치 (구성품 → 상품설명 순서)
  - empty state 오탐 방지: `!productComponents` 조건 추가 (구성품만 있을 때 "설명 없음" 미표시)
  - CSS: .comp-section / .comp-heading / .comp-list / .comp-item / .comp-item-key / .comp-item-val 추가
  - 모바일/PC 반응형 CSS 분리 (font: var(--text-m-title-18B) / var(--text-pc-title-18))
  - 보더 라인: var(--cs-lilac) 1px (spec-table과 동일 스타일)
  - 데이터가 없으면 섹션 미렌더 (CMS 구성품 탭 입력 후 사용자 화면 표시)

- [x] BUG-IMAGE: 자식 상품 선택 시 이미지 업로드 → 목록 카드 썸네일 미반영 버그 수정 | BOUNDARY | ✅ 완료 (이전 세션)
  - 원인: 자식 selectedProduct로 images 탭 저장 시 자식 ID 기준 image_urls UPDATE → 부모 미갱신
  - 수정 (cms/products/+page.server.ts): sectionType==='images' + 자식이면 → 부모 ID 기준 UPDATE
  - 아코디언 선택 상태에서도 이미지는 항상 부모 products.image_urls에 저장
  - invalidateAll() 후 카드 썸네일 즉시 반영

- [x] BUG-ISDIRTY: 사양/구성품 탭 저장 후 isDirty 즉시 비활성화 안 되는 버그 수정 | ROUTINE | ✅ 완료 (이전 세션)
  - 원인: origComponentsJson / origSpecsJson이 const 초기화 → 저장 후 props 변경돼도 원본 고정
  - 수정 (ProductDetailPanel.svelte): const → $derived로 변경 → 저장 후 prop 재수신 시 자동 재계산
  - 저장 직후 isDirtyComponents / isDirtySpecs = false 전환 정상 동작

- [x] QA: sp3-qa-agent GATE C 검수 | GATE C | ✅ 완료 (2026-07-25) — GATE E 통과, 즉시 수정 건 0건
  - 논리 정합성 4시나리오(components×description) 전부 통과
  - 이미지 저장 경로: 부모/자식 분기 정합
  - Svelte 5 패턴, CSS 토큰, TypeScript 안전성 모두 통과
  - 권고 1건: `SelectedProduct` 타입에 `assetTotal` 미선언 (다음 작업 시 추가 권장)

GATE E: ✅ 커밋 허가 — Stephen git commit 진행

---

## NOW — Auth 회원가입 오류 수정 + Production DB 정합 (2026-07-25) ✅ 완료

plan_source: 세션 직접 수행 (GSD 도메인 — 버그픽스)
TDD도메인: 없음

### 완료 태스크

- [x] FEAT-AUTH-PC: 로그인 화면 PC 반응형 수정 | BOUNDARY | ✅ 완료 (커밋 1b00927)
  - flex-wrap + min-width: 220px → 좁은 화면에서 이메일·비밀번호 입력창 깨짐 방지
  - Sign Up / Sign In 버튼 $derived isSignInMode 자동 전환 로직 추가

- [x] FEAT-SIGNUP-MODAL: SignUpModal.svelte 신규 | BOUNDARY | ✅ 완료 (커밋 1b00927)
  - 파일: src/lib/components/auth/SignUpModal.svelte
  - 2단계 가입 모달: 1단계(이메일·비밀번호·이름) + 2단계(휴대폰 OTP 더미)
  - TODO: 알리고 SMS 실연동 필요 (더미 OTP, line ~73, ~102)
  - 에러 메시지 한국어화: 이미 가입된 이메일 / 잠시 후 다시 시도 / 일반 오류

- [x] BUG-TRIGGER-163: handle_new_user 트리거 user_id 컬럼 누락 | CRITICAL | ✅ 완료 (커밋 1b00927)
  - Migration #163: INSERT INTO user_profiles(id, user_id, email, ...) 정상 동작
  - Stage ✅ Production ✅

- [x] BUG-PROD-164: user_profiles Production user_id 컬럼 누락 → 가입 500 오류 | CRITICAL | ✅ 완료
  - 원인: Stage에는 user_id 컬럼 존재, Production에는 미적용 → 트리거 INSERT 실패 → Auth 500
  - 파일: supabase/migrations/20260724000164_164_add_user_id_to_user_profiles_prod.sql
  - ALTER TABLE ADD COLUMN IF NOT EXISTS + backfill(user_id = id) + NOT NULL 제약
  - Stage ✅ Production ✅

- [x] BUG-CMS-RPC-165: get_customer_list RPC 없는 컬럼 참조 → CMS 고객목록 조회 실패 | CRITICAL | ✅ 완료
  - 원인: COALESCE(up.identity_doc_url, up.student_doc_url) — student_doc_url 컬럼 없음
  - 파일: supabase/migrations/20260724000165_165_fix_get_customer_list_rpc.sql
  - 수정: student_doc_url / student_verified_at 참조 제거 → identity_doc_url / identity_verified_at 단독 사용
  - Stage ✅ Production ✅

- [x] QA: sp3-qa-agent GATE C 검수 | GATE C | ✅ 완료 (2026-07-25)

GATE E: ✅ 커밋 허가 — Stephen git commit 진행

---

## NOW — 대여 라이프사이클 정밀 감사 (2026-07-26) ✅ 완료 (연구)

plan_source: 세션 내 아젠다 — 전체 코드베이스 Explore 탐색 + 빌드 로그 분석
감사 범위: 상품 상세 → 예약신청 → 예약승인 → 대여확인 → 반납요청 → 반납완료

결과 상세: `.claude/harness/learnings/rental_lifecycle_audit_2026-07-26.md` 참조

- [x] 전체 대여 라이프사이클 코드베이스 탐색 | RESEARCH | ✅ 완료 (2026-07-26)
- [x] 8개 결함 항목 목록화 (CRITICAL 2건, BOUNDARY 3건, ROUTINE 3건) | RESEARCH | ✅ 완료
- [x] 정상 구현 항목 확인 및 문서화 | RESEARCH | ✅ 완료
- [x] 하네스 플로 시스템 반영 (TASK.md + learnings) | ROUTINE | ✅ 완료

✅ 정상 구현 확인 목록:
  - create_hold_reservation RPC → 상품 상세 예약신청 ✅
  - 비로그인 예약 → /auth/login?next= 리다이렉트 ✅
  - 체크아웃 서버 로드 (hold예약→assets→products) ✅
  - calculate_cart_total RPC 연동 ✅
  - CMS cms/reservation 예약 목록 + 승인/거부 ✅
  - CMS cms/rentals 대여 현황 + 상태 전환 ✅
  - 전자계약 발송·서명·PDF 전체 흐름 ✅
  - 채팅 시스템 (세션·메시지·Realtime·읽음) ✅
  - cancel_payment_and_release_hold (실패·취소 경로) ✅

---

## NOW — CMS 상담채팅 대여 라이프사이클 알림 정합성 정밀 감사 (2026-07-27) ✅ 완료 (연구)

plan_source: 세션 내 아젠다 (Explore 에이전트 2개 병렬 탐색)
감사 범위: `/cms/chat` 상담세션 목록 + 상품선택~반납완료 전 구간 사용자 채팅 알림 정합성
핵심제약: 코드 수정 없음(검증/리포트 전용) — 결제(PG)는 미구현 상태로 "예약신청→예약승인" 직행으로 간주하고 그 위에서 알림 로직만 검증

결과 상세: `.claude/harness/learnings/chat_notification_lifecycle_audit_2026-07-27.md` 참조
선행 감사: [[rental_lifecycle_audit_2026-07-26]] — 상태전이 축, 이번은 채팅 알림 축

- [x] 체크아웃/예약/결제mock/승인/라이프사이클 상태머신 전체 탐색 | RESEARCH | ✅ 완료
- [x] 채팅알림 트리거·CMS 세션목록·전자계약 알림 경로 전체 탐색 | RESEARCH | ✅ 완료
- [x] 요청 7개 항목별 정합/격차 목록화 (CRITICAL 4건, BOUNDARY 6건, ROUTINE 4건) | RESEARCH | ✅ 완료
- [x] 하네스 플로 시스템 반영 (TASK.md BACKLOG + learnings 신규 + GSD_LOG) | ROUTINE | ✅ 완료

신규 발견 핵심 (코드 미수정, Stephen 확인 대기):
  - 실결제(Toss) 확인 경로에서 예약승인 알림 미발송 (BL-CHAT-C1)
  - "대여확인"(수령확인) 전용 알림 타입 부재 (BL-CHAT-C2)
  - 계약서명 시 상태 직접 UPDATE(H-01 위반) + 알림 유실 가능 (BL-CHAT-C3)
  - confirm-mock이 무관한 hold 예약까지 일괄 승인 (BL-CHAT-C4)

✅ 정상 구현 확인 목록 (채팅 알림 축):
  - hold/shipped/in_use/return_requested/returned AUTO_NOTIFY 자동발송 배선 정상 연결 ✅
  - send_rental_chat_notification service_role 전용 잠금 + sender_type/action_payload 스키마 정합 ✅
  - nextStatus()/nextLabel() 상태머신 — rental-lifecycle.md 문서와 100% 일치(재확인) ✅
  - chat_sessions.user_id 기반 계정 연동 정상 ✅
  - /cms/reservation ↔ /cms/rentals 목록 조회 정합 (알림 축과 별개로 문제 없음) ✅

---

## NOW — CMS 상담채팅 알림·실시간 반영 개선 구현 (2026-07-27) ✅ 완료

plan_source: 세션 내 아젠다 (위 정밀 감사 결과를 바탕으로 Stephen이 순차 지시)
범위: 위 감사에서 발견한 CRITICAL 항목 중 채팅 관련 2건 처리 + `/cms/chat` 상담세션 목록 실시간 반영 전면 점검

- [x] BL-CHAT-C1: 실결제(Toss) 확인 경로 예약승인 알림 누락 수정 | CRITICAL | ✅ 완료
  - `src/routes/api/payment/confirm/+server.ts`, `src/routes/payment/success/+page.server.ts`에
    `send_rental_chat_notification(reservation_approval)` 호출 추가(confirm-mock과 동일 패턴)
  - 비고: 두 경로 모두 현재 체크아웃 UI에서 호출되지 않는 미연결 상태 — S1-M3 실결제 연동 시 대비한 선제 수정
- [x] BL-CHAT-C2: "대여확인" 전용 알림 타입 신규 추가 | CRITICAL | ✅ 완료 (Stage+Production 적용)
  - 신규 마이그레이션(`send_rental_chat_notification`에 `rental_confirm` 분기 추가)
  - `cms/reservation/+page.server.ts`의 자동발송 매핑에서 in_use 진입 시 `return_remind` → `rental_confirm`으로 교체
  - 부수 해결: BL-CHAT-B6(반납예정 알림이 대여시작 즉시 발송되던 라벨 불일치) 함께 해소
- [x] 상담세션 목록 실시간 미반영 수정 | BOUNDARY | ✅ 완료
  - 좌측 세션 목록의 마지막 메시지 미리보기·정렬이 새 메시지 도착 시 갱신되지 않던 문제 수정
  - 전체 메시지 Realtime 구독 신규 추가 → 도착 즉시 미리보기 갱신 + 최신순 재정렬
  - 파일: `chatService.ts`, `chat.svelte.ts`, `AdminChatPanel.svelte`
- [x] 대기 탭 세션 새 활동 시 진행중 자동 이동 | BOUNDARY | ✅ 완료
  - 새 메시지 도착 시 AI 판단과 무관하게 대기/종료 세션을 무조건 진행중으로 승격
  - 검증 중 "진행중 승격 직후 다음 메시지에서 다시 대기로 되돌아가는" 충돌 추가 발견·수정
  - 대기 상태는 이제 1시간 무응답 자동전환(auto_pending_inactive_sessions) 경로로만 재진입
  - 파일: `src/routes/api/chat/message/+server.ts`
- [x] 목록카드 점멸 애니메이션(신규 채팅·새 대화 시 3회) | BOUNDARY | ✅ 완료 (강화 1회 포함)
  - 최초 구현: 옅은보라 배경 점멸(0.5초×3)
  - Stephen 재보고("미작동") → MutationObserver·computed style로 트리거·CSS 연결 자체는 정상 확인
  - 노출성 강화: 배경색 + 좌측 강조 보더(기존 child-readonly-notice 패턴 재사용) 2중 신호로 변경, 0.6초×3으로 연장
  - Stephen 재확인 대기 중
- [x] 종료 탭 실시간 반영 확인 | VERIFY | ✅ 완료 (정상, 코드 수정 없음)
  - 관리자 브라우저 2개로 교차 검증 — 기존 세션 상태 구독 로직이 종료 탭에도 정상 적용됨을 확인
- [x] QA 후속 권장 4건 처리 | BOUNDARY | ✅ 완료 (2026-07-27)
  - 결제 승인 알림 idempotent 재시도 시 중복발송 방지 가드 추가
  - 결제정보 탭에 "카드 승인번호"(Toss card.approveNo) 행 신규 추가
  - 상담세션 "긴급" 배지 신규 구현(관리자 미응답 + 마지막 고객 메시지 CS_ESCALATE 시 노출)
  - 구현 중 발견: `chat_intent_logs`가 service_role 전용 RLS인데 일반 세션 클라이언트로
    INSERT하고 있어 지금까지 단 한 건도 적재되지 않던 결함 발견·수정(긴급 배지의 직접 선행 결함)
  - `rental-lifecycle.md` 자동/수동 알림 매핑 표 분리 + 대기 재진입 조건 문서화 (v1.2→v1.3)
  - `ActionCardType`에 `reservation_hold`/`rental_confirm` 누락 값 추가
  - 브라우저 실측: CS_ESCALATE 메시지 전송 → chat_intent_logs 적재 확인 → 긴급 배지 노출 확인

결과 상세: `.claude/harness/GSD_LOG.md` 2026-07-27 이후 항목 참조

---

## BACKLOG

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

---

## NOW — 상품 상세 화면(/products/[id]) 심층 재검수 + 옵션·CMS 버그픽스 (2026-07-27) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 순차 지시 기반 진행)
핵심제약:
  - 요청 범위 외 수정 없음
  - $state(prop) 초기화 금지 원칙 준수 ($effect 재동기화 패턴 적용)
  - DB 데이터 이동(옵션상품/대여정책 자식→부모) 전 Stephen 승인 필수 (CRITICAL — 다중 파일·DB 변경)

신규/수정 파일:
  - src/routes/products/[id]/+page.svelte ← 다수 수정 (아래 상세)
  - src/routes/products/[id]/+page.server.ts ← parent_product_id 필터 2곳 + rental_method_options method_key 추가
  - src/lib/components/products/CalendarTimePicker.svelte ← rentalPeriods prop 제거 + shippingPolicy prop 신규
  - src/lib/components/cms/ProductDetailPanel.svelte ← 옵션상품/대여정책 탭 자식(재고) 저장 차단
  - src/routes/cms/products/+page.server.ts ← updateSection 서버사이드 자식 차단 가드 추가

DB 적용 (Stage: ezyvffjvuwmtuhpxdjrw, Stephen 승인 후 진행):
  - SONY PXW-Z90(467c8f9b) 옵션상품 1건 + 대여방식 3건 — 자식(7c095ca2)→부모 UPDATE 이동, 자식 값 초기화

- [x] BUG-OPT-STALE: 옵션상품 목록 SPA 네비게이션 stale 상태 버그 | CRITICAL FIX | ✅ 완료 (2026-07-27)
  - 원인: `optionItems = $state(data.optionLinks.map(...))` — $state(prop) 초기화는 마운트 시 1회만 실행되는데,
    상품 상세는 같은 컴포넌트가 SPA 네비게이션으로 재사용되어 이전 상품의 옵션이 그대로 잔존/미갱신
  - 수정: buildOptionItems() 함수 추출 + `$effect(() => { optionItems = buildOptionItems(data.optionLinks) })` 재동기화
  - 동일 원인의 `reviews` $state에도 동일 패턴 적용 (SPA 이동 시 후기 목록 상품간 혼입 방지)
  - 브라우저 실검증: Canon RF ↔ SONY PXW-Z90 SPA 이동 시 옵션/후기 정확히 교체되는 것 확인

- [x] FEAT-OPT-ACCORDION: 옵션상품 아코디언 화살표 활성/비활성 | BOUNDARY | ✅ 완료 (2026-07-27)
  - hasOptionItems 파생값 추가 — 옵션 0건 시 화살표 비활성(aria-disabled + tabindex=-1 + opacity 0.45)
  - 옵션 1건 이상 시 기존 펼침/닫힘 토글 유지

- [x] BUG-REVIEW-TOAST: 후기등록 버튼 비로그인/미입력 무반응 버그 | BOUNDARY | ✅ 완료 (2026-07-27)
  - 원인: `disabled={isSubmittingReview || !reviewTitle.trim() || !reviewContent.trim()}` — 조건 미충족 시
    버튼이 네이티브 disabled로 죽어 클릭 자체가 막혀 토스트를 띄울 방법이 없었음
  - 수정: 버튼 disabled를 isSubmittingReview만으로 축소, 클릭 시 상황별 토스트로 안내
    (비로그인 "로그인 후 이용해주세요." / 제목 누락 "제목을 입력해주세요." / 내용 누락 "내용을 입력해주세요.")
  - 브라우저 실검증(MutationObserver): 비로그인 클릭 시 토스트 노출 확인, 로그인 후 실제 등록 성공까지 확인

- [x] FEAT-OPTION-VALIDATION: 예약신청 옵션 검증 토스트 3종 | CRITICAL | ✅ 완료 (2026-07-27)
  - handleReserve() 진입 시 옵션 검증 순차 체크 (기존 reserveDisabled 네이티브 버튼 비활성 방식 → 전량 토스트 전환)
    1. 필수(is_required) 옵션 qty=0 → "필수 옵션상품을 선택하세요."
    2. min_select_required 그룹 전부 qty=0 → "최소 1개 이상의 옵션상품을 선택하세요."
    3. delivery_rental_disabled 옵션 선택 + 배송(비-visit) 방식 선택 충돌 → "선택한 옵션상품은 배송이 불가능합니다."
  - min_select_required 필드가 프론트에서 전혀 매핑되지 않고 있던 것 발견 → buildOptionItems()에 추가 + "최소 1개 선택" 배지 신규 추가
  - +page.server.ts: rental_method_options select에 method_key 추가(visit 판별용) — RentalOption과 분리된 RentalMethodOption 타입 신규
  - 브라우저 실검증: 필수 미선택 토스트 확인 / 배송충돌 토스트 확인 / 방문대여+정상입력 시 정상 통과(재고없음 메시지까지 도달) 확인
  - ⚠️ min_select_required 단독(필수 아님) 케이스는 현재 운영 데이터상 격리 테스트 불가(유일 옵션이 필수와 중복 설정) — 로직은 동일 패턴이라 코드 검토로 확신, Stephen에 CMS 테스트 데이터 구성 필요시 안내

- [x] BUG-CMS-CHILD-OPTION-RENTAL: CMS 옵션상품/대여정책 자식(재고) 저장 사고 | CRITICAL FIX | ✅ 완료 (2026-07-27)
  - Stephen 신고: SONY PXW-Z90(cam-zo-2607) 옵션상품 전혀 반영 안 됨 + CMS 옵션상품/대여정책 미반영
  - 원인: CMS 재고(인벤토리) 아코디언에서 개별 재고가 선택된 상태로 옵션상품/대여정책 탭 저장 시
    product_id=자식으로 저장됨(모든 탭이 공통으로 product.id 사용) → 고객화면(부모 기준 조회)에 미반영
  - 데이터 복구(Stephen 승인 후): SONY PXW-Z90 옵션링크 1건 + 대여방식 3건 자식→부모 UPDATE 이동, 자식 값 초기화
  - 전체 점검(리포트만, 미수정): Manfrotto 055도 동일 패턴 발견 — 옵션 중 1건이 자기 자신을 옵션으로 참조하는
    이상 데이터가 있어 자동이동 보류, Stephen 별도 확인 필요
  - 재발방지: ProductDetailPanel.svelte 옵션상품/대여정책 탭 — product.parent_product_id 존재 시 저장버튼
    비활성화 + 안내배너("상품 대표에서만 설정 가능") + saveOptions() 함수 자체 가드
  - 서버사이드 동일 가드 추가: cms/products/+page.server.ts updateSection에서 sectionType이
    options/rental일 때 대상 product의 parent_product_id 조회 후 존재 시 fail(400)

- [x] BUG-CHILD-URL-404: 상품 상세 자식(재고) UUID/slug 직접 접근 시 부모 정보 혼입 | CRITICAL FIX | ✅ 완료 (2026-07-27)
  - Stephen 직접 진단·지시: +page.server.ts 기본 쿼리에 parent_product_id IS NULL 필터 누락
  - 수정 2줄: 메인 조회 쿼리 + popularProducts(많이 본 상품) 쿼리 양쪽에 .is('parent_product_id', null) 추가
  - 효과: 자식 UUID/slug 직접 접근 → 404 정상 처리. "많이 본 상품"에 자식 재고 중복 노출되던 것도 해결
  - 브라우저 실검증: 부모 slug 정상 노출 / 자식 slug 404 확인 / 많이 본 상품 중복 사라짐 확인

- [x] FEAT-INFO-LAYOUT: 기본정보/예약영역 노출 항목 재배치 | BOUNDARY | ✅ 완료 (2026-07-27)
  - Stephen 지시: 기본 상품 정보 영역 = 대여기간만 / 예약신청 버튼 상단 = 대여방식+배송정책만
  - +page.svelte 상단(title-card): 대여방식·배송정책 블록 제거, 대여기간만 유지
  - CalendarTimePicker.svelte: rentalPeriods prop 제거(대여기간 UI 삭제) + shippingPolicy prop 신규 추가(배송정책 표시)
  - 브라우저 실검증 + Stephen 직접 확인: 대여기간 상단 노출, 대여방식+배송정책 예약영역 상단 노출 확인

- [x] BUG-PICKUP-METHOD-HARDCODE: 예약 시 수령방식 무조건 'visit' 저장 | CRITICAL FIX | ✅ 완료 (2026-07-27)
  - 세션 중 최종 재검수에서 발견 — BL-LC-R3(2026-07-26 감사)로 이미 백로그 등록돼 있던 기존 결함
  - 원인: set_reservation_shipment_method 호출 시 p_pickup_method: 'visit' 하드코딩 — 고객이 실제
    선택한 방식(크레이지샷배송/퀵배송 등)이 전혀 반영 안 됨
  - 수정: `selectedMethod?.method_key ?? 'visit'` — handleReserve() 내 이미 계산된 selectedMethod 재사용
  - 브라우저+DB 실검증: 크레이지샷배송 선택 → reservation.pickup_method='crazydelivery' 정상 저장 확인,
    방문대여 선택 시 기존과 동일하게 'visit' 저장 확인(회귀 없음)
  - BL-LC-R3 백로그 항목 ✅ 완료로 갱신함

svelte-check: 신규 ERROR 0건 (기존 warning만, 오늘 수정 파일 관련 신규 warning 없음)

sp3-qa-agent GATE C 검수 결과 (2026-07-27):
  - 위 8개 항목(옵션 stale/아코디언/후기토스트/옵션검증3종/CMS자식차단/자식URL404/정보영역재배치/pickup_method) 전부 ✅ 결함 없음 확인
  - $effect 재동기화 순환 재실행 위험 없음, handleReserve() 3종 토스트 로직 결함 없음, CMS 서버가드가 options/rental에만 정확히 적용됨, parent_product_id 필터가 legacy numeric id 분기와 충돌 없음 확인
  - ⚠️ GATE E 보류 사유 2건 (Stephen 확인 요청, 아래 참조) — 둘 다 이번 세션 작업 범위 밖(src/routes/cms/products/+page.svelte 관련 별도 진행 중인 작업)에서 발견됨
    1. ProductDetailPanel.svelte의 대표(부모) 상품 QR 조회·다운로드(ph-body/qr-wrap)가 `{#if isChildProduct}`로 감싸져 부모 선택 시 노출 안 됨
       → Stephen 확인(2026-07-27): **의도된 설계임.** 부모는 대표 상품정보 영역일 뿐 실존 재고가 아니므로 QR 불필요.
         실제 QR은 자식(재고) 상품 코드 발행 시점에 동시 반영되는 것이 정본 흐름. → 결함 아님, 조치 불필요.
    2. src/routes/cms/products/+page.svelte(411줄 변경, 미커밋)가 TASK.md 어디에도 기록되어 있지 않음 — 별도 작업분으로 보이며 이번 세션 범위 아님, 해당 작업 세션에서 별도 문서화·검수 필요
  - 미차단 참고사항: CalendarTimePicker.svelte의 reserveDisabled/selectedPeriodId prop이 이제 죽은 코드(기능 결함 아님, 정리 권장)

⏳ 후속: 문제 1은 Stephen 확인 완료(의도된 설계, 조치 불필요). 문제 2는 이번 세션 범위 밖 별도 작업(cms/products/+page.svelte 관련) — 해당 작업 세션에서 별도 문서화·검수 필요. 오늘 세션 8개 항목은 GATE E 통과.

---

## NOW — 채팅 모달·GNB 게스트 UX 개선 (2026-07-27 연속 세션)

plan_source: 세션 내 아젠다 (Stephen 순차 지시 기반 진행)
핵심제약:
  - 요청 범위 외 수정 없음
  - Svelte 5 Runes 패턴 준수 ($state, $derived, $effect)
  - pointer-events 캐스케이드 · transform+fixed 충돌 원칙 준수 (core-rules.md 등록 패턴)

신규/수정 파일:
  - src/lib/components/common/FloatingBar.svelte ← 채팅 모달 동결 버그 수정
  - src/lib/components/chat/ChatHeader.svelte ← /account 링크 + 게스트 프롬프트 UI + guestMode prop화
  - src/lib/components/chat/ChatWindow.svelte ← guestMode 상태 소유 + setGuestInfo 콜백 + oninputstart 전달
  - src/lib/components/chat/ChatInput.svelte ← oninputstart prop 추가
  - src/lib/components/common/GNB.svelte ← isGuestUser 파생값 + 아바타/로그인버튼 분기

- [x] BUG-CHAT-FROZEN: 채팅 모달 클릭·스크롤·입력 완전 동결 | CRITICAL FIX | ✅ 완료 (2026-07-27)
  - 원인: `.fab-bar.peek { transform: translateX(calc(50%+15px)) }` → 이 조상에 transform이 적용되어
    내부 `position:fixed` 자식(ChatBottomSheet backdrop/bottom-sheet)의 stacking context가 뷰포트 기준에서
    `.fab-bar` 기준으로 전환. 또한 임의 스크롤 시 `peekMode=true` → 래퍼에 `pointer-events:none` 캐스케이드
    → 모달 전체 클릭·스크롤 불가
  - 수정:
    1. FloatingBar 스크롤 핸들러 — `chatStore.isOpen` 일 때 peekMode 전환 건너뜀
    2. 라우트 변경 $effect — `chatStore.isOpen` 일 때 peekMode 전환 건너뜀
    3. FloatingButton 래퍼 div — `(peekMode && !chatStore.isOpen)` 시에만 `pointer-events:none` 적용

- [x] FEAT-CHAT-ACCOUNT-LINK: 채팅 헤더 내정보 링크 (로그인 사용자 전용) | BOUNDARY | ✅ 완료 (2026-07-27)
  - 로그인 사용자(userName !== '게스트'): user-info 영역을 `<a href="/account">` 링크로 전환
  - 비로그인/게스트: 기존 비링크 상태 유지
  - `isLoggedIn = $derived(!!userName && userName !== '게스트')` — 익명 auth UUID가 userId로 들어와도
    userName='게스트'이면 비로그인 처리 (userId 검사 대신 userName 검사가 안전)

- [x] FEAT-CHAT-GUEST-PROMPT: 채팅 헤더 게스트 로그인/비회원 선택 UI | BOUNDARY | ✅ 완료 (2026-07-27)
  - 비로그인 초기 상태: 로그인(filled cs-purple, radius-xl, h36) + 비회원(outlined) 버튼 나란히 표시
  - 로그인 선택 → `/auth/login` 랜딩
  - 비회원 선택 → 기존 게스트 이름·임시코드 표시 (링크 없음, guestMode='info')
  - guestMode 상태를 ChatWindow로 끌어올려 ChatInput(형제 컴포넌트)에서도 동일 전환 가능하게 함

- [x] FEAT-CHAT-INPUT-AUTOSWITCH: 입력 시 비회원 자동 전환 | BOUNDARY | ✅ 완료 (2026-07-27)
  - ChatInput에 `oninputstart?: () => void` prop 추가
  - `handleInput()` 내에서 `oninputstart?.()` 호출 → ChatWindow의 `setGuestInfo()`가 실행돼 guestMode='info' 전환
  - 로그인 / 비회원 선택 없이 바로 타이핑 시 비회원 선택과 동일한 UI로 자동 전환

- [x] BUG-GNB-GUEST-AVATAR: 익명 auth 게스트 전환 후 GNB 아바타 노출 | BOUNDARY FIX | ✅ 완료 (2026-07-27)
  - 원인: `supabase.auth.signInAnonymously()` → 실 UUID auth 세션 생성 → `$authState.user !== null`
    → GNB 아바타(?) 버튼 노출 + /account 링크 → 원치 않는 게스트 아바타 UI + 404 위험
  - 수정: `isGuestUser = $derived(!!$authState.user && (is_anonymous===true || !user.email))`
    파생값으로 익명 사용자 판별 → 데스크탑·모바일 GNB 모두:
      · 실 로그인(`$authState.user && !isGuestUser`): 이니셜 아바타 → /account
      · 익명 or 비로그인(`else`): Sign In 버튼 유지 (기존 로그인 버튼 보호)

- [x] BUG-CHAT-LOGIN-404: 채팅 헤더 로그인 버튼 404 오류 | ROUTINE FIX | ✅ 완료 (2026-07-27)
  - 원인: `window.location.href = '/login'` (잘못된 경로)
  - 수정: `/auth/login` 으로 정정

⏳ QA: sp3-qa-agent 검수 예정

---

## NOW — Production 옵션상품 노출 오류 점검 + 전수 데이터 정리 (2026-07-27) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 신고 기반)
핵심제약:
  - Production DB(vnbpmvxruyciuuaermyh) 직접 조회 — 데이터 변경 전 Stephen 승인 필수
  - 코드 수정 없음 — 이번 항목은 순수 데이터 진단·정리 작업 (당일 앞선 세션에서 이미 배포한
    CMS 자식상품 저장 차단 가드가 재발 방지 역할)

신고 내용:
  - 사용자 화면: https://crazyshot-svelte.vercel.app/products/panasonic-lumix-gh5-2607 — 옵션상품 미노출
  - CMS 확인 링크: https://crazyshot-svelte.vercel.app/cms/products?selected=48729961-fc70-4346-bbf6-a348572a0117 (자식/재고 id)

- [x] DIAG-OPT-MISSING: 옵션상품 미노출 원인 분석 — DB 마이그레이션 문제 여부 확인 | CRITICAL | ✅ 완료 (2026-07-27)
  - `get_product_option_links` RPC / `product_option_links` 테이블 / `min_select_required` 컬럼 — Production에
    전부 정상 존재·정상 동작 확인 (RPC 직접 호출로 검증) → **마이그레이션 누락 아님**
  - 실제 원인: 기존에 발견·수정한 것과 동일한 CMS UX 함정 — 재고(자식) 상품이 선택된 상태로 옵션상품을
    저장하면 `product_id`가 대표(부모)가 아닌 자식으로 저장되어 고객 화면(부모 기준 조회)에 미반영
  - PANASONIC LUMIX GH5(부모 8a577ba1 / 자식 48729961) 확인: 자식에 옵션 2건 저장돼 있었으나, 조사 시점엔
    부모 쪽에도 이미 유효한 옵션 2건이 존재(2026-07-27 07:57 생성 — 당일 앞선 세션에서 배포된 자식상품
    저장 차단 가드 이후 Stephen이 부모 기준으로 재설정한 것으로 추정) → 라이브 화면 정상 노출 재확인 완료

- [x] AUDIT-OPT-FULL: Production 전체 상품 옵션상품 노출 상태 전수 점검 | CRITICAL | ✅ 완료 (2026-07-27)
  - 부모 상품 41건 전수 조회 — 옵션상품이 설정된 상품은 3건뿐 (나머지는 미설정 상태이며 오류 아님)
    · PANASONIC LUMIX GH5 — 2건
    · SONY UWP-D21 — 2건 (동일 자식↔부모 오배치 패턴 추가 발견)
    · Sony NP-F770 — 1건
  - 위 3건 전부 브라우저로 라이브 화면 직접 로드해 정상 노출 확인 완료
  - 자식(재고)에 옵션링크가 남아있는 경우 전수 스캔 — 정리 전 2건(GH5·UWP-D21) 발견, 정리 후 재스캔 0건 확인
  - 옵션이 가리키는 option_product_id가 삭제·존재하지 않는 dangling reference 전수 스캔 — 0건 (RPC가 조용히
    누락시키는 항목 없음 확인)
  - 결론: 점검 시점 기준 Production 전체에 옵션상품 노출 관련 결함 0건

- [x] DATA-CLEANUP-ORPHAN-OPTIONS: 자식(재고)에 남은 오배치 옵션 데이터 정리 | BOUNDARY | ✅ 완료 (2026-07-27, Stephen 승인)
  - Stephen 확인: "네, 삭제해주세요" — soft-delete(`deleted_at = now()`) 처리
  - 대상 4건:
    · 자식 `48729961-fc70-4346-bbf6-a348572a0117`(GH5) → option_product_id `9fb5cb80...`(Panasonic DMW-XLR1),
      `8a577ba1...`(부모 자기 자신을 옵션으로 참조하던 이상 데이터)
    · 자식 `221edf93-7bda-4710-bae9-0e6774a81acc`(UWP-D21) → option_product_id `ed39edc1...`, `88cf7430...`
  - 부모 옵션 데이터·고객 화면에는 영향 없음(자식 데이터는 애초에 비노출 상태였음) — 정리 후 라이브 화면
    재확인 불필요(변경 전부터 부모 기준으로 정상 노출 중이었음)

관련 파일: 없음 (코드 변경 없음, DB 데이터 조회·정리만 수행)

⏳ QA: sp3-qa-agent 검수 예정

---

## NOW — 예약신청 배송충돌 토스트 오탐 버그 수정 (2026-07-27) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 신고 기반)
핵심제약:
  - Production DB 데이터 직접 수정 금지 (Stephen이 직접 처리 예정 — 매핑만 문서화)
  - 코드 수정은 안전한 기본값(양성 오판 방지) 원칙으로 진행

신고 내용: 상품상세 화면에서 "배송대여 불가" 옵션 선택 → "방문" 선택 → 예약신청 실행 시
  "선택한 옵션상품은 배송이 불가능합니다." 경고 토스트가 여전히 잘못 노출됨

수정 파일:
  - src/routes/products/[id]/+page.svelte ← handleReserve() 배송충돌 판정 로직 수정

- [x] BUG-DELIVERY-TOAST-FALSEPOSITIVE: 방문 선택 시에도 배송충돌 경고 오탐 | CRITICAL FIX | ✅ 완료 (2026-07-27)
  - 원인: `isDeliveryMethod = !!selectedMethod && selectedMethod.method_key !== 'visit'` — "배송 아님(visit)"만
    제외하고 나머지는 전부 배송으로 간주하는 음성 배제 방식이었는데, Production DB `rental_method_options`의
    "방문"(f1947845...) 행이 `method_key = null`로 미설정 상태 → `null !== 'visit'` → true로 오판정되어
    방문 선택임에도 배송충돌 경고가 발동함
  - Stage DB는 전부 method_key 정상 세팅(visit/crazydelivery/quick/locker/epost) → 이 버그가 안 보였던 이유
  - Production DB 확인 결과: 7개 수령방식 중 `무인보관함`(locker)·`택배`(epost) 2개만 method_key 설정,
    `크레이지배송(택배)`·`방문`·`방문(무인보관함)`·`퀵서비스`·`크레이지배송(자체배송)` 5개는 전부 null
  - 수정: 판정 방식을 양성 확인(positive match)으로 전환 —
    `DELIVERY_METHOD_KEYS = {crazydelivery, quick, locker, epost}`에 속할 때만 배송으로 간주,
    method_key가 null/미지값이면 배송 아님으로 안전하게 처리(오탐 방지 우선)
  - 부수 효과 확인: 이 수정으로 `method_key`가 null인 방식(방문·퀵서비스·크레이지배송 등) 선택 시
    배송충돌 검증 자체가 발동하지 않게 됨(안전한 방향의 공백) — Production method_key 백필 전까지는
    실제 배송+배송불가옵션 조합에 대한 진짜 충돌 경고도 발동하지 않는 상태
  - 동일 원인으로 이전 세션에서 고친 `p_pickup_method: selectedMethod?.method_key ?? 'visit'`도
    method_key가 null인 방식 선택 시 전부 'visit'로 저장되는 동일한 잠재 문제 있음 — 코드 추가 수정 없이
    Production 데이터 백필로 해결 예정(아래 참조)

⚠️ Stephen 직접 처리 예정 — Production `rental_method_options.method_key` 백필 매핑 (본인 확인·직접 진행 희망):
  - 방문(f1947845-c42c-41dc-a3a2-97985289e2d9) → 'visit'
  - 퀵서비스(364a30d9-cac9-4715-ab57-31368ad212a7) → 'quick'
  - 크레이지배송(택배)(4e23b9ba-8c8a-4a3d-8d36-bcd17bf144fd) → 'crazydelivery'
  - 크레이지배송(자체배송)(ec4cf0be-da5f-4990-842f-7a157cc076df) → 'crazydelivery' (Stephen 확인: 둘 다 동일 처리)
  - 방문(무인보관함)(f00c8c04-fca6-4c10-9034-21cb8a301a72) → 'locker' (Stephen 확인: 무인보관함 계열로 처리)
  - 백필 완료 시 별도 코드 수정 없이 배송충돌 검증·pickup_method 저장 양쪽 다 자동으로 정상 작동

- [x] VERIFY-RENAME-SAFETY: 설정(/cms/set/rental) 대여방식 명칭 수정 시 판정 로직 영향 재검증 | ROUTINE | ✅ 완료 (2026-07-27, 코드 변경 없음)
  - Stephen 우려: 상품별 대여방식 노출은 /cms/set/rental '대여방식 옵션' 목록을 참조하는 방식인데,
    이 목록에서 명칭을 수정하면 방금 고친 배송충돌 판정 로직이 재작동 문제를 일으키지 않는지 확인 요청
  - 검증 결과: 문제 없음 (영향 없음 확정)
    1. 판정 로직(+page.svelte handleReserve)은 `id`로 찾은 뒤 `.method_key`만 비교 — `name` 미참조
    2. 상품별 노출(`allowed_method_ids`)도 `id` 참조 방식이라 이름이 바뀌어도 연결 안 끊김
    3. DB `upsert_rental_method_option(p_id, p_name, p_display_order)` RPC 정의 직접 확인 —
       업데이트 시에도 `SET name = p_name, display_order = p_display_order`만 실행, method_key는
       이 RPC 어디에도 없어 물리적으로 변경 불가능한 구조
    4. 참고로 확인된 사실: `/cms/set/rental` 화면에는 대여방식 명칭 수정 기능 자체가 현재 없음
       (추가/삭제/순서변경만 존재, 목록 항목은 읽기전용 텍스트) — 향후 추가되어도 위 구조상 안전

svelte-check: 신규 ERROR 0건

⏳ QA: sp3-qa-agent 검수 예정

---

## NOW — /cms/set/rental 대여방식 method_key 선택 UI 구현 (2026-07-27) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 직접 요청)
등급: 🟡 BOUNDARY (CMS 설정 UI + RPC 확장)
핵심제약:
  - 기존 `rental_method_options.method_key` 컬럼 이미 존재 (Migration #156) — 컬럼 추가 불필요
  - RPC `upsert_rental_method_option` 파라미터 확장 필요 (Migration #175)
  - 유니크 부분 인덱스 (method_key IS NOT NULL AND deleted_at IS NULL) → 중복 키 선택 UI 차단 필요
  - Stage/Production DB 데이터 상이 (Stage: epost, Production: 5종 완전 세팅)
  - 마이그레이션 순서 준수: Stage(ezyvffjvuwmtuhpxdjrw) → Production(vnbpmvxruyciuuaermyh)

수정 파일:
  - supabase/migrations/20260727000175_175_add_method_key_to_upsert_rpc.sql (NEW)
  - src/routes/cms/set/rental/+page.server.ts (MODIFY)
  - src/routes/cms/set/rental/+page.svelte (MODIFY)

- [x] MIGRATION-175: upsert_rental_method_option RPC p_method_key TEXT DEFAULT NULL 파라미터 추가 | BOUNDARY | ✅ 완료 (2026-07-27)
  - INSERT 시: `INSERT INTO rental_method_options (name, display_order, method_key) VALUES (..., p_method_key)`
  - UPDATE 시: `method_key = COALESCE(p_method_key, method_key)` (기존 값 보존)
  - 빈 문자열 → NULL 자동 처리
  - 이전 시그니처(3인자) + 신규 시그니처(4인자) 양쪽 GRANT 부여
  - Stage 적용 ✅ → Production 적용 ✅ (Stephen 명시 승인 후)

- [x] SERVER-METHOD-KEY: +page.server.ts RentalMethodOption 인터페이스 + addMethod 액션 확장 | BOUNDARY | ✅ 완료 (2026-07-27)
  - `RentalMethodOption` 인터페이스: `method_key: string | null` 필드 추가
  - select 쿼리: `'id, name, method_key, display_order, is_active'` 포함
  - `addMethod` 액션: `data.get('method_key')?.trim() || null` 파싱 → RPC 전달

- [x] UI-METHOD-KEY-CHIPS: +page.svelte 대여방식 추가 폼에 method_key 콤보칩 선택 UI 추가 | BOUNDARY | ✅ 완료 (2026-07-27)
  - METHOD_KEYS 상수 (5종): visit/quick/delivery/locker/crazydelivery + 각 label·desc
  - METHOD_KEY_LABELS 맵: epost → '택배(구)' 포함 (Stage DB 레거시 값 대응)
  - `let methodKey = $state('')` + `let usedMethodKeys = $derived(...)` 
  - 기사용 키 → chip disabled + opacity 0.45 (중복 방지)
  - 선택 키 → `<input type="hidden" name="method_key">` 전달
  - 기존 방식 목록: method_key 있으면 배지(METHOD_KEY_LABELS 변환) 표시
  - 브라우저 검증: Production 5개 방식 배지 정상(방문/크레이지배송/퀵/무인/택배(구)) + 사용 칩 비활성 확인

svelte-check: 신규 ERROR 0건 (기존 경고 1건 — 관련 없는 products page unused CSS selector)

sp3-qa-agent GATE C 검수 결과 (2026-07-27): ✅ 통과 (이전 세션 산출물)

---

## NOW — rental_method_options method_key 구조 재검증 + Production 백필 (2026-07-27) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 신고 기반, 배송충돌 토스트 오탐 후속 조사)
핵심제약:
  - Production DB 직접 수정 — 매 단계 Stephen 확인 후 진행
  - 체크아웃(/checkout) 코드는 이번 세션 범위 밖 — 발견한 위험만 보고, 수정은 별도 확인 후

배경: 직전 세션에서 고친 "배송충돌 토스트 오탐"(방문 선택 시에도 경고) 버그의 근본 원인이
  Production `rental_method_options.method_key` 미설정이었음 — 그 후속으로 Stephen이
  "설정(/cms/set/rental)에서 대여방식 이름 수정·삭제 시 예약신청 판정이 깨지지 않는지" 재검증 요청

- [x] VERIFY-RENAME-SAFE: 설정 화면 이름수정이 method_key·판정로직에 영향 없음 확인 | ROUTINE | ✅ 완료 (2026-07-27)
  - 예약신청 판정 로직은 `name`을 전혀 읽지 않고 `id`로 조회 후 `method_key`만 비교 — 이름 변경 무관
  - `upsert_rental_method_option` RPC 정의 직접 확인: 파라미터 `(p_id, p_name, p_display_order)` — method_key
    컬럼은 어떤 경로로도 이 RPC가 건드리지 않음(업데이트 시에도 `SET name=.., display_order=..`만 실행)
  - 참고로 확인된 사실: `/cms/set/rental` 대여방식 목록에는 현재 "이름 수정" UI 자체가 없음(추가·삭제·순서변경만
    존재, 목록 항목은 읽기전용 텍스트) — 질문하신 시나리오는 현재 코드로는 애초에 발생 불가능한 상황이었음

- [x] VERIFY-DELETE-SAFE: 대여방식 옵션 삭제 시 상품 연결 깨짐 여부 확인 | ROUTINE | ✅ 완료 (2026-07-27)
  - `deleteMethod` 액션은 삭제 전 `check_rental_method_option_in_use` RPC로 해당 방식을 사용 중인 상품이
    하나라도 있으면(`allowed_method_ids @> ARRAY[id]`) 삭제 자체를 차단(409) — 사용 중인 항목은 삭제 불가능
    → 상품상세·CMS 패널에서 "갑자기 사라지는" 상황 발생 안 함

- [x] BUG-STRUCTURAL-NEW-METHOD-KEY-GAP: CMS로 신규 대여방식 추가 시 method_key 영구 미설정 구조 확인 | CRITICAL | ✅ 완료 (2026-07-27, 확인·데이터로 해소)
  - `addMethod` 액션/RPC 어디에도 `method_key` 입력 경로가 없어, CMS에서 새로 "추가"하는 대여방식은
    영구히 `method_key = null` → 예약신청 배송충돌 판정 및 체크아웃 배송비 판정에서 계속 누락되는 구조적 공백
  - Stephen 확인: "5종 범위 안에서만 운영" (크레이지배송×2 변형·방문·무인보관함·퀵서비스) — 신규 임의
    확장 없음, 기존 5개만 method_key 백필하면 됨으로 확정

- [x] DATA-BACKFILL-METHOD-KEY: Production rental_method_options.method_key 5건 백필 | CRITICAL | ✅ 완료 (2026-07-27, Stephen 승인)
  - 조사 중 발견: 이전에 이미 soft-delete된 항목 2개("방문(무인보관함)", "택배")가 최초 감사 쿼리에 섞여
    들어와 있었음(`deleted_at` 필터 누락) → 재조사로 실제 활성 대여방식은 정확히 5개임을 확인
  - UNIQUE 제약 발견: `rental_method_options_method_key_active_unique` — 활성 상태에서 동일 method_key
    중복 불가(partial unique index `WHERE deleted_at IS NULL`) → "크레이지배송" 2개를 둘 다 `crazydelivery`로
    설정하려던 최초 계획이 DB 제약 위반으로 즉시 실패, Stephen 재확인 거쳐 최종 매핑 확정
  - 최종 반영 완료 (Production, ezyvffjvuwmtuhpxdjrw 대상 아님 — vnbpmvxruyciuuaermyh):
    · 방문(f1947845...) → `visit`
    · 무인보관함(667d6caf...) → `locker` (기존 값 유지)
    · 퀵서비스(364a30d9...) → `quick`
    · 크레이지배송(택배)(4e23b9ba...) → `delivery` (Stephen 지정 — 기존 5종 코드 상수에 없던 신규 값)
    · 크레이지배송(자체배송)(ec4cf0be...) → `crazydelivery`
  - 코드 후속 수정: `src/routes/products/[id]/+page.svelte`의 `DELIVERY_METHOD_KEYS`에 `'delivery'` 추가
    (Stephen이 'delivery'를 지정하면서 배송판정 상수 4종 → 5종으로 확장 필요해짐)

⚠️ Stephen 확인 필요 — 체크아웃 화면 동일 위험 (수정 안 함, 이번 세션 범위 밖):
  - `src/routes/checkout/+page.svelte:21` `type DeliveryMethod = 'crazydelivery' | 'quick' | 'locker' | 'visit' | 'epost'`
    에도 `'delivery'`가 없음 — 고객이 체크아웃에서 "크레이지배송(택배)" 선택 시 `method_key === method` 매칭
    실패로 배송비 조회가 안 될 가능성 있음. 체크아웃도 함께 수정할지 Stephen 확인 후 별도 진행 필요.

관련 파일: src/routes/products/[id]/+page.svelte (DELIVERY_METHOD_KEYS 상수 1건 수정)
관련 DB: Production(vnbpmvxruyciuuaermyh) rental_method_options.method_key 5건 UPDATE (마이그레이션 파일 없음 — MCP 직접 실행)

svelte-check: 신규 ERROR 0건

sp3-qa-agent GATE C 검수 결과 (2026-07-27): ✅ 통과
  - 실제 코드 변경분(DELIVERY_METHOD_KEYS 'delivery' 1건 추가)만 정확히 범위 확정 후 검수 —
    이전 세션 산출물(체크아웃 마스터-디테일 리팩터 등 별도 미커밋 작업)과 명확히 분리 확인
  - isDeliveryMethod 판정 로직 회귀 없음(기존 4개 값 보존 + 신규 1개만 추가)
  - checkout/+page.svelte에 실제로 손댄 흔적 없음(범위 준수 재확인) — 'delivery' 누락 위험은
    TASK.md 대기 항목으로만 남아있고 코드는 미수정 상태임을 diff로 직접 확인
  - 참고: QA agent 세션엔 Supabase MCP가 없어 Production DB 실측 대조는 못 했으나(문서 기반 판정),
    본 세션에서 직접 쿼리로 이미 실측 확인된 값과 일치함(방문→visit·무인보관함→locker·퀵서비스→quick·
    크레이지배송(택배)→delivery·크레이지배송(자체배송)→crazydelivery)
  - GATE E 통과, 커밋 허가

---

## NOW — CMS 계약서 탭 편집 제한 정책 + PDF 뷰어 조건 보강 (2026-07-27) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 직접 요청)
등급: 🟡 BOUNDARY (CMS 계약서 탭 UI 제어)

수정 배경:
  - 계약서 발송 또는 서명 완료 이후에도 편집 버튼이 표시되어 내용 변경 혼란 가능성
  - 서명 전 PDF 미리보기 뷰어가 빈 상태로 렌더링되는 불필요 UI 존재
  - rental-lifecycle.md에 편집 제한 정책이 누락되어 있었음

수정 파일:
  - src/lib/components/cms/RentalContractViewer.svelte (MODIFY)
  - .claude/rules/rental-lifecycle.md (MODIFY — 정책 문서 보강, v1.2)

- [x] CONTRACT-EDIT-RESTRICT: 편집 버튼 조건 강화 | BOUNDARY | ✅ 완료 (2026-07-27)
  - 기존: `{#if !customerSignedAt}` — 서명 미완료 상태에서도 발송 후 편집 가능
  - 수정: `{#if !signingsentAt && !customerSignedAt}` — 발송(signingsentAt 있음) 또는 서명 완료(customerSignedAt 있음) 시 편집 버튼 숨김
  - 미리보기 & 발송 버튼은 모든 상태에서 항상 유지 (재발송 용도)

- [x] PDF-SIGNED-ONLY: PDF 뷰어·다운로드 서명 완료 후에만 표시 | BOUNDARY | ✅ 완료 (2026-07-27)
  - 기존: contractPdfUrl 존재 시 항상 표시 (서명 전 빈 뷰어 렌더링)
  - 수정: `{#if contractPdfUrl && customerSignedAt}` — 서명된 최종본만 PDF 뷰어·다운로드 표시
  - 서명 링크 확인 ↗: `{#if signingUrl && !customerSignedAt}` — 서명 완료 후 자동 숨김 (기존 동일)
  - 대여중·반출중·반납중 상태도 customerSignedAt 있으면 PDF 표시 — 상태 무관, 서명 완료 여부만 체크

- [x] RENTAL-LIFECYCLE-POLICY-UPDATE: rental-lifecycle.md 편집 제한 정책 반영 | ROUTINE | ✅ 완료 (2026-07-27)
  - "전자계약 발송 흐름" 섹션 내 "계약서 양식 편집 제한 정책 (2026-07-23 확정)" 서브섹션 추가
  - 편집/미리보기/PDF/서명링크 각 표시 조건 명시
  - 구현 코드 스니펫 포함
  - GATE C 체크리스트 4개 항목 추가
  - 버전 v1.1 → v1.2

svelte-check: 신규 ERROR 0건

sp3-qa-agent GATE C 검수 결과 (2026-07-27): ✅ 통과
  - 편집 버튼 조건(`!signingsentAt && !customerSignedAt`) 정확히 구현 — PASS
  - 미리보기 & 발송 버튼 조건 없이 항상 렌더링 — PASS
  - PDF 뷰어·다운로드 조건(`contractPdfUrl && customerSignedAt`) 정확히 구현 — PASS
  - 서명 링크 조건(`signingUrl && !customerSignedAt`) 정확히 구현 — PASS
  - Svelte 5 Runes 문법 준수, any 타입 0건, CSS Variables 사용 — PASS
  - BLOCKING 이슈 없음 / Dead CSS 5개 선택자 경고 (비기능, 기존 잔류 스타일)
    → .pdf-placeholder / .pdf-placeholder p (272-281행)
    → .btn-action / :hover / :disabled (290-306행) — 다음 유지보수 커밋 정리 권장
  - GATE E 통과, 커밋 허가

---

## NOW — 고객용 전자계약 서명 화면(/contract/[token]) 버그픽스 + UI 개선 (2026-07-28) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 직접 요청 — 채팅 '전자계약 확인' 버튼 진입 화면)
등급: 🟡 BOUNDARY (고객용 단일 화면 UI + 버그픽스, DB 마이그레이션 없음)
핵심제약:
  - 요청 범위 외 수정 없음 (해당 페이지 + 공용 SignatureCanvas 컴포넌트만)
  - Svelte 5 Runes 문법 준수
  - CMS 반영 여부는 코드 조사 우선 → 실제 결함 있을 때만 수정

수정 배경:
  - Stephen이 실기기 스크린샷으로 신고: 타이틀 텍스트 오기, "계약서 문서를 불러오는 중입니다" 무한 로딩,
    예약자 정보 노출 부재, 서명 가이드 텍스트 중복
  - 근본 원인 조사(Explore 없이 직접 grep): `contracts.document_url` 컬럼이 코드베이스 전체에서
    한 번도 SET된 적 없는 필드로 확인 — PDF 생성 파이프라인 자체가 미구현 상태라 이 필드를 기다리는
    한 항상 로딩 문구에서 멈춤. CMS 발송 시점(`ContractTemplatePreviewModal.send()`)에 이미
    변수 치환 완료된 `contracts.content_blocks`가 저장되고 있음을 확인 → 이를 직접 렌더링하는
    방식으로 전환(document_url iframe 방식 폐기)

신규/수정 파일:
  - src/routes/contract/[token]/+page.server.ts (MODIFY) — contracts 셀렉트에 title·content_blocks·
    specifications 추가, rental_reservations에 reservation_code 추가, user_profiles(고객 이름·전화번호·
    이메일) 별도 조회 추가
  - src/routes/contract/[token]/+page.svelte (MODIFY) — 타이틀 텍스트 변경, 헤더 요약카드에 예약코드·
    예약자·전화번호·이메일 행 추가, document_url iframe 섹션 → content_blocks 렌더링(doc-section)으로
    전면 교체, 서명 가이드 문구("아래 칸에 직접 서명해 주세요") 제거, 관련 CSS 교체
  - src/lib/components/common/SignatureCanvas.svelte (MODIFY) — sig-hint 3단계 분기("여기에
    서명하세요" / "조금 더 서명해 주세요 (n/3)" / "서명 완료") → 2단계로 단순화(스트로크 카운트 문구 제거)
    · grep으로 이 컴포넌트의 유일한 사용처가 해당 계약서 화면임을 확인 후 안전하게 공용 컴포넌트 수정

- [x] TITLE-CHANGE: "전자 대여 계약서" → "크레이지샷 상품대여 전자계약서" | ROUTINE | ✅ 완료 (2026-07-28)

- [x] BUG-DOC-LOAD: 계약서 문서 무한 로딩 버그 수정 | BOUNDARY | ✅ 완료 (2026-07-28)
  - 원인: document_url 컬럼이 애플리케이션 전체에서 한 번도 write되지 않음 (PDF 생성 로직 미구현)
  - 수정: content_blocks(발송 시점 변수 치환 완료본)를 CMS ContractTemplatePreviewModal과 동일한
    렌더링 패턴(text/html/divider 블록 타입 분기)으로 직접 표시
  - 실브라우저 검증: 로컬 dev + Stage DB(ezyvffjvuwmtuhpxdjrw) 실제 미서명 토큰으로 계약 본문
    정상 렌더링 확인 (표준 계약서 템플릿, 성명·연락처·이메일·주소·예약코드 등 치환값 정상 표시)

- [x] FEAT-HEADER-INFO: 헤더 요약카드에 예약코드 + 예약자 정보(이름·전화번호·이메일) 노출 | BOUNDARY | ✅ 완료 (2026-07-28)
  - +page.server.ts에서 user_profiles(full_name, phone, email) 서버사이드 별도 조회 (service_role,
    RLS 우회 — 계약 서명은 비로그인/토큰 기반 접근이라 CMS 인증 경로 재사용 불가)

- [x] VERIFY-CMS-SYNC: 서명 완료 시 CMS 예약목록 "서명완료" 반영 여부 검증 | ROUTINE | ✅ 검증 완료, 코드 수정 없음 (2026-07-28)
  - 조사 결과: /api/contracts/[token]/sign가 `contract_signings.signed_at` UPDATE →
    `get_rental_list` RPC가 `cs.signed_at AS customer_signed_at`로 조인 →
    `/cms/reservation/+page.svelte`의 `contractBadge()`가 이 값으로 "서명완료" 배지 표시
  - 이미 정상 연결되어 있어 코드 수정 불필요 — Supabase MCP로 Stage DB 직접 쿼리하여 실증:
    실제 서명 실행(reservation_id=32, CSREV260700015) 후 contract_signings.signed_at 기록 확인 +
    get_rental_list RPC 결과에 customer_signed_at 정상 반영 확인
  - ⚠️ 부작용: 위 검증을 위해 Stage DB의 실제 테스트 예약 건(reservation_id 32)에 실제 서명 완료
    처리가 발생함 (테스트/스테이지 데이터, Stephen에게 세션 중 고지 완료)

- [x] UI-CLEANUP: 불필요 서명 안내 텍스트 제거 | ROUTINE | ✅ 완료 (2026-07-28)
  - "아래 칸에 직접 서명해 주세요" (+page.svelte sig-guide) 완전 제거
  - "조금 더 서명해 주세요 (n/3)" (SignatureCanvas.svelte sig-hint 중간 분기) 제거 — "여기에
    서명하세요"는 유지 요청대로 존치

svelte-check: 수정 3개 파일 기준 신규 ERROR 0건 (기존 무관 파일 에러(account/profile RPC 타입)만 잔존)

실브라우저 검증(로컬 dev + Stage DB): 계약 화면 헤더정보 렌더링 → 계약본문 표시 → 체크박스 동의 →
서명 캔버스 3획 서명 → 제출 → /contract/complete 리다이렉트 → DB signed_at 기록 → get_rental_list
customer_signed_at 반영까지 전체 플로우 1회 실측 완료

sp3-qa-agent GATE C 검수 결과 (2026-07-28): ✅ 통과
  - 범위 정합성: git diff 대상 3개 파일 외 요청 외 로직 변경 없음 확인 (워킹트리의 다른 미커밋 변경은
    이번 세션 범위 밖이라 판정 제외 — 커밋 시 대상 파일 명시적 스테이징 필요)
  - 요청 5개 항목 전부 코드 레벨 재검증 완료 — 5/5 PASS (타이틀 문구 / document_url 무한로딩 원인·수정 /
    헤더 예약코드·예약자 정보 / CMS 서명완료 배지 반영 경로 / 불필요 문구 제거)
  - svelte-check: git stash 전후 비교로 신규 ERROR 0건 재확인 (기존 11 errors는 무관 파일 그대로)
  - 보안: SUPABASE_SERVICE_ROLE_KEY는 $env/static/private 전용 유지, RLS 우회는 기존에도 있던 익명
    토큰 접근 구조(신규 도입 아님), 교차 고객 정보 노출 없음(토큰 소유자=예약 당사자 본인 정보만)
  - {@html} content_blocks 렌더링: CMS 관리자만 작성 가능한 기존 신뢰 경계를 고객 화면까지 연장한 것 —
    "CMS 계정 침해 시 고객 브라우저 스크립트 실행 가능"이라는 공격표면 확대 소지는 있으나 CMS 계정 자체가
    이미 전체 서비스 신뢰 주체 수준이라 추가 승인 없이 진행 가능한 리스크로 판단 (Stephen 인지 필요, blocking 아님)
  - BLOCKING 이슈 없음 / 참고 2건(non-blocking, 백로그 권장):
    → doc-block :global(table.cs-contract-table) 색상 하드코딩(#DDDDDD/#f6f6f6/#666) — CMS
      ContractTemplatePreviewModal.svelte 동일 패턴 답습, 양쪽 CSS 변수화 권장
    → +page.server.ts specifications select 추가했으나 화면 미사용 (죽은 페치, 필요 없으면 제거)
  - GATE E 통과, 커밋 허가 (단, 워킹트리의 이번 세션 범위 외 변경분은 Stephen이 별도 판단 후 스테이징)

---

## NOW — /checkout 렌탈정보 미반영 + 옵션상품 미노출 버그픽스 (2026-07-28) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 직접 요청)
등급: 🔴 CRITICAL (예약 흐름 다중 파일 + DB 마이그레이션) — AskUserQuestion으로 두 버그 각각
수정범위(전체 수정 vs 부분 보류) 서비스 의도 확인 후 진행 (두 항목 모두 "전체 수정" 선택)

수정 배경 (Explore 에이전트 근본원인 조사 결과):
  - 버그1: 상품상세에서 선택한 대여시간·대여기간(12h/24h)·수령/반납방식이 체크아웃에 반영 안 됨
    → 시간·수령방식은 DB에 저장은 되나 체크아웃 서버 쿼리가 컬럼을 조회하지 않았고,
      대여기간(duration_type)은 Migration 154에서 컬럼만 추가된 후 실제로 쓰인 적이 없었으며,
      반납방식(return_method)은 애초에 RPC 호출 시 파라미터 자체가 누락되어 있었음
  - 버그2: 상품상세에서 선택한 옵션상품+수량이 체크아웃 카드에 전혀 노출 안 됨
    → 저장할 DB 테이블 자체가 존재하지 않아 예약 신청 시점에 선택값이 그대로 버려지고 있었음
      (신규 테이블+RPC 필요 — 부분 수정 불가능한 근본 원인)

신규/수정 파일:
  - supabase/migrations/20260728000176_176_reservation_duration_and_options.sql ← 신규
    (set_reservation_duration RPC + reservation_options 테이블·RLS·set_reservation_options RPC)
  - src/routes/products/[id]/+page.svelte ← handleReserve(): return_method 파라미터 추가,
    실제 선택 시간 기준 duration_type(12h/24h) 계산 후 저장, 선택된 옵션상품+수량 저장 호출 추가
  - src/routes/checkout/+page.server.ts ← rental_reservations select에 pickup_method·
    return_method·pickup_time·return_time·duration_type 추가, reservation_options 병렬 조회 +
    reservationId별 그룹핑, CartLineItem에 5개 필드 + options 배열 추가
  - src/routes/checkout/+page.svelte ← CartLineItem 타입 확장, newItemState()에 seed 파라미터
    추가(toDeliveryMethod/toDurationType 안전 매핑 헬�터), 신규 카드 생성 시 서버 저장값으로
    durType/opts.rentalMethod/opts.returnMethod/rentalTime/returnTime 시딩, OrderCard·
    ItemListCard에 옵션상품 목록(이름×수량) 렌더링 추가

- [x] BUG-1: 체크아웃 렌탈정보(시간·기간·수령방식) 미반영 수정 | CRITICAL | ✅ 완료 (2026-07-28)
  - set_reservation_shipment_method 호출에 p_return_method 추가 (기존 pickup만 전달되던 것 수정)
  - 상품상세 CalendarTimePicker의 estimatedFee와 동일 판정 기준(당일 12시간 이하→12h, 그 외→24h)으로
    duration_type 계산 후 신규 RPC(set_reservation_duration)로 저장
  - checkout 서버 쿼리 확장 + 신규 카드 시딩 시 하드코딩 기본값('24h'/'crazydelivery') 대신
    실제 저장값 사용 (기존 로컬 UI 편집 상태가 있는 카드는 건드리지 않음 — prev.find 우선순위 유지)
  - toDeliveryMethod(): 알 수 없는 method_key(예: 별도 이슈로 남아있는 'delivery' 값)는 기존
    기본값으로 안전 폴백 — 체크아웃 DeliveryMethod enum 자체 확장은 이번 요청 범위 밖이라 손대지 않음

- [x] BUG-2: 옵션상품+수량 체크아웃 미노출 수정 | CRITICAL | ✅ 완료 (2026-07-28)
  - Migration 176: reservation_options 테이블 신규(RLS 본인 예약만 SELECT) +
    set_reservation_options RPC(SECURITY DEFINER, hold 상태 본인 예약만 저장 허용, H-01 준수)
  - 상품상세 handleReserve(): qty>0인 옵션만 배열로 변환해 예약 생성 직후 저장
  - checkout 서버: reservationId 목록으로 reservation_options 병렬 조회 후 그룹핑
  - OrderCard(모바일 풀카드)·ItemListCard(PC 목록행) 양쪽에 "이름 × 수량" 표시 추가
  - 범위 제한: 표시만 구현 — 옵션 금액을 calculate_cart_total/결제 총액에 반영하는 것은
    이번 요청(표시 버그) 범위 밖이라 미포함. 결제 총액 산정에도 반영이 필요하면 별도 확인 필요

DB 적용:
  - Migration #176 — Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅
    (양쪽 적용 후 테이블·RLS·RPC 존재 실측 확인 완료, 2026-07-28)

svelte-check: 신규 ERROR 0건 (기존 11 errors 그대로 — account/profile RPC 타입 무관 이슈,
products/search noCatIcons 등 전부 이번 세션과 무관 파일)

⚠️ 미검증 항목 (Claude Browser 사용 금지 규칙으로 인해 실브라우저 확인 불가):
  - 실제 상품상세 → 예약신청 → 체크아웃 화면에서 시간·기간·수령방식·옵션상품이 화면에
    정확히 표시되는지는 Stephen의 실기기/로컬 dev 서버 확인 필요
  - RPC는 Stage에서 SQL 직접 호출로 문법·무오류만 확인 (auth.uid() 기반 소유권 체크는
    실제 로그인 세션에서만 검증 가능 — service_role 직접 호출로는 재현 불가)

⏳ QA: sp3-qa-agent 검수 권장 (Stephen 실기기 확인과 별도로)

추가 수정 (동일 세션 연속 요청, 2026-07-28 — Stephen이 launch-selected-element로 직접 지목):

- [x] BUG-3: 체크아웃 '수령 방식'·'반납 방식' 콤보 버튼 UI 미노출 | BOUNDARY | ✅ 완료 (2026-07-28)
  - 증상: 대여 방법/반납 방법 아코디언을 펼치면 선택 가능한 배송방식 콤보 버튼이 하나도 안 보임
    (아코디언 헤더의 현재값 라벨은 정상 표시 — 바로 위 BUG-1 수정분)
  - 근본원인(Stage DB 직접 조회로 실측 확인): rental_reservations.product_id는 예약 시 배정된
    자식 재고 유닛 UUID인데, 대여방식(allowed_method_ids) 정책은 CMS 대여정책 탭에서 부모
    상품에만 설정됨 — 자식 자신의 allowed_method_ids는 항상 빈 배열([])이 기본값.
    checkout의 computeAllowedMethodIds()가 이 빈 배열을 "명시적으로 0개 방식만 허용"으로
    해석해 'none' 반환 → 콤보 버튼 0개 렌더링 (products.md §5 정책과 동일한 부모/자식 소싱 문제,
    CMS ProductDetailPanel의 TASK-CMS-CHILD-DATA-MIRROR와 같은 계열 버그)
  - 수정: src/routes/checkout/+page.server.ts — products 쿼리에 parent_product_id 추가,
    자식의 allowed_method_ids가 비어있으면 부모 상품 행을 추가 조회해 그 값으로 대체
  - 효과: 수령 방식·반납 방식 콤보 버튼 둘 다 동일한 deliveryTabs를 쓰므로 한 번의 수정으로
    양쪽 다 상품상세화면과 동일한 전체 옵션 목록이 노출됨

- [x] CHECK-1: 콤보 버튼 UI 하드코딩 여부 확인 | ROUTINE | ✅ 확인 완료, 코드 수정 없음 (2026-07-28)
  - 콤보 버튼 자체(라벨·요금·마감정보)는 100% data.deliveryOptions(CMS rental_method_options
    실시간 조회 결과)에서만 렌더링됨 — CMS 목록에 없는 방식이 버튼으로 노출되는 경우 없음 확인
  - 단, 콤보 버튼과는 별개 위치인 아코디언 헤더의 현재값 라벨(methodLabel())은 CMS 조회값이
    아닌 파일 내 하드코딩 DELIVERY_LABELS 맵을 사용 — 기존에 이미 알려진 별도 이슈(TASK.md
    2026-07-27 항목 "체크아웃 화면 동일 위험" 참고, 'delivery' 키 누락)와 동일 지점이며
    이번 요청 범위(콤보 버튼) 밖이라 미수정. deliveryFee()의 하드코딩 폴백(3500원)도 CMS
    데이터가 비어있을 때만 쓰이는 방어값이라 동일하게 미수정.

svelte-check: 신규 ERROR 0건 (기존 11 errors 그대로)

추가 재검증 (Stephen이 CHECK-1 결과에 재이의 제기, 2026-07-28):
  - Stephen이 "대여 방법" 아코디언 헤더 값("직접방문")이 CMS 설정값과 다른 것 같다고 재확인 요청
  - Stage DB 직접 조회로 실측: rental_method_options에 method_key='visit' 행의 name 컬럼은
    "방문대여"(콤보 버튼에 정확히 이렇게 표시됨) — 그런데 아코디언 헤더는 "직접방문"으로 표시됨
  - 확인 결과 CHECK-1에서 "범위 밖"으로 넘겼던 DELIVERY_LABELS 하드코딩 맵이 실제로 헤더 값과
    콤보 버튼 값을 서로 다르게 만드는 육안 확인 가능한 불일치였음 — 이번 세션에서 함께 수정

- [x] BUG-4: 아코디언 헤더 대여방식 라벨 하드코딩 → CMS 값 사용으로 수정 | BOUNDARY | ✅ 완료 (2026-07-28)
  - src/routes/checkout/+page.svelte methodLabel(): DELIVERY_LABELS 하드코딩 맵 직접 반환 →
    sdDeliveryOpts(CMS rental_method_options 실시간 조회 결과)에서 method_key로 먼저 찾고,
    CMS에 없을 때만(로딩 지연·미설정 등 방어용) 기존 하드코딩 맵으로 폴백
  - sdDeliveryOpts 타입에 name 필드 추가 (+page.server.ts select에는 이미 포함되어 있었음)
  - 부수효과: 기존에 알려져있던 'delivery' method_key 누락 이슈(TASK.md 2026-07-27 항목)도
    이 수정으로 함께 해소됨 — CMS 이름을 동적으로 찾으므로 더 이상 고정 5개 키에 의존하지 않음
  - 적용 범위: bulkOpts(일괄설정)·item.opts(개별 카드) 6개 호출부 전부 동일 함수 사용이라
    한 번의 수정으로 전체 반영

⚠️ 미해결로 남긴 별도 발견 (이번 요청 범위 밖, Stephen 확인 대기):
  - deliveryFee() 실 결제 금액 계산 버그: rental_method_options.fee_amount 컬럼이 전체 행에서
    0으로 방치되어 있고(실제 금액은 fee_description 텍스트에만 존재), is_free_for_top_grade
    컬럼은 DB엔 있으나 checkout 서버 쿼리가 선택하지 않아 매번 undefined → 크레이지샷배송
    등급별 배송비가 화면 텍스트("3,500원")와 무관하게 항상 0원으로 청구됨. 결제 금액 로직이라
    Stephen 별도 확인 후 진행 필요 (이번 답변에서 확답 못 받음 — 대기 상태로 기록만).

- [x] BUG-5: 콤보 버튼 UI에서 fee_description 텍스트 제거 | ROUTINE | ✅ 완료 (2026-07-28)
  - Stephen 판단: "변경 전 기획의 잔재로 보임" — 콤보 버튼에 표시되던 "무료"/"CRAZY등급 무료 /
    3,500원" 같은 fee_description 텍스트를 완전히 제거
  - src/routes/checkout/+page.svelte: combo-fee span 렌더링 제거 + DeliveryTabMeta.fee 필드·
    DeliveryOptionRow.fee_description 필드·deliveryTabs map의 fee 매핑·.combo-fee CSS(본문+
    반응형) 전부 제거 (죽은 코드 남기지 않음)
  - deadline(마감 정보) 표시는 그대로 유지 — 이번 제거 대상은 fee_description 한정
  - 참고: 바로 위 미해결 항목(deliveryFee 실결제 버그)은 fee_amount/is_free_for_top_grade
    컬럼 기반이라 fee_description 제거와 무관 — 그대로 별도 대기 상태 유지

- [x] BUG-6: 하단 footer 검증 안내 문구("대여 조건에 동의해 주세요." 등) 완전 제거 | ROUTINE | ✅ 완료 (2026-07-28)
  - Stephen이 launch-selected-element로 footer-guide(<p role="alert">) 직접 지목, "불필요 UI 제거" 요청
  - src/routes/checkout/+page.svelte: {#if !canProceed && footerVisible}<p class="footer-guide">
    {proceedGuideMessage()}</p>{/if} 블록 제거
  - proceedGuideMessage() 함수(다른 참조 없음 확인 후 완전 삭제) + .footer-guide CSS 규칙 삭제
  - canProceed 5조건 가드·footer-terms 체크박스·footer-cta 버튼 disabled 로직은 무변경 (안내
    문구만 제거 — 조건 미충족 시 버튼이 비활성 상태로 남는 동작 자체는 그대로 유지)

- [x] BUG-7: 수령/반납 방식 하단 달력·시간 팝업 레이어 가로폭 깨짐 | ROUTINE | ✅ 완료 (2026-07-28)
  - 증상: 날짜/시간 버튼(datetime-btns)을 눌러 열리는 달력·시간 팝업이 상단 바 폭의 절반만
    차지해 달력 7열 그리드가 좁게 눌리고, 배경 뒤 다른 UI(Order items 패널 등)가 겹쳐 비침
  - 원인: src/routes/checkout/+page.svelte .cal-layer·.time-layer가 부모(.datetime-wrap,
    상단 datetime-btns와 폭이 같음)의 50%로 고정되어 있었음 — 반면 공용 컴포넌트
    CalendarGrid.svelte의 .cal-root/.cal-grid(7열)는 항상 100% 폭 기준으로 설계됨
  - 수정: .cal-layer·.time-layer width: 50% → 100%, time-layer는 right:0 → left:0으로 통일
    (달력/시간 팝업은 한 번에 하나만 열리므로 나란히 배치될 필요 없음 — 각각 상단 datetime
    바 전체 폭에 맞춤)
  - CalendarGrid.svelte(공용 컴포넌트)는 무변경 — 컨테이너 폭만 넓혀 기존 100% 그리드 설계가
    의도대로 동작하게 함

- [x] UI-1: 수령/반납일시 버튼 바(datetime-wrap) 상하 패딩 추가 | ROUTINE | ✅ 완료 (2026-07-28)
  - Stephen이 launch-selected-element로 datetime-wrap 직접 지목, 위아래 여백 부족 지적
  - .datetime-wrap: padding: 10px 0 추가 (gap:0은 유지 — 날짜/시간 버튼 사이 간격과 무관)
    → Stephen 후속 요청으로 20px 0으로 값 조정 (동일 세션, 2026-07-28)

- [x] UI-3: 배송 마감시간 안내를 라운드 배지(pill) 스타일로 재작성 | ROUTINE | ✅ 완료 (2026-07-28)
  - Stephen 후속 요청 4건: ① 배경에 매우 옅은 red-5 토큰(--cs-red-xlight) 적용 ② 시계 이모지
    (⏰) 제거 ③ 폰트 토큰 한 단계 위로(--text-m-script-12 → --text-m-script-14B) ④ 상하 패딩
    10px 적용
  - 마크업: {tab.deadline} 앞 "⏰ " 접두 제거
  - CSS: display:inline-block + width:fit-content로 배지 형태화, background:
    var(--cs-red-xlight), border-radius: var(--radius-full)로 라운드 처리, padding: 10px 16px
    (좌우 값은 라운드 배지가 정상적으로 보이도록 기존 파일 내 유사 배지(.price-badge 등) 비율을
    참고해 자체 판단 추가 — 상하 10px만 명시 요청받음, 좌우 없으면 텍스트가 라운드 끝에 붙어
    보여서 임의로 16px 부여함, 조정 필요 시 알려달라고 안내)
  - 글자색은 이번 요청에 포함되지 않아 직전 커밋(UI-2)의 --cs-text-mid 그대로 유지
  - Stephen 후속 요청("가로폭 채움"): display:inline-block+width:fit-content →
    display:block+width:100%+box-sizing:border-box+text-align:center로 변경 (라운드 배지가
    콤보 버튼 줄과 동일한 가로폭을 채우도록, 텍스트는 중앙 정렬)

- [x] UI-4: 개별 상품·일괄설정 "약정 요금" 아코디언 3곳 완전 제거 (중복 판단) | BOUNDARY | ✅ 완료 (2026-07-28)
  - Stephen 판단: 하단 "Order Total"(통합 약정 요금·전체 카트 합산) 섹션에서 어차피 최종
    결제 합계가 노출되므로, 상품 카드별/일괄설정의 개별 "약정 요금" 아코디언(쿠폰 선택 +
    해당 아이템 단위 요금 세부내역)은 중복 기능 — 완전 제거 요청 (개별 카드 3곳 + 일괄설정
    1곳, 총 4개 호출부 전부 동일 FeeContent 스니펫 재사용 중이었음)
  - 확인: 스크린샷의 아코디언 바디 안에 "사용 가능한 쿠폰" + 내부 "약정 요금" 소제목이 다시
    나오는 구조 — 외부 아코디언 헤더 라벨("약정 요금")과 내부 소제목이 중복 표시되고 있었음
  - 제거 대상: bulk-panel의 약정요금 acc-item, OrderCard(모바일)의 약정요금 acc-item,
    ItemDetailPanel(PC)의 약정요금 acc-item — 3개 호출부 + FeeContent 스니펫 정의 자체 삭제
  - 부수 정리(죽은 코드 완전 제거, dead code 미잔존 확인):
    · CardAccordion.fee 필드 제거, AccKey 타입 'fee' 제거 → 'rental'|'return_'만 남김
    · toggleAcc() 함수의 fee 분기 제거 (rental/return_ 2분기로 단순화)
    · newItemState() acc 기본값에서 fee:false 제거
    · .fee-content CSS 규칙 삭제 (FeeContent 전용, 다른 곳 재사용 없음 확인)
  - 유지: CouponRow·PriceRow 스니펫과 .hint-text/.price-detail-list/.price-period-*/
    .period-*/.price-divider/.points-* CSS 전부 — 하단 Order Total 섹션(통합 약정 요금)이
    동일 스니펫·클래스를 그대로 재사용 중이라 삭제하면 통합 섹션이 깨짐 (grep으로 재사용
    여부 전수 확인 후 판단)
  - svelte-check: checkout/+page.svelte 자체 경고 6건은 기존과 동일 내용(줄 번호만 이동),
    신규 ERROR 0건. 프로젝트 전체 신규 WARNING 2건은 cms/rentals·cms/reservation
    +page.svelte에서 발생 — 이번 세션에서 손대지 않은 파일이며 세션 시작 전부터 워킹트리에
    있던 별도 미커밋 변경분으로 확인(diff로 대조), 이번 수정과 무관

- [x] UI-5: 수령/반납일시 버튼 바 상하 패딩 30px + 날짜·시간 라벨 폰트 토큰 상향 | ROUTINE | ✅ 완료 (2026-07-28)
  - Stephen 후속 요청: "중요한 영역"이라 .datetime-wrap 상하 패딩 20px → 30px 확대,
    날짜·시간 버튼 라벨(.datetime-btn-label) 폰트 토큰 한 단계 위로
  - 현재 스타일(16px Bold, white-space nowrap)이 문서상 --text-m-body-16B(700 16px, "버튼·
    본문")와 일치 → 한 단계 위 --text-m-title-18B(700 18px, "소제목")로 교체
  - 480px 이하 초소형 화면 반응형 오버라이드(.datetime-btn-label{font-size:14px}, 2411행)는
    이번 요청 범위(기본 토큰) 밖이라 무변경 유지 — 필요 시 별도 요청 안내
    → Stephen 후속 요청으로 이 반응형 오버라이드도 동일하게 한 단계 상향: 14px(--text-m-
      script-14B와 동일 크기) → --text-m-body-16B(16px Bold)로 교체, letter-spacing -0.5px
      유지 (color: white는 기본 규칙에서 이미 상속되어 무변경)

- [x] FEAT-1: "회원정보 반영"(배송지) 체크박스 — 저장된 주소 있을 때만 활성화 | BOUNDARY | ✅ 완료 (2026-07-28)
  - Stephen 요청: 배송지/반납위치 정보 섹션의 "회원정보 반영" 체크박스는 회원 주소값이
    실제로 존재할 때만 활성화, 없으면 비활성
  - 확인: 기존 코드는 이 체크박스(memberCheck2)가 클릭 시 단순 boolean 토글만 하고 실제
    저장된 주소를 불러와 반영하는 로직 자체가 없었음(별도 미구현 상태) — 이번 요청 범위는
    "주소 존재 여부에 따른 활성/비활성"이므로 그 범위만 구현, 실제 자동입력 연동은 범위 밖
  - src/routes/checkout/+page.server.ts: user_shipping_addresses 테이블에서 road_address
    존재 여부만 조회하는 병렬 쿼리 추가 → hasUserAddress boolean 반환 (게스트 분기는 false
    고정)
  - src/routes/checkout/+page.svelte: ServerExt 타입에 hasUserAddress 추가, sdHasUserAddress
    derived 값 생성, RentalForm props에 hasUserAddress? 추가, 체크박스 button에
    disabled={!props.hasUserAddress} 적용 + .form-check-label-disabled(opacity 0.4,
    cursor:not-allowed) 시각 처리
  - 적용 범위: type==='rental'일 때만 렌더링되는 체크박스이므로 bulk-panel·OrderCard(모바일)·
    ItemDetailPanel(PC) 3개 RentalForm 호출부 전부에 sdHasUserAddress 전달
  - 이 체크박스가 없는 '고객 정보' 섹션의 다른 "회원정보 반영"(memberCheck, 이름/이메일/
    전화번호용)은 주소와 무관해 이번 수정 대상에서 제외
  - svelte-check: checkout 관련 신규 ERROR 0건, 전체 11 errors 그대로 유지

- [x] UI-6: "날짜 / 배송 일괄 설정" 패널을 Order Total 바로 위로 재배치 | ROUTINE | ✅ 완료 (2026-07-28)
  - 기존 순서: bulk-panel(일괄설정) → mobile-cart-list/master-detail(상품 목록) → Order Total
  - 변경 순서: mobile-cart-list/master-detail(상품 목록) → bulk-panel(일괄설정) → Order Total
  - Stephen 근거: 다수 대여상품을 먼저 확인한 뒤 일괄 설정을 적용하는 흐름이 UX상 더 정합
  - 마크업 블록 자체는 내용 변경 없이 위치만 이동 (bulk-panel div 전체를 master-detail
    닫는 태그 뒤·section 닫는 태그 앞으로 절단·재삽입)
  - svelte-check: 신규 ERROR 0건

- [x] FEAT-2: 일괄설정 패널 — 첫 상품 카드 시딩 + 입력 즉시 전체 카드 반영 | BOUNDARY | ✅ 완료 (2026-07-28)
  - AskUserQuestion으로 확인한 두 결정: ① 패널 오픈 시 초기값은 첫 번째(최상단) 상품 카드
    값으로 시딩 ② 일괄설정 필드 수정 시 "전체 적용" 버튼 없이 즉시 전체 카드에 반영
  - 시딩: $effect(bulkOpen 의존) — 패널이 열릴 때 itemsState의 첫 번째 미삭제 항목의
    opts.rentalMethod/returnMethod를 bulkOpts에 복사. 다른 카드에는 되쓰지 않음(시딩과
    반영 분리 — 단순히 패널을 여는 것만으로 다른 카드가 바뀌면 안 됨)
  - 즉시 반영: applyBulkToItems() 신설(기존 applyBulkSettings 로직 재사용, bulkOpen 강제
    닫기·성공 토스트 제거) — bulkHandleMethod/bulkHandleReturnMethod/bulkHandleRentalForm/
    bulkHandleCopy 끝에서 호출 + 신규 bulkHandleDate/bulkHandleTime/bulkHandleReturnForm
    핸들러 추가(기존 인라인 람다를 명명 함수로 전환) 후 동일하게 호출
  - "전체 적용" 버튼 제거(자동 반영되므로 더 이상 필요 없음) + 관련 .bulk-apply CSS 삭제.
    "개별 설정"(resetBulkSettings) 버튼은 기존과 동일하게 유지("적용 중" 배지만 토글, 기존에도
    데이터 자체를 되돌리지 않던 동작이라 이번 변경으로 인한 회귀 아님)
  - ⚠️ 버그 수정 경위: 최초 구현 시 applyBulkToItems()를 호출부에서만 참조하고 실제 함수
    정의(구 applyBulkSettings → 신규 이름 변경)를 누락한 채 커밋 전 상태로 남아 있었음 —
    모든 일괄설정 입력이 존재하지 않는 함수를 호출해 즉시 런타임 오류로 실패하는 상태였음.
    Stephen이 실브라우저에서 "값이 하나도 안 바뀐다"고 재현 확인 후 지적 → 함수 정의 완성 +
    JSX 호출부 전체 재검증으로 해결
  - svelte-check: checkout 관련 신규 ERROR/WARNING 0건 (기존 6개 경고 줄번호만 이동),
    전체 11 errors 그대로

- [x] FEAT-3: 결제완료(DEV) 화면 — 상품별 카드에 단건 대여요금 노출 추가 | ROUTINE | ✅ 완료 (2026-07-28)
  - Stephen이 /payment/success/dev 화면의 상품별 카드(대여일정·수령방식·반납방식) 아래에
    해당 건의 단건 대여요금이 없다고 지적 — 하단 "결제 내역" 카드의 합산 대여요금(subtotal)만
    있고 건별 분해가 없었음
  - src/routes/payment/success/dev/+page.ts: SuccessItem 인터페이스에 price:number 추가,
    구버전 단일상품 폴백 경로는 subtotal 파라미터를 그대로 price로 사용
  - src/routes/checkout/+page.svelte: DEV 결제완료 이동 시 items 배열 구성부(activeItems.map)
    에 price: itemCardRate(line, it.durType) * Math.max(it.qty, 1) 추가 — 기존 대여료 소계
    계산(otSubtotal)과 동일한 함수 재사용, 옵션비·배송비 제외한 순수 대여요금
  - src/routes/payment/success/dev/+page.svelte: 반납방식 행과 포함옵션 행 사이에 "대여요금"
    행 추가, item.price > 0일 때만 표시(기존 옵셔널 필드들과 동일한 조건부 패턴)
  - 범위: DEV 전용 미리보기 화면만 수정 — 실 결제 완료 화면(/payment/success, 단일상품·
    합계요금 구조로 상이함)은 이번 요청 대상 아님, 미수정
  - svelte-check: 신규 ERROR/WARNING 0건, 전체 11 errors 그대로

- [x] FIX-1: 예약신청 시 부가 RPC(수령/반납방식·대여기간·옵션상품) 실패 무음 처리 수정 | BOUNDARY | ✅ 완료 (2026-07-28)
  - Stephen 신고: 상품상세에서 선택한 옵션상품 정보가 체크아웃에 반영 안 되는 경우 발견
  - 근본원인 조사(Stage DB 직접 대조): 동일 상품의 이전 예약(#62)은 옵션(Manfrotto 055)이
    reservation_options에 정상 저장되어 있었음 — 저장 파이프라인 자체는 정상 동작 확인.
    문제의 예약(#64, 체크아웃에 표시 중인 hold 예약)은 reservation_options 행이 아예 없음
  - 실제 원인은 브라우저에서 재현 확인이 불가해 100% 특정은 못 했으나(옵션 미선택이었을
    가능성도 배제 못 함), 코드 감사 중 실제 결함 발견: set_reservation_shipment_method·
    set_reservation_duration·set_reservation_options 3개 RPC 호출 전부 { error } 응답을
    전혀 확인하지 않고 있었음 — RPC가 내부 소유권 검사 실패 등으로 조용히 no-op해도
    사용자는 물론 개발자도 실패를 알 방법이 없는 상태였음. 이 침묵 실패가 관찰된 증상과
    정확히 일치하는 유형이라 우선 수정
  - src/routes/products/[id]/+page.svelte handleReserve(): 3개 RPC 호출 모두 { error }
    구조분해 추가. 수령/반납방식·옵션상품 실패 시 console.error + showToast로 사용자에게
    즉시 알림("체크아웃에서 다시 확인해 주세요"). 대여기간 실패는 console.error만(사용자
    노출 영향도 낮다고 판단, 토스트 중첩으로 인한 UX 저하 방지)
  - 한계: 이번 수정은 실패를 "보이게" 만드는 조치이며, 예약 #64가 왜 옵션 없이 생성됐는지
    소급 확인·복구는 불가능(이미 지난 트랜잭션). 앞으로 동일 현상 재발 시 토스트로 즉시
    확인 가능해짐
  - svelte-check: products/[id]/+page.svelte 신규 ERROR 0건(기존 경고 4개 그대로), 전체
    11 errors 그대로. 경고 총합 296→297은 이번 세션에서 손대지 않은
    cms/products/[id]/edit/+page.svelte(세션 이전부터의 별도 미커밋 변경분)에서 발생 —
    이번 수정과 무관

- [x] UI-2: 배송 마감시간 안내(delivery-deadline) 디자인 토큰 위반 수정 | ROUTINE | ✅ 완료 (2026-07-28)
  - Stephen 질의: "⏰ 19:00 마감"이 무슨 정보인지 + 마감시간 안내라면 표준 디자인 시스템의
    도움말 안내 스타일로 재작성 요청
  - 확인: rental_method_options.deadline_time(CMS /cms/set/rental 설정값) — ui-mobile.md
    "배송 마감 UI 표시 기준"에 정의된 표준 마감 안내(방문 19:00/택배 15:00/퀵 17:00/무인보관함
    18:00)와 동일한 정보. 현재 선택된 대여방식의 마감시간만 조건부 표시.
  - 발견된 위반: 기존 스타일이 var(--cs-orange) 사용 — front-uiux.md에 "브랜드 오렌지 —
    로고·이벤트 포인트 전용, 버튼 사용 금지"로 명시된 토큰을 일반 안내 텍스트에 오용
  - 수정: color를 --cs-orange → --cs-text-mid(문서상 "보조 텍스트, 캡션" 용도)로 교체,
    font-size 12px 하드코딩 → font: var(--text-m-script-12) 캡션 토큰으로 교체, font-weight
    700 유지(도움말성 강조), 같은 폼 내 형제 요소 .form-note와 동일 카테고리로 통일

---

## NOW — 전자계약 시스템 보안·관리 피드백 재검증 + 확인된 결함 2건 수정 (2026-07-28) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 직접 요청 — 별도 "전자계약 기술설명서" 첨부는 타 프로젝트
(1TeamWorks) 문서로 확인, 경로·API 불일치 — 해당 문서의 일반적 갭 카테고리(서버 서명 검증·감사
로그·상태 전이 검증·토큰 만료)만 크레이지샷 코드에 대입해 재검증에 활용)
등급: 🔴 CRITICAL (고객 PII 노출 경로 + 예약 상태 연동 보안 검증 → 재검증 결과 보고 후 Stephen 승인
받아 수정 진행)

검증 범위:
  1. 고객이 채팅 수신 링크로 전자계약을 안전하게 확인·서명 등록할 수 있는가
  2. 관리자가 상담채팅을 통해 예약 사이클 내 전자계약 배포·확인을 빠르게 관리할 수 있는가
  3. 첨부 문서의 일반적 갭 항목이 현재 구현에 반영될 여지가 있는가

검증 결과 요약(수정 전 보고, Stephen 승인 후 진행):
  - 토큰 엔트로피(256bit)·서명 원자적 UPDATE 가드·서버사이드 stroke 재검증·IP/timestamp 기록 등
    핵심 무결성 장치는 이미 견고함을 확인
  - 🔴 결함 A: Migration #146(expires_at)이 Stage·Production 양쪽 DB에 실제 적용되어 있음에도
    `/contract/[token]/+page.server.ts`(GET 로드)가 이 컬럼을 전혀 조회·체크하지 않아, 만료된
    링크로 접속해도 예약자 PII(이름·전화번호·이메일)와 계약 전문이 그대로 노출되고 서명 제출
    시점(POST)에서야 410으로 막히는 구조였음
  - 🟡 결함 B: 서명 완료 시 관리자 채팅에 삽입되는 액션카드의 `action_url`이 `'/cms/reservation'`
    고정 문자열이라 특정 예약으로 딥링크되지 않음. 게다가 `/cms/reservation`은 hold/pending/
    cancelled 상태만 보유하고 confirmed 이후(대부분의 계약 서명 시점)는 `/cms/rentals`가 정본
    화면이라, 기존 코드는 애초에 잘못된 화면으로 안내하고 있었음. 추가로 두 목록 화면(`/cms/
    reservation`, `/cms/rentals`) 모두 `?selected=` 쿼리파라미터를 쓰기만 하고 마운트 시 읽어서
    패널을 자동으로 열어주는 로직 자체가 없어, 파라미터를 붙여도 무의미했음(딥링크 자체가
    구조적으로 불가능한 상태)

신규/수정 파일:
  - src/routes/contract/[token]/+page.server.ts (MODIFY) — expires_at select 추가 + 만료 시
    /contract/expired로 redirect (signed_at 체크 바로 다음)
  - src/routes/api/contracts/[token]/sign/+server.ts (MODIFY) — 예약 상태 UPDATE를 먼저 await한
    뒤 status를 조회하도록 순서 변경(레이스 컨디션 방지) + RENTAL_STATUSES 판정으로 confirmed
    이후는 /cms/rentals, 그 이전은 /cms/reservation으로 액션카드 action_url 분기 + reservation_id
    쿼리파라미터 추가
  - src/routes/cms/reservation/+page.server.ts (MODIFY) — `selected` 쿼리파라미터 파싱 → data.selectedId
  - src/routes/cms/reservation/+page.svelte (MODIFY) — selectedId 초기값을 data.selectedId로 초기화
    (마운트 1회만 — openPanel/closePanel이 이후 직접 제어, 재동기화 effect 미추가로 필터 변경 시
    패널 자동 닫힘 등 부가 동작 변경 없음)
  - src/routes/cms/rentals/+page.server.ts (MODIFY) — 동일 패턴 (selected 파싱)
  - src/routes/cms/rentals/+page.svelte (MODIFY) — 동일 패턴 (selectedId 초기화)

- [x] SEC-EXPIRE-GUARD: 만료된 서명 링크 페이지 로드 단계 차단 | CRITICAL | ✅ 완료 (2026-07-28)
  - 실브라우저 검증: Stage DB 테스트 토큰의 expires_at을 과거로 강제 설정 → /contract/[token] 접속 시
    /contract/expired로 즉시 redirect 확인 (계약 내용·PII 노출 없음) → expires_at 원복 후 정상
    미만료 토큰 접속 시 기존과 동일하게 정상 렌더링되는지 회귀 확인 완료
  - svelte-check: 신규 ERROR 0건

- [x] FEAT-ADMIN-DEEPLINK: 서명완료 알림 액션카드 → 정확한 예약 패널로 딥링크 | BOUNDARY | ✅ 완료 (2026-07-28)
  - /cms/reservation·/cms/rentals 양쪽에 `?selected=` 초기 진입 반영 로직 신규 추가 (기존에는
    URL에 쓰기만 하고 읽지는 않던 죽은 파라미터였음)
  - sign 엔드포인트가 예약의 실제 현재 상태를 보고 confirmed 이후는 /cms/rentals, 그 이전은
    /cms/reservation으로 정확히 분기 + reservation_id를 selected로 포함해 전달
  - ⚠️ 알려진 한계(범위 내 최소 수정 원칙 유지, 별도 확장 안 함): 대상 예약이 관리자가 보고 있는
    현재 필터·페이지네이션(30건/페이지) 밖에 있으면 `data.rentals`에서 못 찾아 패널이 자동으로
    열리지 않음 — URL은 정확히 이동하나 패널만 비어있는 상태. id 기준 단건 조회로 페이지네이션과
    무관하게 항상 열리게 하려면 추가 설계 필요(이번 요청 범위 밖으로 판단, 별도 확인 후 진행 권장)
  - svelte-check: 신규 ERROR 0건, 기존과 동일한 패턴의 WARNING만 추가(state_referenced_locally,
    같은 파일의 searchInput/dateFrom과 동일 성격)

미반영 항목(이번 세션 범위 외, 백로그 권장):
  - 감사 로그 테이블 부재(contract_signings의 sent/viewed/signed_at이 최소 추적은 제공)
  - contracts.status 컬럼이 사실상 죽은 필드(UI 어디서도 렌더링 안 됨, 상태 전이 강제 로직 없음)
  - hooks.server.ts에 Referrer-Policy 등 보안 헤더·레이트리밋 부재(토큰 엔트로피로 실질 위험은 낮음)

---

## NOW — CMS Dead CSS 정리 + 대여현황 Realtime 실시간 갱신 (2026-07-28) ✅ 완료

plan_source: 세션 내 아젠다 (컨텍스트 이관)
핵심제약:
  - 요청 범위 외 수정 절대 금지
  - Svelte 5 Runes 패턴 ($effect cleanup .removeChannel 필수)
  - Realtime: $effect cleanup에서 supabase.removeChannel(channel) 필수
  - 마이그레이션 순서: Stage 검증 → Production 적용

수정/신규 파일:
  - src/lib/components/cms/RentalContractViewer.svelte ← Dead CSS 5개 선택자 제거
  - src/routes/cms/rentals/+page.svelte ← Realtime 구독 $effect 추가
  - supabase/migrations/20260728000177_177_enable_realtime_rental_reservations.sql ← 신규

- [x] DEAD-CSS: RentalContractViewer.svelte Dead CSS 5개 선택자 제거 | ROUTINE | ✅ 완료 (2026-07-28)
  - 제거 선택자: .pdf-placeholder / .pdf-placeholder p / .btn-action / .btn-action:hover / .btn-action:disabled
  - 대응 HTML 마크업이 이전 세션에서 이미 제거된 상태 — 스타일 블록만 잔류해있던 Dead CSS

- [x] FEAT-REALTIME: /cms/rentals 대여현황 Realtime 실시간 갱신 | BOUNDARY | ✅ 완료 (2026-07-28)
  - Migration 177: rental_reservations 테이블을 supabase_realtime 퍼블리케이션 등록 +
    REPLICA IDENTITY FULL 설정
  - Stage(ezyvffjvuwmtuhpxdjrw) ✅ / Production(vnbpmvxruyciuuaermyh) ✅ 양쪽 적용 완료
  - +page.svelte: browser import + supabase import 추가
  - $effect(() => { supabase.channel('cms-rentals-realtime').on('postgres_changes', ...,
    () => { invalidateAll() }).subscribe() / return () => { supabase.removeChannel(channel) } })
  - 동작: /cms/reservation 예약 승인(confirmed) → rental_reservations 상태 변경 → Realtime 이벤트 수신 → invalidateAll() → /cms/rentals 목록 자동 갱신
  - svelte-check: 신규 ERROR 0건 (기존 11 errors 그대로)

⏳ QA: sp3-qa-agent 검수 예정

---

## NOW — /products/[id] 예약 검증 로직 3종 보완 + 후기 등록 Figma 재현 + CalendarTimePicker PC 크기 축소 (2026-07-28) ✅ 완료

plan_source: 세션 내 아젠다 (컨텍스트 이관, 이전 세션 옵션·CMS 버그픽스 연속)
핵심제약:
  - 요청 범위 외 수정 없음
  - Svelte 5 Runes 패턴 준수 ($state(prop) 초기화 금지)
  - Claude Browser 도구 사용 금지(2026-07-28 CLAUDE.md 확정 규칙) → svelte-check + 소스코드 Read로 검증 대체

수정 파일:
  - src/routes/products/[id]/+page.svelte ← handleReserve() 검증 가드 2종 추가 + 후기 폼 전면 재작성
  - src/lib/components/products/CalendarTimePicker.svelte ← 과거 날짜/이전달 이동 차단 + 배송정책 chip hover 제거 + PC 반응형 크기 축소

- [x] BUG-PASTDATE: 달력에서 현재 시점 이전 날짜 선택 가능 버그 수정 | BOUNDARY | ✅ 완료 (2026-07-28)
  - CalendarTimePicker.svelte: todayIso 기준 isPastDate(iso) 함수 신규 + handleDateClick 진입 시 과거 날짜 즉시 return
  - 템플릿: {@const past = isPastDate(iso)} → class:past-date + disabled={past} 적용, CSS로 흐림 처리(opacity 0.35)
  - isAtCurrentMonth $derived 신규 + prevMonth()에서 현재 월일 때 이전 달 이동 차단(nav-btn disabled)

- [x] FEAT-LEADTIME: 예약 일시 리드타임 검증 3종 신규 추가 | CRITICAL | ✅ 완료 (2026-07-28)
  - Stephen 확정 규칙: 방문·퀵·무인택배함 = 당일 기준 "당일+3시간" 이후만 예약 가능 /
    택배(배송)만 = "당일+2일" 이후만 예약 가능 (배송충돌 판정용 DELIVERY_METHOD_KEYS와는
    별개로 TWO_DAY_LEADTIME_KEYS = {'delivery','epost'} 신규 분리)
  - handleReserve(): needsTwoDayLeadtime 여부로 분기 — 2일 리드타임 미충족 시
    "택배 대여는 대여일 2일 전 예약 가능합니다." / 당일+3시간 미충족 시 "당일 대여는
    대여시간 기준 3시간 전 방문만 가능합니다." 토스트 후 예약 진행 차단
  - 대여방식 미선택 시 예약신청 진행되던 버그도 동일 함수 내 가드 추가로 함께 차단
    (data.rentalMethods.length > 0 && !e.methodId 체크)

- [x] FIX-HOVER: 배송정책 콤보 chip 불필요 호버 인터랙션 제거 | ROUTINE | ✅ 완료 (2026-07-28)
  - 원인: .policy-chip:hover가 사용자가 선택할 수 없는 읽기 전용 배송정책 표시 span(.policy-chip--active)
    에도 동일하게 적용되어, 클릭 불가능한 정보성 UI에 호버 강조가 나타남
  - 수정: .policy-chip:hover → .policy-chip:not(.policy-chip--active):hover로 범위 한정
    (실제 선택 가능한 대여방식 chip에만 호버 유지, 배송정책 표시 chip은 호버 제거)
  - 모바일 재확인: 터치 디바이스는 :hover 자체가 지속 발화하지 않아 별도 이슈 없음 확인

- [x] FEAT-REVIEW-FIGMA: 후기 등록 폼 Figma 시안 재현 | BOUNDARY | ✅ 완료 (2026-07-28)
  - Figma 참조: node-id 1188-7444 (Crazyshot.kr UI)
  - 기존 확장형 2단 입력(제목+본문 별도 필드) 폼을 단일 인풋 + 전송 버튼 구조로 전면 교체
  - submitReview(): 입력 전체 텍스트의 앞 10자를 title로 자동 생성(content.slice(0,10)),
    본문은 입력 전체(content) 그대로 저장 → 목록/상세에는 content 전체 노출
  - 비로그인 상태: input readonly + 클릭 시 requireLoginForReview() 토스트
  - CSS: .review-form-expanded/.review-title-input/.review-content-input/.review-submit-btn
    등 확장형 전용 선택자 제거, 기존에 죽어있던 .review-form/.review-send-btn(빠른문의
    .qa-form/.qa-send-btn과 동일 패턴)을 실사용으로 전환
  - PC·Mobile 반응형 별도 오버라이드 불필요 확인(기존 flex 구조가 두 해상도 모두 자연 대응)

- [x] FIX-PC-CALTIME-SIZE: CalendarTimePicker PC반응형 캘린더+시간선택 UI 크기 축소 | ROUTINE | ✅ 완료 (2026-07-28)
  - Stephen 피드백: 최초 제안한 컨테이너 쿼리(container-type/@container) 기반 좌우배치 전환
    방식은 반려("수정전으로 복원해") — 대신 "PC반응형에서 무리한 UI, 달력·시간 UI 모두
    이렇게 클 필요 없다"는 방향으로 재요청
  - 처리: 컨테이너 쿼리 관련 수정 전체 원복(@media (min-width:641px) 뷰포트 기준 구조 복귀,
    .calendar min-width:0 제거, .picker-wrap container-type 제거) 후, 기존 @media
    (min-width:641px) 블록 내부 값만 축소하는 방식으로 재구현
  - 축소 내역(PC 전용, 모바일 무변경):
    · .cal-time-wrapper gap 40px→24px / .calendar gap 16px→10px / .cal-cell font-size 14px→12px
    · .time-col gap 20px→10px / .time-spinner gap 24px→12px, padding 10px 20px→8px 12px
    · .time-label min-width 28px→22px / .spinner-col gap 20px→10px
    · .spin-btn 30×20px→22×16px / .time-val min-width 20px→16px, font-size 14px→12px
    · .time-colon·.time-ampm font-size 14px→12px
  - svelte-check: CalendarTimePicker.svelte 신규 ERROR 0건(기존 unused-selector 경고 2건만
    잔존, 이번 수정과 무관)

근본원인 분석(참고, 코드 미반영):
  - .info-right(PC 예약영역) 컬럼은 페이지 콘텐츠 최대폭(--layout-pc-max: 1240px) 제약으로
    뷰포트가 아무리 넓어져도 최대 ~605px로 고정됨 — 뷰포트 기준 641px 브레이크포인트로 좌우
    배치를 켜면 "화면은 넓은데 실제 칼럼은 좁은" 중간 구간에서 항상 붕괴 위험이 남음
  - 이번 세션은 Stephen 지시대로 UI 자체를 축소하는 방식으로 해결(구조 변경 없음) — 향후
    유사 붕괴가 재발하면 이 근본원인(컨테이너 실폭 vs 뷰포트 불일치) 참고 필요

sp3-qa-agent GATE C 검수 결과 (2026-07-28):
  - 검수 대상: src/routes/products/[id]/+page.svelte · src/lib/components/products/CalendarTimePicker.svelte
  - 규칙 정합성: 보안(서버 키 노출·RLS·H-01 RPC 경유) 전부 준수, rental.md 정합 확인
  - handleReserve() 가드 순서 검증: 대여방식 미선택 → 필수옵션 → min_select_required →
    배송충돌(DELIVERY_METHOD_KEYS) → 리드타임(TWO_DAY_LEADTIME_KEYS) 순서로 상호 배타적 early
    return 확인
  - DELIVERY_METHOD_KEYS(배송충돌 판정)와 TWO_DAY_LEADTIME_KEYS(2일 리드타임 판정) 완전히
    별개 Set으로 분리, 혼용 없음 확인
  - 리드타임 경계값(당일+2일 00:00 / 당일+3시간) 스펙과 일치 확인
  - FIX-HOVER: .policy-chip.chip-active(선택형 button)와 .policy-chip--active(읽기전용 span)가
    서로 다른 클래스라 :not(.policy-chip--active) 제외 규칙이 의도대로 동작 확인
  - submitReview(): Runes 패턴 위반 없음, RPC 캐스팅은 파일 내 기존 ReserveRpcFn/ShipRpcFn과
    동일 패턴 답습(신규 위반 아님)
  - container-type/@container 잔재: 0건 — 컨테이너 쿼리 반려 후 원복 완전성 grep으로 확인
  - svelte-check: 대상 2개 파일 신규 ERROR 0건 (프로젝트 전체 11 errors는 전부 세션 무관 기존 파일)
  - 참고 4건(non-blocking): ① PC 전용 .spin-btn 22×16px — ui-mobile.md 44px 기준 미달이나
    Stephen 명시적 요청 + PC 포인터 전용 + 기존 모바일 값(30×20px)도 원래 미달이었던 기존
    패턴의 연장이라 신규 위반 아님(백로그 권장) ② 리드타임 검증 3종은 클라이언트 UX 가드만
    존재, create_hold_reservation RPC 서버사이드 재검증 없음(요청 범위가 UI였으므로 범위 내,
    악의적 우회 가능성은 별도 확인 권장) ③ .review-send-btn width/height:35px가
    min-width/min-height:44px에 덮여 죽은 값(사소, 정리 권장) ④ +page.svelte git diff에 이번
    5개 항목 외 별도 완료 섹션("/checkout 렌탈정보 미반영 + 옵션상품 미노출 버그픽스",
    Migration #176)의 코드도 같은 파일이라 함께 포함되어 있음 — 코드 자체는 정상이나 커밋 시
    두 아젠다 분이 함께 스테이징됨을 인지 필요

GATE E: ✅ 통과 — 수정 필요 항목 0건 (참고 4건 모두 non-blocking) — git commit 진행 가능

---

## NOW — 전자계약 서명 버튼 비활성 고착 버그 수정 (2026-07-28) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 실기기 스크린샷 신고 — 서명 완료했는데 "서명하기" 버튼 계속 비활성)
등급: 🔴 CRITICAL (고객이 계약에 서명 자체를 못 해 예약 진행이 완전히 막히는 기능 결함)

원인 분석:
  - `SignatureCanvas.svelte`의 유효성 판정이 "펜을 뗀 횟수(stroke)가 3회 이상"이었음
  - 실제 서명은 대부분 펜을 떼지 않고 한 번에 이어그리는 필기체(1획)라서, 정상적으로 서명해도
    strokes=1에 영구적으로 머물러 버튼이 절대 활성화되지 않는 구조적 결함
  - 직전 세션에 "조금 더 서명해 주세요 (1/3)" 안내 문구를 불필요 UI로 판단해 제거하면서, 정확히
    이 상황(강제 요구조건 미충족)에 대한 유일한 피드백까지 함께 사라져 사용자가 원인을 알 수
    없는 상태로 막혀 있었음

수정 파일:
  - src/lib/components/common/SignatureCanvas.svelte (MODIFY) — 판정 기준을 "stroke count ≥ 3"에서
    "stroke ≥ 1 AND 누적 드로잉 길이(totalLength) ≥ minLength(기본 40px)"로 전면 교체.
    SignatureData에 pathLength 필드 추가, minStrokes prop 제거 → minLength prop으로 대체,
    힌트 문구 3단계 복원("여기에 서명하세요"/"여기에 조금 더 서명해 주세요"/"서명 완료" —
    직전 세션에 제거했던 "(n/3)" 형태의 스트로크 카운트 문구는 재도입하지 않음, 단순 클릭·점
    하나처럼 실제 미달 상황에서만 노출되는 문구로 재설계)
  - src/routes/contract/[token]/+page.server.ts — 변경 없음 (이번 결함과 무관, 참고용 명시)
  - src/routes/contract/[token]/+page.svelte (MODIFY) — minStrokes={3} prop 제거, path_length를
    서명 제출 payload에 포함, 에러 문구에서 "(3획 이상)" 표현 제거
  - src/routes/api/contracts/[token]/sign/+server.ts (MODIFY) — 서버사이드 검증도 동일 기준으로
    동기화: `strokeCount < 3` → `strokeCount < 1 OR pathLength < 40`로 교체 (클라이언트만 고치면
    서버가 여전히 3획 미만을 거부해 결함이 재현되므로 반드시 함께 수정 필요했음)

- [x] BUG-SIG-STROKE-LOCK: 서명 유효성 판정을 스트로크 횟수 → 드로잉 길이 기준으로 전환 | CRITICAL | ✅ 완료 (2026-07-28)
  - 실브라우저 검증(로컬 dev + Stage DB 실제 미서명 토큰): 캔버스에 단일 연속 드래그(1스트로크)로
    서명 → 힌트 "서명 완료" 전환 + "서명하기" 버튼 disabled=false 확인 → 실제 제출까지 진행해
    POST /api/contracts/[token]/sign 200 OK + '서명 완료' 페이지 전환 확인 → DB 조회로
    contract_signings.stroke_count=1, signed_at 정상 기록 확인 (기존 로직이었다면 이 지점에서
    클라이언트·서버 양쪽 모두 거부했을 케이스)
  - svelte-check: 신규 ERROR 0건 (SignatureCanvas 사용처는 이 계약서 화면 1곳뿐임을 grep으로
    재확인 후 컴포넌트 공개 API(minStrokes→minLength) 변경 — 타 화면 영향 없음)

---

## NOW — 전자계약 서명 유효성 판정 추가 완화 (2026-07-28) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 직접 질의 — "서명 유효성 판정이 법적 근거 있나?")
등급: 🔴 CRITICAL (서명 등록 가능 여부에 직결)

배경: 바로 직전 항목(BUG-SIG-STROKE-LOCK)에서 "펜 뗀 횟수 3회"를 "누적 드로잉 길이 40px
이상"으로 교체했으나, 이 minLength(40px) 기준 역시 Stephen 확인 없이 임의로 추가한 기준이었음.
Stephen이 법적 근거를 질의 → 전자서명법상 스트로크 수·드로잉 길이에 대한 요구사항 없음을 확인,
"1회만 서명 기록해도 버튼 활성화" 명시적 지시에 따라 길이 기준까지 완전히 제거.

수정 파일:
  - src/lib/components/common/SignatureCanvas.svelte (MODIFY) — totalLength/lastPos/minLength
    전부 제거, 판정을 순수 `strokes >= 1`로 단순화, SignatureData.pathLength 필드 제거,
    힌트 문구 2단계로 원복("여기에 서명하세요"/"서명 완료")
  - src/routes/contract/[token]/+page.svelte (MODIFY) — payload에서 path_length 제거
  - src/routes/api/contracts/[token]/sign/+server.ts (MODIFY) — 서버 검증도 `strokeCount < 1`
    (등록 자체가 없는 경우)로만 단순화, pathLength 관련 검증 완전 제거

- [x] SIMPLIFY-SIG-VALIDATION: 서명 유효성 = "1회 이상 등록" 단일 기준으로 단순화 | CRITICAL | ✅ 완료 (2026-07-28)
  - 실브라우저 검증: 캔버스에 mousedown+mouseup을 동일 좌표(이동 없음, 사실상 점 하나)로 발생시켜도
    즉시 "서명 완료" + 버튼 활성화 확인 → 제출까지 진행해 POST 200 OK + DB stroke_count=1,
    signed_at 정상 기록 확인 (이전 minLength=40px 기준이었다면 거부됐을 가장 극단적인 케이스)
  - svelte-check: 신규 ERROR 0건

sp3-qa-agent GATE C 검수 결과 (2026-07-28, 결함 A/B 보안 수정 + 서명 유효성 판정 단순화 최종본 통합 검수): ✅ 통과
  - 검수 대상 7개 파일 요청 범위와 정확히 일치 확인(cms/rentals/+page.svelte는 별도 커밋 02fcfaf에
    이미 반영됨을 git log로 확인). 워킹트리에 섞인 타 세션 미커밋 변경(checkout/*, payment/success/dev/*,
    ProductHero.svelte 등)은 검수 범위에서 명시적으로 제외
  - 결함 A: load() 실행 순서상 expires_at 체크(3단계)가 PII 조회(5단계, user_profiles) 이전에
    redirect로 실행을 즉시 중단시키므로 근본적으로 차단됨을 코드 순서로 재확인 — PASS
  - 결함 B: UPDATE를 별도로 먼저 await한 뒤 SELECT하는 순서라 레이스 컨디션 없음, RENTAL_STATUSES가
    rental-lifecycle.md 기준과 100% 일치 확인 — PASS
  - `selectedId = $state(data.selectedId ?? null)` 패턴: core-rules.md가 금지하는 "재마운트 없는
    prop 재동기화 문제"가 아니라 "외부 링크로 인한 풀 네비게이션 시 최초 1회 반영"이므로 위반 아님 —
    PASS (단, 같은 탭에서 CMS를 켜둔 채 다른 selected 링크를 연속 클릭하는 극단적 엣지 케이스는
    재마운트가 없어 갱신 안 될 수 있음 — 실사용 빈도 매우 낮아 non-blocking 참고 사항으로만 기록)
  - 서명 유효성 판정: 클라이언트(`strokes >= 1`)·서버(`strokeCount < 1` 거부)가 완전히 일치,
    SignatureData에서 pathLength/totalLength/minLength 등 이전 40px 기준 잔재 전부 제거 확인 — PASS
  - TS 컴파일: 대상 파일 신규 에러 0건 (stash 전후 비교, 잔존 9건은 기존 무관 이슈로 재확인)
  - 실측 검증 방법론(만료 링크 강제 설정 접속 / 이동없는 클릭 서명 / DB 조회) 3건 모두 코드 로직과
    부합하는 타당한 검증 경로로 판단
  - BLOCKING 이슈 없음
  - GATE E 통과, 커밋 허가

---

## NOW — 체크아웃 옵션상품 금액 미반영 버그 수정 (2026-07-28) ✅ 완료

plan_source: 세션 내 아젠다 (Stephen 검증 요청 → 결함 확인 → 수정 승인)
핵심제약:
  - 🔴 CRITICAL: 결제금액 정확성 직결 — 수정 전 Stephen에게 검증 결과 보고 후 승인받아 진행
  - 마이그레이션 순서: Stage(ezyvffjvuwmtuhpxdjrw) 검증 → Production(vnbpmvxruyciuuaermyh) 확인 후 적용
  - 요청 범위 외 수정 없음 (옵션 이미지·기타 메타정보 추가 노출은 이번 요청 범위 밖으로 판단, 미반영)

검증 결과(수정 전 확인):
  - 상품상세 → set_reservation_options RPC → reservation_options 테이블 저장은 정상(Migration #176)
  - checkout/+page.server.ts가 reservation_options를 조회해 각 카드에 options 배열로 연결하는 것도 정상
  - 그러나 체크아웃 화면 표시 합계(otSubtotal/otTotal, +page.svelte)와 개별 카드 요금 배지(fee-badge)
    모두 옵션 unit_price를 전혀 더하지 않고 기본 대여요금만 합산 — 옵션 선택해도 결제금액 불변
  - 서버 authoritative RPC(calculate_cart_total, Migration #173)도 옵션 테이블(Migration #176, #173보다
    하루 늦게 생성됨) 자체를 참조하지 않음 — 애초에 두 마이그레이션이 서로 연결된 적이 없었음
  - 부가 확인: 현재 실제 결제 CTA(footer-cta)는 /api/checkout/confirm-mock 호출 — PG 미연동 시범서비스
    임시 자동승인이라 금액을 아예 참조하지 않음(주석: "PG 미연동 임시 자동 예약승인"). /api/checkout/
    initiate·calculate_cart_total(p_user_id 파라미터 포함 호출)는 현재 UI 어디서도 호출되지 않는
    죽은 코드로 확인(그대로 유지, 이번 요청 범위 아님) — 따라서 지금 실사용자에게 유일하게 노출되는
    금액은 클라이언트 계산값(otSubtotal/otTotal)이며, calculate_cart_total은 향후 M3 실PG 연동 시
    쓰일 것을 대비해 함께 수정

신규/수정 파일:
  - src/routes/checkout/+page.svelte ← itemOptionsAmount() 헬퍼 추가 + otSubtotal·fee-badge 옵션가 합산
    + 옵션 목록 텍스트에 금액 표시 추가
  - supabase/migrations/20260728000178_178_include_options_in_cart_total.sql ← 신규 (calculate_cart_total
    옵션 합산 포함 재작성)

- [x] FIX-OPTION-PRICE: 체크아웃 합계·개별 카드 요금에 옵션상품 금액 반영 | CRITICAL | ✅ 완료 (2026-07-28)
  - itemOptionsAmount(line): line.options.reduce((s,o)=>s+o.unitPrice*o.qty,0) 신규 헬퍼
  - otSubtotal: 기존 itemCardRate(line,durType) 단독 합산 → (itemCardRate + itemOptionsAmount) *
    Math.max(it.qty,1)로 교체 — 기본 대여요금과 동일하게 카트 수량(it.qty) 배수 적용
  - ItemListCard 스니펫 fee-badge: (cardRateVal * item.qty) → ((cardRateVal + itemOptionsAmount(line))
    * item.qty)로 동일하게 교체(합계와 카드별 표시 금액 불일치 방지)
  - OrderCard 스니펫의 옵션 목록(.option-list-item)과 ItemListCard의 옵션 텍스트(.item-options) 양쪽에
    각 옵션의 금액(fmtKrw(unitPrice*qty)+"원") 추가 표시 — 총액만 오르고 사용자가 이유를 알 수 없는
    상황 방지. 기존 CSS(overflow:hidden + text-overflow:ellipsis, 또는 자연 줄바꿈)가 텍스트 길이
    증가를 이미 흡수하므로 별도 CSS 수정 불필요
  - OrderCard의 .product-price(단가 라벨, cardRateVal 단독 표시)는 총액이 아닌 단가 표시 목적이라
    수정 대상에서 제외(의미 변경 방지)
  - svelte-check: 대상 파일 신규 ERROR 0건

- [x] FIX-RPC-OPTION-PRICE: calculate_cart_total RPC 옵션 금액 합산 추가 (Migration #178) | CRITICAL | ✅ 완료 (2026-07-28)
  - Migration #173 로직 그대로 유지 + 예약별 reservation_options SUM(unit_price*qty) 조회 추가 →
    v_subtotal에 가산(멤버십 할인율도 옵션가 포함 소계에 동일하게 적용됨)
  - 반환 컬럼명(subtotal/discount_amount/final_total/deposit_required) 무변경 — 호출부
    (checkout/+page.server.ts) 수정 불필요
  - 적용: Stage(ezyvffjvuwmtuhpxdjrw) ✅ 완료, 함수·reservation_options 테이블 존재 확인 완료
  - Production(vnbpmvxruyciuuaermyh) ⛔ Stephen 확인 후 적용 필요 (현재 미적용)

sp3-qa-agent GATE C 검수 결과 (2026-07-28):
  - 보안: 서버 키 노출 0건, 직접 DML 없음(RPC 경유), RLS로 고객 A↔B 옵션 격리 확인
  - itemOptionsAmount()/otSubtotal/fee-badge 3곳 계산식 일관성 확인, null 방어 확인
  - Migration #178: #173 기존 대여요금 로직 100% 보존 + reservation_options 서브쿼리만 추가된
    최소 diff 확인, 반환 컬럼명·GRANT·SECURITY DEFINER 원본과 동일
  - 멤버십 할인율이 옵션가에도 적용되는 것은 클라이언트·RPC 양쪽이 이미 일관된 기존 설계 방식이라
    신규 불일치 아님(참고 사항으로만 기록)
  - svelte-check: 대상 파일 신규 ERROR 0건
  - 참고 3건(non-blocking): ① /payment/success/dev 화면의 개별 항목 price가 옵션가 미포함
    (itemCardRate*qty만 사용) — 반면 같은 화면 하단 총액은 옵션 포함 otSubtotal을 그대로 받아
    표시돼 "대여요금" 라벨 아래 개별합↔총액이 옵션금액만큼 어긋나 보일 수 있음. 이번 승인 범위
    (체크아웃 화면)엔 미포함, 같은 버그 계열이라 후속 태스크 등록 권장 ② .fee-badge CSS 하드코딩
    색상은 이전 세션 잔존 이슈, 이번 수정과 무관 ③ diff에 이전 세션 완료분(마스터-디테일 레이아웃
    등)이 같은 파일이라 함께 포함— 기존에도 확인된 사항

GATE E: ✅ 통과 — BLOCKING 0건 (참고 3건 non-blocking) — git commit 진행 가능
(Migration #178 Production 적용은 GATE E 통과와 별개로 Stephen 별도 승인 필요)
