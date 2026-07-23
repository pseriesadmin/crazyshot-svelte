<script lang="ts">
  import { tick } from 'svelte'
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'

  interface ShippingAddress {
    id: string
    label: string
    recipient: string | null
    phone: string | null
    road_address: string
    detail_address: string | null
    postal_code: string | null
    is_default: boolean
    sort_order: number
    created_at: string
  }

  interface KakaoAddressData {
    roadAddress: string
    jibunAddress: string
    zonecode: string
  }

  type KakaoPostcodeCtor = new (opts: { oncomplete: (data: KakaoAddressData) => void; width?: string; height?: string }) => { open(): void; embed(el: HTMLElement, opts?: { autoClose?: boolean }): void }
  interface KakaoWindow extends Window { daum?: { Postcode: KakaoPostcodeCtor } }

  interface Props {
    addresses: ShippingAddress[]
  }

  let { addresses }: Props = $props()

  const MAX_ADDRESSES = 5
  let showAddForm = $state(false)

  let newLabel         = $state('')
  let newRecipient     = $state('')
  let newPhone         = $state('')
  let newRoadAddress   = $state('')
  let newDetailAddress = $state('')
  let newPostalCode    = $state('')
  let newSetDefault    = $state(false)
  let isSubmitting     = $state(false)
  let deletingId       = $state<string | null>(null)
  let settingDefaultId = $state<string | null>(null)
  let detailInput      = $state<HTMLInputElement | null>(null)

  // 카카오 주소 모달
  let showKakaoModal  = $state(false)
  let kakaoContainer  = $state<HTMLDivElement | null>(null)

  function loadKakaoScript(): Promise<void> {
    const w = window as KakaoWindow
    return new Promise((resolve, reject) => {
      if (w.daum?.Postcode) { resolve(); return }
      const s = document.createElement('script')
      s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
      s.onload  = () => resolve()
      s.onerror = () => reject(new Error('load_fail'))
      document.head.appendChild(s)
    })
  }

  async function openKakaoModal() {
    if (typeof window === 'undefined') return
    showKakaoModal = true
    try { await loadKakaoScript() } catch {
      csToast.error('주소 검색 서비스를 불러올 수 없습니다.')
      showKakaoModal = false
      return
    }
    await tick()
    const w = window as KakaoWindow
    if (!w.daum?.Postcode || !kakaoContainer) { showKakaoModal = false; return }
    new w.daum.Postcode({
      oncomplete: (data: KakaoAddressData) => {
        newRoadAddress  = data.roadAddress || data.jibunAddress
        newPostalCode   = data.zonecode
        showKakaoModal  = false
        setTimeout(() => detailInput?.focus(), 80)
      },
      width:  '100%',
      height: '100%'
    }).embed(kakaoContainer, { autoClose: false })
  }

  function resetForm() {
    newLabel = ''
    newRecipient = ''
    newPhone = ''
    newRoadAddress = ''
    newDetailAddress = ''
    newPostalCode = ''
    newSetDefault = false
    showAddForm = false
  }

  function formatPhone(val: string): string {
    const d = val.replace(/\D/g, '')
    if (d.length <= 3) return d
    if (d.length <= 7) return `${d.slice(0,3)}-${d.slice(3)}`
    if (d.length <= 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`
    return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7,11)}`
  }

  function handlePhoneInput(e: Event) {
    const t = e.target as HTMLInputElement
    newPhone = formatPhone(t.value)
    t.value = newPhone
  }
</script>

<div class="address-wrap">
  <div class="address-card">

    <!-- 헤더 -->
    <div class="section-header">
      <div>
        <p class="section-title">배송지 정보</p>
        <p class="section-sub">미리 등록하면 매번 번거로운 입력 끝 · 최대 {MAX_ADDRESSES}개</p>
      </div>
      {#if addresses.length < MAX_ADDRESSES && !showAddForm}
        <button class="btn-add" onclick={() => (showAddForm = true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          배송지 추가
        </button>
      {/if}
    </div>

    <!-- 등록된 배송지 목록 -->
    {#if addresses.length === 0 && !showAddForm}
      <div class="empty-state">
        <p class="empty-text">등록된 배송지가 없습니다.</p>
        <button class="btn-add-first" onclick={() => (showAddForm = true)}>
          첫 배송지 등록하기
        </button>
      </div>
    {:else}
      <div class="address-list">
        {#each addresses as addr (addr.id)}
          <div class="address-item" class:is-default={addr.is_default}>
            <div class="addr-top">
              <span class="addr-badge" class:badge-default={addr.is_default} class:badge-extra={!addr.is_default}>
                {addr.is_default ? '기본' : '추가'}
              </span>
              {#if addr.label && addr.label !== '기본' && addr.label !== '추가'}
                <span class="addr-label">{addr.label}</span>
              {/if}
              <div class="addr-actions">
                {#if !addr.is_default}
                  <form
                    method="POST"
                    action="/account/profile?/setDefault"
                    use:enhance={() => {
                      settingDefaultId = addr.id
                      return async ({ result }) => {
                        settingDefaultId = null
                        if (result.type === 'success') {
                          csToast.success('기본 배송지로 설정되었습니다.')
                          await invalidateAll()
                        } else if (result.type === 'failure') {
                          csToast.error((result.data as { error?: string })?.error ?? '처리 실패')
                        }
                      }
                    }}
                  >
                    <input type="hidden" name="address_id" value={addr.id} />
                    <button type="submit" class="btn-set-default" disabled={settingDefaultId === addr.id}>
                      {settingDefaultId === addr.id ? '처리 중...' : '기본으로 설정'}
                    </button>
                  </form>
                {/if}
                <form
                  method="POST"
                  action="/account/profile?/deleteAddress"
                  use:enhance={() => {
                    deletingId = addr.id
                    return async ({ result }) => {
                      deletingId = null
                      if (result.type === 'success') {
                        csToast.success('배송지가 삭제되었습니다.')
                        await invalidateAll()
                      } else if (result.type === 'failure') {
                        csToast.error((result.data as { error?: string })?.error ?? '삭제 실패')
                      }
                    }
                  }}
                >
                  <input type="hidden" name="address_id" value={addr.id} />
                  <button type="submit" class="btn-delete" disabled={deletingId === addr.id} aria-label="배송지 삭제">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
                  </button>
                </form>
              </div>
            </div>
            <p class="addr-main">
              {addr.road_address}{addr.detail_address ? ' ' + addr.detail_address : ''}
            </p>
            {#if addr.postal_code}
              <p class="addr-sub">[{addr.postal_code}]</p>
            {/if}
            {#if addr.recipient || addr.phone}
              <p class="addr-sub">
                {[addr.recipient, addr.phone].filter(Boolean).join(' · ')}
              </p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- 추가 폼 -->
    {#if showAddForm}
      <div class="add-form-wrap">
        <p class="form-title">새 배송지 등록</p>
        <form
          method="POST"
          action="/account/profile?/addAddress"
          use:enhance={() => {
            isSubmitting = true
            return async ({ result }) => {
              isSubmitting = false
              if (result.type === 'success') {
                csToast.success('배송지가 등록되었습니다.')
                resetForm()
                await invalidateAll()
              } else if (result.type === 'failure') {
                csToast.error((result.data as { error?: string })?.error ?? '등록 실패')
              }
            }
          }}
          class="add-form"
        >
          <div class="form-row">
            <label class="form-label" for="addr-road-btn">기본주소 <span class="required">*</span></label>
            <input type="hidden" name="road_address" value={newRoadAddress} />
            <input type="hidden" name="postal_code"  value={newPostalCode}  />
            <button
              id="addr-road-btn"
              type="button"
              class="form-input addr-search-btn"
              onclick={openKakaoModal}
            >
              {#if newRoadAddress}
                <span class="addr-value">{newRoadAddress}</span>
              {:else}
                <span class="addr-placeholder">도로명 주소 입력 (탭하여 검색)</span>
              {/if}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </button>
            {#if newPostalCode}
              <p class="addr-postal-hint">[{newPostalCode}]</p>
            {/if}
          </div>
          <div class="form-row">
            <label class="form-label" for="addr-detail">상세주소</label>
            <input
              id="addr-detail"
              class="form-input"
              type="text"
              name="detail_address"
              bind:value={newDetailAddress}
              bind:this={detailInput}
              placeholder="상세주소 입력 (동·호수 등)"
            />
          </div>
          <div class="form-row">
            <label class="form-label" for="addr-recipient">수령인</label>
            <input
              id="addr-recipient"
              class="form-input"
              type="text"
              name="recipient"
              bind:value={newRecipient}
              placeholder="수령인 이름"
            />
          </div>
          <div class="form-row">
            <label class="form-label" for="addr-phone">연락처</label>
            <input
              id="addr-phone"
              class="form-input"
              type="text"
              name="phone"
              value={newPhone}
              oninput={handlePhoneInput}
              placeholder="010-0000-0000"
            />
          </div>
          <div class="form-row">
            <label class="form-label" for="addr-label">별칭</label>
            <input
              id="addr-label"
              class="form-input"
              type="text"
              name="label"
              bind:value={newLabel}
              placeholder="예: 회사, 본가 (선택)"
              maxlength="20"
            />
          </div>

          {#if addresses.length > 0}
            <label class="check-row">
              <input type="hidden" name="set_default" value={newSetDefault ? 'true' : 'false'} />
              <button
                type="button"
                class="check-box"
                onclick={() => (newSetDefault = !newSetDefault)}
                aria-pressed={newSetDefault}
              >
                {#if newSetDefault}
                  <svg fill="none" viewBox="0 0 20 20" width="20" height="20"><rect fill="#444444" height="20" rx="5" width="20" /><path d="M3 10.7143L7.2 15L17 5" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" /></svg>
                {:else}
                  <svg fill="none" viewBox="0 0 20 20" width="20" height="20"><rect fill="white" height="18" rx="4" width="18" x="1" y="1" /><rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1" /></svg>
                {/if}
              </button>
              <span class="check-label">기본 배송지로 설정</span>
            </label>
          {:else}
            <input type="hidden" name="set_default" value="true" />
          {/if}

          <div class="form-btns">
            <button type="button" class="btn-cancel" onclick={resetForm}>취소</button>
            <button type="submit" class="btn-submit" disabled={isSubmitting || !newRoadAddress.trim()}>
              {isSubmitting ? '등록 중...' : '배송지 저장'}
            </button>
          </div>
        </form>
      </div>
    {/if}

    <!-- 5개 제한 안내 -->
    {#if addresses.length >= MAX_ADDRESSES}
      <p class="limit-notice">배송지는 최대 {MAX_ADDRESSES}개까지 등록할 수 있습니다.</p>
    {/if}

  </div>
</div>

<!-- 카카오 주소 검색 모달 -->
{#if showKakaoModal}
  <div class="kakao-overlay" role="dialog" aria-modal="true" aria-label="주소 검색">
    <div class="kakao-modal">
      <div class="kakao-modal-header">
        <span>주소 검색</span>
        <button class="kakao-close" onclick={() => (showKakaoModal = false)} aria-label="닫기">✕</button>
      </div>
      <div class="kakao-container" bind:this={kakaoContainer}></div>
    </div>
  </div>
{/if}

<style>
  .address-wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .address-card {
    background: white;
    border-radius: 30px 30px 0 0;
    width: 100%;
    padding: 40px 25px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .section-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .section-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: #100b32;
    letter-spacing: -0.5px;
    line-height: 1.6;
    margin: 0;
  }

  .section-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
    font-size: 12px;
    color: #aaa;
    letter-spacing: -0.5px;
    line-height: 1.6;
    margin: 4px 0 0;
  }

  .btn-add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 16px;
    background: #100b32;
    color: white;
    border: none;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .btn-add:hover { background: #201857; }

  /* 빈 상태 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 32px 0;
  }
  .empty-text {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: #aaa;
    margin: 0;
  }
  .btn-add-first {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 24px;
    background: #444;
    color: white;
    border: none;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-add-first:hover { background: #222; }

  /* 주소 목록 */
  .address-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .address-item {
    background: var(--cs-lilac);
    border-radius: 20px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .address-item.is-default {
    background: var(--cs-lilac);
  }

  .addr-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .addr-badge {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 11px;
    flex-shrink: 0;
  }
  .badge-default {
    background: #100b32;
    color: white;
  }
  .badge-extra {
    background: #e8e8e8;
    color: #666;
  }

  .addr-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: #666;
    font-weight: 500;
  }

  .addr-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }

  .btn-set-default {
    height: 26px;
    padding: 0 10px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    font-weight: 600;
    color: #444;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s;
  }
  .btn-set-default:hover:not(:disabled) { background: #f0effb; border-color: #100b32; color: #100b32; }
  .btn-set-default:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: #bbb;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .btn-delete:hover:not(:disabled) { background: rgba(255,53,53,0.08); color: #ff3535; }
  .btn-delete:disabled { opacity: 0.4; cursor: not-allowed; }

  .addr-main {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 15px;
    color: #100b32;
    letter-spacing: -0.5px;
    line-height: 1.5;
    margin: 0;
  }

  .addr-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: #888;
    margin: 0;
    letter-spacing: -0.3px;
  }

  /* 추가 폼 */
  .add-form-wrap {
    background: #f6f6f6;
    border-radius: 20px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: #100b32;
    margin: 0;
  }

  .add-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 600;
    color: #666;
    letter-spacing: -0.3px;
  }
  .required { color: #ff3535; }

  .form-input {
    background: white;
    border: 1px solid #e8e8e8;
    border-radius: 12px;
    padding: 10px 14px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: #100b32;
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.12s;
  }
  .form-input:focus { outline: none; border-color: #100b32; }
  .form-input::placeholder { color: #bbb; }

  .check-row {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  .check-box {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
  }
  .check-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: #444;
    letter-spacing: -0.3px;
  }

  .form-btns {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 4px;
  }

  .btn-cancel {
    height: 44px;
    padding: 0 20px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 600;
    color: #666;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-cancel:hover { background: #f0f0f0; }

  .btn-submit {
    height: 44px;
    padding: 0 24px;
    background: #100b32;
    border: none;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: white;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-submit:hover:not(:disabled) { background: #201857; }
  .btn-submit:disabled { background: #ccc; cursor: not-allowed; }

  .limit-notice {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: #aaa;
    text-align: center;
    margin: 0;
    padding: 8px 0;
  }

  /* 카카오 주소 검색 버튼 */
  .addr-search-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    text-align: left;
  }
  .addr-value      { color: #100b32; }
  .addr-placeholder { color: #bbb; }
  .addr-postal-hint {
    font-size: 12px;
    color: #888;
    margin: 4px 0 0;
    letter-spacing: -0.3px;
  }

  /* 카카오 모달 오버레이 */
  .kakao-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .kakao-modal {
    background: white;
    border-radius: 20px;
    width: 100%;
    max-width: 460px;
    height: 500px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .kakao-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #eee;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 15px;
    color: #100b32;
    flex-shrink: 0;
  }
  .kakao-close {
    background: none;
    border: none;
    font-size: 18px;
    color: #888;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
  }
  .kakao-container {
    flex: 1;
    width: 100%;
  }
</style>
