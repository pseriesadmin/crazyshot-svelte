<script lang="ts">
  import { invalidate, goto } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
  import ProfileCard from '$lib/components/account/ProfileCard.svelte'
  import RentalStatRow from '$lib/components/account/RentalStatRow.svelte'
  import WishlistScroll from '$lib/components/account/WishlistScroll.svelte'
  import MenuSection from '$lib/components/account/MenuSection.svelte'
  import LogTabContent from '$lib/components/members/profile/LogTabContent.svelte'
  import ReviewTabContent from '$lib/components/members/profile/ReviewTabContent.svelte'
  import ProfileTabContent from '$lib/components/members/profile/ProfileTabContent.svelte'
  import AddressTabContent from '$lib/components/members/profile/AddressTabContent.svelte'
  import NotificationTabContent from '$lib/components/members/profile/NotificationTabContent.svelte'
  import PcRentalPanel from '$lib/components/account/PcRentalPanel.svelte'
  import PcCancelPanel from '$lib/components/account/PcCancelPanel.svelte'
  import PcInquiryPanel from '$lib/components/account/PcInquiryPanel.svelte'

  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  $effect(() => {
    const timer = setInterval(() => invalidate('app:rental-status'), 30_000)
    return () => clearInterval(timer)
  })

  const rentalStats = $derived([
    { label: '대여중',    count: data.rentalStats.active },
    { label: '배송중',    count: data.rentalStats.shipping },
    { label: '대여종료',  count: data.rentalStats.completed },
    { label: '취소·반품', count: data.rentalStats.cancelled },
  ])

  const rentalMenuItems = [
    { label: '대여',      href: '/account/rental',  panel: 'rental' },
    { label: '취소·반품', href: '/account/cancel',  panel: 'cancel' },
    { label: '빠른 문의', href: '/account/inquiry', panel: 'inquiry' },
  ]

  const myInfoMenuItems = [
    { label: '로그',         href: '/account/profile?tab=log',         panel: 'log' },
    { label: '후기·댓글',   href: '/account/profile?tab=review',       panel: 'review' },
    { label: '개인정보',    href: '/account/profile?tab=profile',      panel: 'profile' },
    { label: '기본 배송지', href: '/account/profile?tab=address',      panel: 'address' },
    { label: '알림설정',    href: '/account/profile?tab=notification',  panel: 'notification' },
  ]

  const rentalCount  = $derived(data.rentalStats.active + data.rentalStats.shipping)
  const myInfoCount  = 2

  /* PC 우측 패널 전환 — 'home': 기본 대시보드, 그 외: 내정보 서브섹션 */
  let activePcSection = $state('home')

  async function handleLogout() {
    await supabase.auth.signOut()
    goto('/')
  }


</script>

<div class="page-wrap">
  <div class="page-inner">

    <!-- ───────────────── 모바일 레이아웃 (< 1024px) ───────────────── -->
    <div class="mobile-layout">
      <div class="bg-[#ecebf4] flex flex-col items-center relative min-h-screen">

        <SubGnb title="내정보" mobileOnly />

        <!-- 프로필 카드 -->
        <div class="relative shrink-0 w-full">
          <div class="flex flex-col items-start pt-[50px] px-[25px] relative size-full">
            <ProfileCard userName={data.user.name} benefitCount={data.benefitCount} />
          </div>
        </div>

        <!-- 대여 경험 섹션 -->
        <div class="relative shrink-0 w-full">
          <div class="flex flex-col items-start pt-[20px] px-[25px] relative size-full">
            <div class="flex flex-col gap-[10px] items-start max-w-[1240px] min-w-[340px] py-[30px] relative rounded-[30px] shrink-0 w-full">
              <div class="flex h-[29px] items-center relative shrink-0 w-full">
                <p class="font-['Noto_Sans_KR',sans-serif] font-medium leading-[1.6] relative shrink-0 text-[#444] text-[18px] text-center tracking-[-0.3px] whitespace-nowrap">대여 경험</p>
              </div>
              <div class="flex items-center relative shrink-0 w-full">
                <div class="flex flex-col font-['Noto_Sans_KR',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#666] text-[14px] tracking-[-0.5px] whitespace-nowrap">
                  <p class="leading-[1.6]">최근 3개월 동안 0건의 대여정보가 있어요.</p>
                </div>
              </div>
            </div>
            <RentalStatRow stats={rentalStats} />
            {#if data.recentRental}
              <div class="w-full mt-[12px]">
                <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#444] text-[12px] tracking-[-0.3px] mb-[8px]">최근 예약 진행 상태</p>
                <RentalJourneyStepper status={data.recentRental.status} />
              </div>
            {/if}
          </div>
        </div>

        <!-- 관심가져봄 -->
        <WishlistScroll items={data.wishlists} totalCount={data.wishlists.length} />

        <!-- 대여 정보 + 내정보 메뉴 -->
        <div class="flex flex-col items-start pt-[50px] relative shrink-0 w-full">
          <div class="bg-[#f6f6f6] flex flex-col gap-[10px] items-start overflow-clip relative rounded-tr-[50px] shrink-0 w-full">
            <MenuSection title="대여 정보" count={rentalCount} items={rentalMenuItems} variant="rental" />
            <MenuSection title="내정보"    count={myInfoCount}  items={myInfoMenuItems} variant="myinfo" />
          </div>
        </div>

      </div>
    </div>

    <!-- ───────────────── PC SubGnb (≥ 641px) ───────────────── -->
    <SubGnb title="내정보" pcOnly />

    <!-- ───────────────── PC 레이아웃 (≥ 1024px) ───────────────── -->
    <div class="pc-layout">

      <!-- 왼쪽 컬럼 (380px sticky) -->
      <div class="pc-left">

        <!-- 프로필 카드 -->
        <div class="bg-[#ffffff] rounded-[30px] px-[20px] py-[20px] flex items-center justify-between">
              <div class="flex flex-col gap-[5px]">
                <p class="font-['Noto_Sans_KR',sans-serif] font-bold text-[#100b32] text-[21px] tracking-[-0.3px] leading-[1.6]">{data.user.name}님,</p>
                <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#666] text-[14px] tracking-[-0.5px] leading-[1.6]">
                  지금 <span class="font-bold text-[#553fe0]">{data.benefitCount} </span>가지 혜택·이벤트 확인요망
                </p>
              </div>
              <div class="bg-[#553fe0] flex flex-col gap-[10px] items-center justify-center rounded-[25px] size-[70px] overflow-hidden">
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
                  <p class="font-['Noto_Sans_KR',sans-serif] font-medium leading-[1.6] text-[12px] text-[#ffffff] tracking-[-0.5px] whitespace-nowrap">QR체크</p>
                </div>
              </div>
        </div>

        <!-- 내정보 메뉴 카드 -->
        <div class="bg-[#ffffff] rounded-[30px] px-[24px] py-[24px]">
          <div class="flex items-center justify-between mb-[24px]">
            <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#444] text-[18px] tracking-[-0.3px]">내정보</span>
            <div class="flex gap-[20px] items-center">
              <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#444] text-[16px] tracking-[-0.5px]">{myInfoCount}</span>
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
          <div class="flex flex-col gap-[20px]">
            {#each myInfoMenuItems as item}
              <button
                onclick={() => activePcSection = item.panel}
                class="flex items-center justify-between relative shrink-0 w-full cursor-pointer hover:opacity-70 transition-opacity text-left"
              >
                <span
                  class="font-['Noto_Sans_KR',sans-serif] text-[16px] tracking-[-0.5px]"
                  style="color: {activePcSection === item.panel ? 'var(--cs-purple)' : '#444'}; font-weight: {activePcSection === item.panel ? '700' : '500'};"
                >{item.label}</span>
                <div class="h-[12px] relative shrink-0 w-[6px]">
                  <div class="absolute inset-[-8.33%_-16.67%]">
                    <svg class="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 8 14">
                      <path d="M1 1L7 7L1 13"
                        stroke="{activePcSection === item.panel ? '#553FE0' : '#aaaaaa'}"
                        stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                    </svg>
                  </div>
                </div>
              </button>
            {/each}
          </div>
          <div class="pc-logout-wrap">
            <button class="pc-btn-logout" onclick={handleLogout}>로그아웃</button>
          </div>
        </div>

      </div>

      <!-- 오른쪽 컬럼 (flex-1) -->
      <div class="pc-right">

        {#if activePcSection === 'home'}
          <!-- 기본 대시보드: 대여 경험 + 관심가져봄 + 대여 정보 -->

          <!-- 대여 경험 -->
          <div class="bg-[#ecebf4] rounded-[30px] overflow-hidden">
            <div class="px-[24px] py-[24px]">
              <div class="mb-[16px]">
                <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#444] text-[18px] tracking-[-0.3px] mb-[4px]">대여 경험</p>
                <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#666] text-[14px] tracking-[-0.5px]">최근 3개월 동안 0건의 대여정보가 있어요.</p>
              </div>
              <RentalStatRow stats={rentalStats} />
              {#if data.recentRental}
                <div class="mt-[12px]">
                  <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#444] text-[12px] tracking-[-0.3px] mb-[8px]">최근 예약 진행 상태</p>
                  <RentalJourneyStepper status={data.recentRental.status} />
                </div>
              {/if}
            </div>
          </div>

          <!-- 관심가져봄 -->
          <div class="bg-[#ffffff] rounded-[30px] overflow-hidden">
            <div class="px-[24px] py-[24px]">
              <div class="flex items-center justify-between mb-[16px]">
                <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#444] text-[18px] tracking-[-0.3px]">관심가져봄</p>
                <div class="flex gap-[20px] items-center">
                  <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#444] text-[16px] tracking-[-0.5px]">6</span>
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
              <div class="overflow-x-auto">
                <WishlistScroll items={data.wishlists} totalCount={data.wishlists.length} />
              </div>
            </div>
          </div>

          <!-- 대여 정보 메뉴 -->
          <div class="bg-[#ffffff] rounded-[30px] px-[24px] py-[24px]">
            <div class="flex items-center justify-between mb-[24px]">
              <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#444] text-[18px] tracking-[-0.3px]">대여 정보</span>
              <div class="flex gap-[20px] items-center">
                <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[#444] text-[16px] tracking-[-0.5px]">{rentalCount}</span>
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
            <div class="flex flex-col gap-[20px]">
              {#each rentalMenuItems as item}
                <button
                  onclick={() => activePcSection = item.panel}
                  class="flex items-center justify-between relative shrink-0 w-full cursor-pointer hover:opacity-70 transition-opacity text-left"
                  style="border:none;background:none;padding:0;"
                >
                  <span
                    class="font-['Noto_Sans_KR',sans-serif] text-[16px] tracking-[-0.5px]"
                    style="color:{activePcSection === item.panel ? 'var(--cs-purple)' : '#444'};font-weight:{activePcSection === item.panel ? '700' : '500'};"
                  >{item.label}</span>
                  <div class="h-[12px] relative shrink-0 w-[6px]">
                    <div class="absolute inset-[-8.33%_-16.67%]">
                      <svg class="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 8 14">
                        <path d="M1 1L7 7L1 13"
                          stroke="{activePcSection === item.panel ? '#553FE0' : '#aaaaaa'}"
                          stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                      </svg>
                    </div>
                  </div>
                </button>
              {/each}
            </div>
          </div>

        {:else}
          <!-- 서브섹션 패널 -->
          <div class="pc-panel-wrap">
            {#if activePcSection === 'rental'}
              <PcRentalPanel rentals={data.rentals} onback={() => activePcSection = 'home'} />
            {:else if activePcSection === 'cancel'}
              <PcCancelPanel cancels={data.cancels} onback={() => activePcSection = 'home'} />
            {:else if activePcSection === 'inquiry'}
              <PcInquiryPanel inquiries={data.inquiries} onback={() => activePcSection = 'home'} />
            {:else if activePcSection === 'log'}
              <LogTabContent />
            {:else if activePcSection === 'review'}
              <ReviewTabContent />
            {:else if activePcSection === 'profile'}
              <ProfileTabContent
                profile={data.profile}
                authEmail={data.authEmail}
                addresses={data.addresses}
                onswitchtab={(tab) => { activePcSection = tab }}
                compact={true}
              />
            {:else if activePcSection === 'address'}
              <AddressTabContent addresses={data.addresses} />
            {:else if activePcSection === 'notification'}
              <NotificationTabContent
                rentalAlert={data.profile?.allow_rental_alert ?? true}
                benefitAlert={data.profile?.allow_benefit_alert ?? false}
              />
            {/if}
          </div>
        {/if}

      </div>
    </div>

  </div>
</div>

<BottomTabBar />

<style>
  /* ── 페이지 전체 래퍼 ── */
  .page-wrap {
    min-height: 100vh;
    background: #ecebf4;
    display: flex;
    justify-content: center;
    overflow-x: hidden;
  }

  .page-inner {
    width: 100%;
    max-width: 480px;
  }

  /* ── 모바일 레이아웃: 기본 표시 ── */
  .mobile-layout {
    display: block;
    width: 100%;
  }

  /* ── PC 레이아웃: 기본 숨김 ── */
  .pc-layout {
    display: none;
  }

  /* ── PC 링크·버튼 스타일 리셋 ── */
  .pc-layout a {
    text-decoration: none;
    color: inherit;
  }
  .pc-layout button {
    border: none;
    background: none;
    padding: 0;
  }
  .pc-layout button:focus { outline: none; }
  .pc-layout button:focus-visible { outline: 2px solid var(--cs-purple); outline-offset: 2px; border-radius: 4px; }

  /* ── PC 레이아웃 (≥ 1024px) ── */
  @media (min-width: 1024px) {
    .page-inner {
      max-width: 1240px; /* front-uiux §3 PC반응형 최소 정책 */
      /* GNB가 /account에서 미렌더링 → padding-top 불필요 */
    }

    /* SubGnb 재정의: GNB 없으므로 top:0 / 배경·하단선 제거 */
    :global(.page-inner .sub-gnb-pc) {
      top: 0;
      background: transparent;
      border-bottom: none;
    }

    .mobile-layout {
      display: none;
    }

    .pc-layout {
      display: flex;
      width: 100%;
      gap: 24px;
      padding: 16px var(--layout-pc-pad) 80px; /* PC반응형 최소: --layout-pc-pad 40px */
      align-items: flex-start;
    }

    .pc-left {
      width: 380px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 16px;
      position: sticky;
      top: 110px; /* SubGnb 높이(~102px) + 여백 */
    }

    .pc-right {
      flex: 1;
      min-width: 0; /* flex 자식 콘텐츠 오버플로우 방지 */
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* 서브섹션 랜딩 패널 래퍼 — TabContent 컴포넌트의 rounded corner 스타일 유지 */
    .pc-panel-wrap {
      width: 100%;
      border-radius: 30px;
      overflow: hidden;
      background: #ffffff;
    }

    /* PC 로그아웃 버튼 */
    .pc-logout-wrap {
      width: 100%;
      padding: 24px 0 0;
      margin-top: 16px;
      border-top: 1px solid var(--cs-lilac);
    }
    .pc-btn-logout {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 44px;
      border: none;
      border-radius: var(--radius-xl);
      background: rgba(236, 235, 244, 0.6);
      font-family: 'Noto Sans KR', sans-serif;
      font-size: var(--text-m-script-14B);
      font-weight: 500;
      color: var(--cs-text-light);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      letter-spacing: -0.3px;
    }
    .pc-btn-logout:hover {
      background: var(--cs-lilac);
      color: var(--cs-text-mid);
    }
  }
</style>
