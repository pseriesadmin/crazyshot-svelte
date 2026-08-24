-- Migration #333: public_holidays 확장 — holiday_type(national/manual) 구분 + CMS RLS 정정
--
-- 배경: public_holidays는 2026-05-29(#26)에 스키마만 생성되고 이후 앱 코드 어디서도 조회되지
-- 않던 미사용 테이블(2026-08-14 #244 복구 마이그레이션도 동일 스키마 재적용일 뿐, 사용처는
-- 여전히 없었음). 이번 "택배 휴무일 캘린더 제어" 기능에서 법정공휴일(API 자동동기화) +
-- 관리자 임시휴무일(CMS 수동등록)을 함께 담는 실사용 테이블로 재활용한다.
--
-- holiday_type 구분: 'national'(공공데이터포털 특일정보 API 동기화, CMS에서 개별 삭제 불가) /
-- 'manual'(관리자가 CMS에서 직접 추가/삭제하는 임시휴무일).
--
-- RLS 정정: 기존 관리자 정책이 is_admin()(고객 등급 개념, CMS 직원 권한과 무관)을 쓰고 있어
-- is_cms_user()로 교체 — products.md §2-8에서 이미 한 번 발견된 것과 동일한 함정.

ALTER TABLE public_holidays
  ADD COLUMN IF NOT EXISTS holiday_type TEXT NOT NULL DEFAULT 'national'
    CHECK (holiday_type IN ('national', 'manual')),
  ADD COLUMN IF NOT EXISTS note TEXT;

DROP POLICY IF EXISTS "public_holidays: 관리자 전체" ON public_holidays;

CREATE POLICY "public_holidays: 관리자 전체" ON public_holidays
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());
