# GSD_LOG.md — 크레이지샷 실행 이력
# 형식: [YYYY-MM-DD HH:MM] 타입 | 태스크명 | 파일 | 소요 | 결과

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
