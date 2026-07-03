<script lang="ts">
  import CalendarGrid from '$lib/components/common/CalendarGrid.svelte'

  interface Props {
    value?: string
    name?: string
    placeholder?: string
    disablePast?: boolean
    onchange?: (iso: string) => void
  }

  let { value = $bindable(''), name = '', placeholder = '날짜 선택', disablePast = false, onchange }: Props = $props()

  let open = $state(false)

  function displayValue(iso: string): string {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return `${y}.${m}.${d}`
  }

  function handleSelect(iso: string) {
    value = iso
    open = false
    onchange?.(iso)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="dp-wrap" class:dp-open={open}>
  {#if name}
    <input type="hidden" {name} {value} />
  {/if}

  <button
    type="button"
    class="dp-trigger"
    onclick={() => open = !open}
    aria-haspopup="true"
    aria-expanded={open}
  >
    <span class="dp-value" class:dp-placeholder={!value}>
      {value ? displayValue(value) : placeholder}
    </span>
    <svg class="dp-chevron" class:dp-chevron-open={open} width="10" height="6" viewBox="0 0 10 6" fill="none">
      <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="dp-backdrop" onclick={() => open = false}></div>
    <div class="dp-popup" role="dialog" aria-label="날짜 선택">
      <CalendarGrid {value} onselect={handleSelect} {disablePast} />
    </div>
  {/if}
</div>

<style>
  .dp-wrap {
    position: relative;
    display: inline-block;
    width: 100%;
  }

  .dp-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 8px 12px;
    cursor: pointer;
    transition: outline 0.15s;
    min-height: 36px;
    text-align: left;
  }
  .dp-trigger:focus-visible {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }
  .dp-open .dp-trigger {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }

  .dp-value {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    flex: 1;
  }
  .dp-placeholder { color: var(--cs-text-placeholder); }

  .dp-chevron {
    color: var(--cs-text-mid);
    transition: transform 0.2s;
    flex-shrink: 0;
  }
  .dp-chevron-open { transform: rotate(180deg); }

  .dp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
  }

  .dp-popup {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 50;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 16px;
    box-shadow: 0 8px 24px rgba(16,11,50,0.12);
    width: 260px;
    box-sizing: border-box;
  }
</style>
