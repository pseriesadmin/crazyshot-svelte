<script lang="ts">
  import type { PageData } from './$types'
  import type { AccountRow } from './+page.server'
  import AccountDetailPanel from '$lib/components/cms/AccountDetailPanel.svelte'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()

  // 선택된 계정 ID — null이면 패널 닫힘
  let selectedId = $state<string | null>(null)

  // 선택된 계정 데이터 — invalidateAll 후 자동 갱신
  let selectedAccount = $derived<AccountRow | null>(
    data.accounts.find((a) => a.id === selectedId) ?? null
  )

  function selectAccount(id: string): void {
    selectedId = id
  }
  function closePanel(): void {
    selectedId = null
  }

  function roleLabel(role: string): string {
    if (role === 'superadmin') return '슈퍼관리자'
    if (role === 'manager') return '매니저'
    if (role === 'partner') return '파트너'
    return role
  }
</script>

<svelte:head><title>계정 목록 — CrazyShot CMS</title></svelte:head>

<div class="page-wrap">

  <!-- ── 페이지 헤더 (목록·패널 공통 상단, 폭 전체) ── -->
  <div class="list-header">
    <div class="list-header-left">
      <h1 class="page-title">관리자 계정 목록</h1>
      <span class="count-badge">{data.accounts.length}명</span>
    </div>
    <a href="/cms/accounts" class="btn-primary">관리자 등록</a>
  </div>

  <!-- ── 목록·패널 영역 (같은 y축에서 시작) ── -->
  <div class="content-area" class:panel-open={selectedAccount !== null}>
    <div class="table-card">
      <div class="table-wrap">
        <table class="account-table">
          <thead>
            <tr>
              <th class="col-no">번호</th>
              <th class="col-name">이름</th>
              <th class="col-email">계정(이메일)</th>
              <th class="col-role">역할</th>
              <th class="col-status">상태</th>
            </tr>
          </thead>
          <tbody>
            {#if data.accounts.length === 0}
              <tr>
                <td colspan="5" class="empty-cell">등록된 관리자 계정이 없습니다.</td>
              </tr>
            {:else}
              {#each data.accounts as account (account.id)}
                <tr
                  class:suspended={account.is_suspended}
                  class:selected={selectedId === account.id}
                  onclick={() => selectAccount(account.id)}
                  style="cursor: pointer;"
                >
                  <td class="col-no cell-center">{account.no}</td>
                  <td class="col-name">{account.name || '—'}</td>
                  <td class="col-email">
                    <span class="email-text">{account.email}</span>
                  </td>
                  <td class="col-role">
                    <span class="role-badge role-{account.cms_role}">{roleLabel(account.cms_role)}</span>
                  </td>
                  <td class="col-status cell-center">
                    {#if account.is_suspended}
                      <span class="status-badge suspended">중지</span>
                    {:else}
                      <span class="status-badge active">사용</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── 상세 패널 ── -->
    {#if selectedAccount}
      <div class="panel-area">
        {#key selectedAccount.id}
          <AccountDetailPanel row={selectedAccount} onclose={closePanel} callerRole={data.cmsRole ?? ''} callerId={data.callerId ?? ''} />
        {/key}
      </div>
    {/if}
  </div>

</div>

<style>
  /* ── 페이지 레이아웃 ── */
  /* 헤더(list-header)를 목록·패널 공통 상단으로 두고, 그 아래 content-area에서
     table-card·panel-area를 같은 flex row의 형제로 배치 — 둘 다 같은 y축(패딩 없음)에서
     시작해야 패널이 목록 카드보다 위로 붕 뜨는 문제가 재발하지 않는다. */
  .page-wrap {
    height: 100%;
    overflow: hidden;
    padding: 28px 28px 40px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .content-area {
    display: flex;
    gap: 16px;
    flex: 1;
    min-height: 0;
  }

  .table-card {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }

  /* 패널 열림 시 4:6 비율 — /cms/customers .panel-open .table-card / .detail-panel-wrap과 동일 */
  .panel-open .table-card {
    flex: 4;
  }

  .panel-area {
    flex: 6;
    min-width: 0;
    border-left: 1px solid rgba(16, 11, 50, 0.07);
    overflow-y: auto;
    box-sizing: border-box;
  }

  /* ── 헤더 ── */
  .list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .list-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .page-title {
    font: var(--text-pc-menu-kr-20);
    color: var(--cs-text);
    margin: 0;
  }
  .count-badge {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    background: var(--cs-lilac);
    border-radius: var(--radius-full);
    padding: 2px 10px;
  }
  .btn-primary {
    display: inline-flex;
    align-items: center;
    height: 36px;
    padding: 0 16px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    text-decoration: none;
    transition: opacity 0.12s;
  }
  .btn-primary:hover { opacity: 0.85; }

  /* ── 테이블 ── */
  .table-wrap {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    overflow: hidden;
    border: 1px solid rgba(16, 11, 50, 0.07);
  }
  .account-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  thead tr {
    background: var(--cs-surface-gray);
    border-bottom: 1px solid rgba(16, 11, 50, 0.08);
  }
  th {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-weight: 700;
    padding: 10px 14px;
    text-align: left;
    white-space: nowrap;
  }

  tbody tr {
    border-bottom: 1px solid rgba(16, 11, 50, 0.05);
    transition: background 0.1s;
  }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--cs-bg-row-hover); }
  tbody tr.suspended { opacity: 0.45; }
  tbody tr.selected { background: rgba(59, 47, 138, 0.05); }

  td {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    padding: 14px 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell-center { text-align: center; }

  .empty-cell {
    text-align: center;
    color: var(--cs-text-light);
    padding: 40px;
    font: var(--text-pc-body-14);
  }

  /* ── 컬럼 너비 ── */
  .col-no     { width: 6%;  text-align: center; }
  .col-name   { width: 18%; }
  .col-email  { width: 42%; }
  .col-role   { width: 18%; }
  .col-status { width: 16%; }

  /* 패널 열렸을 때 컬럼 좁힘 */
  .panel-open .col-email { width: 34%; }

  .email-text {
    font: var(--text-pc-script-12);
    color: var(--cs-text-dark);
  }

  /* ── 역할 배지 ── */
  .role-badge {
    display: inline-block;
    font: var(--text-pc-script-12);
    font-weight: 700;
    border-radius: var(--radius-sm);
    padding: 2px 7px;
  }
  .role-badge.role-superadmin { background: rgba(59,47,138,0.12); color: var(--cs-purple); }
  .role-badge.role-manager    { background: rgba(16,11,50,0.07);  color: var(--cs-text-dark); }
  .role-badge.role-partner    { background: rgba(255,69,0,0.08);  color: var(--cs-orange); }

  /* ── 상태 배지 ── */
  .status-badge {
    display: inline-block;
    font: var(--text-pc-script-12);
    font-weight: 700;
    border-radius: var(--radius-sm);
    padding: 2px 7px;
  }
  .status-badge.active    { background: rgba(16,11,50,0.05);   color: var(--cs-text-mid); }
  .status-badge.suspended { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
</style>
