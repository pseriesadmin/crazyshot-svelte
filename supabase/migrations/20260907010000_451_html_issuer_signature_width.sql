-- Migration #451 — HTML형 발행자 서명·직인 이미지 너비 조절 (Migration #450 후속)
--
-- 배경: Stephen이 스프레드시트형 편집기의 이미지 크기조절 툴바(소(100)/중(200)/대(400)
-- 프리셋 + 커스텀 px 입력 + 삭제, ContractSpreadsheetEditor.svelte)를 HTML형에도 동일하게
-- 반영하라고 재지시. HTML형은 셀 좌표 개념이 없어 offsetX/offsetY(위치 이동)는 불필요하지만
-- 너비 조절은 동일하게 필요 — 별도 정수 컬럼으로 저장(URL과 분리, cs-image:// 마커 문자열
-- 인코딩 방식을 그대로 따르지 않음 — HTML형은 애초에 마커가 셀 텍스트가 아니라 고정 HTML
-- 주석이므로 굳이 문자열에 욱여넣을 이유가 없음).

ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS html_issuer_signature_width INTEGER DEFAULT NULL;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS html_issuer_signature_width INTEGER DEFAULT NULL;

COMMENT ON COLUMN contract_templates.html_issuer_signature_width IS
  'HTML형 발행자 서명·직인 이미지 너비(px). NULL이면 기본값(90px) 적용. 20~1200 범위(스프레드시트형 크기조절 툴바와 동일 클램프).';
COMMENT ON COLUMN contracts.html_issuer_signature_width IS
  '발행 시점에 contract_templates.html_issuer_signature_width를 스냅샷 복사.';
