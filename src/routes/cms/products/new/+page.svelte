<script lang="ts">
  import { enhance } from '$app/forms'
  import { supabase } from '$lib/services/supabase'
  import { csToast } from '$lib/utils/toast'
  import type { ActionData } from './$types'

  interface Props { form: ActionData }
  let { form }: Props = $props()

  type FormResult = { error?: string } | null

  const CATEGORIES = [
    { value: 'camera',     label: '카메라' },
    { value: 'lens',       label: '렌즈' },
    { value: 'camcorder',  label: '캠코더' },
    { value: 'action_cam', label: '액션캠' },
    { value: 'drone',      label: '드론' },
    { value: 'lighting',   label: '조명' },
    { value: 'audio',      label: '오디오' },
    { value: 'accessory',  label: '보조용품' },
    { value: 'package',    label: '패키지' },
  ]

  const CATEGORY_CODES: Record<string, string> = {
    camera: 'CAM', lens: 'LNS', camcorder: 'CMC', action_cam: 'ACT',
    drone: 'DRN', lighting: 'LGT', audio: 'AUD', accessory: 'ACC', package: 'PKG',
  }

  // ─── 옵션상품 ───────────────────────────────────────────────
  interface OptionSearchResult {
    id: string
    name: string
    price_24h: number
    stock_quantity: number
    image_url: string | null
  }
  interface SelectedOption {
    option_product_id: string
    name: string
    price_24h: number
    stock_quantity: number
    image_url: string | null
    is_required: boolean
    min_select_required: boolean
    delivery_rental_disabled: boolean
  }

  let optionKeyword = $state('')
  let showOptionModal = $state(false)
  let optionResults = $state<OptionSearchResult[]>([])
  let optionSearching = $state(false)
  let selectedOptions = $state<SelectedOption[]>([])
  let bulkRequired = $state(false)
  let bulkMinSelectRequired = $state(false)
  let bulkDeliveryDisabled = $state(false)

  interface ProductSearchRow {
    id: string
    name: string
    stock_quantity: number
    image_urls: string[]
    price_rules: { price: number; duration_type: string }[]
  }

  async function searchOptionProducts() {
    const kw = optionKeyword.trim()
    if (!kw) return
    optionSearching = true
    showOptionModal = true
    const { data, error: err } = await supabase
      .from('products')
      .select<string, ProductSearchRow>('id, name, stock_quantity, image_urls, price_rules(price, duration_type)')
      .ilike('name', `%${kw}%`)
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(20)
    optionSearching = false
    if (err) { csToast.error('상품 검색 중 오류가 발생했습니다.'); return }
    optionResults = (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      stock_quantity: p.stock_quantity ?? 0,
      image_url: p.image_urls[0] ?? null,
      price_24h: p.price_rules.find((r) => r.duration_type === '24h')?.price ?? 0,
    }))
  }

  function addOptionProduct(item: OptionSearchResult) {
    if (selectedOptions.some((o) => o.option_product_id === item.id)) {
      csToast.info('이미 추가된 상품입니다.')
      return
    }
    selectedOptions = [
      ...selectedOptions,
      {
        option_product_id: item.id,
        name: item.name,
        price_24h: item.price_24h,
        stock_quantity: item.stock_quantity,
        image_url: item.image_url,
        is_required: false,
        min_select_required: false,
        delivery_rental_disabled: false,
      },
    ]
    showOptionModal = false
    optionKeyword = ''
    optionResults = []
  }

  function removeOption(id: string) {
    selectedOptions = selectedOptions.filter((o) => o.option_product_id !== id)
  }

  function applyBulk() {
    selectedOptions = selectedOptions.map((o) => ({
      ...o,
      is_required: bulkRequired,
      min_select_required: bulkMinSelectRequired,
      delivery_rental_disabled: bulkDeliveryDisabled,
    }))
  }

  function serializeOptionLinks(): string {
    return JSON.stringify(
      selectedOptions.map((o, i) => ({
        option_product_id: o.option_product_id,
        is_required: o.is_required,
        min_select_required: o.min_select_required,
        delivery_rental_disabled: o.delivery_rental_disabled,
        display_order: i,
      }))
    )
  }
  // ────────────────────────────────────────────────────────────

  let isLoading = $state(false)
  let isActive = $state(true)
  let category = $state('')
  let nameVal = $state('')
  let slugVal = $state('')
  let imageUrls = $state<string[]>([''])
  let specs = $state<{ key: string; value: string }[]>([{ key: '', value: '' }])

  let result = $derived(form as FormResult)

  $effect(() => {
    if (result?.error) csToast.error(result.error)
  })

  function autoSlug(name: string, cat: string): string {
    const catCode = CATEGORY_CODES[cat]?.toLowerCase() ?? ''
    const cleaned = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
    const ym = new Date().toISOString().slice(2, 7).replace('-', '')
    const parts = [catCode, cleaned, ym].filter(Boolean)
    return parts.join('-').slice(0, 200)
  }

  function onNameInput() {
    if (!slugVal || slugVal === autoSlug(nameVal.slice(0, -1), category)) {
      slugVal = autoSlug(nameVal, category)
    }
  }
  function onCategoryChange() {
    if (nameVal) slugVal = autoSlug(nameVal, category)
  }

  function addImage() { imageUrls = [...imageUrls, ''] }
  function removeImage(i: number) { imageUrls = imageUrls.filter((_, idx) => idx !== i) }

  function addSpec() { specs = [...specs, { key: '', value: '' }] }
  function removeSpec(i: number) { specs = specs.filter((_, idx) => idx !== i) }

  function serializeSpecs(): string {
    const obj: Record<string, string> = {}
    for (const s of specs) {
      if (s.key.trim()) obj[s.key.trim()] = s.value
    }
    return JSON.stringify(obj)
  }

  function serializeImages(): string {
    return JSON.stringify(imageUrls.filter(Boolean))
  }

  function thumbPreview(url: string): string {
    if (!url) return ''
    if (url.startsWith('http')) return url
    return `https://res.cloudinary.com/crazyshot/image/upload/w_120,h_90,c_fill,f_auto,q_auto/${url}.jpg`
  }

  let assetCodePreview = $derived(
    category
      ? `CS-${CATEGORY_CODES[category] ?? '???'}-${new Date().toISOString().slice(2, 7).replace('-', '')}-001`
      : 'CS-???-2607-001'
  )
</script>

<svelte:head><title>상품등록 — CrazyShot CMS</title></svelte:head>

<div class="form-wrap">
  <div class="form-header">
    <a href="/cms/products" class="back-link">← 목록으로</a>
    <h1 class="page-title">상품 등록</h1>
  </div>

  {#if result?.error}
    <div class="error-banner" role="alert">{result.error}</div>
  {/if}

  <form
    method="POST"
    action="?/create"
    use:enhance={() => {
      isLoading = true
      return async ({ update }) => { await update(); isLoading = false }
    }}
    class="product-form"
  >
    <!-- Hidden serialized fields -->
    <input type="hidden" name="specifications" value={serializeSpecs()} />
    <input type="hidden" name="image_urls" value={serializeImages()} />
    <input type="hidden" name="is_active" value={isActive.toString()} />
    <input type="hidden" name="option_links" value={serializeOptionLinks()} />

    <!-- ① 기본정보 -->
    <section class="form-section">
      <h2 class="section-title">① 기본정보</h2>

      <div class="field-row">
        <label class="field-label" for="category">카테고리 <span class="required">*</span></label>
        <select
          id="category"
          name="category"
          class="f-input f-select"
          bind:value={category}
          onchange={onCategoryChange}
          required
        >
          <option value="">카테고리 선택</option>
          {#each CATEGORIES as cat}
            <option value={cat.value}>{cat.label}</option>
          {/each}
        </select>
      </div>

      <div class="field-row">
        <label class="field-label" for="name">상품명 <span class="required">*</span></label>
        <input
          id="name"
          name="name"
          type="text"
          class="f-input"
          placeholder="예: Sony FX3 Full-Frame Cinema Camera"
          bind:value={nameVal}
          oninput={onNameInput}
          required
        />
      </div>

      <div class="field-row">
        <label class="field-label" for="brand">브랜드</label>
        <input id="brand" name="brand" type="text" class="f-input" placeholder="예: Sony" />
      </div>

      <div class="field-row">
        <label class="field-label" for="slug">
          슬러그 <span class="required">*</span>
          <span class="field-hint">URL에 사용됩니다 — 영문·숫자·하이픈만</span>
        </label>
        <input
          id="slug"
          name="slug"
          type="text"
          class="f-input"
          placeholder="예: sony-fx3-2607"
          bind:value={slugVal}
          pattern="[a-z0-9-]+"
          required
        />
      </div>

      <div class="field-row">
        <div class="field-label">판매 상태</div>
        <div class="toggle-wrap">
          <button
            type="button"
            class="toggle-btn"
            class:on={isActive}
            onclick={() => (isActive = !isActive)}
            aria-pressed={isActive}
            aria-label="판매 상태 전환"
          >
            <span class="toggle-knob"></span>
          </button>
          <span class="toggle-label">{isActive ? '활성 (판매중)' : '비활성 (숨김)'}</span>
        </div>
      </div>
    </section>

    <!-- ② 상품 설명 & 스펙 -->
    <section class="form-section">
      <h2 class="section-title">② 상품 설명 & 스펙</h2>

      <div class="field-row">
        <label class="field-label" for="description">상품 설명</label>
        <textarea
          id="description"
          name="description"
          class="f-input f-textarea"
          placeholder="상품 특징, 구성품, 주의사항 등을 입력해주세요."
          rows={4}
        ></textarea>
      </div>

      <div class="field-row">
        <div class="field-label">
          스펙 항목
          <span class="field-hint">키-값 형식으로 입력 — JSON으로 저장됩니다</span>
        </div>
        <div class="spec-list">
          {#each specs as spec, i (i)}
            <div class="spec-row">
              <input
                type="text"
                class="f-input spec-key"
                placeholder="항목명 (예: 센서)"
                bind:value={spec.key}
                aria-label={`스펙 항목명 ${i + 1}`}
              />
              <input
                type="text"
                class="f-input spec-val"
                placeholder="값 (예: 풀프레임 CMOS)"
                bind:value={spec.value}
                aria-label={`스펙 값 ${i + 1}`}
              />
              <button
                type="button"
                class="remove-btn"
                onclick={() => removeSpec(i)}
                aria-label="스펙 항목 삭제"
                disabled={specs.length === 1}
              >✕</button>
            </div>
          {/each}
          <button type="button" class="add-btn" onclick={addSpec}>+ 스펙 항목 추가</button>
        </div>
      </div>
    </section>

    <!-- ③ 옵션상품 -->
    <section class="form-section">
      <h2 class="section-title">③ 옵션상품</h2>
      <p class="section-desc">함께 대여 가능한 옵션상품을 상품 DB에서 검색해 추가합니다.</p>

      <!-- 검색 입력폼 -->
      <div class="option-search-row">
        <input
          class="f-input option-search-input"
          type="text"
          placeholder="상품명 또는 키워드 입력 후 검색..."
          bind:value={optionKeyword}
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchOptionProducts() } }}
          aria-label="옵션상품 검색"
        />
        <button type="button" class="btn-search" onclick={searchOptionProducts} disabled={optionSearching}>
          {optionSearching ? '검색 중...' : '검색'}
        </button>
      </div>

      <!-- 검색 결과 모달 -->
      {#if showOptionModal}
        <div
          class="option-modal-backdrop"
          onclick={() => { showOptionModal = false }}
          role="presentation"
        >
          <div
            class="option-modal"
            role="dialog"
            aria-modal="true"
            aria-label="옵션상품 검색 결과"
            onclick={(e) => e.stopPropagation()}
          >
            <div class="option-modal-header">
              <p class="option-modal-title">검색 결과</p>
              <button
                type="button"
                class="option-modal-close"
                onclick={() => { showOptionModal = false }}
                aria-label="닫기"
              >✕</button>
            </div>
            {#if optionSearching}
              <p class="option-modal-empty">검색 중...</p>
            {:else if optionResults.length === 0}
              <p class="option-modal-empty">검색 결과가 없습니다.</p>
            {:else}
              <ul class="option-result-list">
                {#each optionResults as item (item.id)}
                  <li class="option-result-item">
                    {#if item.image_url}
                      <img
                        src={item.image_url}
                        alt={item.name}
                        class="option-result-thumb"
                        width="56"
                        height="42"
                        loading="lazy"
                      />
                    {:else}
                      <div class="option-result-thumb option-result-thumb--empty">No img</div>
                    {/if}
                    <div class="option-result-info">
                      <p class="option-result-name">{item.name}</p>
                      <p class="option-result-meta">
                        24h: {item.price_24h.toLocaleString()}원 · 재고: {item.stock_quantity}개
                      </p>
                      <a
                        href="/products/{item.id}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="btn-detail-link"
                      >상세정보 더보기</a>
                    </div>
                    <button
                      type="button"
                      class="btn-add-option"
                      onclick={() => addOptionProduct(item)}
                    >추가</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      {/if}

      <!-- 선택된 옵션 목록 -->
      {#if selectedOptions.length > 0}
        <!-- 일괄 적용 행 -->
        <div class="bulk-row">
          <span class="bulk-label">일괄 적용</span>
          <label class="cb-label">
            <input type="checkbox" class="cb-input" bind:checked={bulkRequired} />
            필수 선택
          </label>
          <label class="cb-label">
            <input type="checkbox" class="cb-input" bind:checked={bulkMinSelectRequired} />
            최소 1개 선택 필수
          </label>
          <label class="cb-label">
            <input type="checkbox" class="cb-input" bind:checked={bulkDeliveryDisabled} />
            배송 대여 불가
          </label>
          <button type="button" class="btn-bulk-apply" onclick={applyBulk}>적용</button>
        </div>

        <div class="selected-option-list">
          {#each selectedOptions as opt, i (opt.option_product_id)}
            <div class="selected-option-card">
              {#if opt.image_url}
                <img
                  src={opt.image_url}
                  alt={opt.name}
                  class="selected-option-thumb"
                  width="64"
                  height="48"
                  loading="lazy"
                />
              {:else}
                <div class="selected-option-thumb selected-option-thumb--empty">No img</div>
              {/if}
              <div class="selected-option-info">
                <p class="selected-option-name">{opt.name}</p>
                <p class="selected-option-meta">
                  24h: {opt.price_24h.toLocaleString()}원 · 재고: {opt.stock_quantity}개
                </p>
                <div class="selected-option-cbs">
                  <label class="cb-label">
                    <input
                      type="checkbox"
                      class="cb-input"
                      bind:checked={selectedOptions[i].is_required}
                    />
                    필수 선택
                  </label>
                  <label class="cb-label">
                    <input
                      type="checkbox"
                      class="cb-input"
                      bind:checked={selectedOptions[i].min_select_required}
                    />
                    최소 1개 선택 필수
                  </label>
                  <label class="cb-label">
                    <input
                      type="checkbox"
                      class="cb-input"
                      bind:checked={selectedOptions[i].delivery_rental_disabled}
                    />
                    배송 대여 불가
                  </label>
                </div>
              </div>
              <button
                type="button"
                class="remove-btn"
                onclick={() => removeOption(opt.option_product_id)}
                aria-label="{opt.name} 옵션 제거"
              >✕</button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="no-option-msg">추가된 옵션상품이 없습니다.</p>
      {/if}
    </section>

    <!-- ④ 가격 정책 -->
    <section class="form-section">
      <h2 class="section-title">④ 가격 정책</h2>
      <p class="section-desc">24시간 가격은 필수입니다. 미입력 시 해당 유형 가격정책은 생성되지 않습니다.</p>

      <div class="price-grid">
        <div class="field-row">
          <label class="field-label" for="price_12h">12시간 가격 (원)</label>
          <input id="price_12h" name="price_12h" type="number" class="f-input" placeholder="예: 45000" min="0" step="1000" />
        </div>
        <div class="field-row">
          <label class="field-label" for="price_24h">24시간 가격 (원) <span class="required">*</span></label>
          <input id="price_24h" name="price_24h" type="number" class="f-input" placeholder="예: 85000" min="0" step="1000" />
        </div>
        <div class="field-row">
          <label class="field-label" for="price_monthly">월정액 가격 (원)</label>
          <input id="price_monthly" name="price_monthly" type="number" class="f-input" placeholder="예: 1200000" min="0" step="10000" />
        </div>
      </div>

      <div class="price-grid price-grid-3">
        <div class="field-row">
          <label class="field-label" for="deposit_amount">보증금 (원)</label>
          <input id="deposit_amount" name="deposit_amount" type="number" class="f-input" placeholder="예: 500000" min="0" step="10000" />
        </div>
        <div class="field-row">
          <label class="field-label" for="late_fee_per_hour">연체료/시간 (원)</label>
          <input id="late_fee_per_hour" name="late_fee_per_hour" type="number" class="f-input" placeholder="예: 5000" min="0" />
        </div>
        <div class="field-row">
          <label class="field-label" for="damage_fee_percentage">파손 수수료 (%)</label>
          <input id="damage_fee_percentage" name="damage_fee_percentage" type="number" class="f-input" placeholder="예: 20" min="0" max="100" step="1" />
        </div>
      </div>
    </section>

    <!-- ⑤ 이미지 -->
    <section class="form-section">
      <h2 class="section-title">⑤ 이미지</h2>
      <p class="section-desc">Cloudinary Public ID 또는 이미지 URL을 입력하세요. 첫 번째 이미지가 대표 이미지입니다.</p>

      <div class="image-list">
        {#each imageUrls as url, i}
          <div class="image-row">
            <div class="image-preview-wrap">
              {#if thumbPreview(url)}
                <img
                  src={thumbPreview(url)}
                  alt={`이미지 ${i + 1} 미리보기`}
                  class="image-preview"
                  width="80"
                  height="60"
                  loading="lazy"
                />
              {:else}
                <div class="image-preview-empty">미리보기</div>
              {/if}
            </div>
            <input
              type="text"
              class="f-input image-url-input"
              placeholder={i === 0 ? '대표 이미지 URL 또는 Cloudinary Public ID' : `이미지 ${i + 1} URL`}
              bind:value={imageUrls[i]}
              aria-label={`이미지 ${i + 1} URL`}
            />
            <button
              type="button"
              class="remove-btn"
              onclick={() => removeImage(i)}
              aria-label="이미지 삭제"
              disabled={imageUrls.length === 1}
            >✕</button>
          </div>
        {/each}
        {#if imageUrls.length < 8}
          <button type="button" class="add-btn" onclick={addImage}>+ 이미지 추가 (최대 8장)</button>
        {/if}
      </div>
    </section>

    <!-- ⑥ 재고 안내 -->
    <section class="form-section info-section">
      <h2 class="section-title">⑥ 실물 재고 (Asset) 등록 안내</h2>
      <div class="info-box">
        <p class="info-text">
          상품 등록 후, 실물 재고는 <strong>[재고관리]</strong> 탭에서 시리얼번호 단위로 등록합니다.
        </p>
        <p class="info-text">
          품번 자동 생성 형식: <code class="asset-code-preview">{assetCodePreview}</code>
        </p>
        <p class="info-subtext">
          CS-{category ? CATEGORY_CODES[category] : '???'}-{'{'}YYMM{'}'}-{'{'}SEQ{'}'}  형식으로 생성됩니다.
        </p>
      </div>
    </section>

    <!-- 제출 버튼 -->
    <div class="form-actions">
      <a href="/cms/products" class="cancel-btn">취소</a>
      <button type="submit" class="submit-btn" disabled={isLoading}>
        {isLoading ? '등록 중...' : '상품 등록'}
      </button>
    </div>
  </form>
</div>

<style>
  .form-wrap {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
    overflow-y: auto;
    height: 100%;
  }

  .form-header {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .back-link {
    color: var(--cs-text-mid);
    text-decoration: none;
    font: var(--text-pc-body-14);
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    transition: color 0.12s;
  }
  .back-link:hover { color: var(--cs-text); }
  .page-title {
    font: var(--text-pc-htitle-25);
    color: var(--cs-text);
    margin: 0;
  }

  .error-banner {
    padding: 14px 20px;
    background: rgba(255,53,53,0.08);
    border: 1px solid var(--cs-red-badge);
    border-radius: var(--cms-radius-sm);
    color: var(--cs-red-badge);
    font: var(--text-pc-body-14);
  }

  /* 폼 섹션 */
  .product-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .form-section {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .section-title {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
    margin: 0 0 4px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--cs-lilac);
  }
  .section-desc {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: -8px 0 0;
  }

  /* 필드 */
  .field-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text-dark);
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .required { color: var(--cs-red-badge); font: var(--text-pc-script-12); }
  .field-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    font-weight: 400;
  }

  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 12px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 100%;
    box-sizing: border-box;
  }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-select { cursor: pointer; }
  .f-textarea { resize: vertical; min-height: 100px; }

  /* 토글 */
  .toggle-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }
  .toggle-btn {
    position: relative;
    width: 48px;
    height: 28px;
    border: none;
    border-radius: 14px;
    background: var(--cs-surface-gray);
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .toggle-btn.on { background: var(--cs-purple); }
  .toggle-knob {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--cs-white);
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .toggle-btn.on .toggle-knob { transform: translateX(20px); }
  .toggle-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text-dark);
  }

  /* 스펙 */
  .spec-list { display: flex; flex-direction: column; gap: 8px; }
  .spec-row { display: flex; gap: 8px; align-items: center; }
  .spec-key { flex: 2; }
  .spec-val { flex: 3; }

  /* 가격 그리드 */
  .price-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .price-grid-3 { grid-template-columns: 1fr 1fr 1fr; }

  /* 이미지 */
  .image-list { display: flex; flex-direction: column; gap: 10px; }
  .image-row { display: flex; gap: 10px; align-items: center; }
  .image-preview-wrap { flex-shrink: 0; }
  .image-preview {
    width: 80px;
    height: 60px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    display: block;
  }
  .image-preview-empty {
    width: 80px;
    height: 60px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-script-12);
    color: var(--cs-text-placeholder);
  }
  .image-url-input { flex: 1; }

  /* 공통 버튼 */
  .remove-btn {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    cursor: pointer;
    font: var(--text-pc-script-12);
    transition: background 0.12s, color 0.12s;
  }
  .remove-btn:hover:not(:disabled) { background: rgba(255,53,53,0.1); color: var(--cs-red-badge); }
  .remove-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .add-btn {
    align-self: flex-start;
    padding: 8px 16px;
    border: 1.5px dashed rgba(59,47,138,0.25);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    cursor: pointer;
    min-height: 44px;
    transition: background 0.12s, border-color 0.12s;
  }
  .add-btn:hover { background: var(--cs-lilac); border-color: var(--cs-purple); }

  /* 안내 섹션 */
  .info-section { background: var(--cs-lilac); }
  .info-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 20px;
    background: white;
    border-radius: var(--cms-radius-sm);
    border-left: 3px solid var(--cs-purple);
  }
  .info-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text-dark);
    margin: 0;
  }
  .info-subtext {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 0;
  }
  .asset-code-preview {
    display: inline-block;
    padding: 2px 8px;
    background: var(--cs-dark);
    color: var(--cs-orange);
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    letter-spacing: 0.5px;
  }

  /* 폼 액션 버튼 */
  .form-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 8px 0 20px;
  }
  .cancel-btn {
    display: inline-flex;
    align-items: center;
    height: 50px;
    padding: 0 28px;
    border-radius: var(--radius-xl);
    background: var(--cs-surface-gray);
    color: var(--cs-text-dark);
    text-decoration: none;
    font: var(--text-pc-body-14);
    transition: background 0.12s;
  }
  .cancel-btn:hover { background: var(--cs-purple-op10); }
  .submit-btn {
    height: 50px;
    padding: 0 36px;
    border: none;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.12s;
  }
  .submit-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .submit-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  /* ─── 옵션상품 섹션 ──────────────────────────────────────── */
  .option-search-row {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .option-search-input { flex: 1; }
  .btn-search {
    flex-shrink: 0;
    height: 44px;
    padding: 0 20px;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .btn-search:hover:not(:disabled) { background: rgba(59,47,138,0.06); }
  .btn-search:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 모달 */
  .option-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16,11,50,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .option-modal {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 24px 28px;
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .option-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .option-modal-title {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    margin: 0;
  }
  .option-modal-close {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    cursor: pointer;
    font: var(--text-pc-script-12);
    transition: background 0.12s;
  }
  .option-modal-close:hover { background: rgba(255,53,53,0.1); color: var(--cs-red-badge); }
  .option-modal-empty {
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    margin: 0;
    padding: 20px 0;
    text-align: center;
  }
  .option-result-list {
    list-style: none;
    padding: 0;
    margin: 0;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .option-result-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
  }
  .option-result-thumb {
    width: 56px;
    height: 42px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .option-result-thumb--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-lilac);
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
  }
  .option-result-info { flex: 1; min-width: 0; }
  .option-result-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0 0 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .option-result-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 2px;
  }
  .btn-detail-link {
    display: inline-flex;
    align-items: center;
    font: var(--text-pc-script-12);
    color: var(--cs-purple);
    text-decoration: none;
  }
  .btn-detail-link:hover { color: var(--cs-purple-hover); text-decoration: underline; }
  .btn-add-option {
    flex-shrink: 0;
    height: 36px;
    padding: 0 14px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-add-option:hover { background: var(--cs-purple-hover); }

  /* 일괄 적용 행 */
  .bulk-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 14px;
    background: rgba(59,47,138,0.04);
    border-radius: var(--cms-radius-sm);
  }
  .bulk-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    white-space: nowrap;
  }
  .cb-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    cursor: pointer;
    min-height: 44px;
  }
  .cb-input {
    accent-color: var(--cs-purple);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  .btn-bulk-apply {
    margin-left: auto;
    height: 36px;
    padding: 0 16px;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-bulk-apply:hover { background: rgba(59,47,138,0.08); }

  /* 선택된 옵션 카드 */
  .selected-option-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .selected-option-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--cs-white);
    border: 1px solid var(--cs-border);
    border-radius: var(--cms-radius-md);
  }
  .selected-option-thumb {
    width: 64px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .selected-option-thumb--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-surface-gray);
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
  }
  .selected-option-info { flex: 1; min-width: 0; }
  .selected-option-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0 0 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .selected-option-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 6px;
  }
  .selected-option-cbs {
    display: flex;
    gap: 14px;
  }
  .no-option-msg {
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    margin: 0;
    padding: 16px 0;
  }

  @media (max-width: 640px) {
    .form-section { padding: 20px 16px; }
    .price-grid { grid-template-columns: 1fr; }
    .price-grid-3 { grid-template-columns: 1fr; }
    .bulk-row { flex-wrap: wrap; }
  }
</style>
