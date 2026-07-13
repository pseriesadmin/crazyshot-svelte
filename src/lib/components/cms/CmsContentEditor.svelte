<script lang="ts">
  import type { ContentBlock, ImageBlock, ImageLayout } from '$lib/types/content-editor'
  import {
    extractYoutubeId,
    makeEmptyTextBlock,
    makeEmptyImageBlock,
    makeEmptyYoutubeBlock,
    makeEmptyHtmlBlock,
    makeEmptyDividerBlock,
  } from '$lib/types/content-editor'
  import { resizeProductImage } from '$lib/utils/imageResize'

  interface Props {
    blocks: ContentBlock[]
    keywords: string[]
  }

  let { blocks = $bindable([]), keywords = $bindable([]) }: Props = $props()

  // ── 상태 ────────────────────────────────────────────
  let focusedEditorEl = $state<HTMLDivElement | null>(null)
  let showPhotoModal = $state(false)
  let pendingImageBlock = $state<{ idx: number } | null>(null)
  let showPreview = $state(false)
  let kwInput = $state('')

  // ── 블록 조작 ──────────────────────────────────────
  function insertBlock(block: ContentBlock, afterIdx = blocks.length - 1) {
    const next = [...blocks]
    next.splice(afterIdx + 1, 0, block)
    blocks = next
  }

  function removeBlock(i: number) {
    blocks = blocks.filter((_, idx) => idx !== i)
  }

  function moveUp(i: number) {
    if (i === 0) return
    const next = [...blocks]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    blocks = next
  }

  function moveDown(i: number) {
    if (i === blocks.length - 1) return
    const next = [...blocks]
    ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
    blocks = next
  }

  function updateBlock(i: number, patch: Partial<ContentBlock>) {
    const next = [...blocks]
    next[i] = { ...next[i], ...patch } as ContentBlock
    blocks = next
  }

  // ── 미디어 툴바 추가 ────────────────────────────────
  function addText() {
    insertBlock(makeEmptyTextBlock())
    // 다음 tick에 새 블록 포커스
    setTimeout(() => {
      const els = document.querySelectorAll<HTMLDivElement>('.ce-text-body')
      els[els.length - 1]?.focus()
    }, 30)
  }

  function openPhotoModal() {
    const newBlock = makeEmptyImageBlock()
    blocks = [...blocks, newBlock]
    pendingImageBlock = { idx: blocks.length - 1 }
    showPhotoModal = true
  }

  function selectPhotoLayout(layout: ImageLayout) {
    if (pendingImageBlock === null) return
    const idx = pendingImageBlock.idx
    updateBlock(idx, { layout } as Partial<ContentBlock>)
    showPhotoModal = false
    pendingImageBlock = null
  }

  function addYoutube() {
    insertBlock(makeEmptyYoutubeBlock())
  }

  function addHtml() {
    insertBlock(makeEmptyHtmlBlock())
  }

  function addDivider() {
    insertBlock(makeEmptyDividerBlock())
  }

  // ── 텍스트 서식 (execCommand) ───────────────────────
  function applyFormat(cmd: string, value?: string) {
    if (!focusedEditorEl) return
    focusedEditorEl.focus()
    document.execCommand(cmd, false, value)
  }

  function formatHeading(tag: 'h2' | 'h3') {
    if (!focusedEditorEl) return
    focusedEditorEl.focus()
    document.execCommand('formatBlock', false, tag)
  }

  function formatParagraph() {
    if (!focusedEditorEl) return
    focusedEditorEl.focus()
    document.execCommand('formatBlock', false, 'p')
  }

  // ── 유튜브 URL 처리 ────────────────────────────────
  function handleYoutubeInput(i: number, raw: string) {
    const videoId = extractYoutubeId(raw) ?? ''
    const next = [...blocks]
    next[i] = { type: 'youtube', videoId, url: raw }
    blocks = next
  }

  // ── 이미지 블록 URL 추가 ────────────────────────────
  function addImageUrl(blockIdx: number, url: string) {
    if (!url.trim()) return
    const block = blocks[blockIdx] as ImageBlock
    const next = [...blocks]
    next[blockIdx] = {
      ...block,
      images: [...block.images, { url: url.trim(), alt: '' }],
    }
    blocks = next
  }

  function removeImage(blockIdx: number, imgIdx: number) {
    const block = blocks[blockIdx] as ImageBlock
    const next = [...blocks]
    next[blockIdx] = {
      ...block,
      images: block.images.filter((_, i) => i !== imgIdx),
    }
    blocks = next
  }

  function moveImageLeft(blockIdx: number, imgIdx: number) {
    if (imgIdx === 0) return
    const block = blocks[blockIdx] as ImageBlock
    const imgs = [...block.images]
    ;[imgs[imgIdx - 1], imgs[imgIdx]] = [imgs[imgIdx], imgs[imgIdx - 1]]
    const next = [...blocks]
    next[blockIdx] = { ...block, images: imgs }
    blocks = next
  }

  function moveImageRight(blockIdx: number, imgIdx: number) {
    const block = blocks[blockIdx] as ImageBlock
    if (imgIdx === block.images.length - 1) return
    const imgs = [...block.images]
    ;[imgs[imgIdx], imgs[imgIdx + 1]] = [imgs[imgIdx + 1], imgs[imgIdx]]
    const next = [...blocks]
    next[blockIdx] = { ...block, images: imgs }
    blocks = next
  }

  function changeLayout(blockIdx: number, layout: ImageLayout) {
    updateBlock(blockIdx, { layout } as Partial<ContentBlock>)
  }

  // ── 키워드 ─────────────────────────────────────────
  function addKeyword() {
    const kw = kwInput.trim().replace(/^#+/, '')
    if (!kw || keywords.length >= 10 || keywords.includes(kw)) {
      kwInput = ''
      return
    }
    keywords = [...keywords, kw]
    kwInput = ''
  }

  function removeKeyword(kw: string) {
    keywords = keywords.filter((k) => k !== kw)
  }

  function handleKwKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addKeyword()
    } else if (e.key === 'Backspace' && kwInput === '' && keywords.length > 0) {
      keywords = keywords.slice(0, -1)
    }
  }

  // ── 링크 삽입 ─────────────────────────────────────
  function openLinkInput() {
    if (!focusedEditorEl) return
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      savedRange = sel.getRangeAt(0).cloneRange()
    }
    showLinkInput = true
    linkUrl = ''
  }

  function applyLink() {
    if (savedRange && linkUrl.trim()) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(savedRange)
      focusedEditorEl?.focus()
      document.execCommand('createLink', false, linkUrl.trim())
      syncFocusedBlock()
    }
    showLinkInput = false
    linkUrl = ''
    savedRange = null
  }

  function cancelLink() {
    showLinkInput = false
    linkUrl = ''
    savedRange = null
  }

  // ── 모두삭제 ──────────────────────────────────────
  function clearAll() {
    blocks = []
    keywords = []
    showClearConfirm = false
  }

  // ── 키보드: Esc로 모달 닫기 ────────────────────────
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showPreview = false
      showPhotoModal = false
      showClearConfirm = false
      if (showLinkInput) cancelLink()
    }
  }

  // ── 슬라이드 인덱스 (미리보기용) ──────────────────
  let slideIdxMap = $state<Record<number, number>>({})
  function setSlideIdx(blockIdx: number, dir: -1 | 1) {
    const block = blocks[blockIdx] as ImageBlock
    const total = block.images.length
    const cur = slideIdxMap[blockIdx] ?? 0
    slideIdxMap = { ...slideIdxMap, [blockIdx]: (cur + dir + total) % total }
  }

  // ── 이미지 URL 임시 입력 상태 ─────────────────────
  let imgUrlInputs = $state<Record<number, string>>({})

  // ── 서식 툴바 상태 ────────────────────────────────
  let fontSize = $state(14)
  let fontFamily = $state('')

  // ── 링크 입력 상태 ────────────────────────────────
  let showLinkInput = $state(false)
  let linkUrl = $state('')
  let savedRange: Range | null = null

  // ── 모두삭제 확인 모달 ────────────────────────────
  let showClearConfirm = $state(false)

  // ── 이미지 업로드 상태 ────────────────────────────
  let imgIsUploading = $state<Record<number, boolean>>({})
  let imgUploadError = $state<Record<number, string | null>>({})
  let imgDragCounter = $state<Record<number, number>>({})
  const contentUploadPrefix = 'content/' + (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'tmp')

  // ── 포커스 블록 동기화 ────────────────────────────
  function syncFocusedBlock() {
    if (!focusedEditorEl) return
    const els = Array.from(document.querySelectorAll<HTMLDivElement>('.ce-text-body'))
    const idx = els.indexOf(focusedEditorEl)
    if (idx < 0) return
    const next = [...blocks]
    next[idx] = { type: 'text', html: focusedEditorEl.innerHTML }
    blocks = next
  }

  // ── 폰트 크기 적용 ────────────────────────────────
  function applyFontSize(px: number) {
    if (!focusedEditorEl) return
    focusedEditorEl.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    try {
      const contents = range.extractContents()
      const span = document.createElement('span')
      span.style.fontSize = px + 'px'
      span.appendChild(contents)
      range.insertNode(span)
      sel.removeAllRanges()
      const newRange = document.createRange()
      newRange.selectNodeContents(span)
      sel.addRange(newRange)
    } catch { /* cross-element edge case */ }
    syncFocusedBlock()
  }

  // ── 폰트 서체 적용 ────────────────────────────────
  function applyFontFamily(family: string) {
    if (!focusedEditorEl || !family) return
    focusedEditorEl.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    try {
      const contents = range.extractContents()
      const span = document.createElement('span')
      span.style.fontFamily = family
      span.appendChild(contents)
      range.insertNode(span)
    } catch { /* ignore */ }
    syncFocusedBlock()
  }

  // ── 이미지 업로드 (드래그 & 파일 선택) ───────────
  async function uploadImageForBlock(blockIdx: number, file: File): Promise<void> {
    imgIsUploading = { ...imgIsUploading, [blockIdx]: true }
    imgUploadError = { ...imgUploadError, [blockIdx]: null }
    try {
      const { thumb, large } = await resizeProductImage(file)
      const fd = new FormData()
      fd.append('product_id', contentUploadPrefix)
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))
      const res = await fetch('/api/cms/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        imgUploadError = { ...imgUploadError, [blockIdx]: (err as { message?: string }).message ?? '업로드 실패' }
        return
      }
      const data = await res.json() as { largeUrl: string }
      addImageUrl(blockIdx, data.largeUrl)
    } catch (e) {
      imgUploadError = { ...imgUploadError, [blockIdx]: e instanceof Error ? e.message : '업로드 실패' }
    } finally {
      imgIsUploading = { ...imgIsUploading, [blockIdx]: false }
    }
  }

  async function handleImgFiles(blockIdx: number, files: FileList | File[]) {
    for (const file of Array.from(files)) {
      await uploadImageForBlock(blockIdx, file)
    }
  }

  function handleImgDrop(blockIdx: number, e: DragEvent) {
    e.preventDefault()
    imgDragCounter = { ...imgDragCounter, [blockIdx]: 0 }
    const files = e.dataTransfer?.files
    if (files?.length) handleImgFiles(blockIdx, files)
  }

  function triggerImgInput(blockIdx: number) {
    document.querySelector<HTMLInputElement>(`.img-file-in-${blockIdx}`)?.click()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="cms-editor">
  <!-- ① 미디어 툴바 -->
  <div class="media-toolbar" role="toolbar" aria-label="미디어 삽입">
    <button type="button" class="tb-btn" onclick={addText} title="텍스트 블록 추가">
      <span class="tb-icon">T</span>
      <span class="tb-label">텍스트</span>
    </button>
    <button type="button" class="tb-btn" onclick={openPhotoModal} title="사진 삽입">
      <span class="tb-icon">🖼</span>
      <span class="tb-label">사진</span>
    </button>
    <button type="button" class="tb-btn" onclick={addYoutube} title="유튜브 삽입">
      <span class="tb-icon">▶</span>
      <span class="tb-label">유튜브</span>
    </button>
    <button type="button" class="tb-btn" onclick={addHtml} title="HTML 붙여넣기">
      <span class="tb-icon">{`</>`}</span>
      <span class="tb-label">HTML</span>
    </button>
    <button type="button" class="tb-btn" onclick={addDivider} title="구분선 삽입">
      <span class="tb-icon">──</span>
      <span class="tb-label">구분선</span>
    </button>
    <div class="tb-sep"></div>
    <button type="button" class="tb-btn tb-clear" onclick={() => (showClearConfirm = true)} title="작성 내용 모두 삭제">
      <span class="tb-label">모두삭제</span>
    </button>
    <button type="button" class="tb-btn tb-preview" onclick={() => (showPreview = true)}>
      미리보기
    </button>
  </div>

  <!-- ② 텍스트 서식 툴바 -->
  <div class="fmt-toolbar" role="toolbar" aria-label="텍스트 서식">
    <!-- 서체 선택 -->
    <select
      class="fmt-select"
      title="서체 선택"
      aria-label="서체"
      value={fontFamily}
      onchange={(e) => { fontFamily = (e.currentTarget as HTMLSelectElement).value; applyFontFamily(fontFamily) }}
    >
      <option value="">기본 서체</option>
      <option value="'Noto Sans KR', sans-serif">Noto Sans KR</option>
      <option value="'Malgun Gothic', '맑은 고딕', sans-serif">맑은 고딕</option>
      <option value="'NanumGothic', '나눔고딕', sans-serif">나눔고딕</option>
      <option value="'NanumMyeongjo', '나눔명조', serif">나눔명조</option>
      <option value="'Gulim', '굴림', sans-serif">굴림</option>
      <option value="Georgia, serif">Georgia</option>
    </select>

    <span class="fmt-sep"></span>

    <!-- 폰트 사이즈 스피너 -->
    <div class="font-size-ctrl" role="group" aria-label="폰트 크기">
      <button
        type="button"
        class="fmt-btn size-step"
        onclick={() => { if (fontSize > 8) { fontSize -= 1; applyFontSize(fontSize) } }}
        aria-label="폰트 크기 줄이기"
      >−</button>
      <input
        type="number"
        class="fmt-size-input"
        min="8"
        max="72"
        value={fontSize}
        oninput={(e) => { fontSize = parseInt((e.currentTarget as HTMLInputElement).value) || 14 }}
        onchange={() => applyFontSize(fontSize)}
        aria-label="폰트 크기(px)"
      />
      <button
        type="button"
        class="fmt-btn size-step"
        onclick={() => { if (fontSize < 72) { fontSize += 1; applyFontSize(fontSize) } }}
        aria-label="폰트 크기 늘리기"
      >+</button>
    </div>

    <span class="fmt-sep"></span>
    <button type="button" class="fmt-btn" onclick={formatParagraph} title="본문">본문</button>
    <button type="button" class="fmt-btn" onclick={() => formatHeading('h2')} title="제목2">H2</button>
    <button type="button" class="fmt-btn" onclick={() => formatHeading('h3')} title="제목3">H3</button>
    <span class="fmt-sep"></span>
    <button type="button" class="fmt-btn fmt-b" onclick={() => applyFormat('bold')} title="굵게"><b>B</b></button>
    <button type="button" class="fmt-btn fmt-i" onclick={() => applyFormat('italic')} title="기울임"><i>I</i></button>
    <button type="button" class="fmt-btn fmt-u" onclick={() => applyFormat('underline')} title="밑줄"><u>U</u></button>
    <span class="fmt-sep"></span>
    <button type="button" class="fmt-btn" onclick={() => applyFormat('justifyLeft')} title="왼쪽 정렬">≡</button>
    <button type="button" class="fmt-btn" onclick={() => applyFormat('justifyCenter')} title="가운데 정렬">☰</button>
    <span class="fmt-sep"></span>
    <button type="button" class="fmt-btn" onclick={() => applyFormat('insertUnorderedList')} title="목록">• 목록</button>
    <button type="button" class="fmt-btn" onclick={() => applyFormat('insertOrderedList')} title="번호 목록">1. 목록</button>
    <span class="fmt-sep"></span>
    <button type="button" class="fmt-btn fmt-link" onclick={openLinkInput} title="링크 삽입" aria-pressed={showLinkInput}>🔗 링크</button>
  </div>

  <!-- 링크 입력 행 -->
  {#if showLinkInput}
    <div class="link-input-row" role="group" aria-label="링크 URL 입력">
      <span class="link-input-label">링크 URL</span>
      <input
        type="url"
        class="link-url-input"
        placeholder="https://..."
        bind:value={linkUrl}
        onkeydown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); applyLink() }
          if (e.key === 'Escape') { e.preventDefault(); cancelLink() }
        }}
        aria-label="링크 URL"
        autofocus
      />
      <button type="button" class="link-apply-btn" onclick={applyLink}>적용</button>
      <button type="button" class="link-cancel-btn" onclick={cancelLink} aria-label="링크 취소">✕</button>
    </div>
  {/if}

  <!-- ③ 블록 리스트 -->
  <div class="block-list">
    {#if blocks.length === 0}
      <div class="empty-hint" role="button" tabindex="0" onclick={addText} onkeydown={(e) => e.key === 'Enter' && addText()}>
        내용을 입력하세요.
      </div>
    {/if}

    {#each blocks as block, i (i)}
      <div class="block-wrap">
        <!-- 블록 컨트롤 -->
        <div class="block-ctrl" aria-label="블록 이동/삭제">
          <button type="button" class="ctrl-btn" onclick={() => moveUp(i)} disabled={i === 0} aria-label="위로 이동">↑</button>
          <button type="button" class="ctrl-btn" onclick={() => moveDown(i)} disabled={i === blocks.length - 1} aria-label="아래로 이동">↓</button>
          <button type="button" class="ctrl-btn ctrl-del" onclick={() => removeBlock(i)} aria-label="블록 삭제">✕</button>
        </div>

        <!-- 텍스트 블록 -->
        {#if block.type === 'text'}
          <div
            contenteditable="true"
            role="textbox"
            aria-multiline="true"
            aria-label="텍스트 입력"
            class="ce-text-body"
            onfocus={(e) => { focusedEditorEl = e.currentTarget as HTMLDivElement }}
            oninput={(e) => {
              const el = e.currentTarget as HTMLDivElement
              const next = [...blocks]
              next[i] = { type: 'text', html: el.innerHTML }
              blocks = next
            }}
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html block.html}
          </div>

        <!-- 이미지 블록 -->
        {:else if block.type === 'image'}
          <div class="img-block">
            <!-- 레이아웃 피커 -->
            <div class="img-layout-row" role="group" aria-label="이미지 레이아웃">
              <span class="layout-label">레이아웃</span>
              {#each (['individual', 'collage', 'slide'] as ImageLayout[]) as lyt}
                <button
                  type="button"
                  class="chip"
                  class:chip-active={block.layout === lyt}
                  onclick={() => changeLayout(i, lyt)}
                >
                  {lyt === 'individual' ? '개별사진' : lyt === 'collage' ? '콜라주' : '슬라이드'}
                </button>
              {/each}
            </div>

            <!-- 이미지 드롭존 -->
            {#if imgUploadError[i]}
              <p class="img-upload-err" role="alert">{imgUploadError[i]}</p>
            {/if}
            <div
              class="img-dropzone"
              class:img-dz-active={(imgDragCounter[i] ?? 0) > 0}
              class:img-dz-uploading={imgIsUploading[i]}
              role="button"
              tabindex="0"
              aria-label="이미지 파일을 드래그하거나 클릭하여 업로드"
              ondragenter={(e) => { e.preventDefault(); imgDragCounter = { ...imgDragCounter, [i]: (imgDragCounter[i] ?? 0) + 1 } }}
              ondragleave={() => { const c = (imgDragCounter[i] ?? 1) - 1; imgDragCounter = { ...imgDragCounter, [i]: c < 0 ? 0 : c } }}
              ondragover={(e) => e.preventDefault()}
              ondrop={(e) => handleImgDrop(i, e)}
              onclick={() => triggerImgInput(i)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerImgInput(i) } }}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                class={`img-file-in-${i}`}
                style="display:none"
                onchange={(e) => {
                  const files = (e.currentTarget as HTMLInputElement).files
                  if (files?.length) handleImgFiles(i, files)
                  ;(e.currentTarget as HTMLInputElement).value = ''
                }}
              />
              <span class="dz-icon">🖼</span>
              {#if imgIsUploading[i]}
                <span class="dz-text">업로드 중...</span>
              {:else}
                <span class="dz-text">이미지를 드래그하거나 클릭하여 업로드</span>
              {/if}
            </div>

            <!-- URL 직접 입력 (옵션) -->
            <div class="img-url-input-row">
              <input
                type="url"
                class="f-input img-url-in"
                placeholder="또는 이미지 URL 직접 입력 후 Enter"
                value={imgUrlInputs[i] ?? ''}
                oninput={(e) => { imgUrlInputs = { ...imgUrlInputs, [i]: (e.currentTarget as HTMLInputElement).value } }}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addImageUrl(i, imgUrlInputs[i] ?? '')
                    imgUrlInputs = { ...imgUrlInputs, [i]: '' }
                  }
                }}
                aria-label="이미지 URL"
              />
              <button
                type="button"
                class="btn-action"
                onclick={() => {
                  addImageUrl(i, imgUrlInputs[i] ?? '')
                  imgUrlInputs = { ...imgUrlInputs, [i]: '' }
                }}
              >URL 추가</button>
            </div>

            <!-- 이미지 미리보기 (편집 모드) -->
            {#if block.images.length > 0}
              <div class="img-thumbs" class:img-collage={block.layout === 'collage'} class:img-slide-wrap={block.layout === 'slide'}>
                {#each block.images as img, j}
                  <div class="img-thumb-item">
                    <img src={img.url} alt={img.alt || '상품 이미지'} class="thumb-img" />
                    <div class="thumb-ctrl">
                      <button type="button" class="thumb-btn" onclick={() => moveImageLeft(i, j)} disabled={j === 0} aria-label="왼쪽으로">←</button>
                      <button type="button" class="thumb-btn" onclick={() => moveImageRight(i, j)} disabled={j === block.images.length - 1} aria-label="오른쪽으로">→</button>
                      <button type="button" class="thumb-btn thumb-del" onclick={() => removeImage(i, j)} aria-label="이미지 삭제">✕</button>
                    </div>
                    <input
                      type="text"
                      class="f-input thumb-alt"
                      placeholder="대체 텍스트(alt)"
                      value={img.alt}
                      oninput={(e) => {
                        const imgs = [...block.images]
                        imgs[j] = { ...imgs[j], alt: (e.currentTarget as HTMLInputElement).value }
                        const next = [...blocks]
                        next[i] = { ...block, images: imgs }
                        blocks = next
                      }}
                      aria-label={`이미지 ${j + 1} 대체 텍스트`}
                    />
                  </div>
                {/each}
              </div>
            {:else}
              <p class="img-empty">이미지 URL을 입력해 추가하세요.</p>
            {/if}
          </div>

        <!-- 유튜브 블록 -->
        {:else if block.type === 'youtube'}
          <div class="yt-block">
            <input
              type="url"
              class="f-input"
              placeholder="유튜브 URL 붙여넣기 (예: https://youtu.be/xxxxx)"
              value={block.url}
              oninput={(e) => handleYoutubeInput(i, (e.currentTarget as HTMLInputElement).value)}
              aria-label="유튜브 URL"
            />
            {#if block.videoId}
              <div class="yt-embed-wrap">
                <iframe
                  src={`https://www.youtube.com/embed/${block.videoId}`}
                  title="유튜브 영상"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowfullscreen
                  class="yt-iframe"
                ></iframe>
              </div>
            {:else if block.url}
              <p class="yt-err">올바른 유튜브 URL을 입력해주세요.</p>
            {/if}
          </div>

        <!-- HTML 블록 -->
        {:else if block.type === 'html'}
          <div class="html-block">
            <textarea
              class="f-input html-textarea"
              placeholder="HTML 코드를 붙여넣으세요. (외부 사이트 복사 포함)"
              value={block.content}
              oninput={(e) => {
                const next = [...blocks]
                next[i] = { type: 'html', content: (e.currentTarget as HTMLTextAreaElement).value }
                blocks = next
              }}
              rows={5}
              aria-label="HTML 입력"
              spellcheck={false}
            ></textarea>
            {#if block.content.trim()}
              <details class="html-preview-toggle">
                <summary class="html-preview-label">미리보기</summary>
                <div class="html-preview-body">
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html block.content}
                </div>
              </details>
            {/if}
          </div>

        <!-- 구분선 블록 -->
        {:else if block.type === 'divider'}
          <hr class="divider-block" aria-hidden="true" />
        {/if}
      </div>
    {/each}
  </div>

  <!-- ④ 키워드 입력 (하단 고정) -->
  <div class="keyword-area" role="group" aria-label="키워드 태그 (최대 10개)">
    <div class="kw-tag-list">
      {#each keywords as kw}
        <span class="kw-tag">
          <span class="kw-hash">#</span>{kw}
          <button type="button" class="kw-del" onclick={() => removeKeyword(kw)} aria-label={`${kw} 태그 삭제`}>×</button>
        </span>
      {/each}
      {#if keywords.length < 10}
        <input
          type="text"
          class="kw-input"
          placeholder={keywords.length === 0 ? '#태그를 입력해주세요 (최대 10개)' : '태그 추가...'}
          bind:value={kwInput}
          onkeydown={handleKwKeydown}
          onblur={addKeyword}
          aria-label="키워드 태그 입력"
        />
      {/if}
    </div>
    <span class="kw-count">{keywords.length}/10</span>
  </div>
</div>

<!-- ⑤ 사진 첨부 방식 모달 -->
{#if showPhotoModal}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={() => { showPhotoModal = false; pendingImageBlock = null }}
  >
    <div class="photo-modal" role="dialog" aria-modal="true" aria-labelledby="photo-modal-title" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <button type="button" class="modal-close" onclick={() => { showPhotoModal = false; pendingImageBlock = null }} aria-label="닫기">✕</button>
      <h3 class="modal-title" id="photo-modal-title">사진 첨부 방식</h3>
      <p class="modal-sub">첨부되는 사진들의 레이아웃을 선택할 수 있습니다.</p>
      <div class="photo-layout-cards">
        <button type="button" class="layout-card" onclick={() => selectPhotoLayout('individual')}>
          <div class="layout-thumb lt-individual">
            <div class="lt-img"></div>
            <div class="lt-img"></div>
          </div>
          <span class="layout-card-label">개별사진</span>
        </button>
        <button type="button" class="layout-card" onclick={() => selectPhotoLayout('collage')}>
          <div class="layout-thumb lt-collage">
            <div class="lt-row">
              <div class="lt-img"></div>
              <div class="lt-img"></div>
            </div>
            <div class="lt-row">
              <div class="lt-img"></div>
              <div class="lt-img"></div>
            </div>
          </div>
          <span class="layout-card-label">콜라주</span>
        </button>
        <button type="button" class="layout-card" onclick={() => selectPhotoLayout('slide')}>
          <div class="layout-thumb lt-slide">
            <div class="lt-slide-track">
              <div class="lt-img lt-img-slide active"></div>
              <div class="lt-img lt-img-slide"></div>
            </div>
            <div class="lt-dots">
              <span class="lt-dot active"></span>
              <span class="lt-dot"></span>
            </div>
          </div>
          <span class="layout-card-label">슬라이드</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ⑥ 모두삭제 확인 모달 -->
{#if showClearConfirm}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={() => (showClearConfirm = false)}
  >
    <div class="clear-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-confirm-title" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <p class="clear-confirm-msg" id="clear-confirm-title">작성된 내용을 모두 삭제할까요?</p>
      <p class="clear-confirm-sub">블록과 키워드 태그가 전부 삭제되며 되돌릴 수 없습니다.</p>
      <div class="clear-confirm-actions">
        <button type="button" class="clear-cancel-btn" onclick={() => (showClearConfirm = false)}>취소</button>
        <button type="button" class="clear-ok-btn" onclick={clearAll}>모두 삭제</button>
      </div>
    </div>
  </div>
{/if}

<!-- ⑦ 미리보기 모달 -->
{#if showPreview}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={() => (showPreview = false)}
  >
    <div class="preview-modal" role="dialog" aria-modal="true" aria-label="콘텐츠 미리보기" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <div class="preview-header">
        <span class="preview-title">미리보기</span>
        <button type="button" class="modal-close" onclick={() => (showPreview = false)} aria-label="미리보기 닫기">✕</button>
      </div>
      <div class="preview-body">
        {#each blocks as block, i}
          {#if block.type === 'text'}
            <div class="pv-text">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html block.html}
            </div>
          {:else if block.type === 'image' && block.images.length > 0}
            {#if block.layout === 'individual'}
              <div class="pv-individual">
                {#each block.images as img}
                  <img src={img.url} alt={img.alt || '상품 이미지'} class="pv-img-full" />
                {/each}
              </div>
            {:else if block.layout === 'collage'}
              <div class="pv-collage">
                {#each block.images as img}
                  <img src={img.url} alt={img.alt || '상품 이미지'} class="pv-img-tile" />
                {/each}
              </div>
            {:else if block.layout === 'slide'}
              <div class="pv-slide">
                {#each block.images as img, j}
                  <img
                    src={img.url}
                    alt={img.alt || '상품 이미지'}
                    class="pv-slide-img"
                    class:pv-slide-active={(slideIdxMap[i] ?? 0) === j}
                  />
                {/each}
                <div class="pv-slide-ctrl">
                  <button type="button" class="slide-arrow" onclick={() => setSlideIdx(i, -1)} aria-label="이전">‹</button>
                  <span class="slide-dots">
                    {#each block.images as _, j}
                      <span class="slide-dot" class:active={(slideIdxMap[i] ?? 0) === j}></span>
                    {/each}
                  </span>
                  <button type="button" class="slide-arrow" onclick={() => setSlideIdx(i, 1)} aria-label="다음">›</button>
                </div>
              </div>
            {/if}
          {:else if block.type === 'youtube' && block.videoId}
            <div class="pv-yt">
              <iframe
                src={`https://www.youtube.com/embed/${block.videoId}`}
                title="유튜브 영상"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen
                class="yt-iframe"
              ></iframe>
            </div>
          {:else if block.type === 'html' && block.content.trim()}
            <div class="pv-html">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html block.content}
            </div>
          {:else if block.type === 'divider'}
            <hr class="pv-divider" />
          {/if}
        {/each}
        {#if keywords.length > 0}
          <div class="pv-keywords">
            {#each keywords as kw}
              <span class="pv-kw-tag">#{kw}</span>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── 에디터 외곽 ───────────────────────────────────── */
  .cms-editor {
    display: flex;
    flex-direction: column;
    border: 1px solid #ECEBF4;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    overflow: hidden;
  }

  /* ── 미디어 툴바 ───────────────────────────────────── */
  .media-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 12px;
    border-bottom: 1px solid #ECEBF4;
    background: var(--cs-surface-gray);
    flex-wrap: wrap;
  }

  .tb-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text);
    font: var(--text-pc-body-14);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
    min-width: 44px;
  }
  .tb-btn:hover { background: rgba(59,47,138,0.08); }
  .tb-btn:focus-visible { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .tb-icon { font-size: 14px; }
  .tb-label { font-size: 12px; }

  .tb-sep {
    flex: 1;
  }

  .tb-preview {
    background: var(--cs-purple);
    color: var(--cs-white);
    padding: 0 16px;
  }
  .tb-preview:hover { background: var(--cs-purple-hover); }

  .tb-clear {
    color: var(--cs-red-badge);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .tb-clear:hover { background: rgba(255,53,53,0.08); }

  /* ── 서식 툴바 ─────────────────────────────────────── */
  .fmt-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 12px;
    border-bottom: 1px solid #ECEBF4;
    flex-wrap: wrap;
    min-height: 44px;
  }

  .fmt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 30px;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .fmt-btn:hover { background: rgba(59,47,138,0.08); }

  /* 서체 선택 드롭다운 */
  .fmt-select {
    height: 30px;
    padding: 0 6px;
    border: 1px solid #ECEBF4;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    color: var(--cs-text);
    font: var(--text-pc-script-12);
    cursor: pointer;
    outline: none;
    max-width: 110px;
  }
  .fmt-select:focus { border-color: var(--cs-purple); }

  /* 폰트 사이즈 스피너 */
  .font-size-ctrl {
    display: inline-flex;
    align-items: center;
    border: 1px solid #ECEBF4;
    border-radius: var(--radius-sm);
    overflow: hidden;
    height: 30px;
  }
  .fmt-size-input {
    width: 36px;
    height: 100%;
    border: none;
    border-left: 1px solid #ECEBF4;
    border-right: 1px solid #ECEBF4;
    text-align: center;
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    background: var(--cs-white);
    outline: none;
    /* hide spinner arrows */
    -moz-appearance: textfield;
  }
  .fmt-size-input::-webkit-inner-spin-button,
  .fmt-size-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .size-step {
    min-width: 22px;
    height: 30px;
    padding: 0;
    font-size: 14px;
    border-radius: 0;
    background: var(--cs-surface-gray);
    border: none;
    color: var(--cs-text);
    cursor: pointer;
    transition: background 0.1s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .size-step:hover { background: rgba(59,47,138,0.08); }

  .fmt-sep {
    width: 1px;
    height: 18px;
    background: #ECEBF4;
    margin: 0 4px;
    flex-shrink: 0;
  }

  /* ── 링크 입력 행 ─────────────────────────────────── */
  .link-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(59,47,138,0.04);
    border-bottom: 1px solid #ECEBF4;
    flex-wrap: nowrap;
  }
  .link-input-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .link-url-input {
    flex: 1;
    height: 30px;
    padding: 0 10px;
    border: 1px solid #ECEBF4;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    background: var(--cs-white);
    outline: none;
    min-width: 0;
  }
  .link-url-input:focus { border-color: var(--cs-purple); }
  .link-apply-btn {
    height: 30px;
    padding: 0 14px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  .link-apply-btn:hover { background: var(--cs-purple-hover); }
  .link-cancel-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--cs-text-mid);
    font-size: 13px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  .link-cancel-btn:hover { background: rgba(59,47,138,0.08); }

  /* ── 모두삭제 확인 모달 ────────────────────────────── */
  .clear-confirm-dialog {
    position: relative;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 28px 32px;
    width: 380px;
    max-width: calc(100vw - 40px);
    text-align: center;
  }
  .clear-confirm-msg {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    margin: 0 0 8px;
  }
  .clear-confirm-sub {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 24px;
    line-height: 1.6;
  }
  .clear-confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  .clear-cancel-btn {
    height: 40px;
    padding: 0 24px;
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.12s;
  }
  .clear-cancel-btn:hover { background: rgba(59,47,138,0.08); }
  .clear-ok-btn {
    height: 40px;
    padding: 0 24px;
    background: var(--cs-chat-in-bg);
    color: var(--cs-red-badge);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .clear-ok-btn:hover { background: #ffb3b3; }

  /* ── 블록 리스트 ───────────────────────────────────── */
  .block-list {
    min-height: 504px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty-hint {
    color: var(--cs-text-light);
    font: var(--text-pc-body-14);
    padding: 16px;
    cursor: text;
    min-height: 60px;
  }

  .block-wrap {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px;
    border: 1px solid transparent;
    border-radius: var(--cms-radius-sm);
    transition: border-color 0.12s;
  }
  .block-wrap:hover { border-color: #ECEBF4; }

  /* ── 블록 컨트롤 ───────────────────────────────────── */
  .block-ctrl {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .block-wrap:hover .block-ctrl { opacity: 1; }

  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font-size: 11px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .ctrl-btn:hover { background: rgba(59,47,138,0.10); }
  .ctrl-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .ctrl-del:hover { background: rgba(255,53,53,0.10); color: var(--cs-red-badge); }

  /* ── 텍스트 블록 ───────────────────────────────────── */
  .ce-text-body {
    flex: 1;
    min-height: 60px;
    padding: 8px 12px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    line-height: 1.7;
    outline: none;
    word-break: break-word;
  }
  .ce-text-body:focus {
    background: rgba(59,47,138,0.02);
    outline: none;
  }
  .ce-text-body:empty::before {
    content: '텍스트를 입력하세요...';
    color: var(--cs-text-light);
  }

  /* ── 이미지 블록 ───────────────────────────────────── */
  .img-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .img-layout-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .layout-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    flex-shrink: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 5px 10px;
    border: 1px solid #ECEBF4;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    color: var(--cs-text);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .chip:hover { background: rgba(59,47,138,0.06); }
  .chip-active {
    background: var(--cs-purple-dark);
    border-color: var(--cs-purple-dark);
    color: var(--cs-white);
  }

  /* ── 이미지 드롭존 ─────────────────────────────────── */
  .img-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 80px;
    padding: 16px;
    border: 2px dashed #ECEBF4;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    text-align: center;
  }
  .img-dropzone:hover,
  .img-dropzone:focus-visible { border-color: var(--cs-purple); background: rgba(59,47,138,0.04); outline: none; }
  .img-dz-active { border-color: var(--cs-purple); background: rgba(59,47,138,0.06); }
  .img-dz-uploading { opacity: 0.7; pointer-events: none; }

  .dz-icon { font-size: 22px; line-height: 1; }
  .dz-text { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

  .img-upload-err {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    margin: 0 0 4px;
  }

  .img-url-input-row {
    display: flex;
    gap: 8px;
  }
  .img-url-in { flex: 1; }

  .img-thumbs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .img-collage {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }
  .img-slide-wrap {
    display: flex;
    overflow-x: auto;
    flex-wrap: nowrap;
  }

  .img-thumb-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
    width: 120px;
  }

  .thumb-img {
    width: 120px;
    height: 80px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
  }

  .thumb-ctrl {
    display: flex;
    gap: 2px;
    justify-content: center;
  }

  .thumb-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font-size: 11px;
    cursor: pointer;
  }
  .thumb-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .thumb-del:hover { background: rgba(255,53,53,0.10); color: var(--cs-red-badge); }

  .thumb-alt {
    padding: 4px 6px;
    font: var(--text-pc-descript-10);
    height: 28px;
  }

  .img-empty {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    padding: 8px 0;
  }

  /* ── 유튜브 블록 ───────────────────────────────────── */
  .yt-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .yt-embed-wrap {
    position: relative;
    padding-bottom: 56.25%;
    height: 0;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .yt-iframe {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    border: none;
  }

  .yt-err {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
  }

  /* ── HTML 블록 ─────────────────────────────────────── */
  .html-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .html-textarea {
    font-family: monospace;
    font-size: 12px;
    resize: vertical;
  }

  .html-preview-toggle {
    border: 1px solid #ECEBF4;
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }

  .html-preview-label {
    display: block;
    padding: 6px 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    cursor: pointer;
    background: var(--cs-surface-gray);
  }

  .html-preview-body {
    padding: 12px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    line-height: 1.7;
  }

  /* ── 구분선 블록 ───────────────────────────────────── */
  .divider-block {
    flex: 1;
    border: none;
    border-top: 2px solid #ECEBF4;
    margin: 8px 0;
  }

  /* ── 키워드 영역 ───────────────────────────────────── */
  .keyword-area {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid #ECEBF4;
    background: var(--cs-surface-gray);
    flex-wrap: wrap;
  }

  .kw-tag-list {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
    min-height: 34px;
  }

  .kw-tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px 10px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border-radius: 6px;
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
  }

  .kw-hash { color: var(--cs-purple); opacity: 0.6; }

  .kw-del {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--cs-purple);
    font-size: 12px;
    cursor: pointer;
    opacity: 0.7;
    line-height: 1;
    padding: 0;
  }
  .kw-del:hover { opacity: 1; }

  .kw-input {
    border: none;
    background: transparent;
    outline: none;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    min-width: 160px;
    flex: 1;
  }
  .kw-input::placeholder { color: var(--cs-text-light); }

  .kw-count {
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
    flex-shrink: 0;
  }

  /* ── 모달 공통 ─────────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(16,11,50,0.78);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-close {
    position: absolute;
    top: 16px;
    right: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 50%;
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font-size: 14px;
    cursor: pointer;
  }

  /* ── 사진 첨부 방식 모달 ───────────────────────────── */
  .photo-modal {
    position: relative;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px 32px;
    width: 480px;
    max-width: calc(100vw - 40px);
    text-align: center;
  }

  .modal-title {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
    margin: 0 0 6px;
  }

  .modal-sub {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 24px;
  }

  .photo-layout-cards {
    display: flex;
    gap: 16px;
    justify-content: center;
  }

  .layout-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px;
    border: 2px solid #ECEBF4;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    min-width: 100px;
  }
  .layout-card:hover {
    border-color: var(--cs-purple);
    background: rgba(59,47,138,0.04);
  }

  .layout-card-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
  }

  /* 레이아웃 썸네일 */
  .layout-thumb {
    width: 80px;
    height: 64px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--cs-surface-gray);
  }

  .lt-individual { display: flex; flex-direction: column; gap: 2px; padding: 4px; }
  .lt-collage    { display: flex; flex-direction: column; gap: 2px; padding: 4px; }
  .lt-slide      { display: flex; flex-direction: column; gap: 4px; padding: 4px; }

  .lt-row { display: flex; gap: 2px; flex: 1; }

  .lt-img {
    flex: 1;
    background: #CCCCCC;
    border-radius: 2px;
  }

  .lt-slide-track { display: flex; gap: 2px; height: 46px; }
  .lt-img-slide { width: 64px; flex-shrink: 0; }
  .lt-img-slide.active { background: var(--cs-purple); opacity: 0.7; }

  .lt-dots { display: flex; gap: 4px; justify-content: center; margin-top: 2px; }
  .lt-dot { width: 6px; height: 6px; border-radius: 50%; background: #CCCCCC; }
  .lt-dot.active { background: var(--cs-purple); }

  /* ── 미리보기 모달 ─────────────────────────────────── */
  .preview-modal {
    position: relative;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    width: 720px;
    max-width: calc(100vw - 40px);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #ECEBF4;
    flex-shrink: 0;
  }

  .preview-title {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
  }

  .preview-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* 미리보기 블록 스타일 */
  .pv-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    line-height: 1.7;
  }

  .pv-individual { display: flex; flex-direction: column; gap: 8px; }
  .pv-img-full { width: 100%; border-radius: var(--radius-sm); }

  .pv-collage {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }
  .pv-img-tile { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: var(--radius-sm); }

  .pv-slide { position: relative; }
  .pv-slide-img { display: none; width: 100%; border-radius: var(--radius-sm); }
  .pv-slide-img.pv-slide-active { display: block; }

  .pv-slide-ctrl {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 8px;
  }

  .slide-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid #ECEBF4;
    border-radius: 50%;
    background: var(--cs-white);
    font-size: 18px;
    cursor: pointer;
    color: var(--cs-text);
    min-width: 44px;
    min-height: 44px;
  }

  .slide-dots { display: flex; gap: 6px; }
  .slide-dot { width: 8px; height: 8px; border-radius: 50%; background: #ECEBF4; }
  .slide-dot.active { background: var(--cs-purple); }

  .pv-yt { position: relative; padding-bottom: 56.25%; height: 0; }

  .pv-html { font: var(--text-pc-body-14); color: var(--cs-text); line-height: 1.7; }
  .pv-divider { border: none; border-top: 2px solid #ECEBF4; }

  .pv-keywords {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid #ECEBF4;
  }
  .pv-kw-tag {
    padding: 4px 10px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border-radius: 6px;
    font: var(--text-pc-script-12);
    font-weight: 700;
  }

  /* ── 버튼 재사용 ───────────────────────────────────── */
  .btn-action {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  .btn-action:hover { background: var(--cs-purple-hover); }

  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 100%;
  }
  .f-input::placeholder { color: var(--cs-text-light); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  /* ── 모바일 반응형 ─────────────────────────────────── */
  @media (max-width: 640px) {
    .photo-layout-cards { gap: 10px; }
    .layout-card { min-width: 80px; padding: 12px 10px; }
    .layout-thumb { width: 60px; height: 48px; }
    .preview-modal { width: 100%; max-height: 85vh; border-radius: var(--cms-radius-md) var(--cms-radius-md) 0 0; align-self: flex-end; }
    .modal-backdrop { align-items: flex-end; }
    .img-thumbs { gap: 6px; }
    .img-thumb-item { width: 90px; }
    .thumb-img { width: 90px; height: 60px; }
    .fmt-toolbar { gap: 1px; }
    .fmt-btn { min-width: 28px; height: 28px; padding: 0 5px; }
    .fmt-select { max-width: 80px; font-size: 11px; }
    .fmt-size-input { width: 30px; }
    .tb-label { display: none; }
    .tb-btn { padding: 0 8px; }
  }
</style>
