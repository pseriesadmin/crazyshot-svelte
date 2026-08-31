<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { enhance } from '$app/forms'
  import { fly } from 'svelte/transition'
  import CustomerDetailPanel from '$lib/components/cms/CustomerDetailPanel.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { CustomerRow } from './+page.server'

  interface Props {
    data: PageData
    form: ActionData
  }
  let { data, form }: Props = $props()

  // 인증분류(일반/학생/구독) — 2026-09-01 재구성. easy/pop/crazy(membership_grade)는 고객등급이
  // 아니라 정기구독 상품 티어이므로, 실제 고객 분류는 인증 상태 기준 3종으로 별도 정의한다.
  // 한 고객이 학생이면서 동시에 구독자일 수 있어(Stephen 확정) 다중선택 필터 + 배지 복수표시.
  const CLASSIFICATIONS = [
    { value: 'general',    label: '일반' },
    { value: 'student',    label: '학생' },
    { value: 'subscriber', label: '구독' },
  ]

  // 고객 1명이 해당하는 분류 전부 반환(복수 가능) — 일반은 학생·구독 어디에도 해당 안 될 때만
  function classificationsOf(row: CustomerRow): string[] {
    const tags: string[] = []
    if (row.is_student) tags.push('student')
    if (row.membership_grade && row.membership_grade !== 'NONE') tags.push('subscriber')
    if (tags.length === 0) tags.push('general')
    return tags
  }

  const BL_OPTIONS = [
    { value: '',      label: '전체' },
    { value: 'false', label: '정상' },
    { value: 'true',  label: '블랙리스트' },
  ]

  let searchInput = $state(data.search ?? '')
  // /cms/subscriptions 구독자현황 탭 등에서 ?selected=<user_id>(+?tab=)로 딥링크 진입 시
  // 서버 load()가 이미 조회해둔 값으로 초기 상태를 채운다(페이지네이션·필터와 무관한 단건 조회).
  let selectedUserId = $state<string | null>(data.selected ?? null)
  let selectedRow = $state<CustomerRow | null>(data.selectedCustomer ?? null)

  // invalidateAll() 후 data.customers가 갱신되면 selectedRow도 최신 데이터로 동기화
  $effect(() => {
    if (selectedUserId) {
      const updated = data.customers.find(c => c.user_id === selectedUserId)
      if (updated) selectedRow = updated
    }
  })

  $effect(() => { searchInput = data.search ?? '' })

  $effect(() => {
    if (form?.ok === true) {
      csToast.success('처리되었습니다.')
      invalidateAll()
    } else if (form?.ok === false && form.error) {
      csToast.error(form.error)
    }
  })

  function applySearch() {
    const params = new URLSearchParams()
    if (searchInput.trim()) params.set('search', searchInput.trim())
    if (data.classifications.length > 0) params.set('classification', data.classifications.join(','))
    if (data.bl) params.set('bl', data.bl)
    params.delete('page')
    goto(`/cms/customers?${params.toString()}`, { replaceState: true })
  }

  // 다중선택 토글 — 이미 선택된 값이면 해제, 아니면 추가
  function toggleClassification(val: string) {
    const params = new URLSearchParams(window.location.search)
    const next = data.classifications.includes(val)
      ? data.classifications.filter((v) => v !== val)
      : [...data.classifications, val]
    if (next.length > 0) params.set('classification', next.join(',')); else params.delete('classification')
    params.delete('page')
    goto(`/cms/customers?${params.toString()}`, { replaceState: true })
  }

  function setBl(val: string) {
    const params = new URLSearchParams(window.location.search)
    if (val) params.set('bl', val); else params.delete('bl')
    params.delete('page')
    goto(`/cms/customers?${params.toString()}`, { replaceState: true })
  }

  function goPage(p: number) {
    const params = new URLSearchParams(window.location.search)
    params.set('page', p.toString())
    goto(`/cms/customers?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function selectUser(row: CustomerRow) {
    selectedUserId = row.user_id
    selectedRow = row  // 즉시 패널 표시; $effect가 data 갱신 후 최신값으로 덮어씀
    const params = new URLSearchParams(window.location.search)
    params.set('selected', row.user_id)
    params.delete('tab') // 목록에서 직접 클릭한 경우 이전 딥링크의 tab이 남아있지 않도록 초기화
    goto(`/cms/customers?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function closePanel() {
    selectedUserId = null
    selectedRow = null
    const params = new URLSearchParams(window.location.search)
    params.delete('selected')
    params.delete('tab')
    goto(`/cms/customers?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function getScoreClass(score: number): string {
    if (score >= 85) return 'score-high'
    if (score >= 70) return 'score-mid'
    if (score >= 50) return 'score-low'
    return 'score-critical'
  }

  function getDepositRate(score: number): string {
    if (score >= 85) return '0%'
    if (score >= 70) return '30%'
    if (score >= 50) return '50%'
    return '100%'
  }

  function classificationLabel(c: string): string {
    return CLASSIFICATIONS.find((x) => x.value === c)?.label ?? c
  }

  function formatDate(dt: string): string {
    return dt ? dt.slice(0, 10) : '-'
  }

  const totalPages = $derived(Math.ceil((data.totalCount ?? 0) / 30))
</script>

<div class="page-wrap">
  <div class="page-header">
    <h1 class="page-title">고객목록</h1>
    <p class="page-sub">회원 정보·크레이지스코어·블랙리스트를 관리합니다.</p>
  </div>

  <!-- 툴바 -->
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="search-wrap">
        <input
          class="search-in"
          type="search"
          placeholder="이름·이메일·전화번호 검색"
          bind:value={searchInput}
          onkeydown={(e) => e.key === 'Enter' && applySearch()}
        />
        <button class="btn-secondary" onclick={applySearch}>검색</button>
      </div>

      <div class="filter-chips">
        {#each CLASSIFICATIONS as c}
          <button
            class="chip"
            class:chip-active={data.classifications.includes(c.value)}
            onclick={() => toggleClassification(c.value)}
          >{c.label}</button>
        {/each}
      </div>

      <div class="filter-chips">
        {#each BL_OPTIONS as opt}
          <button
            class="chip"
            class:chip-active={(data.bl ?? '') === opt.value}
            onclick={() => setBl(opt.value)}
          >{opt.label}</button>
        {/each}
      </div>
    </div>

    <div class="toolbar-right">
      <span class="count-badge">총 {data.totalCount ?? 0}명</span>
    </div>
  </div>

  <!-- 콘텐츠 영역 -->
  <div class="content-area" class:panel-open={!!selectedUserId}>
    <!-- 테이블 -->
    <div class="table-card">
      <CmsPagination
        page={data.page}
        totalPages={totalPages}
        onpage={goPage}
        variant="top"
        ariaLabel="고객 목록 페이지 탐색"
      />
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="th-badge"></th>
              <th>이름</th>
              <th>이메일</th>
              <th class="col-hide">회원번호</th>
              <th class="col-hide">전화번호</th>
              <th>분류</th>
              <th class="col-hide">크레이지스코어</th>
              <th class="col-hide">보증금율</th>
              <th class="col-hide">포인트</th>
              <th>상태</th>
              <th class="col-hide">가입일</th>
            </tr>
          </thead>
          <tbody>
            {#each data.customers as row (row.user_id)}
              <tr
                class:selected={selectedUserId === row.user_id}
                class:blacklisted-row={row.blacklisted}
                onclick={() => selectUser(row)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && selectUser(row)}
                aria-label="{row.name ?? row.email} 상세 보기"
              >
                <td class="td-badge">
                  {#if row.cms_role}
                    <span class="badge-m" title={row.cms_role}>M</span>
                  {/if}
                </td>
                <td><span class="user-name">{row.name ?? '-'}</span></td>
                <td><span class="user-email">{row.email}</span></td>
                <td class="col-hide">
                  {#if row.member_code}
                    <code class="member-code">{row.member_code}</code>
                  {:else}
                    <span class="text-light">미배정</span>
                  {/if}
                </td>
                <td class="col-hide">{row.phone ?? '-'}</td>
                <td>
                  <div class="classification-badges">
                    {#each classificationsOf(row) as c}
                      <span class="grade-badge grade-{c}">{classificationLabel(c)}</span>
                    {/each}
                  </div>
                </td>
                <td class="col-hide">
                  <span class="score-val {getScoreClass(row.credit_score)}">
                    {row.credit_score}점
                  </span>
                </td>
                <td class="col-hide">
                  <span class="deposit-rate">{getDepositRate(row.credit_score)}</span>
                </td>
                <td class="col-hide">{row.points.toLocaleString('ko-KR')}P</td>
                <td>
                  {#if row.withdrawal_status && row.withdrawal_status !== 'none'}
                    <span class="badge-withdrawn">탈회</span>
                  {:else if row.blacklisted}
                    <span class="badge-danger">블랙리스트</span>
                  {:else}
                    <span class="badge-normal">정상</span>
                  {/if}
                </td>
                <td class="col-hide">{formatDate(row.created_at)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="11" class="no-data">조건에 맞는 회원이 없습니다.</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <CmsPagination
        page={data.page}
        totalPages={totalPages}
        onpage={goPage}
        variant="bottom"
        ariaLabel="고객 목록 페이지 탐색"
      />
    </div>

    <!-- 상세 패널 -->
    {#if selectedUserId && selectedRow}
      <div class="detail-panel-wrap" transition:fly={{ x: 30, duration: 220 }}>
        {#key selectedUserId}
          <CustomerDetailPanel
            row={selectedRow}
            onclose={closePanel}
            initialTab={data.selected === selectedUserId ? data.tab : null}
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
  .search-wrap {
    display: flex;
    gap: 6px;
  }
  .search-in {
    background: var(--cs-white);
    border: 1px solid #ECEBF4;
    border-radius: var(--radius-sm);
    padding: 10px 20px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 240px;
  }
  .search-in:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
    border-color: var(--cs-purple);
  }

  /* 필터 칩 */
  .filter-chips {
    display: flex;
    gap: 4px;
  }
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
  .chip:hover     { background: rgba(59,47,138,0.06); }
  .chip-active    { background: var(--cs-purple-dark); color: var(--cs-white); border-color: var(--cs-purple-dark); }
  .chip:focus-visible {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
    border-color: var(--cs-purple);
  }

  .count-badge {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    background: var(--cs-surface-gray);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
  }

  /* 버튼 */
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
    text-decoration: none;
  }
  .btn-secondary:hover { background: rgba(59,47,138,0.06); }

  .btn-action {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-action:hover    { background: var(--cs-purple-hover); }
  .btn-action:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

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

  /* 패널 오픈 시 4:6 비율 */
  .panel-open .table-card {
    flex: 4;
  }
  .panel-open .col-hide {
    display: none;
  }
  .panel-open table {
    min-width: 0;
  }

  table {
    width: 100%;
    min-width: 720px;
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
  tbody tr:hover { background: rgba(59,47,138,0.04); }
  tbody tr.selected { background: rgba(59,47,138,0.08); }
  tbody tr.blacklisted-row { background: rgba(255,53,53,0.04); }
  tbody tr:last-child { border-bottom: none; }
  td {
    padding: 16px 8px;
    vertical-align: middle;
    white-space: nowrap;
  }

  /* 셀 요소 */
  .user-name  { font-weight: 700; color: var(--cs-text); white-space: nowrap; }
  .user-email { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }

  /* 관리자 배지 컬럼 */
  .th-badge { width: 36px; padding: 10px 8px 10px 16px; }
  .td-badge { padding: 10px 4px 10px 16px; vertical-align: middle; }
  .badge-m {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px;
    border-radius: 6px;
    background: rgba(59,47,138,0.10); color: var(--cs-purple);
    font-size: 11px; font-weight: 700; font-family: 'Noto Sans KR', sans-serif;
    line-height: 1; cursor: default;
  }
  .member-code {
    font: var(--text-pc-script-12);
    font-family: monospace;
    background: var(--cs-surface-gray);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--cs-text);
  }
  .text-light { color: var(--cs-text-light); font: var(--text-pc-script-12); }

  /* 인증분류 배지(일반/학생/구독) — 한 고객이 복수 배지를 가질 수 있음(2026-09-01) */
  .classification-badges {
    display: inline-flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .grade-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
  }
  .grade-general    { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .grade-student    { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .grade-subscriber { background: rgba(59,47,138,0.10);   color: var(--cs-purple); }

  /* 스코어 */
  .score-val { font-weight: 700; }
  .score-high     { color: var(--cs-success-light); }
  .score-mid      { color: var(--cs-text); }
  .score-low      { color: var(--cs-warning); }
  .score-critical { color: var(--cs-red-badge); }
  .deposit-rate { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

  /* 상태 배지 */
  .badge-normal { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: var(--radius-sm); font: var(--text-pc-script-12); background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
  .badge-danger { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: var(--radius-sm); font: var(--text-pc-script-12); background: rgba(255,53,53,0.10); color: var(--cs-red-badge); }
  .badge-withdrawn { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: var(--radius-sm); font: var(--text-pc-script-12); background: rgba(255,53,53,0.10); color: var(--cs-red-badge); }

  .no-data { text-align: center; padding: 40px 20px; color: var(--cs-text-light); font: var(--text-pc-body-14); }

  /* 상세 패널 */
  .detail-panel-wrap {
    flex: 6;
    min-width: 0;
  }
</style>
