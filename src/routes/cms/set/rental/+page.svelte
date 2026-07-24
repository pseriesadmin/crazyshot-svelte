<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import type { PageData, ActionData } from './$types'
  import type { RentalPeriodOption, RentalMethodOption, PickupPoint, RentalConsentItem, RentalShippingSettings } from './+page.server'

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
  let methods = $state<RentalMethodOption[]>(data.methods)
  let methodInput = $state('')
  let methodLoading = $state(false)

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
      <p class="section-desc">상품상세정보에 최대 대여 기간을 표시하고 설정을 반영합니다.</p>

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
      <p class="section-desc">상품 예약등록 화면에 선택 가능한 대여방식 목록을 등록합니다.</p>

      <form
        method="POST"
        action="?/addMethod"
        class="add-form"
        use:enhance={({ formData }) => {
          formData.set('count', String(methods.length))
          methodLoading = true
          return async ({ result, update }) => {
            methodLoading = false
            if (result.type === 'success') {
              methodInput = ''
              csToast.success('대여 방식이 추가되었습니다.')
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
      <p class="section-desc">택배 유형별 요금을 설정하고 고객에게 표시할 배송 안내문을 입력하세요.</p>

      <form
        method="POST"
        action="?/saveShipping"
        class="shipping-form"
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
        <!-- 택배 적용 옵션 콤보버튼 -->
        <div class="sf-row">
          <span class="sf-label">택배 적용 옵션</span>
          <div class="shipping-chips">
            <button
              type="button"
              class="s-chip"
              class:s-chip--on={enableRoundTrip}
              onclick={() => { enableRoundTrip = !enableRoundTrip }}
            >왕복 요금</button>
            <button
              type="button"
              class="s-chip"
              class:s-chip--on={enableDelivery}
              onclick={() => { enableDelivery = !enableDelivery }}
            >배송요금</button>
            <button
              type="button"
              class="s-chip"
              class:s-chip--on={enableReturn}
              onclick={() => { enableReturn = !enableReturn }}
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
              <input
                type="number"
                name="round_trip_fee"
                class="add-input fee-input"
                bind:value={roundTripFee}
                disabled={!enableRoundTrip}
                min="0"
                step="100"
                placeholder="0"
                aria-label="왕복 요금"
              />
              <span class="fee-unit">원</span>
            </div>
          </div>
          <div class="fee-row" class:fee-row--disabled={!enableDelivery}>
            <span class="fee-label">배송요금</span>
            <div class="fee-input-wrap">
              <input
                type="number"
                name="delivery_fee"
                class="add-input fee-input"
                bind:value={deliveryFee}
                disabled={!enableDelivery}
                min="0"
                step="100"
                placeholder="0"
                aria-label="배송요금"
              />
              <span class="fee-unit">원</span>
            </div>
          </div>
          <div class="fee-row" class:fee-row--disabled={!enableReturn}>
            <span class="fee-label">반송요금</span>
            <div class="fee-input-wrap">
              <input
                type="number"
                name="return_fee"
                class="add-input fee-input"
                bind:value={returnFee}
                disabled={!enableReturn}
                min="0"
                step="100"
                placeholder="0"
                aria-label="반송요금"
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
    </section>

    <!-- ══════════════════════════════════════════
         섹션 4: 지점 정보 등록
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">지점 정보 등록</h2>
        <span class="section-badge">{branches.length} / 20</span>
      </div>
      <p class="section-desc">픽업·반납 가능한 지점 목록을 등록하고 상세 정보를 관리합니다.</p>

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
      <p class="section-desc">결제 화면에 표시될 공통 안내문과 필수 동의문을 관리합니다.</p>

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
    margin-bottom: 6px;
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

  .section-desc {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    margin: 0 0 40px;
  }

  /* ─── 추가 폼 ─── */
  .add-form {
    display: flex;
    gap: 10px;
    margin-bottom: 32px;
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

  .btn-add {
    height: 44px;
    padding: 0 22px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-md);
    font: var(--text-pc-title-16);
    white-space: nowrap;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-add:not(:disabled):hover {
    opacity: 0.85;
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

  .subsection-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .subsection-title {
    font: var(--text-pc-title-18);
    color: var(--cs-dark);
    margin: 0;
  }

  .guide-actions {
    display: flex;
    justify-content: flex-end;
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
    flex: 0 0 100px;
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
  }

  .shipping-chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .s-chip {
    height: 36px;
    padding: 0 18px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-md);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .s-chip--on {
    background: var(--cs-purple);
    color: var(--cs-white);
    border-color: var(--cs-purple);
  }

  .s-chip:not(.s-chip--on):hover {
    border-color: rgba(59, 47, 138, 0.4);
    background: rgba(59, 47, 138, 0.04);
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
    color: var(--cs-text);
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
