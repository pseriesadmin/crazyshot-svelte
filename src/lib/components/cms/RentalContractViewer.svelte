<script lang="ts">
  import { csToast } from '$lib/utils/toast'

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

  let sending = $state(false)

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

  async function sendContract(resend = false) {
    if (!contractId) { csToast.error('계약서가 없습니다.'); return }
    sending = true
    try {
      const res = await fetch(`/api/cms/contracts/${contractId}/send-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        csToast.success(resend ? '계약서가 재발송되었습니다.' : '계약서가 채팅으로 발송되었습니다.')
        onrefresh()
      } else {
        const body = await res.json().catch(() => ({}))
        csToast.error(body.error ?? '발송에 실패했습니다.')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      sending = false
    }
  }

  const signingUrl = $derived(
    signingToken ? `/contract/${signingToken}` : null
  )
</script>

<div class="contract-viewer">
  <!-- 대여 품목 요약 카드 -->
  <div class="product-card">
    <div class="product-card-header">대여 품목</div>
    <div class="product-card-body">
      <div class="product-row">
        <span class="product-label">상품명</span>
        <span class="product-value fw-bold">{productName}</span>
      </div>
      {#if productCode}
        <div class="product-row">
          <span class="product-label">상품코드</span>
          <span class="product-value mono">{productCode}</span>
        </div>
      {/if}
      <div class="product-row">
        <span class="product-label">카테고리</span>
        <span class="product-value">{productCategory}</span>
      </div>
      <div class="product-row">
        <span class="product-label">대여기간</span>
        <span class="product-value">{formatDate(rentalStart)} ~ {formatDate(rentalEnd)}</span>
      </div>
      {#if pickupMethod || returnMethod}
        <div class="product-row">
          <span class="product-label">대여방법</span>
          <span class="product-value product-value-method">
            <span class="method-line">수령 · {pickupMethod ? (PICKUP_LABELS[pickupMethod] ?? pickupMethod) : '-'}{pickupTime ? ' ' + pickupTime : ''}</span>
            <span class="method-line">반납 · {returnMethod ? (PICKUP_LABELS[returnMethod] ?? returnMethod) : '-'}{returnTime ? ' ' + returnTime : ''}</span>
          </span>
        </div>
      {/if}
      {#if orderAmount != null}
        <div class="product-row">
          <span class="product-label">이용요금</span>
          <span class="product-value fw-bold">{formatAmount(orderAmount)}</span>
        </div>
      {/if}
    </div>
  </div>

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
      계약서 없음 — 결제 완료 후 생성됩니다
    </div>
  {/if}

  <!-- PDF 미리보기 -->
  {#if contractPdfUrl}
    <div class="pdf-wrap">
      <iframe
        src={contractPdfUrl}
        title="계약서 미리보기"
        class="pdf-frame"
      ></iframe>
    </div>
  {:else}
    <div class="pdf-placeholder">
      <p>결제 완료 후 계약서가 자동 생성됩니다.</p>
    </div>
  {/if}

  <!-- 액션 버튼 -->
  <div class="contract-actions">
    <!-- 발송 (서명 전, 미발송) -->
    {#if contractId && !customerSignedAt && !signingsentAt}
      <button
        class="btn-action"
        onclick={() => sendContract(false)}
        disabled={sending}
        title="채팅으로 서명 링크 발송"
      >
        {sending ? '발송 중...' : '계약서 발송'}
      </button>
    {/if}

    <!-- 재발송 (이미 발송했으나 서명 미완료) -->
    {#if contractId && !customerSignedAt && signingsentAt}
      <button
        class="btn-action"
        onclick={() => {
          if (confirm('이미 발송된 계약서입니다.\n다시 발송하시겠습니까?')) sendContract(true)
        }}
        disabled={sending}
        title="채팅으로 서명 링크 재발송"
      >
        {sending ? '발송 중...' : '계약서 재발송'}
      </button>
    {/if}

    {#if contractPdfUrl}
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

<style>
  .contract-viewer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* 대여 품목 카드 */
  .product-card {
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }
  .product-card-header {
    padding: 8px 14px;
    background: var(--cs-surface-gray);
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    border-bottom: 1px solid var(--cs-lilac);
  }
  .product-card-body {
    display: flex;
    flex-direction: column;
  }
  .product-row {
    display: flex;
    align-items: center;
    padding: 9px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    gap: 12px;
  }
  .product-row:last-child { border-bottom: none; }
  .product-label {
    flex: 0 0 72px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-weight: 700;
  }
  .product-value {
    flex: 1;
    font: var(--text-pc-script-12);
    color: var(--cs-text);
  }
  .fw-bold { font-weight: 700; }
  .mono    { font-family: monospace; }
  .product-value-method { display: flex; flex-direction: column; gap: 2px; }
  .method-line { font: var(--text-pc-script-12); color: var(--cs-text); }

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
</style>
