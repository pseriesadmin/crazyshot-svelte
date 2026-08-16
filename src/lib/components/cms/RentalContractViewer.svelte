<script lang="ts">
  import { browser } from '$app/environment'
  import { hasExistingContractContent } from '$lib/utils/contract-content-mode'
  import ContractEditorModal from '$lib/components/cms/ContractEditorModal.svelte'
  import ContractTemplatePreviewModal from '$lib/components/cms/ContractTemplatePreviewModal.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'

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

  let editorOpen            = $state(false)
  let editorContractId      = $state<string | null>(null)
  let previewTemplateId     = $state<string | null>(null)
  let hasIssuedContent      = $state(false)
  let issuedContractTitle   = $state<string | null>(null)
  let issuedCheckTick       = $state(0)

  // 발행 목록: contractId 변경 또는 issuedCheckTick 갱신 시 발행 여부 재확인
  $effect(() => {
    void issuedCheckTick
    if (!browser || !contractId) { hasIssuedContent = false; issuedContractTitle = null; return }
    const cid = contractId
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/cms/contracts/${cid}/content`)
        if (!r.ok) { if (alive) { hasIssuedContent = false; issuedContractTitle = null }; return }
        const data = await r.json() as { content_blocks?: unknown; canvas_document?: unknown; title?: string }
        if (!alive) return
        hasIssuedContent    = hasExistingContractContent(data.content_blocks, data.canvas_document)
        issuedContractTitle = data.title ?? null
      } catch {
        if (alive) hasIssuedContent = false
      }
    })()
    return () => { alive = false }
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
      <span class="tpl-section-title">계약서 양식 선택 편집</span>
      <button
        class="btn-issue"
        onclick={() => { previewTemplateId = '' }}
      >발행</button>
    </div>
  </div>

  <!-- 발행 목록: 편집된 content_blocks가 있을 때만 표시 -->
  {#if hasIssuedContent && contractId}
    <div class="tpl-section">
      <div class="tpl-section-head">
        <span class="tpl-section-title">발행 목록</span>
      </div>
      <div class="tpl-list">
        <div class="tpl-card">
          <span class="tpl-card-title">{issuedContractTitle || '발행된 계약서'}</span>
          <div class="tpl-card-actions">
            {#if !signingsentAt && !customerSignedAt}
              <button
                class="btn-tpl-edit"
                onclick={() => { editorOpen = true; editorContractId = contractId }}
              >
                편집
              </button>
            {/if}
            <button
              class="btn-tpl-preview"
              onclick={() => { previewTemplateId = '' }}
            >
              미리보기 &amp; 발송
            </button>
            {#if !signingsentAt && !customerSignedAt}
              <span class="tpl-card-del-gap"></span>
              <CmsDeleteButton
                action="?/clearIssuedContract"
                id={contractId!}
                warnMessage="한번 더 선택 시 이 계약서 내용이 초기화됩니다."
                successMessage="계약서 내용이 초기화되었습니다."
                onsuccess={() => { issuedCheckTick++ }}
              />
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

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
    onclose={() => { editorOpen = false; editorContractId = null; issuedCheckTick++; onrefresh() }}
  />
{/if}

{#if previewTemplateId !== null}
  <ContractTemplatePreviewModal
    {contractId}
    {reservationId}
    initialTemplateId={previewTemplateId}
    onclose={() => { previewTemplateId = null }}
    onsent={() => { previewTemplateId = null; onrefresh() }}
    onEdit={(!signingsentAt && !customerSignedAt)
      ? (editedContractId) => {
          previewTemplateId = null
          editorOpen        = true
          // 미리보기 모달이 template 모드였다면 방금 적용·저장한 contractId를 전달해준다 —
          // 그 값을 쓰지 않고 예전 contractId(비어있을 수 있음)로 열면 "정보 소실"처럼
          // 보이는 버그가 재현된다(2026-08-15 실사용 중 발견, ContractTemplatePreviewModal
          // handleEditClick() 참고). existing 모드였다면 어차피 동일한 contractId가 온다.
          editorContractId  = editedContractId ?? contractId
          issuedCheckTick++ // 방금 새로 발행됐을 수 있으므로 "발행 목록" 표시 상태 재확인
        }
      : undefined}
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
  /* 액션 버튼 */
  .contract-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

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
  .btn-issue {
    margin-left: auto;
    height: 24px;
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
  .btn-issue:hover    { background: var(--cs-purple-hover); }
  .btn-issue:disabled { opacity: 0.5; cursor: not-allowed; }
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
    padding: 0 12px;
    background: var(--cs-white);
    color: var(--cs-purple-dark);
    border: 1px solid var(--cs-purple-dark);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .btn-tpl-edit:hover { background: rgba(59,47,138,0.06); }
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
  .tpl-card-del-gap {
    width: 8px;
    flex-shrink: 0;
  }
</style>
