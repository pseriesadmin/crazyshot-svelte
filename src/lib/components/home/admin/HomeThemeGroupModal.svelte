<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'

  // ── 타입 ─────────────────────────────────────────────────────────────
  interface ProductItem {
    id: string
    name: string
    slug: string
    image_urls: string[] | null
    base_price_daily: number
  }

  interface ThemeGroupRow {
    id: string
    title: string
    sub_copy: string | null
    image_url: string
    sort_order: number
    products: ProductItem[]
  }

  interface LocalGroup {
    _tempId: string
    id: string | null
    title: string
    sub_copy: string
    image_url: string
    _preview: string | null
    _file: File | null
    _uploading: boolean
    productItems: ProductItem[]
  }

  // ── Props ─────────────────────────────────────────────────────────────
  interface Props {
    groups: ThemeGroupRow[]
    onclose: () => void
  }
  let { groups, onclose }: Props = $props()

  const MAX_GROUPS   = 10
  const MAX_PRODUCTS = 10

  // ── 로컬 상태 ─────────────────────────────────────────────────────────
  let localGroups = $state<LocalGroup[]>([])
  let origIds     = $state<Set<string>>(new Set())
  let isSaving    = $state(false)
  let saveError   = $state<string | null>(null)

  // 활성 그룹 아코디언 + 상품 편집
  let activeGroupId       = $state<string | null>(null)
  let activeProductsList  = $state<ProductItem[]>([])

  // 상품 검색 (SuggestPicker)
  let pickerOptions  = $state<SuggestPickerOption[]>([])
  let pickerSelId    = $state<string | null>(null)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // ── Props 동기화 ($state(prop) 절대 금지 → $effect 사용) ──────────────
  $effect(() => {
    localGroups = groups.map(toLocal)
    origIds     = new Set(groups.map((g) => g.id))
    activeGroupId      = null
    activeProductsList = []
    pickerOptions      = []
    pickerSelId        = null
  })

  function toLocal(g: ThemeGroupRow): LocalGroup {
    return {
      _tempId:      g.id,
      id:           g.id,
      title:        g.title,
      sub_copy:     g.sub_copy ?? '',
      image_url:    g.image_url,
      _preview:     null,
      _file:        null,
      _uploading:   false,
      productItems: [...g.products],
    }
  }

  function newTempId() {
    return `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  }

  // ── 아코디언 열기·닫기 ────────────────────────────────────────────────
  function syncActiveBack() {
    if (!activeGroupId) return
    const idx = localGroups.findIndex((g) => g._tempId === activeGroupId)
    if (idx < 0) return
    localGroups = localGroups.map((g, i) =>
      i === idx ? { ...g, productItems: [...activeProductsList] } : g
    )
  }

  function activateGroup(tempId: string | null) {
    syncActiveBack()
    activeGroupId     = tempId
    pickerOptions     = []
    pickerSelId       = null
    if (!tempId) { activeProductsList = []; return }
    const grp = localGroups.find((g) => g._tempId === tempId)
    activeProductsList = grp ? [...grp.productItems] : []
  }

  // ── 그룹 추가 / 삭제 ──────────────────────────────────────────────────
  function addGroup() {
    if (localGroups.length >= MAX_GROUPS) return
    const tempId = newTempId()
    const newGrp: LocalGroup = {
      _tempId: tempId, id: null,
      title: '', sub_copy: '', image_url: '',
      _preview: null, _file: null, _uploading: false,
      productItems: [],
    }
    syncActiveBack()
    localGroups = [...localGroups, newGrp]
    activateGroup(tempId)
  }

  function removeGroup(tempId: string) {
    if (activeGroupId === tempId) {
      activeGroupId      = null
      activeProductsList = []
    }
    localGroups = localGroups.filter((g) => g._tempId !== tempId)
  }

  // ── 그룹 필드 수정 ────────────────────────────────────────────────────
  function setField(tempId: string, field: 'title' | 'sub_copy', val: string) {
    localGroups = localGroups.map((g) =>
      g._tempId === tempId ? { ...g, [field]: val } : g
    )
  }

  // ── 이미지 선택 ───────────────────────────────────────────────────────
  let fileInputEls: Record<string, HTMLInputElement> = {}

  function onFileChange(tempId: string, e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    const preview = URL.createObjectURL(file)
    localGroups = localGroups.map((g) =>
      g._tempId === tempId ? { ...g, _file: file, _preview: preview, image_url: '' } : g
    )
  }

  async function uploadImage(grp: LocalGroup): Promise<string> {
    if (!grp._file) return grp.image_url
    const ext  = grp._file.name.split('.').pop() ?? 'jpg'
    const path = `home-theme-groups/${grp._tempId}-${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('cms-assets')
      .upload(path, grp._file, { cacheControl: '3600', upsert: true })
    if (error) throw new Error(`이미지 업로드 실패: ${error.message}`)
    const { data } = supabase.storage.from('cms-assets').getPublicUrl(path)
    return data.publicUrl
  }

  // ── 상품 검색 (SuggestPicker) ─────────────────────────────────────────
  function onPickerInput(value: string) {
    if (debounceTimer) clearTimeout(debounceTimer)
    const q = value.trim()
    if (!q) { pickerOptions = []; return }
    debounceTimer = setTimeout(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.rpc as any)('search_products', {
        p_query:      q,
        p_category:   null,
        p_page:       1,
        p_limit:      10,
        p_session_id: null,
        p_user_id:    null,
      }) as { data: Record<string, unknown>[] | null }
      const rows = (data ?? []) as Record<string, unknown>[]
      const activeIds = new Set(activeProductsList.map((p) => p.id))
      pickerOptions = rows
        .filter((r) => !activeIds.has(String(r['product_id'] ?? r['id'] ?? '')))
        .map((r) => {
          const pid   = String(r['product_id'] ?? r['id'] ?? '')
          const price = Number(r['price_min'] ?? r['base_price_daily'] ?? 0)
          return {
            id:    pid,
            label: String(r['name'] ?? ''),
            meta:  [price > 0 ? `${price.toLocaleString()}원/일` : ''],
          }
        })
    }, 280)
  }

  function onProductSelect(opt: SuggestPickerOption) {
    if (activeProductsList.length >= MAX_PRODUCTS) return
    if (activeProductsList.some((p) => p.id === opt.id)) return
    const newItem: ProductItem = {
      id:               opt.id,
      name:             opt.label,
      slug:             '',
      image_urls:       null,
      base_price_daily: 0,
    }
    activeProductsList = [...activeProductsList, newItem]
    pickerOptions      = []
    pickerSelId        = null
  }

  function removeProduct(productId: string) {
    activeProductsList = activeProductsList.filter((p) => p.id !== productId)
  }

  // ── 저장 ──────────────────────────────────────────────────────────────
  async function save() {
    isSaving  = true
    saveError = null
    syncActiveBack()

    try {
      // 1. 이미지 업로드
      const withUrls: LocalGroup[] = await Promise.all(
        localGroups.map(async (g) => {
          if (!g._file) return g
          const url = await uploadImage(g)
          return { ...g, image_url: url, _file: null, _preview: null }
        })
      )

      // 2. 삭제: origIds에 있지만 localGroups에 없는 것
      const currentIds = new Set(withUrls.map((g) => g.id).filter(Boolean))
      for (const oid of origIds) {
        if (!currentIds.has(oid)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: res } = await (supabase.rpc as any)('cms_delete_theme_group', { p_id: oid }) as { data: { ok: boolean; error?: string } }
          if (!res?.ok) throw new Error(res?.error ?? '삭제 실패')
        }
      }

      // 3. 생성 / 수정
      for (let i = 0; i < withUrls.length; i++) {
        const g = withUrls[i]
        const productIds = g.productItems.map((p, order) => ({ id: p.id, order }))
        const params = {
          p_title:       g.title,
          p_sub_copy:    g.sub_copy || null,
          p_image_url:   g.image_url,
          p_product_ids: productIds,
          p_sort_order:  i,
        }

        if (g.id === null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: res } = await (supabase.rpc as any)('cms_create_theme_group', params) as { data: { ok: boolean; error?: string } }
          if (!res?.ok) throw new Error(res?.error ?? '생성 실패')
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: res } = await (supabase.rpc as any)('cms_update_theme_group', { p_id: g.id, ...params }) as { data: { ok: boolean; error?: string } }
          if (!res?.ok) throw new Error(res?.error ?? '수정 실패')
        }
      }

      await invalidateAll()
      onclose()
    } catch (e) {
      saveError = e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.'
    } finally {
      isSaving = false
    }
  }

  // ── 가격 포맷 ─────────────────────────────────────────────────────────
  function fmtPrice(n: number) {
    return n > 0 ? `${n.toLocaleString()}원/일` : ''
  }
</script>

<!-- 배경 오버레이 -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tg-backdrop" onclick={onclose}></div>

<!-- 패널 -->
<div class="tg-panel" role="dialog" aria-modal="true" aria-label="테마그룹 관리">
  <!-- 헤더 -->
  <div class="tg-header">
    <span class="tg-header-title">취향직격 테마그룹 관리</span>
    <button class="tg-close-btn" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <!-- 본문 -->
  <div class="tg-body">
    {#if saveError}
      <div class="tg-error" role="alert">{saveError}</div>
    {/if}

    <!-- 그룹 목록 (드래그 정렬) -->
    <CmsDragList bind:items={localGroups} itemKey={(g) => g._tempId}>
      {#snippet renderItem(g, _idx)}
        <div class="tg-group-card">
          <!-- 그룹 헤더 행 -->
          <div class="tg-group-row">
            <!-- 이미지 썸네일 -->
            <button
              class="tg-thumb-btn"
              onclick={() => fileInputEls[g._tempId]?.click()}
              aria-label="이미지 변경"
              type="button"
            >
              {#if g._preview || g.image_url}
                <img
                  src={g._preview ?? g.image_url}
                  alt={g.title || '테마 이미지'}
                  class="tg-thumb"
                />
              {:else}
                <div class="tg-thumb-placeholder">📷</div>
              {/if}
            </button>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
              style="display:none"
              bind:this={fileInputEls[g._tempId]}
              onchange={(e) => onFileChange(g._tempId, e)}
            />

            <!-- 제목 입력 -->
            <input
              type="text"
              class="tg-title-input"
              placeholder="그룹명"
              value={g.title}
              oninput={(e) => setField(g._tempId, 'title', (e.target as HTMLInputElement).value)}
            />

            <!-- 아코디언 토글 / 삭제 -->
            <div class="tg-group-actions">
              <button
                class="tg-expand-btn"
                class:active={activeGroupId === g._tempId}
                onclick={() => activateGroup(activeGroupId === g._tempId ? null : g._tempId)}
                aria-label="상품 편집"
                type="button"
              >
                {activeGroupId === g._tempId ? '▲' : '▼'}
              </button>
              <button
                class="tg-del-btn"
                onclick={() => removeGroup(g._tempId)}
                aria-label="그룹 삭제"
                type="button"
              >✕</button>
            </div>
          </div>

          <!-- 서브카피 -->
          <input
            type="text"
            class="tg-subcopy-input"
            placeholder="서브 카피 (선택)"
            value={g.sub_copy}
            oninput={(e) => setField(g._tempId, 'sub_copy', (e.target as HTMLInputElement).value)}
          />

          <!-- 상품 편집 아코디언 -->
          {#if activeGroupId === g._tempId}
            {#key activeGroupId}
              <div class="tg-products-area">
                <div class="tg-products-label">
                  상품 ({activeProductsList.length}/{MAX_PRODUCTS})
                </div>

                <!-- 상품 목록 (드래그 정렬) -->
                {#if activeProductsList.length > 0}
                  <CmsDragList bind:items={activeProductsList} itemKey={(p) => p.id}>
                    {#snippet renderItem(p, _pidx)}
                      <div class="tg-prod-row">
                        <img
                          src={p.image_urls?.[0] ?? '/favicon.png'}
                          alt={p.name}
                          class="tg-prod-thumb"
                        />
                        <div class="tg-prod-info">
                          <span class="tg-prod-name">{p.name}</span>
                          {#if p.base_price_daily > 0}
                            <span class="tg-prod-price">{fmtPrice(p.base_price_daily)}</span>
                          {/if}
                        </div>
                        <button
                          class="tg-prod-del"
                          onclick={() => removeProduct(p.id)}
                          aria-label="상품 제거"
                          type="button"
                        >✕</button>
                      </div>
                    {/snippet}
                  </CmsDragList>
                {/if}

                <!-- 상품 추가 검색 -->
                {#if activeProductsList.length < MAX_PRODUCTS}
                  <div class="tg-picker-wrap">
                    <SuggestPicker
                      id="theme-product-search"
                      bind:selectedId={pickerSelId}
                      options={pickerOptions}
                      noFilter
                      itemLayout="row"
                      placeholder="상품 검색…"
                      listLabel="검색 결과"
                      variant="generic"
                      oninput={onPickerInput}
                      onselect={onProductSelect}
                    >
                      {#snippet field(c)}
                        <input
                          type="text"
                          class="tg-search-input"
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
                        />
                      {/snippet}
                      {#snippet renderItem(item, _i, _sel)}
                        <span class="suggest-name">{item.label}</span>
                        <span class="suggest-meta">{item.meta?.[0] ?? ''}</span>
                      {/snippet}
                    </SuggestPicker>
                  </div>
                {/if}
              </div>
            {/key}
          {/if}
        </div>
      {/snippet}
    </CmsDragList>

    <!-- 그룹 추가 버튼 -->
    {#if localGroups.length < MAX_GROUPS}
      <button class="tg-add-btn" onclick={addGroup} type="button">
        + 그룹 추가
      </button>
    {:else}
      <p class="tg-max-notice">최대 {MAX_GROUPS}개까지 등록 가능합니다.</p>
    {/if}
  </div>

  <!-- 푸터 -->
  <div class="tg-footer">
    <button class="tg-cancel-btn" onclick={onclose} type="button" disabled={isSaving}>취소</button>
    <button class="tg-save-btn" onclick={save} type="button" disabled={isSaving}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</div>

<style>
  /* ── 배경 오버레이 ── */
  .tg-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.42);
  }

  /* ── 패널 ── */
  .tg-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100dvh;
    width: 420px;
    z-index: 201;
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--cs-white, #fff);
    box-shadow: -8px 0 40px rgba(16, 11, 50, 0.18);
  }

  /* ── 헤더 ── */
  .tg-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    background: #100b32;
    flex-shrink: 0;
  }
  .tg-header-title {
    font-size: 15px;
    font-weight: 700;
    color: #fff;
  }
  .tg-close-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    transition: color 0.15s;
  }
  .tg-close-btn:hover { color: #fff; }

  /* ── 본문 ── */
  .tg-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tg-error {
    background: #fff0f0;
    border: 1px solid #ffb3b3;
    border-radius: var(--radius-sm, 8px);
    padding: 10px 14px;
    font-size: 13px;
    color: #cf0000;
  }

  /* ── 그룹 카드 ── */
  .tg-group-card {
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--radius-md, 15px);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tg-group-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* 썸네일 버튼 — 테마 대표이미지는 원형으로 등록(요구사항: 테마 원형이미지) */
  .tg-thumb-btn {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    overflow: hidden;
    border: 1.5px solid #dcdcdc;
    background: #ececec;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s;
  }
  .tg-thumb-btn:hover { border-color: var(--cs-purple, #3b2f8a); }
  .tg-thumb { width: 100%; height: 100%; object-fit: cover; }
  .tg-thumb-placeholder { font-size: 20px; }

  /* 제목 입력 */
  .tg-title-input {
    flex: 1;
    min-width: 0;
    height: 36px;
    border: 1.5px solid #dcdcdc;
    border-radius: var(--radius-sm, 8px);
    padding: 0 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--cs-text, #100b32);
    background: #fff;
    outline: none;
    transition: border-color 0.15s;
  }
  .tg-title-input:focus { border-color: var(--cs-purple, #3b2f8a); }

  /* 아코디언·삭제 버튼 영역 */
  .tg-group-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .tg-expand-btn {
    width: 30px;
    height: 30px;
    border: 1.5px solid #dcdcdc;
    border-radius: var(--radius-sm, 8px);
    background: #fff;
    font-size: 11px;
    cursor: pointer;
    color: var(--cs-text, #100b32);
    transition: border-color 0.15s, background 0.15s;
  }
  .tg-expand-btn.active {
    border-color: var(--cs-purple, #3b2f8a);
    background: var(--cs-purple, #3b2f8a);
    color: #fff;
  }
  .tg-del-btn {
    width: 30px;
    height: 30px;
    border: 1.5px solid #ffb3b3;
    border-radius: var(--radius-sm, 8px);
    background: #fff;
    font-size: 12px;
    cursor: pointer;
    color: #cf0000;
    transition: background 0.15s;
  }
  .tg-del-btn:hover { background: #fff0f0; }

  /* 서브카피 */
  .tg-subcopy-input {
    width: 100%;
    height: 32px;
    border: 1.5px solid #dcdcdc;
    border-radius: var(--radius-sm, 8px);
    padding: 0 10px;
    font-size: 12px;
    color: var(--cs-text-mid, #666);
    background: #fff;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .tg-subcopy-input:focus { border-color: var(--cs-purple, #3b2f8a); }

  /* ── 상품 편집 아코디언 ── */
  .tg-products-area {
    border-top: 1px solid #e0dff0;
    padding-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tg-products-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--cs-text-mid, #666);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* 상품 행 */
  .tg-prod-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #fff;
    border-radius: var(--radius-sm, 8px);
    padding: 6px 8px;
    border: 1px solid #ebe9f5;
  }
  .tg-prod-thumb {
    width: 36px;
    height: 36px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
    background: #ececec;
  }
  .tg-prod-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tg-prod-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--cs-text, #100b32);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tg-prod-price {
    font-size: 11px;
    color: var(--cs-text-mid, #666);
  }
  .tg-prod-del {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: #aaa;
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .tg-prod-del:hover { color: #cf0000; background: #fff0f0; }

  /* 검색 피커 */
  .tg-picker-wrap {
    position: relative;
  }
  .tg-search-input {
    width: 100%;
    height: 34px;
    border: 1.5px solid #dcdcdc;
    border-radius: var(--radius-sm, 8px);
    padding: 0 10px;
    font-size: 12px;
    background: #fff;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .tg-search-input:focus { border-color: var(--cs-purple, #3b2f8a); }

  /* SuggestPicker dropdown 오버라이드 */
  .tg-picker-wrap :global(.suggest-name) {
    font-size: 13px;
    font-weight: 600;
    color: var(--cs-text, #100b32);
  }
  .tg-picker-wrap :global(.suggest-meta) {
    font-size: 12px;
    color: var(--cs-text-mid, #666);
    margin-left: auto;
  }

  /* ── 그룹 추가 버튼 ── */
  .tg-add-btn {
    width: 100%;
    height: 40px;
    border: 1.5px dashed #b8b4e0;
    border-radius: var(--radius-md, 15px);
    background: none;
    color: var(--cs-purple, #3b2f8a);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .tg-add-btn:hover { background: #f0eefb; border-color: var(--cs-purple, #3b2f8a); }

  .tg-max-notice {
    text-align: center;
    font-size: 12px;
    color: var(--cs-text-mid, #666);
    padding: 8px 0;
  }

  /* ── 푸터 ── */
  .tg-footer {
    display: flex;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid #ebe9f5;
    flex-shrink: 0;
  }
  .tg-cancel-btn {
    flex: 1;
    height: 44px;
    border: 1.5px solid #dcdcdc;
    border-radius: var(--radius-xl, 30px);
    background: #fff;
    color: var(--cs-text, #100b32);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .tg-cancel-btn:hover:not(:disabled) { background: #f6f6f6; }
  .tg-cancel-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .tg-save-btn {
    flex: 2;
    height: 44px;
    border: none;
    border-radius: var(--radius-xl, 30px);
    background: var(--cs-purple, #3b2f8a);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }
  .tg-save-btn:hover:not(:disabled) { background: #2d2469; }
  .tg-save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
