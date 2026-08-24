<script lang="ts">
  import { tick } from 'svelte'
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import type { PageData, ActionData } from './$types'
  import type { RentalPeriodOption, RentalMethodOption, PickupPoint, RentalConsentItem, RentalShippingSettings, PublicHolidayRow } from './+page.server'

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
  let methodLoading = $state(false)

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
              await update()
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
        use:enhance={({ formData }) => {
          formData.set('count', String(methods.length))
          methodLoading = true
          return async ({ result, update }) => {
            methodLoading = false
            if (result.type === 'success') {
              methodInput = ''
              methodKey = ''
              csToast.success('대여 방식이 추가되었습니다.')
              await update()
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
            class="add-input"
            placeholder="대여방식명 입력 (예: 일반 대여)"
            maxlength="50"
            bind:value={methodInput}
            disabled={methodLoading}
            aria-label="대여방식명"
          />
          <button
            type="submit"
            class="btn-add"
            disabled={methodLoading || !methodInput.trim() || methods.length >= 10}
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
          class="drag-list-wrap"
        >
          {#snippet renderItem(item: RentalMethodOption)}
            <div class="list-row">
              <span class="list-row-name">{item.name}</span>
              {#if item.method_key}
                <span class="mk-badge">{METHOD_KEY_LABELS[item.method_key] ?? item.method_key}</span>
              {/if}
              <CmsDeleteButton action="?/deleteMethod" id={item.id} />
            </div>
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
              await update()
            } else if (result.type === 'failure') {
              csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
            }
          }
        }}
      >
        <!-- 배송적용옵션 콤보버튼 — 클릭 즉시 자동 저장(다른 콤보버튼 그룹과 통일, 2026-08-24) -->
        <div class="sf-row">
          <span class="sf-label">배송적용옵션</span>
          <div class="shipping-chips">
            <button
              type="button"
              class="s-chip"
              class:s-chip--on={enableRoundTrip}
              disabled={shippingLoading}
              onclick={async () => { enableRoundTrip = !enableRoundTrip; await tick(); shippingFormEl?.requestSubmit() }}
            >왕복 요금</button>
            <button
              type="button"
              class="s-chip"
              class:s-chip--on={enableDelivery}
              disabled={shippingLoading}
              onclick={async () => { enableDelivery = !enableDelivery; await tick(); shippingFormEl?.requestSubmit() }}
            >배송요금</button>
            <button
              type="button"
              class="s-chip"
              class:s-chip--on={enableReturn}
              disabled={shippingLoading}
              onclick={async () => { enableReturn = !enableReturn; await tick(); shippingFormEl?.requestSubmit() }}
            >반송요금</button>
          </div>
        </div>

        <!-- boolean 플래그 hidden inputs -->
        <input type="hidden" name="enable_round_trip" value={enableRoundTrip ? 'true' : 'false'} />
        <input type="hidden" name="enable_delivery"   value={enableDelivery   ? 'true' : 'false'} />
        <input type="hidden" name="enable_return"      value={enableReturn      ? 'true' : 'false'} />

        <!-- 요금 입력 (활성/비활성) -->
        <div class="fee-grid">
          <div class="fee-row" class:fee-row--disabled={!enableRoundTrip}>
            <span class="fee-label">왕복 요금</span>
            <div class="fee-input-wrap">
              <input type="hidden" name="round_trip_fee" value={roundTripFee} />
              <input
                type="text"
                inputmode="numeric"
                class="add-input fee-input"
                value={roundTripFee === '' ? '' : roundTripFee.toLocaleString('ko-KR')}
                disabled={!enableRoundTrip}
                placeholder="0"
                aria-label="왕복 요금"
                oninput={(e) => {
                  const digits = e.currentTarget.value.replace(/[^0-9]/g, '')
                  roundTripFee = digits ? parseInt(digits, 10) : ''
                }}
              />
              <span class="fee-unit">원</span>
            </div>
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
              />
              <span class="fee-unit">원</span>
            </div>
          </div>
          <div class="fee-row" class:fee-row--disabled={!enableReturn}>
            <span class="fee-label">반송요금</span>
            <div class="fee-input-wrap">
              <input type="hidden" name="return_fee" value={returnFee} />
              <input
                type="text"
                inputmode="numeric"
                class="add-input fee-input"
                value={returnFee === '' ? '' : returnFee.toLocaleString('ko-KR')}
                disabled={!enableReturn}
                placeholder="0"
                aria-label="반송요금"
                oninput={(e) => {
                  const digits = e.currentTarget.value.replace(/[^0-9]/g, '')
                  returnFee = digits ? parseInt(digits, 10) : ''
                }}
              />
              <span class="fee-unit">원</span>
            </div>
          </div>
        </div>

        <!-- 배송 안내문 (200자) -->
        <div class="subsection shipping-guide-sub">
          <div class="subsection-head">
            <h3 class="subsection-title">배송 안내문</h3>
          </div>
          <div class="textarea-wrap">
            <textarea
              name="shipping_guide"
              class="guide-textarea"
              maxlength="200"
              rows="4"
              bind:value={shippingGuide}
              placeholder="고객에게 표시될 배송 안내문을 입력하세요. (200자 이내)"
              aria-label="배송 안내문"
            ></textarea>
            <span class="char-count" class:char-count--warn={shippingGuideCount > 180}
              >{shippingGuideCount} / 200</span
            >
          </div>
        </div>

        <div class="guide-actions">
          <button type="submit" class="btn-save" disabled={shippingLoading}>
            {shippingLoading ? '저장 중...' : '배송 설정 저장'}
          </button>
        </div>
      </form>

      <!-- 배송대여 수령/반납 일괄 지정 — /cart에서 선택 시 반납방식 강제고정+시간선택 비활성화(요청 A) -->
      <div class="subsection bulk-delivery-section">
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
                      await update()
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
        {#if methods.length === 0}
          <p class="empty-hint">등록된 대여 방식이 없습니다. "대여 방식 옵션" 섹션에서 먼저 등록해주세요.</p>
        {/if}
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
                await update()
              } else if (result.type === 'failure') {
                csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
              }
            }
          }}
        >
          <div class="sf-row">
            <span class="sf-label">휴무일 제어 옵션</span>
            <div class="shipping-chips">
              <button
                type="button"
                class="s-chip"
                class:s-chip--on={enablePrevDayCheck}
                disabled={cutoffLoading}
                onclick={async () => { enablePrevDayCheck = !enablePrevDayCheck; await tick(); cutoffFormEl?.requestSubmit() }}
              >전날/당일 휴무 체크</button>
              <button
                type="button"
                class="s-chip"
                class:s-chip--on={enableFixedHolidays}
                disabled={cutoffLoading}
                onclick={async () => { enableFixedHolidays = !enableFixedHolidays; await tick(); cutoffFormEl?.requestSubmit() }}
              >고정 휴무일 연동(일·법정공휴일)</button>
              <button
                type="button"
                class="s-chip"
                class:s-chip--on={enableManualHolidays}
                disabled={cutoffLoading}
                onclick={async () => { enableManualHolidays = !enableManualHolidays; await tick(); cutoffFormEl?.requestSubmit() }}
              >임시 휴무일 반영</button>
            </div>
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
                    await update()
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
                <div class="list-row">
                  <span class="mk-badge">{h.date}</span>
                  <span class="list-row-name">{h.name}</span>
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
                  await update()
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
              await update()
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
                          await update()
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
                await update()
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
                await update()
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

  .fee-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 28px;
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

  .shipping-guide-sub {
    margin-bottom: 20px;
  }
</style>
