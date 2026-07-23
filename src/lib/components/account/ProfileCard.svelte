<script lang="ts">
  interface Props {
    userName?: string
    benefitCount?: number
  }

  let { userName = '스티브 꽁지', benefitCount = 3 }: Props = $props()

  const writingPath = 'M22.9985 1L1 13.6663L6.47363 25.9984L25.0278 15.7259V1H22.9985ZM5.02791 23.9987L2.00012 13.6663L5.02791 23.9987Z'
  const qrPaths = {
    p1: 'M3 3H9V9H3V3ZM0 0V12H12V0H0Z',
    p2: 'M15 3H21V9H15V3ZM12 0V12H24V0H12Z',
    p3: 'M6 6H6V6H6V6Z',
    p4: 'M3 15H9V21H3V15ZM0 12V24H12V12H0Z',
    p5: 'M18 18H24V24H18V18ZM15 15V27H27V15H15Z',
    p6: 'M18 12H24V15H21V18H18V12Z',
  }
</script>

<div class="bg-[#f6f6f6] relative rounded-[30px] shrink-0 w-full">
  <div class="flex flex-row items-center justify-center size-full">
    <div class="flex items-center justify-between px-[25px] py-[20px] relative size-full">
      <div class="flex flex-col gap-[5px] items-start justify-center relative flex-1 min-w-0 pr-[16px]">
        <div class="flex flex-col justify-center relative shrink-0 w-full" style="font: var(--text-m-htitle-24B); color: var(--cs-text); letter-spacing: -0.3px;">
          <p>{userName}님,</p>
        </div>
        <div class="flex flex-col justify-center relative shrink-0 w-full" style="font: var(--text-m-body-16L); color: var(--cs-text-mid); letter-spacing: -0.5px;">
          <p class="whitespace-pre-wrap">
            지금 <span style="font-weight: 700; color: var(--cs-purple);">{benefitCount} </span>가지 혜택·이벤트 확인요망
          </p>
        </div>
      </div>
      <div class="bg-[#553fe0] flex flex-col gap-[10px] items-center justify-center relative rounded-[25px] shrink-0 size-[70px]">
        <!-- writing icon -->
        <!-- QR icon -->
        <div class="flex flex-col gap-[5px] items-center justify-center shrink-0">
          <div class="relative shrink-0 size-[27px]">
            <svg class="absolute block inset-0 size-full" fill="none" viewBox="0 0 27 27" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M4.275 2.7C3.44558 2.7 2.7 3.44558 2.7 4.275V5.85C2.7 6.59558 2.09558 7.2 1.35 7.2C0.604416 7.2 0 6.59558 0 5.85V4.275C0 1.95442 1.95442 0 4.275 0H5.85C6.59558 0 7.2 0.604416 7.2 1.35C7.2 2.09558 6.59558 2.7 5.85 2.7H4.275ZM19.8 1.35C19.8 0.604416 20.4044 0 21.15 0H22.725C25.0456 0 27 1.95442 27 4.275V5.85C27 6.59558 26.3956 7.2 25.65 7.2C24.9044 7.2 24.3 6.59558 24.3 5.85V4.275C24.3 3.44558 23.5544 2.7 22.725 2.7H21.15C20.4044 2.7 19.8 2.09558 19.8 1.35ZM1.35 19.8C2.09558 19.8 2.7 20.4044 2.7 21.15V22.725C2.7 23.5544 3.44558 24.3 4.275 24.3H5.85C6.59558 24.3 7.2 24.9044 7.2 25.65C7.2 26.3956 6.59558 27 5.85 27H4.275C1.95442 27 0 25.0456 0 22.725V21.15C0 20.4044 0.604416 19.8 1.35 19.8ZM25.65 19.8C26.3956 19.8 27 20.4044 27 21.15V22.725C27 25.0456 25.0456 27 22.725 27H21.15C20.4044 27 19.8 26.3956 19.8 25.65C19.8 24.9044 20.4044 24.3 21.15 24.3H22.725C23.5544 24.3 24.3 23.5544 24.3 22.725V21.15C24.3 20.4044 24.9044 19.8 25.65 19.8Z" fill="white"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M16.2382 16.3439C16.2194 16.4003 16.2 16.4973 16.2 16.65L16.2 17.5592L18.9 17.55C19.4887 17.55 20.0955 17.6978 20.5488 18.1509C21.0021 18.604 21.15 19.2107 21.15 19.7992V20.25C21.15 20.7471 20.7471 21.15 20.25 21.15C19.7529 21.15 19.35 20.7471 19.35 20.25V19.7992C19.35 19.6468 19.3306 19.55 19.3119 19.4938C19.2947 19.4424 19.2791 19.4267 19.2763 19.424C19.2736 19.4213 19.2577 19.4054 19.2061 19.3882C19.1497 19.3694 19.0527 19.35 18.9 19.35L16.2 19.3592V20.2592C16.2 20.7562 15.7971 21.1592 15.3 21.1592C14.8029 21.1592 14.4 20.7562 14.4 20.2592L14.4 16.65C14.4 16.0613 14.5478 15.4545 15.0009 15.0012C15.454 14.5479 16.0607 14.4 16.6492 14.4H16.6538H18.9046C19.4016 14.4025 19.8025 14.8075 19.8 15.3046C19.7975 15.8016 19.3925 16.2025 18.8954 16.2L16.6472 16.2C16.4959 16.2002 16.3998 16.2195 16.3438 16.2381C16.2924 16.2553 16.2768 16.2709 16.274 16.2737C16.2713 16.2764 16.2554 16.2923 16.2382 16.3439Z" fill="white"/>
              <path d="M7.65 8.1C7.65 7.85147 7.85147 7.65 8.1 7.65H10.35C10.5985 7.65 10.8 7.85147 10.8 8.1V10.35C10.8 10.5985 10.5985 10.8 10.35 10.8H8.1C7.85147 10.8 7.65 10.5985 7.65 10.35V8.1Z" fill="white"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M8.1 5.85H10.35C11.5926 5.85 12.6 6.85736 12.6 8.1V10.35C12.6 11.5926 11.5926 12.6 10.35 12.6H8.1C6.85736 12.6 5.85 11.5926 5.85 10.35V8.1C5.85 6.85736 6.85736 5.85 8.1 5.85ZM8.1 7.65C7.85147 7.65 7.65 7.85147 7.65 8.1V10.35C7.65 10.5985 7.85147 10.8 8.1 10.8H10.35C10.5985 10.8 10.8 10.5985 10.8 10.35V8.1C10.8 7.85147 10.5985 7.65 10.35 7.65H8.1Z" fill="white"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M16.65 5.85H18.9C20.1426 5.85 21.15 6.85736 21.15 8.1V10.35C21.15 11.5926 20.1426 12.6 18.9 12.6H16.65C15.4074 12.6 14.4 11.5926 14.4 10.35V8.1C14.4 6.85736 15.4074 5.85 16.65 5.85ZM16.65 7.65C16.4015 7.65 16.2 7.85147 16.2 8.1V10.35C16.2 10.5985 16.4015 10.8 16.65 10.8H18.9C19.1485 10.8 19.35 10.5985 19.35 10.35V8.1C19.35 7.85147 19.1485 7.65 18.9 7.65H16.65Z" fill="white"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M8.1 14.4H10.35C11.5926 14.4 12.6 15.4074 12.6 16.65V18.9C12.6 20.1426 11.5926 21.15 10.35 21.15H8.1C6.85736 21.15 5.85 20.1426 5.85 18.9V16.65C5.85 15.4074 6.85736 14.4 8.1 14.4ZM8.1 16.2C7.85147 16.2 7.65 16.4015 7.65 16.65V18.9C7.65 19.1485 7.85147 19.35 8.1 19.35H10.35C10.5985 19.35 10.8 19.1485 10.8 18.9V16.65C10.8 16.4015 10.5985 16.2 10.35 16.2H8.1Z" fill="white"/>
            </svg>
          </div>
          <p class="font-['Noto_Sans_KR',sans-serif] font-medium leading-[1.6] relative shrink-0 text-[12px] text-[#ffffff] tracking-[-0.5px] whitespace-nowrap">QR체크</p>
        </div>
      </div>
    </div>
  </div>
</div>
