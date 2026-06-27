<script lang="ts">
  import { enhance } from '$app/forms'
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

    <!-- ③ 가격 정책 -->
    <section class="form-section">
      <h2 class="section-title">③ 가격 정책</h2>
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

    <!-- ④ 이미지 -->
    <section class="form-section">
      <h2 class="section-title">④ 이미지</h2>
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

    <!-- ⑤ 재고 안내 -->
    <section class="form-section info-section">
      <h2 class="section-title">⑤ 실물 재고 (Asset) 등록 안내</h2>
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
    font: var(--text-m-script-14);
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    transition: color 0.12s;
  }
  .back-link:hover { color: var(--cs-text); }
  .page-title {
    font: var(--text-m-title-21);
    color: var(--cs-text);
    margin: 0;
  }

  .error-banner {
    padding: 14px 20px;
    background: rgba(255,53,53,0.08);
    border: 1px solid var(--cs-red-badge);
    border-radius: var(--radius-md);
    color: var(--cs-red-badge);
    font: var(--text-m-script-14B);
  }

  /* 폼 섹션 */
  .product-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .form-section {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .section-title {
    font: var(--text-m-title-18B);
    color: var(--cs-text);
    margin: 0 0 4px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--cs-lilac);
  }
  .section-desc {
    font: var(--text-m-script-12);
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
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .required { color: var(--cs-red-badge); font-size: 12px; }
  .field-hint {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    font-weight: 400;
  }

  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-md);
    padding: 12px 16px;
    font: var(--text-m-script-14);
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
    font: var(--text-m-script-14);
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
    font: var(--text-m-script-12);
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
    font-size: 12px;
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
    font: var(--text-m-script-14);
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
    border-radius: var(--radius-lg);
    border-left: 3px solid var(--cs-purple);
  }
  .info-text {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
    margin: 0;
  }
  .info-subtext {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    margin: 0;
  }
  .asset-code-preview {
    display: inline-block;
    padding: 2px 8px;
    background: var(--cs-dark);
    color: var(--cs-orange);
    border-radius: var(--radius-xs);
    font-family: monospace;
    font-size: 13px;
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
    font: var(--text-m-script-14B);
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
    font: var(--text-m-script-14B);
    cursor: pointer;
    transition: background 0.12s;
  }
  .submit-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .submit-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  @media (max-width: 640px) {
    .form-section { padding: 20px 16px; }
    .price-grid { grid-template-columns: 1fr; }
    .price-grid-3 { grid-template-columns: 1fr; }
  }
</style>
