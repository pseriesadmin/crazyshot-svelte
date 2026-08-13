<script lang="ts">
  import type { PageData } from './$types'
  import SignatureCanvas from '$lib/components/common/SignatureCanvas.svelte'
  import type { SignatureData } from '$lib/components/common/SignatureCanvas.svelte'
  import type { ContentBlock } from '$lib/types/content-editor'
  import { isCanvasDocument, isTiptapDocBlock } from '$lib/types/contract-document'
  import type { CanvasDocument, TiptapDocBlock } from '$lib/types/contract-document'
  import { renderTiptapDocToHtml } from '$lib/utils/tiptapRender'
  import { browser } from '$app/environment'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // data prop은 SvelteKit load() 재실행 시 갱신되므로 $derived로 반응형 추적
  const issuerSignatures = $derived(data.issuerSignatures ?? [])
  const signing = $derived(data.signing)
  const customer = $derived(data.customer)
  const shippingAddress = $derived(data.shippingAddress as string | null)
  const orderData = $derived(data.orderData as {
    total_amount: number | null
    discount_amount: number | null
    tax_amount: number | null
    final_amount: number | null
  } | null)

  // signing이 $derived이므로 이하 파생 const도 $derived로 연쇄 처리 (cascading $derived)
  const contract = $derived(signing.contracts as unknown as {
    id: string
    title: string | null
    content_blocks: (ContentBlock | TiptapDocBlock)[]
    specifications: { key: string; value: string }[]
    document_url: string | null
    authoring_mode: string | null
    canvas_document: unknown
    rental_reservations: {
      id: number
      start_date: string
      end_date: string
      reservation_code: string | null
      pickup_method: string | null
      return_method: string | null
      pickup_time: string | null
      return_time: string | null
      products: { name: string; category: string; product_code: string | null } | null
    } | null
  } | null)

  const reservation    = $derived(contract?.rental_reservations)
  const product        = $derived(reservation?.products)
  const contentBlocks  = $derived(contract?.content_blocks ?? [])
  const specifications = $derived((contract?.specifications ?? []).filter((s) => s.key?.trim()))

  // canvas 모드 분기
  const isCanvasMode = $derived(contract?.authoring_mode === 'canvas')
  const canvasDoc = $derived<CanvasDocument | null>(
    isCanvasDocument(contract?.canvas_document)
      ? (contract?.canvas_document as CanvasDocument)
      : null
  )

  // canvas 모드 변수 치환 — ContractSubstitutionData 16개 전체 매핑
  const PICKUP_LABELS: Record<string, string> = {
    crazydelivery: '크레이지샷 배송',
    quick:         '당일퀵 배송',
    locker:        '무인 보관함',
    visit:         '본점 방문수령',
    epost:         '택배',
  }

  function formatAmount(n: number | null | undefined): string {
    if (n == null) return '-'
    return n.toLocaleString('ko-KR') + '원'
  }

  // $derived — customer/reservation/product/orderData가 모두 $derived이므로 연쇄 추적
  const substitutionMap = $derived<Record<string, string>>({
    '고객이름':     customer?.full_name ?? '',
    '연락처':       customer?.phone    ?? '',
    '이메일':       customer?.email    ?? '',
    '주소':         shippingAddress    ?? '',
    '예약코드':     reservation?.reservation_code ?? '',
    '상품코드':     product?.product_code ?? '',
    '상품명':       product?.name ?? '',
    '수량':         '1',
    '수령형태':     reservation?.pickup_method
                    ? (PICKUP_LABELS[reservation.pickup_method] ?? reservation.pickup_method)
                    : '',
    '수령일시':     reservation?.pickup_time
                    ?? (reservation?.start_date ? formatDate(reservation.start_date) : ''),
    '반납형태':     reservation?.return_method
                    ? (PICKUP_LABELS[reservation.return_method] ?? reservation.return_method)
                    : '',
    '반납일시':     reservation?.return_time
                    ?? (reservation?.end_date ? formatDate(reservation.end_date) : ''),
    '기본대여요금': formatAmount(orderData?.total_amount),
    '할인금액':     formatAmount(orderData?.discount_amount),
    '부가세':       formatAmount(orderData?.tax_amount),
    '최종합계':     formatAmount(orderData?.final_amount),
  })

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

    <!-- 계약서 본문 — canvas 모드 / flow 모드 분기 -->
    {#if isCanvasMode && canvasDoc}
      <!-- canvas 모드: 배경 이미지 + 좌표 기반 필드 오버레이 -->
      <div class="doc-section canvas-doc-section">
        {#if contract?.title}
          <h2 class="doc-title">{contract.title}</h2>
        {/if}
        <p class="canvas-hint">계약서를 확인하고 서명란에 서명해 주세요.</p>

        {#each canvasDoc.pages as page (page.id)}
          <!-- 페이지 컨테이너: aspect-ratio 박스 + position:relative 기반 -->
          <div
            class="canvas-page"
            style="padding-bottom: {(page.height / page.width) * 100}%"
          >
            <!-- 배경 이미지 -->
            <img
              src={page.imageUrl}
              alt="계약서 {canvasDoc.pages.indexOf(page) + 1}페이지"
              class="canvas-bg"
              loading="lazy"
            />

            <!-- 필드 오버레이 -->
            {#each canvasDoc.fields.filter((f) => f.pageId === page.id) as field (field.id)}
              <div
                class="canvas-field canvas-field-{field.type}"
                style="
                  left:   {(field.x / page.width) * 100}%;
                  top:    {(field.y / page.height) * 100}%;
                  width:  {(field.width / page.width) * 100}%;
                  height: {(field.height / page.height) * 100}%;
                "
              >
                {#if field.type === 'signature'}
                  <!-- 서명 필드: SignatureCanvas 인라인 배치 -->
                  <div class="canvas-sig-wrap">
                    <SignatureCanvas
                      width={field.width}
                      height={field.height}
                      onchange={handleSigChange}
                    />
                  </div>
                {:else if field.type === 'text'}
                  <!-- 텍스트 필드: 변수 치환 값 표시 -->
                  <span class="canvas-text-value">
                    {field.boundVariable ? (substitutionMap[field.boundVariable] ?? '') : ''}
                  </span>
                {:else if field.type === 'label'}
                  <!-- 라벨 필드: 고정 텍스트 -->
                  <span class="canvas-label-value">{field.label}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {:else if contentBlocks.length > 0}
      <!-- flow 모드: TipTap contentBlocks 렌더링 -->
      <div class="doc-section">
        {#if contract?.title}
          <h2 class="doc-title">{contract.title}</h2>
        {/if}
        <div class="doc-content">
          {#each contentBlocks as block (block)}
            {#if isTiptapDocBlock(block)}
              <!-- tiptap-doc: generateHTML는 DOM(document) 의존 → browser 가드 필수 -->
              <!-- SSR(Vercel Node.js)에서 호출 시 "window is not defined" 크래시 발생 -->
              <div class="doc-block doc-block-tiptap">
                {#if browser}
                  {@html renderTiptapDocToHtml(block.doc)}
                {:else}
                  <div class="doc-loading">계약서 내용을 불러오는 중...</div>
                {/if}
              </div>
            {:else if block.type === 'text'}
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

    <!-- 특약 조항 -->
    {#if specifications.length > 0}
      <div class="doc-section">
        <h2 class="doc-title">특약 조항</h2>
        <div class="spec-content">
          {#each specifications as spec (spec.key)}
            <div class="spec-row">
              <span class="spec-key">{spec.key}</span>
              <span class="spec-value">{spec.value}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- P8B-5: 발행자(갑) 서명·직인 렌더링 (flow 모드: 문서 최하단) -->
    {#if issuerSignatures.length > 0}
      <div class="doc-section issuer-sig-section">
        <h2 class="doc-title">발행자 서명</h2>
        <div class="issuer-sig-grid">
          {#each issuerSignatures as isig (isig.id)}
            <div class="issuer-sig-item">
              <span class="issuer-sig-label">
                {isig.signature_type === 'company_seal' ? '법인직인' : '발행자 서명'}
              </span>
              {#if isig.signature_image_url}
                <img
                  src={isig.signature_image_url}
                  alt={isig.signature_type === 'company_seal' ? '법인직인' : '발행자 서명'}
                  class="issuer-sig-img"
                />
              {:else}
                <div class="issuer-sig-placeholder">서명 이미지 없음</div>
              {/if}
            </div>
          {/each}
        </div>
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

        <!-- 전자 서명 캔버스 (flow 모드 전용 — canvas 모드는 위 페이지 내 인라인 서명) -->
        {#if !isCanvasMode}
          <div class="sig-section">
            <SignatureCanvas
              width={600}
              height={160}
              onchange={handleSigChange}
            />
          </div>
        {:else}
          <p class="canvas-sign-hint">위 계약서 서명란에 직접 서명해 주세요.</p>
        {/if}

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
  /* SSR 중 tiptap-doc 로딩 플레이스홀더 */
  .doc-loading {
    font-size: 13px;
    color: #888;
    padding: 8px 0;
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

  /* 특약 조항 */
  .spec-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .spec-row {
    display: flex;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    font-size: 14px;
    line-height: 1.6;
  }
  .spec-row:last-child { border-bottom: none; }
  .spec-key {
    flex: 0 0 120px;
    font-weight: 700;
    color: var(--cs-dark, #100B32);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .spec-value {
    flex: 1;
    color: var(--cs-dark, #100B32);
    white-space: pre-wrap;
    word-break: break-word;
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

  /* P8B-5: 발행자 서명 렌더링 */
  .issuer-sig-section { margin-top: 0; }
  .issuer-sig-grid {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .issuer-sig-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px;
    background: #f9f9f9;
    border-radius: 12px;
    min-width: 120px;
  }
  .issuer-sig-label {
    font-size: 12px;
    font-weight: 600;
    color: #666;
    text-align: center;
  }
  .issuer-sig-img {
    max-width: 120px;
    max-height: 80px;
    object-fit: contain;
  }
  .issuer-sig-placeholder {
    width: 120px;
    height: 60px;
    background: #eee;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: #999;
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

  /* ── canvas 모드 ──────────────────────────────────── */
  .canvas-doc-section { padding: 16px; }

  .canvas-hint, .canvas-sign-hint {
    font-size: 13px;
    color: #666;
    margin: 0 0 8px;
  }
  .canvas-sign-hint { margin: 0; }

  /* 페이지 aspect-ratio 박스 */
  .canvas-page {
    position: relative;
    width: 100%;
    overflow: hidden;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    background: #fff;
    margin-bottom: 12px;
  }

  /* 배경 이미지: 절대 배치로 박스 전체 채움 */
  .canvas-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  /* 필드 공통 — 절대 배치, 퍼센트 좌표 */
  .canvas-field {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    overflow: hidden;
  }

  /* 서명 필드 */
  .canvas-field-signature {
    border: 2px dashed var(--cs-purple, #3B2F8A);
    border-radius: 4px;
    background: rgba(59, 47, 138, 0.04);
  }
  .canvas-sig-wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: stretch;
  }
  /* SignatureCanvas가 필드 크기에 맞게 늘어나도록 */
  .canvas-sig-wrap :global(canvas) {
    width: 100% !important;
    height: 100% !important;
    object-fit: contain;
  }

  /* 텍스트 필드 (DB 변수 바인딩) */
  .canvas-field-text {
    border-bottom: 1px solid #aaa;
    padding: 0 4px;
  }
  .canvas-text-value {
    font-size: clamp(10px, 1.4vw, 14px);
    color: var(--cs-dark, #100B32);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 라벨 필드 (고정 텍스트) */
  .canvas-field-label { padding: 0 2px; }
  .canvas-label-value {
    font-size: clamp(9px, 1.2vw, 12px);
    color: #444;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
