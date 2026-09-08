-- Migration #463 — HTML형 발행자 서명·직인 이미지 위치 이동(드래그) 지원
--
-- 배경: Migration #451(html_issuer_signature_width) 주석은 "HTML형은 셀 좌표 개념이
-- 없어 offsetX/offsetY(위치 이동)는 불필요"라고 명시했었으나, Stephen이 이번에 이 결정을
-- 뒤집었다 — 계약서 화면(CMS)에서 직인이 특정 표 셀 중앙에 고정 표시되어 원하는 위치로
-- 옮길 수 없다는 실사용 피드백에 따라, 문서 전체 어디로든 자유롭게 드래그 이동할 수 있게
-- 만들어달라는 명시적 요청(2026-09-08).
--
-- 저장값은 "기본 중앙 위치(top:50%, left:50%, translate(-50%,-50%))" 기준의 px 오프셋
-- 델타값이다 — NULL(=0,0)이면 기존과 완전히 동일하게 셀 중앙에 표시되어 하위호환된다.
-- contract_templates가 정본(에디터에서 드래그로 갱신), contracts는 발행 시점 스냅샷
-- 복사(감사·참고 목적 — html_issuer_signature_width와 동일 패턴, 렌더링은 발행 시점에
-- 이미 html_document 문자열에 구워짐).

ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS html_issuer_signature_offset_x INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS html_issuer_signature_offset_y INTEGER DEFAULT NULL;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS html_issuer_signature_offset_x INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS html_issuer_signature_offset_y INTEGER DEFAULT NULL;

COMMENT ON COLUMN contract_templates.html_issuer_signature_offset_x IS
  'HTML형 발행자 서명·직인 이미지의 기본 중앙 위치 대비 가로 이동 오프셋(px). NULL이면 0(중앙).';
COMMENT ON COLUMN contract_templates.html_issuer_signature_offset_y IS
  'HTML형 발행자 서명·직인 이미지의 기본 중앙 위치 대비 세로 이동 오프셋(px). NULL이면 0(중앙).';
COMMENT ON COLUMN contracts.html_issuer_signature_offset_x IS
  '발행 시점에 contract_templates.html_issuer_signature_offset_x를 스냅샷 복사(감사·참고 용도 — 렌더링은 발행 시점 html_document에 이미 반영됨).';
COMMENT ON COLUMN contracts.html_issuer_signature_offset_y IS
  '발행 시점에 contract_templates.html_issuer_signature_offset_y를 스냅샷 복사(감사·참고 용도 — 렌더링은 발행 시점 html_document에 이미 반영됨).';
