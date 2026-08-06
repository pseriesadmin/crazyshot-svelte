-- Migration 197: canned_responses.match_keywords — 고객 메시지 매칭 전용 키워드 목록
-- 배경: 기존 "단축키"(shortcut)는 관리자가 ChatInput에서 '/'로 부르는 관리자 전용 자동완성
--   필드였는데, 자동답변 키워드 매칭이 이 필드를 겸용하고 있어 값 1개만 등록 가능한 한계가 있었음
--   (동의어 여러 개를 등록할 수 없음). Stephen 지시로 고객 매칭 전용 다중 키워드 필드를 분리한다.
-- shortcut 필드는 그대로 유지(관리자 '/' 자동완성 용도, 값 1개) — 매칭 로직에서도 계속 보조
-- 신호로 참조하므로 기존 시드 5건(반납/연장/결제/파손/예약)은 재등록 없이 그대로 동작한다.

ALTER TABLE canned_responses
  ADD COLUMN IF NOT EXISTS match_keywords TEXT[] NOT NULL DEFAULT '{}';
