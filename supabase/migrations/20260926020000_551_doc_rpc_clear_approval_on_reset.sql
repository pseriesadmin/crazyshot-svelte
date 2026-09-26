-- Migration #551: 승인 잠금 데드락 방지 — 제출시각(*_verified_at)을 NULL로 비울 때 승인시각(*_approved_at)도 함께 NULL
--
-- 배경(sp3-qa-agent 2차 GATE E M-A): #550의 잠금 판정은 "verified_at이 NULL이면 승인으로 간주"인데,
-- delete_user_doc(전체삭제)과 update_user_doc_url(foreign, 문서 4개 미만 — #495)은 verified_at만 NULL로
-- 비우고 approved_at은 남긴다. 관리자가 승인된 증명서를 CMS에서 재등록해 잠금이 풀린(approved<verified)
-- 상태에서 고객이 삭제하거나 foreign을 4개 미만으로 줄이면 verified=NULL + approved 잔존 → 문서 없이
-- 잠겨 업로드·삭제가 모두 막히는 데드락이 된다(탈출구는 CMS 승인취소뿐). Stephen 결정(B안):
-- 두 RPC가 verified_at을 NULL로 만들 때 approved_at도 함께 NULL로 초기화한다. 판정식(SQL·TS)은 무변경.
--
-- 변경점(#550 대비 이것뿐): delete_user_doc의 identity/foreign UPDATE에 *_approved_at = NULL 추가,
-- update_user_doc_url(foreign)에 foreign_approved_at = CASE WHEN array_length(p_doc_url,1) >= 4
-- THEN foreign_approved_at ELSE NULL END 추가(4개 이상이면 기존 값 유지 — 어차피 여기 도달하면
-- 미잠금 상태라 approved<새 verified_at 이 되어 검토 대기).
-- 시그니처·GRANT 유지, #550 파일은 수정하지 않는다(GP-10).
--
-- ROLLBACK: 두 함수를 #550 정의로 CREATE OR REPLACE.

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
      foreign_approved_at = CASE WHEN array_length(p_doc_url, 1) >= 4 THEN foreign_approved_at ELSE NULL END,
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
   등록됐을 때만 기록(#495). 관리자가 승인한 증명서는 저장 거부(#550 — 승인 후 재제출 시엔 다시 가능). 제출시각을 비울 때 승인시각도 함께 비움(#551).';

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
      identity_approved_at = NULL,
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
      foreign_approved_at = NULL,
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
   관리자가 승인한 증명서는 삭제 거부(#550). 삭제 시 승인시각도 함께 초기화(#551).';
