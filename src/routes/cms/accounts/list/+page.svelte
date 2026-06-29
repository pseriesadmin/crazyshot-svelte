<script lang="ts">
  import { enhance } from '$app/forms'
  import type { PageData, ActionData } from './$types'
  import type { AccountRow } from './+page.server'

  interface Props {
    data: PageData
    form: ActionData
  }

  let { data, form }: Props = $props()

  type FormResult = { error?: string; success?: boolean } | null
  let result = $derived(form as FormResult)

  // 인라인 편집 중인 셀 (format: `${id}:phone` | `${id}:role`)
  let editingId = $state<string | null>(null)
  let isProcessing = $state(false)

  // 삭제 confirm
  let pendingDelete = $state<AccountRow | null>(null)
  let deleteError = $state<string | null>(null)

  function roleLabel(role: string): string {
    if (role === 'superadmin') return '슈퍼관리자'
    if (role === 'manager') return '매니저'
    if (role === 'partner') return '파트너'
    return role
  }

  function startEdit(id: string, field: 'phone' | 'role'): void {
    editingId = `${id}:${field}`
  }

  function cancelEdit(): void {
    editingId = null
  }

  function isEditing(id: string, field: string): boolean {
    return editingId === `${id}:${field}`
  }
</script>

<svelte:head><title>계정 목록 — CrazyShot CMS</title></svelte:head>

<div class="list-wrap">
  <div class="list-header">
    <h1 class="page-title">관리자 계정 목록</h1>
    <span class="count-badge">{data.accounts.length}명</span>
  </div>

  {#if result?.error}
    <p class="error-bar" role="alert">{result.error}</p>
  {/if}

  <div class="table-wrap">
    <table class="account-table">
      <thead>
        <tr>
          <th class="col-no">번호</th>
          <th class="col-name">이름</th>
          <th class="col-email">계정(이메일)</th>
          <th class="col-phone">휴대번호</th>
          <th class="col-role">접근권한</th>
          <th class="col-toggle">중복허용</th>
          <th class="col-toggle">세션제한</th>
          <th class="col-toggle">사용</th>
          <th class="col-delete">삭제</th>
        </tr>
      </thead>
      <tbody>
        {#if data.accounts.length === 0}
          <tr>
            <td colspan="9" class="empty-cell">등록된 관리자 계정이 없습니다.</td>
          </tr>
        {:else}
          {#each data.accounts as account (account.id)}
            <tr class:suspended={account.is_suspended}>

              <!-- 번호 -->
              <td class="col-no cell-center">{account.no}</td>

              <!-- 이름 (읽기 전용) -->
              <td class="col-name">{account.name || '—'}</td>

              <!-- 계정(이메일) (읽기 전용) -->
              <td class="col-email">
                <span class="email-text">{account.email}</span>
              </td>

              <!-- 휴대번호 (인라인 편집) -->
              <td class="col-phone">
                {#if isEditing(account.id, 'phone')}
                  <form
                    method="POST"
                    action="?/updatePhone"
                    use:enhance={() => {
                      isProcessing = true
                      return async ({ update }) => {
                        await update({ reset: false })
                        isProcessing = false
                        editingId = null
                      }
                    }}
                  >
                    <input type="hidden" name="user_id" value={account.id} />
                    <input
                      type="text"
                      name="phone"
                      value={account.phone}
                      class="inline-input"
                      onkeydown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.form?.requestSubmit()
                        if (e.key === 'Escape') cancelEdit()
                      }}
                      onblur={(e) => e.currentTarget.form?.requestSubmit()}
                    />
                  </form>
                {:else}
                  <button
                    type="button"
                    class="editable-cell"
                    onclick={() => startEdit(account.id, 'phone')}
                  >{account.phone || '—'}</button>
                {/if}
              </td>

              <!-- 접근권한 (인라인 select) -->
              <td class="col-role">
                {#if account.cms_role === 'superadmin'}
                  <span class="role-tag role-superadmin">{roleLabel(account.cms_role)}</span>
                {:else if isEditing(account.id, 'role')}
                  <form
                    method="POST"
                    action="?/updateRole"
                    use:enhance={() => {
                      isProcessing = true
                      return async ({ update }) => {
                        await update({ reset: false })
                        isProcessing = false
                        editingId = null
                      }
                    }}
                  >
                    <input type="hidden" name="user_id" value={account.id} />
                    <select
                      name="cms_role"
                      class="inline-select"
                      onchange={(e) => e.currentTarget.form?.requestSubmit()}
                      onblur={() => cancelEdit()}
                    >
                      <option value="manager" selected={account.cms_role === 'manager'}>매니저</option>
                      <option value="partner" selected={account.cms_role === 'partner'}>파트너</option>
                    </select>
                  </form>
                {:else}
                  <button
                    type="button"
                    class="role-tag role-{account.cms_role} editable-role"
                    onclick={() => startEdit(account.id, 'role')}
                  >{roleLabel(account.cms_role)}</button>
                {/if}
              </td>

              <!-- 중복허용 토글 -->
              <td class="col-toggle cell-center">
                <form
                  method="POST"
                  action="?/toggleConcurrent"
                  use:enhance={() => {
                    isProcessing = true
                    return async ({ update }) => {
                      await update({ reset: false })
                      isProcessing = false
                    }
                  }}
                >
                  <input type="hidden" name="user_id" value={account.id} />
                  <input type="hidden" name="current" value={account.cms_allow_concurrent_login} />
                  <button
                    type="submit"
                    class="toggle-btn"
                    class:on={account.cms_allow_concurrent_login}
                    disabled={isProcessing}
                    aria-label={account.cms_allow_concurrent_login ? '중복로그인 허용 중' : '중복로그인 차단 중'}
                  >
                    <span class="toggle-thumb"></span>
                  </button>
                </form>
              </td>

              <!-- 세션제한 토글 -->
              <td class="col-toggle cell-center">
                <form
                  method="POST"
                  action="?/toggleSession"
                  use:enhance={() => {
                    isProcessing = true
                    return async ({ update }) => {
                      await update({ reset: false })
                      isProcessing = false
                    }
                  }}
                >
                  <input type="hidden" name="user_id" value={account.id} />
                  <input type="hidden" name="has_limit" value={account.cms_session_timeout_hours !== null} />
                  <button
                    type="submit"
                    class="toggle-btn"
                    class:on={account.cms_session_timeout_hours !== null}
                    disabled={isProcessing}
                    aria-label={account.cms_session_timeout_hours !== null ? `세션 ${account.cms_session_timeout_hours}h 제한` : '세션 무제한'}
                  >
                    <span class="toggle-thumb"></span>
                  </button>
                </form>
              </td>

              <!-- 사용/중지 토글 -->
              <td class="col-toggle cell-center">
                {#if account.cms_role === 'superadmin'}
                  <span class="toggle-disabled">—</span>
                {:else}
                  <form
                    method="POST"
                    action="?/toggleSuspend"
                    use:enhance={() => {
                      isProcessing = true
                      return async ({ update }) => {
                        await update({ reset: false })
                        isProcessing = false
                      }
                    }}
                  >
                    <input type="hidden" name="user_id" value={account.id} />
                    <input type="hidden" name="is_suspended" value={account.is_suspended} />
                    <button
                      type="submit"
                      class="toggle-btn"
                      class:on={!account.is_suspended}
                      class:danger={account.is_suspended}
                      disabled={isProcessing}
                      aria-label={account.is_suspended ? '계정 중지 중 (클릭하여 재활성화)' : '계정 사용 중 (클릭하여 중지)'}
                    >
                      <span class="toggle-thumb"></span>
                    </button>
                  </form>
                {/if}
              </td>

              <!-- 삭제 -->
              <td class="col-delete cell-center">
                <button
                  type="button"
                  class="delete-btn"
                  onclick={() => { pendingDelete = account }}
                  disabled={isProcessing || account.cms_role === 'superadmin'}
                  aria-label="계정 삭제"
                >삭제</button>
              </td>

            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<!-- 삭제 확인 다이얼로그 -->
{#if pendingDelete}
  <div
    class="confirm-backdrop"
    role="presentation"
    onclick={() => { pendingDelete = null }}
    onkeydown={(e) => { if (e.key === 'Escape') pendingDelete = null }}
  >
    <div
      class="confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label="계정 삭제 확인"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') pendingDelete = null }}
    >
      <p class="confirm-msg">계정을 삭제할까요?</p>
      <p class="confirm-sub">{pendingDelete.name} ({pendingDelete.email}) — 복구 불가</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" onclick={() => { pendingDelete = null }} disabled={isProcessing}>
          취소
        </button>
        <form
          method="POST"
          action="?/delete"
          use:enhance={() => {
            isProcessing = true
            deleteError = null
            return async ({ result, update }) => {
              if (result.type === 'failure') {
                deleteError = (result.data as { error?: string })?.error ?? '삭제 중 오류가 발생했습니다.'
                isProcessing = false
              } else {
                await update()
                isProcessing = false
                pendingDelete = null
              }
            }
          }}
        >
          <input type="hidden" name="user_id" value={pendingDelete.id} />
          {#if deleteError}
            <p class="delete-error" role="alert">{deleteError}</p>
          {/if}
          <button type="submit" class="confirm-ok" disabled={isProcessing}>
            {isProcessing ? '처리 중...' : '삭제'}
          </button>
        </form>
      </div>
    </div>
  </div>
{/if}

<style>
  .list-wrap {
    padding: 28px 28px 40px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
  }

  .list-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .page-title {
    font: var(--text-m-title-18B);
    color: var(--cs-text);
    margin: 0;
  }

  .count-badge {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    background: var(--cs-lilac);
    border-radius: var(--radius-full);
    padding: 2px 10px;
  }

  .error-bar {
    font: var(--text-m-script-14);
    color: var(--cs-red-badge);
    background: #fff0f0;
    border-radius: var(--radius-md);
    padding: 10px 14px;
    margin: 0;
  }

  /* ── 테이블 ─────────────────── */
  .table-wrap {
    background: var(--cs-white);
    border-radius: var(--radius-lg);
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
    font: var(--text-m-script-12);
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

  td {
    font: var(--text-m-script-14);
    color: var(--cs-text);
    padding: 9px 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell-center { text-align: center; }

  .empty-cell {
    text-align: center;
    color: var(--cs-text-light);
    padding: 40px;
    font: var(--text-m-script-14);
  }

  /* 컬럼 너비 — 퍼센트 기반으로 균등 배분 */
  .col-no     { width: 5%;  text-align: center; }
  .col-name   { width: 11%; }
  .col-email  { width: 22%; }
  .col-phone  { width: 15%; }
  .col-role   { width: 12%; }
  .col-toggle { width: 7%;  }
  .col-delete { width: 8%;  }

  .email-text {
    font: var(--text-m-script-12);
    color: var(--cs-text-dark);
  }

  /* ── 인라인 편집 ─────────────── */
  .editable-cell,
  .editable-role {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font: var(--text-m-script-14);
    color: var(--cs-text);
    text-align: left;
    width: 100%;
    display: block;
    border-bottom: 1px dashed transparent;
    transition: border-color 0.15s;
  }
  .editable-cell:hover { border-bottom-color: var(--cs-purple); }

  .inline-input {
    font: var(--text-m-script-14);
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    border: 1px solid var(--cs-purple);
    border-radius: var(--radius-xs);
    padding: 2px 6px;
    width: 100%;
    box-sizing: border-box;
    outline: none;
  }

  .inline-select {
    font: var(--text-m-script-12);
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    border: 1px solid var(--cs-purple);
    border-radius: var(--radius-xs);
    padding: 2px 4px;
    width: 100%;
    box-sizing: border-box;
    outline: none;
    cursor: pointer;
  }

  /* ── 역할 태그 ───────────────── */
  .role-tag {
    display: inline-block;
    font: var(--text-m-script-12);
    font-weight: 700;
    border-radius: var(--radius-xs);
    padding: 2px 7px;
  }
  .role-tag.role-superadmin { background: rgba(59,47,138,0.12); color: var(--cs-purple); }
  .role-tag.role-manager    { background: rgba(16,11,50,0.07);  color: var(--cs-text-dark); }
  .role-tag.role-partner    { background: rgba(255,69,0,0.08);  color: var(--cs-orange); }

  .editable-role {
    border-radius: var(--radius-xs);
    padding: 2px 7px !important;
    width: auto;
    display: inline-block;
    border-bottom: none;
  }
  .editable-role:hover { opacity: 0.75; }

  /* ── 토글 스위치 ─────────────── */
  .toggle-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--cs-disabled-toggle);
    border: none;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: background 0.18s;
    vertical-align: middle;
  }
  .toggle-btn.on     { background: var(--cs-purple); }
  .toggle-btn.danger { background: #d0d0d8; }
  .toggle-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .toggle-thumb {
    position: absolute;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--cs-white);
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    transition: transform 0.18s;
  }
  .toggle-btn.on .toggle-thumb { transform: translateX(16px); }

  .toggle-disabled {
    color: var(--cs-text-light);
    font: var(--text-m-script-12);
  }

  /* ── 삭제 버튼 ───────────────── */
  .delete-btn {
    font: var(--text-m-script-12);
    font-weight: 700;
    background: rgba(255,53,53,0.08);
    color: var(--cs-red-badge);
    border: none;
    border-radius: var(--radius-xs);
    padding: 3px 8px;
    cursor: pointer;
    min-height: 26px;
    transition: opacity 0.12s;
  }
  .delete-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .delete-btn:not(:disabled):hover { opacity: 0.75; }

  /* ── 삭제 확인 다이얼로그 ─────── */
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(16,11,50,0.35);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 40px;
  }
  .confirm-dialog {
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    padding: 24px 28px;
    width: min(360px, calc(100vw - 40px));
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .confirm-msg  { font: var(--text-m-body-16B); color: var(--cs-text); margin: 0; }
  .confirm-sub  { font: var(--text-m-script-12); color: var(--cs-text-light); margin: 0; }
  .confirm-actions { display: flex; gap: 10px; margin-top: 12px; }
  .confirm-cancel,
  .confirm-ok {
    flex: 1; height: 44px;
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-m-script-14B);
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .confirm-cancel { background: var(--cs-lilac); color: var(--cs-text); }
  .confirm-ok     { background: var(--cs-red-badge); color: var(--cs-white); }
  .confirm-cancel:disabled,
  .confirm-ok:disabled { opacity: 0.5; cursor: not-allowed; }
  .confirm-actions form { flex: 1; display: contents; }
  .delete-error {
    font: var(--text-m-script-12);
    color: var(--cs-red-badge);
    margin: 8px 0 0;
    text-align: center;
    grid-column: 1 / -1;
  }
</style>
