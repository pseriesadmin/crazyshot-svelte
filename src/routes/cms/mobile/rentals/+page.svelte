<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import QrScannerOverlay from '$lib/components/common/QrScannerOverlay.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import { extractProductId, isProductMatch } from '$lib/utils/qrProductId'
  import { nextStatus } from '$lib/utils/rentalTransition'
  import type { PageData } from './$types'
  import type { RentalListRow } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 대여 라이프사이클 전용 — 데스크톱 /cms/rentals/+page.svelte와 동일 라벨/색상 (pending/hold 미포함)
  const STATUS_LABEL: Record<string, string> = {
    confirmed:        '승인완료',
    shipped:          '반출중',
    in_use:           '대여중',
    return_requested: '반납중',
    returned:         '반납완료',
    completed:        '완료',
    damage_claimed:   '파손신고',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    confirmed:        { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
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

  // QR 일치 시: '승인완료' 카드는 반출로, '반납중' 카드는 반납으로 확인 탭 없이 즉시 자동 기록.
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
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.6"/>
                    <rect x="12" y="2" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.6"/>
                    <rect x="2" y="12" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.6"/>
                    <path d="M12 12h3v3M18 15v3h-3M15 18h-3v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
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
                />
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<QrScannerOverlay
  bind:open={qrOverlayOpen}
  onDetected={handleCardQrDetected}
  onClose={() => (qrOverlayOpen = false)}
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
    padding: 15px 16px 6px;
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
    margin: 12px 0 0;
    padding: 0 16px 40px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    padding: 16px 16px 0;
    background: none;
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
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-purple);
    cursor: pointer;
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
</style>
