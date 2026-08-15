<script lang="ts">
  import { goto, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import SubscriptionDetailPanel from '$lib/components/cms/subscription/SubscriptionDetailPanel.svelte'
  import { csToast } from '$lib/utils/toast'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const panelOpen = $derived(!!data.selectedDetail)

  const REG_WARN_MSG: Record<string, string> = {
    code: '카테고리 품번 채번에 실패했습니다. 상세패널에서 다시 시도해주세요.',
    benefits: '일부 혜택 설정 저장에 실패했습니다. 혜택관리 탭에서 확인해주세요.',
    items: '무료렌탈 대상장비 저장에 실패했습니다. 무료렌탈 대상장비 탭에서 확인해주세요.',
  }

  $effect(() => {
    const regWarn = page.url.searchParams.get('regWarn')
    if (!regWarn) return
    for (const code of regWarn.split(',')) {
      csToast.warning(REG_WARN_MSG[code] ?? `등록 중 일부 항목이 처리되지 못했습니다(${code}).`)
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('regWarn')
    replaceState(url, {})
  })

  function selectPlan(id: number): void {
    const url = new URL(window.location.href)
    url.searchParams.set('selected', String(id))
    replaceState(url, {})
    void goto(url, { invalidateAll: true, keepFocus: true, noScroll: true })
  }

  function closePanel(): void {
    const url = new URL(window.location.href)
    url.searchParams.delete('selected')
    void goto(url, { invalidateAll: true, keepFocus: true, noScroll: true })
  }

  function goToPage(p: number): void {
    const url = new URL(window.location.href)
    url.searchParams.set('page', String(p))
    url.searchParams.delete('selected')
    void goto(url)
  }

  async function handleToggle(id: number, status: string, e: MouseEvent): Promise<void> {
    e.stopPropagation()
    const fd = new FormData()
    fd.set('id', String(id))
    fd.set('status', status)
    const res = await fetch('?/toggleStatus', { method: 'POST', body: fd })
    if (res.ok) {
      void goto(window.location.href, { invalidateAll: true, noScroll: true, keepFocus: true })
    } else {
      csToast.error('상태 변경에 실패했습니다.')
    }
  }
</script>

<svelte:head>
  <title>구독목록 — CMS</title>
</svelte:head>

<div class="sub-wrap">
  <div class="toolbar">
    <h1 class="page-title">구독목록</h1>
    <a href="/cms/subscriptions/new" class="btn-new">+ 구독등록</a>
  </div>

  <CmsPagination page={data.page} totalPages={data.totalPages} onpage={goToPage} variant="top" ariaLabel="구독목록 페이지 탐색" />

  <div class="master-detail">
    <div class="list-pane" class:narrow={panelOpen}>
      <div class="card-list">
        {#each data.plans as plan (plan.id)}
          <div
            class="plan-card"
            class:selected={data.selectedId === plan.id}
            role="button"
            tabindex="0"
            onclick={() => selectPlan(plan.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPlan(plan.id) } }}
          >
            <div class="card-thumb-wrap">
              {#if plan.image_urls?.[0]}
                <img src={plan.image_urls[0]} alt={plan.name} class="card-thumb" width="60" height="60" loading="lazy" />
              {/if}
            </div>
            <div class="card-info">
              <div class="card-badges">
                {#if plan.category}<span class="cat-badge">{plan.category}</span>{/if}
                <span class="price-badge">{plan.monthly_price.toLocaleString()}원/월</span>
              </div>
              <p class="card-name">{plan.name}</p>
              {#if plan.code_series?.prefix}
                <span class="plan-card-code">SUB-{plan.code_series.prefix}-####</span>
              {/if}
              <div class="card-status-row">
                {#if plan.membership_grade}<span class="plan-card-grade">{plan.membership_grade}</span>{/if}
                <span class="plan-card-status" class:active={plan.status === 'active'}>
                  {plan.status === 'active' ? '판매중' : '비활성'}
                </span>
              </div>
            </div>
            <button
              type="button"
              class="status-toggle"
              class:on={plan.status === 'active'}
              onclick={(e) => handleToggle(plan.id, plan.status, e)}
              aria-label={plan.status === 'active' ? '비활성으로 전환' : '판매중으로 전환'}
              title={plan.status === 'active' ? '클릭하여 비활성' : '클릭하여 판매중'}
            >
              <span class="toggle-track">
                <span class="toggle-thumb"></span>
              </span>
            </button>
          </div>
        {:else}
          <p class="empty-list">등록된 구독 상품이 없습니다.</p>
        {/each}
      </div>
    </div>

    {#if panelOpen && data.selectedDetail}
      <div class="detail-pane">
        {#key data.selectedId}
          <SubscriptionDetailPanel
            plan={data.selectedDetail.plan}
            benefits={data.selectedDetail.benefits}
            freeRentalItems={data.selectedDetail.freeRentalItems}
            subscriberCounts={data.selectedDetail.subscriberCounts}
            subscribers={data.selectedDetail.subscribers}
            parentProducts={data.parentProducts}
            categoryOptions={data.categoryOptions}
            onclose={closePanel}
          />
        {/key}
      </div>
    {/if}
  </div>

  <CmsPagination page={data.page} totalPages={data.totalPages} onpage={goToPage} variant="bottom" />
</div>

<style>
  .sub-wrap { padding: 24px 32px 60px; display: flex; flex-direction: column; gap: 16px; }

  .toolbar { display: flex; align-items: center; justify-content: space-between; }
  .page-title { font: var(--text-pc-htitle-25); color: var(--cs-text); margin: 0; }
  .btn-new {
    padding: 10px 20px; border-radius: var(--radius-md); background: var(--cs-purple); color: var(--cs-white);
    font: var(--text-pc-body-14); font-weight: 700; text-decoration: none; transition: opacity 0.12s;
  }
  .btn-new:hover { opacity: 0.85; }

  .master-detail { display: flex; gap: 20px; align-items: flex-start; }
  .list-pane { flex: 1; min-width: 0; transition: flex 0.2s; }
  .list-pane.narrow { flex: 0 0 380px; }
  .detail-pane { flex: 1; min-width: 0; }

  .card-list { display: flex; flex-direction: column; gap: 10px; }
  .empty-list { font: var(--text-pc-body-14); color: var(--cs-text-light); padding: 40px 0; text-align: center; }

  .plan-card {
    display: flex; align-items: center; gap: 14px; padding: 12px 16px; border: none;
    background: var(--cs-white); border-radius: var(--radius-md); cursor: pointer; text-align: left;
    transition: box-shadow 0.15s, border-color 0.15s; border: 1.5px solid transparent;
    width: 100%;
  }
  .plan-card:hover { box-shadow: 0 2px 10px rgba(16, 11, 50, 0.08); }
  .plan-card.selected { border-color: var(--cs-purple); }

  /* 썸네일 */
  .card-thumb-wrap {
    flex-shrink: 0; width: 60px; height: 60px;
    background: #E8E4F8; border-radius: var(--radius-sm); overflow: hidden;
  }
  .card-thumb { width: 60px; height: 60px; object-fit: cover; display: block; }

  /* 정보 영역 */
  .card-info { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .card-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .cat-badge {
    background: var(--cs-lilac); color: var(--cs-purple-dark);
    padding: 3px 8px; border-radius: var(--radius-sm);
    font: var(--text-pc-descript-10); white-space: nowrap;
  }
  .price-badge {
    background: var(--cs-purple-op10, rgba(59,47,138,0.10)); color: var(--cs-purple);
    padding: 3px 8px; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); font-weight: 700; white-space: nowrap;
  }
  .card-name {
    margin: 0; font: var(--text-pc-title-16); color: var(--cs-text); font-weight: 700;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .plan-card-code { font: var(--text-pc-descript-10); color: var(--cs-text-light); font-family: monospace; }
  .card-status-row { display: flex; align-items: center; gap: 8px; }
  .plan-card-grade { font: var(--text-pc-script-12); color: var(--cs-purple); font-weight: 700; }
  .plan-card-status { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .plan-card-status.active { color: var(--cs-purple); }

  .status-toggle {
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    background: transparent; border: none; cursor: pointer; padding: 4px;
    min-height: 44px; min-width: 44px;
  }
  .toggle-track {
    position: relative; width: 36px; height: 20px; border-radius: var(--cms-radius-sm);
    background: var(--cs-disabled-toggle, var(--cs-lilac)); transition: background 0.18s;
    display: block;
  }
  .status-toggle.on .toggle-track { background: var(--cs-purple); }
  .toggle-thumb {
    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--cs-white); transition: transform 0.18s; box-shadow: 0 1px 3px rgba(0,0,0,0.18);
    display: block;
  }
  .status-toggle.on .toggle-thumb { transform: translateX(16px); }
</style>
