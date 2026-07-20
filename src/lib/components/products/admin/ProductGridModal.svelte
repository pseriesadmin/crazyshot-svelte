<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'

  interface CategoryItem {
    id: string
    code: string
    name: string
    sort_order: number
  }

  interface GridSettings {
    category: string
    count: number
    sort: string
  }

  interface Props {
    categories: CategoryItem[]
    initialSettings: GridSettings
    onclose: () => void
  }

  let { categories, initialSettings, onclose }: Props = $props()

  let activeCategory = $state(initialSettings.category ?? 'all')
  let count = $state<number>(initialSettings.count ?? 16)
  let sort = $state(initialSettings.sort ?? 'latest')
  let isSaving = $state(false)
  let error = $state<string | null>(null)

  const SORT_OPTIONS = [
    { value: 'latest',  label: '최신 등록순' },
    { value: 'random',  label: '랜덤' },
    { value: 'views',   label: '조회수순' },
    { value: 'rentals', label: '렌탈 많은 순' },
  ]

  const COUNT_OPTIONS = [
    { value: 8,  label: '8개' },
    { value: 16, label: '16개' },
    { value: 0,  label: '전체' },
  ]

  async function save() {
    isSaving = true
    error = null
    const value: GridSettings = { category: activeCategory, count, sort }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase.rpc as any)('upsert_product_page_setting', {
      p_key: 'product_page_grid',
      p_value: value,
    })
    if (err) {
      error = (err as { message: string }).message
    } else {
      await invalidateAll()
      onclose()
    }
    isSaving = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose} role="presentation"></div>

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="상품 그리드 설정">
  <div class="modal-header">
    <span class="modal-title">상품 그리드 설정</span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="modal-body">
    <!-- 카테고리 선택 -->
    <div class="section">
      <p class="section-label">카테고리 필터</p>
      <div class="chip-group">
        <button
          class="chip"
          class:chip-active={activeCategory === 'all'}
          onclick={() => (activeCategory = 'all')}
        >전체</button>
        {#each categories as cat}
          <button
            class="chip"
            class:chip-active={activeCategory === cat.id}
            onclick={() => (activeCategory = cat.id)}
          >{cat.name}</button>
        {/each}
      </div>
    </div>

    <!-- 노출 수량 -->
    <div class="section">
      <p class="section-label">노출 수량</p>
      <div class="radio-group">
        {#each COUNT_OPTIONS as opt}
          <label class="radio-opt">
            <input
              type="radio"
              name="count"
              value={opt.value}
              checked={count === opt.value}
              onchange={() => (count = opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        {/each}
      </div>
    </div>

    <!-- 노출 순서 -->
    <div class="section">
      <p class="section-label">노출 순서</p>
      <div class="radio-group col">
        {#each SORT_OPTIONS as opt}
          <label class="radio-opt">
            <input
              type="radio"
              name="sort"
              value={opt.value}
              checked={sort === opt.value}
              onchange={() => (sort = opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        {/each}
      </div>
    </div>

    {#if error}
      <p class="save-error" role="alert">{error}</p>
    {/if}
  </div>

  <div class="modal-footer">
    <button class="btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>
    <button class="btn-save" onclick={save} disabled={isSaving}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</aside>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16, 11, 50, 0.3);
  }

  .modal-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100dvh;
    width: 420px;
    z-index: 201;
    background: var(--cs-white);
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    box-shadow: -4px 0 24px rgba(16, 11, 50, 0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    background: var(--cs-dark);
    padding: 20px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .modal-title {
    color: var(--cs-white);
    font: var(--text-pc-title-16);
  }

  .modal-close {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    min-height: 32px;
  }
  .modal-close:hover { color: var(--cs-white); }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .section { display: flex; flex-direction: column; gap: 10px; }

  .section-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }

  .chip-group {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    height: 34px;
    padding: 0 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--cs-lilac);
    background: var(--cs-white);
    color: var(--cs-text);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    white-space: nowrap;
  }
  .chip:hover { background: rgba(59, 47, 138, 0.06); }
  .chip.chip-active {
    background: var(--cs-purple);
    color: var(--cs-white);
    border-color: var(--cs-purple);
  }

  .radio-group {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  .radio-group.col { flex-direction: column; gap: 10px; }

  .radio-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    cursor: pointer;
    min-height: 32px;
  }

  .radio-opt input { accent-color: var(--cs-purple); }

  .save-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    background: rgba(255, 53, 53, 0.08);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
  }

  .modal-footer {
    flex-shrink: 0;
    padding: 16px 24px;
    display: flex;
    gap: 10px;
    border-top: 1px solid var(--cs-lilac);
  }

  .btn-cancel {
    flex: 1;
    height: 50px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-cancel:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .btn-cancel:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-save {
    flex: 1;
    height: 50px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-save:hover:not(:disabled) { background: var(--cs-red); }
  .btn-save:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
</style>
