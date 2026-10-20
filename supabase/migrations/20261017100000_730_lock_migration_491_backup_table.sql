-- Migration 730: Production 전용 백업 테이블 _migration_491_backup 접근 보호(RLS) 켜기
--
-- 배경(2026-10-17 Stage↔Production 점검): Migration 491 실행 때 만들어진 백업 테이블
-- (public._migration_491_backup, 42행: id·old_image_urls·backed_up_at)에 RLS가 꺼져 있고 anon·authenticated에
-- SELECT 권한이 있어, 비로그인 사용자도 PostgREST로 읽을 수 있었다. 내용은 상품 이미지 주소의 옛 백업이라
-- 개인정보는 아니지만 공개할 이유가 없다.
--
-- 변경: RLS만 켠다(정책 0건 = anon·authenticated 전부 차단). 데이터·권한·테이블 자체는 변경·삭제하지 않는다.
--   · service_role·테이블 소유자는 RLS를 우회하므로 491 주석에 적힌 복원 절차(UPDATE ... FROM _migration_491_backup)는 그대로 동작.
--   · 앱 코드·뷰·함수가 이 테이블을 참조하지 않음을 사전 확인(참조는 491 파일 주석뿐).
--   · 테이블이 없는 환경(Stage)에서는 아무것도 하지 않는다(재실행 안전).
--
-- ROLLBACK: ALTER TABLE public._migration_491_backup DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public._migration_491_backup') IS NOT NULL THEN
    PERFORM set_config('lock_timeout', '3s', true);
    ALTER TABLE public._migration_491_backup ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
