<script lang="ts">
  /**
   * PdfViewer.svelte — 자체 PDF 뷰어 (pdf.js 기반, 브라우저 기본 PDF 뷰어와 같은 구조의 도구줄)
   *
   * 왜 직접 만드나: 브라우저 내장 뷰어는 모양·기능이 브라우저마다 달라(특히 모바일은 첫 쪽만 보이거나 아예 안 열림)
   * 일관된 화면을 보장할 수 없고, 앞으로 전자계약 PDF에 "복호화"·"원본 비교" 같은 기능을 붙여야 한다.
   * 이 컴포넌트는 PDF 바이트를 직접 받아(fetch) 가공(prepareBytes) → pdf.js로 그리므로, 그 지점에 기능을 끼워 넣을 수 있다.
   *
   * 구조(브라우저 PDF 뷰어와 동일): [쪽 목록 토글] [파일명] │ [쪽 n / N] │ [− 배율 +] [가로 맞춤] [회전] │ [추가 동작] [내려받기] [인쇄]
   *
   * 확장 지점:
   *   - prepareBytes(bytes): 내려받은 바이트를 화면에 그리기 전에 변환(복호화 등). 실패하면 오류 화면.
   *   - onLoaded({ pageCount, bytes }): 로드 직후 원본 바이트를 받아 해시 계산·원본 비교 등에 사용.
   *   - extraActions 스니펫: 도구줄 오른쪽에 추가 버튼(예: "원본 일치 확인").
   *
   * 주의: 브라우저 전용(pdf.js는 동적 import). 내려받기는 서버 API(attachment)로 연결해 교부 증빙 기록이 남게 한다.
   */
  import { tick, untrack, type Snippet } from 'svelte'
  import { browser } from '$app/environment'
  // pdf.js 워커 — Vite `?url` 임포트(pdfRasterize.ts와 같은 방식). 구형 iOS Safari까지 지원하도록 legacy 빌드를 쓴다.
  import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
  import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
  import {
    clampPage,
    currentPageFromScroll,
    fitWidthZoom,
    isIosDevice,
    normalizeRotation,
    pickLoadErrorMessage,
    pdfScale,
    stepZoom,
    thumbnailScale,
    toDisplayPercent,
    type PageBox,
  } from '$lib/utils/pdfViewerLogic'

  interface Props {
    /** PDF를 가져올 주소(같은 출처 — 로그인 쿠키로 인증) */
    src: string | null
    /** src가 없을 때(아직 PDF가 없는 상태) 빈 캔버스에 보여 줄 안내 — 도구줄은 그대로 보이고 버튼은 비활성 */
    emptyMessage?: string
    /** 도구줄에 표시할 파일 이름 */
    title?: string
    /** 내려받기 주소(서버가 attachment로 내려주는 주소 — 교부 증빙 기록용) */
    downloadUrl?: string
    downloadFilename?: string
    /** 바이트 변환 훅(복호화 등) */
    prepareBytes?: (bytes: Uint8Array) => Promise<Uint8Array>
    onLoaded?: (info: { pageCount: number; bytes: Uint8Array }) => void
    onError?: (message: string) => void
    /** 도구줄 오른쪽 추가 동작 */
    extraActions?: Snippet
  }

  let {
    src,
    emptyMessage = 'PDF가 아직 없습니다.',
    title = '전자계약서.pdf',
    downloadUrl,
    downloadFilename,
    prepareBytes,
    onLoaded,
    onError,
    extraActions,
  }: Props = $props()

  const PAGE_PADDING = 12 // 쪽 좌우 여백(px) — 가로 맞춤 계산에 사용
  const THUMB_WIDTH = 112

  /** 고객에게 그대로 보여 줘도 되는 불러오기 실패 안내 */
  class ViewerLoadError extends Error {}

  type Status = 'loading' | 'ready' | 'error' | 'empty'
  let status = $state<Status>('loading')
  let errorMessage = $state('')
  let pageCount = $state(0)
  let currentPage = $state(1)
  let pageInput = $state('1')
  let pageInputFocused = $state(false)
  let zoomMode = $state<'fit' | 'custom'>('fit')
  let customZoom = $state(1)
  let rotation = $state(0)
  let sidebarOpen = $state(false)
  let containerWidth = $state(0)
  /** 쪽별 기본 크기(pt, 쪽 자체 회전 반영·사용자 회전 미반영) */
  let baseSizes = $state<{ w: number; h: number }[]>([])

  let scrollEl: HTMLDivElement | null = $state(null)
  let pagesEl: HTMLDivElement | null = $state(null)
  let sidebarEl: HTMLDivElement | null = $state(null)

  // pdf.js 객체·바이트는 화면 반응성과 무관한 일반 변수로 둔다
  let doc: PDFDocumentProxy | null = null
  let keptBytes: Uint8Array | null = null
  let pageRotates: number[] = []

  const swapAxes = $derived(rotation % 180 !== 0)
  const firstPageWidthPt = $derived(baseSizes[0] ? (swapAxes ? baseSizes[0].h : baseSizes[0].w) : 0)
  const zoom = $derived(zoomMode === 'fit' ? fitWidthZoom(containerWidth, firstPageWidthPt, PAGE_PADDING) : customZoom)
  const zoomPercent = $derived(toDisplayPercent(zoom))
  const scale = $derived(pdfScale(zoom))

  function boxStyle(i: number): string {
    const b = baseSizes[i]
    if (!b) return 'width:0;height:0'
    const w = (swapAxes ? b.h : b.w) * scale
    const h = (swapAxes ? b.w : b.h) * scale
    return `width:${Math.floor(w)}px;height:${Math.floor(h)}px`
  }

  // ───────────────────────── 문서 불러오기 ─────────────────────────
  $effect(() => {
    if (!browser) return
    const url = src
    const controller = new AbortController()
    let cancelled = false

    errorMessage = ''
    pageCount = 0
    baseSizes = []
    if (!url) {
      status = 'empty'
      return
    }
    status = 'loading'

    ;(async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin', signal: controller.signal })
        if (!res.ok) {
          // 서버가 안내 문구를 준 상태(409·422·429)에서만 그 문구를 쓴다 — 예: "이전 작성 방식이라 미리보기를 만들 수 없어요. '보기' 버튼으로 확인해 주세요."
          let serverError: unknown = null
          try { serverError = ((await res.json()) as { error?: unknown } | null)?.error } catch { serverError = null }
          throw new ViewerLoadError(pickLoadErrorMessage(res.status, serverError))
        }
        let bytes: Uint8Array = new Uint8Array(await res.arrayBuffer())
        if (prepareBytes) bytes = await prepareBytes(bytes)
        if (cancelled) return

        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        // data는 pdf.js가 워커로 넘기며 비워지므로 복사본을 넘기고 원본 바이트는 인쇄·해시 계산용으로 보관한다
        const loaded = await pdfjs.getDocument({
          data: bytes.slice(),
          isEvalSupported: false,
          useSystemFonts: false,
        }).promise
        if (cancelled) {
          void loaded.destroy()
          return
        }

        const sizes: { w: number; h: number }[] = []
        const rotates: number[] = []
        for (let n = 1; n <= loaded.numPages; n++) {
          const page = await loaded.getPage(n)
          const vp = page.getViewport({ scale: 1 })
          sizes.push({ w: vp.width, h: vp.height })
          rotates.push(page.rotate)
        }
        if (cancelled) {
          void loaded.destroy()
          return
        }

        void doc?.destroy()
        doc = loaded
        keptBytes = bytes
        pageRotates = rotates
        baseSizes = sizes
        pageCount = loaded.numPages
        currentPage = 1
        pageInput = '1'
        status = 'ready'
        const info = { pageCount: loaded.numPages, bytes }
        // 확장 훅(원본 비교 등)이 예외를 던져도 정상으로 불러온 문서를 오류 화면으로 바꾸지 않는다
        try {
          untrack(() => onLoaded?.(info))
        } catch (hookError) {
          console.error('[PdfViewer] onLoaded 훅 오류(무시):', hookError)
        }
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return
        // 우리가 만든 안내 문구만 그대로 보이고, pdf.js·브라우저가 던진 영어 오류 문구는 고객에게 노출하지 않는다
        errorMessage = e instanceof ViewerLoadError ? e.message : '계약서를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
        status = 'error'
        untrack(() => onError?.(errorMessage))
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  })

  // 컴포넌트가 사라질 때 pdf.js 자원 해제
  $effect(() => {
    return () => {
      void doc?.destroy()
      doc = null
    }
  })

  // 초기 쪽 목록 표시: 넓은 화면은 열고, 좁은 화면은 닫는다(브라우저 PDF 뷰어와 동일)
  $effect(() => {
    if (!browser) return
    sidebarOpen = window.matchMedia('(min-width: 768px)').matches
  })

  // ───────────────────────── 쪽 그리기(보이는 쪽만) ─────────────────────────
  const rendered = new Map<number, string>()
  const tasks = new Map<number, RenderTask>()
  const thumbRendered = new Map<number, string>()
  let pageObserver: IntersectionObserver | null = null
  let thumbObserver: IntersectionObserver | null = null

  function dpr(): number {
    return Math.min(window.devicePixelRatio || 1, 2) // 모바일 메모리 보호
  }

  async function renderPage(n: number): Promise<void> {
    if (!doc || !pagesEl) return
    const key = `${zoom}|${rotation}`
    if (rendered.get(n) === key) return
    const holder = pagesEl.querySelector<HTMLElement>(`[data-page="${n}"]`)
    if (!holder) return
    tasks.get(n)?.cancel()
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale: scale, rotation: normalizeRotation((pageRotates[n - 1] ?? 0) + rotation) })
    let canvas = holder.querySelector('canvas')
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.setAttribute('aria-hidden', 'true')
      holder.appendChild(canvas)
    }
    const ratio = dpr()
    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
    tasks.set(n, task)
    try {
      await task.promise
      rendered.set(n, key)
    } catch (e) {
      if (!(e instanceof Error && e.name === 'RenderingCancelledException')) throw e
    }
  }

  function releasePage(n: number): void {
    tasks.get(n)?.cancel()
    rendered.delete(n)
    const canvas = pagesEl?.querySelector<HTMLCanvasElement>(`[data-page="${n}"] canvas`)
    if (canvas) {
      canvas.width = 0 // 화면 밖 쪽의 캔버스 메모리를 돌려준다
      canvas.height = 0
    }
  }

  async function renderThumb(n: number): Promise<void> {
    if (!doc || !sidebarEl) return
    const key = `${rotation}`
    if (thumbRendered.get(n) === key) return
    const holder = sidebarEl.querySelector<HTMLElement>(`[data-thumb="${n}"] .pv-thumb-canvas`)
    if (!holder) return
    const page = await doc.getPage(n)
    const base = baseSizes[n - 1]
    const viewport = page.getViewport({
      scale: thumbnailScale(base ? (swapAxes ? base.h : base.w) : 0, THUMB_WIDTH),
      rotation: normalizeRotation((pageRotates[n - 1] ?? 0) + rotation),
    })
    let canvas = holder.querySelector('canvas')
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.setAttribute('aria-hidden', 'true')
      holder.appendChild(canvas)
    }
    const ratio = dpr()
    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      await page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise
      thumbRendered.set(n, key)
    } catch (e) {
      if (!(e instanceof Error && e.name === 'RenderingCancelledException')) throw e
    }
  }

  function pageNumberOf(el: Element): number {
    return Number((el as HTMLElement).dataset.page ?? (el as HTMLElement).dataset.thumb ?? 0)
  }

  /** 관찰자를 새로 걸어 보이는 쪽을 다시 그린다(배율·회전·크기 변경 후) */
  function reobserve(): void {
    if (!scrollEl || !pagesEl) return
    pageObserver?.disconnect()
    pageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = pageNumberOf(entry.target)
          if (entry.isIntersecting) void renderPage(n)
          else releasePage(n)
        }
      },
      { root: scrollEl, rootMargin: '900px 0px' },
    )
    pagesEl.querySelectorAll('[data-page]').forEach((el) => pageObserver?.observe(el))
  }

  function reobserveThumbs(): void {
    if (!sidebarEl || !sidebarOpen) return
    thumbObserver?.disconnect()
    thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) void renderThumb(pageNumberOf(entry.target))
      },
      { root: sidebarEl, rootMargin: '400px 0px' },
    )
    sidebarEl.querySelectorAll('[data-thumb]').forEach((el) => thumbObserver?.observe(el))
  }

  // 배율·회전이 바뀌면(크기 조절 중에는 잠시 기다렸다가) 보이는 쪽을 다시 그리고, 보던 쪽 위치를 유지한다
  let reflowTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    void zoom
    void rotation
    if (status !== 'ready') return
    const keepPage = untrack(() => currentPage)
    rendered.clear()
    thumbRendered.clear()
    if (reflowTimer) clearTimeout(reflowTimer)
    reflowTimer = setTimeout(async () => {
      await tick()
      reobserve()
      reobserveThumbs()
      jumpToPage(keepPage, false)
    }, 120)
    return () => {
      if (reflowTimer) clearTimeout(reflowTimer)
    }
  })

  // 쪽 목록을 열면 썸네일을 그린다
  $effect(() => {
    if (status !== 'ready' || !sidebarOpen) return
    void tick().then(reobserveThumbs)
  })

  // 가로 맞춤 계산용 영역 너비 추적
  $effect(() => {
    const el = scrollEl
    if (!el || !browser) return
    containerWidth = el.clientWidth
    const ro = new ResizeObserver(() => {
      containerWidth = el.clientWidth
    })
    ro.observe(el)
    return () => ro.disconnect()
  })

  // 정리
  $effect(() => {
    return () => {
      pageObserver?.disconnect()
      thumbObserver?.disconnect()
      for (const t of tasks.values()) t.cancel()
    }
  })

  // ───────────────────────── 스크롤·쪽 이동 ─────────────────────────
  let scrollFrame = 0
  function handleScroll(): void {
    if (scrollFrame) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0
      if (!scrollEl || !pagesEl) return
      const boxes: PageBox[] = Array.from(pagesEl.querySelectorAll<HTMLElement>('[data-page]')).map((el) => ({
        top: el.offsetTop,
        height: el.offsetHeight,
      }))
      currentPage = currentPageFromScroll(boxes, scrollEl.scrollTop, scrollEl.clientHeight)
      if (!pageInputFocused) pageInput = String(currentPage)
    })
  }

  function jumpToPage(n: number, smooth = true): void {
    const holder = pagesEl?.querySelector<HTMLElement>(`[data-page="${n}"]`)
    if (!holder || !scrollEl) return
    scrollEl.scrollTo({ top: Math.max(holder.offsetTop - 8, 0), behavior: smooth ? 'smooth' : 'auto' })
    currentPage = n
    if (!pageInputFocused) pageInput = String(n)
  }

  function commitPageInput(): void {
    const n = clampPage(pageInput, pageCount)
    if (n == null) {
      pageInput = String(currentPage)
      return
    }
    pageInput = String(n)
    jumpToPage(n)
  }

  // ───────────────────────── 도구줄 동작 ─────────────────────────
  function zoomBy(direction: 'in' | 'out'): void {
    customZoom = stepZoom(zoom, direction)
    zoomMode = 'custom'
  }

  function fitWidth(): void {
    zoomMode = 'fit'
  }

  function rotate(): void {
    rotation = normalizeRotation(rotation + 90)
  }

  /** 인쇄 — 보관한 바이트를 임시 주소로 만들어 숨은 iframe에서 인쇄한다. iOS는 새 탭으로 연다. */
  function handlePrint(): void {
    if (!keptBytes) return
    const url = URL.createObjectURL(new Blob([keptBytes as BlobPart], { type: 'application/pdf' }))
    const cleanup = (iframe?: HTMLIFrameElement): void => {
      setTimeout(() => {
        iframe?.remove()
        URL.revokeObjectURL(url)
      }, 60_000)
    }
    if (isIosDevice(navigator.userAgent, navigator.maxTouchPoints)) {
      window.open(url, '_blank', 'noopener')
      cleanup()
      return
    }
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } catch {
        window.open(url, '_blank', 'noopener')
      }
    }
    iframe.src = url
    document.body.appendChild(iframe)
    cleanup(iframe)
  }
</script>

<div class="pv" role="region" aria-label={title}>
  <!-- 도구줄: 브라우저 기본 PDF 뷰어와 같은 배치 -->
  <div class="pv-toolbar">
    <div class="pv-group pv-group-left">
      <button
        type="button"
        class="pv-icon-btn pv-hide-sm"
        aria-label="쪽 목록 열기·닫기"
        aria-pressed={sidebarOpen}
        class:active={sidebarOpen}
        onclick={() => (sidebarOpen = !sidebarOpen)}
        disabled={status !== 'ready'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <span class="pv-title pv-hide-sm" title={title}>{title}</span>
    </div>

    <div class="pv-group pv-group-center">
      <div class="pv-pages" aria-label="쪽 이동">
        <input
          class="pv-page-input"
          inputmode="numeric"
          aria-label="현재 쪽"
          bind:value={pageInput}
          disabled={status !== 'ready'}
          onfocus={() => (pageInputFocused = true)}
          onblur={() => {
            pageInputFocused = false
            commitPageInput()
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitPageInput()
            }
          }}
        />
        <span class="pv-page-total">/ {pageCount || '-'}</span>
      </div>

      <span class="pv-divider pv-hide-sm" aria-hidden="true"></span>

      <button type="button" class="pv-icon-btn" aria-label="축소" onclick={() => zoomBy('out')} disabled={status !== 'ready'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14" /></svg>
      </button>
      <span class="pv-zoom" aria-live="polite" aria-label="배율">{status === 'ready' ? `${zoomPercent}%` : '-'}</span>
      <button type="button" class="pv-icon-btn" aria-label="확대" onclick={() => zoomBy('in')} disabled={status !== 'ready'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>

      <span class="pv-divider pv-hide-sm" aria-hidden="true"></span>

      <button
        type="button"
        class="pv-icon-btn pv-hide-sm"
        class:active={zoomMode === 'fit'}
        aria-label="가로 폭에 맞추기"
        aria-pressed={zoomMode === 'fit'}
        onclick={fitWidth}
        disabled={status !== 'ready'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5v14M20 5v14M8 12h8M10 9l-3 3 3 3M14 9l3 3-3 3" /></svg>
      </button>
      <button type="button" class="pv-icon-btn" aria-label="시계 방향으로 회전" onclick={rotate} disabled={status !== 'ready'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" /></svg>
      </button>
    </div>

    <div class="pv-group pv-group-right">
      {#if extraActions}{@render extraActions()}{/if}
      {#if downloadUrl}
        <a class="pv-icon-btn" href={downloadUrl} download={downloadFilename} aria-label="PDF 내려받기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>
        </a>
      {/if}
      <button type="button" class="pv-icon-btn" aria-label="인쇄" onclick={handlePrint} disabled={status !== 'ready'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z" /></svg>
      </button>
    </div>
  </div>

  <div class="pv-body">
    {#if sidebarOpen && status === 'ready'}
      <div class="pv-sidebar" bind:this={sidebarEl} role="navigation" aria-label="쪽 목록">
        {#each Array.from({ length: pageCount }, (_, i) => i + 1) as n (n)}
          <button
            type="button"
            class="pv-thumb"
            class:active={currentPage === n}
            data-thumb={n}
            aria-label="{n}쪽으로 이동"
            aria-current={currentPage === n ? 'page' : undefined}
            onclick={() => jumpToPage(n)}
          >
            <span class="pv-thumb-canvas"></span>
            <span class="pv-thumb-label">{n}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="pv-scroll" bind:this={scrollEl} onscroll={handleScroll}>
      {#if status === 'empty'}
        <p class="pv-message" role="status">{emptyMessage}</p>
      {:else if status === 'loading'}
        <p class="pv-message" role="status">계약서를 불러오는 중이에요…</p>
      {:else if status === 'error'}
        <div class="pv-message" role="alert">
          <p>{errorMessage}</p>
          {#if downloadUrl}<p><a class="pv-link" href={downloadUrl}>PDF 받기</a></p>{/if}
        </div>
      {:else}
        <div class="pv-pages-wrap" bind:this={pagesEl} role="document" aria-label="{title} 본문">
          {#each Array.from({ length: pageCount }, (_, i) => i) as i (i)}
            <div class="pv-page" data-page={i + 1} style={boxStyle(i)} aria-label="{i + 1}쪽"></div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .pv {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--cs-text-dark);
    color: var(--cs-white);
    border-radius: var(--radius-lg);
  }

  /* ── 도구줄 ── */
  .pv-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 56px;
    padding: 0 12px;
    background: var(--cs-dark);
    flex-shrink: 0;
  }
  .pv-group { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .pv-group-left { flex: 1 1 0; }
  .pv-group-center { flex: 0 0 auto; }
  .pv-group-right { flex: 1 1 0; justify-content: flex-end; }

  .pv-title {
    font: var(--text-pc-body-14);
    color: var(--cs-white);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 아이콘 버튼 — 호버는 배경색만(외곽선·그림자 없음), 터치 타겟 44px */
  .pv-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--cs-white);
    cursor: pointer;
    text-decoration: none;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .pv-icon-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
  .pv-icon-btn.active { background: rgba(255, 255, 255, 0.22); }
  .pv-icon-btn:disabled { opacity: 0.4; cursor: default; }

  .pv-pages { display: flex; align-items: center; gap: 6px; padding: 0 4px; }
  .pv-page-input {
    width: 44px;
    height: 32px;
    border: none;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.14);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    text-align: center;
  }
  .pv-page-input:disabled { opacity: 0.4; }
  .pv-page-total { font: var(--text-pc-body-14); color: var(--cs-purple-pale); white-space: nowrap; }
  .pv-zoom { min-width: 48px; text-align: center; font: var(--text-pc-body-14); color: var(--cs-white); }
  .pv-divider { width: 1px; height: 24px; margin: 0 6px; background: rgba(255, 255, 255, 0.2); }

  /* ── 본문 ── */
  .pv-body { display: flex; flex: 1; min-height: 0; }

  .pv-sidebar {
    width: 152px;
    flex-shrink: 0;
    overflow-y: auto;
    padding: 12px 8px;
    background: var(--cs-dark);
  }
  .pv-thumb {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
    margin-bottom: 8px;
    padding: 8px 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-white);
    cursor: pointer;
    transition: background 0.15s;
  }
  .pv-thumb:hover { background: rgba(255, 255, 255, 0.1); }
  .pv-thumb.active { background: var(--cs-purple); }
  .pv-thumb-canvas { display: block; min-height: 40px; background: var(--cs-white); }
  .pv-thumb-label { font: var(--text-pc-script-12); }

  .pv-scroll {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }
  .pv-pages-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    width: max-content;
    min-width: 100%;
  }
  .pv-page { position: relative; flex-shrink: 0; background: var(--cs-white); }
  .pv-page :global(canvas) { display: block; }

  .pv-message {
    padding: 48px 20px;
    text-align: center;
    color: var(--cs-purple-pale);
    font: var(--text-pc-body-14);
  }
  .pv-link { color: var(--cs-white); font-weight: 700; text-decoration: underline; }

  /* ── 모바일: 쪽 목록·파일명·가로 맞춤은 숨기고 핵심 동작만 남긴다 ── */
  @media (max-width: 640px) {
    .pv { border-radius: 20px; }
    .pv-toolbar { min-height: 52px; padding: 0 4px; gap: 0; }
    .pv-hide-sm { display: none !important; }
    .pv-group-left { flex: 0 0 0; }
    .pv-group-center { flex: 1 1 auto; justify-content: center; }
    .pv-group-right { flex: 0 0 auto; }
    .pv-page-input, .pv-page-total, .pv-zoom { font: var(--text-m-script-14B); }
    .pv-sidebar { display: none; }
  }
</style>
