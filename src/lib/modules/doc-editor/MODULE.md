# MODULE.md — doc-editor 모듈 매니페스트

| 항목 | 값 |
|---|---|
| 이름 | doc-editor (문서 & 양식 통합 편집기) |
| 버전 | 0.1.0 (2026-10-14) |
| 프레임워크 | Svelte 5 (runes) · SvelteKit 선택 |
| 저장 포맷 | `[{type:'tiptap-doc', doc}]` — 크레이지샷 계약서 `content_blocks` 와 호환 |

## 의존
- 필수: `svelte-tiptap ^3` · `@tiptap/core·pm·starter-kit·extension-{table,table-row,table-header,table-cell,image,underline,text-align,text-style,color,font-family,link} ^3.29`
- 선택: `@supabase/supabase-js`(adapters/supabase 사용 시)
- 폴더 간 규칙: `core` ← `ui` ← `examples` / `adapters/*`. `core`·`ui`·`examples` 는 호스트 import 금지.

## 파일 소유(이식 시 어떻게 다루나)
| 폴더 | 이식 시 |
|---|---|
| `core/` `ui/` `examples/` | **그대로 복사·수정 금지**(업그레이드는 폴더 교체) |
| `adapters/supabase/` | 그대로 사용 가능(클라이언트 주입) |
| `adapters/crazyshot/` | 삭제 후 자기 프로젝트 어댑터 작성(참고용) |
| `sql/` | 1회 실행(멱등), 롤백 파일 보관 |

## 자동 게이트 (원 프로젝트 테스트)
- `portability.test.ts`: `core/`·`ui/`·`examples/` 의 import 가 상대경로·허용 패키지뿐이고 `$lib·$app·$env·supabase·csToast`·`/api/` 참조가 없음
- `coreEquivalence.test.ts`: 크레이지샷 기존 계약서 구현과 스키마·렌더 HTML·치환 결과가 동일(저장 문서 호환 보증)
- `contractCatalog.test.ts`: 계약서 변수 카탈로그가 치환 데이터 키와 일치
- `supabaseAdapter.test.ts` · `sqlBundle.test.ts`: 저장소 쿼리 체인·SQL 번들 구조
- `docEditor*.mount.test.ts`: 컴포넌트 동작

## 변경 이력
- 0.1.6 (2026-10-17): 이미지 도구 공통 계산을 `core/imageTools.ts`로 분리(모서리 정의·정렬별 허용 모서리·끌기 거리·화면 안 도구줄/손잡이 위치·점 표시 선호 저장) — DocEditor와 호스트의 RichContentEditor가 같은 규칙을 한 곳에서 쓴다. 문서 포맷·렌더·치환·계약서 고유 기능(변수칩·서명/직인·표 반복영역)은 변경 없음. 테스트: imageTools.test.ts, 실제 브라우저 e2e/editors.spec.ts. 기능 계약: .claude/rules-ref/editor-capabilities.md.
- 0.1.5 (2026-10-16): 이미지 도구줄 정리(RichContentEditor와 같은 기준) — 서식 도구줄 정렬·모서리 점 드래그와 중복·충돌하던 소·중·대 프리셋·너비 입력·정렬 버튼 제거. 도구줄은 겹치기·편집·ALT·크기 조절 점 표시/숨김(아이콘, 선택은 localStorage 'de-image-resize-handles'에 기억)·삭제. 정렬은 상단 서식 도구줄, 크기는 모서리 점이 맡는다.
- 0.1.4 (2026-10-16): onEditImage 가 문서 안 모든 이미지(images, 문서 순서)와 눌린 이미지 순번(index)을 함께 넘긴다 — 뷰어의 썸네일 정렬에 문서 전체 이미지가 나열되고, 어느 이미지든 편집 저장 시 그 자리 src만 교체(replace 는 위치가 밀려도 같은 이미지를 다시 찾고, 같은 이미지를 여러 번 편집해도 동작). 타입 EditImageInfo 는 core/types.ts.
- 0.1.3 (2026-10-16): 이미지 도구줄에 RichContentEditor 이미지 도구 이관 — '편집'(공통 뷰어를 편집 모드로 바로 열어 자르기·명암·컬러감·배경색·회전 후 src 교체) · 'ALT'(사진 설명 입력). onEditImage 콜백에 startEdit(도구줄 편집=true / 더블클릭=false) 추가. 서명·직인 삽입도 같은 image 노드라 동일 도구줄을 쓴다.
- 0.1.2 (2026-10-16): RichContentEditor 개선분 이관 — ① 이미지 선택 시 서식 도구줄 정렬 버튼이 이미지 정렬로 동작(양쪽 정렬·겹치기 이미지는 비활성) ② 이미지 모서리 점을 끌어 너비(px) 조절(가운데 정렬=네 모서리 대칭, 왼쪽 정렬·겹치기=오른쪽 모서리, 오른쪽 정렬=왼쪽 모서리, 20~1200px, 놓을 때 문서에 1회 반영). 실행취소 버튼 비활성 고정 결함은 이 모듈에는 없음(스토어 방출 기반, 테스트로 확인). 이미지 표시 크기가 바뀌면(창 크기·확대/축소·이미지 로드) 손잡이 위치를 다시 계산(ResizeObserver). 테스트: docEditorImageUpdate.mount.test.ts.
- 0.1.1 (2026-10-16): `onEditImage` 주입 지점 추가(`ui/DocEditor`·`DocWorkspace`) — 이미지 더블클릭을 호스트에 알리고 `replace`로 src 교체. 모듈은 뷰어를 import하지 않는다(이식성 유지).
- 0.1.0 (2026-10-14): 최초 — 계약서 문서형 편집기 로직을 이식형으로 이관(기능 동등) + 변수 패널·Supabase 어댑터·SQL 번들·예제.
  - 예정: 일반 문서 서식 확장(글꼴 크기·형광펜·들여쓰기·구분선) — 렌더 확장 가산 등록 후(P6).
