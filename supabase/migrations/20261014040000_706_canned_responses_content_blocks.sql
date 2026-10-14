-- 706: 빠른답변(canned_responses) 서식 본문 칸 추가
-- 공통 문서 편집기(RichContentEditor)로 작성한 서식 본문(글자 서식·이미지·동영상·표)을 content_blocks(JSONB)에 저장한다.
-- 기존 content(순수 텍스트)는 그대로 유지하고 항상 content_blocks의 파생 텍스트로 함께 저장한다 —
-- 채팅·검색·자동답변·크레이지챗은 content만 읽으므로 이번 변경으로 동작이 바뀌지 않는다.
-- NULL = 서식 본문 없음(기존 행·CSV 일괄등록 행은 NULL 그대로, help 화면은 content를 텍스트로 표시).
ALTER TABLE public.canned_responses
  ADD COLUMN IF NOT EXISTS content_blocks jsonb;

COMMENT ON COLUMN public.canned_responses.content_blocks IS
  '서식 본문(ContentBlock[] JSON). NULL이면 content 순수 텍스트만 사용. content는 항상 이 값의 텍스트 파생값.';

-- ROLLBACK: ALTER TABLE public.canned_responses DROP COLUMN IF EXISTS content_blocks;
