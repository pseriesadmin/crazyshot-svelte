<script lang="ts">
  /**
   * MediaViewer.svelte — Front·CMS 공통 표준 이미지 & 문서 뷰어
   *
   * 구성
   *  · 상단: 파일 이름 + (n / N) · 닫기(✕)
   *  · 본문: 이미지(확대·축소·회전·끌어서 이동) · PDF(PdfViewer 재사용) · 유튜브 영상(type:'youtube' + videoId), 좌우 이동(여러 장일 때)
   *  · 하단 도구줄: [썸네일 정렬] │ [축소] [확대] [맞춤] [회전] │ [내려받기] [삭제]
   *
   * 사용
   *  · onSave를 넘기면 도구줄에 '이미지 편집'(자르기·회전·반전·밝기·대비)이 나타난다. 편집 결과는 WebP Blob으로 onSave(index, blob)에 전달되고,
   *    저장(교체) 방식은 호출한 화면이 정한다. 성공(true)하면 편집 모드를 닫는다. 안 넘기면 편집 버튼은 숨김.
   *
   *   {#if open}
   *     <MediaViewer items={...} bind:index onclose={() => (open = false)} onDelete={async (i) => ...} />
   *   {/if}
   *
   *  · onDelete를 넘기면 삭제 버튼이 나타난다(안 넘기면 숨김 — 읽기 전용 화면). 삭제는 "삭제 안전 토스트"(1차 경고 → 2차 실행)를 따른다.
   *    onDelete는 실제 삭제를 하고 성공 여부(true/false)를 돌려준다. 호출한 쪽이 items에서 그 항목을 뺐다면 뷰어가 알아서 다음 장으로 이동하고,
   *    남은 항목이 없으면 onclose를 부른다.
   *  · body로 옮겨 렌더링한다(transform 조상 안의 position:fixed 어긋남 방지 — ui-mobile.md).
   *  · Front·CMS 양쪽에서 재사용하는 공용 컴포넌트라 front·CMS 토큰을 함께 쓴다(uiux-index.md "환경 분리 예외").
   */
  import { onMount } from 'svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import DeleteIconButton from '$lib/components/common/DeleteIconButton.svelte'
  import PdfViewer from '$lib/components/common/PdfViewer.svelte'
  import { csToast } from '$lib/utils/toast'
  import { createDeleteSafetyToast } from '$lib/utils/deleteSafetyToast.svelte'
  import type { MediaViewerItem } from '$lib/types/media-viewer'

  interface Props {
    items: MediaViewerItem[]
    /** 현재 보고 있는 항목 번호(0부터) */
    index?: number
    /** 기본 제목(항목에 name이 없을 때) */
    title?: string
    onclose: () => void
    /** 삭제 실행(성공하면 true). 넘기지 않으면 삭제 버튼을 숨긴다 */
    onDelete?: (index: number) => Promise<boolean> | boolean
    /** 내려받기 버튼 노출(기본 true) */
    downloadable?: boolean
    /** 편집한 이미지를 저장(성공하면 true). 넘기지 않으면 편집 버튼을 숨긴다 */
    onSave?: (index: number, blob: Blob) => Promise<boolean> | boolean
    /** 열자마자 편집 모드로 들어간다(onSave가 있을 때) — 편집 버튼으로 연 경우 */
    startInEdit?: boolean
  }

  let { items, index = $bindable(0), title = '이미지', onclose, onDelete, downloadable = true, onSave, startInEdit = false }: Props = $props()

  const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

  let zoom = $state(1)
  let rotation = $state(0)
  let panX = $state(0)
  let panY = $state(0)
  let gridMode = $state(false)
  let stageW = $state(0)
  let stageH = $state(0)
  let failedUrls = $state<Record<string, boolean>>({})
  let dragging = $state(false)

  const current = $derived<MediaViewerItem | null>(items[index] ?? null)
  const YT_ID = /^[\w-]{11}$/
  const kindOf = (it: MediaViewerItem | null): 'image' | 'pdf' | 'youtube' =>
    !it ? 'image' : it.type === 'youtube' && YT_ID.test(it.videoId ?? '') ? 'youtube' : (it.type === 'pdf' || (!it.type && /\.pdf(?:$|[?#])/i.test(it.url))) ? 'pdf' : 'image'
  const isPdf = $derived(kindOf(current) === 'pdf')
  const isVideo = $derived(kindOf(current) === 'youtube')
  /** 확대·회전·편집·내려받기 같은 이미지 전용 도구를 쓸 수 있는 항목 */
  const isImage = $derived(!isPdf && !isVideo)
  const swapAxes = $derived(rotation % 180 !== 0)
  const displayName = $derived(current?.name ?? title)

  const deleteSafety = createDeleteSafetyToast({ successMessage: '삭제됐습니다.' })

  // 항목이 바뀌면 보기 상태 초기화
  $effect(() => {
    void current?.url
    zoom = 1
    rotation = 0
    panX = 0
    panY = 0
  })

  // 삭제 후 항목이 줄어든 경우 번호 보정 / 모두 사라지면 닫기
  $effect(() => {
    if (items.length === 0) { onclose(); return }
    if (index > items.length - 1) index = items.length - 1
    if (index < 0) index = 0
  })

  onMount(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 토스트(삭제 경고 등)가 하단 도구줄을 가려 다음 클릭이 토스트에 닿지 않도록, 열려 있는 동안 토스트를 도구줄 위로 올린다
    document.body.classList.add('mv-open')
    if (startInEdit) void startEdit()
    return () => {
      document.body.classList.remove('mv-open')
      document.body.style.overflow = prev
      if (edObjectUrl) URL.revokeObjectURL(edObjectUrl)
    }
  })

  function portal(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }

  function resetView(): void { zoom = 1; panX = 0; panY = 0 }
  function zoomIn(): void {
    const next = ZOOM_STEPS.find((z) => z > zoom + 0.001)
    if (next !== undefined) zoom = next
  }
  function zoomOut(): void {
    const next = [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001)
    if (next !== undefined) { zoom = next; if (next <= 1) { panX = 0; panY = 0 } }
  }
  function rotate(): void { rotation = (rotation + 90) % 360 }
  function go(delta: number): void {
    if (items.length < 2 || editMode) return
    index = (index + delta + items.length) % items.length
  }
  function pick(i: number): void { index = i; gridMode = false }

  // 확대 상태에서 끌어서 이동
  let dragStart: { x: number; y: number; px: number; py: number } | null = null
  function onPointerDown(e: PointerEvent): void {
    if (zoom <= 1 || !isImage) return
    dragStart = { x: e.clientX, y: e.clientY, px: panX, py: panY }
    dragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragStart) return
    panX = dragStart.px + (e.clientX - dragStart.x)
    panY = dragStart.py + (e.clientY - dragStart.y)
  }
  function onPointerUp(): void { dragStart = null; dragging = false }
  function onWheel(e: WheelEvent): void {
    if (!isImage || gridMode) return
    e.preventDefault()
    if (e.deltaY < 0) zoomIn(); else zoomOut()
  }


  // ── 이미지 편집(자르기 · 명암 · 컬러감 · 배경색 · 회전) ──────────────────────
  type Aspect = 'free' | '1:1' | '4:3' | '16:9'
  type EditSection = 'crop' | 'light' | 'tone' | 'bg' | 'rotate'
  const ASPECTS: { id: Aspect; label: string; r: number | null }[] = [
    { id: 'free', label: '자유', r: null },
    { id: '1:1', label: '1:1', r: 1 },
    { id: '4:3', label: '4:3', r: 4 / 3 },
    { id: '16:9', label: '16:9', r: 16 / 9 },
  ]
  const EDIT_SECTIONS: { id: EditSection; label: string }[] = [
    { id: 'crop', label: '자르기' },
    { id: 'light', label: '명암 조절' },
    { id: 'tone', label: '컬러감 조절' },
    { id: 'bg', label: '배경색 변경' },
    { id: 'rotate', label: '회전' },
  ]
  /** 지금 항목에서 허용된 편집 메뉴(항목별 editTools, 기본 전부) / 편집 가능 여부 */
  const editSectionIds = $derived<EditSection[]>(current?.editTools ?? EDIT_SECTIONS.map((e) => e.id))
  const visibleSections = $derived(EDIT_SECTIONS.filter((e) => editSectionIds.includes(e.id)))
  const canEdit = $derived(!!onSave && isImage && current?.editable !== false)
  /** 배경색 24색 */
  const BG_COLORS: { name: string; hex: string }[] = [
    { name: '흰색', hex: '#FFFFFF' }, { name: '밝은 회색', hex: '#F2F2F2' }, { name: '회색', hex: '#BDBDBD' }, { name: '진회색', hex: '#6B6B6B' },
    { name: '차콜', hex: '#2B2B2B' }, { name: '검정', hex: '#000000' }, { name: '아이보리', hex: '#FFF8E7' }, { name: '베이지', hex: '#E8D8BF' },
    { name: '연분홍', hex: '#FADADD' }, { name: '분홍', hex: '#F48FB1' }, { name: '빨강', hex: '#E53935' }, { name: '주황', hex: '#FB8C00' },
    { name: '노랑', hex: '#FDD835' }, { name: '연두', hex: '#C5E1A5' }, { name: '초록', hex: '#43A047' }, { name: '민트', hex: '#80CBC4' },
    { name: '하늘', hex: '#B3E5FC' }, { name: '파랑', hex: '#1E88E5' }, { name: '남색', hex: '#1A237E' }, { name: '연보라', hex: '#D1C4E9' },
    { name: '보라', hex: '#7E57C2' }, { name: '브라운', hex: '#795548' }, { name: '카키', hex: '#8D8B55' }, { name: '크레이지샷 남색', hex: '#100B32' },
  ]
  const MAX_EDIT_SIDE = 2400

  let editMode = $state(false)
  let editLoading = $state(false)
  let editSaving = $state(false)
  let edOpen = $state<EditSection | null>('crop')
  let edImg: HTMLImageElement | null = null
  let edObjectUrl: string | null = null
  let edTurns = $state(0)        // 90도 단위 회전 횟수(0~3)
  let edFlipH = $state(false)
  let edFlipV = $state(false)
  let edLight = $state(0)        // 명암: -50(어둡게) ~ +50(밝게)
  let edWarm = $state(0)         // 컬러감: -50(차갑게) ~ +50(따뜻하게)
  let edBgColor = $state<string | null>(null)   // null = 원본 배경 유지
  let edBgTol = $state(36)       // 배경 인식 범위
  let edAspect = $state<Aspect>('free')
  let crop = $state({ x: 0, y: 0, w: 1, h: 1 })   // 회전·반전 적용된 이미지 기준 비율(0~1)
  let edCanvas: HTMLCanvasElement | null = $state(null)
  let edBox = $state({ w: 0, h: 0 })              // 미리보기 표시 크기(px)
  let edBarH = $state(0)
  let edBase: HTMLCanvasElement | null = null     // 회전·반전만 반영한 캔버스(긴 변 최대 2400px)
  let edVersion = $state(0)                       // edBase 갱신 알림
  // 배경 인식 결과 캐시(기준 캔버스와 같은 크기, 0~255 = 배경일 확률) — 회전·반전·인식 범위가 바뀌면 다시 계산
  let edMask: Uint8ClampedArray | null = null
  let edMaskKey = ''

  const MIN_CROP = 0.05

  async function startEdit(): Promise<void> {
    if (!current || !canEdit) return
    editLoading = true
    try {
      const res = await fetch(current.url)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      edObjectUrl = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('load')); img.src = edObjectUrl as string })
      edImg = img
      edTurns = 0; edFlipH = false; edFlipV = false; edLight = 0; edWarm = 0; edBgColor = null; edAspect = 'free'
      edOpen = visibleSections[0]?.id ?? null
      crop = { x: 0, y: 0, w: 1, h: 1 }
      editMode = true
      rebuildBase()
    } catch {
      csToast.error('이 이미지는 편집할 수 없습니다.')
      endEdit()
    } finally {
      editLoading = false
    }
  }

  function endEdit(): void {
    editMode = false
    edImg = null
    edBase = null
    edMask = null
    edMaskKey = ''
    if (edObjectUrl) { URL.revokeObjectURL(edObjectUrl); edObjectUrl = null }
  }

  function rebuildBase(): void {
    if (!edImg) return
    const sw = edImg.naturalWidth, sh = edImg.naturalHeight
    const k = Math.min(1, MAX_EDIT_SIDE / Math.max(sw, sh))
    const dw = Math.max(Math.round(sw * k), 1), dh = Math.max(Math.round(sh * k), 1)
    const swap = edTurns % 2 === 1
    const c = document.createElement('canvas')
    c.width = swap ? dh : dw
    c.height = swap ? dw : dh
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.translate(c.width / 2, c.height / 2)
    ctx.rotate((edTurns * Math.PI) / 2)
    ctx.scale(edFlipH ? -1 : 1, edFlipV ? -1 : 1)
    ctx.drawImage(edImg, -dw / 2, -dh / 2, dw, dh)
    edBase = c
    edMask = null
    edMaskKey = ''
    edVersion++
  }

  function geometryChanged(): void {
    crop = { x: 0, y: 0, w: 1, h: 1 }
    edAspect = 'free'
    rebuildBase()
  }
  function turn(dir: 1 | -1): void { edTurns = (edTurns + dir + 4) % 4; geometryChanged() }
  function flip(axis: 'h' | 'v'): void { if (axis === 'h') edFlipH = !edFlipH; else edFlipV = !edFlipV; geometryChanged() }
  function resetEdit(): void {
    edTurns = 0; edFlipH = false; edFlipV = false; edLight = 0; edWarm = 0; edBgColor = null; edBgTol = 36
    geometryChanged()
  }
  function toggleSection(id: EditSection): void { edOpen = edOpen === id ? null : id }

  // ── 배경 자동 인식: 테두리 색을 배경으로 보고, 테두리에서 이어진 비슷한 색 영역만 배경으로 판정 ──
  function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  function computeMask(base: HTMLCanvasElement, tol: number): Uint8ClampedArray | null {
    const w = base.width, h = base.height
    const ctx = base.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const px = ctx.getImageData(0, 0, w, h).data
    // 배경 색 추정 — 테두리 픽셀 색의 채널별 중앙값
    const rs: number[] = [], gs: number[] = [], bs: number[] = []
    const take = (x: number, y: number): void => { const i = (y * w + x) * 4; rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]) }
    const step = Math.max(1, Math.floor(Math.max(w, h) / 400))
    for (let x = 0; x < w; x += step) { take(x, 0); take(x, h - 1) }
    for (let y = 0; y < h; y += step) { take(0, y); take(w - 1, y) }
    const med = (arr: number[]): number => { arr.sort((p, q) => p - q); return arr[Math.floor(arr.length / 2)] }
    const br = med(rs), bg = med(gs), bb = med(bs)
    const lim = tol * tol * 3
    const near = (i: number): boolean => {
      const dr = px[i] - br, dg = px[i + 1] - bg, db = px[i + 2] - bb
      return dr * dr + dg * dg + db * db <= lim
    }
    const hard = new Uint8Array(w * h)
    const stack: number[] = []
    const seed = (x: number, y: number): void => {
      const p = y * w + x
      if (!hard[p] && near(p * 4)) { hard[p] = 1; stack.push(p) }
    }
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1) }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y) }
    while (stack.length) {
      const p = stack.pop() as number
      const x = p % w, y = (p - x) / w
      if (x > 0) { const q = p - 1; if (!hard[q] && near(q * 4)) { hard[q] = 1; stack.push(q) } }
      if (x < w - 1) { const q = p + 1; if (!hard[q] && near(q * 4)) { hard[q] = 1; stack.push(q) } }
      if (y > 0) { const q = p - w; if (!hard[q] && near(q * 4)) { hard[q] = 1; stack.push(q) } }
      if (y < h - 1) { const q = p + w; if (!hard[q] && near(q * 4)) { hard[q] = 1; stack.push(q) } }
    }
    // 가장자리를 부드럽게 — 3×3 평균
    const out = new Uint8ClampedArray(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, n = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            sum += hard[yy * w + xx]; n++
          }
        }
        out[y * w + x] = Math.round((sum / n) * 255)
      }
    }
    return out
  }
  function ensureMask(): Uint8ClampedArray | null {
    if (!edBase) return null
    const key = `${edVersion}:${edBgTol}`
    if (edMask && edMaskKey === key) return edMask
    edMask = computeMask(edBase, edBgTol)
    edMaskKey = key
    return edMask
  }

  /** 기준 캔버스의 (sx,sy,sw,sh) 영역을 dw×dh로 그리면서 명암·컬러감·배경색을 반영 */
  function renderEdited(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number): void {
    if (!edBase) return
    ctx.drawImage(edBase, sx, sy, sw, sh, 0, 0, dw, dh)
    const adjust = edLight !== 0 || edWarm !== 0
    const mask = edBgColor ? ensureMask() : null
    if (!adjust && !mask) return
    const data = ctx.getImageData(0, 0, dw, dh)
    const px = data.data
    const f = 1 + edLight / 100
    const warm = edWarm * 0.6
    const bgc = edBgColor ? hexToRgb(edBgColor) : null
    const bw = edBase.width
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const i = (y * dw + x) * 4
        let r = px[i], g = px[i + 1], b = px[i + 2]
        if (adjust) { r = r * f + warm; g = g * f + warm * 0.15; b = b * f - warm }
        if (mask && bgc) {
          const mx = Math.min(Math.floor(sx + ((x + 0.5) * sw) / dw), bw - 1)
          const my = Math.min(Math.floor(sy + ((y + 0.5) * sh) / dh), edBase.height - 1)
          const a = mask[my * bw + mx] / 255
          if (a > 0) { r += (bgc[0] - r) * a; g += (bgc[1] - g) * a; b += (bgc[2] - b) * a }
        }
        px[i] = r < 0 ? 0 : r > 255 ? 255 : r
        px[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
        px[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
      }
    }
    ctx.putImageData(data, 0, 0)
  }

  // 미리보기 그리기 — 스테이지 크기에 맞춰 축소해 표시
  $effect(() => {
    void edVersion; void edLight; void edWarm; void edBgColor; void edBgTol
    if (!editMode || !edBase || !edCanvas) return
    const maxW = Math.max(stageW - 144, 120), maxH = Math.max(stageH - 8, 120)
    const k = Math.min(maxW / edBase.width, maxH / edBase.height, 1)
    const w = Math.max(Math.round(edBase.width * k), 1), h = Math.max(Math.round(edBase.height * k), 1)
    edCanvas.width = w
    edCanvas.height = h
    edBox = { w, h }
    const ctx = edCanvas.getContext('2d', { willReadFrequently: true })
    if (ctx) renderEdited(ctx, 0, 0, edBase.width, edBase.height, w, h)
  })

  function aspectRatio(): number | null { return ASPECTS.find((a) => a.id === edAspect)?.r ?? null }

  function pickAspect(a: Aspect): void {
    edAspect = a
    const r = aspectRatio()
    if (!r || !edBase) return
    // 현재 이미지 안에서 가장 큰 해당 비율 영역을 가운데에 맞춘다
    const bw = edBase.width, bh = edBase.height
    let w = 1, h = (bw / r) / bh
    if (h > 1) { h = 1; w = (bh * r) / bw }
    crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
  }

  // 자르기 영역 끌기(이동/모서리 크기 조절)
  let cropDrag: { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; fx: number; fy: number; start: typeof crop } | null = null
  function frac(e: PointerEvent): { fx: number; fy: number } {
    const r = edCanvas?.getBoundingClientRect()
    if (!r || r.width === 0) return { fx: 0, fy: 0 }
    return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height }
  }
  function cropDown(e: PointerEvent, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'): void {
    e.stopPropagation()
    const f = frac(e)
    cropDrag = { mode, fx: f.fx, fy: f.fy, start: { ...crop } }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function cropMove(e: PointerEvent): void {
    if (!cropDrag || !edBase) return
    const f = frac(e)
    const st = cropDrag.start
    if (cropDrag.mode === 'move') {
      const nx = Math.min(Math.max(st.x + (f.fx - cropDrag.fx), 0), 1 - st.w)
      const ny = Math.min(Math.max(st.y + (f.fy - cropDrag.fy), 0), 1 - st.h)
      crop = { ...st, x: nx, y: ny }
      return
    }
    // 반대쪽 모서리를 고정하고 끌고 있는 모서리를 따라 크기 조절
    const ax = cropDrag.mode === 'nw' || cropDrag.mode === 'sw' ? st.x + st.w : st.x
    const ay = cropDrag.mode === 'nw' || cropDrag.mode === 'ne' ? st.y + st.h : st.y
    const mx = Math.min(Math.max(f.fx, 0), 1), my = Math.min(Math.max(f.fy, 0), 1)
    const sx = mx >= ax ? 1 : -1, sy = my >= ay ? 1 : -1
    let w = Math.abs(mx - ax), h = Math.abs(my - ay)
    const r = aspectRatio()
    if (r) {
      const k = edBase.width / (r * edBase.height)   // h = w * k
      h = w * k
      const maxW = sx > 0 ? 1 - ax : ax, maxH = sy > 0 ? 1 - ay : ay
      if (h > maxH) { h = maxH; w = h / k }
      if (w > maxW) { w = maxW; h = w * k }
    }
    w = Math.max(w, MIN_CROP); h = Math.max(h, MIN_CROP)
    crop = { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h }
  }
  function cropUp(): void { cropDrag = null }

  async function applyEdit(): Promise<void> {
    if (!edBase || !onSave || editSaving) return
    editSaving = true
    try {
      const sx = Math.round(crop.x * edBase.width), sy = Math.round(crop.y * edBase.height)
      const sw = Math.max(Math.round(crop.w * edBase.width), 1), sh = Math.max(Math.round(crop.h * edBase.height), 1)
      const out = document.createElement('canvas')
      out.width = sw; out.height = sh
      const ctx = out.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('canvas')
      renderEdited(ctx, sx, sy, sw, sh, sw, sh)
      const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, 'image/webp', 0.92))
      if (!blob) throw new Error('blob')
      const saved = await onSave(index, blob)
      if (saved) { csToast.success('편집한 이미지를 저장했습니다.'); endEdit() }
    } catch {
      csToast.error('이미지 편집 저장에 실패했습니다.')
    } finally {
      editSaving = false
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { if (editMode) { if (!editSaving) endEdit() } else if (gridMode) gridMode = false; else onclose(); return }
    if (editMode || gridMode || !isImage) return
    // 입력창(배경에 포커스가 남은 글 입력란 등)에서 치는 글자는 단축키로 가로채지 않는다
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    if (e.key === 'ArrowLeft') go(-1)
    else if (e.key === 'ArrowRight') go(1)
    else if (e.key === '+' || e.key === '=') zoomIn()
    else if (e.key === '-') zoomOut()
    else if (e.key === 'r' || e.key === 'R') rotate()
    else if (e.key === '0') resetView()
  }

  function fileNameOf(item: MediaViewerItem): string {
    if (item.name) return item.name
    try {
      const last = decodeURIComponent(new URL(item.url, location.href).pathname.split('/').pop() ?? '')
      return last || '파일'
    } catch {
      return '파일'
    }
  }

  async function download(): Promise<void> {
    if (!current) return
    const item = current
    try {
      const res = await fetch(item.url)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = fileNameOf(item)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch {
      // 다른 출처 등으로 직접 받을 수 없으면 새 탭으로 연다
      window.open(item.url, '_blank', 'noopener,noreferrer')
      csToast.warning('새 탭에서 열었습니다. 거기서 저장해 주세요.')
    }
  }

  function handleDelete(): void {
    if (!current || !onDelete) return
    const i = index
    void deleteSafety.handleAction(current.url, async () => {
      const ok = await onDelete(i)
      return ok
    })
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="mv-backdrop"
  use:portal
  role="dialog"
  aria-modal="true"
  aria-label={`${displayName} 보기`}
  tabindex="-1"
  onclick={(e) => { if (e.target === e.currentTarget) onclose() }}
>
  <!-- 상단 -->
  <div class="mv-top">
    <span class="mv-title">{displayName}</span>
    {#if items.length > 1}<span class="mv-count">{index + 1} / {items.length}</span>{/if}
  </div>
  <button type="button" class="mv-close" onclick={onclose} aria-label="닫기">✕</button>

  <!-- 본문 -->
  {#if editMode}
    <div class="mv-stage mv-edit-stage" style={`margin-bottom:${edBarH + 32}px;`} bind:clientWidth={stageW} bind:clientHeight={stageH} role="presentation">
      <div class="mv-edit-box" style={`width:${edBox.w}px;height:${edBox.h}px;`}>
        <canvas bind:this={edCanvas} class="mv-edit-canvas"></canvas>
        {#if editSectionIds.includes('crop')}
        <!-- 자르기 영역: 바깥은 어둡게, 안쪽은 끌어서 이동, 모서리는 크기 조절 -->
        <div
          class="mv-crop"
          role="presentation"
          style={`left:${crop.x * 100}%;top:${crop.y * 100}%;width:${crop.w * 100}%;height:${crop.h * 100}%;`}
          onpointerdown={(e) => cropDown(e, 'move')}
          onpointermove={cropMove}
          onpointerup={cropUp}
          onpointercancel={cropUp}
        >
          {#each ['nw', 'ne', 'sw', 'se'] as corner (corner)}
            <span
              class={`mv-handle mv-handle-${corner}`}
              role="presentation"
              onpointerdown={(e) => cropDown(e, corner as 'nw' | 'ne' | 'sw' | 'se')}
              onpointermove={cropMove}
              onpointerup={cropUp}
              onpointercancel={cropUp}
            ></span>
          {/each}
        </div>
        {/if}
      </div>
    </div>
  {:else if gridMode}
    <div class="mv-grid-wrap" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) gridMode = false }}>
      <div class="mv-grid">
        {#each items as it, i (i)}
          <button
            type="button"
            class="mv-thumb"
            class:current={i === index}
            onclick={() => pick(i)}
            aria-label={`${it.name ?? title} ${i + 1}번 보기`}
          >
            {#if kindOf(it) === 'pdf'}
              <span class="mv-thumb-pdf">PDF</span>
            {:else if kindOf(it) === 'youtube'}
              <img src={it.thumbUrl ?? `https://img.youtube.com/vi/${it.videoId}/hqdefault.jpg`} alt="" loading="lazy" />
              <span class="mv-thumb-play" aria-hidden="true">▶</span>
            {:else}
              <img src={it.thumbUrl ?? it.url} alt="" loading="lazy" />
            {/if}
            <span class="mv-thumb-no">{i + 1}</span>
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <div
      class="mv-stage"
      bind:clientWidth={stageW}
      bind:clientHeight={stageH}
      role="presentation"
      onclick={(e) => { if (e.target === e.currentTarget) onclose() }}
      onwheel={onWheel}
    >
      {#if current}
        {#if isPdf}
          <div class="mv-pdf">
            <PdfViewer src={current.url} title={displayName} downloadUrl={downloadable ? current.url : undefined} downloadFilename={fileNameOf(current)} />
          </div>
        {:else if isVideo}
          {#key current.videoId}
            <iframe
              class="mv-video"
              src={`https://www.youtube.com/embed/${current.videoId}?autoplay=1`}
              title={displayName}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowfullscreen
            ></iframe>
          {/key}
        {:else if failedUrls[current.url]}
          <p class="mv-fail">이미지를 불러올 수 없어요.</p>
        {:else}
          <img
            class="mv-img"
            class:grab={zoom > 1}
            class:dragging
            src={current.url}
            alt={displayName}
            draggable="false"
            style={`max-width:${Math.max((swapAxes ? stageH : stageW) - 0, 0)}px;max-height:${Math.max((swapAxes ? stageW : stageH) - 0, 0)}px;transform:translate(${panX}px,${panY}px) rotate(${rotation}deg) scale(${zoom});`}
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointercancel={onPointerUp}
            onerror={() => { if (current) failedUrls[current.url] = true }}
          />
        {/if}
      {/if}

      {#if items.length > 1}
        <button type="button" class="mv-nav mv-prev" onclick={() => go(-1)} aria-label="이전">
          <ChevronIcon direction="left" size={12} color="#ffffff" />
        </button>
        <button type="button" class="mv-nav mv-next" onclick={() => go(1)} aria-label="다음">
          <ChevronIcon direction="right" size={12} color="#ffffff" />
        </button>
      {/if}
    </div>
  {/if}

  <!-- 하단 도구줄 -->
  {#if editMode}
    <div class="mv-edit-bar" role="toolbar" aria-label="이미지 편집 도구" bind:clientHeight={edBarH}>
      <div class="mv-acc">
        {#each visibleSections as sec (sec.id)}
          <div class="mv-acc-item">
            <button type="button" class="mv-acc-head" class:open={edOpen === sec.id} aria-expanded={edOpen === sec.id} onclick={() => toggleSection(sec.id)}>
              <span>{sec.label}</span>
              <ChevronIcon direction={edOpen === sec.id ? 'up' : 'down'} size={10} color="#666666" />
            </button>
            {#if edOpen === sec.id}
              <div class="mv-acc-panel">
                {#if sec.id === 'crop'}
                  <div class="mv-row">
                    {#each ASPECTS as a (a.id)}
                      <button type="button" class="mv-chip" class:active={edAspect === a.id} onclick={() => pickAspect(a.id)} aria-pressed={edAspect === a.id}>{a.label}</button>
                    {/each}
                  </div>
                  <p class="mv-hint">이미지 위 사각형을 끌어 이동하고, 모서리를 끌어 크기를 조절하세요.</p>
                {:else if sec.id === 'light'}
                  <label class="mv-slider"><span>어둡게</span><input type="range" min="-50" max="50" step="1" bind:value={edLight} aria-label="명암 조절" /><span>밝게</span></label>
                {:else if sec.id === 'tone'}
                  <label class="mv-slider"><span>차갑게</span><input type="range" min="-50" max="50" step="1" bind:value={edWarm} aria-label="컬러감 조절" /><span>따뜻하게</span></label>
                {:else if sec.id === 'bg'}
                  <div class="mv-row">
                    <button type="button" class="mv-chip" class:active={edBgColor === null} onclick={() => (edBgColor = null)} aria-pressed={edBgColor === null}>원본 배경</button>
                    <span class="mv-hint">배경을 자동으로 인식해 선택한 색으로 바꿉니다.</span>
                  </div>
                  <div class="mv-swatches">
                    {#each BG_COLORS as c (c.hex)}
                      <button
                        type="button"
                        class="mv-swatch"
                        class:selected={edBgColor === c.hex}
                        style={`background:${c.hex};color:${c.hex === '#FFFFFF' || c.hex === '#F2F2F2' || c.hex === '#FFF8E7' || c.hex === '#FADADD' || c.hex === '#FDD835' || c.hex === '#C5E1A5' || c.hex === '#B3E5FC' || c.hex === '#D1C4E9' || c.hex === '#E8D8BF' || c.hex === '#80CBC4' ? '#100B32' : '#ffffff'};`}
                        onclick={() => (edBgColor = c.hex)}
                        aria-label={`배경색 ${c.name}`}
                        aria-pressed={edBgColor === c.hex}
                        title={c.name}
                      >{edBgColor === c.hex ? '✓' : ''}</button>
                    {/each}
                  </div>
                  {#if edBgColor}
                    <label class="mv-slider"><span>인식 범위 좁게</span><input type="range" min="10" max="90" step="1" bind:value={edBgTol} aria-label="배경 인식 범위" /><span>넓게</span></label>
                  {/if}
                {:else if sec.id === 'rotate'}
                  <div class="mv-row">
                    <button type="button" class="mv-btn" onclick={() => turn(-1)} aria-label="왼쪽으로 회전" title="왼쪽으로 회전">
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.5 9a5.5 5.5 0 1 0 1.8-4.07M3.5 2.5v3h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                    </button>
                    <button type="button" class="mv-btn" onclick={() => turn(1)} aria-label="오른쪽으로 회전" title="오른쪽으로 회전">
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M14.5 9a5.5 5.5 0 1 1-1.8-4.07M14.5 2.5v3h-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                    </button>
                    <button type="button" class="mv-btn" class:active={edFlipH} onclick={() => flip('h')} aria-label="좌우 반전" aria-pressed={edFlipH} title="좌우 반전">
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 2v14M6.5 5L2.5 13h4zM11.5 5l4 8h-4z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                    </button>
                    <button type="button" class="mv-btn" class:active={edFlipV} onclick={() => flip('v')} aria-label="상하 반전" aria-pressed={edFlipV} title="상하 반전">
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 9h14M5 6.5L13 2.5v4zM5 11.5l8 4v-4z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <div class="mv-row mv-edit-actions">
        <button type="button" class="mv-text-btn" onclick={resetEdit} disabled={editSaving}>초기화</button>
        <button type="button" class="mv-text-btn" onclick={endEdit} disabled={editSaving}>취소</button>
        <button type="button" class="mv-apply" onclick={applyEdit} disabled={editSaving}>{editSaving ? '저장 중...' : '적용'}</button>
      </div>
    </div>
  {:else}
  <div class="mv-bar" role="toolbar" aria-label="뷰어 도구">
    <button type="button" class="mv-btn" class:active={gridMode} onclick={() => (gridMode = !gridMode)} aria-label="썸네일 정렬" aria-pressed={gridMode} title="썸네일 정렬">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
        <rect x="10.5" y="2" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
        <rect x="2" y="10.5" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
        <rect x="10.5" y="10.5" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
      </svg>
    </button>

    {#if isImage}
      <span class="mv-sep" aria-hidden="true"></span>
      <button type="button" class="mv-btn" onclick={zoomOut} disabled={gridMode || zoom <= ZOOM_STEPS[0]} aria-label="축소" title="축소">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.5 9h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </button>
      <button type="button" class="mv-btn" onclick={zoomIn} disabled={gridMode || zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label="확대" title="확대">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.5 9h11M9 3.5v11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </button>
      <button type="button" class="mv-btn" onclick={resetView} disabled={gridMode || (zoom === 1 && panX === 0 && panY === 0)} aria-label="크기 맞춤" title="크기 맞춤">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M10.5 3H15v4.5M7.5 15H3v-4.5M15 3l-4.8 4.8M3 15l4.8-4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button type="button" class="mv-btn" onclick={rotate} disabled={gridMode} aria-label="회전" title="회전">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M14.5 9a5.5 5.5 0 1 1-1.8-4.07M14.5 2.5v3h-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      {#if canEdit}
        <button type="button" class="mv-btn" onclick={startEdit} disabled={gridMode || editLoading} aria-label="이미지 편집" title="이미지 편집">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M3 15l.7-3.3L12.4 3a1.6 1.6 0 0 1 2.3 2.3L6 14l-3 1zM10.8 4.6l2.6 2.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}
    {/if}

    {#if (downloadable && isImage) || onDelete}
      <span class="mv-sep mv-sep-grow" aria-hidden="true"></span>
    {/if}

    {#if downloadable && isImage}
      <button type="button" class="mv-btn" onclick={download} disabled={gridMode} aria-label="내려받기" title="내려받기">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 2.5v8.5M5.5 7.8L9 11.3l3.5-3.5M3 14.5h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    {/if}

    {#if onDelete && current}
      <div class="mv-del">
        <DeleteIconButton
          onclick={handleDelete}
          ariaLabel="삭제"
          confirming={deleteSafety.pendingKey === current.url}
          disabled={deleteSafety.busyKey !== null}
        />
      </div>
    {/if}
  </div>
  {/if}
</div>

<style>
  /* 뷰어가 열려 있는 동안 하단 토스트를 도구줄(바닥 24px + 높이 56px) 위로 — front·CMS 토스트 공통 */
  :global(body.mv-open [data-sonner-toaster][data-y-position='bottom']) { bottom: 100px !important; }
  .mv-backdrop {
    position: fixed;
    inset: 0;
    z-index: 600;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(16, 11, 50, 0.88);
    overscroll-behavior: contain;
  }

  /* 상단 */
  .mv-top {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 72px;
    padding: 0 84px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    pointer-events: none;
    color: var(--cs-white);
  }
  .mv-title {
    font: var(--text-pc-title-16);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mv-count {
    font: var(--text-pc-body-14);
    opacity: 0.7;
    flex-shrink: 0;
  }
  .mv-close {
    position: absolute;
    top: 14px; right: 20px;
    z-index: 3;
    width: 44px; height: 44px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.16);
    color: var(--cs-white);
    font-size: 18px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s;
  }
  .mv-close:hover { background: var(--cs-red-badge); }

  /* 본문 */
  .mv-stage {
    position: relative;
    flex: 1;
    width: 100%;
    min-height: 0;
    margin: 72px 0 96px;
    padding: 0 72px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .mv-img {
    display: block;
    object-fit: contain;
    border-radius: var(--cms-radius-md, 15px);
    user-select: none;
    touch-action: none;
    transition: transform 0.18s ease;
  }
  .mv-img.grab { cursor: grab; }
  .mv-img.dragging { cursor: grabbing; transition: none; }
  .mv-fail {
    margin: 0;
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    opacity: 0.8;
  }
  .mv-pdf {
    width: min(960px, 100%);
    height: 100%;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md, 15px);
    overflow: hidden;
  }
  .mv-video {
    width: min(960px, 100%);
    max-height: 100%;
    aspect-ratio: 16 / 9;
    border: none;
    border-radius: var(--cms-radius-md, 15px);
    background: #000;
  }
  .mv-thumb-play {
    position: absolute;
    left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    width: 36px; height: 36px;
    border-radius: 50%;
    background: rgba(16, 11, 50, 0.6);
    color: var(--cs-white);
    font-size: 14px;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none;
  }
  .mv-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px; height: 44px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.16);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s;
  }
  .mv-nav:hover { background: rgba(255, 255, 255, 0.3); }
  .mv-prev { left: 16px; }
  .mv-next { right: 16px; }

  /* 썸네일 정렬 */
  .mv-grid-wrap {
    flex: 1;
    width: 100%;
    min-height: 0;
    margin: 72px 0 96px;
    padding: 0 40px;
    box-sizing: border-box;
    overflow-y: auto;
    display: flex;
    justify-content: center;
  }
  .mv-grid {
    width: min(960px, 100%);
    height: max-content;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 12px;
  }
  .mv-thumb {
    position: relative;
    aspect-ratio: 1 / 1;
    padding: 4px;
    border: none;
    border-radius: var(--cms-radius-md, 15px);
    background: rgba(255, 255, 255, 0.1);
    cursor: pointer;
    transition: background 0.12s;
  }
  .mv-thumb:hover { background: rgba(255, 255, 255, 0.25); }
  .mv-thumb.current { background: var(--cs-purple); }
  .mv-thumb img {
    width: 100%; height: 100%;
    object-fit: cover;
    border-radius: 11px;
    display: block;
  }
  .mv-thumb-pdf {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    border-radius: 11px;
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font: var(--text-pc-title-16);
  }
  .mv-thumb-no {
    position: absolute;
    left: 10px; bottom: 10px;
    min-width: 22px; height: 22px;
    padding: 0 6px;
    border-radius: 11px;
    background: rgba(16, 11, 50, 0.7);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    display: flex; align-items: center; justify-content: center;
  }

  /* 하단 도구줄 */
  .mv-bar {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    width: min(460px, calc(100vw - 24px));
    height: 56px;
    padding: 0 10px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--cs-white);
    border-radius: var(--radius-xl, 30px);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .mv-bar::-webkit-scrollbar { display: none; }
  .mv-btn {
    flex-shrink: 0;
    width: 44px; height: 44px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--cs-text-mid);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s, color 0.12s;
  }
  .mv-btn:hover:not(:disabled) { background: var(--cs-surface-gray); color: var(--cs-text); }
  .mv-btn.active { background: var(--cs-purple); color: var(--cs-white); }
  .mv-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .mv-sep {
    flex-shrink: 0;
    width: 1px; height: 20px;
    margin: 0 6px;
    background: var(--cs-lilac);
  }
  .mv-sep-grow { margin-left: auto; background: transparent; }
  .mv-del {
    flex-shrink: 0;
    width: 44px; height: 44px;
    display: flex; align-items: center; justify-content: center;
  }
  .mv-del :global(.del-icon-btn) { margin-left: 0; }

  /* 이미지 편집 */
  .mv-edit-box { position: relative; flex-shrink: 0; }
  .mv-edit-canvas { display: block; width: 100%; height: 100%; border-radius: 4px; user-select: none; }
  .mv-crop {
    position: absolute;
    box-shadow: 0 0 0 9999px rgba(16, 11, 50, 0.55);
    background: transparent;
    cursor: move;
    touch-action: none;
  }
  .mv-handle {
    position: absolute;
    width: 22px; height: 22px;
    background: var(--cs-white);
    border-radius: 6px;
    touch-action: none;
  }
  .mv-handle-nw { left: -11px; top: -11px; cursor: nwse-resize; }
  .mv-handle-ne { right: -11px; top: -11px; cursor: nesw-resize; }
  .mv-handle-sw { left: -11px; bottom: -11px; cursor: nesw-resize; }
  .mv-handle-se { right: -11px; bottom: -11px; cursor: nwse-resize; }
  .mv-edit-bar {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    width: min(560px, calc(100vw - 24px));
    max-height: calc(100vh - 150px);
    overflow-y: auto;
    padding: 8px 14px 10px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg, 30px);
  }
  .mv-acc { display: flex; flex-direction: column; }
  .mv-acc-item + .mv-acc-item { border-top: 1px solid var(--cs-lilac); }
  .mv-acc-head {
    width: 100%;
    height: 44px;
    padding: 0 6px;
    border: none;
    border-radius: var(--cms-radius-sm, 10px);
    background: transparent;
    color: var(--cs-text);
    font: var(--text-pc-body-14);
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    transition: background 0.12s;
  }
  .mv-acc-head:hover { background: var(--cs-surface-gray); }
  .mv-acc-head.open { color: var(--cs-purple); }
  .mv-acc-panel { padding: 2px 6px 10px; display: flex; flex-direction: column; gap: 8px; }
  .mv-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .mv-hint { margin: 0; color: var(--cs-text-mid); font: var(--text-pc-script-12); }
  .mv-edit-actions { justify-content: flex-end; gap: 8px; }
  .mv-chip {
    height: 32px;
    padding: 0 12px;
    border: none;
    border-radius: 16px;
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .mv-chip:hover { background: var(--cs-lilac); }
  .mv-chip.active { background: var(--cs-purple); color: var(--cs-white); }
  .mv-slider {
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    white-space: nowrap;
  }
  .mv-slider input[type='range'] { flex: 1; min-width: 80px; accent-color: var(--cs-purple); }
  .mv-swatches { display: grid; grid-template-columns: repeat(12, 1fr); gap: 6px; }
  .mv-swatch {
    aspect-ratio: 1 / 1;
    min-width: 0;
    padding: 0;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    font-size: 13px;
    font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    box-shadow: inset 0 0 0 1px rgba(16, 11, 50, 0.12);
    transition: transform 0.12s;
  }
  .mv-swatch:hover { transform: scale(1.12); }
  .mv-text-btn {
    height: 44px;
    padding: 0 20px;
    border: none;
    border-radius: var(--cms-radius-md, 15px);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.12s;
  }
  .mv-text-btn:hover:not(:disabled) { background: var(--cs-lilac); }
  .mv-text-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .mv-apply {
    height: 44px;
    padding: 0 20px;
    border: none;
    border-radius: var(--cms-radius-md, 15px);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.12s;
  }
  .mv-apply:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .mv-apply:disabled { opacity: 0.5; cursor: not-allowed; }

  @media (max-width: 640px) {
    .mv-top { padding: 0 64px; }
    .mv-close { right: 12px; }
    .mv-stage { padding: 0 8px; margin-bottom: 92px; }
    .mv-swatches { grid-template-columns: repeat(8, 1fr); }
    .mv-nav { width: 40px; height: 40px; }
    .mv-prev { left: 6px; }
    .mv-next { right: 6px; }
    .mv-bar { bottom: 16px; }
  }
</style>
