<script lang="ts">
  import { enhance, deserialize } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import FreeRentalItemSelector from '$lib/components/cms/subscription/FreeRentalItemSelector.svelte'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import { csToast } from '$lib/utils/toast'
  import {
    BENEFIT_TYPES,
    BENEFIT_DEFS,
    MEMBERSHIP_GRADE_OPTIONS,
    SPEC_LABEL_PRESETS,
    defaultBenefitParams,
    type BenefitType,
  } from '$lib/utils/subscriptionBenefits'
  import { sortByTier } from '$lib/utils/comboCategoryCode'
  import type { PageData, ActionData } from './$types'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import type { MappingGroupSimple, MappingItemSimple, TaxonomyCodeSimple } from './+page.server'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  const POLICY_ITEM_MAX_LENGTH = 200
  const POLICY_ITEM_MAX_COUNT = 20

  let policyItems = $state(data.policyItems)
  let newPolicyContent = $state('')
  let editingPolicyId = $state<string | null>(null)
  let editingPolicyContent = $state('')
  let isPolicySaving = $state(false)

  // 서버 재조회(add/edit/delete 후 invalidateAll) 시 로컬 상태 재동기화
  $effect(() => {
    policyItems = data.policyItems
  })

  async function submitPolicyAction(action: string, fields: Record<string, string>): Promise<boolean> {
    isPolicySaving = true
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    const res = await fetch(`?/${action}`, { method: 'POST', body: fd })
    const result = deserialize(await res.text())
    isPolicySaving = false

    if (result.type === 'success') {
      await invalidateAll()
      return true
    }
    if (result.type === 'failure') {
      csToast.error((result.data as { error?: string } | undefined)?.error ?? '처리에 실패했습니다.')
    } else {
      csToast.error('처리에 실패했습니다.')
    }
    return false
  }

  async function addPolicyItem(): Promise<void> {
    const content = newPolicyContent.trim()
    if (!content) return
    const ok = await submitPolicyAction('addPolicyItem', { content })
    if (ok) { newPolicyContent = ''; csToast.success('정책항목이 추가됐습니다.') }
  }

  function startEditPolicy(id: string, content: string): void {
    editingPolicyId = id
    editingPolicyContent = content
  }
  function cancelEditPolicy(): void {
    editingPolicyId = null
    editingPolicyContent = ''
  }
  async function saveEditPolicy(id: string): Promise<void> {
    const content = editingPolicyContent.trim()
    if (!content) return
    const ok = await submitPolicyAction('updatePolicyItem', { id, content })
    if (ok) { cancelEditPolicy(); csToast.success('정책항목이 수정됐습니다.') }
  }
  async function removePolicyItem(id: string): Promise<void> {
    const ok = await submitPolicyAction('deletePolicyItem', { id })
    if (ok) csToast.success('정책항목이 삭제됐습니다.')
  }

  async function persistPolicyOrder(): Promise<void> {
    const orderedIds = policyItems.map((item) => item.id)
    await submitPolicyAction('reorderPolicyItems', { ordered_ids: JSON.stringify(orderedIds) })
  }

  // ─── 분류(조합그룹) + 코드 조합(콤보) — products/new와 동일 패턴 ─────────────
  let category = $state('')
  let selectedGroupId = $state<string | null>(null)
  let selectedComboRowId = $state<string | null>(null)
  let lastConfirmedGroupId = $state<string | null>(null)

  const groupPickerOptions = $derived<SuggestPickerOption[]>(
    (data.mappingGroups as MappingGroupSimple[]).map((mg) => ({ id: mg.id, label: mg.name }))
  )

  function onGroupChange(): void {
    selectedComboRowId = null
    category = ''
  }

  function onGroupPickerSelect(opt: SuggestPickerOption, _previousId: string | null): void {
    // ⚠️ SuggestPicker의 previousId는 검색창 재입력 중(정확히 일치하지 않는 입력) 내부적으로
    // selectedId를 조용히 null로 만들었다가 재선택 시 넘어오므로 신뢰 불가 — products/new와
    // 동일하게 이 화면이 직접 확정한 lastConfirmedGroupId와 비교해 진짜 그룹 변경 시에만 리셋한다.
    if (opt.id !== lastConfirmedGroupId) onGroupChange()
    selectedGroupId = opt.id
    lastConfirmedGroupId = opt.id
    const matched = (data.mappingGroups as MappingGroupSimple[]).find((mg) => mg.id === opt.id)
    category = matched?.default_category ?? ''
  }

  function onGroupPickerInput(val: string): void {
    // 입력창을 완전히 비우면(분류 선택 취소) 코드 조합 영역·category·combo 선택값도 함께 초기화
    if (!val.trim() && selectedGroupId) {
      selectedGroupId = null
      lastConfirmedGroupId = null
      onGroupChange()
    }
  }

  interface ComboRow { combo_row_id: string; codes: TaxonomyCodeSimple[] }

  const combosForGroup = $derived<ComboRow[]>(
    selectedGroupId
      ? (() => {
          const items = (data.mappingItems as MappingItemSimple[]).filter((i) => i.group_id === selectedGroupId)
          const rowIds = [...new Set(items.map((i) => i.combo_row_id))]
          return rowIds.map((rid) => {
            const codes = sortByTier(
              items
                .filter((i) => i.combo_row_id === rid)
                .map((i) => (data.taxonomyCodes as TaxonomyCodeSimple[]).find((tc) => tc.id === i.taxonomy_code_id))
                .filter((tc): tc is TaxonomyCodeSimple => tc !== undefined)
            )
            return { combo_row_id: rid, codes }
          })
        })()
      : []
  )

  function selectCombo(combo: ComboRow): void {
    selectedComboRowId = combo.combo_row_id
  }

  let name = $state('')
  let tagline = $state('')
  let monthlyPrice = $state(0)
  let membershipGrade = $state('')
  let sortOrder = $state(0)
  let isPopular = $state(false)

  let specs = $state<{ label: string; value: string }[]>([])

  interface LocalBenefit { benefit_type: BenefitType; is_enabled: boolean; benefit_params: Record<string, number | string | boolean> }
  let benefits = $state<LocalBenefit[]>(
    BENEFIT_TYPES.map((type) => ({ benefit_type: type, is_enabled: false, benefit_params: defaultBenefitParams(type) }))
  )

  const freeRentalEnabled = $derived(benefits.find((b) => b.benefit_type === 'FREE_RENTAL')?.is_enabled ?? false)
  let freeRentalProductIds = $state<string[]>([])

  function addSpecRow(preset?: string): void {
    specs = [...specs, { label: preset ?? '', value: '' }]
  }
  function removeSpecRow(index: number): void {
    specs = specs.filter((_, i) => i !== index)
  }

  function toggleBenefit(type: BenefitType): void {
    benefits = benefits.map((b) => b.benefit_type === type ? { ...b, is_enabled: !b.is_enabled } : b)
  }
  function updateBenefitParam(type: BenefitType, key: string, value: number | string | boolean): void {
    benefits = benefits.map((b) => b.benefit_type === type ? { ...b, benefit_params: { ...b.benefit_params, [key]: value } } : b)
  }

  let isLoading = $state(false)
</script>

<svelte:head>
  <title>구독등록 — CMS</title>
</svelte:head>

<div class="form-wrap">
  <h1 class="page-title">구독등록</h1>

  {#if form?.error}
    <p class="form-error">{form.error}</p>
  {/if}

  <form
    method="POST"
    action="?/create"
    class="sub-form"
    use:enhance={() => {
      isLoading = true
      return async ({ update }) => { await update(); isLoading = false }
    }}
  >
    <input type="hidden" name="features" value={JSON.stringify(specs)} />
    <input type="hidden" name="benefits" value={JSON.stringify(benefits)} />
    <input type="hidden" name="free_rental_product_ids" value={JSON.stringify(freeRentalProductIds)} />

    <!-- ① 기본정보 -->
    <section class="form-section">
      <h2 class="section-title">① 기본정보</h2>

      <div class="field-row">
        <label class="field-label" for="cat-picker">분류(카테고리) <span class="required">*</span></label>
        <SuggestPicker
          id="cat-picker"
          bind:selectedId={selectedGroupId}
          options={groupPickerOptions}
          placeholder="분류선택 — 카테고리 검색 또는 선택..."
          listLabel="분류 제안"
          variant="category"
          oninput={onGroupPickerInput}
          onselect={onGroupPickerSelect}
        >
          {#snippet field(c)}
            <input
              type="text"
              class="f-input"
              id={c.id}
              placeholder={c.placeholder}
              required={c.required}
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
        {#if category}<input type="hidden" name="category" value={category} />{/if}
        {#if selectedComboRowId}<input type="hidden" name="combo_row_id" value={selectedComboRowId} />{/if}
        <p class="field-guide">
          분류 선택 후 아래 코드 조합을 고르면 그 조합의 분류코드가 품번 구조에 반영됩니다. 등록 시에는
          품번 구조만 저장되며, 실제 품번은 고객이 구독을 완료하는 시점에 구독자별로 발급됩니다.
        </p>
      </div>

      {#if selectedGroupId}
        <div class="field-row field-row-combo">
          <div class="field-label">코드 조합</div>
          {#if combosForGroup.length > 0}
            <div class="combo-rows">
              {#each combosForGroup as combo (combo.combo_row_id)}
                <button
                  type="button"
                  class="combo-row-btn"
                  class:combo-row-selected={selectedComboRowId === combo.combo_row_id}
                  onclick={() => selectCombo(combo)}
                >
                  <span class="combo-chips">
                    {#each combo.codes as tc, i (tc.id)}
                      {#if i > 0}<span class="combo-sep">·</span>{/if}
                      <span class="combo-chip">{tc.code}</span>
                    {/each}
                  </span>
                </button>
              {/each}
            </div>
          {:else}
            <p class="combo-empty">이 그룹에 등록된 조합이 없습니다 — 카테고리 값만으로 품번 구조가 계산됩니다.</p>
          {/if}
        </div>
      {/if}

      <div class="field-row">
        <label class="field-label" for="name">상품명 <span class="required">*</span></label>
        <input id="name" class="f-input" type="text" name="name" bind:value={name} required />
      </div>
      <div class="field-row">
        <label class="field-label" for="tagline">서브타이틀</label>
        <input id="tagline" class="f-input" type="text" name="tagline" bind:value={tagline} placeholder="예: 완벽한 입문자의 선택" />
      </div>
      <div class="field-row">
        <label class="field-label" for="monthly_price">월 가격</label>
        <input type="hidden" name="monthly_price" value={monthlyPrice} />
        <input id="monthly_price" class="f-input" type="text" inputmode="numeric" placeholder="0"
          value={monthlyPrice ? monthlyPrice.toLocaleString('ko-KR') : ''}
          oninput={(e) => { const digits = (e.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, ''); monthlyPrice = digits ? parseInt(digits, 10) : 0 }} />
      </div>
      <div class="field-row">
        <span class="field-label">연동 등급</span>
        <div class="toggle-group">
          {#each MEMBERSHIP_GRADE_OPTIONS as opt (opt.value)}
            <label class="radio-label">
              <input type="radio" name="membership_grade" value={opt.value} checked={membershipGrade === opt.value} onchange={() => { membershipGrade = opt.value }} />
              <span>{opt.label}</span>
            </label>
          {/each}
        </div>
      </div>
      <div class="field-row">
        <label class="field-label" for="sort_order">정렬순서</label>
        <input id="sort_order" class="f-input" type="number" name="sort_order" bind:value={sortOrder} />
      </div>
      <div class="field-row">
        <span class="field-label">인기 배지</span>
        <div class="toggle-row">
          <label class="switch" title="켜면 /members 비교표에서 이 플랜에 '인기' 배지가 표시됩니다">
            <input type="checkbox" name="is_popular" value="true" bind:checked={isPopular} />
            <span class="switch-track"></span>
          </label>
          <span class="field-hint">/members 비교표 '인기' 배지 표시 (여러 플랜 동시 허용)</span>
        </div>
      </div>
    </section>

    <!-- ② 상품 스펙 -->
    <section class="form-section">
      <h2 class="section-title">② 상품 스펙</h2>
      <p class="section-desc">/members 카드 선택 시 노출되는 라벨:값 목록입니다.</p>

      <div class="spec-list">
        {#each specs as row, i (i)}
          <div class="spec-row">
            <input class="f-input" type="text" placeholder="라벨 (예: 무료 배송)" bind:value={row.label} />
            <input class="f-input" type="text" placeholder="값 (예: 월 2회)" bind:value={row.value} />
            <button type="button" class="spec-remove" onclick={() => removeSpecRow(i)} aria-label="스펙 행 삭제">✕</button>
          </div>
        {/each}
      </div>
      <div class="spec-actions">
        <button type="button" class="btn-add-spec" onclick={() => addSpecRow()}>+ 스펙 추가</button>
        {#each SPEC_LABEL_PRESETS.filter((p) => !specs.some((s) => s.label === p)) as preset (preset)}
          <button type="button" class="spec-preset-chip" onclick={() => addSpecRow(preset)}>+ {preset}</button>
        {/each}
      </div>
    </section>

    <!-- ③ 혜택 초기설정 -->
    <section class="form-section">
      <h2 class="section-title">③ 혜택 초기설정</h2>
      <p class="section-desc">등록 후에도 구독목록 상세패널의 '혜택관리' 탭에서 언제든 수정할 수 있습니다.</p>

      <div class="benefit-cards">
        {#each benefits as benefit (benefit.benefit_type)}
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
                        <input type="text" inputmode="numeric" class="f-input f-input--sm"
                          value={(benefit.benefit_params[field.key] as number) ? (benefit.benefit_params[field.key] as number).toLocaleString('ko-KR') : ''}
                          oninput={(e) => {
                            const digits = (e.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, '')
                            updateBenefitParam(benefit.benefit_type, field.key, digits ? parseInt(digits, 10) : 0)
                          }} />
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
    </section>

    <!-- ④ 무료렌탈 대상장비 -->
    {#if freeRentalEnabled}
      <section class="form-section">
        <h2 class="section-title">④ 무료렌탈 대상장비</h2>
        <FreeRentalItemSelector products={data.parentProducts} bind:selectedIds={freeRentalProductIds} />
      </section>
    {/if}

    <!-- ⑤ 정책설정 -->
    <section class="form-section">
      <h2 class="section-title">⑤ 정책설정</h2>
      <p class="section-desc">
        정기결제 청구일은 고객이 실제로 구독을 시작한 날짜(가입일) 기준으로 매달 고정됩니다.
        아래 정책항목은 특정 상품이 아닌 전체 구독 서비스에 공통 적용되며, <code>/members</code>
        'Plans &amp; features' 하단 '정기구독 이용안내'에 그대로 노출됩니다.
      </p>

      <div class="policy-list">
        {#if policyItems.length > 0}
          <CmsDragList bind:items={policyItems} itemKey={(item) => item.id} onreorder={persistPolicyOrder} class="policy-drag-list">
            {#snippet renderItem(item)}
              <div class="policy-row">
                {#if editingPolicyId === item.id}
                  <div class="policy-edit-wrap">
                    <textarea
                      class="f-input f-textarea policy-edit-input"
                      maxlength={POLICY_ITEM_MAX_LENGTH}
                      bind:value={editingPolicyContent}
                      rows="2"
                    ></textarea>
                    <span class="policy-counter" class:over={editingPolicyContent.length > POLICY_ITEM_MAX_LENGTH}>
                      {editingPolicyContent.length}/{POLICY_ITEM_MAX_LENGTH}
                    </span>
                  </div>
                  <div class="policy-row-actions">
                    <button type="button" class="policy-btn policy-btn-primary" disabled={isPolicySaving || !editingPolicyContent.trim()} onclick={() => saveEditPolicy(item.id)}>저장</button>
                    <button type="button" class="policy-btn" disabled={isPolicySaving} onclick={cancelEditPolicy}>취소</button>
                  </div>
                {:else}
                  <span class="policy-content">{item.content}</span>
                  <div class="policy-row-actions">
                    <button type="button" class="policy-btn" disabled={isPolicySaving} onclick={() => startEditPolicy(item.id, item.content)}>수정</button>
                    <button type="button" class="policy-btn policy-btn-danger" disabled={isPolicySaving} onclick={() => removePolicyItem(item.id)}>삭제</button>
                  </div>
                {/if}
              </div>
            {/snippet}
          </CmsDragList>
        {:else}
          <p class="policy-empty">등록된 정책항목이 없습니다.</p>
        {/if}
      </div>

      <div class="policy-add-wrap">
        <div class="policy-add-input-wrap">
          <input
            type="text"
            class="f-input policy-add-input"
            placeholder="정책항목 내용 입력 (예: 정기결제는 매달 자동으로 청구됩니다)"
            maxlength={POLICY_ITEM_MAX_LENGTH}
            bind:value={newPolicyContent}
            disabled={isPolicySaving || policyItems.length >= POLICY_ITEM_MAX_COUNT}
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPolicyItem() } }}
          />
          <span class="policy-counter" class:over={newPolicyContent.length > POLICY_ITEM_MAX_LENGTH}>
            {newPolicyContent.length}/{POLICY_ITEM_MAX_LENGTH}
          </span>
        </div>
        <button
          type="button"
          class="policy-btn policy-btn-primary"
          disabled={isPolicySaving || !newPolicyContent.trim() || policyItems.length >= POLICY_ITEM_MAX_COUNT}
          onclick={addPolicyItem}
        >+ 추가</button>
      </div>
      <p class="policy-count-notice" class:over={policyItems.length >= POLICY_ITEM_MAX_COUNT}>
        {policyItems.length}/{POLICY_ITEM_MAX_COUNT}개 등록됨
        {#if policyItems.length >= POLICY_ITEM_MAX_COUNT}— 최대 개수에 도달했습니다{/if}
      </p>
    </section>

    <button type="submit" class="btn-submit" disabled={isLoading}>
      {isLoading ? '등록 중...' : '구독 상품 등록'}
    </button>
  </form>
</div>

<style>
  .form-wrap { padding: 24px 32px 80px; display: flex; flex-direction: column; gap: 20px; }
  .page-title { font: var(--text-pc-htitle-25); color: var(--cs-text); margin: 0; }
  .form-error { padding: 12px 16px; background: rgba(255, 53, 53, 0.1); color: var(--cs-red-badge); border-radius: var(--radius-sm); font: var(--text-pc-body-14); }

  .sub-form { display: flex; flex-direction: column; gap: 16px; }
  .form-section {
    background: var(--cs-white); border-radius: var(--radius-lg); padding: 28px 32px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .section-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0; }
  .section-desc { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: -8px 0 0; }

  .field-row { display: flex; flex-direction: column; gap: 6px; }
  .field-label { font: var(--text-pc-body-14); color: var(--cs-text-dark); }
  .field-guide { font: var(--text-pc-descript-10); color: var(--cs-text-light); margin: 0; }
  .required { color: var(--cs-red-badge); }

  /* ── 코드 조합(콤보) — products/new와 동일 시각 언어 ── */
  .field-row-combo { gap: 10px; }
  .combo-rows { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  .combo-row-btn {
    display: inline-flex; align-items: center; gap: 4px; padding: 8px 14px;
    border: 1.5px solid var(--cs-lilac); border-radius: var(--radius-sm); background: var(--cs-white);
    cursor: pointer; transition: border-color 0.12s, background 0.12s; min-height: 44px;
  }
  .combo-row-btn:hover { border-color: rgba(59, 47, 138, 0.35); background: rgba(59, 47, 138, 0.04); }
  .combo-row-selected { border-color: var(--cs-purple) !important; background: var(--cs-purple-op10) !important; }
  .combo-chips { display: flex; align-items: center; gap: 4px; }
  .combo-chip {
    padding: 2px 7px; background: var(--cs-lilac); color: var(--cs-purple-dark, var(--cs-purple));
    border-radius: 4px; font: var(--text-pc-body-14); font-weight: 700; letter-spacing: 0.01em;
  }
  .combo-row-selected .combo-chip { background: var(--cs-purple); color: var(--cs-white); }
  .combo-sep { color: var(--cs-text-light); font-size: 11px; }
  .combo-empty { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 4px 0 0; }

  .f-input {
    background: var(--cs-surface-gray); border: none; border-radius: var(--radius-sm);
    padding: 12px 16px; font: var(--text-pc-body-14); color: var(--cs-text);
    width: 100%; box-sizing: border-box;
  }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-textarea { resize: vertical; min-height: 80px; font-family: inherit; }
  .f-input--sm { width: 120px; flex: 0 0 auto; }

  .toggle-group { display: flex; gap: 6px; flex-wrap: wrap; }
  .toggle-row { display: flex; align-items: center; gap: 10px; }
  .field-hint { font: var(--text-pc-descript-10); color: var(--cs-text-light); }

  .switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .switch-track { position: absolute; inset: 0; background: var(--cs-lilac); border-radius: 999px; cursor: pointer; transition: background 0.15s; }
  .switch-track::before {
    content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: var(--cs-white);
    border-radius: 50%; transition: transform 0.15s;
  }
  .switch input:checked + .switch-track { background: var(--cs-purple); }
  .switch input:checked + .switch-track::before { transform: translateX(18px); }
  .radio-label {
    display: flex; align-items: center; gap: 5px; padding: 8px 14px; border: 1.5px solid var(--cs-lilac);
    border-radius: var(--radius-xl); font: var(--text-pc-script-12); color: var(--cs-text); cursor: pointer;
    background: var(--cs-white);
  }
  .radio-label:has(input:checked) { background: var(--cs-purple); border-color: var(--cs-purple); color: var(--cs-white); }

  .spec-list { display: flex; flex-direction: column; gap: 8px; }
  .spec-row { display: flex; align-items: center; gap: 8px; }
  .spec-remove {
    width: 32px; height: 32px; flex-shrink: 0; border: none; background: var(--cs-surface-gray); color: var(--cs-text-light);
    cursor: pointer; border-radius: 50%; transition: background 0.12s, color 0.12s;
  }
  .spec-remove:hover { background: var(--cs-red-badge); color: var(--cs-white); }
  .spec-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .btn-add-spec, .spec-preset-chip {
    padding: 8px 16px; border: 1.5px dashed var(--cs-purple); border-radius: var(--radius-sm);
    background: transparent; color: var(--cs-purple); font: var(--text-pc-script-12); cursor: pointer;
  }
  .btn-add-spec:hover, .spec-preset-chip:hover { background: rgba(59, 47, 138, 0.08); }

  /* ── 정책항목 관리 ── */
  .policy-list { display: flex; flex-direction: column; gap: 8px; }
  .policy-empty { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .policy-row {
    display: flex; align-items: center; gap: 12px; padding: 10px 14px; flex: 1; min-width: 0;
    background: var(--cs-surface-gray); border-radius: var(--radius-sm);
  }
  .policy-content { flex: 1; font: var(--text-pc-body-14); color: var(--cs-text); word-break: break-word; }
  .policy-row-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .policy-edit-wrap { flex: 1; display: flex; align-items: flex-start; gap: 8px; }
  .policy-edit-input { flex: 1; }

  .policy-btn {
    padding: 6px 14px; border: 1.5px solid var(--cs-lilac); border-radius: var(--radius-sm);
    background: var(--cs-white); color: var(--cs-text-mid); font: var(--text-pc-script-12);
    cursor: pointer; white-space: nowrap; transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .policy-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .policy-btn-primary:not(:disabled) { border-color: var(--cs-purple); background: var(--cs-purple); color: var(--cs-white); }
  .policy-btn-primary:not(:disabled):hover { opacity: 0.85; }
  .policy-btn-danger:not(:disabled):hover { border-color: var(--cs-red-badge); background: var(--cs-red-badge); color: var(--cs-white); }

  .policy-add-wrap { display: flex; align-items: center; gap: 10px; }
  .policy-add-input-wrap { flex: 1; position: relative; display: flex; align-items: center; }
  .policy-add-input { width: 100%; padding-right: 64px; }
  .policy-counter {
    font: var(--text-pc-descript-10); color: var(--cs-text-light); white-space: nowrap;
  }
  .policy-add-input-wrap .policy-counter { position: absolute; right: 14px; }
  .policy-counter.over { color: var(--cs-red-badge); }
  .policy-count-notice { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .policy-count-notice.over { color: var(--cs-red-badge); }

  .benefit-cards { display: flex; flex-direction: column; gap: 14px; }
  .benefit-card { border: 1.5px solid var(--cs-surface-gray); border-radius: var(--radius-md); padding: 16px 18px; transition: border-color 0.15s; }
  .benefit-card.enabled { border-color: var(--cs-purple); }
  .benefit-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .benefit-card-title { font: var(--text-pc-title-16); color: var(--cs-text); font-weight: 700; }
  .benefit-card-desc { margin: 4px 0 0; font: var(--text-pc-script-12); color: var(--cs-text-light); }

  .switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .switch-track { position: absolute; inset: 0; background: var(--cs-lilac); border-radius: 999px; cursor: pointer; transition: background 0.15s; }
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

  .btn-submit {
    padding: 16px; border: none; border-radius: var(--radius-md); background: var(--cs-purple); color: var(--cs-white);
    font: var(--text-pc-title-16); font-weight: 700; cursor: pointer; transition: opacity 0.12s;
  }
  .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-submit:not(:disabled):hover { opacity: 0.85; }
</style>
