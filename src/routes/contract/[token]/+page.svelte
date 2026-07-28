<script lang="ts">
  import type { PageData } from './$types'
  import SignatureCanvas from '$lib/components/common/SignatureCanvas.svelte'
  import type { SignatureData } from '$lib/components/common/SignatureCanvas.svelte'
  import type { ContentBlock } from '$lib/types/content-editor'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const signing = data.signing
  const customer = data.customer
  const contract = signing.contracts as unknown as {
    id: string
    title: string | null
    content_blocks: ContentBlock[]
    document_url: string | null
    rental_reservations: {
      id: number
      start_date: string
      end_date: string
      reservation_code: string | null
      products: { name: string; category: string } | null
    } | null
  } | null

  const reservation = contract?.rental_reservations
  const product     = reservation?.products
  const contentBlocks = contract?.content_blocks ?? []

  let agreed    = $state(false)
  let sigValid  = $state(false)
  let sigData   = $state<SignatureData | null>(null)
  let signing_  = $state(false)
  let signError = $state('')
  let done      = $state(false)

  function handleSigChange(valid: boolean, data: SignatureData | null) {
    sigValid = valid
    sigData  = data
  }

  function formatDate(dt: string): string {
    return dt ? dt.slice(0, 10) : '-'
  }

  async function submitSign() {
    if (!agreed)   { signError = '약관에 동의해야 서명할 수 있습니다.'; return }
    if (!sigValid) { signError = '서명을 완성해 주세요.';    return }
    signError = ''
    signing_  = true
    try {
      const res = await fetch(`/api/contracts/${signing.token}/sign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          signature_data: sigData?.pngBase64 ?? null,
          stroke_count:   sigData?.strokeCount ?? 0,
        }),
      })
      if (res.ok) {
        done = true
        setTimeout(() => { window.location.href = '/contract/complete' }, 1200)
      } else {
        const body = await res.json().catch(() => ({}))
        signError = body.error ?? '서명 처리 중 오류가 발생했습니다.'
      }
    } catch {
      signError = '네트워크 오류가 발생했습니다. 다시 시도해 주세요.'
    } finally {
      signing_ = false
    }
  }
</script>

<svelte:head>
  <title>전자계약서 서명 — 크레이지샷</title>
</svelte:head>

<div class="contract-page">
  <!-- 헤더 -->
  <header class="contract-header">
    <span class="logo-text">CRAZY<span class="logo-orange">SHOT</span></span>
  </header>

  <main class="contract-main">
    <!-- 계약 요약 -->
    <div class="summary-card">
      <h1 class="summary-title">크레이지샷 상품대여 전자계약서</h1>
      {#if reservation?.reservation_code}
        <div class="summary-item">
          <span class="summary-label">예약코드</span>
          <span class="summary-value">{reservation.reservation_code}</span>
        </div>
      {/if}
      {#if product}
        <div class="summary-item">
          <span class="summary-label">대여 상품</span>
          <span class="summary-value">{product.name}</span>
        </div>
      {/if}
      {#if reservation}
        <div class="summary-item">
          <span class="summary-label">대여 기간</span>
          <span class="summary-value">
            {formatDate(reservation.start_date)} ~ {formatDate(reservation.end_date)}
          </span>
        </div>
      {/if}
      {#if customer?.full_name}
        <div class="summary-item">
          <span class="summary-label">예약자</span>
          <span class="summary-value">{customer.full_name}</span>
        </div>
      {/if}
      {#if customer?.phone}
        <div class="summary-item">
          <span class="summary-label">전화번호</span>
          <span class="summary-value">{customer.phone}</span>
        </div>
      {/if}
      {#if customer?.email}
        <div class="summary-item">
          <span class="summary-label">이메일</span>
          <span class="summary-value">{customer.email}</span>
        </div>
      {/if}
    </div>

    <!-- 계약서 본문 -->
    {#if contentBlocks.length > 0}
      <div class="doc-section">
        {#if contract?.title}
          <h2 class="doc-title">{contract.title}</h2>
        {/if}
        <div class="doc-content">
          {#each contentBlocks as block (block)}
            {#if block.type === 'text'}
              <div class="doc-block">{@html block.html}</div>
            {:else if block.type === 'html'}
              <div class="doc-block">{@html block.content}</div>
            {:else if block.type === 'divider'}
              <hr class="doc-divider" />
            {/if}
          {/each}
        </div>
      </div>
    {:else}
      <div class="pdf-placeholder">
        <p>계약서 내용을 준비 중입니다. 잠시 후 다시 시도해 주세요.</p>
      </div>
    {/if}

    <!-- 서명 폼 -->
    {#if !done}
      <div class="sign-section">
        <!-- 동의 체크박스 -->
        <label class="agree-label">
          <input
            type="checkbox"
            class="agree-check"
            bind:checked={agreed}
          />
          <span>
            위 계약서 내용을 모두 확인하였으며, 본 전자계약에 동의합니다.
          </span>
        </label>

        <!-- 전자 서명 캔버스 -->
        <div class="sig-section">
          <SignatureCanvas
            width={600}
            height={160}
            onchange={handleSigChange}
          />
        </div>

        {#if signError}
          <p class="sign-error" role="alert">{signError}</p>
        {/if}

        <button
          class="btn-sign"
          onclick={submitSign}
          disabled={signing_ || !agreed || !sigValid}
        >
          {signing_ ? '서명 처리 중...' : '서명하기'}
        </button>
      </div>
    {:else}
      <div class="sign-done">
        <span class="done-icon">✅</span>
        <p>서명이 완료되었습니다. 잠시 후 이동합니다...</p>
      </div>
    {/if}
  </main>
</div>

<style>
  :global(body) {
    background: var(--cs-lilac, #ECEBF4);
    margin: 0;
  }

  .contract-page {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  /* 헤더 */
  .contract-header {
    background: var(--cs-dark, #100B32);
    padding: 16px 20px;
    display: flex;
    align-items: center;
  }
  .logo-text {
    font-size: 20px;
    font-weight: 900;
    color: #fff;
    letter-spacing: 1px;
  }
  .logo-orange { color: var(--cs-orange, #FF4500); }

  /* 메인 */
  .contract-main {
    flex: 1;
    max-width: 680px;
    margin: 0 auto;
    width: 100%;
    padding: 24px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-sizing: border-box;
  }

  /* 요약 카드 */
  .summary-card {
    background: #fff;
    border-radius: 20px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .summary-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-dark, #100B32);
    margin: 0 0 4px;
  }
  .summary-item {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .summary-label {
    flex: 0 0 80px;
    font-size: 13px;
    color: #666;
    font-weight: 700;
  }
  .summary-value {
    font-size: 14px;
    color: var(--cs-dark, #100B32);
    font-weight: 600;
  }

  /* 계약서 본문 */
  .doc-section {
    background: #fff;
    border-radius: 20px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .doc-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-dark, #100B32);
    margin: 0 0 4px;
  }
  .doc-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .doc-block {
    font-size: 14px;
    line-height: 1.7;
    color: var(--cs-dark, #100B32);
  }
  .doc-block :global(table.cs-contract-table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .doc-block :global(table.cs-contract-table th),
  .doc-block :global(table.cs-contract-table td) {
    border: 1px solid #DDDDDD;
    padding: 7px 10px;
    text-align: left;
  }
  .doc-block :global(table.cs-contract-table th) {
    background: #f6f6f6;
    color: #666;
    font-weight: 700;
    white-space: nowrap;
  }
  .doc-divider {
    border: none;
    border-top: 1px solid var(--cs-lilac, #ECEBF4);
    margin: 4px 0;
  }
  .pdf-placeholder {
    background: #fff;
    border-radius: 20px;
    padding: 40px 20px;
    text-align: center;
    color: #888;
    font-size: 14px;
  }

  /* 서명 섹션 */
  .sign-section {
    background: #fff;
    border-radius: 20px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .agree-label {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    color: var(--cs-dark, #100B32);
    line-height: 1.5;
  }
  .agree-check {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    margin-top: 2px;
    accent-color: var(--cs-red-badge, #FF3535);
    cursor: pointer;
  }

  /* 서명 캔버스 영역 */
  .sig-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sign-error {
    font-size: 13px;
    color: var(--cs-red-badge, #FF3535);
    margin: 0;
  }
  .btn-sign {
    width: 100%;
    height: 54px;
    background: var(--cs-red-badge, #FF3535);
    color: #fff;
    border: none;
    border-radius: 30px;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
    min-height: 54px;
  }
  .btn-sign:hover:not(:disabled) { background: var(--cs-red, #CF0000); }
  .btn-sign:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  /* 서명 완료 */
  .sign-done {
    background: #fff;
    border-radius: 20px;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
  }
  .done-icon { font-size: 40px; }
  .sign-done p { font-size: 15px; color: var(--cs-dark, #100B32); font-weight: 600; margin: 0; }
</style>
