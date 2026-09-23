<script lang="ts">
  import { tick } from 'svelte'
  import { slide } from 'svelte/transition'
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import type { PageData, ActionData } from './$types'
  import type { RentalPeriodOption, RentalMethodOption, PickupPoint, RentalConsentItem, RentalShippingSettings, PublicHolidayRow, DeliveryFeeDiscountTier } from './+page.server'

  interface Props {
    data: PageData
    form: ActionData
  }

  let { data }: Props = $props()

  // ─── 대여 기간 조건 ───
  let periods = $state<RentalPeriodOption[]>(data.periods)
  let periodInput = $state('')
  let periodLoading = $state(false)

  $effect(() => { periods = data.periods })

  // ─── 대여 방식 ───
  const METHOD_KEYS = [
    { key: 'visit',         label: '방문',              desc: '방문, 내방' },
    { key: 'quick',         label: '퀵서비스',           desc: '퀵서비스, 오토바이 배달' },
    { key: 'delivery',      label: '택배/배송',           desc: '배송, 택배, 자체배송' },
    { key: 'locker',        label: '무인보관함',           desc: '무인, 무인보관함' },
    { key: 'crazydelivery', label: '크레이지배송(자체)', desc: '크레이지배송(자체배송)' },
  ] as const satisfies { key: string; label: string; desc: string }[]

  const METHOD_KEY_LABELS: Record<string, string> = {
    visit: '방문', quick: '퀵', delivery: '택배', locker: '무인', crazydelivery: '크레이지배송', epost: '택배(구)',
  }

  let methods = $state<RentalMethodOption[]>(data.methods)
  let methodInput = $state('')
  let methodKey = $state('')
  let methodDeadlineInput = $state('')
  let methodLoading = $state(false)

  // 기존 대여방식 행의 안내문구(deadline_time) 수정(2026-09-21, Stephen 요청) —
  // 한 번에 한 행만 편집 가능(openCalId와 동일하게 단일 공유 상태로 충분). 내용 길이가
  // 방식마다 균일하지 않을 수 있어 인라인 폼 대신 그 행 바로 아래 아코디언으로 노출.
  let editingDeadlineId = $state<string | null>(null)
  let editingDeadlineValue = $state('')
  // 반납방식 노출용 안내문구(return_deadline_time, Migration #524, 2026-09-23 Stephen 요청) —
  // 수령방식용(editingDeadlineValue)과 완전히 독립된 값. 같은 아코디언 안에서 함께 편집·저장.
  let editingReturnDeadlineValue = $state('')
  let deadlineEditLoading = $state(false)

  function startEditDeadline(item: RentalMethodOption) {
    editingDeadlineId = item.id
    editingDeadlineValue = item.deadline_time ?? ''
    editingReturnDeadlineValue = item.return_deadline_time ?? ''
  }

  function cancelEditDeadline() {
    editingDeadlineId = null
    editingDeadlineValue = ''
    editingReturnDeadlineValue = ''
  }

  // 아코디언이 열릴 때 입력칸에 포커스 — HTML autofocus 속성은 a11y 린트 경고 대상이라
  // (a11y_autofocus) 액션으로 동일 동작을 구현(사용자가 배지를 직접 클릭해 연 결과라
  // 예측 가능한 포커스 이동이라 판단, Escape로 언제든 빠져나올 수 있음).
  function focusOnMount(node: HTMLElement) {
    node.focus()
  }

  // 대여방식별 "사용자 장바구니 화면 노출용 안내문구"(rental_method_options.deadline_time,
  // 예: "19:00 마감") 길이 제한 — 20자 이내(Stephen 확정, 2026-09-21). 문자 종류 제한
  // (한글·영문·숫자만)은 2026-09-21 같은 날 후속 지시로 해제됨 — 공백·콜론 등 특수문자
  // 입력 허용(기존 "19:00 마감" 형식도 그대로 재현 가능해짐). 길이 제한 자체는 유지.
  function filterMethodDeadlineInput(raw: string): string {
    return raw.slice(0, 20)
  }

  let usedMethodKeys = $derived(new Set(methods.map((m) => m.method_key).filter(Boolean)))

  $effect(() => { methods = data.methods })

  // ─── 지점 정보 ───
  let branches = $state<PickupPoint[]>(data.branches)
  let branchInput = $state('')
  let branchLoading = $state(false)
  let expandedBranchId = $state<string | null>(null)
  let branchForms = $state<Record<string, { address: string; phone: string; contact_person: string }>>({})

  $effect(() => {
    branches = data.branches
    // 기존 열린 지점의 폼 데이터 초기화
    branchForms = Object.fromEntries(
      data.branches.map((b) => [
        b.id,
        {
          address: b.address ?? '',
          phone: b.phone ?? '',
          contact_person: b.contact_person ?? '',
        },
      ])
    )
  })

  function formatPhone(val: string): string {
    const digits = val.replace(/\D/g, '').slice(0, 11)
    if (digits.length < 4) return digits
    if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }

  function onPhoneInput(branchId: string, raw: string): void {
    if (branchForms[branchId]) {
      branchForms[branchId].phone = formatPhone(raw)
    }
  }

  // ─── 배송 설정 ───
  let enableRoundTrip  = $state(data.shippingSettings?.enable_round_trip  ?? false)
  let roundTripFee     = $state<number | ''>(data.shippingSettings?.round_trip_fee  ?? '')
  let enableDelivery   = $state(data.shippingSettings?.enable_delivery    ?? false)
  let deliveryFee      = $state<number | ''>(data.shippingSettings?.delivery_fee    ?? '')
  let enableReturn     = $state(data.shippingSettings?.enable_return       ?? false)
  let returnFee        = $state<number | ''>(data.shippingSettings?.return_fee       ?? '')
  let shippingGuide    = $state(data.shippingSettings?.shipping_guide      ?? '')
  let shippingLoading  = $state(false)
  let shippingFormEl = $state<HTMLFormElement | undefined>(undefined)
  let shippingGuideCount = $derived(shippingGuide.length)
  // "안내문 저장" 버튼 — 요금 토글/입력은 전부 자동저장돼 이 버튼은 배송 안내문 전용이므로,
  // 안내문 텍스트가 서버값과 달라졌을 때만 활성화(guideIsDirty와 동일 패턴)
  let shippingGuideIsDirty = $derived.by(() => shippingGuide !== (data.shippingSettings?.shipping_guide ?? ''))

  // 배송(is_bulk_delivery) 방식 행에 배송 설정 요약 표시 — 신규 쿼리 없이 이미 로드된
  // shippingSettings 상태만 재사용(TASK.md "배송 설정 ↔ 대여 방식 옵션 CMS 연동" Part A)
  const shippingBadgeLabel = $derived.by(() => {
    const rt = enableRoundTrip && roundTripFee !== '' ? Number(roundTripFee) : null
    const rf = enableReturn && returnFee !== '' ? Number(returnFee) : null
    if (rt === null && rf === null) return '미설정'
    const parts: string[] = []
    if (rt !== null) parts.push(`왕복 ${rt.toLocaleString()}원`)
    if (rf !== null) parts.push(`반납 ${rf.toLocaleString()}원`)
    return parts.join(' / ')
  })

  $effect(() => {
    enableRoundTrip = data.shippingSettings?.enable_round_trip  ?? false
    roundTripFee    = data.shippingSettings?.round_trip_fee     ?? ''
    enableDelivery  = data.shippingSettings?.enable_delivery    ?? false
    deliveryFee     = data.shippingSettings?.delivery_fee       ?? ''
    enableReturn    = data.shippingSettings?.enable_return       ?? false
    returnFee       = data.shippingSettings?.return_fee          ?? ''
    shippingGuide   = data.shippingSettings?.shipping_guide      ?? ''
  })

  // ─── 택배 휴무일 캘린더 제어 ───
  let enablePrevDayCheck  = $state(data.cutoffSettings?.enable_prev_day_check  ?? false)
  let enableFixedHolidays = $state(data.cutoffSettings?.enable_fixed_holidays  ?? false)
  let enableManualHolidays = $state(data.cutoffSettings?.enable_manual_holidays ?? false)
  let holidayGuideText = $state(data.cutoffSettings?.holiday_guide_text ?? '')
  let holidayGuideCount = $derived(holidayGuideText.length)
  let holidayGuideIsDirty = $derived.by(() => holidayGuideText !== (data.cutoffSettings?.holiday_guide_text ?? ''))
  let cutoffLoading = $state(false)
  let cutoffFormEl = $state<HTMLFormElement | undefined>(undefined)
  let syncLoading = $state(false)
  let manualHolidayDate = $state('')
  let manualHolidayNote = $state('')
  let manualHolidayLoading = $state(false)

  let nationalHolidays = $derived<PublicHolidayRow[]>(data.holidays.filter((h) => h.holiday_type === 'national'))
  let manualHolidays = $derived<PublicHolidayRow[]>(data.holidays.filter((h) => h.holiday_type === 'manual'))

  $effect(() => {
    enablePrevDayCheck   = data.cutoffSettings?.enable_prev_day_check   ?? false
    enableFixedHolidays  = data.cutoffSettings?.enable_fixed_holidays   ?? false
    enableManualHolidays = data.cutoffSettings?.enable_manual_holidays  ?? false
    holidayGuideText     = data.cutoffSettings?.holiday_guide_text      ?? ''
  })

  // ─── 이용안내 ───
  let guideText = $state(data.guideText)
  let guideLoading = $state(false)
  let guideCharCount = $derived(guideText.length)
  let guideIsDirty = $derived.by(() => guideText !== data.guideText)

  $effect(() => { guideText = data.guideText })

  // ─── 필수 동의문 ───
  let consents = $state<RentalConsentItem[]>(data.consents)
  let consentInput = $state('')
  let consentLoading = $state(false)
  let consentCharCount = $derived(consentInput.length)

  $effect(() => { consents = data.consents })

  // ─── 배송료 우대설정 (최대 5개) ───
  let discountTiers = $state<DeliveryFeeDiscountTier[]>(data.discountTiers)
  let tierAmount = $state<number | ''>('')
  // 조건은 다중선택(둘 다 선택 시 AND — 두 조건 모두 충족해야 매칭, Stephen 확정 2026-08-29)
  let tierConditions = $state<Array<'long_term_rental' | 'sale_only_purchase' | 'rental_item'>>([])
  let tierDiscount = $state<'' | 'free' | 'half' | 'base'>('')
  let tierLoading = $state(false)

  const TIER_CONDITION_OPTIONS = [
    { value: 'long_term_rental', label: '3일이상 장기대여' },
    { value: 'sale_only_purchase', label: '판매상품 구매' },
    { value: 'rental_item', label: '대여상품' },
  ] as const satisfies { value: 'long_term_rental' | 'sale_only_purchase' | 'rental_item'; label: string }[]
  // '기본왕복배송요금'(discount_rate=0)은 2026-09-15 Stephen 확정으로 비활성화됨 — 이 값은
  // 곧 "할인 없음"과 동일해서, calcShippingDiscountRate()의 best(초기값 0)를 절대 넘어설 수
  // 없어 등록해도 실질 효과가 전혀 없는 죽은 옵션이었다(cartShippingFee.ts 참고). 목록·기존
  // 등록 데이터는 그대로 남기되(제거 금지, Stephen 지시) 신규 선택만 막는다 — 아래 렌더링에서
  // `value === 'base'`인 항목만 disabled 처리.
  const TIER_DISCOUNT_OPTIONS = [
    { value: 'free', label: '무료' },
    { value: 'half', label: '50% 할인' },
    { value: 'base', label: '기본왕복배송요금' },
  ] as const satisfies { value: 'free' | 'half' | 'base'; label: string }[]
  const TIER_CONDITION_LABELS: Record<string, string> = {
    long_term_rental: '3일이상 장기대여',
    sale_only_purchase: '판매상품 구매',
    rental_item: '대여상품',
  }
  const TIER_DISCOUNT_LABELS: Record<number, string> = { 1: '무료', 0.5: '50% 할인', 0: '기본왕복배송요금' }
  function tierConditionsLabel(types: string[]): string {
    return types.map((t) => TIER_CONDITION_LABELS[t] ?? t).join(' + ')
  }

  $effect(() => { discountTiers = data.discountTiers })

  // ─── 드래그 후 순서 저장 헬퍼 ───
  async function savePeriodOrder(): Promise<void> {
    const ids = periods.map((p) => p.id)
    const fd = new FormData()
    fd.set('ids', JSON.stringify(ids))
    await fetch('?/reorderPeriods', { method: 'POST', body: fd })
    await invalidateAll()
  }

  async function saveMethodOrder(): Promise<void> {
    const ids = methods.map((m) => m.id)
    const fd = new FormData()
    fd.set('ids', JSON.stringify(ids))
    await fetch('?/reorderMethods', { method: 'POST', body: fd })
    await invalidateAll()
  }

  async function saveConsentOrder(): Promise<void> {
    const ids = consents.map((c) => c.id)
    const fd = new FormData()
    fd.set('ids', JSON.stringify(ids))
    await fetch('?/reorderConsents', { method: 'POST', body: fd })
    await invalidateAll()
  }
</script>

<div class="page-wrap">


  <div class="sections">

    <!-- ══════════════════════════════════════════
         섹션 1: 대여 기간 조건
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">대여 기간 제한 옵션</h2>
        <span class="section-badge">{periods.length} / 10</span>
      </div>

      <form
        method="POST"
        action="?/addPeriod"
        class="add-form"
        use:enhance={({ formData }) => {
          formData.set('count', String(periods.length))
          periodLoading = true
          return async ({ result, update }) => {
            periodLoading = false
            if (result.type === 'success') {
              periodInput = ''
              csToast.success('대여 기간 조건이 추가되었습니다.')
              await update({ reset: false })
            } else if (result.type === 'failure') {
              csToast.error((result.data as { error?: string })?.error ?? '추가에 실패했습니다.')
            }
          }
        }}
      >
        <input
          type="text"
          name="name"
          class="add-input"
          placeholder="조건명 입력 (예: 12시간 대여)"
          maxlength="50"
          bind:value={periodInput}
          disabled={periodLoading}
          aria-label="대여 기간 조건명"
        />
        <button
          type="submit"
          class="btn-add"
          disabled={periodLoading || !periodInput.trim() || periods.length >= 10}
        >
          {periodLoading ? '추가 중...' : '추가'}
        </button>
      </form>

      {#if periods.length > 0}
        <CmsDragList
          bind:items={periods}
          itemKey={(item) => item.id}
          onreorder={savePeriodOrder}
          class="drag-list-wrap"
        >
          {#snippet renderItem(item: RentalPeriodOption)}
            <div class="list-row">
              <span class="list-row-name">{item.name}</span>
              <CmsDeleteButton action="?/deletePeriod" id={item.id} />
            </div>
          {/snippet}
        </CmsDragList>
      {:else}
        <p class="empty-hint">등록된 대여 기간 조건이 없습니다.</p>
      {/if}
    </section>

    <!-- ══════════════════════════════════════════
         섹션 2: 대여 방식
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">대여 방식 옵션</h2>
        <span class="section-badge">{methods.length} / 10</span>
      </div>

      <form
        method="POST"
        action="?/addMethod"
        class="add-form add-form--method"
        use:enhance={({ formData, cancel }) => {
          if (!methodKey) { csToast.error('방식 유형을 선택하세요.'); cancel(); return }
          formData.set('count', String(methods.length))
          methodLoading = true
          return async ({ result, update }) => {
            methodLoading = false
            if (result.type === 'success') {
              methodInput = ''
              methodKey = ''
              methodDeadlineInput = ''
              csToast.success('대여 방식이 추가되었습니다.')
              await update({ reset: false })
            } else if (result.type === 'failure') {
              csToast.error((result.data as { error?: string })?.error ?? '추가에 실패했습니다.')
            }
          }
        }}
      >
        <!-- method_key 선택 -->
        <div class="mk-select-row">
          <span class="mk-select-label">방식 유형</span>
          <div class="mk-chips">
            {#each METHOD_KEYS as mk}
              <button
                type="button"
                class="mk-chip"
                class:mk-chip--on={methodKey === mk.key}
                class:mk-chip--used={usedMethodKeys.has(mk.key)}
                disabled={usedMethodKeys.has(mk.key) && methodKey !== mk.key}
                title={usedMethodKeys.has(mk.key) ? '이미 사용 중' : mk.desc}
                onclick={() => { methodKey = methodKey === mk.key ? '' : mk.key }}
              >{mk.label}</button>
            {/each}
          </div>
        </div>
        <input type="hidden" name="method_key" value={methodKey} />

        <div class="mk-name-row">
          <input
            type="text"
            name="name"
            class="add-input add-input--method-name"
            placeholder="대여방식명 입력 (예: 일반 대여)"
            maxlength="50"
            bind:value={methodInput}
            disabled={methodLoading}
            aria-label="대여방식명"
          />
          <input
            type="text"
            name="deadline_time"
            class="add-input add-input--method-deadline"
            placeholder="안내문구 (예: 19시마감, 20자)"
            maxlength="20"
            value={methodDeadlineInput}
            oninput={(e) => {
              methodDeadlineInput = filterMethodDeadlineInput(e.currentTarget.value)
              e.currentTarget.value = methodDeadlineInput
            }}
            disabled={methodLoading}
            aria-label="장바구니 노출 안내문구"
          />
          <button
            type="submit"
            class="btn-add"
            disabled={methodLoading || !methodInput.trim() || !methodKey || methods.length >= 10}
          >
            {methodLoading ? '추가 중...' : '추가'}
          </button>
        </div>
      </form>

      {#if methods.length > 0}
        <CmsDragList
          bind:items={methods}
          itemKey={(item) => item.id}
          onreorder={saveMethodOrder}
          class="drag-list-wrap mk-methods-list"
        >
          {#snippet renderItem(item: RentalMethodOption)}
            <div class="list-row">
              <span class="list-row-name">{item.name}</span>
              {#if item.method_key}
                <span class="mk-badge">{METHOD_KEY_LABELS[item.method_key] ?? item.method_key}</span>
              {/if}
              <!-- 안내문구(deadline_time) 배지 — 내용 길이가 방식마다 제각각일 수 있어
                   텍스트에 말줄임(ellipsis) 적용(2026-09-21 후속, Stephen 지시). 클릭하면
                   그 "행 자체" 바로 아래로 아코디언이 펼쳐진다(.mk-methods-list 전용
                   flex-wrap 오버라이드로 구현). 우측 ChevronIcon으로 펼침/접힘 상태를
                   예측 가능하게 표시(uiux-index.md 표준 — 아코디언·리스트 화살표는
                   ChevronIcon 단독 표준, 인라인 SVG 신규 작성 금지) — 닫힘=down(펼칠 수
                   있음을 암시), 열림=up(접을 수 있음을 암시). -->
              {#if item.deadline_time}
                <button
                  type="button"
                  class="mk-badge mk-badge--deadline mk-badge--editable"
                  class:mk-badge--active={editingDeadlineId === item.id}
                  title={item.deadline_time}
                  onclick={() => (editingDeadlineId === item.id ? cancelEditDeadline() : startEditDeadline(item))}
                >
                  <span class="mk-badge-text">{item.deadline_time}</span>
                  <ChevronIcon direction={editingDeadlineId === item.id ? 'up' : 'down'} size={7} color="currentColor" />
                </button>
              {:else}
                <button
                  type="button"
                  class="mk-badge mk-badge--deadline-empty"
                  class:mk-badge--active={editingDeadlineId === item.id}
                  title="클릭하여 안내문구 추가"
                  onclick={() => (editingDeadlineId === item.id ? cancelEditDeadline() : startEditDeadline(item))}
                >
                  <span class="mk-badge-text">안내문구 추가</span>
                  <ChevronIcon direction={editingDeadlineId === item.id ? 'up' : 'down'} size={7} color="currentColor" />
                </button>
              {/if}
              {#if item.is_bulk_delivery}
                <span class="mk-badge mk-badge--shipping">{shippingBadgeLabel}</span>
              {/if}
              <CmsDeleteButton action="?/deleteMethod" id={item.id} />
            </div>
            {#if editingDeadlineId === item.id}
              <!-- 안내문구(deadline_time) 수정 아코디언(2026-09-21, Stephen 지시로 위치
                   재설계 — 목록 전체 하단이 아니라 "그 행 바로 아래"에 펼쳐져야 함) —
                   .mk-methods-list 전용 flex-wrap:wrap 오버라이드(아래 :global 규칙) 위에서
                   flex-basis:100%로 강제 줄바꿈시켜, 같은 .drag-list-item 안에서 .list-row
                   다음 줄로 내려오도록 만든다. name/method_key/display_order는
                   upsert_rental_method_option UPDATE 분기가 무조건 덮어쓰므로(COALESCE
                   대상 아님) 그 방식의 현재값을 hidden으로 그대로 재전송. -->
              <!-- draggable="false"(QA 권고, 2026-09-21) — 조상 .drag-list-item이
                   draggable="true"라 이 아코디언 영역에서 마우스를 누른 채 살짝만
                   움직여도 드래그 재정렬이 시작될 수 있음(인접 행과 높이가 가까워짐) —
                   저장/취소 버튼 조작 중 의도치 않은 순서변경+자동저장 방지. -->
              <div class="mk-deadline-accordion" draggable="false" transition:slide={{ duration: 200 }}>
                <form
                  method="POST"
                  action="?/updateMethodDeadline"
                  class="mk-deadline-edit-form"
                  use:enhance={() => {
                    deadlineEditLoading = true
                    return async ({ result, update }) => {
                      deadlineEditLoading = false
                      if (result.type === 'success') {
                        cancelEditDeadline()
                        await update({ reset: false })
                      } else if (result.type === 'failure') {
                        csToast.error((result.data as { error?: string })?.error ?? '수정에 실패했습니다.')
                      }
                    }
                  }}
                >
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="name" value={item.name} />
                  <input type="hidden" name="display_order" value={item.display_order} />
                  <input type="hidden" name="method_key" value={item.method_key ?? ''} />
                  <div class="mk-deadline-field-row">
                    <span class="mk-deadline-field-label">수령방식</span>
                    <input
                      type="text"
                      name="deadline_time"
                      class="mk-deadline-edit-input"
                      value={editingDeadlineValue}
                      maxlength="20"
                      placeholder="안내문구 (예: 19시마감, 20자)"
                      aria-label="수령방식 안내문구 수정"
                      disabled={deadlineEditLoading}
                      use:focusOnMount
                      onkeydown={(e) => {
                        if (e.key === 'Escape') { e.preventDefault(); cancelEditDeadline() }
                      }}
                      oninput={(e) => {
                        editingDeadlineValue = filterMethodDeadlineInput(e.currentTarget.value)
                        e.currentTarget.value = editingDeadlineValue
                      }}
                    />
                  </div>
                  <!-- 반납방식 노출용 안내문구(return_deadline_time, Migration #524,
                       2026-09-23 Stephen 요청) — 수령방식 입력행과 완전히 독립된 두 번째
                       필드. 같은 폼에서 함께 저장(부분필드 전송 위험 방지 — service-
                       operations.md §18 관례와 동일하게 항상 두 필드 모두 재전송). -->
                  <div class="mk-deadline-field-row">
                    <span class="mk-deadline-field-label">반납방식</span>
                    <input
                      type="text"
                      name="return_deadline_time"
                      class="mk-deadline-edit-input"
                      value={editingReturnDeadlineValue}
                      maxlength="20"
                      placeholder="안내문구 (예: 19시마감, 20자)"
                      aria-label="반납방식 안내문구 수정"
                      disabled={deadlineEditLoading}
                      onkeydown={(e) => {
                        if (e.key === 'Escape') { e.preventDefault(); cancelEditDeadline() }
                      }}
                      oninput={(e) => {
                        editingReturnDeadlineValue = filterMethodDeadlineInput(e.currentTarget.value)
                        e.currentTarget.value = editingReturnDeadlineValue
                      }}
                    />
                  </div>
                  <div class="mk-deadline-actions-row">
                    <button type="submit" class="btn-add" disabled={deadlineEditLoading}>
                      {deadlineEditLoading ? '저장 중...' : '저장'}
                    </button>
                    <button type="button" class="mk-deadline-btn mk-deadline-btn--cancel" disabled={deadlineEditLoading} aria-label="취소" title="취소" onclick={cancelEditDeadline}>✕</button>
                  </div>
                </form>
              </div>
            {/if}
          {/snippet}
        </CmsDragList>
      {:else}
        <p class="empty-hint">등록된 대여 방식이 없습니다.</p>
      {/if}
    </section>

    <!-- ══════════════════════════════════════════
         섹션 3: 배송 설정
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">배송 설정</h2>
      </div>

      <form
        method="POST"
        action="?/saveShipping"
        class="shipping-form"
        bind:this={shippingFormEl}
        use:enhance={() => {
          shippingLoading = true
          return async ({ result, update }) => {
            shippingLoading = false
            if (result.type === 'success') {
              csToast.success('배송 설정이 저장되었습니다.')
              await update({ reset: false })
            } else if (result.type === 'failure') {
              csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
            }
          }
        }}
      >
        <!-- boolean 플래그 hidden inputs -->
        <input type="hidden" name="enable_round_trip" value={enableRoundTrip ? 'true' : 'false'} />
        <input type="hidden" name="enable_delivery"   value={enableDelivery   ? 'true' : 'false'} />
        <input type="hidden" name="enable_return"      value={enableReturn      ? 'true' : 'false'} />

        <!-- 요금 입력 (활성/비활성) -->
        <div class="fee-grid fee-grid--spaced">
          <div class="fee-row" class:fee-row--disabled={!enableRoundTrip}>
            <span class="fee-label">왕복요금</span>
            <div class="fee-input-wrap">
              <input type="hidden" name="round_trip_fee" value={roundTripFee} />
              <input
                type="text"
                inputmode="numeric"
                class="add-input fee-input"
                value={roundTripFee === '' ? '' : roundTripFee.toLocaleString('ko-KR')}
                disabled={!enableRoundTrip}
                placeholder="0"
                aria-label="왕복요금"
                oninput={(e) => {
                  const digits = e.currentTarget.value.replace(/[^0-9]/g, '')
                  roundTripFee = digits ? parseInt(digits, 10) : ''
                }}
                onblur={async () => { await tick(); shippingFormEl?.requestSubmit() }}
              />
              <span class="fee-unit">원</span>
            </div>
            <button
              type="button"
              class="s-chip fee-chip"
              class:s-chip--on={enableRoundTrip}
              disabled={shippingLoading}
              onclick={async () => { enableRoundTrip = !enableRoundTrip; await tick(); shippingFormEl?.requestSubmit() }}
            >왕복요금</button>
          </div>
          <div class="fee-row" class:fee-row--disabled={!enableDelivery}>
            <span class="fee-label">배송요금</span>
            <div class="fee-input-wrap">
              <input type="hidden" name="delivery_fee" value={deliveryFee} />
              <input
                type="text"
                inputmode="numeric"
                class="add-input fee-input"
                value={deliveryFee === '' ? '' : deliveryFee.toLocaleString('ko-KR')}
                disabled={!enableDelivery}
                placeholder="0"
                aria-label="배송요금"
                oninput={(e) => {
                  const digits = e.currentTarget.value.replace(/[^0-9]/g, '')
                  deliveryFee = digits ? parseInt(digits, 10) : ''
                }}
                onblur={async () => { await tick(); shippingFormEl?.requestSubmit() }}
              />
              <span class="fee-unit">원</span>
            </div>
            <button
              type="button"
              class="s-chip fee-chip"
              class:s-chip--on={enableDelivery}
              disabled={shippingLoading}
              onclick={async () => { enableDelivery = !enableDelivery; await tick(); shippingFormEl?.requestSubmit() }}
            >배송요금</button>
          </div>
          <div class="fee-row" class:fee-row--disabled={!enableReturn}>
            <span class="fee-label">반납요금</span>
            <div class="fee-input-wrap">
              <input type="hidden" name="return_fee" value={returnFee} />
              <input
                type="text"
                inputmode="numeric"
                class="add-input fee-input"
                value={returnFee === '' ? '' : returnFee.toLocaleString('ko-KR')}
                disabled={!enableReturn}
                placeholder="0"
                aria-label="반납요금"
                oninput={(e) => {
                  const digits = e.currentTarget.value.replace(/[^0-9]/g, '')
                  returnFee = digits ? parseInt(digits, 10) : ''
                }}
                onblur={async () => { await tick(); shippingFormEl?.requestSubmit() }}
              />
              <span class="fee-unit">원</span>
            </div>
            <button
              type="button"
              class="s-chip fee-chip"
              class:s-chip--on={enableReturn}
              disabled={shippingLoading}
              onclick={async () => { enableReturn = !enableReturn; await tick(); shippingFormEl?.requestSubmit() }}
            >반납요금</button>
          </div>
        </div>

        <!-- 배송 안내문 (200자) -->
        <div class="subsection shipping-guide-sub shipping-guide-sub--spaced">
          <div class="subsection-head">
            <h3 class="subsection-title">배송 안내문</h3>
          </div>
          <div class="textarea-wrap">
            <textarea
              name="shipping_guide"
              class="guide-textarea guide-textarea--has-save-btn"
              maxlength="200"
              rows="4"
              bind:value={shippingGuide}
              placeholder="고객에게 표시될 배송 안내문을 입력하세요. (200자 이내)"
              aria-label="배송 안내문"
            ></textarea>
            <span class="char-count" class:char-count--warn={shippingGuideCount > 180}
              >{shippingGuideCount} / 200</span
            >
            <button
              type="submit"
              class="btn-save textarea-save-btn"
              disabled={shippingLoading || !shippingGuideIsDirty}
            >
              {shippingLoading ? '저장 중...' : '안내문 저장'}
            </button>
          </div>
        </div>
      </form>

      <!-- 대여옵션 일괄적용·제한·휴무일 제어 옵션 통합 레이아웃 -->
      <div class="rental-restriction-group">
      <!-- 배송대여 수령/반납 일괄 지정(요청 A) + 대여 제한옵션 — 하나의 카드로 통합 레이아웃
           (2026-08-30, Stephen 지시로 두 sf-row를 단일 div로 병합) -->
      <div class="subsection bulk-delivery-section bulk-delivery-section--group-start">
        <div class="sf-row">
          <span class="sf-label">대여옵션(수령/반납) 일괄적용</span>
          <div class="shipping-chips">
            {#each methods as m (m.id)}
              <form
                method="POST"
                action="?/toggleBulkDelivery"
                class="chip-form"
                use:enhance={() => {
                  return async ({ result, update }) => {
                    if (result.type === 'success') {
                      await update({ reset: false })
                    } else if (result.type === 'failure') {
                      csToast.error((result.data as { error?: string })?.error ?? '변경에 실패했습니다.')
                    }
                  }
                }}
              >
                <input type="hidden" name="id" value={m.id} />
                <button type="submit" class="s-chip" class:s-chip--on={m.is_bulk_delivery}>
                  {m.name}
                </button>
              </form>
            {/each}
          </div>
        </div>
        <!-- 휴무일 캘린더 제한 대상(택배사 의존 여부) — 위 "일괄적용"(요청 A, 반납방식
             강제고정용)과는 별개 목적(감사 RSC-B3, 2026-08-30 신설). 공휴일·일요일에 이
             방식의 날짜 선택을 막을지 여기서만 독립적으로 결정한다. -->
        <div class="sf-row">
          <span class="sf-label">휴무일 제한 방식</span>
          <div class="shipping-chips">
            {#each methods as m (m.id)}
              <form
                method="POST"
                action="?/toggleCourierDependent"
                class="chip-form"
                use:enhance={() => {
                  return async ({ result, update }) => {
                    if (result.type === 'success') {
                      await update({ reset: false })
                    } else if (result.type === 'failure') {
                      csToast.error((result.data as { error?: string })?.error ?? '변경에 실패했습니다.')
                    }
                  }
                }}
              >
                <input type="hidden" name="id" value={m.id} />
                <button type="submit" class="s-chip" class:s-chip--on={m.is_courier_dependent}>
                  {m.name}
                </button>
              </form>
            {/each}
          </div>
        </div>
        {#if methods.length === 0}
          <p class="empty-hint">등록된 대여 방식이 없습니다. "대여 방식 옵션" 섹션에서 먼저 등록해주세요.</p>
        {/if}

        <!-- "배송 반납 허용 지정" — 위 "대여옵션(수령/반납) 일괄적용"(is_bulk_delivery, "요청 A"
             전용)과 완전히 분리된 플래그(Migration #440).

             ⛔ 2026-09-04 라벨 정정(Stephen 지적) — "반납 배송선택 제한 대상"이라는 원래 라벨이
             ON/OFF 방향을 헷갈리게 만들어 실제로 반대로 설정하는 오조작이 발생함. "배송 방식
             지정"으로 라벨을 단순화하고, ON 시 정확히 무슨 일이 일어나는지(반납 콤보에서 제외)
             를 캡션으로 명시해 방향성 오독을 방지한다.

             ⛔ 2026-09-04(같은 세션 후속) Stephen UX 지적으로 별도 마스터 on/off 토글("대여옵션
             제한 → 반납 배송선택 제한")을 완전히 제거(Migration #443, 컬럼+RPC 모두 DROP) —
             칩과 별개로 켜야 하는 스위치가 하나 더 있는 구조 자체가 혼란스럽다는 지적. 이제
             이 칩에서 ON으로 지정한 방식이 있다는 사실 자체가 곧 활성화 조건이다.

             ⛔ 2026-09-04(같은 날 재후속, Stephen 확정) — 이전엔 is_bulk_delivery와 동시에 켤 수
             없도록 RPC 상호배타 가드가 있었으나(Migration #441, "일괄적용이 켜진 방식은 반납이
             이미 그 값으로 강제고정돼 이 판정 대상으로 삼는 것 자체가 의미 없다"는 전제), 이
             전제가 틀렸음이 확인됨 — is_bulk_delivery는 "이 방식이 수령일 때"의 동작(반납
             강제복사+시간숨김+순수청구)을, is_delivery_type은 "이 방식이 수령이 아닐 때" 반납
             옵션 목록 노출을 규정하는 서로 겹치지 않는 독립 조건이라, 크레이지샷배송처럼 같은
             방식이 두 동작을 동시에 필요로 하는 경우가 실제로 있었다(크레이지샷배송을 수령으로
             선택해도 반납이 자동 동기화되지 않던 실사용 결함으로 발견). Migration #444로 RPC
             상호배타 가드 제거 — 이제 두 칩을 동일 방식에 동시에 켤 수 있다. -->
        <div class="sf-row">
          <span class="sf-label">배송 반납 허용 지정</span>
          <div class="shipping-chips">
            {#each methods as m (m.id)}
              <form
                method="POST"
                action="?/toggleDeliveryType"
                class="chip-form"
                use:enhance={() => {
                  return async ({ result, update }) => {
                    if (result.type === 'success') {
                      await update({ reset: false })
                    } else if (result.type === 'failure') {
                      csToast.error((result.data as { error?: string })?.error ?? '변경에 실패했습니다.')
                    }
                  }
                }}
              >
                <input type="hidden" name="id" value={m.id} />
                <button type="submit" class="s-chip" class:s-chip--on={m.is_delivery_type}>
                  {m.name}
                </button>
              </form>
            {/each}
          </div>
        </div>
      </div>

      <!-- 배송료 우대설정 — 대여금액+조건 만족 시 배송비(왕복+배송+반납 합계)를 할인해주는
           조합 규칙(최대 5개). 여러 조합이 동시 매칭되면 가장 유리한(할인율 큰) 조합 1개만
           자동 적용(스태킹 없음), 대여금액은 장바구니 전체 합계(otSubtotal) 기준. -->
      <div class="subsection bulk-delivery-section discount-tier-section">
        <div class="sf-row discount-tier-title-row">
          <span class="sf-label">배송료 우대설정</span>
          <span class="section-badge">{discountTiers.length} / 5</span>
        </div>

        <div class="discount-tier-block">
        <form
          method="POST"
          action="?/addDiscountTier"
          class="add-form add-form--method"
          use:enhance={({ formData, cancel }) => {
            if (tierAmount === '') { csToast.error('대여금액을 입력하세요.'); cancel(); return }
            if (tierConditions.length === 0) { csToast.error('조건을 선택하세요.'); cancel(); return }
            if (!tierDiscount) { csToast.error('우대옵션을 선택하세요.'); cancel(); return }
            formData.set('count', String(discountTiers.length))
            tierLoading = true
            return async ({ result, update }) => {
              tierLoading = false
              if (result.type === 'success') {
                tierAmount = ''
                tierConditions = []
                tierDiscount = ''
                csToast.success('배송료 우대설정이 추가되었습니다.')
                await update({ reset: false })
              } else if (result.type === 'failure') {
                csToast.error((result.data as { error?: string })?.error ?? '추가에 실패했습니다.')
              }
            }
          }}
        >
          <input type="hidden" name="min_rental_amount" value={tierAmount} />
          <input type="hidden" name="condition_types" value={JSON.stringify(tierConditions)} />
          <input type="hidden" name="discount_rate" value={tierDiscount} />

          <div class="tier-input-row">
            <div class="fee-input-wrap">
              <input
                type="text"
                inputmode="numeric"
                class="add-input fee-input"
                value={tierAmount === '' ? '' : tierAmount.toLocaleString('ko-KR')}
                placeholder="0"
                aria-label="대여금액"
                disabled={tierLoading}
                oninput={(e) => {
                  const digits = e.currentTarget.value.replace(/[^0-9]/g, '')
                  tierAmount = digits ? parseInt(digits, 10) : ''
                }}
              />
              <span class="fee-unit">원 이상</span>
            </div>

            <div class="mk-select-row">
              <span class="mk-select-label">조건</span>
              <!-- 다중선택(독립 토글) — cms-uiux.md §7-12-B .s-chip 표준. 둘 다 선택 시 AND
                   (두 조건 모두 충족해야 매칭, Stephen 확정 2026-08-29) -->
              <div class="mk-chips">
                {#each TIER_CONDITION_OPTIONS as opt}
                  <button
                    type="button"
                    class="s-chip"
                    class:s-chip--on={tierConditions.includes(opt.value)}
                    onclick={() => {
                      tierConditions = tierConditions.includes(opt.value)
                        ? tierConditions.filter((v) => v !== opt.value)
                        : [...tierConditions, opt.value]
                    }}
                  >{opt.label}</button>
                {/each}
              </div>
            </div>

            <div class="mk-select-row">
              <span class="mk-select-label">우대옵션</span>
              <div class="mk-chips">
                {#each TIER_DISCOUNT_OPTIONS as opt}
                  <button
                    type="button"
                    class="mk-chip"
                    class:mk-chip--on={tierDiscount === opt.value}
                    class:mk-chip--used={opt.value === 'base'}
                    disabled={opt.value === 'base'}
                    title={
                      opt.value === 'base'
                        ? '실질 할인 효과가 없어 선택할 수 없습니다(0% 할인과 동일)'
                        : opt.value === 'half'
                          ? '왕복배송료(수령·반납 둘 다 배송)에만 적용됩니다 — 편도(배송만/반납만)요금에는 적용되지 않습니다'
                          : undefined
                    }
                    onclick={() => { tierDiscount = tierDiscount === opt.value ? '' : opt.value }}
                  >{opt.label}</button>
                {/each}
              </div>
            </div>

            <button
              type="submit"
              class="btn-add tier-add-btn"
              disabled={tierLoading || discountTiers.length >= 5}
            >
              {tierLoading ? '추가 중...' : '추가'}
            </button>
          </div>
        </form>

        {#if discountTiers.length > 0}
          <div class="drag-list-wrap">
            {#each discountTiers as tier (tier.id)}
              <div class="list-row">
                <span class="mk-badge">{tier.min_rental_amount.toLocaleString('ko-KR')}원 이상</span>
                <span class="list-row-name">{tierConditionsLabel(tier.condition_types)}</span>
                <span class="mk-badge mk-badge--shipping">{TIER_DISCOUNT_LABELS[tier.discount_rate]}</span>
                <CmsDeleteButton action="?/deleteDiscountTier" id={tier.id} successMessage="배송료 우대설정이 삭제되었습니다." />
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-hint">등록된 배송료 우대설정이 없습니다.</p>
        {/if}
        </div>
      </div>

      <!-- 택배 휴무일 캘린더 제어 — /cart 수령·반납 캘린더의 휴무 기반 선택 제한 -->
      <div class="subsection">
        <form
          method="POST"
          action="?/saveCutoffSettings"
          bind:this={cutoffFormEl}
          use:enhance={() => {
            cutoffLoading = true
            return async ({ result, update }) => {
              cutoffLoading = false
              if (result.type === 'success') {
                await update({ reset: false })
              } else if (result.type === 'failure') {
                csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
              }
            }
          }}
        >
          <div class="sf-row holiday-toggle-row">
            <span class="sf-label">휴무일 제어 옵션</span>
            <div class="shipping-chips">
              <button
                type="button"
                class="s-chip"
                class:s-chip--on={enablePrevDayCheck}
                disabled={cutoffLoading}
                onclick={async () => { enablePrevDayCheck = !enablePrevDayCheck; await tick(); cutoffFormEl?.requestSubmit() }}
              >전날/당일 휴무 체크 (필수, 마스터)</button>
              <button
                type="button"
                class="s-chip"
                class:s-chip--on={enableFixedHolidays}
                disabled={cutoffLoading || !enablePrevDayCheck}
                onclick={async () => { enableFixedHolidays = !enableFixedHolidays; await tick(); cutoffFormEl?.requestSubmit() }}
              >고정 휴무일 연동(일·법정공휴일)</button>
              <button
                type="button"
                class="s-chip"
                class:s-chip--on={enableManualHolidays}
                disabled={cutoffLoading || !enablePrevDayCheck}
                onclick={async () => { enableManualHolidays = !enableManualHolidays; await tick(); cutoffFormEl?.requestSubmit() }}
              >임시 휴무일 반영</button>
            </div>
          </div>

          <div class="textarea-wrap">
            <textarea
              name="holiday_guide_text"
              class="guide-textarea guide-textarea--has-save-btn"
              maxlength="200"
              rows="3"
              bind:value={holidayGuideText}
              disabled={cutoffLoading}
              placeholder="배송 휴무일이 포함된 예약 시 장바구니 달력 하단에 노출될 안내문을 입력하세요. (200자 이내)"
              aria-label="배송 휴무일 안내 스크립트"
            ></textarea>
            <span class="char-count" class:char-count--warn={holidayGuideCount > 180}
              >{holidayGuideCount} / 200</span
            >
            <button
              type="submit"
              class="btn-save textarea-save-btn"
              disabled={cutoffLoading || !holidayGuideIsDirty}
            >
              {cutoffLoading ? '저장 중...' : '안내문 저장'}
            </button>
          </div>

          <input type="hidden" name="enable_prev_day_check" value={enablePrevDayCheck ? 'true' : 'false'} />
          <input type="hidden" name="enable_fixed_holidays" value={enableFixedHolidays ? 'true' : 'false'} />
          <input type="hidden" name="enable_manual_holidays" value={enableManualHolidays ? 'true' : 'false'} />
        </form>

        <!-- 법정공휴일 목록(읽기전용, API 자동 동기화) -->
        <div class="holiday-block">
          <div class="subsection-head subsection-head--between">
            <h4 class="subsection-title">법정공휴일 (자동 동기화)</h4>
            <form
              method="POST"
              action="?/syncHolidaysNow"
              use:enhance={() => {
                syncLoading = true
                return async ({ result, update }) => {
                  syncLoading = false
                  if (result.type === 'success') {
                    const d = result.data as { upserted?: number } | undefined
                    csToast.success(`동기화 완료(${d?.upserted ?? 0}건 반영)`)
                    await update({ reset: false })
                  } else if (result.type === 'failure') {
                    csToast.error((result.data as { error?: string })?.error ?? '동기화에 실패했습니다.')
                  }
                }
              }}
            >
              <button type="submit" class="btn-add btn-sync" disabled={syncLoading}>
                <svg class="btn-sync-icon" width="14" height="14" viewBox="0 0 33 33" fill="none" aria-hidden="true">
                  <path d="M2.30298 12.874C3.40107 12.9931 4.19442 13.98 4.07544 15.0781C3.67277 18.7921 4.87692 22.6365 7.67114 25.4697C10.0357 27.8672 13.7943 29.1514 17.5168 28.9863C19.5746 28.8951 21.5067 28.3688 23.1165 27.4336H22.6819C21.5775 27.4334 20.6819 26.538 20.6819 25.4336C20.6819 24.3292 21.5775 23.4338 22.6819 23.4336H27.9817L28.1848 23.4434C29.1866 23.5446 29.9717 24.3858 29.9817 25.4141L30.0325 30.7529C30.043 31.8573 29.1563 32.7617 28.052 32.7725C26.9477 32.7829 26.0432 31.8963 26.0325 30.792L26.0276 30.3232C23.5835 32.0041 20.6224 32.8525 17.6936 32.9824C13.0533 33.1881 8.12127 31.622 4.82349 28.2783C1.14351 24.5471 -0.42663 19.4953 0.098877 14.6475C0.217924 13.5495 1.20502 12.7552 2.30298 12.874ZM15.3176 0.0214844C19.953 -0.201191 24.8738 1.32964 28.177 4.67871C31.8565 8.40943 33.4264 13.4604 32.9016 18.3076C32.7826 19.4056 31.7956 20.199 30.6975 20.0801C29.5998 19.9609 28.8063 18.9748 28.925 17.877C29.3271 14.1636 28.1232 10.32 25.3293 7.4873C22.97 5.09521 19.2339 3.83776 15.51 4.0166C13.492 4.11358 11.5847 4.62527 9.97485 5.52344H10.3167C11.4212 5.52344 12.3166 6.41895 12.3167 7.52344C12.3167 8.62801 11.4212 9.52344 10.3167 9.52344H4.96606C3.86172 9.52317 2.96606 8.62784 2.96606 7.52344V2.18457C2.96606 1.08016 3.86172 0.184833 4.96606 0.18457C6.07063 0.18457 6.96606 1.08 6.96606 2.18457V2.68066C9.42478 1.01539 12.3866 0.162368 15.3176 0.0214844Z" fill="currentColor"/>
                </svg>
                {syncLoading ? '동기화 중...' : '지금 동기화'}
              </button>
            </form>
          </div>
          {#if nationalHolidays.length > 0}
            <div class="drag-list-wrap">
              {#each nationalHolidays as h (h.id)}
                <div class="list-row" class:list-row-inactive={!h.is_active}>
                  <span class="mk-badge">{h.date}</span>
                  <span class="list-row-name">{h.name}</span>
                  {#if !h.is_active}
                    <span class="inactive-badge" title="동기화 정정으로 비활성화됨 — /cart 휴무일 판정에서 제외됩니다">비활성</span>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <p class="empty-hint">동기화된 법정공휴일이 없습니다. "지금 동기화"를 눌러 최신 데이터를 가져오세요.</p>
          {/if}
        </div>

        <!-- 임시 휴무일 관리(관리자 직접 등록) -->
        <div class="holiday-block">
          <div class="subsection-head">
            <h4 class="subsection-title">임시 휴무일 관리</h4>
          </div>
          <form
            method="POST"
            action="?/addManualHoliday"
            class="add-form"
            use:enhance={() => {
              manualHolidayLoading = true
              return async ({ result, update }) => {
                manualHolidayLoading = false
                if (result.type === 'success') {
                  csToast.success('임시 휴무일이 추가되었습니다.')
                  manualHolidayDate = ''
                  manualHolidayNote = ''
                  await update({ reset: false })
                } else if (result.type === 'failure') {
                  csToast.error((result.data as { error?: string })?.error ?? '추가에 실패했습니다.')
                }
              }
            }}
          >
            <input
              type="date"
              name="date"
              class="add-input"
              bind:value={manualHolidayDate}
              disabled={manualHolidayLoading}
              aria-label="임시휴무일 날짜"
              required
            />
            <input
              type="text"
              name="note"
              class="add-input"
              placeholder="사유 입력 (예: 명절 연휴)"
              maxlength="100"
              bind:value={manualHolidayNote}
              disabled={manualHolidayLoading}
              aria-label="임시휴무일 사유"
            />
            <button
              type="submit"
              class="btn-add"
              disabled={manualHolidayLoading || !manualHolidayDate}
            >
              {manualHolidayLoading ? '추가 중...' : '추가'}
            </button>
          </form>

          {#if manualHolidays.length > 0}
            <div class="drag-list-wrap">
              {#each manualHolidays as h (h.id)}
                <div class="list-row">
                  <span class="mk-badge">{h.date}</span>
                  <span class="list-row-name">{h.note || h.name}</span>
                  <CmsDeleteButton action="?/deleteManualHoliday" id={h.id} />
                </div>
              {/each}
            </div>
          {:else}
            <p class="empty-hint">등록된 임시 휴무일이 없습니다.</p>
          {/if}
        </div>
      </div>
      </div>
    </section>

    <!-- ══════════════════════════════════════════
         섹션 4: 지점 정보 등록
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">지점 정보 등록</h2>
        <span class="section-badge">{branches.length} / 20</span>
      </div>

      <form
        method="POST"
        action="?/addBranch"
        class="add-form"
        use:enhance={({ formData }) => {
          formData.set('count', String(branches.length))
          branchLoading = true
          return async ({ result, update }) => {
            branchLoading = false
            if (result.type === 'success') {
              branchInput = ''
              csToast.success('지점이 추가되었습니다.')
              await update({ reset: false })
            } else if (result.type === 'failure') {
              csToast.error((result.data as { error?: string })?.error ?? '추가에 실패했습니다.')
            }
          }
        }}
      >
        <input
          type="text"
          name="name"
          class="add-input"
          placeholder="지점명 입력 (예: 크레이지샷 본점)"
          maxlength="100"
          bind:value={branchInput}
          disabled={branchLoading}
          aria-label="지점명"
        />
        <button
          type="submit"
          class="btn-add"
          disabled={branchLoading || !branchInput.trim() || branches.length >= 20}
        >
          {branchLoading ? '추가 중...' : '추가'}
        </button>
      </form>

      {#if branches.length > 0}
        <div class="accordion-list">
          {#each branches as branch (branch.id)}
            <div class="accordion-item">
              <div
                class="accordion-header"
                class:accordion-header--open={expandedBranchId === branch.id}
              >
                <button
                  type="button"
                  class="accordion-toggle"
                  onclick={() => {
                    expandedBranchId = expandedBranchId === branch.id ? null : branch.id
                  }}
                  aria-expanded={expandedBranchId === branch.id}
                >
                  <span class="accordion-name">{branch.name}</span>
                </button>
                <CmsDeleteButton
                  action="?/deleteBranch"
                  id={branch.id}
                  successMessage="지점이 삭제되었습니다."
                  onsuccess={() => { expandedBranchId = null }}
                />
                <button
                  type="button"
                  class="accordion-arrow-btn"
                  onclick={() => {
                    expandedBranchId = expandedBranchId === branch.id ? null : branch.id
                  }}
                  aria-hidden="true"
                  tabindex="-1"
                >
                  {expandedBranchId === branch.id ? '▲' : '▼'}
                </button>
              </div>

              {#if expandedBranchId === branch.id && branchForms[branch.id]}
                <div class="accordion-body">
                  <form
                    id="branch-form-{branch.id}"
                    method="POST"
                    action="?/updateBranch"
                    use:enhance={() => {
                      return async ({ result, update }) => {
                        if (result.type === 'success') {
                          csToast.success('지점 정보가 저장되었습니다.')
                          await update({ reset: false })
                        } else if (result.type === 'failure') {
                          csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
                        }
                      }
                    }}
                  >
                    <input type="hidden" name="id" value={branch.id} />
                    <input type="hidden" name="name" value={branch.name} />

                    <div class="field-row">
                      <label class="field-label" for="addr-{branch.id}">주소</label>
                      <input
                        id="addr-{branch.id}"
                        type="text"
                        name="address"
                        class="field-input"
                        placeholder="주소를 입력하세요"
                        bind:value={branchForms[branch.id].address}
                        aria-label="주소"
                      />
                    </div>

                    <div class="field-row">
                      <label class="field-label" for="phone-{branch.id}">비상연락망</label>
                      <input
                        id="phone-{branch.id}"
                        type="tel"
                        name="phone"
                        class="field-input"
                        placeholder="010-0000-0000"
                        maxlength="13"
                        value={branchForms[branch.id].phone}
                        oninput={(e) => onPhoneInput(branch.id, (e.target as HTMLInputElement).value)}
                        aria-label="비상연락망"
                      />
                    </div>

                    <div class="field-row">
                      <label class="field-label" for="contact-{branch.id}">담당자명</label>
                      <input
                        id="contact-{branch.id}"
                        type="text"
                        name="contact_person"
                        class="field-input field-input--sm"
                        placeholder="최대 10자"
                        maxlength="10"
                        bind:value={branchForms[branch.id].contact_person}
                        aria-label="담당자명"
                      />
                    </div>

                    <div class="accordion-actions">
                      <button type="submit" class="btn-save">저장</button>
                    </div>
                  </form>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-hint">등록된 지점이 없습니다.</p>
      {/if}
    </section>

    <!-- ══════════════════════════════════════════
         섹션 4: 대여·예약 이용안내
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">대여·예약 이용안내</h2>
      </div>

      <!-- 공통 안내문 -->
      <div class="subsection">
        <h3 class="subsection-title">공통 대여 안내문</h3>
        <form
          method="POST"
          action="?/saveGuide"
          use:enhance={() => {
            guideLoading = true
            return async ({ result, update }) => {
              guideLoading = false
              if (result.type === 'success') {
                csToast.success('안내문이 저장되었습니다.')
                await update({ reset: false })
              } else if (result.type === 'failure') {
                csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
              }
            }
          }}
        >
          <div class="textarea-wrap">
            <textarea
              name="guide_text"
              class="guide-textarea"
              placeholder="공통 대여 안내문을 입력하세요 (최대 1,000자)"
              maxlength="1000"
              rows="6"
              bind:value={guideText}
              aria-label="공통 대여 안내문"
            ></textarea>
            <span class="char-count" class:char-count--warn={guideCharCount > 900}>
              {guideCharCount} / 1,000
            </span>
          </div>
          <div class="guide-actions">
            <button
              type="submit"
              class="btn-save"
              disabled={guideLoading || !guideIsDirty}
            >
              {guideLoading ? '저장 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>

      <!-- 필수 동의문 -->
      <div class="subsection">
        <div class="subsection-head">
          <h3 class="subsection-title">필수 동의문 항목</h3>
          <span class="section-badge">{consents.length} / 10</span>
        </div>

        <form
          method="POST"
          action="?/addConsent"
          class="add-form"
          use:enhance={({ formData }) => {
            formData.set('count', String(consents.length))
            consentLoading = true
            return async ({ result, update }) => {
              consentLoading = false
              if (result.type === 'success') {
                consentInput = ''
                csToast.success('동의문이 추가되었습니다.')
                await update({ reset: false })
              } else if (result.type === 'failure') {
                csToast.error((result.data as { error?: string })?.error ?? '추가에 실패했습니다.')
              }
            }
          }}
        >
          <div class="consent-input-wrap">
            <input
              type="text"
              name="content"
              class="add-input"
              placeholder="필수 동의문 내용 입력 (최대 200자)"
              maxlength="200"
              bind:value={consentInput}
              disabled={consentLoading}
              aria-label="필수 동의문"
            />
            <span class="char-count-inline" class:char-count--warn={consentCharCount > 180}>
              {consentCharCount}/200
            </span>
          </div>
          <button
            type="submit"
            class="btn-add"
            disabled={consentLoading || !consentInput.trim() || consents.length >= 10}
          >
            {consentLoading ? '추가 중...' : '추가'}
          </button>
        </form>

        {#if consents.length > 0}
          <CmsDragList
            bind:items={consents}
            itemKey={(item) => item.id}
            onreorder={saveConsentOrder}
            class="drag-list-wrap"
          >
            {#snippet renderItem(item: RentalConsentItem)}
              <div class="list-row">
                <span class="list-row-name consent-text">{item.content}</span>
                <CmsDeleteButton action="?/deleteConsent" id={item.id} />
              </div>
            {/snippet}
          </CmsDragList>
        {:else}
          <p class="empty-hint">등록된 필수 동의문이 없습니다.</p>
        {/if}
      </div>
    </section>

  </div>
</div>

<style>
  .page-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 32px 16px;
    min-width: 0;
  }

  /* ─── 페이지 헤더 ─── */

  /* ─── 섹션 레이아웃 ─── */
  .sections {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .setting-section {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 34px 32px;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 10px;
    /* section-desc 문구 제거(2026-08-24)로 사라진 여백을 보정 — 타이틀과 바로 아래
       입력폼/서브섹션 사이 30px 확보(전 섹션 공통 적용) */
    margin-bottom: 30px;
  }

  .section-title {
    font: var(--text-pc-menu-kr-20);
    color: var(--cs-dark);
    margin: 0;
  }

  .section-badge {
    background: var(--cs-lilac);
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    font-weight: 700;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  /* ─── 추가 폼 ─── */
  .add-form {
    display: flex;
    gap: 10px;
    margin-bottom: 32px;
  }

  .add-form--method {
    flex-direction: column;
    gap: 12px;
  }

  /* 배송료 우대설정 — 대여금액+조건+우대옵션을 옅은 그레이 박스로 묶어 한 행 정렬
     (2026-08-29, 낱개 행 stack이 지저분해 보인다는 Stephen 지적으로 카드형 정리) */
  .tier-input-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 24px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    padding: 16px 20px;
  }

  .tier-input-row .fee-input {
    background: var(--cs-white);
  }

  /* "추가" 버튼을 tier-input-row 우측 끝에 재배치(2026-08-29, Stephen 지시) — 기존
     add-form--method(column flex) 하위 단독 자식일 때의 stretch로 인한 전체폭 대신,
     행 안에서는 auto폭 + margin-left:auto로 우측 정렬 */
  .tier-add-btn {
    margin-left: auto;
    flex-shrink: 0;
    width: auto;
  }

  .mk-select-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .mk-select-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    flex-shrink: 0;
    width: 56px;
  }

  .mk-chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .mk-chip {
    height: 32px;
    padding: 0 14px;
    border: 1.5px solid var(--cs-lilac);
    border-radius: var(--cms-radius-xl, 30px);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .mk-chip--on {
    background: var(--cs-purple);
    color: var(--cs-white);
    border-color: var(--cs-purple);
  }

  .mk-chip--used {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .mk-chip:not(.mk-chip--on):not(.mk-chip--used):hover {
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }

  .mk-name-row {
    display: flex;
    gap: 10px;
  }

  .mk-badge {
    flex-shrink: 0;
    height: 22px;
    padding: 0 10px;
    background: var(--cs-lilac);
    color: var(--cs-purple);
    border-radius: var(--cms-radius-xl, 30px);
    font: var(--text-pc-script-12);
    font-weight: 700;
    display: inline-flex;
    align-items: center;
  }

  .mk-badge--shipping {
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
  }

  /* 대여방식 목록의 장바구니 노출용 안내문구(deadline_time) 배지(2026-09-21, 이후
     클릭 시 아코디언 확장으로 재설계) — mk-badge--shipping과 동일 톤 재사용(신규 팔레트
     도입 없음). <button> 기반이라 브라우저 기본 버튼 스타일 리셋 필요. 우측에 ChevronIcon
     (펼침/접힘 예측 표시, Stephen 지시)을 함께 배치하기 위해 inline-flex로 전환 — 말줄임은
     버튼 전체가 아니라 텍스트 span(.mk-badge-text)에만 적용해 아이콘이 잘리지 않게 함. */
  .mk-badge--deadline {
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
  }
  .mk-badge--editable,
  .mk-badge--deadline-empty {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: none;
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.1s;
  }
  .mk-badge-text {
    max-width: 126px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mk-badge--editable:hover {
    background: var(--cs-purple-op10, rgba(59,47,138,0.1));
    color: var(--cs-purple);
  }
  .mk-badge--deadline-empty {
    background: transparent;
    color: var(--cs-text-light, #AAAAAA);
    border: 1px dashed var(--cs-lilac);
  }
  .mk-badge--deadline-empty:hover {
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }
  .mk-badge--active {
    background: var(--cs-purple) !important;
    color: var(--cs-white) !important;
    border-color: var(--cs-purple) !important;
  }

  /* 안내문구 수정 아코디언(2026-09-21, Stephen 재지시로 위치 수정 — 목록 전체 하단이
     아니라 "그 행 바로 아래"에 펼쳐져야 함) — CmsDragList.svelte의 .drag-list-item은
     기본 display:flex + flex-wrap:nowrap(공용 컴포넌트, 다른 12곳 이상에서 재사용 중이라
     직접 수정 금지)이라, 아래 :global 규칙으로 "이 목록(.mk-methods-list)에 한정해서만"
     flex-wrap:wrap을 켜고, 아코디언 자체는 flex-basis:100%로 강제 줄바꿈시켜 같은
     .drag-list-item 안에서 .list-row 다음 줄로 내려오게 만든다. flex-wrap:wrap 자체는
     flex-basis:100% 자식이 없는 한 아무 시각적 영향이 없어 다른 목록(대여기간·동의문)에
     영향 없음 — 이 목록 전용 클래스로 스코프했으므로 애초에 다른 목록에는 적용되지도 않음. */
  :global(.mk-methods-list .drag-list-item) {
    flex-wrap: wrap;
  }
  .mk-deadline-accordion {
    flex-basis: 100%;
    width: 100%;
    margin-top: 10px;
    padding: 14px 16px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    box-sizing: border-box;
  }
  .mk-deadline-edit-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .mk-deadline-field-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mk-deadline-field-label {
    flex-shrink: 0;
    width: 60px;
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .mk-deadline-actions-row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .mk-deadline-edit-input {
    flex: 1;
    height: 40px;
    padding: 0 12px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-white);
    outline: none;
  }
  .mk-deadline-edit-input:focus {
    border-color: var(--cs-purple);
  }
  .mk-deadline-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    flex-shrink: 0;
  }
  .mk-deadline-btn--cancel {
    color: var(--cs-text-light, #AAAAAA);
  }
  .mk-deadline-btn--cancel:hover {
    background: rgba(255,53,53,0.08);
    color: var(--cs-red-badge);
  }

  .add-input {
    flex: 1;
    height: 44px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    padding: 0 14px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    outline: none;
    transition: border-color 0.15s;
  }

  .add-input:focus {
    border-color: var(--cs-purple);
    background: var(--cs-white);
  }

  .add-input::placeholder {
    color: var(--cs-text-placeholder);
  }

  /* 대여방식명 입력폭 축소 + 우측에 장바구니 노출용 안내문구(deadline_time) 입력 추가
     (2026-09-21, Stephen 지시) — 최초엔 방식명 2 : 안내문구 1로 배분했으나, 실화면에서
     안내문구 입력란이 지나치게 좁아 보인다는 Stephen 피드백에 따라 두 비율을 맞바꿔
     방식명 1 : 안내문구 2로 재조정(줄인 폭만큼 그대로 안내문구로 이전). */
  .add-input--method-name {
    flex: 1;
  }
  .add-input--method-deadline {
    flex: 2;
  }

  /* ProductDetailPanel.svelte .btn-save-inline 스타일 토큰 반영(2026-08-24, Stephen 지시) —
     활성 상태를 .btn-save-inline.dirty에, 비활성(disabled)을 .btn-save-inline 기본상태에 매핑 */
  .btn-add {
    padding: 5px 14px;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    white-space: nowrap;
    cursor: pointer;
    min-height: 32px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .btn-add:disabled {
    border-color: var(--cs-border);
    background: transparent;
    color: var(--cs-text-light);
    cursor: not-allowed;
  }

  .btn-add:not(:disabled):hover {
    background: var(--cs-purple-hover);
    border-color: var(--cs-purple-hover);
  }

  /* "지금 동기화" 버튼 — 동기화 아이콘 + 텍스트 */
  .btn-sync {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  /* 배경 grey5%(--cs-surface-gray) 전용 오버라이드 — 텍스트/아이콘(currentColor)도 밝은
     배경에서 보이도록 함께 어두운 톤으로 조정(흰 텍스트 유지 시 대비 실패) */
  .btn-sync:not(:disabled) {
    background: var(--cs-surface-gray);
    border: none;
    color: var(--cs-text);
  }
  .btn-sync:not(:disabled):hover {
    background: var(--cs-lilac);
  }
  .btn-sync-icon {
    flex-shrink: 0;
  }

  /* ─── 드래그 리스트 아이템 ─── */
  :global(.drag-list-wrap) {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 1;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    padding: 0 14px;
    height: 44px;
    gap: 12px;
    min-width: 0;
  }

  .list-row-name {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* is_active=false 국경일 행 — /cart 휴무일 판정에서 제외되고 있음을 관리자가 즉시
     알아챌 수 있도록 시각적으로 구분(2026-08-25, 동기화 정정으로 실제 발생 가능한 상태) */
  .list-row-inactive { opacity: 0.5; }
  .list-row-inactive .list-row-name { text-decoration: line-through; }
  .inactive-badge {
    flex-shrink: 0;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-error, #d92d20);
    background: rgba(217, 45, 32, 0.1);
    border-radius: var(--radius-full, 99px);
    padding: 2px 10px;
  }

  .consent-text {
    font: var(--text-pc-body-14);
  }

  /* ─── 위험 버튼 (삭제) ─── */
  .act-del {
    display: inline-flex; align-items: center; justify-content: center;
    height: 28px; padding: 0 8px;
    border: none; border-radius: var(--radius-sm);
    background: transparent; cursor: pointer;
    color: var(--cs-text-light);
    transition: background 0.1s, color 0.1s;
    flex-shrink: 0;
  }
  .act-del:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  .btn-danger-sm {
    height: 28px;
    padding: 0 12px;
    background: var(--cs-error, #E53E3E);
    border: none;
    border-radius: var(--cms-radius-sm);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .btn-danger-sm:hover {
    opacity: 0.8;
  }

  .btn-danger-sm--pending {
    background: color-mix(in srgb, var(--cs-error, #E53E3E) 60%, black);
  }

  .act-del--pending {
    color: var(--cs-red-badge);
    background: rgba(255,53,53,0.08);
  }

  /* ─── 저장 버튼 ─── */
  .btn-save {
    height: 34px;
    padding: 0 18px;
    background: var(--cs-purple);
    border: none;
    border-radius: var(--cms-radius-sm);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-save:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-save:not(:disabled):hover {
    opacity: 0.85;
  }

  /* ─── 빈 상태 ─── */
  .empty-hint {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    text-align: center;
    padding: 20px 0;
    margin: 0;
  }

  /* ─── 아코디언 (지점 정보) ─── */
  .accordion-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .accordion-item {
    border-radius: var(--cms-radius-md);
    overflow: hidden;
    border: 1px solid var(--cs-lilac);
  }

  .accordion-header {
    display: flex;
    align-items: center;
    height: 48px;
    background: var(--cs-surface-gray);
    gap: 8px;
    padding-right: 12px;
    transition: background 0.15s;
  }

  .accordion-header:hover,
  .accordion-header--open {
    background: var(--cs-lilac);
  }

  .accordion-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0 16px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }

  .accordion-name {
    font: var(--text-pc-title-16);
    color: var(--cs-dark);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }


  .accordion-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--cs-lilac);
  }

  .accordion-arrow-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    font-size: 11px;
    color: var(--cs-text-mid);
    cursor: pointer;
    flex-shrink: 0;
  }

  .accordion-body {
    padding: 20px 20px 16px;
    background: var(--cs-white);
    border-top: 1px solid var(--cs-lilac);
  }

  /* ─── 지점 상세 폼 필드 ─── */
  .field-row {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .field-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
  }

  .field-input {
    height: 38px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    padding: 0 12px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    outline: none;
    transition: border-color 0.15s;
  }

  .field-input:focus {
    border-color: var(--cs-purple);
    background: var(--cs-white);
  }

  .field-input::placeholder {
    color: var(--cs-text-mid);
  }

  .field-input--sm {
    max-width: 160px;
  }

  /* ─── 이용안내 섹션 ─── */
  .subsection {
    margin-bottom: 28px;
  }

  .subsection:last-child {
    margin-bottom: 0;
  }

  /* "배송 설정 저장" 폼과 "대여옵션(수령/반납) 일괄적용" 사이 여백 */
  .bulk-delivery-section {
    margin-top: 30px;
  }

  /* 배송료 우대설정 ↔ 휴무일 제어 옵션 사이 여백 — 기능 간 시각적 분리도 확보 위해
     한 차례 더 2배 반영(2026-08-30, Stephen 지시): 28px → 56px → 112px */
  .discount-tier-section {
    margin-bottom: 112px;
    /* 대여옵션 카드 ↔ 배송료 우대설정 사이 여백도 2배(같은 날 후속 지시) — 인접 마진
       collapse를 고려해 이 쪽(margin-top)도 함께 60px로 올려 시각적 간격을 보장 */
    margin-top: 60px;
  }

  /* 휴무일 제어 옵션 토글 행과 그 아래 법정공휴일·임시휴무일 목록 사이 여백 2배 —
     기본 .sf-row margin-bottom(24px)의 2배 */
  .holiday-toggle-row {
    margin-bottom: 48px;
  }

  /* "배송료 우대설정" 타이틀과 그 아래 입력폼(tier-input-row) 사이 여백 축소 —
     하나의 기능을 설명하는 타이틀이므로 시각적 결합성 확보(2026-08-30, Stephen 지시) —
     기본 .sf-row margin-bottom(24px)의 절반 */
  .discount-tier-title-row {
    margin-bottom: 12px;
  }

  .subsection-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .subsection-title {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    margin: 0;
  }

  .guide-actions {
    display: flex;
    justify-content: flex-end;
  }

  /* ─── 택배 휴무일 캘린더 제어 서브섹션 ─── */
  .subsection-head--between {
    justify-content: space-between;
  }

  .holiday-block {
    margin-top: 24px;
  }

  .holiday-block .drag-list-wrap {
    max-height: 220px;
    overflow-y: auto;
    /* 기본 6px(:global(.drag-list-wrap))의 2배 — 법정공휴일·임시휴무일 목록 전용 */
    gap: 12px;
  }

  .textarea-wrap {
    position: relative;
    margin-bottom: 10px;
  }

  .guide-textarea {
    width: 100%;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    padding: 12px 14px 32px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
    line-height: 1.6;
  }

  .guide-textarea:focus {
    border-color: var(--cs-purple);
    background: var(--cs-white);
  }

  .guide-textarea::placeholder {
    color: var(--cs-text-mid);
  }

  .char-count {
    position: absolute;
    bottom: 10px;
    right: 14px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .char-count--warn {
    color: var(--cs-error, #E53E3E);
    font-weight: 700;
  }

  /* 배송 안내문 "안내문 저장" 버튼 — 입력폼 외부(guide-actions) 대신 textarea-wrap 내부
     우측 상단에 배치(2026-08-30, Stephen 지시 — "입력폼 내부 배치가 UX 최선") */
  .textarea-save-btn {
    position: absolute;
    top: 10px;
    right: 14px;
  }

  /* 버튼이 textarea 위에 겹치지 않도록 상단 여백 확보(char-count의 하단 여백 확보와
     동일 원리) — .guide-textarea 공용 클래스는 "공통 대여 안내문" 섹션과 공유하므로
     이 인스턴스에만 스코프한 modifier로 상단 패딩만 확장 */
  .guide-textarea--has-save-btn {
    padding-top: 52px;
  }

  /* ─── 동의문 입력 래퍼 ─── */
  .consent-input-wrap {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  .consent-input-wrap .add-input {
    padding-right: 60px;
  }

  .char-count-inline {
    position: absolute;
    right: 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    pointer-events: none;
  }

  /* ─── 배송 설정 섹션 ─── */
  .shipping-form {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .sf-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }

  .sf-label {
    /* "대여옵션(수령/반납) 일괄적용" 라벨(가장 긴 값) 기준 — 3개 sf-row(배송적용옵션 ·
       대여옵션 일괄적용 · 휴무일 제어 옵션) 전부 동일 폭 공유해 좌측 정렬 통일 */
    flex: 0 0 210px;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    white-space: nowrap;
  }

  /* 배송료 우대설정 행의 "N / 5" 카운터(목록 수량 인덱스) — 행 우측 끝으로 정렬
     (2026-08-30, Stephen 지시) */
  .sf-row .section-badge {
    margin-left: auto;
  }

  .shipping-chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  /* 배송대여 수령/반납 일괄 지정 콤보 — 칩마다 개별 form으로 감싸되 레이아웃엔 영향 없게 */
  .chip-form {
    display: inline-flex;
  }
  /* cms-uiux.md §7-12-B "콤보버튼 UI(옵션 선택/토글) — mk-chip 표준" 값 그대로 적용
     (이 페이지의 .mk-chip과 완전히 동일한 스타일 토큰 — 2026-08-24 Stephen 지시로 통일) */
  .s-chip {
    height: 32px;
    padding: 0 14px;
    border: 1.5px solid var(--cs-lilac);
    border-radius: var(--cms-radius-xl, 30px);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .s-chip--on {
    background: var(--cs-purple);
    color: var(--cs-white);
    border-color: var(--cs-purple);
  }

  .s-chip:not(.s-chip--on):hover {
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }

  .s-chip:disabled {
    background: transparent;
    color: var(--cs-text-light);
    border-color: var(--cs-border);
    cursor: not-allowed;
  }

  .fee-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 28px;
  }

  /* 요금 입력(fee-grid) ↔ 배송 안내문 사이 여백 2배 확보(2026-08-30, Stephen 지시 —
     "메뉴 기능 간 분리도 확보") — 기본 margin-bottom(28px)의 2배 */
  .fee-grid--spaced {
    margin-bottom: 56px;
  }

  /* 배송 안내문 블록 자체의 하단 여백 — rental-restriction-group과의 분리도 확보 위해
     한 차례 더 2배 반영(2026-08-30, Stephen 지시): 28px → 56px → 112px */
  .shipping-guide-sub--spaced {
    margin-bottom: 112px;
  }

  /* rental-restriction-group 진입부(첫 카드) 상단 여백 2배 — 기본 .bulk-delivery-section
     margin-top(30px)의 2배. 이 카드 뒤(배송료 우대설정 등)의 margin-top은 변경하지 않음 */
  .bulk-delivery-section--group-start {
    margin-top: 60px;
    /* 이 카드 ↔ 배송료 우대설정 사이 여백도 2배(같은 날 후속 지시) — 기본 .subsection
       margin-bottom(28px)의 2배 */
    margin-bottom: 56px;
  }

  .fee-row {
    display: flex;
    align-items: center;
    gap: 12px;
    transition: opacity 0.15s;
  }

  .fee-row--disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  /* 콤보칩(.fee-chip)은 그 행을 켜고 끄는 토글 자신이므로, 행이 꺼진(--disabled) 상태에서도
     항상 클릭 가능해야 한다 — 부모 규칙(opacity/pointer-events)을 이 칩에서만 되돌림 */
  .fee-row--disabled .fee-chip {
    opacity: 1;
    pointer-events: auto;
  }

  .fee-label {
    flex: 0 0 100px;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    white-space: nowrap;
  }

  .fee-input-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .fee-input {
    width: 160px;
    text-align: right;
    flex: none;
  }

  .fee-unit {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
  }

  /* 요금 입력란 우측에 배치된 켜기/끄기 콤보칩 — 입력란과 적정 여백을 두어 시각적으로 분리 */
  .fee-chip {
    margin-left: 24px;
    flex-shrink: 0;
  }

  .shipping-guide-sub {
    margin-bottom: 20px;
  }
</style>
