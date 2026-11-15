<script lang="ts">
  // 쿠폰 선택 — 이미 만들어진 쿠폰 중 1개(선택 안 함 가능). 쿠폰은 참조만 한다.
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { BadgeCouponOption } from '$lib/types/badge'

  interface Props {
    options: BadgeCouponOption[]
    value: string | null
    onchange: (id: string | null) => void
  }

  let { options, value, onchange }: Props = $props()

  const pickerOptions = $derived(options.map((o) => ({ id: o.id, label: o.label })))
  const selectedLabel = $derived(options.find((o) => o.id === value)?.label ?? null)
  let selId = $state<string | null>(null)
</script>

{#if value}
  <div class="cp-chip">
    <span class="cp-chip-label">{selectedLabel ?? '삭제된 쿠폰'}</span>
    <button type="button" class="close-red" aria-label="쿠폰 선택 해제" onclick={() => onchange(null)}>✕</button>
  </div>
{:else}
  <SuggestPicker
    id="badge-coupon"
    bind:selectedId={selId}
    options={pickerOptions}
    placeholder="쿠폰 선택"
    listLabel="쿠폰"
    variant="generic"
    minChars={0}
    pageSize={10}
    clearOnSelect
    onselect={(opt) => { selId = null; onchange(opt.id) }}
  >
    {#snippet field(c)}
      <input type="text" role="combobox" class="cp-input" id={c.id} placeholder={c.placeholder}
        value={c.value} oninput={c.oninput} onkeydown={c.onkeydown}
        onfocus={c.onfocus} onblur={c.onblur}
        aria-autocomplete={c.ariaAutocomplete} aria-expanded={c.ariaExpanded}
        aria-controls={c.ariaControls} autocomplete="off" />
    {/snippet}
  </SuggestPicker>
{/if}

<style>
  /* 인라인 입력 — ProductDetailPanel .il-input 과 동일 */
  .cp-input {
    width: 100%; background: transparent; border: none; border-radius: var(--cms-radius-sm);
    padding: 3px 8px; font: var(--text-pc-body-14); color: var(--cs-text); min-height: 32px;
    transition: background 0.12s, outline 0.12s;
  }
  .cp-input::placeholder { color: var(--cs-text-placeholder); }
  .cp-input:hover { background: rgba(59,47,138,0.04); }
  .cp-input:focus { background: var(--cs-surface-gray); outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }
  .cp-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 6px 0 8px;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-lilac);
  }
  .cp-chip-label { flex: 1; min-width: 0; font: var(--text-pc-body-14); color: var(--cs-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close-red {
    flex-shrink: 0;
    width: 28px; height: 28px; min-height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .close-red:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
</style>
