-- Migration 456: allowed_pickup_ids 빈 배열([]) → null 일괄 정정 (+ NOT NULL 완화)
--
-- 배경(2026-09-07 발견): Migration 455에서 allowed_method_ids에 적용했던 것과 완전히
-- 동일한 결함이 allowed_pickup_ids(방문 지점 허용 목록)에도 있었다. CMS "대여정책" 탭
-- 저장 로직이 관리자가 방문 지점을 하나도 선택하지 않고 저장하면 빈 배열([])을 저장해왔고,
-- 카트(cart/+page.svelte computeAllowedPickupIds)는 "allowed_pickup_ids 미설정 상품 →
-- 전체 허용"을 의도했지만 Array.isArray([])가 true라 빈 배열이 "허용 지점 0개로 명시
-- 제한"으로 오인됐다. 그 결과 그런 상품이 다른 상품과 함께 장바구니에 담기면 교집합이
-- 항상 빈 값이 되어 "등록된 방문 지점이 없습니다" — 실제로는 방문 지점이 등록돼 있는데도
-- 방문대여 선택 UI 자체가 완전히 사라지는 실사용 결함으로 이어졌다.
--
-- 저장 로직 자체는 이미 수정 완료(cms/products/+page.server.ts, cms/products/new/
-- +page.server.ts — 같은 세션) — 이 마이그레이션은 그 수정 이전에 이미 []로 잘못
-- 저장된 기존 상품 데이터를 일괄 정정한다. 카트 측에는 이미 방어 로직(빈 배열도 null과
-- 동일하게 취급)이 추가돼 있어 이 마이그레이션 적용 여부와 무관하게 실사용 영향은
-- 없었으나, 데이터 정합성을 저장 로직의 새 계약과 일치시키기 위해 적용한다.
--
-- Migration 455와 동일하게 컬럼이 NOT NULL DEFAULT ARRAY[]::uuid[]로 정의돼 있어(Migration
-- #125) null UPDATE가 제약 위반으로 실패한다 — 제약을 먼저 완화한다. 애플리케이션 코드
-- 읽기 지점 전수 확인 결과(loadSelectedProductDetail.ts:175, cart/+page.server.ts:262·270,
-- cart/+page.svelte:1360) 이미 전부 `string[] | null` 타입 + `?? []`/`length===0` 가드로
-- null을 안전하게 처리하도록 작성돼 있었다. RPC 소비처(Migration #130,
-- `WHERE allowed_pickup_ids @> ARRAY[p_id]`)도 NULL @> x = NULL(=false 취급)이라 빈
-- 배열과 동일하게 안전.
--
-- 영향 범위: allowed_pickup_ids = '{}'::uuid[] 인 행만 대상 — 실제로 값이 채워진 행은
-- 무영향. allowed_period_ids는 이번 요청 범위 밖이라 건드리지 않는다.

ALTER TABLE public.products ALTER COLUMN allowed_pickup_ids DROP NOT NULL;

UPDATE public.products
SET allowed_pickup_ids = NULL
WHERE allowed_pickup_ids = '{}'::uuid[];

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- UPDATE public.products SET allowed_pickup_ids = '{}'::uuid[] WHERE allowed_pickup_ids IS NULL;
-- ALTER TABLE public.products ALTER COLUMN allowed_pickup_ids SET NOT NULL;
-- ============================================================
