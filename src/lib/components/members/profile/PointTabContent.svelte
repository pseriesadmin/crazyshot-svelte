<script lang="ts">
  import type { PointTransactionCard } from '$lib/server/account/loadPointTransactions'

  interface Props {
    /** 보유 포인트(user_profiles.points) */
    points: number
    /** 적립·사용 내역(최신순) */
    transactions: PointTransactionCard[]
  }

  let { points, transactions }: Props = $props()

  // 적립 사유(ref_type) → 고객용 이름. 없으면 type 기본 이름, 설명(description)이 있으면 그 문장을 우선 노출
  const REF_LABEL: Record<string, string> = {
    return_register_mission: '반납등록 미션 적립',
    rental_complete: '대여 완료 적립',
    rental_complete_sub_bonus: '구독 보너스 적립',
    on_time_return: '정시 반납 적립',
    birthday: '생일 선물 포인트',
    order: '예약 결제 시 사용',
  }
  const TYPE_LABEL: Record<string, string> = {
    earn: '포인트 적립',
    use: '포인트 사용',
    expire: '포인트 소멸',
    admin_grant: '포인트 지급',
    admin_deduct: '포인트 차감',
    refund: '포인트 환불',
  }

  function titleOf(tx: PointTransactionCard): string {
    return tx.description?.trim() || (tx.refType && REF_LABEL[tx.refType]) || TYPE_LABEL[tx.type] || '포인트 변동'
  }
  function formatDate(iso: string): string {
    const d = new Date(iso)
    const kst = new Date(d.getTime() + 9 * 3600 * 1000)
    return `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, '0')}.${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`
  }
  function formatAmount(n: number): string {
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ko-KR')}`
  }
</script>

<div class="flex flex-col gap-[10px] w-full md:max-w-[640px] md:mx-auto">
  <div class="bg-white rounded-tl-[30px] rounded-tr-[30px] w-full">
    <div class="flex flex-col gap-[20px] px-[25px] py-[40px]">

      <div class="flex flex-col gap-[10px]">
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[16px] text-[#444] tracking-[-0.5px] leading-[1.6]">
          포인트
        </p>
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
          나의 보유 포인트와 적립·사용 내역
        </p>
      </div>

      <!-- 보유 포인트 -->
      <div class="balance-card" role="status" aria-label="보유 포인트">
        <p class="balance-label">보유 포인트</p>
        <p class="balance-value"><span class="balance-num">{points.toLocaleString('ko-KR')}</span><span class="balance-unit">point</span></p>
      </div>

      <!-- 포인트 누적 내역 -->
      <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[14px] text-[#444] tracking-[-0.5px] leading-[1.6] mt-[4px]">
        포인트 내역
      </p>
      {#each transactions as tx (tx.id)}
        <div class="bg-[#f6f6f6] rounded-[20px] px-[20px] py-[15px] flex items-center justify-between gap-[12px]">
          <div class="flex flex-col gap-[4px] min-w-0">
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
              {formatDate(tx.createdAt)}
            </p>
            <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[14px] text-[#100b32] tracking-[-0.5px] leading-[1.6]">
              {titleOf(tx)}
            </p>
            {#if tx.expiresAt && tx.amount > 0}
              <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#444] tracking-[-0.5px] leading-[1.6]">
                {formatDate(tx.expiresAt).slice(0, 10)}까지 사용 가능
              </p>
            {/if}
          </div>
          <div class="flex flex-col items-end gap-[2px] shrink-0">
            <span class="amount" class:plus={tx.amount > 0}>{formatAmount(tx.amount)}</span>
            <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px]">
              잔액 {tx.balanceAfter.toLocaleString('ko-KR')}
            </span>
          </div>
        </div>
      {:else}
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[13px] text-[#aaa] tracking-[-0.3px] leading-[1.6] py-[10px]">
          포인트 내역이 없습니다.
        </p>
      {/each}

    </div>
  </div>
</div>

<style>
  .balance-card {
    background: var(--cs-lilac, #ecebf4);
    border-radius: var(--radius-lg, 20px);
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .balance-label { font: var(--text-m-script-14B); color: var(--cs-text-mid, #666); margin: 0; }
  .balance-value { margin: 0; display: flex; align-items: baseline; gap: 8px; }
  .balance-num { font: var(--text-m-htitle-24B); color: var(--cs-purple, #3b2f8a); line-height: 1.2; }
  .balance-unit { font: var(--text-m-body-16B); color: var(--cs-purple, #3b2f8a); }
  .amount { font: var(--text-m-body-16B); color: var(--cs-text-mid, #666); }
  .amount.plus { color: var(--cs-purple, #3b2f8a); }
</style>
