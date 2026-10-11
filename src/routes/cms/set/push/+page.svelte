<script lang="ts">
  import { invalidateAll, goto } from '$app/navigation'
  import { deserialize } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import {
    NOTIFY_VARIABLES,
    SMS_BRAND_PREFIX,
    applyNotifyTemplate,
    getNotifySpec,
    validateNotifyMessage,
    type NotifyVarKey,
    type NotifyVars,
  } from '$lib/utils/notifyTemplate'
  import { isValidLockerPassword, sanitizeLockerInput } from '$lib/utils/lockerFields'
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

  // 서버 액션 응답을 확인해 실패(401/403/400/500)를 성공으로 오인하지 않도록 한다.
  // 성공 시 null, 실패 시 사용자에게 보일 문구를 반환.
  async function postAction(action: string, fd: FormData): Promise<string | null> {
    const res = await fetch(action, { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } })
    const result = deserialize(await res.text())
    if (result.type === 'success') return null
    if (result.type === 'failure') return (result.data as { message?: string } | undefined)?.message ?? '저장에 실패했습니다.'
    return '저장에 실패했습니다.'
  }

  async function togglePushConfig(row: PushConfigRow): Promise<void> {
    togglingConfigId = row.id
    const nextEnabled = !row.push_enabled
    const fd = new FormData()
    fd.set('notify_type', row.notify_type)
    fd.set('push_enabled', String(nextEnabled))
    try {
      const err = await postAction('?/updatePushConfig', fd)
      if (err) {
        csToast.error(err)
        return
      }
      csToast.success(`'${row.label}' 알림을 ${nextEnabled ? '켰습니다.' : '껐습니다.'}`)
      await invalidateAll()
    } catch {
      csToast.error('저장에 실패했습니다.')
    } finally {
      togglingConfigId = null
    }
  }

  // ─── 알림별 안내문장 편집(아코디언) ───
  // 푸시·문자 같은 문장을 쓴다. 비어 있으면 코드의 기본 문구를 그대로 쓴다.
  const ANSWER_TYPES = new Set(['admin_chat_reply', 'ai_auto_reply', 'canned_auto_reply'])
  const SAMPLE_VARS: NotifyVars = Object.fromEntries(Object.values(NOTIFY_VARIABLES).map((v) => [v.key, v.sample]))

  let openType = $state<string | null>(null)
  // 입력 중인 문장 — 행을 펼칠 때 서버값으로 채운다(prop으로 $state를 초기화하지 않고 펼침 시점에 지정)
  let drafts = $state<Record<string, string>>({})
  let savingType = $state<string | null>(null)
  let textareaEl = $state<HTMLTextAreaElement | null>(null)

  function draftOf(row: PushConfigRow): string {
    return drafts[row.notify_type] ?? row.message ?? ''
  }

  function toggleOpen(row: PushConfigRow): void {
    if (openType === row.notify_type) {
      openType = null
      return
    }
    drafts[row.notify_type] = row.message ?? ''
    openType = row.notify_type
  }

  function isMessageDirty(row: PushConfigRow): boolean {
    return draftOf(row).trim() !== (row.message ?? '').trim()
  }

  function insertVariable(row: PushConfigRow, key: NotifyVarKey): void {
    const token = `{{${key}}}`
    const cur = draftOf(row)
    const el = textareaEl
    const start = el?.selectionStart ?? cur.length
    const end = el?.selectionEnd ?? start
    drafts[row.notify_type] = cur.slice(0, start) + token + cur.slice(end)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  function fillDefaultMessage(row: PushConfigRow): void {
    const spec = getNotifySpec(row.notify_type)
    if (spec) drafts[row.notify_type] = spec.defaultMessage
  }

  async function saveMessage(row: PushConfigRow, message: string): Promise<void> {
    savingType = row.notify_type
    const fd = new FormData()
    fd.set('notify_type', row.notify_type)
    fd.set('message', message)
    try {
      const err = await postAction('?/updatePushMessage', fd)
      if (err) {
        csToast.error(err)
        return
      }
      drafts[row.notify_type] = message.trim()
      csToast.success(message.trim() === '' ? `'${row.label}' 안내문장을 기본 문구로 복원했습니다.` : `'${row.label}' 안내문장을 저장했습니다.`)
      await invalidateAll()
    } catch {
      csToast.error('저장에 실패했습니다.')
    } finally {
      savingType = null
    }
  }

  // ─── 무인보관함 중앙현관 비밀번호(2026-10-11) — 채팅카드·문자·푸시 변수가 같은 값을 읽는다 ───
  let entranceDraft = $state<string | null>(null)
  let savingEntrance = $state(false)
  const entranceSaved = $derived(data.lockerEntrancePassword ?? '')
  const entranceValue = $derived(entranceDraft ?? entranceSaved)
  const entranceDirty = $derived(entranceValue.trim() !== entranceSaved.trim())
  const entranceValid = $derived(entranceValue.trim() === '' || isValidLockerPassword(entranceValue.trim()))

  async function saveEntrance(): Promise<void> {
    savingEntrance = true
    const fd = new FormData()
    fd.set('password', entranceValue.trim())
    try {
      const err = await postAction('?/updateLockerEntrance', fd)
      if (err) {
        csToast.error(err)
        return
      }
      entranceDraft = null
      csToast.success(entranceValue.trim() === '' ? '중앙현관 비밀번호를 삭제했습니다.' : '중앙현관 비밀번호를 저장했습니다.')
      await invalidateAll()
    } catch {
      csToast.error('저장에 실패했습니다.')
    } finally {
      savingEntrance = false
    }
  }

  // ─── 섹션 c: 관리자 알림 수신 중앙관리 ───
  const ADMIN_EVENTS = [
    { key: 'new_reservation', label: '예약신청', field: 'admin_notify_new_reservation' as const },
    { key: 'contract_signed', label: '전자서명', field: 'admin_notify_contract_signed' as const },
    { key: 'payment_completed', label: '결제완료', field: 'admin_notify_payment_completed' as const },
    { key: 'new_session', label: '신규상담', field: 'admin_notify_new_session' as const },
    { key: 'urgent_chat_message', label: '긴급상담', field: 'admin_notify_urgent_chat_message' as const },
    { key: 'identity_review', label: '본인증명승인', field: 'admin_notify_identity_review' as const },
    { key: 'crazychat_request', label: '크레이지챗접수', field: 'admin_notify_crazychat_request' as const },
  ] as const

  let togglingAdminCell = $state<string | null>(null)

  // 마스터(superadmin) 계정의 수신 설정은 실제 superadmin만 변경 가능(서버 게이트와 동일 기준) —
  // manager에게는 해당 행 토글을 비활성화해 눌러서 오류를 보는 경로를 없앤다.
  function isAdminRowLocked(row: AdminNotifyRow): boolean {
    return row.cms_role === 'superadmin' && data.cmsRole !== 'superadmin'
  }

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
      const err = await postAction('?/updateAdminNotify', fd)
      if (err) {
        csToast.error(err)
        return
      }
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
    { value: 'urgent_chat_message', label: '긴급상담(관리자)' },
    { value: 'identity_review', label: '본인증명승인(관리자)' },
    { value: 'crazychat_request', label: '크레이지챗접수(관리자)' },
  ])

  // 로그 "이벤트" 열 한글 표기 — 설정 라벨 + 관리자 이벤트 라벨, 매핑 없으면 원문 코드 그대로
  const typeLabelMap = $derived(new Map(logTypeOptions.filter((o) => o.value !== 'all').map((o) => [o.value, o.label])))

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

  // 시각은 KST 고정 표기(브라우저 로컬 시간대와 무관, SSR/하이드레이션 일치)
  function formatDateTime(iso: string): string {
    const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${kst.getUTCFullYear()}.${pad(kst.getUTCMonth() + 1)}.${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
  }
</script>

{#snippet pushRow(row: PushConfigRow)}
  {@const spec = getNotifySpec(row.notify_type)}
  {@const isOpen = openType === row.notify_type}
  <div class="push-row" class:push-row--open={isOpen}>
    <div class="push-row-head">
      <button
        type="button"
        class="push-row-main"
        aria-expanded={isOpen}
        aria-controls="msg-{row.notify_type}"
        disabled={!spec}
        onclick={() => toggleOpen(row)}
      >
        <ChevronIcon direction={isOpen ? 'down' : 'right'} size={7} color="var(--cs-text-mid)" />
        <span class="push-row-label">{row.label}</span>
        {#if spec}
          <span class="msg-badge" class:msg-badge--sms={spec.sms}>{spec.sms ? '푸시+문자' : '푸시 전용'}</span>
        {/if}
        {#if row.message}
          <span class="msg-badge msg-badge--custom">문구 설정됨</span>
        {/if}
      </button>
      <button
        type="button"
        class="s-chip"
        class:s-chip--on={row.push_enabled}
        disabled={togglingConfigId === row.id}
        onclick={() => togglePushConfig(row)}
      >{row.push_enabled ? '발송 ON' : '발송 OFF'}</button>
    </div>

    {#if isOpen && spec}
      {@const draft = draftOf(row)}
      {@const check = validateNotifyMessage(row.notify_type, draft)}
      {@const previewBody = applyNotifyTemplate(draft.trim() === '' ? spec.defaultMessage : draft, SAMPLE_VARS)}
      <div class="msg-panel" id="msg-{row.notify_type}">
        <div class="msg-editor">
          <div class="msg-editor-head">
            <span class="msg-field-title">안내문장</span>
            <button type="button" class="btn-text-inline" onclick={() => fillDefaultMessage(row)}>기본 문구 불러오기</button>
          </div>
          <textarea
            class="msg-textarea"
            rows="4"
            maxlength="1000"
            bind:this={textareaEl}
            value={draft}
            oninput={(e) => { drafts[row.notify_type] = e.currentTarget.value }}
            placeholder={spec.defaultMessage}
            aria-label="{row.label} 안내문장"
          ></textarea>
          <div class="msg-meta">
            <span>{draft.length}/1000자</span>
            {#if spec.sms && draft.trim() !== ''}
              <span class:msg-meta--warn={check.smsKind !== 'SMS'}>문자 최대 {check.smsBytes}바이트 · {check.smsKind === 'SMS' ? '단문(SMS)' : check.smsKind === 'LMS' ? '장문(LMS)' : '2000바이트 초과'}</span>
            {/if}
            {#if draft.trim() === ''}<span>비워 두면 기본 문구가 발송됩니다.</span>{/if}
          </div>
          {#if !check.ok}
            <p class="msg-error" role="alert">{check.error}</p>
          {/if}
          {#each check.warnings as w (w)}
            <p class="msg-warn">{w}</p>
          {/each}
          {#if ANSWER_TYPES.has(row.notify_type)}
            <p class="msg-warn">기본값은 실제 답변 내용({'{{답변내용}}'})입니다. 다른 문장으로 바꾸면 고객에게 답변 내용 대신 이 문장이 표시됩니다.</p>
          {/if}

          <div class="msg-preview">
            <span class="msg-field-title">미리보기(예시값)</span>
            <div class="msg-preview-box"><span class="msg-preview-tag">푸시</span>{previewBody}</div>
            {#if spec.sms}
              <div class="msg-preview-box"><span class="msg-preview-tag">문자</span>{SMS_BRAND_PREFIX}{previewBody}</div>
            {/if}
          </div>

          {#if row.notify_type === 'locker_guide'}
            <div class="entrance-box">
              <span class="msg-field-title">중앙현관 비밀번호</span>
              <p class="msg-hint">위 안내문장의 {'{{중앙현관비밀번호}}'} 변수에 들어가는 값입니다. 푸시·문자·채팅카드가 같은 값을 씁니다. 비우면 이 변수가 들어 있는 줄이 문장에서 빠집니다.</p>
              <div class="entrance-row">
                <input
                  type="text"
                  class="msg-input"
                  maxlength="10"
                  value={entranceValue}
                  oninput={(e) => { entranceDraft = sanitizeLockerInput(e.currentTarget.value); e.currentTarget.value = entranceDraft }}
                  placeholder="중앙현관 비밀번호 입력"
                  aria-label="무인보관함 중앙현관 비밀번호"
                  disabled={savingEntrance}
                />
                <button
                  type="button"
                  class="btn-save-inline"
                  class:dirty={entranceDirty && entranceValid}
                  disabled={savingEntrance || !entranceDirty || !entranceValid}
                  onclick={saveEntrance}
                >저장</button>
              </div>
              {#if !entranceValid}
                <p class="msg-error" role="alert">4~10자의 숫자·특수문자만 입력할 수 있습니다.</p>
              {/if}
              <p class="msg-warn">안내문장은 푸시·문자·채팅카드에 같은 문장으로 해당 예약 고객 1명에게만 발송됩니다. 비밀번호 변수는 휴대폰 잠금 화면 알림에도 그대로 보일 수 있습니다.</p>
            </div>
          {/if}

          <div class="msg-actions">
            <button
              type="button"
              class="btn-reset-inline"
              disabled={savingType === row.notify_type || !row.message}
              onclick={() => saveMessage(row, '')}
            >기본 문구로 복원</button>
            <button
              type="button"
              class="btn-save-inline"
              class:dirty={isMessageDirty(row) && check.ok}
              disabled={savingType === row.notify_type || !isMessageDirty(row) || !check.ok}
              onclick={() => saveMessage(row, draft)}
            >저장</button>
          </div>
        </div>

        <div class="msg-vars">
          <span class="msg-field-title">변수</span>
          <p class="msg-hint">클릭하면 커서 위치에 삽입됩니다.</p>
          <div class="msg-chips">
            {#each spec.vars as key (key)}
              <button
                type="button"
                class="var-chip"
                onmousedown={(e) => e.preventDefault()}
                onclick={() => insertVariable(row, key)}
                title={`{{${key}}} 삽입`}
              >
                <span class="var-chip-label">{NOTIFY_VARIABLES[key].label}</span>
                <span class="var-chip-var">{`{{${key}}}`}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

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
      <p class="section-desc">예약 신청부터 반납 완료까지 각 단계에서 고객에게 푸시알림을 발송할지 여부를 설정합니다. 알림 이름을 눌러 안내문장을 직접 바꿀 수 있고, 같은 문장이 푸시와 문자(해당 알림)에 함께 쓰입니다.</p>

      <div class="push-row-list">
        {#each lifecycleRows as row (row.id)}
          {@render pushRow(row)}
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
          {@render pushRow(row)}
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
      <p class="section-desc">고객의 예약신청·전자서명·결제완료·본인증명 등록(승인 요청) 등 행위 발생 시 각 관리자 계정이 푸시알림을 받을지 설정합니다.</p>

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
                        disabled={togglingAdminCell === `${row.id}:${evt.key}` || isAdminRowLocked(row)}
                        title={isAdminRowLocked(row) ? '마스터 계정의 설정은 마스터만 변경할 수 있습니다.' : undefined}
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
                  <td>{typeLabelMap.get(log.type) ?? log.type}</td>
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
    flex-direction: column;
    padding: 14px 18px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
  }

  .push-row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .push-row-main {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
  }

  .push-row-main:disabled {
    cursor: default;
  }

  .push-row-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }

  .msg-badge {
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 700;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  .msg-badge--sms {
    color: var(--cs-purple);
  }

  .msg-badge--custom {
    background: var(--cs-purple);
    color: var(--cs-white);
  }

  /* ─── 안내문장 편집 패널 ─── */
  .msg-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 240px;
    gap: 20px;
    margin-top: 14px;
    padding-top: 16px;
    border-top: 1px solid var(--cs-lilac);
  }

  .msg-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .msg-editor-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .msg-field-title {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }

  .msg-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 16px;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    resize: vertical;
  }

  .msg-textarea::placeholder {
    color: var(--cs-text-light);
  }

  .msg-textarea:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }

  .entrance-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
  }

  .entrance-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .msg-input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: 40px;
    padding: 0 16px;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }

  .msg-input::placeholder {
    color: var(--cs-text-light);
  }

  .msg-input:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }

  .msg-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .msg-meta--warn {
    color: var(--cs-purple);
    font-weight: 700;
  }

  .msg-error {
    margin: 0;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-red-badge);
  }

  .msg-warn {
    margin: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .msg-preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }

  .msg-preview-box {
    padding: 10px 14px;
    background: var(--cs-white);
    border-radius: var(--radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: pre-wrap;
    word-break: keep-all;
  }

  .msg-preview-tag {
    display: inline-block;
    margin-right: 8px;
    padding: 1px 8px;
    background: var(--cs-lilac);
    color: var(--cs-purple);
    border-radius: var(--radius-full);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }

  .msg-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }

  /* cms-uiux.md §0-10-D 섹션 인라인 저장 버튼 — 변경사항이 있을 때만 활성 */
  .btn-save-inline {
    padding: 5px 14px;
    border: 1.5px solid var(--cs-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-light);
    font: var(--text-pc-script-12);
    cursor: not-allowed;
    min-height: 32px;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .btn-save-inline.dirty {
    border-color: var(--cs-purple);
    background: var(--cs-purple);
    color: var(--cs-white);
    cursor: pointer;
  }

  .btn-save-inline.dirty:hover {
    opacity: 0.85;
  }

  /* 보조 텍스트 버튼 — 면(fill)·테두리 없이 글자만, 호버는 배경색 변경만 */
  .btn-reset-inline,
  .btn-text-inline {
    padding: 5px 10px;
    min-height: 32px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s;
  }

  .btn-reset-inline:hover:not(:disabled),
  .btn-text-inline:hover {
    background: var(--cs-lilac);
  }

  .btn-reset-inline:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ─── 변수 선택 패널 ─── */
  .msg-vars {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .msg-hint {
    margin: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .msg-chips {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .var-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 36px;
    padding: 6px 12px;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .var-chip:hover {
    background: var(--cs-lilac);
  }

  .var-chip-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
  }

  .var-chip-var {
    font: var(--text-pc-script-12);
    font-family: monospace;
    color: var(--cs-purple);
    white-space: nowrap;
  }

  /* ─── on/off 칩 버튼 (rental 설정 페이지와 동일 컨벤션) ─── */
  /* cms-uiux.md §0-10-G DetailPanel 전용 버튼 — 대형(44px·padding 0 20px·15px·body-14). OFF 상태는 토글 구분을 위해 기존 흰 배경 유지 */
  .s-chip {
    height: 44px;
    padding: 0 20px;
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

  .s-chip--on:hover:not(:disabled) {
    background: var(--cs-purple-hover);
    border-color: var(--cs-purple-hover);
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
