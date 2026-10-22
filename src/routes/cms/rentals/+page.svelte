<script lang="ts">
  import { tick } from 'svelte'
  import { goto, invalidateAll, replaceState } from '$app/navigation'
  import { browser } from '$app/environment'
  import { supabase } from '$lib/services/supabase'
  import { fly } from 'svelte/transition'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import { contractSignRemainingSeconds, formatCountdown, isContractSignUrgent } from '$lib/utils/holdContractTimer'
  import type { PageData } from './$types'
  import type { RentalListRow } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 통합 예약·대여현황(2026-10-22, Stephen 확정 — 예약현황 + 대여현황 한 화면): 임시예약 → 신청대기 → 계약대기 → 계약완료 → … → 완료, 취소·환불·CS, 전체.
  // '계약대기'는 실제 상태가 '신청대기'와 같은 hold 이지만 전자계약이 발송된 건만 골라내는 별도 조건(contractPending)이라 value 는 같고 contractPending 만 다르다.
  // 화면 오픈 시 기본 활성 필터는 '신청대기'(+page.server.ts). '전체' 칩은 없앴다(2026-10-22) — 모든 상태가 다른 칩에 있고 파손신고 건은 '완료' 칩에 합쳤다.
  const STATUS_FILTERS: { label: string; value: string; contractPending?: boolean; arrow?: boolean }[] = [
    // 장바구니에 담기만 하고 아직 예약신청을 제출하지 않은 건(draft) — 고객 구매 패턴 파악용 조회 칩
    { label: '임시예약', value: 'draft' },
    { label: '신청대기', value: 'hold', arrow: true },
    { label: '계약대기', value: 'hold', contractPending: true, arrow: true },
    { label: '계약완료', value: 'confirmed', arrow: true },
    { label: '배송중',   value: 'shipped', arrow: true },
    { label: '대여중',   value: 'in_use', arrow: true },
    // 반납요청 + 반납완료(검수 대기)를 하나로 통합(2026-10-19) — 행 배지로 반납요청 예정/발송·반납등록을 구분
    { label: '반납중',   value: 'returning', arrow: true },
    // 반납중 목록 중 반납 이력정보에 문제가 있어 이슈로 등록된 건(2026-10-17, Migration #724)
    { label: '검수',     value: 'inspection', arrow: true },
    { label: '완료',     value: 'completed' },
    // 결제 전 취소·만료 + 결제 후 취소·환불 + 완료된 CS 접수 건 — 단계 화살표 없음
    { label: '취소·환불·CS', value: 'cancelled_refunded' },
  ]

    const STATUS_LABEL: Record<string, string> = {
    pending:          '접수',
    draft:            '임시',
    hold:             '신청대기',
    expired:          '만료됨',
    confirmed:        '계약완료',
    shipped:          '반출중',
    in_use:           '대여중',
    return_requested: '반납중',
    returned:         '반납완료',
    completed:        '완료',
    damage_claimed:   '파손신고',
    // 취소 행 라벨은 표시 시점에 결정(환불 완료 = '취소·환불', 결제 전 취소 = '취소') — rowStatusLabel 참고
    cancelled:        '취소',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    pending:          { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    draft:            { bg: 'rgba(59,47,138,0.08)',   color: 'var(--cs-purple)' },
    hold:             { bg: 'rgba(245,158,11,0.12)',  color: 'var(--cs-warning)' },
    expired:          { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    confirmed:        { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    shipped:          { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    in_use:           { bg: 'rgba(59,47,138,0.12)',   color: 'var(--cs-purple)' },
    return_requested: { bg: 'rgba(255,69,0,0.12)',    color: 'var(--cs-orange)' },
    returned:         { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    completed:        { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    damage_claimed:   { bg: 'rgba(255,53,53,0.10)',   color: '#CF0000' },
    cancelled:        { bg: 'rgba(255,53,53,0.10)',   color: '#CF0000' },
  }

  // 결제까지 끝난 뒤 PG 환불이 완료된 취소만 '취소·환불', 결제 전 취소·환불 미완료는 '취소'
  function rowStatusLabel(row: RentalListRow): string {
    if (row.status === 'returned' && (data.status ?? '') === 'inspection') return '검수'
    return row.status === 'cancelled' && row.payment_status === 'cancelled' ? '취소·환불' : (STATUS_LABEL[row.status] ?? row.status)
  }

  const PICKUP_LABELS: Record<string, string> = {
    crazydelivery: '크레이지배송',
    quick:         '당일퀵',
    locker:        '무인보관함',
    visit:         '본점방문',
    epost:         '택배',
    cj:            'CJ택배',
  }

  let searchInput = $state(data.search ?? '')
  let dateFrom    = $state(data.dateFrom ?? '')
  let dateTo      = $state(data.dateTo ?? '')
  // 채팅 액션카드 등 외부 링크(?selected=)로 진입 시 초기 진입 1회만 반영 —
  // 이후 선택/해제는 openPanel()/closePanel()이 직접 제어(재동기화 effect 없음)
  let selectedId  = $state<number | null>(data.selectedId ?? null)
  let selectedRow = $state<RentalListRow | null>(null)
  // 예약취소 실행 중에는 목록 새로고침으로 행이 사라져도 패널을 닫지 않는다(취소사유 등록 유지, 2026-10-15)
  let keepOpenId  = $state<number | null>(null)

  $effect(() => { searchInput = data.search ?? '' })
  $effect(() => { dateFrom = data.dateFrom ?? '' })
  $effect(() => { dateTo = data.dateTo ?? '' })

  $effect(() => {
    if (selectedId != null) {
      const updated = data.rentals.find(r => r.reservation_id === selectedId)
      if (updated) selectedRow = updated
      else if (keepOpenId !== selectedId) closePanel()
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
    // 현재 URL 파라미터를 기준으로 시작해 selected 등 기존 값을 유지한다.
    const params = new URLSearchParams(window.location.search)
    // status는 빈 값('전체')이어도 명시적으로 채운다 — 파라미터 자체가 없으면 서버가 최초진입 기본값('신청대기')으로 되돌리므로,
    // '전체' 선택 상태가 유지되게 하려면 빈 문자열이라도 항상 params에 실어 보내야 한다(+page.server.ts 참고).
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
    goto(`/cms/rentals?${params.toString()}`, { replaceState: true })
  }

  function setStatus(val: string, contractPending = false) {
    const params = new URLSearchParams(window.location.search)
    // '전체'(val === '')도 명시적으로 채운다 — 위 applyFilters와 동일한 이유
    params.set('status', val)
    if (contractPending) params.set('contract_pending', '1')
    else                 params.delete('contract_pending')
    params.delete('page')
    params.delete('selected') // 칩 이동 시 열린 패널 선택은 해제 — 취소된 예약 링크의 칩 자동 전환(서버 리다이렉트)과 충돌하지 않게
    goto(`/cms/rentals?${params.toString()}`, { replaceState: true })
  }

  function goPage(p: number) {
    const params = new URLSearchParams(window.location.search)
    params.set('page', p.toString())
    goto(`/cms/rentals?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  // 패널 선택/해제는 주소의 ?selected= 만 맞추면 되므로 데이터를 다시 불러오지 않는 replaceState를 쓴다.
  // (goto는 실시간 새로고침 invalidateAll과 겹쳐 취소되면 CMS 로딩 막이 안 꺼지는 문제가 있었다 — 2026-10-06)
  // 라우터가 아직 준비되기 전(첫 하이드레이션 중 effect)에는 replaceState가 예외를 던지므로 그때만 goto로 대체한다.
  function syncSelectedUrl(url: string) {
    try {
      replaceState(url, {})
    } catch {
      void goto(url, { replaceState: true, noScroll: true })
    }
  }

  function selectRow(row: RentalListRow) {
    selectedId  = row.reservation_id
    selectedRow = row
    const params = new URLSearchParams(window.location.search)
    params.set('selected', String(row.reservation_id))
    syncSelectedUrl(`/cms/rentals?${params.toString()}`)
  }

  // 관리자가 예약을 취소(환불)하면 그 예약이 있는 '취소·환불' 목록으로 전환해 같은 예약을 다시 연다
  async function openInCancelledList(id: number) {
    keepOpenId = id
    try {
      await goto(`/cms/rentals?status=cancelled_refunded&selected=${id}`, { replaceState: true, invalidateAll: true })
      selectedId = id
    } finally { keepOpenId = null }
    await scrollSelectedRowIntoView()
  }

  // 예약승인으로 전자계약이 발송되면 그 예약은 '계약대기' 칩 목록으로 옮겨진다 — 같은 예약의 패널을 열어 둔 채 해당 칩으로 전환하고 목록에서 그 행이 보이게 한다
  async function openInContractPending(id: number) {
    await goto(`/cms/rentals?status=hold&contract_pending=1&selected=${id}`, { replaceState: true, invalidateAll: true })
    selectedId = id
    await scrollSelectedRowIntoView()
  }

  // 계약 발송 후 서명·결제 제한 시간 잔여 표시용 현재 시각 — 마운트 후에만 값이 생기고(서버 렌더 시점 시각으로 잘못 표시되는 것 방지) 1초마다 갱신한다.
  // 제한 시간은 DB release_reservation_hold(Migration 676, 1시간)와 같다(holdContractTimer.ts).
  let nowMs = $state<number | null>(null)
  $effect(() => {
    nowMs = Date.now()
    const timer = setInterval(() => { nowMs = Date.now() }, 1000)
    return () => clearInterval(timer)
  })

  function contractBadge(row: RentalListRow): { label: string; cls: string } {
    if (row.customer_signed_at) return { label: '서명완료', cls: 'signed' }
    if (row.signing_sent_at)    return { label: '발송중',   cls: 'sent' }
    if (row.contract_id)        return { label: '미서명',   cls: 'unsigned' }
    return                             { label: '미발행',   cls: 'none' }
  }

  function draftLabel(id: number): string {
    return '임시-' + id
  }

  // 검수 승인·이슈 등록이 끝나면 그 예약이 옮겨간 칩(완료 / 검수)으로 전환해 같은 예약 패널을 다시 연다
  async function openAfterInspection(id: number, to: 'inspection' | 'completed') {
    keepOpenId = id
    try {
      await goto(`/cms/rentals?status=${to}&selected=${id}`, { replaceState: true, invalidateAll: true })
      selectedId = id
    } finally { keepOpenId = null }
    await scrollSelectedRowIntoView()
  }

  // 취소·환불 칩으로 전환된 뒤에도 이전 목록의 스크롤 위치가 남아 취소 건이 화면 밖에 있을 수 있어, 선택된 행이 보이도록 맞춘다
  async function scrollSelectedRowIntoView() {
    await tick()
    document.querySelector('.table-wrap tr.selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function closePanel() {
    selectedId  = null
    selectedRow = null
    const params = new URLSearchParams(window.location.search)
    params.delete('selected')
    syncSelectedUrl(`/cms/rentals?${params.toString()}`)
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
  <!-- 툴바 — 검색 UI와 필터 UI를 별도 행으로 분리(2026-08-20) -->
  <div class="toolbar">
    <div class="toolbar-top">
      <div class="search-wrap">
        <input
          class="search-in"
          type="search"
          placeholder="고객명·이메일·상품명·상품코드·예약코드"
          bind:value={searchInput}
          onkeydown={(e) => e.key === 'Enter' && applyFilters()}
        />
        <input class="date-in" type="date" bind:value={dateFrom} onchange={applyFilters} aria-label="대여 시작일 필터" />
        <span class="date-sep">~</span>
        <input class="date-in" type="date" bind:value={dateTo} onchange={applyFilters} aria-label="대여 종료일 필터" />
      </div>

      <span class="count-badge">총 {data.totalCount ?? 0}건</span>
    </div>

    <!-- 예약 → 대여 진행 순서를 겸하는 내비게이터형 필터 — 신청대기→...→검수는 버튼 내부 화살표로 "단계"임을 드러내고,
         '전체'는 구분선으로 분리해 취소·환불·CS 는 파이프라인 밖의 종결 상태임을 색으로 구분(CMS 콤보버튼 표준 §7-12-A pill 적용) -->
    <div class="filter-nav" role="group" aria-label="예약·대여 상태 필터">
      {#each STATUS_FILTERS as f}
        {@const countKey = f.contractPending ? 'contract_pending' : f.value}
        <button
          class="chip"
          class:chip-refund={f.value === 'cancelled_refunded'}
          class:chip-active={(data.status ?? '') === f.value && !!data.contractPending === !!f.contractPending}
          onclick={() => setStatus(f.value, f.contractPending)}
        >
          <span>{f.label}</span>
          {#if data.chipCounts?.[countKey] != null}
            <!-- 처리 대기 건수 배지 — 상품 패널 탭 수량 배지(tab-count-badge) 스타일 차용: 있음=red-5%/red, 없음=surface-gray/text-mid -->
            <span class="chip-count" class:is-empty={data.chipCounts[countKey] === 0} aria-label="{f.value === 'completed' || f.value === 'cancelled_refunded' ? '오늘 완료' : '처리 대기'} {data.chipCounts[countKey]}건" title={f.value === 'completed' ? '오늘 완료된 건수' : f.value === 'cancelled_refunded' ? '오늘 취소·완료 처리된 건수' : undefined}>{data.chipCounts[countKey]}</span>
          {/if}
          {#if f.arrow}
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
              <th class="col-hide">결제금액</th>
              <th>계약</th>
              <th class="col-hide">신청일</th>
            </tr>
          </thead>
          <tbody>
            {#each data.rentals as row (row.reservation_id)}
              {@const st = STATUS_STYLE[row.status] ?? STATUS_STYLE['pending']}
              {@const cb = contractBadge(row)}
              <!-- 계약 발송 후 서명·결제 제한 시간 잔여(초) — 관리자 목록 전용. 타이머가 없거나 종료되면 null이라 가린다. -->
              {@const remainSec = nowMs !== null ? contractSignRemainingSeconds(row, nowMs) : null}
              <tr
                class:selected={selectedId === row.reservation_id}
                onclick={() => selectRow(row)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && selectRow(row)}
                aria-label="{row.customer_name} 대여 상세 보기"
              >
                <td>
                  {#if row.cancel_pending}
                    <!-- 고객 취소 요청/취소 후 관리자 승인 대기 — 패널 헤더 [예약취소]로 처리(환불은 요청 건에서 이 버튼이 실행) -->
                    <span class="status-badge" style="background:{STATUS_STYLE.cancelled.bg};color:{STATUS_STYLE.cancelled.color}">취소대기</span>
                  {:else if row.status === 'hold' && !row.signing_sent_at && data.contractPending}
                    <!-- '계약대기' 칩에서 계약서가 아직 발송되지 않은 행 = 예약승인만 된 예약(승인 시각, Migration #719) — 신청대기와 구분해 표시 -->
                    <span class="status-badge" style="background:rgba(16,185,129,0.12);color:var(--cs-success-light)">승인완료 · 계약 미발송</span>
                  {:else if !(row.status === 'hold' && row.signing_sent_at) && !(row.status === 'in_use' && (data.status ?? '') === 'returning')}
                    <!-- 계약서가 발송된 신청대기는 '신청대기' 대신 계약 진행 배지(계약발송/서명완료)만 보인다. '반납중' 칩에서는 대여중 배지를 달지 않는다(반납 일시가 지나 반납 단계 배지가 대신한다) -->
                    <span class="status-badge" style="background:{st.bg};color:{st.color}">
                      {rowStatusLabel(row)}
                    </span>
                  {/if}
                  {#if row.status_mixed && !row.cancel_pending}
                    <!-- 주문 1건 = 1행(Migration 618): 같은 주문의 상품들이 서로 다른 단계일 때 표기(상태는 가장 덜 진행된 단계) -->
                    <span class="status-badge" style="background:rgba(14,165,233,0.12);color:var(--cs-info)">일부 진행</span>
                  {/if}
                  {#if row.status === 'hold' && row.payment_confirmed_at}
                    <span class="status-badge" style="background:rgba(245,158,11,0.12);color:var(--cs-warning);margin-left:4px;">결제완료</span>
                  {/if}
                  {#if row.status === 'hold' && row.customer_signed_at}
                    <span class="status-badge" style="background:rgba(56,142,60,0.12);color:var(--cs-success);margin-left:4px;">서명완료{#if remainSec !== null}<span class="badge-remain" class:badge-remain-urgent={isContractSignUrgent(remainSec)} role="timer" title="계약 발송 후 서명·결제 제한 시간 — {formatCountdown(remainSec)} 남음(지나면 예약신청이 자동 만료됩니다)">{formatCountdown(remainSec)}</span>{/if}</span>
                  {:else if row.status === 'hold' && row.signing_sent_at}
                    <span class="status-badge" style="background:rgba(14,165,233,0.12);color:var(--cs-info);margin-left:4px;">계약발송{#if remainSec !== null}<span class="badge-remain" class:badge-remain-urgent={isContractSignUrgent(remainSec)} role="timer" title="계약 발송 후 서명·결제 제한 시간 — {formatCountdown(remainSec)} 남음(지나면 예약신청이 자동 만료됩니다)">{formatCountdown(remainSec)}</span>{/if}</span>
                  {/if}
                  {#if row.return_stage && (data.status ?? '') === 'returning'}
                    <!-- 반납중 칩 배지: 반납요청 예정(알림 발송 전까지만) · 반납등록(고객이 반납 이력정보 등록). 알림이 발송되면 예정 배지는 조용히 사라진다 -->
                    {#if row.return_stage === 'registered'}
                      <span class="status-badge" style="background:{STATUS_STYLE.confirmed.bg};color:{STATUS_STYLE.confirmed.color}">반납등록</span>
                    {:else if row.return_stage === 'notice_due'}
                      <span class="status-badge" style="background:rgba(255,69,0,0.12);color:var(--cs-orange)">반납요청 예정</span>
                    {/if}
                  {/if}
                  {#if row.prior_issue}
                    <!-- CS 사전 이슈 접수 건(3단계) — 반납완료 시 검수 칩으로 자동 이동, 고객 증빙과 실물을 비교 검수 -->
                    <span class="status-badge" style="background:{STATUS_STYLE.cancelled.bg};color:{STATUS_STYLE.cancelled.color}">사전접수건</span>
                  {/if}
                  {#if row.dhero_status}
                    <span class="dhero-mini-badge">{row.dhero_status}</span>
                  {/if}
                </td>
                <td class="col-hide">
                  {#if row.status === 'draft'}
                    <!-- 임시예약은 예약코드가 없다 — 예약신청 제출 시 주문 단위 통합 코드가 한 번만 발행된다. 구분용 표시 이름만 id로 만든다(저장 안 함) -->
                    <code class="rsv-code">{draftLabel(row.reservation_id)}</code>
                  {:else}
                    <code class="rsv-code">{row.reservation_code ?? `CZ-${String(row.reservation_id).padStart(5,'0')}`}</code>
                  {/if}
                </td>
                <td>
                  <span class="customer-name">{row.customer_name ?? '-'}</span>
                </td>
                <td>
                  <div class="product-cell">
                    <span class="product-name">{row.product_name}</span>
                    {#if (row.order_item_count ?? 1) > 1}
                      <span class="product-more" title="같은 주문(예약코드)에 묶인 상품 {row.order_item_count}건">외 {row.order_item_count - 1}건</span>
                    {/if}
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
                    {#if row.rental_days_label}
                      <span class="rental-days">({row.rental_days_label})</span>
                    {/if}
                  </span>
                </td>
                <td class="col-hide">
                  <span class="method-value">{pickupLabel(row.pickup_method)}</span>
                </td>
                <td class="col-hide">
                  <span class="method-value">{pickupLabel(row.return_method)}</span>
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
                <td colspan="11" class="no-data">조건에 맞는 예약·대여 내역이 없습니다.</td>
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
            oncancelled={openInCancelledList}
            oninspectionchange={openAfterInspection}
            onstatuschange={closePanel}
            oncontractsent={openInContractPending}
            oncancelstate={(pending) => { keepOpenId = pending ? selectedId : null }}
            isRentalView={!['draft', 'hold', 'pending', 'expired'].includes(selectedRow.status) && !(selectedRow.status === 'cancelled' && !selectedRow.payment_confirmed_at)}
            hideChangeCancelButtons={(data.status ?? '') === 'returning' || (data.status ?? '') === 'inspection'}
            stepFilter={['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned']}
            cmsRole={data.cmsRole}
            canChangeOrCancelReservation={data.canChangeOrCancelReservation}
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
    outline: 2px solid var(--cs-focus-ring);
    outline-offset: -2px;
    border-color: var(--cs-focus-ring);
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
  .chip-count {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 18px; height: 18px; margin-left: -3px; padding: 0 5px;
    border-radius: var(--radius-full, 99px);
    font: var(--text-pc-descript-10); line-height: 18px;
    background: var(--cs-red-xlight); color: var(--cs-red);
  }
  .chip-count.is-empty { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  /* '전체'는 파이프라인 밖의 리셋 액션 — 미선택 시 기본 BG토큰(purple-10) 제거해 다른
     순차 상태 버튼들과 시각적으로 구분(선택되면 다른 칩과 동일하게 chip-active 배경 적용) */
  .chip-all:not(.chip-active) { background: transparent; }
  /* '취소·환불'은 일반 진행 단계와 구분되는 종료 상태 — 미선택 시 극연한 레드(red-5%), 선택 시 레드(red-100, 흰 글자 대비 확보) */
  .chip-refund:not(.chip-active) { background: var(--cs-red-xlight); }
  .chip-refund.chip-active { background: var(--cs-red); }

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
  /* 두발히어로 배송 상태 미니 배지 (status 칸에 서브로 표시) */
  .dhero-mini-badge {
    display: block;
    margin-top: 3px;
    padding: 1px 7px;
    border-radius: var(--radius-full, 99px);
    font-size: 10px;
    font-weight: 600;
    background: #ede9fe;
    color: #5b21b6;
    white-space: nowrap;
    width: fit-content;
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
  .product-more  { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text-mid); }
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

  /* 통합(2026-10-22): 예약현황에서 옮겨온 기간 필터·금액·계약 배지·계약 잔여시간 스타일 */
  .date-in {
    background: var(--cs-white);
    border: 1px solid #ECEBF4;
    border-radius: var(--radius-sm);
    padding: 10px 10px;
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    width: 130px;
  }
  .date-in:focus { outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; border-color: var(--cs-focus-ring); }
  .date-sep { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .amount { font-weight: 700; color: var(--cs-text); }
  .badge-remain-urgent { color: var(--cs-red); opacity: 1; }
  .badge-remain { margin-left: 6px; font: var(--text-pc-tag-11); font-weight: 400; opacity: 0.75; font-variant-numeric: tabular-nums; white-space: nowrap; }
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
</style>
