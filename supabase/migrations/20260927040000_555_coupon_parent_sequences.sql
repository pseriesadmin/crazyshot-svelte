-- Migration #555: coupon_parent_sequences 신규 테이블
-- 목적: 쿠폰 발행("레코드 생성") 시점에 부여되는 "발행 순번"(issue_seq) 전용 원자 카운터.
--   product_parent_sequences(Migration #214)와 완전히 동일한 패턴이나, 상품과 카운터를
--   공유하지 않는 완전히 별도 테이블이다 — 쿠폰 코드 채번 체계는 상품 채번 체계와 무관.
--
-- 배경(Plan "쿠폰 생성 7건 결함 보완" 4번+7번): 쿠폰도 상품처럼 코드조합 화면에서
-- "부모 순번(2단 계층)" 설정을 노출하고 있었지만, 실제 채번 RPC(cms_create_coupon)는
-- 이 값을 전혀 읽지 않아 아무 효과가 없었다. 이 테이블은 그 부모 순번을 실제로
-- 소비시키기 위한 카운터다.
--
-- ⚠️ 이 값(issue_seq)은 CMS 발행관리 목록에서 "몇 번째로 발행된 쿠폰 레코드인가"를
-- 식별하기 위한 표시 전용 값이다. 고객에게 실제 발급되는 redeemed_code(사용 시점 실채번,
-- generate_user_coupon_redeemed_code/coupon_code_sequences)와는 완전히 별개 숫자다 —
-- "발행 개수 식별"과 "사용 코드 상한"이라는 서로 다른 의미를 한 숫자에 섞지 않기 위해
-- 의도적으로 분리했다(Stephen 확정).

CREATE TABLE IF NOT EXISTS public.coupon_parent_sequences (
  category_code TEXT NOT NULL,
  year_month    TEXT NOT NULL,   -- code_series.date_option='yyyymm'→해당월, 그 외→'nodate'
  next_seq      INT  NOT NULL DEFAULT 2,  -- INSERT 시 2를 넣어 RETURNING next_seq-1=1 얻음
  PRIMARY KEY (category_code, year_month)
);

COMMENT ON TABLE public.coupon_parent_sequences IS
  '쿠폰 "발행 순번"(issue_seq) 전용 카운터. category_code + year_month 단위로 쿠폰 레코드
   생성 순번을 단조증가 관리. INSERT ... ON CONFLICT DO UPDATE SET next_seq = next_seq + 1
   패턴으로 원자적 채번. 순번은 1부터 시작. products.product_parent_sequences와 동일 패턴이나
   완전히 별도 테이블(카운터 공유 금지) — 상품 채번 체계와 무관.';

ALTER TABLE public.coupon_parent_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_coupon_parent_sequences"
  ON public.coupon_parent_sequences
  FOR ALL
  USING (auth.role() = 'service_role');

REVOKE ALL ON public.coupon_parent_sequences FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.coupon_parent_sequences TO service_role;

-- ─────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.coupon_parent_sequences;
