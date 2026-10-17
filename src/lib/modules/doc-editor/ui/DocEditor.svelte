<script lang="ts">
  /**
   * DocEditor.svelte — 문서 & 양식 통합 편집기 (doc-editor ui, 이식형)
   *
   * 이관 원본: src/lib/components/cms/contract-editor/ContractDocumentEditor.svelte (원본은 무변경 유지).
   * 검증된 편집 로직(표·반복행·이미지 NodeView·줌·소스·서명/직인)은 그대로 옮기고,
   * 호스트 의존만 주입식(props)으로 바꿨다:
   *   - 토스트          → notify(message, level)
   *   - 이미지 업로드   → uploadImage(file) (없으면 data URL 인라인)
   *   - 서명/직인 목록  → listSignatureAssets()
   *   - 저장            → 호스트가 getEditorJSON()으로 읽어 처리 (이 컴포넌트는 저장 콜백을 갖지 않는다)
   *   - 디자인 토큰     → --de-* CSS 변수(기본값 내장, 호스트가 덮어쓰기)
   * ⛔ 이식 규칙: $lib·$app·$env·supabase·/api 금지 (portability.test.ts가 강제)
   */

  import { onDestroy, untrack } from 'svelte'
  import { createEditor, EditorContent } from 'svelte-tiptap'
  import { generateHTML, type JSONContent } from '@tiptap/core'
  import { NodeSelection } from '@tiptap/pm/state'

  import { CustomImage, DOC_EDITOR_EXTENSIONS } from '../core/extensions'
  import { isTiptapDocBlock } from '../core/types'
  import type { DocJSON, TiptapDocBlock, MergeFieldAttrs, SignatureAsset, EditImageInfo } from '../core/types'
  import { fillMissingTableColwidths } from '../core/table-colwidth'
  import { cleanPastedHtml } from '../core/pasteClean'
  import { IMAGE_RESIZE_CORNERS, allowedHandleSide, pointerExtent, createHandlePref, type ImageAlignKey } from '../core/imageTools'
  import { createPlaceholder } from './placeholderExtension'
  import { ensureIconFont } from './iconFont'
  import { validateImageFile } from './imageFile'
  import { DEFAULT_FEATURES, type DocEditorFeatures } from './features'
  import DocToolbar from './DocToolbar.svelte'
  import TableContextBar from './TableContextBar.svelte'


  // --------------------------------------------------------------------------
  // Props
  // --------------------------------------------------------------------------
  interface Props {
    /** 초기 문서 — TiptapDocBlock({type:'tiptap-doc',doc}) 또는 TipTap JSON 문서 */
    initialContent?: TiptapDocBlock | DocJSON | null
    /** 레거시 HTML 초기값 — initialContent가 없을 때 폴백 */
    initialHtml?: string
    /** 편집 비활성화 */
    readonly?: boolean
    /**
     * 문서 내용이 바뀔 때마다 호출(첫 로드 시 1회 호출될 수 있음 — 호출부가 로드 직후 dirty를 초기화하는 패턴).
     * TipTap 문서는 ProseMirror 내부 상태라 Svelte 리액티비티 밖에 있어 이 콜백으로 isDirty를 세운다.
     */
    onchange?: () => void
    /** 사용자 안내 알림(토스트 등). 미지정 시 무음. */
    notify?: (message: string, level: 'warning' | 'error' | 'info') => void
    /** 이미지 업로드 — 지정하면 서버 업로드 URL을 쓰고, 없으면 data URL로 문서에 인라인한다. */
    uploadImage?: (file: File) => Promise<{ url: string }>
    /**
     * 문서에 삽입된 이미지를 더블클릭하거나 이미지 도구줄의 '편집'을 눌렀을 때 호출(편집 가능 상태에서만). startEdit=true(도구줄 '편집')면 호스트가 뷰어를 편집 모드로 바로 연다. 호스트가 이미지 뷰어·편집기를 띄우고,
     * 편집이 끝나면 replace(새 주소)로 그 이미지의 src를 교체한다(너비·정렬 등 다른 속성은 유지). 미지정 시 더블클릭 동작 없음.
     */
    onEditImage?: (info: EditImageInfo) => void
    /** 서명/직인 자산 목록 제공자 — 없으면 서명/직인 버튼이 비활성(목록 비어 있음) */
    listSignatureAssets?: () => Promise<SignatureAsset[]>
    /** 기능 개별 on/off (기본 전부 on) */
    features?: Partial<DocEditorFeatures>
    /** 아이콘 웹폰트 CSS URL. null이면 로드하지 않음(호스트가 이미 로드한 경우) */
    iconFontUrl?: string | null
    /** 빈 문서일 때 보이는 안내 문구 (미지정 시 표시 없음). 마운트 시점 값만 쓰며 이후 변경은 반영되지 않는다({#key}로 다시 마운트 필요) */
    placeholder?: string
  }

  let {
    initialContent = null,
    initialHtml,
    readonly = false,
    onchange,
    notify,
    uploadImage,
    onEditImage,
    listSignatureAssets,
    features: featuresProp = {},
    iconFontUrl,
    placeholder,
  }: Props = $props()

  const features: DocEditorFeatures = $derived({ ...DEFAULT_FEATURES, ...featuresProp })

  // --------------------------------------------------------------------------
  // 에디터 extension은 tiptapExtensions.ts에서 공유 (tiptapRender.ts와 동일 설정)
  // → DOC_EDITOR_EXTENSIONS import로 대체 (위 import 블록 참조)
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // 이미지 NodeView — 에디터 전용 (generateHTML/tiptapRender.ts 경로에서는 미사용)
  //
  // 선택된 이미지 위에 플로팅 툴바를 표시(2026-10-16 정리 — RichContentEditor와 같은 기준):
  //   • 겹치기(텍스트 위에 띄우기) · 편집(공통 뷰어) · ALT(사진 설명) · 크기 조절 점 표시/숨김 · 삭제
  //   • 크기는 모서리 점 드래그, 정렬은 상단 서식 도구줄의 정렬 버튼이 맡는다(예전의 소·중·대 프리셋·너비 입력·정렬 버튼은 이와 중복·충돌해 제거).
  //
  // CustomImage.extend()로 width·align 속성 정의는 그대로 상속하고
  // addNodeView()만 추가. generateHTML() 측은 CustomImage 그대로 사용하므로
  // 저장된 너비·정렬 스타일이 고객 서명 화면에서도 정확히 렌더링된다.
  // --------------------------------------------------------------------------

  // 크기 조절 점 표시 여부 — 이미지 도구줄의 크기 아이콘으로 켜고 끈다(기본 표시, 선택은 이 브라우저에 기억).
  // 문서 안 모든 이미지가 같은 설정을 따르므로, 각 이미지 NodeView의 손잡이 갱신 함수를 모아 두고 전환 때 한꺼번에 부른다.
  const handlePref = createHandlePref('de-image-resize-handles')
  let resizeHandlesOn = handlePref.read()
  const handleLayouts = new Set<() => void>()
  function toggleResizeHandles(): void {
    resizeHandlesOn = !resizeHandlesOn
    handlePref.write(resizeHandlesOn)
    handleLayouts.forEach((fn) => fn())
  }

  const ImageWithNodeView = CustomImage.extend({
    addNodeView() {
      // `this.editor` : TipTap extension context 의 editor 인스턴스
      const extEditor = this.editor

      return ({ node: initNode, getPos }: {
        node: { attrs: Record<string, unknown>; type: { name: string } }
        getPos: (() => number | undefined) | boolean
      }) => {
        let currentAttrs: Record<string, unknown> = { ...initNode.attrs }

        // ── 헬퍼: 화면 확대/축소(--de-zoom, CSS zoom) 배율 — 포인터·getBoundingClientRect 값은 화면 픽셀이고
        //    left/top 은 문서(확대 전) 픽셀이라, 겹치기 좌표 계산은 이 배율로 나눠야 어긋나지 않는다 ──
        function zoomScale(): number {
          const area = outer.closest('.de-editor-area')
          const v = area ? getComputedStyle(area).getPropertyValue('--de-zoom').trim() : ''
          const n = parseFloat(v)
          return Number.isFinite(n) && n > 0 ? n / 100 : 1
        }

        // ── 헬퍼: attr 변경을 ProseMirror tr로 적용 ──
        function dispatchAttrs(patch: Record<string, unknown>): void {
          if (typeof getPos !== 'function') return
          const pos = getPos()
          if (pos === undefined) return
          const { state, dispatch } = extEditor.view
          dispatch(state.tr.setNodeMarkup(pos, undefined, { ...currentAttrs, ...patch }))
        }

        // ── 외부 래퍼 (정렬/절대위치 담당) ──
        const outer = document.createElement('div')

        // ── img ──
        const img = document.createElement('img')
        img.draggable = false

        // ── 드래그 상태 (ContractCanvasEditor.onFieldPointerDown 패턴 참고) ──
        let isDragging = false
        /** 실제 이동이 있었는지(드래그) 여부 — 없으면(순수 클릭) pointerup에서 노드 선택 처리 */
        let dragMoved = false
        let dragOffsetX = 0
        let dragOffsetY = 0

        // ── 플로팅 툴바 (선택 시에만 display:flex) ──
        const bar = document.createElement('div')
        bar.style.cssText =
          'display:none;position:absolute;bottom:calc(100% + 4px);left:50%;' +
          'transform:translateX(-50%);background:var(--de-white, #FFFFFF);border:1px solid var(--de-lilac, #ECEBF4);' +
          'border-radius:8px;box-shadow:0 4px 16px rgba(16,11,50,.12);' +
          'padding:4px 8px;gap:4px;align-items:center;white-space:nowrap;z-index:100'

        // ── 툴바 빌더 헬퍼 ──
        function mkBtn(text: string, title: string): HTMLButtonElement {
          const b = document.createElement('button')
          b.type = 'button'
          b.textContent = text
          b.title = title
          b.style.cssText =
            'min-height:24px;min-width:24px;padding:2px 7px;background:transparent;' +
            'border:1px solid transparent;border-radius:6px;font-size:11px;' +
            'font-weight:600;color:var(--de-text, #100B32);cursor:pointer;line-height:1.4;flex-shrink:0'
          b.addEventListener('mouseenter', () => {
            if (b.dataset['state'] !== 'active') b.style.background = 'var(--de-lilac, #ECEBF4)'
          })
          b.addEventListener('mouseleave', () => {
            if (b.dataset['state'] !== 'active') b.style.background = 'transparent'
          })
          return b
        }

        function mkSep(): HTMLSpanElement {
          const s = document.createElement('span')
          s.style.cssText = 'width:1px;height:16px;background:var(--de-lilac, #ECEBF4);flex-shrink:0;align-self:center'
          return s
        }

        // ── 겹치기(overlay) 토글 버튼 ──
        const overlayBtn = mkBtn('겹치기', '텍스트 위에 겹치기 — 드래그로 위치 조정')
        overlayBtn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          const isOverlay = !!(currentAttrs['overlay'] as boolean)
          if (isOverlay) {
            // 겹치기 해제 → 인라인 정렬 복귀
            dispatchAttrs({ overlay: false })
          } else {
            // 겹치기 ON → 지금 보이는 자리에서 그대로 떠오르게(문서 좌상단 0,0으로 튀지 않도록)
            // 좌표는 .ProseMirror 안쪽(패딩 포함) 기준·확대 배율 보정
            const pmEl = outer.closest('.ProseMirror') as HTMLElement | null
            let x = 0
            let y = 0
            if (pmEl) {
              const s = zoomScale()
              const pmRect = pmEl.getBoundingClientRect()
              const imgRect = img.getBoundingClientRect()
              x = Math.max(0, Math.round((imgRect.left - pmRect.left - pmEl.clientLeft) / s))
              y = Math.max(0, Math.round((imgRect.top - pmRect.top - pmEl.clientTop) / s))
            }
            dispatchAttrs({ overlay: true, x, y })
          }
        })
        bar.appendChild(overlayBtn)

        bar.appendChild(mkSep())

        // ── 문서 안 모든 이미지(문서 순서) — 뷰어의 썸네일 정렬에 전부 나열되고, 어느 이미지든 편집 저장 시 그 자리의 src만 교체된다 ──
        function collectImages(): { images: EditImageInfo['images']; index: number } {
          const images: EditImageInfo['images'] = []
          let index = 0
          const myPos = typeof getPos === 'function' ? getPos() : undefined
          extEditor.state.doc.descendants((n, p) => {
            if (n.type.name !== 'image') return true
            const src = (n.attrs['src'] as string) || ''
            if (p === myPos) index = images.length
            // cur = 이 이미지의 현재 src(교체할 때마다 갱신 — 같은 이미지를 뷰어에서 여러 번 편집해도 계속 같은 자리를 찾는다)
            let cur = src
            images.push({
              src,
              alt: (n.attrs['alt'] as string) || '',
              // 위치가 밀렸을 수 있어 교체 시점에 같은 위치·같은 src 를 확인하고, 아니면 같은 src 의 첫 이미지를 찾는다
              replace: (newSrc: string) => {
                const { state, dispatch } = extEditor.view
                const same = (m: { type: { name: string }; attrs: Record<string, unknown> } | null | undefined) => !!m && m.type.name === 'image' && m.attrs['src'] === cur
                let at = same(state.doc.nodeAt(p)) ? p : -1
                if (at < 0) state.doc.descendants((m, q) => { if (at < 0 && same(m)) at = q; return at < 0 })
                const target = at >= 0 ? state.doc.nodeAt(at) : null
                if (target) {
                  dispatch(state.tr.setNodeMarkup(at, undefined, { ...target.attrs, src: newSrc }))
                  cur = newSrc
                }
              },
            })
            return false
          })
          return { images, index }
        }

        // ── 이미지 편집(RichContentEditor 이미지 도구 이관) ──
        // '편집' = 공통 이미지 뷰어를 편집 모드로 연다(자르기·명암·컬러감·배경색·회전). 저장하면 같은 이미지의 src만 교체되고 너비·정렬·겹치기 위치는 유지된다.
        const editBtn = mkBtn('', '이미지 편집 — 자르기·명암·컬러감·배경색·회전')
        editBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 18 18" fill="none" aria-hidden="true" style="vertical-align:-1px;margin-right:3px">' +
          '<path d="M3 15l.7-3.3L12.4 3a1.6 1.6 0 0 1 2.3 2.3L6 14l-3 1zM10.8 4.6l2.6 2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>편집'
        editBtn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          const src = (currentAttrs['src'] as string) || ''
          if (!onEditImage || !extEditor.isEditable || !src) return
          onEditImage({ src, replace: (newSrc: string) => dispatchAttrs({ src: newSrc }), startEdit: true, ...collectImages() })
        })
        bar.appendChild(editBtn)

        // ── 사진 설명(ALT) — 시각장애 보조기기·검색에 쓰이는 대체 텍스트 ──
        const altBtn = mkBtn('ALT', '사진 설명(대체 텍스트)')
        const altInput = document.createElement('input')
        altInput.type = 'text'
        altInput.maxLength = 120
        altInput.placeholder = '사진 설명'
        altInput.style.cssText =
          'display:none;width:140px;height:24px;padding:0 6px;border:1px solid var(--de-lilac, #ECEBF4);' +
          'border-radius:6px;font-size:11px;color:var(--de-text, #100B32);outline:none;box-sizing:border-box;flex-shrink:0'
        function applyAlt(): void {
          const v = altInput.value.trim()
          altInput.style.display = 'none'
          if (v !== ((currentAttrs['alt'] as string | undefined) ?? '')) dispatchAttrs({ alt: v })
        }
        altBtn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          if (altInput.style.display === 'none') {
            altInput.value = (currentAttrs['alt'] as string | undefined) ?? ''
            altInput.style.display = 'block'
            altInput.focus()
          } else {
            applyAlt()
          }
        })
        altInput.addEventListener('keydown', (e) => {
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault(); applyAlt() }
          else if (e.key === 'Escape') { altInput.style.display = 'none' }
        })
        altInput.addEventListener('blur', applyAlt)
        // 도구줄 크기 아이콘(속이 빈 사각 윤곽 + 네 모서리 점) — 크기 조절 점 표시/숨김 전환
        const handleToggleBtn = mkBtn('', '크기 조절 점 숨기기')
        handleToggleBtn.setAttribute('aria-label', '크기 조절 점 표시/숨김')
        handleToggleBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true" style="vertical-align:-2px">' +
          '<rect x="4.5" y="4.5" width="9" height="9" rx="0.8" stroke="currentColor" stroke-width="1.4"/>' +
          '<rect x="2.4" y="2.4" width="3.2" height="3.2" rx="0.7" fill="currentColor"/><rect x="12.4" y="2.4" width="3.2" height="3.2" rx="0.7" fill="currentColor"/>' +
          '<rect x="2.4" y="12.4" width="3.2" height="3.2" rx="0.7" fill="currentColor"/><rect x="12.4" y="12.4" width="3.2" height="3.2" rx="0.7" fill="currentColor"/></svg>'
        handleToggleBtn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          toggleResizeHandles()
        })

        bar.appendChild(altBtn)
        bar.appendChild(altInput)
        bar.appendChild(handleToggleBtn)

        bar.appendChild(mkSep())

        // ── 삭제 버튼 (2026-08-16 — 기존엔 이미지 선택 시 삭제 수단이 전혀 없어
        //    "선택 후 Delete/Backspace 키" 외 발견 불가능했음. jspreadsheet-ce 스프레드시트
        //    모드 오버레이 삭제 버튼과 동일한 발견성으로 통일) ──
        const deleteBtn = mkBtn('✕', '이미지 삭제')
        deleteBtn.style.color = 'var(--de-danger, #FF3535)'
        deleteBtn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          if (typeof getPos !== 'function') return
          const pos = getPos()
          if (pos === undefined) return
          const { state, dispatch } = extEditor.view
          // nodeSize를 이미지 atom 노드 크기(항상 1)로 가정하지 않고 실제 문서에서 다시
          // 조회 — NodeView 클로저의 initNode는 최초 마운트 시점 스냅샷이라 신뢰하지 않는다.
          const docNode = state.doc.nodeAt(pos)
          if (!docNode) return
          dispatch(state.tr.delete(pos, pos + docNode.nodeSize))
        })
        bar.appendChild(deleteBtn)

        // ── 모서리 크기 조절 손잡이(RichContentEditor 이관) ──
        // 선택된 이미지의 모서리 점을 끌면 너비(px)가 바뀌고, 놓을 때 한 번만 문서에 반영한다(되돌리기 한 단계).
        // 가운데 정렬은 네 모서리(중심 기준 대칭), 왼쪽 정렬·겹치기는 오른쪽 모서리, 오른쪽 정렬은 왼쪽 모서리만 나온다.
        const CORNERS = IMAGE_RESIZE_CORNERS
        let imgSelected = false
        let resizeState: { side: 'l' | 'r'; rect: DOMRect; scale: number; w: number } | null = null

        const sizeBadge = document.createElement('div')
        sizeBadge.style.cssText =
          'display:none;position:absolute;transform:translate(-50%,-50%);padding:3px 8px;border-radius:8px;' +
          'background:var(--de-dark, #100B32);color:#fff;font-size:11px;font-weight:700;pointer-events:none;z-index:102'

        const handleEls = CORNERS.map((c) => {
          const el = document.createElement('div')
          el.setAttribute('data-de-resize', c.id)
          el.setAttribute('role', 'slider')
          el.setAttribute('aria-label', '이미지 크기 조절')
          el.title = '모서리를 끌어 크기 조절'
          el.style.cssText =
            'display:none;position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:3px;' +
            `background:var(--de-purple, #3B2F8A);z-index:101;touch-action:none;cursor:${c.cursor}`
          return { ...c, el }
        })

        function sideAllowed(side: 'l' | 'r'): boolean {
          const a = ((currentAttrs['align'] as string | undefined) || 'center') as ImageAlignKey
          return allowedHandleSide(side, a, !!currentAttrs['overlay'])
        }

        /** 이미지의 현재 모서리 위치(outer 기준)에 손잡이를 놓고, 선택 상태·정렬에 맞게 보이거나 숨긴다 */
        function layoutHandles(): void {
          handleEls.forEach((h) => {
            const show = imgSelected && resizeHandlesOn && sideAllowed(h.side)
            h.el.style.display = show ? 'block' : 'none'
            h.el.style.left = `${img.offsetLeft + h.cx * img.offsetWidth}px`
            h.el.style.top = `${img.offsetTop + h.cy * img.offsetHeight}px`
          })
          // 도구줄 크기 아이콘 상태(켜짐=강조) 동기화
          handleToggleBtn.dataset['state'] = resizeHandlesOn ? 'active' : ''
          handleToggleBtn.setAttribute('aria-pressed', String(resizeHandlesOn))
          handleToggleBtn.title = resizeHandlesOn ? '크기 조절 점 숨기기' : '크기 조절 점 보이기'
          handleToggleBtn.style.background = resizeHandlesOn ? 'var(--de-purple-wash, rgba(59,47,138,0.1))' : 'transparent'
          handleToggleBtn.style.borderColor = resizeHandlesOn ? 'var(--de-purple, #3B2F8A)' : 'transparent'
          handleToggleBtn.style.color = resizeHandlesOn ? 'var(--de-purple, #3B2F8A)' : 'var(--de-text, #100B32)'
        }

        function startResize(e: PointerEvent, side: 'l' | 'r'): void {
          if (!extEditor.isEditable) return
          e.preventDefault()
          e.stopPropagation()
          const rect = img.getBoundingClientRect()
          const scale = zoomScale()
          resizeState = { side, rect, scale, w: Math.round(rect.width / scale) }
          ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        }
        function moveResize(e: PointerEvent): void {
          const r = resizeState
          if (!r) return
          const align = ((currentAttrs['align'] as string | undefined) || 'center') as ImageAlignKey
          const raw = pointerExtent(align, !!currentAttrs['overlay'], e.clientX, r.rect) / r.scale
          const w = Math.min(1200, Math.max(20, Math.round(raw)))
          resizeState = { ...r, w }
          img.style.width = `${w}px`
          layoutHandles()
          sizeBadge.textContent = `${w}px`
          sizeBadge.style.left = `${img.offsetLeft + img.offsetWidth / 2}px`
          sizeBadge.style.top = `${img.offsetTop + img.offsetHeight / 2}px`
          sizeBadge.style.display = 'block'
        }
        function endResize(commit: boolean): void {
          const r = resizeState
          resizeState = null
          sizeBadge.style.display = 'none'
          if (!r) return
          if (commit && r.w !== currentAttrs['width']) dispatchAttrs({ width: r.w })
          else applyAttrs() // 변경 없음·취소 → 문서 값으로 화면 복구
        }
        handleEls.forEach((h) => {
          h.el.addEventListener('pointerdown', (e: PointerEvent) => startResize(e, h.side))
          h.el.addEventListener('pointermove', moveResize)
          h.el.addEventListener('pointerup', () => endResize(true))
          h.el.addEventListener('pointercancel', () => endResize(false))
          h.el.addEventListener('mousedown', (e) => e.preventDefault()) // 포커스·선택 유지
        })
        const isHandle = (t: EventTarget | null): boolean => handleEls.some((h) => h.el === t) // 배지는 pointer-events:none

        img.addEventListener('load', layoutHandles)
        // 창 크기·화면 확대/축소·max-width:100% 로 이미지 표시 크기가 바뀌어도 손잡이가 모서리에 붙어 있게 한다
        const sizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => layoutHandles()) : null
        sizeObserver?.observe(img)
        handleLayouts.add(layoutHandles)

        outer.appendChild(img)
        outer.appendChild(bar)
        handleEls.forEach((h) => outer.appendChild(h.el))
        outer.appendChild(sizeBadge)

        // ── 더블클릭 → 호스트의 이미지 뷰어·편집기 호출(편집 가능 상태에서만) ──
        outer.addEventListener('dblclick', (e: MouseEvent) => {
          if (!onEditImage || !extEditor.isEditable) return
          if (bar.contains(e.target as Node) || isHandle(e.target)) return   // 플로팅 툴바·크기 손잡이 조작은 제외
          const src = (currentAttrs['src'] as string) || ''
          if (!src) return
          e.preventDefault()
          e.stopPropagation()
          onEditImage({ src, replace: (newSrc: string) => dispatchAttrs({ src: newSrc }), startEdit: false, ...collectImages() })
        })

        // ── 겹치기 드래그 (ContractCanvasEditor.onFieldPointerDown 패턴) ──
        outer.addEventListener('pointerdown', (e: PointerEvent) => {
          if (!(currentAttrs['overlay'] as boolean)) return
          // 툴바 클릭은 드래그 무시 — 여기서 e.preventDefault()를 호출하면 안 된다(2026-08-19,
          // 실제 신뢰된 클릭으로 직접 검증). 스프레드시트 모드 27라운드와 겉보기엔 같은
          // "return만 하는 분기"라 얼핏 동일한 결함으로 보였으나 구조가 다르다 — 이 툴바의
          // 프리셋/정렬/삭제 버튼은 전부 'mousedown' 이벤트로 동작을 실행하는데(자체
          // btn.addEventListener('mousedown', ...)), 여기서 pointerdown에 preventDefault를
          // 호출하면 Pointer Events 스펙상 브라우저가 뒤이어 합성하는 호환 mousedown 이벤트
          // 자체가 통째로 취소된다 — 즉 버튼의 mousedown 리스너가 실제 클릭에서는 영원히
          // 발화하지 않게 된다(document 캡처단계 디버그 리스너로 직접 확인: pointerdown은
          // 도달하지만 mousedown은 로그에 전혀 안 찍힘, click은 찍히지만 이 버튼들은 click을
          // 안 씀). preventDefault를 추가했다가 실사용 검증 중 이 결함을 직접 재현해 원복함.
          if (bar.contains(e.target as Node) || isHandle(e.target)) return
          e.preventDefault()
          e.stopPropagation()
          outer.setPointerCapture(e.pointerId)
          isDragging = true
          dragMoved = false
          const rect = outer.getBoundingClientRect()
          dragOffsetX = e.clientX - rect.left
          dragOffsetY = e.clientY - rect.top
        }, { passive: false })

        outer.addEventListener('pointermove', (e: PointerEvent) => {
          if (!isDragging) return
          dragMoved = true
          e.preventDefault()
          // .ProseMirror 가 position:relative 기준점 (CSS로 보장됨)
          const pmEl = outer.closest('.ProseMirror') as HTMLElement | null
          if (!pmEl) return
          const s = zoomScale()
          const pmRect = pmEl.getBoundingClientRect()
          const outRect = outer.getBoundingClientRect()
          // 포인터·rect 는 화면 픽셀 → 문서 픽셀로 환산. 문서 밖(오른쪽·아래)으로 나가 렌더에서 사라지지 않게 제한
          const maxX = Math.max(0, (pmRect.width - outRect.width) / s)
          const maxY = Math.max(0, (pmRect.height - outRect.height) / s)
          const newX = Math.max(0, Math.min(Math.round((e.clientX - pmRect.left - dragOffsetX) / s), maxX))
          const newY = Math.max(0, Math.min(Math.round((e.clientY - pmRect.top - dragOffsetY) / s), maxY))
          if (newX === currentAttrs['x'] && newY === currentAttrs['y']) return
          dispatchAttrs({ x: newX, y: newY })
        }, { passive: false })

        outer.addEventListener('pointerup', () => {
          // ⛔ 2026-08-19 진짜 근본원인 — "겹치기(overlay) 이미지를 클릭해도 크기조절
          // 플로팅 툴바가 아예 뜨지 않는" 결함(Stephen "설정바가 작동하지 않는다" 실사용
          // 재현). 위 pointerdown이 겹치기 이미지 위 클릭마다 무조건 e.preventDefault()를
          // 호출하는데(드래그 시작을 위해 원래부터 필요한 호출), Pointer Events 스펙상
          // pointerdown의 preventDefault는 뒤이어 브라우저가 자동 합성하는 호환
          // mousedown/mouseup/click 이벤트 전부를 억제한다 — 즉 드래그로 실제 이동이
          // 전혀 없는 "순수 클릭"이어도 ProseMirror 입장에서는 mousedown/click 자체를
          // 아예 받지 못해, atom 노드를 클릭했을 때 기본 제공되는 NodeSelection 생성이
          // 절대 일어나지 않는다 → selectNode()가 호출되지 않아 플로팅 툴바가 영원히
          // display:none으로 남는다. (합성 dispatchEvent로 직접 pointerdown/mousedown/
          // click을 전부 쏘는 자동화 테스트에서는 이 억제 자체가 재현되지 않아 "정상
          // 동작"으로 오판했었음 — 실제 신뢰된 마우스 클릭에서만 나타나는 결함.)
          // 수정: 이동 없이(dragMoved=false) 끝난 포인터업이면 우리가 직접
          // NodeSelection을 만들어 선택 상태로 전환 — 브라우저가 억제한 기본 선택 동작을
          // 대신 수행한다.
          if (isDragging && !dragMoved && typeof getPos === 'function') {
            const pos = getPos()
            if (pos !== undefined) {
              const { state, dispatch } = extEditor.view
              dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
            }
          }
          isDragging = false
        })

        outer.addEventListener('pointercancel', () => {
          isDragging = false
        })

        // ── attrs → DOM 반영 ──
        function applyAttrs(): void {
          const w = currentAttrs['width'] as number | null | undefined
          const align = (currentAttrs['align'] as string | undefined) || 'center'
          const overlay = !!(currentAttrs['overlay'] as boolean)
          const ox = (currentAttrs['x'] as number) || 0
          const oy = (currentAttrs['y'] as number) || 0

          img.src = (currentAttrs['src'] as string) || ''
          img.alt = (currentAttrs['alt'] as string) || ''

          // img 인라인 스타일
          const imgStyles = ['display:block', 'border-radius:4px', 'height:auto', 'max-width:100%']
          if (w) imgStyles.push(`width:${w}px`)
          if (!overlay && align === 'center') imgStyles.push('margin:0 auto')
          img.style.cssText = imgStyles.join(';')

          // outer 배치: overlay 시 absolute, 아니면 align 기반
          if (overlay) {
            outer.style.cssText =
              `position:absolute;left:${ox}px;top:${oy}px;z-index:10;cursor:move`
          } else if (align === 'left') {
            outer.style.cssText = 'position:relative;display:inline-block;float:left;margin:4px 8px 4px 0;clear:none'
          } else if (align === 'right') {
            outer.style.cssText = 'position:relative;display:inline-block;float:right;margin:4px 0 4px 8px;clear:none'
          } else {
            outer.style.cssText = 'position:relative;display:block;clear:both'
          }

          // 겹치기 버튼 활성 상태
          overlayBtn.dataset['state'] = overlay ? 'active' : ''
          if (overlay) {
            overlayBtn.style.background = 'var(--de-purple-wash, rgba(59,47,138,0.1))'
            overlayBtn.style.borderColor = 'var(--de-purple, #3B2F8A)'
            overlayBtn.style.color = 'var(--de-purple, #3B2F8A)'
          } else {
            overlayBtn.style.background = 'transparent'
            overlayBtn.style.borderColor = 'transparent'
            overlayBtn.style.color = 'var(--de-text, #100B32)'
          }
          // ALT 버튼: 사진 설명이 있으면 강조
          const hasAlt = !!(currentAttrs['alt'] as string | undefined)
          altBtn.dataset['state'] = hasAlt ? 'active' : ''
          altBtn.style.background = hasAlt ? 'var(--de-purple-wash, rgba(59,47,138,0.1))' : 'transparent'
          altBtn.style.borderColor = hasAlt ? 'var(--de-purple, #3B2F8A)' : 'transparent'
          altBtn.style.color = hasAlt ? 'var(--de-purple, #3B2F8A)' : 'var(--de-text, #100B32)'
          layoutHandles()
        }

        applyAttrs()

        return {
          dom: outer,
          update(updatedNode: { type: { name: string }; attrs: Record<string, unknown> }) {
            if (updatedNode.type.name !== 'image') return false
            currentAttrs = { ...updatedNode.attrs }
            applyAttrs()
            return true
          },
          selectNode() {
            img.style.outline = '2px solid var(--de-purple, #3B2F8A)'
            img.style.outlineOffset = '2px'
            bar.style.display = 'flex'
            imgSelected = true
            layoutHandles()
          },
          deselectNode() {
            img.style.outline = ''
            img.style.outlineOffset = ''
            bar.style.display = 'none'
            imgSelected = false
            layoutHandles()
          },
          /**
           * 툴바 내 이벤트는 ProseMirror 로 전파하지 않음 (input 타이핑 보호).
           * overlay 모드에서 포인터 이벤트는 드래그 핸들러가 처리 — PM에 전파 차단.
           */
          stopEvent(event: Event) {
            if (bar.contains(event.target as Node) || isHandle(event.target)) return true
            if (
              currentAttrs['overlay'] &&
              (event.type === 'pointerdown' ||
               event.type === 'pointermove' ||
               event.type === 'pointerup' ||
               event.type === 'pointercancel')
            ) return true
            return false
          },
          destroy() {
            sizeObserver?.disconnect()
            handleLayouts.delete(layoutHandles)
          },
        }
      }
    },
  })

  /**
   * 에디터 전용 확장 목록:
   *   DOC_EDITOR_EXTENSIONS 에서 CustomImage 를 제거하고
   *   NodeView 가 추가된 ImageWithNodeView 로 교체.
   *   generateHTML()/tiptapRender.ts 는 DOC_EDITOR_EXTENSIONS 그대로 사용.
   */
  const editorExtensions = [
    ...DOC_EDITOR_EXTENSIONS.filter((e) => e !== CustomImage),
    ImageWithNodeView,
    // 에디터 전용(문서 스키마·렌더에 영향 없음) — 안내 문구
    ...(untrack(() => placeholder) ? [createPlaceholder(untrack(() => placeholder) as string)] : []),
  ]

  // --------------------------------------------------------------------------
  // TipTap 에디터 생성 (svelte-tiptap createEditor → Readable<Editor>)
  //
  // untrack()으로 props를 읽음: 부모가 {#key}로 remount를 보장하므로
  // content/editable은 마운트 시점에 한 번만 읽으면 충분 (의도적 비반응형 스냅샷).
  // readonly 변경 대응은 아래 $effect에서 setEditable()로 별도 처리.
  // --------------------------------------------------------------------------
  const editorStore = createEditor({
    extensions: editorExtensions,
    content: untrack(() => {
      const initialDoc = isTiptapDocBlock(initialContent) ? initialContent.doc : (initialContent as DocJSON | null)
      return (
        (initialDoc ? fillMissingTableColwidths(initialDoc) : null) ??
        initialHtml ??
        ({ type: 'doc', content: [{ type: 'paragraph' }] } as JSONContent)
      )
    }),
    editable: untrack(() => !readonly),
    editorProps: {
      // 붙여넣기 정화(워드·엑셀·웹 복사본의 주석·스타일·MS 전용 서식·원본 서체 제거)
      transformPastedHTML: cleanPastedHtml,
      // 이미지만 복사한 경우(스크린샷 등)에만 이미지로 삽입 — 텍스트/HTML이 함께 있으면 기본 붙여넣기를 우선(내용 유실 방지)
      handlePaste: (_view, event) => {
        if (!features.image) return false
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return false
        if (event.clipboardData?.getData('text/html') || event.clipboardData?.getData('text/plain')) return false
        event.preventDefault()
        for (const f of files) insertImageFile(f)
        return true
      },
      // 이미지 파일을 끌어다 놓으면 놓은 위치에 삽입 (문서 안 노드 이동은 기본 동작에 맡김)
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !features.image) return false
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        for (const f of files) insertImageFile(f, at?.pos)
        return true
      },
    },
    // isDirty 판정용 알림 — 기존 편집기와 같은 의미: 문서가 실제로 바뀔 때마다 호출한다.
    // (초기 로드 시 알림이 오던 원인은 아래 setEditable 의 기본 update 이벤트였고, 거기서 끈다.)
    onUpdate: () => onchange?.(),
  })

  onDestroy(() => {
    $editorStore?.destroy()
  })

  // readonly prop 변경 시 TipTap 에디터 editable 상태 동기화
  $effect(() => {
    // emitUpdate=false: setEditable 기본값은 'update' 이벤트를 내보내 편집 전에도 onchange(dirty)가 켜지기 때문
    $editorStore?.setEditable(!readonly, false)
  })

  // 2026-08-17 편집 메뉴 UI 통일(Stephen "jspreadsheet 네이티브 툴바를 표준 디자인 UI로
  // 기준" 요청) — 툴바 아이콘이 스프레드시트 모드(ContractSpreadsheetEditor.svelte)와
  // 동일한 Google Material Icons 웹폰트에 의존한다. $effect는 마운트 이후에만
  // 실행되므로(SSR 미실행) onMount와 동일하게 안전 — 의존값이 없어 1회만 실행된다.
  $effect(() => {
    if (iconFontUrl !== null) ensureIconFont(iconFontUrl)
  })

  // --------------------------------------------------------------------------
  // UI 상태
  // --------------------------------------------------------------------------
  let showHtmlModal = $state(false)
  let htmlSource    = $state('')
  let imgInput: HTMLInputElement | null = $state(null)

  // --------------------------------------------------------------------------
  // 캔버스 확대/축소 (2026-08-15 실사용 요청 — Word/Sheets류 줌 컨트롤)
  // CSS zoom(비표준이나 Chrome/Safari/Edge 폭넓게 지원, Firefox도 최신 버전 지원)을 사용 —
  // transform:scale()과 달리 레이아웃 자체가 재계산돼 빈 여백 없이 실제 크기가 줄어든다.
  // --------------------------------------------------------------------------
  const ZOOM_MIN = 50
  const ZOOM_MAX = 200
  const ZOOM_STEP = 10
  let zoomPercent = $state(100)

  function zoomOut() { zoomPercent = Math.max(ZOOM_MIN, zoomPercent - ZOOM_STEP) }
  function zoomIn()  { zoomPercent = Math.min(ZOOM_MAX, zoomPercent + ZOOM_STEP) }
  function zoomReset() { zoomPercent = 100 }

  // --------------------------------------------------------------------------
  // 반복 영역 지정/해제 (Stage 5 — 다중 상품 반복행)
  // 현재 커서가 있는 tableRow 노드의 repeatRegion 속성을 토글한다.
  // --------------------------------------------------------------------------

  /** 현재 커서 위치가 반복 영역으로 지정된 행 안에 있는지 여부 */
  let isInRepeatRow = $derived(
    (() => {
      const editor = $editorStore
      if (!editor) return false
      const selFrom = editor.state.selection.$from
      for (let d = selFrom.depth; d >= 0; d--) {
        const node = selFrom.node(d)
        if (node.type.name === 'tableRow') {
          return node.attrs['repeatRegion'] === true
        }
      }
      return false
    })()
  )

  /**
   * 현재 커서가 있는 표 행의 repeatRegion 속성을 토글한다.
   * 반복 영역이면 해제, 아니면 지정한다.
   * 표 바깥에서 호출하면 경고 토스트를 표시한다.
   */
  function toggleRepeatRegionOnCurrentRow(): void {
    const editor = $editorStore
    if (!editor) return
    const { state } = editor
    const selFrom = state.selection.$from
    for (let d = selFrom.depth; d >= 0; d--) {
      const node = selFrom.node(d)
      if (node.type.name === 'tableRow') {
        const rowPos = selFrom.before(d)
        editor.view.dispatch(
          state.tr.setNodeMarkup(rowPos, undefined, {
            ...node.attrs,
            repeatRegion: !node.attrs['repeatRegion'],
          })
        )
        return
      }
    }
    notify?.('표 안의 행을 클릭한 뒤 사용하세요.', 'warning')
  }

  // --------------------------------------------------------------------------
  // 이미지 업로드 핸들러 (P1-6, P0-3 검증 포함)
  // --------------------------------------------------------------------------
  function triggerImgUpload() {
    imgInput?.click()
  }

  /** 이미지 파일 1개를 검증·업로드(또는 data URL 인라인)한 뒤 문서에 삽입한다. pos 지정 시 그 위치에 넣는다. */
  function insertImageFile(file: File, pos?: number): void {
    const validation = validateImageFile(file)
    if (!validation.ok) {
      notify?.(validation.error ?? '허용되지 않는 파일 형식입니다.', 'error')
      return
    }
    // 기본 너비 200px로 삽입 (원본이 매우 클 수 있어 기본값 지정)
    const insertImage = (src: string) => {
      const node = { type: 'image', attrs: { src, width: 200, align: 'center' } }
      const e = $editorStore
      const chain = e?.chain().focus()
      if (!e || !chain) return
      if (typeof pos === 'number') chain.insertContentAt(pos, node).run()
      else if (e.state.selection instanceof NodeSelection) chain.insertContentAt(e.state.selection.to, node).run() // 선택된 이미지·칩을 덮어쓰지 않고 그 뒤에 넣는다
      else chain.insertContent(node).run()
    }
    if (uploadImage) {
      // 주입된 업로더 사용(서버 저장 URL) — 실패 시 안내만 하고 문서는 변경하지 않는다
      uploadImage(file)
        .then(({ url }) => { if (url) insertImage(url) })
        .catch((err: unknown) => notify?.(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.', 'error'))
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        if (dataUrl) insertImage(dataUrl)
      }
      reader.readAsDataURL(file)
    }
  }

  function onImgFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (file) insertImageFile(file)
    // 동일 파일 재선택 허용을 위해 value 초기화
    if (imgInput) imgInput.value = ''
  }

  // --------------------------------------------------------------------------
  // HTML 소스 보기/편집 토글 (P1-7)
  // --------------------------------------------------------------------------
  function openHtmlModal() {
    const e = $editorStore
    if (!e) return
    const doc = e.getJSON()
    htmlSource = generateHTML(doc, DOC_EDITOR_EXTENSIONS)
    showHtmlModal = true
  }

  function applyHtmlSource() {
    $editorStore?.commands.setContent(htmlSource)
    showHtmlModal = false
  }

  // --------------------------------------------------------------------------
  // 변수 칩 삽입 (P1-8) — 외부에서 접근 가능하도록 public 메서드로 노출
  // --------------------------------------------------------------------------
  export function insertMergeField(attrs: MergeFieldAttrs) {
    $editorStore?.chain().focus().insertMergeField(attrs).run()
  }

  // --------------------------------------------------------------------------
  // 문서 교체 (docx 임포트용) — HTML 문자열 또는 TipTap JSONContent 수용
  // --------------------------------------------------------------------------
  export function setEditorContent(content: string | JSONContent) {
    $editorStore?.commands.setContent(content)
  }

  // --------------------------------------------------------------------------
  // 커서 위치에 콘텐츠 삽입 (xlsx 테이블 삽입용)
  // --------------------------------------------------------------------------
  export function insertEditorContent(content: JSONContent) {
    $editorStore?.chain().focus().insertContent(content).run()
  }

  // --------------------------------------------------------------------------
  // 현재 에디터 JSON 반환 (폼 직렬화·저장용)
  // --------------------------------------------------------------------------
  export function getEditorJSON(): JSONContent | null {
    const doc = $editorStore?.getJSON()
    return doc ? fillMissingTableColwidths(doc) : null
  }

  // --------------------------------------------------------------------------
  // 현재 에디터 HTML (미리보기·저장 부가 데이터용)
  // --------------------------------------------------------------------------
  export function getEditorHTML(): string {
    const doc = $editorStore?.getJSON()
    return doc ? generateHTML(doc, DOC_EDITOR_EXTENSIONS) : ''
  }

  /** 변수 칩 삽입 — insertMergeField 의 별칭(통합 편집기 공개 API 이름) */
  export function insertVariable(attrs: MergeFieldAttrs) {
    $editorStore?.chain().focus().insertMergeField(attrs).run()
  }

  /** 편집기에 포커스 */
  export function focus() {
    $editorStore?.commands.focus()
  }
</script>

<!-- 숨겨진 이미지 파일 input (P1-6) -->
<input
  type="file"
  accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
  style="display:none"
  bind:this={imgInput}
  onchange={onImgFileChange}
  aria-label="이미지 업로드"
/>

<div class="de-wrap">
  <!-- 서식 도구 (Rich 방식 2줄 툴바 + 선택 시트) — ui/DocToolbar.svelte -->
  {#if !readonly}
    <DocToolbar
      {editorStore}
      {features}
      onPickImage={triggerImgUpload}
      onOpenSource={openHtmlModal}
      {listSignatureAssets}
      {notify}
      {zoomPercent}
      zoomMin={ZOOM_MIN}
      zoomMax={ZOOM_MAX}
      onZoom={(a) => (a === 'in' ? zoomIn() : a === 'out' ? zoomOut() : zoomReset())}
    />
    {#if features.table}
      <TableContextBar
        {editorStore}
        repeatEnabled={features.repeatRow}
        repeatActive={isInRepeatRow}
        onToggleRepeat={toggleRepeatRegionOnCurrentRow}
      />
    {/if}
  {/if}

  <!-- TipTap 에디터 영역 (P1-3) — --de-zoom CSS 변수로 확대/축소 전달(zoomPercent) -->
  <div class="de-editor-area" class:readonly style="--de-zoom: {zoomPercent}%">
    <EditorContent editor={$editorStore} class="de-editor-content" />
  </div>

</div>

<!-- HTML 소스 편집 모달 (P1-7) -->
{#if showHtmlModal}
  <div class="de-html-overlay" role="dialog" aria-modal="true" aria-label="HTML 소스 편집">
    <div class="de-html-modal">
      <div class="de-html-header">
        <span class="de-html-title">HTML 소스 편집</span>
        <button
          type="button"
          class="close-btn"
          onclick={() => { showHtmlModal = false }}
          aria-label="닫기"
        >✕</button>
      </div>
      <textarea
        class="de-html-textarea"
        bind:value={htmlSource}
        spellcheck="false"
        aria-label="HTML 소스"
      ></textarea>
      <div class="de-html-footer">
        <button type="button" class="btn-action" onclick={applyHtmlSource}>적용</button>
        <button type="button" class="btn-cancel" onclick={() => { showHtmlModal = false }}>취소</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* 전체 래퍼 */
  .de-wrap {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--de-lilac, #ECEBF4);
    border-radius: var(--de-radius-sm, 10px);
    overflow: hidden;
    background: var(--de-white, #FFFFFF);
  }

  /* 에디터 영역 — A4 용지 배경 */
  .de-editor-area {
    flex: 1;
    min-height: 360px;
    /* min-width:0 필수 — .de-wrap(column-flex)의 아이템이라 없으면 넓은 임포트 표의
       min-content 폭이 이 박스 자체를 늘려버려 .tableWrapper의 overflow-x:auto가
       무력화된다(2026-08-15 실사용 중 발견). */
    min-width: 0;
    padding: 24px 16px;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--de-surface, #F6F6F6);
  }
  /* readonly 시 배경 동일 유지 (이미 gray) */
  .de-editor-area.readonly { background: #e8e8ee; }

  /*
   * TipTap 에디터 내부 스타일 — A4 폭 용지 카드.
   * min-height:297mm — 콘텐츠가 짧으면(예: 표 하나만 임포트 직후) 용지 박스 자체가
   * 세로로 짧아져 가로가 넓은 "가로형(landscape)"처럼 보이는 문제가 있었다(2026-08-15
   * 실사용 중 발견 — 외부 브라우저에서도 재현 확인됨). A4 세로 높이(297mm)를 최소값으로
   * 고정해 콘텐츠 양과 무관하게 항상 올바른 세로형 비율로 보이게 한다(콘텐츠가 그보다
   * 길면 자연스럽게 더 길어짐 — 문서형 에디터는 페이지 분할 없이 이어지는 캔버스이므로
   * 최댓값 제한은 없음).
   * zoom:var(--de-zoom) — 확대/축소 컨트롤(zoomPercent, ContractDocumentEditor 툴바)
   */
  .de-editor-area :global(.de-editor-content) {
    width: 210mm;
    max-width: 100%;
    min-height: 297mm;
    margin: 0 auto;
    background: var(--de-white, #FFFFFF);
    box-shadow: 0 1px 2px rgba(16,11,50,.06), 0 4px 20px rgba(16,11,50,.10);
    box-sizing: border-box;
    zoom: var(--de-zoom, 100%);
  }
  .de-editor-area :global(.ProseMirror) {
    position: relative; /* overlay 이미지 absolute 배치 기준점 */
    outline: none;
    min-height: 320px;
    padding: 20mm;
    font: var(--de-font-body, 700 14px/200% sans-serif);
    color: var(--de-text, #100B32);
    line-height: 1.8;
  }

  /* 인쇄 스타일 */
  @page {
    size: A4;
    margin: 20mm;
  }
  @media print {
    .de-wrap { border: none; box-shadow: none; }
    .de-editor-area {
      padding: 0;
      background: white;
      min-height: 0;
    }
    .de-editor-area :global(.de-editor-content) {
      box-shadow: none;
      width: 100%;
      max-width: none;
      min-height: 0;
      zoom: 100%; /* 화면 확대/축소 설정과 무관하게 인쇄는 항상 실제 크기 */
    }
    .de-editor-area :global(.ProseMirror) {
      padding: 0;
      min-height: 0;
    }
  }
  .de-editor-area :global(.ProseMirror p) {
    margin: 0 0 0.5em;
  }
  .de-editor-area :global(.ProseMirror h1) { font-size: 1.5em; font-weight: 700; margin: 0.5em 0; }
  .de-editor-area :global(.ProseMirror h2) { font-size: 1.3em; font-weight: 700; margin: 0.5em 0; }
  .de-editor-area :global(.ProseMirror h3) { font-size: 1.1em; font-weight: 700; margin: 0.4em 0; }
  .de-editor-area :global(.ProseMirror ul),
  .de-editor-area :global(.ProseMirror ol) {
    padding-left: 1.4em;
    margin: 0.4em 0;
  }

  /*
   * 표 컨테이너 — resizable:true인 TipTap Table은 편집 모드에서 <table>을
   * <div class="tableWrapper">로 자동 감싼다(@tiptap/extension-table NodeView).
   * 이 래퍼에 overflow-x를 주지 않으면 넓은 표(특히 임포트된 표)가 A4 페이지 폭을
   * 그대로 뚫고 나가 페이지 자체가 깨져 보인다 — 표만 가로 스크롤되게 컨테인한다.
   */
  .de-editor-area :global(.tableWrapper) {
    overflow-x: auto;
    max-width: 100%;
  }
  /* 컬럼 리사이즈 드래그 중 커서 (prosemirror-tables columnResizing 표준 클래스) */
  .de-editor-area :global(.resize-cursor) {
    cursor: col-resize;
  }
  /*
   * 컬럼 경계 드래그 핸들 (prosemirror-tables columnResizing 표준 클래스) —
   * 기본은 스타일이 전혀 없어 거의 투명한 4px 영역이라 발견 불가능했음(기능은 이미 동작).
   */
  .de-editor-area :global(.column-resize-handle) {
    position: absolute;
    right: -2px;
    top: 0;
    bottom: -2px;
    width: 4px;
    z-index: 20;
    background-color: var(--de-purple, #3B2F8A);
    pointer-events: none;
  }

  /* 표 스타일 */
  .de-editor-area :global(.ProseMirror table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
  }
  .de-editor-area :global(.ProseMirror table th),
  .de-editor-area :global(.ProseMirror table td) {
    border: 1px solid #ddd;
    padding: 4px 6px;
    /*
     * min-width:40px(과거)는 fitColumnWidthsToTarget()의 컬럼당 최소 20px 하한과
     * 충돌했다 — 컬럼이 많은 표(예: 17열)는 17*40px=680px로 A4 본문 폭(642px)을
     * CSS 레벨에서 이미 초과해버려, JS 축소 계산이 아무리 정확해도 브라우저가 실제로는
     * 더 넓게 렌더링하는 결과로 이어졌다(2026-08-15 실사용 중 발견 — 축소 로직 자체는
     * 정상이었으나 이 CSS 하한이 그 효과를 무력화하고 있었음). JS 쪽 하한(20px)과
     * 일치시켜 충돌을 제거.
     */
    min-width: 20px;
    overflow-wrap: anywhere; /* 긴 미분리 토큰(전화번호·등록번호 등)이 컬럼폭을 강제로 넓히지 않도록 */
  }
  .de-editor-area :global(.ProseMirror table th) {
    background: var(--de-surface, #F6F6F6);
    font-weight: 700;
  }
  .de-editor-area :global(.ProseMirror .selectedCell) {
    background: rgba(59,47,138,0.08);
  }

  /*
   * 반복 영역으로 지정된 표 행(repeatRegion=true) 시각적 표시 (Stage 5).
   * CustomTableRow의 renderHTML이 data-repeat-region="true"를 <tr>에 렌더링하고
   * 이 CSS가 그 셀들에 옅은 배경 + 하단 강조선을 적용해 에디터에서 반복 영역을 식별하게 한다.
   * 발송·인쇄 시에는 이 CSS가 적용되지 않으므로(인라인 스타일 아님) 출력에 영향 없음.
   */
  .de-editor-area :global(.ProseMirror tr[data-repeat-region="true"] td),
  .de-editor-area :global(.ProseMirror tr[data-repeat-region="true"] th) {
    background: rgba(59,47,138,0.06);
    outline: 1px dashed rgba(59,47,138,0.30);
    outline-offset: -1px;
  }

  /* 이미지 — NodeView 인라인 스타일이 이 스타일보다 우선하므로 폴백 역할만 수행 */
  .de-editor-area :global(.ProseMirror img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
  }

  /*
   * NodeView 이미지 선택 시 outline 은 img 인라인 스타일로 처리.
   * ProseMirror 기본 selectedNode 데코레이션과 중복 방지.
   */
  .de-editor-area :global(.ProseMirror .ProseMirror-selectednode) {
    outline: none !important;
  }

  /* 변수 칩 (MergeFieldNode) */
  .de-editor-area :global(.cs-merge-chip) {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    background: var(--de-purple-soft, #E1DEF3);
    border: 1px solid var(--de-purple, #3B2F8A);
    border-radius: 99px;
    font-size: 11px;
    font-weight: 700;
    color: var(--de-purple, #3B2F8A);
    cursor: default;
    user-select: none;
    white-space: nowrap;
  }
  .de-editor-area :global(.cs-merge-chip.ProseMirror-selectednode) {
    outline: 2px solid var(--de-purple, #3B2F8A);
    outline-offset: 1px;
  }

  /* 푸터 */


  /* HTML 소스 모달 */
  .de-html-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .de-html-modal {
    background: var(--de-white, #FFFFFF);
    border-radius: var(--de-radius-sm, 10px);
    width: 760px;
    max-width: 100%;
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  }
  .de-html-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--de-lilac, #ECEBF4);
    flex-shrink: 0;
  }
  .de-html-title {
    font: var(--de-font-title, 700 16px/200% sans-serif);
    font-weight: 700;
    color: var(--de-text, #100B32);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--de-text-mid, #666666);
    padding: 4px 8px;
    border-radius: var(--de-radius-xs, 8px);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--de-lilac, #ECEBF4); }
  .de-html-textarea {
    flex: 1;
    min-height: 360px;
    padding: 12px;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.6;
    border: none;
    outline: none;
    resize: none;
    color: var(--de-text, #100B32);
  }
  .de-html-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--de-lilac, #ECEBF4);
    flex-shrink: 0;
  }
  .btn-action {
    height: 32px;
    padding: 0 16px;
    background: var(--de-purple, #3B2F8A);
    color: var(--de-white, #FFFFFF);
    border: none;
    border-radius: var(--de-radius-sm, 10px);
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-action:hover { background: var(--de-purple-hover, #2E2470); }
  .btn-cancel {
    height: 32px;
    padding: 0 14px;
    border: 1px solid #ddd;
    border-radius: var(--de-radius-sm, 10px);
    background: var(--de-surface, #F6F6F6);
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    cursor: pointer;
    transition: background 0.1s;
  }
  .btn-cancel:hover { background: var(--de-lilac, #ECEBF4); }

  /* 빈 문서 안내 문구 (Placeholder 확장) */
  .de-editor-area :global(.ProseMirror p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    color: var(--de-text-mid, #666666);
    opacity: 0.6;
  }
</style>
