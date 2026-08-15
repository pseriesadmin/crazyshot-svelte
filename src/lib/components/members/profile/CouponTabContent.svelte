<script lang="ts">
  import type { UserCouponCard } from '$lib/server/account/loadUserCoupons'

  interface Props {
    coupons: UserCouponCard[]
  }

  let { coupons }: Props = $props()

  function formatValidUntil(iso: string | null): string {
    if (!iso) return '상시'
    const d = new Date(iso)
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}까지`
  }
</script>

<div class="flex flex-col gap-[10px] w-full">
  <div class="bg-white rounded-tl-[30px] rounded-tr-[30px] w-full">
    <div class="flex flex-col gap-[20px] px-[25px] py-[40px]">

      <div class="flex flex-col gap-[10px]">
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[16px] text-[#444] tracking-[-0.5px] leading-[1.6]">
          쿠폰
        </p>
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
          나의 보유 쿠폰
        </p>
      </div>

      {#each coupons as coupon}
        <div class="bg-[#f6f6f6] rounded-[20px] px-[20px] py-[15px] flex items-center justify-between">
          <div class="flex flex-col gap-[6px]">
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
              {formatValidUntil(coupon.validUntil)}
            </p>
            <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[14px] text-[#100b32] tracking-[-0.5px] leading-[1.6]">
              {coupon.label}
            </p>
            {#if coupon.minPurchaseAmount > 0}
              <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#444] tracking-[-0.5px] leading-[1.6]">
                {coupon.minPurchaseAmount.toLocaleString('ko-KR')}원 이상 구매 시
              </p>
            {/if}
          </div>
          <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#444] bg-white rounded-[20px] px-[12px] py-[6px] tracking-[-0.5px] shrink-0">
            {coupon.statusLabel}
          </span>
        </div>
      {:else}
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[13px] text-[#aaa] tracking-[-0.3px] leading-[1.6] py-[10px]">
          보유한 쿠폰이 없습니다.
        </p>
      {/each}

    </div>
  </div>
</div>
