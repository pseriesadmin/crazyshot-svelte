<script lang="ts">
  /**
   * DocToolbar.svelte — 통합 편집기 상단 툴바 + 선택 시트 (doc-editor ui, 이식형)
   *
   * 이관 원본: src/lib/components/editor/RichContentEditor.svelte 의 PC 툴바·선택 시트(서체·글자색·문단 유형·링크·표·이모지)
   * UI 로직(원본은 무변경 유지) — 1줄: 서식 / 2줄: 삽입. 시트는 눌린 버튼 아래(공간이 없으면 위)에 뜨는 고정 위치 팝오버.
   * 계약서 편집 고유 기능(서명/직인·HTML 소스·줌)은 2줄 쪽에 추가했다. 표 편집 도구는 TableContextBar(떠 있는 도구줄)가 맡는다.
   * 모바일 하단 바는 포함하지 않는다(문서·양식 편집은 PC 화면 기준).
   * 모든 호스트 의존은 props 주입이다(notify·listSignatureAssets).
   */
  import type { Readable } from 'svelte/store'
  import type { Editor } from '@tiptap/core'
  import { NodeSelection } from '@tiptap/pm/state'
  import Icon from './Icon.svelte'
  import { FONTS, SIZE_PRESETS, DEFAULT_SIZE, COLORS, EMOJI_LIST, normalizeUrl } from './toolbarData'
  import type { DocEditorFeatures } from './features'
  import type { SignatureAsset } from '../core/types'

  interface Props {
    editorStore: Readable<Editor | undefined>
    features: DocEditorFeatures
    onPickImage: () => void
    onOpenSource: () => void
    listSignatureAssets?: () => Promise<SignatureAsset[]>
    notify?: (message: string, level: 'warning' | 'error' | 'info') => void
    zoomPercent: number
    zoomMin: number
    zoomMax: number
    onZoom: (action: 'in' | 'out' | 'reset') => void
  }

  let {
    editorStore, features, onPickImage, onOpenSource, listSignatureAssets, notify,
    zoomPercent, zoomMin, zoomMax, onZoom,
  }: Props = $props()

  // ── 시트(팝오버) 상태 ───────────────────────────────
  let sheet = $state<string | null>(null)
  let sheetX = $state(0)
  let sheetY = $state(0)
  let linkUrl = $state('')
  let tableRows = $state(3)
  let tableCols = $state(3)

  let sigAssets = $state<SignatureAsset[]>([])
  let sigLoading = $state(false)

  // ── 툴바 상태(트랜잭션마다 $editorStore 가 다시 방출돼 템플릿이 갱신된다) ─────────
  function act(name: string, attrs?: Record<string, unknown>): boolean {
    return $editorStore?.isActive(name, attrs) ?? false
  }

  function curSize(): number {
    const v = $editorStore?.getAttributes('textStyle')['fontSize'] as string | undefined
    const n = v ? parseFloat(v) : NaN
    if (!Number.isFinite(n)) return DEFAULT_SIZE
    // 한글·워드에서 가져온 문서는 pt 단위(13pt)다 — 표시·증감 기준을 px 로 맞춘다(1pt = 4/3px). 안 맞추면 13pt 에서 +를 눌러 14px(더 작은 글자)로 줄어든다
    if (/pt\s*$/i.test(v ?? '')) return Math.round((n * 4) / 3)
    // px(또는 단위 없는 숫자)만 그대로 읽는다 — em·rem·% 는 기준 크기를 알 수 없어 기본값으로 표시(1.2em 이 '1'로 보이지 않게)
    return /^\s*[\d.]+\s*(px)?\s*$/i.test(v ?? '') ? Math.round(n) : DEFAULT_SIZE
  }

  function curFamilyLabel(): string {
    const v = ($editorStore?.getAttributes('textStyle')['fontFamily'] as string | undefined) ?? ''
    return FONTS.find((f) => f.value === v)?.label ?? (v ? '사용자 서체' : '기본 서체')
  }

  function curParaLabel(): string {
    const e = $editorStore
    if (!e) return '본문'
    if (e.isActive('heading', { level: 1 })) return '제목1'
    if (e.isActive('heading', { level: 2 })) return '제목2'
    if (e.isActive('heading', { level: 3 })) return '제목3'
    if (e.isActive('blockquote')) return '인용'
    return '본문'
  }

  // ── 명령 ────────────────────────────────────────────
  /** 동적 명령 호출 — 확장이 등록돼 있을 때만 존재하는 명령(setFontSize 등)을 타입 없이 호출 */
  function runOptional(name: string, arg?: unknown): void {
    const e = $editorStore
    if (!e) return
    type AnyChain = Record<string, ((a?: unknown) => AnyChain) | (() => boolean)>
    const chain = e.chain().focus() as unknown as AnyChain
    const fn = chain[name] as ((a?: unknown) => AnyChain) | undefined
    if (typeof fn !== 'function') return
    const next = arg === undefined ? fn.call(chain) : fn.call(chain, arg)
    ;(next['run'] as () => boolean)()
  }

  function applySize(px: number) {
    const v = Math.max(8, Math.min(72, Math.round(px)))
    runOptional('setFontSize', `${v}px`)
  }

  function applyFont(value: string) {
    const e = $editorStore
    if (!e) return
    if (value) e.chain().focus().setFontFamily(value).run()
    else e.chain().focus().unsetFontFamily().run()
    sheet = null
  }

  function applyColor(c: string | null, kind: 'color' | 'bg') {
    const e = $editorStore
    if (!e) return
    if (kind === 'color') {
      if (c) e.chain().focus().setColor(c).run()
      else e.chain().focus().unsetColor().run()
    } else {
      runOptional(c ? 'setBackgroundColor' : 'unsetBackgroundColor', c ?? undefined)
    }
    sheet = null
  }

  function setPara(kind: 'p' | 'h1' | 'h2' | 'h3' | 'quote') {
    const e = $editorStore
    if (!e) return
    const c = e.chain().focus()
    if (kind === 'p') {
      if (e.isActive('blockquote')) c.lift('blockquote').setParagraph().run()
      else c.setParagraph().run()
    } else if (kind === 'quote') c.toggleBlockquote().run()
    else c.toggleHeading({ level: kind === 'h1' ? 1 : kind === 'h2' ? 2 : 3 }).run()
    sheet = null
  }

  function indent(dir: 1 | -1) {
    const e = $editorStore
    if (!e) return
    if (e.isActive('listItem')) {
      const c = e.chain().focus()
      ;(dir === 1 ? c.sinkListItem('listItem') : c.liftListItem('listItem')).run()
    } else {
      runOptional(dir === 1 ? 'indentBlock' : 'outdentBlock')
    }
  }

  function clearFormat() {
    $editorStore?.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run()
    sheet = null
  }

  function applyLink() {
    const e = $editorStore
    if (!e) return
    const href = normalizeUrl(linkUrl)
    if (!href) {
      notify?.('http://, https://, mailto:, tel: 형식의 주소를 입력해주세요.', 'warning')
      return
    }
    if (e.state.selection.empty && !e.isActive('link')) {
      e.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else {
      e.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    sheet = null
  }

  function removeLink() {
    $editorStore?.chain().focus().extendMarkRange('link').unsetLink().run()
    sheet = null
  }

  /** 노드 선택 상태에서 표·이모지·구분선 같은 삽입이 노드를 덮어쓰지 않도록, 선택을 노드 뒤로 옮긴다. */
  function leaveNodeSelection() {
    const e = $editorStore
    if (!e) return
    const sel = e.state.selection
    if (sel instanceof NodeSelection) e.commands.setTextSelection(sel.to)
  }

  function insertContent(content: Record<string, unknown>) {
    const e = $editorStore
    if (!e) return
    const chain = e.chain().focus()
    const sel = e.state.selection
    if (sel instanceof NodeSelection) chain.insertContentAt(sel.to, content).run()
    else chain.insertContent(content).run()
  }

  function applyTable() {
    const rows = Math.max(1, Math.min(10, Math.round(tableRows) || 3))
    const cols = Math.max(1, Math.min(6, Math.round(tableCols) || 3))
    leaveNodeSelection()
    $editorStore?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
    sheet = null
  }

  function insertEmoji(em: string) {
    leaveNodeSelection()
    $editorStore?.chain().focus().insertContent(em).run()
    sheet = null
  }

  function insertSigAsset(asset: SignatureAsset) {
    // 기본 너비 200px (서명/직인은 원본이 크기 때문에 합리적 기본값)
    // 이미지·칩이 선택돼 있으면 덮어쓰지 않고 그 뒤에 넣는다(insertContent 헬퍼)
    insertContent({ type: 'image', attrs: { src: asset.imageUrl, width: 200, align: 'center' } })
    sheet = null
  }

  async function loadSigAssets() {
    sigLoading = true
    try {
      sigAssets = listSignatureAssets ? await listSignatureAssets() : []
    } catch {
      sigAssets = []
    } finally {
      sigLoading = false
    }
  }

  // ── 시트 열기/닫기 ──────────────────────────────────
  function openSheet(name: string, e?: Event) {
    if (sheet === name) {
      sheet = null
      return
    }
    if (name === 'link' && $editorStore) linkUrl = ($editorStore.getAttributes('link')['href'] as string | undefined) ?? ''
    if (name === 'sig') void loadSigAssets()
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
    if (t?.closest('.dt-sheet, [data-sheet-btn]')) return
    sheet = null
  }

  function onKeyDownWindow(e: KeyboardEvent) {
    if (e.key === 'Escape' && sheet) sheet = null
  }

  /** 툴바 클릭이 에디터 포커스·선택을 빼앗지 않게 한다(입력 요소는 제외). */
  function keepSelection(e: Event) {
    const t = e.target as HTMLElement | null
    if (t && t.closest('input, textarea, select')) return
    e.preventDefault()
  }

  const SHEET_TITLES: Record<string, string> = {
    font: '서체', size: '글자 크기', color: '글자색', bg: '배경색', para: '문단 유형',
    link: '링크', emoji: '이모지', table: '표 삽입', sig: '서명/직인',
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onKeyDownWindow} />

<div class="dt-wrap" role="toolbar" aria-label="서식 도구" tabindex="-1" onmousedown={keepSelection} onpointerdown={keepSelection}>
  <div class="dt-toolbar dt-toolbar-fmt">
    <button type="button" class="dt-btn" aria-label="실행취소" title="실행취소 (Ctrl+Z)" disabled={!$editorStore || !$editorStore.can().undo()} onclick={() => $editorStore?.chain().focus().undo().run()}><Icon name="undo" /></button>
    <button type="button" class="dt-btn" aria-label="다시실행" title="다시실행 (Ctrl+Shift+Z)" disabled={!$editorStore || !$editorStore.can().redo()} onclick={() => $editorStore?.chain().focus().redo().run()}><Icon name="redo" /></button>
    <span class="dt-sep"></span>

    {#if features.fontColor}
      <button type="button" class="dt-btn dt-btn-wide dt-drop" data-sheet-btn aria-label="서체" disabled={!$editorStore} onclick={(e) => openSheet('font', e)}>{curFamilyLabel()}<span class="dt-caret" aria-hidden="true">▾</span></button>
    {/if}
    {#if features.fontSize}
      <div class="dt-size" role="group" aria-label="글자 크기">
        <button type="button" class="dt-btn dt-size-step" aria-label="글자 작게" disabled={!$editorStore} onclick={() => applySize(curSize() - 1)}>−</button>
        <button type="button" class="dt-size-val" data-sheet-btn aria-label="글자 크기 목록" disabled={!$editorStore} onclick={(e) => openSheet('size', e)}>{curSize()}</button>
        <button type="button" class="dt-btn dt-size-step" aria-label="글자 크게" disabled={!$editorStore} onclick={() => applySize(curSize() + 1)}>+</button>
      </div>
    {/if}
    {#if features.fontColor || features.fontSize}<span class="dt-sep"></span>{/if}

    {#if features.fontColor}
      <button type="button" class="dt-btn" data-sheet-btn aria-label="글자색" title="글자색" disabled={!$editorStore} onclick={(e) => openSheet('color', e)}><span class="dt-glyph dt-glyph-color">A</span></button>
    {/if}
    {#if features.bgColor}
      <button type="button" class="dt-btn" data-sheet-btn aria-label="배경색" title="배경색" disabled={!$editorStore} onclick={(e) => openSheet('bg', e)}><span class="dt-glyph dt-glyph-bg">A</span></button>
    {/if}
    {#if features.fontColor || features.bgColor}<span class="dt-sep"></span>{/if}

    <button type="button" class="dt-btn dt-glyph-b" aria-label="굵게" title="굵게 (Ctrl+B)" aria-pressed={act('bold')} class:dt-btn-active={act('bold')} disabled={!$editorStore} onclick={() => $editorStore?.chain().focus().toggleBold().run()}><b>B</b></button>
    <button type="button" class="dt-btn" aria-label="기울임" title="기울임 (Ctrl+I)" aria-pressed={act('italic')} class:dt-btn-active={act('italic')} disabled={!$editorStore} onclick={() => $editorStore?.chain().focus().toggleItalic().run()}><i>I</i></button>
    <button type="button" class="dt-btn" aria-label="밑줄" title="밑줄 (Ctrl+U)" aria-pressed={act('underline')} class:dt-btn-active={act('underline')} disabled={!$editorStore} onclick={() => $editorStore?.chain().focus().toggleUnderline().run()}><u>U</u></button>
    <button type="button" class="dt-btn" aria-label="취소선" title="취소선" aria-pressed={act('strike')} class:dt-btn-active={act('strike')} disabled={!$editorStore} onclick={() => $editorStore?.chain().focus().toggleStrike().run()}><s>S</s></button>
    <span class="dt-sep"></span>

    {#each [['left', 'alignLeft', '왼쪽 정렬'], ['center', 'alignCenter', '가운데 정렬'], ['right', 'alignRight', '오른쪽 정렬'], ['justify', 'alignJustify', '양쪽 정렬']] as [v, ic, label] (v)}
      <button type="button" class="dt-btn" aria-label={label} title={label} aria-pressed={act('paragraph', { textAlign: v }) || act('heading', { textAlign: v })} class:dt-btn-active={act('paragraph', { textAlign: v }) || act('heading', { textAlign: v })} disabled={!$editorStore} onclick={() => $editorStore?.chain().focus().setTextAlign(v).run()}><Icon name={ic} /></button>
    {/each}
    <span class="dt-sep"></span>

    <button type="button" class="dt-btn" aria-label="글머리 목록" title="글머리 목록" aria-pressed={act('bulletList')} class:dt-btn-active={act('bulletList')} disabled={!$editorStore} onclick={() => $editorStore?.chain().focus().toggleBulletList().run()}><Icon name="ul" /></button>
    <button type="button" class="dt-btn" aria-label="번호 목록" title="번호 목록" aria-pressed={act('orderedList')} class:dt-btn-active={act('orderedList')} disabled={!$editorStore} onclick={() => $editorStore?.chain().focus().toggleOrderedList().run()}><Icon name="ol" /></button>
    {#if features.indent}
      <button type="button" class="dt-btn" aria-label="들여쓰기" title="들여쓰기" disabled={!$editorStore} onclick={() => indent(1)}><Icon name="indent" /></button>
      <button type="button" class="dt-btn" aria-label="내어쓰기" title="내어쓰기" disabled={!$editorStore} onclick={() => indent(-1)}><Icon name="outdent" /></button>
    {/if}
    <span class="dt-sep"></span>

    {#if features.paragraph}
      <button type="button" class="dt-btn dt-btn-wide dt-drop" data-sheet-btn aria-label="문단 유형" disabled={!$editorStore} onclick={(e) => openSheet('para', e)}>{curParaLabel()}<span class="dt-caret" aria-hidden="true">▾</span></button>
    {/if}
    {#if features.link}
      <button type="button" class="dt-btn" data-sheet-btn aria-label="링크" title="링크" aria-pressed={act('link')} class:dt-btn-active={act('link')} disabled={!$editorStore} onclick={(e) => openSheet('link', e)}><Icon name="link" /></button>
    {/if}
    {#if features.paragraph}
      <button type="button" class="dt-btn dt-btn-wide" aria-label="서식 지우기" title="서식 지우기" disabled={!$editorStore} onclick={clearFormat}>서식 지우기</button>
    {/if}
  </div>

  <div class="dt-toolbar dt-toolbar-ins">
    {#if features.image}
      <button type="button" class="dt-btn dt-btn-wide" aria-label="사진" disabled={!$editorStore} onclick={onPickImage}><Icon name="photo" /><span>사진</span></button>
    {/if}
    {#if features.emoji}
      <button type="button" class="dt-btn dt-btn-wide" data-sheet-btn aria-label="이모지" disabled={!$editorStore} onclick={(e) => openSheet('emoji', e)}><Icon name="emoji" /><span>이모지</span></button>
    {/if}
    {#if features.table}
      <button type="button" class="dt-btn dt-btn-wide" data-sheet-btn aria-label="표" disabled={!$editorStore} onclick={(e) => openSheet('table', e)}><Icon name="table" /><span>표</span></button>
    {/if}
    {#if features.divider}
      <button type="button" class="dt-btn dt-btn-wide" aria-label="구분선" disabled={!$editorStore} onclick={() => { leaveNodeSelection(); insertContent({ type: 'horizontalRule' }) }}><Icon name="divider" /><span>구분선</span></button>
    {/if}
    {#if features.signature}
      <button type="button" class="dt-btn dt-btn-wide" data-sheet-btn aria-label="서명/직인 이미지 삽입" title="서명/직인 이미지 삽입" disabled={!$editorStore} onclick={(e) => openSheet('sig', e)}><Icon name="signature" /><span>서명/직인</span></button>
    {/if}
    {#if features.source}
      <button type="button" class="dt-btn dt-btn-wide" aria-label="HTML 소스 편집" title="HTML 소스 편집" disabled={!$editorStore} onclick={onOpenSource}><Icon name="source" /><span>HTML</span></button>
    {/if}
    {#if features.zoom}
      <div class="dt-zoom" role="group" aria-label="확대·축소">
        <button type="button" class="dt-btn" onclick={() => onZoom('out')} disabled={zoomPercent <= zoomMin} title="축소" aria-label="캔버스 축소">－</button>
        <button type="button" class="dt-btn dt-zoom-value" onclick={() => onZoom('reset')} title="100%로 초기화" aria-label="확대·축소 배율 초기화 (현재 {zoomPercent}%)">{zoomPercent}%</button>
        <button type="button" class="dt-btn" onclick={() => onZoom('in')} disabled={zoomPercent >= zoomMax} title="확대" aria-label="캔버스 확대">＋</button>
      </div>
    {/if}
  </div>
</div>

{#if sheet}
  <div
    class="dt-sheet"
    style={`left: ${sheetX}px; top: ${sheetY}px`}
    role="dialog"
    aria-label="서식 선택"
    tabindex="-1"
    onmousedown={keepSelection}
    onpointerdown={keepSelection}
  >
    <div class="dt-sheet-head">
      <span class="dt-sheet-title">{SHEET_TITLES[sheet] ?? ''}</span>
      <button type="button" class="dt-sheet-close" aria-label="닫기" onclick={() => (sheet = null)}>✕</button>
    </div>

    {#if sheet === 'font'}
      <ul class="dt-list">
        {#each FONTS as f (f.label)}
          <li><button type="button" class="dt-list-item" style={f.value ? `font-family: ${f.value}` : ''} onclick={() => applyFont(f.value)}>{f.label}</button></li>
        {/each}
      </ul>
    {:else if sheet === 'size'}
      <div class="dt-chips">
        {#each SIZE_PRESETS as s (s)}
          <button type="button" class="dt-chipbtn" class:dt-chipbtn-on={curSize() === s} onclick={() => { applySize(s); sheet = null }}>{s}</button>
        {/each}
      </div>
      <div class="dt-size dt-size-sheet" role="group" aria-label="글자 크기 미세 조정">
        <button type="button" class="dt-btn dt-size-step" aria-label="글자 작게" onclick={() => applySize(curSize() - 1)}>−</button>
        <span class="dt-size-num">{curSize()}px</span>
        <button type="button" class="dt-btn dt-size-step" aria-label="글자 크게" onclick={() => applySize(curSize() + 1)}>+</button>
      </div>
    {:else if sheet === 'color' || sheet === 'bg'}
      <div class="dt-palette">
        {#each COLORS as c (c)}
          <button type="button" class="dt-swatch" style={`background:${c}`} aria-label={`${c} 적용`} onclick={() => applyColor(c, sheet === 'color' ? 'color' : 'bg')}></button>
        {/each}
      </div>
      <button type="button" class="dt-chipbtn dt-chipbtn-wide" onclick={() => applyColor(null, sheet === 'color' ? 'color' : 'bg')}>{sheet === 'color' ? '기본 글자색' : '배경색 없음'}</button>
    {:else if sheet === 'para'}
      <ul class="dt-list">
        <li><button type="button" class="dt-list-item" onclick={() => setPara('p')}>본문</button></li>
        <li><button type="button" class="dt-list-item dt-list-h1" onclick={() => setPara('h1')}>제목1</button></li>
        <li><button type="button" class="dt-list-item dt-list-h2" onclick={() => setPara('h2')}>제목2</button></li>
        <li><button type="button" class="dt-list-item dt-list-h3" onclick={() => setPara('h3')}>제목3</button></li>
        <li><button type="button" class="dt-list-item" onclick={() => setPara('quote')}>인용</button></li>
      </ul>
    {:else if sheet === 'link'}
      <!-- novalidate: 브라우저 기본 URL 검사는 'example.com'처럼 스킴 없는 주소를 막는다 — 주소 정리·검증은 normalizeUrl 이 한다 -->
        <form class="dt-form" novalidate onsubmit={(e) => { e.preventDefault(); applyLink() }}>
        <input class="dt-input" type="url" inputmode="url" placeholder="https://..." bind:value={linkUrl} aria-label="링크 주소" />
        <div class="dt-form-row">
          <button type="submit" class="dt-chipbtn dt-chipbtn-on">적용</button>
          {#if act('link')}<button type="button" class="dt-chipbtn" onclick={removeLink}>링크 해제</button>{/if}
        </div>
      </form>
    {:else if sheet === 'table'}
      <form class="dt-form" onsubmit={(e) => { e.preventDefault(); applyTable() }}>
        <label class="dt-label">행 <input class="dt-input dt-input-num" type="number" min="1" max="10" bind:value={tableRows} /></label>
        <label class="dt-label">열 <input class="dt-input dt-input-num" type="number" min="1" max="6" bind:value={tableCols} /></label>
        <div class="dt-form-row"><button type="submit" class="dt-chipbtn dt-chipbtn-on">표 삽입</button></div>
      </form>
    {:else if sheet === 'emoji'}
      <div class="dt-emoji">
        {#each EMOJI_LIST as em (em)}
          <button type="button" class="dt-emoji-btn" aria-label={`${em} 삽입`} onclick={() => insertEmoji(em)}>{em}</button>
        {/each}
      </div>
    {:else if sheet === 'sig'}
      {#if sigLoading}
        <div class="dt-sig-info">불러오는 중...</div>
      {:else if sigAssets.length === 0}
        <div class="dt-sig-info dt-sig-empty">
          등록된 서명·직인이 없습니다.<br />발행자 서명·직인 필수 토글 아래<br />'서명 &amp; 직인 이미지 등록' 버튼으로 먼저 등록하세요.
        </div>
      {:else}
        <div class="dt-sig-list" role="listbox" aria-label="서명/직인 자산 목록">
          {#each sigAssets as asset (asset.id)}
            <button
              type="button"
              class="dt-sig-item"
              role="option"
              aria-selected={false}
              onclick={() => insertSigAsset(asset)}
              aria-label="{asset.assetType === 'signature' ? '서명' : '직인'} 삽입{asset.name ? ': ' + asset.name : ''}"
            >
              <img src={asset.imageUrl} alt="{asset.assetType === 'signature' ? '서명' : '직인'} 미리보기" class="dt-sig-thumb" />
              <div class="dt-sig-meta">
                <span class="dt-sig-label">{asset.name ?? (asset.assetType === 'signature' ? '서명' : '직인')}</span>
                <span class="dt-sig-badge dt-sig-badge--{asset.assetType}">{asset.assetType === 'signature' ? '서명' : '직인'}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .dt-wrap {
    background: var(--de-surface, #F6F6F6);
    border-bottom: 1px solid var(--de-border, #E0E0E6);
  }
  .dt-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 6px 10px;
  }
  .dt-toolbar-ins { border-top: 1px solid var(--de-border, #E0E0E6); }

  .dt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 36px;
    height: 34px;
    padding: 0 8px;
    border: none;
    border-radius: var(--de-radius-xs, 8px);
    background: transparent;
    color: var(--de-text, #100B32);
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .dt-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--de-purple, #3B2F8A) 8%, transparent); }
  .dt-btn-active { background: color-mix(in srgb, var(--de-purple, #3B2F8A) 14%, transparent); color: var(--de-purple, #3B2F8A); }
  .dt-btn:disabled { opacity: 0.4; cursor: default; }
  .dt-btn-wide { padding: 0 10px; }
  .dt-drop { min-width: 92px; justify-content: space-between; }
  .dt-caret { font-size: 10px; color: var(--de-text-sub, #444444); }
  .dt-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--de-border, #E0E0E6); flex-shrink: 0; }
  .dt-glyph { font-size: 15px; font-weight: 900; line-height: 1; }
  .dt-glyph-color { border-bottom: 3px solid var(--de-danger, #FF3535); padding-bottom: 1px; }
  .dt-glyph-bg { background: var(--de-purple-soft, #E1DEF3); padding: 0 3px; }

  .dt-size { display: inline-flex; align-items: center; gap: 0; }
  .dt-size-step { min-width: 28px; padding: 0 4px; font-size: 16px; }
  .dt-size-val {
    min-width: 36px;
    height: 34px;
    border: none;
    border-radius: var(--de-radius-xs, 8px);
    background: var(--de-white, #FFFFFF);
    color: var(--de-text, #100B32);
    font: var(--de-font-body, 700 14px/200% sans-serif);
    cursor: pointer;
  }
  .dt-size-sheet { margin-top: 8px; justify-content: center; gap: 12px; }
  .dt-size-num { min-width: 52px; text-align: center; font: var(--de-font-body, 700 14px/200% sans-serif); color: var(--de-text, #100B32); }

  .dt-zoom { display: inline-flex; align-items: center; gap: 0; margin-left: auto; }
  .dt-zoom-value { min-width: 52px; }

  /* ── 선택 시트(팝오버) ── */
  .dt-sheet {
    position: fixed;
    z-index: 20;
    width: 260px;
    max-height: 340px;
    overflow: auto;
    padding: 10px 12px 12px;
    border-radius: var(--de-radius-md, 15px);
    background: var(--de-white, #FFFFFF);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--de-text, #100B32) 18%, transparent);
  }
  .dt-sheet-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .dt-sheet-title { font: var(--de-font-body, 700 14px/200% sans-serif); font-weight: 700; color: var(--de-text, #100B32); }
  .dt-sheet-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--de-radius-xs, 8px);
    background: transparent;
    color: var(--de-text-mid, #666666);
    font-size: 14px;
    cursor: pointer;
  }
  .dt-sheet-close:hover { background: var(--de-danger-soft, #FFEAEA); color: var(--de-danger, #FF3535); }
  .dt-list { list-style: none; margin: 0; padding: 0; }
  .dt-list-item {
    width: 100%;
    min-height: 40px;
    padding: 0 10px;
    border: none;
    border-radius: var(--de-radius-xs, 8px);
    background: transparent;
    color: var(--de-text, #100B32);
    font: var(--de-font-body, 700 14px/200% sans-serif);
    text-align: left;
    cursor: pointer;
  }
  .dt-list-item:hover { background: color-mix(in srgb, var(--de-purple, #3B2F8A) 8%, transparent); }
  .dt-list-h1 { font-size: 20px; font-weight: 900; }
  .dt-list-h2 { font-size: 18px; font-weight: 900; }
  .dt-list-h3 { font-size: 16px; font-weight: 900; }
  .dt-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .dt-palette { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .dt-swatch {
    height: 36px;
    min-width: 36px;
    border: none;
    border-radius: var(--de-radius-xs, 8px);
    cursor: pointer;
  }
  .dt-swatch:hover { opacity: 0.8; }
  .dt-chipbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    padding: 0 12px;
    border: none;
    border-radius: var(--de-radius-full, 9999px);
    background: var(--de-white, #FFFFFF);
    color: var(--de-text, #100B32);
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .dt-chipbtn:hover:not(:disabled) { background: var(--de-lilac, #ECEBF4); }
  .dt-chipbtn:disabled { opacity: 0.4; cursor: default; }
  .dt-chipbtn-on { background: var(--de-purple, #3B2F8A); color: var(--de-white, #FFFFFF); }
  .dt-chipbtn-on:hover:not(:disabled) { background: var(--de-purple-hover, #2E2470); }
  .dt-chipbtn-wide { width: 100%; margin-top: 8px; }
  .dt-form { display: flex; flex-direction: column; gap: 8px; }
  .dt-form-row { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }
  .dt-input {
    width: 100%;
    min-height: 40px;
    padding: 0 12px;
    border: none;
    border-radius: var(--de-radius-xs, 8px);
    background: var(--de-surface, #F6F6F6);
    color: var(--de-text, #100B32);
    font: var(--de-font-body, 700 14px/200% sans-serif);
    outline: none;
  }
  .dt-input-num { width: 72px; margin-left: 6px; }
  .dt-label { display: flex; align-items: center; gap: 6px; font: var(--de-font-body, 700 14px/200% sans-serif); color: var(--de-text, #100B32); }
  .dt-emoji { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
  .dt-emoji-btn { height: 34px; border: none; border-radius: var(--de-radius-xs, 8px); background: transparent; font-size: 20px; line-height: 1; cursor: pointer; }
  .dt-emoji-btn:hover { background: color-mix(in srgb, var(--de-purple, #3B2F8A) 8%, transparent); }

  /* 서명/직인 시트 */
  .dt-sig-info { padding: 14px 4px; font-size: 12px; color: var(--de-text-mid, #666666); line-height: 1.6; text-align: center; }
  .dt-sig-empty { color: var(--de-text-mid, #666666); }
  .dt-sig-list { display: flex; flex-direction: column; max-height: 240px; overflow-y: auto; }
  .dt-sig-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--de-radius-xs, 8px);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, border-color 0.1s;
  }
  .dt-sig-item:hover { background: var(--de-lilac, #ECEBF4); border-color: var(--de-lilac, #ECEBF4); }
  .dt-sig-thumb { width: 48px; height: 32px; object-fit: contain; border: 1px solid var(--de-lilac, #ECEBF4); border-radius: 4px; background: #fafafa; flex-shrink: 0; }
  .dt-sig-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .dt-sig-label { font-size: 12px; font-weight: 600; color: var(--de-text, #100B32); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dt-sig-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 99px; line-height: 1.4; }
  .dt-sig-badge--signature { background: rgba(59, 47, 138, 0.08); color: var(--de-purple, #3B2F8A); }
  .dt-sig-badge--seal { background: rgba(16, 11, 50, 0.07); color: var(--de-text, #100B32); }
</style>
