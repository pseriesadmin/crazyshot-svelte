<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { enhance } from '$app/forms'
  import { fly } from 'svelte/transition'
  import CustomerDetailPanel from '$lib/components/cms/CustomerDetailPanel.svelte'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { CustomerRow } from './+page.server'

  interface Props {
    data: PageData
    form: ActionData
  }
  let { data, form }: Props = $props()

  const GRADES = [
    { value: '',      label: '전체 등급' },
    { value: 'none',  label: 'NONE' },
    { value: 'easy',  label: 'EASY' },
    { value: 'pop',   label: 'POP' },
    { value: 'crazy', label: 'CRAZY' },
  ]

  const BL_OPTIONS = [
    { value: '',      label: '전체' },
    { value: 'false', label: '정상' },
    { value: 'true',  label: '블랙리스트' },
  ]

  let searchInput = $state(data.search ?? '')
  let selectedUserId = $state<string | null>(null)
  let selectedRow = $state<CustomerRow | null>(null)

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
    if (data.grade) params.set('grade', data.grade)
    if (data.bl) params.set('bl', data.bl)
    params.delete('page')
    goto(`/cms/customers?${params.toString()}`, { replaceState: true })
  }

  function setGrade(val: string) {
    const params = new URLSearchParams(window.location.search)
    if (val) params.set('grade', val); else params.delete('grade')
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
    selectedRow    = row
    const params = new URLSearchParams(window.location.search)
    params.set('selected', row.user_id)
    goto(`/cms/customers?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function closePanel() {
    selectedUserId = null
    selectedRow    = null
    const params = new URLSearchParams(window.location.search)
    params.delete('selected')
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

  function gradeLabel(g: string): string {
    return g.toUpperCase()
  }

  function formatDate(dt: string): string {
    return dt ? dt.slice(0, 10) : '-'
  }

  const totalPages = $derived(Math.ceil((data.totalCount ?? 0) / 50))
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
        {#each GRADES as g}
          <button
            class="chip"
            class:chip-active={(data.grade ?? '') === g.value}
            onclick={() => setGrade(g.value)}
          >{g.label}</button>
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
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="th-badge"></th>
              <th>이름</th>
              <th>이메일</th>
              <th>회원번호</th>
              <th>전화번호</th>
              <th>등급</th>
              <th>크레이지스코어</th>
              <th>보증금율</th>
              <th>포인트</th>
              <th>상태</th>
              <th>가입일</th>
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
                <td>
                  {#if row.member_code}
                    <code class="member-code">{row.member_code}</code>
                  {:else}
                    <span class="text-light">미배정</span>
                  {/if}
                </td>
                <td>{row.phone ?? '-'}</td>
                <td>
                  <span class="grade-badge grade-{row.membership_grade}">
                    {gradeLabel(row.membership_grade)}
                  </span>
                </td>
                <td>
                  <span class="score-val {getScoreClass(row.credit_score)}">
                    {row.credit_score}점
                  </span>
                </td>
                <td>
                  <span class="deposit-rate">{getDepositRate(row.credit_score)}</span>
                </td>
                <td>{row.points.toLocaleString('ko-KR')}P</td>
                <td>
                  {#if row.blacklisted}
                    <span class="badge-danger">블랙리스트</span>
                  {:else}
                    <span class="badge-normal">정상</span>
                  {/if}
                </td>
                <td>{formatDate(row.created_at)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="11" class="no-data">조건에 맞는 회원이 없습니다.</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- 페이지네이션 -->
      {#if totalPages > 1}
        <div class="pagination">
          <button
            class="btn-action"
            disabled={data.page <= 1}
            onclick={() => goPage(data.page - 1)}
          >이전</button>
          <span class="page-info">{data.page} / {totalPages}</span>
          <button
            class="btn-action"
            disabled={data.page >= totalPages}
            onclick={() => goPage(data.page + 1)}
          >다음</button>
        </div>
      {/if}
    </div>

    <!-- 상세 패널 -->
    {#if selectedUserId && selectedRow}
      <div class="detail-panel-wrap" transition:fly={{ x: 30, duration: 220 }}>
        {#key selectedUserId}
          <CustomerDetailPanel
            row={selectedRow}
            onclose={closePanel}
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

  table {
    width: 100%;
    border-collapse: collapse;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  thead th {
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 700;
    padding: 10px 16px;
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
    padding: 10px 16px;
    vertical-align: middle;
  }

  /* 셀 요소 */
  .user-name  { font-weight: 700; color: var(--cs-text); }
  .user-email { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

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

  /* 등급 배지 */
  .grade-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .grade-none  { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .grade-easy  { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .grade-pop   { background: rgba(59,47,138,0.10);   color: var(--cs-purple); }
  .grade-crazy { background: rgba(255,69,0,0.12);    color: var(--cs-orange); }
  .grade-admin { background: var(--cs-lilac);        color: var(--cs-purple-dark); }

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

  .no-data { text-align: center; padding: 40px 20px; color: var(--cs-text-light); font: var(--text-pc-body-14); }

  /* 페이지네이션 */
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 12px;
    border-top: 1px solid #ECEBF4;
  }
  .page-info { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

  /* 상세 패널 */
  .detail-panel-wrap {
    width: 420px;
    flex-shrink: 0;
  }
</style>
