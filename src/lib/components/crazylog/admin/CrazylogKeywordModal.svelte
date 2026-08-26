<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'

  type KwItem = { title: string; href: string }
  type KwOption = { id: string; title: string; href: string }

  interface Props {
    initialKeywords: KwItem[]
    keywordOptions: KwOption[]
    onclose: () => void
  }

  let { initialKeywords, keywordOptions, onclose }: Props = $props()

  const MAX = 10

  const KEYWORD_OPTIONS = $derived<SuggestPickerOption[]>(
    keywordOptions.map((o) => ({ id: o.id, label: o.title }))
  )

  let keywords           = $state<KwItem[]>([...initialKeywords])
  let kwPickerSelectedId = $state<string | null>(null)
  let isSaving           = $state(false)
  let error              = $state<string | null>(null)

  const availableKwOptions = $derived(
    KEYWORD_OPTIONS.filter((opt) => !keywords.some((k) => k.href === `/crazylog/view/${opt.id}`))
  )

  function addKeyword(optId: string | null) {
    if (!optId) return
    const src = keywordOptions.find((o) => o.id === optId)
    if (!src || keywords.length >= MAX) return
    if (keywords.some((k) => k.href === src.href)) return
    keywords = [...keywords, { title: src.title, href: src.href }]
    kwPickerSelectedId = null
  }

  function removeKeyword(kw: KwItem) {
    keywords = keywords.filter((k) => k.href !== kw.href)
  }

  async function save() {
    isSaving = true
    error    = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key:   'crazylog_head_keywords',
        p_value: { items: keywords },
      })
      if (err) { error = err.message; return }
      await invalidateAll()
      onclose()
    } catch (e) {
      error = e instanceof Error ? e.message : '저장 실패'
    }
    isSaving = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose} role="presentation"></div>

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="헤드 키워드 설정">
  <div class="modal-header">
    <span class="modal-title">헤드 키워드 설정</span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="modal-scroll">
    <p class="section-label">
      키워드 선택
      <span class="hint">최대 {MAX}개 · 모바일 화면 노출</span>
    </p>

    {#if keywords.length < MAX}
      <SuggestPicker
        id="kw-picker"
        bind:selectedId={kwPickerSelectedId}
        options={availableKwOptions}
        clearOnSelect
        placeholder="키워드 검색 또는 선택..."
        listLabel="키워드 제안"
        onselect={(opt) => addKeyword(opt.id)}
      >
        {#snippet field(c)}
          <input
            type="text"
            class="f-input"
            id={c.id}
            placeholder={c.placeholder}
            aria-label="키워드 선택"
            value={c.value}
            oninput={c.oninput}
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
    {:else}
      <p class="kw-max-hint">최대 {MAX}개 선택 완료</p>
    {/if}

    {#if keywords.length > 0}
      <div class="kw-chips">
        {#each keywords as kw}
          <span class="kw-chip">
            {kw.title}
            <button
              type="button"
              class="kw-chip-remove"
              onclick={() => removeKeyword(kw)}
              aria-label="{kw.title} 제거"
            >✕</button>
          </span>
        {/each}
      </div>
    {:else}
      <p class="empty-hint">키워드를 추가하세요.</p>
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
    z-index: 201;
    background: var(--cs-white);
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    box-shadow: -4px 0 24px rgba(16, 11, 50, 0.15);
    display: flex;
    flex-direction: column;
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

  .modal-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
  }

  .hint {
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-text-light);
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

  .kw-max-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 0;
  }

  .kw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .kw-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--cs-lilac);
    color: var(--cs-text);
    border-radius: var(--radius-xl);
    padding: 6px 12px;
    font: var(--text-pc-body-14);
  }

  .kw-chip-remove {
    background: none;
    border: none;
    color: var(--cs-text-light);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    min-height: unset;
  }
  .kw-chip-remove:hover { color: var(--cs-red-badge); }

  .empty-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 0;
  }

  .save-error {
    color: var(--cs-red-badge);
    font: var(--text-pc-script-12);
    margin: 0;
  }

  .modal-footer {
    padding: 16px 24px;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    border-top: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }

  .btn-cancel {
    height: 36px;
    padding: 0 20px;
    background: none;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    cursor: pointer;
  }
  .btn-cancel:hover { border-color: var(--cs-text-mid); }

  .btn-save {
    height: 36px;
    padding: 0 24px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
  }
  .btn-save:disabled { opacity: 0.5; cursor: default; }
</style>
