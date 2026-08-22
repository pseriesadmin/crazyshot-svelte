<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { browser } from '$app/environment'
  import { supabase } from '$lib/services/supabase'
  import { fly } from 'svelte/transition'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import ReservationRentalTabBar from '$lib/components/cms/ReservationRentalTabBar.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import type { PageData } from './$types'
  import type { RentalListRow } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // '전체'는 '완료' 우측(맨 끝)에 배치 — 화면 오픈 시 기본 활성 필터는 '계약완료'(+page.server.ts).
  const STATUS_FILTERS = [
    { label: '계약완료', value: 'confirmed' },
    { label: '배송중',   value: 'shipped' },
    { label: '대여중',   value: 'in_use' },
    { label: '반납요청', value: 'return_requested' },
    { label: '반납완료', value: 'returned' },
    { label: '완료',     value: 'completed' },
    { label: '전체',     value: '' },
  ]

  // 대여 라이프사이클 전용 — pending/hold (예약 단계) 의도적으로 미포함
  const STATUS_LABEL: Record<string, string> = {
    confirmed:        '계약완료',
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
  // 채팅 액션카드 등 외부 링크(?selected=)로 진입 시 초기 진입 1회만 반영 —
  // 이후 선택/해제는 openPanel()/closePanel()이 직접 제어(재동기화 effect 없음)
  let selectedId  = $state<number | null>(data.selectedId ?? null)
  let selectedRow = $state<RentalListRow | null>(null)

  $effect(() => { searchInput = data.search ?? '' })

  $effect(() => {
    if (selectedId != null) {
      const updated = data.rentals.find(r => r.reservation_id === selectedId)
      if (updated) selectedRow = updated
    }
  })

  // Realtime: rental_reservations 상태 변경 시 목록 자동 갱신
  $effect(() => {
    if (!browser) return
    const channel = supabase
      .channel('cms-rentals-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'rental_reservations',
      }, () => {
        invalidateAll()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  })

  function applyFilters() {
    const params = new URLSearchParams()
    // status는 빈 값('전체')이어도 명시적으로 채운다 — 파라미터 자체가 없으면 서버가
    // 최초진입 기본값('계약완료')으로 되돌리므로, '전체' 선택 상태가 유지되게 하려면
    // 빈 문자열이라도 항상 params에 실어 보내야 한다(+page.server.ts 참고).
    params.set('status', data.status ?? '')
    if (searchInput.trim()) params.set('search', searchInput.trim())
    goto(`/cms/rentals?${params.toString()}`, { replaceState: true })
  }

  function setStatus(val: string) {
    const params = new URLSearchParams(window.location.search)
    // '전체'(val === '')도 명시적으로 채운다 — 위 applyFilters와 동일한 이유
    params.set('status', val)
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
  <ReservationRentalTabBar />

  <!-- 툴바 — 검색 UI와 필터 UI를 별도 행으로 분리(2026-08-20) -->
  <div class="toolbar">
    <div class="toolbar-top">
      <div class="search-wrap">
        <input
          class="search-in"
          type="search"
          placeholder="고객명·이메일·상품명·상품코드"
          bind:value={searchInput}
          onkeydown={(e) => e.key === 'Enter' && applyFilters()}
        />
      </div>

      <span class="count-badge">총 {data.totalCount ?? 0}건</span>
    </div>

    <!-- 대여 라이프사이클 진행 순서를 겸하는 내비게이터형 필터 — 계약완료→...→완료는
         버튼 내부 화살표로 "단계"임을 드러내고, '전체'는 구분선으로 분리해 파이프라인
         밖의 리셋 액션임을 시각적으로 구분(CMS 콤보버튼 표준 §7-12-A pill 적용) -->
    <div class="filter-nav" role="group" aria-label="대여 진행 상태 필터">
      {#each STATUS_FILTERS as f}
        {#if f.value === ''}
          <span class="filter-divider" aria-hidden="true"></span>
        {/if}
        <button
          class="chip"
          class:chip-all={f.value === ''}
          class:chip-active={(data.status ?? '') === f.value}
          onclick={() => setStatus(f.value)}
        >
          <span>{f.label}</span>
          {#if f.value !== '' && f.value !== 'completed'}
            <ChevronIcon direction="right" size={6} color="currentColor" />
          {/if}
        </button>
      {/each}
    </div>
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
              <th class="col-hide">상품코드</th>
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
                  {#if row.order_key}
                    <div class="order-key-tag" title="같은 주문으로 묶인 예약">주문 {row.order_key}</div>
                  {/if}
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
                <td colspan="8" class="no-data">조건에 맞는 대여 내역이 없습니다.</td>
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
            stepFilter={['confirmed', 'shipped', 'in_use', 'return_requested', 'returned']}
            cmsRole={data.cmsRole}
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

  /* 툴바 — 검색 행(toolbar-top)과 필터 행(filter-nav)을 세로로 분리(2026-08-20) */
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 24px;                          /* 검색행↔필터행 여백 2배(기존 12px) */
  }
  .toolbar-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
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
    width: 440px;                        /* 기존 220px → 2배 확장, 검색버튼 제거로 엔터 입력만 사용 */
  }
  .search-in:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
    border-color: var(--cs-purple);
  }

  /* 대여 라이프사이클 내비게이터형 필터 — CMS 콤보버튼 표준 §7-12-A(cat-pill/filter-pill
     툴바형: pill 30px, purple↔purple-20)을 베이스로, 미선택 상태도 버튼 UI가 뚜렷이 보이도록
     BG를 --cs-purple-op10(purple-10%, app.css 기존 등록 토큰)로 강화 + 화살표를 버튼 내부로
     이동 + 가로폭 확장(2026-08-20 Stephen 지시 반영) */
  .filter-nav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .filter-divider {
    width: 1px;
    height: 18px;
    background: var(--cs-lilac);
    margin: 0 2px;
    flex-shrink: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: var(--radius-xl);
    padding: 5px 26px;                  /* 상하 5px 추가(기존 0) + 가로폭 확장(기존 16px) */
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    border: none;
    background: var(--cs-purple-op10);  /* purple-10% — 미선택 상태도 버튼 UI로 뚜렷이 노출 */
    color: var(--cs-text);
    transition: background 0.15s, color 0.15s;
  }
  /* 호버 컬러토큰값 유지(기존 var(--cs-purple) 그대로) — 화살표는 currentColor라 함께 전환됨 */
  .chip:hover:not(.chip-active) { color: var(--cs-purple); }
  .chip-active { background: var(--cs-purple); color: var(--cs-white); }
  /* '전체'는 파이프라인 밖의 리셋 액션 — 미선택 시 기본 BG토큰(purple-10) 제거해 다른
     순차 상태 버튼들과 시각적으로 구분(선택되면 다른 칩과 동일하게 chip-active 배경 적용) */
  .chip-all:not(.chip-active) { background: transparent; }

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
  .order-key-tag {
    font: var(--text-pc-script-12);
    font-size: 10px;
    color: var(--cs-text-light);
    margin-top: 2px;
    white-space: nowrap;
  }
  .customer-name { font-weight: 700; }
  .product-cell  { display: flex; flex-direction: column; gap: 2px; }
  .product-name  { font-weight: 600; }
  .product-cat   { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .product-code  {
    font: var(--text-pc-script-12);
    font-family: monospace;
    background: var(--cs-surface-gray);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--cs-text);
  }
  .text-light    { color: var(--cs-text-light); font: var(--text-pc-script-12); }
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
