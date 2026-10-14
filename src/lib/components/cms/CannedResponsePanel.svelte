<script lang="ts">
  // CannedResponsePanel.svelte — 빠른답변 상세/편집 패널
  // create/update: 기존 /api/cms/canned-responses REST API fetch 재사용 (로직 중복 없음)
  // delete: CmsDeleteButton.svelte action="?/delete" 재사용

  import { untrack } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import { csToast } from '$lib/utils/toast'
  import { isValidCtaUrl } from '$lib/utils/ctaUrl'
  import { DEFAULT_CANNED_CATEGORIES, sortCategories, type CannedCategory } from '$lib/constants/cannedResponseCategories'
  import { HELP_CATEGORIES } from '$lib/constants/helpCategories'
  import RichContentEditor from '$lib/components/editor/RichContentEditor.svelte'
  import type { ContentBlock } from '$lib/types/content-editor'
  import { blocksToPlainText, extractCannedMedia, hasBlocksContent, mediaThumbUrl, textToBlocks } from '$lib/utils/cannedBlocks'
  // 로컬 타입 정의 (routes 크로스-임포트 금지 원칙)
  interface CannedResponseRow {
    id: string
    title: string
    content: string
    category: string | null
    help_category: string | null
    shortcut: string | null
    match_keywords: string[]
    usage_count: number
    created_at: string
    image_url: string | null
    cta_label: string | null
    cta_url: string | null
    pending_review?: boolean
    /** 서식 본문(공통 문서 편집기). null/없음 = 순수 텍스트만 있는 기존 답변 */
    content_blocks?: ContentBlock[] | null
  }

  const MAX_KEYWORDS = 10

  interface Props {
    item: CannedResponseRow | null
    onclose?: () => void
    oncreated?: (id: string) => void
    /** 분류 목록(설정에서 추가한 분류 포함). 없으면 기본 6개 */
    categories?: readonly CannedCategory[]
  }

  let { item, onclose, oncreated, categories = DEFAULT_CANNED_CATEGORIES }: Props = $props()

  const isNew = $derived(item === null)

  // 로컬 편집 상태
  let localTitle    = $state('')
  // 서식 본문(공통 문서 편집기) — 채팅에는 이 본문의 텍스트(localContent)만 나가고, 이미지·동영상은 썸네일로 따로 붙는다
  let localBlocks   = $state<ContentBlock[]>([])
  let editorKey     = $state(0)
  let editorRef     = $state<RichContentEditor | undefined>()
  // 편집기가 요구하는 키워드 바인딩(이 화면은 showKeywords=false라 쓰지 않음 — 고객 매칭 키워드는 아래 별도 입력란)
  let editorKeywords = $state<string[]>([])
  // 이미지·동영상 업로드 위치(Storage 폴더) — 새 답변은 임시 폴더, 기존 답변은 답변 id 폴더
  let tmpUploadId   = $state(globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'tmp')
  const localContent = $derived(blocksToPlainText(localBlocks))
  const localMedia   = $derived(extractCannedMedia(localBlocks))
  let localCategory = $state<string | null>(null)
  let localHelpCategory = $state<string | null>(null)
  let localShortcut = $state('')
  let localKeywords = $state<string[]>([])
  let kwInput       = $state('')
  let isSaving      = $state(false)
  let localImageUrl  = $state('')
  let localCtaLabel  = $state('')
  let localCtaUrl    = $state('')

  // item 변경 시 로컬 상태 동기화
  $effect(() => {
    localTitle    = item?.title    ?? ''
    // 서식 본문이 있으면 그대로, 없으면(기존 순수 텍스트 답변) 줄 단위 문단으로 변환해 편집기에 넣는다
    localBlocks   = item?.content_blocks && item.content_blocks.length > 0
      ? (JSON.parse(JSON.stringify(item.content_blocks)) as ContentBlock[])
      : textToBlocks(item?.content)
    // 같은 effect 안에서 읽고 쓰면 자기 자신을 다시 예약해 무한 갱신이 될 수 있어 읽기를 추적에서 뺀다
    untrack(() => { editorKey++ })
    localCategory = item?.category ?? null
    localHelpCategory = item?.help_category ?? null
    localShortcut = item?.shortcut ?? ''
    localKeywords = item?.match_keywords ? [...item.match_keywords] : []
    kwInput       = ''
    localImageUrl  = item?.image_url  ?? ''
    localCtaLabel  = item?.cta_label  ?? ''
    localCtaUrl    = item?.cta_url    ?? ''
  })

  // ── 고객 매칭 키워드 (단축키와 분리 — IME-safe, CmsContentEditor 키워드 패턴 참고) ──
  function addKeyword(): void {
    const kw = kwInput.trim()
    if (!kw || localKeywords.length >= MAX_KEYWORDS || localKeywords.includes(kw)) {
      kwInput = ''
      return
    }
    localKeywords = [...localKeywords, kw]
    kwInput = ''
  }

  function removeKeyword(kw: string): void {
    localKeywords = localKeywords.filter((k) => k !== kw)
  }

  function handleKwKeydown(e: KeyboardEvent): void {
    if (e.isComposing) return // IME 조합 중 무시 (한글 이중 등록 방지)
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addKeyword()
    } else if (e.key === 'Backspace' && kwInput === '' && localKeywords.length > 0) {
      localKeywords = localKeywords.slice(0, -1)
    }
  }

  const contentLength = $derived(localContent.length)
  const shortcutDisplay = $derived(
    localShortcut ? (localShortcut.startsWith('/') ? localShortcut : `/${localShortcut}`) : ''
  )

  async function handleSave(): Promise<void> {
    if (isSaving) return
    // 편집기의 디바운스 대기 중인 마지막 입력을 저장 전에 확정하고 직렬화 누락 여부를 점검한다(변경이 없으면 원본 그대로)
    const flushed = editorRef?.flush()
    if (flushed && !flushed.ok) {
      csToast.error('본문을 저장 형식으로 변환하는 중 내용이 달라져 저장을 멈췄어요. 새로고침 후 다시 시도해주세요.')
      return
    }
    const blocksToSave = flushed?.blocks ?? localBlocks
    const contentToSave = blocksToPlainText(blocksToSave).trim()
    if (!localTitle.trim() || !contentToSave || !localHelpCategory || !hasBlocksContent(blocksToSave)) return
    // CTA 입력 검증 — 링크는 http(s):// 또는 / 로 시작해야 고객 화면에서 열린다. 버튼 텍스트만 있고 링크가
    // 없으면 눌러도 동작하지 않는 버튼이 되므로 막는다(2026-10-02).
    const ctaUrlTrim = localCtaUrl.trim()
    if (ctaUrlTrim && !isValidCtaUrl(ctaUrlTrim)) {
      csToast.error('버튼 링크는 http:// 또는 https://로 시작하거나 /로 시작하는 사이트 내부 경로여야 합니다.')
      return
    }
    if (localCtaLabel.trim() && !ctaUrlTrim) {
      csToast.error('버튼 텍스트를 쓰려면 버튼 링크 URL도 입력해 주세요.')
      return
    }
    isSaving = true
    try {
      const url    = isNew ? '/api/cms/canned-responses' : `/api/cms/canned-responses/${item!.id}`
      const method = isNew ? 'POST' : 'PATCH'
      const body = {
        title:    localTitle.trim(),
        content:  contentToSave,
        content_blocks: blocksToSave,
        category: localCategory || null,
        help_category: localHelpCategory,
        shortcut: localShortcut.replace(/^\//, '').trim() || null,
        match_keywords: localKeywords,
        image_url: localImageUrl.trim() || null,
        cta_label: localCtaLabel.trim() || null,
        cta_url:   localCtaUrl.trim() || null,
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        csToast.error(d.error ?? '저장 실패')
        return
      }
      const created = await res.json() as { id?: string }
      csToast.success(isNew ? '빠른답변이 등록됐습니다.' : '빠른답변이 수정됐습니다.')
      await invalidateAll()
      if (isNew && created.id) oncreated?.(created.id)
    } finally {
      isSaving = false
    }
  }

  function handleDeleteSuccess(): void {
    csToast.success('빠른답변이 삭제됐습니다.')
    invalidateAll()
    onclose?.()
  }
</script>

<div class="panel">
  <div class="panel-head">
    <h3 class="panel-title">{isNew ? '새 빠른답변' : '빠른답변 편집'}</h3>
    <button class="btn-close" onclick={onclose} aria-label="패널 닫기">✕</button>
  </div>

  {#if item?.pending_review}
    <div class="pending-banner">
      ⚠️ CSV 일괄등록으로 생성돼 아직 검토 전인 항목입니다 — 지금은 실시간 고객채팅 자동매칭 대상이 아닙니다. 내용을 확인하고 "저장"을 누르면 검토 완료 처리되어 자동매칭 대상에 포함됩니다.
    </div>
  {/if}

  <div class="panel-body">
    <!-- 제목 -->
    <div class="field">
      <label class="field-label" for="cr-title">제목 <span class="req">*</span></label>
      <input
        id="cr-title"
        type="text"
        class="field-input"
        bind:value={localTitle}
        placeholder="빠른답변 제목을 입력하세요"
        maxlength="100"
      />
    </div>

    <!-- 도움말 분류 (카테고리 상위 분류, 콤보 버튼 — 필수) -->
    <div class="field">
      <span class="field-label">도움말 분류 <span class="req">*</span> <span class="field-hint">(선택 시 /help 고객센터 FAQ에 자동 반영됩니다)</span></span>
      <div class="cat-pills">
        {#each HELP_CATEGORIES as cat}
          <button
            type="button"
            class="cat-pill"
            class:active={localHelpCategory === cat.value}
            onclick={() => localHelpCategory = cat.value}
          >{cat.label}</button>
        {/each}
      </div>
    </div>

    <!-- 카테고리 (콤보 버튼) -->
    <div class="field">
      <span class="field-label">빠른답변 분류</span>
      <div class="cat-pills">
        <button
          type="button"
          class="cat-pill"
          class:active={localCategory === null}
          onclick={() => localCategory = null}
        >전체</button>
        {#each sortCategories(categories, { activeOnly: true }).concat(categories.filter((c) => !c.is_active && c.value === localCategory)) as cat (cat.value)}
          <button
            type="button"
            class="cat-pill"
            class:active={localCategory === cat.value}
            onclick={() => localCategory = cat.value}
          >{cat.label}</button>
        {/each}
      </div>
    </div>

    <!-- 단축키 -->
    <div class="field">
      <label class="field-label" for="cr-shortcut">단축키</label>
      <div class="shortcut-wrap">
        <span class="shortcut-prefix">/</span>
        <input
          id="cr-shortcut"
          type="text"
          class="field-input field-input--shortcut"
          bind:value={localShortcut}
          placeholder="예: return, payment"
          maxlength="30"
        />
      </div>
      <!-- 단축키 미리보기 — ChatInput /드롭다운이 어떻게 보일지 -->
      {#if shortcutDisplay}
        <div class="shortcut-preview">
          <span class="preview-label">미리보기</span>
          <div class="preview-row">
            <span class="preview-shortcut">{shortcutDisplay}</span>
            <span class="preview-title">{localTitle || '(제목 없음)'}</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- 고객 매칭 키워드 (단축키와 분리 — 크레이지챗·빠른답변이 고객 메시지를 판단할 때 쓰는 값) -->
    <div class="field">
      <label class="field-label" for="cr-kw-input">
        매칭 키워드
        <span class="field-hint">(크레이지챗이 이 단어를 보면 이 답변을 보냅니다)</span>
      </label>
      <div class="kw-tag-list" role="group" aria-label="매칭 키워드 (최대 10개)">
        {#each localKeywords as kw (kw)}
          <span class="kw-tag">
            {kw}
            <button type="button" class="kw-del" onclick={() => removeKeyword(kw)} aria-label={`${kw} 키워드 삭제`}>×</button>
          </span>
        {/each}
        {#if localKeywords.length < MAX_KEYWORDS}
          <input
            id="cr-kw-input"
            type="text"
            class="kw-input"
            placeholder={localKeywords.length === 0 ? '예: 파손, 고장, 깨짐 (Enter로 추가)' : '키워드 추가...'}
            bind:value={kwInput}
            onkeydown={handleKwKeydown}
            onblur={addKeyword}
          />
        {/if}
      </div>
      <span class="kw-count">{localKeywords.length}/{MAX_KEYWORDS}</span>
    </div>

    <!-- 내용 -->
    <div class="field">
      <label class="field-label" for="cr-content">
        내용 <span class="req">*</span>
        <span class="char-count">{contentLength}자</span>
      </label>
      <!-- 공통 문서 편집기(RichContentEditor) — 글자 서식·이미지·동영상·표. 채팅에는 텍스트만, 이미지·동영상은 썸네일로 나간다 -->
      {#key editorKey}
        <div class="content-editor-box" id="cr-content">
          <RichContentEditor
            bind:this={editorRef}
            bind:blocks={localBlocks}
            bind:keywords={editorKeywords}
            variant="cms"
            showKeywords={false}
            uploadPrefix={`canned/${item?.id ?? tmpUploadId}`}
            placeholder="고객에게 전송할 답변 내용을 입력하세요"
          />
        </div>
      {/key}
    </div>

    <!-- 내용 전체 미리보기 — 채팅에 실제로 나가는 모습(글자만 + 이미지·동영상 썸네일) -->
    {#if localContent}
      <div class="content-preview">
        <span class="preview-label">내용 미리보기 (채팅 표시)</span>
        <div class="preview-bubble">{localContent}</div>
        {#if localMedia.length > 0}
          <div class="preview-media">
            {#each localMedia as m, i (i)}
              <span class="preview-thumb">
                <img src={mediaThumbUrl(m)} alt="" loading="lazy" />
                {#if m.type === 'youtube'}<span class="preview-play" aria-hidden="true">▶</span>{/if}
              </span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- CTA 카드 (선택) — image_url / cta_label / cta_url -->
    <div class="field cta-section">
      <span class="field-label cta-section-label">
        액션 카드 (CTA) <span class="field-hint">— 선택사항. 채팅창에 버튼/이미지 카드 형태로 노출됩니다.</span>
      </span>
      <div class="cta-fields">
        <div class="cta-field">
          <label class="cta-field-label" for="cr-image-url">
            이미지 URL <span class="field-hint">— 카드 대표 이미지(주소 직접 입력). 본문에 넣을 사진·동영상은 위 편집기에 추가하세요.</span>
          </label>
          <input
            id="cr-image-url"
            type="url"
            class="field-input"
            bind:value={localImageUrl}
            placeholder="https://res.cloudinary.com/..."
          />
        </div>
        <div class="cta-row">
          <div class="cta-field cta-field--half">
            <label class="cta-field-label" for="cr-cta-label">버튼 텍스트</label>
            <input
              id="cr-cta-label"
              type="text"
              class="field-input"
              bind:value={localCtaLabel}
              placeholder="예: 자세히 보기"
              maxlength="30"
            />
          </div>
          <div class="cta-field cta-field--half">
            <label class="cta-field-label" for="cr-cta-url">버튼 링크 URL</label>
            <input
              id="cr-cta-url"
              type="url"
              class="field-input"
              bind:value={localCtaUrl}
              placeholder="https://..."
            />
          </div>
        </div>
      </div>
      {#if localCtaLabel || localCtaUrl || localImageUrl}
        <div class="cta-preview">
          <span class="preview-label">CTA 카드 미리보기</span>
          <div class="cta-preview-card">
            {#if localImageUrl}
              <div class="cta-preview-img-wrap">
                <img src={localImageUrl} alt="CTA 이미지" class="cta-preview-img" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
              </div>
            {/if}
            {#if localCtaLabel}
              <div class="cta-preview-btn">{localCtaLabel}</div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <div class="panel-foot">
    {#if !isNew && item}
      <CmsDeleteButton
        action="?/delete"
        id={item.id}
        warnMessage="빠른답변을 삭제하면 복구할 수 없습니다."
        successMessage="삭제됐습니다."
        onsuccess={handleDeleteSuccess}
      />
    {/if}
    <div class="foot-right">
      <button type="button" class="btn-cancel" onclick={onclose}>취소</button>
      <button
        type="button"
        class="btn-save"
        onclick={handleSave}
        disabled={!localTitle.trim() || !localContent.trim() || !localHelpCategory || isSaving}
      >
        {isSaving ? '저장 중...' : isNew ? '등록' : '저장'}
      </button>
    </div>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);   /* cms-uiux.md §1/§7-4 — 목록형 카드(패널) 표준 15px, 30px 아니었음 */
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);   /* §1 DetailPanel 필수 구조 — 누락돼 있었음 */
    overflow: hidden;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }

  .panel-title {
    font: var(--text-pc-title-18, 700 18px/1.4 'Noto Sans KR', sans-serif);
    color: var(--cs-dark);
    margin: 0;
  }

  /* close-red 표준(cms-uiux.md §0-10-A) */
  .btn-close {
    margin-left: auto;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-text-light);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .btn-close:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  /* Migration #617 — 미검토(pending_review) 안내 배너 */
  .pending-banner {
    flex-shrink: 0;
    padding: 10px 24px;
    background: var(--cs-red-xlight, rgba(255,53,53,0.08));
    color: var(--cs-red-badge, #FF3535);
    font: 700 12px/1.5 'Noto Sans KR', sans-serif;
  }

  /* §1 DetailPanel 필수 구조 — display:block 필수(flex 자식 압축·클립 버그 방지), gap 대신 margin-top */
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: block;
    padding: 16px 20px 20px;
  }
  .panel-body > * + * {
    margin-top: 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font: var(--text-pc-body-14, 700 14px/1.4 'Noto Sans KR', sans-serif);
    color: var(--cs-text-mid, #666);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .req { color: var(--cs-red-badge, #FF3535); font-weight: 400; }

  .field-hint {
    font: 400 11px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaa);
  }

  /* 고객 매칭 키워드 태그 입력 — cms-uiux.md §7-7 .f-input 표준(배경 gray, 테두리 없음) */
  .kw-tag-list {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 38px;
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray, #f6f6f6);
  }
  .kw-tag-list:focus-within { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .kw-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border-radius: 6px;
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    white-space: nowrap;
  }

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
    flex: 1;
    min-width: 140px;
    border: none;
    background: transparent;
    outline: none;
    font: 400 13px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-dark);
  }
  .kw-input::placeholder { color: var(--cs-text-light, #aaa); }

  .kw-count {
    align-self: flex-end;
    font: 400 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaa);
  }

  .char-count {
    margin-left: auto;
    font: 400 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaa);
  }

  /* cms-uiux.md §7-7 .f-input 표준(배경 gray, 테두리 없음) */
  .field-input {
    border: none;
    border-radius: var(--radius-sm);
    padding: 10px 16px;
    font: var(--text-pc-body-14, 700 14px/1.4 'Noto Sans KR', sans-serif);
    color: var(--cs-text);
    background: var(--cs-surface-gray, #f6f6f6);
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }
  .field-input:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }

  /* 카테고리 콤보 버튼 */
  .cat-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .cat-pill {
    height: 34px;
    padding: 0 18px;   /* 콤보버튼 UI 표준(cms-uiux.md §7-12-A) — 좌우 패딩 14px → 18px(+30%) */
    border-radius: var(--radius-xl, 30px);
    border: none;      /* 콤보버튼 UI 표준(§7-12-A, 2026-08-18) — 아웃라인 제거 */
    background: var(--cs-lilac);   /* 콤보버튼 UI 표준(§7-12-A, 2026-08-18) — 제일 옅은 퍼플 톤(purple-5%) */
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .cat-pill.active {
    background: var(--cs-purple);
    color: var(--cs-white);
  }
  .cat-pill:hover:not(.active) {
    color: var(--cs-purple);
  }

  /* 단축키 — cms-uiux.md §7-7 .f-input 표준(배경 gray, 테두리 없음) */
  .shortcut-wrap {
    display: flex;
    align-items: center;
    gap: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray, #f6f6f6);
    overflow: hidden;
  }
  .shortcut-wrap:focus-within { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .shortcut-prefix {
    padding: 10px 10px 10px 14px;
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-purple);
    background: var(--cs-lilac);
    user-select: none;
  }

  .field-input--shortcut {
    border: none;
    border-radius: 0;
    background: transparent;
    flex: 1;
  }
  .field-input--shortcut:focus { outline: none; }   /* .shortcut-wrap:focus-within이 대신 표시 — 이중 아웃라인 방지 */

  /* 미리보기 공통 */
  .shortcut-preview,
  .content-preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }

  /* 공통 문서 편집기 래퍼 — ProductDetailPanel .content-editor-box와 동일 */
  .content-editor-box {
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm);
    overflow: clip;
  }
  .preview-media { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .preview-thumb {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--cs-lilac);
  }
  .preview-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .preview-play {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--cs-white);
    background: rgba(16, 11, 50, 0.35);
    font-size: 14px;
  }

  .preview-label {
    font: 700 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaa);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .preview-row {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
  }

  .preview-shortcut {
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-purple);
    background: rgba(59,47,138,0.08);
    padding: 3px 8px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .preview-title {
    font: 400 13px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-bubble {
    background: var(--cs-lilac);
    border-radius: var(--radius-md, 15px);
    padding: 12px 16px;
    font: 400 13px/1.6 'Noto Sans KR', sans-serif;
    color: var(--cs-dark);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* 하단 액션 */
  .panel-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-top: 1px solid var(--cs-lilac);
    flex-shrink: 0;
    gap: 12px;
  }

  .foot-right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  /* cms-uiux.md §7-3 .btn-secondary(CTA 보조) 표준 */
  .btn-cancel {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    padding: 0 30px;
    border-radius: var(--radius-md, 15px);
    border: 1px solid var(--cs-purple-dark, #201857);
    background: var(--cs-white);
    font: var(--text-pc-body-14, 700 14px/1.4 'Noto Sans KR', sans-serif);
    letter-spacing: -0.5px;
    color: var(--cs-purple-dark, #201857);
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-cancel:hover { background: rgba(59,47,138,0.06); }

  /* cms-uiux.md §7-3 .btn-primary(CTA 기본) 표준 */
  .btn-save {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    padding: 0 30px;
    border-radius: var(--radius-md, 15px);
    border: none;
    background: var(--cs-purple);
    font: var(--text-pc-body-14, 700 14px/1.4 'Noto Sans KR', sans-serif);
    letter-spacing: -0.5px;
    color: var(--cs-white);
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-save:hover:not(:disabled) { background: var(--cs-purple-hover, #2e2468); }
  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* CTA 섹션 */
  .cta-section {
    border-top: 1px dashed var(--cs-lilac);
    padding-top: 16px;
  }

  .cta-section-label {
    flex-direction: column;
    align-items: flex-start !important;
    gap: 2px !important;
  }

  .cta-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cta-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cta-field-label {
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
  }

  .cta-row {
    display: flex;
    gap: 10px;
  }

  .cta-field--half {
    flex: 1;
    min-width: 0;
  }

  /* CTA 미리보기 카드 */
  .cta-preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
  }

  .cta-preview-card {
    border: 1.5px solid var(--cs-lilac);
    border-radius: var(--radius-md, 15px);
    overflow: hidden;
    background: var(--cs-white);
    max-width: 220px;
  }

  .cta-preview-img-wrap {
    width: 100%;
    aspect-ratio: 16/9;
    overflow: hidden;
    background: var(--cs-surface-gray, #f6f6f6);
  }

  .cta-preview-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cta-preview-btn {
    padding: 8px 14px;
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-purple);
    text-align: center;
  }
</style>
