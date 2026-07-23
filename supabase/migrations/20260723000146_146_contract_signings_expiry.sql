-- Migration 146: contract_signings 만료일 컬럼 추가
-- 서명 링크를 발송 후 30일 뒤 자동 만료
-- /contract/[token] 페이지에서 expires_at < NOW() → /contract/expired 리다이렉트

ALTER TABLE contract_signings
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 기존 행: sent_at 기준 30일 후로 만료 설정 (sent_at NULL이면 now+30일)
UPDATE contract_signings
  SET expires_at = COALESCE(sent_at, now()) + INTERVAL '30 days'
  WHERE expires_at IS NULL;

-- 이후 신규 INSERT 기본값: now() + 30일
ALTER TABLE contract_signings
  ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '30 days');

-- 만료 인덱스 (만료 여부 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_contract_signings_expires_at
  ON contract_signings(expires_at)
  WHERE signed_at IS NULL;
