<script lang="ts">
  // PRD.1.7 — ChatInput: 메시지 입력 바
  // Figma node: 2497:8789 (Message Input Main)
  // 배경: --cs-points (#C1BBEC), 높이 93px, 첨부 + 입력 + 전송

  interface Props {
    disabled?: boolean
    placeholder?: string
    onsend?: (content: string) => void
    onattach?: (file: File) => void
  }

  let { disabled = false, placeholder = '메시지를 입력하세요...', onsend, onattach }: Props = $props()

  let content = $state('')
  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let fileInputEl = $state<HTMLInputElement | null>(null)

  let canSend = $derived(content.trim().length > 0 && !disabled)

  function handleSend() {
    const text = content.trim()
    if (!text || disabled) return
    onsend?.(text)
    content = ''
    if (textareaEl) textareaEl.style.height = 'auto'
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleInput() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    const maxH = 72
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, maxH) + 'px'
  }

  function handleAttach() {
    fileInputEl?.click()
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    onattach?.(file)
    input.value = ''
  }
</script>

<div class="input-bar">
  <!-- 숨김 파일 입력 -->
  <input
    bind:this={fileInputEl}
    type="file"
    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
    style="display:none"
    onchange={handleFileChange}
  />

  <!-- pill 컨테이너 — Figma node 2497:8792 -->
  <div class="input-pill">
    <!-- 텍스트 입력 -->
    <textarea
      class="input-field"
      bind:this={textareaEl}
      bind:value={content}
      {placeholder}
      {disabled}
      rows="1"
      maxlength="1000"
      aria-label="메시지 입력"
      oninput={handleInput}
      onkeydown={handleKeydown}
    ></textarea>

    <!-- 오른쪽 아이콘 — 텍스트 없으면 첨부, 있으면 전송으로 교체 -->
    {#if canSend}
      <button
        class="icon-right send-btn"
        onclick={handleSend}
        aria-label="전송"
        type="button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
          <circle cx="17.5" cy="17.5" r="17.5" fill="#553FE0"/>
          <path d="M17.5711 24.4998L17.5711 10.4999M11.5 16.5L17.5711 10.4999L23.5 16.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    {:else}
      <button
        class="icon-right attach-btn"
        onclick={handleAttach}
        aria-label="파일 첨부"
        {disabled}
        type="button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
          <path d="M17.1886 13.8969C17.5791 13.5064 18.2123 13.5064 18.6028 13.8969C18.9933 14.2874 18.9933 14.9206 18.6028 15.3111L14.4309 19.483C13.8639 20.05 13.831 21.0045 14.4309 21.6044C15.0308 22.2042 15.9852 22.1713 16.5522 21.6044L24.3304 13.8262C25.932 12.2246 25.8444 9.68333 24.3304 8.16933C22.8164 6.65533 20.2751 6.5677 18.6735 8.16933L10.8953 15.9475C8.3446 18.4982 8.39217 22.6367 10.8953 25.1399C13.3985 27.6431 17.537 27.6906 20.0877 25.1399L24.2597 20.968C24.6502 20.5774 25.2833 20.5774 25.6739 20.968C26.0644 21.3585 26.0644 21.9917 25.6739 22.3822L21.5019 26.5541C18.1628 29.8933 12.7581 29.8311 9.48112 26.5541C6.20409 23.2771 6.14197 17.8724 9.48112 14.5333L17.2593 6.75512C19.6646 4.3498 23.4705 4.48104 25.7446 6.75512C28.0187 9.02919 28.1499 12.8351 25.7446 15.2404L17.9664 23.0186C16.6393 24.3456 14.4202 24.4221 13.0167 23.0186C11.6131 21.615 11.6896 19.3959 13.0167 18.0688L17.1886 13.8969Z" fill="#A0A1B0"/>
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  /* Figma node 2497:8792 — Message Input Main */
  .input-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    flex-shrink: 0;
    padding: 0;
  }

  /* pill 컨테이너 — surface-gray, 67px, radius 25px */
  .input-pill {
    flex: 1 0 0;
    min-width: 0;
    background: var(--cs-surface-gray);
    border-radius: 25px;
    height: 67px;
    display: flex;
    align-items: center;
    padding: 8px 15px;
    gap: 8px;
  }

  /* pill 우측 아이콘 공통 (첨부/전송 토글) */
  .icon-right {
    width: 35px;
    height: 35px;
    min-width: 35px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    border-radius: 50%;
    transition: opacity 0.15s;
  }

  .icon-right:hover:not(:disabled) {
    opacity: 0.75;
  }

  .icon-right:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* 입력 필드 — 투명 배경, pill 내부 */
  .input-field {
    flex: 1 0 0;
    min-width: 0;
    background: transparent;
    border: none;
    padding: 0;
    font: 400 16px/22px 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    letter-spacing: -0.2px;
    resize: none;
    outline: none;
    height: 36px;
    max-height: 72px;
    overflow-y: auto;
  }

  .input-field::placeholder {
    color: var(--cs-text-placeholder);
  }

  .input-field:focus {
    outline: none;
  }
</style>
