<script lang="ts">
  /**
   * RichContentEditor — 워드프로세서형 단일 문서 콘텐츠 에디터 (2026-10-05 신규, 공용)
   *
   * - 문서 1개(TipTap)에서 텍스트·이미지 묶음·동영상·구분선·표를 커서 위치 그대로 편집한다.
   * - 저장 형식은 기존 ContentBlock[] 그대로(변환은 contentBlocksTiptap.ts). 변환 불가 블록은 원본 보존 노드로 담는다.
   * - 선택 유지: 툴바 영역 mousedown/pointerdown preventDefault + 모든 명령 editor.chain().focus() 경유.
   * - 사용처: 1단계 크레이지로그 작성(/crazylog/[slug]). CMS 상품설명·구독은 4단계에서 교체(별도 승인).
   * ⛔ 브라우저 전용: 에디터는 onMount 이후에 동적 import로 생성한다(SSR 안전·번들 지연 로딩).
   */
  import { onMount } from 'svelte'
  import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core'
  import { NodeSelection } from '@tiptap/pm/state'
  import type { ContentBlock, ImageAlign, ImageItem, ImageLayout } from '$lib/types/content-editor'
  import { extractYoutubeId, IMAGE_WIDTH_MAX, IMAGE_WIDTH_MIN, normalizeImageAlign, normalizeImageWidth } from '$lib/types/content-editor'
  import { resizeProductImage } from '$lib/utils/imageResize'
  import { validateUploadFile, validateUploadFileSize } from '$lib/utils/fileValidation'
  import { csToast } from '$lib/utils/toast'
  import { buildSandboxedPreviewDoc } from '$lib/utils/previewSanitize'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import KeywordTagInput from './KeywordTagInput.svelte'
  import '$lib/styles/rich-content.css'

  interface Props {
    blocks: ContentBlock[]
    keywords: string[]
    /** 이미지 업로드 prefix(/api/cms/upload의 product_id). 크레이지로그는 'log/<uuid>' */
    uploadPrefix?: string
    /** 'user' = 사용자 화면(front 토큰), 'cms' = 관리자 화면(4단계에서 사용) */
    variant?: 'user' | 'cms'
    placeholder?: string
    /** 키워드 입력란 노출 여부 */
    showKeywords?: boolean
    /** 읽기 전용(도구·편집 불가, 내용만 보여준다) — 재고 단위 상품처럼 수정 권한이 없는 화면용 */
    readonly?: boolean
    /** 내용이 바뀔 때(디바운스 후 blocks 갱신 시) 호출 */
    onchange?: () => void
  }

  let {
    blocks = $bindable([]),
    keywords = $bindable([]),
    uploadPrefix = 'content/' + (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'tmp'),
    variant = 'user',
    placeholder = '내용을 입력하세요',
    showKeywords = true,
    readonly = false,
    onchange,
  }: Props = $props()

  // ── 상태 ────────────────────────────────────────────
  let host = $state<HTMLDivElement | null>(null)
  let editor = $state.raw<TiptapEditor | null>(null)
  let conv = $state.raw<typeof import('$lib/utils/contentBlocksTiptap') | null>(null)
  let tick = $state(0) // 트랜잭션마다 증가 — 툴바 활성 상태 갱신용
  let focused = $state(false)
  let isMobile = $state(false)
  let kb = $state(0)
  let sheet = $state<string | null>(null)
  let sheetX = $state(0)
  let sheetY = $state(0)
  let uploading = $state(0)
  let activeImgIdx = $state<number | null>(null)
  let activeImgPos = $state<number | null>(null) // activeImgIdx가 속한 묶음 위치(다른 묶음으로 옮겨가면 무효)
  let altText = $state('')
  let lastScrollKey = ''
  let dirty = false
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let blurTimer: ReturnType<typeof setTimeout> | undefined
  let toolbarWrap = $state<HTMLDivElement | null>(null)
  let canvasWrap = $state<HTMLDivElement | null>(null)
  let ctxStyle = $state('top: 0px; left: 0px')
  let photoInput: HTMLInputElement
  let attachInput: HTMLInputElement
  let addToGroupInput: HTMLInputElement

  // 시트 입력값
  let linkUrl = $state('')
  let videoUrl = $state('')
  let videoErr = $state('')
  let tableRows = $state(3)
  let tableCols = $state(3)

  // 원본 보존 블록 다이얼로그
  interface LegacyDialog {
    /** 방금 '+ HTML'로 만든 빈 블록 — 취소하면 빈 카드를 남기지 않고 지운다 */
    isNew?: boolean
    mode: 'edit' | 'convert'
    html: string
    from: number
    nodeSize: number
    attrs: Record<string, unknown>
    preview?: { html: string; textMatches: boolean; doc: JSONContent }
    ack: boolean
  }
  let legacyDlg = $state<LegacyDialog | null>(null)

  const FONTS = [
    { label: '기본 서체', value: '' },
    { label: 'Noto Sans KR', value: "'Noto Sans KR', sans-serif" },
    { label: '맑은 고딕', value: "'Malgun Gothic', '맑은 고딕', sans-serif" },
    { label: '나눔고딕', value: "'NanumGothic', '나눔고딕', sans-serif" },
    { label: '나눔명조', value: "'NanumMyeongjo', '나눔명조', serif" },
    { label: '굴림', value: "'Gulim', '굴림', sans-serif" },
    { label: 'Georgia', value: 'Georgia, serif' },
  ]
  const SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 28, 32]
  const DEFAULT_SIZE = 16
  const COLORS = [
    '#000000', '#444444', '#777777', '#aaaaaa', '#ffffff',
    '#cf0000', '#ff3535', '#ff4500', '#ff9800', '#ffc107',
    '#2e7d32', '#4caf50', '#00897b', '#0288d1', '#1565c0',
    '#3b2f8a', '#553fe0', '#8e24aa', '#d81b60', '#795548',
  ]
  const EMOJI_LIST = [
    '😀', '😂', '🥰', '😎', '🤔', '😭', '😡', '🥳',
    '👍', '👎', '👏', '🙏', '💪', '🤝', '✌️', '👋',
    '❤️', '💔', '💯', '🔥', '⭐', '✨', '🎉', '🎊',
    '📷', '🎬', '🎵', '🎮', '📚', '✏️', '💡', '🔑',
    '🌸', '🌊', '⛅', '🌙', '🌈', '🍕', '☕', '🍀',
  ]

  // ── 외부 제어 (bind:this) ───────────────────────────
  /** 저장 직전 호출: 대기 중인 변경을 즉시 반영하고 직렬화 누락 여부를 점검한다. */
  export function flush(): { blocks: ContentBlock[]; ok: boolean } {
    if (!editor || !conv) return { blocks, ok: true }
    if (!dirty) return { blocks, ok: true } // 무변경 저장 = 원본 그대로
    clearTimeout(syncTimer)
    syncPending = false // 저장이 최신 문서를 직접 직렬화하므로 정리 단계에서 같은 내용을 다시 덮어쓰지 않는다
    const v = conv.verifySerialization(editor.getJSON())
    blocks = v.blocks
    return { blocks: v.blocks, ok: v.ok }
  }

  /** 임시저장 복원 등으로 문서를 통째로 바꾼다(변경으로 간주). */
  export function setBlocks(next: ContentBlock[]): boolean {
    if (!editor || !conv) return false
    editor.commands.setContent(conv.blocksToDoc(next), { emitUpdate: false })
    dirty = true
    blocks = next.length > 0 ? next : [{ type: 'text', html: '' }]
    onchange?.()
    return true
  }

  export function isDirty(): boolean {
    return dirty
  }

  // ── 동기화 ──────────────────────────────────────────
  let syncPending = false // 디바운스 대기 중인 편집이 있는지 — 편집기가 사라질 때(탭 전환 등) 마지막 입력 유실 방지
  function scheduleSync() {
    dirty = true
    syncPending = true
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncPending = false
      if (!editor || !conv) return
      blocks = conv.docToBlocks(editor.getJSON())
      onchange?.()
    }, 250)
  }

  // ── 붙여넣기 정화 ───────────────────────────────────
  function cleanPastedHtml(html: string): string {
    return html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<(meta|link)\b[^>]*>/gi, '')
      .replace(/font-family\s*:[^;"]*;?/gi, '')
      .replace(/mso-[^;"]*;?/gi, '')
  }

  // ── 이미지 업로드 ───────────────────────────────────
  async function uploadOne(file: File): Promise<ImageItem | null> {
    if (!file.type.startsWith('image/')) {
      csToast.error('이미지 파일만 넣을 수 있어요.')
      return null
    }
    const typeOk = validateUploadFile(file)
    if (!typeOk.ok) {
      csToast.error(typeOk.error ?? '지원하지 않는 형식이에요.')
      return null
    }
    const sizeOk = validateUploadFileSize(file)
    if (!sizeOk.ok) {
      csToast.error(sizeOk.error ?? '파일이 너무 커요.')
      return null
    }
    try {
      const { thumb, large } = await resizeProductImage(file)
      const fd = new FormData()
      fd.append('product_id', uploadPrefix)
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))
      const res = await fetch('/api/cms/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string }
        csToast.error(err.message ?? '사진 업로드에 실패했어요.')
        return null
      }
      const json = (await res.json()) as { largeUrl: string }
      return { url: json.largeUrl, alt: file.name.replace(/\.[^.]+$/, '') }
    } catch (e) {
      csToast.error(e instanceof Error ? e.message : '사진 업로드에 실패했어요.')
      return null
    }
  }

  const MAX_GROUP_IMAGES = 30
  const UPLOAD_CONCURRENCY = 3

  /** 동시에 최대 3장씩 올리되 결과 순서는 선택한 순서를 유지한다. 일부 실패는 요약으로 알린다. */
  async function uploadMany(files: File[]): Promise<ImageItem[]> {
    uploading += files.length
    const results: (ImageItem | null)[] = new Array(files.length).fill(null)
    let next = 0
    const worker = async () => {
      while (next < files.length) {
        const i = next++
        results[i] = await uploadOne(files[i])
        uploading -= 1
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker))
    const ok = results.filter((r): r is ImageItem => r !== null)
    if (files.length > 1 && ok.length < files.length) csToast.warning(`${files.length - ok.length}장은 올리지 못했어요.`)
    return ok
  }

  /**
   * 블록 삽입. 사진 묶음·동영상처럼 "노드가 선택된" 상태에서 insertContent를 쓰면 선택된 노드가 덮어써져 사라진다
   * (재현 확인) → 선택된 노드 바로 뒤에 넣는다. pos를 주면 그 위치에 넣는다.
   */
  function insertMedia(content: JSONContent | JSONContent[], pos?: number) {
    if (!editor) return
    const chain = editor.chain().focus()
    if (pos !== undefined) {
      chain.insertContentAt(pos, content).run()
      return
    }
    const sel = editor.state.selection
    if (sel instanceof NodeSelection) chain.insertContentAt(sel.to, content).run()
    else chain.insertContent(content).run()
  }

  /** 노드 선택 상태에서 표·이모지·구분선 같은 삽입이 노드를 덮어쓰지 않도록, 선택을 노드 뒤로 옮긴다. */
  function leaveNodeSelection() {
    if (!editor) return
    const sel = editor.state.selection
    if (sel instanceof NodeSelection) editor.commands.setTextSelection(sel.to)
  }

  /** 사진 삽입: group=한 묶음(레이아웃은 도구줄에서 변경) / each=사진마다 별도 묶음. pos 생략 시 현재 커서 위치. */
  async function insertImages(files: File[], mode: 'group' | 'each', pos?: number) {
    if (!editor || files.length === 0) return
    let list = files
    if (mode === 'group' && list.length > MAX_GROUP_IMAGES) {
      csToast.warning(`한 묶음에는 사진 ${MAX_GROUP_IMAGES}장까지 넣을 수 있어요. 앞의 ${MAX_GROUP_IMAGES}장만 올립니다.`)
      list = list.slice(0, MAX_GROUP_IMAGES)
    }
    const items = await uploadMany(list)
    if (!editor || items.length === 0) return
    const nodes =
      mode === 'each'
        ? items.map((img) => ({ type: 'imageGroup', attrs: { layout: 'individual', images: [img] } }))
        : [{ type: 'imageGroup', attrs: { layout: 'individual', images: items } }]
    insertMedia(nodes, pos)
  }

  function pickedFiles(e: Event): File[] {
    const input = e.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    return files
  }

  // ── 이미지 묶음 편집 ────────────────────────────────
  function selectedNode(): { node: import('@tiptap/pm/model').Node; pos: number } | null {
    if (!editor) return null
    const s = editor.state.selection
    return s instanceof NodeSelection ? { node: s.node, pos: s.from } : null
  }

  /** 커서·셀 선택이 표 안에 있는지 (CellSelection 포함) */
  function inTable(): boolean {
    if (!editor) return false
    const anchorPos = editor.state.selection.$anchor
    for (let d = anchorPos.depth; d > 0; d--) if (anchorPos.node(d).type.name === 'table') return true
    return false
  }

  function canDo(cmd: 'mergeCells' | 'splitCell'): boolean {
    void tick
    return editor ? editor.can()[cmd]() : false
  }

  const ctxKind = $derived.by(() => {
    void tick
    if (!editor) return null
    const sel = selectedNode()
    if (sel?.node.type.name === 'imageGroup') return 'image'
    if (sel?.node.type.name === 'legacyHtml') return 'legacy'
    if (sel?.node.type.name === 'youtubeEmbed') return 'youtube'
    if (inTable()) return 'table'
    return null
  })

  const groupAttrs = $derived.by(() => {
    void tick
    const sel = selectedNode()
    if (!sel || sel.node.type.name !== 'imageGroup') return null
    return {
      layout: sel.node.attrs.layout as ImageLayout,
      images: (sel.node.attrs.images as ImageItem[]) ?? [],
      width: normalizeImageWidth(sel.node.attrs.width),
      align: normalizeImageAlign(sel.node.attrs.align),
    }
  })

  function curIdx(): number {
    const n = groupAttrs?.images.length ?? 0
    const sel = selectedNode()
    const valid = activeImgIdx !== null && sel !== null && activeImgPos === sel.pos && activeImgIdx < n
    return valid ? (activeImgIdx as number) : 0
  }

  function updateGroup(next: { layout?: ImageLayout; images?: ImageItem[]; width?: number; align?: ImageAlign }) {
    if (!editor || !groupAttrs) return
    if (next.images && next.images.length === 0) {
      editor.chain().focus().deleteSelection().run()
      return
    }
    editor.chain().focus().updateAttributes('imageGroup', next).run()
  }

  function setLayout(layout: ImageLayout) {
    updateGroup({ layout })
  }

  /** 대표 이미지는 문서 전체에서 1장만 — 모든 묶음의 isHead를 지우고 대상만 지정(null이면 전부 해제). */
  function setHead(idx: number | null) {
    if (!editor || !groupAttrs) return
    const sel = selectedNode()
    if (!sel) return
    const { state, view } = editor
    const tr = state.tr
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'imageGroup') return true
      const imgs = (node.attrs.images as ImageItem[]).map((img, i) => {
        const { isHead: _drop, ...rest } = img
        return pos === sel.pos && idx !== null && i === idx ? { ...rest, isHead: true } : rest
      })
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, images: imgs })
      return false
    })
    view.dispatch(tr)
    editor.commands.focus()
  }

  function moveImage(dir: -1 | 1) {
    if (!groupAttrs) return
    const i = curIdx()
    const j = i + dir
    if (j < 0 || j >= groupAttrs.images.length) return
    const imgs = [...groupAttrs.images]
    ;[imgs[i], imgs[j]] = [imgs[j], imgs[i]]
    activeImgIdx = j
    updateGroup({ images: imgs })
  }

  function removeImage() {
    if (!groupAttrs) return
    const i = curIdx()
    activeImgIdx = null
    updateGroup({ images: groupAttrs.images.filter((_, k) => k !== i) })
  }

  /** 바로 다음 블록이 사진 묶음이면 그 정보를, 아니면 null */
  function nextGroupInfo(): { pos: number; node: import('@tiptap/pm/model').Node } | null {
    const sel = selectedNode()
    if (!editor || !sel || sel.node.type.name !== 'imageGroup') return null
    const end = sel.pos + sel.node.nodeSize
    const after = editor.state.doc.resolve(end).nodeAfter
    return after && after.type.name === 'imageGroup' ? { pos: end, node: after } : null
  }

  function canMergeNext(): boolean {
    void tick
    return nextGroupInfo() !== null
  }

  /** 묶음을 사진 한 장씩 별도 묶음(개별사진)으로 나눈다. */
  function splitGroup() {
    const sel = selectedNode()
    if (!editor || !sel || !groupAttrs || groupAttrs.images.length < 2) return
    const nodes = groupAttrs.images.map((img) => ({ type: 'imageGroup', attrs: { layout: 'individual', images: [img], width: groupAttrs.width, align: groupAttrs.align } }))
    editor.chain().focus().insertContentAt({ from: sel.pos, to: sel.pos + sel.node.nodeSize }, nodes).run()
  }

  /** 바로 다음 사진 묶음과 하나로 합친다(배치는 앞 묶음 기준, 대표 이미지는 문서에 1장만 유지). */
  function mergeNext() {
    const sel = selectedNode()
    const nx = nextGroupInfo()
    if (!editor || !sel || !nx || !groupAttrs) return
    const second = (nx.node.attrs.images as ImageItem[]).map((img) => {
      if (!groupAttrs.images.some((i) => i.isHead)) return img
      const { isHead: _drop, ...rest } = img
      return rest
    })
    const images = [...groupAttrs.images, ...second]
    // 상한을 넘기면 일부를 자르지 않고 합치기 자체를 거부한다(잘려 나가는 사진·대표 이미지 유실 방지)
    if (images.length > MAX_GROUP_IMAGES) {
      csToast.warning(`합치면 사진이 ${MAX_GROUP_IMAGES}장을 넘어 합칠 수 없어요.`)
      return
    }
    editor
      .chain()
      .focus()
      .insertContentAt({ from: sel.pos, to: nx.pos + nx.node.nodeSize }, { type: 'imageGroup', attrs: { layout: groupAttrs.layout, images, width: groupAttrs.width, align: groupAttrs.align } })
      .run()
  }

  const WIDTH_PRESETS = [25, 33, 50, 75, 100]
  let imgWidthLive = $state<number | null>(null) // 슬라이더를 끄는 동안의 미리 보기 값(놓으면 적용)

  function setImgWidth(w: number) {
    imgWidthLive = null
    updateGroup({ width: normalizeImageWidth(w) })
  }

  function setImgAlign(a: ImageAlign) {
    updateGroup({ align: a })
  }

  function applyAlt() {
    if (!groupAttrs) return
    const i = curIdx()
    const imgs = groupAttrs.images.map((img, k) => (k === i ? { ...img, alt: altText.trim() } : img))
    updateGroup({ images: imgs })
    sheet = null
  }

  async function addToGroup(files: File[]) {
    if (!groupAttrs || files.length === 0) return
    const room = MAX_GROUP_IMAGES - groupAttrs.images.length
    if (room <= 0) {
      csToast.warning(`한 묶음에는 사진 ${MAX_GROUP_IMAGES}장까지 넣을 수 있어요.`)
      return
    }
    if (files.length > room) csToast.warning(`${room}장만 더 넣을 수 있어요. 앞의 ${room}장만 올립니다.`)
    const items = await uploadMany(files.slice(0, room))
    if (items.length === 0) return
    updateGroup({ images: [...groupAttrs.images, ...items] })
  }

  // ── 사진 끌어서 순서 변경 ────────────────────────────
  // 이미 선택된 묶음의 사진을 끌면 순서가 바뀐다(처음 클릭은 선택만). 노드 자체 드래그(PM)와 겹치지 않게 pointerdown을 가로챈다.
  interface ImgDrag {
    /** 끌기를 시작한 묶음 노드(위치는 문서가 바뀌면 밀리므로 노드 동일성으로 비교한다) */
    node: import('@tiptap/pm/model').Node
    from: number
    to: number
    startX: number
    startY: number
    moved: boolean
    figs: HTMLElement[]
    strip: HTMLElement | null
  }
  let imgDrag: ImgDrag | null = null
  const DRAG_THRESHOLD = 6

  function clearDragMarks() {
    host?.querySelectorAll('.rc-fig-dragging, .rc-fig-drop').forEach((el) => el.classList.remove('rc-fig-dragging', 'rc-fig-drop'))
  }

  function nearestFigIndex(d: ImgDrag, x: number, y: number): number {
    let best = d.to
    let bestDist = Infinity
    d.figs.forEach((fig, i) => {
      const r = fig.getBoundingClientRect()
      const dist = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2))
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    return best
  }

  function onImgDragMove(e: PointerEvent) {
    const d = imgDrag
    if (!d) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return
      d.moved = true
      d.figs[d.from]?.classList.add('rc-fig-dragging')
    }
    // 슬라이드 가로 스트립: 가장자리에 가까우면 자동 스크롤
    if (d.strip) {
      const r = d.strip.getBoundingClientRect()
      if (e.clientX < r.left + 40) d.strip.scrollLeft -= 14
      else if (e.clientX > r.right - 40) d.strip.scrollLeft += 14
    }
    const to = nearestFigIndex(d, e.clientX, e.clientY)
    if (to !== d.to || d.moved) {
      d.figs.forEach((f) => f.classList.remove('rc-fig-drop'))
      d.to = to
      if (to !== d.from) d.figs[to]?.classList.add('rc-fig-drop')
    }
  }

  function endImgDrag(commit: boolean) {
    const d = imgDrag
    imgDrag = null
    window.removeEventListener('pointermove', onImgDragMove)
    window.removeEventListener('pointerup', onImgDragUp)
    window.removeEventListener('pointercancel', onImgDragCancel)
    clearDragMarks()
    if (!d || !commit || !d.moved || d.to === d.from || !editor || readonly) return
    // 끄는 사이 문서가 바뀔 수 있다(다른 업로드 완료 등) → 위치·선택에 의존하지 않고, 시작한 묶음 노드를 문서에서 다시 찾는다.
    // 노드가 그대로면 위치가 밀렸어도 정상 반영하고, 그 묶음이 사라졌거나 내용이 바뀌었으면 반영하지 않는다.
    let pos = -1
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n === d.node) pos = p
      return pos < 0
    })
    if (pos < 0) return
    const imgs = [...(d.node.attrs.images as ImageItem[])]
    const [moved] = imgs.splice(d.from, 1)
    imgs.splice(d.to, 0, moved)
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...d.node.attrs, images: imgs }))
    activeImgIdx = d.to
    activeImgPos = pos
  }
  function onImgDragUp() {
    endImgDrag(true)
  }
  function onImgDragCancel() {
    endImgDrag(false)
  }

  function onHostPointerDown(e: PointerEvent) {
    if (readonly || !editor || e.button !== 0 || imgDrag) return // 읽기 전용에서는 묶음 안 사진 순서 끌기도 막는다
    const fig = (e.target as HTMLElement | null)?.closest<HTMLElement>('figure.rc-fig')
    const sel = selectedNode()
    if (!fig || !sel || sel.node.type.name !== 'imageGroup') return
    const dom = editor.view.nodeDOM(sel.pos)
    if (!(dom instanceof HTMLElement) || !dom.contains(fig)) return
    if ((sel.node.attrs.images as ImageItem[]).length < 2) return
    e.preventDefault() // PM의 노드 통째 드래그가 시작되지 않게(이미 선택된 묶음 안에서만 가로챔)
    const idx = Number(fig.dataset.idx)
    activeImgIdx = idx
    activeImgPos = sel.pos
    imgDrag = {
      node: sel.node,
      from: idx,
      to: idx,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      figs: Array.from(dom.querySelectorAll<HTMLElement>('figure.rc-fig')),
      strip: sel.node.attrs.layout === 'slide' ? dom : null,
    }
    window.addEventListener('pointermove', onImgDragMove)
    window.addEventListener('pointerup', onImgDragUp)
    window.addEventListener('pointercancel', onImgDragCancel)
  }

  // ── 원본 보존 블록 ──────────────────────────────────
  function openLegacy(mode: 'edit' | 'convert') {
    const sel = selectedNode()
    if (!sel || sel.node.type.name !== 'legacyHtml' || !conv) return
    const html = String(sel.node.attrs.html ?? '')
    legacyDlg = {
      mode,
      html,
      from: sel.pos,
      nodeSize: sel.node.nodeSize,
      attrs: { ...sel.node.attrs },
      preview: mode === 'convert' ? conv.previewConversion(html) : undefined,
      ack: false,
    }
  }

  /** 원본 HTML 블록 새로 추가(Gemini·imweb 등에서 복사한 HTML을 서식 변환 없이 그대로 보존해 넣는 용도) */
  function addHtmlBlock() {
    if (!editor) return
    const id = `lg-new-${Date.now()}`
    insertMedia({ type: 'legacyHtml', attrs: { html: '', kind: 'html', id } })
    let pos = -1
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === 'legacyHtml' && n.attrs.id === id) pos = p
      return pos < 0
    })
    if (pos < 0) return
    editor.commands.setNodeSelection(pos)
    const node = editor.state.doc.nodeAt(pos)
    if (!node) return
    legacyDlg = { isNew: true, mode: 'edit', html: '', from: pos, nodeSize: node.nodeSize, attrs: { ...node.attrs }, ack: false }
  }

  /** 다이얼로그 닫기 — 새로 만든 빈 HTML 블록이면 카드째 지운다 */
  function closeLegacyDialog() {
    const d = legacyDlg
    legacyDlg = null
    if (d?.isNew && editor) {
      const node = editor.state.doc.nodeAt(d.from)
      if (node && node.type.name === 'legacyHtml' && !String(node.attrs.html ?? '').trim()) {
        editor.chain().focus().deleteRange({ from: d.from, to: d.from + node.nodeSize }).run()
      }
    }
  }

  function applyLegacyEdit() {
    if (!editor || !legacyDlg) return
    const { from, attrs, html } = legacyDlg
    if (legacyDlg.isNew && !html.trim()) {
      closeLegacyDialog()
      return
    }
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setNodeMarkup(from, undefined, { ...attrs, html })
        return true
      })
      .run()
    legacyDlg = null
  }

  function applyLegacyConvert() {
    if (!editor || !legacyDlg?.preview) return
    const { from, nodeSize, preview } = legacyDlg
    if (!preview.textMatches && !legacyDlg.ack) return
    editor.chain().focus().insertContentAt({ from, to: from + nodeSize }, preview.doc.content ?? []).run()
    legacyDlg = null
  }

  // ── 툴바 상태·명령 ──────────────────────────────────
  function act(name: string, attrs?: Record<string, unknown>): boolean {
    void tick
    return editor?.isActive(name, attrs) ?? false
  }

  function curSize(): number {
    void tick
    const v = editor?.getAttributes('textStyle').fontSize as string | undefined
    const n = v ? parseInt(v, 10) : NaN
    return Number.isFinite(n) ? n : DEFAULT_SIZE
  }

  function curFamilyLabel(): string {
    void tick
    const v = (editor?.getAttributes('textStyle').fontFamily as string | undefined) ?? ''
    return FONTS.find((f) => f.value === v)?.label ?? (v ? '사용자 서체' : '기본 서체')
  }

  function curParaLabel(): string {
    void tick
    if (!editor) return '본문'
    if (editor.isActive('heading', { level: 1 })) return '제목1'
    if (editor.isActive('heading', { level: 2 })) return '제목2'
    if (editor.isActive('heading', { level: 3 })) return '제목3'
    if (editor.isActive('blockquote')) return '인용'
    return '본문'
  }

  function applySize(px: number) {
    const v = Math.max(8, Math.min(72, Math.round(px)))
    editor?.chain().focus().setFontSize(`${v}px`).run()
  }

  function applyFont(value: string) {
    if (!editor) return
    if (value) editor.chain().focus().setFontFamily(value).run()
    else editor.chain().focus().unsetFontFamily().run()
    sheet = null
  }

  function applyColor(c: string | null, kind: 'color' | 'bg') {
    if (!editor) return
    const chain = editor.chain().focus()
    if (kind === 'color') (c ? chain.setColor(c) : chain.unsetColor()).run()
    else (c ? chain.setBackgroundColor(c) : chain.unsetBackgroundColor()).run()
    sheet = null
  }

  function setPara(kind: 'p' | 'h2' | 'h3' | 'quote') {
    if (!editor) return
    const c = editor.chain().focus()
    if (kind === 'p') {
      if (editor.isActive('blockquote')) c.lift('blockquote').setParagraph().run()
      else c.setParagraph().run()
    } else if (kind === 'quote') c.toggleBlockquote().run()
    else c.toggleHeading({ level: kind === 'h2' ? 2 : 3 }).run()
    sheet = null
  }

  function indent(dir: 1 | -1) {
    if (!editor) return
    const c = editor.chain().focus()
    if (editor.isActive('listItem')) (dir === 1 ? c.sinkListItem('listItem') : c.liftListItem('listItem')).run()
    else (dir === 1 ? c.indentBlock() : c.outdentBlock()).run()
  }

  function clearFormat() {
    editor?.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run()
    sheet = null
  }

  function normalizeUrl(raw: string): string | null {
    const v = raw.trim()
    if (!v) return null
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
    return /^(https?:|mailto:|tel:)/i.test(withScheme) ? withScheme : null
  }

  function applyLink() {
    if (!editor) return
    const href = normalizeUrl(linkUrl)
    if (!href) {
      csToast.warning('http://, https://, mailto:, tel: 형식의 주소를 입력해주세요.')
      return
    }
    const empty = editor.state.selection.empty
    if (empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    sheet = null
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run()
    sheet = null
  }

  function applyVideo() {
    if (!editor) return
    const id = extractYoutubeId(videoUrl.trim())
    if (!id) {
      videoErr = '유튜브 주소(youtube.com / youtu.be)를 입력해주세요.'
      return
    }
    insertMedia({ type: 'youtubeEmbed', attrs: { videoId: id, url: videoUrl.trim() } })
    videoUrl = ''
    videoErr = ''
    sheet = null
  }

  function applyTable() {
    const rows = Math.max(1, Math.min(10, Math.round(tableRows) || 3))
    const cols = Math.max(1, Math.min(6, Math.round(tableCols) || 3))
    leaveNodeSelection()
    editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
    sheet = null
  }

  function openSheet(name: string, e?: Event) {
    if (sheet === name) {
      sheet = null
      return
    }
    if (name === 'link' && editor) linkUrl = (editor.getAttributes('link').href as string | undefined) ?? ''
    if (name === 'video') videoErr = ''
    if (name === 'imgsize') imgWidthLive = null
    if (name === 'alt' && groupAttrs) altText = groupAttrs.images[curIdx()]?.alt ?? ''
    if (e) {
      // 눌린 버튼 바로 아래(공간이 없으면 위)에 띄운다 — 툴바가 2줄이어도 첫 줄을 덮지 않는다
      const btn = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const SHEET_W = 260
      const SHEET_H = 340
      sheetX = Math.max(8, Math.min(btn.left, window.innerWidth - SHEET_W - 8))
      sheetY = btn.bottom + 4 + SHEET_H > window.innerHeight ? Math.max(8, btn.top - SHEET_H - 4) : btn.bottom + 4
    }
    sheet = name
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (!sheet) return
    const t = e.target as HTMLElement | null
    if (t?.closest('.rc-sheet, [data-sheet-btn]')) return
    sheet = null
  }

  function onKeyDownWindow(e: KeyboardEvent) {
    if (e.key === 'Escape' && sheet) sheet = null
    if (e.key === 'Escape' && legacyDlg) closeLegacyDialog()
    if (e.key === 'Escape' && imgDrag) endImgDrag(false)
  }

  /** 툴바 클릭이 에디터 포커스·선택을 빼앗지 않게 한다(입력 요소는 제외). */
  function keepSelection(e: Event) {
    const t = e.target as HTMLElement | null
    if (t && t.closest('input, textarea, select')) return
    e.preventDefault()
  }

  // ── 이미지 활성 표시(편집 DOM에 클래스 부여) ─────────
  $effect(() => {
    void tick
    void activeImgIdx
    if (!host) return
    host.querySelectorAll('.rc-fig-active').forEach((el) => el.classList.remove('rc-fig-active'))
    if (ctxKind !== 'image' || !editor) return
    const sel = selectedNode()
    if (!sel) return
    const dom = editor.view.nodeDOM(sel.pos)
    if (dom instanceof HTMLElement) {
      const fig = dom.querySelector<HTMLElement>(`.rc-fig[data-idx="${curIdx()}"]`)
      fig?.classList.add('rc-fig-active')
      // 슬라이드는 가로 스트립이라 앞으로/뒤로로 옮긴 사진이 화면 밖일 수 있다 → 그 사진이 보이게 스크롤(바뀔 때만)
      const key = `${sel.pos}:${curIdx()}`
      if (fig && groupAttrs?.layout === 'slide' && key !== lastScrollKey) fig.scrollIntoView?.({ block: 'nearest', inline: 'center' })
      lastScrollKey = key
    }
  })

  $effect(() => {
    if (ctxKind !== 'image') activeImgIdx = null
  })

  // 선택 도구줄은 편집 영역을 밀어내지 않도록 선택한 항목 근처에 떠 있게 한다(밀리면 표·사진 드래그 선택이 끊긴다).
  $effect(() => {
    void tick
    if (!ctxKind || !editor || !canvasWrap) return
    let anchor: HTMLElement | null = null
    if (ctxKind === 'table') {
      const node = editor.view.domAtPos(editor.state.selection.$anchor.pos).node
      const el = node instanceof HTMLElement ? node : node.parentElement
      anchor = el?.closest<HTMLElement>('.tableWrapper') ?? el?.closest<HTMLElement>('table') ?? null
    } else {
      const sel = selectedNode()
      const dom = sel ? editor.view.nodeDOM(sel.pos) : null
      anchor = dom instanceof HTMLElement ? dom : null
    }
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const w = canvasWrap.getBoundingClientRect()
    const BAR_H = 48
    const above = r.top - w.top - BAR_H - 4
    const top = above >= 0 ? above : r.bottom - w.top + 4
    const left = Math.max(8, r.left - w.left)
    ctxStyle = `top: ${Math.round(top)}px; left: ${Math.round(left)}px`
  })

  // ── 생명주기 ────────────────────────────────────────
  onMount(() => {
    let destroyed = false
    const mq = window.matchMedia('(max-width: 767px)')
    isMobile = mq.matches
    const onMq = (e: MediaQueryListEvent) => (isMobile = e.matches)
    mq.addEventListener('change', onMq)

    const vv = window.visualViewport
    const updateKb = () => {
      if (!vv) return
      kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    }
    vv?.addEventListener('resize', updateKb)
    vv?.addEventListener('scroll', updateKb)

    void (async () => {
      const [{ Editor }, ext, converter] = await Promise.all([
        import('@tiptap/core'),
        import('./extensions'),
        import('$lib/utils/contentBlocksTiptap'),
      ])
      if (destroyed || !host) return
      conv = converter
      editor = new Editor({
        element: host,
        editable: !readonly,
        extensions: [...ext.createRichExtensions(), ...ext.createEditorOnlyExtensions(placeholder)],
        content: converter.blocksToDoc($state.snapshot(blocks) as ContentBlock[]),
        editorProps: {
          attributes: { class: 'rc-canvas rc-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '본문 입력', spellcheck: 'false', autocorrect: 'off' },
          transformPastedHTML: cleanPastedHtml,
          handlePaste: (_view, event) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
            if (files.length === 0) return false
            // 엑셀·워드 복사처럼 텍스트/HTML이 함께 담긴 경우는 기본 붙여넣기를 우선(텍스트 유실 방지)
            if (event.clipboardData?.getData('text/html') || event.clipboardData?.getData('text/plain')) return false
            event.preventDefault()
            void insertImages(files, 'each')
            return true
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false
            const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
            if (files.length === 0) return false
            event.preventDefault()
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
            void insertImages(files, 'each', at?.pos)
            return true
          },
          handleClickOn: (_view, _pos, node, nodePos, event) => {
            if (node.type.name === 'imageGroup') {
              const fig = (event.target as HTMLElement | null)?.closest<HTMLElement>('figure.rc-fig')
              activeImgIdx = fig ? Number(fig.dataset.idx) : 0
              activeImgPos = nodePos
            }
            return false
          },
        },
        onUpdate: () => scheduleSync(),
        onTransaction: () => {
          tick += 1
        },
        onFocus: () => {
          clearTimeout(blurTimer)
          focused = true
          updateKb()
        },
        onBlur: () => {
          clearTimeout(blurTimer)
          blurTimer = setTimeout(() => (focused = false), 150)
        },
      })
      tick += 1
      host.addEventListener('pointerdown', onHostPointerDown)
    })()

    return () => {
      destroyed = true
      clearTimeout(syncTimer)
      // 대기 중인 편집이 있으면 버리지 않고 마지막으로 한 번 반영한다(탭을 바꿔 편집기가 사라져도 입력이 남도록)
      if (syncPending && editor && conv && !readonly) {
        syncPending = false
        blocks = conv.docToBlocks(editor.getJSON())
        onchange?.()
      }
      clearTimeout(blurTimer)
      host?.removeEventListener('pointerdown', onHostPointerDown)
      endImgDrag(false)
      mq.removeEventListener('change', onMq)
      vv?.removeEventListener('resize', updateKb)
      vv?.removeEventListener('scroll', updateKb)
      editor?.destroy()
      editor = null
    }
  })

  // 읽기 전용 전환(prop 변경)을 이미 만들어진 에디터에도 반영
  $effect(() => {
    const ro = readonly
    if (editor && editor.isEditable === ro) editor.setEditable(!ro)
  })

  const showMobileBar = $derived(!readonly && isMobile && (focused || sheet !== null))
  const tableActive = $derived(ctxKind === 'table')
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onKeyDownWindow} onscroll={() => { if (sheet && !isMobile) sheet = null }} />

{#snippet icon(name: string)}
  {#if name === 'alignLeft'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 4h14M2 8h9M2 12h14M2 16h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  {:else if name === 'alignCenter'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 4h14M4.5 8h9M2 12h14M4.5 16h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  {:else if name === 'alignRight'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 4h14M7 8h9M2 12h14M7 16h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  {:else if name === 'alignJustify'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 4h14M2 8h14M2 12h14M2 16h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  {:else if name === 'ul'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="3" cy="5" r="1.2" fill="currentColor"/><circle cx="3" cy="9" r="1.2" fill="currentColor"/><circle cx="3" cy="13" r="1.2" fill="currentColor"/><path d="M7 5h9M7 9h9M7 13h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  {:else if name === 'ol'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><text x="1" y="7" font-size="6" fill="currentColor">1</text><text x="1" y="12" font-size="6" fill="currentColor">2</text><text x="1" y="17" font-size="6" fill="currentColor">3</text><path d="M7 5h9M7 10h9M7 15h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  {:else if name === 'indent'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 3h14M8 7h8M8 11h8M2 15h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M2 7l3 2-3 2z" fill="currentColor"/></svg>
  {:else if name === 'outdent'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 3h14M8 7h8M8 11h8M2 15h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 7L2 9l3 2z" fill="currentColor"/></svg>
  {:else if name === 'photo'}
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="8.5" r="1.5" fill="currentColor"/><path d="M2 14l4-4 3 3 3-3 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  {:else if name === 'video'}
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="4" width="11" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M13 8l5-3v10l-5-3V8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
  {:else if name === 'emoji'}
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><circle cx="7.5" cy="8.5" r="1" fill="currentColor"/><circle cx="12.5" cy="8.5" r="1" fill="currentColor"/><path d="M7 13c.8 1.2 5.2 1.2 6 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  {:else if name === 'table'}
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 8h15M2.5 12h15M8 3.5v13M13 3.5v13" stroke="currentColor" stroke-width="1.2"/></svg>
  {:else if name === 'divider'}
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2 2"/></svg>
  {:else if name === 'attach'}
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M16 8l-7 7a4 4 0 0 1-5.66-5.66l7-7A2.5 2.5 0 0 1 14 5.87L7 12.87A1 1 0 0 1 5.59 11.5L12 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  {:else if name === 'link'}
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M8 12a4 4 0 0 0 5.66 0l2-2a4 4 0 0 0-5.66-5.66L9 5.34" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 8a4 4 0 0 0-5.66 0l-2 2a4 4 0 0 0 5.66 5.66L11 14.66" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  {:else if name === 'undo'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M6 4L3 7l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 7h7a4 4 0 0 1 0 8H7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  {:else if name === 'redo'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M12 4l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7H8a4 4 0 0 0 0 8h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  {:else if name === 'layIndividual'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="3" y="2" width="12" height="6" rx="1.5" fill="currentColor"/><rect x="3" y="10" width="12" height="6" rx="1.5" fill="currentColor"/></svg>
  {:else if name === 'layCollage'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="2" width="6" height="6" rx="1.2" fill="currentColor"/><rect x="10" y="2" width="6" height="6" rx="1.2" fill="currentColor"/><rect x="2" y="10" width="6" height="6" rx="1.2" fill="currentColor"/><rect x="10" y="10" width="6" height="6" rx="1.2" fill="currentColor"/></svg>
  {:else if name === 'laySlide'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="4" y="3" width="10" height="12" rx="1.5" fill="currentColor"/><rect x="0.5" y="5" width="2" height="8" rx="1" fill="currentColor" opacity="0.5"/><rect x="15.5" y="5" width="2" height="8" rx="1" fill="currentColor" opacity="0.5"/></svg>
  {:else if name === 'star'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M9 1.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L1.8 7.1l5-.7L9 1.8z"/></svg>
  {:else if name === 'trash'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 5h12M7 5V3.5h4V5M5 5l.7 9.5h6.6L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  {:else if name === 'plus'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 3.5v11M3.5 9h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
  {:else if name === 'rowAdd'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="2.5" width="14" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M9 10.5v5M6.5 13h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  {:else if name === 'rowDel'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="2.5" width="14" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 13h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  {:else if name === 'colAdd'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.5" y="2" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M13 6.5v5M10.5 9h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  {:else if name === 'colDel'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.5" y="2" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 9h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  {:else if name === 'rowAddBefore'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="10.5" width="14" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M9 2.5v5M6.5 5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  {:else if name === 'colAddBefore'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="10.5" y="2" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M5 6.5v5M2.5 9h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  {:else if name === 'merge'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="14" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 9h3M12.5 9h-3M7 7.5L8.5 9 7 10.5M11 7.5L9.5 9 11 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
  {:else if name === 'split'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="14" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 3.5v11" stroke="currentColor" stroke-width="1.4"/></svg>
  {:else if name === 'headerRow'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2" y="3" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 3h14v4H2z" fill="currentColor"/></svg>
  {:else if name === 'para'}
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
  {:else if name === 'clear'}
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 4h10M9 4l-2 12M6 16h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 12.5l5 5M17.5 12.5l-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  {:else if name === 'imgWidth'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="5" y="4.5" width="8" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 9H4M14 9h2.5M3 7.5L1.5 9 3 10.5M15 7.5L16.5 9 15 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
  {:else if name === 'groupSplit'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.5" y="1.5" width="13" height="5" rx="1.3" fill="currentColor"/><rect x="2.5" y="11.5" width="13" height="5" rx="1.3" fill="currentColor"/><path d="M2 9h14" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 2"/></svg>
  {:else if name === 'groupMerge'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.5" y="1.5" width="13" height="5" rx="1.3" fill="currentColor"/><rect x="2.5" y="11.5" width="13" height="5" rx="1.3" fill="currentColor"/><path d="M9 7.5v3M7.3 9.2L9 10.7l1.7-1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
  {:else if name === 'alt'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.5" y="3.5" width="15" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/><text x="9" y="12" text-anchor="middle" font-size="7" font-weight="900" fill="currentColor">ALT</text></svg>
  {:else if name === 'more'}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="9" r="1.6"/><circle cx="9" cy="9" r="1.6"/><circle cx="14" cy="9" r="1.6"/></svg>
  {/if}
{/snippet}

<div class="rc-root" data-variant={variant} class:rc-mobile={isMobile}>
  <input bind:this={photoInput} type="file" accept="image/png,image/jpeg,image/webp,image/heif,image/heic" multiple hidden onchange={(e) => void insertImages(pickedFiles(e), 'group')} />
  <input bind:this={attachInput} type="file" accept="image/png,image/jpeg,image/webp,image/heif,image/heic" multiple hidden onchange={(e) => void insertImages(pickedFiles(e), 'each')} />
  <input bind:this={addToGroupInput} type="file" accept="image/png,image/jpeg,image/webp,image/heif,image/heic" multiple hidden onchange={(e) => void addToGroup(pickedFiles(e))} />

  <!-- ═════════ PC / 태블릿 툴바 ═════════ -->
  {#if !isMobile && !readonly}
    <div class="rc-toolbar-wrap" bind:this={toolbarWrap} role="toolbar" aria-label="서식 도구" tabindex="-1" onmousedown={keepSelection} onpointerdown={keepSelection}>
      <div class="rc-toolbar rc-toolbar-fmt">
        <button type="button" class="rc-btn" aria-label="실행취소" title="실행취소 (Ctrl+Z)" disabled={!editor || !editor.can().undo()} onclick={() => editor?.chain().focus().undo().run()}>{@render icon('undo')}</button>
        <button type="button" class="rc-btn" aria-label="다시실행" title="다시실행 (Ctrl+Shift+Z)" disabled={!editor || !editor.can().redo()} onclick={() => editor?.chain().focus().redo().run()}>{@render icon('redo')}</button>
        <span class="rc-sep"></span>

        <button type="button" class="rc-btn rc-btn-wide rc-drop" data-sheet-btn aria-label="서체" disabled={!editor} onclick={(e) => openSheet('font', e)}>{curFamilyLabel()}<ChevronIcon size={5} direction="down" color="var(--cs-text-dark)" /></button>
        <div class="rc-size" role="group" aria-label="글자 크기">
          <button type="button" class="rc-btn rc-size-step" aria-label="글자 작게" disabled={!editor} onclick={() => applySize(curSize() - 1)}>−</button>
          <button type="button" class="rc-size-val" data-sheet-btn aria-label="글자 크기 목록" disabled={!editor} onclick={(e) => openSheet('size', e)}>{curSize()}</button>
          <button type="button" class="rc-btn rc-size-step" aria-label="글자 크게" disabled={!editor} onclick={() => applySize(curSize() + 1)}>+</button>
        </div>
        <span class="rc-sep"></span>

        <button type="button" class="rc-btn" data-sheet-btn aria-label="글자색" title="글자색" disabled={!editor} onclick={(e) => openSheet('color', e)}><span class="rc-glyph rc-glyph-color">A</span></button>
        <button type="button" class="rc-btn" data-sheet-btn aria-label="배경색" title="배경색" disabled={!editor} onclick={(e) => openSheet('bg', e)}><span class="rc-glyph rc-glyph-bg">A</span></button>
        <span class="rc-sep"></span>

        <button type="button" class="rc-btn rc-glyph-b" aria-label="굵게" title="굵게 (Ctrl+B)" aria-pressed={act('bold')} class:rc-btn-active={act('bold')} disabled={!editor} onclick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
        <button type="button" class="rc-btn" aria-label="기울임" title="기울임 (Ctrl+I)" aria-pressed={act('italic')} class:rc-btn-active={act('italic')} disabled={!editor} onclick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
        <button type="button" class="rc-btn" aria-label="밑줄" title="밑줄 (Ctrl+U)" aria-pressed={act('underline')} class:rc-btn-active={act('underline')} disabled={!editor} onclick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
        <button type="button" class="rc-btn" aria-label="취소선" title="취소선" aria-pressed={act('strike')} class:rc-btn-active={act('strike')} disabled={!editor} onclick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></button>
        <span class="rc-sep"></span>

        {#each [['left', 'alignLeft', '왼쪽 정렬'], ['center', 'alignCenter', '가운데 정렬'], ['right', 'alignRight', '오른쪽 정렬'], ['justify', 'alignJustify', '양쪽 정렬']] as [v, ic, label] (v)}
          <button type="button" class="rc-btn" aria-label={label} title={label} aria-pressed={act('paragraph', { textAlign: v }) || act('heading', { textAlign: v })} class:rc-btn-active={act('paragraph', { textAlign: v }) || act('heading', { textAlign: v })} disabled={!editor} onclick={() => editor?.chain().focus().setTextAlign(v).run()}>{@render icon(ic)}</button>
        {/each}
        <span class="rc-sep"></span>

        <button type="button" class="rc-btn" aria-label="글머리 목록" title="글머리 목록" aria-pressed={act('bulletList')} class:rc-btn-active={act('bulletList')} disabled={!editor} onclick={() => editor?.chain().focus().toggleBulletList().run()}>{@render icon('ul')}</button>
        <button type="button" class="rc-btn" aria-label="번호 목록" title="번호 목록" aria-pressed={act('orderedList')} class:rc-btn-active={act('orderedList')} disabled={!editor} onclick={() => editor?.chain().focus().toggleOrderedList().run()}>{@render icon('ol')}</button>
        <button type="button" class="rc-btn" aria-label="들여쓰기" title="들여쓰기" disabled={!editor} onclick={() => indent(1)}>{@render icon('indent')}</button>
        <button type="button" class="rc-btn" aria-label="내어쓰기" title="내어쓰기" disabled={!editor} onclick={() => indent(-1)}>{@render icon('outdent')}</button>
        <span class="rc-sep"></span>

        <button type="button" class="rc-btn rc-btn-wide rc-drop" data-sheet-btn aria-label="문단 유형" disabled={!editor} onclick={(e) => openSheet('para', e)}>{curParaLabel()}<ChevronIcon size={5} direction="down" color="var(--cs-text-dark)" /></button>
        <button type="button" class="rc-btn" data-sheet-btn aria-label="링크" title="링크" aria-pressed={act('link')} class:rc-btn-active={act('link')} disabled={!editor} onclick={(e) => openSheet('link', e)}>{@render icon('link')}</button>
        <button type="button" class="rc-btn rc-btn-wide" aria-label="서식 지우기" title="서식 지우기" disabled={!editor} onclick={clearFormat}>서식 지우기</button>
      </div>

      <div class="rc-toolbar rc-toolbar-ins">
        <button type="button" class="rc-btn rc-btn-wide" aria-label="사진" disabled={!editor} onclick={() => photoInput.click()}>{@render icon('photo')}<span>사진</span></button>
        <button type="button" class="rc-btn rc-btn-wide" data-sheet-btn aria-label="동영상" disabled={!editor} onclick={(e) => openSheet('video', e)}>{@render icon('video')}<span>동영상</span></button>
        <button type="button" class="rc-btn rc-btn-wide" data-sheet-btn aria-label="이모지" disabled={!editor} onclick={(e) => openSheet('emoji', e)}>{@render icon('emoji')}<span>이모지</span></button>
        <button type="button" class="rc-btn rc-btn-wide" data-sheet-btn aria-label="표" disabled={!editor} onclick={(e) => openSheet('table', e)}>{@render icon('table')}<span>표</span></button>
        <button type="button" class="rc-btn rc-btn-wide" aria-label="구분선" disabled={!editor} onclick={() => insertMedia({ type: 'horizontalRule' })}>{@render icon('divider')}<span>구분선</span></button>
        <button type="button" class="rc-btn rc-btn-wide" aria-label="첨부" disabled={!editor} onclick={() => attachInput.click()}>{@render icon('attach')}<span>첨부</span></button>
        {#if variant === 'cms'}
          <button type="button" class="rc-btn rc-btn-wide" aria-label="HTML 블록 추가" title="복사한 HTML을 서식 변환 없이 그대로 넣기" disabled={!editor} onclick={addHtmlBlock}><span class="rc-glyph">&lt;/&gt;</span><span>HTML</span></button>
        {/if}
        {#if uploading > 0}<span class="rc-chip" role="status">사진 업로드 중 ({uploading})</span>{/if}
      </div>
    </div>
  {/if}

  <!-- ═════════ 편집 캔버스 ═════════ -->
  <div class="rc-canvas-wrap" bind:this={canvasWrap}>
    <div class="rc-host" bind:this={host}></div>
  {#if ctxKind && !readonly}
    <div class="rc-ctx" style={ctxStyle} role="toolbar" aria-label="선택 항목 도구" tabindex="-1" onmousedown={keepSelection} onpointerdown={keepSelection}>
      {#if ctxKind === 'image' && groupAttrs}
        {@const head = !!groupAttrs.images[curIdx()]?.isHead}
        {#each [['individual', 'layIndividual', '개별사진'], ['collage', 'layCollage', '콜라주'], ['slide', 'laySlide', '슬라이드']] as [v, ic, label] (v)}
          <button type="button" class="rc-ib" class:rc-ib-on={groupAttrs.layout === v} aria-pressed={groupAttrs.layout === v} aria-label={label} title={label} onclick={() => setLayout(v as ImageLayout)}>{@render icon(ic)}</button>
        {/each}
        <span class="rc-sep"></span>
        <button type="button" class="rc-ib" class:rc-ib-on={head} aria-pressed={head} aria-label={head ? '대표 해제' : '대표 지정'} title={head ? '대표 해제' : '대표 지정'} onclick={() => setHead(head ? null : curIdx())}>{@render icon('star')}</button>
        <button type="button" class="rc-ib" aria-label="앞으로" title="앞으로" disabled={curIdx() === 0} onclick={() => moveImage(-1)}><ChevronIcon size={6} direction="left" color="currentColor" /></button>
        <button type="button" class="rc-ib" aria-label="뒤로" title="뒤로" disabled={curIdx() >= groupAttrs.images.length - 1} onclick={() => moveImage(1)}><ChevronIcon size={6} direction="right" color="currentColor" /></button>
        <span class="rc-ctx-count" title="선택한 묶음의 사진을 끌어서 순서를 바꿀 수 있어요">{curIdx() + 1}/{groupAttrs.images.length}</span>
        <button type="button" class="rc-ib" data-sheet-btn aria-label="사진 설명(대체 텍스트)" title="사진 설명(대체 텍스트)" onclick={(e) => openSheet('alt', e)}>{@render icon('alt')}</button>
        <button type="button" class="rc-ib" class:rc-ib-on={groupAttrs.width < 100 || groupAttrs.align !== 'center'} data-sheet-btn aria-label="사진 크기·정렬" title="사진 크기·정렬" onclick={(e) => openSheet('imgsize', e)}>{@render icon('imgWidth')}</button>
        <button type="button" class="rc-ib rc-ib-danger" aria-label="이 사진 삭제" title="이 사진 삭제" onclick={removeImage}>{@render icon('trash')}</button>
        <span class="rc-sep"></span>
        <button type="button" class="rc-ib" aria-label="사진 추가" title="사진 추가" onclick={() => addToGroupInput.click()}>{@render icon('plus')}</button>
        <button type="button" class="rc-ib" aria-label="묶음 나누기" title="사진을 한 장씩 따로 나누기" disabled={groupAttrs.images.length < 2} onclick={splitGroup}>{@render icon('groupSplit')}</button>
        <button type="button" class="rc-ib" aria-label="다음 묶음과 합치기" title="바로 아래 사진 묶음과 합치기" disabled={!canMergeNext()} onclick={mergeNext}>{@render icon('groupMerge')}</button>
        <button type="button" class="rc-ib rc-ib-danger" aria-label="묶음 삭제" title="묶음 전체 삭제" onclick={() => editor?.chain().focus().deleteSelection().run()}>{@render icon('layIndividual')}<span class="rc-ib-x">✕</span></button>
      {:else if ctxKind === 'legacy'}
        <span class="rc-ctx-count">원본 보존</span>
        <button type="button" class="rc-seg-btn" onclick={() => openLegacy('edit')}>원본 HTML 편집</button>
        <button type="button" class="rc-seg-btn" onclick={() => openLegacy('convert')}>새 서식으로 변환</button>
        <button type="button" class="rc-ib rc-ib-danger" aria-label="삭제" title="삭제" onclick={() => editor?.chain().focus().deleteSelection().run()}>{@render icon('trash')}</button>
      {:else if ctxKind === 'youtube'}
        <button type="button" class="rc-ib rc-ib-danger" aria-label="동영상 삭제" title="동영상 삭제" onclick={() => editor?.chain().focus().deleteSelection().run()}>{@render icon('trash')}</button>
      {:else if tableActive}
        <button type="button" class="rc-ib" aria-label="위에 행 추가" title="위에 행 추가" onclick={() => editor?.chain().focus().addRowBefore().run()}>{@render icon('rowAddBefore')}</button>
        <button type="button" class="rc-ib" aria-label="아래에 행 추가" title="아래에 행 추가" onclick={() => editor?.chain().focus().addRowAfter().run()}>{@render icon('rowAdd')}</button>
        <button type="button" class="rc-ib" aria-label="행 삭제" title="행 삭제" onclick={() => editor?.chain().focus().deleteRow().run()}>{@render icon('rowDel')}</button>
        <span class="rc-sep"></span>
        <button type="button" class="rc-ib" aria-label="왼쪽에 열 추가" title="왼쪽에 열 추가" onclick={() => editor?.chain().focus().addColumnBefore().run()}>{@render icon('colAddBefore')}</button>
        <button type="button" class="rc-ib" aria-label="오른쪽에 열 추가" title="오른쪽에 열 추가" onclick={() => editor?.chain().focus().addColumnAfter().run()}>{@render icon('colAdd')}</button>
        <button type="button" class="rc-ib" aria-label="열 삭제" title="열 삭제" onclick={() => editor?.chain().focus().deleteColumn().run()}>{@render icon('colDel')}</button>
        <span class="rc-sep"></span>
        <button type="button" class="rc-ib" aria-label="셀 병합" title="셀 병합 (여러 셀을 드래그로 선택)" disabled={!canDo('mergeCells')} onclick={() => editor?.chain().focus().mergeCells().run()}>{@render icon('merge')}</button>
        <button type="button" class="rc-ib" aria-label="셀 분할" title="셀 분할" disabled={!canDo('splitCell')} onclick={() => editor?.chain().focus().splitCell().run()}>{@render icon('split')}</button>
        <button type="button" class="rc-ib" aria-label="머리글 행 전환" title="머리글 행 켜기/끄기" onclick={() => editor?.chain().focus().toggleHeaderRow().run()}>{@render icon('headerRow')}</button>
        <span class="rc-sep"></span>
        <button type="button" class="rc-ib rc-ib-danger" aria-label="표 삭제" title="표 삭제" onclick={() => editor?.chain().focus().deleteTable().run()}>{@render icon('trash')}</button>
      {/if}
    </div>
  {/if}

    {#if !editor}<p class="rc-loading" role="status">에디터를 불러오는 중…</p>{/if}
  </div>

  {#if showKeywords}
    <KeywordTagInput bind:keywords {readonly} />
  {/if}

  <!-- ═════════ 선택 시트(PC: 툴바 아래 팝오버 / 모바일: 하단 시트) ═════════ -->
  {#if sheet}
    <div
      class="rc-sheet"
      class:rc-sheet-mobile={isMobile}
      style={isMobile ? `bottom: calc(${kb}px + 61px)` : `left: ${sheetX}px; top: ${sheetY}px`}
      role="dialog"
      aria-label="서식 선택"
      tabindex="-1"
      onmousedown={keepSelection}
      onpointerdown={keepSelection}
    >
      <div class="rc-sheet-head">
        <span class="rc-sheet-title">
          {({ font: '서체', size: '글자 크기', color: '글자색', bg: '배경색', para: '문단 유형', align: '정렬', link: '링크', alt: '사진 설명', imgsize: '사진 크기·정렬', video: '동영상', emoji: '이모지', table: '표 삽입', more: '더보기' } as Record<string, string>)[sheet] ?? ''}
        </span>
        <button type="button" class="rc-sheet-close" aria-label="닫기" onclick={() => (sheet = null)}>✕</button>
      </div>

      {#if sheet === 'font'}
        <ul class="rc-list">
          {#each FONTS as f (f.label)}
            <li><button type="button" class="rc-list-item" style={f.value ? `font-family: ${f.value}` : ''} onclick={() => applyFont(f.value)}>{f.label}</button></li>
          {/each}
        </ul>
      {:else if sheet === 'size'}
        <div class="rc-chips">
          {#each SIZE_PRESETS as s (s)}
            <button type="button" class="rc-chipbtn" class:rc-chipbtn-on={curSize() === s} onclick={() => { applySize(s); sheet = null }}>{s}</button>
          {/each}
        </div>
        <div class="rc-size rc-size-sheet" role="group" aria-label="글자 크기 미세 조정">
          <button type="button" class="rc-btn rc-size-step" aria-label="글자 작게" onclick={() => applySize(curSize() - 1)}>−</button>
          <span class="rc-size-num">{curSize()}px</span>
          <button type="button" class="rc-btn rc-size-step" aria-label="글자 크게" onclick={() => applySize(curSize() + 1)}>+</button>
        </div>
      {:else if sheet === 'color' || sheet === 'bg'}
        <div class="rc-palette">
          {#each COLORS as c (c)}
            <button type="button" class="rc-swatch" style={`background:${c}`} aria-label={`${c} 적용`} onclick={() => applyColor(c, sheet === 'color' ? 'color' : 'bg')}></button>
          {/each}
        </div>
        <button type="button" class="rc-chipbtn rc-chipbtn-wide" onclick={() => applyColor(null, sheet === 'color' ? 'color' : 'bg')}>{sheet === 'color' ? '기본 글자색' : '배경색 없음'}</button>
      {:else if sheet === 'para'}
        <ul class="rc-list">
          <li><button type="button" class="rc-list-item" onclick={() => setPara('p')}>본문</button></li>
          <li><button type="button" class="rc-list-item rc-list-h2" onclick={() => setPara('h2')}>제목2</button></li>
          <li><button type="button" class="rc-list-item rc-list-h3" onclick={() => setPara('h3')}>제목3</button></li>
          <li><button type="button" class="rc-list-item" onclick={() => setPara('quote')}>인용</button></li>
        </ul>
      {:else if sheet === 'align'}
        <div class="rc-chips">
          {#each [['left', 'alignLeft', '왼쪽'], ['center', 'alignCenter', '가운데'], ['right', 'alignRight', '오른쪽'], ['justify', 'alignJustify', '양쪽']] as [v, ic, label] (v)}
            <button type="button" class="rc-btn rc-btn-wide" aria-label={label + ' 정렬'} onclick={() => { editor?.chain().focus().setTextAlign(v).run(); sheet = null }}>{@render icon(ic)}<span>{label}</span></button>
          {/each}
        </div>
      {:else if sheet === 'link'}
        <form class="rc-form" onsubmit={(e) => { e.preventDefault(); applyLink() }}>
          <input class="rc-input" type="url" inputmode="url" placeholder="https://..." bind:value={linkUrl} aria-label="링크 주소" />
          <div class="rc-form-row">
            <button type="submit" class="rc-chipbtn rc-chipbtn-on">적용</button>
            {#if act('link')}<button type="button" class="rc-chipbtn" onclick={removeLink}>링크 해제</button>{/if}
          </div>
        </form>
      {:else if sheet === 'imgsize' && groupAttrs}
        <div class="rc-chips" role="group" aria-label="폭 프리셋">
          {#each WIDTH_PRESETS as w (w)}
            <button type="button" class="rc-chipbtn" class:rc-chipbtn-on={groupAttrs.width === w} aria-pressed={groupAttrs.width === w} onclick={() => setImgWidth(w)}>{w === 100 ? '전체' : `${w}%`}</button>
          {/each}
        </div>
        <label class="rc-range">
          <span class="rc-range-cap">폭 {imgWidthLive ?? groupAttrs.width}%</span>
          <input type="range" min={IMAGE_WIDTH_MIN} max={IMAGE_WIDTH_MAX} step="5" value={groupAttrs.width} aria-label="사진 묶음 폭(%)"
            oninput={(e) => (imgWidthLive = Number(e.currentTarget.value))}
            onchange={(e) => setImgWidth(Number(e.currentTarget.value))} />
        </label>
        <div class="rc-chips" role="group" aria-label="정렬">
          {#each [['left', 'alignLeft', '왼쪽'], ['center', 'alignCenter', '가운데'], ['right', 'alignRight', '오른쪽']] as [v, ic, label] (v)}
            <button type="button" class="rc-btn rc-btn-wide" class:rc-btn-active={groupAttrs.align === v} aria-pressed={groupAttrs.align === v} aria-label={`${label} 정렬`} onclick={() => setImgAlign(v as ImageAlign)}>{@render icon(ic)}<span>{label}</span></button>
          {/each}
        </div>
        <p class="rc-hint">폭이 전체(100%)보다 작을 때 정렬이 적용돼요.</p>
      {:else if sheet === 'alt'}
        <form class="rc-form" onsubmit={(e) => { e.preventDefault(); applyAlt() }}>
          <input class="rc-input" type="text" maxlength="120" placeholder="사진을 설명하는 짧은 글(시각장애·검색에 사용)" bind:value={altText} aria-label="사진 설명" />
          <div class="rc-form-row"><button type="submit" class="rc-chipbtn rc-chipbtn-on">적용</button></div>
        </form>
      {:else if sheet === 'video'}
        <form class="rc-form" onsubmit={(e) => { e.preventDefault(); applyVideo() }}>
          <input class="rc-input" type="url" inputmode="url" placeholder="유튜브 주소를 붙여넣어주세요" bind:value={videoUrl} aria-label="유튜브 주소" />
          {#if videoErr}<p class="rc-err" role="alert">{videoErr}</p>{/if}
          <div class="rc-form-row"><button type="submit" class="rc-chipbtn rc-chipbtn-on">삽입</button></div>
        </form>
      {:else if sheet === 'emoji'}
        <div class="rc-emoji">
          {#each EMOJI_LIST as em (em)}
            <button type="button" class="rc-emoji-btn" aria-label={em} onclick={() => { leaveNodeSelection(); editor?.chain().focus().insertContent(em).run(); sheet = null }}>{em}</button>
          {/each}
        </div>
      {:else if sheet === 'table'}
        <form class="rc-form" onsubmit={(e) => { e.preventDefault(); applyTable() }}>
          <label class="rc-label">행 <input class="rc-input rc-input-num" type="number" min="1" max="10" bind:value={tableRows} /></label>
          <label class="rc-label">열 <input class="rc-input rc-input-num" type="number" min="1" max="6" bind:value={tableCols} /></label>
          <div class="rc-form-row"><button type="submit" class="rc-chipbtn rc-chipbtn-on">표 삽입</button></div>
        </form>
      {:else if sheet === 'more'}
        <div class="rc-more-grid">
          <button type="button" class="rc-more-item" onclick={(e) => openSheet('font', e)}><span class="rc-more-ic"><span class="rc-glyph">Aa</span></span><span>서체</span></button>
          <button type="button" class="rc-more-item" onclick={(e) => openSheet('bg', e)}><span class="rc-more-ic"><span class="rc-glyph rc-glyph-bg">A</span></span><span>배경색</span></button>
          <button type="button" class="rc-more-item" class:rc-more-on={act('strike')} onclick={() => { editor?.chain().focus().toggleStrike().run(); sheet = null }}><span class="rc-more-ic"><span class="rc-glyph"><s>S</s></span></span><span>취소선</span></button>
          <button type="button" class="rc-more-item" onclick={() => { indent(1); sheet = null }}><span class="rc-more-ic">{@render icon('indent')}</span><span>들여쓰기</span></button>
          <button type="button" class="rc-more-item" onclick={() => { indent(-1); sheet = null }}><span class="rc-more-ic">{@render icon('outdent')}</span><span>내어쓰기</span></button>
          <button type="button" class="rc-more-item" onclick={(e) => openSheet('para', e)}><span class="rc-more-ic">{@render icon('para')}</span><span>문단 유형</span></button>
          <button type="button" class="rc-more-item" class:rc-more-on={act('link')} onclick={(e) => openSheet('link', e)}><span class="rc-more-ic">{@render icon('link')}</span><span>링크</span></button>
          <button type="button" class="rc-more-item" onclick={(e) => openSheet('table', e)}><span class="rc-more-ic">{@render icon('table')}</span><span>표</span></button>
          <button type="button" class="rc-more-item" onclick={(e) => openSheet('video', e)}><span class="rc-more-ic">{@render icon('video')}</span><span>동영상</span></button>
          <button type="button" class="rc-more-item" onclick={(e) => openSheet('emoji', e)}><span class="rc-more-ic">{@render icon('emoji')}</span><span>이모지</span></button>
          <button type="button" class="rc-more-item" onclick={() => { insertMedia({ type: 'horizontalRule' }); sheet = null }}><span class="rc-more-ic">{@render icon('divider')}</span><span>구분선</span></button>
          <button type="button" class="rc-more-item" onclick={() => { sheet = null; attachInput.click() }}><span class="rc-more-ic">{@render icon('attach')}</span><span>첨부</span></button>
          <button type="button" class="rc-more-item" onclick={clearFormat}><span class="rc-more-ic">{@render icon('clear')}</span><span>서식 지우기</span></button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- ═════════ 모바일: 키보드 위 도킹 툴바 ═════════ -->
  {#if showMobileBar}
    <div class="rc-mbar" style={`bottom: ${kb}px; padding-bottom: ${kb > 0 ? 0 : 'env(safe-area-inset-bottom)'}`} role="toolbar" aria-label="서식 도구" tabindex="-1" onmousedown={keepSelection} onpointerdown={keepSelection}>
      <div class="rc-mbar-scroll">
        <button type="button" class="rc-btn" aria-label="실행취소" disabled={!editor || !editor.can().undo()} onclick={() => editor?.chain().focus().undo().run()}>{@render icon('undo')}</button>
        <button type="button" class="rc-btn" aria-label="다시실행" disabled={!editor || !editor.can().redo()} onclick={() => editor?.chain().focus().redo().run()}>{@render icon('redo')}</button>
        <button type="button" class="rc-btn" aria-label="사진" disabled={!editor} onclick={() => photoInput.click()}>{@render icon('photo')}</button>
        <button type="button" class="rc-btn" aria-label="굵게" aria-pressed={act('bold')} class:rc-btn-active={act('bold')} onclick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
        <button type="button" class="rc-btn" aria-label="기울임" aria-pressed={act('italic')} class:rc-btn-active={act('italic')} onclick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
        <button type="button" class="rc-btn" aria-label="밑줄" aria-pressed={act('underline')} class:rc-btn-active={act('underline')} onclick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
        <button type="button" class="rc-btn" data-sheet-btn aria-label="정렬" onclick={(e) => openSheet('align', e)}>{@render icon('alignLeft')}</button>
        <button type="button" class="rc-btn" aria-label="글머리 목록" aria-pressed={act('bulletList')} class:rc-btn-active={act('bulletList')} onclick={() => editor?.chain().focus().toggleBulletList().run()}>{@render icon('ul')}</button>
        <button type="button" class="rc-btn" aria-label="번호 목록" aria-pressed={act('orderedList')} class:rc-btn-active={act('orderedList')} onclick={() => editor?.chain().focus().toggleOrderedList().run()}>{@render icon('ol')}</button>
        <button type="button" class="rc-btn rc-btn-wide" data-sheet-btn aria-label="글자 크기" onclick={(e) => openSheet('size', e)}>{curSize()}</button>
        <button type="button" class="rc-btn" data-sheet-btn aria-label="글자색" onclick={(e) => openSheet('color', e)}><span class="rc-glyph rc-glyph-color">A</span></button>
        <button type="button" class="rc-btn" data-sheet-btn aria-label="더보기" onclick={(e) => openSheet('more', e)}>{@render icon('more')}</button>
      </div>
      {#if uploading > 0}<span class="rc-chip rc-chip-mobile" role="status">사진 업로드 중 ({uploading})</span>{/if}
    </div>
  {/if}

  <!-- ═════════ 원본 보존 블록 다이얼로그 ═════════ -->
  {#if legacyDlg}
    <div class="rc-modal-back" role="presentation" onclick={closeLegacyDialog}></div>
    <div class="rc-modal" role="dialog" aria-modal="true" aria-label={legacyDlg.mode === 'edit' ? '원본 HTML 편집' : '새 서식으로 변환'}>
      <div class="rc-sheet-head">
        <span class="rc-sheet-title">{legacyDlg.mode === 'edit' ? '원본 HTML 편집' : '새 서식으로 변환'}</span>
        <button type="button" class="rc-sheet-close" aria-label="닫기" onclick={closeLegacyDialog}>✕</button>
      </div>
      {#if legacyDlg.mode === 'edit'}
        <textarea class="rc-textarea" bind:value={legacyDlg.html} aria-label="원본 HTML" spellcheck="false"></textarea>
        <div class="rc-form-row">
          <button type="button" class="rc-chipbtn" onclick={closeLegacyDialog}>취소</button>
          <button type="button" class="rc-chipbtn rc-chipbtn-on" onclick={applyLegacyEdit}>적용</button>
        </div>
      {:else if legacyDlg.preview}
        <div class="rc-compare">
          <div>
            <p class="rc-compare-title">변환 전(원본)</p>
            <iframe class="rc-compare-box" sandbox="" referrerpolicy="no-referrer" title="변환 전(원본) 미리보기" tabindex="-1" srcdoc={buildSandboxedPreviewDoc(legacyDlg.html)}></iframe>
          </div>
          <div>
            <p class="rc-compare-title">변환 후</p>
            <iframe class="rc-compare-box" sandbox="" referrerpolicy="no-referrer" title="변환 후 미리보기" tabindex="-1" srcdoc={buildSandboxedPreviewDoc(legacyDlg.preview.html)}></iframe>
          </div>
        </div>
        {#if legacyDlg.preview.textMatches}
          <p class="rc-ok" role="status">글자가 모두 같아요. 안전하게 변환할 수 있어요.</p>
        {:else}
          <p class="rc-err" role="alert">변환하면 일부 글자·요소가 사라져요. 원본을 그대로 두는 것을 권장해요.</p>
          <label class="rc-label"><input type="checkbox" bind:checked={legacyDlg.ack} /> 내용이 달라지는 것을 확인했어요</label>
        {/if}
        <div class="rc-form-row">
          <button type="button" class="rc-chipbtn" onclick={closeLegacyDialog}>취소</button>
          <button type="button" class="rc-chipbtn rc-chipbtn-on" disabled={!legacyDlg.preview.textMatches && !legacyDlg.ack} onclick={applyLegacyConvert}>변환 적용</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .rc-root {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--cs-surface-gray);
  }

  /* ── 툴바 ── */
  .rc-toolbar-wrap {
    position: sticky;
    top: 0;
    z-index: 6;
    background: var(--cs-surface-gray);
    border-bottom: 1px solid var(--cs-border);
  }
  .rc-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 6px 10px;
  }
  .rc-toolbar-ins { border-top: 1px solid var(--cs-border); }

  .rc-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 36px;
    height: 34px;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .rc-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--cs-purple) 8%, transparent); }
  .rc-btn-active { background: color-mix(in srgb, var(--cs-purple) 14%, transparent); color: var(--cs-purple); }
  .rc-btn:disabled { opacity: 0.4; cursor: default; }
  .rc-btn-wide { padding: 0 10px; }
  .rc-drop { min-width: 92px; justify-content: space-between; }
  .rc-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--cs-border); flex-shrink: 0; }
  .rc-glyph { font-size: 15px; font-weight: 900; line-height: 1; }
  .rc-glyph-color { border-bottom: 3px solid var(--cs-red-badge); padding-bottom: 1px; }
  .rc-glyph-bg { background: var(--cs-purple-op10); padding: 0 3px; }

  .rc-size { display: inline-flex; align-items: center; gap: 0; }
  .rc-size-step { min-width: 28px; padding: 0 4px; font-size: 16px; }
  .rc-size-val {
    min-width: 36px;
    height: 34px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    color: var(--cs-text);
    font: var(--text-pc-body-14);
    cursor: pointer;
  }
  .rc-size-sheet { margin-top: 8px; justify-content: center; gap: 12px; }
  .rc-size-num { min-width: 52px; text-align: center; font: var(--text-pc-body-14); color: var(--cs-text); }

  .rc-chip {
    margin-left: auto;
    padding: 4px 10px;
    border-radius: var(--radius-full);
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }

  /* ── 컨텍스트 도구줄 ── */
  .rc-ctx {
    position: absolute;
    z-index: 8;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 2px;
    max-width: calc(100% - 16px);
    padding: 5px 8px;
    border-radius: var(--radius-md);
    background: var(--cs-purple-op10);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--cs-dark) 16%, transparent);
    overflow-x: auto;
  }
  .rc-ctx > * { flex-shrink: 0; }
  .rc-ctx-count { padding: 0 6px; font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-purple); }
  .rc-ib {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text);
    cursor: pointer;
    transition: background 0.12s;
  }
  .rc-ib:hover:not(:disabled) { background: color-mix(in srgb, var(--cs-purple) 10%, transparent); }
  .rc-ib:disabled { opacity: 0.3; cursor: default; }
  .rc-ib-on { background: var(--cs-purple); color: var(--cs-white); }
  .rc-ib-on:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .rc-ib-danger { color: var(--cs-red-badge); }
  .rc-ib-danger:hover:not(:disabled) { background: var(--cs-red-xlight); }
  .rc-ib-x { position: absolute; right: 4px; bottom: 3px; font-size: 9px; font-weight: 900; line-height: 1; }
  .rc-seg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    padding: 0 12px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text);
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.12s;
  }
  .rc-seg-btn:hover { background: color-mix(in srgb, var(--cs-purple) 10%, transparent); }
  .rc-chipbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    padding: 0 12px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--cs-white);
    color: var(--cs-text);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .rc-chipbtn:hover:not(:disabled) { background: var(--cs-lilac); }
  .rc-chipbtn:disabled { opacity: 0.4; cursor: default; }
  .rc-chipbtn-on { background: var(--cs-purple); color: var(--cs-white); }
  .rc-chipbtn-on:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .rc-chipbtn-wide { width: 100%; margin-top: 8px; }

  /* ── 캔버스 ── */
  .rc-canvas-wrap { position: relative; min-height: 320px; }
  .rc-host { min-height: 320px; }
  .rc-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    font: var(--text-pc-body-14);
    color: var(--cs-text-placeholder);
    pointer-events: none;
  }
  .rc-host :global(.rc-canvas) {
    min-height: 320px;
    padding: 16px 20px 40px;
    outline: none;
    background: var(--cs-surface-gray);
    font: var(--text-m-body-16L);
    line-height: 1.8;
    color: var(--cs-text-dark);
    word-break: break-word;
    /* 상세 화면(.d-article)과 같은 문단 간격: 최상위 요소 사이 16px */
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .rc-host :global(.rc-canvas p) { margin: 0; min-height: 1.8em; }
  .rc-host :global(.rc-canvas > p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--cs-text-placeholder);
    pointer-events: none;
  }
  .rc-host :global(.rc-canvas .ProseMirror-selectednode.rc-images),
  .rc-host :global(.rc-canvas .ProseMirror-selectednode.rc-youtube),
  .rc-host :global(.rc-canvas .ProseMirror-selectednode.rc-legacy) {
    background: var(--cs-purple-op10);
    box-shadow: 0 0 0 6px var(--cs-purple-op10);
    border-radius: var(--radius-md);
  }
  /* 사진 번호(묶음을 선택했을 때만) · 대표 배지 · 선택한 사진 표시 */
  .rc-host :global(.rc-images) { counter-reset: rcfig; }
  .rc-host :global(.rc-fig) { counter-increment: rcfig; }
  .rc-host :global(.rc-images.ProseMirror-selectednode .rc-fig::before) {
    content: counter(rcfig);
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 1;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    background: var(--cs-dark);
    color: var(--cs-white);
    font-size: 11px;
    font-weight: 700;
  }
  .rc-host :global(.rc-fig[data-head='1']::after) {
    content: '대표';
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: var(--cs-red-badge);
    color: var(--cs-white);
    font-size: 11px;
    font-weight: 700;
  }
  .rc-host :global(.rc-fig-active .rc-img) { opacity: 0.78; }
  /* 끌어서 순서 변경: 선택된 묶음에서만 잡기 커서, 터치 스크롤 대신 드래그 */
  .rc-host :global(.rc-images.ProseMirror-selectednode .rc-fig) { cursor: grab; touch-action: none; user-select: none; }
  .rc-host :global(.rc-fig-dragging .rc-img) { opacity: 0.35; }
  .rc-host :global(.rc-fig-drop) { background: var(--cs-purple); border-radius: var(--radius-md); }
  .rc-host :global(.rc-fig-drop .rc-img) { opacity: 0.6; }
  .rc-host :global(.rc-img) { cursor: pointer; }
  .rc-host :global(.rc-legacy) {
    border-radius: var(--radius-md);
    background: var(--cs-white);
    overflow: hidden;
    cursor: pointer;
  }
  .rc-host :global(.rc-legacy-badge) {
    padding: 6px 12px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .rc-host :global(.rc-legacy-body) { position: relative; height: 200px; overflow: hidden; }
  .rc-host :global(.rc-legacy-body iframe) { display: block; width: 100%; height: 100%; border: 0; pointer-events: none; background: var(--cs-white); }
  /* 표: 셀 선택(드래그·Shift+클릭) 표시와 가로 넘침 */
  .rc-host :global(.rc-canvas .tableWrapper) { overflow-x: auto; }
  .rc-host :global(.rc-canvas table) { margin: 0; }
  .rc-host :global(.rc-canvas td),
  .rc-host :global(.rc-canvas th) { position: relative; }
  .rc-host :global(.rc-canvas .selectedCell::after) {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 2;
    background: color-mix(in srgb, var(--cs-purple) 20%, transparent);
    pointer-events: none;
  }
  .rc-host :global(.ProseMirror-gapcursor::after) { border-top-color: var(--cs-purple); }

  /* CMS 변형(cms-uiux.md 토큰 허용 범위): --text-m-* 금지 → 캔버스(고객 화면 본문과 같은 타이포를 보여주는 작성 영역)는 14px/500 고정값 */
  .rc-root[data-variant='cms'] .rc-host :global(.rc-canvas) {
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.8;
  }

  /* ── 선택 시트(PC 팝오버) ── */
  .rc-sheet {
    position: fixed;
    z-index: 20;
    width: 260px;
    max-height: 340px;
    overflow: auto;
    padding: 10px 12px 12px;
    border-radius: var(--radius-md);
    background: var(--cs-white);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--cs-dark) 18%, transparent);
  }
  .rc-sheet-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .rc-sheet-title { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }
  .rc-sheet-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-mid, var(--cs-text-dark));
    font-size: 14px;
    cursor: pointer;
  }
  .rc-sheet-close:hover { background: var(--cs-red-xlight); color: var(--cs-red-badge); }
  .rc-list { list-style: none; margin: 0; padding: 0; }
  .rc-list-item {
    width: 100%;
    min-height: 40px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text);
    font: var(--text-pc-body-14);
    text-align: left;
    cursor: pointer;
  }
  .rc-list-item:hover { background: color-mix(in srgb, var(--cs-purple) 8%, transparent); }
  .rc-list-h2 { font-size: 18px; font-weight: 900; }
  .rc-list-h3 { font-size: 16px; font-weight: 900; }
  .rc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .rc-palette { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .rc-swatch {
    height: 36px;
    min-width: 36px;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .rc-swatch:hover { opacity: 0.8; }
  .rc-range { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
  .rc-range-cap { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text-dark); }
  .rc-range input[type='range'] { width: 100%; accent-color: var(--cs-purple); }
  .rc-hint { margin: 8px 0 0; font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .rc-form { display: flex; flex-direction: column; gap: 8px; }
  .rc-form-row { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }
  .rc-input {
    width: 100%;
    min-height: 40px;
    padding: 0 12px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    font: var(--text-pc-body-14);
    outline: none;
  }
  .rc-input-num { width: 72px; margin-left: 6px; }
  .rc-label { display: flex; align-items: center; gap: 6px; font: var(--text-pc-body-14); color: var(--cs-text); }
  .rc-err { margin: 0; font: var(--text-pc-script-12); color: var(--cs-red-badge); }
  .rc-ok { margin: 8px 0 0; font: var(--text-pc-script-12); color: var(--cs-purple); font-weight: 700; }
  .rc-emoji { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
  .rc-emoji-btn { height: 34px; border: none; border-radius: var(--radius-sm); background: transparent; font-size: 20px; line-height: 1; cursor: pointer; }
  .rc-emoji-btn:hover { background: color-mix(in srgb, var(--cs-purple) 8%, transparent); }
  .rc-more-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 2px; }
  .rc-more-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 76px;
    padding: 8px 2px;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--cs-text);
    font: var(--text-m-script-12);
    font-weight: 700;
    letter-spacing: -0.3px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .rc-more-item:active { background: var(--cs-lilac); }
  .rc-more-ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    background: var(--cs-surface-gray);
  }
  .rc-more-on { color: var(--cs-purple); }
  .rc-more-on .rc-more-ic { background: color-mix(in srgb, var(--cs-purple) 14%, transparent); }

  /* ── 모달 ── */
  .rc-modal-back { position: fixed; inset: 0; z-index: 60; background: color-mix(in srgb, var(--cs-dark) 45%, transparent); }
  .rc-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 61;
    transform: translate(-50%, -50%);
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    overflow: auto;
    padding: 16px;
    border-radius: var(--radius-lg);
    background: var(--cs-white);
  }
  .rc-textarea {
    width: 100%;
    min-height: 240px;
    padding: 12px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    font: 13px/1.5 ui-monospace, Menlo, monospace;
    resize: vertical;
    outline: none;
  }
  .rc-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .rc-compare-title { margin: 0 0 4px; font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text-dark); }
  .rc-compare-box {
    display: block;
    width: 100%;
    height: 260px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
  }

  /* ═════════ 모바일 (≤767px) ═════════ */
  .rc-mbar {
    position: fixed;
    left: 0;
    right: 0;
    z-index: 40;
    background: var(--cs-white);
    box-shadow: 0 -4px 16px color-mix(in srgb, var(--cs-dark) 12%, transparent);
  }
  .rc-mbar-scroll {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .rc-mbar-scroll::-webkit-scrollbar { display: none; }
  .rc-chip-mobile { position: absolute; right: 12px; top: -34px; margin: 0; }
  .rc-mobile .rc-btn { min-width: 44px; height: 44px; flex-shrink: 0; }
  .rc-mobile .rc-btn-wide { min-width: 52px; }
  .rc-mobile .rc-chipbtn { min-height: 44px; padding: 0 14px; }
  .rc-mobile .rc-seg-btn { min-height: 44px; }
  .rc-mobile .rc-ib { min-width: 44px; height: 44px; }
  .rc-mobile .rc-canvas-wrap,
  .rc-mobile .rc-host { min-height: 50dvh; }
  .rc-mobile .rc-host :global(.rc-canvas) {
    min-height: 50dvh;
    padding: 16px 25px 120px;
    font-size: 16px; /* iOS 입력 확대 방지 */
    line-height: 2;
    gap: 0;
  }
  .rc-sheet-mobile {
    position: fixed;
    top: auto;
    left: 0;
    right: 0;
    width: auto;
    max-height: 50dvh;
    z-index: 45;
    padding: 12px 16px 16px;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 -8px 24px color-mix(in srgb, var(--cs-dark) 18%, transparent);
  }
  .rc-sheet-mobile .rc-swatch { height: 44px; }
  .rc-sheet-mobile .rc-list-item { min-height: 44px; }
  .rc-sheet-mobile .rc-input { min-height: 44px; font-size: 16px; }
  .rc-sheet-mobile .rc-emoji-btn { height: 44px; }
  .rc-sheet-mobile .rc-sheet-close { width: 44px; height: 44px; }
  .rc-mobile .rc-compare { grid-template-columns: 1fr; }
  .rc-mobile .rc-textarea { font-size: 16px; }
</style>
