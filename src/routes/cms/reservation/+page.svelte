<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { fly } from 'svelte/transition'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import { csToast } from '$lib/utils/toast'
  import type { PageData } from './$types'
  import type { RentalListRow } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const STATUS_FILTERS = [
    { label: '전체',     value: '' },
    { label: '신청대기', value: 'hold' },
    { label: '승인완료', value: 'confirmed' },
    { label: '배송중',   value: 'shipped' },
    { label: '대여중',   value: 'in_use' },
    { label: '반납요청', value: 'return_requested' },
    { label: '반납완료', value: 'returned' },
    { label: '완료',     value: 'completed' },
    { label: '취소',     value: 'cancelled' },
  ]

  const STATUS_LABEL: Record<string, string> = {
    pending:          '접수',
    hold:             '신청대기',
    confirmed:        '승인완료',
    shipped:          '배송중',
    in_use:           '대여중',
    return_requested: '반납요청',
    returned:         '반납완료',
    completed:        '완료',
    cancelled:        '취소',
    damage_claimed:   '파손신고',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    pending:          { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    hold:             { bg: 'rgba(245,158,11,0.12)',  color: 'var(--cs-warning)' },
    confirmed:        { bg: 'rgba(16,185,129,0.12)',  color: 'var(--cs-success-light)' },
    shipped:          { bg: 'rgba(14,165,233,0.12)',  color: 'var(--cs-info)' },
    in_use:           { bg: 'rgba(59,47,138,0.12)',   color: 'var(--cs-purple)' },
    return_requested: { bg: 'rgba(255,69,0,0.12)',    color: 'var(--cs-orange)' },
    returned:         { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    completed:        { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    cancelled:        { bg: 'rgba(255,53,53,0.10)',   color: 'var(--cs-red-badge)' },
    damage_claimed:   { bg: 'rgba(255,53,53,0.10)',   color: 'var(--cs-red-badge)' },
  }

  let searchInput  = $state(data.search ?? '')
  let dateFrom     = $state(data.dateFrom ?? '')
  let dateTo       = $state(data.dateTo ?? '')
  let selectedId   = $state<number | null>(null)
  let selectedRow  = $state<RentalListRow | null>(null)

  $effect(() => { searchInput = data.search ?? '' })
  $effect(() => { dateFrom = data.dateFrom ?? '' })
  $effect(() => { dateTo = data.dateTo ?? '' })
  $effect(() => {
    if (selectedId != null) {
      const updated = data.rentals.find(r => r.reservation_id === selectedId)
      if (updated) selectedRow = updated
    }
  })

  function applyFilters() {
    const params = new URLSearchParams()
    if (data.status)     params.set('status', data.status)
    if (searchInput.trim()) params.set('search', searchInput.trim())
    if (dateFrom)        params.set('date_from', dateFrom)
    if (dateTo)          params.set('date_to', dateTo)
    params.delete('page')
    goto(`/cms/reservation?${params.toString()}`, { replaceState: true })
  }

  function setStatus(val: string) {
    const params = new URLSearchParams(window.location.search)
    if (val) params.set('status', val); else params.delete('status')
    params.delete('page')
    goto(`/cms/reservation?${params.toString()}`, { replaceState: true })
  }

  function goPage(p: number) {
    const params = new URLSearchParams(window.location.search)
    params.set('page', p.toString())
    goto(`/cms/reservation?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function selectRow(row: RentalListRow) {
    selectedId  = row.reservation_id
    selectedRow = row
    const params = new URLSearchParams(window.location.search)
    params.set('selected', String(row.reservation_id))
    goto(`/cms/reservation?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function closePanel() {
    selectedId  = null
    selectedRow = null
    const params = new URLSearchParams(window.location.search)
    params.delete('selected')
    goto(`/cms/reservation?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }

  function contractBadge(row: RentalListRow): { label: string; cls: string } {
    if (row.customer_signed_at) return { label: '서명완료', cls: 'signed' }
    if (row.signing_sent_at)    return { label: '발송중',   cls: 'sent' }
    if (row.contract_id)        return { label: '미서명',   cls: 'unsigned' }
    return                             { label: '미발행',   cls: 'none' }
  }

  function reservationNo(id: number): string {
    return 'CZ-' + String(id).padStart(5, '0')
  }
</script>

<div class="page-wrap">
  <div class="page-header">
    <h1 class="page-title">예약목록</h1>
    <p class="page-sub">신청 → 계약 → 승인 파이프라인을 관리합니다.</p>
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
        <input
          class="date-in"
          type="date"
          bind:value={dateFrom}
          onchange={applyFilters}
          aria-label="대여 시작일 필터"
        />
        <span class="date-sep">~</span>
        <input
          class="date-in"
          type="date"
          bind:value={dateTo}
          onchange={applyFilters}
          aria-label="대여 종료일 필터"
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

    <div class="toolbar-right">
      <span class="count-badge">총 {data.totalCount ?? 0}건</span>
    </div>
  </div>

  <!-- 콘텐츠 영역 -->
  <div class="content-area" class:panel-open={selectedId != null}>
    <!-- 테이블 -->
    <div class="table-card">
      <CmsPagination
        page={data.page}
        totalPages={data.totalPages}
        onpage={goPage}
        variant="top"
        ariaLabel="예약 목록 페이지 탐색"
      />
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>상태</th>
              <th class="col-hide">예약번호</th>
              <th>고객명</th>
              <th>상품명</th>
              <th class="col-hide">상품코드</th>
              <th>대여기간</th>
              <th class="col-hide">결제금액</th>
              <th>계약</th>
              <th class="col-hide">신청일</th>
            </tr>
          </thead>
          <tbody>
            {#each data.rentals as row (row.reservation_id)}
              {@const st = STATUS_STYLE[row.status] ?? STATUS_STYLE['pending']}
              {@const cb = contractBadge(row)}
              <tr
                class:selected={selectedId === row.reservation_id}
                onclick={() => selectRow(row)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && selectRow(row)}
                aria-label="{row.customer_name} 예약 상세 보기"
              >
                <td>
                  <span class="status-badge" style="background:{st.bg};color:{st.color}">
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </td>
                <td class="col-hide">
                  <code class="rsv-code">{row.reservation_code ?? reservationNo(row.reservation_id)}</code>
                </td>
                <td><span class="customer-name">{row.customer_name ?? '-'}</span></td>
                <td>
                  <span class="product-name">{row.product_name}</span>
                  {#if row.product_category}
                    <span class="product-cat">{row.product_category}</span>
                  {/if}
                </td>
                <td class="col-hide">
                  {#if row.product_code}
                    <code class="product-code">{row.product_code}</code>
                  {:else}
                    <span class="text-light">-</span>
                  {/if}
                </td>
                <td>
                  <span class="date-range">
                    {formatDate(row.rental_start)} ~ {formatDate(row.rental_end)}
                  </span>
                </td>
                <td class="col-hide">
                  {#if row.order_amount != null}
                    <span class="amount">{row.order_amount.toLocaleString('ko-KR')}원</span>
                  {:else}
                    <span class="text-light">-</span>
                  {/if}
                </td>
                <td>
                  <span class="contract-badge contract-{cb.cls}">{cb.label}</span>
                </td>
                <td class="col-hide">{formatDate(row.created_at)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="9" class="no-data">조건에 맞는 예약이 없습니다.</td>
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
        ariaLabel="예약 목록 페이지 탐색"
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
            stepFilter={['hold', 'confirmed']}
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

  .page-header { margin-bottom: 4px; }
  .page-title  { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub    { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }

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
  .date-in {
    background: var(--cs-white);
    border: 1px solid #ECEBF4;
    border-radius: var(--radius-sm);
    padding: 10px 10px;
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    width: 130px;
  }
  .date-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: var(--cs-purple); }
  .date-sep { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

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
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
  }
  .table-wrap { overflow-x: auto; flex: 1; }

  .panel-open .table-card { flex: 4; }
  .panel-open .col-hide   { display: none; }
  .panel-open table       { min-width: 0; }

  table {
    width: 100%;
    min-width: 680px;
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
    white-space: nowrap;
  }
  .rsv-code {
    font: var(--text-pc-script-12);
    font-family: monospace;
    background: var(--cs-surface-gray);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--cs-text);
  }
  .customer-name { font-weight: 700; color: var(--cs-text); }
  .product-name  { font-weight: 600; color: var(--cs-text); }
  .product-cat   { font: var(--text-pc-script-12); color: var(--cs-text-light); margin-left: 4px; }
  .product-code  {
    font: var(--text-pc-script-12);
    font-family: monospace;
    background: var(--cs-surface-gray);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--cs-text);
  }
  .date-range { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .amount     { font-weight: 700; color: var(--cs-text); }
  .text-light { color: var(--cs-text-light); font: var(--text-pc-script-12); }

  /* 계약 배지 */
  .contract-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .contract-signed   { background: rgba(16,185,129,0.12);  color: var(--cs-success-light); }
  .contract-sent     { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .contract-unsigned { background: rgba(245,158,11,0.12);  color: var(--cs-warning); }
  .contract-none     { background: rgba(102,102,102,0.10); color: var(--cs-text-light); }

  .no-data { text-align: center; padding: 40px 20px; color: var(--cs-text-light); font: var(--text-pc-body-14); }

  /* 상세 패널 */
  .detail-panel-wrap {
    flex: 6;
    min-width: 0;
  }
</style>
