-- Migration #300: product-images 버킷에 image/gif 추가
-- 목적: 계약설정(/cms/reservation/contracts) "서명 & 직인 이미지 등록" 흐름이
--       ContractTemplatePanel.svelte / /api/cms/signature-assets 양쪽에서 이미
--       GIF를 로컬 허용 예외로 처리하고 있었으나(전역 validateUploadFile() 미사용,
--       "gif 허용: 이 컴포넌트 전용 로컬 검증만 사용" 주석 명시), 버킷 자체에는
--       image/gif가 한 번도 추가된 적이 없어 실제로는 GIF 업로드가 항상 실패하던
--       상태였음(2026-08-18 PNG 업로드 실패 조사 중 부수 발견, Stephen 확정 지시로 추가).
-- 기존: webp + jpeg + jpg + png (migration #75) → 변경: 위 4종 + gif

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/jpg', 'image/png', 'image/gif']
WHERE id = 'product-images';
