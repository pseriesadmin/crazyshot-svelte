<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'

  interface ImageItem {
    url: string
    path: string
  }

  interface Props {
    initialImages: ImageItem[]
    initialMode: 'random' | 'fixed'
    onclose: () => void
  }

  let { initialImages, initialMode, onclose }: Props = $props()

  let images = $state<ImageItem[]>(initialImages.map((img) => ({ ...img })))
  let mode = $state<'random' | 'fixed'>(initialMode)

  $effect(() => {
    images = initialImages.map((img) => ({ ...img }))
    mode = initialMode
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
        p_value: { images, mode },
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

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="도움말 히어로 배경 이미지 관리">
  <div class="modal-header">
    <span class="modal-title">도움말 배경 이미지 관리</span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="modal-body">
    <!-- 노출 방식 -->
    <div class="section">
      <p class="section-label">노출 방식</p>
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
    </div>

    <!-- 이미지 업로드 -->
    <div class="section">
      <p class="section-label">이미지 업로드 <span class="hint">PNG · JPEG · WebP · HEIF</span></p>
      <button class="upload-btn" onclick={openFilePicker} disabled={isUploading}>
        {#if isUploading}업로드 중…{:else}+ 이미지 추가{/if}
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
        multiple
        class="hidden-input"
        onchange={onFileChange}
      />
    </div>

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
      </div>
    {:else}
      <p class="empty-msg">이미지를 추가하면 히어로 배경으로 사용됩니다.<br />이미지가 없으면 기본 이미지가 사용됩니다.</p>
    {/if}

    {#if error}
      <p class="save-error" role="alert">{error}</p>
    {/if}
  </div>

  <div class="modal-footer">
    <button class="btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>
    <button class="btn-save" onclick={save} disabled={isSaving || isUploading}>
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

  .radio-group { display: flex; gap: 16px; }
  .radio-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    cursor: pointer;
  }

  .upload-btn {
    height: 40px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    align-self: flex-start;
  }
  .upload-btn:hover { opacity: 0.85; }
  .upload-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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

  .empty-msg {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    text-align: center;
    padding: 20px 0;
    line-height: 1.6;
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
