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

  import { csToast } from '$lib/utils/toast'
  import { validateUploadFile } from '$lib/utils/fileValidation'
  import { CustomImage, TIPTAP_CONTRACT_EXTENSIONS } from './tiptapExtensions'
  import type { TiptapDocBlock, ContractDocumentPayload, MergeFieldAttrs } from '$lib/types/contract-document'

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

        outer.appendChild(img)
        outer.appendChild(bar)

        // ── 겹치기 드래그 (ContractCanvasEditor.onFieldPointerDown 패턴) ──
        outer.addEventListener('pointerdown', (e: PointerEvent) => {
          if (!(currentAttrs['overlay'] as boolean)) return
          if (bar.contains(e.target as Node)) return // 툴바 클릭은 드래그 무시
          e.preventDefault()
          e.stopPropagation()
          outer.setPointerCapture(e.pointerId)
          isDragging = true
          const rect = outer.getBoundingClientRect()
          dragOffsetX = e.clientX - rect.left
          dragOffsetY = e.clientY - rect.top
        }, { passive: false })

        outer.addEventListener('pointermove', (e: PointerEvent) => {
          if (!isDragging) return
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
      initialContent?.doc ??
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

  // --------------------------------------------------------------------------
  // UI 상태
  // --------------------------------------------------------------------------
  let saving        = $state(false)
  let showHtmlModal = $state(false)
  let htmlSource    = $state('')
  let imgInput: HTMLInputElement | null = $state(null)

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
    return $editorStore?.getJSON() ?? null
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
      const doc = e.getJSON()
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
      <!-- 텍스트 서식 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('bold')}
          onclick={() => toggle('toggleBold')}
          title="굵게 (Ctrl+B)"
          aria-label="굵게"
        ><strong>B</strong></button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('italic')}
          onclick={() => toggle('toggleItalic')}
          title="기울임 (Ctrl+I)"
          aria-label="기울임"
        ><em>I</em></button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('underline')}
          onclick={() => toggle('toggleUnderline')}
          title="밑줄 (Ctrl+U)"
          aria-label="밑줄"
        ><u>U</u></button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('strike')}
          onclick={() => toggle('toggleStrike')}
          title="취소선"
          aria-label="취소선"
        ><s>S</s></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 정렬 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('textAlign', { textAlign: 'left' })}
          onclick={() => toggle('setTextAlign', { textAlign: 'left' })}
          title="왼쪽 정렬"
          aria-label="왼쪽 정렬"
        >≡</button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('textAlign', { textAlign: 'center' })}
          onclick={() => toggle('setTextAlign', { textAlign: 'center' })}
          title="가운데 정렬"
          aria-label="가운데 정렬"
        >≡</button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('textAlign', { textAlign: 'right' })}
          onclick={() => toggle('setTextAlign', { textAlign: 'right' })}
          title="오른쪽 정렬"
          aria-label="오른쪽 정렬"
        >≡</button>
      </div>

      <div class="cde-sep"></div>

      <!-- 목록 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('bulletList')}
          onclick={() => toggle('toggleBulletList')}
          title="글머리기호 목록"
          aria-label="글머리기호 목록"
        >•≡</button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('orderedList')}
          onclick={() => toggle('toggleOrderedList')}
          title="번호 목록"
          aria-label="번호 목록"
        >1≡</button>
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

      <!-- 링크 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('link')}
          onclick={setLink}
          title="링크 설정"
          aria-label="링크 설정"
        >🔗</button>
      </div>

      <div class="cde-sep"></div>

      <!-- 표 (P1-5) -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          onclick={insertTable}
          title="표 삽입"
          aria-label="표 삽입"
        >표+</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().addRowAfter().run()}
          title="행 추가"
          aria-label="행 추가"
        >행+</button>
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
          onclick={() => $editorStore?.chain().focus().addColumnAfter().run()}
          title="열 추가"
          aria-label="열 추가"
        >열+</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().deleteColumn().run()}
          title="열 삭제"
          aria-label="열 삭제"
        >열-</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().toggleHeaderRow().run()}
          title="헤더행 토글"
          aria-label="헤더행 토글"
        >헤더</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().deleteTable().run()}
          title="표 삭제"
          aria-label="표 삭제"
        >표-</button>
      </div>

      <div class="cde-sep"></div>

      <!-- 이미지 (P1-6) -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          onclick={triggerImgUpload}
          title="이미지 삽입"
          aria-label="이미지 삽입"
        >이미지</button>
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
          class="cde-btn"
          onclick={openHtmlModal}
          title="HTML 소스 편집"
          aria-label="HTML 소스 편집"
        >&lt;/&gt;</button>
      </div>
    </div>
  {/if}

  <!-- TipTap 에디터 영역 (P1-3) -->
  <div class="cde-editor-area" class:readonly>
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

  /* 서식 메뉴바 */
  .cde-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 6px 10px;
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
    margin: 0 4px;
  }

  .cde-btn {
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

  /* 에디터 영역 — A4 용지 배경 */
  .cde-editor-area {
    flex: 1;
    min-height: 360px;
    padding: 24px 16px;
    overflow-y: auto;
    background: var(--cs-surface-gray, #f6f6f6);
  }
  /* readonly 시 배경 동일 유지 (이미 gray) */
  .cde-editor-area.readonly { background: #e8e8ee; }

  /* TipTap 에디터 내부 스타일 — A4 폭 용지 카드 */
  .cde-editor-area :global(.cde-editor-content) {
    width: 210mm;
    max-width: 100%;
    margin: 0 auto;
    background: var(--cs-white, #fff);
    box-shadow: 0 1px 2px rgba(16,11,50,.06), 0 4px 20px rgba(16,11,50,.10);
    box-sizing: border-box;
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

  /* 표 스타일 */
  .cde-editor-area :global(.ProseMirror table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
  }
  .cde-editor-area :global(.ProseMirror table th),
  .cde-editor-area :global(.ProseMirror table td) {
    border: 1px solid #ddd;
    padding: 6px 10px;
    min-width: 40px;
  }
  .cde-editor-area :global(.ProseMirror table th) {
    background: var(--cs-surface-gray, #f6f6f6);
    font-weight: 700;
  }
  .cde-editor-area :global(.ProseMirror .selectedCell) {
    background: rgba(59,47,138,0.08);
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
