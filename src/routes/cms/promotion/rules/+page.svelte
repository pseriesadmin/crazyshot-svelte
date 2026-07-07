<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { MarketingRule, MarketingRuleLog } from './+page.server'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  // 서버 타입을 명시적으로 캐스팅 (marketing_rules 테이블이 database.ts 미정의)
  let rules = $derived((data.rules as unknown as MarketingRule[]) ?? [])
  let logs  = $derived((data.logs  as unknown as MarketingRuleLog[]) ?? [])

  // ─ 탭 ─
  const TABS = [
    { id: 'list',    label: '룰 목록' },
    { id: 'create',  label: '룰 생성' },
    { id: 'history', label: '실행 이력' },
  ] as const

  let activeTab = $state<'list' | 'create' | 'history'>('list')

  // ─ 폼 상태 ─
  let f_name         = $state('')
  let f_trigger_type = $state('cart_abandon_24h')
  let f_trigger_meta = $state('')
  let f_action_type  = $state('send_coupon')
  let f_action_meta  = $state('')
  let createLoading  = $state(false)

  // ─ 삭제 확인 ─
  let deleteId        = $state('')
  let deleteName      = $state('')
  let showDeleteModal = $state(false)

  function confirmDelete(id: string, name: string) {
    deleteId   = id
    deleteName = name
    showDeleteModal = true
  }

  // ─ action 결과 처리 ─
  $effect(() => {
    if (!form) return
    if ('success' in form && form.success) {
      csToast.success('완료되었습니다.')
      showDeleteModal = false
      if (activeTab === 'create') {
        f_name = ''
        f_trigger_type = 'cart_abandon_24h'
        f_trigger_meta = ''
        f_action_type  = 'send_coupon'
        f_action_meta  = ''
        activeTab = 'list'
      }
    } else if ('error' in form && form.error) {
      csToast.error(String(form.error))
    }
  })

  // ─ 유틸 ─
  function triggerLabel(t: string): string {
    const MAP: Record<string, string> = {
      cart_abandon_24h: '장바구니 24h 미결제',
      dormant_30d:      '30일 미접속',
      vip_upgrade:      'VIP 승급',
      birthday:         '생일 당월',
      signup:           '신규 가입',
    }
    return MAP[t] ?? t
  }

  function actionLabel(a: string): string {
    const MAP: Record<string, string> = {
      send_coupon:       '쿠폰 발송',
      grant_points:      '포인트 지급',
      send_notification: '알림 (미구현)',
      send_kakao:        '카카오 (미구현)',
    }
    return MAP[a] ?? a
  }

  function formatDate(d: string | null | undefined): string {
    if (!d) return '—'
    return new Date(d).toLocaleString('ko-KR', {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
  }

  let isUnsupported = $derived(
    f_action_type === 'send_notification' || f_action_type === 'send_kakao'
  )
</script>

<div class="page-wrap">
  <!-- 서브탭 -->
  <div class="sub-tabs">
    {#each TABS as t}
      <button
        class="sub-tab-btn"
        class:active={activeTab === t.id}
        onclick={() => activeTab = t.id}
      >{t.label}</button>
    {/each}
  </div>

  <!-- ─────────────────────────────────
       탭1: 룰 목록
  ───────────────────────────────── -->
  {#if activeTab === 'list'}
    <div class="toolbar">
      <span class="section-title nm">마케팅 룰</span>
      <button class="btn-primary" onclick={() => activeTab = 'create'}>+ 룰 생성</button>
    </div>

    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>룰 이름</th>
            <th>트리거</th>
            <th>액션</th>
            <th>활성</th>
            <th>등록일</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {#each rules as rule}
            <tr>
              <td class="td-name">{rule.name}</td>
              <td>
                <span class="badge badge-info">{triggerLabel(rule.trigger_type)}</span>
              </td>
              <td>
                <span class="badge {rule.action_type === 'send_notification' || rule.action_type === 'send_kakao' ? 'badge-inactive' : 'badge-active'}">
                  {actionLabel(rule.action_type)}
                </span>
              </td>
              <td>
                <form method="POST" action="?/toggleRule" use:enhance>
                  <input type="hidden" name="id" value={rule.id} />
                  <input type="hidden" name="is_active" value={String(rule.is_active)} />
                  <button
                    type="submit"
                    class="tog"
                    class:tog-on={rule.is_active}
                    role="switch"
                    aria-checked={rule.is_active}
                    aria-label="룰 활성화 토글"
                  >
                    <span class="tog-thumb"></span>
                  </button>
                </form>
              </td>
              <td class="td-date">{formatDate(rule.created_at)}</td>
              <td>
                <button class="btn-danger sm" onclick={() => confirmDelete(rule.id, rule.name)}>삭제</button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="6" class="no-data">등록된 룰이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

  <!-- ─────────────────────────────────
       탭2: 룰 생성
  ───────────────────────────────── -->
  {:else if activeTab === 'create'}
    <div class="section-title">새 룰 등록</div>
    <div class="form-card">
      <form
        method="POST"
        action="?/createRule"
        use:enhance={() => {
          createLoading = true
          return ({ update }) => { createLoading = false; update() }
        }}
      >
        <div class="fs-title">기본 정보</div>
        <div class="form-field">
          <label for="r-name">룰 이름</label>
          <input id="r-name" name="name" class="f-input" bind:value={f_name} required
            placeholder="예: 장바구니 24h 미결제 쿠폰 발송" />
        </div>

        <div class="fs-title">트리거 조건</div>
        <div class="form-grid">
          <div class="form-field">
            <label for="r-trigger">트리거 유형</label>
            <select id="r-trigger" name="trigger_type" class="f-input" bind:value={f_trigger_type}>
              <option value="cart_abandon_24h">장바구니 24h 미결제</option>
              <option value="dormant_30d">30일 미접속</option>
              <option value="vip_upgrade">VIP 승급</option>
              <option value="birthday">생일 당월</option>
              <option value="signup">신규 가입</option>
            </select>
          </div>
          <div class="form-field">
            <label for="r-trigger-meta">트리거 메타 (JSON, 선택)</label>
            <textarea id="r-trigger-meta" name="trigger_meta" class="f-input ta" rows="3"
              bind:value={f_trigger_meta}
              placeholder="예: 트리거 메타 JSON"></textarea>
          </div>
        </div>

        <div class="fs-title">액션</div>
        <div class="form-grid">
          <div class="form-field">
            <label for="r-action">액션 유형</label>
            <select id="r-action" name="action_type" class="f-input" bind:value={f_action_type}>
              <option value="send_coupon">쿠폰 발송</option>
              <option value="grant_points">포인트 지급</option>
              <option value="send_notification">알림 전송</option>
              <option value="send_kakao">카카오 알림톡</option>
            </select>
          </div>
          <div class="form-field">
            <label for="r-action-meta">액션 메타 (JSON, 선택)</label>
            <textarea id="r-action-meta" name="action_meta" class="f-input ta" rows="3"
              bind:value={f_action_meta}
              placeholder="예: 액션 메타 JSON"></textarea>
          </div>
        </div>

        {#if isUnsupported}
          <div class="unsupported-notice">
            현재 미지원 액션입니다 — 룰 실행 시 로그만 기록되며 실제 발송은 이루어지지 않습니다.
          </div>
        {/if}

        <div class="form-actions">
          <button type="button" class="btn-ghost" onclick={() => activeTab = 'list'}>취소</button>
          <button type="submit" class="btn-primary" disabled={createLoading || !f_name}>
            {createLoading ? '저장 중...' : '룰 생성'}
          </button>
        </div>
      </form>
    </div>

  <!-- ─────────────────────────────────
       탭3: 실행 이력
  ───────────────────────────────── -->
  {:else if activeTab === 'history'}
    <div class="section-title">실행 이력 (최근 50건)</div>
    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>룰 ID</th>
            <th>사용자 ID</th>
            <th>실행 시각</th>
            <th>결과</th>
          </tr>
        </thead>
        <tbody>
          {#each logs as log}
            {@const result = log.result}
            <tr>
              <td class="td-id">{String(log.rule_id ?? '—').substring(0, 8)}…</td>
              <td class="td-id">{String(log.user_id ?? '—').substring(0, 8)}…</td>
              <td class="td-date">{formatDate(log.triggered_at)}</td>
              <td>
                {#if result?.success}
                  <span class="badge badge-active">성공</span>
                {:else}
                  <span class="badge badge-error">실패</span>
                {/if}
              </td>
            </tr>
          {:else}
            <tr><td colspan="4" class="no-data">실행 이력이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- 삭제 확인 모달 -->
{#if showDeleteModal}
  <div class="modal-bg" onclick={() => showDeleteModal = false} role="presentation">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="룰 삭제 확인">
      <p class="modal-title">룰 삭제</p>
      <p class="modal-sub"><strong>{deleteName}</strong> 룰을 삭제합니다.<br>이 작업은 되돌릴 수 없습니다.</p>
      <form method="POST" action="?/deleteRule" use:enhance>
        <input type="hidden" name="id" value={deleteId} />
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onclick={() => showDeleteModal = false}>취소</button>
          <button type="submit" class="btn-danger">삭제</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
/* ─ 레이아웃 ─ */
.page-wrap {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 20px 24px 32px;
}

/* ─ 서브탭 ─ */
.sub-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.sub-tab-btn {
  padding: 6px 18px; border: none;
  border-radius: var(--cms-radius-sm);
  background: transparent; color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer;
  min-height: 44px; transition: background 0.15s, color 0.15s;
}
.sub-tab-btn:hover  { background: rgba(59,47,138,0.08); color: var(--cs-text); }
.sub-tab-btn.active { background: var(--cs-white); color: var(--cs-purple); }

/* ─ 섹션 타이틀 ─ */
.section-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 16px; }
.section-title.nm { margin: 0; }

/* ─ 툴바 ─ */
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }

/* ─ 폼 카드 ─ */
.form-card {
  background: var(--cs-white); border-radius: var(--cms-radius-lg);
  padding: 28px; margin-bottom: 16px;
}
.fs-title {
  font: var(--text-pc-body-14); color: var(--cs-purple);
  margin: 20px 0 10px;
  border-bottom: 1px solid var(--cs-surface-gray); padding-bottom: 6px;
}
.fs-title:first-child { margin-top: 0; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

/* ─ 미지원 안내 ─ */
.unsupported-notice {
  background: rgba(255,53,53,0.08);
  border-left: 3px solid var(--cs-red-badge);
  border-radius: var(--cms-radius-sm);
  padding: 10px 14px;
  font: var(--text-pc-script-12);
  color: var(--cs-red-badge);
  margin-top: 12px;
}

/* ─ 폼 액션 ─ */
.form-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  margin-top: 20px; padding-top: 16px;
  border-top: 1px solid var(--cs-surface-gray);
}

/* ─ 테이블 ─ */
.table-card {
  background: var(--cs-white); border-radius: var(--cms-radius-md);
  overflow: hidden; margin-bottom: 16px;
}
table { width: 100%; border-collapse: collapse; font: var(--text-pc-body-14); color: var(--cs-text); }
thead th {
  background: var(--cs-lilac); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); padding: 10px 16px;
  text-align: left; white-space: nowrap;
}
tbody tr { border-bottom: 1px solid var(--cs-surface-gray); }
tbody tr:hover { background: rgba(59,47,138,0.04); }
tbody tr:last-child { border-bottom: none; }
td { padding: 10px 16px; vertical-align: middle; }
.td-name { font: var(--text-pc-body-14); color: var(--cs-text); }
.td-id   { font: var(--text-pc-script-12); color: var(--cs-text-mid); font-family: monospace; }
.td-date { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.no-data { text-align: center; color: var(--cs-text-light); padding: 32px; }

/* ─ 배지 ─ */
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); white-space: nowrap;
}
.badge-active   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
.badge-inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }
.badge-info     { background: rgba(59,47,138,0.08); color: var(--cs-purple); }
.badge-error    { background: rgba(255,53,53,0.10); color: var(--cs-red-badge); }

/* ─ 토글 ─ */
.tog {
  position: relative; width: 40px; height: 22px; border: none;
  border-radius: var(--radius-full); background: var(--cs-disabled-toggle);
  cursor: pointer; transition: background 0.2s; flex-shrink: 0;
}
.tog.tog-on { background: var(--cs-purple); }
.tog-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--cs-white); transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.tog.tog-on .tog-thumb { transform: translateX(18px); }

/* ─ 버튼 ─ */
.btn-primary {
  background: var(--cs-purple); color: var(--cs-white); border: none;
  border-radius: var(--radius-sm); padding: 8px 16px;
  font: var(--text-pc-body-14); height: 36px; cursor: pointer;
  transition: background 0.15s; white-space: nowrap;
}
.btn-primary:hover    { background: var(--cs-purple-hover); }
.btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
.btn-ghost {
  background: transparent; border: 1.5px solid var(--cs-purple);
  border-radius: var(--radius-sm); color: var(--cs-purple);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s; white-space: nowrap;
}
.btn-ghost:hover { background: rgba(59,47,138,0.06); }
.btn-danger {
  background: transparent; border: 1.5px solid var(--cs-red-badge);
  border-radius: var(--radius-sm); color: var(--cs-red-badge);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s;
}
.btn-danger:hover { background: rgba(255,53,53,0.08); }
.btn-danger.sm { padding: 4px 10px; height: 28px; font: var(--text-pc-script-12); }

/* ─ 입력 필드 ─ */
.f-input {
  background: var(--cs-surface-gray); border: none;
  border-radius: var(--cms-radius-sm); padding: 10px 16px;
  font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
}
.f-input::placeholder { color: var(--cs-text-placeholder); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
.f-input.ta { resize: vertical; height: auto; }

/* ─ 모달 ─ */
.modal-bg {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(16,11,50,0.45);
  display: flex; align-items: center; justify-content: center;
}
.modal-box {
  background: var(--cs-white); border-radius: var(--cms-radius-lg);
  padding: 28px 32px; min-width: 320px; max-width: 440px; width: 100%;
}
.modal-title   { font: var(--text-pc-title-16); color: var(--cs-text); margin: 0 0 8px; }
.modal-sub     { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 20px; line-height: 1.6; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
</style>
