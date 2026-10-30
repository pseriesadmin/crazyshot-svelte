## 최근 변경 (AI가 이전 버전과의 차이를 빨리 파악하는 곳)

> 이미 v1.0.0 을 가져가 쓰는 프로젝트라면 **이 절만 읽고** 아래 "호스트가 할 일"을 따르면 된다.
> 파일 단위 차이는 `MANIFEST.json` 의 `sha256` 을 이전 키트와 비교하면 정확히 나온다. **저장 포맷·DB 스키마(`sql/`) 변경은 없다**(v1.0.0 으로 저장한 양식이 그대로 열린다).

### v1.1.0 (2026-10-29) — doc-editor 0.1.6 → 0.1.7 + 양식 편집 화면·가져오기 보강

| 층 | 파일(키트 기준) | 바뀐 점 | 호스트 영향 |
|---|---|---|---|
| A 편집기 | `lib/modules/doc-editor/ui/TableContextBar.svelte` | 표 보조 툴바(`position:fixed`)를 보이는 편집 영역(`.de-editor-area`) 안으로 가둔다. 표가 영역 밖으로 스크롤되면 숨긴다(전에는 화면 맨 위에 붙어 메인 툴바·헤더 위로 지나갔다). 영역 크기를 잴 수 없으면(jsdom 등 크기 0) 가두지 않고 화면 전체 기준 | 없음. 편집 영역 래퍼의 클래스 `.de-editor-area` 를 바꾸지 말 것 |
| A 편집기 | `lib/modules/doc-editor/ui/DocToolbar.svelte` | 서식 목록 창(글꼴·색·표 등, `position:fixed`)이 문서 스크롤 때 닫힌다(목록 안 스크롤은 유지) | 없음 |
| C 화면 | `lib/components/cms/contract-editor/ContractSpreadsheetEditor.svelte` | ① 빈 격자 최소 26열(A~Z) ② 스크롤이 끝에 가까우면 빈 행 30개씩 자동 추가(시트당 5,000행 상한, 변경 알림·수식 보정은 건너뜀) ③ 수식 줄·머리글 고정 위치를 툴바 실측 높이로 계산(CSS 변수 `--cse-toolbar-h`·`--cse-head-top`, ResizeObserver) ④ 겹침 순서 정리(채우기 점 1 · 이미지 3 · 머리글·수식 줄 4 · 툴바 5) ⑤ 축 머리글 글자를 `--text-pc-body-14` + `--cs-text-mid` 로 | CSS 변수 `--text-pc-body-14`, `--cs-text-mid` 필요(`host/tokens.css` 에 이미 포함) |
| C 화면 | `lib/components/cms/contract-editor/spreadsheetWidgetAdapter.ts` | `GRID_MIN_COLS = 26` 추가, `gridDimensionsToFill` 이 열을 최소 26으로 보장 | 없음 |
| C 화면 | `lib/components/cms/contract-editor/ContractCanvasEditor.svelte` | ① 필드 팔레트를 우측으로 옮기고 접기/펼치기(›‹, 저장 키 `cs-contracts-fieldpanel-open`) ② 외부에서 호출하는 `save()`·`addBackgroundFile(file)` 공개 ③ 새 prop `showSaveButton`(기본 `true` — 기존 호출부 그대로 동작) | 호스트가 저장 버튼을 자기 하단 줄에 두려면 `showSaveButton={false}` + `bind:this` 후 `ref.save()` |
| C 화면 | `lib/components/cms/contract-editor/ContractCanvasFieldPalette.svelte` | 폭·구분선은 바깥 열(`.palette-col`)이 맡고 팔레트는 100% 폭 | 없음 |
| C 화면 | `lib/components/cms/contract-editor/ContractImportModal.svelte` | 한글(.hwp/.hwpx) 가져오기의 **동의 단계 제거** — 파일을 고르면 곧바로 변환해 미리보기를 보인다(손실 안내는 미리보기 상단에 한 줄) | 동의 화면을 전제로 한 호스트 테스트가 있으면 수정 |
| C 가져오기 | `lib/utils/docImport/xlsBiff.ts` **(신규)** | 구형 엑셀(.xls, BIFF8 바이너리)을 직접 읽어 테두리·배경·정렬·글꼴·열/행 기본 서식·숨김 시트·JPEG/PNG 그림·글상자 글자를 꺼낸다. 의존: `xlsx`(SheetJS) 의 CFB 만 사용, DOM 비사용 | 없음(기존 `xlsx` 의존만) |
| C 가져오기 | `lib/utils/docImport/xlsTextBoxes.ts` **(신규)** | 글상자 글자를 도형 영역 가운데의 가까운 빈 칸 값으로 옮긴다(기존 값은 덮어쓰지 않음) | 없음 |
| C 가져오기 | `lib/utils/docImport/{xlsxImport,xlsxImages,xlsxExtras,xlsxToSpreadsheetDocument}.ts` | `.xls` 이면 위 BIFF 읽기로 분기(.xlsx 경로는 그대로) | 없음 |
| 테스트 | `tests/services/xlsBiff.test.ts` **(신규)**, `tests/services/spreadsheetTrim.test.ts`, `tests/components/contractImportModal.mount.test.ts` | .xls 서식·그림·글상자 해석 / 최소 26열 / 동의 단계 없는 가져오기 | 기존 테스트 폴더에 덮어쓰기 |

#### v1.0.0(2026-10-18) 이후 같이 반영된 것 — 키트는 매번 원본 현재 소스 전체를 다시 만든다
| 층 | 파일(키트 기준) | 내용 | 호스트 영향 |
|---|---|---|---|
| C 내보내기 | `lib/utils/docExport/*`(신규 9개) · `lib/components/cms/contract-editor/ContractFileSaveMenu.svelte`(신규) | 편집 중인 양식을 파일로 저장: 문서형 docx·hwp·pdf·html / HTML형 html·pdf / 스프레드시트형 xlsx·ods·pdf·html·csv·tsv. 헤더의 `파일 저장` 메뉴 | **npm 추가: `exceljs 4.4.0`, `docx 9.15.0`**(`deps.json`) |
| C 수식 | `lib/utils/sheetFormula/*`(신규 5개) | 스프레드시트 수식 엔진(약 40개 함수·시트 간 참조·행/열 삽입 시 참조 보정). `eval` 미사용 | 없음 |
| C 가져오기 | `lib/utils/docImport/{xlsxImages,xlsxExtras}.ts`(신규) · `xlsxImport.ts` · `spreadsheetRender.ts` · `lib/types/{sheet-format,contract-document}.ts` | .xlsx 원본 보존 가져오기(열 너비·행 높이·테두리·정렬·글꼴·그림·숨김 시트·틀 고정·하이퍼링크·수식). 셀 값 안의 표식 `cs-image://…`·`cs-link://…`, 타입에 `formulas`·`numFmts`·`hidden`·`freeze` 추가(모두 선택 필드 — 기존 저장본 호환) | 그림은 가져오기 확정 때 호스트의 이미지 업로드(`onUploadImage`)로 올린다 |
| C 가져오기 | `lib/utils/docImport/{rhwpLoader,rhwpPreview}.ts`(신규) | 한글 원본 미리보기·누름틀→변수 연결(다른 작업) | **npm 추가: `@rhwp/core 0.8.7`**(약 3MB, 처음 쓸 때만 로드) |
| C 공통 | `lib/components/cms/CmsHelpBubble.svelte`, `lib/components/common/SuggestPicker.svelte`, `lib/types/suggest-picker.ts`(신규) · `PdfViewer`/`MediaViewer`/`doc-editor/core/imageTools.ts`/`utils/kstDate.ts` 소폭 수정 | 위 화면이 쓰는 공통 부품·보정(다른 작업 포함) | 없음 |
| 참고 | `reference/src/routes/api/cms/contract-templates/export-pdf/+server.ts`(신규) | PDF 저장 서버 예시(headless Chromium) | D층 환경 필요 |

- `host/tokens.css` 가 "정의 못 찾음"으로 알리는 `--cse-toolbar-h`·`--cse-head-top` 은 **스프레드시트 편집기가 실행 중에 직접 넣는 값**(CSS 에 기본값 포함)이라 호스트가 정의하지 않아도 된다.

#### 참고용(`reference/`, 렌탈 도메인 결합 — 그대로 쓰지 않고 자기 호스트에 새로 구현할 때의 본보기)
- `reference/src/lib/components/cms/ContractTemplatePanel.svelte` 와 `reference/src/routes/cms/reservation/contracts/` 에 아래 흐름이 구현돼 있다.
  - **이탈 경고·임시저장·복구**(문서형·HTML형·스프레드시트형): `reference/src/lib/utils/contractModeDraft.ts`(문서형·HTML형), `contractSheetDraft.ts`(스프레드시트형), `contractUnsavedGuard.ts`(양식 전환·닫기 확인 + 확인창이 즉시 취소되는 환경 토스트 `askConfirm`). 브라우저 localStorage, 7일 만료, 문서형 150만 자·HTML형 30만 자 초과 시 임시저장 없이 경고만.
  - **문서형 변경 감지**: 편집기 변경 알림(`onchange`)만 믿지 않고 열린 시점의 문서 JSON 과 비교(끝의 빈 문단은 무시). 편집기에 포커스만 줘도 끝에 빈 문단이 붙는 TipTap 동작 때문. 구현: 패널의 `flowBaseline`·`flowSignature()`·`onFlowEditorChange()`.
  - **다른 형식 파일을 가져오면 새 양식으로 이어서 작성**: 저장된 양식은 작성 모드를 못 바꾸므로(서버도 거절) 엑셀↔문서·한글, **PDF→고정 캔버스형** 은 새 양식 화면을 열어 가져온다(패널 prop `onStartNewFromImport`·`initialImportFile`, 캔버스 `addBackgroundFile`).
  - 작성 중(저장 전) 내용이 있으면 `문서 가져오기` 를 누르는 즉시 "작성중인 문서를 저장해주세요." 토스트로 중단.

### 호스트가 할 일 (v1.0.0 → v1.1.0 업그레이드)
1. `lib/` 를 `src/lib/contract-kit/` 에 **덮어쓰기**(신규 파일이 많으니 폴더째 복사. 삭제된 파일은 없음), `tests/` 를 `src/__tests__/contract-kit/` 에 덮어쓰기.
1-1. `deps.json` 대조: 새로 필요한 npm 패키지 `exceljs`·`docx`(파일 저장), `@rhwp/core`(한글 원본 미리보기)를 설치.
2. 자기 CSS 에 `--text-pc-body-14`, `--cs-text-mid` 가 있는지 확인(`host/tokens.css` 참고).
3. `ContractCanvasEditor` 를 쓰는 호스트 화면: 동작 그대로면 수정 불필요. 저장 버튼 위치를 바꾸고 싶을 때만 위 `showSaveButton`·`save()` 사용.
4. 한글 가져오기 동의 모달을 전제로 한 호스트 코드·테스트가 있으면 제거.
5. 임시저장·이탈 경고·"새 양식으로 이어서 작성"이 필요하면 `reference/` 의 위 파일을 본보기로 호스트 패널에 구현(키트 본체에는 포함되지 않는다).
6. 검증: 키트 폴더에서 `VERIFY.md` 의 절차(빈 SvelteKit 프로젝트에서 vitest·svelte-check)를 다시 실행.
