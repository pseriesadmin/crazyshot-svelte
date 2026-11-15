<script lang="ts">
  // /cms/promotion/ad '배지 목록'·'배지 설정' 탭 — 상품목록(/cms/products)과 같은 마스터-디테일 구조:
  // 카드 목록(패널 열림 시 30%) + 오른쪽 sticky 상세 패널(나머지 70%). 정본: src/routes/cms/products/+page.svelte
  import { invalidateAll } from '$app/navigation'
  import { fly } from 'svelte/transition'
  import { csToast } from '$lib/utils/toast'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import BadgeChip from './BadgeChip.svelte'
  import BadgeRulePanel from './BadgeRulePanel.svelte'
  import BadgeTemplatePanel from './BadgeTemplatePanel.svelte'
  import { postBadgeAction } from './badgeApi'
  import { isoToKstDate } from '$lib/utils/badgeColor'
  import type { BadgeCouponOption, BadgeProductName, BadgeRule, BadgeTemplate } from '$lib/types/badge'

  interface Props {
    mode: 'list' | 'settings'
    rules: BadgeRule[]
    templates: BadgeTemplate[]
    coupons: BadgeCouponOption[]
    productNames: BadgeProductName[]
  }

  let { mode, rules, templates, coupons, productNames }: Props = $props()

  let ordered = $state<BadgeRule[]>([])
  $effect(() => {
    ordered = [...rules]
  })
  // '배지 설정' 목록도 같은 방식으로 드래그 정렬(순서는 sort_order 로 저장)
  let orderedTemplates = $state<BadgeTemplate[]>([])
  $effect(() => {
    orderedTemplates = [...templates]
  })

  // 선택된 카드 — 'new' 는 신규 등록
  let selectedId = $state<string | null>(null)
  const panelOpen = $derived(selectedId !== null)

  const selectedRule = $derived(mode === 'list' && selectedId && selectedId !== 'new' ? (rules.find((r) => r.id === selectedId) ?? null) : null)
  const selectedTemplate = $derived(mode === 'settings' && selectedId && selectedId !== 'new' ? (templates.find((t) => t.id === selectedId) ?? null) : null)

  // 탭을 옮기면 패널을 닫는다
  $effect(() => {
    void mode
    selectedId = null
  })

  function templateOf(id: string): BadgeTemplate | undefined {
    return templates.find((t) => t.id === id)
  }
  function periodLabel(r: BadgeRule): string {
    const f = isoToKstDate(r.valid_from)
    const u = isoToKstDate(r.valid_until)
    if (!f && !u) return '상시'
    return `${f || '—'} ~ ${u || '—'}`
  }
  function couponLabel(id: string): string {
    return coupons.find((c) => c.id === id)?.label ?? '삭제된 쿠폰'
  }

  function closePanel() { selectedId = null }

  // 저장 후에도 패널은 닫지 않는다 — 저장된 항목을 연 채로 최신 값으로 다시 그린다(신규 등록이면 저장된 항목으로 전환).
  // id 없이 호출되면(삭제) 패널을 닫는다.
  let panelVersion = $state(0)
  async function afterSaved(savedId?: string) {
    await invalidateAll()
    if (savedId) {
      selectedId = savedId
      panelVersion += 1
    } else {
      selectedId = null
    }
  }

  async function onReorder() {
    const r = await postBadgeAction('reorderProductBadges', { ids: ordered.map((x) => x.id) })
    if (!r.ok) csToast.error(r.error ?? '순서를 저장하지 못했어요')
    await invalidateAll()
  }

  // 카드에서 삭제 — 지금 열려 있는 항목이 삭제된 경우에만 패널을 닫는다(목록 갱신은 폼 처리 후 자동)
  function onRuleDeleted(id: string) {
    if (selectedId === id) selectedId = null
  }

  async function onReorderTemplates() {
    const r = await postBadgeAction('reorderBadgeTemplates', { ids: orderedTemplates.map((x) => x.id) })
    if (!r.ok) csToast.error(r.error ?? '순서를 저장하지 못했어요')
    await invalidateAll()
  }

  async function toggle(id: string) {
    const r = await postBadgeAction('toggleProductBadge', { id })
    if (!r.ok) csToast.error(r.error ?? '처리에 실패했어요')
    await invalidateAll()
  }
</script>

<div class="badge-wrap">
  <!-- 툴바 (/cms/products 와 동일: CTA 44px) -->
  <div class="toolbar">
    <button type="button" class="cta-btn" onclick={() => (selectedId = 'new')}>{mode === 'list' ? '+ 신규목록등록' : '+ 배지 추가'}</button>
  </div>

  <!-- 마스터-디테일 레이아웃 -->
  <div class="master-detail">
    <!-- 카드 목록 -->
    <div class="list-pane" class:narrow={panelOpen}>
      {#if mode === 'list'}
        {#if ordered.length === 0}
          <div class="empty-state"><p class="empty-msg">등록된 배지 노출이 없습니다.</p></div>
        {:else}
          <CmsDragList bind:items={ordered} itemKey={(r) => r.id} onreorder={onReorder} class="badge-card-list">
            {#snippet renderItem(r: BadgeRule)}
              {@const t = templateOf(r.template_id)}
              <div class="product-card" class:selected={selectedId === r.id} role="listitem">
                <button type="button" class="card-body" onclick={() => (selectedId = r.id)} aria-pressed={selectedId === r.id} aria-label="배지 노출 상세 보기">
                  <div class="card-thumb-wrap">
                    {#if t}<BadgeChip kind={t.kind} svg_url={t.svg_url} text={t.text} bg_color={t.bg_color} text_color={t.text_color} size={22} />{/if}
                  </div>
                  <div class="card-info">
                    <div class="card-info-top">
                      <span class="cat-badge">{periodLabel(r)}</span>
                      {#if r.coupon_id}<span class="stock-badge">{couponLabel(r.coupon_id)}</span>{/if}
                    </div>
                    <p class="card-name">{r.name}</p>
                  </div>
                </button>
                <div class="card-actions">
                  <button
                    type="button"
                    class="status-toggle"
                    class:on={r.is_active}
                    aria-label={r.is_active ? '숨김으로 전환' : '노출로 전환'}
                    onclick={() => toggle(r.id)}
                  >
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                  </button>
                  <!-- 패널 안의 삭제 버튼과 같은 표준(CmsDeleteButton 아이콘형 — 1차 클릭 경고 토스트, 2차 클릭 삭제) -->
                  <CmsDeleteButton action="?/deleteProductBadge" id={r.id} onsuccess={() => onRuleDeleted(r.id)} />
                </div>
              </div>
            {/snippet}
          </CmsDragList>
        {/if}
      {:else}
        {#if templates.length === 0}
          <div class="empty-state"><p class="empty-msg">등록된 배지가 없습니다.</p></div>
        {:else}
          <CmsDragList bind:items={orderedTemplates} itemKey={(t) => t.id} onreorder={onReorderTemplates} class="badge-card-list">
            {#snippet renderItem(t: BadgeTemplate)}
              <div class="product-card" class:selected={selectedId === t.id} role="listitem">
                <button type="button" class="card-body" onclick={() => (selectedId = t.id)} aria-pressed={selectedId === t.id} aria-label="{t.name} 상세 보기">
                  <div class="card-thumb-wrap">
                    <BadgeChip kind={t.kind} svg_url={t.svg_url} text={t.text} bg_color={t.bg_color} text_color={t.text_color} size={22} />
                  </div>
                  <div class="card-info">
                    <p class="card-name">{t.name}</p>
                  </div>
                </button>
              </div>
            {/snippet}
          </CmsDragList>
        {/if}
      {/if}
    </div>

    <!-- 상세 뷰어 패널 -->
    {#if panelOpen}
      <div class="detail-pane" transition:fly={{ x: 24, duration: 200 }}>
        {#key `${mode}:${selectedId}:${panelVersion}`}
          {#if mode === 'list'}
            <BadgeRulePanel rule={selectedRule} {templates} {coupons} {productNames} onclose={closePanel} onsaved={afterSaved} />
          {:else}
            <BadgeTemplatePanel template={selectedTemplate} onclose={closePanel} onsaved={afterSaved} />
          {/if}
        {/key}
      </div>
    {/if}
  </div>
</div>

<style>
  .badge-wrap { display: flex; flex-direction: column; gap: 30px; }

  /* 툴바 */
  .toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-shrink: 0; }
  .cta-btn {
    display: inline-flex; align-items: center; height: 44px; padding: 0 30px; border: none;
    background: var(--cs-purple); color: var(--cs-white); border-radius: var(--radius-md);
    font: var(--text-pc-body-14); white-space: nowrap; cursor: pointer; transition: background 0.12s;
  }
  .cta-btn:hover { background: var(--cs-purple-hover); }

  /* 마스터-디테일 */
  .master-detail { display: flex; gap: 16px; align-items: flex-start; }
  .list-pane { width: 100%; min-width: 0; display: flex; flex-direction: column; transition: width 0.22s ease; }
  /* 패널 열림 시 목록:상세 = 3:7 (상품목록과 동일) */
  .list-pane.narrow { width: 30%; flex-shrink: 0; }

  /* 카드 목록 */
  .list-pane :global(.badge-card-list) { display: flex; flex-direction: column; gap: 30px; padding-right: 4px; }

  /* 카드 */
  .product-card {
    display: flex; align-items: stretch; flex: 1; min-width: 0;
    background: var(--cs-white); border-radius: var(--radius-lg); box-shadow: 0px 1px 2px rgba(0,0,0,0.06);
    transition: background 0.15s; flex-shrink: 0; overflow: hidden;
  }
  .product-card:hover { background: var(--cs-border); }
  .product-card.selected { background: rgba(59,47,138,0.06); }
  .card-body {
    display: flex; align-items: center; gap: 15px; flex: 1; min-width: 0; padding: 15px 0 15px 20px;
    background: transparent; border: none; cursor: pointer; text-align: left;
  }
  .card-thumb-wrap {
    flex-shrink: 0; width: 60px; height: 60px; background: #E8E4F8; border-radius: var(--cms-radius-sm);
    overflow: hidden; display: flex; align-items: center; justify-content: center; padding: 0 6px; box-sizing: border-box;
  }
  .card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .card-info-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .cat-badge {
    display: inline-block; padding: 5px 10px; background: var(--cs-lilac); color: var(--cs-purple-dark);
    border-radius: var(--radius-sm); font: var(--text-pc-descript-10); white-space: nowrap;
  }
  .stock-badge {
    display: inline-block; padding: 5px 10px; background: #F3F4F6; color: var(--cs-text-mid);
    border-radius: var(--radius-sm); font: var(--text-pc-descript-10); white-space: nowrap;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis;
  }
  .card-name { font: var(--text-pc-body-14); color: var(--cs-text); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* 카드 우측 — 토글 + 삭제 아이콘을 한 묶음으로 카드 세로 가운데에 둔다(묶음 안은 서로 가운데 정렬) */
  .card-actions { display: flex; align-items: center; gap: 6px; padding: 0 20px 0 8px; flex-shrink: 0; }
  .card-actions :global(form) { display: flex; }
  .status-toggle {
    display: flex; align-items: center; background: transparent; border: none; cursor: pointer;
    padding: 4px; min-height: 44px; min-width: 44px; justify-content: center;
  }
  .toggle-track {
    position: relative; width: 36px; height: 20px; background: var(--cs-disabled-toggle);
    border-radius: var(--cms-radius-sm); transition: background 0.18s; display: block; flex-shrink: 0;
    padding: 2px; box-sizing: border-box;
  }
  .status-toggle.on .toggle-track { background: var(--cs-purple); }
  .toggle-thumb {
    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--cs-white); transition: transform 0.18s; box-shadow: 0 1px 3px rgba(0,0,0,0.18); display: block;
  }
  .status-toggle.on .toggle-thumb { transform: translateX(16px); }

  /* 빈 상태 */
  .empty-state {
    display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 60px 20px;
    background: var(--cs-white); border-radius: var(--cms-radius-md);
  }
  .empty-msg { font: var(--text-pc-title-16); color: var(--cs-text-light); margin: 0; }

  /* 상세 패널 — 스크롤해도 화면에 보이도록 sticky (상품목록과 동일) */
  .detail-pane {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px;
    position: sticky; top: 16px; align-self: flex-start; max-height: calc(100vh - 126px); overflow-y: auto;
  }
</style>
