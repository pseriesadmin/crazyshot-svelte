<script lang="ts">
  interface Props {
    open: boolean
    /** 스캔 성공 시 호출. false를 반환하면 "인식 실패" 에러를 오버레이 내부에 표시하고 스캔을 재개한다. */
    onDetected: (raw: string) => boolean | void
    onClose: () => void
  }
  let { open = $bindable(false), onDetected, onClose }: Props = $props()

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

  async function startScan(): Promise<void> {
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
    } catch {
      qrStatus = 'error'
      qrError = '카메라 접근 권한이 필요합니다.'
    }
  }

  function beginScanLoop(): void {
    if (!hasBarcodeDetector()) return
    const detector = createBarcodeDetector(['qr_code'])

    async function tick(): Promise<void> {
      if (!open || !videoEl || videoEl.readyState < 2) {
        scanRafId = requestAnimationFrame(tick)
        return
      }
      try {
        const barcodes = await detector.detect(videoEl)
        if (barcodes.length > 0) {
          handleDetected(barcodes[0].rawValue)
          return
        }
      } catch { /* 프레임 처리 중 무시 */ }
      scanRafId = requestAnimationFrame(tick)
    }
    scanRafId = requestAnimationFrame(tick)
  }

  function handleDetected(raw: string): void {
    stopCamera()
    const accepted = onDetected(raw)
    if (accepted === false) {
      qrStatus = 'error'
      qrError = `QR 코드를 인식했으나 상품 정보를 찾을 수 없습니다.\n(${raw.slice(0, 60)})`
      return
    }
    qrStatus = 'detected'
    open = false
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

  function close(): void {
    stopCamera()
    open = false
    qrStatus = 'idle'
    qrError = ''
    onClose()
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

  $effect(() => {
    if (open) startScan()
    else stopCamera()
  })
</script>

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

{#if open}
  <div class="qr-overlay" role="dialog" aria-modal="true" aria-label="QR 코드 스캐너">
    <!-- 헤더 -->
    <div class="qr-header">
      <span class="qr-title">상품 QR 스캔</span>
      <button type="button" class="qr-close-btn" onclick={close} aria-label="닫기">✕</button>
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
        <button
          type="button"
          class="qr-capture-btn"
          onclick={() => qrFileInput?.click()}
        >사진으로 QR 스캔</button>
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
