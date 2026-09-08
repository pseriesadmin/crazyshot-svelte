-- Migration #464 — "계약 및 인수 확인"·"개인정보동의" 문단을 관리자 편집 가능하게 전환
--
-- 배경: html 고정 서식(defaultRentalContractHtml.ts)의 "계약 및 인수 확인"·"개인정보동의"
-- 두 섹션은 지금까지 코드에 하드코딩된 고정 문단(<p> 태그 나열)이었다 — 특약(specifications)과
-- 달리 관리자가 CMS에서 전혀 수정할 수 없었음. Stephen 요청: 이 두 섹션도 "단순 텍스트 편집"
-- 형태로 관리자가 직접 고칠 수 있게 하고, ContractFieldPanel.svelte에 '계약조항'·'개인정보동의'
-- 탭을 신설해 편집 UI를 제공한다.
--
-- 저장값은 문단 단위 일반 텍스트(빈 줄로 문단 구분, 문단 맨 앞 "[라벨]"은 렌더링 시 자동
-- 굵게 처리 — 기존 하드코딩 문단의 <strong>[라벨]</strong> 표기와 동일 관례를 그대로 재현)다.
-- NULL(미커스터마이즈)이면 지금까지의 기본 문구를 그대로 사용(contract-substitution.ts의
-- DEFAULT_CONTRACT_TERMS_TEXT/DEFAULT_PRIVACY_TERMS_TEXT로 하위호환).
--
-- contracts 테이블에는 별도 컬럼을 추가하지 않는다 — 발행 시점에 이미 html_document 문자열에
-- 완전히 구워지므로(html_issuer_signature_width와 달리 감사용 스냅샷 필요 없음), 이번 스코프는
-- "템플릿 작성 UI"에 한정한다(사후 클릭편집 기능은 이번 요청 범위 밖).

ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS contract_terms_text TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS privacy_terms_text  TEXT DEFAULT NULL;

COMMENT ON COLUMN contract_templates.contract_terms_text IS
  'HTML형 "계약 및 인수 확인" 섹션 문단 텍스트(빈 줄로 문단 구분, 문단 맨 앞 "[라벨]" 자동 굵게). NULL이면 기본 문구 사용.';
COMMENT ON COLUMN contract_templates.privacy_terms_text IS
  'HTML형 "개인정보동의" 섹션 문단 텍스트(빈 줄로 문단 구분, 문단 맨 앞 "[라벨]" 자동 굵게). NULL이면 기본 문구 사용.';
