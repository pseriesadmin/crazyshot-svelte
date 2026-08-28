<script lang="ts">
  /**
   * ContractDocumentEditor.svelte — 계약 전용 TipTap flow 모드 에디터
   *
   * - CmsContentEditor.svelte 와 완전 독립 (상품설명·크레이지로그 공용 컴포넌트 미수정)
   * - svelte-tiptap 3.x (Svelte5 지원) 기반
   * - 이미지 업로드: validateUploadFile() 필수 통과 (P0-3)
   * - 변수 칩(MergeFieldNode): 직렬화 시 {{변수명}} 원문 보장 (substituteVariables 호환)
   * - 저장: onSave(payload) 어댑터 콜백으로 위임 (Supabase 직접 import 없음, Phase 9 원칙)
   */

  import { onDestroy, untrack } from 'svelte'
  import { createEditor, EditorContent } from 'svelte-tiptap'
  import { generateHTML, type JSONContent } from '@tiptap/core'
  import { NodeSelection } from 'prosemirror-state'

  import { csToast } from '$lib/utils/toast'
  import { validateUploadFile } from '$lib/utils/fileValidation'
  import { CustomImage, TIPTAP_CONTRACT_EXTENSIONS } from './tiptapExtensions'
  import type { TiptapDocBlock, ContractDocumentPayload, MergeFieldAttrs } from '$lib/types/contract-document'
  import { ensureMaterialIconsFont } from '$lib/utils/loadMaterialIconsFont'
  import { fillMissingTableColwidths } from '$lib/utils/docImport/tableColwidthFill'

  // --------------------------------------------------------------------------
  // Props
  // --------------------------------------------------------------------------
  interface Props {
    /** 초기 문서 콘텐츠 (content_blocks JSONB에서 로드된 값) */
    initialContent?: TiptapDocBlock | null
    /**
     * 레거시 HTML 초기값 — initialContent가 null일 때 폴백으로 사용.
     * 기존 CmsContentEditor(ContentBlock 배열)로 작성된 HTML을 그대로 로드할 때 사용.
     */
    initialHtml?: string
    /** 계약서 제목 */
    title?: string
    /** 특약 조항 */
    specifications?: { key: string; value: string }[]
    /** 적용된 템플릿 ID */
    templateId?: string | null
    /** 저장 콜백 — Supabase를 직접 호출하지 않고 호출부에 위임 */
    onSave?: (payload: ContractDocumentPayload) => Promise<void>
    /** 편집 비활성화 여부 */
    readonly?: boolean
  }

  let {
    initialContent = null,
    initialHtml,
    title: titleProp = '',
    specifications: specsProp = [],
    templateId = null,
    onSave,
    readonly = false,
  }: Props = $props()

  // --------------------------------------------------------------------------
  // 에디터 extension은 tiptapExtensions.ts에서 공유 (tiptapRender.ts와 동일 설정)
  // → TIPTAP_CONTRACT_EXTENSIONS import로 대체 (위 import 블록 참조)
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // 이미지 NodeView — 에디터 전용 (generateHTML/tiptapRender.ts 경로에서는 미사용)
  //
  // 선택된 이미지 위에 플로팅 툴바를 표시:
  //   • 프리셋 버튼 (소 100px / 중 200px / 대 400px)
  //   • 너비 직접 입력 (px)
  //   • 정렬 버튼 (← 가운데 →)
  //
  // CustomImage.extend()로 width·align 속성 정의는 그대로 상속하고
  // addNodeView()만 추가. generateHTML() 측은 CustomImage 그대로 사용하므로
  // 저장된 너비·정렬 스타일이 고객 서명 화면에서도 정확히 렌더링된다.
  // --------------------------------------------------------------------------

  const ImageWithNodeView = CustomImage.extend({
    addNodeView() {
      // `this.editor` : TipTap extension context 의 editor 인스턴스
      const extEditor = this.editor

      return ({ node: initNode, getPos }: {
        node: { attrs: Record<string, unknown>; type: { name: string } }
        getPos: (() => number | undefined) | boolean
      }) => {
        let currentAttrs: Record<string, unknown> = { ...initNode.attrs }

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
          'transform:translateX(-50%);background:#fff;border:1px solid #ECEBF4;' +
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
            'font-weight:600;color:#100B32;cursor:pointer;line-height:1.4;flex-shrink:0'
          b.addEventListener('mouseenter', () => {
            if (b.dataset['state'] !== 'active') b.style.background = '#ECEBF4'
          })
          b.addEventListener('mouseleave', () => {
            if (b.dataset['state'] !== 'active') b.style.background = 'transparent'
          })
          return b
        }

        function mkSep(): HTMLSpanElement {
          const s = document.createElement('span')
          s.style.cssText = 'width:1px;height:16px;background:#ECEBF4;flex-shrink:0;align-self:center'
          return s
        }

        // ── 프리셋 크기 버튼 ──
        const presets = [
          { label: '소', px: 100 },
          { label: '중', px: 200 },
          { label: '대', px: 400 },
        ] as const

        presets.forEach(({ label, px }) => {
          const btn = mkBtn(`${label}(${px})`, `너비 ${px}px`)
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault()
            e.stopPropagation()
            dispatchAttrs({ width: px })
          })
          bar.appendChild(btn)
        })

        bar.appendChild(mkSep())

        // ── 너비 직접 입력 ──
        const widthInput = document.createElement('input')
        widthInput.type = 'number'
        widthInput.min = '20'
        widthInput.max = '1200'
        widthInput.placeholder = 'px'
        widthInput.style.cssText =
          'width:56px;height:24px;padding:0 4px;border:1px solid #ECEBF4;' +
          'border-radius:6px;font-size:11px;color:#100B32;outline:none;box-sizing:border-box;flex-shrink:0'

        widthInput.addEventListener('keydown', (e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            const w = parseInt(widthInput.value, 10)
            if (w > 0) dispatchAttrs({ width: w })
          }
        })
        widthInput.addEventListener('blur', () => {
          const w = parseInt(widthInput.value, 10)
          if (w > 0) dispatchAttrs({ width: w })
        })
        bar.appendChild(widthInput)

        bar.appendChild(mkSep())

        // ── 정렬 버튼 ──
        const alignDefs = [
          { label: '←', value: 'left', title: '왼쪽 정렬' },
          { label: '가운데', value: 'center', title: '가운데 정렬' },
          { label: '→', value: 'right', title: '오른쪽 정렬' },
        ] as const

        const alignBtns: Array<{ btn: HTMLButtonElement; value: string }> = []
        alignDefs.forEach(({ label, value, title }) => {
          const btn = mkBtn(label, title)
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault()
            e.stopPropagation()
            // 너비 입력란에 미확정 값이 있으면 함께 반영
            const inputW = parseInt(widthInput.value, 10)
            const patch: Record<string, unknown> = { align: value }
            if (inputW > 0) patch['width'] = inputW
            dispatchAttrs(patch)
          })
          bar.appendChild(btn)
          alignBtns.push({ btn, value })
        })

        bar.appendChild(mkSep())

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
            // 겹치기 ON → 현재 위치에서 absolute
            dispatchAttrs({ overlay: true, x: 0, y: 0 })
          }
        })
        bar.appendChild(overlayBtn)

        bar.appendChild(mkSep())

        // ── 삭제 버튼 (2026-08-16 — 기존엔 이미지 선택 시 삭제 수단이 전혀 없어
        //    "선택 후 Delete/Backspace 키" 외 발견 불가능했음. jspreadsheet-ce 스프레드시트
        //    모드 오버레이 삭제 버튼과 동일한 발견성으로 통일) ──
        const deleteBtn = mkBtn('✕', '이미지 삭제')
        deleteBtn.style.color = '#FF3535'
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

        outer.appendChild(img)
        outer.appendChild(bar)

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
          if (bar.contains(e.target as Node)) return
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
          const pmRect = pmEl.getBoundingClientRect()
          const imgW = outer.getBoundingClientRect().width
          const newX = Math.max(0, Math.min(Math.round(e.clientX - pmRect.left - dragOffsetX), Math.max(0, pmRect.width - imgW)))
          const newY = Math.max(0, Math.round(e.clientY - pmRect.top - dragOffsetY))
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

          // 너비 입력 값 동기화
          widthInput.value = w ? String(w) : ''

          // 정렬 버튼 활성 상태 (overlay 시 비활성화)
          alignBtns.forEach(({ btn, value }) => {
            const active = !overlay && align === value
            btn.dataset['state'] = active ? 'active' : ''
            btn.style.opacity = overlay ? '0.4' : '1'
            if (active) {
              btn.style.background = 'rgba(59,47,138,0.1)'
              btn.style.borderColor = '#3B2F8A'
              btn.style.color = '#3B2F8A'
            } else {
              btn.style.background = 'transparent'
              btn.style.borderColor = 'transparent'
              btn.style.color = '#100B32'
            }
          })

          // 겹치기 버튼 활성 상태
          overlayBtn.dataset['state'] = overlay ? 'active' : ''
          if (overlay) {
            overlayBtn.style.background = 'rgba(59,47,138,0.1)'
            overlayBtn.style.borderColor = '#3B2F8A'
            overlayBtn.style.color = '#3B2F8A'
          } else {
            overlayBtn.style.background = 'transparent'
            overlayBtn.style.borderColor = 'transparent'
            overlayBtn.style.color = '#100B32'
          }
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
            img.style.outline = '2px solid #3B2F8A'
            img.style.outlineOffset = '2px'
            bar.style.display = 'flex'
          },
          deselectNode() {
            img.style.outline = ''
            img.style.outlineOffset = ''
            bar.style.display = 'none'
          },
          /**
           * 툴바 내 이벤트는 ProseMirror 로 전파하지 않음 (input 타이핑 보호).
           * overlay 모드에서 포인터 이벤트는 드래그 핸들러가 처리 — PM에 전파 차단.
           */
          stopEvent(event: Event) {
            if (bar.contains(event.target as Node)) return true
            if (
              currentAttrs['overlay'] &&
              (event.type === 'pointerdown' ||
               event.type === 'pointermove' ||
               event.type === 'pointerup' ||
               event.type === 'pointercancel')
            ) return true
            return false
          },
          destroy() { /* 정리 없음 */ },
        }
      }
    },
  })

  /**
   * 에디터 전용 확장 목록:
   *   TIPTAP_CONTRACT_EXTENSIONS 에서 CustomImage 를 제거하고
   *   NodeView 가 추가된 ImageWithNodeView 로 교체.
   *   generateHTML()/tiptapRender.ts 는 TIPTAP_CONTRACT_EXTENSIONS 그대로 사용.
   */
  const editorExtensions = [
    ...TIPTAP_CONTRACT_EXTENSIONS.filter((e) => e !== CustomImage),
    ImageWithNodeView,
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
    content: untrack(() =>
      (initialContent?.doc ? fillMissingTableColwidths(initialContent.doc) : null) ??
      initialHtml ??
      ({ type: 'doc', content: [{ type: 'paragraph' }] } as JSONContent)
    ),
    editable: untrack(() => !readonly),
  })

  onDestroy(() => {
    $editorStore?.destroy()
  })

  // readonly prop 변경 시 TipTap 에디터 editable 상태 동기화
  $effect(() => {
    $editorStore?.setEditable(!readonly)
  })

  // 2026-08-17 편집 메뉴 UI 통일(Stephen "jspreadsheet 네이티브 툴바를 표준 디자인 UI로
  // 기준" 요청) — 툴바 아이콘이 스프레드시트 모드(ContractSpreadsheetEditor.svelte)와
  // 동일한 Google Material Icons 웹폰트에 의존한다. $effect는 마운트 이후에만
  // 실행되므로(SSR 미실행) onMount와 동일하게 안전 — 의존값이 없어 1회만 실행된다.
  $effect(() => {
    ensureMaterialIconsFont()
  })

  // --------------------------------------------------------------------------
  // UI 상태
  // --------------------------------------------------------------------------
  let saving        = $state(false)
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
  // 서명/직인 자산 삽입 팝오버 (기존 GET /api/cms/signature-assets 재사용)
  // --------------------------------------------------------------------------
  interface SigAsset {
    id: string
    asset_type: string
    image_url: string
    label: string | null
    is_default: boolean
  }

  let showSigPicker  = $state(false)
  let sigAssets      = $state<SigAsset[]>([])
  let sigLoading     = $state(false)
  let sigPickerEl: HTMLDivElement | null = $state(null)

  async function openSigPicker() {
    if (showSigPicker) {
      showSigPicker = false
      return
    }
    closeAllPickers()
    showSigPicker = true
    sigLoading = true
    try {
      const res = await fetch('/api/cms/signature-assets')
      sigAssets = res.ok ? (await res.json() as SigAsset[]) : []
    } catch {
      sigAssets = []
    } finally {
      sigLoading = false
    }
  }

  function insertSigAsset(asset: SigAsset) {
    // 기본 너비 200px (서명/직인은 원본이 크기 때문에 합리적 기본값)
    $editorStore?.chain().focus().insertContent({
      type: 'image',
      attrs: { src: asset.image_url, width: 200, align: 'center' },
    }).run()
    showSigPicker = false
  }

  // 팝오버 외부 클릭 시 닫기
  $effect(() => {
    if (!showSigPicker) return
    function onDocClick(e: MouseEvent) {
      const el = sigPickerEl
      if (el && !el.contains(e.target as Node)) {
        showSigPicker = false
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  })

  // --------------------------------------------------------------------------
  // 글꼴/글자색 피커 (2026-08-17 편집 메뉴 UI 통일 — Stephen "jspreadsheet 네이티브
  // 툴바를 표준 디자인 UI로 기준" 요청. 네이티브 툴바의 폰트·글자색 피커와 동일한
  // 선택지를 제공한다. TextStyle/Color/FontFamily 익스텐션은 tiptapExtensions.ts에
  // 이미 구성돼 있었으나(생성일 미상 — 향후 확장을 대비해 미리 추가돼 있던 것으로 보임)
  // 툴바 UI가 없어 실제로 쓸 방법이 없었다 — 새 npm 의존성 추가 없이 UI만 신규 구현.
  // --------------------------------------------------------------------------
  let showFontPicker  = $state(false)
  let showColorPicker = $state(false)
  let fontPickerEl: HTMLDivElement | null = $state(null)
  let colorPickerEl: HTMLDivElement | null = $state(null)

  /** 서명/직인·글꼴·글자색 팝오버는 동시에 하나만 열리도록 상호배타 처리 */
  function closeAllPickers(): void {
    showSigPicker = false
    showFontPicker = false
    showColorPicker = false
  }

  function toggleFontPicker(): void {
    const next = !showFontPicker
    closeAllPickers()
    showFontPicker = next
  }
  function toggleColorPicker(): void {
    const next = !showColorPicker
    closeAllPickers()
    showColorPicker = next
  }

  /** jspreadsheet 네이티브 폰트 피커와 동일한 4개 선택지(기본값/Verdana/Arial/Courier New) */
  const FONT_OPTIONS: { label: string; value: string }[] = [
    { label: '기본값',      value: '' },
    { label: 'Verdana',     value: 'Verdana' },
    { label: 'Arial',       value: 'Arial' },
    { label: 'Courier New', value: 'Courier New' },
  ]
  /** 글자색 팔레트 — CMS 브랜드 톤 일부 + 문서에서 흔히 쓰는 기본색 */
  const COLOR_SWATCHES: { label: string; value: string }[] = [
    { label: '제거', value: '' },
    { label: '검정', value: '#100B32' },
    { label: '회색', value: '#666666' },
    { label: '빨강', value: '#CF0000' },
    { label: '파랑', value: '#1D4ED8' },
    { label: '초록', value: '#16A34A' },
    { label: '보라', value: '#3B2F8A' },
    { label: '주황', value: '#FF4500' },
  ]

  function setDocFontFamily(value: string): void {
    const e = $editorStore
    if (!e) return
    if (value) e.chain().focus().setFontFamily(value).run()
    else e.chain().focus().unsetFontFamily().run()
    showFontPicker = false
  }
  function setDocColor(value: string): void {
    const e = $editorStore
    if (!e) return
    if (value) e.chain().focus().setColor(value).run()
    else e.chain().focus().unsetColor().run()
    showColorPicker = false
  }

  // 팝오버 외부 클릭 시 닫기 (글꼴·글자색 공용)
  $effect(() => {
    if (!showFontPicker && !showColorPicker) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (showFontPicker && fontPickerEl && !fontPickerEl.contains(target)) showFontPicker = false
      if (showColorPicker && colorPickerEl && !colorPickerEl.contains(target)) showColorPicker = false
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  })

  // --------------------------------------------------------------------------
  // 서식 메뉴 핸들러 (P1-4)
  // --------------------------------------------------------------------------
  function toggle(cmd: string, opts?: Record<string, unknown>) {
    const e = $editorStore
    if (!e) return
    const chain = e.chain().focus()
    // unknown 경유 캐스팅 — ChainedCommands 동적 호출 (타입 안전한 대안 없음)
    type AnyChain = Record<string, (arg?: Record<string, unknown>) => AnyChain & { run: () => boolean }>
    const anyChain = chain as unknown as AnyChain
    const fn = anyChain[cmd]
    if (fn) {
      opts ? fn.call(anyChain, opts).run() : fn.call(anyChain).run()
    }
  }

  function isActive(cmd: string, opts?: Record<string, unknown>): boolean {
    return $editorStore?.isActive(cmd, opts) ?? false
  }

  function setLink() {
    const e = $editorStore
    if (!e) return
    const prev = e.getAttributes('link')['href'] as string | undefined ?? ''
    const url  = window.prompt('링크 URL', prev)
    if (url === null) return
    if (url === '') {
      e.chain().focus().unsetLink().run()
    } else {
      e.chain().focus().setLink({ href: url }).run()
    }
  }

  // --------------------------------------------------------------------------
  // 표 삽입/편집 핸들러 (P1-5)
  // --------------------------------------------------------------------------
  function insertTable() {
    $editorStore
      ?.chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run()
  }

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
    csToast.warning('표 안의 행을 클릭한 뒤 사용하세요.')
  }

  // --------------------------------------------------------------------------
  // 이미지 업로드 핸들러 (P1-6, P0-3 검증 포함)
  // --------------------------------------------------------------------------
  function triggerImgUpload() {
    imgInput?.click()
  }

  function onImgFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    const validation = validateUploadFile(file)
    if (!validation.ok) {
      csToast.error(validation.error ?? '허용되지 않는 파일 형식입니다.')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const src = e.target?.result as string
      if (src) {
        // 기본 너비 200px로 삽입 (원본이 매우 클 수 있어 기본값 지정)
        $editorStore?.chain().focus().insertContent({
          type: 'image',
          attrs: { src, width: 200, align: 'center' },
        }).run()
      }
    }
    reader.readAsDataURL(file)
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
    htmlSource = generateHTML(doc, TIPTAP_CONTRACT_EXTENSIONS)
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
  // 저장 (onSave 어댑터 콜백)
  // --------------------------------------------------------------------------
  async function handleSave() {
    if (!onSave) return
    const e = $editorStore
    if (!e) return
    saving = true
    try {
      const doc = fillMissingTableColwidths(e.getJSON())
      const block: TiptapDocBlock = { type: 'tiptap-doc', doc }
      await onSave({
        title:          titleProp,
        contentBlocks:  [block],
        specifications: specsProp,
        templateId,
      })
    } catch (err) {
      csToast.error(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      saving = false
    }
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

<div class="cde-wrap">
  <!-- 서식 메뉴바 (P1-4, P1-5) -->
  {#if !readonly}
    <div class="cde-toolbar" role="toolbar" aria-label="서식 도구">
      <!-- 실행취소/다시실행 (2026-08-17 편집 메뉴 UI 통일 — jspreadsheet 네이티브 툴바를
           표준 디자인 UI로 기준. StarterKit이 기본 제공하는 history 익스텐션에 이미
           연결돼 있던 명령이라 신규 익스텐션·npm 설치 없이 UI만 새로 노출. -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          onclick={() => toggle('undo')}
          disabled={!($editorStore?.can().undo() ?? false)}
          title="실행취소"
          aria-label="실행취소"
        ><i class="material-icons cde-icon" aria-hidden="true">undo</i></button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          onclick={() => toggle('redo')}
          disabled={!($editorStore?.can().redo() ?? false)}
          title="다시실행"
          aria-label="다시실행"
        ><i class="material-icons cde-icon" aria-hidden="true">redo</i></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 텍스트 서식 (2026-08-17 아이콘 기반으로 재구성 — jspreadsheet 네이티브 툴바와
           동일한 Material Icons 글리프, format_bold 등은 네이티브 툴바 아이콘명과 동일) -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('bold')}
          onclick={() => toggle('toggleBold')}
          title="굵게 (Ctrl+B)"
          aria-label="굵게"
        ><i class="material-icons cde-icon" aria-hidden="true">format_bold</i></button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('italic')}
          onclick={() => toggle('toggleItalic')}
          title="기울임 (Ctrl+I)"
          aria-label="기울임"
        ><i class="material-icons cde-icon" aria-hidden="true">format_italic</i></button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('underline')}
          onclick={() => toggle('toggleUnderline')}
          title="밑줄 (Ctrl+U)"
          aria-label="밑줄"
        ><i class="material-icons cde-icon" aria-hidden="true">format_underlined</i></button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('strike')}
          onclick={() => toggle('toggleStrike')}
          title="취소선"
          aria-label="취소선"
        ><i class="material-icons cde-icon" aria-hidden="true">strikethrough_s</i></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 정렬 — format_align_left/center/right 아이콘으로 완전히 구분되는 서로 다른
           글리프 사용(2026-08-16에는 "≡" 3개가 동일해 보이던 문제를 한글 라벨로 임시
           수정했었으나, 2026-08-17 네이티브 툴바 기준 아이콘 방식으로 재작업) -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('textAlign', { textAlign: 'left' })}
          onclick={() => toggle('setTextAlign', { textAlign: 'left' })}
          title="왼쪽 정렬"
          aria-label="왼쪽 정렬"
        ><i class="material-icons cde-icon" aria-hidden="true">format_align_left</i></button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('textAlign', { textAlign: 'center' })}
          onclick={() => toggle('setTextAlign', { textAlign: 'center' })}
          title="가운데 정렬"
          aria-label="가운데 정렬"
        ><i class="material-icons cde-icon" aria-hidden="true">format_align_center</i></button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('textAlign', { textAlign: 'right' })}
          onclick={() => toggle('setTextAlign', { textAlign: 'right' })}
          title="오른쪽 정렬"
          aria-label="오른쪽 정렬"
        ><i class="material-icons cde-icon" aria-hidden="true">format_align_right</i></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 목록 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('bulletList')}
          onclick={() => toggle('toggleBulletList')}
          title="글머리기호 목록"
          aria-label="글머리기호 목록"
        ><i class="material-icons cde-icon" aria-hidden="true">format_list_bulleted</i></button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('orderedList')}
          onclick={() => toggle('toggleOrderedList')}
          title="번호 목록"
          aria-label="번호 목록"
        ><i class="material-icons cde-icon" aria-hidden="true">format_list_numbered</i></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 제목 레벨 -->
      <div class="cde-group">
        {#each [1, 2, 3] as level (level)}
          <button
            type="button"
            class="cde-btn"
            class:active={isActive('heading', { level })}
            onclick={() => toggle('toggleHeading', { level })}
            title="제목 {level}"
            aria-label="제목 {level}"
          >H{level}</button>
        {/each}
      </div>

      <div class="cde-sep"></div>

      <!-- 글꼴/글자색 (2026-08-17 신규 — jspreadsheet 네이티브 툴바의 폰트·글자색 피커와
           동일한 선택지. TextStyle/Color/FontFamily 익스텐션은 이미 구성돼 있었음. -->
      <div class="cde-pick-group" bind:this={fontPickerEl}>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={showFontPicker}
          onclick={toggleFontPicker}
          title="글꼴"
          aria-label="글꼴"
          aria-expanded={showFontPicker}
          aria-haspopup="listbox"
        ><i class="material-icons cde-icon" aria-hidden="true">font_download</i></button>
        {#if showFontPicker}
          <div class="cde-opt-popover" role="listbox" aria-label="글꼴 선택">
            <div class="cde-opt-list">
              {#each FONT_OPTIONS as opt (opt.value)}
                <button
                  type="button"
                  class="cde-opt-item"
                  role="option"
                  aria-selected={isActive('textStyle', { fontFamily: opt.value })}
                  class:active={isActive('textStyle', { fontFamily: opt.value })}
                  onclick={() => setDocFontFamily(opt.value)}
                >{opt.label}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="cde-pick-group" bind:this={colorPickerEl}>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={showColorPicker}
          onclick={toggleColorPicker}
          title="글자색"
          aria-label="글자색"
          aria-expanded={showColorPicker}
          aria-haspopup="listbox"
        ><i class="material-icons cde-icon" aria-hidden="true">format_color_text</i></button>
        {#if showColorPicker}
          <div class="cde-opt-popover" role="listbox" aria-label="글자색 선택">
            <div class="cde-color-grid">
              {#each COLOR_SWATCHES as sw (sw.value || 'none')}
                <button
                  type="button"
                  class="cde-color-swatch"
                  class:cde-color-swatch--none={!sw.value}
                  style={sw.value ? `background:${sw.value}` : undefined}
                  title={sw.label}
                  aria-label={sw.label}
                  onclick={() => setDocColor(sw.value)}
                ></button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="cde-sep"></div>

      <!-- 링크 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          class:active={isActive('link')}
          onclick={setLink}
          title="링크 설정"
          aria-label="링크 설정"
        ><i class="material-icons cde-icon" aria-hidden="true">link</i></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 표 (P1-5, 2026-08-15 중급 편집 기능 보강: 행/열 앞에 추가·셀 병합/분할·열 헤더 —
           @tiptap/extension-table가 이미 지원하는 커맨드인데 버튼이 없어 UI로 접근할 방법이
           없었음(실사용 중 "구글 워드·스프레드시트 기본 기능" 미달 제보로 발견). 표 삽입/삭제·
           병합/분할은 jspreadsheet 네이티브 툴바에 대응 아이콘이 있어 2026-08-17에 아이콘화 —
           행/열 개별 추가·삭제·헤더 토글은 대응하는 단일 아이콘이 없어 텍스트 버튼 유지
           (모호한 아이콘을 억지로 고르는 것보다 명확한 한글 약어가 오독 위험이 낮다는 판단). -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          onclick={insertTable}
          title="표 삽입"
          aria-label="표 삽입"
        ><i class="material-icons cde-icon" aria-hidden="true">grid_on</i></button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().addRowBefore().run()}
          title="행 위에 추가"
          aria-label="행 위에 추가"
        >행↑+</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().addRowAfter().run()}
          title="행 아래에 추가"
          aria-label="행 아래에 추가"
        >행↓+</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().deleteRow().run()}
          title="행 삭제"
          aria-label="행 삭제"
        >행-</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().addColumnBefore().run()}
          title="열 왼쪽에 추가"
          aria-label="열 왼쪽에 추가"
        >열←+</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().addColumnAfter().run()}
          title="열 오른쪽에 추가"
          aria-label="열 오른쪽에 추가"
        >열→+</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().deleteColumn().run()}
          title="열 삭제"
          aria-label="열 삭제"
        >열-</button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          onclick={() => $editorStore?.chain().focus().mergeCells().run()}
          title="선택한 셀 병합 (셀 여러 개를 드래그로 선택한 뒤 클릭)"
          aria-label="셀 병합"
        ><i class="material-icons cde-icon" aria-hidden="true">merge_type</i></button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          onclick={() => $editorStore?.chain().focus().splitCell().run()}
          title="병합된 셀 분할"
          aria-label="셀 분할"
        ><i class="material-icons cde-icon" aria-hidden="true">call_split</i></button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().toggleHeaderRow().run()}
          title="헤더행 토글"
          aria-label="헤더행 토글"
        >헤더행</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().toggleHeaderColumn().run()}
          title="헤더열 토글"
          aria-label="헤더열 토글"
        >헤더열</button>
        <button
          type="button"
          class="cde-btn"
          class:active={isInRepeatRow}
          onclick={toggleRepeatRegionOnCurrentRow}
          title="이 행을 반복 영역으로 지정/해제 — 계약서 발송 시 상품목록 항목별로 행이 반복됩니다"
          aria-label="반복 영역 지정/해제"
        >반복↩</button>
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          onclick={() => $editorStore?.chain().focus().deleteTable().run()}
          title="표 삭제"
          aria-label="표 삭제"
        ><i class="material-icons cde-icon" aria-hidden="true">delete</i></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 이미지 (P1-6) -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          onclick={triggerImgUpload}
          title="이미지 삽입"
          aria-label="이미지 삽입"
        ><i class="material-icons cde-icon" aria-hidden="true">image</i></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 서명/직인 삽입 (기존 GET /api/cms/signature-assets 재사용) -->
      <div class="cde-group cde-sig-group" bind:this={sigPickerEl}>
        <button
          type="button"
          class="cde-btn"
          class:active={showSigPicker}
          onclick={openSigPicker}
          title="서명/직인 이미지 삽입"
          aria-label="서명/직인 이미지 삽입"
          aria-expanded={showSigPicker}
          aria-haspopup="listbox"
        >서명/직인</button>

        {#if showSigPicker}
          <div class="cde-sig-popover" role="listbox" aria-label="서명/직인 자산 목록">
            {#if sigLoading}
              <div class="cde-sig-info">불러오는 중...</div>
            {:else if sigAssets.length === 0}
              <div class="cde-sig-info cde-sig-empty">
                등록된 서명·직인이 없습니다.<br />발행자 서명·직인 필수 토글 아래<br />'서명 &amp; 직인 이미지 등록' 버튼으로 먼저 등록하세요.
              </div>
            {:else}
              <div class="cde-sig-list">
                {#each sigAssets as asset (asset.id)}
                  <button
                    type="button"
                    class="cde-sig-item"
                    role="option"
                    aria-selected={false}
                    onclick={() => insertSigAsset(asset)}
                    aria-label="{asset.asset_type === 'signature' ? '서명' : '직인'} 삽입{asset.label ? ': ' + asset.label : ''}"
                  >
                    <img
                      src={asset.image_url}
                      alt="{asset.asset_type === 'signature' ? '서명' : '직인'} 미리보기"
                      class="cde-sig-thumb"
                    />
                    <div class="cde-sig-meta">
                      <span class="cde-sig-label">{asset.label ?? (asset.asset_type === 'signature' ? '서명' : '직인')}</span>
                      <span class="cde-sig-badge cde-sig-badge--{asset.asset_type}">{asset.asset_type === 'signature' ? '서명' : '직인'}</span>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="cde-sep"></div>

      <!-- HTML 소스 보기 (P1-7) -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn cde-icon-btn"
          onclick={openHtmlModal}
          title="HTML 소스 편집"
          aria-label="HTML 소스 편집"
        ><i class="material-icons cde-icon" aria-hidden="true">code</i></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 캔버스 확대/축소 (2026-08-15 실사용 요청) -->
      <div class="cde-group cde-zoom-group">
        <button
          type="button"
          class="cde-btn"
          onclick={zoomOut}
          disabled={zoomPercent <= ZOOM_MIN}
          title="축소"
          aria-label="캔버스 축소"
        >－</button>
        <button
          type="button"
          class="cde-btn cde-zoom-value"
          onclick={zoomReset}
          title="100%로 초기화"
          aria-label="확대·축소 배율 초기화 (현재 {zoomPercent}%)"
        >{zoomPercent}%</button>
        <button
          type="button"
          class="cde-btn"
          onclick={zoomIn}
          disabled={zoomPercent >= ZOOM_MAX}
          title="확대"
          aria-label="캔버스 확대"
        >＋</button>
      </div>
    </div>
  {/if}

  <!-- TipTap 에디터 영역 (P1-3) — --cde-zoom CSS 변수로 확대/축소 전달(zoomPercent) -->
  <div class="cde-editor-area" class:readonly style="--cde-zoom: {zoomPercent}%">
    <EditorContent editor={$editorStore} class="cde-editor-content" />
  </div>

  <!-- 저장 버튼 -->
  {#if onSave && !readonly}
    <div class="cde-footer">
      <button
        type="button"
        class="cde-btn-save btn-action"
        onclick={handleSave}
        disabled={saving}
      >
        {saving ? '저장 중...' : '저장'}
      </button>
    </div>
  {/if}
</div>

<!-- HTML 소스 편집 모달 (P1-7) -->
{#if showHtmlModal}
  <div class="cde-html-overlay" role="dialog" aria-modal="true" aria-label="HTML 소스 편집">
    <div class="cde-html-modal">
      <div class="cde-html-header">
        <span class="cde-html-title">HTML 소스 편집</span>
        <button
          type="button"
          class="close-btn"
          onclick={() => { showHtmlModal = false }}
          aria-label="닫기"
        >✕</button>
      </div>
      <textarea
        class="cde-html-textarea"
        bind:value={htmlSource}
        spellcheck="false"
        aria-label="HTML 소스"
      ></textarea>
      <div class="cde-html-footer">
        <button type="button" class="btn-action" onclick={applyHtmlSource}>적용</button>
        <button type="button" class="btn-cancel" onclick={() => { showHtmlModal = false }}>취소</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* 전체 래퍼 */
  .cde-wrap {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--cms-radius-sm, 8px);
    overflow: hidden;
    background: var(--cs-white, #fff);
  }

  /* 서식 메뉴바 — 2026-08-16 편집 메뉴 UI 통일(Stephen 요청): 그룹 간 여백을
     .cse-toolbar(스프레드시트 모드)와 동일한 밀도로 넓혀 촘촘하게 붙어 보이던
     문제를 완화 */
  .cde-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    background: var(--cs-surface-gray, #f6f6f6);
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
  }

  .cde-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .cde-sep {
    width: 1px;
    height: 18px;
    background: var(--cs-lilac, #ECEBF4);
    margin: 0 6px;
  }

  .cde-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    min-width: 28px;
    padding: 2px 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm, 8px);
    font-size: 12px;
    font-weight: 600;
    color: var(--cs-text, #100B32);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
    white-space: nowrap;
  }
  .cde-btn:hover { background: var(--cs-lilac, #ECEBF4); }
  .cde-btn.active {
    background: var(--cs-purple-op10, rgba(59,47,138,0.1));
    border-color: var(--cs-purple, #3B2F8A);
    color: var(--cs-purple, #3B2F8A);
  }
  .cde-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* 2026-08-17 편집 메뉴 UI 통일 — jspreadsheet 네이티브 툴바를 표준 디자인 UI로 기준해
     아이콘 버튼 도입(Stephen 요청). 아이콘은 스프레드시트 모드가 이미 쓰는 동일한 Google
     Material Icons 웹폰트 글리프를 재사용($lib/utils/loadMaterialIconsFont.ts 공용화). */
  .cde-icon-btn {
    padding: 2px;
  }
  .cde-icon {
    font-size: 18px;
    line-height: 1;
  }

  /* 확대/축소 컨트롤 */
  .cde-zoom-group { gap: 0; }
  .cde-zoom-value {
    min-width: 44px;
    cursor: pointer;
  }

  /* 에디터 영역 — A4 용지 배경 */
  .cde-editor-area {
    flex: 1;
    min-height: 360px;
    /* min-width:0 필수 — .cde-wrap(column-flex)의 아이템이라 없으면 넓은 임포트 표의
       min-content 폭이 이 박스 자체를 늘려버려 .tableWrapper의 overflow-x:auto가
       무력화된다(2026-08-15 실사용 중 발견). */
    min-width: 0;
    padding: 24px 16px;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--cs-surface-gray, #f6f6f6);
  }
  /* readonly 시 배경 동일 유지 (이미 gray) */
  .cde-editor-area.readonly { background: #e8e8ee; }

  /*
   * TipTap 에디터 내부 스타일 — A4 폭 용지 카드.
   * min-height:297mm — 콘텐츠가 짧으면(예: 표 하나만 임포트 직후) 용지 박스 자체가
   * 세로로 짧아져 가로가 넓은 "가로형(landscape)"처럼 보이는 문제가 있었다(2026-08-15
   * 실사용 중 발견 — 외부 브라우저에서도 재현 확인됨). A4 세로 높이(297mm)를 최소값으로
   * 고정해 콘텐츠 양과 무관하게 항상 올바른 세로형 비율로 보이게 한다(콘텐츠가 그보다
   * 길면 자연스럽게 더 길어짐 — 문서형 에디터는 페이지 분할 없이 이어지는 캔버스이므로
   * 최댓값 제한은 없음).
   * zoom:var(--cde-zoom) — 확대/축소 컨트롤(zoomPercent, ContractDocumentEditor 툴바)
   */
  .cde-editor-area :global(.cde-editor-content) {
    width: 210mm;
    max-width: 100%;
    min-height: 297mm;
    margin: 0 auto;
    background: var(--cs-white, #fff);
    box-shadow: 0 1px 2px rgba(16,11,50,.06), 0 4px 20px rgba(16,11,50,.10);
    box-sizing: border-box;
    zoom: var(--cde-zoom, 100%);
  }
  .cde-editor-area :global(.ProseMirror) {
    position: relative; /* overlay 이미지 absolute 배치 기준점 */
    outline: none;
    min-height: 320px;
    padding: 20mm;
    font: var(--text-pc-body-14, 14px);
    color: var(--cs-text, #100B32);
    line-height: 1.8;
  }

  /* 인쇄 스타일 */
  @page {
    size: A4;
    margin: 20mm;
  }
  @media print {
    .cde-wrap { border: none; box-shadow: none; }
    .cde-toolbar { display: none !important; }
    .cde-footer { display: none !important; }
    .cde-editor-area {
      padding: 0;
      background: white;
      min-height: 0;
    }
    .cde-editor-area :global(.cde-editor-content) {
      box-shadow: none;
      width: 100%;
      max-width: none;
      min-height: 0;
      zoom: 100%; /* 화면 확대/축소 설정과 무관하게 인쇄는 항상 실제 크기 */
    }
    .cde-editor-area :global(.ProseMirror) {
      padding: 0;
      min-height: 0;
    }
  }
  .cde-editor-area :global(.ProseMirror p) {
    margin: 0 0 0.5em;
  }
  .cde-editor-area :global(.ProseMirror h1) { font-size: 1.5em; font-weight: 700; margin: 0.5em 0; }
  .cde-editor-area :global(.ProseMirror h2) { font-size: 1.3em; font-weight: 700; margin: 0.5em 0; }
  .cde-editor-area :global(.ProseMirror h3) { font-size: 1.1em; font-weight: 700; margin: 0.4em 0; }
  .cde-editor-area :global(.ProseMirror ul),
  .cde-editor-area :global(.ProseMirror ol) {
    padding-left: 1.4em;
    margin: 0.4em 0;
  }

  /*
   * 표 컨테이너 — resizable:true인 TipTap Table은 편집 모드에서 <table>을
   * <div class="tableWrapper">로 자동 감싼다(@tiptap/extension-table NodeView).
   * 이 래퍼에 overflow-x를 주지 않으면 넓은 표(특히 임포트된 표)가 A4 페이지 폭을
   * 그대로 뚫고 나가 페이지 자체가 깨져 보인다 — 표만 가로 스크롤되게 컨테인한다.
   */
  .cde-editor-area :global(.tableWrapper) {
    overflow-x: auto;
    max-width: 100%;
  }
  /* 컬럼 리사이즈 드래그 중 커서 (prosemirror-tables columnResizing 표준 클래스) */
  .cde-editor-area :global(.resize-cursor) {
    cursor: col-resize;
  }
  /*
   * 컬럼 경계 드래그 핸들 (prosemirror-tables columnResizing 표준 클래스) —
   * 기본은 스타일이 전혀 없어 거의 투명한 4px 영역이라 발견 불가능했음(기능은 이미 동작).
   */
  .cde-editor-area :global(.column-resize-handle) {
    position: absolute;
    right: -2px;
    top: 0;
    bottom: -2px;
    width: 4px;
    z-index: 20;
    background-color: var(--cs-purple, #3B2F8A);
    pointer-events: none;
  }

  /* 표 스타일 */
  .cde-editor-area :global(.ProseMirror table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
  }
  .cde-editor-area :global(.ProseMirror table th),
  .cde-editor-area :global(.ProseMirror table td) {
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
  .cde-editor-area :global(.ProseMirror table th) {
    background: var(--cs-surface-gray, #f6f6f6);
    font-weight: 700;
  }
  .cde-editor-area :global(.ProseMirror .selectedCell) {
    background: rgba(59,47,138,0.08);
  }

  /*
   * 반복 영역으로 지정된 표 행(repeatRegion=true) 시각적 표시 (Stage 5).
   * CustomTableRow의 renderHTML이 data-repeat-region="true"를 <tr>에 렌더링하고
   * 이 CSS가 그 셀들에 옅은 배경 + 하단 강조선을 적용해 에디터에서 반복 영역을 식별하게 한다.
   * 발송·인쇄 시에는 이 CSS가 적용되지 않으므로(인라인 스타일 아님) 출력에 영향 없음.
   */
  .cde-editor-area :global(.ProseMirror tr[data-repeat-region="true"] td),
  .cde-editor-area :global(.ProseMirror tr[data-repeat-region="true"] th) {
    background: rgba(59,47,138,0.06);
    outline: 1px dashed rgba(59,47,138,0.30);
    outline-offset: -1px;
  }

  /* 이미지 — NodeView 인라인 스타일이 이 스타일보다 우선하므로 폴백 역할만 수행 */
  .cde-editor-area :global(.ProseMirror img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
  }

  /*
   * NodeView 이미지 선택 시 outline 은 img 인라인 스타일로 처리.
   * ProseMirror 기본 selectedNode 데코레이션과 중복 방지.
   */
  .cde-editor-area :global(.ProseMirror .ProseMirror-selectednode) {
    outline: none !important;
  }

  /* 변수 칩 (MergeFieldNode) */
  .cde-editor-area :global(.cs-merge-chip) {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    background: var(--cs-purple-op10, rgba(59,47,138,0.1));
    border: 1px solid var(--cs-purple, #3B2F8A);
    border-radius: 99px;
    font-size: 11px;
    font-weight: 700;
    color: var(--cs-purple, #3B2F8A);
    cursor: default;
    user-select: none;
    white-space: nowrap;
  }
  .cde-editor-area :global(.cs-merge-chip.ProseMirror-selectednode) {
    outline: 2px solid var(--cs-purple, #3B2F8A);
    outline-offset: 1px;
  }

  /* 푸터 */
  .cde-footer {
    display: flex;
    justify-content: flex-end;
    padding: 8px 12px;
    border-top: 1px solid var(--cs-lilac, #ECEBF4);
    background: var(--cs-surface-gray, #f6f6f6);
  }

  .cde-btn-save {
    height: 32px;
    padding: 0 20px;
    background: var(--cs-purple, #3B2F8A);
    color: var(--cs-white, #fff);
    border: none;
    border-radius: var(--cms-radius-sm, 8px);
    font: var(--text-pc-body-14, 14px);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .cde-btn-save:hover:not(:disabled) { background: var(--cs-purple-hover, #2d2470); }
  .cde-btn-save:disabled { background: var(--cs-disabled-button, #ccc); cursor: not-allowed; }

  /* HTML 소스 모달 */
  .cde-html-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .cde-html-modal {
    background: var(--cs-white, #fff);
    border-radius: var(--cms-radius-sm, 8px);
    width: 760px;
    max-width: 100%;
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  }
  .cde-html-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }
  .cde-html-title {
    font: var(--text-pc-title-16, 16px);
    font-weight: 700;
    color: var(--cs-text, #100B32);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--cs-text-mid, #666);
    padding: 4px 8px;
    border-radius: var(--radius-sm, 8px);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--cs-lilac, #ECEBF4); }
  .cde-html-textarea {
    flex: 1;
    min-height: 360px;
    padding: 12px;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.6;
    border: none;
    outline: none;
    resize: none;
    color: var(--cs-text, #100B32);
  }
  .cde-html-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }
  .btn-action {
    height: 32px;
    padding: 0 16px;
    background: var(--cs-purple, #3B2F8A);
    color: var(--cs-white, #fff);
    border: none;
    border-radius: var(--cms-radius-sm, 8px);
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-action:hover { background: var(--cs-purple-hover, #2d2470); }
  .btn-cancel {
    height: 32px;
    padding: 0 14px;
    border: 1px solid #ddd;
    border-radius: var(--cms-radius-sm, 8px);
    background: var(--cs-surface-gray, #f6f6f6);
    font: var(--text-pc-script-12, 12px);
    cursor: pointer;
    transition: background 0.1s;
  }
  .btn-cancel:hover { background: var(--cs-lilac, #ECEBF4); }

  /* ── 글꼴/글자색 팝오버 (2026-08-17 신규) — 서명/직인 팝오버와 동일 크롬 ── */
  .cde-pick-group {
    position: relative;
  }
  .cde-opt-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 200;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--cms-radius-sm, 8px);
    box-shadow: 0 4px 16px rgba(16, 11, 50, 0.12);
    min-width: 140px;
    overflow: hidden;
  }
  .cde-opt-list {
    display: flex;
    flex-direction: column;
    max-height: 240px;
    overflow-y: auto;
    padding: 4px;
  }
  .cde-opt-item {
    padding: 8px 10px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--cms-radius-sm, 8px);
    font-size: 12px;
    color: var(--cs-text, #100B32);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: background 0.1s, border-color 0.1s;
  }
  .cde-opt-item:hover {
    background: var(--cs-lilac, #ECEBF4);
    border-color: var(--cs-lilac, #ECEBF4);
  }
  .cde-opt-item.active {
    background: var(--cs-purple-op10, rgba(59,47,138,0.1));
    border-color: var(--cs-purple, #3B2F8A);
    color: var(--cs-purple, #3B2F8A);
  }
  .cde-color-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px;
    width: 160px;
  }
  .cde-color-swatch {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 1px solid rgba(16, 11, 50, 0.15);
    cursor: pointer;
    padding: 0;
    transition: transform 0.1s, border-color 0.1s;
  }
  .cde-color-swatch:hover {
    transform: scale(1.1);
    border-color: var(--cs-purple, #3B2F8A);
  }
  /* "제거" 스와치 — 대각선으로 표시 */
  .cde-color-swatch--none {
    background:
      linear-gradient(to top left, transparent calc(50% - 1px), var(--cs-red-badge, #FF3535) calc(50% - 1px), var(--cs-red-badge, #FF3535) calc(50% + 1px), transparent calc(50% + 1px)),
      var(--cs-surface-gray, #f6f6f6);
  }

  /* ── 서명/직인 삽입 팝오버 ── */
  .cde-sig-group {
    position: relative;
  }

  .cde-sig-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 200;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--cms-radius-sm, 8px);
    box-shadow: 0 4px 16px rgba(16, 11, 50, 0.12);
    min-width: 220px;
    max-width: 320px;
    overflow: hidden;
  }

  .cde-sig-info {
    padding: 14px 16px;
    font-size: 12px;
    color: var(--cs-text-mid, #666);
    line-height: 1.6;
    text-align: center;
  }

  .cde-sig-empty {
    color: var(--cs-text-mid, #666);
  }

  .cde-sig-list {
    display: flex;
    flex-direction: column;
    max-height: 280px;
    overflow-y: auto;
    padding: 4px;
  }

  .cde-sig-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--cms-radius-sm, 8px);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, border-color 0.1s;
    width: 100%;
  }
  .cde-sig-item:hover {
    background: var(--cs-lilac, #ECEBF4);
    border-color: var(--cs-lilac, #ECEBF4);
  }

  .cde-sig-thumb {
    width: 48px;
    height: 32px;
    object-fit: contain;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: 4px;
    background: #fafafa;
    flex-shrink: 0;
  }

  .cde-sig-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .cde-sig-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--cs-text, #100B32);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cde-sig-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 99px;
    line-height: 1.4;
  }
  .cde-sig-badge--signature {
    background: rgba(59, 47, 138, 0.08);
    color: var(--cs-purple, #3B2F8A);
  }
  .cde-sig-badge--seal {
    background: rgba(16, 11, 50, 0.07);
    color: var(--cs-text, #100B32);
  }
</style>
