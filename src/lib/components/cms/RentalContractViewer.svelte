<script lang="ts">
  import { csToast } from '$lib/utils/toast'
  import { browser } from '$app/environment'
  import ContractEditorModal from '$lib/components/cms/ContractEditorModal.svelte'
  import ContractTemplatePreviewModal from '$lib/components/cms/ContractTemplatePreviewModal.svelte'

  interface TemplateSummary {
    id: string
    title: string
    content_blocks: unknown[]
    created_at: string
  }

  interface Props {
    contractId:       string | null
    contractPdfUrl:   string | null
    autoSignedAt:     string | null
    customerSignedAt: string | null
    signingToken:     string | null
    signingsentAt:    string | null
    reservationId:    number
    productName:      string
    productCode:      string | null
    productCategory:  string
    rentalStart:      string
    rentalEnd:        string
    orderAmount:      number | null
    pickupMethod:     string | null
    pickupTime:       string | null
    returnMethod:     string | null
    returnTime:       string | null
    onrefresh:        () => void
  }
  let {
    contractId,
    contractPdfUrl,
    autoSignedAt,
    customerSignedAt,
    signingToken,
    signingsentAt,
    reservationId,
    productName,
    productCode,
    productCategory,
    rentalStart,
    rentalEnd,
    orderAmount,
    pickupMethod = null,
    pickupTime   = null,
    returnMethod = null,
    returnTime   = null,
    onrefresh,
  }: Props = $props()

  const PICKUP_LABELS: Record<string, string> = {
    crazydelivery: '크레이지샷 배송',
    quick:         '당일퀵 배송',
    locker:        '무인 보관함',
    visit:         '본점 방문수령',
    epost:         '택배',
  }

  let editorOpen        = $state(false)
  let editorContractId  = $state<string | null>(null)
  let applyingTemplate  = $state(false)
  let templates         = $state<TemplateSummary[]>([])
  let loadingTemplates  = $state(false)
  let previewTemplateId = $state<string | null>(null)

  $effect(() => {
    if (!browser) return
    loadingTemplates = true
    fetch('/api/cms/contract-templates')
      .then((r) => r.json())
      .then((data: unknown) => { templates = data as TemplateSummary[] })
      .catch(() => {})
      .finally(() => { loadingTemplates = false })
  })

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }

  function formatDateTime(dt: string | null): string {
    if (!dt) return '-'
    return new Date(dt).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  function formatAmount(n: number | null): string {
    if (n == null) return '-'
    return n.toLocaleString('ko-KR') + '원'
  }

  async function openEditorForTemplate(tplId: string) {
    const tpl = templates.find(t => t.id === tplId)
    if (!tpl) return
    applyingTemplate = true
    try {
      let activeId = contractId
      if (!activeId) {
        const initRes = await fetch(`/api/cms/reservations/${reservationId}/init-contract`, { method: 'POST' })
        if (!initRes.ok) { csToast.error('계약서 생성 실패'); return }
        activeId = ((await initRes.json()) as { contractId: string }).contractId
      }
      const patchRes = await fetch(`/api/cms/contracts/${activeId}/content`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title:          tpl.title,
          content_blocks: tpl.content_blocks,
          specifications: [],
          template_id:    tpl.id,
        }),
      })
      if (!patchRes.ok) { csToast.error('양식 적용 실패'); return }
      editorContractId = activeId
      editorOpen = true
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      applyingTemplate = false
    }
  }

  const signingUrl = $derived(
    signingToken ? `/contract/${signingToken}` : null
  )
</script>

<div class="contract-viewer">
  <!-- 상태 배너 -->
  {#if customerSignedAt}
    <div class="banner banner-signed">
      고객 서명 완료 · {formatDateTime(customerSignedAt)}
    </div>
  {:else if signingsentAt}
    <div class="banner banner-sent">
      계약서 발송됨 · 서명 대기 중 ({formatDateTime(signingsentAt)})
    </div>
  {:else if contractId}
    <div class="banner banner-unsigned">
      계약서 미서명 — 고객에게 발송하세요
    </div>
  {:else}
    <div class="banner banner-none">
      계약서 미생성 — 양식을 선택해 발송하세요
    </div>
  {/if}

  <!-- 계약서 양식 목록 (항상 표시) -->
  <div class="tpl-section">
    <div class="tpl-section-head">
      <span class="tpl-section-title">계약서 양식</span>
    </div>
    {#if loadingTemplates}
      <p class="tpl-loading">양식 목록 불러오는 중...</p>
    {:else if templates.length === 0}
      <p class="tpl-empty">등록된 활성 양식이 없습니다. <a href="/cms/reservation/contracts" class="tpl-link">양식 작성하기 →</a></p>
    {:else}
      <div class="tpl-list">
        {#each templates as tpl (tpl.id)}
          <div class="tpl-card">
            <span class="tpl-card-title">{tpl.title}</span>
            <div class="tpl-card-actions">
              {#if !signingsentAt && !customerSignedAt}
                <button
                  class="btn-tpl-edit"
                  onclick={() => openEditorForTemplate(tpl.id)}
                  disabled={applyingTemplate}
                >편집</button>
              {/if}
              <button
                class="btn-tpl-preview"
                onclick={() => { previewTemplateId = tpl.id }}
              >
                미리보기 &amp; 발송
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- PDF 미리보기·다운로드: 서명 완료 후에만 표시 -->
  {#if contractPdfUrl && customerSignedAt}
    <div class="pdf-wrap">
      <iframe
        src={contractPdfUrl}
        title="계약서 미리보기"
        class="pdf-frame"
      ></iframe>
    </div>
  {/if}

  <!-- 액션 버튼 -->
  <div class="contract-actions">
    {#if contractPdfUrl && customerSignedAt}
      <a
        href={contractPdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="btn-secondary"
      >PDF 다운로드</a>
    {/if}

    {#if signingUrl && !customerSignedAt}
      <a
        href={signingUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="btn-secondary"
      >서명 링크 확인 ↗</a>
    {/if}
  </div>
</div>

{#if editorOpen && (editorContractId ?? contractId)}
  <ContractEditorModal
    contractId={(editorContractId ?? contractId)!}
    {reservationId}
    onclose={() => { editorOpen = false; editorContractId = null; onrefresh() }}
  />
{/if}

{#if previewTemplateId !== null}
  <ContractTemplatePreviewModal
    {contractId}
    {reservationId}
    initialTemplateId={previewTemplateId}
    onclose={() => { previewTemplateId = null }}
    onsent={() => { previewTemplateId = null; onrefresh() }}
  />
{/if}

<style>
  .contract-viewer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* 배너 */
  .banner {
    padding: 10px 14px;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .banner-signed   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
  .banner-sent     { background: rgba(14,165,233,0.12); color: var(--cs-info); }
  .banner-unsigned { background: rgba(245,158,11,0.12); color: var(--cs-warning); }
  .banner-none     { background: var(--cs-surface-gray); color: var(--cs-text-light); }

  /* PDF */
  .pdf-wrap {
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
    height: 360px;
  }
  .pdf-frame {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }
  .pdf-placeholder {
    padding: 32px 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    color: var(--cs-text-light);
  }
  .pdf-placeholder p { font: var(--text-pc-body-14); margin: 0; }

  /* 액션 버튼 */
  .contract-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

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
    cursor: pointer;
    transition: background 0.12s;
    text-decoration: none;
  }
  .btn-action:hover    { background: var(--cs-purple-hover); }
  .btn-action:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-secondary {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 14px;
    background: var(--cs-white);
    color: var(--cs-purple-dark);
    border: 1px solid var(--cs-purple-dark);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    text-decoration: none;
  }
  .btn-secondary:hover { background: rgba(59,47,138,0.06); }

  /* 계약서 양식 목록 */
  .tpl-section {
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }
  .tpl-section-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: var(--cs-surface-gray);
    border-bottom: 1px solid var(--cs-lilac);
  }
  .tpl-section-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .tpl-loading, .tpl-empty {
    padding: 16px 14px;
    margin: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  .tpl-link {
    color: var(--cs-purple);
    text-decoration: none;
  }
  .tpl-link:hover { text-decoration: underline; }
  .tpl-list {
    display: flex;
    flex-direction: column;
  }
  .tpl-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    gap: 12px;
  }
  .tpl-card:last-child { border-bottom: none; }
  .tpl-card-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tpl-card-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .btn-tpl-edit {
    height: 28px;
    padding: 0 10px;
    background: transparent;
    color: var(--cs-purple);
    border: 1px solid var(--cs-purple);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .btn-tpl-edit:hover    { background: var(--cs-purple-op10); }
  .btn-tpl-edit:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-tpl-preview {
    height: 28px;
    padding: 0 12px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .btn-tpl-preview:hover { background: var(--cs-purple-hover); }
</style>
