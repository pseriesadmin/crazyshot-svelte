<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import {
    HELP_HERO_DEFAULT_TITLE, HELP_HERO_DEFAULT_SUB, HELP_HERO_TITLE_MAX, HELP_HERO_SUB_MAX,
  } from '$lib/constants/helpHero'

  interface ImageItem {
    url: string
    path: string
  }

  interface Props {
    initialImages: ImageItem[]
    initialMode: 'random' | 'fixed'
    initialTitle?: string
    initialSub?: string
    onclose: () => void
    /** 통합 설정 모달 안에 섹션으로 표시(오버레이·헤더·취소 숨김) */
    embedded?: boolean
  }

  let { initialImages, initialMode, initialTitle = '', initialSub = '', onclose, embedded = false }: Props = $props()

  let images = $state<ImageItem[]>(initialImages.map((img) => ({ ...img })))
  let mode = $state<'random' | 'fixed'>(initialMode)
  // 메인·서브 문구 — 줄바꿈(Enter) 그대로 화면에 반영, 비우면 기본 문구 사용
  let title = $state(initialTitle)
  let sub = $state(initialSub)

  $effect(() => {
    images = initialImages.map((img) => ({ ...img }))
    mode = initialMode
    title = initialTitle
    sub = initialSub
  })
  let isUploading = $state(false)
  let isSaving = $state(false)
  let error = $state<string | null>(null)
  let fileInput: HTMLInputElement | undefined = $state()

  function openFilePicker() {
    fileInput?.click()
  }

  async function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    if (!files.length) return
    input.value = ''

    isUploading = true
    error = null
    for (const file of files) {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/cms/help/hero-bg', { method: 'POST', body: form })
      if (!res.ok) {
        const msg = await res.text().catch(() => '업로드 실패')
        error = msg
        break
      }
      const { url, path } = (await res.json()) as { url: string; path: string }
      images = [...images, { url, path }]
    }
    isUploading = false
  }

  async function removeImage(item: ImageItem) {
    images = images.filter((img) => img.path !== item.path)
    fetch('/api/cms/help/hero-bg', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path }),
    }).catch(() => {/* storage 삭제 실패는 무시 — UI에서 이미 제거됨 */})
  }

  async function save() {
    isSaving = true
    error = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key: 'help_hero_bg_images',
        p_value: { images, mode, title: title.trim(), sub: sub.trim() },
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

{#if !embedded}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onclose} role="presentation"></div>
{/if}

<aside class="modal-panel" class:embedded role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="도움말 히어로 배경·문구 관리">
  {#if !embedded}
    <div class="modal-header">
      <span class="modal-title">도움말 히어로 관리 (배경·문구)</span>
      <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
    </div>
  {/if}

  <div class="modal-body">
    <!-- 메인·서브 문구 -->
    <div class="section">
      <p class="section-label">메인 문구 <span class="hint">{title.length}/{HELP_HERO_TITLE_MAX} · 줄바꿈 가능</span></p>
      <textarea class="text-input" rows="3" maxlength={HELP_HERO_TITLE_MAX} placeholder={HELP_HERO_DEFAULT_TITLE} bind:value={title}></textarea>
    </div>
    <div class="section">
      <p class="section-label">서브 문구 <span class="hint">{sub.length}/{HELP_HERO_SUB_MAX} · 줄바꿈 가능</span></p>
      <textarea class="text-input" rows="3" maxlength={HELP_HERO_SUB_MAX} placeholder={HELP_HERO_DEFAULT_SUB} bind:value={sub}></textarea>
      <p class="hint">비워두면 기본 문구가 표시됩니다.</p>
    </div>

    <!-- 노출 방식 -->
    <div class="section">
      <p class="section-label">노출 방식</p>
      {#if embedded}
        <!-- 통합 홈 화면 설정 모달: 다른 섹션과 같은 콤보 버튼(mode-chip) 규격 — 스타일은 HomeSettingsModal 공통 레이어 -->
        <div class="mode-chips">
          <button type="button" class="mode-chip" class:mode-chip--on={mode === 'random'} aria-pressed={mode === 'random'} onclick={() => (mode = 'random')}>랜덤 노출</button>
          <button type="button" class="mode-chip" class:mode-chip--on={mode === 'fixed'} aria-pressed={mode === 'fixed'} onclick={() => (mode = 'fixed')}>첫 번째 고정</button>
        </div>
      {:else}
        <div class="radio-group">
          <label class="radio-opt">
            <input type="radio" name="mode" value="random" checked={mode === 'random'} onchange={() => (mode = 'random')} />
            <span>랜덤 노출</span>
          </label>
          <label class="radio-opt">
            <input type="radio" name="mode" value="fixed" checked={mode === 'fixed'} onchange={() => (mode = 'fixed')} />
            <span>첫 번째 고정</span>
          </label>
        </div>
      {/if}
    </div>

    <input
        bind:this={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
        multiple
        class="hidden-input"
        onchange={onFileChange}
      />

    <!-- 이미지 목록 -->
    {#if images.length > 0}
      <div class="section">
        <p class="section-label">이미지 목록 <span class="hint">드래그로 순서 변경</span></p>
        <CmsDragList bind:items={images} itemKey={(item) => item.path}>
          {#snippet renderItem(item)}
            <div class="img-row">
              <img src={item.url} alt="Hero BG" class="img-thumb" />
              <span class="img-path">{item.path.split('/').pop()}</span>
              <button class="img-remove" onclick={() => removeImage(item)} aria-label="이미지 제거">✕</button>
            </div>
          {/snippet}
        </CmsDragList>
        <div class="empty-msg add-only"><button type="button" class="icon-tile" onclick={openFilePicker} disabled={isUploading} aria-label="이미지 추가"><span class="tile-tag">+</span></button></div>
      </div>
    {:else}
      <div class="empty-row">
        <span class="empty-handle" aria-hidden="true">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="3" cy="2" r="1.5" fill="currentColor"/><circle cx="7" cy="2" r="1.5" fill="currentColor"/>
            <circle cx="3" cy="7" r="1.5" fill="currentColor"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/>
            <circle cx="3" cy="12" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/>
          </svg>
        </span>
        <div class="empty-msg">
        <button type="button" class="icon-tile" onclick={openFilePicker} disabled={isUploading} aria-label="이미지 추가"><span class="tile-tag">+</span></button>
        <p class="empty-text">이미지를 추가하면 히어로 배경으로 사용됩니다.<br />이미지가 없으면 기본 이미지가 사용됩니다.</p>
        <button type="button" class="empty-remove" disabled aria-label="제거(비활성)" tabindex="-1">
            <!-- CMS 공통 표준 삭제 아이콘(휴지통 SVG 12×12) — 비어 있어 비활성 표시 -->
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="3,6 5,6 21,6"/>
              <path d="M19,6l-1,14H6L5,6"/>
              <path d="M10,11v6M14,11v6"/>
              <path d="M9,6V4h6v2"/>
            </svg>
          </button>
      </div>
      </div>
    {/if}

    <p class="size-help size-help--center">PC 1240×500 · 모바일 화면폭×600 · 둥근 사각형</p>

    {#if error}
      <p class="save-error" role="alert">{error}</p>
    {/if}
  </div>

  <div class="modal-footer">
    {#if !embedded}<button class="btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>{/if}
    <button class="btn-save" onclick={save} disabled={isSaving || isUploading}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</aside>

<style>
  /* 통합 설정 모달 안에 섹션으로 박히는 모드(embedded) — 오버레이·헤더 없이 본문 흐름에 배치 */
  .modal-panel.embedded { position: static; height: auto; width: auto; max-width: none; z-index: auto; border-radius: 0; box-shadow: none; background: transparent; display: block; overflow: visible; }
  .modal-panel.embedded .modal-body { overflow: visible; flex: none; }

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

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .section { display: flex; flex-direction: column; gap: 8px; }

  .section-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text-mid);
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
  }

  .size-help--center { align-self: center; }

  .size-help {
    width: fit-content;
    margin: 0;
    background: rgba(59, 47, 138, 0.1);
    color: var(--cs-purple);
    border-radius: var(--radius-full);
    padding: 1px 8px;
    font-size: 11px;
    font-weight: 700;
  }

  .hint {
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-text-light);
  }

  .text-input {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    resize: vertical;
    line-height: 1.6;
  }
  .text-input::placeholder { color: var(--cs-text-light); }
  .radio-group { display: flex; gap: 16px; }
  .radio-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    cursor: pointer;
  }


  .hidden-input { display: none; }

  .img-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
  }

  .img-thumb {
    width: 48px;
    height: 36px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .img-path {
    flex: 1;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .img-remove {
    background: none;
    border: none;
    color: var(--cs-text-mid);
    cursor: pointer;
    min-height: 32px;
    min-width: 32px;
    flex-shrink: 0;
  }
  .img-remove:hover { color: var(--cs-red-badge); }

  /* '비어있음' 카드 — 목록 행과 같은 연회색 면 + 반경 8px, 왼쪽에 카테고리 추가목록과 같은 44px 아이콘 칸(눌러서 이미지 추가) */
  .empty-msg {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 10px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
  }
  .empty-text {
    flex: 1;
    min-width: 0;
    margin: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    text-align: center;
    line-height: 1.6;
  }
  .add-only { margin-top: 8px; margin-left: 24px; }
  .icon-tile {
    position: relative;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: var(--cs-lilac);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.12s;
  }
  .icon-tile:hover { background: var(--cs-purple-op10); }
  .icon-tile:disabled { opacity: 0.5; cursor: not-allowed; }
  .tile-tag { font: var(--text-pc-body-14); color: var(--cs-text-mid, #666); pointer-events: none; }
  /* 목록 행과 같은 배치 — 왼쪽 드래그 손잡이·오른쪽 삭제 아이콘을 비활성(흐린) 상태로 표시 */
  .empty-row { display: flex; align-items: center; }
  .empty-handle {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    min-height: 44px;
    color: var(--cs-text-light);
    opacity: 0.5;
    cursor: not-allowed;
  }
  .empty-row .empty-msg { flex: 1; min-width: 0; }
  .empty-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    min-width: 28px;
    flex-shrink: 0;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-light);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
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
