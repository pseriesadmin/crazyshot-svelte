<script lang="ts">
  import { csToast } from '$lib/utils/toast'
  import { substituteVariables, type AnyContentBlock } from '$lib/utils/contract-substitution'
  import { applyContractTemplate } from '$lib/utils/contract-apply-template'
  import { hasExistingContractContent } from '$lib/utils/contract-content-mode'
  import { isTiptapDocBlock } from '$lib/types/contract-document'
  import { renderTiptapDocToHtml } from '$lib/utils/tiptapRender'
  import type { TiptapDocBlock } from '$lib/types/contract-document'
  import type { ContractSubstitutionData } from '$lib/types/contract-module'

  interface TemplateSummary {
    id: string
    title: string
    content_blocks: AnyContentBlock[]
    specifications: { key: string; value: string }[]
    created_at: string
    /** canvas 모드 여부 — GET /api/cms/contract-templates로 반환 */
    authoring_mode?: string
    /** canvas 모드 문서 — authoring_mode='canvas'일 때 contracts.canvas_document에 저장 */
    canvas_document?: unknown
  }

  interface Props {
    contractId: string | null
    reservationId: number
    initialTemplateId?: string | null
    onclose: () => void
    onsent: () => void
    onEdit?: () => void
  }

  let { contractId, reservationId, initialTemplateId = null, onclose, onsent, onEdit }: Props = $props()

  let templates      = $state<TemplateSummary[]>([])
  let selectedId     = $state<string | null>(null)
  let subData        = $state<ContractSubstitutionData | null>(null)
  let loading        = $state(true)
  let sending        = $state(false)
  let error          = $state<string | null>(null)

  // ── 편집 내용 보존 관련 상태 ─────────────────────────────────────────────────
  // existing 모드: DB에 저장된 content_blocks 그대로 발송 (PATCH 없음, 편집 내용 보존)
  // template 모드: 양식 치환 후 PATCH 저장 → 발송 (기존 동작)
  let existingBlocks        = $state<AnyContentBlock[]>([])
  // canvas 계약의 경우 content_blocks는 항상 [] — canvas_document를 보관해 미리보기 분기에 활용
  let existingCanvasDocument = $state<unknown>(null)
  let hasExistingContent = $state(false)
  let contentMode        = $state<'existing' | 'template'>('template')
  let overwriteWarning   = $state(false)       // 덮어쓰기 확인 배너 표시 여부
  let pendingTemplateId  = $state<string | null>(null)  // 덮어쓰기 대기 중인 양식 ID

  const selectedTemplate = $derived(templates.find((t) => t.id === selectedId) ?? null)

  // 미리보기 블록: existing 모드는 저장된 블록 그대로, template 모드는 치환 결과
  const previewBlocks = $derived<AnyContentBlock[]>(
    contentMode === 'existing'
      ? existingBlocks
      : (selectedTemplate && subData
          ? substituteVariables(selectedTemplate.content_blocks ?? [], subData)
          : [])
  )

  const previewTitle = $derived(
    contentMode === 'existing' ? '현재 편집된 내용 미리보기' : (selectedTemplate?.title ?? '')
  )

  const showPreview = $derived(
    // canvas 계약은 existingBlocks가 [] 이므로 existingCanvasDocument 유무도 함께 확인
    (contentMode === 'existing' && (existingBlocks.length > 0 || existingCanvasDocument != null)) ||
    (contentMode === 'template' && selectedTemplate !== null)
  )

  // 발송 버튼 비활성화 조건
  const sendDisabled = $derived(
    sending ||
    overwriteWarning ||
    (contentMode === 'template' && !selectedTemplate)
  )

  async function loadData() {
    loading = true
    error = null
    try {
      const [tplRes, subRes] = await Promise.all([
        fetch('/api/cms/contract-templates'),
        fetch(`/api/cms/reservations/${reservationId}/contract-data`),
      ])
      if (!tplRes.ok) throw new Error('계약서 양식 목록을 불러오지 못했습니다.')
      if (!subRes.ok) throw new Error('예약 데이터를 불러오지 못했습니다.')

      templates = (await tplRes.json()) as TemplateSummary[]
      subData   = (await subRes.json()) as ContractSubstitutionData

      // 기존 계약서 편집 내용 확인 (편집 보존 목적 — contractId가 있을 때만)
      // 실패해도 template 모드로 graceful fallback (주요 로드에 영향 없음)
      if (contractId) {
        try {
          const contentRes = await fetch(`/api/cms/contracts/${contractId}/content`)
          if (contentRes.ok) {
            const contentData = (await contentRes.json()) as { content_blocks?: unknown; canvas_document?: unknown }
            if (hasExistingContractContent(contentData.content_blocks, contentData.canvas_document)) {
              existingBlocks = contentData.content_blocks as AnyContentBlock[]
              // canvas 계약은 canvas_document를 보관 — 미리보기 분기 및 showPreview 조건에 사용
              existingCanvasDocument = contentData.canvas_document ?? null
              hasExistingContent = true
              contentMode = 'existing'
            }
          }
        } catch {
          // 네트워크 오류 등 → template 모드 유지 (graceful fallback)
        }
      }

      // 템플릿 초기 선택 — template 모드일 때만 (existing 모드에서는 미리보기와 무관)
      if (contentMode !== 'existing') {
        if (initialTemplateId && templates.some((t) => t.id === initialTemplateId)) {
          selectedId = initialTemplateId
        } else if (templates.length > 0) {
          selectedId = templates[0].id
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : '데이터 로딩 실패'
    } finally {
      loading = false
    }
  }

  // 템플릿 항목 클릭 핸들러
  // existing 모드에서는 덮어쓰기 확인을 먼저 경유 — 조용한 덮어쓰기 경로 차단
  function onTemplateClick(templateId: string) {
    if (hasExistingContent && contentMode === 'existing') {
      pendingTemplateId = templateId
      overwriteWarning = true
    } else {
      selectedId = templateId
    }
  }

  // 덮어쓰기 확인 ("양식 다시 적용" 클릭)
  function confirmOverwrite() {
    if (pendingTemplateId) {
      selectedId = pendingTemplateId
      contentMode = 'template'
    }
    pendingTemplateId = null
    overwriteWarning = false
  }

  // 덮어쓰기 취소
  function cancelOverwrite() {
    pendingTemplateId = null
    overwriteWarning = false
  }

  async function send() {
    // 사전 가드
    if (contentMode === 'template' && (!selectedTemplate || !subData)) return
    if (contentMode === 'existing' && !contractId) {
      csToast.error('계약서 정보를 찾을 수 없습니다.')
      return
    }

    sending = true
    try {
      if (contentMode === 'existing') {
        // ── existing 경로: 편집 내용 보존 ──────────────────────────────────────
        // applyContractTemplate() 호출 없음 → PATCH 없음 → 편집 내용 안전
        // 단순히 send-chat만 호출해 현재 저장된 content_blocks 그대로 발송
        const sendRes = await fetch(`/api/cms/contracts/${contractId}/send-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!sendRes.ok) {
          const body = await sendRes.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? '발송 실패')
        }
      } else {
        // ── template 경로: 양식 치환 + PATCH 저장 + 발송 (기존 동작) ───────────
        if (!selectedTemplate || !subData) return  // TypeScript 타입 가드 (위에서 이미 체크)

        const isCanvas = selectedTemplate.authoring_mode === 'canvas'

        // canvas 모드는 content_blocks가 빈 배열 — substituteVariables 적용 불필요.
        // 변수 치환은 고객 서명 화면(/contract/[token])에서 렌더링 시 적용됨.
        const substitutedBlocks = isCanvas
          ? []
          : substituteVariables(selectedTemplate.content_blocks ?? [], subData)

        const result = await applyContractTemplate({
          contractId,
          reservationId,
          title:           selectedTemplate.title,
          contentBlocks:   substitutedBlocks,
          specifications:  selectedTemplate.specifications ?? [],
          templateId:      selectedTemplate.id,
          authoring_mode:  isCanvas ? 'canvas' : 'flow',
          canvasDocument:  isCanvas ? selectedTemplate.canvas_document : undefined,
        })

        if (result.error) throw new Error(result.error)

        const sendRes = await fetch(`/api/cms/contracts/${result.contractId}/send-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!sendRes.ok) {
          const body = await sendRes.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? '발송 실패')
        }
      }

      csToast.success('계약서가 채팅으로 발송되었습니다.')
      onsent()
    } catch (e) {
      csToast.error(e instanceof Error ? e.message : '발송에 실패했습니다.')
    } finally {
      sending = false
    }
  }

  loadData()
</script>

<div class="modal-overlay" role="dialog" aria-modal="true" aria-label="계약서 양식 선택 및 발송">
  <div class="modal-wrap">
    <!-- 헤더 -->
    <div class="modal-header">
      <span class="modal-title">계약서 양식 적용 & 발송</span>
      <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
    </div>

    {#if loading}
      <div class="state-center">
        <p class="state-text">불러오는 중...</p>
      </div>
    {:else if error}
      <div class="state-center">
        <p class="state-error">{error}</p>
        <button class="btn-retry" onclick={loadData}>다시 시도</button>
      </div>
    {:else if templates.length === 0}
      <div class="state-center">
        <p class="state-text">등록된 활성 계약서 양식이 없습니다.</p>
        <p class="state-sub">/cms/reservation/contracts 에서 양식을 먼저 작성하세요.</p>
      </div>
    {:else}
      <!-- 덮어쓰기 확인 배너: existing 모드에서 양식 선택 시 표시 -->
      {#if overwriteWarning}
        <div class="overwrite-banner" role="alert">
          <p class="overwrite-msg">
            이미 편집된 내용이 있습니다. 이 양식을 다시 적용하면 편집 내용이 사라집니다.
          </p>
          <div class="overwrite-actions">
            <button type="button" class="btn-cancel-overwrite" onclick={cancelOverwrite}>취소</button>
            <button type="button" class="btn-confirm-overwrite" onclick={confirmOverwrite}>양식 다시 적용</button>
          </div>
        </div>
      {/if}

      <div class="modal-body">
        <!-- 좌측: 양식 목록 -->
        <div class="tpl-list">
          <p class="list-label">
            {contentMode === 'existing' ? '다른 양식으로 교체' : '양식 선택'}
          </p>
          {#if hasExistingContent && contentMode === 'existing'}
            <p class="list-existing-hint">양식 클릭 시 편집 내용 대체 확인</p>
          {/if}
          {#each templates as tpl (tpl.id)}
            <button
              type="button"
              class="tpl-item"
              class:selected={contentMode === 'template' && selectedId === tpl.id}
              class:tpl-item-overwrite-pending={overwriteWarning && pendingTemplateId === tpl.id}
              onclick={() => onTemplateClick(tpl.id)}
            >
              {tpl.title}
            </button>
          {/each}
        </div>

        <!-- 우측: 미리보기 (문서 뷰어) -->
        <div class="preview-pane">
          {#if contentMode === 'existing' && !overwriteWarning}
            <div class="existing-notice">
              편집된 내용이 그대로 발송됩니다. 다른 양식으로 교체하려면 좌측 목록에서 양식을 클릭하세요.
            </div>
          {/if}
          {#if showPreview}
            <div class="doc-page">
              <div
                class="preview-title"
                class:preview-title-existing={contentMode === 'existing'}
              >
                {previewTitle}
              </div>
              {#if contentMode === 'template' && selectedTemplate?.authoring_mode === 'canvas'}
                <div class="preview-canvas-notice">
                  고정 캔버스형 계약서입니다. 발송 후 고객 서명 화면에서 배경 서식과 서명 필드를 확인할 수 있습니다.
                </div>
              {:else if contentMode === 'existing' && existingCanvasDocument != null}
                <div class="preview-canvas-notice">
                  발행된 고정 캔버스형 계약서입니다. 발송 후 고객 서명 화면에서 기존 발행 내용을 그대로 확인할 수 있습니다.
                </div>
              {/if}
              <div class="preview-content">
                {#each previewBlocks as block (block)}
                  {#if isTiptapDocBlock(block)}
                    <!-- tiptap-doc: 치환 후 정적 HTML로 렌더링 (발송 전 실시간 미리보기) -->
                    <div class="preview-block preview-block-tiptap">{@html renderTiptapDocToHtml((block as TiptapDocBlock).doc)}</div>
                  {:else if block.type === 'text'}
                    <div class="preview-block">{@html block.html}</div>
                  {:else if block.type === 'html'}
                    <div class="preview-block">{@html block.content}</div>
                  {:else if block.type === 'divider'}
                    <hr class="preview-divider" />
                  {/if}
                {/each}
              </div>
            </div>
          {:else if contentMode === 'template'}
            <div class="preview-empty">양식을 선택하세요.</div>
          {/if}
        </div>
      </div>

      <!-- 푸터 -->
      <div class="modal-footer">
        <button type="button" class="btn-cancel" onclick={onclose}>취소</button>
        {#if onEdit}
          <button type="button" class="btn-edit" onclick={onEdit}>편집</button>
        {/if}
        <button
          type="button"
          class="btn-send"
          onclick={send}
          disabled={sendDisabled}
        >
          {sending ? '발송 중...' : '채팅으로 발송'}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .modal-wrap {
    background: var(--cs-white);
    border-radius: var(--cms-radius-sm);
    width: 960px;
    max-width: 100%;
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  }

  /* 헤더 */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .modal-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--cs-text-mid);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--cs-lilac); }

  /* 상태 화면 */
  .state-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 24px;
  }
  .state-text { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0; }
  .state-sub  { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .state-error { font: var(--text-pc-body-14); color: var(--cs-error); margin: 0; }
  .btn-retry {
    height: 30px;
    padding: 0 14px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    background: transparent;
    font: var(--text-pc-script-12);
    cursor: pointer;
  }

  /* 덮어쓰기 확인 배너 */
  .overwrite-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 20px;
    background: rgba(245, 158, 11, 0.08);
    border-bottom: 1px solid rgba(245, 158, 11, 0.25);
    border-left: 3px solid var(--cs-warning);
    flex-shrink: 0;
  }
  .overwrite-msg {
    margin: 0;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-warning);
    flex: 1;
    min-width: 0;
  }
  .overwrite-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .btn-cancel-overwrite {
    height: 28px;
    padding: 0 12px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.1s;
    white-space: nowrap;
  }
  .btn-cancel-overwrite:hover { background: var(--cs-lilac); }
  .btn-confirm-overwrite {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--cs-warning);
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    color: var(--cs-warning);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    white-space: nowrap;
  }
  .btn-confirm-overwrite:hover {
    background: rgba(245, 158, 11, 0.10);
  }

  /* 기존 내용 사용 중 안내 (미리보기 상단) */
  .existing-notice {
    padding: 8px 14px;
    margin-bottom: 16px;
    background: rgba(245, 158, 11, 0.06);
    border: 1px solid rgba(245, 158, 11, 0.20);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-warning);
    line-height: 1.5;
  }

  /* 미리보기 제목 — existing 모드 구분 */
  .preview-title-existing {
    color: var(--cs-text-mid);
    font-size: 13px;
    font-weight: 700;
  }

  /* 바디 */
  .modal-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* 좌측 목록 */
  .tpl-list {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--cs-lilac);
    overflow-y: auto;
    padding: 12px 0;
  }
  .list-label {
    margin: 0 0 4px;
    padding: 0 14px;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .list-existing-hint {
    margin: 0 0 6px;
    padding: 2px 14px;
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-warning);
    font-size: 11px;
  }
  .tpl-item {
    display: block;
    width: 100%;
    padding: 10px 14px;
    border: none;
    background: transparent;
    text-align: left;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    cursor: pointer;
    transition: background 0.1s;
    border-bottom: 1px solid var(--cs-lilac);
  }
  .tpl-item:last-child { border-bottom: none; }
  .tpl-item:hover    { background: var(--cs-surface-gray); }
  .tpl-item.selected { background: var(--cs-purple-op10); color: var(--cs-purple); }
  .tpl-item.tpl-item-overwrite-pending {
    background: rgba(245, 158, 11, 0.08);
    color: var(--cs-warning);
  }

  /* 우측 미리보기 — 문서 뷰어 (실제 계약서처럼 종이 카드로 표시) */
  .preview-pane {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    background: var(--cs-surface-gray);
    padding: 28px 24px;
  }
  .preview-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
  }

  /* 종이 문서 카드 — A4 폭 기준 */
  .doc-page {
    width: 100%;
    max-width: 210mm;
    margin: 0 auto;
    background: var(--cs-white);
    box-shadow: 0 1px 2px rgba(16,11,50,0.06), 0 10px 28px rgba(16,11,50,0.10);
    padding: 20mm;
    box-sizing: border-box;
    position: relative; /* overlay 이미지 absolute 배치 기준점 */
  }
  .preview-title {
    padding: 0 0 18px;
    margin: 0 0 22px;
    font: var(--text-pc-title-18);
    font-weight: 700;
    color: var(--cs-text);
    border-bottom: 2px solid var(--cs-text);
    text-align: center;
  }
  .preview-content {
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .preview-block {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    line-height: 1.9;
  }
  /* overlay 이미지(position:absolute)가 이 블록을 기준으로 배치됨 — contract/[token]/+page.svelte .doc-block-tiptap과 동일 패턴 */
  .preview-block-tiptap {
    position: relative;
  }
  .preview-block :global(table.cs-contract-table) {
    width: 100%;
    border-collapse: collapse;
    font: var(--text-pc-script-12);
  }
  .preview-block :global(table.cs-contract-table th),
  .preview-block :global(table.cs-contract-table td) {
    border: 1px solid #DDDDDD;
    padding: 7px 10px;
    text-align: left;
  }
  .preview-block :global(table.cs-contract-table th) {
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font-weight: 700;
    width: 100px;
    white-space: nowrap;
  }
  .preview-divider {
    border: none;
    border-top: 1px solid var(--cs-lilac);
    margin: 4px 0;
  }

  /* canvas 모드 안내 */
  .preview-canvas-notice {
    padding: 10px 14px;
    margin-bottom: 16px;
    background: rgba(59, 47, 138, 0.06);
    border: 1px solid rgba(59, 47, 138, 0.18);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-purple);
    line-height: 1.5;
  }

  /* 푸터 */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .btn-cancel {
    height: 34px;
    padding: 0 16px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.1s;
  }
  .btn-cancel:hover { background: var(--cs-lilac); }

  .btn-edit {
    height: 34px;
    padding: 0 16px;
    border: 1px solid var(--cs-purple);
    border-radius: var(--cms-radius-sm);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.1s;
    white-space: nowrap;
  }
  .btn-edit:hover { background: var(--cs-purple-op10); }

  .btn-send {
    height: 34px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-send:hover    { background: var(--cs-purple-hover); }
  .btn-send:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .no-contract-note {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin-right: auto;
  }
</style>
