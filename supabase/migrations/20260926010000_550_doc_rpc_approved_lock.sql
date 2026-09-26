-- Migration #550: 관리자 승인된 본인증명·외국인증명은 고객 RPC(update_user_doc_url / delete_user_doc)로도 수정·삭제 불가
--
-- 배경: 고객 마이페이지에서 관리자가 승인(identity_approved_at / foreign_approved_at, migration #526)한
-- 증명서의 수정·삭제 UI를 숨기고 API(/api/profile/upload-doc·delete-doc·delete-doc-item)를 403으로
-- 막았으나(2026-09-26), 두 RPC가 authenticated에 EXECUTE가 부여된 SECURITY DEFINER라 로그인 고객이
-- 브라우저에서 supabase.rpc(...)를 직접 호출하면 API 가드를 우회해 승인된 문서를 바꾸거나 지울 수
-- 있었다(sp3-qa-agent GATE E B1). 서버 API 가드와 동일한 판정을 두 RPC 앞머리에도 둔다.
--
-- 승인 판정 = *_approved_at IS NOT NULL AND (*_verified_at IS NULL OR *_approved_at >= *_verified_at)
--   (migration #526 "검토 대기" 판정식의 반대 — 승인 후 재제출되면 다시 검토대기라 수정 가능)
--
-- 시그니처·GRANT·본문 로직은 최신 정의(update_user_doc_url = #495, delete_user_doc = #360)를 그대로
-- 유지하고 "승인 잠금 체크"만 추가한다. CREATE OR REPLACE는 기존 ACL(authenticated EXECUTE)을 보존한다.
-- 관리자 재등록은 service_role 경로(/api/cms/upload-doc)라 auth.uid()를 쓰는 이 RPC들과 무관.
--
-- ROLLBACK: 아래 두 함수를 각각 #495(update_user_doc_url) / #360(delete_user_doc) 정의로
--   CREATE OR REPLACE 하면 원복(잠금 체크 제거).

CREATE OR REPLACE FUNCTION update_user_doc_url(
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

  -- 관리자 승인 잠금(#550)
  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL
      AND CASE p_type
            WHEN 'identity' THEN identity_approved_at IS NOT NULL
                                 AND (identity_verified_at IS NULL OR identity_approved_at >= identity_verified_at)
            ELSE                 foreign_approved_at  IS NOT NULL
                                 AND (foreign_verified_at  IS NULL OR foreign_approved_at  >= foreign_verified_at)
          END
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', '관리자가 승인한 증명서는 수정·삭제할 수 없어요.');
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
      foreign_verified_at = CASE WHEN array_length(p_doc_url, 1) >= 4 THEN NOW() ELSE NULL END,
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

COMMENT ON FUNCTION update_user_doc_url(TEXT, TEXT[], TEXT[], TEXT[], TEXT) IS
  '인증된 사용자가 자신의 본인증명(identity, 최대 5개 파일 배열) 또는 외국인증명(foreign,
   체류기간별 콤보 최대 4개 파일 배열) 문서 URL을 저장. foreign_verified_at은 콤보 4종이 전부
   등록됐을 때만 기록(#495). 관리자가 승인한 증명서는 저장 거부(#550 — 승인 후 재제출 시엔 다시 가능).';

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

  -- 관리자 승인 잠금(#550)
  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL
      AND CASE p_type
            WHEN 'identity' THEN identity_approved_at IS NOT NULL
                                 AND (identity_verified_at IS NULL OR identity_approved_at >= identity_verified_at)
            ELSE                 foreign_approved_at  IS NOT NULL
                                 AND (foreign_verified_at  IS NULL OR foreign_approved_at  >= foreign_verified_at)
          END
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', '관리자가 승인한 증명서는 수정·삭제할 수 없어요.');
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
  '인증된 사용자가 자신의 본인증명(identity) 또는 외국인증명(foreign) 등록 정보를 완전히 삭제(NULL 초기화)한다.
   관리자가 승인한 증명서는 삭제 거부(#550).';
