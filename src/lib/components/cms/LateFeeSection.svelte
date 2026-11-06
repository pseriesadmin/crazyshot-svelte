<script lang="ts">
  // 예약 상세 패널 '결제정보' 탭 — 연체료 목록 + 관리자 [결제 확인] (2026-11-02, Stephen 지시)
  // 연체료는 매일 KST 00:00 자동 감지로 생기고, 고객 결제가 아닌 현장·계좌이체 등은 여기서 매니저 이상이 결제 완료로 확인한다.
  // 확인하면 고객에게 채팅 대화카드 + 푸시 + 문자가 나간다(서버 /api/cms/reservations/[id]/late-fees).
  // 연체료가 없는 예약에서는 아무것도 그리지 않는다.
  import { onMount } from 'svelte'
  import { csToast } from '$lib/utils/toast'

  interface LateFee {
    id: string
    hours_late: number
    fee_amount: number
    is_paid: boolean
    paid_at: string | null
    created_at: string
    confirmed_by_admin: boolean
  }

  interface Props {
    reservationId: number
    /** 결제 확인 권한(매니저 이상) */
    canConfirm: boolean
  }

  let { reservationId, canConfirm }: Props = $props()

  let lateFees = $state<LateFee[]>([])
  let confirmingId = $state<string | null>(null)

  async function load(): Promise<void> {
    try {
      const res = await fetch(`/api/cms/reservations/${reservationId}/late-fees`)
      if (!res.ok) return
      const body = (await res.json()) as { lateFees?: LateFee[] }
      lateFees = body.lateFees ?? []
    } catch {
      lateFees = []
    }
  }

  onMount(() => {
    void load()
  })

  function won(n: number): string {
    return `${n.toLocaleString('ko-KR')}원`
  }

  // 시각은 KST 고정 표기
  function kst(iso: string | null): string {
    if (!iso) return ''
    const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  }

  async function confirmPaid(fee: LateFee): Promise<void> {
    if (confirmingId) return
    if (!window.confirm(`연체료 ${won(fee.fee_amount)}을 결제 완료로 확인할까요? 고객에게 결제 완료 안내(채팅카드·푸시·문자)가 발송됩니다.`)) return
    confirmingId = fee.id
    try {
      const res = await fetch(`/api/cms/reservations/${reservationId}/late-fees`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ late_fee_id: fee.id }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        csToast.error(body.error ?? '결제 확인에 실패했습니다.')
        return
      }
      csToast.success('연체료 결제를 확인했습니다. 고객에게 안내가 발송됩니다.')
      await load()
    } catch {
      csToast.error('결제 확인에 실패했습니다.')
    } finally {
      confirmingId = null
    }
  }
</script>

{#if lateFees.length > 0}
  <div class="lf-title">연체료</div>
  <div class="lf-section">
    {#each lateFees as fee (fee.id)}
      <div class="lf-row">
        <div class="lf-main">
          <span class="lf-amount">{won(fee.fee_amount)}</span>
          <span class="lf-sub">{fee.hours_late}시간 연체 · {kst(fee.created_at)} 감지</span>
        </div>
        {#if fee.is_paid}
          <span class="lf-state">결제완료 · {kst(fee.paid_at)} · {fee.confirmed_by_admin ? '관리자 확인' : '고객 결제'}</span>
        {:else}
          <span class="lf-state lf-state--unpaid">미납</span>
          {#if canConfirm}
            <button type="button" class="lf-btn" disabled={confirmingId !== null} onclick={() => confirmPaid(fee)}>결제 확인</button>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .lf-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    padding: 4px 0 2px;
  }

  .lf-section {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }

  .lf-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
  }

  .lf-row:last-child {
    border-bottom: none;
  }

  .lf-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .lf-amount {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }

  .lf-sub {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .lf-state {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .lf-state--unpaid {
    font-weight: 700;
    color: var(--cs-red-badge);
  }

  /* cms-uiux.md §0-10-F — DetailPanel 실행 버튼(소형) */
  .lf-btn {
    min-width: 78px;
    text-align: center;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.4;
    padding: 8px 14px;
    border: 1px solid var(--cs-text-mid);
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }

  .lf-btn:hover:not(:disabled) {
    background: var(--cs-text-mid);
    color: var(--cs-white);
  }

  .lf-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
