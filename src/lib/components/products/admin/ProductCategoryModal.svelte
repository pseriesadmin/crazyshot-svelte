<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'

  interface CategoryItem {
    id: string
    code: string
    name: string
    sort_order: number
    is_active?: boolean
  }

  interface SelectedItem {
    code_id:      string
    icon_key:     string
    sort_order:   number
    name:         string
    icon_url:     string | null   // 저장된 커스텀 아이콘 URL
    _preview:     string | null   // 로컬 blob preview (미업로드)
    _file:        File   | null   // 대기 중 파일
  }

  interface Props {
    categories: CategoryItem[]
    initialSettings: {
      items: { code_id: string; icon_key: string; sort_order: number; icon_url?: string | null }[]
    }
    initialKeywordsSettings: { items: string[] }
    onclose: () => void
  }

  let { categories, initialSettings, initialKeywordsSettings, onclose }: Props = $props()

  const CAT_LABELS: Record<string, string> = {
    camera:     '카메라',
    lens:       '렌즈',
    camcorder:  '캠코더',
    action_cam: '액션캠',
    drone:      '드론',
    lighting:   '조명',
    audio:      '오디오',
    accessory:  '보조용품',
    package:    '패키지',
  }


  // 저장된 항목만 초기 선택목록으로 반환
  // 저장값 없음 → 빈 목록 시작 (피커로 카테고리 추가, products/new 피커와 동일 구조)
  function buildSelected(): SelectedItem[] {
    const saved = initialSettings?.items ?? []
    const matched: SelectedItem[] = []
    for (const item of saved) {
      // code_id 직접 일치 우선, 실패 시 icon_key(=code) 폴백 (이전 저장 포맷 호환)
      const cat = categories.find((c) => c.id === item.code_id)
               ?? categories.find((c) => c.code === item.icon_key)
      if (!cat) continue
      matched.push({
        code_id:    cat.id,
        icon_key:   cat.code,
        sort_order: item.sort_order,
        name:       CAT_LABELS[cat.code] ?? cat.name,
        icon_url:   item.icon_url ?? null,
        _preview:   null,
        _file:      null,
      })
    }
    return matched
  }

  let selected = $state<SelectedItem[]>(buildSelected())

  let pickerSelectedId = $state<string | null>(null)
  let isSaving         = $state(false)
  let error            = $state<string | null>(null)

  // 키워드 옵션 목록
  const KEYWORD_OPTIONS: SuggestPickerOption[] = [
    { id: 'SONY',       label: 'SONY' },
    { id: 'CANON',      label: 'CANON' },
    { id: 'NIKON',      label: 'NIKON' },
    { id: 'Fujifilm',   label: 'Fujifilm' },
    { id: 'Olympus',    label: 'Olympus' },
    { id: 'Panasonic',  label: 'Panasonic' },
    { id: 'Leica',      label: 'Leica' },
    { id: 'GoPro',      label: 'GoPro' },
    { id: 'DJI',        label: 'DJI' },
    { id: 'Blackmagic', label: 'Blackmagic' },
    { id: 'RODE',       label: 'RODE' },
    { id: 'Godox',      label: 'Godox' },
  ]

  let selectedKeywords   = $state<string[]>(initialKeywordsSettings?.items ?? [])
  let kwPickerSelectedId = $state<string | null>(null)

  let availableKwOptions = $derived(
    KEYWORD_OPTIONS.filter((opt) => !selectedKeywords.includes(opt.id))
  )

  function addKeyword(optId: string | null) {
    if (!optId) return
    const opt = KEYWORD_OPTIONS.find((o) => o.id === optId)
    if (!opt || selectedKeywords.includes(opt.id)) return
    if (selectedKeywords.length >= 10) return
    selectedKeywords = [...selectedKeywords, opt.id]
    kwPickerSelectedId = null
  }

  function removeKeyword(kw: string) {
    selectedKeywords = selectedKeywords.filter((k) => k !== kw)
  }

  let selectedIds   = $derived(new Set(selected.map((s) => s.code_id)))
  // 이미 선택된 카테고리는 피커 목록에서 제외 — 선택 시 addCategory guard와 충돌 방지
  let pickerOptions = $derived(
    categories
      .filter((c) => !selectedIds.has(c.id))
      .map((c) => ({
        id:    c.id,
        label: CAT_LABELS[c.code] ?? c.name,
        meta:  [c.name, c.code].filter(Boolean),
      }))
  )

  function addCategory(catId: string | null) {
    if (!catId) return
    const cat = categories.find((c) => c.id === catId)
    if (!cat || selectedIds.has(cat.id)) return
    selected = [
      ...selected,
      {
        code_id:    cat.id,
        icon_key:   cat.code,
        sort_order: selected.length,
        name:       CAT_LABELS[cat.code] ?? cat.name,
        icon_url:   null,
        _preview:   null,
        _file:      null,
      },
    ]
    pickerSelectedId = null
  }

  function removeItem(codeId: string) {
    const item = selected.find((s) => s.code_id === codeId)
    if (item?._preview) URL.revokeObjectURL(item._preview)
    selected = selected.filter((s) => s.code_id !== codeId)
  }

  function onFileChange(codeId: string, e: Event) {
    const input  = e.target as HTMLInputElement
    const file   = input.files?.[0]
    if (!file) return
    const old = selected.find((s) => s.code_id === codeId)
    if (old?._preview) URL.revokeObjectURL(old._preview)
    const preview = URL.createObjectURL(file)
    selected = selected.map((s) =>
      s.code_id === codeId ? { ...s, _preview: preview, _file: file } : s
    )
  }

  async function uploadIcon(item: SelectedItem): Promise<string | null> {
    if (!item._file) return item.icon_url
    const ext  = item._file.name.split('.').pop() ?? 'png'
    const path = `product-cat-icons/${item.icon_key}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('cms-assets')
      .upload(path, item._file, { upsert: true, contentType: item._file.type })
    if (upErr) throw new Error(`[${item.name}] 아이콘 업로드 실패: ${upErr.message}`)
    const { data } = supabase.storage.from('cms-assets').getPublicUrl(path)
    return data.publicUrl
  }

  async function save() {
    isSaving = true
    error    = null
    try {
      const resolved = await Promise.all(
        selected.map(async (s) => ({ ...s, icon_url: await uploadIcon(s) }))
      )
      const items = resolved.map((s, i) => ({
        code_id:    s.code_id,
        icon_key:   s.icon_key,
        icon_url:   s.icon_url ?? null,
        sort_order: i,
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: catErr } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key:   'product_page_categories',
        p_value: { items },
      })
      if (catErr) { error = catErr.message; return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: kwErr } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key:   'product_page_keywords',
        p_value: { items: selectedKeywords },
      })
      if (kwErr) {
        error = kwErr.message
      } else {
        await invalidateAll()
        onclose()
      }
    } catch (e) {
      error = e instanceof Error ? e.message : '저장 실패'
    }
    isSaving = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose} role="presentation"></div>

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="카테고리 설정">
  <div class="modal-header">
    <span class="modal-title">카테고리 설정</span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <!-- 스크롤 영역: 모달 내 전체 콘텐츠 -->
  <div class="modal-scroll">
    <p class="section-label">카테고리 선택</p>
    <SuggestPicker
      id="cat-picker"
      bind:selectedId={pickerSelectedId}
      options={pickerOptions}
      placeholder="분류선택-카테고리 검색 또는 선택..."
      listLabel="카테고리 제안"
      onselect={(opt) => addCategory(opt.id)}
    >
      {#snippet field(c)}
        <input
          type="text"
          class="f-input"
          id={c.id}
          placeholder={c.placeholder}
          aria-label="카테고리 선택"
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

    <!-- ② 카테고리 추가목록 -->
    {#if selected.length > 0}
      <p class="section-label mt">
        카테고리 추가목록
        <span class="hint">드래그로 순서 변경</span>
      </p>
      <div class="order-list">
        <CmsDragList bind:items={selected} class="order-drag">
          {#snippet renderItem(item)}
            <div class="cat-card-inner">

              <!-- 아이콘 미리보기: 이미지 임포트 전 빈 상태 -->
              <div class="cat-card-icon">
                {#if item._preview}
                  <img src={item._preview} alt={item.name} class="icon-img" />
                {:else if item.icon_url}
                  <img src={item.icon_url} alt={item.name} class="icon-img" />
                {/if}
              </div>

              <!-- 카테고리 이름 -->
              <span class="cat-card-name">{item.name}</span>

              <!-- 아이콘 이미지 선택 -->
              <label class="btn-icon-pick" title="아이콘 이미지 선택 (SVG, PNG)">
                <span class="pick-label">이미지</span>
                <input
                  type="file"
                  accept="image/svg+xml,image/png"
                  class="sr-only"
                  onchange={(e) => onFileChange(item.code_id, e)}
                />
              </label>

              <!-- 삭제 -->
              <button
                type="button"
                class="btn-remove"
                onclick={() => removeItem(item.code_id)}
                aria-label="{item.name} 제거"
              >✕</button>
            </div>
          {/snippet}
        </CmsDragList>
      </div>
    {:else}
      <p class="empty-hint">위 목록에서 카테고리를 선택해 추가하세요.</p>
    {/if}

    {#if error}
      <p class="save-error" role="alert">{error}</p>
    {/if}

    <!-- ③ 상품 키워드 설정: 카테고리 추가목록 아래 연속 배치 -->
    <div class="kw-area">
    <p class="section-label">
      상품 키워드
      <span class="hint">최대 10개 · 모바일 화면 노출</span>
    </p>

    {#if selectedKeywords.length < 10}
      <SuggestPicker
        id="kw-picker"
        bind:selectedId={kwPickerSelectedId}
        options={availableKwOptions}
        placeholder="브랜드·키워드 검색 또는 선택..."
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
      <p class="kw-max-hint">최대 10개 선택 완료</p>
    {/if}

    {#if selectedKeywords.length > 0}
      <div class="kw-chips">
        {#each selectedKeywords as kw}
          <span class="kw-chip">
            {kw}
            <button
              type="button"
              class="kw-chip-remove"
              onclick={() => removeKeyword(kw)}
              aria-label="{kw} 제거"
            >✕</button>
          </span>
        {/each}
      </div>
    {/if}
    </div><!-- /.kw-area -->
  </div><!-- /.modal-scroll -->

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
    overflow: hidden;
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

  /* 단일 스크롤 영역: 모달 내 전체 콘텐츠 */
  .modal-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px 40px;
  }

  .section-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 10px;
    font-weight: 700;
  }
  .section-label.mt { margin-top: 24px; }

  .hint {
    font-weight: 400;
    color: var(--cs-text-light);
    margin-left: 6px;
  }

  .f-input {
    flex: 1;
    width: 100%;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: 10px;
    padding: 12px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    min-height: 44px;
    box-sizing: border-box;
  }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  /* ── 추가목록 ── */
  .order-list :global(.order-drag) { gap: 8px; }

  .cat-card-inner {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  /* 아이콘 박스 */
  .cat-card-icon {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-lilac);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .icon-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* 카테고리 이름 */
  .cat-card-name {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 이미지 선택 레이블-버튼 */
  .btn-icon-pick {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 10px;
    background: var(--cs-surface-gray);
    border: 1px solid #ECEBF4;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s;
  }
  .btn-icon-pick:hover {
    background: rgba(59, 47, 138, 0.06);
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }
  .pick-label { font: var(--text-pc-script-12); }
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0);
    white-space: nowrap; border-width: 0;
  }

  /* 삭제 버튼 */
  .btn-remove {
    background: none;
    border: none;
    color: var(--cs-text-light);
    font-size: 13px;
    cursor: pointer;
    padding: 4px 6px;
    min-height: 28px;
    flex-shrink: 0;
    transition: color 0.12s;
  }
  .btn-remove:hover { color: var(--cs-red-badge); }

  /* 빈 상태 */
  .empty-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    text-align: center;
    padding: 24px 0 8px;
    margin-top: 16px;
  }

  /* 에러 */
  .save-error {
    margin-top: 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    background: rgba(255, 53, 53, 0.08);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
  }

  /* 푸터 */
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

  /* ── 키워드 영역 (modal-scroll 내 연속 배치) ── */
  .kw-area {
    margin-top: 24px;
  }

  /* ── 키워드 칩 ── */
  .kw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .kw-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border-radius: var(--radius-sm);
    padding: 5px 10px;
    font: var(--text-pc-body-14);
    font-size: 13px;
  }

  .kw-chip-remove {
    background: none;
    border: none;
    color: var(--cs-text-mid);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    font-size: 11px;
    min-width: 16px;
    min-height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .kw-chip-remove:hover { color: var(--cs-red-badge); }

  .kw-max-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 8px 0 0;
  }
</style>
