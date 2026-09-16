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

<div class="stat-row relative shrink-0 w-full">
  {#each stats as item}
    <div class="stat-item bg-[#e1def3] relative rounded-[20px]">
      <div class="flex flex-row items-center justify-center size-full">
        <div class="flex items-center justify-center px-[20px] py-[10px] relative size-full">
          <div class="stat-body flex gap-[10px] items-center justify-center relative shrink-0">
            <div class="flex flex-col font-['Noto_Sans_KR',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#666] text-[14px] tracking-[-0.5px] whitespace-nowrap">
              <p class="leading-[1.6]">{item.label}</p>
            </div>
            <div class="stat-count-box bg-[#ecebf4] flex flex-col items-center justify-center relative rounded-[15px] shrink-0 h-[45px]">
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

<style>
  /* 모바일 기본: 2×2 그리드 + 여유로운 간격(기존 flex-row 10px보다 넓게) */
  .stat-row {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 15px;
  }
  .stat-item {
    min-width: 0;
  }

  /* 모바일: 레이블·숫자를 좌우 병렬로 배치(기존 상하 배치 대체) */
  /* 모바일: 숫자 박스를 카드 우측 끝에 고정 배치(기존엔 그룹 전체가 중앙정렬만 되어 비고정) */
  .stat-body {
    flex-direction: row;
    width: 100%;
    justify-content: space-between;
  }

  /* 모바일: 숫자 카운팅 박스 가로폭 2배(45px → 90px) 고정 */
  .stat-count-box {
    width: 90px;
  }

  /* PC(≥768px, account/+page.svelte pc-layout 실제 기준)에서는 기존 배열 그대로 유지 */
  @media (min-width: 768px) {
    .stat-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .stat-item {
      flex: 1 0 0;
      min-width: 1px;
    }
    .stat-body {
      flex-direction: column;
      width: auto;
      justify-content: center;
    }
    /* PC도 숫자 카운팅 박스 가로폭 2배(45px → 90px) 고정 */
    .stat-count-box {
      width: 90px;
    }
  }
</style>
