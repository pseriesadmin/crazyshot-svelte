<script lang="ts">
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
  import ChatIcon from '$lib/components/common/ChatIcon.svelte'
  import FloatingButton from '$lib/components/chat/FloatingButton.svelte'
  import { openChatWithContext } from '$lib/stores/chat.svelte'
  import { authState } from '$lib/stores/auth'
  import type { PageData } from './$types'
  import type { MyRental } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 공통 플로팅 채팅 모달(FloatingButton)이 이 화면(/account)에는 전역 레이아웃에서
  // 마운트되지 않으므로 이 페이지에서 직접 마운트 — 루트 +layout.svelte와 동일한 파생 패턴
  let chatUserId = $derived($authState.user?.id ?? 'test-user')
  let chatUserName = $derived(
    ($authState.user?.user_metadata?.full_name as string | undefined) ??
    $authState.user?.email?.split('@')[0] ??
    '테스트유저'
  )
  let chatUserHandle = $derived(
    ($authState.user?.user_metadata?.username as string | undefined) ??
    $authState.user?.email?.split('@')[0] ??
    'test'
  )

  function openReservationChat(rentalId: string): void {
    openChatWithContext({ context_type: 'reservation', context_reservation_id: Number(rentalId) })
  }

  // 서명 완료된 전자계약서를 새 창(탭)으로 열람 — ActionCard.svelte의 팝업차단 우회
  // 패턴(사용자 클릭 이벤트 핸들러 내부에서 동기적으로 window.open 호출)과 동일
  function openContractViewer(rentalId: string): void {
    window.open(`/account/rental/${rentalId}/contract`, '_blank', 'noopener,noreferrer')
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

<div class="page-wrap">

  <SubGnb title="대여" mobileOnly />

  <div class="content">

    {#if data.rentals.length === 0}
      <div class="empty-state">
        <p class="empty-msg">대여 내역이 없습니다.</p>
        <p class="empty-sub">아직 진행 중인 대여가 없어요.</p>
      </div>
    {:else}
      <div class="list-wrap">
        {#each data.rentals as rental (rental.id)}
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
            {/if}
          </div>
        {/each}
      </div>
    {/if}

  </div>

  <BottomTabBar />

  <!-- 이 화면(/account)은 루트 레이아웃에서 FloatingBar가 제외되어 있어, 카드별 채팅
       버튼이 여는 공통 플로팅 채팅 모달(바텀시트)을 이 페이지에서 직접 마운트한다. -->
  <FloatingButton userId={chatUserId} userName={chatUserName} userHandle={chatUserHandle} hideFab />
</div>

<style>
  .page-wrap {
    min-height: 100vh;
    background: var(--cs-lilac);
    display: flex;
    flex-direction: column;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 70px 20px 100px;
    max-width: 600px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
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
  .list-wrap { display: flex; flex-direction: column; gap: 27px; }

  .rental-card {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);   /* PC: 50px */
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* front-uiux.md §4 카드 반경 대/중 2단 체계 — 대(large) Mobile 30px(하드코딩, 전용 변수 없음) */
  @media (max-width: 640px) {
    .rental-card { border-radius: 30px; }
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

  /* 대여 건별 채팅 문의 버튼 — 공통 플로팅 채팅 아이콘(ChatIcon) 재사용, 44×44 터치 타겟 */
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

  /* 전자계약 확인 버튼 — 보조 액션(외곽선 스타일), 서명 완료된 예약에만 노출 */
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

  @media (min-width: 768px) {
    .content {
      padding: 100px 40px 60px;
      max-width: 720px;
    }
  }
</style>
