<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { fly } from 'svelte/transition'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import ReservationRentalTabBar from '$lib/components/cms/ReservationRentalTabBar.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import type { PageData } from './$types'
  import type { RentalListRow } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 예약현황(/cms/reservation) 전용 필터 — 계약완료 이후 상태(대여 라이프사이클)는 이 화면
  // 쿼리에서 애초에 제외되므로(RENTAL_VIEW_STATUSES, +page.server.ts) 해당 정렬버튼은 제거.
  // '전체'는 '취소' 우측(맨 끝)에 배치 — 화면 오픈 시 기본 활성 필터는 '신청대기'(+page.server.ts).
  // '계약대기'(2026-08-20)는 실제 rr.status는 '신청대기'와 동일하게 hold이지만, 전자계약이
  // 발송됐으나 아직 서명되지 않은 건만 골라내는 별도 차원의 조건(contractPending)이라
  // value는 같고 contractPending만 다르게 구분한다 — selectFilter()/chip-active 판정 참고.
  const STATUS_FILTERS: { label: string; value: string; contractPending?: boolean }[] = [
    { label: '신청대기', value: 'hold' },
    { label: '계약대기', value: 'hold', contractPending: true },
    { label: '취소',     value: 'cancelled' },
    { label: '전체',     value: '' },
  ]

  const STATUS_LABEL: Record<string, string> = {
    pending:          '접수',
    hold:             '신청대기',
    confirmed:        '계약완료',
    shipped:          '배송중',
    in_use:           '대여중',
    return_requested: '반납요청',
    returned:         '반납완료',
    completed:        '완료',
    cancelled:        '취소',
    damage_claimed:   '파손신고',
    expired:          '만료됨',
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
    expired:          { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
  }

  let searchInput  = $state(data.search ?? '')
  let dateFrom     = $state(data.dateFrom ?? '')
  let dateTo       = $state(data.dateTo ?? '')
  // 채팅 액션카드 등 외부 링크(?selected=)로 진입 시 초기 진입 1회만 반영 —
  // 이후 선택/해제는 openPanel()/closePanel()이 직접 제어(재동기화 effect 없음)
  let selectedId   = $state<number | null>(data.selectedId ?? null)
  let selectedRow  = $state<RentalListRow | null>(null)

  $effect(() => { searchInput = data.search ?? '' })
  $effect(() => { dateFrom = data.dateFrom ?? '' })
  $effect(() => { dateTo = data.dateTo ?? '' })
  $effect(() => {
    if (selectedId != null) {
      const updated = data.rentals.find(r => r.reservation_id === selectedId)
      if (updated) {
        selectedRow = updated
      } else {
        // RSV-A-C1: 상태 변경 후 invalidateAll로 목록이 갱신됐는데 해당 row가 더 이상
        // 현재 필터에 없으면(예: 승인 → hold 목록에서 사라짐) 패널을 자동으로 닫는다.
        closePanel()
      }
    }
  })

  function applyFilters() {
    // RSV-A-C1: 현재 URL 파라미터를 기준으로 시작해 selected 등 기존 값을 유지한다.
    // 기존에 new URLSearchParams()로 빈 객체를 생성하면 selected 파라미터가 소실됐다.
    const params = new URLSearchParams(window.location.search)
    // status는 빈 값('전체')이어도 명시적으로 채운다 — 파라미터 자체가 없으면 서버가
    // 최초진입 기본값('신청대기')으로 되돌리므로, '전체' 선택 상태가 유지되게 하려면
    // 빈 문자열이라도 항상 params에 실어 보내야 한다(요구사항 1, +page.server.ts 참고).
    params.set('status', data.status ?? '')
    // '계약대기' 선택 상태도 검색·날짜 필터 적용 시 함께 유지
    if (data.contractPending) params.set('contract_pending', '1')
    else params.delete('contract_pending')
    if (searchInput.trim()) params.set('search', searchInput.trim())
    else params.delete('search')
    if (dateFrom) params.set('date_from', dateFrom)
    else params.delete('date_from')
    if (dateTo) params.set('date_to', dateTo)
    else params.delete('date_to')
    params.delete('page')
    goto(`/cms/reservation?${params.toString()}`, { replaceState: true })
  }

  function setStatus(val: string, contractPending = false) {
    const params = new URLSearchParams(window.location.search)
    // '전체'(val === '')도 명시적으로 채운다 — 위 applyFilters와 동일한 이유
    params.set('status', val)
    if (contractPending) params.set('contract_pending', '1')
    else                 params.delete('contract_pending')
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
  <ReservationRentalTabBar />

  <!-- 툴바 — 검색 UI와 필터 UI를 별도 행으로 분리(2026-08-20, /cms/rentals과 동일 레이아웃) -->
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
      </div>

      <span class="count-badge">총 {data.totalCount ?? 0}건</span>
    </div>

    <!-- 대여현황(/cms/rentals)과 동일한 내비게이터형 필터 디자인 적용(2026-08-20) —
         '신청대기'는 다음 단계(승인)로 이어지는 진행 상태라 내부 화살표 부여, '취소'는
         파이프라인의 분기/종결 상태라 화살표 없음, '전체'는 구분선으로 분리한 리셋 액션 -->
    <div class="filter-nav" role="group" aria-label="예약 상태 필터">
      {#each STATUS_FILTERS as f}
        {#if f.value === ''}
          <span class="filter-divider" aria-hidden="true"></span>
        {/if}
        <button
          class="chip"
          class:chip-all={f.value === ''}
          class:chip-active={(data.status ?? '') === f.value && !!data.contractPending === !!f.contractPending}
          onclick={() => setStatus(f.value, f.contractPending)}
        >
          <span>{f.label}</span>
          {#if f.value === 'hold'}
            <ChevronIcon direction="right" size={6} color="currentColor" />
          {/if}
        </button>
      {/each}
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
                  {#if row.status === 'hold' && row.payment_confirmed_at}
                    <span class="status-badge" style="background:rgba(245,158,11,0.12);color:var(--cs-warning);margin-left:4px;">결제완료</span>
                  {/if}
                  {#if row.status === 'hold' && row.signing_sent_at}
                    <span class="status-badge" style="background:rgba(14,165,233,0.12);color:var(--cs-info);margin-left:4px;">계약발송</span>
                  {/if}
                </td>
                <td class="col-hide">
                  <code class="rsv-code">{row.reservation_code ?? reservationNo(row.reservation_id)}</code>
                  {#if row.order_key}
                    <div class="order-key-tag" title="같은 주문으로 묶인 예약">주문 {row.order_key}</div>
                  {/if}
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
            onstatuschange={closePanel}
            stepFilter={['hold', 'confirmed']}
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

  /* 대여현황(/cms/rentals)과 동일한 내비게이터형 필터 디자인(2026-08-20) — CMS 콤보버튼
     표준 §7-12-A pill 기반 + 미선택 BG purple-10 + 버튼 내부 화살표 + 확장 패딩,
     '전체'만 미선택 시 배경 제거 */
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
    padding: 5px 26px;
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    border: none;
    background: var(--cs-purple-op10);
    color: var(--cs-text);
    transition: background 0.15s, color 0.15s;
  }
  .chip:hover:not(.chip-active) { color: var(--cs-purple); }
  .chip-active { background: var(--cs-purple); color: var(--cs-white); }
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
  .order-key-tag {
    font: var(--text-pc-script-12);
    font-size: 10px;
    color: var(--cs-text-light);
    margin-top: 2px;
    white-space: nowrap;
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
