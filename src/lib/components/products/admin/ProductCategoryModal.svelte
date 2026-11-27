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
    name:         string          // 카테고리 원래 이름(코드그룹 정본)
    label:        string          // 메뉴에 표시할 이름(수정 가능, 원래 이름과 같으면 저장 시 변경 없음으로 처리)
    icon_url:     string | null   // 저장된 커스텀 아이콘 URL (OFF: 기본 상태)
    icon_active_url: string | null // 저장된 ON 아이콘 URL (호버·선택 상태, 상자 배경 포함 SVG)
    _preview:     string | null   // 로컬 blob preview (미업로드)
    _file:        File   | null   // 대기 중 파일
    _aPreview:    string | null   // ON 이미지 로컬 preview
    _aFile:       File   | null   // ON 이미지 대기 중 파일
  }

  interface Props {
    categories: CategoryItem[]
    initialSettings: {
      items: { code_id: string; icon_key: string; sort_order: number; name?: string | null; icon_url?: string | null; icon_active_url?: string | null }[]
    }
    initialKeywordsSettings: { items: string[] }
    onclose: () => void
    /** 통합 설정 모달 안에 섹션으로 표시(오버레이·헤더·취소 숨김) */
    embedded?: boolean
  }

  let { categories, initialSettings, initialKeywordsSettings, onclose, embedded = false }: Props = $props()

  // BUG-FIX(2026-08-10): 하드코딩 CAT_LABELS 제거 — categories prop(data.categories)이
  // 이미 백오피스에서 정식 라벨로 조회돼 내려오므로 cat.name을 그대로 사용

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
        name:       cat.name,
        label:      item.name?.trim() || cat.name,
        icon_url:   item.icon_url ?? null,
        icon_active_url: item.icon_active_url ?? null,
        _preview:   null,
        _file:      null,
        _aPreview:  null,
        _aFile:     null,
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
        label: c.name,
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
        name:       cat.name,
        label:      cat.name,
        icon_url:   null,
        icon_active_url: null,
        _preview:   null,
        _file:      null,
        _aPreview:  null,
        _aFile:     null,
      },
    ]
    pickerSelectedId = null
  }

  function removeItem(codeId: string) {
    const item = selected.find((s) => s.code_id === codeId)
    if (item?._preview) URL.revokeObjectURL(item._preview)
    if (item?._aPreview) URL.revokeObjectURL(item._aPreview)
    selected = selected.filter((s) => s.code_id !== codeId)
  }

  const LABEL_MAX = 20

  // 이름 입력 — 항목 객체를 직접 갱신해 입력 중 목록이 다시 그려지지 않게 한다
  function onLabelInput(codeId: string, e: Event) {
    const item = selected.find((s) => s.code_id === codeId)
    if (item) item.label = (e.target as HTMLInputElement).value
  }

  // 비워 두고 포커스를 옮기면 원래 이름으로 되돌린다
  function onLabelBlur(codeId: string, e: Event) {
    const item = selected.find((s) => s.code_id === codeId)
    if (!item) return
    if (!item.label.trim()) {
      item.label = item.name
      ;(e.target as HTMLInputElement).value = item.name
    }
  }

  function onFileChange(codeId: string, e: Event, variant: 'off' | 'on' = 'off') {
    const input  = e.target as HTMLInputElement
    const file   = input.files?.[0]
    if (!file) return
    const old = selected.find((s) => s.code_id === codeId)
    const preview = URL.createObjectURL(file)
    if (variant === 'on') {
      if (old?._aPreview) URL.revokeObjectURL(old._aPreview)
      selected = selected.map((s) =>
        s.code_id === codeId ? { ...s, _aPreview: preview, _aFile: file } : s
      )
      return
    }
    if (old?._preview) URL.revokeObjectURL(old._preview)
    selected = selected.map((s) =>
      s.code_id === codeId ? { ...s, _preview: preview, _file: file } : s
    )
  }

  async function uploadIcon(item: SelectedItem, variant: 'off' | 'on' = 'off'): Promise<string | null> {
    const file = variant === 'on' ? item._aFile : item._file
    if (!file) return variant === 'on' ? item.icon_active_url : item.icon_url
    const ext  = file.name.split('.').pop() ?? 'png'
    const path = `product-cat-icons/${item.icon_key}${variant === 'on' ? '-on' : ''}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('cms-assets')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) throw new Error(`[${item.name}] ${variant === 'on' ? 'ON ' : ''}아이콘 업로드 실패: ${upErr.message}`)
    const { data } = supabase.storage.from('cms-assets').getPublicUrl(path)
    return data.publicUrl
  }

  async function save() {
    isSaving = true
    error    = null
    try {
      const resolved = await Promise.all(
        selected.map(async (s) => ({ ...s, icon_url: await uploadIcon(s, 'off'), icon_active_url: await uploadIcon(s, 'on') }))
      )
      const items = resolved.map((s, i) => ({
        code_id:    s.code_id,
        icon_key:   s.icon_key,
        icon_url:   s.icon_url ?? null,
        icon_active_url: s.icon_active_url ?? null,
        name:       s.label.trim() && s.label.trim() !== s.name ? s.label.trim() : null,
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

{#if !embedded}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onclose} role="presentation"></div>
{/if}

<aside class="modal-panel" class:embedded role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="카테고리 설정">
  {#if !embedded}
    <div class="modal-header">
      <span class="modal-title">카테고리 설정</span>
      <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
    </div>
  {/if}

  <!-- 스크롤 영역: 모달 내 전체 콘텐츠 -->
  <div class="modal-scroll">
    <p class="section-label">분류선택 메뉴등록</p>
    <SuggestPicker
      id="cat-picker"
      bind:selectedId={pickerSelectedId}
      options={pickerOptions}
      clearOnSelect
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
       
      </p>
      <div class="order-list">
        <CmsDragList bind:items={selected} class="order-drag">
          {#snippet renderItem(item)}
            <div class="cat-card-inner">

              <!-- OFF 이미지: 미리보기 칸을 눌러 바로 등록 -->
              <label class="icon-tile" class:filled={!!(item._preview || item.icon_url)} title="OFF(기본) 아이콘 이미지 선택 — 상자 배경 포함 SVG 권장">
                {#if item._preview}
                  <img src={item._preview} alt="{item.name} OFF" class="icon-img" />
                {:else if item.icon_url}
                  <img src={item.icon_url} alt="{item.name} OFF" class="icon-img" />
                {/if}
                <span class="tile-tag">OFF</span>
                <input
                  type="file"
                  accept="image/svg+xml,image/png"
                  class="sr-only"
                  onchange={(e) => onFileChange(item.code_id, e)}
                />
              </label>

              <!-- ON 이미지(호버·선택 상태 공용) -->
              <label class="icon-tile" class:filled={!!(item._aPreview || item.icon_active_url)} title="ON(호버·선택) 아이콘 이미지 선택 — 상자 배경 포함 SVG 권장">
                {#if item._aPreview}
                  <img src={item._aPreview} alt="{item.name} ON" class="icon-img" />
                {:else if item.icon_active_url}
                  <img src={item.icon_active_url} alt="{item.name} ON" class="icon-img" />
                {/if}
                <span class="tile-tag">ON</span>
                <input
                  type="file"
                  accept="image/svg+xml,image/png"
                  class="sr-only"
                  onchange={(e) => onFileChange(item.code_id, e, 'on')}
                />
              </label>

              <!-- 카테고리 이름 (수정 가능) -->
              <input
                type="text"
                class="cat-name-input"
                value={item.label}
                maxlength={LABEL_MAX}
                aria-label="{item.name} 표시 이름"
                oninput={(e) => onLabelInput(item.code_id, e)}
                onblur={(e) => onLabelBlur(item.code_id, e)}
              />

              <!-- 삭제 -->
              <button
                type="button"
                class="btn-remove"
                onclick={() => removeItem(item.code_id)}
                aria-label="{item.name} 제거"
                title="제거"
              >
                <!-- CMS 공통 표준 삭제 아이콘(CmsDeleteButton 의 휴지통 SVG 12×12) -->
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
        clearOnSelect
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

    <p class="icon-size-help">아이콘 PC 88×88 · 모바일 70×70 · 둥근 사각형</p>
  </div><!-- /.modal-scroll -->

  <div class="modal-footer">
    {#if !embedded}<button class="btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>{/if}
    <button class="btn-save" onclick={save} disabled={isSaving}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</aside>

<style>
  /* 통합 설정 모달 안에 섹션으로 박히는 모드(embedded) — 오버레이·헤더 없이 본문 흐름에 배치 */
  .modal-panel.embedded { position: static; height: auto; width: auto; max-width: none; z-index: auto; border-radius: 0; box-shadow: none; background: transparent; display: block; overflow: visible; }
  .modal-panel.embedded .modal-scroll { overflow: visible; flex: none; }

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
    border-radius: var(--radius-2xl) 0 0 0; /* 패널 좌상단 곡선과 일치(front-uiux.md §9-2-A ②) */
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
  .section-label { font: var(--text-pc-body-14); font-weight: 700; }   /* 분류선택 메뉴등록·카테고리 추가목록 — 한 단계 크게(12px → 14px) */

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

  /* 선택 상품 목록(HomeCategoryProductsModal .hcp-selected-row)과 같은 카드형 행 — 연회색 면 + 반경 8px + 안쪽 여백 8px 10px */
  .cat-card-inner {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
  }

  /* 아이콘 박스 */
  .icon-size-help {
    margin: 24px 0 0;
    text-align: center;
    font-size: 12px;
    color: var(--cs-text-mid, #666);
  }

  .icon-tile {
    position: relative;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-lilac);
    border-radius: var(--radius-sm);
    overflow: hidden;
    cursor: pointer;
    transition: background 0.12s;
  }
  .icon-tile:hover { background: var(--cs-purple-op10); }
  .icon-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  /* OFF/ON 글자: 비어 있으면 칸 정중앙에 항상 표시, 이미지가 채워지면 호버 때만 반투명으로 표시 */
  .tile-tag {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid, #666);
    pointer-events: none;
    transition: opacity 0.12s;
  }
  .icon-tile.filled .tile-tag {
    opacity: 0;
    color: var(--cs-white);
    background: rgba(16, 11, 50, 0.45);
  }
  .icon-tile.filled:hover .tile-tag { opacity: 1; }

  /* 카테고리 이름 입력 */
  .cat-name-input {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    background: var(--cs-white, #fff);   /* 연회색 카드 위에서 보이도록 흰 면 */
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    box-sizing: border-box;
  }
  .cat-name-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0);
    white-space: nowrap; border-width: 0;
  }

  /* 삭제 버튼 */
  /* CMS 공통 표준 삭제 아이콘 버튼(홈 배너 모달 .btn-remove 규격과 동일) — 투명 면, 호버는 옅은 레드 면 + 레드 아이콘 */
  .btn-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    min-width: 28px;
    min-height: 32px;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-light);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .btn-remove:hover { background: rgba(255, 53, 53, 0.08); color: var(--cs-red-badge); }

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
  /* front 관리모달 푸터 표준(front-uiux.md §9-2-A ④) */
  .modal-footer {
    flex-shrink: 0;
    padding: 16px 24px;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    border-top: 1px solid var(--cs-lilac);
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
  .btn-cancel:hover:not(:disabled) { border-color: var(--cs-text-mid); }
  .btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

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
    transition: background 0.15s;
  }
  .btn-save:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

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
