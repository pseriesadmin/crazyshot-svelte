<script lang="ts">
  import { invalidateAll, goto } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import type { PageData } from './$types'
  import type { PushConfigRow, AdminNotifyRow, PushLogRow } from './+page.server'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()

  let pushConfig = $state<PushConfigRow[]>(data.pushConfig)
  let adminList = $state<AdminNotifyRow[]>(data.adminList)

  $effect(() => { pushConfig = data.pushConfig })
  $effect(() => { adminList = data.adminList })

  const lifecycleRows = $derived(pushConfig.filter((r) => r.category === 'customer_lifecycle'))
  const marketingRows = $derived(pushConfig.filter((r) => r.category === 'customer_marketing'))

  // ─── 섹션 a·b: 고객 알림 마스터 스위치 ───
  let togglingConfigId = $state<number | null>(null)

  async function togglePushConfig(row: PushConfigRow): Promise<void> {
    togglingConfigId = row.id
    const nextEnabled = !row.push_enabled
    const fd = new FormData()
    fd.set('notify_type', row.notify_type)
    fd.set('push_enabled', String(nextEnabled))
    try {
      await fetch('?/updatePushConfig', { method: 'POST', body: fd })
      csToast.success(`'${row.label}' 알림을 ${nextEnabled ? '켰습니다.' : '껐습니다.'}`)
      await invalidateAll()
    } catch {
      csToast.error('저장에 실패했습니다.')
    } finally {
      togglingConfigId = null
    }
  }

  // ─── 섹션 c: 관리자 알림 수신 중앙관리 ───
  const ADMIN_EVENTS = [
    { key: 'new_reservation', label: '예약신청', field: 'admin_notify_new_reservation' as const },
    { key: 'contract_signed', label: '전자서명', field: 'admin_notify_contract_signed' as const },
    { key: 'payment_completed', label: '결제완료', field: 'admin_notify_payment_completed' as const },
    { key: 'new_session', label: '신규상담', field: 'admin_notify_new_session' as const },
  ] as const

  let togglingAdminCell = $state<string | null>(null)

  async function toggleAdminNotify(
    row: AdminNotifyRow,
    eventKey: (typeof ADMIN_EVENTS)[number]['key'],
    field: (typeof ADMIN_EVENTS)[number]['field'],
  ): Promise<void> {
    const cellKey = `${row.id}:${eventKey}`
    togglingAdminCell = cellKey
    const nextEnabled = !row[field]
    const fd = new FormData()
    fd.set('target_user_id', row.id)
    fd.set('event_key', eventKey)
    fd.set('enabled', String(nextEnabled))
    try {
      await fetch('?/updateAdminNotify', { method: 'POST', body: fd })
      await invalidateAll()
    } catch {
      csToast.error('저장에 실패했습니다.')
    } finally {
      togglingAdminCell = null
    }
  }

  // ─── 섹션 d: 발송 로그 ───
  const STATUS_OPTIONS = [
    { value: 'all', label: '전체 상태' },
    { value: 'sent', label: '성공' },
    { value: 'skipped', label: '스킵' },
    { value: 'error', label: '실패' },
  ]

  const logTypeOptions = $derived([
    { value: 'all', label: '전체 이벤트' },
    ...pushConfig.map((r) => ({ value: r.notify_type, label: r.label })),
    { value: 'new_reservation', label: '예약신청(관리자)' },
    { value: 'contract_signed', label: '전자서명(관리자)' },
    { value: 'payment_completed', label: '결제완료(관리자)' },
    { value: 'new_session', label: '신규상담(관리자)' },
  ])

  function applyLogFilter(status: string, type: string, page: number): void {
    const params = new URLSearchParams()
    if (status !== 'all') params.set('log_status', status)
    if (type !== 'all') params.set('log_type', type)
    if (page > 1) params.set('log_page', String(page))
    const qs = params.toString()
    goto(qs ? `?${qs}` : '?', { keepFocus: true, noScroll: true })
  }

  function statusMeta(metadata: PushLogRow['metadata']): { text: string; cls: string } {
    const status = metadata?.status ?? 'unknown'
    if (status === 'sent') return { text: '성공', cls: 'log-badge--sent' }
    if (status === 'skipped') return { text: '스킵', cls: 'log-badge--skipped' }
    if (status === 'error') return { text: '실패', cls: 'log-badge--error' }
    return { text: status, cls: 'log-badge--skipped' }
  }

  function formatDateTime(iso: string): string {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
</script>

<div class="page-wrap">
  <div class="sections">

    <!-- ══════════════════════════════════════════
         섹션 a: 고객 라이프사이클 알림
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">고객 알림 — 예약~대여~반납</h2>
        <span class="section-badge">{lifecycleRows.length}종</span>
      </div>
      <p class="section-desc">예약 신청부터 반납 완료까지 각 단계에서 고객에게 푸시알림을 발송할지 여부를 설정합니다.</p>

      <div class="push-row-list">
        {#each lifecycleRows as row (row.id)}
          <div class="push-row">
            <span class="push-row-label">{row.label}</span>
            <button
              type="button"
              class="s-chip"
              class:s-chip--on={row.push_enabled}
              disabled={togglingConfigId === row.id}
              onclick={() => togglePushConfig(row)}
            >{row.push_enabled ? '발송 ON' : '발송 OFF'}</button>
          </div>
        {/each}
      </div>
    </section>

    <!-- ══════════════════════════════════════════
         섹션 b: 이벤트·쿠폰 발행 알림
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">이벤트·쿠폰 발행 알림</h2>
      </div>
      <p class="section-desc">전체 고객 대상 이벤트·쿠폰 발행 시 푸시알림 발송 여부를 설정합니다. 개별 고객의 수신 동의(혜택 알림 허용)와 함께 적용됩니다.</p>

      <div class="push-row-list">
        {#each marketingRows as row (row.id)}
          <div class="push-row">
            <span class="push-row-label">{row.label}</span>
            <button
              type="button"
              class="s-chip"
              class:s-chip--on={row.push_enabled}
              disabled={togglingConfigId === row.id}
              onclick={() => togglePushConfig(row)}
            >{row.push_enabled ? '발송 ON' : '발송 OFF'}</button>
          </div>
        {/each}
      </div>
    </section>

    <!-- ══════════════════════════════════════════
         섹션 c: 관리자 알림 수신 (중앙관리)
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">관리자 알림 수신 설정</h2>
        <span class="section-badge">{adminList.length}명</span>
      </div>
      <p class="section-desc">고객의 예약신청·전자서명·결제완료 행위 발생 시 각 관리자 계정이 푸시알림을 받을지 설정합니다.</p>

      {#if adminList.length > 0}
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th class="at-name-col">관리자</th>
                {#each ADMIN_EVENTS as evt (evt.key)}
                  <th>{evt.label}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each adminList as row (row.id)}
                <tr>
                  <td class="at-name-col">
                    <span class="at-name">{row.full_name || row.email}</span>
                    <span class="at-role-badge">{row.cms_role}</span>
                  </td>
                  {#each ADMIN_EVENTS as evt (evt.key)}
                    <td>
                      <button
                        type="button"
                        class="s-chip s-chip--sm"
                        class:s-chip--on={row[evt.field]}
                        disabled={togglingAdminCell === `${row.id}:${evt.key}`}
                        onclick={() => toggleAdminNotify(row, evt.key, evt.field)}
                        aria-label="{row.full_name || row.email} {evt.label} 알림 {row[evt.field] ? '끄기' : '켜기'}"
                      >{row[evt.field] ? 'ON' : 'OFF'}</button>
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="empty-hint">등록된 관리자 계정이 없습니다.</p>
      {/if}
    </section>

    <!-- ══════════════════════════════════════════
         섹션 d: 발송 로그
    ══════════════════════════════════════════ -->
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">푸시알림 발송 로그</h2>
      </div>
      <p class="section-desc">발송 성공·스킵·실패 이력을 확인합니다.</p>

      <div class="log-filter-row">
        <select
          class="log-filter-select"
          value={data.logStatus}
          onchange={(e) => applyLogFilter(e.currentTarget.value, data.logType, 1)}
          aria-label="상태 필터"
        >
          {#each STATUS_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
        <select
          class="log-filter-select"
          value={data.logType}
          onchange={(e) => applyLogFilter(data.logStatus, e.currentTarget.value, 1)}
          aria-label="이벤트 필터"
        >
          {#each logTypeOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      {#if data.logs.length > 0}
        <div class="log-table-wrap">
          <table class="log-table">
            <thead>
              <tr>
                <th>발송시각</th>
                <th>수신자</th>
                <th>이벤트</th>
                <th>상태</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {#each data.logs as log (log.id)}
                {@const meta = statusMeta(log.metadata)}
                <tr>
                  <td class="log-time">{formatDateTime(log.sent_at)}</td>
                  <td>{log.recipient_name}</td>
                  <td>{log.type}</td>
                  <td><span class="log-badge {meta.cls}">{meta.text}</span></td>
                  <td class="log-body-cell">
                    <span class="log-title">{log.title}</span>
                    {#if log.metadata?.reason}
                      <span class="log-reason">{log.metadata.reason}</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <CmsPagination
          page={data.logPage}
          totalPages={data.totalLogPages}
          onpage={(p) => applyLogFilter(data.logStatus, data.logType, p)}
          variant="bottom"
          ariaLabel="발송 로그 페이지 탐색"
        />
      {:else}
        <p class="empty-hint">발송 로그가 없습니다.</p>
      {/if}
    </section>

  </div>
</div>

<style>
  .page-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 32px 16px;
    min-width: 0;
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .setting-section {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 34px 32px;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }

  .section-title {
    font: var(--text-pc-menu-kr-20);
    color: var(--cs-dark);
    margin: 0;
  }

  .section-badge {
    background: var(--cs-lilac);
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    font-weight: 700;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  .section-desc {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    margin: 0 0 32px;
  }

  /* ─── 섹션 a·b: 알림 마스터 스위치 목록 ─── */
  .push-row-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .push-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
  }

  .push-row-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }

  /* ─── on/off 칩 버튼 (rental 설정 페이지와 동일 컨벤션) ─── */
  .s-chip {
    height: 36px;
    padding: 0 18px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-md);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .s-chip--on {
    background: var(--cs-purple);
    color: var(--cs-white);
    border-color: var(--cs-purple);
  }

  .s-chip:not(.s-chip--on):hover {
    border-color: rgba(59, 47, 138, 0.4);
    background: rgba(59, 47, 138, 0.04);
  }

  .s-chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .s-chip--sm {
    height: 28px;
    padding: 0 12px;
    font: var(--text-pc-script-12);
  }

  /* ─── 섹션 c: 관리자 알림 테이블 ─── */
  .admin-table-wrap {
    overflow-x: auto;
  }

  .admin-table {
    width: 100%;
    border-collapse: collapse;
  }

  .admin-table th {
    text-align: left;
    padding: 10px 14px;
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text-mid);
    border-bottom: 1px solid var(--cs-lilac);
    white-space: nowrap;
  }

  .admin-table td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    vertical-align: middle;
  }

  .at-name-col {
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }

  .at-name {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }

  .at-role-badge {
    background: var(--cs-lilac);
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    font-weight: 700;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  /* ─── 섹션 d: 발송 로그 ─── */
  .log-filter-row {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
  }

  .log-filter-select {
    height: 36px;
    padding: 0 12px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    color: var(--cs-text);
    font: var(--text-pc-body-14);
    cursor: pointer;
  }

  .log-table-wrap {
    overflow-x: auto;
  }

  .log-table {
    width: 100%;
    border-collapse: collapse;
  }

  .log-table th {
    text-align: left;
    padding: 10px 14px;
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text-mid);
    border-bottom: 1px solid var(--cs-lilac);
    white-space: nowrap;
  }

  .log-table td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }

  .log-time {
    color: var(--cs-text-mid);
    white-space: nowrap;
  }

  .log-badge {
    display: inline-flex;
    padding: 3px 10px;
    border-radius: var(--radius-full);
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
  }

  .log-badge--sent {
    background: rgba(59, 47, 138, 0.08);
    color: var(--cs-purple);
  }

  .log-badge--error {
    background: rgba(255, 53, 53, 0.08);
    color: var(--cs-red-badge);
  }

  .log-badge--skipped {
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
  }

  .log-body-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .log-title {
    color: var(--cs-text);
  }

  .log-reason {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  /* ─── 빈 상태 ─── */
  .empty-hint {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    text-align: center;
    padding: 20px 0;
    margin: 0;
  }
</style>
