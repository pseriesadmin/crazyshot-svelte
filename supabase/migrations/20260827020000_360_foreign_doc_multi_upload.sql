-- Migration #360: 외국인증명 체류기간별 콤보버튼 + 다중 파일 등록 지원
-- 배경: 내정보 > 개인정보 > 외국인 증명 탭에 단기체류(90일 내)/장기체류(90일 이상) 하위 선택과
-- 체류기간별 필수 증명서 콤보 버튼(각 4종)을 추가하는 UI 요청 — 실제로 동작하려면 파일을
-- 최대 4개까지 한 번에 등록할 수 있어야 한다(Stephen 확정: "다중 파일 저장까지 함께 구현").
--
-- 기존 foreign_doc_url(TEXT, 1개 파일 전용) 컬럼은 CMS 고객상세·채팅 상담패널·products 상세
-- 인증여부 체크 등 여러 화면이 스칼라 문자열로 그대로 읽고 있어(요청 범위 밖), 타입을
-- 바꾸면 그 화면들이 전부 깨진다. 그래서 identity_doc_url처럼 기존 컬럼을 배열로 "전환"하지
-- 않고, 신규 컬럼(foreign_doc_urls TEXT[])을 추가하는 방식을 택한다 — foreign_doc_url은
-- 계속 "첫 번째 파일" 대표값만 담아 기존 화면과 100% 하위호환 유지, 전체 파일 목록은
-- foreign_doc_urls가 별도로 보관한다.

-- 1. 신규 컬럼 추가
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS foreign_doc_urls   TEXT[],
  ADD COLUMN IF NOT EXISTS foreign_type       TEXT[],
  ADD COLUMN IF NOT EXISTS foreign_stay_type  TEXT;

-- 2. 기존 단일 파일 등록자 백필 — foreign_doc_url이 있는데 foreign_doc_urls가 없으면
--    1개짜리 배열로 보존(기존 등록자가 새 UI에서 "미등록"으로 보이지 않도록)
UPDATE user_profiles
SET foreign_doc_urls = ARRAY[foreign_doc_url]
WHERE foreign_doc_url IS NOT NULL
  AND foreign_doc_urls IS NULL;

-- 3. 제약 조건
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_foreign_doc_urls_max4
  CHECK (foreign_doc_urls IS NULL OR array_length(foreign_doc_urls, 1) <= 4);

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_foreign_type_check
  CHECK (
    foreign_type IS NULL
    OR foreign_type <@ ARRAY[
      'passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket',
      'arc_front', 'arc_back', 'foreign_fact_cert'
    ]::text[]
  );

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_foreign_stay_type_check
  CHECK (foreign_stay_type IS NULL OR foreign_stay_type IN ('short', 'long'));

COMMENT ON COLUMN user_profiles.foreign_doc_urls IS
  '외국인증명 파일 공개 URL 배열(최대 4개, Supabase Storage user-documents). foreign_doc_url
   (하위호환 스칼라, 첫 번째 파일만 보관)과 별개로 전체 파일 목록을 보관.';
COMMENT ON COLUMN user_profiles.foreign_type IS
  '외국인증명 체류기간별 필수 증명서 종류(다중 선택): passport_photo(여권사진면) |
   accommodation_reservation(숙소예약확인서) | entry_eticket(입국 E-Ticket) |
   exit_eticket(출국 E-Ticket) | arc_front(외국인등록증 앞면) | arc_back(외국인등록증 뒷면) |
   foreign_fact_cert(외국인사실증명서) | NULL(미등록)';
COMMENT ON COLUMN user_profiles.foreign_stay_type IS
  '외국인증명 체류기간 구분: short(단기체류, 90일 내) | long(장기체류, 90일 이상) | NULL(미등록)';

-- 4. update_user_doc_url RPC 재발행 — p_foreign_type/p_foreign_stay_type 신규 인자 추가
--    (인자 개수가 늘어나므로 기존 3-param 버전을 명시적으로 DROP — products.md §2-3/
--    Migration #345·#346과 동일 이유로 오버로드 공존 시 PostgREST 호출 모호성(PGRST203) 위험)
DROP FUNCTION IF EXISTS update_user_doc_url(TEXT, TEXT[], TEXT[]);

CREATE FUNCTION update_user_doc_url(
  p_type              TEXT,
  p_doc_url           TEXT[],
  p_identity_type     TEXT[] DEFAULT NULL,
  p_foreign_type      TEXT[] DEFAULT NULL,
  p_foreign_stay_type TEXT   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_type NOT IN ('identity', 'foreign') THEN
    RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 문서 유형');
  END IF;

  IF p_doc_url IS NULL OR array_length(p_doc_url, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '파일이 없습니다.');
  END IF;

  IF p_type = 'identity' THEN
    IF array_length(p_doc_url, 1) > 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', '최대 5개까지 등록할 수 있어요.');
    END IF;

    IF p_identity_type IS NOT NULL AND
       NOT (p_identity_type <@ ARRAY['general', 'student', 'enrollment', 'resident', 'resident_copy', 'driver', 'other']::text[]) THEN
      RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 증명 종류');
    END IF;

    UPDATE user_profiles
    SET
      identity_doc_url     = p_doc_url,
      identity_verified_at = NOW(),
      identity_type        = COALESCE(p_identity_type, identity_type, ARRAY['general']::text[]),
      updated_at           = NOW()
    WHERE user_id    = auth.uid()
      AND deleted_at IS NULL;

  ELSIF p_type = 'foreign' THEN
    IF array_length(p_doc_url, 1) > 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', '최대 4개까지 등록할 수 있어요.');
    END IF;

    IF p_foreign_stay_type IS NOT NULL AND p_foreign_stay_type NOT IN ('short', 'long') THEN
      RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 체류 유형');
    END IF;

    IF p_foreign_type IS NOT NULL AND
       NOT (p_foreign_type <@ ARRAY[
         'passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket',
         'arc_front', 'arc_back', 'foreign_fact_cert'
       ]::text[]) THEN
      RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 증명 종류');
    END IF;

    UPDATE user_profiles
    SET
      foreign_doc_url     = p_doc_url[1],
      foreign_doc_urls    = p_doc_url,
      foreign_verified_at = NOW(),
      foreign_type        = COALESCE(p_foreign_type, foreign_type),
      foreign_stay_type   = COALESCE(p_foreign_stay_type, foreign_stay_type),
      is_foreign          = true,
      updated_at          = NOW()
    WHERE user_id    = auth.uid()
      AND deleted_at IS NULL;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '사용자를 찾을 수 없습니다');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_doc_url(TEXT, TEXT[], TEXT[], TEXT[], TEXT) TO authenticated;

COMMENT ON FUNCTION update_user_doc_url(TEXT, TEXT[], TEXT[], TEXT[], TEXT) IS
  '인증된 사용자가 자신의 본인증명(identity, 최대 5개 파일 배열) 또는 외국인증명(foreign,
   체류기간별 콤보 최대 4개 파일 배열 — foreign_doc_urls에 전체 저장 + foreign_doc_url에
   첫 파일만 하위호환 보관) 문서 URL을 저장.';

-- 5. delete_user_doc RPC 갱신 — foreign 삭제 시 신규 컬럼도 함께 초기화
--    (인자 시그니처는 변경 없음 — CREATE OR REPLACE로 충분, DROP 불필요)
CREATE OR REPLACE FUNCTION delete_user_doc(
  p_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_type NOT IN ('identity', 'foreign') THEN
    RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 문서 유형');
  END IF;

  IF p_type = 'identity' THEN
    UPDATE user_profiles
    SET
      identity_doc_url     = NULL,
      identity_type        = NULL,
      identity_verified_at = NULL,
      updated_at           = NOW()
    WHERE user_id    = auth.uid()
      AND deleted_at IS NULL;

  ELSIF p_type = 'foreign' THEN
    UPDATE user_profiles
    SET
      foreign_doc_url     = NULL,
      foreign_doc_urls    = NULL,
      foreign_type        = NULL,
      foreign_stay_type   = NULL,
      foreign_verified_at = NULL,
      is_foreign          = false,
      updated_at          = NOW()
    WHERE user_id    = auth.uid()
      AND deleted_at IS NULL;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '사용자를 찾을 수 없습니다');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION delete_user_doc(TEXT) IS
  '인증된 사용자가 자신의 본인증명(identity) 또는 외국인증명(foreign, foreign_doc_urls·
   foreign_type·foreign_stay_type 포함 전체 초기화) 등록 정보를 완전히 삭제(NULL 초기화)한다.';
