<script lang="ts">
  // 모바일 GNB 중앙 '배지 배너' 관리 — 홈 화면 설정 통합 모달의 한 섹션(embedded)으로만 쓰인다.
  // 저장값: cms_settings 'gnb_badge_banner' = { items: [{ id, url, path, link }], mode } (구조·검증: $lib/utils/gnbBadgeBanner.ts)
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import {
    GNB_BADGE_LINK_MAX, GNB_BADGE_SETTING_KEY, safeBadgeLink,
    type GnbBadgeItem, type GnbBadgeMode,
  } from '$lib/utils/gnbBadgeBanner'

  interface Props {
    initialItems: GnbBadgeItem[]
    initialMode: GnbBadgeMode
    onclose: () => void
    /** 통합 설정 모달 안에 섹션으로 표시(오버레이·헤더·취소 숨김) */
    embedded?: boolean
  }
  let { initialItems, initialMode, onclose, embedded = false }: Props = $props()

  // 허용 형식: PNG · JPEG · SVG (SVG 는 <img> 로만 표시되므로 안의 스크립트는 실행되지 않는다)
  const ACCEPT = 'image/png,image/jpeg,image/svg+xml'
  const ALLOWED = ['image/png', 'image/jpeg', 'image/svg+xml']
  const MAX_BYTES = 2 * 1024 * 1024   // GNB 는 모든 화면에서 불러오므로 작게 제한

  let items = $state<GnbBadgeItem[]>(initialItems.map((it) => ({ ...it })))
  let mode = $state<GnbBadgeMode>(initialMode)

  // 부모 데이터가 갱신되면(저장 후 다시 불러오기) 로컬 값도 동기화 — $state(prop) 단독 초기화 금지
  $effect(() => {
    items = initialItems.map((it) => ({ ...it }))
    mode = initialMode
  })

  let isUploading = $state(false)
  let isSaving = $state(false)
  let error = $state<string | null>(null)
  let fileInput: HTMLInputElement | undefined = $state()

  function openFilePicker(): void {
    fileInput?.click()
  }

  async function onFileChange(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (!files.length) return

    isUploading = true
    error = null
    for (const file of files) {
      if (!ALLOWED.includes(file.type)) { error = 'PNG, JPEG, SVG 파일만 올릴 수 있어요.'; break }
      if (file.size > MAX_BYTES) { error = '이미지 크기는 2MB 이하여야 해요.'; break }
      const ext = file.type === 'image/svg+xml' ? 'svg' : file.type === 'image/png' ? 'png' : 'jpg'
      const id = crypto.randomUUID()
      const path = `gnb-badge/${id}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('cms-assets')
        .upload(path, file, { upsert: false, contentType: file.type })
      if (upErr) { error = `업로드 실패: ${upErr.message}`; break }
      const { data } = supabase.storage.from('cms-assets').getPublicUrl(path)
      items = [...items, { id, url: data.publicUrl, path, link: '' }]
    }
    isUploading = false
  }

  function removeItem(id: string): void {
    items = items.filter((it) => it.id !== id)
  }

  // 입력 중 목록이 다시 그려지지 않게 해당 항목만 직접 바꾼다
  function onLinkInput(id: string, e: Event): void {
    const item = items.find((it) => it.id === id)
    if (item) item.link = (e.currentTarget as HTMLInputElement).value
  }

  async function save(): Promise<void> {
    error = null
    // 링크는 비워 두거나 '/경로' · 'https://…' 만 허용
    const cleaned: GnbBadgeItem[] = []
    for (const it of items) {
      const raw = it.link.trim()
      const link = safeBadgeLink(raw)
      if (raw && !link) {
        error = '링크는 /경로 또는 https:// 주소만 입력할 수 있어요.'
        return
      }
      cleaned.push({ id: it.id, url: it.url, path: it.path, link })
    }
    isSaving = true
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key: GNB_BADGE_SETTING_KEY,
        p_value: { items: cleaned, mode },
      })
      if (err) { error = err.message; return }
      await invalidateAll()
      onclose()
    } catch (e) {
      error = e instanceof Error ? e.message : '저장 실패'
    } finally {
      isSaving = false
    }
  }
</script>

{#if !embedded}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onclose} role="presentation"></div>
{/if}

<aside class="modal-panel" class:embedded role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="GNB 배지 배너 관리">
  {#if !embedded}
    <div class="modal-header">
      <span class="modal-title">GNB 배지 배너 관리</span>
      <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
    </div>
  {/if}

  <div class="modal-body">
    <!-- 노출 방식 -->
    <div class="section">
      <p class="section-label">노출 방식</p>
      <div class="mode-chips">
        <button type="button" class="mode-chip" class:mode-chip--on={mode === 'random'} aria-pressed={mode === 'random'} onclick={() => (mode = 'random')}>랜덤 노출</button>
        <button type="button" class="mode-chip" class:mode-chip--on={mode === 'sequential'} aria-pressed={mode === 'sequential'} onclick={() => (mode = 'sequential')}>순서 노출</button>
      </div>
    </div>

    <input bind:this={fileInput} type="file" accept={ACCEPT} multiple class="hidden-input" onchange={onFileChange} />

    <!-- 배지 목록 -->
    {#if items.length > 0}
      <div class="section">
        <p class="section-label">배지 목록 <span class="hint">드래그로 순서 변경</span></p>
        <CmsDragList bind:items itemKey={(item) => item.id}>
          {#snippet renderItem(item)}
            <div class="img-row">
              <span class="img-thumb"><img src={item.url} alt="GNB 배지" /></span>
              <input
                type="text"
                class="link-input"
                value={item.link}
                maxlength={GNB_BADGE_LINK_MAX}
                placeholder="/경로 또는 https://… (선택)"
                aria-label="배지 이동 링크"
                oninput={(e) => onLinkInput(item.id, e)}
              />
              <button class="img-remove" type="button" onclick={() => removeItem(item.id)} aria-label="배지 제거">
                <!-- CMS 공통 표준 삭제 아이콘(휴지통 SVG 12×12) -->
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <polyline points="3,6 5,6 21,6"/>
                  <path d="M19,6l-1,14H6L5,6"/>
                  <path d="M10,11v6M14,11v6"/>
                  <path d="M9,6V4h6v2"/>
                </svg>
              </button>
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
        <p class="empty-text">배지를 추가하면 모바일 GNB 중앙에 노출됩니다.</p>
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

    <p class="size-help size-help--center">모바일 GNB 중앙 · 최대 96×32 · 비율 유지</p>

    {#if error}
      <p class="save-error" role="alert">{error}</p>
    {/if}
  </div>

  <div class="modal-footer">
    {#if !embedded}<button class="btn-cancel" type="button" onclick={onclose} disabled={isSaving}>취소</button>{/if}
    <button class="btn-save" type="button" onclick={save} disabled={isSaving || isUploading}>
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
  .modal-title { color: var(--cs-white); font: var(--text-pc-title-16); }
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

  .size-help--center { align-self: center; }

  .hint {
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-text-light);
  }


  .hidden-input { display: none; }

  .img-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    width: 100%;
    min-width: 0;
  }

  /* 미리보기 — GNB 와 같은 어두운 바탕 위에 올려 흰색·투명 배지도 보이게 한다 */
  .img-thumb {
    width: 64px;
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1d183e;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .img-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }

  .link-input {
    flex: 1;
    min-width: 0;
    height: 36px;
    box-sizing: border-box;
    padding: 0 12px;
    background: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm, 10px);
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }
  .link-input::placeholder { color: var(--cs-text-light); }
  .link-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  /* CMS 공통 표준 삭제 아이콘 버튼(카테고리 추가목록 .btn-remove 규격과 동일) — 투명 면, 호버는 옅은 레드 면 + 레드 아이콘 */
  .img-remove {
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
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .img-remove:hover { background: rgba(255, 53, 53, 0.08); color: var(--cs-red-badge); }

  /* 카테고리 추가목록과 같은 목록 간격 8px */
  .section :global(.drag-list) { gap: 8px; }

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
