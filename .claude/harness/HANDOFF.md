# HANDOFF.md — AI 세션 인수인계
# Harness Flow v3.2 | Claude Code ↔ Cursor AI 전환 시 필수 갱신
# 형식: AI_COLLAB_PROTOCOL.md 원칙 C 기준

---

## 최종 업데이트: 2026-07-07 (DB 파편화 수정 + $state 버그 수정 세션)

---

## 이번 세션 완료 내역

### DB 파편화 수정 + Svelte $state 버그 전수 수정

| ID | 내용 | 산출물 |
|----|------|--------|
| DB-1 | Stage DB "Sony FX6-12" 중복 3개 → 2개 soft-delete | REST API DML + Migration #77 |
| DB-2 | price_rules UNIQUE 제약 → partial index (WHERE deleted_at IS NULL) | Migration #77 DDL (Stage + Production) |
| DB-3 | updateSection/pricing soft-delete 행 재INSERT 버그 수정 | +page.server.ts pricing 섹션 |
| UI-1 | ProductDetailPanel 상품 전환 시 stale $state 버그 수정 | {#key data.selectedId} 래퍼 추가 |
| UI-2 | CalendarGrid $state 동기화 버그 수정 | $effect 추가 |
| RULE | $state(prop) 초기화 절대 금지 규칙 영구 등록 | core-rules.md + ui-mobile.md |

---

## 이전 세션 완료 내역

### T-CODE 시리즈 전체 완료 (상품코드 + 코드설정 연동)

| ID | 내용 | 산출물 |
|----|------|--------|
| T-CODE-0 | 헤더 slug→product_code 오류 수정 + slug 탭 복원 | ProductDetailPanel.svelte, +page.server.ts |
| T-CODE-1 | Migration #68 (product_code 시스템) + #69 (CA 더미 수정) | 마이그레이션 파일 2개, Stage + Prod 적용 완료 |
| T-CODE-2 | 신규 상품 등록 시 품번 자동 발행 | new/+page.server.ts |
| T-CODE-3 | 패널 헤더 product_code 표시 | T-CODE-0 포함 완료 |
| T-CODE-4 | 기존 상품 backfill | Migration #68 DO 블록 포함 |
| T-CODE-5 | cms_settings 키명 재검수 | 분리 불필요 판단, 주석 정정 |

---

## DB 현재 상태

### Stage (ezyvffjvuwmtuhpxdjrw)
- 마이그레이션 최신: **#77**까지 적용 완료
- 활성 products 3개: Sony FX6-12 (98f44cf6), DJI RS4 Pro (f0660be5), Manfrotto 055 (b83bc6f4)
- 중복 Sony FX6-12 2개 (232b4eba, 7f8fbb87) soft-deleted
- price_rules: partial unique index `price_rules_active_unique WHERE deleted_at IS NULL` 적용 완료

### Production (vnbpmvxruyciuuaermyh)
- 마이그레이션 최신: **#77 DDL** 적용 완료 (DML은 중복 없어서 불필요)
- price_rules partial unique index 동일하게 적용 완료

---

## 핵심 설계 결정 사항

### 1. slug vs product_code 분리 확립
- **slug**: URL 식별자 (영문 소문자/숫자/하이픈), 관리자 직접 입력
- **product_code**: 자동 생성 품번 (CS-CAM-all-001), 분류코드+포맷 기반 채번, 수정 불가

### 2. 품번 생성 경로 (현재 Fallback 동작)
```
상품 등록 → generate_product_code RPC
  Step 1: category_taxonomy_map 조회 → 현재 비어있음(0건) → Skip
  Fallback 1: product_category_codes.product_category 직접 조회
  Fallback 2: 카테고리명 앞 3자리 대문자 (SPT/MON/PWR/MED/STD/VID는 이 경로)
  → cms_settings.reservation_code_format 읽기
  → reset_monthly=false → year_month='all'
  → 시퀀스 채번 → CS-{CAT}-all-{seq}
```

### 3. cms_settings 키 공유 현황
- `reservation_code_format` 키 = 상품 품번 포맷에 현재 사용 중
- M3 예약코드 구현 시 `product_code_format` 키로 분리 필요 (BACKLOG 등록됨)

---

## 수정된 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/lib/components/cms/ProductDetailPanel.svelte` | 헤더 slug 편집 폼 제거 → product_code 읽기 전용, slug 탭 복원 |
| `src/routes/cms/products/+page.server.ts` | SelectedProduct 타입 product_code 필드 추가 |
| `src/routes/cms/products/new/+page.server.ts` | INSERT 후 generate_product_code RPC 자동 호출 추가 |
| `src/routes/cms/codes/+page.server.ts` | saveFormat 주석 정정 (예약코드→상품품번) |
| `supabase/migrations/20260706000068_68_product_code_system.sql` | 신규 — product_code 컬럼, 시퀀스 테이블, RPC, backfill |
| `supabase/migrations/20260706000069_69_fix_camera_code.sql` | 신규 — CA 더미 삭제, CAM 복구, 품번 재발행 |

---

## 다음 세션 권장 작업

### 즉시 필요 (BACKLOG)
1. **category_taxonomy_map 기본 매핑 입력**
   - SPT/MON/PWR/MED/STD/VID 의 product_category = null → Fallback 2 적용 중
   - /cms/codes 에서 매핑 직접 입력하거나 Migration으로 일괄 처리 필요

2. **edit/+page.server.ts category 변경 시 품번 재발행 정책 결정**
   - 현재: 수정 시 product_code 갱신 안 됨 (최초 등록 시만 발행)
   - 정책: category 변경 시 재발행 허용 여부 Stephen 결정 필요

### 다음 모듈
- S1-M4: Subscriptions (GSD)
- S1-M5: Shipments (GSD)

---

## 주의사항

- **git 자율 실행 금지** — Stephen만 직접 실행
- **마이그레이션 적용 순서**: stage 검증 → production 적용 절대 준수
- `generate_product_code` RPC: SECURITY DEFINER, service_role만 호출 가능
- `/cms/codes` 분류코드 삭제해도 기존 products.product_code 텍스트에 영향 없음

---

*HANDOFF.md | Harness Flow v3.2 | 2026-07-07 DB 파편화 수정 + $state 버그 수정 완료*
