<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'

  interface PostItem {
    id: string
    title: string
    log_type: string | null
    thumbnail_url: string | null
  }

  interface SlotSettings {
    posts: { id: string; order: number }[]
    mode: 'random' | 'fixed'
  }

  interface Props {
    slotKey: string
    initialSettings: SlotSettings
    onclose: () => void
  }

  let { slotKey, initialSettings, onclose }: Props = $props()

  let mode = $state<'random' | 'fixed'>(initialSettings.mode)
  let selected = $state<PostItem[]>([])
  let searchResults = $state<PostItem[]>([])
  let isSearching = $state(false)
  let isLoadingInitial = $state(false)
  let isSaving = $state(false)
  let error = $state<string | null>(null)
  let debounceTimer = $state<ReturnType<typeof setTimeout> | null>(null)
  let pickerSelectedId = $state<string | null>(null)

  const MAX_ITEMS = 8

  const selectedIds = $derived(new Set(selected.map((s) => s.id)))

  const pickerOptions = $derived<SuggestPickerOption[]>(
    searchResults
      .filter((p) => !selectedIds.has(p.id))
      .map((p) => ({
        id:    p.id,
        label: p.title,
        meta:  [p.log_type ?? ''],
      }))
  )

  function onPickerInput(val: string) {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!val.trim()) { searchResults = []; return }
    debounceTimer = setTimeout(() => doSearch(val.trim()), 280)
  }

  function onPostSelect(opt: SuggestPickerOption) {
    const post = searchResults.find((p) => p.id === opt.id)
    if (post) addPost(post)
    setTimeout(() => { pickerSelectedId = null; searchResults = [] }, 0)
  }

  $effect(() => {
    const ids = initialSettings.posts
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((p) => p.id)
      .filter(Boolean)
    if (!ids.length) return
    isLoadingInitial = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase.rpc as any)('get_crazylog_posts_by_ids', { p_ids: ids }).then(
      ({ data }: { data: unknown[] | null }) => {
        if (!data) { isLoadingInitial = false; return }
        const map = new Map<string, PostItem>()
        for (const r of data as Record<string, unknown>[]) {
          const id = String(r['id'] ?? '')
          if (id) map.set(id, {
            id,
            title:         String(r['title'] ?? ''),
            log_type:      (r['log_type'] as string | null) ?? null,
            thumbnail_url: (r['thumbnail_url'] as string | null) ?? null,
          })
        }
        selected = ids.map((id) => map.get(id)).filter((x): x is PostItem => !!x)
        isLoadingInitial = false
      }
    )
  })

  async function doSearch(q: string) {
    isSearching = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('search_crazylog_posts', {
      p_query: q,
      p_limit: 10,
    })
    searchResults = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id:            String(r['id'] ?? ''),
      title:         String(r['title'] ?? ''),
      log_type:      (r['log_type'] as string | null) ?? null,
      thumbnail_url: (r['thumbnail_url'] as string | null) ?? null,
    }))
    isSearching = false
  }

  function addPost(p: PostItem) {
    if (selected.length >= MAX_ITEMS) return
    if (selected.some((s) => s.id === p.id)) return
    selected = [...selected, p]
  }

  function removePost(id: string) {
    selected = selected.filter((s) => s.id !== id)
  }

  async function save() {
    isSaving = true
    error = null
    const value: SlotSettings = {
      posts: selected.map((p, i) => ({ id: p.id, order: i })),
      mode,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase.rpc as any)('upsert_crazylog_banner_setting', {
      p_key: slotKey,
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

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="크레이지 로그 목록 선택">
  <div class="modal-header">
    <span class="modal-title">크레이지 로그 목록 선택</span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="modal-body">
    <div class="section">
      <p class="section-label">노출 방식</p>
      <div class="radio-group">
        <label class="radio-opt">
          <input type="radio" name="mode" value="fixed" checked={mode === 'fixed'} onchange={() => (mode = 'fixed')} />
          <span>고정 순서</span>
        </label>
        <label class="radio-opt">
          <input type="radio" name="mode" value="random" checked={mode === 'random'} onchange={() => (mode = 'random')} />
          <span>랜덤 노출 (최대 3개)</span>
        </label>
      </div>
    </div>

    <div class="section">
      <p class="section-label">로그 추가 <span class="count-badge">{selected.length}/{MAX_ITEMS}</span></p>
      <div class="search-wrap">
        <SuggestPicker
          id="crazylog-banner-search"
          bind:selectedId={pickerSelectedId}
          options={pickerOptions}
          noFilter
          clearOnSelect
          itemLayout="row"
          placeholder="포스트 제목으로 검색..."
          listLabel="크레이지 로그 검색 결과"
          oninput={onPickerInput}
          onselect={onPostSelect}
        >
          {#snippet field(c)}
            <input
              type="text"
              class="f-input"
              id={c.id}
              placeholder={c.placeholder}
              value={c.value}
              oninput={c.oninput}
              onkeydown={c.onkeydown}
              onfocus={c.onfocus}
              onblur={c.onblur}
              aria-autocomplete={c.ariaAutocomplete}
              aria-expanded={c.ariaExpanded}
              aria-controls={c.ariaControls}
              autocomplete="off"
              disabled={selected.length >= MAX_ITEMS}
            />
          {/snippet}
          {#snippet renderItem(item, _i, _sel)}
            <span class="suggest-name">{item.label}</span>
            <span class="suggest-type">{item.meta?.[0] ?? ''}</span>
          {/snippet}
        </SuggestPicker>
        {#if isLoadingInitial || isSearching}
          <p class="search-hint">{isLoadingInitial ? '저장된 로그 불러오는 중…' : '검색 중…'}</p>
        {/if}
      </div>
    </div>

    {#if selected.length > 0}
      <div class="section">
        <p class="section-label">선택된 로그 (드래그로 순서 변경)</p>
        <CmsDragList bind:items={selected} itemKey={(item) => item.id}>
          {#snippet renderItem(item)}
            <div class="selected-row">
              <span class="selected-name">{item.title}</span>
              <button class="remove-btn" onclick={() => removePost(item.id)} aria-label="{item.title} 제거">✕</button>
            </div>
          {/snippet}
        </CmsDragList>
      </div>
    {:else}
      <p class="empty-msg">위 검색창에서 로그를 추가하세요.</p>
    {/if}

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
    max-width: 100vw;
    z-index: 201;
    background: var(--cs-white);
    border-radius: var(--radius-xl) 0 0 var(--radius-xl);
    box-shadow: -4px 0 24px rgba(16, 11, 50, 0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    background: var(--cs-dark);
    flex-shrink: 0;
  }

  .modal-title {
    color: var(--cs-white);
    font: var(--text-pc-title-16);
  }

  .modal-close {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    padding: 4px 8px;
    min-height: 32px;
    transition: color 0.15s;
  }
  .modal-close:hover { color: var(--cs-white); }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .section-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0 0 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .count-badge {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .radio-group { display: flex; gap: 16px; }
  .radio-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    cursor: pointer;
  }

  .search-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 8px;
  }

  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    padding: 10px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 100%;
    box-sizing: border-box;
  }
  .f-input::placeholder { color: var(--cs-text-light); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .suggest-name { flex: 1; }
  .suggest-type { color: var(--cs-text-mid); font-size: 12px; }

  .selected-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-md);
  }
  .selected-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .remove-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--cs-text-mid);
    min-height: 32px;
    min-width: 32px;
  }
  .remove-btn:hover { color: var(--cs-red-badge); }

  .empty-msg {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    text-align: center;
    padding: 20px 0;
  }

  .save-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
  }

  .modal-footer {
    display: flex;
    gap: 10px;
    padding: 16px 24px;
    border-top: 1px solid var(--cs-border);
    flex-shrink: 0;
  }

  .btn-cancel,
  .btn-save {
    flex: 1;
    min-height: 44px;
    border-radius: var(--radius-xl);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    border: none;
  }
  .btn-cancel {
    background: var(--cs-surface-gray);
    color: var(--cs-text);
  }
  .btn-cancel:hover { background: var(--cs-border); }
  .btn-save {
    background: var(--cs-red-badge);
    color: var(--cs-white);
  }
  .btn-save:hover { background: var(--cs-red); }
  .btn-save:disabled,
  .btn-cancel:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
