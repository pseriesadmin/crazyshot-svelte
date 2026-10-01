-- Production(vnbpmvxruyciuuaermyh) product_option_links — 재고(자식) af37c3e5 의 옵션 링크 3건 삭제 전 백업 (2026-10-01)
-- 사유: "빠른 재고 등록"이 부모 링크를 복사해 둔 오래된 사본(부모는 이후 수정됨)이 부모와 어긋남(SONY UWP-D21 사고).
--       재고는 부모값을 따르는 구조로 전환(Stephen 확정) — 정본은 부모 상품(cbc516ff-b1fa-4cba-8135-3c6308d25900)의 링크.
-- 복구가 필요하면 아래 INSERT를 그대로 실행한다(삭제 전 값 그대로).
INSERT INTO product_option_links
  (id, product_id, option_product_id, is_required, delivery_rental_disabled, display_order, created_at, updated_at, deleted_at, min_select_required, is_free, qty_follows_main)
VALUES
  ('e14d59fa-82ba-42d3-98c6-68296bf49792','af37c3e5-1254-40a5-9d4a-d2a712a3c120','d9f24708-cb45-4b56-9a42-b52cad8ab875', false, false, 0, '2026-10-01 07:03:16.91886+00','2026-10-01 07:03:16.91886+00', NULL, false, false, true),
  ('8f0aea20-27d3-4e25-b135-30b246dbd9ae','af37c3e5-1254-40a5-9d4a-d2a712a3c120','b6d7764d-b1f0-4e67-a34c-daaeb2e8d6b4', false, true,  1, '2026-10-01 07:03:16.91886+00','2026-10-01 07:03:16.91886+00', NULL, true,  true,  true),
  ('fce8be14-bd3b-40a9-80ed-f7840accb6b4','af37c3e5-1254-40a5-9d4a-d2a712a3c120','bd5bb125-b7c1-4d03-b154-8191f685b7f9', false, true,  2, '2026-10-01 07:03:16.91886+00','2026-10-01 07:03:16.91886+00', NULL, true,  true,  true);
