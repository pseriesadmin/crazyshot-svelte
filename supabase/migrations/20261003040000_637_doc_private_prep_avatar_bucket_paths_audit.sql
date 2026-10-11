-- Migration #637: 서류 비공개 전환 B2a — 아바타 전용 공개 버킷 + 서류 값 경로화 + 열람 감사 제약 확장 (2026-10-03, Stephen 승인 플랜 웨이브 B)
--
-- 배경: 본인증명·외국인증명 서류가 공개 버킷 user-documents에 getPublicUrl 전체 URL로 저장돼, URL만 알면 로그인 없이 영구 열람됐다
--   (실서버 점검 H1). B1(코드)에서 공개 URL·경로 양쪽을 읽는 헬퍼(src/lib/server/userDocs.ts)와 CMS 서명 URL 열람을 배포했다.
--
-- 이 마이그레이션(B2a)은 **추가·변환만** 하며 user-documents를 아직 비공개로 바꾸지 않는다(그 단계는 별도 #638, 아래 "적용 순서"):
--   1) user-avatars 공개 버킷 신설 — 아바타는 <img src>로 직접 노출되는 것이 본질이라 공개가 맞다(서류와 분리).
--   2) user_profiles의 서류 값(identity_doc_url·foreign_doc_urls·foreign_doc_url)에서 공개 URL 접두를 제거해 "경로만 저장"으로 변환.
--      호스트와 무관하게 '/storage/v1/object/public/user-documents/' 표지 뒤를 경로로 삼는다(Stage·Production ref가 달라도 동일).
--      멱등 — 이미 경로인 값·표지가 없는 값(테스트 픽스처 등)은 그대로 둔다. 배열 순서(identity_type/foreign_type과의 짝)는 보존한다.
--   3) cms_admin_audit_log의 action_type CHECK에 'doc_view'(서류 열람) 추가 — 기존 값은 모두 유지.
--
-- 안전성: 서류 URL을 읽는 코드는 모두 양쪽 형식을 처리하거나(헬퍼·CMS 서명 엔드포인트·정리 로직) 건수·존재만 쓴다(고객 화면·예약 차단 판정·장바구니).
--   user_profiles에는 서류 컬럼에 반응하는 트리거가 없다(member_code·user_id 동기화 트리거만 있음).
--
-- 적용 순서(전체): ① #637(이 파일) Stage→Production ② 코드 B3a 배포(upload-avatar→user-avatars·이전 아바타 삭제, 서류는 경로만 저장)
--   ③ 기존 아바타 이전 스크립트(scripts/migrate-avatars.mjs: 256px 리사이즈 후 user-avatars로 복사·avatar_url 갱신)
--   ④ #638(user-documents public=false + 이 변환 재실행) — 아바타·서류 읽기 경로가 모두 새 구조일 때만.
--
-- 롤백: (2) 경로→공개 URL 역변환은 'https://<project-ref>.supabase.co/storage/v1/object/public/user-documents/' || 경로 로 재구성(project-ref는 환경별).
--       (1) 버킷은 비어 있으면 DELETE FROM storage.buckets WHERE id='user-avatars'. (3) CHECK는 'doc_view'를 뺀 목록으로 재생성.

-- 1) 아바타 전용 공개 버킷
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-avatars',
  'user-avatars',
  true,
  2097152,
  ARRAY['image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 2) 서류 값 경로화(멱등)
UPDATE public.user_profiles
SET identity_doc_url = (
      SELECT array_agg(regexp_replace(u, '^.*/storage/v1/object/public/user-documents/', '') ORDER BY ord)
      FROM unnest(identity_doc_url) WITH ORDINALITY AS t(u, ord)
    )
WHERE identity_doc_url IS NOT NULL
  AND EXISTS (SELECT 1 FROM unnest(identity_doc_url) AS u WHERE u LIKE '%/storage/v1/object/public/user-documents/%');

UPDATE public.user_profiles
SET foreign_doc_urls = (
      SELECT array_agg(regexp_replace(u, '^.*/storage/v1/object/public/user-documents/', '') ORDER BY ord)
      FROM unnest(foreign_doc_urls) WITH ORDINALITY AS t(u, ord)
    )
WHERE foreign_doc_urls IS NOT NULL
  AND EXISTS (SELECT 1 FROM unnest(foreign_doc_urls) AS u WHERE u LIKE '%/storage/v1/object/public/user-documents/%');

UPDATE public.user_profiles
SET foreign_doc_url = regexp_replace(foreign_doc_url, '^.*/storage/v1/object/public/user-documents/', '')
WHERE foreign_doc_url LIKE '%/storage/v1/object/public/user-documents/%';

-- 3) 열람 감사 action_type 확장(기존 값 전부 유지 + doc_view)
ALTER TABLE public.cms_admin_audit_log DROP CONSTRAINT IF EXISTS cms_admin_audit_log_action_type_check;
ALTER TABLE public.cms_admin_audit_log ADD CONSTRAINT cms_admin_audit_log_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'role_change', 'create', 'delete', 'suspend', 'menu_permission_change',
    'concurrent_login_change', 'session_limit_change', 'name_change',
    'password_recovery_issued', 'password_recovery_completed', 'doc_view'
  ]::text[]));
