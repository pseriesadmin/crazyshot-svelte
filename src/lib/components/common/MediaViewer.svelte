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
   *  · onMobileCreate를 넘기면 도구줄에 '모바일 전용 이미지' 아이콘이 나타난다(상품 이미지 전용). 모바일 상품상세 헤더 비율(390×800) 점선 가이드 위에서
   *    이미지를 줄이거나 늘려 구도를 맞춘 뒤 '+'를 누르면, 가이드 안 모습 그대로(빈 상·하단은 이미지 가장자리 색을 이어 자동 채움) large·thumb WebP로 onMobileCreate(index, {large, thumb})에 전달한다.
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
    /** 모바일 전용 이미지를 만든다(성공하면 true). 넘기지 않으면 모바일 이미지 버튼을 숨긴다 */
    onMobileCreate?: (index: number, files: { large: Blob; thumb: Blob }) => Promise<boolean> | boolean
  }

  let { items, index = $bindable(0), title = '이미지', onclose, onDelete, downloadable = true, onSave, startInEdit = false, onMobileCreate }: Props = $props()

  const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
  const ZOOM_MIN = ZOOM_STEPS[0]
  const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]
  const WHEEL_ZOOM_SENSITIVITY = 0.0006   // 휠 1틱(deltaY 100) ≈ 6%

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
      if (mobObjectUrl) URL.revokeObjectURL(mobObjectUrl)
      mobKeyReset()
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
    if (items.length < 2 || editMode || mobMode) return
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
    // 휠 이동량에 비례한 연속 배율 — 트랙패드의 잔잔한 스크롤은 미세하게, 마우스 휠 한 칸은 약 6%씩
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    const delta = Math.max(-120, Math.min(120, e.deltaY * unit))
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)))
    if (Math.abs(next - zoom) < 0.0005) return
    // 커서가 가리키는 지점이 제자리에 머물도록 이동값 보정
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const cx = e.clientX - (rect.left + rect.width / 2)
    const cy = e.clientY - (rect.top + rect.height / 2)
    const ratio = next / zoom
    zoom = next
    if (next <= 1) { panX = 0; panY = 0 } else { panX = cx - (cx - panX) * ratio; panY = cy - (cy - panY) * ratio }
  }


  // ── 이미지 편집(자르기 · 명암 · 컬러감 · 배경색 · 회전) ──────────────────────
  type Aspect = 'free' | '1:1' | '4:3' | '16:9'
  type EditSection = 'crop' | 'light' | 'tone' | 'sharp' | 'bg' | 'rotate'
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
    { id: 'sharp', label: '선명도·해상도' },
    { id: 'bg', label: '배경색 변경' },
    { id: 'rotate', label: '회전' },
  ]
  /** 지금 항목에서 허용된 편집 메뉴(항목별 editTools, 기본 전부) / 편집 가능 여부 */
  const editSectionIds = $derived<EditSection[]>(current?.editTools ?? EDIT_SECTIONS.map((e) => e.id))
  const visibleSections = $derived(EDIT_SECTIONS.filter((e) => editSectionIds.includes(e.id)))
  const canEdit = $derived(!!onSave && isImage && current?.editable !== false)
  /** 배경색 25색 */
  const BG_COLORS: { name: string; hex: string }[] = [
    { name: '기본 배경색', hex: '#F3F0EE' }, { name: '흰색', hex: '#FFFFFF' }, { name: '밝은 회색', hex: '#F2F2F2' }, { name: '회색', hex: '#BDBDBD' }, { name: '진회색', hex: '#6B6B6B' },
    { name: '차콜', hex: '#2B2B2B' }, { name: '검정', hex: '#000000' }, { name: '아이보리', hex: '#FFF8E7' }, { name: '베이지', hex: '#E8D8BF' },
    { name: '연분홍', hex: '#FADADD' }, { name: '분홍', hex: '#F48FB1' }, { name: '빨강', hex: '#E53935' }, { name: '주황', hex: '#FB8C00' },
    { name: '노랑', hex: '#FDD835' }, { name: '연두', hex: '#C5E1A5' }, { name: '초록', hex: '#43A047' }, { name: '민트', hex: '#80CBC4' },
    { name: '하늘', hex: '#B3E5FC' }, { name: '파랑', hex: '#1E88E5' }, { name: '남색', hex: '#1A237E' }, { name: '연보라', hex: '#D1C4E9' },
    { name: '보라', hex: '#7E57C2' }, { name: '브라운', hex: '#795548' }, { name: '카키', hex: '#8D8B55' }, { name: '크레이지샷 남색', hex: '#100B32' },
  ]
  const MAX_EDIT_SIDE = 2400
  /** 확대 결과의 긴 변 상한(브라우저 메모리 보호) */
  const MAX_OUT_SIDE = 4000
  const SCALE_CHOICES = [1, 1.5, 2]

  let editMode = $state(false)
  let editLoading = $state(false)
  let editSaving = $state(false)
  let edOpen = $state<EditSection | null>('crop')
  let edImg: HTMLImageElement | null = null
  let edObjectUrl: string | null = null
  let edTurns = $state(0)        // 90도 단위 회전 횟수(0~3) — 현재 화면의 회전 버튼은 edTilt를 쓴다
  let edTilt = $state(0)         // 5도 단위 기울기(도, 시계 방향이 +, -180 초과~180)
  const ED_TILT_STEP = 5
  let edFlipH = $state(false)
  let edFlipV = $state(false)
  let edLight = $state(0)        // 명암: -50(어둡게) ~ +50(밝게)
  let edWarm = $state(0)         // 컬러감: -50(차갑게) ~ +50(따뜻하게)
  let edBgColor = $state<string | null>(null)   // null = 원본 배경 유지
  let edSharp = $state(0)        // 선명도: 0(원본) ~ 100
  let edScale = $state(1)        // 해상도 배율(적용할 때 반영): 1 / 1.5 / 2
  let edBgTol = $state(36)       // 배경 인식 범위
  let edAspect = $state<Aspect>('free')
  let crop = $state({ x: 0, y: 0, w: 1, h: 1 })   // 회전·반전 적용된 이미지 기준 비율(0~1)
  let edCanvas: HTMLCanvasElement | null = $state(null)
  let edBox = $state({ w: 0, h: 0 })              // 미리보기 표시 크기(px)
  let edBarH = $state(0)
  let edBase: HTMLCanvasElement | null = null     // 회전·반전만 반영한 캔버스(긴 변 최대 2400px)
  let edVersion = $state(0)                       // edBase 갱신 알림
  // 배경 인식 결과 캐시(기준 캔버스와 같은 크기, 0~255 = 배경일 확률) — 회전·반전·인식 범위가 바뀌면 다시 계산
  let edBgAnalysis: BgAnalysis | null = null
  let edBgAnalysisKey = ''
  let edBgCanvas: HTMLCanvasElement | null = null
  let edBgCanvasKey = ''

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
      edTurns = 0; edTilt = 0; edFlipH = false; edFlipV = false; edLight = 0; edWarm = 0; edBgColor = null; edAspect = 'free'; edSharp = 0; edScale = 1
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
    edBgAnalysis = null
    edBgAnalysisKey = ''
    edBgCanvas = null
    edBgCanvasKey = ''
    if (edObjectUrl) { URL.revokeObjectURL(edObjectUrl); edObjectUrl = null }
  }

  function rebuildBase(): void {
    if (!edImg) return
    const sw = edImg.naturalWidth, sh = edImg.naturalHeight
    const k = Math.min(1, MAX_EDIT_SIDE / Math.max(sw, sh))
    const dw = Math.max(Math.round(sw * k), 1), dh = Math.max(Math.round(sh * k), 1)
    const swap = edTurns % 2 === 1
    const w0 = swap ? dh : dw, h0 = swap ? dw : dh
    // 기울여도 작업 영역 크기는 그대로(확대·축소 없음) — 이미지 중심을 축으로 돌리고, 드러난 모서리는 테두리 색으로 채운다
    const th = (edTilt * Math.PI) / 180
    const c = document.createElement('canvas')
    c.width = w0
    c.height = h0
    const ctx = c.getContext('2d')
    if (!ctx) return
    if (edTilt !== 0) {
      // 기울여서 드러난 모서리는 원본 테두리 색으로 채운다
      ctx.fillStyle = borderColorOf(edImg)
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.imageSmoothingQuality = 'high'
    }
    ctx.translate(c.width / 2, c.height / 2)
    ctx.rotate(th)
    ctx.rotate((edTurns * Math.PI) / 2)
    ctx.scale(edFlipH ? -1 : 1, edFlipV ? -1 : 1)
    ctx.drawImage(edImg, -dw / 2, -dh / 2, dw, dh)
    edBase = c
    edBgAnalysis = null
    edBgAnalysisKey = ''
    edBgCanvas = null
    edBgCanvasKey = ''
    edVersion++
  }

  function geometryChanged(): void {
    crop = { x: 0, y: 0, w: 1, h: 1 }
    edAspect = 'free'
    rebuildBase()
  }
  function turn(dir: 1 | -1): void {
    const next = (edTilt + dir * ED_TILT_STEP) % 360
    edTilt = next > 180 ? next - 360 : next <= -180 ? next + 360 : next
    geometryChanged()
  }
  function flip(axis: 'h' | 'v'): void { if (axis === 'h') edFlipH = !edFlipH; else edFlipV = !edFlipV; geometryChanged() }
  function resetEdit(): void {
    edTurns = 0; edTilt = 0; edFlipH = false; edFlipV = false; edLight = 0; edWarm = 0; edBgColor = null; edBgTol = 36; edSharp = 0; edScale = 1
    geometryChanged()
  }
  function toggleSection(id: EditSection): void { edOpen = edOpen === id ? null : id }

  // ── 배경 분리·재채색 ──────────────────────────────────────────────────────
  // 원칙: 배경이라고 확신하는 곳만 바꾸고 상품(오브젝트)은 한 픽셀도 건드리지 않는다.
  //  ① 테두리 색(B)과 "같은 색의 밝기만 다른 것(그림자·완만한 그라데이션)"만 테두리에서 이어진 영역으로 확장 — 색 차이·급격한 경계에서 멈춘다
  //  ② 배경 영역은 새 색 × (배경 기준색 대비 원래 밝기 비율)로 칠한다 → 그림자·그라데이션이 그대로 남는다
  //  ③ 경계의 안티앨리어싱 띠(5px)는 배경색과 오브젝트색의 혼합 비율(알파)을 풀어, 배경 몫만 새 색으로 바꾼다 → 경계가 거칠지 않고 옛 배경색 테두리가 남지 않는다
  function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  interface BgAnalysis {
    w: number; h: number
    px: Uint8ClampedArray        // 원본 픽셀(RGBA)
    reg: Uint8Array              // 0 오브젝트 · 1 배경 · 2 경계 띠 · 3 배경 아님으로 판정된 조각
    shade: Float32Array          // 배경(1)·띠(2)의 밝기 비율(1 = 배경 기준색 그대로, <1 그림자)
    wgt: Uint8Array              // 띠에서 배경이 차지하는 몫 0~255
    bl: Uint8Array               // 띠 옆 배경 색(RGB)
    mode: Uint8Array             // 띠 픽셀 처리(비트): 1 = 원본 가장자리가 오염(링잉 등)돼 안쪽 오브젝트 색과 새 배경색의 혼합으로 다시 만든다 · 2 = 안쪽 오브젝트 색(fcol)이 저장됨. 0 = 원래 픽셀의 배경 몫만 교체
    fcol: Uint8Array             // 안쪽 오브젝트 색(RGB)
  }

  /** 밝기 비율 — 배경 기준색 대비 얼마나 어두운지(작은 흔들림·압축 잡음은 1로 눌러 배경이 균일하게 칠해지게 한다) */
  function shadeOf(r: number, g: number, b: number, fr: number, fg: number, fb: number): number {
    const den = fr * fr + fg * fg + fb * fb
    if (den < 1) return 1
    const k = (r * fr + g * fg + b * fb) / den
    const d = k - 1
    const dz = 0.025
    const v = Math.abs(d) < dz ? 1 : 1 + d - Math.sign(d) * dz
    return v < 0 ? 0 : v > 1.15 ? 1.15 : v
  }

  function analyzeBackgroundPixels(px: Uint8ClampedArray, w: number, h: number, tol: number): BgAnalysis | null {
    const n = w * h
    // 1) 배경 기준색 B — 테두리 픽셀 색의 채널별 중앙값
    const rs: number[] = [], gs: number[] = [], bs: number[] = []
    const take = (x: number, y: number): void => { const i = (y * w + x) * 4; rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]) }
    const step = Math.max(1, Math.floor(Math.max(w, h) / 400))
    for (let x = 0; x < w; x += step) { take(x, 0); take(x, h - 1) }
    for (let y = 0; y < h; y += step) { take(0, y); take(w - 1, y) }
    const med = (arr: number[]): number => { arr.sort((p, q) => p - q); return arr[Math.floor(arr.length / 2)] }
    const br = med(rs), bg = med(gs), bb = med(bs)
    const BB = br * br + bg * bg + bb * bb
    const useScale = BB > 2500   // 기준색이 거의 검정이면 밝기 비율이 불안정 → 단순 색 거리만

    // 판정 기준은 고정값이 아니라 '이 이미지 테두리 배경의 실제 편차'에서 구한다 — 잡음이 적은 깨끗한 배경일수록 엄격해져,
    // 배경과 비슷한 흰색·밝은 상품(예: 흰 렌즈)을 배경으로 오인하지 않는다. 슬라이더(인식 범위)는 이 기준을 배율로 넓히거나 좁힌다.
    const tolScale = tol / 36
    const Bn = Math.sqrt(BB)
    const ks: number[] = [], resid: number[] = [], stepDiffs: number[] = []
    const sampleStat = (x: number, y: number): void => {
      const o = (y * w + x) * 4
      const k = useScale ? (px[o] * br + px[o + 1] * bg + px[o + 2] * bb) / BB : 1
      const dr = px[o] - k * br, dg = px[o + 1] - k * bg, db = px[o + 2] - k * bb
      ks.push(k); resid.push(Math.sqrt(dr * dr + dg * dg + db * db))
    }
    for (let x = 0; x < w; x += step) { sampleStat(x, 0); sampleStat(x, h - 1) }
    for (let y = 0; y < h; y += step) { sampleStat(0, y); sampleStat(w - 1, y) }
    const pairDiff = (o1: number, o2: number): number => {
      const dr = px[o1] - px[o2], dg = px[o1 + 1] - px[o2 + 1], db = px[o1 + 2] - px[o2 + 2]
      return Math.sqrt(dr * dr + dg * dg + db * db)
    }
    for (let x = 0; x < w - 1; x += step) { stepDiffs.push(pairDiff(x * 4, (x + 1) * 4), pairDiff(((h - 1) * w + x) * 4, ((h - 1) * w + x + 1) * 4)) }
    for (let y = 0; y < h - 1; y += step) { stepDiffs.push(pairDiff(y * w * 4, (y + 1) * w * 4), pairDiff((y * w + w - 1) * 4, ((y + 1) * w + w - 1) * 4)) }
    const pct = (arr: number[], q: number): number => { const c = arr.slice().sort((p1, p2) => p1 - p2); return c[Math.min(c.length - 1, Math.floor(c.length * q))] }
    const kMed = med(ks.slice())
    const kDev = pct(ks.map((v) => Math.abs(v - kMed)), 0.9)          // 테두리 밝기 비율의 흔들림
    const resP = pct(resid, 0.95)                                      // 테두리 색 편차
    const stepP = pct(stepDiffs, 0.9)                                  // 이웃 픽셀 간 차이(잡음 수준)
    const kHi = 1 + Math.max(0.012, 2 * kDev) * tolScale             // 배경보다 '밝은' 쪽 허용폭 — 좁게(흰 상품 보호)
    const resBase = Math.max(4, 2.2 * resP) * tolScale

    // 배경다움: B 방향의 밝기 비율 k 로 맞춘 뒤 남는 색 차이가 작아야 한다(strict=엄격: 오브젝트 안쪽 구멍 씨앗용)
    const likeRgb = (r: number, g: number, b: number, strict: boolean): boolean => {
      let k = 1
      if (useScale) {
        k = (r * br + g * bg + b * bb) / BB
        if (strict ? (k < 0.96 || k > 1 + 0.02 * tolScale) : (k < 0.45 || k > kHi)) return false
      }
      // 어두워진 만큼(그림자)은 색 차이를 조금 더 허용
      const L = strict ? Math.max(3, 1.6 * resP) * tolScale : resBase + 0.1 * Math.max(0, 1 - k) * Bn * tolScale
      const dr = r - k * br, dg = g - k * bg, db = b - k * bb
      return dr * dr + dg * dg + db * db <= L * L
    }
    const like = (o: number, strict: boolean): boolean => likeRgb(px[o], px[o + 1], px[o + 2], strict)
    const stepTol = Math.max(4.5, 2.5 * stepP) * Math.sqrt(tolScale)   // 급한 경계(오브젝트 윤곽)에서 번짐을 멈춘다
    const flatTol = Math.max(3, 2.2 * stepP) * Math.sqrt(tolScale)
    // 이웃 픽셀 사이 변화를 '밝기 방향(배경 기준색 B 방향)'과 '색 방향'으로 나눈다 — 그림자·완만한 그라데이션은 밝기 방향으로만 서서히 변하므로
    // 밝기 방향 변화는 넉넉히(한 칸 1.8%), 색 방향 변화는 잡음 수준으로만 허용한다. 오브젝트 윤곽은 둘 다 급해서 여기서 멈춘다.
    const ux = br / Bn, uy = bg / Bn, uz = bb / Bn
    const alongTol = Math.max(stepTol, 0.018 * Bn * Math.sqrt(tolScale))
    const stepOkVec = (o1: number, o2: number, cTol: number): boolean => {
      const dr = px[o1] - px[o2], dg = px[o1 + 1] - px[o2 + 1], db = px[o1 + 2] - px[o2 + 2]
      if (!useScale) return dr * dr + dg * dg + db * db <= cTol * cTol
      const al = dr * ux + dg * uy + db * uz
      if (al > alongTol || al < -alongTol) return false
      const cr = dr - al * ux, cg = dg - al * uy, cb = db - al * uz
      return cr * cr + cg * cg + cb * cb <= cTol * cTol
    }
    const stepOk = (a: number, c: number): boolean => stepOkVec(a, c, stepTol)
    // 평평함: 배경은 이웃과 거의 같다(잡음 수준·완만한 그림자). 경계의 부드러운 전이(은색 하이라이트·흐린 윤곽)는 '확실한 배경'에서 빼고 아래 경계 띠에서 혼합 비율로 정밀하게 푼다
    const flat = (q: number): boolean => {
      const o = q * 4
      const x = q % w, y = (q - x) / w
      return (x <= 0 || stepOkVec(o, (q - 1) * 4, flatTol)) && (x >= w - 1 || stepOkVec(o, (q + 1) * 4, flatTol)) && (y <= 0 || stepOkVec(o, (q - w) * 4, flatTol)) && (y >= h - 1 || stepOkVec(o, (q + w) * 4, flatTol))
    }

    const reg = new Uint8Array(n)
    const queue = new Int32Array(n)
    /** 시작 픽셀들에서 배경다운 이웃으로 번진다. 수집한 픽셀 수를 돌려준다(queue 앞쪽에 목록이 남는다) */
    const grow = (tail0: number): number => {
      let head = 0, tail = tail0
      while (head < tail) {
        const p = queue[head++]
        const x = p % w, y = (p - x) / w
        const o = p * 4
        if (x > 0) { const q = p - 1; if (reg[q] === 0 && like(q * 4, false) && stepOk(o, q * 4) && flat(q)) { reg[q] = 4; queue[tail++] = q } }
        if (x < w - 1) { const q = p + 1; if (reg[q] === 0 && like(q * 4, false) && stepOk(o, q * 4) && flat(q)) { reg[q] = 4; queue[tail++] = q } }
        if (y > 0) { const q = p - w; if (reg[q] === 0 && like(q * 4, false) && stepOk(o, q * 4) && flat(q)) { reg[q] = 4; queue[tail++] = q } }
        if (y < h - 1) { const q = p + w; if (reg[q] === 0 && like(q * 4, false) && stepOk(o, q * 4) && flat(q)) { reg[q] = 4; queue[tail++] = q } }
      }
      return tail
    }

    // 2) 테두리에서 이어진 배경
    let seeds = 0
    const seed = (x: number, y: number): void => {
      const p = y * w + x
      if (reg[p] === 0 && like(p * 4, false)) { reg[p] = 4; queue[seeds++] = p }
    }
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1) }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y) }
    let cnt = grow(seeds)
    for (let i = 0; i < cnt; i++) reg[queue[i]] = 1
    if (cnt === 0) return null

    // 3) 오브젝트로 둘러싸인 안쪽 배경(손잡이 구멍 등) — 배경색과 거의 같은 큰 덩어리만
    const minSize = Math.max(300, Math.round(n * 0.0003))
    for (let p = 0; p < n; p++) {
      if (reg[p] !== 0 || !like(p * 4, true)) continue
      reg[p] = 4
      queue[0] = p
      const size = grow(1)
      let val = 3
      if (size >= minSize) {
        // 덩어리 평균 색이 배경 기준색과 정말 같을 때만 배경 — 오브젝트 안의 흰 하이라이트·밝은 면을 배경으로 오인하지 않게
        let mr = 0, mg = 0, mb = 0
        for (let i = 0; i < size; i++) { const o = queue[i] * 4; mr += px[o]; mg += px[o + 1]; mb += px[o + 2] }
        mr /= size; mg /= size; mb /= size
        const k = useScale ? (mr * br + mg * bg + mb * bb) / BB : 1
        const dr = mr - k * br, dg = mg - k * bg, db = mb - k * bb
        const lim = Math.max(2.5, 1.2 * resP) * tolScale
        if ((!useScale || (k >= 0.96 && k <= 1 + 0.02 * tolScale)) && dr * dr + dg * dg + db * db <= lim * lim) val = 1
      }
      for (let i = 0; i < size; i++) reg[queue[i]] = val
    }

    // 3.5) 배경 속 작은 얼룩(먼지·잡음 덩어리) — 배경색에 가까운 아주 작은 '오브젝트 섬'은 배경으로 돌린다(작은 어두운 부품·가는 선은 색이 달라 그대로 남는다)
    const smallMax = Math.max(50, Math.round(n * 0.0002))
    const seen = new Uint8Array(n)
    for (let p0 = 0; p0 < n; p0++) {
      if ((reg[p0] !== 0 && reg[p0] !== 3) || seen[p0]) continue
      let head = 0, tail = 0
      queue[tail++] = p0; seen[p0] = 1
      let sr = 0, sg = 0, sb = 0, touchesEdge = false
      while (head < tail) {
        const p = queue[head++]
        const o = p * 4
        sr += px[o]; sg += px[o + 1]; sb += px[o + 2]
        const x = p % w, y = (p - x) / w
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true
        if (x > 0) { const q = p - 1; if (!seen[q] && (reg[q] === 0 || reg[q] === 3)) { seen[q] = 1; queue[tail++] = q } }
        if (x < w - 1) { const q = p + 1; if (!seen[q] && (reg[q] === 0 || reg[q] === 3)) { seen[q] = 1; queue[tail++] = q } }
        if (y > 0) { const q = p - w; if (!seen[q] && (reg[q] === 0 || reg[q] === 3)) { seen[q] = 1; queue[tail++] = q } }
        if (y < h - 1) { const q = p + w; if (!seen[q] && (reg[q] === 0 || reg[q] === 3)) { seen[q] = 1; queue[tail++] = q } }
      }
      if (tail <= smallMax && !touchesEdge && likeRgb(sr / tail, sg / tail, sb / tail, false)) {
        for (let i = 0; i < tail; i++) reg[queue[i]] = 1
      }
    }

    // 4) 경계 띠 — 배경에서 5px 이내의 비(非)배경 픽셀(흐릿한 경계도 덮는다)
    const band: number[] = []
    let frontier: number[] = []
    for (let p = 0; p < n; p++) {
      if (reg[p] !== 1) continue
      const x = p % w, y = (p - x) / w
      if ((x > 0 && reg[p - 1] !== 1) || (x < w - 1 && reg[p + 1] !== 1) || (y > 0 && reg[p - w] !== 1) || (y < h - 1 && reg[p + w] !== 1)) frontier.push(p)
    }
    // 배경 가장자리 1겹도 띠로 돌려 혼합 비율로 다시 푼다 — 흰 상품 가장자리처럼 배경과 비슷한 경계 픽셀이 이진 판정으로 깎여 나가는 것을 막는다
    const eroded = new Uint8Array(n)
    for (const p of frontier) { reg[p] = 2; eroded[p] = 1; band.push(p) }
    for (let layer = 0; layer < 5; layer++) {
      const next: number[] = []
      for (const p of frontier) {
        const x = p % w, y = (p - x) / w
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
        for (const q of nb) {
          if (q < 0 || reg[q] === 1 || reg[q] === 2) continue
          reg[q] = 2; band.push(q); next.push(q)
        }
      }
      frontier = next
    }

    // 5) 배경 픽셀의 밝기 비율 — 배경 기준색(B) 대비. 그림자·완만한 그라데이션이 그대로 비율로 남는다(기준색이 거의 검정이면 비율 없이 평평하게)
    const shade = new Float32Array(n)
    const wgt = new Uint8Array(n)
    const bl = new Uint8Array(n * 3)
    for (let p = 0; p < n; p++) {
      if (reg[p] !== 1) continue
      const o = p * 4
      shade[p] = useScale ? shadeOf(px[o], px[o + 1], px[o + 2], br, bg, bb) : 1
    }

    // 6) 경계 띠 — 가장 가까운 '확실한 배경'색(Bl)·'확실한 오브젝트'색(F)과 거리로 배경 몫(w)을 푼다
    const mode = new Uint8Array(n)
    const fcol = new Uint8Array(n * 3)
    /** 띠 픽셀마다 가장 가까운 확실한 픽셀(조건 isSrc)과 그 거리 — 띠 안에서만 번지는 너비 우선 탐색 */
    const nearest = (isSrc: (rg: number) => boolean): { src: Int32Array; dist: Uint8Array } => {
      const src = new Int32Array(n).fill(-1)
      const dist = new Uint8Array(n)
      const q: number[] = []
      for (const p of band) {
        const x = p % w, y = (p - x) / w
        const cand = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
        for (const c of cand) { if (c >= 0 && isSrc(reg[c])) { src[p] = c; dist[p] = 1; q.push(p); break } }
      }
      for (let head = 0; head < q.length; head++) {
        const p = q[head]
        const x = p % w, y = (p - x) / w
        const cand = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
        for (const r of cand) {
          if (r < 0 || reg[r] !== 2 || src[r] !== -1) continue
          src[r] = src[p]; dist[r] = Math.min(255, dist[p] + 1); q.push(r)
        }
      }
      return { src, dist }
    }
    const isBgRg = (rg: number): boolean => rg === 1
    const isObjRg = (rg: number): boolean => rg === 0 || rg === 3
    const nb = nearest(isBgRg)
    const nf = nearest(isObjRg)
    /** 확실한 픽셀 c 주변 3×3 중 같은 종류 픽셀의 평균 색(잡음 줄이기) */
    const meanAround = (c: number, pred: (rg: number) => boolean): [number, number, number] => {
      const cx = c % w, cy = (c - cx) / w
      let r = 0, g = 0, b = 0, k = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx, yy = cy + dy
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue
        const q = yy * w + xx
        if (!pred(reg[q])) continue
        const o = q * 4
        r += px[o]; g += px[o + 1]; b += px[o + 2]; k++
      }
      return k ? [r / k, g / k, b / k] : [px[c * 4], px[c * 4 + 1], px[c * 4 + 2]]
    }
    for (const p of band) {
      const o = p * 4
      const sb = nb.src[p]
      if (sb < 0) {
        // 안쪽 배경이 없는 좁은 틈 — 배경으로 되돌린다
        if (eroded[p]) { reg[p] = 1; shade[p] = useScale ? shadeOf(px[o], px[o + 1], px[o + 2], br, bg, bb) : 1 }
        continue
      }
      const [blr, blg, blb] = meanAround(sb, isBgRg)
      const sf = nf.src[p]
      let wv = 0
      let useF = false
      let fr = 0, fg = 0, fb = 0
      if (sf < 0) {
        // 가까운 확실한 오브젝트가 없다(외톨이 픽셀) — 옆 배경과 아주 비슷할 때만 배경으로(가는 선·끈이 지워지지 않게)
        const dr = px[o] - blr, dg = px[o + 1] - blg, db = px[o + 2] - blb
        wv = dr * dr + dg * dg + db * db <= (tol * 0.6) * (tol * 0.6) ? 1 : 0
      } else {
        ;[fr, fg, fb] = meanAround(sf, isObjRg)
        const vr = blr - fr, vg = blg - fg, vb = blb - fb
        const dd = vr * vr + vg * vg + vb * vb
        if (dd < 225) {
          // 가까운 오브젝트 색이 배경색과 거의 같아 혼합 비율을 풀 수 없다 — 이 픽셀이 옆 배경과 같은 색이면 배경 얼룩이므로 배경으로, 아니면 그대로 둔다
          const dr = px[o] - blr, dg = px[o + 1] - blg, db = px[o + 2] - blb
          if (dr * dr + dg * dg + db * db <= resBase * resBase) wv = 1
        } else {
          let t = ((px[o] - fr) * vr + (px[o + 1] - fg) * vg + (px[o + 2] - fb) * vb) / dd
          t = t < 0 ? 0 : t > 1 ? 1 : t
          // 이 픽셀이 두 색(오브젝트–배경)을 잇는 선 위에 있나 — 그러면 정상적인 혼합(안티앨리어싱)
          const er = px[o] - (fr + t * vr), eg = px[o + 1] - (fg + t * vg), eb = px[o + 2] - (fb + t * vb)
          const lineTol = 10 + 0.12 * Math.sqrt(dd)
          if (er * er + eg * eg + eb * eb <= lineTol * lineTol) {
            wv = t
          } else {
            // 선에서 벗어났다: 배경 쪽에 가까우면 원본 가장자리의 링잉·번짐(오염), 오브젝트 쪽이면 오브젝트의 질감 — 후자는 건드리지 않는다
            const dB = (px[o] - blr) ** 2 + (px[o + 1] - blg) ** 2 + (px[o + 2] - blb) ** 2
            const dF = (px[o] - fr) ** 2 + (px[o + 1] - fg) ** 2 + (px[o + 2] - fb) ** 2
            if (dB < dF) {
              const dO = nf.dist[p], dBg = nb.dist[p]
              wv = dO / (dO + dBg)
              useF = true
            }
          }
        }
      }
      if (wv <= 0) continue
      wgt[p] = Math.round(wv * 255)
      bl[p * 3] = Math.round(blr); bl[p * 3 + 1] = Math.round(blg); bl[p * 3 + 2] = Math.round(blb)
      shade[p] = useScale ? shadeOf(blr, blg, blb, br, bg, bb) : 1
      if (sf >= 0) { mode[p] = useF ? 3 : 2; fcol[p * 3] = Math.round(fr); fcol[p * 3 + 1] = Math.round(fg); fcol[p * 3 + 2] = Math.round(fb) }
    }

    // 6b) 흐린 경계 확장 — 띠 바깥에서도 색이 '배경→오브젝트' 선을 따라 계속 변하는 동안(최대 8칸)만 배경 몫을 이어 푼다. 경계가 흐릴수록 전이가 길다.
    //     평평해지면(은색 하이라이트·오브젝트 면) 멈추므로 오브젝트 질감은 건드리지 않는다.
    let ext: number[] = band.filter((p) => wgt[p] > 12 && wgt[p] < 250 && (mode[p] & 2) !== 0)
    for (let layer = 0; layer < 8 && ext.length > 0; layer++) {
      const nextExt: number[] = []
      for (const p of ext) {
        const blr = bl[p * 3], blg = bl[p * 3 + 1], blb = bl[p * 3 + 2]
        const fr = fcol[p * 3], fg = fcol[p * 3 + 1], fb = fcol[p * 3 + 2]
        const vr = blr - fr, vg = blg - fg, vb = blb - fb
        const dd = vr * vr + vg * vg + vb * vb
        if (dd < 225) continue
        const tp = wgt[p] / 255
        const x = p % w, y = (p - x) / w
        const cand = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
        for (const q of cand) {
          if (q < 0 || (reg[q] !== 0 && reg[q] !== 3)) continue
          const o = q * 4
          let t = ((px[o] - fr) * vr + (px[o + 1] - fg) * vg + (px[o + 2] - fb) * vb) / dd
          if (t >= tp - 0.012 || t <= 0.05) continue
          const er = px[o] - (fr + t * vr), eg = px[o + 1] - (fg + t * vg), eb = px[o + 2] - (fb + t * vb)
          const lineTol = 10 + 0.12 * Math.sqrt(dd)
          if (er * er + eg * eg + eb * eb > lineTol * lineTol) continue
          t = t > 1 ? 1 : t
          reg[q] = 2; mode[q] = 2; wgt[q] = Math.round(t * 255)
          bl[q * 3] = blr; bl[q * 3 + 1] = blg; bl[q * 3 + 2] = blb
          fcol[q * 3] = fr; fcol[q * 3 + 1] = fg; fcol[q * 3 + 2] = fb
          shade[q] = shade[p]
          band.push(q); nextExt.push(q)
        }
      }
      ext = nextExt
    }
    return { w, h, px, reg, shade, wgt, bl, mode, fcol }
  }

  /** 분석 결과에 새 배경색(tr,tg,tb)을 입힌 픽셀을 만든다 — 오브젝트(reg 0)·배경이 아닌 조각(3)은 원본 그대로 */
  function recolorBackgroundPixels(an: BgAnalysis, tr: number, tg: number, tb: number): Uint8ClampedArray<ArrayBuffer> {
    const { px, reg, shade, wgt, bl, mode, fcol } = an
    const n = an.w * an.h
    const out = new Uint8ClampedArray(px)
    for (let p = 0; p < n; p++) {
      const rg = reg[p]
      const o = p * 4
      if (rg === 1) {
        const k = shade[p]
        out[o] = tr * k; out[o + 1] = tg * k; out[o + 2] = tb * k
      } else if (rg === 2) {
        const w8 = wgt[p]
        if (w8 === 0) continue
        const wv = w8 / 255
        const k = shade[p]
        if ((mode[p] & 1) === 1) {
          // 원본 가장자리가 오염된 곳 — 안쪽 오브젝트 색과 새 배경색만으로 다시 만든다(옛 배경색·링잉이 남지 않게)
          out[o] = fcol[p * 3] * (1 - wv) + tr * k * wv
          out[o + 1] = fcol[p * 3 + 1] * (1 - wv) + tg * k * wv
          out[o + 2] = fcol[p * 3 + 2] * (1 - wv) + tb * k * wv
        } else {
          out[o] = px[o] + wv * (tr * k - bl[p * 3])
          out[o + 1] = px[o + 1] + wv * (tg * k - bl[p * 3 + 1])
          out[o + 2] = px[o + 2] + wv * (tb * k - bl[p * 3 + 2])
        }
      }
    }
    return out
  }

  /** 배경색을 바꾼 기준 캔버스(캐시) — 선택 색이 없으면 원본 기준 캔버스 */
  function bgSourceCanvas(): HTMLCanvasElement | null {
    if (!edBase || !edBgColor) return edBase
    const akey = `${edVersion}:${edBgTol}`
    if (edBgAnalysisKey !== akey) {
      const ctx = edBase.getContext('2d', { willReadFrequently: true })
      edBgAnalysis = ctx ? analyzeBackgroundPixels(ctx.getImageData(0, 0, edBase.width, edBase.height).data, edBase.width, edBase.height, edBgTol) : null
      edBgAnalysisKey = akey
      edBgCanvas = null
      edBgCanvasKey = ''
    }
    const an = edBgAnalysis
    if (!an) return edBase
    // 명암·컬러감 조절은 맨 마지막에 전체에 걸리므로, 선택한 배경색이 그대로 나오도록 미리 반대로 계산해 둔다
    const f = 1 + edLight / 100
    const warm = edWarm * 0.6
    const [R, G, B] = hexToRgb(edBgColor)
    const tr = (R - warm) / f, tg = (G - warm * 0.15) / f, tb = (B + warm) / f
    const ckey = `${akey}:${edBgColor}:${edLight}:${edWarm}`
    if (edBgCanvas && edBgCanvasKey === ckey) return edBgCanvas
    const out = recolorBackgroundPixels(an, tr, tg, tb)
    const cv = document.createElement('canvas')
    cv.width = an.w; cv.height = an.h
    const cx = cv.getContext('2d')
    if (!cx) return edBase
    cx.putImageData(new ImageData(out, an.w, an.h), 0, 0)
    edBgCanvas = cv
    edBgCanvasKey = ckey
    return cv
  }

  /** 박스 블러(가로·세로 한 번씩) — 선명도 계산용. RGB만 처리 */
  function boxBlurRgb(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
    const tmp = new Uint8ClampedArray(src.length)
    const out = new Uint8ClampedArray(src.length)
    const win = 2 * r + 1
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let x = -r; x <= r; x++) sum += src[(y * w + Math.min(Math.max(x, 0), w - 1)) * 4 + c]
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 4 + c] = sum / win
          sum += src[(y * w + Math.min(x + r + 1, w - 1)) * 4 + c] - src[(y * w + Math.max(x - r, 0)) * 4 + c]
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let y = -r; y <= r; y++) sum += tmp[(Math.min(Math.max(y, 0), h - 1) * w + x) * 4 + c]
        for (let y = 0; y < h; y++) {
          out[(y * w + x) * 4 + c] = sum / win
          sum += tmp[(Math.min(y + r + 1, h - 1) * w + x) * 4 + c] - tmp[(Math.max(y - r, 0) * w + x) * 4 + c]
        }
      }
    }
    return out
  }

  /** 언샵 마스크 — 원본에서 흐린 사본을 빼 윤곽만 더한다. 작은 차이(잡음)는 건드리지 않아 거칠어지는 것을 막는다 */
  function sharpenPixels(px: Uint8ClampedArray, w: number, h: number, strength: number): void {
    const r = Math.max(1, Math.round(Math.max(w, h) / 900))   // 이미지가 클수록 윤곽 폭도 비례
    const blur = boxBlurRgb(boxBlurRgb(px, w, h, r), w, h, r)
    const amount = (strength / 100) * 1.6
    const NOISE = 3
    for (let i = 0; i < px.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const d = px[i + c] - blur[i + c]
        if (d > NOISE || d < -NOISE) px[i + c] = px[i + c] + d * amount
      }
    }
  }

  /** 큰 폭으로 키울 때는 한 번에 키우지 않고 1.5배 이내씩 여러 번 — 뭉개짐·계단 현상을 줄인다 */
  function drawScaled(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number): void {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (dw <= sw * 1.5 || dh <= sh * 1.5) { ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh); return }
    let cur = document.createElement('canvas')
    cur.width = sw; cur.height = sh
    const c0 = cur.getContext('2d')
    if (!c0) { ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh); return }
    c0.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
    while (cur.width * 1.5 < dw) {
      const next = document.createElement('canvas')
      next.width = Math.round(cur.width * 1.4); next.height = Math.round(cur.height * 1.4)
      const nc = next.getContext('2d')
      if (!nc) break
      nc.imageSmoothingEnabled = true
      nc.imageSmoothingQuality = 'high'
      nc.drawImage(cur, 0, 0, next.width, next.height)
      cur = next
    }
    ctx.drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, dw, dh)
  }

  /** 기준 캔버스의 (sx,sy,sw,sh) 영역을 dw×dh로 그리면서 배경색·명암·컬러감·선명도를 반영(배경색은 기준 캔버스 단계에서 먼저 바꾼다) */
  function renderEdited(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number): void {
    if (!edBase) return
    drawScaled(ctx, bgSourceCanvas() ?? edBase, sx, sy, sw, sh, dw, dh)
    const adjust = edLight !== 0 || edWarm !== 0
    const sharp = edSharp > 0
    if (!adjust && !sharp) return
    const data = ctx.getImageData(0, 0, dw, dh)
    const px = data.data
    if (adjust) {
      const f = 1 + edLight / 100
      const warm = edWarm * 0.6
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] * f + warm, g = px[i + 1] * f + warm * 0.15, b = px[i + 2] * f - warm
        px[i] = r < 0 ? 0 : r > 255 ? 255 : r
        px[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
        px[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
      }
    }
    if (sharp) sharpenPixels(px, dw, dh, edSharp)
    ctx.putImageData(data, 0, 0)
  }

  /** 적용 시 실제 결과 크기 — 선택한 배율을 긴 변 상한 안으로 제한 */
  function outputSize(sw: number, sh: number): { w: number; h: number; k: number } {
    const k = Math.min(edScale, MAX_OUT_SIDE / Math.max(sw, sh))
    const kk = Math.max(k, 1)
    return { w: Math.round(sw * kk), h: Math.round(sh * kk), k: kk }
  }

  // 미리보기 그리기 — 스테이지 크기에 맞춰 축소해 표시
  $effect(() => {
    void edVersion; void edLight; void edWarm; void edBgColor; void edBgTol; void edSharp
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
  // 편집 화면 위에서 세로 스크롤하면 자르기 영역을 중심 기준으로 확대(위로)·축소(아래로) — 가로세로 비율은 유지
  function editWheel(e: WheelEvent): void {
    if (editSaving || edBox.w <= 0 || edBox.h <= 0) return
    e.preventDefault()
    if (!e.deltaY) return
    const lo = Math.max(MIN_CROP / crop.w, MIN_CROP / crop.h)
    const hi = Math.min(1 / crop.w, 1 / crop.h)
    const f = Math.min(Math.max(Math.exp(-e.deltaY * 0.0015), lo), Math.max(hi, lo))
    const w = crop.w * f, h = crop.h * f
    const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2
    crop = {
      x: Math.min(Math.max(cx - w / 2, 0), 1 - w),
      y: Math.min(Math.max(cy - h / 2, 0), 1 - h),
      w, h
    }
  }

  async function applyEdit(): Promise<void> {
    if (!edBase || !onSave || editSaving) return
    editSaving = true
    try {
      const sx = Math.round(crop.x * edBase.width), sy = Math.round(crop.y * edBase.height)
      const sw = Math.max(Math.round(crop.w * edBase.width), 1), sh = Math.max(Math.round(crop.h * edBase.height), 1)
      const outSz = outputSize(sw, sh)
      const out = document.createElement('canvas')
      out.width = outSz.w; out.height = outSz.h
      const ctx = out.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('canvas')
      renderEdited(ctx, sx, sy, sw, sh, outSz.w, outSz.h)
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


  // ── 모바일 전용 이미지(상품상세 모바일 헤더 비율 390×800 가이드) ───────────────
  const MOB_RATIO_W = 390
  const MOB_RATIO_H = 800
  const MOB_OUT_W = 780   // 2배 해상도 출력
  const MOB_OUT_H = 1600
  const MOB_THUMB_W = 240
  const MOB_THUMB_H = 492
  const canMobile = $derived(!!onMobileCreate && isImage)

  let mobMode = $state(false)
  let mobLoading = $state(false)
  let mobSaving = $state(false)
  let mobImg: HTMLImageElement | null = null
  let mobObjectUrl = $state<string | null>(null)
  let mobNat = $state({ w: 0, h: 0 })
  let mobF = $state(1)          // 1 = 이미지 전체가 가이드 안에 들어오는 크기(contain), 커질수록 확대
  let mobX = $state(0)          // 가이드 중심 기준 이미지 중심 이동량(가이드 px)
  let mobY = $state(0)
  let mobBarH = $state(0)
  let mobRot = $state(0)        // 이미지 기울기(도, 시계 방향이 +) — 5도씩 조절
  const MOB_ROT_STEP = 5

  // 가이드 크기 — 스테이지 높이(+ 버튼 자리)와 폭에 맞춰 390:800 비율로 계산
  const mobGuide = $derived.by(() => {
    const maxH = Math.max(Math.min(stageH - 92, 640), 160)
    const maxW = Math.max(stageW - 48, 90)
    const h = Math.min(maxH, (maxW * MOB_RATIO_H) / MOB_RATIO_W)
    return { w: Math.round((h * MOB_RATIO_W) / MOB_RATIO_H), h: Math.round(h) }
  })
  const mobBase = $derived(mobNat.w > 0 ? Math.min(mobGuide.w / mobNat.w, mobGuide.h / mobNat.h) : 1)
  const mobCover = $derived(mobNat.w > 0 ? Math.max(mobGuide.w / mobNat.w, mobGuide.h / mobNat.h) / mobBase : 1)
  const mobScale = $derived(mobBase * mobF)      // 원본 1px 당 가이드 px
  const MOB_F_MIN = 0.3
  const MOB_F_MAX = 4

  async function startMobile(): Promise<void> {
    if (!current || !canMobile) return
    mobLoading = true
    try {
      const res = await fetch(current.url)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('load')); img.src = url })
      if (mobObjectUrl) URL.revokeObjectURL(mobObjectUrl)
      mobObjectUrl = url
      mobImg = img
      mobNat = { w: img.naturalWidth, h: img.naturalHeight }
      mobF = 1; mobX = 0; mobY = 0; mobRot = 0
      mobMode = true
    } catch {
      csToast.error('이 이미지는 모바일 이미지로 만들 수 없습니다.')
      endMobile()
    } finally {
      mobLoading = false
    }
  }

  function endMobile(): void {
    mobKeyReset()
    mobMode = false
    mobImg = null
    if (mobObjectUrl) { URL.revokeObjectURL(mobObjectUrl); mobObjectUrl = null }
  }

  function mobSetF(next: number): void {
    mobF = Math.min(Math.max(next, MOB_F_MIN), MOB_F_MAX)
  }
  function mobRotate(dir: 1 | -1): void {
    const next = (mobRot + dir * MOB_ROT_STEP) % 360
    mobRot = next > 180 ? next - 360 : next <= -180 ? next + 360 : next
  }
  function mobFitAll(): void { mobF = 1; mobX = 0; mobY = 0 }
  function mobFill(): void { mobF = Math.min(mobCover, MOB_F_MAX); mobX = 0; mobY = 0 }

  let mobDrag: { x: number; y: number; px: number; py: number } | null = null
  function mobDown(e: PointerEvent): void {
    mobDrag = { x: e.clientX, y: e.clientY, px: mobX, py: mobY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function mobMove(e: PointerEvent): void {
    if (!mobDrag) return
    mobX = mobDrag.px + (e.clientX - mobDrag.x)
    mobY = mobDrag.py + (e.clientY - mobDrag.y)
  }
  function mobUp(): void { mobDrag = null }
  // 모바일 도구줄 위에서 좌우 스크롤(트랙패드 가로 스크롤·Shift+휠)로 크기 조절 — 오른쪽 늘리기 / 왼쪽 줄이기
  function mobBarWheel(node: HTMLElement): { destroy: () => void } {
    const onWheel = (e: WheelEvent): void => {
      const d = e.deltaX || (e.shiftKey ? e.deltaY : 0)
      if (!d) return
      e.preventDefault()
      mobSetF(mobF * Math.exp(d * 0.0015))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return { destroy: () => node.removeEventListener('wheel', onWheel) }
  }
  function mobWheel(e: WheelEvent): void {
    e.preventDefault()
    // 가로 스크롤(트랙패드 좌우·Shift+휠)은 이미지를 좌우로 이동, 세로 스크롤은 크기 조절
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { mobX -= e.deltaX; return }
    mobSetF(mobF * Math.exp(-e.deltaY * 0.0015))
  }

  type Rgb = [number, number, number]
  const medianOf = (arr: number[]): number => { arr.sort((p, q) => p - q); return arr[Math.floor(arr.length / 2)] }

  /**
   * 가장자리 색 띠(profile) — 이미지 가장자리 바로 안쪽 여러 줄의 칸별 중앙값을 구해 상품이 가장자리에 걸친 칸(이상치)은 배경 색으로 대체하고,
   * 이동 평균으로 부드럽게 만든다. 빈 영역은 이 띠를 그대로 바깥으로 늘려 채우므로 이미지 가장자리와 색이 이어진다.
   */
  function edgeProfile(px: Uint8ClampedArray, W: number, length: number, at: (pos: number, depth: number) => number): Rgb[] {
    const DEPTH = 8
    const prof: Rgb[] = []
    for (let k = 0; k < length; k++) {
      const rs: number[] = [], gs: number[] = [], bs: number[] = []
      for (let d = 0; d < DEPTH; d++) {
        const o = at(k, d) * 4
        rs.push(px[o]); gs.push(px[o + 1]); bs.push(px[o + 2])
      }
      prof.push([medianOf(rs), medianOf(gs), medianOf(bs)])
    }
    // 이상치(배경과 크게 다른 칸 — 가장자리에 걸친 상품) → 전체 중앙값 배경색으로 교체
    const mid: Rgb = [medianOf(prof.map((c) => c[0])), medianOf(prof.map((c) => c[1])), medianOf(prof.map((c) => c[2]))]
    const lim = 38 * 38 * 3
    const cleaned = prof.map((c): Rgb => {
      const dr = c[0] - mid[0], dg = c[1] - mid[1], db = c[2] - mid[2]
      return dr * dr + dg * dg + db * db > lim ? mid : c
    })
    // 이동 평균 2회 — 칸 사이 줄무늬 제거
    const win = Math.max(3, Math.round(length / 16))
    let cur = cleaned
    for (let pass = 0; pass < 2; pass++) {
      const next: Rgb[] = []
      for (let k = 0; k < length; k++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let q = Math.max(0, k - win); q <= Math.min(length - 1, k + win); q++) { r += cur[q][0]; g += cur[q][1]; b += cur[q][2]; n++ }
        next.push([r / n, g / n, b / n])
      }
      cur = next
    }
    return cur
  }

  /** 원본 이미지 테두리(바깥 2px 띠)의 중앙값 색 — 기울였을 때 드러나는 빈 영역을 채우는 색 */
  function sourceBorderColor(): string { return mobImg ? borderColorOf(mobImg) : '#ffffff' }
  function borderColorOf(img: HTMLImageElement): string {
    const S = 96
    const cv = document.createElement('canvas')
    cv.width = S; cv.height = S
    const cx = cv.getContext('2d', { willReadFrequently: true })
    if (!cx) return '#ffffff'
    cx.drawImage(img, 0, 0, S, S)
    const d = cx.getImageData(0, 0, S, S).data
    const rs: number[] = [], gs: number[] = [], bs: number[] = []
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (x >= 2 && x < S - 2 && y >= 2 && y < S - 2) continue
        const o = (y * S + x) * 4
        if (d[o + 3] < 128) continue   // 투명한 테두리는 색 계산에서 제외(검정으로 채워지는 것 방지)
        rs.push(d[o]); gs.push(d[o + 1]); bs.push(d[o + 2])
      }
    }
    if (rs.length === 0) return '#ffffff'
    return `rgb(${medianOf(rs)},${medianOf(gs)},${medianOf(bs)})`
  }

  /** 가이드 안 모습을 OW×OH로 그리고, 빈 상·하단(좌·우)은 이미지 가장자리 색을 바깥으로 이어 자동 채움 */
  function renderMobile(): HTMLCanvasElement | null {
    if (!mobImg || mobGuide.w <= 0) return null
    const W = MOB_OUT_W, H = MOB_OUT_H
    const m = W / mobGuide.w
    // 원본 가장자리 몇 px(경계선·반투명 테두리)는 쓰지 않는다 — 가로선·색 어긋남의 원인
    const ins = Math.max(2, Math.round(Math.min(mobNat.w, mobNat.h) * 0.004))
    const sw = mobNat.w - ins * 2, sh = mobNat.h - ins * 2
    if (sw <= 0 || sh <= 0) return null
    const dw = sw * mobScale * m, dh = sh * mobScale * m
    // 정수 좌표로 맞춰 가장자리 줄이 반투명하게 번지지 않도록
    const x0 = Math.round(W / 2 + mobX * m - dw / 2), y0 = Math.round(H / 2 + mobY * m - dh / 2)
    const x1 = x0 + Math.max(Math.round(dw), 1), y1 = y0 + Math.max(Math.round(dh), 1)
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    if (mobRot !== 0) {
      // 기울인 경우: 원본 테두리 색으로 바탕을 채운 뒤, 이미지 중심을 축으로 회전해 그린다(드러난 모서리·빈 영역은 테두리 색)
      ctx.fillStyle = sourceBorderColor()
      ctx.fillRect(0, 0, W, H)
      ctx.imageSmoothingQuality = 'high'
      ctx.save()
      ctx.translate(W / 2 + mobX * m, H / 2 + mobY * m)
      ctx.rotate((mobRot * Math.PI) / 180)
      ctx.drawImage(mobImg, ins, ins, sw, sh, -dw / 2, -dh / 2, dw, dh)
      ctx.restore()
      return c
    }
    ctx.drawImage(mobImg, ins, ins, sw, sh, x0, y0, x1 - x0, y1 - y0)
    const vx0 = Math.max(x0, 0), vx1 = Math.min(x1, W), vy0 = Math.max(y0, 0), vy1 = Math.min(y1, H)
    if (vx1 - vx0 < 2 || vy1 - vy0 < 2) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      return c
    }
    if (vx0 === 0 && vx1 === W && vy0 === 0 && vy1 === H) return c   // 빈 영역 없음
    const data = ctx.getImageData(0, 0, W, H)
    const px = data.data
    const clampDepth = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)
    const top = y0 > 0 ? edgeProfile(px, W, vx1 - vx0, (k, d) => clampDepth(vy0 + d, 0, H - 1) * W + vx0 + k) : null
    const bottom = y1 < H ? edgeProfile(px, W, vx1 - vx0, (k, d) => clampDepth(vy1 - 1 - d, 0, H - 1) * W + vx0 + k) : null
    const left = x0 > 0 ? edgeProfile(px, W, vy1 - vy0, (k, d) => (vy0 + k) * W + clampDepth(vx0 + d, 0, W - 1)) : null
    const right = x1 < W ? edgeProfile(px, W, vy1 - vy0, (k, d) => (vy0 + k) * W + clampDepth(vx1 - 1 - d, 0, W - 1)) : null
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x >= vx0 && x < vx1 && y >= vy0 && y < vy1) continue
        let col: Rgb | null = null
        if (y < vy0 && top) col = top[clampDepth(x, vx0, vx1 - 1) - vx0]
        else if (y >= vy1 && bottom) col = bottom[clampDepth(x, vx0, vx1 - 1) - vx0]
        else if (x < vx0 && left) col = left[clampDepth(y, vy0, vy1 - 1) - vy0]
        else if (x >= vx1 && right) col = right[clampDepth(y, vy0, vy1 - 1) - vy0]
        const o = (y * W + x) * 4
        px[o] = col ? col[0] : 255
        px[o + 1] = col ? col[1] : 255
        px[o + 2] = col ? col[2] : 255
        px[o + 3] = 255
      }
    }
    ctx.putImageData(data, 0, 0)
    return c
  }

  async function createMobile(): Promise<void> {
    if (!onMobileCreate || mobSaving) return
    mobSaving = true
    try {
      const big = renderMobile()
      if (!big) throw new Error('canvas')
      const small = document.createElement('canvas')
      small.width = MOB_THUMB_W; small.height = MOB_THUMB_H
      small.getContext('2d')?.drawImage(big, 0, 0, MOB_THUMB_W, MOB_THUMB_H)
      const toBlob = (cv: HTMLCanvasElement, q: number): Promise<Blob | null> => new Promise((ok) => cv.toBlob(ok, 'image/webp', q))
      const [large, thumb] = await Promise.all([toBlob(big, 0.88), toBlob(small, 0.82)])
      if (!large || !thumb) throw new Error('blob')
      const saved = await onMobileCreate(index, { large, thumb })
      if (saved) { csToast.success('모바일 전용 이미지를 만들었습니다.'); endMobile() }
    } catch {
      csToast.error('모바일 이미지 저장에 실패했습니다.')
    } finally {
      mobSaving = false
    }
  }

  // 방향키 연속 이동: 누르고 있는 시간이 길수록 빨라진다(0.4초 뒤부터 가속)
  const MOB_ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
  const mobKeys = new Set<string>()
  let mobKeyFast = false
  let mobKeyZoom = false
  let mobKeyRaf = 0
  let mobKeyStart = 0
  let mobKeyLast = 0
  function mobKeyDir(): { dx: number; dy: number } {
    return {
      dx: (mobKeys.has('ArrowRight') ? 1 : 0) - (mobKeys.has('ArrowLeft') ? 1 : 0),
      dy: (mobKeys.has('ArrowDown') ? 1 : 0) - (mobKeys.has('ArrowUp') ? 1 : 0)
    }
  }
  function mobKeyStep(): void {
    const { dx, dy } = mobKeyDir()
    if (mobKeyZoom) { if (dx) mobSetF(mobF * (1 + dx * (mobKeyFast ? 0.05 : 0.01))); return }
    const step = mobKeyFast ? 10 : 1
    mobX += dx * step
    mobY += dy * step
  }
  function mobKeyLoop(now: number): void {
    mobKeyRaf = 0
    if (!mobMode || mobSaving || mobKeys.size === 0) return
    const dt = Math.min(now - mobKeyLast, 50) / 1000
    mobKeyLast = now
    const held = now - mobKeyStart
    if (held > 400) {
      const ramp = Math.min(1 + (held - 400) / 800, 3)   // 1배 → 3배로 서서히 가속
      const { dx, dy } = mobKeyDir()
      if (mobKeyZoom) {
        if (dx) mobSetF(mobF * Math.exp(dx * dt * (mobKeyFast ? 1.8 : 0.7) * ramp))
      } else {
        const speed = (mobKeyFast ? 400 : 90) * ramp   // 가이드 px/초
        mobX += dx * speed * dt
        mobY += dy * speed * dt
      }
    }
    mobKeyRaf = requestAnimationFrame(mobKeyLoop)
  }
  function onKeyUp(e: KeyboardEvent): void {
    mobKeys.delete(e.key)
    if (e.key === 'Control') mobKeyZoom = false
    if (mobKeys.size === 0 && mobKeyRaf) { cancelAnimationFrame(mobKeyRaf); mobKeyRaf = 0 }
  }
  function mobKeyReset(): void {
    mobKeys.clear()
    if (mobKeyRaf) { cancelAnimationFrame(mobKeyRaf); mobKeyRaf = 0 }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { if (mobMode) { if (!mobSaving) endMobile() } else if (editMode) { if (!editSaving) endEdit() } else if (gridMode) gridMode = false; else onclose(); return }
    if (mobMode) {
      // 모바일 가이드: 방향키로 이미지 이동, Ctrl + 좌우 방향키로 크기 조절(Shift는 빠르게)
      // 키를 누르고 있는 동안은 OS 키반복(처음 지연 후 뭉텅이 입력) 대신 매 프레임 부드럽게 이어서 움직인다
      if (!MOB_ARROWS.includes(e.key) || mobSaving) return
      // 크기 슬라이더(range)에 포커스가 남아 있어도 방향키는 슬라이더가 아닌 이미지 이동으로 쓴다(preventDefault로 슬라이더 이동 차단)
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t instanceof HTMLInputElement && t.type !== 'range'))) return
      e.preventDefault()
      if (e.repeat) return
      mobKeys.add(e.key)
      mobKeyFast = e.shiftKey
      mobKeyZoom = e.ctrlKey
      mobKeyStart = performance.now()
      mobKeyLast = mobKeyStart
      // 눌렀을 때 한 번 즉시 반응(가볍게 톡 치면 1칸/한 단계)
      mobKeyStep()
      if (!mobKeyRaf) mobKeyRaf = requestAnimationFrame(mobKeyLoop)
      return
    }
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

<svelte:window onkeydown={onKey} onkeyup={onKeyUp} onblur={mobKeyReset} />

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
    <div class="mv-stage mv-edit-stage" style={`margin-bottom:${edBarH + 32}px;`} bind:clientWidth={stageW} bind:clientHeight={stageH} role="presentation" onwheel={editWheel}>
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
  {:else if mobMode}
    <div class="mv-stage mv-mob-stage" style={`margin-bottom:${mobBarH + 32}px;`} bind:clientWidth={stageW} bind:clientHeight={stageH} role="presentation" onwheel={mobWheel}>
      <div class="mv-mob-wrap" role="presentation" onpointerdown={mobDown} onpointermove={mobMove} onpointerup={mobUp} onpointercancel={mobUp}>
        <div class="mv-mob-guide" style={`width:${mobGuide.w}px;height:${mobGuide.h}px;`}>
          {#if mobObjectUrl}
            <img
              class="mv-mob-img"
              src={mobObjectUrl}
              alt=""
              draggable="false"
              style={`width:${mobNat.w * mobScale}px;height:${mobNat.h * mobScale}px;left:${mobGuide.w / 2 + mobX - (mobNat.w * mobScale) / 2}px;top:${mobGuide.h / 2 + mobY - (mobNat.h * mobScale) / 2}px;transform:rotate(${mobRot}deg);`}
            />
          {/if}
          <span class="mv-mob-label">모바일 {MOB_RATIO_W}×{MOB_RATIO_H}</span>
        </div>
        <div class="mv-row mv-mob-tools" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
          <button type="button" class="mv-mob-icon" onclick={() => mobRotate(-1)} aria-label="왼쪽으로 5도 회전" title="왼쪽으로 5도 회전">
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.5 9a5.5 5.5 0 1 0 1.8-4.07M3.5 2.5v3h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button type="button" class="mv-mob-icon" onclick={mobFitAll} aria-label="전체 보기" title="전체 보기">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /><rect x="7" y="7" width="6" height="6" rx="1" fill="currentColor" /></svg>
          </button>
          <button type="button" class="mv-mob-icon" onclick={mobFill} aria-label="꽉 채우기" title="꽉 채우기">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2" fill="currentColor" /></svg>
          </button>
          <button type="button" class="mv-mob-icon" onclick={() => mobRotate(1)} aria-label="오른쪽으로 5도 회전" title="오른쪽으로 5도 회전">
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M14.5 9a5.5 5.5 0 1 1-1.8-4.07M14.5 2.5v3h-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
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
            <PdfViewer src={current.url} docLabel="문서" title={displayName} downloadUrl={downloadable ? current.url : undefined} downloadFilename={fileNameOf(current)} />
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
              <ChevronIcon direction={edOpen === sec.id ? 'up' : 'down'} size={5} color="#666666" />
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
                {:else if sec.id === 'sharp'}
                  <div class="mv-row">
                    {#each SCALE_CHOICES as k (k)}
                      <button type="button" class="mv-chip" class:active={edScale === k} onclick={() => (edScale = k)} aria-pressed={edScale === k}>{k === 1 ? '원래 크기' : `${k}배`}</button>
                    {/each}
                  </div>
                  <label class="mv-slider"><span>선명도 낮게</span><input type="range" min="0" max="100" step="1" bind:value={edSharp} aria-label="선명도 조절" /><span>높게</span></label>
                  <p class="mv-hint">선명도는 미리보기에 바로 보입니다. 해상도는 [적용]을 누를 때 반영되며{#if edBase && edScale > 1} 결과는 약 {outputSize(Math.max(Math.round(crop.w * edBase.width), 1), Math.max(Math.round(crop.h * edBase.height), 1)).w}×{outputSize(Math.max(Math.round(crop.w * edBase.width), 1), Math.max(Math.round(crop.h * edBase.height), 1)).h}px{/if}, 원본에 없는 세부 묘사를 새로 만들지는 못하고 경계를 또렷하게 해줍니다. 너무 높이면 가장자리에 하얀 테두리가 생길 수 있어요.</p>
                {:else if sec.id === 'bg'}
                  <div class="mv-row">
                    <button type="button" class="mv-chip" class:active={edBgColor === null} onclick={() => (edBgColor = null)} aria-pressed={edBgColor === null}>원본 배경</button>
                    <span class="mv-hint">배경만 골라 선택한 색으로 바꾸고, 상품은 그대로 두며 그림자·명암은 남깁니다.</span>
                  </div>
                  <div class="mv-swatches">
                    {#each BG_COLORS as c (c.hex)}
                      <button
                        type="button"
                        class="mv-swatch"
                        class:selected={edBgColor === c.hex}
                        style={`background:${c.hex};color:${c.hex === '#F3F0EE' || c.hex === '#FFFFFF' || c.hex === '#F2F2F2' || c.hex === '#FFF8E7' || c.hex === '#FADADD' || c.hex === '#FDD835' || c.hex === '#C5E1A5' || c.hex === '#B3E5FC' || c.hex === '#D1C4E9' || c.hex === '#E8D8BF' || c.hex === '#80CBC4' ? '#100B32' : '#ffffff'};`}
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
  {:else if mobMode}
    <div class="mv-edit-bar mv-mob-bar" role="toolbar" aria-label="모바일 이미지 도구" bind:clientHeight={mobBarH} use:mobBarWheel>
      <button type="button" class="mv-mob-add" onclick={createMobile} onpointerdown={(e) => e.stopPropagation()} disabled={mobSaving} aria-label="모바일 전용 이미지로 저장" title="가이드 안 모습 그대로 모바일 전용 이미지로 저장">
        {#if mobSaving}…{:else}<svg viewBox="0 0 18 12" fill="none" aria-hidden="true"><path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" /></svg>{/if}
      </button>
    </div>
  {:else}
  <div class="mv-bar" class:mv-bar-wide={!!onMobileCreate} role="toolbar" aria-label="뷰어 도구">
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
      {#if canMobile}
        <button type="button" class="mv-btn" onclick={startMobile} disabled={gridMode || mobLoading} aria-label="모바일 전용 이미지 만들기" title="모바일 전용 이미지 만들기">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect x="5" y="1.8" width="8" height="14.4" rx="2" stroke="currentColor" stroke-width="1.6" />
            <path d="M8 13.8h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
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
  .mv-bar-wide { width: min(512px, calc(100vw - 24px)); }
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

  /* 모바일 전용 이미지 */
  .mv-mob-stage { overflow: hidden; touch-action: none; }
  .mv-mob-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 28px;
    cursor: grab;
    touch-action: none;
  }
  .mv-mob-guide {
    position: relative;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.08);
  }
  .mv-mob-img { position: absolute; max-width: none; user-select: none; pointer-events: none; }
  .mv-mob-guide::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 2;
    border: 2px dashed var(--cs-white);
    box-shadow: 0 0 0 9999px rgba(16, 11, 50, 0.6);
    pointer-events: none;
  }
  .mv-mob-label {
    position: absolute;
    left: 8px; top: 8px;
    z-index: 3;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(16, 11, 50, 0.7);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    pointer-events: none;
  }
  .mv-mob-add {
    position: relative;
    z-index: 4;   /* 가이드 바깥을 어둡게 덮는 막(z-index 2)보다 위에 */
    flex-shrink: 0;
    width: 44px; height: 44px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--cs-white);
    color: var(--cs-purple);
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s;
  }
  /* 표준 체크 아이콘 크기(front-uiux §17: Mobile 22×15 → PC 18×12) */
  .mv-mob-add svg { width: 22px; height: 15px; }
  @media (min-width: 768px) { .mv-mob-add svg { width: 18px; height: 12px; } }
  .mv-mob-add:hover:not(:disabled) { background: var(--cs-lilac); }
  .mv-mob-add:disabled { opacity: 0.5; cursor: not-allowed; }

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
    padding: 8px 16.8px 10px;   /* 좌우 14px의 120%(20% 추가) */
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg, 30px);
  }
  /* 모바일 도구줄: 흰 배경 없이 두 버튼만 */
  .mv-mob-bar {
    width: max-content;
    padding: 0;
    overflow: visible;
    background: transparent;
  }
  .mv-row.mv-mob-tools {   /* .mv-row(gap 4px)가 뒤에 선언돼 있어 클래스 2개로 우선순위를 올린다 */
    position: relative;
    z-index: 4;   /* 가이드 바깥을 어둡게 덮는 막(z-index 2)보다 위에 — 밝은 원형 배경 유지 */
    flex-shrink: 0;
    gap: 12px;   /* 기본 4px의 3배(+200%) */
  }
  .mv-mob-icon {
    flex-shrink: 0;
    width: 31px; height: 31px;   /* 44px의 70%(30% 축소) */
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s;
  }
  .mv-mob-icon svg { width: 16.8px; height: 16.8px; }   /* 14px의 120%(20% 확대) */
  .mv-mob-icon:hover { background: var(--cs-lilac); }   /* 두 버튼 간격: 기본 4px의 3배(+200%) */
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
  .mv-swatches { display: grid; grid-template-columns: repeat(13, 1fr); gap: 6px; }
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
