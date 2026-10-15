# doc-editor — 문서 & 양식 통합 편집기 (이식형 모듈)

TipTap 기반 문서·양식 편집기입니다. 표·반복행·이미지·서명/직인·줌·HTML 소스·**변수 칩 패널**을 한 번에 제공하고,
변수 치환·HTML 렌더 엔진과 Supabase 저장소·SQL 번들까지 포함합니다. SvelteKit(Svelte 5) 프로젝트라면 폴더를 복사해
어댑터만 연결하면 DB 연동까지 그대로 쓸 수 있습니다.

- 저장 포맷: `[{ "type": "tiptap-doc", "doc": { …TipTap JSON… } }]` (원소 1개)
- 이식 단위: 이 폴더 전체(`src/lib/modules/doc-editor`). 소스는 서로 **상대경로**로만 import 합니다.

## 폴더 구조

| 폴더 | 내용 | 호스트 의존 |
|---|---|---|
| `core/` | 타입·TipTap 확장·변수 치환·HTML 렌더·표 colwidth 보정 | 없음(순수 TS) |
| `ui/` | `DocEditor`·`VariablePanel`·`DocWorkspace`·아이콘 폰트·이미지 검증 | 없음(props 주입) |
| `adapters/supabase/` | 문서 저장소·서명자산 저장소·Storage 업로더 | Supabase 클라이언트(주입) |
| `adapters/crazyshot/` | 크레이지샷 계약서 연결(예시 구현) | 이 프로젝트 전용 — 다른 프로젝트는 참고만 |
| `sql/` | `001_doc_editor.sql` / `.rollback.sql` | PostgreSQL(Supabase) |
| `examples/` | `MinimalHost.svelte` 최소 사용 예 | 없음 |

`core/`·`ui/`·`examples/` 는 `$lib`·`$app`·`$env`·supabase 를 import 하지 않습니다(자동 테스트로 강제).

## 설치 (새 프로젝트)

1. **패키지**
   ```bash
   npm i svelte-tiptap@^3 @tiptap/core@^3 @tiptap/pm@^3 @tiptap/starter-kit@^3 \
     @tiptap/extension-table@^3 @tiptap/extension-table-row@^3 @tiptap/extension-table-header@^3 @tiptap/extension-table-cell@^3 \
     @tiptap/extension-image@^3 @tiptap/extension-underline@^3 @tiptap/extension-text-align@^3 \
     @tiptap/extension-text-style@^3 @tiptap/extension-color@^3 @tiptap/extension-font-family@^3 @tiptap/extension-link@^3
   # DB 연동을 쓸 때
   npm i @supabase/supabase-js
   ```
   (원 프로젝트 검증 버전: tiptap 3.29.x, svelte-tiptap 3.0.x, svelte 5.55.x)
2. **폴더 복사**: `src/lib/modules/doc-editor` 를 그대로 복사합니다. `adapters/crazyshot/` 은 지워도 됩니다.
3. **DB**(선택): `sql/001_doc_editor.sql` 을 Supabase SQL Editor 에서 1회 실행합니다(멱등). 되돌리기는 `.rollback.sql`.
4. **확인**: `examples/MinimalHost.svelte` 를 아무 페이지에 마운트해 편집기가 뜨는지 봅니다.

## 빠른 시작

```svelte
<script lang="ts">
  import { DocWorkspace } from '$lib/modules/doc-editor'
  import type { VariableCatalog } from '$lib/modules/doc-editor'

  const catalog: VariableCatalog = [
    { key: 'person', label: '고객', items: [{ variable: '이름', label: '이름' }] },
  ]
  let ws: DocWorkspace
  async function save() {
    const doc = ws.getEditorJSON()
    // → doc_templates.content = [{ type: 'tiptap-doc', doc }]
  }
</script>

<DocWorkspace bind:this={ws} {catalog} onchange={() => (dirty = true)} />
```

레이아웃을 직접 짜려면 `DocEditor` 와 `VariablePanel` 을 따로 쓰고 칩 클릭을 `editor.insertVariable(attrs)` 에 연결합니다.

## 컴포넌트 API

### `DocEditor`
| prop | 타입 | 설명 |
|---|---|---|
| `initialContent` | `TiptapDocBlock \| DocJSON \| null` | 초기 문서(마운트 시점 1회 읽음 — 문서가 바뀌면 `{#key}` 로 재마운트) |
| `initialHtml` | `string` | 레거시 HTML 초기값 |
| `readonly` | `boolean` | 툴바 숨김·편집 불가 |
| `onchange` | `() => void` | 내용 변경 알림(첫 로드 시 1회 호출될 수 있음 — 호출부가 로드 직후 dirty 를 초기화) |
| `notify` | `(msg, 'warning'\|'error'\|'info') => void` | 토스트 연결(없으면 무음) |
| `uploadImage` | `(file) => Promise<{url}>` | 이미지 업로더(없으면 data URL 인라인) |
| `listSignatureAssets` | `() => Promise<SignatureAsset[]>` | 서명/직인 목록 제공자 |
| `features` | `Partial<DocEditorFeatures>` | `fontColor·link·table·repeatRow·image·signature·source·zoom·paragraph·divider·emoji·fontSize·bgColor·indent` on/off(기본 전부 on). `fontSize·bgColor·indent` 는 렌더 쪽도 `FontSize·BackgroundColor·Indent` 확장을 등록해야 보이므로, 별도 렌더 집합을 쓰는 호스트는 그 등록 전까지 끄세요 |
| `placeholder` | `string` | 빈 문서 안내 문구(마운트 시점 값만 반영) |
| `iconFontUrl` | `string \| null` | 아이콘 웹폰트 CSS(기본 Google Material Icons, `null` = 로드 안 함) |

export 함수(`bind:this`): `insertVariable(attrs)`(=`insertMergeField`), `getEditorJSON()`, `getEditorHTML()`, `setEditorContent(html|json)`, `insertEditorContent(json)`, `focus()`

### `VariablePanel`
`catalog`(필수) · `onInsert(attrs)`(필수) · `extraTabs` + `extra` 스니펫(호스트 고유 탭) · `initialTab` · `hint` · `searchable`

### `DocWorkspace`
편집기 + 패널 결합. `DocEditor` props 전부 + `catalog`·`extraTabs`·`extra`·`panelWidth`·`panelHint`.

## 변수 탭 커스텀

변수 목록은 코드에 박혀 있지 않고 **호스트가 `catalog`로 넘기는 데이터**입니다. 그룹 하나가 탭 하나이고, 키(`variable`)는 치환 때 쓰는 `values` 의 키와 같으면 됩니다. 크레이지샷 계약서 변수는 `adapters/crazyshot/contractCatalog.ts` 가 넘기는 값이라, 다른 프로젝트로 옮길 때는 이 어댑터 폴더를 가져가지 않고 자기 카탈로그를 만들면 됩니다.

### 1) 탭·변수 정의

```ts
import type { VariableCatalog } from '$lib/modules/doc-editor'

export const catalog: VariableCatalog = [
  {
    key: 'customer',            // 탭 식별자(유일)
    label: '고객',              // 탭 이름
    items: [
      { variable: '이름', label: '이름' },                       // 문서에는 {{이름}} 칩으로 들어간다
      { variable: '연락처', label: '연락처', hint: '하이픈 포함' },
    ],
  },
  {
    key: 'order',
    label: '주문',
    items: [
      { variable: '주문번호', label: '주문번호' },
      { variable: '합계', label: '합계 금액(원)' },             // 표시 이름(label)과 키(variable)는 달라도 된다
    ],
  },
]
```

- `variable` 은 **치환 키**(`{{키}}`)이고 `label` 은 칩에 보이는 이름입니다. 문서에 한 번 들어간 칩은 `variable` 로 저장되므로, 이미 쓰인 키 이름을 바꾸면 기존 문서의 칩이 치환되지 않습니다(키는 바꾸지 말고 `label` 만 바꾸세요).
- 변수 목록을 DB 등에서 읽어 온다면 `catalog` 값만 바꿔 주면 패널이 따라서 갱신됩니다(이 모듈에는 변수를 추가·삭제하는 관리 화면이 없습니다).

### 2) 값 채우기 — 카탈로그와 같은 키로

```ts
import { substituteDoc, findUnresolvedInDoc } from '$lib/modules/doc-editor'

const filled = substituteDoc(doc, { values: { 이름: '홍길동', 연락처: '010-0000-0000', 주문번호: 'A-1', 합계: '120,000' } })
const missing = findUnresolvedInDoc(filled)   // 값이 없어 {{키}} 로 남은 변수 점검
```

### 3) 패널 옵션 (`VariablePanel` 직접 사용)

```svelte
<script lang="ts">
  import { DocEditor, VariablePanel } from '$lib/modules/doc-editor'
  import { catalog } from './catalog'
  let editor: DocEditor
</script>

<div style="display:flex; gap:12px">
  <div style="flex:1"><DocEditor bind:this={editor} /></div>
  <div style="width:240px">
    <VariablePanel
      {catalog}
      searchable
      initialTab="order"
      hint="클릭하면 커서 위치에 변수가 들어갑니다."
      onInsert={(attrs) => editor.insertVariable(attrs)}
    />
  </div>
</div>
```

- `searchable` 은 변수가 많을 때 검색창을 붙이고, `initialTab` 은 처음 열 탭 key 입니다.
- `DocWorkspace` 는 `catalog·extraTabs·extra·panelHint·panelWidth` 만 패널로 전달합니다. `searchable`·`initialTab` 이 필요하면 위처럼 `DocEditor` + `VariablePanel` 을 직접 배치하세요.

### 4) 변수 칩이 아닌 고유 탭 추가 (`extraTabs` + `extra`)

```svelte
<script lang="ts">
  let ws: DocWorkspace
</script>

<DocWorkspace
  bind:this={ws}
  {catalog}
  extraTabs={[{ key: 'clauses', label: '약관' }]}
>
  {#snippet extra(tabKey)}
    {#if tabKey === 'clauses'}
      <!-- 이 탭의 본문은 호스트가 자유롭게 그린다. 여기서는 버튼 하나로 변수 칩을 넣는 예 -->
      <button type="button" onmousedown={(e) => e.preventDefault()} onclick={() => ws.insertVariable({ variable: '환불약관', label: '환불약관' })}>
        환불약관 넣기
      </button>
    {/if}
  {/snippet}
</DocWorkspace>
```

- `extraTabs` 는 카탈로그 탭 **뒤에** 붙고, 활성 탭 key 가 `extra` 스니펫의 인자로 들어옵니다. 크레이지샷 계약서의 "특약" 탭이 이 방식입니다(`adapters/crazyshot/SpecsTab.svelte`).
- 편집기 선택(커서·셀 선택)이 풀리지 않게, 탭·칩 버튼은 `mousedown` 을 막습니다. 스니펫 안에 직접 만든 버튼에서 같은 현상이 있으면 `onmousedown={(e) => e.preventDefault()}` 를 붙이세요.

### 5) 칩·패널 모양

- 패널은 `--de-purple`·`--de-purple-wash`·`--de-purple-line`·`--de-lilac`·`--de-border`·`--de-surface`·`--de-text`·`--de-text-mid`·`--de-white`·`--de-radius-sm`·`--de-font-caption` 토큰을 씁니다. 색·반경은 이 변수만 덮어쓰면 바뀝니다(위 "디자인 토큰" 절).
- 문서 안에 들어가는 변수 칩(`.cs-merge-chip`)의 색은 `MergeFieldNode` 가 붙이는 클래스이므로 호스트 CSS 에서 덮어쓰세요.
- 칩 배치·글자 구성 자체를 바꾸려면 `ui/VariablePanel.svelte`(`dvp-*` 클래스)를 복사해 수정하는 것이 가장 단순합니다.

### 한계

- 탭이 많거나 변수 그룹이 수십 개인 경우의 레이아웃은 검증하지 않았습니다(이 프로젝트는 탭 4~5개).

## 변수 치환·렌더 (서버·SSR 가능)

```ts
import { substituteDoc, renderDocToHtml } from '$lib/modules/doc-editor'

const filled = substituteDoc(doc, {
  values: { 이름: '홍길동' },          // 문자열이 아닌 값은 {{키}} 원문 유지
  repeatItems: [{ 상품명: 'A' }, { 상품명: 'B' }],   // 반복행(repeatRegion) 확장. 생략하면 반복 확장 안 함, [] 이면 반복 행 제거
})
const html = renderDocToHtml(filled)   // generateHTML 사용 — jsdom/브라우저 DOM 필요(서버는 happy-dom 등 DOM 환경에서 호출)
```

- 키가 없는 변수는 `{{키}}` 원문으로 남습니다. 남은 변수 점검: `findUnresolvedInDoc(doc)`.
- 반복행: 표의 한 행을 "반복 영역"으로 지정하면 `repeatItems` 개수만큼 복제됩니다(항목 값 우선, 없으면 `values`).

## 디자인 토큰 (`--de-*`)

호스트가 정의하지 않으면 내장 기본값을 씁니다. 래퍼(또는 `:root`)에서 덮어쓰세요.

`--de-lilac`(경계·배경) · `--de-purple`(강조) · `--de-purple-hover` · `--de-purple-soft` · `--de-white` · `--de-text` · `--de-text-mid` · `--de-surface`(툴바 배경) · `--de-danger` · `--de-disabled` · `--de-radius-sm` · `--de-radius-xs` · `--de-font-caption` · `--de-font-body` · `--de-font-title`
(`adapters/crazyshot/host-tokens.css` 가 크레이지샷 토큰에 연결한 예)

## DB 연동 (Supabase)

```ts
// +page.server.ts — 서버에서 service_role 클라이언트를 만들어 주입
import { createDocStore } from '$lib/modules/doc-editor/adapters/supabase'
const docs = createDocStore(adminClient)
await docs.create({ title: '표준 계약서', kind: 'contract', content: [{ type: 'tiptap-doc', doc }] })
const { data } = await docs.get(id)           // data.content[0].doc → initialContent
await docs.update(id, { content, meta: { specs } })
await docs.remove(id)                         // 소프트 삭제
```

- 오류는 throw 하지 않고 `{ data, error }` 로 돌려줍니다.
- 이미지는 `createStorageUploader(client)` 를 `uploadImage` 에 주입(버킷 `doc-editor-assets`, 공개 읽기).
- 서명/직인: `createSignatureStore(client).list()` → `toEditorAssets(rows)` 를 `listSignatureAssets` 로.
- 테이블은 RLS 켜고 정책 없음(= 서버 전용)이 기본입니다. 브라우저 직접 접근이 필요하면 SQL 파일의 [선택] 정책을 참고해 직접 추가하세요.

## 이식 체크리스트

- [ ] 패키지 설치(위 표) · 폴더 복사
- [ ] `examples/MinimalHost.svelte` 마운트 확인(툴바·본문 표시, 표 삽입, 변수 칩 클릭 삽입)
- [ ] `--de-*` 토큰 매핑(또는 기본값 수용)
- [ ] `notify`·`uploadImage`·`listSignatureAssets` 연결(필요한 것만)
- [ ] (DB) `001_doc_editor.sql` 실행 → `createDocStore` 연결 → 저장/불러오기 왕복 확인
- [ ] 저장된 문서를 `renderDocToHtml(substituteDoc(...))` 로 화면·PDF 에 쓰는 경로가 같은 모듈의 확장 집합을 쓰는지 확인(편집기와 렌더가 다른 확장을 쓰면 서식이 사라집니다)

## 테스트

| 구분 | 위치(원 프로젝트) | 실행 |
|---|---|---|
| core 동등성·이식성·카탈로그·어댑터·SQL 구조 | `src/__tests__/modules/docEditor/` | `npx vitest run src/__tests__/modules` |
| 컴포넌트 mount | `src/__tests__/components/docEditor*.mount.test.ts` | `npm run test:component` |

## 알려진 한계

- 렌더(`renderDocToHtml`)는 DOM 이 필요합니다(브라우저·jsdom·happy-dom). 서버(Node)에서는 DOM 환경을 제공해야 합니다.
- 아이콘은 Google Material Icons 웹폰트에 의존합니다(`iconFontUrl={null}` 로 끄고 호스트 폰트를 쓸 수 있음).
- 문서형 치환은 반복행의 `{{NO.}}` 를 해석하지 않습니다(원본 계약서 엔진과 동일 동작 유지).
- 글꼴 크기·형광펜·들여쓰기·구분선 등 일반 문서 서식 확장은 렌더 쪽 가산 등록과 함께 별도 단계로 제공 예정입니다.
