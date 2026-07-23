<script lang="ts">
  import { page } from '$app/stores'
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import LogTabContent from '$lib/components/members/profile/LogTabContent.svelte'
  import ReviewTabContent from '$lib/components/members/profile/ReviewTabContent.svelte'
  import ProfileTabContent from '$lib/components/members/profile/ProfileTabContent.svelte'
  import AddressTabContent from '$lib/components/members/profile/AddressTabContent.svelte'
  import NotificationTabContent from '$lib/components/members/profile/NotificationTabContent.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  type Tab = 'log' | 'review' | 'profile' | 'address' | 'notification'

  const VALID_TABS: Tab[] = ['log', 'review', 'profile', 'address', 'notification']

  const TAB_LABELS: { id: Tab; label: string; count?: number }[] = [
    { id: 'log',          label: '로그',      count: data.profile?.rental_count ?? 0 },
    { id: 'review',       label: '후기·댓글' },
    { id: 'profile',      label: '개인정보' },
    { id: 'address',      label: '기본 배송지' },
    { id: 'notification', label: '알림설정' },
  ]

  function getInitialTab(): Tab {
    const param = $page.url.searchParams.get('tab')
    return (VALID_TABS.includes(param as Tab) ? param : 'profile') as Tab
  }

  let activeTab = $state<Tab>(getInitialTab())

  /* PC(≥1024px) 진입 시 /account로 리다이렉트 — PC 전용 내정보 화면 사용 */
  $effect(() => {
    if (!browser) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const redirect = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) goto('/account')
    }
    if (mq.matches) { goto('/account'); return }
    mq.addEventListener('change', redirect)
    return () => mq.removeEventListener('change', redirect)
  })
</script>

<div class="page-root">
  <!-- Sub GNB (Mobile + PC 공용) -->
  <SubGnb title="내정보" />

  <div class="page-inner">

    <!-- 탭 메뉴 -->
    <div class="tab-scroll-wrap">
      <div class="tab-scroll-inner">
        <div class="tab-list">
          {#each TAB_LABELS as tab}
            <button
              class="tab-btn"
              class:tab-active={activeTab === tab.id}
              onclick={() => activeTab = tab.id}
            >
              <span class="tab-label">{tab.label}</span>
              {#if tab.count !== undefined}
                <span class="tab-count">{tab.count}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- 탭 콘텐츠 -->
    <div class="tab-content">
      {#if activeTab === 'log'}
        <LogTabContent />
      {:else if activeTab === 'review'}
        <ReviewTabContent />
      {:else if activeTab === 'profile'}
        <ProfileTabContent
          profile={data.profile}
          authEmail={data.authEmail}
          addresses={data.addresses}
          onswitchtab={(tab) => { activeTab = tab as typeof activeTab }}
        />
      {:else if activeTab === 'address'}
        <AddressTabContent addresses={data.addresses} />
      {:else if activeTab === 'notification'}
        <div class="flex flex-col gap-[10px] w-full">
          <div class="bg-white rounded-tl-[30px] rounded-tr-[30px] w-full">
            <NotificationTabContent
              rentalAlert={data.profile?.allow_rental_alert ?? true}
              benefitAlert={data.profile?.allow_benefit_alert ?? false}
            />
          </div>
        </div>
      {/if}
    </div>

  </div>
</div>

<style>
  .page-root {
    min-height: 100vh;
    background: #ecebf4;
    display: flex;
    flex-direction: column;
    padding-top: 0;
  }

  .page-inner {
    width: 100%;
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* 탭 스크롤 영역 */
  .tab-scroll-wrap {
    width: 100%;
    padding: 30px 25px 0;
  }

  .tab-scroll-inner {
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .tab-scroll-inner::-webkit-scrollbar {
    display: none;
  }

  .tab-list {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: max-content;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: 30px;
    border: none;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
  }

  .tab-btn:hover:not(.tab-active) {
    background: #e1def3;
  }

  .tab-active {
    background: #201857;
  }

  .tab-label,
  .tab-count {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.5px;
    line-height: 1.6;
    white-space: nowrap;
    color: #100b32;
  }

  .tab-active .tab-label,
  .tab-active .tab-count {
    color: white;
  }

  /* 탭 콘텐츠 */
  .tab-content {
    width: 100%;
    padding-top: 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
</style>
