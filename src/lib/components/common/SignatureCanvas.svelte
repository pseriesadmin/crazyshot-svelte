<script lang="ts">
  import { browser } from '$app/environment'
  import { onMount } from 'svelte'

  export interface SignatureData {
    strokeCount: number
    pngBase64:   string
  }

  interface Props {
    width?:    number
    height?:   number
    /** 선 굵기(캔버스 버퍼 px) — 모바일처럼 버퍼가 화면에 축소 표시되는 경우 키워 화면상 굵기를 유지 */
    lineWidth?: number
    /** 지정하면 서명 여백을 잘라낸 뒤 이 크기에 맞춰(비율 유지·가운데) 내보낸다 — 입력 캔버스 비율과 저장 이미지 비율을 분리 */
    exportSize?: { width: number; height: number }
    onchange?: (valid: boolean, data: SignatureData | null) => void
  }

  let {
    width  = 360,
    height = 160,
    lineWidth = 2,
    exportSize,
    onchange,
  }: Props = $props()

  let canvas    = $state<HTMLCanvasElement | undefined>()
  let isDrawing = $state(false)
  let strokes   = $state(0)

  function getCtx(): CanvasRenderingContext2D | null {
    return canvas?.getContext('2d') ?? null
  }

  function getPos(e: MouseEvent | Touch): { x: number; y: number } {
    const rect = canvas!.getBoundingClientRect()
    const scaleX = canvas!.width  / rect.width
    const scaleY = canvas!.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    }
  }

  function startDraw(x: number, y: number) {
    const ctx = getCtx()
    if (!ctx) return
    isDrawing = true
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function moveDraw(x: number, y: number) {
    if (!isDrawing) return
    const ctx = getCtx()
    if (!ctx) return
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function endDraw() {
    if (!isDrawing) return
    isDrawing = false
    strokes  += 1
    notify()
  }

  // 서명 여부는 1회라도 그렸는지로만 판정 — 실제 서명은 펜을 떼지 않고 한 번에 이어그리는
  // 필기체가 대부분이라 다회 스트로크를 요구할 근거가 없음
  function notify() {
    const valid = strokes >= 1
    if (!onchange) return
    if (!valid || !canvas) {
      onchange(valid, null)
      return
    }
    onchange(valid, {
      strokeCount: strokes,
      pngBase64:   exportPng(),
    })
  }

  // exportSize 지정 시: 그려진 영역만 잘라 지정 크기에 맞춰 투명 배경 PNG로 내보낸다(서명이 작게 저장되는 것 방지)
  function exportPng(): string {
    if (!canvas) return ''
    if (!exportSize) return canvas.toDataURL('image/png')
    const ctx = getCtx()
    if (!ctx) return canvas.toDataURL('image/png')
    const { width: w, height: h } = canvas
    const { data } = ctx.getImageData(0, 0, w, h)
    let minX = w, minY = h, maxX = -1, maxY = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 0) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return canvas.toDataURL('image/png')
    const pad = 6
    const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad)
    const sw = Math.min(w, maxX + pad + 1) - sx, sh = Math.min(h, maxY + pad + 1) - sy
    const out = document.createElement('canvas')
    out.width = exportSize.width
    out.height = exportSize.height
    const octx = out.getContext('2d')
    if (!octx) return canvas.toDataURL('image/png')
    const scale = Math.min(out.width / sw, out.height / sh, 2)   // 아주 작은 표식이 과하게 확대·굵어지지 않게 상한
    const dw = sw * scale, dh = sh * scale
    octx.drawImage(canvas, sx, sy, sw, sh, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh)
    return out.toDataURL('image/png')
  }

  export function clearCanvas() {
    const ctx = getCtx()
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    strokes = 0
    onchange?.(false, null)
  }

  function initCtx() {
    const ctx = getCtx()
    if (!ctx) return
    ctx.strokeStyle = '#100B32'
    ctx.lineWidth   = lineWidth
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
  }

  $effect(() => {
    if (!browser || !canvas) return
    initCtx()
  })

  function onMousedown(e: MouseEvent) {
    e.preventDefault()
    const { x, y } = getPos(e)
    startDraw(x, y)
  }
  function onMousemove(e: MouseEvent) {
    e.preventDefault()
    const { x, y } = getPos(e)
    moveDraw(x, y)
  }
  function onMouseup() { endDraw() }

  function onTouchstart(e: TouchEvent) {
    e.preventDefault()
    const t = e.touches[0]
    if (!t) return
    const { x, y } = getPos(t)
    startDraw(x, y)
  }
  function onTouchmove(e: TouchEvent) {
    e.preventDefault()
    const t = e.touches[0]
    if (!t) return
    const { x, y } = getPos(t)
    moveDraw(x, y)
  }
  function onTouchend() { endDraw() }
</script>

<div class="sig-wrap">
  {#if browser}
    <canvas
      bind:this={canvas}
      {width}
      {height}
      class="sig-canvas"
      onmousedown={onMousedown}
      onmousemove={onMousemove}
      onmouseup={onMouseup}
      onmouseleave={onMouseup}
      ontouchstart={onTouchstart}
      ontouchmove={onTouchmove}
      ontouchend={onTouchend}
    ></canvas>
  {/if}
  <div class="sig-footer">
    <span class="sig-hint">
      {#if strokes === 0}
        여기에 서명하세요
      {:else}
        서명 완료
      {/if}
    </span>
    <button type="button" class="sig-clear" onclick={clearCanvas} disabled={strokes === 0}>
      지우기
    </button>
  </div>
</div>

<style>
  .sig-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sig-canvas {
    display: block;
    width: 100%;
    touch-action: none;
    border: 1.5px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-sm, 8px);
    background: #fff;
    cursor: crosshair;
  }

  .sig-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sig-hint {
    font-size: 12px;
    color: var(--cs-text-mid, #666);
  }

  .sig-clear {
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-error, #ef4444);
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: background 0.12s;
  }
  .sig-clear:hover:not(:disabled)   { background: rgba(239,68,68,0.08); }
  .sig-clear:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
