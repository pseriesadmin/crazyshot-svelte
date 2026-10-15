<script lang="ts">
  import { tick } from 'svelte'
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
  }

  interface GridSettings {
    category: string
    count: number
    sort: string
    /** '고정노출 정렬'일 때 카테고리(전체 포함)별로 맨 앞에 지정 순서대로 노출할 상품 — { all: […], 카테고리id: […] }, 목록마다 최대 30개 */
    fixedByCategory?: Record<string, { id: string; order: number }[]>
    /** 이전 저장 형식(단일 목록) — '전체' 목록으로 읽는다. 저장할 때는 더 이상 쓰지 않는다 */
    fixedProducts?: { id: string; order: number }[]
  }

  interface FixedProduct {
    id: string
    name: string
    base_price_daily: number
    /** 대표 이미지(첫 번째 이미지) — 선택 목록 썸네일 */
    image_url: string | null
  }

  // 서버 모듈(productGrid.ts FIXED_GRID_MAX)과 같은 값 — $lib/server 는 브라우저에서 import 할 수 없어 따로 둔다
  const FIXED_MAX = 30

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
    { value: 'fixed',   label: '고정노출 정렬' },
  ]

  // ── 고정노출 설정(둘째·셋째 선택영역 = HomeCategoryProductsModal 의 상품 검색 + 선택 목록 구조 그대로) ──
  // 카테고리(전체 포함)마다 목록을 따로 가진다. 위 '카테고리 필터' 칩에서 고른 카테고리의 목록을 편집한다(별도 탭 없음 — 하나로 통일).
  // 목록마다 최대 FIXED_MAX개.
  const ALL_KEY = 'all'
  // svelte-ignore state_referenced_locally
  let fixedByCat        = $state<Record<string, FixedProduct[]>>(
    Object.fromEntries([[ALL_KEY, []], ...categories.map((c) => [c.id, []]), [activeCategory, []]]),
  )
  let searchResults     = $state<FixedProduct[]>([])
  let isLoadingFixed    = $state(false)
  let fixedLoadFailed   = $state(false) // 저장된 고정 목록을 못 불러왔으면 저장을 막아 기존 설정이 빈 값으로 덮이지 않게 한다
  let isSearching       = $state(false)
  let pickerSelectedId  = $state<string | null>(null)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // 현재 편집 중인 목록의 키 — 위 카테고리 필터 칩 선택(activeCategory)을 그대로 따른다
  const fixedTab = $derived(activeCategory)
  const currentFixed = $derived(fixedByCat[fixedTab] ?? [])
  const fixedIds = $derived(new Set(currentFixed.map((p) => p.id)))
  const pickerOptions = $derived<SuggestPickerOption[]>(
    searchResults
      .filter((p) => !fixedIds.has(p.id))
      .map((p) => ({
        id:    p.id,
        label: p.name,
        meta:  [`${p.base_price_daily.toLocaleString('ko-KR')}원/1일`],
      })),
  )

  function setCurrentFixed(next: FixedProduct[]) {
    fixedByCat[fixedTab] = next
  }

  // 카테고리 필터 칩 목록(전체 + 카테고리) — 폭은 "가장 긴 칩" 기준으로 통일한다.
  // 칩은 한 줄로 흘러가다 폭이 차면 다음 줄로 넘어가는(flex-wrap) 기존 배치 그대로이고,
  // 각 칩의 min-width 만 가장 넓은 칩의 실제 렌더 폭으로 맞춘다(글자 수·고정 상품 개수 배지가 바뀌면 다시 잰다).
  const chipOptions = $derived([{ id: ALL_KEY, name: '전체' }, ...categories.map((c) => ({ id: c.id, name: c.name }))])
  let chipEls = $state<HTMLButtonElement[]>([])
  let chipW   = $state(0)

  async function measureChips() {
    chipW = 0 // 자연 폭으로 되돌린 뒤
    await tick()
    chipW = Math.ceil(Math.max(0, ...chipEls.filter(Boolean).map((el) => el.offsetWidth))) // 가장 넓은 칩에 맞춘다
  }

  $effect(() => {
    // 칩 내용이 바뀌는 조건(카테고리 이름·목록)을 의존성으로 등록
    void chipOptions.map((o) => o.name).join('|')
    measureChips()
    // 웹폰트 로딩이 끝난 뒤 폭이 달라질 수 있어 한 번 더 잰다
    document.fonts?.ready.then(() => measureChips())
  })

  // 카테고리 칩 선택 — 편집 대상 목록이 바뀌므로 검색 상태를 비운다
  function selectCategory(key: string) {
    activeCategory = key
    searchResults = []
    pickerSelectedId = null
  }

  // 저장돼 있는 고정 상품 불러오기 — 모달은 열릴 때마다 새로 만들어지므로 처음 1회.
  // 이전 형식(fixedProducts 단일 목록)은 '전체' 목록으로 읽는다.
  $effect(() => {
    const saved: Record<string, { id: string; order: number }[]> = { ...(initialSettings.fixedByCategory ?? {}) }
    if (!saved[ALL_KEY] && initialSettings.fixedProducts?.length) saved[ALL_KEY] = initialSettings.fixedProducts
    const orderedIds = (list: { id: string; order: number }[] | undefined) =>
      (list ?? []).slice().sort((a, b) => a.order - b.order).map((p) => p.id).filter(Boolean)
    const idsByKey = new Map<string, string[]>()
    for (const [key, list] of Object.entries(saved)) {
      const ids = orderedIds(list)
      if (ids.length) idsByKey.set(key.toLowerCase() === ALL_KEY ? ALL_KEY : key, ids)
    }
    const allIds = [...new Set([...idsByKey.values()].flat())]
    if (!allIds.length) return
    isLoadingFixed = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase.rpc as any)('get_products_by_ids', { p_ids: allIds }).then(
      ({ data }: { data: unknown[] | null }) => {
        if (data) {
          const map = new Map<string, FixedProduct>()
          for (const r of data as Record<string, unknown>[]) {
            const id = String(r['id'] ?? '')
            if (id) {
              const imgs = r['image_urls'] as string[] | null
              map.set(id, {
                id,
                name: String(r['name'] ?? ''),
                base_price_daily: Number(r['base_price_daily'] ?? 0),
                image_url: Array.isArray(imgs) && imgs.length > 0 ? imgs[0] : null,
              })
            }
          }
          const next: Record<string, FixedProduct[]> = { ...fixedByCat }
          for (const [key, ids] of idsByKey) {
            if (!(key in next)) continue // 더 이상 없는 카테고리 키는 무시
            next[key] = ids.map((id) => map.get(id)).filter((x): x is FixedProduct => !!x)
          }
          fixedByCat = next
        } else {
          fixedLoadFailed = true
          error = '저장된 고정 목록을 불러오지 못했습니다. 모달을 닫고 다시 열어 주세요.'
        }
        isLoadingFixed = false
      },
    ).catch(() => {
      // 네트워크 예외 — 불러오기 중 상태가 남아 저장이 영구히 잠기지 않게 정리하고 안내
      fixedLoadFailed = true
      isLoadingFixed = false
      error = '저장된 고정 목록을 불러오지 못했습니다. 모달을 닫고 다시 열어 주세요.'
    })
  })

  function onPickerInput(val: string) {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!val.trim()) { searchResults = []; return }
    debounceTimer = setTimeout(() => doSearch(val.trim()), 280)
  }

  // 브라우저 직접 RPC 대신 서버 라우트 사용(nlsearch.md §2) — 홈 카테고리 상품 모달과 같은 엔드포인트
  async function doSearch(q: string) {
    isSearching = true
    try {
      // 상단 카테고리 필터 칩이 '전체'가 아니면 그 카테고리 상품만 검색한다(서버가 카테고리로 제한)
      const catParam = activeCategory !== ALL_KEY ? `&category=${encodeURIComponent(activeCategory)}` : ''
      const res = await fetch(`/api/cms/products/search-suggestions?q=${encodeURIComponent(q)}&limit=10${catParam}`)
      if (res.ok) {
        const items = await res.json() as Array<{ id: string; name: string; image_url?: string | null; price_24h?: number | null }>
        searchResults = items
          .filter((r) => !!r.id)
          .map((r) => ({ id: r.id, name: r.name, base_price_daily: r.price_24h ?? 0, image_url: r.image_url ?? null }))
      } else {
        searchResults = []
      }
    } catch {
      searchResults = []
    }
    isSearching = false
  }

  function onProductSelect(opt: SuggestPickerOption) {
    const product = searchResults.find((p) => p.id === opt.id)
    if (product && currentFixed.length < FIXED_MAX && !fixedIds.has(product.id)) {
      setCurrentFixed([...currentFixed, product])
    }
    setTimeout(() => { pickerSelectedId = null; searchResults = [] }, 0)
  }

  const COUNT_OPTIONS = [
    { value: 8,  label: '8개' },
    { value: 16, label: '16개' },
    { value: 0,  label: '전체' },
  ]

  async function save() {
    isSaving = true
    error = null
    // 고정 상품 목록은 노출 순서가 '고정노출 정렬'이 아니어도 그대로 보관한다(다시 고르면 바로 쓸 수 있도록) — 화면은 sort==='fixed'일 때만 사용.
    // 비어 있는 탭은 저장하지 않고, 이전 형식(fixedProducts)은 더 이상 쓰지 않는다(전체 탭 값으로 흡수됨).
    const fixedByCategory: Record<string, { id: string; order: number }[]> = {}
    for (const [key, list] of Object.entries(fixedByCat)) {
      if (list.length) fixedByCategory[key] = list.map((p, i) => ({ id: p.id, order: i }))
    }
    const value: GridSettings = { category: activeCategory, count, sort, fixedByCategory }
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
      <p class="fx-label">카테고리 필터</p>
      <div class="chip-group">
        {#each chipOptions as opt, i (opt.id)}
          <button
            bind:this={chipEls[i]}
            class="chip"
            class:chip-active={activeCategory === opt.id}
            style:min-width={chipW ? `${chipW}px` : undefined}
            onclick={() => selectCategory(opt.id)}
          >{opt.name}</button>
        {/each}
      </div>
    </div>

    <!-- [숨김 보관 2026-09-29, Stephen 지시] 노출 수량(8개/16개/전체) 선택 UI — 제거하지 않고 주석 처리.
         PC '전체' 화면은 무한스크롤(20개 시작·10개씩 추가)로 동작하며 이 설정과 연동되지 않아 일시 숨김.
         추후 재개발 시 이 블록의 주석을 해제하고 서버(+page.server.ts gridLimit)·화면 연동을 함께 정리할 것.
         저장값(count)은 기존 값 그대로 유지된다.
         ※ 되살릴 때는 radio 대신 위 '노출 순서'와 같은 콤보 버튼(.combo-wrap/.combo-btn, front-uiux.md §16)으로 구현할 것 — radio 구현은 금지, 라디오 전용 스타일은 삭제됨.
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
    -->

    <!-- 노출 순서 -->
    <div class="section">
      <p class="section-label">노출 순서</p>
      <!-- 콤보 버튼 선택 그룹(front-uiux.md §16) — radio 대신 버튼 배열, 선택 = 보라 채움 -->
      <div class="combo-wrap" role="group" aria-label="노출 순서">
        {#each SORT_OPTIONS as opt}
          <button
            type="button"
            class="combo-btn"
            class:combo-btn-active={sort === opt.value}
            aria-pressed={sort === opt.value}
            onclick={() => (sort = opt.value)}
          >
            <span class="combo-label">{opt.label}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- 고정노출 설정 — 노출 순서가 '고정노출 정렬'이 아니면 가리지 않고 비활성(흐리게·조작 불가)으로 보여 준다.
         inert: 포커스·클릭·드래그·키 입력을 모두 막는다. 둘째(상품 추가)·셋째(선택된 상품) 선택영역 구조 그대로 -->
    <div class="fx-root" class:fx-disabled={sort !== 'fixed'} inert={sort !== 'fixed'} aria-disabled={sort !== 'fixed'}>
      <!-- 상품 추가 + 선택된 상품 — 카드형 그룹(ProductHeroModal .group-products 와 동일 스타일) -->
      <div class="fx-group">
      <div class="section">
        <p class="fx-label fx-label-sm">
          고정노출 설정
          <span class="fx-count">{currentFixed.length}/{FIXED_MAX}</span>
        </p>
        {#if isLoadingFixed}
          <p class="fx-hint">저장된 상품을 불러오는 중…</p>
        {/if}
        {#if currentFixed.length < FIXED_MAX}
          <div class="fx-picker-wrap">
            <SuggestPicker
              id="grid-fixed-search"
              bind:selectedId={pickerSelectedId}
              options={pickerOptions}
              noFilter
              clearOnSelect
              itemLayout="row"
              placeholder="상품명으로 검색..."
              listLabel="상품 검색 결과"
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
                <span class="fx-suggest-name">{item.label}</span>
                <span class="fx-suggest-price">{item.meta?.[0] ?? ''}</span>
              {/snippet}
            </SuggestPicker>
            {#if isSearching}
              <p class="fx-hint fx-hint--searching">검색 중…</p>
            {/if}
          </div>
        {:else}
          <p class="fx-hint fx-hint--max">최대 {FIXED_MAX}개 선택 완료. 아래 목록에서 불필요한 항목을 제거하세요.</p>
        {/if}
      </div>

      {#if currentFixed.length > 0}
        <div class="section">
          <div class="fx-list">
          <CmsDragList bind:items={fixedByCat[fixedTab]} itemKey={(item) => item.id}>
            {#snippet renderItem(item)}
              <div class="fx-selected-row">
                {#if item.image_url}
                  <img class="fx-thumb" src={item.image_url} alt="" loading="lazy" />
                {:else}
                  <span class="fx-thumb fx-thumb--empty" aria-hidden="true"></span>
                {/if}
                <span class="fx-selected-name">{item.name}</span>
                <button
                  class="fx-remove-btn"
                  onclick={() => { setCurrentFixed(currentFixed.filter((s) => s.id !== item.id)) }}
                  aria-label="{item.name} 제거"
                >✕</button>
              </div>
            {/snippet}
          </CmsDragList>
          </div>
        </div>
      {:else if !isLoadingFixed}
        <p class="fx-empty">위 검색창에서 상품을 검색해 추가하세요. 이 카테고리에 고정 상품이 없으면 조회수순으로 노출됩니다.</p>
      {/if}
      </div>
    </div>

    {#if error}
      <p class="save-error" role="alert">{error}</p>
    {/if}
  </div>

  <div class="modal-footer">
    <button class="btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>
    <button class="btn-save" onclick={save} disabled={isSaving || isLoadingFixed || fixedLoadFailed}>
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
    gap: 36px;
  }

  .section { display: flex; flex-direction: column; gap: 10px; }

  .section-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* 카테고리 필터 칩 — 한 줄로 흘러가다 폭이 차면 다음 줄로 넘어가는 기존 배치(flex-wrap). 칩 폭 통일은 각 칩의 min-width(스크립트에서 측정) */
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
    /* 카테고리 필터에 시각적 비중 — 콤보 버튼 라벨과 폰트 교환(13px·Bold). 줄 높이는 칩 높이(34px) 안에서 토큰 값 유지 */
    font-size: 13px;
    font-weight: 700;
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

  /* ━━━ 콤보 버튼 선택 그룹 — front-uiux.md §16-4 표준 패턴 ━━━
     정본은 가로 스크롤(overflow-x:auto)이지만, 이 모달은 폭이 372px라 5개 옵션이 한 줄에 다 보이지 않아 3열 그리드로 배치한다.
     모든 버튼의 가로폭은 "글자가 가장 많은 버튼" 기준으로 같다 — inline-grid(최대 콘텐츠 폭)의 1fr 트랙은 가장 넓은 항목에 맞춰 동일 폭이 된다.
     버튼 규격(패딩·반경·보더·색)은 정본 그대로. */
  .combo-wrap {
    display: inline-grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px 6px; /* 행 간격 12px · 열 간격 6px */
    align-self: flex-start; /* 부모(.section, flex column)가 폭을 늘리지 않게 — 폭은 가장 긴 버튼 기준 */
  }
  .combo-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 16px;
    border-radius: var(--radius-xl);
    border: 1.5px solid #DCDCDC;
    background: #fff;
    cursor: pointer;
    transition: all 0.18s;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .combo-btn:hover { background: #F5F4FA; } /* 호버는 BG 색상 변경만 */
  .combo-btn-active,
  .combo-btn-active:hover {
    border-color: var(--cs-purple);
    background: var(--cs-purple);
  }
  /* 폰트 교환(Stephen 지시 2026-10-15): 콤보 라벨은 카테고리 필터 칩이 쓰던 토큰(--text-pc-script-12)을 사용 — §16 표준(13px Bold)과 다른 이 모달 한정 값 */
  .combo-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text);
  }
  .combo-btn-active .combo-label { color: #fff; }
  @media (max-width: 640px) {
    .combo-btn   { padding: 8px 12px; }
  }


  /* ── 고정노출 설정: 홈 카테고리 상품 모달(.hcp-*)의 상품 검색·선택 목록 스타일 그대로 ── */
  .fx-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
  }
  /* 카드 안 "고정노출 설정" 제목 — 카테고리 설정 모달의 '카테고리 선택' 라벨과 같은 폰트(12px·700·보조 텍스트색) */
  .fx-label.fx-label-sm {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  /* 개수 배지 — ProductHeroModal .count-badge 와 동일 */
  .fx-count {
    background: rgba(59, 47, 138, 0.1);
    color: var(--cs-purple);
    border-radius: var(--radius-full);
    padding: 1px 8px;
    font-size: 11px;
    font-weight: 400;
    margin-left: auto; /* 제목 줄의 우측 끝으로 */
  }
  /* 탭(칩) 안의 설정된 상품 수 표시 */

  /* 고정노출 설정 전체 래퍼 — modal-body 와 같은 세로 간격을 유지하고, 비활성일 때는 흐리게 보인다 */
  .fx-root { display: flex; flex-direction: column; gap: 24px; transition: opacity 0.15s; }
  .fx-root.fx-disabled { opacity: 0.45; }

  /* 카드형 그룹 — ProductHeroModal .group-products 와 동일(연보라 카드·반경 15px·패딩 12px 20px·내부 간격 16px) */
  .fx-group {
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: var(--cs-lilac);
    border-radius: var(--radius-md);
    padding: 20px;
  }

  .fx-picker-wrap { position: relative; }
  /* 검색 입력창과 선택된 상품 목록 사이 여백 */
  .fx-list { margin-top: 12px; }

  /* 입력창 — ProductHeroModal .f-input 규격 */
  .f-input {
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
  .f-input::placeholder { color: var(--cs-text-light); }

  .fx-hint { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; line-height: 1.6; }
  .fx-hint--searching { color: var(--cs-purple); }
  .fx-hint--max { color: var(--cs-text-light); }

  .fx-suggest-name  { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text); }
  .fx-suggest-price { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin-left: 6px; }

  /* 선택 목록 행 사이 간격 — 공용 CmsDragList(다른 모달도 사용)는 건드리지 않고 이 모달 래퍼에서만 지정 */
  .fx-list :global(.drag-list) { gap: 8px; }

  /* 선택 행 — ProductHeroModal .selected-row/.selected-name/.remove-btn 규격(카드 위에서는 행 배경 없음, 썸네일만 추가) */
  .fx-selected-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0; /* 드래그 목록 안에서 콘텐츠 폭으로 늘어나지 않고 모달 폭에 맞춰 말줄임이 동작하도록 */
  }
  /* 썸네일: 히어로 배너 모달 목록(.img-thumb)과 같은 48×36 규격 */
  .fx-thumb {
    width: 48px;
    height: 36px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: var(--cs-white);
  }
  .fx-thumb--empty { display: inline-block; }
  .fx-selected-name {
    flex: 1;
    min-width: 0;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fx-remove-btn {
    background: none;
    border: none;
    color: var(--cs-text-light);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 14px;
    min-height: 32px;
    min-width: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    transition: background 0.12s, color 0.12s;
  }
  .fx-remove-btn:hover { background: rgba(255, 53, 53, 0.08); color: var(--cs-red-badge); }

  .fx-empty {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    text-align: center;
    padding: 12px 0;
    margin: 0;
    line-height: 1.6;
  }

  .save-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    background: rgba(255, 53, 53, 0.08);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
  }

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
</style>
