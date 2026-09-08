<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { Coupon } from '$lib/types/database'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import { sortByTier, buildComboCategoryCode } from '$lib/utils/comboCategoryCode'
  import { datePart } from '../../../codes/_shared'
  import type { MappingGroupSimple, MappingItemSimple, TaxonomyCodeSimple } from './+page.server'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  // ─ 쿠폰 생성 폼 상태 (항목 7: 목록 화면 +page.svelte의 인라인 폼을 그대로 이전) ─
  let createLoading = $state(false)
  let f_code        = $state('')
  let f_type        = $state('all')
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
  let f_display_name   = $state('')   // 항목 1: 고객 노출용 이름 (신규)
  let f_description    = $state('')   // 관리자 메모(고객에게 노출되지 않음)

  // 원단위 입력 필드 천단위 콤마 표시 — type="number"은 콤마를 표시할 수 없어 text+
  // inputmode="numeric"으로 전환(cms/products/new·cms/set/rental 등 기존 CMS 폼과 동일
  // 관례), 실제 제출값은 각 필드 옆 hidden input(raw 숫자)이 담당
  function parseAmountDigits(raw: string): number {
    const digits = raw.replace(/[^0-9]/g, '')
    return digits ? parseInt(digits, 10) : 0
  }

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
    { id: 'percentage',    label: '정률 (%)' },
    { id: 'free_shipping', label: '무료배송' },
  ]
  // ⛔ 실사용 중 발견된 결함 수정(2026-09-08): 이 목록에 있던 'fixed'/'percent'는
  // coupon_type_enum에 존재하지 않는 값이라(discount_type과 혼동해 잘못 들어간 값 —
  // 실제 enum에는 'all'/'first_purchase'가 있었는데 빠져 있었음), 기본 선택값(f_type='fixed')을
  // 그대로 두고 제출하면 매번 "invalid input value for enum coupon_type_enum" 원문 에러가
  // 그대로 토스트에 노출됐다(Stage DB 직접 재현으로 확인). enum 실제 값 기준으로 교체.
  const TYPE_OPTIONS: SuggestPickerOption[] = [
    { id: 'all',            label: '전체' },
    { id: 'first_purchase', label: '첫구매 전용' },
    { id: 'free_delivery',  label: '무료 배송' },
    { id: 'first_rental',   label: '첫 렌탈 전용' },
    { id: 'category',       label: '카테고리 한정' },
    { id: 'bundle',         label: '번들 렌탈' },
    { id: 'subscription',   label: '정기구독 전용' },
    { id: 'student',        label: '학생 신학기' },
    { id: 'walk_in',        label: '방문 픽업' },
    { id: 'reactivation',   label: '휴면 복귀' },
    { id: 'referral',       label: '추천인' },
    { id: 'event',          label: '이벤트' },
  ]
  const USER_GRADE_OPTIONS: SuggestPickerOption[] = [
    { id: '__all__', label: '전체 회원' },
    { id: 'BASIC',   label: 'BASIC' },
    { id: 'PRO',     label: 'PRO' },
    { id: 'CRAZY',   label: 'CRAZY' },
  ]
  // SuggestPicker bind용 nullable state — 초기값은 폼 상태 기본값과 동일한 리터럴로 지정
  let _sel_dtype = $state<string | null>('fixed')    // f_discount_type 초기값과 동일(discount_type enum엔 'fixed' 존재)
  let _sel_type  = $state<string | null>('all')      // f_type 초기값과 동일(coupon_type_enum 기준 유효값)
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

  // ─ action 에러 처리 (성공 시엔 서버가 목록 화면으로 redirect하므로 이 페이지에 남지 않음) ─
  $effect(() => {
    if (form && 'error' in form && form.error) {
      csToast.error(String(form.error))
    }
  })
</script>

<div class="page-wrap">
  <div class="toolbar">
    <span class="section-title nm">쿠폰 생성</span>
  </div>

  <div class="form-card">
    <form method="POST" action="?/create"
      use:enhance={({ cancel }) => {
        // 항목 2: "제한 기간" 모드인데 날짜가 비어있으면 제출 전에 즉시 차단
        // (CmsDatePicker의 hidden input은 HTML required 검증 대상이 아니라 서버 검증만으로는
        // 늦게 발견되므로, 제출 시점에 한 번 더 확인해 UX를 보강)
        if (f_validity_type === 'fixed_period' && (!f_valid_from || !f_valid_until)) {
          csToast.error('시작일과 종료일을 모두 선택해주세요.')
          cancel()
          return
        }
        createLoading = true
        return ({ update }) => { createLoading = false; update() }
      }}
    >
      <!-- 항목 1: 고객 노출용 "쿠폰 이름" 신설 + "설명"은 관리자 메모로 역할 재분배 —
           "기본 정보" 위에 배치, 아래 여백 추가로 구분(Stephen 지시) -->
      <div class="display-info-section">
        <div class="fs-title fs-title-row">
          <span>표시 정보</span>
          <a href="/cms/promotion/coupon?tab=manage" class="rep-close-btn" aria-label="취소하고 목록으로">✕</a>
        </div>
        <div class="display-info-grid">
          <div class="form-field">
            <label for="fc-dname">쿠폰 이름 (고객 노출, 선택)</label>
            <input id="fc-dname" name="display_name" class="f-input"
              bind:value={f_display_name} placeholder="예) 첫 대여 5,000원 할인" />
          </div>
          <div class="form-field">
            <label for="fc-desc">관리자 메모 (선택, 고객에게 노출되지 않음)</label>
            <input id="fc-desc" name="description" class="f-input"
              bind:value={f_description} placeholder="쿠폰 기능 설명용 내부 메모" />
          </div>
        </div>
      </div>

      <div class="fs-title">기본 정보</div>
      <div class="form-grid">
        <div class="form-field">
          <label for="fc-code">쿠폰 코드</label>
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
          <!-- 항목 4: sequenced 모드(콤보 선택됨)에서는 읽기전용 "코드 표시" 배지로 전환 —
               자유편집 가능한 입력창처럼 보이던 UX 혼란 방지. manual 모드는 그대로 자유편집 -->
          <input id="fc-code" name="code" class="f-input" class:f-input-code-badge={codeMode === 'sequenced'}
            bind:value={f_code} readonly={codeMode === 'sequenced'} required />
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
          <input id="fc-dval" type="text" inputmode="numeric" class="f-input"
            value={f_discount_value.toLocaleString('ko-KR')}
            oninput={(e) => { f_discount_value = parseAmountDigits((e.currentTarget as HTMLInputElement).value) }} />
          <input type="hidden" name="discount_value" value={f_discount_value} />
        </div>
        {#if f_discount_type === 'percentage'}
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
          <input id="fc-mra" type="text" inputmode="numeric" class="f-input"
            value={f_min_rental_amount.toLocaleString('ko-KR')}
            oninput={(e) => { f_min_rental_amount = parseAmountDigits((e.currentTarget as HTMLInputElement).value) }} />
          <input type="hidden" name="min_rental_amount" value={f_min_rental_amount} />
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

      <!-- 항목 5: 세로 나열 토글 스위치 → CMS 표준 .s-chip 콤보버튼(cms-uiux.md §7-12-B,
           cms/set/rental·cms/set/push와 동일 스타일) — hidden input 배선은 그대로 유지 -->
      <div class="fs-title">전용 조건</div>
      <div class="s-chip-group">
        <button type="button" class="s-chip" class:s-chip--on={f_first_rental}
          onclick={() => f_first_rental = !f_first_rental}>첫 렌탈 전용</button>
        <button type="button" class="s-chip" class:s-chip--on={f_student}
          onclick={() => f_student = !f_student}>학생 인증 계정 전용</button>
        <button type="button" class="s-chip" class:s-chip--on={f_walk_in}
          onclick={() => f_walk_in = !f_walk_in}>방문 픽업 전용</button>
        <button type="button" class="s-chip" class:s-chip--on={f_subscription}
          onclick={() => f_subscription = !f_subscription}>정기구독 전용</button>
      </div>
      <input type="hidden" name="is_first_rental_only" value={String(f_first_rental)} />
      <input type="hidden" name="is_student_only" value={String(f_student)} />
      <input type="hidden" name="is_walk_in_only" value={String(f_walk_in)} />
      <input type="hidden" name="is_subscription_only" value={String(f_subscription)} />

      <div class="fs-title">결합 옵션</div>
      <div class="s-chip-group">
        <button type="button" class="s-chip" class:s-chip--on={f_allow_points}
          onclick={() => f_allow_points = !f_allow_points}>포인트 결합 사용 허용</button>
        <button type="button" class="s-chip" class:s-chip--on={f_allow_stacking}
          onclick={() => f_allow_stacking = !f_allow_stacking}>쿠폰 중복 사용 허용</button>
      </div>
      <input type="hidden" name="allow_with_points" value={String(f_allow_points)} />
      <input type="hidden" name="allow_stacking" value={String(f_allow_stacking)} />

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

      <div class="form-actions">
        <a href="/cms/promotion/coupon?tab=manage" class="btn-ghost">취소</a>
        <button type="submit" class="btn-primary" disabled={createLoading}>
          {createLoading ? '저장 중...' : '쿠폰 생성'}
        </button>
      </div>
    </form>
  </div>
</div>

<style>
.page-wrap {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 20px 24px 32px;
}

.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.section-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 16px; }
.section-title.nm { margin: 0; }

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

/* ─ "표시 정보" 타이틀행 취소 버튼 — CMS 표준 close-red(cms-uiux.md §0-10-A,
     rep-close-btn) 재사용, 카드 코너 절대배치 대신 타이틀행 내 flex 배치로 변형 ─ */
.fs-title-row { display: flex; align-items: center; justify-content: space-between; }
.rep-close-btn {
  flex-shrink: 0;
  width: 28px; height: 28px; min-height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: var(--radius-sm);
  color: var(--cs-text-light); font-size: 14px; cursor: pointer;
  text-decoration: none; transition: background 0.12s, color 0.12s;
}
.rep-close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* ─ 항목 1: "표시 정보"(쿠폰 이름 + 관리자 메모) 전용 그룹 래퍼 ─ */
.display-info-section { display: block; margin-bottom: 12px; }
.display-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

/* ─ 조합코드 섹션 (products/new 동일 패턴) ─ */
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

/* ─ 항목 5: CMS 표준 콤보버튼(.s-chip, cms-uiux.md §7-12-B — cms/set/rental·cms/set/push
     와 동일 스타일 토큰, 공유 컴포넌트가 아니라 각 페이지가 로컬 CSS로 복제하는 기존 관례) ─ */
.s-chip-group { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
.s-chip {
  height: 32px; padding: 0 14px;
  border: 1.5px solid var(--cs-lilac);
  border-radius: var(--cms-radius-xl, 30px);
  background: var(--cs-white); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); font-weight: 600;
  cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.s-chip--on { background: var(--cs-purple); color: var(--cs-white); border-color: var(--cs-purple); }
.s-chip:not(.s-chip--on):hover { border-color: var(--cs-purple); color: var(--cs-purple); }

/* ─ 토글 그룹(자동 발행 전용 — 단일 스위치는 기존 .tog 유지) ─ */
.toggle-group { display: flex; flex-direction: column; gap: 10px; margin-bottom: 4px; }
.toggle-row {
  display: flex; align-items: center; gap: 12px;
  font: var(--text-pc-body-14); color: var(--cs-text);
}

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

/* ─ 폼 액션 ─ */
.form-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  margin-top: 20px;
}

/* ─ 토글(자동 발행 전용) ─ */
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
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1.5px solid var(--cs-purple);
  border-radius: var(--radius-sm); color: var(--cs-purple);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s; white-space: nowrap;
  text-decoration: none;
}
.btn-ghost:hover { background: rgba(59,47,138,0.06); }

/* ─ 입력 필드 ─ */
.f-input {
  background: var(--cs-surface-gray); border: none;
  border-radius: var(--cms-radius-sm); padding: 10px 16px;
  font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
}
.f-input::placeholder { color: var(--cs-text-placeholder); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

/* ─ 항목 4: sequenced 모드 코드 표시 배지 — 자유편집 입력창과 구분되는 단순 표시 스타일 ─ */
.f-input-code-badge {
  background: var(--cs-dark); color: var(--cs-white);
  font-weight: 700; font-family: 'Courier New', monospace;
  letter-spacing: .04em; cursor: default;
}
.f-input-code-badge:focus { outline: none; }
</style>
