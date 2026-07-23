<script lang="ts">
  interface ReviewItem {
    date: string
    item: string
    rating: number
    content: string
  }

  const reviews: ReviewItem[] = [
    {
      date: '2024.03.16',
      item: '스타벅스 텀블러 500ml',
      rating: 5,
      content: '상태가 깨끗하고 사용하기 편했어요. 다음에도 이용하고 싶습니다.',
    },
    {
      date: '2024.02.29',
      item: '나이키 캐리어 28인치',
      rating: 4,
      content: '바퀴가 약간 소음이 있지만 전반적으로 만족스러웠습니다.',
    },
  ]
</script>

<div class="flex flex-col gap-[10px] w-full">
  <div class="bg-white rounded-tl-[30px] rounded-tr-[30px] w-full">
    <div class="flex flex-col gap-[20px] px-[25px] py-[40px]">

      <div class="flex flex-col gap-[10px]">
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[16px] text-[#444] tracking-[-0.5px] leading-[1.6]">
          후기·댓글
        </p>
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
          내가 작성한 후기와 댓글
        </p>
      </div>

      {#each reviews as r}
        <div class="bg-[#f6f6f6] rounded-[20px] px-[20px] py-[15px] flex flex-col gap-[10px]">
          <div class="flex items-center justify-between">
            <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[13px] text-[#100b32] tracking-[-0.5px] leading-[1.6]">
              {r.item}
            </p>
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
              {r.date}
            </p>
          </div>
          <div class="flex gap-[2px]">
            {#each Array.from({ length: 5 }, (_, i) => i) as idx}
              <span class="text-[14px]" class:text-star-on={idx < r.rating} class:text-star-off={idx >= r.rating}>★</span>
            {/each}
          </div>
          <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[13px] text-[#444] tracking-[-0.5px] leading-[1.6]">
            {r.content}
          </p>
        </div>
      {/each}

    </div>
  </div>
</div>

<style>
  .text-star-on { color: #FFE500; }
  .text-star-off { color: #ddd; }
</style>
