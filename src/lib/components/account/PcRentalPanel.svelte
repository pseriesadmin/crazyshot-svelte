<script lang="ts">
  import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
  import ChatIcon from '$lib/components/common/ChatIcon.svelte'
  import { openChatWithContext } from '$lib/stores/chat.svelte'

  interface RentalItem {
    id: string
    status: string
    reservation_code: string
    start_date: string | null
    end_date: string | null
    created_at: string
    product_name?: string | null
    product_category?: string | null
    has_signed_contract?: boolean
    pending_contract_token?: string | null
  }

  interface Props {
    rentals: RentalItem[]
    onback: () => void
  }

  let { rentals, onback }: Props = $props()

  // 대여 건별 채팅 문의 — 공통 플로팅 채팅 모달을 여는 트리거(모달 자체는 상위 /account
  // 페이지가 FloatingButton hideFab으로 마운트해둠, account/rental/+page.svelte와 동일 패턴)
  function openReservationChat(rentalId: string): void {
    openChatWithContext({ context_type: 'reservation', context_reservation_id: Number(rentalId) })
  }

  // 서명 완료된 전자계약서를 새 창(탭)으로 열람 — account/rental/+page.svelte와 동일 패턴
  function openContractViewer(rentalId: string): void {
    window.open(`/account/rental/${rentalId}/contract`, '_blank', 'noopener,noreferrer')
  }

  // 서명 대기 중인 전자계약서 — 토큰 기반 서명화면(/contract/[token])을 새 창으로 연다
  function openContractSigning(token: string): void {
    window.open(`/contract/${token}`, '_blank', 'noopener,noreferrer')
  }

  const STATUS_LABEL: Record<string, string> = {
    hold:             '신청대기',
    confirmed:        '계약완료',
    shipped:          '반출중',
    in_use:           '대여중',
    return_requested: '반납중',
    returned:         '반납완료',
    completed:        '완료',
    damage_claimed:   '파손신고',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    hold:             { bg: 'rgba(102,102,102,0.10)', color: '#666' },
    confirmed:        { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    shipped:          { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    in_use:           { bg: 'rgba(59,47,138,0.12)',   color: '#3B2F8A' },
    return_requested: { bg: 'rgba(255,69,0,0.12)',    color: '#FF4500' },
    returned:         { bg: 'rgba(102,102,102,0.10)', color: '#666' },
    completed:        { bg: 'rgba(102,102,102,0.10)', color: '#666' },
    damage_claimed:   { bg: 'rgba(255,53,53,0.10)',   color: '#CF0000' },
  }

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }
</script>

<div class="panel">
  <div class="panel-head">
    <button class="btn-back" onclick={onback}>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
        <path d="M7 1L1 7L7 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      돌아가기
    </button>
    <span class="panel-title">대여</span>
  </div>

  {#if rentals.length === 0}
    <div class="empty-state">
      <p class="empty-msg">대여 내역이 없습니다.</p>
      <p class="empty-sub">아직 진행 중인 대여가 없어요.</p>
    </div>
  {:else}
    <div class="list-wrap">
      {#each rentals as rental (rental.id)}
        {@const st = STATUS_STYLE[rental.status] ?? STATUS_STYLE['hold']}
        <div class="rental-card">
          <div class="card-head">
            <span class="code">{rental.reservation_code}</span>
            <div class="card-head-right">
              <span class="status-chip" style="background:{st.bg};color:{st.color}">
                {STATUS_LABEL[rental.status] ?? rental.status}
              </span>
              <button
                type="button"
                class="chat-btn"
                onclick={() => openReservationChat(rental.id)}
                aria-label="이 대여 건으로 채팅 문의하기"
                title="채팅 문의"
              >
                <ChatIcon size={28} />
              </button>
            </div>
          </div>

          {#if rental.product_name}
            <div class="product-row">
              <span class="product-name">{rental.product_name}</span>
              {#if rental.product_category}
                <span class="product-cat">{rental.product_category}</span>
              {/if}
            </div>
          {/if}

          <div class="card-dates">
            <span class="date-label">대여기간</span>
            <span class="date-value">{formatDate(rental.start_date)} ~ {formatDate(rental.end_date)}</span>
          </div>

          <div class="stepper-wrap">
            <RentalJourneyStepper status={rental.status} />
          </div>

          {#if rental.has_signed_contract}
            <button
              type="button"
              class="contract-btn"
              onclick={() => openContractViewer(rental.id)}
            >
              전자계약 확인
            </button>
          {:else if rental.pending_contract_token}
            <button
              type="button"
              class="contract-btn"
              onclick={() => openContractSigning(rental.pending_contract_token ?? '')}
            >
              전자계약 서명하기
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 16px; }

  .panel-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
  }
  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 6px 0;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--cs-text-mid);
    cursor: pointer;
    transition: color 0.15s;
  }
  .btn-back:hover { color: var(--cs-purple); }
  .panel-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-text);
  }

  /* 빈 상태 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 60px 20px;
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
  }
  .empty-msg {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
  }
  .empty-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* 카드 */
  .list-wrap { display: flex; flex-direction: column; gap: 12px; }

  .rental-card {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .code {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
    letter-spacing: -0.3px;
  }
  .status-chip {
    display: inline-flex;
    align-items: center;
    padding: 3px 12px;
    border-radius: var(--radius-xl);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .card-head-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* 대여 건별 채팅 문의 버튼 — account/rental/+page.svelte(모바일)와 동일 스펙 */
  .chat-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: transform 0.15s;
  }
  .chat-btn:hover  { transform: scale(1.07); }
  .chat-btn:active { transform: scale(0.95); }

  .product-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .product-name {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
    line-height: 1.4;
  }
  .product-cat {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: var(--cs-text-mid);
  }

  .card-dates {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .date-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .date-value {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text);
  }
  .stepper-wrap { margin-top: 4px; }

  /* 전자계약 확인/서명하기 버튼 — account/rental/+page.svelte(모바일)와 동일 스펙 */
  .contract-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    min-height: 44px;
    border-radius: var(--radius-xl);
    background: var(--cs-white);
    border: 1.5px solid var(--cs-purple);
    color: var(--cs-purple);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }
  .contract-btn:hover  { background: var(--cs-lilac); }
  .contract-btn:active { background: var(--cs-purple-pale); }
</style>
