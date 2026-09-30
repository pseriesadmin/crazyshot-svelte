<script lang="ts">
  import type { MyLogItem } from '$lib/server/account/loadMyActivity'

  interface Props { logs?: MyLogItem[] }
  let { logs = [] }: Props = $props()
</script>

<div class="flex flex-col gap-[10px] w-full md:max-w-[640px] md:mx-auto">
  <div class="bg-white rounded-tl-[30px] rounded-tr-[30px] w-full">
    <div class="flex flex-col gap-[20px] px-[25px] py-[40px]">

      <div class="flex flex-col gap-[10px]">
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[16px] text-[#444] tracking-[-0.5px] leading-[1.6]">
          로그
        </p>
        <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
          나의 대여 이용 내역
        </p>
      </div>

      {#if logs.length === 0}
        <p class="bg-[var(--cs-surface-gray)] rounded-[20px] px-[20px] py-[20px] text-center font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[var(--cs-text-light)] tracking-[-0.5px] leading-[1.6]">
          아직 대여 이용 내역이 없어요
        </p>
      {/if}
      {#each logs as log (log.id)}
        <div class="bg-[#f6f6f6] rounded-[20px] px-[20px] py-[15px] flex items-center justify-between">
          <div class="flex flex-col gap-[6px]">
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
              {log.date}
            </p>
            <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[14px] text-[#100b32] tracking-[-0.5px] leading-[1.6]">
              {log.title}
            </p>
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#444] tracking-[-0.5px] leading-[1.6]">
              {#if log.duration}{log.duration} 대여{/if}
            </p>
          </div>
          <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#444] bg-white rounded-[20px] px-[12px] py-[6px] tracking-[-0.5px] shrink-0">
            {log.status}
          </span>
        </div>
      {/each}

    </div>
  </div>
</div>
