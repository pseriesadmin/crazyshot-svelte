-- Migration #495: foreign_verified_at은 콤보(4종) 전부 등록됐을 때만 기록
--
-- 배경: 2026-09-14 세션에서 외국인증명 등록 UX를 본인증명과 동일하게 "슬롯 1개 선택 시
-- 그 1건만 즉시 자동 병합 등록"으로 전환했다(기존엔 4종을 한 번에 함께 제출할 때만
-- update_user_doc_url(foreign)이 호출됐음). 그런데 이 RPC의 foreign 분기는 호출될 때마다
-- 문서 개수와 무관하게 무조건 foreign_verified_at = NOW()를 기록하고 있어, 이제 4종 중
-- 1개만 등록해도 "인증완료시각"이 즉시 찍히는 회귀가 발생했다(@sp3-qa-agent 검수로 발견,
-- HIGH). CMS 상담패널(src/lib/components/chat/CustomerDetailPanel.svelte)이
-- foreign_verified_at 존재 여부만으로 "완료"/"미완료"를 표시하므로, 실제로는 미완료인
-- 고객이 관리자 화면에 "완료"로 잘못 노출되는 컴플라이언스 성격의 표시 오류였다.
--
-- 수정: foreign_verified_at을 "제출된 문서 배열 길이가 4(콤보 완성)일 때만 NOW()로 기록,
-- 미달이면 NULL로 비움"으로 변경. array_length(p_doc_url,1) > 4는 바로 위에서 이미 에러
-- 처리되므로 이 지점에선 항상 <= 4 — "= 4"와 ">= 4"가 동치이나 의미를 명확히 하기 위해
-- ">= 4"로 작성(향후 콤보 개수 정책이 바뀌어도 상한 체크와 독립적으로 안전).
--
-- 부수 효과(의도된 동작): 완성된 콤보에서 개별삭제로 1개를 지우면(delete-doc-item 엔드포인트가
-- 동일 RPC를 재사용) 배열 길이가 3으로 줄어 foreign_verified_at이 자동으로 NULL로 비워진다
-- — "완료" 배지가 실제 등록 상태와 항상 정확히 일치하게 됨(이전에는 삭제해도 예전 시각이
-- 그대로 남아있었음, 이 역시 이번 수정으로 함께 해소).
--
-- identity 분기는 이번 회귀와 무관(항상 배치식 재등록/병합 둘 다 이미 존재하던 방식) —
-- identity_verified_at 로직은 그대로 유지, 손대지 않음.

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
   체류기간별 콤보 최대 4개 파일 배열 — foreign_doc_urls에 전체 저장 + foreign_doc_url에
   첫 파일만 하위호환 보관) 문서 URL을 저장. foreign_verified_at은 콤보 4종이 전부 등록됐을
   때만 기록되고, 미달이면 NULL로 비워진다(Migration #495 — 부분 제출 시 "완료" 오표시 방지).';
