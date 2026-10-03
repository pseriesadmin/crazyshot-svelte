-- Migration #638: 서류 비공개 전환 B2b — user-documents 버킷을 비공개(public=false)로 (2026-10-04, Stephen 승인 플랜 웨이브 B)
--
-- 배경: 본인증명·외국인증명 서류가 공개 버킷에 영구·무인증 URL로 열람되던 문제(실서버 점검 H1)의 최종 단계.
--   선행 완료: #637(user-avatars 버킷·서류 값 경로화·감사 CHECK) → B3a 코드(서류는 경로만 저장, 아바타는 user-avatars, CMS는 서명 URL로만 열람)
--   → 기존 아바타 이전(scripts/migrate-avatars.mjs).
--
-- 이 마이그레이션이 하는 일:
--   1) 안전장치 — 아직 user-documents 공개 URL을 가리키는 아바타(avatar_url)가 있으면 EXCEPTION으로 전체 중단한다.
--      (비공개 전환 시 그 아바타가 깨지므로, 아바타 이전 스크립트를 먼저 실행해야 한다. 트랜잭션이라 부분 적용 없음)
--   2) 서류 값 경로화 재실행(멱등) — #637 이후 구코드가 저장했을 수 있는 공개 URL을 경로로 마저 변환.
--   3) user-documents public=false. storage.objects 정책은 만들지 않는다(서비스 롤만 접근 — 열람은 서버가 발급하는 서명 URL).
--
-- 적용 순서: B3a 코드 Production 배포 확인 → 아바타 이전 스크립트 실행(남은 URL 0건 확인) → 이 마이그레이션(Stage 먼저) → DRIFT_CHECK 1~4.
-- 롤백(최후 수단 — 신분증 서류가 다시 공개된다):  UPDATE storage.buckets SET public = true WHERE id = 'user-documents';
--   (경로→공개 URL 역변환이 필요하면 'https://<project-ref>.supabase.co/storage/v1/object/public/user-documents/' || 경로 로 재구성)
--   ⚠️ 롤백해도 서류 값은 이미 경로로 저장돼 있어(공개 URL을 쓰던 구버전 코드는 복구되지 않음) 이 단계는 사실상 되돌리지 않는 것을 전제로 한다.

-- 1) 안전장치: 공개 URL 아바타 잔존 시 중단
DO $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT count(*) INTO v_remaining
  FROM public.user_profiles
  WHERE avatar_url LIKE '%/storage/v1/object/public/user-documents/%';

  IF v_remaining > 0 THEN
    RAISE EXCEPTION '[#638 중단] 아직 user-documents 공개 URL을 가리키는 아바타가 % 건 있습니다. scripts/migrate-avatars.mjs 로 먼저 이전하세요.', v_remaining;
  END IF;
END $$;

-- 2) 서류 값 경로화 재실행(멱등)
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

-- 3) 버킷 비공개 전환
UPDATE storage.buckets SET public = false WHERE id = 'user-documents';
