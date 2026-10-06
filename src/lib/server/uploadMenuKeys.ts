// uploadMenuKeys.ts — /api/cms/upload(비 log/ 경로)를 쓰는 CMS 화면들의 메뉴 키 (메뉴권한 서버 집행 2-C, 2026-10-06)
// 호출처: 상품 상세·상품 등록(products.list·new) · 모바일 상품/자산 사진(rental.reservation) · 이력 사진(rental.history) ·
// 계약서 양식 에디터(rental.contracts) · 빠른답변 이미지(consulting.qna) · 구독 상세(subscription.*)
// rental.contracts·consulting.qna는 CmsContentEditor(이미지 삽입 업로드)를 쓰는 화면이라 예비 포함 — 실제 호출이 없다고 확인되면 좁혀도 된다(과허용 방향이라 안전).
// 새 CMS 화면이 이 업로드를 쓰게 되면 그 화면의 메뉴 키를 여기에 추가한다(빠지면 그 화면의 업로드가 403).
export const UPLOAD_MENU_KEYS: readonly string[] = [
  'products.list',
  'products.new',
  'rental.reservation',
  'rental.history',
  'rental.contracts',
  'consulting.qna',
  'subscription.list',
  'subscription.new',
]
