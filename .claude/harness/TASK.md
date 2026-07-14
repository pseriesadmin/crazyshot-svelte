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
