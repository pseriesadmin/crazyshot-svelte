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
- 0.1.0 (2026-10-14): 최초 — 계약서 문서형 편집기 로직을 이식형으로 이관(기능 동등) + 변수 패널·Supabase 어댑터·SQL 번들·예제.
  - 예정: 일반 문서 서식 확장(글꼴 크기·형광펜·들여쓰기·구분선) — 렌더 확장 가산 등록 후(P6).
