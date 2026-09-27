-- Migration #558: 순번1(부모순번) 없는 1단 조합 부모상품의 code_series 중복 생성 DB 레벨 최종 차단
--
-- 배경: products.md §2-13 R1/R3("동일 부모 코드품번 상품 존재 불가")는 2026-09-24
-- 커밋(b7deab2)에서 앱레벨 SELECT-then-INSERT 체크(+page.server.ts cloneProduct)로 구현됐으나,
-- 그 체크는 순수 SELECT 후 INSERT라 진짜 동시 요청(서로 다른 탭/세션에서 같은 조합코드로
-- 거의 동시에 "새 상품 복제" 제출)에는 TOCTOU 경합구간이 남아있었다(같은 탭 내 재시도·연타는
-- 서버가 매 요청마다 새로 SELECT하고 isCloning 버튼 disable로 이미 막혀 있음 — 이번 수정은
-- 그 범위 밖의 "서로 다른 세션 간 동시 요청"만 추가로 닫는다).
--
-- 대상 범위: parent_product_id IS NULL(부모) + deleted_at IS NULL(삭제안됨) +
-- code_series에 parent_seq_digits 키가 없는 1단 조합만(2단 조합은 부모마다 product_parent_
-- sequences에서 parent_seq가 원자적으로 +1되어 항상 서로 달라 이 제약과 무관, products.md §2-3).
--
-- 커트오프(2026-09-24, 위 정책 커밋일 자정 KST) 이전 생성분은 제외: Stage DB에 그 이전
-- (2026-08-25) 생성된 레거시 중복 1쌍이 이미 존재함(category_code=HYP·year_month=all,
-- 하입팩 SET 상품 2건 — 이름이 서로 다른 실제 판매 상품이고 각각 활성 재고를 1개씩 보유해
-- products.md §2-11 reassign_product_code_series(재고 0개 부모 전용)로도 해소 불가 확인,
-- 2026-09-27 조회). 이 레거시 쌍을 손대지 않고 무조건적 UNIQUE를 걸면 이 마이그레이션 자체가
-- 기존 데이터 위반으로 실패하므로, 정책 시행일 이후 생성되는 신규 부모에만 적용되도록 커트오프를
-- 둔다. Production DB는 동일 조건 위반 데이터 0건 확인(2026-09-27 조회) — 커트오프는 Stage
-- 레거시 보존 목적일 뿐 Production 동작에는 영향 없음(사실상 무조건 적용과 동일).
--
-- 실제 위반 시점: generate_product_code(7-param) RPC의 ELSE 분기(parent_max_sequence IS NULL,
-- 즉 이 마이그레이션 대상과 동일한 1단 조합 케이스)가 이 UPDATE로 code_series를 기록하는
-- 시점에 충돌한다 — INSERT 시점(products 신규 행 생성)에는 code_series가 아직 NULL이라
-- 충돌하지 않는다. 경합에서 진 쪽은 +page.server.ts의 codeErr 처리(기존 max_sequence_exceeded
-- 등과 동일한 else 분기)로 흡수되어 "품번 발행 실패" cloneWarnings로 남고, 이미 INSERT된
-- 상품 행 자체는 §2-10① regWarn 패턴과 동일하게 "품번 미발행" 상태로 남는다(전체 요청을
-- 하드 실패시키지 않음 — §8-F/§8-G의 기존 "품번 채번 재시도"/"품번 체계 설정" 복구 UI로
-- 관리자가 직접 확인·재조치 가능).

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_single_tier_parent_code_series
  ON products ((code_series->>'category_code'), (code_series->>'year_month'))
  WHERE parent_product_id IS NULL
    AND deleted_at IS NULL
    AND code_series IS NOT NULL
    AND NOT (code_series ? 'parent_seq_digits')
    AND created_at >= '2026-09-24 00:00:00+09';
