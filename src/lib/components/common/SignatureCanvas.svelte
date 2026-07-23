<script lang="ts">
  import { browser } from '$app/environment'
  import { onMount } from 'svelte'

  export interface SignatureData {
    strokeCount: number
    pngBase64:   string
  }

  interface Props {
    width?:      number
    height?:     number
    minStrokes?: number
    onchange?:   (valid: boolean, data: SignatureData | null) => void
  }

  let {
    width      = 360,
    height     = 160,
    minStrokes = 3,
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
    strokes += 1
    notify()
  }

  function notify() {
    const valid = strokes >= minStrokes
    if (!onchange) return
    if (!valid || !canvas) {
      onchange(valid, null)
      return
    }
    onchange(valid, {
      strokeCount: strokes,
      pngBase64:   canvas.toDataURL('image/png'),
    })
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
    ctx.lineWidth   = 2
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
      {:else if strokes < minStrokes}
        조금 더 서명해 주세요 ({strokes}/{minStrokes})
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
