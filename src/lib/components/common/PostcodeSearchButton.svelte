<script lang="ts">
  // PostcodeSearchButton.svelte
  // Daum Postcode(카카오 주소 검색) 위젯을 재사용 가능한 버튼+모달로 공용화.
  // AddressTabContent.svelte 및 cart/+page.svelte 등에서 공유.
  import { tick } from 'svelte'
  import { csToast } from '$lib/utils/toast'

  interface KakaoAddressData {
    roadAddress: string
    jibunAddress: string
    zonecode: string
  }

  type KakaoPostcodeCtor = new (opts: {
    oncomplete: (data: KakaoAddressData) => void
    width?: string
    height?: string
  }) => { open(): void; embed(el: HTMLElement, opts?: { autoClose?: boolean }): void }

  interface KakaoWindow extends Window {
    daum?: { Postcode: KakaoPostcodeCtor }
  }

  interface Props {
    /** 현재 선택된 도로명 주소 (표시용) */
    value?: string
    /** 버튼에 표시할 placeholder 텍스트 */
    placeholder?: string
    /** 버튼 id (label for 연결용) */
    id?: string
    /** 주소 선택 완료 콜백 */
    onselect: (roadAddress: string, postalCode: string) => void
  }

  let {
    value = '',
    placeholder = '도로명 주소 입력 (클릭하여 검색)',
    id = 'postcode-search-btn',
    onselect,
  }: Props = $props()

  let showModal    = $state(false)
  let container    = $state<HTMLDivElement | null>(null)

  function loadScript(): Promise<void> {
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

  async function open() {
    if (typeof window === 'undefined') return
    showModal = true
    try {
      await loadScript()
    } catch {
      csToast.error('주소 검색 서비스를 불러올 수 없습니다.')
      showModal = false
      return
    }
    await tick()
    const w = window as KakaoWindow
    if (!w.daum?.Postcode || !container) { showModal = false; return }
    new w.daum.Postcode({
      oncomplete: (data: KakaoAddressData) => {
        onselect(data.roadAddress || data.jibunAddress, data.zonecode)
        showModal = false
      },
      width:  '100%',
      height: '100%',
    }).embed(container, { autoClose: false })
  }
</script>

<button
  {id}
  type="button"
  class="postcode-btn"
  onclick={open}
  aria-label="주소 검색"
>
  {#if value}
    <span class="postcode-value">{value}</span>
  {:else}
    <span class="postcode-placeholder">{placeholder}</span>
  {/if}
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
</button>

{#if showModal}
  <div class="postcode-overlay" role="dialog" aria-modal="true" aria-label="주소 검색">
    <div class="postcode-modal">
      <div class="postcode-modal-header">
        <span>주소 검색</span>
        <button
          type="button"
          class="postcode-close"
          onclick={() => (showModal = false)}
          aria-label="닫기"
        >✕</button>
      </div>
      <div class="postcode-container" bind:this={container}></div>
    </div>
  </div>
{/if}

<style>
  .postcode-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    padding: 10px 14px;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: var(--radius-md, 15px);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: 14px;
    color: var(--cs-text, #100b32);
    transition: border-color 0.15s;
  }

  .postcode-btn:hover {
    border-color: var(--cs-purple, #3b2f8a);
  }

  .postcode-placeholder {
    color: #aaa;
    flex: 1;
  }

  .postcode-value {
    color: var(--cs-text, #100b32);
    flex: 1;
    word-break: break-all;
  }

  /* 오버레이 */
  .postcode-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .postcode-modal {
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    width: 100%;
    max-width: 500px;
    height: 480px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  }

  .postcode-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid #eee;
    font-weight: 700;
    font-size: 15px;
    color: var(--cs-text, #100b32);
  }

  .postcode-close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 18px;
    color: #888;
    padding: 4px 8px;
    min-width: 32px;
    min-height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: background 0.15s;
  }

  .postcode-close:hover {
    background: #f5f5f5;
  }

  .postcode-container {
    flex: 1;
    overflow: hidden;
  }
</style>
