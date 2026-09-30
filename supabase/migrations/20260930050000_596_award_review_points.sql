-- Migration 596 — 포인트 자동적립: 리뷰 작성(review) 이벤트 (2026-09-30)
--
-- 배경: point_earn_rules(Migration #50)에 review 규칙이 있지만 실제로 지급하는 코드가
-- 없었음(award_rental_complete_points #407과 동일한 공백 클래스, Stephen 지시로 이번에 구현).
--
-- 정책(Stephen 확정, 2026-09-30):
--   ① 실제로 그 상품을 대여해 반납/완료까지 한 이력이 있는 고객만 적립 대상
--      (리뷰 작성 기능 자체(create_product_review)는 대여 이력을 확인하지 않으므로
--      아무나 아무 상품에나 리뷰를 쓸 수 있는 기존 동작은 그대로 두고, 적립 판정에서만
--      별도로 검증한다 — 리뷰 작성 제한 자체는 이번 스코프 밖)
--   ② 같은 상품에 대해 사용자당 최초 1회만 지급(리뷰를 여러 번 써도 반복 지급 안 됨)
--
-- 구현 위치: create_product_review RPC(Migration #123/#124) 내부, 리뷰 INSERT 직후.
--   별도 서버 라우트를 새로 만들지 않는 이유 — 이 RPC는 클라이언트에서 직접 호출되는
--   SECURITY DEFINER 함수라 auth.uid()를 이미 내부에서 신뢰할 수 있고, 파라미터 개수가
--   바뀌지 않으므로 CREATE OR REPLACE로 안전하게 확장 가능(products.md 문서화된
--   "파라미터 개수 변경 시 DROP 필요" 함정과 무관 — 이번엔 3개 그대로).
--
-- fail-soft: 적립 로직은 자체 BEGIN...EXCEPTION 블록으로 감싸 실패해도 리뷰 등록
--   자체는 정상 커밋된다(award_rental_complete_points와 동일한 "지급 실패가 메인 흐름을
--   막지 않는다" 원칙을 리뷰 INSERT 트랜잭션 내부에서 재현 — PL/pgSQL 예외 블록은
--   암묵적 세이브포인트라 그 안의 롤백이 바깥 INSERT까지 되돌리지 않음).
--
-- 리뷰↔대여이력 연결: product_reviews.product_id는 항상 "부모" 상품(고객 상품상세 페이지
--   기준, products.md §2-1), rental_reservations.product_id는 항상 "자식"(실제 배정된
--   재고단위) 상품이므로 products.parent_product_id로 연결한다.
--
-- grade_multipliers는 award_rental_complete_points(#407)와 동일하게 이번에도 미적용
--   (고객 등급 체계 자체가 아직 없다는 기존 확정 사항 유지).

CREATE OR REPLACE FUNCTION public.create_product_review(
  p_product_id UUID,
  p_title      TEXT,
  p_content    TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        UUID;
  v_user_id   UUID := auth.uid();
  v_name      TEXT;
  v_amount    INT;
  v_is_active BOOLEAN;
  v_eligible  BOOLEAN;
  v_already   BOOLEAN;
  v_new_balance INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;

  IF char_length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION '제목을 입력해주세요.';
  END IF;

  IF char_length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION '내용을 입력해주세요.';
  END IF;

  SELECT full_name INTO v_name
    FROM public.user_profiles WHERE user_id = v_user_id;

  INSERT INTO public.product_reviews (product_id, user_id, author_name, title, content)
    VALUES (p_product_id, v_user_id, COALESCE(v_name, '익명'), trim(p_title), trim(p_content))
    RETURNING id INTO v_id;

  -- ── 리뷰 작성 적립(fail-soft) ──
  BEGIN
    SELECT amount, is_active INTO v_amount, v_is_active
      FROM public.point_earn_rules WHERE event_type = 'review';

    IF v_amount IS NOT NULL AND v_is_active IS TRUE AND v_amount > 0 THEN
      SELECT EXISTS (
        SELECT 1
          FROM public.rental_reservations rr
          JOIN public.products p ON p.id = rr.product_id
         WHERE p.parent_product_id = p_product_id
           AND rr.user_id = v_user_id
           AND rr.status IN ('returned', 'completed')
      ) INTO v_eligible;

      IF v_eligible THEN
        SELECT EXISTS (
          SELECT 1 FROM public.point_transactions
           WHERE ref_type = 'review' AND ref_id = p_product_id::text AND user_id = v_user_id
        ) INTO v_already;

        IF NOT v_already THEN
          UPDATE public.user_profiles
             SET points = points + v_amount
           WHERE user_id = v_user_id
          RETURNING points INTO v_new_balance;

          IF FOUND THEN
            INSERT INTO public.point_transactions(
              user_id, type, amount, balance_after, description, ref_type, ref_id
            )
            VALUES (
              v_user_id, 'earn', v_amount, v_new_balance,
              '리뷰 작성 적립', 'review', p_product_id::text
            );
          END IF;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- 적립 실패해도 리뷰 등록 자체는 유지
  END;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_review TO authenticated;

-- ── ROLLBACK(참고용) ──
-- 이전(Migration #124) 버전으로 되돌리려면 그 파일의 CREATE OR REPLACE 본문을 재실행할 것.
