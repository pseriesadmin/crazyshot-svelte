<script lang="ts">
  import { csToast } from '$lib/utils/toast'
  import { substituteVariables } from '$lib/utils/contract-substitution'
  import type { ContentBlock } from '$lib/types/content-editor'
  import type { ContractSubstitutionData } from '$lib/types/contract-module'

  interface TemplateSummary {
    id: string
    title: string
    content_blocks: ContentBlock[]
    created_at: string
  }

  interface Props {
    contractId: string | null
    reservationId: number
    initialTemplateId?: string | null
    onclose: () => void
    onsent: () => void
  }

  let { contractId, reservationId, initialTemplateId = null, onclose, onsent }: Props = $props()

  let templates      = $state<TemplateSummary[]>([])
  let selectedId     = $state<string | null>(null)
  let subData        = $state<ContractSubstitutionData | null>(null)
  let loading        = $state(true)
  let sending        = $state(false)
  let error          = $state<string | null>(null)

  const selectedTemplate = $derived(templates.find((t) => t.id === selectedId) ?? null)

  const previewBlocks = $derived<ContentBlock[]>(
    selectedTemplate && subData
      ? substituteVariables(selectedTemplate.content_blocks ?? [], subData)
      : []
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

      if (initialTemplateId && templates.some((t) => t.id === initialTemplateId)) {
        selectedId = initialTemplateId
      } else if (templates.length > 0) {
        selectedId = templates[0].id
      }
    } catch (e) {
      error = e instanceof Error ? e.message : '데이터 로딩 실패'
    } finally {
      loading = false
    }
  }

  async function send() {
    if (!selectedTemplate || !subData) return
    sending = true
    try {
      // contractId가 없으면 (신청대기 등) 즉시 생성
      let activeContractId = contractId
      if (!activeContractId) {
        const initRes = await fetch(`/api/cms/reservations/${reservationId}/init-contract`, {
          method: 'POST',
        })
        if (!initRes.ok) {
          const body = await initRes.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? '계약서 생성 실패')
        }
        const { contractId: newId } = await initRes.json() as { contractId: string }
        activeContractId = newId
      }

      const substitutedBlocks = substituteVariables(
        selectedTemplate.content_blocks ?? [],
        subData
      )

      const patchRes = await fetch(`/api/cms/contracts/${activeContractId}/content`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title:          selectedTemplate.title,
          content_blocks: substitutedBlocks,
          specifications: [],
          template_id:    selectedTemplate.id,
        }),
      })
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? '저장 실패')
      }

      const sendRes = await fetch(`/api/cms/contracts/${activeContractId}/send-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!sendRes.ok) {
        const body = await sendRes.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? '발송 실패')
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
      <div class="modal-body">
        <!-- 좌측: 양식 목록 -->
        <div class="tpl-list">
          <p class="list-label">양식 선택</p>
          {#each templates as tpl (tpl.id)}
            <button
              type="button"
              class="tpl-item"
              class:selected={selectedId === tpl.id}
              onclick={() => { selectedId = tpl.id }}
            >
              {tpl.title}
            </button>
          {/each}
        </div>

        <!-- 우측: 미리보기 -->
        <div class="preview-pane">
          {#if !selectedTemplate}
            <div class="preview-empty">양식을 선택하세요.</div>
          {:else}
            <div class="preview-title">{selectedTemplate.title}</div>
            <div class="preview-content">
              {#each previewBlocks as block (block)}
                {#if block.type === 'text'}
                  <div class="preview-block">{@html block.html}</div>
                {:else if block.type === 'html'}
                  <div class="preview-block">{@html block.content}</div>
                {:else if block.type === 'divider'}
                  <hr class="preview-divider" />
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- 푸터 -->
      <div class="modal-footer">
        <button type="button" class="btn-cancel" onclick={onclose}>취소</button>
        <button
          type="button"
          class="btn-send"
          onclick={send}
          disabled={!selectedTemplate || sending}
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
    width: 860px;
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
    margin: 0 0 6px;
    padding: 0 14px;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
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

  /* 우측 미리보기 */
  .preview-pane {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .preview-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
  }
  .preview-title {
    padding: 14px 20px 0;
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
    border-bottom: 1px solid var(--cs-lilac);
    padding-bottom: 12px;
    flex-shrink: 0;
  }
  .preview-content {
    padding: 16px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .preview-block {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    line-height: 1.7;
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
