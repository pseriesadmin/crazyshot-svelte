<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import QrScannerOverlay from '$lib/components/common/QrScannerOverlay.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import { extractProductId, isProductMatch } from '$lib/utils/qrProductId'
  import { nextStatus } from '$lib/utils/rentalTransition'
  import { scrollPeek } from '$lib/utils/scrollPeek'
  import type { PageData } from './$types'
  import type { RentalListRow } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 대여 라이프사이클 전용 — 데스크톱 /cms/rentals/+page.svelte와 동일 라벨/색상 (pending/hold 미포함)
  const STATUS_LABEL: Record<string, string> = {
    confirmed:        '계약완료',
    shipped:          '반출중',
    in_use:           '대여중',
    return_requested: '반납중',
    returned:         '반납완료',
    completed:        '완료',
    damage_claimed:   '파손신고',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    confirmed:        { bg: 'rgba(59,47,138,0.1)',    color: 'var(--cs-purple)' },
    shipped:          { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    in_use:           { bg: 'rgba(59,47,138,0.12)',   color: 'var(--cs-purple)' },
    return_requested: { bg: 'rgba(255,69,0,0.12)',    color: 'var(--cs-orange)' },
    returned:         { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    completed:        { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    damage_claimed:   { bg: 'rgba(255,53,53,0.10)',   color: '#CF0000' },
  }

  // 단일 확장 아코디언 — 카드 하나를 펼치면 이전에 펼쳐진 카드는 자동으로 닫힘
  let expandedReservationId = $state<number | null>(null)

  function toggleCard(id: number): void {
    expandedReservationId = expandedReservationId === id ? null : id
  }

  // 카드 QR 아이콘 스캔 — 일치 검증 후 이동
  let qrOverlayOpen = $state(false)
  let activeQrRow = $state<RentalListRow | null>(null)

  function openCardQr(row: RentalListRow, e: Event): void {
    e.stopPropagation()
    activeQrRow = row
    qrOverlayOpen = true
  }

  // QR 일치 시: '계약완료' 카드는 반출로, '반납중' 카드는 반납으로 확인 탭 없이 즉시 자동 기록.
  // 그 외 상태는 기존처럼 /cms/mobile/qr/[id] 수동 처리 화면으로 이동(RentalDetailPanel 수동 버튼과 하이브리드 유지).
  const AUTO_STATUSES = new Set(['confirmed', 'return_requested'])

  function handleCardQrDetected(raw: string): boolean {
    const row = activeQrRow
    const scannedId = extractProductId(raw)
    if (!row || !scannedId) return false
    processCardQrMatch(row, scannedId)
    return true
  }

  async function processCardQrMatch(row: RentalListRow, scannedId: string): Promise<void> {
    if (!isProductMatch(scannedId, row)) {
      csToast.error('스캔한 상품이 예약 상품과 일치하지 않습니다')
      return
    }

    const target = nextStatus(row.status, row.pickup_method, row.return_method)
    if (!AUTO_STATUSES.has(row.status) || !target) {
      goto(`/cms/mobile/qr/${encodeURIComponent(scannedId)}`)
      return
    }

    try {
      const res = await fetch('/api/cms/rental-qr-transition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reservationId: row.reservation_id, newStatus: target, productId: scannedId }),
      })
      const body = await res.json()
      if (body.ok) {
        csToast.success(row.status === 'confirmed' ? '반출로 자동 기록되었습니다' : '반납으로 자동 기록되었습니다')
        invalidateAll()
      } else {
        csToast.error(body.message ?? '처리에 실패했습니다')
      }
    } catch {
      csToast.error('처리 중 오류가 발생했습니다')
    }
  }

  function formatPeriod(row: RentalListRow): string {
    const start = row.rental_start?.slice(0, 10) ?? ''
    const end = row.rental_end?.slice(0, 10) ?? ''
    const days = row.rental_days ? ` (${row.rental_days}일)` : ''
    return `${start} ~ ${end}${days}`
  }

  // 일반 QR 스캐너 — /cms/mobile 메인 화면과 동일한 플로팅 메뉴(대여목록/카메라)를
  // 이 화면에도 노출. 카드별 QR 검증 오버레이(qrOverlayOpen)와는 별개 상태.
  let showGeneralQrScanner = $state(false)

  // 플로팅 메뉴 스크롤 인터랙션 — 업스크롤 시 절반 숨김, 다운스크롤 시 튀어나오며 노출
  let fabPeek = $state(false)

  function handleGeneralQrDetected(raw: string): boolean {
    const id = extractProductId(raw)
    if (!id) return false
    goto(`/cms/mobile/qr/${id}`)
    return true
  }
</script>

<div class="mob-rentals-page">
  <div class="mob-rentals-header">
    <button type="button" class="back-btn" onclick={() => goto('/cms/mobile')} aria-label="뒤로">‹</button>
    <span class="header-title">대여 목록</span>
  </div>

  {#if data.rentals.length === 0}
    <div class="no-data">표시할 대여 건이 없습니다.</div>
  {:else}
    <ul class="rental-card-list" role="list">
      {#each data.rentals as row (row.reservation_id)}
        <li>
          <div class="rental-card" class:expanded={expandedReservationId === row.reservation_id}>
            <button
              type="button"
              class="rental-card-header"
              onclick={() => toggleCard(row.reservation_id)}
              aria-expanded={expandedReservationId === row.reservation_id}
            >
              <div class="rental-card-main">
                <span
                  class="status-badge"
                  style="background:{STATUS_STYLE[row.status]?.bg ?? '#F6F6F6'}; color:{STATUS_STYLE[row.status]?.color ?? 'var(--cs-text-mid)'}"
                >{STATUS_LABEL[row.status] ?? row.status}</span>
                <span class="rental-card-customer">{row.customer_name}</span>
              </div>
              <span class="rental-card-chevron" class:rotated={expandedReservationId === row.reservation_id}>
                <ChevronIcon direction="down" />
              </span>
            </button>

            <div class="rental-card-body">
              <div class="rental-card-product-row">
                <div class="rental-card-product">
                  <span class="rental-card-product-name">{row.product_name}</span>
                  <span class="rental-card-product-meta">{row.product_category}</span>
                </div>
                <button
                  type="button"
                  class="rental-card-qr-btn"
                  onclick={(e) => openCardQr(row, e)}
                  aria-label="상품 QR 확인"
                  title="상품 QR 확인"
                >
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M10.3882 10.4939C10.3694 10.5503 10.35 10.6473 10.35 10.8L10.35 11.7092L13.05 11.7C13.6387 11.7 14.2455 11.8478 14.6988 12.3009C15.1521 12.754 15.3 13.3607 15.3 13.9492V14.4C15.3 14.8971 14.8971 15.3 14.4 15.3C13.9029 15.3 13.5 14.8971 13.5 14.4V13.9492C13.5 13.7968 13.4806 13.7 13.4619 13.6438C13.4447 13.5924 13.4291 13.5767 13.4263 13.574C13.4236 13.5713 13.4077 13.5554 13.3561 13.5382C13.2997 13.5194 13.2027 13.5 13.05 13.5L10.35 13.5092V14.4092C10.35 14.9062 9.94706 15.3092 9.45 15.3092C8.95294 15.3092 8.55 14.9062 8.55 14.4092L8.55001 10.8C8.55001 10.2113 8.6978 9.60452 9.15088 9.15124C9.60403 8.6979 10.2107 8.55 10.7992 8.55H10.8038H13.0546C13.5516 8.55253 13.9525 8.95752 13.95 9.45457C13.9475 9.95162 13.5425 10.3525 13.0454 10.35L10.7972 10.35C10.6459 10.3502 10.5498 10.3695 10.4938 10.3881C10.4424 10.4053 10.4268 10.4209 10.424 10.4237C10.4213 10.4264 10.4054 10.4423 10.3882 10.4939Z" fill="currentColor"/>
                    <path d="M1.8 2.25C1.8 2.00147 2.00147 1.8 2.25 1.8H4.5C4.74853 1.8 4.95 2.00147 4.95 2.25V4.5C4.95 4.74853 4.74853 4.95 4.5 4.95H2.25C2.00147 4.95 1.8 4.74853 1.8 4.5V2.25Z" fill="currentColor"/>
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M2.25 0H4.5C5.74264 0 6.75 1.00736 6.75 2.25V4.5C6.75 5.74264 5.74264 6.75 4.5 6.75H2.25C1.00736 6.75 0 5.74264 0 4.5V2.25C0 1.00736 1.00736 0 2.25 0ZM2.25 1.8C2.00147 1.8 1.8 2.00147 1.8 2.25V4.5C1.8 4.74853 2.00147 4.95 2.25 4.95H4.5C4.74853 4.95 4.95 4.74853 4.95 4.5V2.25C4.95 2.00147 4.74853 1.8 4.5 1.8H2.25Z" fill="currentColor"/>
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M10.8 0H13.05C14.2926 0 15.3 1.00736 15.3 2.25V4.5C15.3 5.74264 14.2926 6.75 13.05 6.75H10.8C9.55736 6.75 8.55 5.74264 8.55 4.5V2.25C8.55 1.00736 9.55736 0 10.8 0ZM10.8 1.8C10.5515 1.8 10.35 2.00147 10.35 2.25V4.5C10.35 4.74853 10.5515 4.95 10.8 4.95H13.05C13.2985 4.95 13.5 4.74853 13.5 4.5V2.25C13.5 2.00147 13.2985 1.8 13.05 1.8H10.8Z" fill="currentColor"/>
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M2.25 8.55H4.5C5.74264 8.55 6.75 9.55736 6.75 10.8V13.05C6.75 14.2926 5.74264 15.3 4.5 15.3H2.25C1.00736 15.3 0 14.2926 0 13.05V10.8C0 9.55736 1.00736 8.55 2.25 8.55ZM2.25 10.35C2.00147 10.35 1.8 10.5515 1.8 10.8V13.05C1.8 13.2985 2.00147 13.5 2.25 13.5H4.5C4.74853 13.5 4.95 13.2985 4.95 13.05V10.8C4.95 10.5515 4.74853 10.35 4.5 10.35H2.25Z" fill="currentColor"/>
                  </svg>
                </button>
              </div>
              <p class="rental-card-period">{formatPeriod(row)}</p>
              {#if row.reservation_code}
                <p class="rental-card-code">{row.reservation_code}</p>
              {/if}
            </div>

            {#if expandedReservationId === row.reservation_id}
              <div class="rental-card-detail-wrap">
                <RentalDetailPanel
                  {row}
                  onclose={() => (expandedReservationId = null)}
                  onrefresh={() => invalidateAll()}
                  isRentalView={true}
                  enableQrVerify={true}
                  stepFilter={['confirmed', 'shipped', 'in_use', 'return_requested', 'returned']}
                />
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- 플로팅 아이콘 메뉴 그룹 (/cms/mobile 메인 화면과 동일 — 대여목록 + 카메라, 하단 우측 고정) -->
<div class="fab-group" class:peek={fabPeek} use:scrollPeek={(v) => (fabPeek = v)}>
  <button
    type="button"
    class="rental-list-fab"
    onclick={() => goto('/cms/mobile/rentals')}
    aria-label="대여 목록"
    title="대여 목록"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="75" height="75" viewBox="0 0 50 50" fill="none" aria-hidden="true">
      <circle cx="25" cy="25" r="25" fill="#3B2F8A"/>
      <g transform="translate(16.5, 13.5)">
        <path d="M5.50195 0.552734V0H11.4268V0.552734C11.4269 0.0478777 11.4273 0.00376604 11.4277 0H11.4521C11.4617 0.000207732 11.4733 0.000442309 11.4854 0.000976562C11.5102 0.0020945 11.5413 0.00449327 11.5762 0.0078125C11.6461 0.0144915 11.7373 0.0265941 11.8418 0.0498047C12.0492 0.0959336 12.3309 0.18971 12.6162 0.379883C13.0867 0.693805 13.4563 1.19576 13.6133 1.9043C14.1644 1.95503 14.5826 2.04988 14.9473 2.23047C15.6296 2.56854 16.1845 3.10811 16.5322 3.77148C16.9275 4.52581 16.9277 5.51345 16.9277 7.48828V16.5166C16.9277 18.4914 16.9275 19.4791 16.5322 20.2334C16.1845 20.8969 15.6297 21.4363 14.9473 21.7744C14.1714 22.1587 13.1553 22.1592 11.124 22.1592H5.80371C3.77246 22.1592 2.75635 22.1588 1.98047 21.7744C1.29818 21.4363 0.743199 20.8968 0.395508 20.2334C0.000285467 19.4791 7.97912e-10 18.4913 0 16.5166V7.48828C1.06551e-08 5.51345 0.000185887 4.52581 0.395508 3.77148C0.743212 3.10806 1.29813 2.56857 1.98047 2.23047C2.34492 2.04993 2.7628 1.95507 3.31348 1.9043C3.47046 1.19536 3.8417 0.693827 4.3125 0.379883C4.59801 0.189565 4.87948 0.095915 5.08691 0.0498047C5.19155 0.0265825 5.28265 0.0144769 5.35254 0.0078125C5.38751 0.00448526 5.41847 0.00208781 5.44336 0.000976562C5.45551 0.000442312 5.46699 0.000207629 5.47656 0H5.50098C5.50145 0.00462108 5.50179 0.0532855 5.50195 0.552734ZM4.83594 15.6426C4.14581 15.6428 3.58602 16.2024 3.58594 16.8926C3.58595 17.5828 4.14576 18.1424 4.83594 18.1426H8.46289C9.15324 18.1426 9.71288 17.5829 9.71289 16.8926C9.7128 16.2023 9.15319 15.6426 8.46289 15.6426H4.83594ZM4.83594 10.752C4.14597 10.7522 3.58628 11.312 3.58594 12.002C3.58594 12.6922 4.14575 13.2518 4.83594 13.252H12.0908C12.781 13.2518 13.3408 12.6922 13.3408 12.002C13.3405 11.312 12.7808 10.7521 12.0908 10.752H4.83594ZM4.83594 5.8623C4.14581 5.86251 3.58602 6.42215 3.58594 7.1123C3.58594 7.80254 4.14575 8.3621 4.83594 8.3623H12.0908C12.781 8.36214 13.3408 7.80256 13.3408 7.1123C13.3407 6.42212 12.781 5.86247 12.0908 5.8623H4.83594Z" fill="white"/>
      </g>
    </svg>
  </button>

  <button
    type="button"
    class="qr-fab"
    onclick={() => (showGeneralQrScanner = true)}
    aria-label="QR 코드 스캔"
    title="상품 QR 스캔"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="75" height="75" viewBox="0 0 50 50" fill="none" aria-hidden="true">
      <circle cx="25" cy="25" r="25" fill="#3B2F8A"/>
      <g transform="translate(14.6, 17)">
        <path d="M16.8008 0C19.0097 0.000212977 20.8008 1.79099 20.8008 4V12C20.8008 14.209 19.0097 15.9998 16.8008 16H4C1.79104 15.9998 0 14.209 0 12V4C0 1.79099 1.79104 0.000211051 4 0H16.8008ZM10.4004 4C8.19137 4 6.40059 5.79103 6.40039 8C6.4006 10.209 8.19138 12 10.4004 12C12.6094 12 14.4002 10.209 14.4004 8C14.4002 5.79103 12.6094 4 10.4004 4ZM16.8008 2.40039C15.9172 2.40039 15.2004 3.11651 15.2002 4C15.2004 4.88348 15.9173 5.60059 16.8008 5.60059C17.6841 5.60038 18.4002 4.88335 18.4004 4C18.4002 3.11664 17.6841 2.4006 16.8008 2.40039Z" fill="white"/>
      </g>
    </svg>
  </button>
</div>

<QrScannerOverlay
  bind:open={qrOverlayOpen}
  onDetected={handleCardQrDetected}
  onClose={() => (qrOverlayOpen = false)}
/>

<QrScannerOverlay
  bind:open={showGeneralQrScanner}
  onDetected={handleGeneralQrDetected}
  onClose={() => (showGeneralQrScanner = false)}
/>

<style>
  .mob-rentals-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    background: var(--cs-lilac);
  }

  .mob-rentals-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px 16px 12px;
  }

  .back-btn {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    font-size: 28px;
    color: var(--cs-text);
    cursor: pointer;
    flex-shrink: 0;
  }

  .header-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-text);
  }

  .no-data {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--cs-text-light);
    padding: 48px 20px;
  }

  .rental-card-list {
    list-style: none;
    margin: 24px 0 0;
    padding: 0 16px 40px;
    display: flex;
    flex-direction: column;
    gap: 36px;
  }

  .rental-card {
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    border: 1px solid transparent;
    overflow: hidden;
    transition: border-color 0.12s;
  }
  .rental-card.expanded { border-color: var(--cs-purple); }

  .rental-card-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 16px 16px;
    background: rgba(16,11,50,0.05);
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .rental-card-main {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .status-badge {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: var(--radius-full);
  }

  .rental-card-customer {
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rental-card-chevron {
    flex-shrink: 0;
    display: flex;
    transition: transform 0.15s;
  }
  .rental-card-chevron.rotated { transform: rotate(180deg); }

  .rental-card-body {
    padding: 10px 16px 16px;
  }

  .rental-card-product-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .rental-card-product {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .rental-card-product-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rental-card-product-meta {
    font-size: 12px;
    color: var(--cs-text-mid);
  }

  .rental-card-qr-btn {
    flex-shrink: 0;
    width: 50px;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-purple);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .rental-card-qr-btn svg {
    width: 28px;
    height: 28px;
  }
  .rental-card-qr-btn:hover {
    background: var(--cs-purple);
    color: var(--cs-white);
  }

  .rental-card-period {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--cs-text-mid);
  }

  .rental-card-code {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--cs-text-light);
  }

  .rental-card-detail-wrap {
    border-top: 1px solid var(--cs-lilac);
    padding: 12px 4px;
  }

  /* ── 플로팅 아이콘 메뉴 그룹 (/cms/mobile 메인 화면과 동일 스타일) ── */
  .fab-group {
    position: fixed;
    bottom: 24px;
    right: 20px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    transform: translateX(0);
  }
  /* 업스크롤 → peek(절반 숨김, 미세 감쇠) / 다운스크롤 → expand(팝아웃, 감쇠 스프링)
   * 표본 수치값 정본: .claude/rules/ui-mobile.md "그룹형 플로팅 메뉴(.fab-group) 감쇠
   * 스프링 바운스 표준" 참고 — duration은 기준값 대비 20% 단축(0.62s→0.5s, 0.28s→0.22s) */
  .fab-group:not(.peek) {
    animation: fab-pop-out 0.5s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
  }
  .fab-group.peek {
    animation: fab-peek-in 0.22s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
  }
  @keyframes fab-pop-out {
    0%   { transform: translateX(calc(50% + 20px)); }
    28%  { transform: translateX(-21px); }
    46%  { transform: translateX(10px); }
    61%  { transform: translateX(-5px); }
    73%  { transform: translateX(2.5px); }
    83%  { transform: translateX(-1.2px); }
    91%  { transform: translateX(0.6px); }
    100% { transform: translateX(0); }
  }
  @keyframes fab-peek-in {
    0%   { transform: translateX(0); }
    55%  { transform: translateX(65px); }
    78%  { transform: translateX(53px); }
    92%  { transform: translateX(58.5px); }
    100% { transform: translateX(calc(50% + 20px)); }
  }

  .qr-fab,
  .rental-list-fab {
    width: 75px;
    height: 75px;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
  }
  .qr-fab:active, .rental-list-fab:active { transform: scale(0.96); }
  @media (hover: hover) and (pointer: fine) {
    .qr-fab:hover, .rental-list-fab:hover { transform: scale(1.06); }
  }
</style>
