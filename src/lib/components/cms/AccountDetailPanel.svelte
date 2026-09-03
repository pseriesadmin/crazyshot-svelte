<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import type { ActionResult } from '@sveltejs/kit'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import { parseUserAgent } from '$lib/utils/parseUserAgent'
  import { CMS_MENUS, roleAllowsMenuByDefault } from '$lib/constants/cmsMenus'

  interface LoginLogRow {
    id: string
    email: string
    cms_role: string | null
    ip_address: string | null
    user_agent: string | null
    logged_in_at: string
  }

  /** 메뉴 권한 오버라이드 행 (server type 재정의 — client bundle 안전) */
  interface MenuPermRow {
    menu_key: string
    allowed: boolean
    updated_at: string
    updated_by: string | null
  }

  // AccountRow 인라인 정의 (circular import 방지)
  interface AccountRow {
    no: number
    id: string
    name: string
    email: string
    phone: string
    cms_role: string
    cms_allow_concurrent_login: boolean
    cms_session_timeout_hours: number | null
    is_suspended: boolean
  }

  type AccountTabKey = 'info' | 'permissions' | 'logs'

  interface Props {
    row: AccountRow
    onclose: () => void
    initialTab?: string | null
    callerRole?: string
    callerId?: string
  }

  let { row, onclose, initialTab = null, callerRole = '', callerId = '' }: Props = $props()

  /** 호출자가 마스터(superadmin)인지 여부 — 역할 변경 콤보버튼 활성 판정 */
  let callerIsSuperadmin = $derived(callerRole === 'superadmin')
  /** 호출자가 지금 보고 있는 계정이 본인 계정인지 — "비밀번호 변경" 레이아웃은 항상 노출되나
      실행 버튼은 본인 계정에서만 활성화 */
  let isOwnAccount = $derived(!!callerId && row.id === callerId)

  // ── 비밀번호 변경 모달 상태 ─────────────────────────────────
  let showChangePwModal = $state(false)
  let changingPw = $state(false)
  let changePwError = $state<string | null>(null)
  let currentPasswordKoreanWarned = false
  let newPasswordKoreanWarned = false
  let confirmPasswordKoreanWarned = false

  const VALID_TABS: AccountTabKey[] = ['info', 'permissions', 'logs']
  function resolveInitialTab(tab: string | null): AccountTabKey {
    return VALID_TABS.includes(tab as AccountTabKey) ? (tab as AccountTabKey) : 'info'
  }

  let activeTab = $state<AccountTabKey>(resolveInitialTab(initialTab))
  let isProcessing = $state(false)
  let pendingDelete = $state(false)
  let deleteError = $state<string | null>(null)

  // ── 접속로그 탭 상태 ────────────────────────────────────────
  let logsLoaded = $state(false)
  let logsLoading = $state(false)
  let logsError = $state<string | null>(null)
  let logs = $state<LoginLogRow[]>([])
  let logsTotal = $state(0)
  let logsPage = $state(1)
  let logsTotalPages = $state(1)

  async function fetchLogs(page = 1) {
    logsLoading = true
    logsError = null
    try {
      const res = await fetch(`/api/cms/accounts/${row.id}/login-logs?page=${page}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        logsError = (body as { error?: string }).error ?? '접속로그를 불러오는데 실패했습니다.'
        return
      }
      const body = (await res.json()) as {
        logs: LoginLogRow[]
        total: number
        page: number
        totalPages: number
      }
      logs = body.logs
      logsTotal = body.total
      logsPage = body.page
      logsTotalPages = body.totalPages
      logsLoaded = true
    } catch {
      logsError = '네트워크 오류가 발생했습니다.'
    } finally {
      logsLoading = false
    }
  }

  // 탭이 'logs'로 바뀌는 시점에 최초 1회 fetch
  $effect(() => {
    if (activeTab === 'logs' && !logsLoaded && !logsLoading) {
      fetchLogs(1)
    }
  })

  // row가 바뀌면(다른 계정 선택) 로그 상태 초기화
  $effect(() => {
    const _id = row.id
    if (_id) {
      logsLoaded = false
      logsError = null
      logs = []
      logsPage = 1
      logsTotalPages = 1
    }
  })

  function formatLoggedAt(ts: string): string {
    try {
      const d = new Date(ts)
      const pad = (n: number) => String(n).padStart(2, '0')
      const y = d.getFullYear()
      const mo = pad(d.getMonth() + 1)
      const da = pad(d.getDate())
      const h = pad(d.getHours())
      const mi = pad(d.getMinutes())
      return `${y}-${mo}-${da} ${h}:${mi}`
    } catch {
      return ts
    }
  }

  // 로컬 편집 상태 — prop 변경 시 $effect로 동기화
  let editName = $state(row.name)
  let editPhone = $state(row.phone)

  $effect(() => {
    editName = row.name
    editPhone = row.phone
    deleteError = null
    pendingDelete = false
  })

  function roleLabel(role: string): string {
    if (role === 'superadmin') return '슈퍼관리자'
    if (role === 'manager') return '매니저'
    if (role === 'partner') return '파트너'
    return role
  }

  function handleFormResult(
    opts: { successMsg?: string; onSuccess?: () => void } = {}
  ) {
    return () => {
      isProcessing = true
      return async ({ result }: { result: ActionResult }) => {
        if (result.type === 'failure') {
          const err = (result.data as { error?: string })?.error ?? '처리 중 오류가 발생했습니다.'
          csToast.error(err)
        } else if (result.type === 'success') {
          await invalidateAll()
          csToast.success(opts.successMsg ?? '저장되었습니다.')
          opts.onSuccess?.()
        }
        isProcessing = false
      }
    }
  }

  const TAB_LABELS: Record<AccountTabKey, string> = {
    info: '기본정보',
    permissions: '권한설정',
    logs: '접속로그',
  }

  // ── 권한설정 탭 상태 ─────────────────────────────────────────
  let permsLoaded = $state(false)
  let permsLoading = $state(false)
  let permsError = $state<string | null>(null)
  let permissions = $state<MenuPermRow[]>([])
  let savingKey = $state<string | null>(null)
  let roleChanging = $state(false)

  async function fetchPermissions() {
    permsLoading = true
    permsError = null
    try {
      const res = await fetch(`/api/cms/accounts/${row.id}/menu-permissions`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        permsError = (body as { error?: string }).error ?? '권한 정보를 불러오는데 실패했습니다.'
        return
      }
      const data = (await res.json()) as MenuPermRow[]
      permissions = data
      permsLoaded = true
    } catch {
      permsError = '네트워크 오류가 발생했습니다.'
    } finally {
      permsLoading = false
    }
  }

  async function setMenuPermission(menuKey: string, allowed: boolean) {
    savingKey = menuKey
    try {
      const res = await fetch(`/api/cms/accounts/${row.id}/menu-permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu_key: menuKey, allowed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        csToast.error((body as { error?: string }).error ?? '저장 중 오류가 발생했습니다.')
        return
      }
      // 로컬 상태 업데이트
      const idx = permissions.findIndex((p) => p.menu_key === menuKey)
      if (idx >= 0) {
        permissions = permissions.map((p) =>
          p.menu_key === menuKey ? { ...p, allowed } : p
        )
      } else {
        permissions = [
          ...permissions,
          { menu_key: menuKey, allowed, updated_at: new Date().toISOString(), updated_by: null },
        ]
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      savingKey = null
    }
  }

  function handleRoleFormResult() {
    return () => {
      roleChanging = true
      return async ({ result }: { result: ActionResult }) => {
        if (result.type === 'failure') {
          const err = (result.data as { error?: string })?.error ?? '처리 중 오류가 발생했습니다.'
          csToast.error(err)
        } else if (result.type === 'success') {
          await invalidateAll()
          csToast.success('관리자 레벨이 변경되었습니다.')
        }
        roleChanging = false
      }
    }
  }

  // 권한설정 탭이 활성화될 때 최초 1회 권한 조회
  $effect(() => {
    if (activeTab === 'permissions' && !permsLoaded && !permsLoading) {
      fetchPermissions()
    }
  })

  // row가 바뀌면(다른 계정 선택) 권한 상태 초기화
  $effect(() => {
    const _rowId = row.id
    if (_rowId) {
      permsLoaded = false
      permsError = null
      permissions = []
      savingKey = null
    }
  })
</script>

<div class="panel">
  <!-- ── 패널 헤더 ── -->
  <div class="panel-header">
    <div class="header-main">
      <div class="header-title-row">
        <span class="header-name">{row.name || '이름 없음'}</span>
        <span class="role-badge role-{row.cms_role}">{roleLabel(row.cms_role)}</span>
        {#if row.is_suspended}
          <span class="suspended-badge">중지</span>
        {/if}
      </div>
      <span class="header-email">{row.email}</span>
    </div>
    <button type="button" class="close-btn" onclick={onclose} aria-label="패널 닫기">✕</button>
  </div>

  <!-- ── 탭 바 ── -->
  <div class="tab-bar" role="tablist">
    {#each VALID_TABS as tab (tab)}
      <button
        type="button"
        role="tab"
        class="tab-btn"
        class:active={activeTab === tab}
        aria-selected={activeTab === tab}
        onclick={() => { activeTab = tab }}
      >{TAB_LABELS[tab]}</button>
    {/each}
  </div>

  <!-- ── 탭 콘텐츠 ── -->
  <div class="tab-content">

    {#if activeTab === 'info'}
      <!-- ── 기본정보 탭 ── -->
      <div class="info-section">

        <!-- 이름 -->
        <div class="field-group">
          <label class="field-label" for="edit-name">이름</label>
          <form
            method="POST"
            action="?/updateName"
            class="field-form"
            use:enhance={handleFormResult({ successMsg: '이름이 저장되었습니다.' })}
          >
            <input type="hidden" name="user_id" value={row.id} />
            <input
              id="edit-name"
              type="text"
              name="full_name"
              class="field-input"
              bind:value={editName}
              disabled={isProcessing}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.isComposing) {
                  e.preventDefault()
                  ;(e.currentTarget as HTMLInputElement).form?.requestSubmit()
                }
              }}
              placeholder="이름 입력"
            />
            <button type="submit" class="save-btn" disabled={isProcessing || !editName.trim()}>저장</button>
          </form>
        </div>

        <!-- 이메일 (읽기전용) -->
        <div class="field-group">
          <span class="field-label">계정(이메일)</span>
          <div class="field-readonly">{row.email}</div>
        </div>

        <!-- 휴대번호 -->
        <div class="field-group">
          <label class="field-label" for="edit-phone">휴대번호</label>
          <form
            method="POST"
            action="?/updatePhone"
            class="field-form"
            use:enhance={handleFormResult({ successMsg: '휴대번호가 저장되었습니다.' })}
          >
            <input type="hidden" name="user_id" value={row.id} />
            <input
              id="edit-phone"
              type="text"
              name="phone"
              class="field-input"
              bind:value={editPhone}
              disabled={isProcessing}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.isComposing) {
                  e.preventDefault()
                  ;(e.currentTarget as HTMLInputElement).form?.requestSubmit()
                }
              }}
              placeholder="010-0000-0000"
            />
            <button type="submit" class="save-btn" disabled={isProcessing}>저장</button>
          </form>
        </div>

        <!-- 구분선 -->
        <div class="section-divider"></div>

        <!-- 중복허용 토글 -->
        <div class="toggle-group">
          <div class="toggle-info">
            <span class="toggle-label">중복 로그인 허용</span>
            <span class="toggle-desc">동일 계정 동시 접속을 허용합니다</span>
          </div>
          <form
            method="POST"
            action="?/toggleConcurrent"
            use:enhance={handleFormResult()}
          >
            <input type="hidden" name="user_id" value={row.id} />
            <input type="hidden" name="current" value={row.cms_allow_concurrent_login} />
            <button
              type="submit"
              class="combo-btn"
              class:combo-active={row.cms_allow_concurrent_login}
              disabled={isProcessing}
              aria-pressed={row.cms_allow_concurrent_login}
              aria-label={row.cms_allow_concurrent_login ? '중복 로그인 허용 중' : '중복 로그인 차단 중'}
            >{row.cms_allow_concurrent_login ? 'ON' : 'OFF'}</button>
          </form>
        </div>

        <!-- 세션제한 토글 -->
        <div class="toggle-group">
          <div class="toggle-info">
            <span class="toggle-label">세션 시간 제한 <span class="toggle-note">{row.cms_session_timeout_hours !== null ? `(${row.cms_session_timeout_hours}h)` : ''}</span></span>
            <span class="toggle-desc">비활성 시 24시간 후 자동 로그아웃</span>
          </div>
          <form
            method="POST"
            action="?/toggleSession"
            use:enhance={handleFormResult()}
          >
            <input type="hidden" name="user_id" value={row.id} />
            <input type="hidden" name="has_limit" value={row.cms_session_timeout_hours !== null} />
            <button
              type="submit"
              class="combo-btn"
              class:combo-active={row.cms_session_timeout_hours !== null}
              disabled={isProcessing}
              aria-pressed={row.cms_session_timeout_hours !== null}
              aria-label={row.cms_session_timeout_hours !== null ? '세션 제한 적용 중' : '세션 무제한'}
            >{row.cms_session_timeout_hours !== null ? 'ON' : 'OFF'}</button>
          </form>
        </div>

        <!-- 사용/중지 토글 -->
        <div class="toggle-group">
          <div class="toggle-info">
            <span class="toggle-label">계정 활성화</span>
            <span class="toggle-desc">
              {row.cms_role === 'superadmin' ? '마스터 계정은 중지할 수 없습니다' : row.is_suspended ? '계정이 중지된 상태입니다' : '계정이 활성 상태입니다'}
            </span>
          </div>
          {#if row.cms_role === 'superadmin'}
            <span class="toggle-na">—</span>
          {:else}
            <form
              method="POST"
              action="?/toggleSuspend"
              use:enhance={handleFormResult()}
            >
              <input type="hidden" name="user_id" value={row.id} />
              <input type="hidden" name="is_suspended" value={row.is_suspended} />
              <button
                type="submit"
                class="combo-btn"
                class:combo-active={!row.is_suspended}
                disabled={isProcessing}
                aria-pressed={!row.is_suspended}
                aria-label={row.is_suspended ? '계정 중지 중' : '계정 사용 중'}
              >{row.is_suspended ? 'OFF' : 'ON'}</button>
            </form>
          {/if}
        </div>

        <!-- 비밀번호 변경 (레이아웃은 항상 노출, 실행 버튼만 본인 계정에서만 활성화) -->
        <div class="toggle-group">
          <div class="toggle-info">
            <span class="toggle-label">비밀번호 변경</span>
            <span class="toggle-desc">
              {isOwnAccount ? '본인 계정의 로그인 비밀번호를 변경합니다' : '본인 계정에서만 변경할 수 있습니다'}
            </span>
          </div>
          <button
            type="button"
            class="combo-btn"
            disabled={!isOwnAccount}
            title={isOwnAccount ? undefined : '본인 계정에서만 변경할 수 있습니다'}
            onclick={() => { showChangePwModal = true; changePwError = null }}
          >변경</button>
        </div>

        <!-- 구분선 -->
        <div class="section-divider"></div>

        <!-- 삭제 영역 -->
        {#if !pendingDelete}
          <div class="delete-area">
            <button
              type="button"
              class="delete-trigger"
              onclick={() => { pendingDelete = true; deleteError = null }}
              disabled={isProcessing || row.cms_role === 'superadmin'}
              title={row.cms_role === 'superadmin' ? '마스터 계정은 삭제할 수 없습니다' : '계정 삭제'}
            >
              계정 삭제
            </button>
            {#if row.cms_role === 'superadmin'}
              <span class="delete-note">마스터 계정은 삭제할 수 없습니다</span>
            {/if}
          </div>
        {:else}
          <div class="delete-confirm">
            <p class="confirm-msg">정말 삭제할까요?</p>
            <p class="confirm-sub">{row.name} ({row.email}) — 복구 불가</p>
            {#if deleteError}
              <p class="confirm-error" role="alert">{deleteError}</p>
            {/if}
            <div class="confirm-actions">
              <button
                type="button"
                class="confirm-cancel"
                onclick={() => { pendingDelete = false; deleteError = null }}
                disabled={isProcessing}
              >취소</button>
              <form
                method="POST"
                action="?/delete"
                use:enhance={() => {
                  isProcessing = true
                  return async ({ result }: { result: ActionResult }) => {
                    if (result.type === 'failure') {
                      deleteError = (result.data as { error?: string })?.error ?? '삭제 중 오류가 발생했습니다.'
                      isProcessing = false
                    } else {
                      await invalidateAll()
                      isProcessing = false
                      pendingDelete = false
                      onclose()
                    }
                  }
                }}
              >
                <input type="hidden" name="user_id" value={row.id} />
                <button type="submit" class="confirm-delete" disabled={isProcessing}>
                  {isProcessing ? '처리 중...' : '삭제'}
                </button>
              </form>
            </div>
          </div>
        {/if}

      </div>

    {:else if activeTab === 'permissions'}
      <!-- ── 권한설정 탭 (Stage 5) ── -->
      <div class="perms-tab">

        <!-- ① 관리자 레벨 섹션 -->
        <div class="perms-section">
          <h3 class="perms-section-title">관리자 레벨</h3>

          {#if callerIsSuperadmin}
            <!-- superadmin 호출자: 콤보버튼 활성 -->
            <div class="role-combo-row">
              <!-- 마스터: 현재 역할 표시 전용, 직접 지정 불가 -->
              <button
                type="button"
                class="combo-btn"
                class:combo-active={row.cms_role === 'superadmin'}
                disabled
                title="마스터 레벨 직접 지정 불가"
              >마스터</button>
              <!-- 매니저: 클릭 시 updateRole 액션 -->
              <form method="POST" action="?/updateRole" use:enhance={handleRoleFormResult()} style="display:contents">
                <input type="hidden" name="user_id" value={row.id} />
                <input type="hidden" name="cms_role" value="manager" />
                <button
                  type="submit"
                  class="combo-btn"
                  class:combo-active={row.cms_role === 'manager'}
                  disabled={roleChanging || row.cms_role === 'manager'}
                >매니저</button>
              </form>
              <!-- 파트너: 클릭 시 updateRole 액션 -->
              <form method="POST" action="?/updateRole" use:enhance={handleRoleFormResult()} style="display:contents">
                <input type="hidden" name="user_id" value={row.id} />
                <input type="hidden" name="cms_role" value="partner" />
                <button
                  type="submit"
                  class="combo-btn"
                  class:combo-active={row.cms_role === 'partner'}
                  disabled={roleChanging || row.cms_role === 'partner'}
                >파트너</button>
              </form>
            </div>
            {#if row.cms_role === 'superadmin'}
              <p class="perms-note">마스터 계정을 강등하면 마스터 권한이 제거됩니다. 신중하게 처리하세요.</p>
            {/if}
          {:else}
            <!-- manager/partner 호출자: 읽기전용 배지 표시 -->
            <div class="role-readonly-row">
              <span class="role-badge role-{row.cms_role}">{roleLabel(row.cms_role)}</span>
              <span class="perms-note">레벨 변경은 마스터(superadmin) 계정만 가능합니다</span>
            </div>
          {/if}
        </div>

        <div class="section-divider"></div>

        <!-- ② 메뉴 접근 권한 섹션 -->
        <div class="perms-section">
          <h3 class="perms-section-title">메뉴 접근 권한</h3>
          <p class="perms-desc">역할 기본 허용 범위 안에서만 차단할 수 있습니다 (좁히기 전용)</p>

          {#if permsLoading}
            <div class="perms-state">
              <span class="perms-state-text">불러오는 중...</span>
            </div>

          {:else if permsError}
            <div class="perms-state perms-state-error" role="alert">
              <span class="perms-state-text">{permsError}</span>
              <button type="button" class="perms-retry-btn" onclick={() => fetchPermissions()}>다시 시도</button>
            </div>

          {:else}
            <div class="menu-grid">
              {#each CMS_MENUS as mainMenu (mainMenu.menu_key)}
                {#if mainMenu.subMenus.length > 0}
                  <div class="menu-group">
                    <div class="menu-group-label">{mainMenu.label}</div>
                    {#each mainMenu.subMenus as sub (sub.menu_key)}
                      {@const isRoleAllowed = roleAllowsMenuByDefault(row.cms_role, sub.menu_key)}
                      {@const override = permissions.find((p) => p.menu_key === sub.menu_key)}
                      {@const isOverrideBlocked = override?.allowed === false}
                      {@const effectiveAllowed = isRoleAllowed && !isOverrideBlocked}
                      {@const isSaving = savingKey === sub.menu_key}
                      <div class="menu-item" class:menu-item-dimmed={!isRoleAllowed}>
                        <span class="menu-item-label">{sub.label}</span>
                        <div class="menu-combo">
                          <button
                            type="button"
                            class="combo-btn combo-sm"
                            class:combo-active={effectiveAllowed}
                            disabled={!isRoleAllowed || isSaving}
                            onclick={() => setMenuPermission(sub.menu_key, !effectiveAllowed)}
                            aria-pressed={effectiveAllowed}
                            aria-label="{sub.label} {effectiveAllowed ? '허용됨' : '차단됨'}"
                          >{effectiveAllowed ? 'ON' : 'OFF'}</button>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>

      </div>

    {:else if activeTab === 'logs'}
      <!-- ── 접속로그 탭 ── -->
      <div class="logs-tab">

        {#if logsLoading}
          <div class="logs-state">
            <span class="logs-state-text">불러오는 중...</span>
          </div>

        {:else if logsError}
          <div class="logs-state logs-state-error" role="alert">
            <span class="logs-state-text">{logsError}</span>
            <button type="button" class="logs-retry-btn" onclick={() => fetchLogs(logsPage)}>다시 시도</button>
          </div>

        {:else if logs.length === 0}
          <!-- EC-6: 빈 목록 안내 -->
          <div class="logs-state">
            <span class="logs-empty-icon" aria-hidden="true">📋</span>
            <span class="logs-state-text">접속 이력이 없습니다.</span>
          </div>

        {:else}
          <div class="logs-count">총 {logsTotal.toLocaleString()}건</div>
          <div class="logs-table-wrap">
            <table class="logs-table">
              <thead>
                <tr>
                  <th class="col-email">아이디</th>
                  <th class="col-at">접속일시</th>
                  <th class="col-ip">IP</th>
                  <th class="col-device">디바이스·브라우저</th>
                </tr>
              </thead>
              <tbody>
                {#each logs as log (log.id)}
                  <tr>
                    <td class="col-email cell-email">{log.email}</td>
                    <td class="col-at cell-at">{formatLoggedAt(log.logged_in_at)}</td>
                    <td class="col-ip cell-ip">{log.ip_address ?? '—'}</td>
                    <td class="col-device cell-device">{parseUserAgent(log.user_agent ?? '').display}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if logsTotalPages > 1}
            <div class="logs-pagination">
              <CmsPagination
                page={logsPage}
                totalPages={logsTotalPages}
                onpage={(p) => fetchLogs(p)}
                variant="bottom"
                ariaLabel="접속로그 페이지 탐색"
              />
            </div>
          {/if}
        {/if}

      </div>

    {/if}

  </div>
</div>

{#if showChangePwModal}
  <div class="pw-modal-overlay" role="dialog" aria-modal="true" aria-label="비밀번호 변경">
    <div class="pw-modal-wrap">
      <div class="pw-modal-header">
        <span class="pw-modal-title">비밀번호 변경</span>
        <button type="button" class="close-btn" onclick={() => { showChangePwModal = false }} aria-label="닫기">✕</button>
      </div>
      <form
        method="POST"
        action="/cms/login?/changePassword"
        class="pw-modal-form"
        use:enhance={() => {
          changingPw = true
          changePwError = null
          return async ({ result }: { result: ActionResult }) => {
            changingPw = false
            if (result.type === 'failure') {
              changePwError = (result.data as { error?: string })?.error ?? '비밀번호 변경에 실패했습니다.'
            } else if (result.type === 'success') {
              csToast.success('비밀번호가 변경되었습니다.')
              showChangePwModal = false
            } else if (result.type === 'error') {
              changePwError = '비밀번호 변경 중 오류가 발생했습니다.'
            }
          }
        }}
      >
        {#if changePwError}
          <p class="pw-error" role="alert">{changePwError}</p>
        {/if}

        <label class="field-label" for="pw-current">현재 비밀번호</label>
        <input
          id="pw-current"
          name="currentPassword"
          type="password"
          class="field-input"
          maxlength={72}
          placeholder="현재 비밀번호 입력"
          autocomplete="current-password"
          oninput={(e) => {
            const el = e.currentTarget as HTMLInputElement
            const filtered = el.value.replace(/[^\x00-\x7F]/g, '')
            if (el.value !== filtered) {
              el.value = filtered
              if (!currentPasswordKoreanWarned) {
                currentPasswordKoreanWarned = true
                csToast.warning('영문(숫자)으로 입력하세요.')
                setTimeout(() => { currentPasswordKoreanWarned = false }, 3000)
              }
            }
          }}
          required
        />

        <label class="field-label" for="pw-new">새 비밀번호</label>
        <input
          id="pw-new"
          name="newPassword"
          type="password"
          class="field-input"
          maxlength={72}
          placeholder="8자 이상 입력"
          autocomplete="new-password"
          oninput={(e) => {
            const el = e.currentTarget as HTMLInputElement
            const filtered = el.value.replace(/[^\x00-\x7F]/g, '')
            if (el.value !== filtered) {
              el.value = filtered
              if (!newPasswordKoreanWarned) {
                newPasswordKoreanWarned = true
                csToast.warning('영문(숫자)으로 입력하세요.')
                setTimeout(() => { newPasswordKoreanWarned = false }, 3000)
              }
            }
          }}
          required
        />

        <label class="field-label" for="pw-confirm">새 비밀번호 확인</label>
        <input
          id="pw-confirm"
          name="confirmPassword"
          type="password"
          class="field-input"
          maxlength={72}
          placeholder="비밀번호 재입력"
          autocomplete="new-password"
          oninput={(e) => {
            const el = e.currentTarget as HTMLInputElement
            const filtered = el.value.replace(/[^\x00-\x7F]/g, '')
            if (el.value !== filtered) {
              el.value = filtered
              if (!confirmPasswordKoreanWarned) {
                confirmPasswordKoreanWarned = true
                csToast.warning('영문(숫자)으로 입력하세요.')
                setTimeout(() => { confirmPasswordKoreanWarned = false }, 3000)
              }
            }
          }}
          required
        />

        <button type="submit" class="pw-submit-btn" disabled={changingPw}>
          {changingPw ? '변경 중...' : '비밀번호 변경'}
        </button>
      </form>
    </div>
  </div>
{/if}

<style>
  /* ── 패널 컨테이너 ── */
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--cs-white);
    overflow: hidden;
  }

  /* ── 헤더 ── */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 20px 16px;
    border-bottom: 1px solid rgba(16, 11, 50, 0.07);
    gap: 8px;
    flex-shrink: 0;
  }
  .header-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .header-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .header-name {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .header-email {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .role-badge {
    flex-shrink: 0;
    display: inline-block;
    font: var(--text-pc-script-12);
    font-weight: 700;
    border-radius: var(--radius-sm);
    padding: 2px 7px;
  }
  .role-badge.role-superadmin { background: rgba(59,47,138,0.12); color: var(--cs-purple); }
  .role-badge.role-manager    { background: rgba(16,11,50,0.07);  color: var(--cs-text-dark); }
  .role-badge.role-partner    { background: rgba(255,69,0,0.08);  color: var(--cs-orange); }

  .suspended-badge {
    flex-shrink: 0;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-red-badge);
    background: rgba(255, 53, 53, 0.08);
    border-radius: var(--radius-sm);
    padding: 2px 7px;
  }

  .close-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    color: var(--cs-text-light);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  /* ── 탭 바 ── */
  .tab-bar {
    display: flex;
    border-bottom: 1px solid rgba(16, 11, 50, 0.07);
    flex-shrink: 0;
  }
  .tab-btn {
    flex: 1;
    height: 40px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    padding: 0 12px;
  }
  .tab-btn.active {
    color: var(--cs-purple);
    border-bottom-color: var(--cs-purple);
  }
  .tab-btn:not(.active):hover { color: var(--cs-text); }

  /* ── 탭 콘텐츠 ── */
  .tab-content {
    flex: 1;
    overflow-y: auto;
  }

  /* ── 기본정보 탭 ── */
  .info-section {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }
  .field-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .field-form {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .field-input {
    flex: 1;
    height: 36px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    border: 1px solid rgba(16,11,50,0.12);
    border-radius: var(--cms-radius-sm);
    padding: 0 10px;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .field-input:focus { border-color: var(--cs-purple); }
  .field-input:disabled { opacity: 0.5; }
  .field-readonly {
    font: var(--text-pc-body-14);
    color: var(--cs-text-dark);
    background: var(--cs-surface-gray);
    border: 1px solid rgba(16,11,50,0.07);
    border-radius: var(--cms-radius-sm);
    padding: 8px 10px;
  }

  .save-btn {
    height: 36px;
    padding: 0 14px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.12s;
    flex-shrink: 0;
  }
  .save-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .save-btn:not(:disabled):hover { opacity: 0.85; }

  .section-divider {
    height: 1px;
    background: rgba(16, 11, 50, 0.06);
    margin: 4px 0 16px;
  }

  /* ── 토글 그룹 ── */
  .toggle-group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .toggle-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    font-weight: 600;
  }
  .toggle-note {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-weight: 400;
  }
  .toggle-desc {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  .toggle-na {
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    flex-shrink: 0;
  }

  /* ── 삭제 영역 ── */
  .delete-area {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .delete-trigger {
    height: 34px;
    padding: 0 14px;
    background: transparent;
    border: 1px solid rgba(255, 53, 53, 0.3);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-red-badge);
    cursor: pointer;
    transition: background 0.12s;
  }
  .delete-trigger:not(:disabled):hover { background: rgba(255, 53, 53, 0.06); }
  .delete-trigger:disabled { opacity: 0.3; cursor: not-allowed; }
  .delete-note {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  .delete-confirm {
    background: rgba(255, 53, 53, 0.04);
    border: 1px solid rgba(255, 53, 53, 0.15);
    border-radius: var(--cms-radius-sm);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .confirm-msg  { font: var(--text-pc-title-16); color: var(--cs-text); margin: 0; }
  .confirm-sub  { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .confirm-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    margin: 0;
  }
  .confirm-actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .confirm-actions form { display: contents; }
  .confirm-cancel {
    flex: 1;
    height: 36px;
    background: var(--cs-lilac);
    color: var(--cs-text);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .confirm-delete {
    flex: 1;
    height: 36px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .confirm-cancel:disabled,
  .confirm-delete:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── placeholder 탭 ── */
  .placeholder-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    gap: 8px;
    text-align: center;
  }
  .placeholder-icon { font-size: 32px; }
  .placeholder-title {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    font-weight: 700;
    margin: 0;
  }
  .placeholder-desc {
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    margin: 0;
    line-height: 1.6;
  }

  /* ── 접속로그 탭 ── */
  .logs-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  /* 로딩·에러·빈 상태 공통 */
  .logs-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 48px 24px;
    text-align: center;
    flex: 1;
  }
  .logs-state-error .logs-state-text { color: var(--cs-red-badge); }
  .logs-state-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
  }
  .logs-empty-icon { font-size: 28px; }
  .logs-retry-btn {
    height: 32px;
    padding: 0 14px;
    background: var(--cs-lilac);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .logs-retry-btn:hover { opacity: 0.75; }

  /* 건수 */
  .logs-count {
    flex-shrink: 0;
    padding: 10px 16px 4px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  /* 테이블 래퍼 — 가로 스크롤 허용 */
  .logs-table-wrap {
    flex: 1;
    overflow-x: auto;
    overflow-y: auto;
    padding: 0 0 4px;
  }

  .logs-table {
    width: 100%;
    min-width: 460px;
    border-collapse: collapse;
    font: var(--text-pc-script-12);
  }

  .logs-table thead th {
    position: sticky;
    top: 0;
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font-weight: 700;
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(16,11,50,0.07);
    white-space: nowrap;
  }

  .logs-table tbody tr {
    border-bottom: 1px solid rgba(16,11,50,0.04);
    transition: background 0.1s;
  }
  .logs-table tbody tr:hover { background: rgba(59,47,138,0.03); }

  .logs-table tbody td {
    padding: 8px 10px;
    color: var(--cs-text);
    vertical-align: middle;
  }

  /* 열 너비 */
  .col-email  { width: 34%; }
  .col-at     { width: 22%; white-space: nowrap; }
  .col-ip     { width: 20%; white-space: nowrap; }
  .col-device { width: 24%; }

  .cell-email {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 0;
    white-space: nowrap;
  }
  .cell-at, .cell-ip {
    font-variant-numeric: tabular-nums;
    color: var(--cs-text-dark);
  }
  .cell-device { color: var(--cs-text-mid); }

  /* 페이지네이션 */
  .logs-pagination {
    flex-shrink: 0;
    padding: 4px 0 8px;
  }

  /* ── 권한설정 탭 (Stage 5) ── */
  .perms-tab {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .perms-section {
    padding-bottom: 16px;
  }

  .perms-section-title {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    margin: 0 0 10px;
  }

  .perms-desc {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 0 0 12px;
  }

  .perms-note {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 6px 0 0;
  }

  /* 관리자 레벨 콤보 행 */
  .role-combo-row {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .role-combo-row form { display: contents; }

  /* 읽기전용 역할 표시 */
  .role-readonly-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* ── 콤보 버튼 (CMS 톤 재해석) ── */
  /* uiux-index.md "콤보 버튼 선택 그룹" 표준을 CMS 톤으로 적용:
     - 선택 배경: --cs-purple (front 표준과 동일 색이지만 CMS 반경 --cms-radius-md(15px) 적용)
     - 비선택: --cs-surface-gray + 1px border */
  .combo-btn {
    height: 32px;
    padding: 0 14px;
    border-radius: var(--cms-radius-md);
    border: 1px solid rgba(16, 11, 50, 0.15);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    white-space: nowrap;
  }
  .combo-btn:hover:not(:disabled) {
    border-color: rgba(59, 47, 138, 0.35);
    color: var(--cs-text);
  }
  .combo-btn.combo-active {
    background: var(--cs-purple);
    border-color: var(--cs-purple);
    color: #fff;
  }
  /* 선택된 버튼은 disabled여도 선택 상태 색상 유지 */
  .combo-btn.combo-active:disabled {
    opacity: 1;
    cursor: default;
  }
  /* 비선택 disabled */
  .combo-btn:disabled:not(.combo-active) {
    opacity: 0.38;
    cursor: not-allowed;
  }

  /* 메뉴 항목용 소형 콤보 버튼 */
  .combo-btn.combo-sm {
    height: 26px;
    padding: 0 10px;
    font-size: 11px;
    border-radius: var(--cms-radius-sm);
  }

  /* ── 메뉴 권한 그리드 ── */
  .menu-grid {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .menu-group {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .menu-group-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    padding: 4px 0 6px;
    border-bottom: 1px solid rgba(16, 11, 50, 0.06);
    margin-bottom: 2px;
  }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 0;
    border-bottom: 1px solid rgba(16, 11, 50, 0.03);
  }
  .menu-item:last-child { border-bottom: none; }

  .menu-item-dimmed {
    opacity: 0.4;
  }

  .menu-item-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-combo {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  /* 권한 로딩·에러 상태 */
  .perms-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
  }
  .perms-state-error .perms-state-text { color: var(--cs-red-badge); }
  .perms-state-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
  }
  .perms-retry-btn {
    height: 30px;
    padding: 0 12px;
    background: var(--cs-lilac);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .perms-retry-btn:hover { opacity: 0.75; }

  /* ── 비밀번호 변경 모달 ── */
  .pw-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .pw-modal-wrap {
    background: var(--cs-white);
    border-radius: var(--cms-radius-sm);
    width: 360px;
    max-width: 100%;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  }
  .pw-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
  }
  .pw-modal-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
  }
  .pw-modal-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 20px;
  }
  .pw-modal-form .field-label { margin-top: 10px; }
  .pw-modal-form .field-label:first-child { margin-top: 0; }
  .pw-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    margin: 0 0 4px;
  }
  .pw-submit-btn {
    height: 40px;
    margin-top: 16px;
    background: var(--cs-purple);
    border: none;
    border-radius: var(--cms-radius-md);
    color: #fff;
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .pw-submit-btn:hover:not(:disabled) { opacity: 0.85; }
  .pw-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
