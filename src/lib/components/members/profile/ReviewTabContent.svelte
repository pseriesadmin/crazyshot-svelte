<script lang="ts">
  import type { MyReviewItem, MyCommentItem } from '$lib/server/account/loadMyActivity'

  interface Props { reviews?: MyReviewItem[]; comments?: MyCommentItem[] }
  let { reviews = [], comments = [] }: Props = $props()
</script>

<div class="flex flex-col gap-[10px] w-full md:max-w-[640px] md:mx-auto">
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

      {#if reviews.length === 0 && comments.length === 0}
        <p class="bg-[var(--cs-surface-gray)] rounded-[20px] px-[20px] py-[20px] text-center font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[var(--cs-text-light)] tracking-[-0.5px] leading-[1.6]">
          아직 작성한 후기·댓글이 없어요
        </p>
      {/if}

      {#each reviews as r (r.id)}
        <div class="bg-[#f6f6f6] rounded-[20px] px-[20px] py-[15px] flex flex-col gap-[10px]">
          <div class="flex items-center justify-between">
            <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[13px] text-[#100b32] tracking-[-0.5px] leading-[1.6]">
              {r.item}
            </p>
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
              {r.date}
            </p>
          </div>
          {#if r.title}
            <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[13px] text-[var(--cs-text-dark)] tracking-[-0.5px] leading-[1.6]">
              {r.title}
            </p>
          {/if}
          <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[13px] text-[#444] tracking-[-0.5px] leading-[1.6]">
            {r.content}
          </p>
        </div>
      {/each}

      {#each comments as c (c.id)}
        <div class="bg-[var(--cs-surface-gray)] rounded-[20px] px-[20px] py-[15px] flex flex-col gap-[10px]">
          <div class="flex items-center justify-between">
            <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[13px] text-[var(--cs-text)] tracking-[-0.5px] leading-[1.6]">
              {c.postTitle}
            </p>
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[var(--cs-text-light)] tracking-[-0.5px] leading-[1.6]">
              {c.date}
            </p>
          </div>
          <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[13px] text-[var(--cs-text-dark)] tracking-[-0.5px] leading-[1.6]">
            {c.content}
          </p>
        </div>
      {/each}

    </div>
  </div>
</div>
