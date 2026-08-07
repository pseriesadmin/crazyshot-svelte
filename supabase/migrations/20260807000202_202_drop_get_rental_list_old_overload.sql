-- Migration 202: get_rental_list — 구 6-인자 오버로드 제거
--
-- 배경: migration 201에서 CREATE OR REPLACE FUNCTION으로 p_include_statuses/
--   p_exclude_statuses를 trailing 파라미터로 추가했으나, PostgreSQL은 파라미터 목록(타입
--   시퀀스)이 다르면 CREATE OR REPLACE라도 기존 함수를 "교체"하지 않고 별도 오버로드로
--   추가한다 — 그 결과 6-인자 구버전과 8-인자 신버전이 동시에 존재하게 됨을 배포 직후
--   실제 조회(pg_proc)로 확인.
--   이 상태로 두면 향후 누군가 get_rental_list를 신규 파라미터 없이(원래 6개 인자만) 호출할
--   경우 PostgREST가 "6-인자 정확매치"와 "8-인자에서 뒤 2개를 기본값으로" 사이에서 오버로드를
--   구분하지 못해 PGRST203(모호성) 에러가 난다 — products.md §2-3에 이미 기록된
--   generate_product_code와 동일한 함정.
-- 조치: 구 6-인자 오버로드를 DROP해 get_rental_list를 8-인자 단일 함수로 확정한다.
--   (신 함수는 뒤 2개 인자 모두 DEFAULT NULL이라 기존 호출부와 하위호환 유지)

DROP FUNCTION IF EXISTS public.get_rental_list(
  p_status    TEXT,
  p_search    TEXT,
  p_date_from DATE,
  p_date_to   DATE,
  p_page      INTEGER,
  p_per_page  INTEGER
);
