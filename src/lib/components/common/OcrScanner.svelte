<script lang="ts">
  /* global File */
  /**
   * OcrScanner.svelte — Tesseract.js 기반 OCR 컴포넌트
   * 재사용: 모바일 장치코드 스캔, 추후 사용자 증명서 등록 등
   *
   * 사용법:
   *   <OcrScanner lang="eng" onResult={(text) => { ... }} onError={(err) => { ... }} />
   */
  import { browser } from '$app/environment'
  import type { Worker } from 'tesseract.js'

  interface Props {
    lang?: string
    onResult: (text: string, imageUrl: string) => void
    onError?: (err: Error) => void
    onReady?: (triggerCamera: () => void) => void
    compact?: boolean
  }

  let { lang = 'eng', onResult, onError, onReady, compact = false }: Props = $props()

  let worker: Worker | null = null
  let isReady = $state(false)
  let isProcessing = $state(false)
  let progress = $state(0)
  let statusMsg = $state('초기화 중...')
  let fileInputEl = $state<HTMLInputElement | null>(null)
  let cameraInputEl = $state<HTMLInputElement | null>(null)
  let currentImageUrl = $state<string | null>(null)

  $effect(() => {
    if (!browser) return
    let cancelled = false

    // workerPath를 자체 도메인에서 제공 (CDN 의존 제거)
    import('tesseract.js').then(({ createWorker }) =>
      createWorker(lang, 1, {
        workerPath: '/tesseract-worker.min.js',
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => {
          if (cancelled) return
          if (m.status === 'recognizing text') {
            progress = Math.round(m.progress * 100)
            statusMsg = `인식 중... ${progress}%`
          }
        },
      })
    ).then(w => {
      if (cancelled) { w.terminate(); return }
      worker = w
      isReady = true
      statusMsg = '준비됨'
      onReady?.(triggerCamera)
    }).catch(err => {
      if (!cancelled) onError?.(err instanceof Error ? err : new Error(String(err)))
    })

    return () => {
      cancelled = true
      worker?.terminate()
      worker = null
      if (currentImageUrl) { URL.revokeObjectURL(currentImageUrl); currentImageUrl = null }
    }
  })

  async function processImage(file: File): Promise<void> {
    if (!worker || isProcessing) return
    isProcessing = true
    progress = 0
    statusMsg = '이미지 분석 중...'
    // 이전 object URL 해제
    if (currentImageUrl) { URL.revokeObjectURL(currentImageUrl); currentImageUrl = null }
    const imageUrl = URL.createObjectURL(file)
    currentImageUrl = imageUrl
    try {
      const { data: { text } } = await worker.recognize(file)
      const cleaned = text.trim().replace(/\s+/g, ' ')
      onResult(cleaned, imageUrl)
      statusMsg = '인식 완료'
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      onError?.(e)
      statusMsg = '인식 실패 — 수동 입력을 이용하세요.'
    } finally {
      isProcessing = false
      progress = 0
    }
  }

  function handleFileChange(e: Event): void {
    const files = (e.target as HTMLInputElement).files
    if (files?.length) processImage(files[0])
    ;(e.target as HTMLInputElement).value = ''
  }

  function triggerCamera(): void {
    cameraInputEl?.click()
  }

  function triggerFile(): void {
    fileInputEl?.click()
  }
</script>

<div class="ocr-scanner">
  <div class="ocr-status" aria-live="polite">
    <span class="ocr-status-dot" class:ready={isReady} class:processing={isProcessing}></span>
    <span class="ocr-status-text">{statusMsg}</span>
  </div>

  {#if isProcessing && progress > 0}
    <div class="ocr-progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
      <div class="ocr-progress-fill" style="width:{progress}%"></div>
    </div>
  {/if}

  {#if !compact}
    <div class="ocr-actions">
      <button
        type="button"
        class="ocr-btn ocr-btn-camera"
        onclick={triggerCamera}
        disabled={!isReady || isProcessing}
        aria-label="카메라로 코드 촬영"
      >
        카메라 촬영
      </button>
      <button
        type="button"
        class="ocr-btn ocr-btn-file"
        onclick={triggerFile}
        disabled={!isReady || isProcessing}
        aria-label="파일에서 이미지 선택"
      >
        이미지 선택
      </button>
    </div>
  {/if}

  <!-- 카메라 캡처 전용 input -->
  <input
    bind:this={cameraInputEl}
    type="file"
    accept="image/*"
    capture="environment"
    style="display:none"
    onchange={handleFileChange}
    aria-hidden="true"
  />
  <!-- 파일 선택 input -->
  <input
    bind:this={fileInputEl}
    type="file"
    accept="image/*"
    style="display:none"
    onchange={handleFileChange}
    aria-hidden="true"
  />
</div>

<style>
  .ocr-scanner {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .ocr-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .ocr-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cs-disabled-toggle);
    flex-shrink: 0;
    transition: background 0.2s;
  }
  .ocr-status-dot.ready { background: var(--cs-success-light); }
  .ocr-status-dot.processing {
    background: var(--cs-purple);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .ocr-status-text { color: var(--cs-text-mid); }

  .ocr-progress-bar {
    height: 4px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .ocr-progress-fill {
    height: 100%;
    background: var(--cs-purple);
    border-radius: var(--radius-full);
    transition: width 0.2s;
  }

  .ocr-actions {
    display: flex;
    gap: 8px;
  }

  .ocr-btn {
    flex: 1;
    height: 44px;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .ocr-btn:hover:not(:disabled) { background: rgba(59,47,138,0.06); }
  .ocr-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .ocr-btn-camera { border-color: var(--cs-orange); color: var(--cs-orange); }
  .ocr-btn-camera:hover:not(:disabled) { background: rgba(255,69,0,0.06); }
</style>
