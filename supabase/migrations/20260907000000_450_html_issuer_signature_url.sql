-- Migration #450 — HTML형(고정 서식) 계약서의 발행자(대표이사) 서명·직인 이미지 URL
--
-- 배경: html_document는 코드 상수(DEFAULT_RENTAL_CONTRACT_HTML)를 그대로 저장하는 고정
-- 템플릿이라 flow/spreadsheet 모드처럼 에디터 안에서 셀/커서 위치에 이미지를 직접 삽입할
-- 방법이 없다. 다만 이 계약서의 "대표이사" 도장은 계약서마다 달라지지 않는 고정 이미지이므로,
-- 템플릿 단위로 1개의 이미지 URL만 저장해두면 충분하다 — contract_templates에 저장된 값을
-- contracts로 그대로 복사해(발행 시점 스냅샷 원칙, 기존 html_document/authoring_mode와 동일
-- 패턴) 이후 그 템플릿이 수정되어도 이미 발행된 계약서의 도장은 바뀌지 않게 한다.
--
-- 값은 cms_signature_assets.image_url을 그대로 저장(자산 삭제 시에도 이미 발행된 계약서에는
-- 영향 없음 — URL 문자열만 복사, FK 아님. 스프레드시트/문서형의 cs-image:// 마커 삽입과
-- 동일한 "URL 값 복사" 원칙).

ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS html_issuer_signature_url TEXT DEFAULT NULL;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS html_issuer_signature_url TEXT DEFAULT NULL;

COMMENT ON COLUMN contract_templates.html_issuer_signature_url IS
  'HTML형(고정 서식) 계약서의 발행자(대표이사) 서명/직인 이미지 URL — cms_signature_assets.image_url 값을 그대로 복사 저장. flow/canvas/spreadsheet 모드 또는 미지정 시 NULL.';
COMMENT ON COLUMN contracts.html_issuer_signature_url IS
  '발행(applyContractTemplate) 시점에 contract_templates.html_issuer_signature_url을 스냅샷 복사. 이후 템플릿이 바뀌어도 이미 발행된 계약서는 영향받지 않음.';
