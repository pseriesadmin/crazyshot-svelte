-- Migration #185: 캔드 리스폰스(빠른답변 라이브러리) 테이블
-- Phase 1-1 | 2026-08-05
-- 편집 권한: is_cms_user() 기반 (파트너 포함 모든 CMS 사용자)
-- (원래 #184로 생성됐으나 동시 진행 중이던 다른 세션의 push notification 마이그레이션(#181~184)과
--  번호 충돌 확인되어 오케스트레이터가 #185로 재번호 — 내용 변경 없음)

CREATE TABLE IF NOT EXISTS canned_responses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  category    VARCHAR(20) CHECK (category IN ('return', 'payment', 'reservation', 'damage', 'general')),
  shortcut    TEXT        UNIQUE,
  usage_count INT         NOT NULL DEFAULT 0,
  created_by  UUID        REFERENCES auth.users ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;

-- 관리자(is_cms_user()) 전체 작업 허용 — 매니저 제한 없음, 파트너 포함
CREATE POLICY "cr_admin_all" ON canned_responses
  FOR ALL USING (is_cms_user());

-- 서비스 전체 공개 조회 (챗봇 등 서비스에서 조회 가능하도록)
CREATE POLICY "cr_read" ON canned_responses
  FOR SELECT USING (true);

-- 기본 시드 데이터 5건
INSERT INTO canned_responses (title, content, category, shortcut) VALUES
  ('반납 안내 기본',
   '반납은 택배 또는 직접 방문으로 가능합니다. 반납 전 장비 상태를 확인해 주시고, 원래 패키지 그대로 포장해 발송해 주세요.',
   'return', '/반납'),
  ('연장 요청 안내',
   '렌탈 기간 연장은 반납일 전날까지 요청 가능합니다. 연장 요청은 이 채팅을 통해 남겨주시면 재고 상황 확인 후 안내해 드립니다.',
   'return', '/연장'),
  ('결제 방법 안내',
   '카드·계좌이체·포인트 결합결제가 가능합니다. 결제 방법 변경이나 결제 오류 문의는 채팅으로 남겨주시면 도움드리겠습니다.',
   'payment', '/결제'),
  ('파손 접수 안내',
   '장비 파손 시 파손 부위 사진을 채팅으로 보내주시면 확인 후 처리 절차를 안내해 드립니다. 임의 수리는 추가 비용이 발생할 수 있습니다.',
   'damage', '/파손'),
  ('예약 확인 안내',
   '예약 내역은 마이페이지 > 렌탈내역에서 확인하실 수 있습니다. 예약 코드를 알려주시면 상세 내역을 함께 확인해 드리겠습니다.',
   'reservation', '/예약');

-- usage_count 원자적 증가 RPC (race condition 방지)
CREATE OR REPLACE FUNCTION public.increment_canned_response_usage(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE canned_responses
  SET usage_count = usage_count + 1
  WHERE id = p_id;
END;
$$;
