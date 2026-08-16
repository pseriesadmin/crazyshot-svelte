<script lang="ts">
  import { page } from '$app/state'

  const TABS = [
    { label: '예약현황', href: '/cms/reservation' },
    { label: '대여현황', href: '/cms/rentals' },
  ]

  function isActive(href: string): boolean {
    if (href === '/cms/reservation') {
      return page.url.pathname.startsWith('/cms/reservation') && !page.url.pathname.startsWith('/cms/reservation/contracts')
    }
    return page.url.pathname.startsWith(href)
  }
</script>

<div class="rr-tab-nav" role="tablist" aria-label="예약대여현황 탭">
  {#each TABS as tab}
    <a
      href={tab.href}
      role="tab"
      aria-selected={isActive(tab.href)}
      class="rr-tab-btn"
      class:active={isActive(tab.href)}
      data-sveltekit-preload-data="hover"
    >{tab.label}</a>
  {/each}
</div>

<style>
  .rr-tab-nav {
    display: flex;
    gap: 2px;
    padding: 0 0 10px;
  }
  .rr-tab-btn {
    padding: 8px 23.04px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-pc-title-18);
    text-decoration: none;
    cursor: pointer;
    min-height: 40px;
    display: flex;
    align-items: center;
    transition: color 0.12s, border-color 0.12s;
    margin-bottom: -1px;
  }
  .rr-tab-btn:hover { color: var(--cs-text); }
  .rr-tab-btn.active { color: var(--cs-purple); border-bottom-color: var(--cs-purple); font-weight: 700; }
</style>
