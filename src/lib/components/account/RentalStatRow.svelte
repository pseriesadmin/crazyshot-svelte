<script lang="ts">
  // DB 매핑: +page.server.ts → rentalStats → 부모(account/+page.svelte)에서 변환 후 주입
  // StatItem.count 소스:
  //   대여중   ← rentalStats.active    (rental_reservations.status IN ('confirmed','active'))
  //   배송중   ← rentalStats.shipping  (rental_reservations.status = 'shipping')
  //   대여종료 ← rentalStats.completed (rental_reservations.status = 'completed')
  //   취소·반품 ← rentalStats.cancelled (rental_reservations.status IN ('cancelled','returned'))
  interface StatItem {
    label: string
    count: number
  }

  interface Props {
    stats?: StatItem[]
  }

  let { stats = [
    { label: '대여중',    count: 0 }, // rentalStats.active
    { label: '배송중',    count: 0 }, // rentalStats.shipping
    { label: '대여종료',  count: 0 }, // rentalStats.completed
    { label: '취소·반품', count: 0 }, // rentalStats.cancelled
  ] }: Props = $props()
</script>

<div class="flex gap-[10px] items-start relative shrink-0 w-full">
  {#each stats as item}
    <div class="bg-[#e1def3] flex-[1_0_0] min-w-px relative rounded-[20px]">
      <div class="flex flex-row items-center justify-center size-full">
        <div class="flex items-center justify-center px-[20px] py-[10px] relative size-full">
          <div class="flex flex-col gap-[10px] items-center justify-center relative shrink-0">
            <div class="flex flex-col font-['Noto_Sans_KR',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#666] text-[14px] tracking-[-0.5px] whitespace-nowrap">
              <p class="leading-[1.6]">{item.label}</p>
            </div>
            <div class="bg-[#ecebf4] flex flex-col items-center justify-center relative rounded-[15px] shrink-0 size-[45px]">
              <div class="flex flex-col font-['Noto_Sans_KR',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#100b32] text-[18px] tracking-[-0.3px] whitespace-nowrap">
                <p class="leading-[1.6]">{item.count}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/each}
</div>
