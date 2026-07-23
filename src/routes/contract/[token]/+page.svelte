<script lang="ts">
  import type { PageData } from './$types'
  import SignatureCanvas from '$lib/components/common/SignatureCanvas.svelte'
  import type { SignatureData } from '$lib/components/common/SignatureCanvas.svelte'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const signing = data.signing
  const contract = signing.contracts as unknown as {
    id: string
    document_url: string | null
    rental_reservations: {
      id: number
      start_date: string
      end_date: string
      products: { name: string; category: string } | null
    } | null
  } | null

  const reservation = contract?.rental_reservations
  const product     = reservation?.products

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
    if (!sigValid) { signError = '서명을 완성해 주세요 (3획 이상).';    return }
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
      <h1 class="summary-title">전자 대여 계약서</h1>
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
    </div>

    <!-- PDF 미리보기 -->
    {#if contract?.document_url}
      <div class="pdf-section">
        <iframe
          src={contract.document_url}
          title="계약서 내용"
          class="pdf-frame"
        ></iframe>
      </div>
    {:else}
      <div class="pdf-placeholder">
        <p>계약서 문서를 불러오는 중입니다.</p>
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
          <p class="sig-guide">아래 칸에 직접 서명해 주세요</p>
          <SignatureCanvas
            width={600}
            height={160}
            minStrokes={3}
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

  /* PDF */
  .pdf-section {
    background: #fff;
    border-radius: 20px;
    overflow: hidden;
    height: 420px;
  }
  .pdf-frame {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
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
  .sig-guide {
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-dark, #100B32);
    margin: 0;
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
