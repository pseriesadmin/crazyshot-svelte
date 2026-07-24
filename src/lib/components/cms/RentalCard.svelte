<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import type { ActionLog, ActiveRentalRow } from '$lib/types/rental'

  interface Props {
    rental:    ActiveRentalRow
    onrefresh: () => void
  }
  let { rental, onrefresh }: Props = $props()

  let isSubmitting = $state(false)

  const STATUS_LABEL: Record<string, string> = {
    confirmed:        '승인완료',
    shipped:          '배송중',
    in_use:           '대여중',
    return_requested: '반납요청',
    returned:         '반납완료',
    completed:        '완료',
    cancelled:        '취소',
    damage_claimed:   '파손신고',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    confirmed:        { bg: 'rgba(16,185,129,0.12)',  color: 'var(--cs-success-light)' },
    shipped:          { bg: 'rgba(14,165,233,0.12)',  color: 'var(--cs-info)' },
    in_use:           { bg: 'rgba(59,47,138,0.12)',   color: 'var(--cs-purple)' },
    return_requested: { bg: 'rgba(255,69,0,0.12)',    color: 'var(--cs-orange)' },
    returned:         { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    completed:        { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
  }

  const ACTION_LABELS: Record<string, string> = {
    visit_pickup:           '방문 반출',
    visit_return:           '방문 반납',
    crazy_delivery_pickup:  '크레이지배송 반출',
    crazy_delivery_return:  '크레이지배송 반납',
  }

  const PICKUP_LABELS: Record<string, string> = {
    crazydelivery: '크레이지배송',
    quick:         '당일퀵',
    locker:        '무인보관함',
    visit:         '방문수령',
    epost:         '택배',
  }

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }

  function formatDateTime(dt: string): string {
    return new Date(dt).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // 픽업 반출 버튼 표시 조건
  const showVisitPickup = $derived(
    rental.pickup_method === 'visit' && rental.status === 'confirmed'
  )
  const showCrazyPickup = $derived(
    rental.pickup_method === 'crazydelivery' && rental.status === 'confirmed'
  )
  // 방문 반납 버튼 표시 조건
  const showVisitReturn = $derived(
    rental.return_method === 'visit' && rental.status === 'return_requested'
  )
  const showCrazyReturn = $derived(
    rental.return_method === 'crazydelivery' && rental.status === 'return_requested'
  )
  // 중간 단계 버튼
  const showReceivedConfirm = $derived(rental.status === 'shipped')    // 수령 확인 → in_use
  const showReturnAccept    = $derived(rental.status === 'in_use')     // 반납 접수 → return_requested
  const showComplete        = $derived(rental.status === 'returned')   // 완료 처리 → completed

  const hasActions = $derived(
    showVisitPickup || showCrazyPickup ||
    showVisitReturn || showCrazyReturn ||
    showReceivedConfirm || showReturnAccept || showComplete
  )

  const st = $derived(STATUS_STYLE[rental.status] ?? { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' })
</script>

<article class="rental-card">
  <!-- 카드 헤더: 예약코드 + 상태 배지 -->
  <div class="card-header">
    <code class="rsv-code">{rental.reservation_code}</code>
    <span class="status-badge" style="background:{st.bg};color:{st.color}">
      {STATUS_LABEL[rental.status] ?? rental.status}
    </span>
  </div>

  <!-- 상품 정보 -->
  <div class="card-product">
    {#if rental.product_image_url}
      <img
        src={rental.product_image_url}
        alt={rental.product_name}
        class="product-img"
        width="56"
        height="56"
        loading="lazy"
      />
    {/if}
    <div class="product-meta">
      <span class="product-name">{rental.product_name}</span>
      <span class="product-cat">{rental.product_category ?? ''}</span>
      <span class="rental-period">
        {formatDate(rental.rental_start)} ~ {formatDate(rental.rental_end)}
        {#if rental.rental_days}
          <span class="rental-days">({rental.rental_days}일)</span>
        {/if}
      </span>
    </div>
  </div>

  <!-- 고객 + 방법 -->
  <div class="card-methods">
    <div class="method-row">
      <span class="method-label">고객</span>
      <span class="method-value">{rental.customer_name}</span>
    </div>
    <div class="method-row">
      <span class="method-label">수령</span>
      <span class="method-value">
        {rental.pickup_method ? (PICKUP_LABELS[rental.pickup_method] ?? rental.pickup_method) : '-'}
        {#if rental.pickup_time}
          <span class="time-hint">{rental.pickup_time}</span>
        {/if}
      </span>
    </div>
    <div class="method-row">
      <span class="method-label">반납</span>
      <span class="method-value">
        {rental.return_method ? (PICKUP_LABELS[rental.return_method] ?? rental.return_method) : '-'}
        {#if rental.return_time}
          <span class="time-hint">{rental.return_time}</span>
        {/if}
      </span>
    </div>
  </div>

  <!-- 콤보 액션 버튼 -->
  {#if hasActions}
    <div class="card-actions">
      {#if showVisitPickup}
        <form method="POST" action="/cms/rentals?/logRentalAction" use:enhance={() => {
          isSubmitting = true
          return async ({ result, update }) => {
            isSubmitting = false
            if (result.type === 'success') { csToast.success('방문 반출 처리되었습니다.'); onrefresh() }
            else csToast.error('처리 중 오류가 발생했습니다.')
            await update()
          }
        }}>
          <input type="hidden" name="reservation_id" value={rental.reservation_id} />
          <input type="hidden" name="action_type"    value="visit_pickup" />
          <button type="submit" class="btn-combo" disabled={isSubmitting}>방문 반출↑</button>
        </form>
      {/if}

      {#if showCrazyPickup}
        <form method="POST" action="/cms/rentals?/logRentalAction" use:enhance={() => {
          isSubmitting = true
          return async ({ result, update }) => {
            isSubmitting = false
            if (result.type === 'success') { csToast.success('크레이지배송 반출 처리되었습니다.'); onrefresh() }
            else csToast.error('처리 중 오류가 발생했습니다.')
            await update()
          }
        }}>
          <input type="hidden" name="reservation_id" value={rental.reservation_id} />
          <input type="hidden" name="action_type"    value="crazy_delivery_pickup" />
          <button type="submit" class="btn-combo" disabled={isSubmitting}>크레이지배송 반출↑</button>
        </form>
      {/if}

      {#if showReceivedConfirm}
        <form method="POST" action="/cms/rentals?/updateStatus" use:enhance={() => {
          isSubmitting = true
          return async ({ result, update }) => {
            isSubmitting = false
            if (result.type === 'success') { csToast.success('수령 확인되었습니다.'); onrefresh() }
            else csToast.error('처리 중 오류가 발생했습니다.')
            await update()
          }
        }}>
          <input type="hidden" name="reservation_id" value={rental.reservation_id} />
          <input type="hidden" name="status"         value="in_use" />
          <button type="submit" class="btn-combo btn-mid" disabled={isSubmitting}>수령 확인</button>
        </form>
      {/if}

      {#if showReturnAccept}
        <form method="POST" action="/cms/rentals?/updateStatus" use:enhance={() => {
          isSubmitting = true
          return async ({ result, update }) => {
            isSubmitting = false
            if (result.type === 'success') { csToast.success('반납 접수되었습니다.'); onrefresh() }
            else csToast.error('처리 중 오류가 발생했습니다.')
            await update()
          }
        }}>
          <input type="hidden" name="reservation_id" value={rental.reservation_id} />
          <input type="hidden" name="status"         value="return_requested" />
          <button type="submit" class="btn-combo btn-mid" disabled={isSubmitting}>반납 접수</button>
        </form>
      {/if}

      {#if showVisitReturn}
        <form method="POST" action="/cms/rentals?/logRentalAction" use:enhance={() => {
          isSubmitting = true
          return async ({ result, update }) => {
            isSubmitting = false
            if (result.type === 'success') { csToast.success('방문 반납 처리되었습니다.'); onrefresh() }
            else csToast.error('처리 중 오류가 발생했습니다.')
            await update()
          }
        }}>
          <input type="hidden" name="reservation_id" value={rental.reservation_id} />
          <input type="hidden" name="action_type"    value="visit_return" />
          <button type="submit" class="btn-combo btn-return" disabled={isSubmitting}>방문 반납↓</button>
        </form>
      {/if}

      {#if showCrazyReturn}
        <form method="POST" action="/cms/rentals?/logRentalAction" use:enhance={() => {
          isSubmitting = true
          return async ({ result, update }) => {
            isSubmitting = false
            if (result.type === 'success') { csToast.success('크레이지배송 반납 처리되었습니다.'); onrefresh() }
            else csToast.error('처리 중 오류가 발생했습니다.')
            await update()
          }
        }}>
          <input type="hidden" name="reservation_id" value={rental.reservation_id} />
          <input type="hidden" name="action_type"    value="crazy_delivery_return" />
          <button type="submit" class="btn-combo btn-return" disabled={isSubmitting}>크레이지배송 반납↓</button>
        </form>
      {/if}

      {#if showComplete}
        <form method="POST" action="/cms/rentals?/updateStatus" use:enhance={() => {
          isSubmitting = true
          return async ({ result, update }) => {
            isSubmitting = false
            if (result.type === 'success') { csToast.success('대여가 완료 처리되었습니다.'); onrefresh() }
            else csToast.error('처리 중 오류가 발생했습니다.')
            await update()
          }
        }}>
          <input type="hidden" name="reservation_id" value={rental.reservation_id} />
          <input type="hidden" name="status"         value="completed" />
          <button type="submit" class="btn-combo btn-done" disabled={isSubmitting}>완료 처리</button>
        </form>
      {/if}
    </div>
  {/if}

  <!-- 액션 로그 타임스탬프 -->
  {#if rental.action_logs.length > 0}
    <div class="card-logs">
      {#each rental.action_logs as log (log.performed_at)}
        <div class="log-row">
          <span class="log-check">✓</span>
          <span class="log-type">{ACTION_LABELS[log.type] ?? log.type}</span>
          <span class="log-time">{formatDateTime(log.performed_at)}</span>
        </div>
      {/each}
    </div>
  {/if}
</article>

<style>
  .rental-card {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    border: 1px solid var(--cs-lilac);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* 헤더 */
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--cs-lilac);
    background: var(--cs-lilac);
  }
  .rsv-code {
    font: var(--text-pc-script-12);
    font-family: monospace;
    font-weight: 700;
    color: var(--cs-purple);
    letter-spacing: 0.5px;
  }
  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }

  /* 상품 */
  .card-product {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--cs-lilac);
  }
  .product-img {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: var(--cms-radius-sm);
    flex-shrink: 0;
    background: var(--cs-surface-gray);
  }
  .product-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .product-name {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .product-cat {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  .rental-period {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin-top: 2px;
  }
  .rental-days {
    color: var(--cs-text-light);
  }

  /* 방법 */
  .card-methods {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
  }
  .method-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .method-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    width: 28px;
    flex-shrink: 0;
  }
  .method-value {
    font: var(--text-pc-script-12);
    font-weight: 600;
    color: var(--cs-text);
  }
  .time-hint {
    font-weight: 400;
    color: var(--cs-text-mid);
    margin-left: 4px;
  }

  /* 액션 버튼 */
  .card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
  }
  .card-actions form {
    margin: 0;
    padding: 0;
  }
  .btn-combo {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    font-weight: 700;
    border: none;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
  }
  .btn-combo:hover:not(:disabled) { opacity: 0.85; }
  .btn-combo:disabled              { opacity: 0.45; cursor: not-allowed; }

  .btn-combo.btn-return {
    background: rgba(59,47,138,0.10);
    color: var(--cs-purple);
  }
  .btn-combo.btn-mid {
    background: rgba(14,165,233,0.12);
    color: var(--cs-info);
  }
  .btn-combo.btn-done {
    background: rgba(16,185,129,0.12);
    color: var(--cs-success-light);
  }

  /* 로그 */
  .card-logs {
    padding: 8px 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .log-row {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .log-check {
    color: var(--cs-success-light);
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .log-type {
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    font-weight: 600;
  }
  .log-time {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin-left: auto;
  }
</style>
