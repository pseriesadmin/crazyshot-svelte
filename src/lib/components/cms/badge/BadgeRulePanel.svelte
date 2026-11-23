<script lang="ts">
  // 배지 노출 등록·수정 패널 — 템플릿(여러 개 선택) + 쿠폰 + 대상(상품/카테고리) + 노출기간. 부모에서 {#key} 로 재마운트한다.
  import { csToast } from '$lib/utils/toast'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import BadgeChip from './BadgeChip.svelte'
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'
  import CouponPicker from './CouponPicker.svelte'
  import { postBadgeAction } from './badgeApi'
  import { isoToKstDate, kstDateToIso } from '$lib/utils/badgeColor'
  import { formatBadgeNo } from '$lib/utils/badgeNo'
  import type { BadgeCouponOption, BadgeProductName, BadgeRule, BadgeTemplate, CustomerBadge } from '$lib/types/badge'

  interface Props {
    rule: BadgeRule | null
    templates: BadgeTemplate[]
    coupons: BadgeCouponOption[]
    /** 기존 대상 상품의 표시 이름 */
    productNames: BadgeProductName[]
    /** 미리보기 썸네일에 무작위로 깔 실제 상품 이미지 후보 */
    sampleImages?: string[]
    onclose: () => void
    /** 저장 성공 시 저장된 항목 id 와 함께 호출(패널은 열어 둔다) — id 없이 호출하면 삭제 등으로 패널을 닫는 경우 */
    onsaved: (savedId?: string) => void
  }

  let { rule, templates, coupons, productNames, sampleImages = [], onclose, onsaved }: Props = $props()

  // 마운트 시 1회 초기화 — 부모 {#key} 로 항목이 바뀌면 재마운트(core-rules: $state(prop) 금지 패턴 1)
  let name = $state(rule?.name ?? '')
  // 선택한 배지타입(순서 = 고객 화면 표시 순서, 개수 제한 없음). 옛 데이터는 첫 배지타입 한 개로 시작한다.
  let templateIds = $state<string[]>([...(rule?.template_ids?.length ? rule.template_ids : rule?.template_id ? [rule.template_id] : [])])
  let couponId = $state<string | null>(rule?.coupon_id ?? null)
  let validFrom = $state(isoToKstDate(rule?.valid_from ?? null))
  let validUntil = $state(isoToKstDate(rule?.valid_until ?? null))
  let products = $state<BadgeProductName[]>(
    (rule?.product_ids ?? []).map((id) => ({ id, name: productNames.find((p) => p.id === id)?.name ?? '삭제된 상품' }))
  )
  let categories = $state<string[]>([...(rule?.categories ?? [])])
  let saving = $state(false)

  const isNew = rule === null
  const signature = $derived(
    JSON.stringify([name.trim(), templateIds, couponId, validFrom, validUntil, products.map((p) => p.id).sort(), [...categories].sort()])
  )
  const initialSignature = JSON.stringify([
    (rule?.name ?? '').trim(),
    rule?.template_ids?.length ? rule.template_ids : rule?.template_id ? [rule.template_id] : [],
    rule?.coupon_id ?? null,
    isoToKstDate(rule?.valid_from ?? null),
    isoToKstDate(rule?.valid_until ?? null),
    [...(rule?.product_ids ?? [])].sort(),
    [...(rule?.categories ?? [])].sort(),
  ])
  const isDirty = $derived(
    isNew ? name.trim() !== '' && templateIds.length > 0 && (products.length > 0 || categories.length > 0) : signature !== initialSignature
  )

  function toggleTemplate(id: string) {
    templateIds = templateIds.includes(id) ? templateIds.filter((x) => x !== id) : [...templateIds, id]
  }

  // 고객 상품 썸네일에 적용된 모습 미리보기 — 선택한 배지를 고객 화면과 같은 규칙(이미지형 좌상단·바형 하단 중앙)으로 그린다
  // 패널을 열 때마다 실제 상품 이미지 중 하나를 무작위로 깐다(마운트 시 1회 — 선택을 바꿔도 사진은 그대로). 후보가 없으면 빈 이미지(회색 배경).
  const PREVIEW_IMG =
    (sampleImages.length > 0 ? sampleImages[Math.floor(Math.random() * sampleImages.length)] : null) ??
    'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
  const previewBadges = $derived(
    templateIds
      .map((id) => templates.find((t) => t.id === id))
      .filter((t): t is BadgeTemplate => t !== undefined && t.is_active)
      .map((t): CustomerBadge => ({
        product_id: 'preview', badge_id: 'preview', template_id: t.id, priority: 0,
        kind: t.kind, svg_url: t.svg_url, text: t.text, bg_color: t.bg_color, text_color: t.text_color,
      }))
  )

  // ── 상품 검색(브라우저 RPC 직접 호출 금지 → 서버 API)
  let productOptions = $state<{ id: string; label: string; meta?: string[] }[]>([])
  let productSel = $state<string | null>(null)
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  function onProductInput(q: string) {
    if (searchTimer) clearTimeout(searchTimer)
    const term = q.trim()
    if (term.length < 1) {
      productOptions = []
      return
    }
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cms/products/search-suggestions?q=${encodeURIComponent(term)}&limit=20`)
        if (!res.ok) return
        const rows = (await res.json()) as Array<{ id: string; name: string; brand: string | null; category: string | null }>
        productOptions = rows.map((r) => ({ id: r.id, label: r.name, meta: [r.brand, r.category].filter((v): v is string => !!v) }))
      } catch {
        productOptions = []
      }
    }, 250)
  }

  function addProduct(opt: { id: string; label: string }) {
    productSel = null
    productOptions = []   // 선택 직후 이전 검색 목록이 다시 열려 아래 입력칸을 가리지 않도록 비운다
    if (products.some((p) => p.id === opt.id)) return
    if (products.length >= 500) return csToast.error('상품은 최대 500개까지 선택할 수 있어요')
    products = [...products, { id: opt.id, name: opt.label }]
  }

  // ── 카테고리
  let categoryOptions = $state<{ id: string; label: string }[]>([])
  let categorySel = $state<string | null>(null)

  $effect(() => {
    let alive = true
    fetch('/api/cms/products/category-options')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { categories?: { value: string; label: string }[] } | null) => {
        if (alive && body?.categories) categoryOptions = body.categories.map((c) => ({ id: c.value, label: c.label }))
      })
      .catch(() => {})
    return () => { alive = false }
  })

  function addCategory(opt: { id: string }) {
    categorySel = null
    if (categories.includes(opt.id)) return
    if (categories.length >= 50) return csToast.error('카테고리는 최대 50개까지 선택할 수 있어요')
    categories = [...categories, opt.id]
  }

  function labelOfCategory(v: string): string {
    return categoryOptions.find((c) => c.id === v)?.label ?? v
  }

  async function save() {
    if (!isDirty || saving) return
    if (name.trim() === '') return csToast.error('명칭을 입력해 주세요')
    if (templateIds.length === 0) return csToast.error('배지를 1개 이상 선택해 주세요')
    if (products.length + categories.length === 0) return csToast.error('상품 또는 카테고리를 1개 이상 선택해 주세요')
    const from = kstDateToIso(validFrom, 'start')
    const until = kstDateToIso(validUntil, 'end')
    if (from && until && until < from) return csToast.error('종료일이 시작일보다 빠를 수 없어요')
    saving = true
    const r = await postBadgeAction('saveProductBadge', {
      id: rule?.id ?? '',
      name: name.trim(),
      template_ids: templateIds,
      coupon_id: couponId ?? '',
      valid_from: from ?? '',
      valid_until: until ?? '',
      is_active: String(rule?.is_active ?? true),
      product_ids: products.map((p) => p.id),
      categories,
    })
    saving = false
    if (!r.ok) return csToast.error(r.error ?? '저장에 실패했어요')
    csToast.success('저장되었습니다.')
    onsaved(r.id ?? rule?.id)
  }
</script>

<div class="detail-panel">
  <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <div class="title-group">
          <span class="section-title">{rule ? '배지목록 등록정보' : '새 배지 노출'}</span>
          {#if rule?.badge_no !== undefined}<span class="panel-no" aria-label="배지 목록 품번 {formatBadgeNo(rule.badge_no)}">{formatBadgeNo(rule.badge_no)}</span>{/if}
        </div>
        <div class="head-actions">
          <button type="button" class="btn-save-inline" class:dirty={isDirty} disabled={!isDirty || saving} onclick={save}>{saving ? '저장 중...' : '저장'}</button>
          <button type="button" class="close-btn" aria-label="패널 닫기" onclick={onclose}>✕</button>
        </div>
      </div>

      <div class="inline-form">
        <div class="inline-row">
          <label class="vr-label" for="badge-name">목록이름</label>
          <input id="badge-name" class="il-input" maxlength="40" bind:value={name} autocomplete="off" />
        </div>

        <div class="inline-row inline-row-top">
          <span class="vr-label">배지</span>
          <div class="row-value badge-row">
            <div class="tpl-grid">
              {#each templates.filter((t) => t.is_active) as t (t.id)}
                <button type="button" class="tpl" class:active={templateIds.includes(t.id)} aria-pressed={templateIds.includes(t.id)} onclick={() => toggleTemplate(t.id)}>
                  <BadgeChip kind={t.kind} svg_url={t.svg_url} text={t.text} bg_color={t.bg_color} text_color={t.text_color} size={26} />
                </button>
              {/each}
            </div>
            <div class="badge-preview" aria-label="고객 상품 썸네일 적용 미리보기">
              <ProductDPCard variant="thumb" name="" imageUrl={PREVIEW_IMG} badges={previewBadges} badgeSize={22} />
            </div>
          </div>
        </div>

        <div class="inline-row">
          <span class="vr-label">쿠폰</span>
          <div class="row-value">
            <CouponPicker options={coupons} value={couponId} onchange={(id) => (couponId = id)} />
          </div>
        </div>

        <div class="inline-row inline-row-top">
          <span class="vr-label">상품</span>
          <div class="row-value">
            <SuggestPicker
              id="badge-product"
              bind:selectedId={productSel}
              options={productOptions}
              placeholder="상품 검색"
              listLabel="상품"
              variant="generic"
              minChars={1}
              pageSize={10}
              noFilter
              clearOnSelect
              oninput={onProductInput}
              onselect={addProduct}
            >
              {#snippet field(c)}
                <input type="text" class="il-input" id={c.id} placeholder={c.placeholder}
                  value={c.value} oninput={c.oninput} onkeydown={c.onkeydown}
                  onfocus={c.onfocus} onblur={c.onblur}
                  aria-autocomplete={c.ariaAutocomplete} aria-expanded={c.ariaExpanded}
                  aria-controls={c.ariaControls} autocomplete="off" />
              {/snippet}
            </SuggestPicker>
            {#if products.length > 0}
              <div class="chips">
                {#each products as p (p.id)}
                  <span class="chip">{p.name}<button type="button" class="chip-x" aria-label="{p.name} 제거" onclick={() => (products = products.filter((x) => x.id !== p.id))}>✕</button></span>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="inline-row inline-row-top">
          <span class="vr-label">카테고리</span>
          <div class="row-value">
            <SuggestPicker
              id="badge-category"
              bind:selectedId={categorySel}
              options={categoryOptions}
              placeholder="카테고리 선택"
              listLabel="카테고리"
              variant="category"
              minChars={0}
              pageSize={10}
              clearOnSelect
              onselect={addCategory}
            >
              {#snippet field(c)}
                <input type="text" class="il-input" id={c.id} placeholder={c.placeholder}
                  value={c.value} oninput={c.oninput} onkeydown={c.onkeydown}
                  onfocus={c.onfocus} onblur={c.onblur}
                  aria-autocomplete={c.ariaAutocomplete} aria-expanded={c.ariaExpanded}
                  aria-controls={c.ariaControls} autocomplete="off" />
              {/snippet}
            </SuggestPicker>
            {#if categories.length > 0}
              <div class="chips">
                {#each categories as c (c)}
                  <span class="chip">{labelOfCategory(c)}<button type="button" class="chip-x" aria-label="{labelOfCategory(c)} 제거" onclick={() => (categories = categories.filter((x) => x !== c))}>✕</button></span>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="inline-row">
          <span class="vr-label">노출 기간</span>
          <div class="row-value date-row">
            <CmsDatePicker bind:value={validFrom} placeholder="시작일" disablePast={false} />
            <CmsDatePicker bind:value={validUntil} placeholder="종료일" disablePast={false} minDate={validFrom} />
          </div>
        </div>
      </div>

      {#if rule}
        <div class="panel-actions">
          <CmsDeleteButton action="?/deleteProductBadge" id={rule.id} onsuccess={() => onsaved()} />
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .head-actions { display: flex; align-items: center; gap: 8px; }
  /* 배정된 품번 — 제목 오른쪽에 여백을 두고 단순 텍스트로 표시 */
  .title-group { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  .panel-no { flex-shrink: 0; font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  /* 패널 닫기 close-red (cms-uiux.md §0-10-A-1) */
  .close-btn {
    flex-shrink: 0; width: 28px; height: 28px; min-height: 28px; display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer; transition: background 0.12s, color 0.12s;
  }
  .close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  /* 상세 패널 본문(ProductDetailPanel .detail-panel / .tab-content / .section 과 동일) */
  /* flex-shrink: 0 — 바깥 .detail-pane(max-height + overflow-y: auto)이 스크롤하도록, 내용이 길어도 패널이 줄어들어 잘리지 않게 한다 */
  .detail-panel { display: flex; flex-direction: column; flex-shrink: 0; background: var(--cs-white); border-radius: var(--cms-radius-lg); overflow: hidden; }
  .tab-content { padding: 26px 26px 65px; }
  .section { display: flex; flex-direction: column; gap: 16px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: var(--cs-surface-gray); border-radius: var(--radius-lg); }
  .section-title { font: var(--text-pc-title-16); color: var(--cs-text); }

  /* 섹션 인라인 저장 버튼 btn-save-inline (cms-uiux.md §0-10-D, ProductDetailPanel 값) */
  .btn-save-inline {
    padding: 5px 14px; border: 1.5px solid var(--cs-border); border-radius: var(--radius-sm);
    background: transparent; color: var(--cs-text-light); font: var(--text-pc-script-12);
    cursor: not-allowed; min-height: 32px; transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .btn-save-inline.dirty { border-color: var(--cs-purple); background: var(--cs-purple); color: var(--cs-white); cursor: pointer; }
  .btn-save-inline.dirty:hover { background: var(--cs-purple-hover); border-color: var(--cs-purple-hover); }

  /* 인라인 편집 폼 — 라벨(왼쪽) + 값(오른쪽) 행 */
  .inline-form { display: flex; flex-direction: column; gap: 0; }
  .inline-row { display: flex; align-items: center; gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--cs-surface-gray); }
  .inline-row:last-child { border-bottom: none; }
  .inline-row-top { align-items: flex-start; padding-top: 10px; }
  .vr-label { flex: 0 0 90px; font: var(--text-pc-script-12); color: var(--cs-text-light); padding-top: 1px; }
  .row-value { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .il-input {
    flex: 1; width: 100%; background: transparent; border: none; border-radius: var(--cms-radius-sm);
    padding: 3px 8px; font: var(--text-pc-body-14); color: var(--cs-text);
    transition: background 0.12s, outline 0.12s; min-height: 32px;
  }
  .il-input::placeholder { color: var(--cs-text-placeholder); }
  .il-input:hover { background: rgba(59,47,138,0.04); }
  .il-input:focus { background: var(--cs-surface-gray); outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }
  .panel-actions { display: flex; justify-content: flex-end; padding-top: 16px; }

  /* 배지 행 — 왼쪽 선택 목록 + 오른쪽 고객 썸네일 적용 미리보기 */
  .badge-row { flex-direction: row; flex-wrap: wrap; align-items: flex-start; gap: 16px; --pc-thumb-size: 174px; }
  /* 배지가 많아지면 오른쪽 미리보기 높이를 넘지 않고 이 영역 안에서 세로 스크롤 */
  .tpl-grid { flex: 1 1 240px; min-width: 0; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 8px; max-height: var(--pc-thumb-size); overflow-y: auto; }
  /* 미선택은 배경 없음, 선택(여러 개 가능)만 퍼플 면, 호버는 배경색 변경만(cms-uiux.md §0-10 상태 표현 원칙) */
  .tpl {
    display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 14px;
    border: none; border-radius: var(--cms-radius-sm); background: transparent; cursor: pointer; transition: background 0.15s;
  }
  .tpl:hover:not(.active) { background: var(--cs-surface-gray); }
  .tpl.active { background: var(--cs-purple); }
  .badge-preview { flex: 0 0 auto; }
  /* 흰·연보라 배지도 보이도록 사진 자리를 중간 톤 배경으로 둔다 */
  .badge-preview :global(.pc-img-wrap) { background: var(--cs-text-light); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 4px 4px 4px 12px;
    border-radius: var(--cms-radius-sm); background: var(--cs-lilac); color: var(--cs-text); font: var(--text-pc-script-12);
  }
  .chip-x {
    width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm); color: var(--cs-text-light);
    font-size: 12px; cursor: pointer; transition: background 0.12s, color 0.12s;
  }
  .chip-x:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .date-row { flex-direction: row; gap: 8px; }
</style>
