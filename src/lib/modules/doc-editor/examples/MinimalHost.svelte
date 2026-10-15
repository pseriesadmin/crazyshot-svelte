<script lang="ts">
  /**
   * MinimalHost.svelte — 통합 편집기 최소 사용 예제 (이식 검증용)
   *
   * 이 파일은 모듈 안의 것(../index)만 import 한다 — 새 프로젝트에 폴더를 복사한 뒤
   * 이 컴포넌트가 그대로 마운트되면 "설치가 끝났다"는 뜻이다(README의 이식 체크리스트 참조).
   * 호스트 쪽에서는 notify·uploadImage·listSignatureAssets·저장(onSave)만 자기 구현으로 바꾸면 된다.
   */
  import { DocWorkspace } from '../index'
  import type { DocJSON, TiptapDocBlock, VariableCatalog } from '../index'

  interface Props {
    /** 저장된 문서(없으면 빈 문서) */
    initial?: TiptapDocBlock | DocJSON | null
    /** 변수 카탈로그 — 호스트 도메인에 맞게 구성 */
    catalog?: VariableCatalog
    /** 저장 버튼 — 서버로 보낼 content 배열을 받는다(DB의 doc_templates.content 형식) */
    onSave?: (content: TiptapDocBlock[]) => void | Promise<void>
  }

  const DEFAULT_CATALOG: VariableCatalog = [
    { key: 'person', label: '고객', items: [{ variable: '이름', label: '이름' }, { variable: '연락처', label: '연락처' }] },
  ]

  let { initial = null, catalog = DEFAULT_CATALOG, onSave }: Props = $props()

  let workspace: DocWorkspace | undefined = $state()
  let dirty = $state(false)

  async function save() {
    const doc = workspace?.getEditorJSON()
    if (!doc) return
    await onSave?.([{ type: 'tiptap-doc', doc }])
    dirty = false
  }
</script>

<div class="mh-root">
  <DocWorkspace
    bind:this={workspace}
    {catalog}
    initialContent={initial}
    iconFontUrl={null}
    onchange={() => { dirty = true }}
  />
  <div class="mh-actions">
    <button type="button" class="mh-save" onclick={save} disabled={!dirty}>저장</button>
  </div>
</div>

<style>
  .mh-root { display: flex; flex-direction: column; gap: 12px; }
  .mh-actions { display: flex; justify-content: flex-end; }
  .mh-save {
    height: 36px;
    padding: 0 16px;
    border: none;
    border-radius: var(--de-radius-sm, 10px);
    background: var(--de-purple, #3B2F8A);
    color: var(--de-white, #FFFFFF);
    font: var(--de-font-body, 700 14px/200% sans-serif);
    cursor: pointer;
  }
  .mh-save:disabled { background: var(--de-disabled, #B0ABCC); cursor: not-allowed; }
</style>
