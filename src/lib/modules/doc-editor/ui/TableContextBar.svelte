<script lang="ts">
  /**
   * TableContextBar.svelte — 표 안에 커서가 있을 때만 표 위에 떠 있는 편집 도구줄 (doc-editor ui, 이식형)
   *
   * 이관 원본: RichContentEditor 의 표 컨텍스트 바 UI 방식(표에 붙어 따라다니는 줄)을 따르고,
   * 계약서 고유 기능(반복행 지정, 헤더열)을 추가했다. 화면 고정(fixed) 위치를 표 상단에 맞춰 계산한다.
   */
  import type { Readable } from 'svelte/store'
  import type { Editor } from '@tiptap/core'
  import Icon from './Icon.svelte'

  interface Props {
    editorStore: Readable<Editor | undefined>
    /** 반복행 버튼 노출 여부 */
    repeatEnabled?: boolean
    /** 현재 커서 행이 반복 영역인지 */
    repeatActive?: boolean
    onToggleRepeat?: () => void
  }

  let { editorStore, repeatEnabled = true, repeatActive = false, onToggleRepeat }: Props = $props()

  let top = $state(0)
  let left = $state(0)
  let visible = $state(false)

  function recompute(): void {
    const editor = $editorStore
    if (!editor || !editor.isEditable || !editor.isActive('table')) {
      visible = false
      return
    }
    try {
      const { node } = editor.view.domAtPos(editor.state.selection.from)
      const el = node instanceof Element ? node : node.parentElement
      const table = el?.closest('table')
      if (!table) {
        visible = false
        return
      }
      const r = table.getBoundingClientRect()
      const BAR_H = 38
      top = r.top - BAR_H - 4 >= 4 ? r.top - BAR_H - 4 : Math.max(4, r.top + 4)
      left = Math.max(8, Math.min(r.left, window.innerWidth - 360))
      visible = true
    } catch {
      visible = false
    }
  }

  // 트랜잭션(선택 이동·편집)마다 svelte-tiptap 스토어가 다시 방출된다 → 위치 재계산
  $effect(() => {
    void $editorStore?.state.selection
    recompute()
  })

  $effect(() => {
    const on = () => recompute()
    window.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
    }
  })

  function keepSelection(e: Event): void {
    e.preventDefault()
  }

  function run(fn: (chain: ReturnType<Editor['chain']>) => { run: () => boolean }): void {
    const e = $editorStore
    if (!e) return
    fn(e.chain().focus()).run()
  }
</script>

{#if visible}
  <div
    class="tcb"
    style={`top: ${top}px; left: ${left}px`}
    role="toolbar"
    aria-label="표 편집 도구"
    tabindex="-1"
    onmousedown={keepSelection}
    onpointerdown={keepSelection}
  >
    <button type="button" class="tcb-btn" aria-label="행 위에 추가" title="행 위에 추가" onclick={() => run((c) => c.addRowBefore())}><Icon name="rowAddBefore" /></button>
    <button type="button" class="tcb-btn" aria-label="행 아래에 추가" title="행 아래에 추가" onclick={() => run((c) => c.addRowAfter())}><Icon name="rowAdd" /></button>
    <button type="button" class="tcb-btn tcb-danger" aria-label="행 삭제" title="행 삭제" onclick={() => run((c) => c.deleteRow())}><Icon name="rowDel" /></button>
    <span class="tcb-sep"></span>
    <button type="button" class="tcb-btn" aria-label="열 왼쪽에 추가" title="열 왼쪽에 추가" onclick={() => run((c) => c.addColumnBefore())}><Icon name="colAddBefore" /></button>
    <button type="button" class="tcb-btn" aria-label="열 오른쪽에 추가" title="열 오른쪽에 추가" onclick={() => run((c) => c.addColumnAfter())}><Icon name="colAdd" /></button>
    <button type="button" class="tcb-btn tcb-danger" aria-label="열 삭제" title="열 삭제" onclick={() => run((c) => c.deleteColumn())}><Icon name="colDel" /></button>
    <span class="tcb-sep"></span>
    <button type="button" class="tcb-btn" aria-label="셀 병합" title="선택한 셀 병합 (셀 여러 개를 드래그로 선택한 뒤 클릭)" onclick={() => run((c) => c.mergeCells())}><Icon name="merge" /></button>
    <button type="button" class="tcb-btn" aria-label="셀 분할" title="병합된 셀 분할" onclick={() => run((c) => c.splitCell())}><Icon name="split" /></button>
    <span class="tcb-sep"></span>
    <button type="button" class="tcb-btn" aria-label="헤더행 토글" title="헤더행 토글" onclick={() => run((c) => c.toggleHeaderRow())}><Icon name="headerRow" /></button>
    <button type="button" class="tcb-btn" aria-label="헤더열 토글" title="헤더열 토글" onclick={() => run((c) => c.toggleHeaderColumn())}><Icon name="headerCol" /></button>
    {#if repeatEnabled}
      <button
        type="button"
        class="tcb-btn"
        class:tcb-on={repeatActive}
        aria-label="반복 영역 지정/해제"
        aria-pressed={repeatActive}
        title="이 행을 반복 영역으로 지정/해제 — 계약서 발송 시 상품목록 항목별로 행이 반복됩니다"
        onclick={() => onToggleRepeat?.()}
      ><Icon name="repeat" /></button>
    {/if}
    <span class="tcb-sep"></span>
    <button type="button" class="tcb-btn tcb-danger" aria-label="표 삭제" title="표 삭제" onclick={() => run((c) => c.deleteTable())}><Icon name="trash" /></button>
  </div>
{/if}

<style>
  .tcb {
    position: fixed;
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding: 0 6px;
    border-radius: var(--de-radius-md, 15px);
    background: var(--de-white, #FFFFFF);
    box-shadow: 0 4px 16px color-mix(in srgb, var(--de-text, #100B32) 18%, transparent);
  }
  .tcb-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: var(--de-radius-xs, 8px);
    background: transparent;
    color: var(--de-text, #100B32);
    cursor: pointer;
  }
  .tcb-btn:hover { background: color-mix(in srgb, var(--de-purple, #3B2F8A) 8%, transparent); }
  .tcb-on { background: color-mix(in srgb, var(--de-purple, #3B2F8A) 14%, transparent); color: var(--de-purple, #3B2F8A); }
  .tcb-danger:hover { background: var(--de-danger-soft, #FFEAEA); color: var(--de-danger, #FF3535); }
  .tcb-sep { width: 1px; height: 16px; margin: 0 3px; background: var(--de-border, #E0E0E6); }
</style>
