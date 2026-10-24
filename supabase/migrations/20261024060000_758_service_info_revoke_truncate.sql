-- Migration #758: '서비스 기본 정보' 표의 로그인 계정 TRUNCATE·REFERENCES·TRIGGER 권한 회수 (심층 방어, #757 sp3 검수 MINOR-1, Stephen 지시 "A로 진행")
-- 배경: #757 로 INSERT/UPDATE/DELETE 는 RLS 정책(매니저 이상)이 통제하지만, TRUNCATE·REFERENCES·TRIGGER 는 RLS 가 적용되지 않는 권한이다.
--       authenticated 에 이 권한이 남아 있었다(Stage·Production 실측). PostgREST(API)에는 TRUNCATE 호출 경로가 없고 최종 사용자가 직접 SQL 을 실행할 수 없어 현재 악용 경로는 없었지만 권한 자체를 회수한다.
-- 영향: 앱은 이 표를 사용자 세션으로 직접 쓰지 않는다(저장은 SECURITY DEFINER 함수·읽기는 공개 RPC·정책관리 로드는 service_role). 매니저 이상의 INSERT/UPDATE/DELETE 는 그대로.

REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.service_info_settings FROM authenticated;

-- ROLLBACK: GRANT TRUNCATE, REFERENCES, TRIGGER ON public.service_info_settings TO authenticated;
