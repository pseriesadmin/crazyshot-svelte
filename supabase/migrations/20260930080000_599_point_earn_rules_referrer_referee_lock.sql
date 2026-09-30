-- Migration 599 — 추천인/피추천인 적립 규칙 "준비중" 고정 (2026-09-30)
--
-- 배경: 추천 시스템(추천코드 발급·추적) 자체가 프로젝트에 아직 없어(referral_code 등
-- 관련 컬럼·테이블 전수 검색 결과 0건) referrer/referee 적립을 지급할 방법이 없다.
-- CMS 화면에서 이 두 행의 "활성" 토글을 켜도 실제로 지급되는 코드가 없어 관리자에게
-- 오해를 줄 수 있으므로, Stephen 지시에 따라 이번 세션에서는 "준비중(비활성)" 상태를
-- 명시적으로 고정한다(추천 시스템 자체 구현은 이번 스코프 밖 — 별도 신규 기능 건).
--
-- ① description을 "준비중" 안내 문구로 갱신 — CMS 화면(+page.svelte)이 이미 각 행의
--    description을 라벨 아래에 그대로 렌더링하므로 클라이언트 수정 없이 안내된다.
-- ② update_point_earn_rule RPC에 가드 추가 — referrer/referee는 p_is_active로 무엇을
--    넘기든 항상 false로 강제 저장한다. CMS 화면의 토글 UI를 우회해 API를 직접 호출해도
--    활성화될 수 없도록 정본(RPC)에서 막는다(UI 비활성화는 보조 수단일 뿐).

UPDATE public.point_earn_rules
   SET description = '추천 시스템(추천코드 발급·추적) 미구축 — 준비중, 활성화 불가',
       is_active = false,
       updated_at = now()
 WHERE event_type IN ('referrer', 'referee');

CREATE OR REPLACE FUNCTION public.update_point_earn_rule(
  p_event_type       VARCHAR(30),
  p_amount           INT DEFAULT NULL,
  p_rate             NUMERIC(5,4) DEFAULT NULL,
  p_is_active        BOOLEAN DEFAULT NULL,
  p_grade_multipliers JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_active BOOLEAN := p_is_active;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  -- 추천인/피추천인: 추천 시스템 미구축 — 활성화 요청을 항상 강제로 거부(준비중 고정)
  IF p_event_type IN ('referrer', 'referee') THEN
    v_is_active := false;
  END IF;

  UPDATE point_earn_rules
  SET
    amount            = COALESCE(p_amount, amount),
    rate              = COALESCE(p_rate, rate),
    is_active         = COALESCE(v_is_active, is_active),
    grade_multipliers = COALESCE(p_grade_multipliers, grade_multipliers),
    updated_at        = now()
  WHERE event_type = p_event_type;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RULE_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── ROLLBACK(참고용) ──
-- update_point_earn_rule은 Migration #51 버전(가드 없음)으로 CREATE OR REPLACE 재적용.
-- description/is_active 원복은 별도 데이터 마이그레이션 필요(원문은 Migration #50 참고).
