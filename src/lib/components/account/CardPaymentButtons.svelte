<script lang="ts">
  // 마이페이지 대여·취소 카드 — 예약번호 오른쪽 '카드영수증 보기' / '카드 취소내역 보기' (2026-10-26)
  //  - 영수증: 토스 카드 매출전표 주소를 새 창으로 연다(서버가 허용 도메인만 내려줌)
  //  - 취소내역: 클릭 시 /api/account/payments/cancel-detail 조회 → 앱 안 상세창(승인취소·시점·환불 금액·사유) + 매출전표 링크
  //  - 부분취소: payment.partial 이면 '부분취소' 칩 + 취소내역 버튼 활성(현재 부분취소 실행 경로가 없어 표시 장치만 준비)
  import { onMount } from 'svelte'

  interface Payment {
    receiptUrl: string | null
    cancelled: boolean
    partial: boolean
    cancelDetail: boolean
  }
  interface CancelDetail {
    status: string
    cancelledAt: string | null
    cancelAmount: number | null
    balanceAmount: number | null
    receiptUrl: string | null
    source: 'toss' | 'db'
  }

  interface Props {
    reservationId: string | number
    payment: Payment | null | undefined
    /** 'rental' = 대여 탭(영수증 + 부분취소 시 취소내역), 'cancel' = 취소 탭(취소내역만) */
    mode: 'rental' | 'cancel'
    /** 고객이 취소를 요청했고 환불 완료 전인 카드 — 취소내역 버튼을 비활성으로 보여준다 */
    cancelling?: boolean
  }
  let { reservationId, payment, mode, cancelling = false }: Props = $props()

  const showReceipt = $derived(mode === 'rental' && !!payment?.receiptUrl)
  const showCancel = $derived(!!payment?.cancelDetail)
  // 취소중(환불 승인 전): 결제는 있는데 아직 취소내역을 가져올 수 없음 → 비활성 버튼
  const pendingCancel = $derived(mode === 'rental' && cancelling && !!payment && !payment.cancelDetail)

  function openReceipt(url: string | null | undefined): void {
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  let open = $state(false)
  let loading = $state(false)
  let errorMsg = $state<string | null>(null)
  let detail = $state<CancelDetail | null>(null)

  async function openCancelDetail(): Promise<void> {
    open = true
    loading = true
    errorMsg = null
    detail = null
    try {
      const res = await fetch(`/api/account/payments/cancel-detail?reservationId=${encodeURIComponent(String(reservationId))}`)
      const json = await res.json().catch(() => null) as { ok?: boolean; detail?: CancelDetail; error?: string } | null
      if (!res.ok || !json?.ok || !json.detail) {
        errorMsg = json?.error ?? '취소 내역을 불러오지 못했어요. 잠시 후 다시 시도해주세요.'
      } else {
        detail = json.detail
      }
    } catch {
      errorMsg = '일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.'
    } finally {
      loading = false
    }
  }

  function close(): void {
    open = false
  }

  function onKeydown(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') close()
  }

  // 모달을 body 로 옮긴다 — 카드·패널의 transform/overflow 영향 없이 화면 전체 기준으로 표시
  function portal(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }

  function formatAt(iso: string | null): string {
    if (!iso) return '-'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '-'
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d).replace(/\. /g, '-').replace(/-(\d{2}):/, ' $1:').replace(/\.$/, '')
  }
  const won = (n: number | null): string => (n == null ? '-' : `${n.toLocaleString('ko-KR')}원`)

  onMount(() => {
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  })
</script>

{#if showReceipt || showCancel || pendingCancel || payment?.partial}
  <div class="pay-btns">
    {#if showReceipt}
      <button type="button" class="pay-btn" onclick={() => openReceipt(payment?.receiptUrl)}>카드영수증 보기</button>
    {/if}
    {#if payment?.partial}
      <span class="pay-chip">부분취소</span>
    {/if}
    {#if showCancel}
      <button type="button" class="pay-btn" onclick={openCancelDetail}>카드 취소내역 보기</button>
    {:else if pendingCancel}
      <button type="button" class="pay-btn" disabled aria-disabled="true" title="환불이 완료되면 확인할 수 있어요">카드 취소내역 보기</button>
    {/if}
  </div>
{/if}

{#if open}
  <div use:portal>
    <button type="button" class="cd-backdrop" onclick={close} aria-label="닫기"></button>
    <div class="cd-modal" role="dialog" aria-modal="true" aria-label="카드 취소내역">
      <div class="cd-head">
        <p class="cd-title">카드 취소내역</p>
        <button type="button" class="cd-close" onclick={close} aria-label="닫기">✕</button>
      </div>
      {#if loading}
        <p class="cd-msg" role="status">불러오는 중...</p>
      {:else if errorMsg}
        <p class="cd-msg cd-msg--error" role="alert">{errorMsg}</p>
      {:else if detail}
        <dl class="cd-list">
          <div class="cd-row"><dt>취소 상태</dt><dd>{detail.status}</dd></div>
          <div class="cd-row"><dt>취소 시점</dt><dd>{formatAt(detail.cancelledAt)}</dd></div>
          <div class="cd-row"><dt>환불 금액</dt><dd>{won(detail.cancelAmount)}</dd></div>
          {#if detail.status === '부분취소'}
            <div class="cd-row"><dt>남은 결제 금액</dt><dd>{won(detail.balanceAmount)}</dd></div>
          {/if}
        </dl>
        {#if detail.receiptUrl}
          <button type="button" class="cd-link" onclick={() => openReceipt(detail?.receiptUrl)}>카드 매출전표 보기</button>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .pay-btns {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  /* 면 버튼 — 테두리·그림자 없음, 호버는 배경색만(front-uiux 버튼 원칙). 시각 32px, 터치 영역은 ::before 로 44px 확보 */
  .pay-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0 12px;
    border: none;
    border-radius: var(--radius-xl);
    background: var(--cs-lilac);
    color: var(--cs-purple);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .pay-btn::before {
    content: '';
    position: absolute;
    inset: -6px -2px;
  }
  .pay-btn:hover:not(:disabled) { background: var(--cs-purple); color: var(--cs-white); }
  /* 취소중(환불 완료 전) 비활성 — 배경만 옅게, 호버 변화 없음 */
  .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .pay-chip {
    display: inline-flex;
    align-items: center;
    padding: 3px 12px;
    border-radius: var(--radius-xl);
    background: rgba(255, 69, 0, 0.12);
    color: #ff4500;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .cd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 600;
    border: none;
    background: rgba(16, 11, 50, 0.5);
    cursor: default;
  }
  .cd-modal {
    position: fixed;
    z-index: 601;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(360px, calc(100vw - 40px));
    max-height: calc(100vh - 40px);
    overflow-y: auto;
    padding: 20px;
    border-radius: var(--radius-xl);
    background: var(--cs-white);
    color: var(--cs-text);
    font-family: 'Noto Sans KR', sans-serif;
  }
  .cd-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .cd-title { margin: 0; font-size: 16px; font-weight: 700; }
  .cd-close {
    width: 44px;
    height: 44px;
    margin: -8px -8px -8px 0;
    border: none;
    background: transparent;
    color: var(--cs-text-mid);
    font-size: 16px;
    cursor: pointer;
  }
  .cd-close:hover { color: var(--cs-red-badge); }
  .cd-msg { margin: 8px 0 12px; font-size: 14px; color: var(--cs-text-mid); }
  .cd-msg--error { color: var(--cs-red-badge); }
  .cd-list { margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .cd-row { display: flex; justify-content: space-between; gap: 16px; font-size: 14px; }
  .cd-row dt { margin: 0; color: var(--cs-text-mid); white-space: nowrap; }
  .cd-row dd { margin: 0; font-weight: 700; text-align: right; word-break: keep-all; }
  .cd-link {
    width: 100%;
    height: 44px;
    margin-top: 16px;
    border: none;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    color: var(--cs-white);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }
  .cd-link:hover { background: var(--cs-purple-hover); }
</style>
