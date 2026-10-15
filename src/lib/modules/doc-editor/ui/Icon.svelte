<script lang="ts">
  /**
   * Icon.svelte — 툴바 인라인 SVG 아이콘 (doc-editor ui, 외부 폰트 비의존)
   *
   * 이관 원본: RichContentEditor.svelte 의 {#snippet icon(name)} (원본은 무변경 유지).
   * 계약서 편집에만 쓰는 아이콘(signature·source·headerCol·repeat)은 같은 선 굵기·크기 규칙으로 새로 그렸다.
   */
  interface Props {
    name: string
  }
  let { name }: Props = $props()
</script>

{#if name === 'alignLeft'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 4h14M2 8h9M2 12h14M2 16h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
{:else if name === 'alignCenter'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 4h14M4.5 8h9M2 12h14M4.5 16h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
{:else if name === 'alignRight'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 4h14M7 8h9M2 12h14M7 16h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
{:else if name === 'alignJustify'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 4h14M2 8h14M2 12h14M2 16h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
{:else if name === 'ul'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="3" cy="5" r="1.2" fill="currentColor"/><circle cx="3" cy="9" r="1.2" fill="currentColor"/><circle cx="3" cy="13" r="1.2" fill="currentColor"/><path d="M7 5h9M7 9h9M7 13h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
{:else if name === 'ol'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><text x="1" y="7" font-size="6" fill="currentColor">1</text><text x="1" y="12" font-size="6" fill="currentColor">2</text><text x="1" y="17" font-size="6" fill="currentColor">3</text><path d="M7 5h9M7 10h9M7 15h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
{:else if name === 'indent'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 3h14M8 7h8M8 11h8M2 15h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M2 7l3 2-3 2z" fill="currentColor"/></svg>
{:else if name === 'outdent'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 3h14M8 7h8M8 11h8M2 15h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 7L2 9l3 2z" fill="currentColor"/></svg>
{:else if name === 'photo'}
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="8.5" r="1.5" fill="currentColor"/><path d="M2 14l4-4 3 3 3-3 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'emoji'}
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><circle cx="7.5" cy="8.5" r="1" fill="currentColor"/><circle cx="12.5" cy="8.5" r="1" fill="currentColor"/><path d="M7 13c.8 1.2 5.2 1.2 6 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'table'}
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 8h15M2.5 12h15M8 3.5v13M13 3.5v13" stroke="currentColor" stroke-width="1.2"/></svg>
{:else if name === 'divider'}
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2 2"/></svg>
{:else if name === 'link'}
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M8 12a4 4 0 0 0 5.66 0l2-2a4 4 0 0 0-5.66-5.66L9 5.34" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 8a4 4 0 0 0-5.66 0l-2 2a4 4 0 0 0 5.66 5.66L11 14.66" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'undo'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M6 4L3 7l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 7h7a4 4 0 0 1 0 8H7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
{:else if name === 'redo'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M12 4l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7H8a4 4 0 0 0 0 8h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
{:else if name === 'trash'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 5h12M7 5V3.5h4V5M5 5l.7 9.5h6.6L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
{:else if name === 'rowAdd'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="2.5" width="14" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M9 10.5v5M6.5 13h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'rowDel'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="2.5" width="14" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 13h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'colAdd'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.5" y="2" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M13 6.5v5M10.5 9h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'colDel'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.5" y="2" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 9h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'rowAddBefore'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="10.5" width="14" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M9 2.5v5M6.5 5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'colAddBefore'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="10.5" y="2" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M5 6.5v5M2.5 9h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'merge'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="14" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 9h3M12.5 9h-3M7 7.5L8.5 9 7 10.5M11 7.5L9.5 9 11 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
{:else if name === 'split'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="14" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 3.5v11" stroke="currentColor" stroke-width="1.4"/></svg>
{:else if name === 'headerRow'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="3" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 3h14v4H2z" fill="currentColor"/></svg>
{:else if name === 'headerCol'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="3" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 3h5v12H2z" fill="currentColor"/></svg>
{:else if name === 'repeat'}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 8V7a3 3 0 0 1 3-3h7M13 4l-2-2M13 4l-2 2M15 10v1a3 3 0 0 1-3 3H5M5 14l2 2M5 14l2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
{:else if name === 'signature'}
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 15c2.5-3 4-8 5.5-8S9 12 10.5 12 12 8 13.5 8 15 13 17 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 17.5h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
{:else if name === 'source'}
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 6L3 10l4 4M13 6l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
{/if}
