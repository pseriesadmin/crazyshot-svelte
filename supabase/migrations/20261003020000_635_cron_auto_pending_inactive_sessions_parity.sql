-- Migration 635: auto-pending-inactive-chat-sessions 크론을 Stage에도 등록 (Production과 동일하게 정렬)
--
-- 배경(2026-10-03 Stage↔Production 구조 점검): Production에는 10분마다
-- SELECT auto_pending_inactive_sessions(); (3시간 무응답 '진행중' 상담 → '대기' 자동 전환)을 도는
-- 크론이 있으나 Stage에는 등록돼 있지 않아 Stage에서 이 자동 전환을 검증할 수 없었다
-- (service-operations.md §7: 대기 재진입 경로 ① 3시간 무응답 자동전환).
-- 함수 auto_pending_inactive_sessions()는 Stage에 이미 존재한다(Migration 226).
--
-- Stage 영향 사전 점검(2026-10-03): 진행중(open) 상담 0건 → 등록 직후 전환되는 세션 없음.
-- Production은 같은 이름의 잡이 이미 있으므로 이 마이그레이션은 no-op(이력만 기록)이다.
-- 같은 이름 잡이 있으면 건드리지 않는다.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-pending-inactive-chat-sessions') THEN
    PERFORM cron.schedule(
      'auto-pending-inactive-chat-sessions',
      '*/10 * * * *',
      'SELECT auto_pending_inactive_sessions();'
    );
  END IF;
END $$;

-- ============================================================
-- ROLLBACK (Stage에서 되돌릴 때만)
-- ============================================================
-- SELECT cron.unschedule('auto-pending-inactive-chat-sessions');
-- ============================================================
