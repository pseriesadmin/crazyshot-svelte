<script lang="ts">
  // 고객용 서명완료 전자계약서 열람 화면 (읽기 전용, /account/rental 카드 "전자계약 확인"
  // 버튼이 새 창으로 여는 대상). /contract/[token]/+page.svelte(서명화면)와 동일한 렌더링
  // 규칙(DOM 중첩·CSS 패딩)을 그대로 따른다 — canvas 모드 필드 좌표가 그 페이지의
  // .contract-main > .doc-section > .doc-block-tiptap 패딩 체인을 기준으로 저장돼 있어,
  // 같은 중첩 구조를 유지해야 서명 화면과 동일한 위치에 그려진다(ui-mobile.md 좌표계 원점
  // 관련 결함 사례 참고 — 구조가 달라지면 겹치기 이미지 위치가 틀어짐).
  import type { PageData } from './$types'
  import type { ContentBlock } from '$lib/types/content-editor'
  import { isCanvasDocument, isSpreadsheetDocument, isTiptapDocBlock } from '$lib/types/contract-document'
  import type { CanvasDocument, SpreadsheetDocument, TiptapDocBlock } from '$lib/types/contract-document'
  import { renderTiptapDocToHtml } from '$lib/utils/tiptapRender'
  import { renderSpreadsheetToHtml } from '$lib/utils/spreadsheetRender'
  import { browser } from '$app/environment'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const reservation = $derived(data.reservation as {
    id: number | string
    reservation_code: string | null
    start_date: string
    end_date: string
    pickup_method: string | null
    return_method: string | null
    pickup_time: string | null
    return_time: string | null
    products: { name: string; category: string; product_code: string | null } | null
  })
  const product = $derived(reservation?.products)
  const customer = $derived(data.customer as { full_name: string | null; phone: string | null; email: string | null } | null)
  const issuerSignatures = $derived(data.issuerSignatures ?? [])
  const shippingAddress = $derived(data.shippingAddress as string | null)
  const orderData = $derived(data.orderData as {
    total_amount: number | null
    discount_amount: number | null
    tax_amount: number | null
    final_amount: number | null
  } | null)
  const mySignature = $derived(data.mySignature as { signature_data: string | null; signed_at: string; ip_address: string | null } | null)

  const contract = $derived(data.contract as {
    id: string
    title: string | null
    content_blocks: (ContentBlock | TiptapDocBlock)[]
    specifications: { key: string; value: string }[]
    authoring_mode: string | null
    canvas_document: unknown
    spreadsheet_document: unknown
  } | null)

  const contentBlocks  = $derived(contract?.content_blocks ?? [])
  const specifications = $derived((contract?.specifications ?? []).filter((s) => s.key?.trim()))

  const isCanvasMode = $derived(contract?.authoring_mode === 'canvas')
  const canvasDoc = $derived<CanvasDocument | null>(
    isCanvasDocument(contract?.canvas_document) ? (contract?.canvas_document as CanvasDocument) : null
  )

  const isSpreadsheetMode = $derived(contract?.authoring_mode === 'spreadsheet')
  const spreadsheetDoc = $derived<SpreadsheetDocument | null>(
    isSpreadsheetDocument(contract?.spreadsheet_document) ? (contract?.spreadsheet_document as SpreadsheetDocument) : null
  )

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

  function formatDate(dt: string | null | undefined): string {
    return dt ? dt.slice(0, 10) : '-'
  }

  function formatDateTime(dt: string | null | undefined): string {
    if (!dt) return '-'
    return new Date(dt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
  }

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

  function handlePrint(): void {
    if (browser) window.print()
  }
</script>

<svelte:head>
  <title>전자계약서 확인 — 크레이지샷</title>
</svelte:head>

<div class="contract-page">
  <header class="contract-header">
    <span class="logo-text">CRAZY<span class="logo-orange">SHOT</span></span>
    {#if contract}
      <button type="button" class="print-btn" onclick={handlePrint}>인쇄하기</button>
    {/if}
  </header>

  <main class="contract-main">
    {#if !contract}
      <div class="pdf-placeholder">
        <p>서명된 계약서를 찾을 수 없습니다. 계약서가 아직 발송되지 않았거나 서명이 완료되지 않았을 수 있어요.</p>
      </div>
    {:else}
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
      </div>

      <!-- 계약서 본문 — canvas / spreadsheet / flow 모드 분기 (서명 필드는 읽기 전용 이미지) -->
      {#if isCanvasMode && canvasDoc}
        <div class="doc-section canvas-doc-section">
          {#if contract?.title}
            <h2 class="doc-title">{contract.title}</h2>
          {/if}

          {#each canvasDoc.pages as page (page.id)}
            <div class="canvas-page" style="padding-bottom: {(page.height / page.width) * 100}%">
              <img
                src={page.imageUrl}
                alt="계약서 {canvasDoc.pages.indexOf(page) + 1}페이지"
                class="canvas-bg"
                loading="lazy"
              />

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
                    <!-- 서명 필드: 인터랙티브 캔버스 대신 서명 당시 캡처된 이미지 표시 -->
                    {#if mySignature?.signature_data}
                      <img src={mySignature.signature_data} alt="고객 서명" class="canvas-my-sig-img" draggable="false" />
                    {/if}
                  {:else if field.type === 'text'}
                    <span class="canvas-text-value">
                      {field.boundVariable ? (substitutionMap[field.boundVariable] ?? '') : ''}
                    </span>
                  {:else if field.type === 'label'}
                    <span class="canvas-label-value">{field.label}</span>
                  {:else if field.type === 'issuer-image'}
                    {#if field.imageUrl}
                      <img src={field.imageUrl} alt={field.label || '발행자 서명·직인 이미지'} class="canvas-issuer-img" draggable="false" />
                    {/if}
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {:else if isSpreadsheetMode && spreadsheetDoc}
        <div class="doc-section">
          {#if contract?.title}
            <h2 class="doc-title">{contract.title}</h2>
          {/if}
          <div class="spreadsheet-doc-content">
            {@html renderSpreadsheetToHtml(spreadsheetDoc)}
          </div>
        </div>
      {:else if contentBlocks.length > 0}
        <div class="doc-section">
          {#if contract?.title}
            <h2 class="doc-title">{contract.title}</h2>
          {/if}
          <div class="doc-content">
            {#each contentBlocks as block (block)}
              {#if isTiptapDocBlock(block)}
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
          <p>계약서 내용을 불러올 수 없습니다.</p>
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

      <!-- 발행자(갑) 서명·직인 -->
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
                  <img src={isig.signature_image_url} alt={isig.signature_type === 'company_seal' ? '법인직인' : '발행자 서명'} class="issuer-sig-img" />
                {:else}
                  <div class="issuer-sig-placeholder">서명 이미지 없음</div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- 고객(을) 서명 완료 표시 — flow/spreadsheet 모드 전용(canvas 모드는 위 페이지 내 인라인) -->
      {#if !isCanvasMode && mySignature}
        <div class="doc-section signed-section">
          <h2 class="doc-title">서명 완료</h2>
          <div class="signed-badge">✅ {formatDateTime(mySignature.signed_at)} 서명 완료</div>
          {#if mySignature.signature_data}
            <img src={mySignature.signature_data} alt="고객 서명" class="my-sig-img" />
          {/if}
        </div>
      {/if}
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

  .contract-header {
    background: var(--cs-dark, #100B32);
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .logo-text {
    font-size: 20px;
    font-weight: 900;
    color: #fff;
    letter-spacing: 1px;
  }
  .logo-orange { color: var(--cs-orange, #FF4500); }

  .print-btn {
    height: 36px;
    padding: 0 16px;
    border-radius: var(--radius-full, 9999px);
    background: transparent;
    border: 1.5px solid rgba(255, 255, 255, 0.4);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
  .print-btn:hover { background: rgba(255, 255, 255, 0.1); }

  .contract-main {
    flex: 1;
    max-width: 210mm;
    margin: 0 auto;
    width: 100%;
    padding: 24px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-sizing: border-box;
  }

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
  .summary-item { display: flex; align-items: center; gap: 12px; }
  .summary-label { flex: 0 0 80px; font-size: 13px; color: #666; font-weight: 700; }
  .summary-value { font-size: 14px; color: var(--cs-dark, #100B32); font-weight: 600; }

  .doc-section {
    background: #fff;
    border-radius: 20px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
  }
  .doc-title { font-size: 16px; font-weight: 700; color: var(--cs-dark, #100B32); margin: 0 0 4px; }
  .doc-content { display: flex; flex-direction: column; gap: 12px; }
  .doc-block { font-size: 14px; line-height: 1.7; color: var(--cs-dark, #100B32); }

  /* 좌표계 원점 — /contract/[token]/+page.svelte와 동일한 패딩(20mm - 44px)을 유지해야
     겹치기(overlay) 서명·직인 이미지 위치가 서명 당시 화면과 동일하게 재현된다. */
  .doc-block-tiptap { position: relative; padding: calc(20mm - 44px); }
  .doc-block-tiptap :global(.tt-table-scroll) { overflow-x: auto; max-width: 100%; }
  .doc-block-tiptap :global(table) { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
  .doc-block-tiptap :global(table th),
  .doc-block-tiptap :global(table td) { border: 1px solid #ddd; padding: 4px 6px; overflow-wrap: anywhere; }
  .doc-block-tiptap :global(table th) { background: #f6f6f6; font-weight: 700; }
  .doc-block :global(table.cs-contract-table) { width: 100%; border-collapse: collapse; font-size: 12px; }
  .doc-block :global(table.cs-contract-table th),
  .doc-block :global(table.cs-contract-table td) { border: 1px solid #DDDDDD; padding: 7px 10px; text-align: left; }
  .doc-block :global(table.cs-contract-table th) { background: #f6f6f6; color: #666; font-weight: 700; white-space: nowrap; }
  .doc-loading { font-size: 13px; color: #888; padding: 8px 0; }
  .doc-divider { border: none; border-top: 1px solid var(--cs-lilac, #ECEBF4); margin: 4px 0; }
  .pdf-placeholder { background: #fff; border-radius: 20px; padding: 40px 20px; text-align: center; color: #888; font-size: 14px; }

  .spec-content { display: flex; flex-direction: column; gap: 8px; }
  .spec-row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--cs-lilac, #ECEBF4); font-size: 14px; line-height: 1.6; }
  .spec-row:last-child { border-bottom: none; }
  .spec-key { flex: 0 0 120px; font-weight: 700; color: var(--cs-dark, #100B32); white-space: pre-wrap; word-break: break-word; }
  .spec-value { flex: 1; color: var(--cs-dark, #100B32); white-space: pre-wrap; word-break: break-word; }

  /* 발행자 서명 */
  .issuer-sig-section { margin-top: 0; }
  .issuer-sig-grid { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 8px; }
  .issuer-sig-item { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px; background: #f9f9f9; border-radius: 12px; min-width: 120px; }
  .issuer-sig-label { font-size: 12px; font-weight: 600; color: #666; text-align: center; }
  .issuer-sig-img { max-width: 120px; max-height: 80px; object-fit: contain; }
  .issuer-sig-placeholder { width: 120px; height: 60px; background: #eee; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #999; }

  /* 고객 서명 완료 (flow/spreadsheet 모드) */
  .signed-section { align-items: flex-start; }
  .signed-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: var(--radius-full, 9999px);
    background: var(--cs-bg-success, #f0fff4);
    color: var(--cs-text-success, #1a7f37);
    font-size: 13px;
    font-weight: 700;
  }
  .my-sig-img { max-width: 240px; max-height: 100px; object-fit: contain; border: 1px solid #eee; border-radius: 8px; padding: 8px; }

  /* ── canvas 모드 ── */
  .canvas-doc-section { padding: 16px; }
  .canvas-page { position: relative; width: 100%; overflow: hidden; border: 1px solid #e0e0e0; border-radius: 8px; background: #fff; margin-bottom: 12px; }
  .canvas-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; }
  .canvas-field { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: flex-start; overflow: hidden; }
  .canvas-my-sig-img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .canvas-text-value { font-size: clamp(10px, 1.4vw, 14px); color: var(--cs-dark, #100B32); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .canvas-field-label { padding: 0 2px; }
  .canvas-label-value { font-size: clamp(9px, 1.2vw, 12px); color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .canvas-field-issuer-image { padding: 0; overflow: hidden; }
  .canvas-issuer-img { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; user-select: none; }

  /* ── spreadsheet 모드 ── */
  .spreadsheet-doc-content { overflow-x: auto; }
  .spreadsheet-doc-content :global(.ss-sheet-page) { margin-bottom: 24px; }
  .spreadsheet-doc-content :global(.ss-sheet-name) { font-size: 13px; font-weight: 700; color: var(--cs-dark, #100B32); margin: 0 0 8px; }
  .spreadsheet-doc-content :global(.ss-table) { border-collapse: collapse; font-size: 12px; color: var(--cs-dark, #100B32); min-width: 100%; }
  .spreadsheet-doc-content :global(.ss-table td) { border: 1px solid #ccc; padding: 4px 6px; white-space: pre-wrap; vertical-align: top; word-break: break-all; }
  .spreadsheet-doc-content :global(.ss-cell-image) { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: 600px; height: auto; z-index: 5; pointer-events: none; }

  /* 인쇄 — A4 기준 출력 */
  @page { size: A4; margin: 20mm; }
  @media print {
    :global(body) { background: white !important; }
    .contract-header { display: none !important; }
    .contract-main { max-width: none; padding: 0; }
    .summary-card { display: none !important; }
    .doc-section { border-radius: 0; box-shadow: none; padding: 0; break-inside: avoid; }
  }
</style>
