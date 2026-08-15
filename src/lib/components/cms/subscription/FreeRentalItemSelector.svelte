<script lang="ts">
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'

  interface Product { id: string; name: string }

  interface Props {
    products: Product[]
    selectedIds: string[]
  }

  let { products, selectedIds = $bindable([]) }: Props = $props()

  let pickerValue = $state('')

  const options = $derived<SuggestPickerOption[]>(
    products
      .filter((p) => !selectedIds.includes(p.id))
      .map((p) => ({ id: p.id, label: p.name }))
  )

  const selectedProducts = $derived(
    selectedIds
      .map((id) => products.find((p) => p.id === id))
      .filter((p): p is Product => !!p)
  )

  function onSelect(opt: SuggestPickerOption): void {
    if (!selectedIds.includes(opt.id)) selectedIds = [...selectedIds, opt.id]
    pickerValue = ''
  }

  function removeItem(id: string): void {
    selectedIds = selectedIds.filter((sid) => sid !== id)
  }
</script>

<div class="fri-wrap">
  <SuggestPicker
    id="fri-picker"
    options={options}
    placeholder="무료렌탈 대상 장비 검색..."
    listLabel="장비 제안"
    variant="generic"
    onselect={onSelect}
  >
    {#snippet field(c)}
      <input
        type="text"
        class="fri-input"
        id={c.id}
        placeholder={c.placeholder}
        value={pickerValue}
        oninput={(e) => { pickerValue = (e.currentTarget as HTMLInputElement).value; c.oninput(e) }}
        onkeydown={c.onkeydown}
        onfocus={c.onfocus}
        onblur={c.onblur}
        aria-autocomplete={c.ariaAutocomplete}
        aria-expanded={c.ariaExpanded}
        aria-controls={c.ariaControls}
        autocomplete="off"
      />
    {/snippet}
  </SuggestPicker>

  {#if selectedProducts.length > 0}
    <ul class="fri-list">
      {#each selectedProducts as product (product.id)}
        <li class="fri-item">
          <span class="fri-item-name">{product.name}</span>
          <button type="button" class="fri-item-remove" onclick={() => removeItem(product.id)} aria-label="{product.name} 제거">✕</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="fri-empty">선택된 장비가 없습니다.</p>
  {/if}
</div>

<style>
  .fri-wrap { display: flex; flex-direction: column; gap: 12px; }
  .fri-input {
    width: 100%; padding: 9px 12px; border: 1.5px solid var(--cs-lilac); border-radius: var(--radius-sm);
    font: var(--text-pc-body-14); color: var(--cs-text); background: var(--cs-white);
  }
  .fri-input:focus { outline: none; border-color: var(--cs-purple); }
  .fri-list { display: flex; flex-direction: column; gap: 6px; padding: 0; margin: 0; list-style: none; }
  .fri-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; background: var(--cs-surface-gray); border-radius: var(--radius-sm);
  }
  .fri-item-name { font: var(--text-pc-body-14); color: var(--cs-text); }
  .fri-item-remove {
    width: 22px; height: 22px; border: none; background: transparent; color: var(--cs-text-light);
    cursor: pointer; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    transition: background 0.12s, color 0.12s;
  }
  .fri-item-remove:hover { background: var(--cs-red-badge); color: var(--cs-white); }
  .fri-empty { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
</style>
