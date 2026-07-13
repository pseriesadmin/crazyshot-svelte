<script lang="ts">
  import { goto } from '$app/navigation'
  import { matchesSearch } from '$lib/utils/chosungSearch'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  let searchQuery = $state('')

  const filtered = $derived(
    data.products.filter(p => matchesSearch({ name: p.name, product_code: p.product_code }, searchQuery))
  )

  function thumbUrl(imageUrls: string[]): string {
    const first = imageUrls[0]
    if (!first) return ''
    if (first.includes('/large_')) return first.replace('/large_', '/thumb_')
    return first
  }

  // ── QR 스캐너 ──────────────────────────────────────────
  let showQrScanner = $state(false)
  let qrStatus = $state<'idle' | 'scanning' | 'detected' | 'error' | 'unsupported'>('idle')
  let qrError = $state('')
  let videoEl = $state<HTMLVideoElement | null>(null)
  let qrFileInput = $state<HTMLInputElement | null>(null)

  let mediaStream: MediaStream | null = null
  let scanRafId: number | null = null

  interface BarcodeDetectorLike {
    detect(image: ImageBitmapSource): Promise<Array<{ rawValue: string; format: string }>>
  }
  interface BarcodeDetectorConstructor {
    new(options?: { formats: string[] }): BarcodeDetectorLike
  }

  function hasBarcodeDetector(): boolean {
    return typeof window !== 'undefined' && 'BarcodeDetector' in window
  }

  function createBarcodeDetector(formats: string[]): BarcodeDetectorLike {
    const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorConstructor }).BarcodeDetector
    return new Ctor({ formats })
  }

  /** QR URL에서 product UUID 추출 */
  function extractProductId(raw: string): string | null {
    // https://crazyshot.kr/qr/product/{id} 또는 /qr/product/{id}
    const match = raw.match(/\/qr\/product\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
    if (match?.[1]) return match[1]
    // product_code 형태 (하이픈 없는 대문자 코드)
    const codeMatch = raw.match(/\/qr\/product\/([A-Z0-9]{3,20})$/i)
    if (codeMatch?.[1]) return codeMatch[1]
    return null
  }

  async function openQrScanner(): Promise<void> {
    showQrScanner = true
    qrStatus = 'idle'
    qrError = ''

    if (!hasBarcodeDetector()) {
      qrStatus = 'unsupported'
      return
    }

    await startCameraScan()
  }

  async function startCameraScan(): Promise<void> {
    qrStatus = 'scanning'
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      if (videoEl) {
        videoEl.srcObject = mediaStream
        await videoEl.play()
        beginScanLoop()
      }
    } catch (e) {
      qrStatus = 'error'
      qrError = '카메라 접근 권한이 필요합니다.'
    }
  }

  function beginScanLoop(): void {
    if (!hasBarcodeDetector()) return
    const detector = createBarcodeDetector(['qr_code'])

    async function tick(): Promise<void> {
      if (!showQrScanner || !videoEl || videoEl.readyState < 2) {
        scanRafId = requestAnimationFrame(tick)
        return
      }
      try {
        const barcodes = await detector.detect(videoEl)
        if (barcodes.length > 0) {
          const raw = barcodes[0].rawValue
          handleDetected(raw)
          return
        }
      } catch { /* 프레임 처리 중 무시 */ }
      scanRafId = requestAnimationFrame(tick)
    }
    scanRafId = requestAnimationFrame(tick)
  }

  function handleDetected(raw: string): void {
    stopCamera()
    const id = extractProductId(raw)
    if (id) {
      qrStatus = 'detected'
      showQrScanner = false
      goto(`/cms/mobile/${id}`)
    } else {
      qrStatus = 'error'
      qrError = `QR 코드를 인식했으나 상품 정보를 찾을 수 없습니다.\n(${raw.slice(0, 60)})`
    }
  }

  function stopCamera(): void {
    if (scanRafId !== null) {
      cancelAnimationFrame(scanRafId)
      scanRafId = null
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop())
      mediaStream = null
    }
  }

  function closeQrScanner(): void {
    stopCamera()
    showQrScanner = false
    qrStatus = 'idle'
    qrError = ''
  }

  /** iOS / BarcodeDetector 미지원 환경: 파일 캡처 후 decode 시도 */
  async function handleQrFileCapture(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0]
    ;(e.target as HTMLInputElement).value = ''
    if (!file) return

    qrStatus = 'scanning'
    qrError = ''

    if (!hasBarcodeDetector()) {
      qrStatus = 'error'
      qrError = '이 브라우저는 QR 자동 인식을 지원하지 않습니다.\n기기 기본 카메라 앱으로 QR을 스캔하면 상품 페이지로 이동합니다.'
      return
    }

    try {
      const bitmap = await createImageBitmap(file)
      const detector = createBarcodeDetector(['qr_code'])
      const barcodes = await detector.detect(bitmap)
      bitmap.close()
      if (barcodes.length > 0) {
        handleDetected(barcodes[0].rawValue)
      } else {
        qrStatus = 'error'
        qrError = 'QR 코드를 인식하지 못했습니다. 더 가깝게 촬영해주세요.'
      }
    } catch {
      qrStatus = 'error'
      qrError = 'QR 인식 중 오류가 발생했습니다.'
    }
  }

  // 스캐너 닫힐 때 카메라 정리
  $effect(() => {
    if (!showQrScanner) stopCamera()
  })
</script>

<div class="mob-page">
  <div class="search-wrap">
    <input
      type="search"
      class="search-input"
      placeholder="상품명·자음·품번 검색 (예: 소니, ㅅㄴ, CAM)"
      bind:value={searchQuery}
      aria-label="상품 검색"
    />
  </div>

  {#if data.products.length >= 200}
    <div class="limit-notice" role="alert">최대 200개까지 표시됩니다.</div>
  {/if}

  {#if filtered.length === 0}
    <div class="no-data">검색 결과가 없습니다.</div>
  {:else}
    <ul class="product-list" role="list">
      {#each filtered as product (product.id)}
        <li>
          <button
            type="button"
            class="product-item"
            onclick={() => goto(`/cms/mobile/${product.id}`)}
          >
            <div class="product-thumb-wrap">
              {#if thumbUrl(product.image_urls)}
                <img
                  src={thumbUrl(product.image_urls)}
                  alt={product.name}
                  class="product-thumb"
                  loading="lazy"
                />
              {:else}
                <div class="product-thumb-placeholder" aria-hidden="true">📦</div>
              {/if}
            </div>
            <div class="product-info">
              <span class="product-name">{product.name}</span>
              {#if product.product_code}
                <span class="product-code">{product.product_code}</span>
              {:else}
                <span class="product-code no-code">품번 미발행</span>
              {/if}
            </div>
            <span class="product-arrow" aria-hidden="true">›</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- 카메라 FAB (하단 우측 고정) -->
<button
  type="button"
  class="qr-fab"
  onclick={openQrScanner}
  aria-label="QR 코드 스캔"
  title="상품 QR 스캔"
>
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <!-- 카메라 본체 -->
    <rect x="2" y="7" width="24" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
    <!-- 렌즈 -->
    <circle cx="14" cy="15.5" r="5" fill="none" stroke="currentColor" stroke-width="2"/>
    <!-- 뷰파인더 -->
    <rect x="10" y="4" width="8" height="3" rx="1.5" fill="currentColor"/>
    <!-- QR 힌트 점 -->
    <circle cx="6" cy="11" r="1.2" fill="currentColor"/>
  </svg>
</button>

<!-- 숨김 파일 입력 (iOS/미지원 fallback) -->
<input
  bind:this={qrFileInput}
  type="file"
  accept="image/*"
  capture="environment"
  style="display:none"
  onchange={handleQrFileCapture}
  aria-hidden="true"
/>

<!-- QR 스캐너 오버레이 -->
{#if showQrScanner}
  <div class="qr-overlay" role="dialog" aria-modal="true" aria-label="QR 코드 스캐너">
    <!-- 헤더 -->
    <div class="qr-header">
      <span class="qr-title">상품 QR 스캔</span>
      <button type="button" class="qr-close-btn" onclick={closeQrScanner} aria-label="닫기">✕</button>
    </div>

    {#if qrStatus === 'unsupported'}
      <!-- BarcodeDetector 미지원 (iOS 등) -->
      <div class="qr-unsupported-wrap">
        <div class="qr-unsupported-icon" aria-hidden="true">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <rect x="4" y="4" width="20" height="20" rx="3" stroke="currentColor" stroke-width="2.5" fill="none"/>
            <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor"/>
            <rect x="32" y="4" width="20" height="20" rx="3" stroke="currentColor" stroke-width="2.5" fill="none"/>
            <rect x="36" y="8" width="8" height="8" rx="1" fill="currentColor"/>
            <rect x="4" y="32" width="20" height="20" rx="3" stroke="currentColor" stroke-width="2.5" fill="none"/>
            <rect x="8" y="36" width="8" height="8" rx="1" fill="currentColor"/>
            <line x1="32" y1="36" x2="52" y2="36" stroke="currentColor" stroke-width="2.5"/>
            <line x1="32" y1="44" x2="44" y2="44" stroke="currentColor" stroke-width="2.5"/>
            <line x1="52" y1="44" x2="52" y2="52" stroke="currentColor" stroke-width="2.5"/>
            <line x1="44" y1="52" x2="52" y2="52" stroke="currentColor" stroke-width="2.5"/>
          </svg>
        </div>
        <p class="qr-unsupported-title">카메라 QR 자동인식 미지원</p>
        <p class="qr-unsupported-desc">
          이 브라우저는 실시간 QR 인식을 지원하지 않습니다.<br/>
          아래 버튼으로 사진을 찍거나,<br/>
          <strong>기기 기본 카메라 앱</strong>으로 QR을 스캔하면<br/>
          상품 페이지로 자동 이동됩니다.
        </p>
        {#if qrStatus === 'unsupported'}
          <button
            type="button"
            class="qr-capture-btn"
            onclick={() => qrFileInput?.click()}
          >사진으로 QR 스캔</button>
        {/if}
        {#if qrError}
          <p class="qr-error-msg" role="alert">{qrError}</p>
        {/if}
      </div>

    {:else if qrStatus === 'error'}
      <!-- 에러 상태 -->
      <div class="qr-unsupported-wrap">
        <p class="qr-error-msg" role="alert">{qrError}</p>
        {#if hasBarcodeDetector()}
          <button type="button" class="qr-capture-btn" onclick={startCameraScan}>다시 시도</button>
        {:else}
          <button type="button" class="qr-capture-btn" onclick={() => qrFileInput?.click()}>사진으로 다시 시도</button>
        {/if}
      </div>

    {:else}
      <!-- 카메라 뷰파인더 (scanning / idle) -->
      <div class="qr-viewfinder-wrap">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          bind:this={videoEl}
          class="qr-video"
          autoplay
          playsinline
          muted
        ></video>
        <!-- 스캔 프레임 오버레이 -->
        <div class="qr-frame-overlay" aria-hidden="true">
          <div class="qr-frame">
            <span class="qr-corner tl"></span>
            <span class="qr-corner tr"></span>
            <span class="qr-corner bl"></span>
            <span class="qr-corner br"></span>
            <div class="qr-scan-line"></div>
          </div>
        </div>
      </div>
      <p class="qr-hint">QR 코드를 프레임 안에 맞춰주세요</p>
    {/if}
  </div>
{/if}

<style>
  .mob-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    background: var(--cs-lilac);
  }

  .search-wrap {
    padding: 10px 14px 6px;
    background: var(--cs-lilac);
  }

  .search-input {
    width: 100%;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    padding: 10px 16px;
    font-size: 15px;
    color: var(--cs-text);
    height: 44px;
  }
  .search-input::placeholder { color: var(--cs-text-placeholder); }
  .search-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .limit-notice {
    margin: 10px 16px 0;
    padding: 8px 12px;
    background: var(--cs-bg-warning);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--cs-text-warning);
  }

  .no-data {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--cs-text-light);
    padding: 48px 20px;
  }

  .product-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0 12px 24px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .product-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    padding: 12px 14px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    min-height: 64px;
    transition: background 0.12s;
  }
  .product-item:active { background: rgba(59,47,138,0.06); }

  .product-thumb-wrap {
    width: 48px;
    height: 36px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--cs-surface-gray);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .product-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .product-thumb-placeholder {
    font-size: 20px;
  }

  .product-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .product-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .product-code {
    font-size: 12px;
    color: var(--cs-text-mid);
  }
  .product-code.no-code { color: var(--cs-text-light); }

  .product-arrow {
    font-size: 22px;
    color: var(--cs-text-light);
    flex-shrink: 0;
    line-height: 1;
  }

  /* ── QR FAB ── */
  .qr-fab {
    position: fixed;
    bottom: 24px;
    right: 20px;
    z-index: 100;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-full);
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(59,47,138,0.35);
    transition: background 0.15s, transform 0.15s;
  }
  .qr-fab:hover   { background: var(--cs-purple-hover); transform: scale(1.06); }
  .qr-fab:active  { transform: scale(0.96); }

  /* ── QR 스캐너 오버레이 ── */
  .qr-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16,11,50,0.96);
    display: flex;
    flex-direction: column;
    color: var(--cs-white);
  }

  .qr-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    flex-shrink: 0;
  }

  .qr-title {
    font-size: 17px;
    font-weight: 700;
    color: var(--cs-white);
  }

  .qr-close-btn {
    width: 44px;
    height: 44px;
    background: rgba(255,255,255,0.12);
    border: none;
    border-radius: var(--radius-full);
    color: var(--cs-white);
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }
  .qr-close-btn:hover { background: rgba(255,255,255,0.22); }

  /* 카메라 뷰파인더 */
  .qr-viewfinder-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(16,11,50,0.95);
  }

  .qr-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* 프레임 오버레이 */
  .qr-frame-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      linear-gradient(rgba(16,11,50,0.55) 0%, transparent 25%),
      linear-gradient(transparent 75%, rgba(16,11,50,0.55) 100%),
      linear-gradient(to right, rgba(16,11,50,0.55) 0%, transparent 25%),
      linear-gradient(to left,  rgba(16,11,50,0.55) 0%, transparent 25%);
  }

  .qr-frame {
    position: relative;
    width: min(72vw, 260px);
    height: min(72vw, 260px);
    overflow: hidden;
  }

  /* 모서리 마커 */
  .qr-corner {
    position: absolute;
    width: 28px;
    height: 28px;
    border-color: var(--cs-white);
    border-style: solid;
  }
  .qr-corner.tl { top: 0; left: 0;  border-width: 3px 0 0 3px; border-radius: 4px 0 0 0; }
  .qr-corner.tr { top: 0; right: 0; border-width: 3px 3px 0 0; border-radius: 0 4px 0 0; }
  .qr-corner.bl { bottom: 0; left: 0;  border-width: 0 0 3px 3px; border-radius: 0 0 0 4px; }
  .qr-corner.br { bottom: 0; right: 0; border-width: 0 3px 3px 0; border-radius: 0 0 4px 0; }

  /* 스캔 라인 */
  .qr-scan-line {
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    background: var(--cs-purple-pale);
    box-shadow: 0 0 8px 2px rgba(193,187,236,0.5);
    animation: scan-move 1.8s ease-in-out infinite;
  }
  @keyframes scan-move {
    0%   { top: 6px;  opacity: 0.8; }
    50%  { top: calc(100% - 8px); opacity: 1; }
    100% { top: 6px;  opacity: 0.8; }
  }

  .qr-hint {
    flex-shrink: 0;
    text-align: center;
    padding: 14px 20px 24px;
    font-size: 14px;
    color: rgba(255,255,255,0.7);
    margin: 0;
  }

  /* 미지원 / 에러 상태 */
  .qr-unsupported-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 24px 32px;
    text-align: center;
  }

  .qr-unsupported-icon { opacity: 0.6; }

  .qr-unsupported-title {
    font-size: 17px;
    font-weight: 700;
    color: var(--cs-white);
    margin: 0;
  }

  .qr-unsupported-desc {
    font-size: 14px;
    line-height: 1.7;
    color: rgba(255,255,255,0.7);
    margin: 0;
  }

  .qr-capture-btn {
    height: 48px;
    padding: 0 28px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
    margin-top: 4px;
  }
  .qr-capture-btn:hover { background: var(--cs-purple-hover); }

  .qr-error-msg {
    font-size: 13px;
    color: var(--cs-red-badge);
    background: rgba(255,53,53,0.12);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    margin: 0;
    white-space: pre-line;
    line-height: 1.6;
  }
</style>
