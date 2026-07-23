<script lang="ts">
  import { goto } from '$app/navigation'

  interface MenuItem {
    label: string
    href: string
  }

  interface Props {
    title: string
    count?: number
    items: MenuItem[]
    variant?: 'rental' | 'myinfo'
  }

  let { title, count = 0, items, variant = 'myinfo' }: Props = $props()
</script>

<div class="bg-white relative shrink-0 w-full" class:rounded-top={variant === 'rental'} class:pb-tall={variant === 'myinfo'}>
  <div class="flex flex-col justify-center size-full">
    <div class="inner flex flex-col items-start justify-center px-[30px] relative size-full" class:pb-rental={variant === 'rental'} class:pb-myinfo={variant === 'myinfo'}>
      <!-- 섹션 타이틀 바 -->
      <div class="flex flex-col gap-[10px] items-start max-w-[1240px] min-w-[340px] py-[30px] relative rounded-[30px] shrink-0 w-full">
        <div class="flex h-[29px] items-center relative shrink-0 w-full">
          <p class="font-['Noto_Sans_KR',sans-serif] font-medium leading-[1.6] relative shrink-0 text-[#444] text-[18px] text-center tracking-[-0.3px] whitespace-nowrap">{title}</p>
          <div class="flex gap-[20px] items-center relative shrink-0 ml-auto">
            <p class="font-['Noto_Sans_KR',sans-serif] font-medium leading-[1.6] relative shrink-0 text-[#444] text-[16px] text-center tracking-[-0.5px] whitespace-nowrap">{count}</p>
            <!-- chevron down (rotate-90 of right arrow) -->
            <div class="h-[6px] relative shrink-0 w-[12px]">
              <div class="absolute flex inset-0 items-center justify-center" style="container-type:size">
                <div class="flex-none h-[100cqw] rotate-90 w-[100cqh]">
                  <div class="relative size-full">
                    <div class="absolute inset-[-8.33%_-16.67%]">
                      <svg class="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 8 14">
                        <path d="M1 1L7 7L1 13" stroke="#aaaaaa" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- 메뉴 아이템 목록 -->
      <div class="flex flex-col gap-[20px] items-start relative shrink-0 w-full">
        {#each items as item}
          <button
            class="flex items-center justify-between relative shrink-0 w-full cursor-pointer hover:opacity-70 transition-opacity"
            onclick={() => goto(item.href)}
            aria-label={item.label}
          >
            <div class="flex flex-col font-['Noto_Sans_KR',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#444] text-[16px] tracking-[-0.5px] whitespace-nowrap">
              <p class="leading-[1.6]">{item.label}</p>
            </div>
            <!-- chevron right -->
            <div class="h-[12px] relative shrink-0 w-[6px]">
              <div class="absolute inset-[-8.33%_-16.67%]">
                <svg class="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 8 14">
                  <path d="M1 1L7 7L1 13" stroke="#aaaaaa" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                </svg>
              </div>
            </div>
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .rounded-top { border-top-right-radius: 50px; }
  .inner.pb-rental { padding-bottom: 30px; }
  .inner.pb-myinfo  { padding-bottom: 70px; }

  /* 브라우저 기본 button 스타일 초기화 */
  button { border: none; background: none; padding: 0; }
  button:focus { outline: none; }
  button:focus-visible { outline: 2px solid var(--cs-purple); outline-offset: 2px; border-radius: 4px; }
</style>
