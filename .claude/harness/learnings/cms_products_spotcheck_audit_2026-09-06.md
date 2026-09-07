# /cms/products 상품등록관리 — 스팟체크 감사 (A4 트랙)
2026-09-06 | 순수 읽기전용 조사 | 담당범위: src/routes/cms/products/**, cms/products/new/**

## 요약 (3줄)

1. products.md §2-12 "5곳" vs `grep option_only src` "8개 파일" 불일치는 **버그도 문서오류도
   아니다** — "5곳"은 고객노출 "제외 판정" 로직이 실제로 존재하는 지점만 세는 개념이고, 8개
   파일 중 6개는 그 컬럼을 단순히 읽거나(조회/상속) 쓰는(등록/수정폼) CRUD 지점이라 애초에
   "판정 로직"이 아니다. 실제 판정 지점은 6개 RPC(supabase/migrations, src 밖이라 grep에
   안 잡힘) + productSearchIndex.ts + products/search/+page.svelte(둘 다 §2-12 5번째
   불릿에 이미 포함) = 문서와 정확히 일치.
2. 과거 감사(2026-08-31)의 H-1/M-1/M-2/M-3는 전부 코드상 수정 반영 확인됨. L-1~L-6 백로그
   6건은 전부 여전히 미수정 상태로 코드에 그대로 남아있음(방치 자체가 새 발견은 아님).
3. L-2("권한 게이팅 비일관")는 재조사 결과 실제로는 security-auth.md 매트릭스("상품 관리
   `/cms/products` → partner도 세션만으로 허용")와 정확히 일치하는 **의도된 정책**이었다 —
   백로그 항목 자체가 스스로 "security-auth.md 대조 필요"라고 남겨뒀던 미완 확인을 이번에
   완료한 것. reassignCodeSeries만 manager+ 게이트인 것도 products.md §2-11에 명시된 별도
   정책이라 불일치가 아니다.

---

## option_only 8파일 분류표

| 파일 | 역할 | "5곳"(제외 판정)에 포함? | 판정 근거 |
|---|---|---|---|
| `src/lib/server/searchEngine/adapters/productSearchIndex.ts:249` | NLSearch 인덱스 빌드 쿼리에 `.eq('option_only', false)` — 실제 필터 | ✅ 포함 | §2-12 5번째 불릿 "NLSearch 인덱스 쿼리(productSearchIndex.ts)"와 문자 그대로 일치 |
| `src/routes/products/search/+page.svelte:40` | 검색페이지 추천상품 클라이언트 쿼리에 `.eq('option_only', false)` — 실제 필터 | ✅ 포함 | §2-12 5번째 불릿 "+ 검색페이지 추천상품 클라이언트 쿼리"와 문자 그대로 일치 |
| `src/lib/server/products/loadSelectedProductDetail.ts` | CMS 상세패널 로드 시 자식→부모 상속값으로 `option_only`를 읽어 selectedProduct에 채움(184번째 줄 근처) — 고객노출 제외와 무관, 관리자 편집화면 데이터 공급 | ❌ 미포함 | 판정(필터) 로직이 아니라 읽기(조회+상속) 로직. products.md §9 Q4 패턴과 동일 성격 |
| `src/lib/components/cms/ProductDetailPanel.svelte` | 기본정보 탭 "노출 조건" 토글 UI — `localBasic.option_only` 상태관리 + hidden input으로 폼 제출 | ❌ 미포함 | 관리자가 값을 "쓰는" UI, 고객노출 판정과 무관 |
| `src/routes/cms/rental/history/+page.server.ts` | `SelectedProduct` 타입 선언에 `option_only: boolean` 필드 존재(공유 컴포넌트 prop 형식 맞춤용) — 실제 상품 목록 쿼리(35~42행)는 option_only로 필터하지 않음(의도적, 이 화면은 관리자가 옵션전용 상품도 포함해 전 상품 이력을 봐야 함) | ❌ 미포함 | 타입 선언 + 의도적 비필터(admin 내부 도구는 옵션전용 상품도 봐야 함) |
| `src/routes/cms/products/new/+page.svelte` | 신규등록 폼 — `optionOnly` 값을 hidden input으로 서버에 제출 | ❌ 미포함 | 쓰기(등록) UI |
| `src/routes/cms/products/new/+page.server.ts` | 신규등록 액션 — `form.get('option_only')`를 파싱해 INSERT에 반영 | ❌ 미포함 | 쓰기(등록) 서버 로직 |
| `src/routes/cms/products/+page.server.ts` | ① updateSection 'basic'에서 UPDATE payload에 포함 ② cloneProduct 두 분기(add_inventory/new_product) 모두 source.option_only를 신규 자식/복제본에 상속 | ❌ 미포함 | 쓰기(수정) + 상속 로직, 판정 로직 아님 |

**결론**: 8개 파일 중 정확히 2개(`productSearchIndex.ts`, `products/search/+page.svelte`)만
"고객노출 제외 판정" 로직을 담고 있고, 이 둘은 products.md §2-12 5번째 불릿에 이미 한
문장으로 함께 명시돼 있다. 나머지 6개는 CRUD(읽기/쓰기/상속/타입선언) 지점일 뿐 그 자체로
"노출을 제외"하지 않는다 — 실제 제외는 DB RPC 레이어(search_products #390, get_products_by_ids
#391, get_home_theme_groups_with_products/admin #392, get_hype_pack_theme_groups_with_products
/admin #393)에서 일어나며 이들은 `supabase/migrations/*.sql` 안에서만 `option_only = false`
WHERE절로 존재해 `grep option_only src`에는 애초에 잡히지 않는다(마이그레이션 파일 4개를
직접 열어 WHERE절 6곳 — search_products 2곳(SELECT+로그UPDATE), get_products_by_ids 1곳,
home_theme 2개 함수, hype_pack 2개 함수 — 전부 `p.option_only = false`/`AND p.option_only =
false` 조건 실존 확인). 따라서 "5곳"과 "8개 파일"은 서로 다른 것을 세는 숫자이며 모순이
아니다. 이 결론은 2026-08-31 이후 수행된 별도 QA(`cms_global_verification_v5_synthesis_
2026-08-31.md` B-1: "상태: CLOSED, 이슈 없음... DB컬럼→RPC필터 4종→CMS UI→서버반영→조회→
NLSearch/검색페이지까지 전 계층 완전 정합 확인")와도 독립적으로 일치한다.

부가 확인: CMS 옵션상품 선택 피커(`/api/cms/products/search-suggestions`, `CmsSimilarNameInput.
svelte`의 `source='product_search'` 분기가 호출)는 실제로 `option_only` 컬럼을 전혀 검사하지
않고 `activeOnly` 파라미터가 있을 때만 `is_active`를 검사한다 — §2-12 "옵션상품 선택 피커는
이 컬럼을 검사하지 않는다"는 문서 서술과 코드가 정확히 일치.

---

## L-1~L-6 백로그 재확인 결과 (2026-08-31 감사 대비)

| 항목 | 상태 | 확인 근거 |
|---|---|---|
| L-1 (deleteProduct 존재확인 없음) | **미수정, 재현 가능** | `+page.server.ts:1020-1032` — `target` 조회 시 `.single()`의 error를 확인하지 않고, 이후 `deleted_at` UPDATE도 `.eq('id', productId)`가 매칭 0건이어도 Supabase는 에러를 던지지 않아 `error`가 null → `return { success: true, action: 'deleteProduct' }` 그대로 반환. 존재하지 않는 productId를 보내도 "성공"으로 응답함 |
| L-2 (권한 게이팅 비일관) | **재분류: 버그 아님(의도된 정책)** | `deleteProduct`/`deleteSelectedInventory`/`cloneProduct`/`toggleStatus`/`updateSection`은 세션체크만, `reassignCodeSeries`만 `hasSettingsAccess`(manager+) — 이는 security-auth.md 매트릭스의 "상품 관리 `/cms/products` → partner: ✅ 세션만"과 정확히 일치하는 **명시된 정책**이며, reassignCodeSeries만 별도 강화 게이트인 것도 products.md §2-11에 "품번 체계 자체를 바꾸는 액션이라... 엄격한 게이트를 적용" 명문화돼 있다. 2026-08-31 감사가 "security-auth.md 대조 필요"라고 남긴 미완 확인을 이번에 완료 — 대조 결과 불일치 없음 |
| L-3 (재고 0개 시 부모 OFF — 순차 쿼리) | **미수정, 재현 가능** | `deleteProduct`(1036-1045) 단일 삭제 경로와 `deleteSelectedInventory`(1090-1103) 배치 삭제 경로 둘 다 `parentIds`를 순회하며 매 parentId마다 개별 count 쿼리 + 개별 UPDATE 쿼리를 순차 실행 — 배치화(단일 쿼리)되지 않음. 정합성 문제는 아니고(각 카운트는 정확) 순수 성능 이슈 |
| L-4 (Orphaned CSS) | **미수정, 확인됨** | `ProductDetailPanel.svelte`: `.btn-edit`(3069,3074행)·`.btn-cancel`(3075,3080행)·`.field-row`/`.field-row-inline`(3084-3085행) 정의만 존재, 템플릿(`class="..."`) 어디에도 이 클래스명을 사용하는 마크업 없음(grep 결과 스타일 블록 외 매치 0건). `new/+page.svelte`: `.field-hint`(1581행)·`.f-textarea`(1602행)도 동일하게 정의만 있고 사용처 없음 |
| L-5 (`_unused_dmg` 네이밍) | **미수정, 확인됨** | `ProductDetailPanel.svelte:1885` `<input id="ip-dmg" ... name="_unused_dmg" ...>` — 여전히 이 이름 그대로 존재. 실제 제출용 값은 별도 hidden input(`name="damage_fee_percentage"`, 1818행)이 담당하는 구조라 `_unused_dmg`는 여전히 혼동 소지 있는 네이밍으로 남아있음(기능적으로는 문제 없음) |
| L-6 (`blockChildInputFocus`가 BUTTON 미차단) | **미수정, 위험도 변화 없음** | `blockChildInputFocus`(158행)는 `onfocusin` 핸들러로 `<div class="section" role="tabpanel" onfocusin={blockChildInputFocus}>` 8곳에 부착 — BUTTON 요소의 focus는 여전히 걸러지지 않는 로직 그대로. 다만 TabKey 필터링으로 자식상품 선택 시 애초에 이 탭들에 도달할 수 없어(§4-1) 실질적 익스플로잇 경로는 여전히 없음(2026-08-31 감사 서술과 동일 결론) |

---

## cloneProduct N+1 쿼리 (M-4) 재확인

`src/routes/cms/products/+page.server.ts` `cloneProduct` 액션, 두 분기(`add_inventory`
1158-1248행 / `new_product` 1331행~) 모두 `for (let i = 1; i <= count; i++)` 루프 안에서:

- 슬러그 유니크 확인 `while(true)` 루프(최소 1회, 충돌 시 N회 추가 쿼리)
- `products` INSERT 1회
- `generate_inventory_product_code`/`generate_product_code` RPC 1~2회(1회 실패 시 자동 재시도)
- `price_rules` INSERT 1회(가격 있을 때)
- (add_inventory만) `get_product_option_links` RPC 조회 1회 + `upsert_product_option_links` RPC
  1회(옵션 있을 때)

항목당 최소 3회~최대 7회 순차 쿼리, `count`는 `Math.min(20, ...)`로 상한 20 — 최악의 경우
1회 요청당 최대 약 140회 순차 DB 왕복. 2026-08-31 감사 M-4가 "구조를 바꾸지 않고 현황만
기록"이라 명시한 그대로 현재까지 손대지 않은 상태 그대로 남아있음 — 정합성 문제는 아니며(각
쿼리는 개별적으로 올바르게 성공/실패 처리됨) 순수 성능/응답시간 이슈. 20건 일괄등록 시
Vercel 서버리스 함수 타임아웃(기본 10초, 설정에 따라 최대 60초) 근접 가능성이 실사용 리스크로
남아있음 — 별도 세션에서 배치 리팩터링 검토 권장(감사 원문의 권고와 동일).

---

## 신규 발견

없음. 이번 스팟체크는 지정된 8개 option_only 파일 판정, 4건(H-1/M-1/M-2/M-3) 수정 여부,
L-1~L-6 6건 재확인, cloneProduct N+1 규모 확인이 목적이었고 신규 CRITICAL/BOUNDARY 이슈는
발견되지 않았다.

## 부가 발견

- `CmsSuggestPicker.svelte`(10줄)는 uiux-index.md가 "구경로, 신규작성 금지"로 지정한 대로
  `common/SuggestPicker.svelte`로 위임하는 re-export shim이 맞다 — 4개 파일이 이 경로를
  계속 쓰고 있으나 "기존 호출 경로 호환 유지" 주석대로 의도된 하위호환이지 신규 위반이 아님.
- `CmsSimilarNameInput.svelte`의 `source='product_search'` 분기(`/api/cms/products/
  search-suggestions` 호출, 옵션상품 피커에서 사용)는 `option_only`를 전혀 검사하지 않고
  `activeOnly` 파라미터가 있을 때만 `is_active`를 검사함을 직접 확인 — products.md §2-12의
  "옵션상품 선택 피커는 이 컬럼을 검사하지 않는다" 서술과 코드가 정확히 일치(별도 코드
  변경 불필요하다는 문서 주장 재확인).

## 자체 오인점검

- misidentifications.md의 반복 교훈("컬럼명/타입명만 보고 도메인 의미 추정 금지", "결론이
  옳아도 근거를 실제 파일 대조 없이 서술 금지")에 따라, "5곳 vs 8개 파일" 판정은 문서 서술을
  그대로 믿지 않고 마이그레이션 파일 4개(#390~393) 원문을 전부 열어 실제 WHERE절 존재를
  1차 확인한 뒤, 8개 grep 매치 파일 각각을 열어 역할(판정 vs CRUD)을 개별 분류했다.
- L-1~L-6 재확인도 감사 문서 서술을 그대로 인용하지 않고 코드 라인 번호까지 직접 대조해
  현재 시점 실존 여부를 재확인했다(문서 작성 이후 다른 세션에서 몰래 수정됐을 가능성 배제).
