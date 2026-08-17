-- Migration #289: user_profiles 민감 컬럼 고객 직접수정 차단 + ensure_user_profile() user_id 누락 수정
--
-- 배경: Stephen이 CMS 고객상세 "포인트" 필드(0P)를 선택해 "누적&차감 로직 정상 여부 검수"
-- 요청 → 감사 중 화면 표시 로직 자체는 정상이었으나, 그 뒤의 user_profiles 테이블 보안
-- 상태에서 CRITICAL 결함 2건을 발견(라이브 DB 직접 조회로 확인, Stage/Production 대조).
--
-- ── 결함 A(CRITICAL): Production의 user_profiles UPDATE RLS 정책이 컬럼 제한이 없음 ──
--   정책: "user_profiles_update" USING (auth.uid() = id), WITH CHECK 없음(=USING과 동일 적용)
--   + authenticated에 points 등 모든 컬럼 UPDATE GRANT가 걸려있음
--   + points 컬럼에 CHECK(points >= 0) 같은 하한 제약도 없음
--   → 로그인한 고객이 브라우저에서 직접
--        supabase.from('user_profiles').update({points: 999999}).eq('id', 본인ID)
--     를 호출하면 그대로 통과된다 — RPC도, CMS 관리자 승인도, 하한 제약도 전혀 없이
--     고객이 스스로 포인트(대여요금 할인 등 화폐가치 상당)를 무제한 생성할 수 있는 상태.
--   Stage는 우연히 UPDATE 정책 자체가 없어(전체 차단) 이 벡터가 막혀있었음 — 두 환경이
--   갈라져 있던 상태.
--
--   ⚠️ 검토했으나 적용하지 않은 것: 포인트 관리 RPC 5종(admin_grant_points 등)의
--   authenticated EXECUTE 권한 회수는 시도하지 않는다 — 이 5개는 전부 함수 본문 최상단에
--   `IF NOT is_cms_user() THEN RAISE EXCEPTION` 게이트가 이미 정확히 존재하고,
--   src/routes/cms/promotion/point/+page.server.ts가 이 RPC들을 실제로
--   locals.supabase(CMS 관리자 본인의 authenticated 세션)로 호출한다(service_role 아님) —
--   이 프로젝트에서 이미 한 번 겪은 "migration 263 authenticated 회귀 사고"와 동일한 실수를
--   반복해 이 권한을 회수하면 실제 CMS 포인트 관리 화면 자체가 깨진다. 여기서는 손대지 않음.
--
--   수정(이 마이그레이션): user_profiles 테이블의 UPDATE 권한 자체를 authenticated/anon/
--   PUBLIC으로부터 통째로 회수한다(H-01 원칙 — 직접 DML 절대 금지, RPC 경유만 허용).
--   ⚠️ 최초 시도는 컬럼단위 REVOKE UPDATE (points, ...) 였으나 Stage에서 실측 결과 무효였음
--   — authenticated가 이미 테이블 레벨 arwdDxtm(전체 권한) 직접 grant를 갖고 있어(pg_class.relacl
--   확인), 컬럼단위 REVOKE로는 테이블 레벨 grant를 이길 수 없음(Postgres 권한 모델 특성).
--   그래서 테이블 레벨 REVOKE UPDATE로 방식을 바꿈 — 이 편이 오히려 H-01 원칙과 더 일치.
--   src/ 전수 grep으로 확인: user_profiles에 대한 .update() 호출은 코드베이스 전체에
--   단 2곳뿐이며 둘 다 service_role 관리자 클라이언트 사용(upload-doc 엔드포인트,
--   memberCodeCombo.test.ts 테스트 정리) — 이번 REVOKE로 영향받는 정상 기능 없음.
--   고객 본인 프로필 수정의 정식 경로는 update_user_profile() RPC(SECURITY DEFINER,
--   full_name/email/birth_date만 갱신) — REVOKE와 무관하게 그대로 동작.
--   Stage에서 실제로 authenticated 세션을 시뮬레이션해 트랜잭션 내 검증 후 롤백 —
--   ① update_user_profile RPC 정상 성공 ② 직접 points UPDATE는 permission denied로 차단.
--
--   추가로 points >= 0 CHECK 제약 신설(방어적 이중화 — 혹시 모를 service_role 경로 실수 대비).
--
-- ── 결함 B(CRITICAL, Production 전용): ensure_user_profile()이 user_id를 누락한 채 INSERT ──
--   현재 정의: INSERT INTO user_profiles (id, email) VALUES (v_user_id, ...) ON CONFLICT(id) DO NOTHING
--   user_profiles.user_id는 NOT NULL(기본값 없음) — 이 INSERT가 실제로 신규 행을 만들어야 하는
--   순간(그 함수가 존재하는 목적 그 자체)마다 NOT NULL 위반으로 실패한다.
--   Stage는 BEFORE INSERT 트리거 trg_sync_user_id(NEW.user_id := NEW.id)가 우연히 이를
--   막아주고 있었으나, Production에는 그 트리거가 존재하지 않아 그대로 실패함(직접 조회로
--   Production 트리거 목록에 없음을 확인 — trg_auto_assign_member_code/trg_prevent_member_code_null
--   두 개뿐). 익명(게스트) 세션이 정회원으로 전환되는 시점에 이 함수가 호출되는데
--   (src/lib/stores/auth.ts performSignUp), 정상 가입 트리거 handle_new_user()는
--   IF NEW.is_anonymous THEN RETURN NEW로 익명 유저 프로필 생성을 건너뛰므로 이 함수가
--   유일한 안전망 — 실패하면 그 고객은 user_profiles 행 자체가 없는 상태로 남아 포인트·
--   회원코드·CMS 고객화면 등 전부 조회 불가 상태가 된다.
--
--   수정: handle_new_user()와 동일하게 user_id를 명시적으로 채워 INSERT.
--
-- stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 → production(vnbpmvxruyciuuaermyh)은 Stephen 승인 후.

-- ── A-1. points 하한 CHECK 제약(없으면 추가) ────────────────────────────────────
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_profiles'::regclass AND conname = 'user_profiles_points_nonneg'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_points_nonneg CHECK (points >= 0);
  END IF;
END $do$;

-- ── A-2. user_profiles 테이블 UPDATE 권한 통째로 회수(H-01 원칙 — RPC 경유만 허용) ────
-- 정상 셀프서비스 수정은 update_user_profile() RPC(SECURITY DEFINER)가 계속 처리 —
-- 이 REVOKE와 무관하게 그대로 동작(함수 소유자 권한으로 실행되므로 호출자 grant 무관).
REVOKE UPDATE ON public.user_profiles FROM authenticated, anon, PUBLIC;

-- ── B. ensure_user_profile() — user_id 누락 수정 ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_user_profile()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- handle_new_user()와 동일하게 id = user_id = auth.users.id를 명시적으로 채운다.
  -- user_id는 NOT NULL(기본값 없음)이라 누락 시 이 INSERT 자체가 실패한다(migration 289
  -- 이전 결함 — Production에는 이를 대신 채워주는 트리거가 없어 실제로 발현 가능했음).
  INSERT INTO public.user_profiles (id, user_id, email)
  VALUES (v_user_id, v_user_id, auth.jwt() ->> 'email')
  ON CONFLICT (id) DO NOTHING;

  RETURN v_user_id;
END;
$$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- GRANT UPDATE ON public.user_profiles TO authenticated, anon;
-- ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_points_nonneg;
-- ensure_user_profile()은 원본(user_id 누락 버전)으로 되돌리지 말 것 — 결함 재도입이므로
--   롤백이 필요하면 반드시 이 마이그레이션의 CREATE OR REPLACE 그대로 유지.
-- ============================================================
