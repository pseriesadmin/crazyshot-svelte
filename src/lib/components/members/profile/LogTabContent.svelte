<script lang="ts">
  interface LogItem {
    date: string
    title: string
    status: string
    duration: string
  }

  const logs: LogItem[] = [
    { date: '2024.03.15', title: '스타벅스 텀블러 500ml', status: '반납완료', duration: '3일' },
    { date: '2024.02.28', title: '나이키 캐리어 28인치',  status: '반납완료', duration: '7일' },
    { date: '2024.01.10', title: '소니 미러리스 카메라',   status: '반납완료', duration: '2일' },
  ]
</script>

<div class="flex flex-col gap-[10px] w-full">
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

      {#each logs as log}
        <div class="bg-[#f6f6f6] rounded-[20px] px-[20px] py-[15px] flex items-center justify-between">
          <div class="flex flex-col gap-[6px]">
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">
              {log.date}
            </p>
            <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[14px] text-[#100b32] tracking-[-0.5px] leading-[1.6]">
              {log.title}
            </p>
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#444] tracking-[-0.5px] leading-[1.6]">
              {log.duration} 대여
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
