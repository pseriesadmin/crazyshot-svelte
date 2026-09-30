-- Migration 600 — review·on_time_return 규칙 설명 문구를 실제 구현과 동기화 (2026-09-30)
--
-- 배경(sp3-qa-agent 독립검수 MEDIUM-1): point_earn_rules.description(Migration #50 원문)이
-- review는 "렌탈 완료 후 14일 이내 작성 시", on_time_return은 "반납 예정일 당일 반납 시"로
-- 되어 있었으나, Migration #596/#597로 실제 구현된 정책은 다음과 같다(Stephen 확정,
-- 2026-09-30):
--   review         — 기간 제한 없음, 실제 대여 이력이 있으면 상품당 최초 1회 지급
--   on_time_return — 반납 예정일 이전(조기 반납 포함) 또는 당일까지 반납하면 정시 인정
--
-- CMS 화면(+page.svelte)이 이 description을 라벨 아래에 그대로 렌더링하므로, 실제 동작과
-- 다른 문구가 계속 노출되면 관리자가 오인할 수 있다 — referrer/referee(Migration #599)와
-- 동일한 방식으로 이번에 함께 맞춘다.

UPDATE public.point_earn_rules
   SET description = '리뷰 작성 — 실제 대여(반납/완료) 이력이 있는 고객만, 상품당 최초 1회 고정 500P(기간 제한 없음)',
       updated_at = now()
 WHERE event_type = 'review';

UPDATE public.point_earn_rules
   SET description = '정시 반납 — 반납 예정일 이전(조기 반납 포함) 또는 당일 반납 시 고정 200P',
       updated_at = now()
 WHERE event_type = 'on_time_return';

-- ── ROLLBACK(참고용) ──
-- UPDATE public.point_earn_rules SET description = '리뷰 작성 — 렌탈 완료 후 14일 이내 작성 시 고정 500P' WHERE event_type = 'review';
-- UPDATE public.point_earn_rules SET description = '정시 반납 — 반납 예정일 당일 반납 시 고정 200P' WHERE event_type = 'on_time_return';
