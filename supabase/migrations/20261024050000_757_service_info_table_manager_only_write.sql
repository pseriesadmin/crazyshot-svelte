-- Migration #757: '서비스 기본 정보' 표 직접 쓰기도 매니저 이상 전용으로 (#756 sp3 검수 미검증 U-3 확인 결과, Stephen 지시 "서비스 기본 정보 저장 권한도 막아줘"의 완결)
-- 배경: #756 은 저장 함수(upsert_service_info_settings)만 매니저 이상으로 좁혔다. 그런데 표 service_info_settings 에는 정책 "service_info_settings: cms 관리"(FOR ALL, 대상 public, is_cms_user())가 있고
--       authenticated·anon 에 표 INSERT/UPDATE/DELETE 권한이 부여돼 있어(Stage·Production 모두 확인), partner(협력사) 관리자가 함수를 거치지 않고 PostgREST 로 표를 직접 고치거나 지울 수 있었다 → 함수만 막으면 우회된다.
-- 변경: ① "cms 관리" 정책을 삭제하고 같은 이름으로 authenticated 대상·is_cms_manager_or_above() 조건(USING·WITH CHECK)으로 다시 만든다. ② anon·PUBLIC 의 표 쓰기 권한(INSERT·UPDATE·DELETE 등)을 회수한다(읽기는 유지 — 공개 조회 정책·get_service_info_settings 가 푸터·계약서에서 비로그인으로도 쓰인다).
-- 유지: "service_info_settings: 공개 조회" SELECT 정책(using true), get_service_info_settings, 저장 함수(#756), 서버가 service_role 로 읽는 정책관리 화면 로드(RLS 무관).
-- 영향: manager·superadmin 은 이전과 같이 쓸 수 있다(함수 경유가 기본, 표 직접 쓰기도 가능). partner·고객·비로그인은 표를 직접 쓸 수 없다.

DROP POLICY IF EXISTS "service_info_settings: cms 관리" ON public.service_info_settings;

CREATE POLICY "service_info_settings: cms 관리"
  ON public.service_info_settings
  FOR ALL
  TO authenticated
  USING (public.is_cms_manager_or_above())
  WITH CHECK (public.is_cms_manager_or_above());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.service_info_settings FROM PUBLIC, anon;

-- ROLLBACK (#566 정의로 되돌리기 — partner 가 표를 직접 쓸 수 있게 되므로 신중히):
-- DROP POLICY IF EXISTS "service_info_settings: cms 관리" ON public.service_info_settings;
-- CREATE POLICY "service_info_settings: cms 관리" ON public.service_info_settings FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());
-- GRANT INSERT, UPDATE, DELETE ON public.service_info_settings TO anon;  -- 필요한 경우에만(원래는 기본 권한으로 부여돼 있었음)
