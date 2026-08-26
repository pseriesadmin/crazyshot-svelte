<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
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
    is_active: boolean
    products: ProductItem[]
  }

  interface LocalGroup {
    _tempId: string
    id: string | null
    title: string
    sub_copy: string
    image_url: string
    is_active: boolean
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
  // I-3: 마지막 실제 검색어 추적
  let lastSearchQuery = $state('')

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
      is_active:    g.is_active,
      _preview:     null,
      _file:        null,
      _uploading:   false,
      productItems: [...g.products],
    }
  }

  function toggleActive(tempId: string) {
    localGroups = localGroups.map((g) =>
      g._tempId === tempId ? { ...g, is_active: !g.is_active } : g
    )
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
      title: '', sub_copy: '', image_url: '', is_active: true,
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

  // ── 상품 검색 (SuggestPicker) — H-5: search_products RPC → 서버라우트 전환 ──
  // nlsearch.md §2 "브라우저 직접 RPC 호출 금지" 준수
  function onPickerInput(value: string) {
    if (debounceTimer) clearTimeout(debounceTimer)
    const q = value.trim()
    if (!q) { pickerOptions = []; return }
    debounceTimer = setTimeout(async () => {
      lastSearchQuery = q
      try {
        const res = await fetch(
          `/api/cms/products/search-suggestions?q=${encodeURIComponent(q)}&limit=10`,
        )
        if (!res.ok) { pickerOptions = []; return }
        const items = await res.json() as Array<{ id: string; name: string; price_24h?: number | null }>
        const activeIds = new Set(activeProductsList.map((p) => p.id))
        pickerOptions = items
          .filter((r) => !!r.id && !activeIds.has(r.id))
          .map((r) => ({
            id:    r.id,
            label: r.name,
            meta:  [r.price_24h != null && r.price_24h > 0 ? `${r.price_24h.toLocaleString()}원/일` : ''],
          }))
      } catch {
        pickerOptions = []
      }
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
    // I-3: 실제 검색 후 선택한 경우에만 학습 신호 전송 (fire-and-forget)
    if (lastSearchQuery) {
      fetch('/api/cms/products/search-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: opt.id, search_term: lastSearchQuery, context: 'home_theme_group' }),
      }).catch(() => {})
    }
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
          p_is_active:   g.is_active,
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

  const MAX_NAME_LEN = 20
  function truncateName(name: string): string {
    return name.length > MAX_NAME_LEN ? `${name.slice(0, MAX_NAME_LEN)}…` : name
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
                <ChevronIcon
                  direction={activeGroupId === g._tempId ? 'up' : 'down'}
                  size={8}
                  color={activeGroupId === g._tempId ? '#fff' : 'currentColor'}
                />
              </button>
              <button
                class="tg-del-btn"
                onclick={() => removeGroup(g._tempId)}
                aria-label="그룹 삭제"
                type="button"
              >✕</button>
              <button
                class="checkbox-btn tg-visible-btn"
                class:checked={g.is_active}
                onclick={() => toggleActive(g._tempId)}
                aria-label={g.is_active ? '노출 중 — 클릭 시 숨김' : '숨김 — 클릭 시 노출'}
                type="button"
              >
                <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
                  <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z"
                    fill="currentColor" />
                </svg>
              </button>
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
                        <div class="tg-prod-info">
                          <span class="tg-prod-name" title={p.name}>{truncateName(p.name)}</span>
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
                      clearOnSelect
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

  /* 그룹 목록(CmsDragList) 카드 간 여백 — .tg-body의 "직계" drag-list만 선택(> 콤비네이터).
     상품편집 아코디언 내부의 중첩 CmsDragList(.tg-products-area 안)는 이 규칙에 걸리지 않음 —
     :global(.drag-list) 하위선택자만 쓰면 중첩된 상품목록 drag-list까지 함께 30px로 벌어지는
     의도치 않은 버그가 생기므로 반드시 > 로 범위를 좁혀야 함 */
  .tg-body > :global(.drag-list) {
    gap: 30px;
  }

  /* 상품편집 아코디언 내부 상품 목록 — 그룹 카드보다 촘촘한 간격 유지(밀도 높은 리스트) */
  .tg-products-area :global(.drag-list) {
    gap: 8px;
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
    display: flex;
    align-items: center;
    justify-content: center;
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

  /* 그룹 노출 선택 — 체크아이콘 버튼 표준(front-uiux.md §17, CMS 재사용) */
  .checkbox-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm, 8px);
    transition: background 0.15s;
  }
  .tg-visible-btn { color: var(--cs-purple-op10, #ECEBF4); }
  .tg-visible-btn.checked { color: var(--cs-purple, #3b2f8a); }
  .tg-visible-btn:hover { background: rgba(59, 47, 138, 0.06); }
  .tg-visible-btn svg { width: 18px; height: 12px; }

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
  /* SuggestPicker 표준 입력 — cms-uiux.md §7-7/§12 정본(.f-input) 그대로 사용 */
  .f-input {
    background: var(--cs-surface-gray, #f6f6f6);
    border: none;
    border-radius: var(--radius-sm, 8px);
    padding: 10px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text, #100b32);
    width: 100%;
    box-sizing: border-box;
  }
  .f-input::placeholder { color: var(--cs-text-light); }
  .f-input:focus { outline: 2px solid var(--cs-purple, #3b2f8a); outline-offset: -2px; }

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
