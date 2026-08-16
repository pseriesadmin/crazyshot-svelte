-- Migration #276: member_code_sequences.member_type 컬럼 폭 확장 — CRITICAL 버그 수정
--
-- 배경: migration 274(회원코드 코드조합 기준설정) GATE E 검수(@sp3-qa-agent, 2026-08-17) 중
-- Stage DB 직접 RPC 호출로 재현 확인된 CRITICAL 결함.
--
-- 문제: member_code_sequences.member_type은 migration 97에서 'BC'/'BB' 고정 2글자 값만
-- 전제하고 VARCHAR(2)로 정의됐다. migration 274는 generate_member_code의 시퀀스 키를
-- v_type_code(override 지정 시 코드조합에서 뽑아낸 실제 접두어, 가변 길이)로 바꿨는데
-- (member_type 기준 키는 B2C/B2B가 override 사용 시 동일 접두어를 공유하면서도 서로 다른
-- 카운터에서 번호를 받아 충돌하는 별도 버그가 있어 그렇게 고쳤음 — 그 수정 자체는 정확함),
-- product_category_codes.code는 2~4자가 섞여 있고 콤보는 여러 코드를 이어붙일 수 있어
-- 2글자를 넘는 override가 얼마든지 나올 수 있다. 이 경우
--   INSERT INTO member_code_sequences (member_type, ...) VALUES (v_type_code, ...)
-- 가 "value too long for type character varying(2)"(22001)로 실패하고, 이 예외가
-- trg_auto_assign_member_code(BEFORE INSERT)를 통해 user_profiles INSERT 자체를 막아
-- 신규 회원가입 전체를 깨뜨릴 수 있다. 현재 Stage에 저장된 기준값 'GS'가 우연히 2자라
-- 지금까지 발현되지 않았을 뿐, 관리자가 3자 이상 코드를 조합 기준으로 저장하면 즉시 재현된다.
--
-- 수정: product_code_sequences.category_code(VARCHAR(30), migration 41)와 동일한 폭으로
-- 확장 — 기존 'BC'/'BB' 값과 인덱스·UNIQUE 제약(member_type, year_month)은 그대로 유지되므로
-- 데이터 마이그레이션 불필요, 컬럼 타입만 넓힌다.

ALTER TABLE member_code_sequences
  ALTER COLUMN member_type TYPE VARCHAR(30);

COMMENT ON COLUMN member_code_sequences.member_type IS
  '채번 시퀀스 키 — override 미지정 시 BC/BB 고정값, override 지정 시 코드조합에서 계산된
   실제 표시 접두어(가변 길이, 최대 30자). VARCHAR(30)은 product_code_sequences.category_code와
   동일 폭(migration 41 선례).';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- ALTER TABLE member_code_sequences ALTER COLUMN member_type TYPE VARCHAR(2);
--   (⚠️ 롤백 전 반드시 2자 초과 값이 없는지 확인 — 있으면 타입 축소 자체가 실패함)
-- ============================================================
