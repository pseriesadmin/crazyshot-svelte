<script lang="ts">
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
  import ChatIcon from '$lib/components/common/ChatIcon.svelte'
  import FloatingButton from '$lib/components/chat/FloatingButton.svelte'
  import { openChatWithContext } from '$lib/stores/chat.svelte'
  import { authState } from '$lib/stores/auth'
  import { goto, invalidateAll } from '$app/navigation'
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

  // 서명 대기 중인 전자계약서 — 채팅 액션카드와 동일한 토큰 기반 서명화면(/contract/[token])을
  // 새 창으로 연다(같은 팝업차단 우회 패턴)
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

  // 예약신청 취소 모달
  // modalType A: 취소 가능 → 확인 모달
  // modalType B: 취소 불가 → 채팅 문의 안내
  let cancelPendingId  = $state<string | null>(null)
  let cancelModalType  = $state<'A' | 'B' | null>(null)
  let cancelLoading    = $state(false)
  let cancelErrorMsg   = $state<string | null>(null)

  function openCancelModal(rental: MyRental): void {
    cancelPendingId  = rental.id
    cancelErrorMsg   = null
    cancelModalType  = rental.canCancel ? 'A' : 'B'
  }

  function dismissCancel(): void {
    if (cancelLoading) return
    cancelPendingId  = null
    cancelModalType  = null
    cancelErrorMsg   = null
  }

  async function confirmCancel(): Promise<void> {
    if (!cancelPendingId) return
    cancelLoading  = true
    cancelErrorMsg = null
    try {
      const res = await fetch('/api/checkout/cancel-reservation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reservationId: Number(cancelPendingId) }),
      })
      const json = await res.json() as { ok: boolean; error?: string }
      if (!res.ok || !json.ok) {
        // 서버 재검증 결과 취소 불가 → Modal B로 전환
        cancelModalType = 'B'
        cancelErrorMsg  = json.error ?? '예약신청취소가 불가합니다.'
        return
      }
      cancelPendingId = null
      cancelModalType = null
      await invalidateAll()
    } catch {
      cancelModalType = 'B'
      cancelErrorMsg  = '일시적인 오류가 발생했습니다. 채팅으로 문의해주세요.'
    } finally {
      cancelLoading = false
    }
  }

  function goToCancelChat(): void {
    if (cancelPendingId) openReservationChat(cancelPendingId)
    dismissCancel()
  }
</script>

<div class="page-wrap">

  <SubGnb title="대여" mobileOnly />

  <div class="content">

    <!-- 뒤로가기 — SubGnb가 PC에서는 렌더링되지 않아(mobileOnly) 채팅 대화카드 등으로
         이 화면에 새 탭/직접 진입 시 PC에서 이동 수단이 전혀 없던 문제 방지 -->
    <button type="button" class="btn-back" onclick={() => goto('/account')}>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
        <path d="M7 1L1 7L7 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      마이페이지
    </button>

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

            {#if rental.status === 'hold' || (rental.status === 'confirmed' && !rental.tracking_number)}
              <div class="card-actions">
                {#if rental.status === 'hold'}
                  <button
                    type="button"
                    class="card-actions-btn primary"
                    onclick={() => goto(`/account/rental/${rental.id}`)}
                  >
                    예약신청 확인
                  </button>
                {/if}
                <button
                  type="button"
                  class="card-actions-btn danger"
                  disabled={!rental.canCancel}
                  title={rental.canCancel ? undefined : '방문 수령 6시간 전부터는 취소가 제한됩니다. 채팅으로 문의해주세요.'}
                  onclick={() => openCancelModal(rental)}
                >
                  예약신청 취소
                </button>
              </div>
            {/if}

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

  <BottomTabBar />

  <!-- 이 화면(/account)은 루트 레이아웃에서 FloatingBar가 제외되어 있어, 카드별 채팅
       버튼이 여는 공통 플로팅 채팅 모달(바텀시트)을 이 페이지에서 직접 마운트한다. -->
  <FloatingButton userId={chatUserId} userName={chatUserName} userHandle={chatUserHandle} hideFab />

  {#if cancelModalType}
    <!-- position:fixed 모달 — FloatingButton의 transform 서브트리 밖 형제로 배치돼 뷰포트 기준으로 정확히 렌더링됨 (ui-mobile.md §transform+fixed 충돌 규칙) -->
    <button type="button" class="cancel-modal-backdrop" onclick={dismissCancel} aria-label="닫기"></button>

    {#if cancelModalType === 'A'}
      <!-- Modal A: 취소 가능 — 확인 모달 -->
      <div class="cancel-modal" role="alertdialog" aria-modal="true" aria-label="예약신청취소 확인">
        <div class="cancel-modal-top">
          <div class="cancel-modal-icon" aria-hidden="true">⚠️</div>
          <p class="cancel-modal-title">예약신청을 취소하시겠어요?</p>
          <p class="cancel-modal-sub">취소하면 되돌릴 수 없어요.<br>결제한 경우 전액 환불됩니다.</p>
        </div>
        <div class="cancel-modal-bottom">
          {#if cancelErrorMsg}
            <p class="cancel-modal-error">{cancelErrorMsg}</p>
          {/if}
          <div class="cancel-modal-actions">
            <button
              type="button"
              class="cancel-modal-btn outline"
              onclick={dismissCancel}
              disabled={cancelLoading}
            >
              아니요
            </button>
            <button
              type="button"
              class="cancel-modal-btn red"
              onclick={confirmCancel}
              disabled={cancelLoading}
            >
              {cancelLoading ? '처리 중...' : '네, 취소할게요'}
            </button>
          </div>
        </div>
      </div>
    {:else}
      <!-- Modal B: 취소 불가 — 채팅 문의 안내 -->
      <div class="cancel-modal" role="alertdialog" aria-modal="true" aria-label="예약신청취소 불가 안내">
        <div class="cancel-modal-closerow">
          <button type="button" class="cancel-modal-close" onclick={dismissCancel} aria-label="닫기">✕</button>
        </div>
        <div class="cancel-modal-top cancel-modal-top--info">
          <p class="cancel-modal-title">예약신청 취소가 어렵습니다</p>
          <p class="cancel-modal-sub">
            {cancelErrorMsg ?? '방문 수령 예정 건은 수령 6시간 전부터 취소가 제한됩니다.'}
            <br>채팅으로 문의해주세요.
          </p>
        </div>
        <div class="cancel-modal-bottom cancel-modal-bottom--info">
          <button type="button" class="cancel-modal-chatbtn" onclick={goToCancelChat}>채팅 문의하기</button>
        </div>
      </div>
    {/if}
  {/if}
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

  /* 뒤로가기 — /account/rental/[id]/+page.svelte와 동일 스펙(SubGnb mobileOnly라
     PC에서는 이 버튼이 유일한 이동 수단) */
  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--cs-text-mid);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    min-height: 44px;
    min-width: 44px;
  }
  .btn-back:hover { color: var(--cs-purple); }

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

  /* 예약신청 확인/취소 버튼 (hold 상태 전용) */
  .card-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card-actions-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    min-height: 44px;
    border-radius: var(--radius-xl);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    border: 1.5px solid transparent;
  }
  .card-actions-btn.primary {
    background: var(--cs-purple);
    border-color: var(--cs-purple);
    color: #fff;
  }
  .card-actions-btn.primary:hover  { background: #2d2470; border-color: #2d2470; }
  .card-actions-btn.primary:active { background: #1f1a55; border-color: #1f1a55; }
  .card-actions-btn.danger {
    background: var(--cs-white);
    border-color: var(--cs-red-badge, #FF3535);
    color: var(--cs-red-badge, #FF3535);
  }
  .card-actions-btn.danger:hover  { background: rgba(255,53,53,0.06); }
  .card-actions-btn.danger:active { background: rgba(255,53,53,0.12); }
  .card-actions-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    background: var(--cs-white);
    border-color: #ddd;
    color: #999;
  }
  .card-actions-btn.danger:disabled:hover,
  .card-actions-btn.danger:disabled:active { background: var(--cs-white); }

  /* 예약신청취소 모달 (Figma 기준: --cs-purple-dark top + --cs-dark bottom + --radius-2xl) */
  .cancel-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 300;
    border: none;
    padding: 0;
    cursor: default;
  }
  .cancel-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: clamp(340px, calc(100% - 40px), 605px);
    /* Figma "popup-modal_basic"(node 594:3103) 기준 — 바깥 셸에 10px 패딩을 둬 하단 섹션이
       그 안에서 별도로 라운드 처리되며 살짝 인셋된 "프레임" 형태로 보이도록 함 */
    background: var(--cs-purple-dark, #1d183e);
    padding: 10px;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    z-index: 301;
    display: flex;
    flex-direction: column;
  }
  .cancel-modal-closerow {
    display: flex;
    justify-content: flex-end;
    padding: 2px 10px 0;
  }
  .cancel-modal-top {
    background: var(--cs-purple-dark, #1d183e);
    padding: 32px 28px 28px;
    border-radius: 40px 40px 0 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .cancel-modal-icon {
    font-size: 36px;
    line-height: 1;
  }
  .cancel-modal-title {
    font: var(--text-m-title-21);
    color: #fff;
    margin: 0;
    text-align: center;
    word-break: keep-all;
  }
  .cancel-modal-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.72);
    margin: 0;
    text-align: center;
    line-height: 1.6;
    word-break: keep-all;
  }
  .cancel-modal-bottom {
    background: var(--cs-dark, #100B32);
    padding: 20px 28px 28px;
    border-radius: 0 0 40px 40px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .cancel-modal-error {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-red-badge, #FF3535);
    text-align: center;
    margin: 0;
  }
  .cancel-modal-actions {
    display: flex;
    gap: 10px;
  }
  .cancel-modal-btn {
    flex: 1;
    height: 50px;
    min-height: 44px;
    border-radius: var(--radius-xl);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s, background 0.15s;
  }
  .cancel-modal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .cancel-modal-btn.outline {
    background: rgba(255, 255, 255, 0.10);
    color: rgba(255, 255, 255, 0.80);
    border: 1.5px solid rgba(255, 255, 255, 0.20);
  }
  .cancel-modal-btn.outline:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
  .cancel-modal-btn.red {
    background: var(--cs-red-badge, #FF3535);
    color: #fff;
  }
  .cancel-modal-btn.red:hover:not(:disabled) { background: var(--cs-red, #CF0000); }
  /* Figma "popup-modal_basic"(node 594:3103) 기준 — X는 안내문 섹션 위 별도 행에 배치되는
     44px 터치타겟의 투명 아이콘버튼(원형 hover bg 없음). absolute 오버랩 대신 실제 레이아웃
     흐름에 놓아 라운드 코너 클리핑·겹침 문제 없이 배치 */
  .cancel-modal-close {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.72);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s;
  }
  .cancel-modal-close:hover { color: #fff; }
  /* Figma 기준 안내문/하단 섹션 상하 여백(40px/20px, 40px/15px) */
  /* 모바일 실사용 너비(약 340px 하한)에 맞춘 비율 축소 — PC(605px 기준 40px)와 동일 비율(약 6.6%)로 환산 */
  .cancel-modal-top--info { padding: 20px 24px; }
  .cancel-modal-bottom--info { padding: 15px 24px; }
  .cancel-modal-chatbtn {
    align-self: center;
    padding: 4px;
    border: none;
    background: none;
    color: rgba(255, 255, 255, 0.80);
    font: var(--text-m-body-16B);
    cursor: pointer;
    transition: color 0.15s;
  }
  .cancel-modal-chatbtn:hover { color: #fff; }

  @media (min-width: 768px) {
    .content {
      padding: 100px 40px 60px;
      max-width: 720px;
    }
  }
</style>
