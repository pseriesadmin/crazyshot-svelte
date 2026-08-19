<script lang="ts">
  import { enhance } from '$app/forms'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { fly } from 'svelte/transition'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { Coupon } from '$lib/types/database'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'
  import CmsKpiGrid from '$lib/components/cms/CmsKpiGrid.svelte'
  import CmsKpiCard from '$lib/components/cms/CmsKpiCard.svelte'
  import CmsStatRing from '$lib/components/cms/CmsStatRing.svelte'
  import CmsStatBars from '$lib/components/cms/CmsStatBars.svelte'
  import CouponDetailPanel from '$lib/components/cms/CouponDetailPanel.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import { sortByTier, buildComboCategoryCode } from '$lib/utils/comboCategoryCode'
  import { datePart } from '../../codes/_shared'
  import type { MappingGroupSimple, MappingItemSimple, TaxonomyCodeSimple } from './+page.server'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  // ─ 탭 ─
  const TABS = [
    { id: 'dashboard',  label: '대시보드' },
    { id: 'manage',     label: '발행 관리' },
    { id: 'report',     label: '사용량 리포트' },
    { id: 'expire',     label: '만료 관리' },
  ] as const

  let activeTab = $state(data.tab)

  function switchTab(id: string) {
    activeTab = id
    const u = new URL(page.url)
    u.searchParams.set('tab', id)
    goto(u.toString(), { replaceState: true, invalidateAll: true })
  }

  // ─ 폼 토글 ─
  let showCreateForm = $state(false)

  // ─ 쿠폰 생성 폼 상태 ─
  let createLoading = $state(false)
  let f_code        = $state('')
  let f_type        = $state('fixed')
  let f_discount_type  = $state('fixed')
  let f_discount_value = $state(0)
  let f_max_discount   = $state(0)
  let f_per_user_limit = $state(1)
  let f_total_limit    = $state(0)
  let f_min_rental_amount = $state(0)
  let f_min_rental_days   = $state(0)
  let f_user_grade     = $state('')
  let f_validity_type  = $state<'fixed_period' | 'unlimited'>('fixed_period')
  let f_valid_from     = $state('')
  let f_valid_until    = $state('')
  let f_allow_points   = $state(true)
  let f_allow_stacking = $state(false)
  let f_first_rental   = $state(false)
  let f_student        = $state(false)
  let f_walk_in        = $state(false)
  let f_subscription   = $state(false)
  let f_auto_issue     = $state(false)
  let f_auto_sched_type = $state<'monthly' | 'period'>('monthly')
  let f_auto_day       = $state(1)
  let f_auto_from      = $state('')
  let f_auto_to        = $state('')
  let f_dist_target    = $state<'all' | 'grade'>('all')
  let f_dist_grade     = $state('')
  let f_categories     = $state<string[]>([])
  let f_description    = $state('')

  // 카테고리 토글 — BND-COUPON-CAT-1: 하드코딩 제거, code_mapping_groups(백오피스) 기준 반영
  function toggleCat(c: string) {
    f_categories = f_categories.includes(c)
      ? f_categories.filter(x => x !== c)
      : [...f_categories, c]
  }

  // ── 조합그룹 / 콤보 선택 (A-2: products/new 패턴 이식) ───────────────────────────────
  interface ComboRow {
    combo_row_id: string
    combo_name: string | null
    date_option: 'none' | 'ym' | 'ymd'
    max_sequence: number | null
    parent_max_sequence: number | null
    codes: TaxonomyCodeSimple[]
  }

  const DEFAULT_CODE_FORMAT = { prefix: 'CS', date_format: 'YYMM', seq_digits: 3 }

  let codeMode            = $state<'manual' | 'sequenced'>('manual')
  let selectedGroupId     = $state<string | null>(null)
  let selectedComboRowId  = $state<string | null>(null)
  let lastConfirmedGroupId = $state<string | null>(null)

  let combosForGroup = $derived<ComboRow[]>(
    selectedGroupId
      ? (() => {
          const items = (data.mappingItems as MappingItemSimple[]).filter(i => i.group_id === selectedGroupId)
          const rowIds = [...new Set(items.map(i => i.combo_row_id))]
          return rowIds.map(rid => {
            const rowItems = items.filter(i => i.combo_row_id === rid)
            const first = rowItems[0]
            const codes = sortByTier(
              rowItems
                .map(i => (data.taxonomyCodes as TaxonomyCodeSimple[]).find(tc => tc.id === i.taxonomy_code_id))
                .filter((tc): tc is TaxonomyCodeSimple => tc !== undefined)
            )
            return {
              combo_row_id: rid,
              combo_name: first.combo_name ?? null,
              date_option: first.date_option as ComboRow['date_option'],
              max_sequence: first.max_sequence,
              parent_max_sequence: first.parent_max_sequence,
              codes,
            }
          })
        })()
      : []
  )

  let groupPickerOptions = $derived<SuggestPickerOption[]>(
    (data.mappingGroups as MappingGroupSimple[]).map(mg => ({
      id: mg.id,
      label: mg.name,
      meta: [mg.description].filter((v): v is string => Boolean(v)),
    }))
  )

  function comboDatePart(combo: ComboRow): string | null {
    if (combo.date_option === 'none') return null
    if (combo.date_option === 'ymd') {
      const now = new Date()
      return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    }
    return datePart('YYMM')
  }

  function buildComboPreview(combo: ComboRow): string {
    const catCode = buildComboCategoryCode(combo.codes)
    if (!catCode) return '—'
    const prefix = DEFAULT_CODE_FORMAT.prefix
    const d = comboDatePart(combo) ?? ''
    const seqPlaceholder = (combo.parent_max_sequence != null && combo.max_sequence != null)
      ? '0'.repeat(String(combo.parent_max_sequence).length) + '0'.repeat(String(combo.max_sequence).length)
      : '0'.repeat(combo.max_sequence != null ? String(combo.max_sequence).length : DEFAULT_CODE_FORMAT.seq_digits)
    return `${prefix}${catCode}${d}${seqPlaceholder}`
  }

  function comboSeqMax(combo: ComboRow): string {
    const childLabel = combo.max_sequence != null ? `~${combo.max_sequence}` : '무제한'
    return combo.parent_max_sequence != null
      ? `부모~${combo.parent_max_sequence} · 자식${childLabel}`
      : childLabel
  }

  function onGroupChange() {
    selectedComboRowId = null
    codeMode = 'manual'
  }

  function onGroupPickerSelect(opt: SuggestPickerOption, _previousId: string | null) {
    if (opt.id !== lastConfirmedGroupId) onGroupChange()
    lastConfirmedGroupId = opt.id
  }

  function onGroupPickerInput(val: string) {
    if (!val.trim() && selectedGroupId) {
      selectedGroupId = null
      lastConfirmedGroupId = null
      onGroupChange()
    }
  }

  function selectCombo(combo: ComboRow) {
    selectedComboRowId = combo.combo_row_id
    const preview = buildComboPreview(combo)
    if (preview && preview !== '—') f_code = preview
    codeMode = 'sequenced'
  }

  // ⛔ 결함 수정(2026-08-18): 콤보 선택 시 codeMode/f_code는 상태로 잡히지만, 실제 서버
  // 제출(FormData)에 실릴 code_series는 hidden input이 없어 전송된 적이 없었음 —
  // createCoupon 액션(+page.server.ts:283)이 매번 code_mode를 못 받아 'manual'로 조용히
  // 폴백해, 지금까지 이 화면으로 sequenced 모드 쿠폰이 한 번도 생성된 적이 없었다.
  // generate_user_coupon_redeemed_code(migration 292)가 파싱하는 정확한 키 이름
  // (category_code/prefix/date_option/seq_digits/max_sequence)에 맞춰 구성.
  const selectedCombo = $derived<ComboRow | null>(
    selectedComboRowId ? combosForGroup.find(c => c.combo_row_id === selectedComboRowId) ?? null : null
  )
  const codeSeriesPayload = $derived(
    selectedCombo
      ? {
          category_code: buildComboCategoryCode(selectedCombo.codes),
          prefix: DEFAULT_CODE_FORMAT.prefix,
          // RPC는 'yyyymm'만 인식(그 외는 전부 무날짜) — code_mapping_items의 'ymd'(일 단위)는
          // 쿠폰 채번에서 지원 범위 밖이라 'yyyymm'으로 근사 처리(완전 무날짜보다는 근접)
          date_option: selectedCombo.date_option === 'none' ? 'none' : 'yyyymm',
          seq_digits: DEFAULT_CODE_FORMAT.seq_digits,
          max_sequence: selectedCombo.max_sequence,
        }
      : null
  )
  // ───────────────────────────────────────────────────────────────────────────────────────

  // A-4: SuggestPicker 정적 옵션 (select 대체)
  const DISCOUNT_TYPE_OPTIONS: SuggestPickerOption[] = [
    { id: 'fixed',         label: '정액 (원)' },
    { id: 'percent',       label: '정률 (%)' },
    { id: 'free_shipping', label: '무료배송' },
  ]
  const TYPE_OPTIONS: SuggestPickerOption[] = [
    { id: 'fixed',         label: '정액 할인' },
    { id: 'percent',       label: '정률 할인 (%)' },
    { id: 'free_delivery', label: '무료 배송' },
    { id: 'first_rental',  label: '첫 렌탈 전용' },
    { id: 'category',      label: '카테고리 한정' },
    { id: 'bundle',        label: '번들 렌탈' },
    { id: 'subscription',  label: '정기구독 전용' },
    { id: 'student',       label: '학생 신학기' },
    { id: 'walk_in',       label: '방문 픽업' },
    { id: 'reactivation',  label: '휴면 복귀' },
    { id: 'referral',      label: '추천인' },
    { id: 'event',         label: '이벤트' },
  ]
  const USER_GRADE_OPTIONS: SuggestPickerOption[] = [
    { id: '__all__', label: '전체 회원' },
    { id: 'BASIC',   label: 'BASIC' },
    { id: 'PRO',     label: 'PRO' },
    { id: 'CRAZY',   label: 'CRAZY' },
  ]
  // SuggestPicker bind용 nullable state — 초기값은 폼 상태 기본값과 동일한 리터럴로 지정
  let _sel_dtype = $state<string | null>('fixed')    // f_discount_type 초기값과 동일
  let _sel_type  = $state<string | null>('fixed')    // f_type 초기값과 동일
  let _sel_grade = $state<string | null>('__all__')  // f_user_grade='' → '__all__' 매핑

  let autoScheduleJson = $derived(
    f_auto_sched_type === 'monthly'
      ? JSON.stringify({ type: 'monthly', day: f_auto_day })
      : JSON.stringify({ type: 'period', from: f_auto_from, to: f_auto_to })
  )

  let distTargetJson = $derived(
    f_dist_target === 'grade'
      ? JSON.stringify({ type: 'grade', meta: f_dist_grade })
      : JSON.stringify({ type: 'all' })
  )

  // ─ 목록카드 + DetailPanel 선택 상태 (cms-uiux.md 표준 구조) ─
  let selectedCouponId = $state<string | null>(data.selectedId ?? null)
  let showDistHistory  = $state(false)

  const selectedCoupon = $derived(
    selectedCouponId ? data.coupons.find(c => c.id === selectedCouponId) ?? null : null
  )

  function selectCoupon(c: Coupon) {
    selectedCouponId = c.id
    const u = new URL(page.url)
    u.searchParams.set('selected', c.id)
    goto(u.toString(), { replaceState: true, noScroll: true })
  }

  function closePanel() {
    selectedCouponId = null
    const u = new URL(page.url)
    u.searchParams.delete('selected')
    goto(u.toString(), { replaceState: true, noScroll: true })
  }

  // 사용량 리포트 탭 — 행은 coupon_id만 갖고 있어 data.coupons(전체 목록, tab 무관하게
  // 항상 로드됨)에서 매칭되는 쿠폰을 찾아 발행관리 탭과 동일한 selectCoupon()으로 위임.
  // 과거 리포트 기간에 등장했지만 이후 삭제된 쿠폰처럼 못 찾는 경우는 조용히 무시(패널 안 열림).
  function selectCouponById(couponId: string) {
    const c = data.coupons.find(c => c.id === couponId)
    if (c) selectCoupon(c)
  }

  // ─ 만료 연장 상태 ─
  let reportFrom = $state(data.from.substring(0, 10))
  let reportTo   = $state(data.to.substring(0, 10))

  let extendCouponId = $state('')
  let extendNewUntil = $state('')
  let extendLoading  = $state(false)

  // ─ 삭제 확인 ─
  let deleteId        = $state('')
  let deleteCode      = $state('')
  let showDeleteModal = $state(false)

  function confirmDelete(c: Coupon) {
    deleteId   = c.id
    deleteCode = c.code ?? ''
    showDeleteModal = true
  }

  // ─ action 결과 처리 ─
  $effect(() => {
    if (!form) return
    if (form.ok) {
      csToast.success('완료되었습니다.')
      showCreateForm  = false
      showDeleteModal = false
      extendCouponId  = ''
      if (deleteId && deleteId === selectedCouponId) closePanel()
    } else if ('error' in form && form.error) {
      csToast.error(String(form.error))
    }
  })

  // data 갱신 시 재동기화
  $effect(() => {
    reportFrom = data.from.substring(0, 10)
    reportTo   = data.to.substring(0, 10)
  })

  // ─ 유틸 ─
  // sequenced 모드 쿠폰은 code가 NULL(실제 코드는 고객이 결제로 "사용"하는 순간에만
  // user_coupons.redeemed_code로 개별 채번됨) — 목록·만료 테이블에서 빈 값 대신
  // code_series 패턴 프리뷰(예: "Z쿠폰코드*")를 보여준다. manual 모드는 code 그대로.
  function codeDisplay(c: { code: string | null; code_mode?: string; code_series?: { prefix?: string; category_code?: string } | null }): string {
    if (c.code) return c.code
    if (c.code_mode === 'sequenced' && c.code_series) {
      const prefix = c.code_series.prefix ?? 'CS'
      const cat = c.code_series.category_code ?? ''
      return `${prefix}${cat}*`
    }
    return '—'
  }

  function discountLabel(c: Coupon): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cc = c as unknown as any
    if (c.discount_type === 'percentage') {
      const max = cc.max_discount_amount ? ` (최대 ${Number(cc.max_discount_amount).toLocaleString()}원)` : ''
      return `${c.discount_value}%${max}`
    }
    if (c.discount_type === 'fixed') return `${c.discount_value.toLocaleString()}원`
    return '무료배송'
  }

  function typeLabel(type: string): string {
    const MAP: Record<string, string> = {
      fixed: '정액', percent: '정률', free_delivery: '무료배송',
      first_rental: '첫렌탈', category: '카테고리', bundle: '번들',
      subscription: '구독전용', student: '학생전용', walk_in: '방문픽업',
      reactivation: '휴면복귀', referral: '추천인', event: '이벤트', all: '전체',
    }
    return MAP[type] ?? type
  }

  function formatDate(d: string | null | undefined): string {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' })
  }
</script>

<div class="page-wrap">
  <!-- 서브탭 -->
  <div class="sub-tabs">
    {#each TABS as t}
      <button
        class="sub-tab-btn"
        class:active={activeTab === t.id}
        onclick={() => switchTab(t.id)}
      >{t.label}</button>
    {/each}
  </div>

  <!-- ────────────────────────────────────────────
       탭1: 대시보드
  ──────────────────────────────────────────── -->
  {#if activeTab === 'dashboard'}
    <div class="section-title">쿠폰 현황</div>

    <!-- 히어로 통계: 전환율 게이지 + 발급/사용 breakdown 바 -->
    <div class="hero-stats">
      <div class="hero-ring">
        <CmsStatRing value={data.stats.conversion_rate} label="쿠폰 사용 전환율" tone="primary" size={140} />
      </div>
      <div class="hero-bars">
        <div class="hero-bars-title">발급 · 사용 · 만료 breakdown</div>
        <CmsStatBars unit="건" items={[
          { label: '총 발급',  value: data.stats.total_issued,  tone: 'primary' },
          { label: '현재 활성', value: data.stats.total_active,  tone: 'info' },
          { label: '누적 사용', value: data.stats.total_used,    tone: 'primary' },
          { label: '만료',    value: data.stats.total_expired, tone: 'danger' },
        ]} />
      </div>
    </div>

    <CmsKpiGrid columns={3} cards={[
      { label: '총 발급 수',        value: data.stats.total_issued,  tone: 'primary' },
      { label: '현재 활성',         value: data.stats.total_active,  tone: 'info' },
      { label: '누적 사용',         value: data.stats.total_used,    tone: 'primary', size: 'sm' },
      { label: '만료 수',           value: data.stats.total_expired, tone: 'danger', size: 'sm' },
      { label: '총 할인 제공액',    value: data.stats.total_discount_amount, unit: '원', tone: 'info', size: 'sm' },
      { label: '쿠폰 사용 전환율',  value: data.stats.conversion_rate, unit: '%', tone: 'primary', size: 'sm', progress: data.stats.conversion_rate },
    ]} />

    {#if data.expiringSoon.length > 0}
      <div class="expire-section">
        <div class="expire-section-title">⚠ 만료 임박 쿠폰 (7일 이내)</div>
        <div class="expire-grid">
          {#each data.expiringSoon.slice(0, 5) as c}
            <CmsKpiCard label={c.code ?? ''} value={formatDate(c.valid_until)} tone="warn" size="sm" />
          {/each}
        </div>
      </div>
    {/if}

  <!-- ────────────────────────────────────────────
       탭2: 발행 관리
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'manage'}
    <div class="toolbar">
      <span class="section-title nm">쿠폰 목록</span>
      <button class="btn-primary" onclick={() => showCreateForm = !showCreateForm}>
        {showCreateForm ? '닫기' : '+ 쿠폰 생성'}
      </button>
    </div>

    {#if showCreateForm}
      <div class="form-card">
        <form method="POST" action="?/createCoupon"
          use:enhance={() => {
            createLoading = true
            return ({ update }) => { createLoading = false; update() }
          }}
        >
          <div class="fs-title">기본 정보</div>
          <div class="form-grid">
            <div class="form-field">
              <label for="fc-code">쿠폰 코드</label>
              <p class="field-hint">분류 선택 및 검색</p>
              {#if (data.mappingGroups as MappingGroupSimple[]).length > 0}
                <SuggestPicker
                  id="fc-code-group"
                  bind:selectedId={selectedGroupId}
                  options={groupPickerOptions}
                  placeholder="분류 검색 또는 선택..."
                  listLabel="조합그룹"
                  variant="generic"
                  minChars={0}
                  oninput={onGroupPickerInput}
                  onselect={onGroupPickerSelect}
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
                </SuggestPicker>
                {#if selectedGroupId}
                  <div class="combo-rows-wrap">
                    {#if combosForGroup.length > 0}
                      <div class="combo-rows">
                        {#each combosForGroup as combo (combo.combo_row_id)}
                          <button
                            type="button"
                            class="combo-row-btn"
                            class:combo-row-selected={selectedComboRowId === combo.combo_row_id}
                            onclick={() => selectCombo(combo)}
                            title={buildComboPreview(combo)}
                          >
                            {#if combo.combo_name}
                              <span class="combo-name-label">{combo.combo_name}</span>
                            {/if}
                            <span class="combo-row-chips">
                              <span class="combo-prefix-chip">{DEFAULT_CODE_FORMAT.prefix}</span>
                              <span class="combo-sep">·</span>
                              <span class="combo-chips">
                                {#each combo.codes as tc, i}
                                  {#if i > 0}<span class="combo-sep">·</span>{/if}
                                  <span class="combo-chip">{tc.code}</span>
                                {/each}
                              </span>
                              {#if comboDatePart(combo)}
                                <span class="combo-sep">·</span>
                                <span class="combo-meta-chip combo-ym-chip">{comboDatePart(combo)}</span>
                              {/if}
                              <span class="combo-sep">·</span>
                              <span class="combo-meta-chip combo-seq-chip">{comboSeqMax(combo)}</span>
                            </span>
                          </button>
                        {/each}
                      </div>
                    {:else}
                      <p class="combo-empty">이 그룹에 등록된 조합이 없습니다.</p>
                    {/if}
                  </div>
                {/if}
              {:else}
                <p class="combo-empty">등록된 분류 그룹이 없습니다. /cms/codes에서 'coupon' 키로
                  분류 그룹을 먼저 등록하면 여기서 검색·선택할 수 있습니다. 등록 전까지는
                  아래 칸에 쿠폰 코드를 직접 입력하세요.</p>
              {/if}
              <input id="fc-code" name="code" class="f-input" bind:value={f_code} required />
              <!-- 결함 수정: code_mode/code_series를 실제로 폼 제출에 실어 보내는 hidden input
                   (이전엔 이게 없어 콤보를 선택해도 항상 manual로 저장됐음) -->
              <input type="hidden" name="code_mode" value={codeMode} />
              <input type="hidden" name="code_series" value={codeSeriesPayload ? JSON.stringify(codeSeriesPayload) : ''} />
            </div>
            <div class="form-field">
              <label for="fc-type">쿠폰 유형</label>
              <SuggestPicker
                id="fc-type"
                bind:selectedId={_sel_type}
                options={TYPE_OPTIONS}
                placeholder="쿠폰 유형 선택"
                listLabel="쿠폰 유형"
                variant="generic"
                minChars={0}
                onselect={(opt) => { f_type = opt.id }}
              >
                {#snippet field(c)}
                  <input type="text" class="f-input" id={c.id} placeholder={c.placeholder}
                    value={c.value} oninput={c.oninput} onkeydown={c.onkeydown}
                    onfocus={c.onfocus} onblur={c.onblur}
                    aria-autocomplete={c.ariaAutocomplete} aria-expanded={c.ariaExpanded}
                    aria-controls={c.ariaControls} autocomplete="off" />
                {/snippet}
              </SuggestPicker>
              <input type="hidden" name="type" value={f_type} />
            </div>
            <div class="form-field">
              <label for="fc-dtype">할인 방식</label>
              <SuggestPicker
                id="fc-dtype"
                bind:selectedId={_sel_dtype}
                options={DISCOUNT_TYPE_OPTIONS}
                placeholder="할인 방식 선택"
                listLabel="할인 방식"
                variant="generic"
                minChars={0}
                onselect={(opt) => { f_discount_type = opt.id }}
              >
                {#snippet field(c)}
                  <input type="text" class="f-input" id={c.id} placeholder={c.placeholder}
                    value={c.value} oninput={c.oninput} onkeydown={c.onkeydown}
                    onfocus={c.onfocus} onblur={c.onblur}
                    aria-autocomplete={c.ariaAutocomplete} aria-expanded={c.ariaExpanded}
                    aria-controls={c.ariaControls} autocomplete="off" />
                {/snippet}
              </SuggestPicker>
              <input type="hidden" name="discount_type" value={f_discount_type} />
            </div>
            <div class="form-field">
              <label for="fc-dval">할인값</label>
              <input id="fc-dval" name="discount_value" type="number" min="0"
                class="f-input" bind:value={f_discount_value} />
            </div>
            {#if f_discount_type === 'percent'}
              <div class="form-field">
                <label for="fc-maxd">최대 할인 한도 (원, 0=무제한)</label>
                <input id="fc-maxd" name="max_discount_amount" type="number" min="0"
                  class="f-input" bind:value={f_max_discount} />
              </div>
            {/if}
          </div>

          <div class="fs-title">사용 제한</div>
          <div class="form-grid">
            <div class="form-field">
              <label for="fc-mra">최소 렌탈 금액 (원, 0=없음)</label>
              <input id="fc-mra" name="min_rental_amount" type="number" min="0"
                class="f-input" bind:value={f_min_rental_amount} />
            </div>
            <div class="form-field">
              <label for="fc-mrd">최소 렌탈 기간 (일, 0=없음)</label>
              <input id="fc-mrd" name="min_rental_days" type="number" min="0"
                class="f-input" bind:value={f_min_rental_days} />
            </div>
            <div class="form-field">
              <label for="fc-pul">1인당 사용 횟수</label>
              <input id="fc-pul" name="per_user_limit" type="number" min="1"
                class="f-input" bind:value={f_per_user_limit} />
            </div>
            <div class="form-field">
              <label for="fc-tul">전체 발급 한도 (0=무제한)</label>
              <input id="fc-tul" name="total_usage_limit" type="number" min="0"
                class="f-input" bind:value={f_total_limit} />
            </div>
            <div class="form-field">
              <label for="fc-grade">필수 회원 등급 (선택)</label>
              <SuggestPicker
                id="fc-grade"
                bind:selectedId={_sel_grade}
                options={USER_GRADE_OPTIONS}
                placeholder="회원 등급 선택"
                listLabel="회원 등급"
                variant="generic"
                minChars={0}
                onselect={(opt) => { f_user_grade = opt.id === '__all__' ? '' : opt.id }}
              >
                {#snippet field(c)}
                  <input type="text" class="f-input" id={c.id} placeholder={c.placeholder}
                    value={c.value} oninput={c.oninput} onkeydown={c.onkeydown}
                    onfocus={c.onfocus} onblur={c.onblur}
                    aria-autocomplete={c.ariaAutocomplete} aria-expanded={c.ariaExpanded}
                    aria-controls={c.ariaControls} autocomplete="off" />
                {/snippet}
              </SuggestPicker>
              <input type="hidden" name="user_grade_required" value={f_user_grade} />
            </div>
          </div>

          {#if f_type === 'category'}
            <div class="fs-title">적용 카테고리</div>
            <div class="cat-picker">
              {#each data.categoryOptions as cat (cat.value)}
                <button type="button" class="cat-chip"
                  class:selected={f_categories.includes(cat.value)}
                  onclick={() => toggleCat(cat.value)}>{cat.label}</button>
              {/each}
            </div>
            <input type="hidden" name="applicable_categories"
              value={f_categories.length ? JSON.stringify(f_categories) : ''} />
          {/if}

          <div class="fs-title">전용 조건</div>
          <div class="toggle-group">
            <div class="toggle-row">
              <span>첫 렌탈 전용</span>
              <button type="button" class="tog" class:tog-on={f_first_rental}
                role="switch" aria-checked={f_first_rental}
                onclick={() => f_first_rental = !f_first_rental}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="is_first_rental_only" value={String(f_first_rental)} />
            </div>
            <div class="toggle-row">
              <span>학생 인증 계정 전용 <em>(is_student 검증)</em></span>
              <button type="button" class="tog" class:tog-on={f_student}
                role="switch" aria-checked={f_student}
                onclick={() => f_student = !f_student}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="is_student_only" value={String(f_student)} />
            </div>
            <div class="toggle-row">
              <span>방문 픽업 전용 <em>(shipment_type=pickup 검증)</em></span>
              <button type="button" class="tog" class:tog-on={f_walk_in}
                role="switch" aria-checked={f_walk_in}
                onclick={() => f_walk_in = !f_walk_in}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="is_walk_in_only" value={String(f_walk_in)} />
            </div>
            <div class="toggle-row">
              <span>정기구독 전용 <em>(PRD 구독 플랜 연계)</em></span>
              <button type="button" class="tog" class:tog-on={f_subscription}
                role="switch" aria-checked={f_subscription}
                onclick={() => f_subscription = !f_subscription}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="is_subscription_only" value={String(f_subscription)} />
            </div>
          </div>

          <div class="fs-title">결합 옵션</div>
          <div class="toggle-group">
            <div class="toggle-row">
              <span>포인트 결합 사용 허용</span>
              <button type="button" class="tog" class:tog-on={f_allow_points}
                role="switch" aria-checked={f_allow_points}
                onclick={() => f_allow_points = !f_allow_points}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="allow_with_points" value={String(f_allow_points)} />
            </div>
            <div class="toggle-row">
              <span>쿠폰 중복 사용 허용 <em>(복수 쿠폰 동시 적용)</em></span>
              <button type="button" class="tog" class:tog-on={f_allow_stacking}
                role="switch" aria-checked={f_allow_stacking}
                onclick={() => f_allow_stacking = !f_allow_stacking}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="allow_stacking" value={String(f_allow_stacking)} />
            </div>
          </div>

          <div class="fs-title">유효기간</div>
          <div class="radio-group">
            <label class="radio-lbl">
              <input type="radio" name="validity_type" value="fixed_period"
                bind:group={f_validity_type} />
              제한 기간 (from~until)
            </label>
            <label class="radio-lbl">
              <input type="radio" name="validity_type" value="unlimited"
                bind:group={f_validity_type} />
              무제한 (만료일 없음)
            </label>
          </div>
          {#if f_validity_type === 'fixed_period'}
            <div class="form-grid">
              <div class="form-field">
                <label for="fc-vf">시작일</label>
                <CmsDatePicker bind:value={f_valid_from} name="valid_from" placeholder="시작일 선택" disablePast={false} />
              </div>
              <div class="form-field">
                <label for="fc-vu">종료일</label>
                <CmsDatePicker bind:value={f_valid_until} name="valid_until" placeholder="종료일 선택" disablePast={false} />
              </div>
            </div>
          {/if}

          <div class="fs-title">자동 발행</div>
          <div class="toggle-group">
            <div class="toggle-row">
              <span>자동 발행 활성화</span>
              <button type="button" class="tog" class:tog-on={f_auto_issue}
                role="switch" aria-checked={f_auto_issue}
                onclick={() => f_auto_issue = !f_auto_issue}>
                <span class="tog-thumb"></span>
              </button>
              <input type="hidden" name="auto_issue_enabled" value={String(f_auto_issue)} />
            </div>
          </div>
          {#if f_auto_issue}
            <div class="auto-box">
              <div class="radio-group">
                <label class="radio-lbl">
                  <input type="radio" bind:group={f_auto_sched_type} value="monthly" />
                  매월 n일 발행
                </label>
                <label class="radio-lbl">
                  <input type="radio" bind:group={f_auto_sched_type} value="period" />
                  특정 기간 발행
                </label>
              </div>
              {#if f_auto_sched_type === 'monthly'}
                <div class="form-field" style="max-width:160px">
                  <label for="fc-aday">발행일 (1~31)</label>
                  <input id="fc-aday" type="number" min="1" max="31" class="f-input"
                    bind:value={f_auto_day} />
                </div>
              {:else}
                <div class="form-grid">
                  <div class="form-field">
                    <label for="fc-af">시작일</label>
                    <CmsDatePicker bind:value={f_auto_from} placeholder="시작일 선택" disablePast={false} />
                  </div>
                  <div class="form-field">
                    <label for="fc-at">종료일</label>
                    <CmsDatePicker bind:value={f_auto_to} placeholder="종료일 선택" disablePast={false} />
                  </div>
                </div>
              {/if}
              <input type="hidden" name="auto_issue_schedule" value={autoScheduleJson} />
              <div class="fs-title sm">배포 대상</div>
              <div class="radio-group">
                <label class="radio-lbl">
                  <input type="radio" bind:group={f_dist_target} value="all" />
                  전체 회원
                </label>
                <label class="radio-lbl">
                  <input type="radio" bind:group={f_dist_target} value="grade" />
                  특정 등급
                </label>
              </div>
              {#if f_dist_target === 'grade'}
                <select class="f-input" style="max-width:200px;margin-top:6px"
                  bind:value={f_dist_grade}>
                  <option value="BASIC">BASIC</option>
                  <option value="PRO">PRO</option>
                  <option value="CRAZY">CRAZY</option>
                </select>
              {/if}
              <input type="hidden" name="distribution_target" value={distTargetJson} />
            </div>
          {/if}

          <div class="form-field" style="margin-top:16px">
            <label for="fc-desc">설명 (선택)</label>
            <input id="fc-desc" name="description" class="f-input"
              bind:value={f_description} placeholder="내부 메모용 설명" />
          </div>

          <div class="form-actions">
            <button type="button" class="btn-ghost" onclick={() => showCreateForm = false}>취소</button>
            <button type="submit" class="btn-primary" disabled={createLoading}>
              {createLoading ? '저장 중...' : '쿠폰 생성'}
            </button>
          </div>
        </form>
      </div>
    {/if}

    <!-- 목록카드 + DetailPanel (cms-uiux.md 표준 구조 — /cms/reservation과 동일 패턴) -->
    <div class="content-area" class:panel-open={selectedCouponId != null}>
      <div class="table-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>코드</th><th>유형</th><th class="col-hide">할인</th>
              <th class="col-hide">유효기간</th><th>사용/한도</th><th>상태</th><th>관리</th>
            </tr>
          </thead>
          <tbody>
            {#each data.coupons as c (c.id)}
              {@const cc = c as unknown as Record<string, unknown>}
              <tr
                class:selected={selectedCouponId === c.id}
                onclick={() => selectCoupon(c)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && selectCoupon(c)}
                aria-label="{codeDisplay(c)} 쿠폰 상세 보기"
              >
                <td class="td-code">{codeDisplay(c)}</td>
                <td><span class="badge badge-info">{typeLabel(c.type)}</span></td>
                <td class="td-date col-hide">
                  {#if cc.validity_type === 'unlimited'}
                    <span class="badge badge-active">무제한</span>
                  {:else}
                    {formatDate(c.valid_from)} ~ {formatDate(c.valid_until)}
                  {/if}
                </td>
                <td class="col-hide">{discountLabel(c)}</td>
                <td>{c.usage_count} / {c.usage_limit ?? '∞'}</td>
                <td>
                  <form method="POST" action="?/toggleCoupon" use:enhance
                    onclick={(e) => e.stopPropagation()}
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="is_active" value={String(c.is_active)} />
                    <button type="submit" class="tog" class:tog-on={c.is_active}
                      role="switch" aria-checked={c.is_active} aria-label="활성화 토글">
                      <span class="tog-thumb"></span>
                    </button>
                  </form>
                </td>
                <td>
                  <button class="btn-danger sm" onclick={(e) => { e.stopPropagation(); confirmDelete(c) }}>삭제</button>
                </td>
              </tr>
            {:else}
              <tr><td colspan="7" class="no-data">등록된 쿠폰이 없습니다.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>

        <!-- 배포 이력 (접이식) -->
        <button type="button" class="dist-history-toggle" onclick={() => showDistHistory = !showDistHistory}>
          {showDistHistory ? '▾' : '▸'} 배포 이력 {data.distributions.length > 0 ? `(${data.distributions.length})` : ''}
        </button>
        {#if showDistHistory}
          <div class="dist-history-table">
            <table>
              <thead>
                <tr><th>배포일</th><th>쿠폰 코드</th><th>대상</th><th>발급 수</th></tr>
              </thead>
              <tbody>
                {#each data.distributions as d}
                  <tr>
                    <td class="td-date">{formatDate(d.created_at)}</td>
                    <td class="td-code">{d.coupons ? codeDisplay(d.coupons) : '—'}</td>
                    <td>{d.target_type}</td>
                    <td>{d.issued_count.toLocaleString()}명</td>
                  </tr>
                {:else}
                  <tr><td colspan="4" class="no-data">배포 이력이 없습니다.</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <!-- 상세 패널 -->
      {#if selectedCouponId != null && selectedCoupon}
        <div class="detail-panel-wrap" transition:fly={{ x: 30, duration: 220 }}>
          {#key selectedCouponId}
            <CouponDetailPanel coupon={selectedCoupon} onclose={closePanel} context="manage" />
          {/key}
        </div>
      {/if}
    </div>

  <!-- ────────────────────────────────────────────
       탭3: 사용량 리포트
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'report'}
    <div class="toolbar">
      <span class="section-title nm">사용량 리포트</span>
      <form method="GET" class="filter-form">
        <input type="hidden" name="tab" value="report" />
        <select name="period" class="f-input sm">
          <option value="day"   selected={data.period === 'day'}>일별</option>
          <option value="month" selected={data.period === 'month'}>월별</option>
          <option value="year"  selected={data.period === 'year'}>연별</option>
        </select>
        <CmsDatePicker bind:value={reportFrom} name="from" placeholder="시작일" disablePast={false} />
        <CmsDatePicker bind:value={reportTo} name="to" placeholder="종료일" disablePast={false} />
        <button type="submit" class="btn-primary">조회</button>
      </form>
    </div>
    <div class="content-area" class:panel-open={selectedCouponId != null}>
      <div class="table-card">
        <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>기간</th><th>쿠폰 코드</th><th>유형</th>
              <th>발급 수</th><th>사용 수</th><th>전환율</th>
            </tr>
          </thead>
          <tbody>
            {#each data.usageReport as r}
              <tr
                class:selected={selectedCouponId === r.coupon_id}
                onclick={() => selectCouponById(r.coupon_id)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && selectCouponById(r.coupon_id)}
                aria-label="{r.coupon_code} 쿠폰 상세 보기"
              >
                <td>{r.period}</td>
                <td class="td-code">{r.coupon_code}</td>
                <td><span class="badge badge-info">{typeLabel(r.coupon_type)}</span></td>
                <td>{r.issued_count.toLocaleString()}</td>
                <td>{r.used_count.toLocaleString()}</td>
                <td>{r.conversion_pct}%</td>
              </tr>
            {:else}
              <tr><td colspan="6" class="no-data">리포트 데이터가 없습니다.</td></tr>
            {/each}
          </tbody>
        </table>
        </div>
      </div>

      <!-- 상세 패널 (발행 관리 탭과 동일 컴포넌트·패턴 재사용 — 단 '배포' 탭은 '사용 채번
           목록'으로 대체되도록 context="report" 전달, Stephen 확정 2026-08-18) -->
      {#if selectedCouponId != null && selectedCoupon}
        <div class="detail-panel-wrap" transition:fly={{ x: 30, duration: 220 }}>
          {#key selectedCouponId}
            <CouponDetailPanel coupon={selectedCoupon} onclose={closePanel} context="report" />
          {/key}
        </div>
      {/if}
    </div>

  <!-- ────────────────────────────────────────────
       탭4: 만료 관리
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'expire'}
    <div class="section-title">만료 임박 (7일 이내)</div>
    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>쿠폰 코드</th><th>유형</th>
            <th>사용/한도</th><th>만료일</th><th>연장</th>
          </tr>
        </thead>
        <tbody>
          {#each data.expiringSoon as c}
            <tr>
              <td class="td-code">{codeDisplay(c)}</td>
              <td><span class="badge badge-info">{typeLabel(c.type)}</span></td>
              <td>{c.usage_count} / {c.usage_limit ?? '∞'}</td>
              <td class="td-date">{formatDate(c.valid_until)}</td>
              <td>
                <button class="btn-ghost sm"
                  onclick={() => { extendCouponId = c.id; extendNewUntil = '' }}>
                  기간 연장
                </button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="5" class="no-data">만료 임박 쿠폰이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="section-title" style="margin-top:20px">만료 완료</div>
    <div class="table-card">
      <table>
        <thead>
          <tr><th>쿠폰 코드</th><th>유형</th><th>총 사용</th><th>만료일</th></tr>
        </thead>
        <tbody>
          {#each data.expiredCoupons as c}
            <tr>
              <td class="td-code">{codeDisplay(c)}</td>
              <td><span class="badge badge-inactive">{typeLabel(c.type)}</span></td>
              <td>{c.usage_count}</td>
              <td class="td-date">{formatDate(c.valid_until)}</td>
            </tr>
          {:else}
            <tr><td colspan="4" class="no-data">만료된 쿠폰이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- 기간 연장 모달 -->
{#if extendCouponId}
  <div class="modal-bg" onclick={() => extendCouponId = ''} role="presentation">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="기간 연장"
      onclick={(e) => e.stopPropagation()}>
      <p class="modal-title">쿠폰 유효기간 연장</p>
      <form method="POST" action="?/extendCoupon"
        use:enhance={() => {
          extendLoading = true
          return ({ update }) => { extendLoading = false; update() }
        }}
      >
        <input type="hidden" name="coupon_id" value={extendCouponId} />
        <div class="form-field">
          <label for="ext-until">새 만료일</label>
          <CmsDatePicker bind:value={extendNewUntil} name="new_until" placeholder="새 만료일 선택" disablePast={false} />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onclick={() => extendCouponId = ''}>취소</button>
          <button type="submit" class="btn-primary" disabled={extendLoading}>
            {extendLoading ? '처리 중...' : '연장 확인'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- 삭제 확인 모달 -->
{#if showDeleteModal}
  <div class="modal-bg" onclick={() => showDeleteModal = false} role="presentation">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="삭제 확인"
      onclick={(e) => e.stopPropagation()}>
      <p class="modal-title">쿠폰 삭제</p>
      <p class="modal-sub"><strong>{deleteCode}</strong> 쿠폰을 삭제합니다.<br>이 작업은 되돌릴 수 없습니다.</p>
      <form method="POST" action="?/deleteCoupon" use:enhance>
        <input type="hidden" name="id" value={deleteId} />
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onclick={() => showDeleteModal = false}>취소</button>
          <button type="submit" class="btn-danger">삭제</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
/* ─ 레이아웃 ─ */
.page-wrap {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 20px 24px 32px;
}

/* ─ 서브탭 ─ */
.sub-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.sub-tab-btn {
  padding: 6px 18px; border: none;
  border-radius: var(--cms-radius-sm);
  background: transparent; color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer;
  min-height: 34px; transition: background 0.15s, color 0.15s;
}
.sub-tab-btn:hover  { background: rgba(59,47,138,0.08); color: var(--cs-text); }
.sub-tab-btn.active { background: var(--cs-white); color: var(--cs-purple); }

/* ─ 섹션 타이틀 ─ */
.section-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 16px; }
.section-title.nm { margin: 0; }

/* ─ KPI 그리드: CmsKpiGrid/CmsKpiCard 공용 컴포넌트로 대체 (dashboard 탭) ─ */

/* ─ 히어로 통계 (게이지 + 바그래프) ─ */
.hero-stats {
  display: flex;
  gap: 24px;
  background: var(--cs-white);
  border-radius: var(--cms-radius-lg);
  padding: 28px 32px;
  margin-bottom: 20px;
  box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
}
.hero-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding-right: 24px;
  border-right: 1px solid var(--cs-surface-gray);
}
.hero-bars {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
}
.hero-bars-title {
  font: var(--text-pc-body-14);
  font-weight: 700;
  color: var(--cs-text);
}

/* ─ 만료 임박 섹션 ─ */
.expire-section       { margin: 20px 0 16px; }
.expire-section-title { font: var(--text-pc-body-14); color: var(--cs-text); margin-bottom: 10px; }
.expire-grid          { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

/* ─ 배포 이력 토글 ─ */
.dist-history-toggle {
  display: flex; align-items: center; gap: 6px;
  background: transparent; border: none; cursor: pointer;
  font: var(--text-pc-body-14); color: var(--cs-purple);
  padding: 8px 0; margin-bottom: 8px;
}

/* ─ 툴바 ─ */
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }

/* ─ 카드 ─ */
.form-card {
  background: var(--cs-white); border-radius: var(--cms-radius-lg);
  padding: 28px; margin-bottom: 16px;
}

.fs-title {
  font: var(--text-pc-body-14); color: var(--cs-purple);
  margin: 20px 0 10px;
  border-bottom: 1px solid var(--cs-surface-gray); padding-bottom: 6px;
}
.fs-title:first-child { margin-top: 0; }
.fs-title.sm { margin-top: 12px; font: var(--text-pc-script-12); }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

/* ─ A-1: 쿠폰 코드 가이드 텍스트 ─ */
.field-hint { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0 0 6px; }

/* ─ A-2: 조합코드 섹션 (products/new 동일 패턴) ─ */
.combo-rows-wrap { margin-top: 4px; margin-bottom: 4px; }
.combo-rows { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.combo-row-btn {
  display: inline-flex; flex-direction: column; align-items: flex-start;
  gap: 4px; padding: 8px 14px;
  border: 1.5px solid #ECEBF4; border-radius: var(--radius-sm);
  background: var(--cs-white); cursor: pointer;
  transition: border-color 0.12s, background 0.12s; min-height: 44px;
}
.combo-row-btn:hover { border-color: rgba(59,47,138,0.35); background: rgba(59,47,138,0.04); }
.combo-row-selected { border-color: var(--cs-purple) !important; background: var(--cs-purple-op10) !important; }
.combo-name-label {
  font: var(--text-pc-descript-10); color: var(--cs-text-light);
  line-height: 1.2; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.combo-row-chips { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; }
.combo-prefix-chip {
  padding: 2px 7px; background: var(--cs-dark); color: var(--cs-white);
  border-radius: 4px; font: var(--text-pc-body-14); font-weight: 700; font-family: 'Courier New', monospace;
}
.combo-row-selected .combo-prefix-chip { background: var(--cs-purple-dark); }
.combo-chips { display: flex; align-items: center; gap: 4px; }
.combo-chip {
  padding: 2px 7px; background: var(--cs-lilac); color: var(--cs-purple-dark);
  border-radius: 4px; font: var(--text-pc-body-14); font-weight: 700;
}
.combo-row-selected .combo-chip { background: var(--cs-purple); color: var(--cs-white); }
.combo-sep { color: var(--cs-text-light); font-size: 11px; }
.combo-meta-chip {
  padding: 2px 7px; border-radius: 4px; font: var(--text-pc-script-12);
  font-weight: 600; font-family: 'Courier New', monospace;
}
.combo-ym-chip { color: var(--cs-text-dark); background: var(--cs-surface-gray); }
.combo-seq-chip { color: var(--cs-purple-dark); background: rgba(59, 47, 138, 0.08); }
.combo-row-selected .combo-ym-chip { color: var(--cs-purple-dark); background: rgba(59, 47, 138, 0.12); }
.combo-row-selected .combo-seq-chip { color: var(--cs-white); background: var(--cs-purple); }
.combo-empty { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 4px 0 0; }

/* ─ 카테고리 피커 ─ */
.cat-picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.cat-chip {
  padding: 4px 12px; border-radius: var(--radius-sm);
  border: 1.5px solid var(--cs-border); background: transparent;
  font: var(--text-pc-script-12); color: var(--cs-text-mid);
  cursor: pointer; min-height: 28px; transition: all 0.12s;
}
.cat-chip.selected { border-color: var(--cs-purple); background: rgba(59,47,138,0.08); color: var(--cs-purple); }

/* ─ 토글 그룹 ─ */
.toggle-group { display: flex; flex-direction: column; gap: 10px; margin-bottom: 4px; }
.toggle-row {
  display: flex; align-items: center; gap: 12px;
  font: var(--text-pc-body-14); color: var(--cs-text);
}
.toggle-row em { font-style: normal; font: var(--text-pc-script-12); color: var(--cs-text-light); }

/* ─ 라디오 ─ */
.radio-group { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; }
.radio-lbl {
  display: flex; align-items: center; gap: 6px;
  font: var(--text-pc-body-14); color: var(--cs-text);
  cursor: pointer; min-height: 28px;
}

/* ─ 자동 발행 박스 ─ */
.auto-box {
  background: var(--cs-lilac); border-radius: var(--cms-radius-sm);
  padding: 16px; margin-top: 8px;
}

/* ─ 필터 폼 ─ */
.filter-form { display: flex; gap: 8px; align-items: center; }
.f-input.sm  { padding: 6px 10px; font: var(--text-pc-script-12); height: 32px; }

/* ─ 폼 액션 ─ */
.form-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  margin-top: 20px; padding-top: 16px;
  border-top: 1px solid var(--cs-surface-gray);
}

/* ─ 목록카드 + DetailPanel 분할 (cms-uiux.md §목록카드+DetailPanel 필수 구조) ─ */
.content-area {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.content-area .table-card {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.content-area.panel-open .table-card { flex: 4; }
.content-area .table-wrap { flex: 1; min-height: 0; overflow-y: auto; overflow-x: auto; }
.detail-panel-wrap {
  flex: 6;
  min-width: 0;
  /* overflow: hidden 추가 금지 — 패널 스크롤 파괴 */
}
.content-area.panel-open .col-hide { display: none; }

/* ─ 테이블 ─ */
.table-card {
  background: var(--cs-white); border-radius: var(--cms-radius-md);
  overflow: hidden; margin-bottom: 16px;
}
table { width: 100%; border-collapse: collapse; font: var(--text-pc-body-14); color: var(--cs-text); }
thead th {
  background: var(--cs-lilac); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); padding: 10px 16px;
  text-align: left; white-space: nowrap;
}
tbody tr { border-bottom: 1px solid var(--cs-surface-gray); cursor: pointer; }
tbody tr:hover { background: rgba(59,47,138,0.04); }
tbody tr.selected { background: rgba(59,47,138,0.08); }
tbody tr:last-child { border-bottom: none; }
td { padding: 10px 16px; vertical-align: middle; }
.td-code { font: var(--text-pc-body-14); color: var(--cs-purple); letter-spacing: .04em; }
.td-date { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.no-data { text-align: center; color: var(--cs-text-light); padding: 32px; }

/* ─ 배포 이력 (접이식 하위 테이블) ─ */
.dist-history-table {
  border-top: 1px solid var(--cs-surface-gray);
  overflow-x: auto;
}

/* ─ 배지 ─ */
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); white-space: nowrap;
}
.badge-active   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
.badge-inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }
.badge-info     { background: rgba(59,47,138,0.08); color: var(--cs-purple); }

/* ─ 토글 ─ */
.tog {
  position: relative; width: 40px; height: 22px; border: none;
  border-radius: var(--radius-full); background: var(--cs-disabled-toggle);
  cursor: pointer; transition: background 0.2s; flex-shrink: 0;
}
.tog.tog-on { background: var(--cs-purple); }
.tog-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--cs-white); transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.tog.tog-on .tog-thumb { transform: translateX(18px); }

/* ─ 버튼 ─ */
.btn-primary {
  background: var(--cs-purple); color: var(--cs-white); border: none;
  border-radius: var(--radius-sm); padding: 8px 16px;
  font: var(--text-pc-body-14); height: 36px; cursor: pointer;
  transition: background 0.15s; white-space: nowrap;
}
.btn-primary:hover    { background: var(--cs-purple-hover); }
.btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
.btn-ghost {
  background: transparent; border: 1.5px solid var(--cs-purple);
  border-radius: var(--radius-sm); color: var(--cs-purple);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s; white-space: nowrap;
}
.btn-ghost:hover { background: rgba(59,47,138,0.06); }
.btn-danger {
  background: transparent; border: 1.5px solid var(--cs-red-badge);
  border-radius: var(--radius-sm); color: var(--cs-red-badge);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s;
}
.btn-danger:hover { background: rgba(255,53,53,0.08); }
.btn-danger.sm, .btn-ghost.sm, .btn-primary.sm {
  padding: 4px 10px; height: 28px; font: var(--text-pc-script-12);
}

/* ─ 입력 필드 ─ */
.f-input {
  background: var(--cs-surface-gray); border: none;
  border-radius: var(--cms-radius-sm); padding: 10px 16px;
  font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
}
.f-input::placeholder { color: var(--cs-text-placeholder); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

/* ─ 모달 ─ */
.modal-bg {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(16,11,50,0.45);
  display: flex; align-items: center; justify-content: center;
}
.modal-box {
  background: var(--cs-white); border-radius: var(--cms-radius-lg);
  padding: 28px 32px; min-width: 320px; max-width: 440px; width: 100%;
}
.modal-title   { font: var(--text-pc-title-16); color: var(--cs-text); margin: 0 0 8px; }
.modal-sub     { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 20px; line-height: 1.6; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
</style>
