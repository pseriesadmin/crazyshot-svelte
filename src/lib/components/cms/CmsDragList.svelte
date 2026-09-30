<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'

  interface Props {
    items: T[]
    renderItem: Snippet<[T, number]>
    itemKey?: (item: T, index: number) => string | number
    onreorder?: () => void
    class?: string
  }

  let { items = $bindable([]), renderItem, itemKey, onreorder, class: cls = '' }: Props = $props()

  let dragIdx = $state<number | null>(null)
  let overIdx = $state<number | null>(null)

  // 드래그 시작이 실제로 손잡이(.drag-handle)에서 일어난 경우에만 정렬을 시작한다 —
  // draggable="true"가 카드 전체에 걸려 있어, 카드 안 입력창에서 텍스트를 드래그
  // 선택하면 그 제스처가 카드째로 dragstart로 잡혀 화면이 함께 딸려 움직이던 버그 수정
  // (2026-09-30). 원인: 손잡이 아이콘은 시각적 표시일 뿐 실제 드래그 가능 영역이 아니었음.
  function onDragStart(e: DragEvent, i: number) {
    const target = e.target as HTMLElement | null
    if (!target?.closest('.drag-handle')) {
      e.preventDefault()
      return
    }
    dragIdx = i
  }

  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault()
    overIdx = i
  }

  function onDragEnd() {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const arr = [...items]
      const [moved] = arr.splice(dragIdx, 1)
      arr.splice(overIdx, 0, moved)
      items = arr
      onreorder?.()
    }
    dragIdx = null
    overIdx = null
  }
</script>

<div class="drag-list {cls}">
  {#each items as item, i (itemKey ? itemKey(item, i) : i)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="drag-list-item"
      class:drag-list-item--dragging={dragIdx === i}
      class:drag-list-item--over={overIdx === i && dragIdx !== i}
      draggable="true"
      ondragstart={(e) => onDragStart(e, i)}
      ondragover={(e) => onDragOver(e, i)}
      ondragend={onDragEnd}
    >
      <span class="drag-handle" aria-hidden="true">
        <svg width="10" height="14" viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="3" cy="2"  r="1.5" fill="currentColor"/>
          <circle cx="7" cy="2"  r="1.5" fill="currentColor"/>
          <circle cx="3" cy="7"  r="1.5" fill="currentColor"/>
          <circle cx="7" cy="7"  r="1.5" fill="currentColor"/>
          <circle cx="3" cy="12" r="1.5" fill="currentColor"/>
          <circle cx="7" cy="12" r="1.5" fill="currentColor"/>
        </svg>
      </span>
      {@render renderItem(item, i)}
    </div>
  {/each}
</div>

<style>
  .drag-list {
    display: flex;
    flex-direction: column;
  }

  .drag-list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    cursor: grab;
    transition: opacity 0.15s, background 0.12s;
    border-radius: var(--cms-radius-sm);
  }
  .drag-list-item:active { cursor: grabbing; }

  .drag-list-item--dragging {
    opacity: 0.4;
  }

  .drag-list-item--over {
    background: color-mix(in srgb, var(--cs-purple) 6%, transparent);
    outline: 2px dashed var(--cs-purple);
    outline-offset: -2px;
  }

  .drag-handle {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    min-height: 44px;
    color: var(--cs-text-light);
    transition: color 0.12s;
    cursor: grab;
  }
  .drag-handle:hover { color: var(--cs-purple); }
  .drag-list-item:active .drag-handle { cursor: grabbing; }
</style>
