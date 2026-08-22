<script lang="ts">
  import { enhance } from '$app/forms'
  import { goto } from '$app/navigation'
  import { nextStatus, nextLabel } from '$lib/utils/rentalTransition'
  import type { PageData, ActionData } from './$types'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  // 상태 레이블
  const STATUS_LABEL: Record<string, string> = {
    confirmed:        '계약완료',
    shipped:          '반출중',
    in_use:           '대여중',
    return_requested: '반납중',
    returned:         '반납완료',
  }

  // 상태 배지 스타일
  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    confirmed:        { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    shipped:          { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    in_use:           { bg: 'rgba(59,47,138,0.12)',   color: 'var(--cs-purple)' },
    return_requested: { bg: 'rgba(255,69,0,0.12)',    color: 'var(--cs-orange)' },
    returned:         { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
  }

  const rsv = $derived(data.activeReservation)
  const ns  = $derived(rsv ? nextStatus(rsv.status, rsv.pickup_method, rsv.return_method) : null)
  const nl  = $derived(rsv ? nextLabel(rsv.status, rsv.pickup_method, rsv.return_method) : '')

  let submitting = $state(false)
</script>

<div class="qr-page">

  <!-- 상단 헤더 -->
  <div class="qr-header">
    <button type="button" class="back-btn" onclick={() => goto('/cms/mobile')} aria-label="목록으로">‹</button>
    <div class="header-info">
      <span class="header-name">{data.product.name}</span>
      {#if data.product.product_code}
        <span class="header-code">{data.product.product_code}</span>
      {/if}
    </div>
  </div>

  <div class="qr-content">

    <!-- 에러 배너 -->
    {#if form && !form.ok && 'message' in form && form.message}
      <div class="error-banner" role="alert">{form.message}</div>
    {/if}

    <!-- 분기 1: 처리 성공 완료 화면 -->
    {#if form?.ok && 'newStatus' in form}
      <div class="result-card">
        <div class="result-icon">✓</div>
        <p class="result-status">{STATUS_LABEL[form.newStatus] ?? form.newStatus}</p>
        <p class="result-msg">처리가 완료되었습니다.</p>
        <button type="button" class="rescan-btn" onclick={() => goto('/cms/mobile')}>
          다시 스캔
        </button>
      </div>

    <!-- 분기 2: 활성 예약 있음 -->
    {:else if rsv}
      <div class="rsv-card">
        <div class="rsv-top">
          <span class="rsv-code">{rsv.reservation_code ?? `예약 #${rsv.id}`}</span>
          <span
            class="status-badge"
            style="background:{STATUS_STYLE[rsv.status]?.bg ?? 'rgba(100,100,100,0.1)'};color:{STATUS_STYLE[rsv.status]?.color ?? 'var(--cs-text-mid)'}"
          >
            {STATUS_LABEL[rsv.status] ?? rsv.status}
          </span>
        </div>
        <p class="rsv-customer">{rsv.customer_name ?? '—'}</p>
        <p class="rsv-period">{rsv.start_date} ~ {rsv.end_date}</p>
      </div>

      {#if ns}
        <form
          method="POST"
          action="?/processQrAction"
          use:enhance={() => {
            submitting = true
            return ({ update }) => { submitting = false; update() }
          }}
        >
          <input type="hidden" name="reservation_id" value={String(rsv.id)} />
          <input type="hidden" name="new_status" value={ns} />
          <button type="submit" class="action-btn" disabled={submitting}>
            {submitting ? '처리 중...' : nl}
          </button>
        </form>
      {:else}
        <p class="no-action-msg">이 상태에서는 추가 처리 단계가 없습니다.</p>
      {/if}

    <!-- 분기 3: 활성 예약 없음 -->
    {:else}
      <div class="no-rsv-card">
        <p class="no-rsv-text">현재 활성 예약이 없습니다.</p>
        <a href="/cms/mobile/{data.product.id}" class="detail-link">
          상품 상세 보기
        </a>
      </div>
    {/if}

  </div>

</div>

<style>
  .qr-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    background: var(--cs-lilac);
    min-height: 100vh;
  }

  /* 헤더 */
  .qr-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px 6px;
    background: var(--cs-lilac);
  }

  .back-btn {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--cs-text);
    font-size: 28px;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    line-height: 1;
  }

  .header-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .header-name {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-code {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  /* 콘텐츠 영역 */
  .qr-content {
    flex: 1;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* 에러 배너 */
  .error-banner {
    background: rgba(255, 53, 53, 0.10);
    border-radius: var(--radius-sm);
    padding: 12px 16px;
    font-size: 14px;
    color: #CF0000;
  }

  /* ── 처리 완료 카드 ── */
  .result-card {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    padding: 40px 24px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }

  .result-icon {
    width: 64px;
    height: 64px;
    background: rgba(16, 185, 129, 0.12);
    color: #047857;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 8px;
  }

  .result-status {
    font-size: 20px;
    font-weight: 800;
    color: var(--cs-text);
    margin: 0;
  }

  .result-msg {
    font-size: 14px;
    color: var(--cs-text-mid);
    margin: 0 0 8px;
  }

  .rescan-btn {
    width: 100%;
    height: 52px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
    margin-top: 8px;
  }
  .rescan-btn:hover { background: var(--cs-purple-hover); }

  /* ── 예약 카드 ── */
  .rsv-card {
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .rsv-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .rsv-code {
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
  }

  .status-badge {
    font-size: 12px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .rsv-customer {
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
  }

  .rsv-period {
    font-size: 13px;
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* ── 액션 버튼 ── */
  .action-btn {
    width: 100%;
    height: 56px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font-size: 18px;
    font-weight: 800;
    cursor: pointer;
    transition: background 0.15s;
    letter-spacing: -0.3px;
  }
  .action-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .action-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .no-action-msg {
    text-align: center;
    font-size: 13px;
    color: var(--cs-text-light);
    padding: 12px 0;
    margin: 0;
  }

  /* ── 예약 없음 카드 ── */
  .no-rsv-card {
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 40px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    text-align: center;
  }

  .no-rsv-text {
    font-size: 15px;
    color: var(--cs-text-mid);
    margin: 0;
  }

  .detail-link {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 20px;
    background: transparent;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-xl);
    color: var(--cs-purple);
    font-size: 14px;
    font-weight: 700;
    text-decoration: none;
    transition: background 0.15s;
  }
  .detail-link:hover { background: rgba(59, 47, 138, 0.06); }
</style>
