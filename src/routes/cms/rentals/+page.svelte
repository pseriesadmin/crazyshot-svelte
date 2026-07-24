<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { fly } from 'svelte/transition'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import type { PageData } from './$types'
  import type { RentalListRow } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const STATUS_FILTERS = [
    { label: '전체',     value: '' },
    { label: '승인완료', value: 'confirmed' },
    { label: '배송중',   value: 'shipped' },
    { label: '대여중',   value: 'in_use' },
    { label: '반납요청', value: 'return_requested' },
    { label: '반납완료', value: 'returned' },
    { label: '완료',     value: 'completed' },
  ]

  // 대여 라이프사이클 전용 — pending/hold (예약 단계) 의도적으로 미포함
  const STATUS_LABEL: Record<string, string> = {
    confirmed:        '승인완료',
    shipped:          '반출중',
    in_use:           '대여중',
    return_requested: '반납중',
    returned:         '반납완료',
    completed:        '완료',
    damage_claimed:   '파손신고',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    confirmed:        { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    shipped:          { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    in_use:           { bg: 'rgba(59,47,138,0.12)',   color: 'var(--cs-purple)' },
    return_requested: { bg: 'rgba(255,69,0,0.12)',    color: 'var(--cs-orange)' },
    returned:         { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    completed:        { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    damage_claimed:   { bg: 'rgba(255,53,53,0.10)',   color: '#CF0000' },
  }

  const PICKUP_LABELS: Record<string, string> = {
    crazydelivery: '크레이지배송',
    quick:         '당일퀵',
    locker:        '무인보관함',
    visit:         '본점방문',
    epost:         '택배',
    cj:            'CJ택배',
  }

  let searchInput = $state('')
  let selectedId  = $state<number | null>(null)
  let selectedRow = $state<RentalListRow | null>(null)

  $effect(() => { searchInput = data.search ?? '' })

  $effect(() => {
    if (selectedId != null) {
      const updated = data.rentals.find(r => r.reservation_id === selectedId)
      if (updated) selectedRow = updated
    }
  })

  function applyFilters() {
    const params = new URLSearchParams()
    if (data.status)        params.set('status', data.status)
    if (searchInput.trim()) params.set('search', searchInput.trim())
    goto(`/cms/rentals?${params.toString()}`, { replaceState: true })
  }

  function setStatus(val: string) {
    const params = new URLSearchParams(window.location.search)
    if (val) params.set('status', val); else params.delete('status')
    params.delete('page')
    goto(`/cms/rentals?${params.toString()}`, { replaceState: true })
  }

  function goPage(p: number) {
    const params = new URLSearchParams(window.location.search)
    params.set('page', p.toString())
    goto(`/cms/rentals?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function selectRow(row: RentalListRow) {
    selectedId  = row.reservation_id
    selectedRow = row
    const params = new URLSearchParams(window.location.search)
    params.set('selected', String(row.reservation_id))
    goto(`/cms/rentals?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function closePanel() {
    selectedId  = null
    selectedRow = null
    const params = new URLSearchParams(window.location.search)
    params.delete('selected')
    goto(`/cms/rentals?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }

  function pickupLabel(method: string | null): string {
    if (!method) return '-'
    return PICKUP_LABELS[method] ?? method
  }
</script>

<div class="page-wrap">
  <!-- 헤더 -->
  <div class="page-header">
    <div class="header-left">
      <h1 class="page-title">대여현황</h1>
      <p class="page-sub">승인완료 이후 대여 라이프사이클을 관리합니다.</p>
    </div>
    <a href="/cms/reservation" class="btn-to-reservation">예약목록 →</a>
  </div>

  <!-- 툴바 -->
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="search-wrap">
        <input
          class="search-in"
          type="search"
          placeholder="고객명·이메일·상품명·상품코드"
          bind:value={searchInput}
          onkeydown={(e) => e.key === 'Enter' && applyFilters()}
        />
        <button class="btn-secondary" onclick={applyFilters}>검색</button>
      </div>

      <div class="filter-chips">
        {#each STATUS_FILTERS as f}
          <button
            class="chip"
            class:chip-active={(data.status ?? '') === f.value}
            onclick={() => setStatus(f.value)}
          >{f.label}</button>
        {/each}
      </div>
    </div>

    <span class="count-badge">총 {data.totalCount ?? 0}건</span>
  </div>

  <!-- 콘텐츠 영역 -->
  <div class="content-area" class:panel-open={selectedId != null}>
    <!-- 테이블 카드 -->
    <div class="table-card">
      <CmsPagination
        page={data.page}
        totalPages={data.totalPages}
        onpage={goPage}
        variant="top"
        ariaLabel="대여현황 목록 페이지 탐색"
      />

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>상태</th>
              <th class="col-hide">예약번호</th>
              <th>고객명</th>
              <th>상품명</th>
              <th>대여기간</th>
              <th class="col-hide">수령방식</th>
              <th class="col-hide">반납방식</th>
            </tr>
          </thead>
          <tbody>
            {#each data.rentals as row (row.reservation_id)}
              {@const st = STATUS_STYLE[row.status] ?? STATUS_STYLE['pending']}
              <tr
                class:selected={selectedId === row.reservation_id}
                onclick={() => selectRow(row)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && selectRow(row)}
                aria-label="{row.customer_name} 대여 상세 보기"
              >
                <td>
                  <span class="status-badge" style="background:{st.bg};color:{st.color}">
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </td>
                <td class="col-hide">
                  <code class="rsv-code">{row.reservation_code ?? `CZ-${String(row.reservation_id).padStart(5,'0')}`}</code>
                </td>
                <td>
                  <span class="customer-name">{row.customer_name ?? '-'}</span>
                </td>
                <td>
                  <div class="product-cell">
                    <span class="product-name">{row.product_name}</span>
                    {#if row.product_category}
                      <span class="product-cat">{row.product_category}</span>
                    {/if}
                  </div>
                </td>
                <td>
                  <span class="date-range">
                    {formatDate(row.rental_start)} ~ {formatDate(row.rental_end)}
                    {#if row.rental_days != null}
                      <span class="rental-days">({row.rental_days}일)</span>
                    {/if}
                  </span>
                </td>
                <td class="col-hide">
                  <span class="method-value">{pickupLabel(row.pickup_method)}</span>
                </td>
                <td class="col-hide">
                  <span class="method-value">{pickupLabel(row.return_method)}</span>
                </td>
              </tr>
            {:else}
              <tr>
                <td colspan="7" class="no-data">조건에 맞는 대여 내역이 없습니다.</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <CmsPagination
        page={data.page}
        totalPages={data.totalPages}
        onpage={goPage}
        variant="bottom"
        ariaLabel="대여현황 목록 페이지 탐색"
      />
    </div>

    <!-- 상세 패널 -->
    {#if selectedId != null && selectedRow}
      <div class="detail-panel-wrap" transition:fly={{ x: 30, duration: 220 }}>
        {#key selectedId}
          <RentalDetailPanel
            row={selectedRow}
            onclose={closePanel}
            onrefresh={invalidateAll}
            isRentalView={true}
          />
        {/key}
      </div>
    {/if}
  </div>
</div>

<style>
  .page-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* 헤더 */
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .header-left { display: flex; flex-direction: column; gap: 2px; }
  .page-title  { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub    { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }

  .btn-to-reservation {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    border: 1px solid var(--cs-lilac);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    text-decoration: none;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
  }
  .btn-to-reservation:hover { background: rgba(59,47,138,0.06); color: var(--cs-purple); }

  /* 툴바 */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .search-wrap { display: flex; align-items: center; gap: 6px; }
  .search-in {
    background: var(--cs-white);
    border: 1px solid #ECEBF4;
    border-radius: var(--radius-sm);
    padding: 10px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 220px;
  }
  .search-in:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
    border-color: var(--cs-purple);
  }
  .btn-secondary {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 20px;
    background: var(--cs-white);
    color: var(--cs-purple-dark);
    border: 1px solid #201857;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-secondary:hover { background: rgba(59,47,138,0.06); }

  .filter-chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 30px;
    border-radius: var(--radius-sm);
    padding: 5px 10px;
    font: var(--text-pc-script-12);
    font-weight: 400;
    white-space: nowrap;
    cursor: pointer;
    border: 1px solid #ECEBF4;
    background: var(--cs-white);
    color: var(--cs-text);
    transition: background 0.12s, color 0.12s;
  }
  .chip:hover  { background: rgba(59,47,138,0.06); }
  .chip-active { background: var(--cs-purple-dark); color: var(--cs-white); border-color: var(--cs-purple-dark); }

  .count-badge {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    background: var(--cs-surface-gray);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
  }

  /* 콘텐츠 레이아웃 */
  .content-area {
    display: flex;
    gap: 16px;
    flex: 1;
    min-height: 0;
  }
  .table-card {
    flex: 1;
    min-width: 0;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
  }
  .table-wrap { overflow-x: auto; flex: 1; }

  .panel-open .table-card { flex: 4; }
  .panel-open .col-hide   { display: none; }

  /* 테이블 */
  table {
    width: 100%;
    min-width: 560px;
    border-collapse: collapse;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  thead th {
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 700;
    padding: 16px 8px;
    text-align: left;
    white-space: nowrap;
    border-bottom: 1px solid #ECEBF4;
  }
  tbody tr {
    border-bottom: 1px solid var(--cs-surface-gray);
    cursor: pointer;
    transition: background 0.12s;
  }
  tbody tr:hover    { background: rgba(59,47,138,0.04); }
  tbody tr.selected { background: rgba(59,47,138,0.08); }
  tbody tr:last-child { border-bottom: none; }
  td {
    padding: 14px 8px;
    vertical-align: middle;
    white-space: nowrap;
  }

  /* 셀 요소 */
  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .rsv-code {
    font-family: monospace;
    font-size: 12px;
    background: var(--cs-surface-gray);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--cs-text);
  }
  .customer-name { font-weight: 700; }
  .product-cell  { display: flex; flex-direction: column; gap: 2px; }
  .product-name  { font-weight: 600; }
  .product-cat   { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .date-range    { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .rental-days   { color: var(--cs-text-light); }
  .method-value  { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .no-data       { text-align: center; padding: 40px 20px; color: var(--cs-text-light); }

  /* 상세 패널 */
  .detail-panel-wrap {
    flex: 6;
    min-width: 0;
  }
</style>
