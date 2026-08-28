<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { enhance, deserialize } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import FreeRentalItemSelector from './FreeRentalItemSelector.svelte'
  import CmsContentEditor from '$lib/components/cms/CmsContentEditor.svelte'
  import { resizeProductImage } from '$lib/utils/imageResize'
  import {
    BENEFIT_TYPES,
    BENEFIT_DEFS,
    MEMBERSHIP_GRADE_OPTIONS,
    SPEC_LABEL_PRESETS,
    defaultBenefitParams,
    type BenefitType,
  } from '$lib/utils/subscriptionBenefits'
  import type { ContentBlock } from '$lib/types/content-editor'
  import type {
    SubscriptionPlanRow,
    TierBenefitRow,
    FreeRentalItemRow,
    SubscriberCounts,
    SubscriberRow,
  } from '$lib/types/subscription'
  import type { ActionResult } from '@sveltejs/kit'

  interface Props {
    plan: SubscriptionPlanRow
    benefits: TierBenefitRow[]
    freeRentalItems: FreeRentalItemRow[]
    subscriberCounts: SubscriberCounts
    subscribers: SubscriberRow[]
    parentProducts: { id: string; name: string }[]
    categoryOptions: { value: string; label: string }[]
    onclose?: () => void
  }

  let { plan, benefits, freeRentalItems, subscriberCounts, subscribers, parentProducts, categoryOptions, onclose }: Props = $props()

  type TabKey = 'basic' | 'pricing' | 'specs' | 'content' | 'images' | 'benefits' | 'freeRentalItems' | 'subscribers'

  const savedFreeRentalBenefit = $derived(benefits.find((b) => b.benefit_type === 'FREE_RENTAL') ?? null)
  const freeRentalEnabled = $derived(savedFreeRentalBenefit?.is_enabled ?? false)

  const ALL_TABS: { key: TabKey; label: string }[] = [
    { key: 'basic', label: '기본정보' },
    { key: 'pricing', label: '가격정책' },
    { key: 'content', label: '상품설명' },
    { key: 'images', label: '이미지' },
    { key: 'specs', label: '상품 스펙' },
    { key: 'benefits', label: '혜택관리' },
    { key: 'freeRentalItems', label: '무료렌탈 대상장비' },
    { key: 'subscribers', label: '구독자현황' },
  ]

  const TABS = $derived(
    freeRentalEnabled ? ALL_TABS : ALL_TABS.filter((t) => t.key !== 'freeRentalItems')
  )

  let activeTab = $state<TabKey>('basic')
  let isSaving = $state(false)

  function switchTab(key: TabKey): void {
    activeTab = key
  }

  // ── 기본정보 ──────────────────────────────────────────────
  let localBasic = $state({
    name: plan.name,
    tagline: plan.tagline ?? '',
    membership_grade: plan.membership_grade ?? '',
    sort_order: plan.sort_order,
    is_popular: plan.is_popular,
  })

  const isDirtyBasic = $derived(
    localBasic.name !== plan.name ||
    localBasic.tagline !== (plan.tagline ?? '') ||
    localBasic.membership_grade !== (plan.membership_grade ?? '') ||
    localBasic.sort_order !== plan.sort_order ||
    localBasic.is_popular !== plan.is_popular
  )

  // ── 가격정책 ──────────────────────────────────────────────
  let localPricing = $state({ monthly_price: plan.monthly_price })
  const isDirtyPricing = $derived(localPricing.monthly_price !== plan.monthly_price)

  // ── 이미지 갤러리 ─────────────────────────────────────────
  let isImageUploading = $state(false)
  let imageUploadError = $state<string | null>(null)
  let imageFileInputEl = $state<HTMLInputElement | null>(null)

  // ── 상품설명 ──────────────────────────────────────────────
  let localContentBlocks = $state<ContentBlock[]>((plan.content_blocks ?? []).map((b) => ({ ...b })))
  let localContentKeywords = $state<string[]>([])

  const isDirtyContent = $derived(
    JSON.stringify(localContentBlocks) !== JSON.stringify(plan.content_blocks ?? [])
  )

  // ── 상품 스펙 ─────────────────────────────────────────────
  let localSpecs = $state<{ label: string; value: string }[]>(plan.features.map((f) => ({ ...f })))
  const isDirtySpecs = $derived(JSON.stringify(localSpecs) !== JSON.stringify(plan.features))

  function addSpecRow(preset?: string): void {
    localSpecs = [...localSpecs, { label: preset ?? '', value: '' }]
  }
  function removeSpecRow(index: number): void {
    localSpecs = localSpecs.filter((_, i) => i !== index)
  }

  // ── 혜택관리 ──────────────────────────────────────────────
  interface LocalBenefit { benefit_type: BenefitType; is_enabled: boolean; benefit_params: Record<string, number | string | boolean> }

  function buildLocalBenefits(): LocalBenefit[] {
    return BENEFIT_TYPES.map((type) => {
      const saved = benefits.find((b) => b.benefit_type === type)
      return {
        benefit_type: type,
        is_enabled: saved?.is_enabled ?? false,
        benefit_params: { ...defaultBenefitParams(type), ...(saved?.benefit_params ?? {}) },
      }
    })
  }

  let localBenefits = $state<LocalBenefit[]>(buildLocalBenefits())

  function savedBenefitsSnapshot(): LocalBenefit[] {
    return BENEFIT_TYPES.map((type) => {
      const saved = benefits.find((b) => b.benefit_type === type)
      return {
        benefit_type: type,
        is_enabled: saved?.is_enabled ?? false,
        benefit_params: { ...defaultBenefitParams(type), ...(saved?.benefit_params ?? {}) },
      }
    })
  }

  const isDirtyBenefits = $derived(JSON.stringify(localBenefits) !== JSON.stringify(savedBenefitsSnapshot()))

  function toggleBenefit(type: BenefitType): void {
    localBenefits = localBenefits.map((b) => b.benefit_type === type ? { ...b, is_enabled: !b.is_enabled } : b)
  }

  function updateBenefitParam(type: BenefitType, key: string, value: number | string | boolean): void {
    localBenefits = localBenefits.map((b) =>
      b.benefit_type === type ? { ...b, benefit_params: { ...b.benefit_params, [key]: value } } : b
    )
  }

  // ── 무료렌탈 대상장비 ──────────────────────────────────────
  let freeRentalSelectedIds = $state<string[]>(freeRentalItems.map((i) => i.product_id))

  // props 변경(저장 후 invalidateAll) 시 로컬 상태 재동기화
  $effect(() => {
    localBasic = {
      name: plan.name,
      tagline: plan.tagline ?? '',
      membership_grade: plan.membership_grade ?? '',
      sort_order: plan.sort_order,
      is_popular: plan.is_popular,
    }
    localPricing = { monthly_price: plan.monthly_price }
    localContentBlocks = (plan.content_blocks ?? []).map((b) => ({ ...b }))
    localContentKeywords = []
    imageUploadError = null
    localSpecs = plan.features.map((f) => ({ ...f }))
    localBenefits = buildLocalBenefits()
    freeRentalSelectedIds = freeRentalItems.map((i) => i.product_id)
  })

  function handleSectionSave() {
    isSaving = true
    return async ({ result }: { result: ActionResult }) => {
      isSaving = false
      if (result.type === 'success') {
        await invalidateAll()
        csToast.success('저장됐습니다.')
      } else if (result.type === 'failure') {
        csToast.error((result.data as { error?: string } | undefined)?.error ?? '저장에 실패했습니다.')
      }
    }
  }

  async function uploadImages(files: FileList | File[]): Promise<void> {
    isImageUploading = true
    imageUploadError = null
    for (const file of Array.from(files)) {
      try {
        const { large } = await resizeProductImage(file)
        const fd = new FormData()
        fd.append('plan_id', String(plan.id))
        fd.append('file', new File([large], 'image.webp', { type: 'image/webp' }))
        const res = await fetch('/api/cms/subscriptions/upload', { method: 'POST', body: fd })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          imageUploadError = (err as { message?: string }).message ?? '업로드 실패'
          csToast.error(imageUploadError ?? '업로드 실패')
          break
        }
      } catch (e) {
        imageUploadError = e instanceof Error ? e.message : '업로드 실패'
        csToast.error(imageUploadError ?? '업로드 실패')
        break
      }
    }
    isImageUploading = false
    await invalidateAll()
  }

  async function deleteImage(imageUrl: string): Promise<void> {
    if (!confirm('이미지를 삭제할까요?')) return
    const res = await fetch('/api/cms/subscriptions/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl, plan_id: plan.id }),
    })
    if (res.ok) {
      await invalidateAll()
      csToast.success('이미지가 삭제됐습니다.')
    } else {
      csToast.error('이미지 삭제에 실패했습니다.')
    }
  }

  // ── 이미지 탭 — 드래그&드롭 + 라이트박스 (ProductDetailPanel과 동일 UX) ──
  let isImageDragging = $state(false)
  let imageDragCounter = 0
  let lightboxUrl = $state<string | null>(null)

  function handleImageDragEnter(e: DragEvent): void {
    e.preventDefault()
    imageDragCounter++
    isImageDragging = true
  }
  function handleImageDragLeave(): void {
    imageDragCounter--
    if (imageDragCounter <= 0) { imageDragCounter = 0; isImageDragging = false }
  }
  function handleImageDragOver(e: DragEvent): void { e.preventDefault() }
  function handleImageDrop(e: DragEvent): void {
    e.preventDefault()
    imageDragCounter = 0
    isImageDragging = false
    const files = e.dataTransfer?.files
    if (files?.length) void uploadImages(files)
  }
  function openLightbox(url: string): void { lightboxUrl = url }
  function closeLightbox(): void { lightboxUrl = null }

  async function saveContent(): Promise<void> {
    isSaving = true
    const fd = new FormData()
    fd.set('plan_id', String(plan.id))
    fd.set('section_type', 'content')
    fd.set('content_blocks', JSON.stringify(localContentBlocks))
    const res = await fetch('?/updateSection', { method: 'POST', body: fd })
    isSaving = false
    if (res.ok) {
      await invalidateAll()
      csToast.success('저장됐습니다.')
    } else {
      csToast.error('저장에 실패했습니다.')
    }
  }

  const categoryLabel = $derived(
    plan.category ? (categoryOptions.find((c) => c.value === plan.category)?.label ?? plan.category) : null
  )

  async function retryProductCode(): Promise<void> {
    if (!plan.category) return
    isSaving = true
    const fd = new FormData()
    fd.set('plan_id', String(plan.id))
    fd.set('category', plan.category)
    const res = await fetch('?/retryProductCode', { method: 'POST', body: fd })
    isSaving = false
    // res.ok만으로는 실제 실패 사유를 알 수 없음 — SvelteKit fail()도 HTTP 200으로 내려오므로
    // deserialize로 ActionResult를 직접 해석해야 정확한 성공/실패 판정이 됨(ProductDetailPanel.svelte 패턴)
    const result = deserialize(await res.text()) as { type: string; data?: { error?: string } }
    if (result.type === 'success') {
      await invalidateAll()
      csToast.success('품번 체계가 설정됐습니다.')
    } else {
      csToast.error(result.data?.error ?? '품번 체계 설정에 실패했습니다.')
    }
  }

  let retryingSubscriberId = $state<number | null>(null)

  async function retrySubscriberCode(userSubscriptionId: number, planId: number): Promise<void> {
    retryingSubscriberId = userSubscriptionId
    const fd = new FormData()
    fd.set('user_subscription_id', String(userSubscriptionId))
    fd.set('plan_id', String(planId))
    const res = await fetch('?/retrySubscriberCode', { method: 'POST', body: fd })
    retryingSubscriberId = null
    const result = deserialize(await res.text()) as { type: string; data?: { error?: string } }
    if (result.type === 'success') {
      await invalidateAll()
      csToast.success('품번이 발급됐습니다.')
    } else {
      csToast.error(result.data?.error ?? '품번 발급에 실패했습니다.')
    }
  }

  async function saveFreeRentalItems(): Promise<void> {
    if (!savedFreeRentalBenefit) return
    isSaving = true
    const fd = new FormData()
    fd.set('plan_id', String(plan.id))
    fd.set('section_type', 'freeRentalItems')
    fd.set('tier_benefit_id', savedFreeRentalBenefit.id)
    fd.set('product_ids', JSON.stringify(freeRentalSelectedIds))
    const res = await fetch('?/updateSection', { method: 'POST', body: fd })
    isSaving = false
    if (res.ok) {
      await invalidateAll()
      csToast.success('저장됐습니다.')
    } else {
      csToast.error('저장에 실패했습니다.')
    }
  }
</script>

<div class="panel-wrap">
  <div class="detail-panel">
    <div class="summary-bar">
      <div class="summary-thumb-wrap">
        {#if (plan.image_urls ?? [])[0]}
          <img src={(plan.image_urls ?? [])[0]} alt={plan.name} class="summary-thumb" width="44" height="44" loading="lazy" />
        {/if}
      </div>
      <span class="summary-name">{plan.name}</span>
      {#if onclose}
        <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
      {/if}
    </div>

    {#if TABS.length > 1}
      <div class="tab-nav" role="tablist">
        {#each TABS as tab (tab.key)}
          <button type="button" class="tab-btn" class:active={activeTab === tab.key} role="tab" aria-selected={activeTab === tab.key} onclick={() => switchTab(tab.key)}>
            {tab.label}
          </button>
        {/each}
      </div>
    {/if}

    <div class="tab-content">
      {#if activeTab === 'basic'}
        <div class="section" role="tabpanel">
          <div class="section-header">
            <span class="section-title">기본정보</span>
            <button form="form-basic" type="submit" class="btn-save-inline" class:dirty={isDirtyBasic} disabled={!isDirtyBasic || isSaving}>
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
          <form id="form-basic" method="POST" action="?/updateSection" use:enhance={handleSectionSave} class="inline-form">
            <input type="hidden" name="plan_id" value={plan.id} />
            <input type="hidden" name="section_type" value="basic" />
            <div class="inline-row">
              <span class="vr-label">분류·품번</span>
              <div class="code-display">
                <span class="code-category">{categoryLabel ?? '미지정'}</span>
                {#if plan.code_series?.prefix}
                  <span class="code-value">SUB-{plan.code_series.prefix}-####</span>
                  <span class="code-hint">(구독자별 실제 품번은 구독 완료 시 발급)</span>
                {:else if plan.category}
                  <span class="code-missing">품번 체계 미설정</span>
                  <button type="button" class="code-retry-btn" disabled={isSaving} onclick={retryProductCode}>품번 체계 설정</button>
                {/if}
              </div>
            </div>
            <div class="inline-row">
              <label class="vr-label" for="sb-name">상품명 <span class="required">*</span></label>
              <input id="sb-name" class="il-input" type="text" name="name" bind:value={localBasic.name} required />
            </div>
            <div class="inline-row">
              <label class="vr-label" for="sb-tagline">서브타이틀</label>
              <input id="sb-tagline" class="il-input" type="text" name="tagline" bind:value={localBasic.tagline} placeholder="예: 완벽한 입문자의 선택" />
            </div>
            <div class="inline-row">
              <span class="vr-label">연동 등급</span>
              <div class="toggle-group">
                {#each MEMBERSHIP_GRADE_OPTIONS as opt (opt.value)}
                  <label class="radio-label">
                    <input type="radio" name="membership_grade" value={opt.value} checked={localBasic.membership_grade === opt.value} onchange={() => { localBasic.membership_grade = opt.value }} />
                    <span>{opt.label}</span>
                  </label>
                {/each}
              </div>
            </div>
            <div class="inline-row">
              <label class="vr-label" for="sb-order">정렬순서</label>
              <input id="sb-order" class="il-input il-input--sm" type="number" name="sort_order" bind:value={localBasic.sort_order} />
            </div>
            <div class="inline-row">
              <span class="vr-label">인기 배지</span>
              <label class="switch" title="켜면 /members 비교표에서 이 플랜에 '인기' 배지가 표시됩니다">
                <input type="checkbox" name="is_popular" value="true" checked={localBasic.is_popular} onchange={(e) => { localBasic.is_popular = (e.currentTarget as HTMLInputElement).checked }} />
                <span class="switch-track"></span>
              </label>
              <span class="vr-hint">/members 비교표 '인기' 배지 표시 (여러 플랜 동시 허용)</span>
            </div>
          </form>
        </div>
      {/if}

      {#if activeTab === 'pricing'}
        <div class="section" role="tabpanel">
          <div class="section-header">
            <span class="section-title">가격정책</span>
            <button form="form-pricing" type="submit" class="btn-save-inline" class:dirty={isDirtyPricing} disabled={!isDirtyPricing || isSaving}>
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
          <form id="form-pricing" method="POST" action="?/updateSection" use:enhance={handleSectionSave} class="inline-form">
            <input type="hidden" name="plan_id" value={plan.id} />
            <input type="hidden" name="section_type" value="pricing" />
            <div class="inline-row">
              <label class="vr-label" for="sb-price">월 가격 <span class="required">*</span></label>
              <div style="display:flex;align-items:center;gap:8px">
                <input type="hidden" name="monthly_price" value={localPricing.monthly_price} />
                <input id="sb-price" class="il-input il-input--sm" type="text" inputmode="numeric" placeholder="0"
                  value={localPricing.monthly_price ? localPricing.monthly_price.toLocaleString('ko-KR') : ''}
                  oninput={(e) => { const digits = (e.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, ''); localPricing.monthly_price = digits ? parseInt(digits, 10) : 0 }} />
                <span style="font:var(--text-pc-script-12);color:var(--cs-text-light)">원 / 월</span>
              </div>
            </div>
          </form>
        </div>
      {/if}

      {#if activeTab === 'content'}
        <div class="section" role="tabpanel">
          <div class="section-header">
            <span class="section-title">상품설명</span>
            <button
              type="button"
              class="btn-save-inline"
              class:dirty={isDirtyContent}
              disabled={!isDirtyContent || isSaving}
              onclick={saveContent}
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
          <CmsContentEditor bind:blocks={localContentBlocks} bind:keywords={localContentKeywords} />
        </div>
      {/if}

      {#if activeTab === 'images'}
        <div class="section" role="tabpanel">
          <div class="section-header">
            <span class="section-title">이미지 ({(plan.image_urls ?? []).length}장)</span>
            {#if isImageUploading}<span class="img-status uploading">업로드 중...</span>{/if}
          </div>
          <div
            class="drop-zone"
            class:drag-over={isImageDragging}
            class:uploading={isImageUploading}
            role="button"
            tabindex="0"
            aria-label="이미지 파일을 드래그하거나 클릭하여 업로드"
            ondragenter={handleImageDragEnter}
            ondragleave={handleImageDragLeave}
            ondragover={handleImageDragOver}
            ondrop={handleImageDrop}
            onclick={() => imageFileInputEl?.click()}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') imageFileInputEl?.click() }}
          >
            <input
              bind:this={imageFileInputEl}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
              multiple
              style="display:none"
              onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files; if (f?.length) void uploadImages(f) }}
            />
            <p class="dz-text">{isImageUploading ? '업로드 중...' : '이미지를 드래그하거나 클릭하여 업로드'}</p>
          </div>
          {#if imageUploadError}
            <p class="img-error" role="alert">{imageUploadError}</p>
          {/if}
          {#if (plan.image_urls ?? []).length > 0}
            <div class="img-grid">
              {#each plan.image_urls ?? [] as url, i (url)}
                <div class="img-item" class:img-item-first={i === 0}>
                  <button
                    type="button"
                    class="img-item-view"
                    onclick={() => openLightbox(url)}
                    aria-label={`이미지 ${i + 1} 확대 보기`}
                  >
                    <img src={url} alt="구독 상품 이미지 {i + 1}" class="img-thumb" loading="lazy" />
                    <span class="img-item-overlay">🔍 확대</span>
                  </button>
                  {#if i === 0}<span class="img-rep-badge">대표</span>{/if}
                  <button
                    type="button"
                    class="img-del-btn"
                    onclick={() => deleteImage(url)}
                    aria-label="이미지 삭제"
                  >✕</button>
                </div>
              {/each}
            </div>
          {:else}
            <p class="fri-empty">등록된 이미지가 없습니다. 이미지를 추가해주세요.</p>
          {/if}
        </div>
      {/if}

      {#if lightboxUrl}
        <div class="lightbox-overlay" role="dialog" aria-modal="true" aria-label="이미지 확대 보기" onclick={closeLightbox} onkeydown={(e) => { if (e.key === 'Escape') closeLightbox() }} tabindex="-1">
          <button type="button" class="lightbox-close" onclick={closeLightbox} aria-label="닫기">✕</button>
          <div class="lightbox-img-wrap" onclick={(e) => e.stopPropagation()} role="presentation">
            <img src={lightboxUrl} alt="확대 이미지" class="lightbox-img" />
          </div>
        </div>
      {/if}

      {#if activeTab === 'specs'}
        <div class="section" role="tabpanel">
          <div class="section-header">
            <span class="section-title">상품 스펙</span>
            <button form="form-specs" type="submit" class="btn-save-inline" class:dirty={isDirtySpecs} disabled={!isDirtySpecs || isSaving}>
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
          <form id="form-specs" method="POST" action="?/updateSection" use:enhance={handleSectionSave}>
            <input type="hidden" name="plan_id" value={plan.id} />
            <input type="hidden" name="section_type" value="specs" />
            <input type="hidden" name="features" value={JSON.stringify(localSpecs)} />
          </form>
          <div class="spec-list">
            {#each localSpecs as row, i (i)}
              <div class="spec-row">
                <input class="il-input" type="text" placeholder="라벨 (예: 무료 배송)" bind:value={row.label} />
                <input class="il-input" type="text" placeholder="값 (예: 월 2회)" bind:value={row.value} />
                <button type="button" class="spec-remove" onclick={() => removeSpecRow(i)} aria-label="스펙 행 삭제">✕</button>
              </div>
            {/each}
          </div>
          <div class="spec-actions">
            <button type="button" class="btn-add-spec" onclick={() => addSpecRow()}>+ 스펙 추가</button>
            {#each SPEC_LABEL_PRESETS.filter((p) => !localSpecs.some((s) => s.label === p)) as preset (preset)}
              <button type="button" class="spec-preset-chip" onclick={() => addSpecRow(preset)}>+ {preset}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if activeTab === 'benefits'}
        <div class="section" role="tabpanel">
          <div class="section-header">
            <span class="section-title">혜택관리</span>
            <button form="form-benefits" type="submit" class="btn-save-inline" class:dirty={isDirtyBenefits} disabled={!isDirtyBenefits || isSaving}>
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
          <form id="form-benefits" method="POST" action="?/updateSection" use:enhance={handleSectionSave}>
            <input type="hidden" name="plan_id" value={plan.id} />
            <input type="hidden" name="section_type" value="benefits" />
            <input type="hidden" name="benefits" value={JSON.stringify(localBenefits)} />
          </form>
          <div class="benefit-cards">
            {#each localBenefits as benefit (benefit.benefit_type)}
              {@const def = BENEFIT_DEFS[benefit.benefit_type]}
              <div class="benefit-card" class:enabled={benefit.is_enabled}>
                <div class="benefit-card-header">
                  <div>
                    <span class="benefit-card-title">{def.label}</span>
                    <p class="benefit-card-desc">{def.description}</p>
                  </div>
                  <label class="switch">
                    <input type="checkbox" checked={benefit.is_enabled} onchange={() => toggleBenefit(benefit.benefit_type)} />
                    <span class="switch-track"></span>
                  </label>
                </div>
                {#if benefit.is_enabled}
                  <div class="benefit-fields">
                    {#each def.fields as field (field.key)}
                      <div class="benefit-field-row">
                        <span class="benefit-field-label">{field.label}</span>
                        {#if field.type === 'number'}
                          <div class="benefit-field-input-wrap">
                            <input
                              type="text"
                              inputmode="numeric"
                              class="il-input il-input--sm"
                              value={(benefit.benefit_params[field.key] as number) ? (benefit.benefit_params[field.key] as number).toLocaleString('ko-KR') : ''}
                              oninput={(e) => {
                                const digits = (e.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, '')
                                updateBenefitParam(benefit.benefit_type, field.key, digits ? parseInt(digits, 10) : 0)
                              }}
                            />
                            {#if field.unit}<span class="benefit-field-unit">{field.unit}</span>{/if}
                          </div>
                        {:else if field.type === 'select'}
                          <div class="toggle-group">
                            {#each field.options ?? [] as opt (opt.value)}
                              <label class="radio-label">
                                <input type="radio" name="opt-{benefit.benefit_type}-{field.key}" value={opt.value}
                                  checked={benefit.benefit_params[field.key] === opt.value}
                                  onchange={() => updateBenefitParam(benefit.benefit_type, field.key, opt.value)} />
                                <span>{opt.label}</span>
                              </label>
                            {/each}
                          </div>
                        {:else if field.type === 'checkbox'}
                          <label class="radio-label">
                            <input type="checkbox" checked={benefit.benefit_params[field.key] as boolean}
                              onchange={(e) => updateBenefitParam(benefit.benefit_type, field.key, (e.currentTarget as HTMLInputElement).checked)} />
                            <span>사용</span>
                          </label>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if activeTab === 'freeRentalItems'}
        <div class="section" role="tabpanel">
          <div class="section-header">
            <span class="section-title">무료렌탈 대상장비</span>
            <button type="button" class="btn-save-inline dirty" disabled={isSaving} onclick={saveFreeRentalItems}>
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
          {#if !savedFreeRentalBenefit}
            <p class="fri-empty">먼저 '혜택관리' 탭에서 무료렌탈 혜택을 저장해주세요.</p>
          {:else}
            <FreeRentalItemSelector products={parentProducts} bind:selectedIds={freeRentalSelectedIds} />
          {/if}
        </div>
      {/if}

      {#if activeTab === 'subscribers'}
        <div class="section" role="tabpanel">
          <div class="section-header">
            <span class="section-title">구독자현황</span>
          </div>
          <div class="subscriber-kpi-row">
            <div class="subscriber-kpi">
              <span class="subscriber-kpi-value">{subscriberCounts.active}</span>
              <span class="subscriber-kpi-label">활성</span>
            </div>
            <div class="subscriber-kpi">
              <span class="subscriber-kpi-value">{subscriberCounts.cancelled}</span>
              <span class="subscriber-kpi-label">취소</span>
            </div>
            <div class="subscriber-kpi">
              <span class="subscriber-kpi-value">{subscriberCounts.expired}</span>
              <span class="subscriber-kpi-label">만료</span>
            </div>
          </div>

          {#if subscribers.length > 0}
            <div class="subscriber-list">
              {#each subscribers as sub (sub.id)}
                <div class="subscriber-row">
                  <span class="subscriber-code" class:pending={!sub.product_code}>
                    {sub.product_code ?? '품번 발급 대기'}
                  </span>
                  {#if !sub.product_code}
                    <button
                      type="button"
                      class="subscriber-retry-btn"
                      disabled={retryingSubscriberId === sub.id}
                      onclick={() => retrySubscriberCode(sub.id, plan.id)}
                    >
                      {retryingSubscriberId === sub.id ? '재시도 중...' : '재시도'}
                    </button>
                  {/if}
                  <a
                    class="subscriber-info-link"
                    href="/cms/customers?selected={sub.user_id}&tab=subscription"
                    target="_blank"
                    rel="noopener"
                  >
                    <span class="subscriber-email">{sub.email ?? sub.user_id}</span>
                    <span class="subscriber-status subscriber-status-{sub.status}">
                      {sub.status === 'active' ? '활성' : sub.status === 'cancelled' ? '취소' : '만료'}
                    </span>
                    <span class="subscriber-date">
                      {sub.started_at ? new Date(sub.started_at).toLocaleDateString('ko-KR') : '-'}
                    </span>
                  </a>
                </div>
              {/each}
            </div>
          {:else}
            <p class="fri-empty">아직 구독자가 없습니다.</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .panel-wrap { display: flex; flex-direction: column; gap: 8px; }
  .detail-panel {
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .summary-bar {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 26px; border-bottom: 1px solid var(--cs-surface-gray);
  }
  .summary-thumb-wrap {
    flex-shrink: 0; width: 72px; height: 72px;
    background: #E8E4F8; border-radius: var(--radius-sm); overflow: hidden;
  }
  .summary-thumb { width: 72px; height: 72px; object-fit: cover; display: block; }
  .summary-name { flex: 1; font: var(--text-pc-title-18); color: var(--cs-text); font-weight: 700; }

  /* ── 이미지 갤러리 ── */
  .img-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
  .img-item { position: relative; width: 100px; height: 100px; border-radius: var(--radius-sm); overflow: hidden; border: 1.5px solid var(--cs-lilac); }
  .img-item-first { border-color: var(--cs-purple); }
  .img-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
  .img-rep-badge {
    position: absolute; top: 4px; left: 4px; padding: 2px 6px; border-radius: var(--radius-sm);
    background: var(--cs-purple); color: var(--cs-white); font: var(--text-pc-descript-10); font-weight: 700;
  }
  .img-del-btn {
    position: absolute; top: 4px; right: 4px; width: 22px; height: 22px;
    border: none; border-radius: 50%; background: rgba(16,11,50,0.55); color: var(--cs-white);
    font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 0.12s;
  }
  .img-del-btn:hover { background: var(--cs-red-badge); }
  .img-error { font: var(--text-pc-script-12); color: var(--cs-red-badge); margin: 0; }
  .img-status { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

  /* 드롭존 (ProductDetailPanel과 동일 패턴) */
  .drop-zone {
    display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 10px;
    min-height: 48px; border: 2px dashed var(--cs-border); border-radius: var(--radius-md);
    background: var(--cs-surface-gray); cursor: pointer; padding: 10px 20px;
    transition: border-color 0.15s, background 0.15s; user-select: none;
  }
  .drop-zone:hover, .drop-zone:focus-visible {
    border-color: var(--cs-purple); background: rgba(59,47,138,0.04); outline: none;
  }
  .drop-zone.drag-over { border-color: var(--cs-purple); background: rgba(59,47,138,0.08); transform: scale(1.01); }
  .drop-zone.uploading { pointer-events: none; opacity: 0.6; }
  .dz-text { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0; }

  /* 이미지 확대(라이트박스) 트리거 */
  .img-item-view { display: block; width: 100%; height: 100%; border: none; padding: 0; cursor: zoom-in; background: transparent; position: relative; }
  .img-item-overlay {
    position: absolute; inset: 0; background: rgba(16,11,50,0.45); color: var(--cs-white);
    font: var(--text-pc-script-12); display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.15s; pointer-events: none;
  }
  .img-item-view:hover .img-item-overlay { opacity: 1; }

  /* ─── 라이트박스 ─────────────────────────────────── */
  .lightbox-overlay {
    position: fixed; inset: 0; z-index: 500; background: rgba(16,11,50,0.88);
    display: flex; align-items: center; justify-content: center; padding: 32px; cursor: zoom-out;
  }
  .lightbox-img-wrap { max-width: 90vw; max-height: 90vh; cursor: default; }
  .lightbox-img {
    max-width: 100%; max-height: 90vh; object-fit: contain; border-radius: var(--radius-lg);
    display: block; box-shadow: 0 8px 40px rgba(0,0,0,0.5);
  }
  .lightbox-close {
    position: fixed; top: 20px; right: 24px; width: 44px; height: 44px;
    border: 2px solid rgba(255,255,255,0.4); border-radius: 50%; background: rgba(16,11,50,0.65);
    color: var(--cs-white); font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s, border-color 0.12s; z-index: 501;
  }
  .lightbox-close:hover { background: var(--cs-red-badge); border-color: var(--cs-red-badge); }

  .close-btn {
    margin-left: auto; flex-shrink: 0;
    width: 28px; height: 28px; min-height: 28px; border: none; background: transparent; color: var(--cs-text-light);
    cursor: pointer; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center;
    font-size: 14px; transition: background 0.12s, color 0.12s;
  }
  .close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  .tab-nav {
    display: flex; gap: 2px; padding: 10px 16px 0;
    justify-content: center;
    border-bottom: 1px solid var(--cs-surface-gray);
    flex-shrink: 0; background: var(--cs-white);
  }
  .tab-btn {
    padding: 8px 16px; border: none; border-bottom: 2px solid transparent;
    background: transparent; color: var(--cs-text-mid);
    font: var(--text-pc-body-14); cursor: pointer; min-height: 40px;
    transition: color 0.12s, border-color 0.12s; margin-bottom: -1px;
  }
  .tab-btn:hover { color: var(--cs-text); }
  .tab-btn.active { color: var(--cs-purple); border-bottom-color: var(--cs-purple); font-weight: 700; }

  .tab-content { padding: 26px 26px 65px; }

  .section { display: flex; flex-direction: column; gap: 16px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; }
  .section-title { font: var(--text-pc-title-16); color: var(--cs-text); }

  .required { color: var(--cs-red-badge); }

  .btn-save-inline {
    padding: 5px 14px; border: 1.5px solid var(--cs-border, var(--cs-lilac)); border-radius: var(--radius-sm);
    background: transparent; color: var(--cs-text-light); font: var(--text-pc-script-12);
    cursor: not-allowed; min-height: 32px; transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .btn-save-inline.dirty { border-color: var(--cs-purple); background: var(--cs-purple); color: var(--cs-white); cursor: pointer; }
  .btn-save-inline.dirty:hover { opacity: 0.85; }

  .inline-form { display: flex; flex-direction: column; gap: 0; }
  .inline-row { display: flex; align-items: center; gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--cs-surface-gray); }
  .inline-row:last-child { border-bottom: none; }
  .inline-row-top { align-items: flex-start; padding-top: 10px; }

  .vr-label { flex: 0 0 110px; font: var(--text-pc-script-12); color: var(--cs-text-light); padding-top: 1px; }
  .vr-hint { font: var(--text-pc-descript-10); color: var(--cs-text-light); align-self: center; }

  .code-display { flex: 1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .code-category {
    padding: 4px 10px; border-radius: var(--radius-sm); background: var(--cs-purple-op10, rgba(59,47,138,0.1));
    color: var(--cs-purple); font: var(--text-pc-script-12); font-weight: 700;
  }
  .code-value { font: var(--text-pc-body-14); color: var(--cs-text); font-family: monospace; font-weight: 700; }
  .code-hint { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .code-missing { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .code-retry-btn {
    padding: 4px 12px; border: 1.5px solid var(--cs-purple); border-radius: var(--radius-sm);
    background: transparent; color: var(--cs-purple); font: var(--text-pc-script-12); cursor: pointer;
  }
  .code-retry-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .code-retry-btn:not(:disabled):hover { background: rgba(59, 47, 138, 0.08); }

  .il-input, .il-textarea {
    flex: 1; padding: 8px 12px; border: 1.5px solid var(--cs-lilac); border-radius: var(--radius-sm);
    font: var(--text-pc-body-14); color: var(--cs-text); background: var(--cs-white);
  }
  .il-input:focus, .il-textarea:focus { outline: none; border-color: var(--cs-purple); }
  .il-input--sm { flex: 0 0 120px; }
  .il-textarea { resize: vertical; font-family: inherit; }

  .toggle-group { display: flex; gap: 6px; flex-wrap: wrap; }
  .radio-label {
    display: flex; align-items: center; gap: 5px; padding: 6px 12px; border: 1.5px solid var(--cs-lilac);
    border-radius: var(--radius-xl, 30px); font: var(--text-pc-script-12); color: var(--cs-text); cursor: pointer;
  }
  .radio-label:has(input:checked) { background: var(--cs-purple); border-color: var(--cs-purple); color: var(--cs-white); }
  .radio-label input { accent-color: var(--cs-purple); }

  /* ── 상품 스펙 ── */
  .spec-list { display: flex; flex-direction: column; gap: 8px; }
  .spec-row { display: flex; align-items: center; gap: 8px; }
  .spec-remove {
    width: 28px; height: 28px; min-height: 28px; flex-shrink: 0; border: none; background: transparent; color: var(--cs-text-light);
    cursor: pointer; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center;
    transition: background 0.12s, color 0.12s;
  }
  .spec-remove:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .spec-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .btn-add-spec, .spec-preset-chip {
    padding: 6px 14px; border: 1.5px dashed var(--cs-purple); border-radius: var(--radius-sm);
    background: transparent; color: var(--cs-purple); font: var(--text-pc-script-12); cursor: pointer;
  }
  .btn-add-spec:hover, .spec-preset-chip:hover { background: rgba(59, 47, 138, 0.08); }

  /* ── 혜택관리 ── */
  .benefit-cards { display: flex; flex-direction: column; gap: 14px; }
  .benefit-card { border: 1.5px solid var(--cs-surface-gray); border-radius: var(--radius-md); padding: 16px 18px; transition: border-color 0.15s; }
  .benefit-card.enabled { border-color: var(--cs-purple); }
  .benefit-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .benefit-card-title { font: var(--text-pc-title-16); color: var(--cs-text); font-weight: 700; }
  .benefit-card-desc { margin: 4px 0 0; font: var(--text-pc-script-12); color: var(--cs-text-light); }

  .switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .switch-track {
    position: absolute; inset: 0; background: var(--cs-lilac); border-radius: 999px; cursor: pointer; transition: background 0.15s;
  }
  .switch-track::before {
    content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: var(--cs-white);
    border-radius: 50%; transition: transform 0.15s;
  }
  .switch input:checked + .switch-track { background: var(--cs-purple); }
  .switch input:checked + .switch-track::before { transform: translateX(18px); }

  .benefit-fields { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--cs-surface-gray); }
  .benefit-field-row { display: flex; align-items: center; gap: 16px; }
  .benefit-field-label { flex: 0 0 140px; font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .benefit-field-input-wrap { display: flex; align-items: center; gap: 6px; }
  .benefit-field-unit { font: var(--text-pc-script-12); color: var(--cs-text-light); }

  /* ── 무료렌탈 대상장비 ── */
  .fri-empty { font: var(--text-pc-script-12); color: var(--cs-text-light); }

  /* ── 구독자현황 ── */
  .subscriber-kpi-row { display: flex; gap: 12px; }
  .subscriber-kpi {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 20px; background: var(--cs-surface-gray); border-radius: var(--radius-md);
  }
  .subscriber-kpi-value { font: var(--text-pc-htitle-25); color: var(--cs-purple); font-weight: 900; }
  .subscriber-kpi-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

  .subscriber-list { display: flex; flex-direction: column; gap: 4px; margin-top: 16px; }
  .subscriber-row {
    display: flex; align-items: center; gap: 8px; padding: 10px 12px;
    border-bottom: 1px solid var(--cs-surface-gray); font: var(--text-pc-script-12);
    color: inherit; border-radius: var(--cms-radius-sm);
  }
  .subscriber-row:last-child { border-bottom: none; }
  .subscriber-info-link {
    display: flex; align-items: center; gap: 14px; flex: 1;
    text-decoration: none; color: inherit; cursor: pointer;
    transition: background 0.12s; border-radius: var(--cms-radius-sm); padding: 2px 4px;
  }
  .subscriber-info-link:hover { background: rgba(59,47,138,0.04); }
  .subscriber-code { flex: 0 0 130px; font-family: monospace; font-weight: 700; color: var(--cs-text); }
  .subscriber-code.pending { color: var(--cs-text-light); font-family: inherit; font-weight: 400; }
  .subscriber-retry-btn {
    flex: 0 0 auto; padding: 3px 8px; font: var(--text-pc-script-12); font-weight: 700;
    background: transparent; border: 1px solid var(--cs-purple); border-radius: var(--radius-full);
    color: var(--cs-purple); cursor: pointer; white-space: nowrap; transition: opacity 0.12s;
  }
  .subscriber-retry-btn:hover { opacity: 0.75; }
  .subscriber-retry-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .subscriber-email { flex: 1; color: var(--cs-text-mid); }
  .subscriber-status { flex: 0 0 44px; font-weight: 700; }
  .subscriber-status-active { color: var(--cs-purple); }
  .subscriber-status-cancelled, .subscriber-status-expired { color: var(--cs-text-light); }
  .subscriber-date { flex: 0 0 90px; color: var(--cs-text-light); text-align: right; }
</style>

