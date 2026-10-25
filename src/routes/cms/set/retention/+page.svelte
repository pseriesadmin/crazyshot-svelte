<script lang="ts">
  // 개인정보·거래 기록 보존 만료 리포트 — 읽기 전용. 만료가 도래해도 자동 삭제하지 않고 관리자가 확인한다(2026-10-24 Stephen 확정)
  import CmsKpiGrid from '$lib/components/cms/CmsKpiGrid.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  type Filter = 'attention' | 'all'
  let filter = $state<Filter>('attention')

  const STATE_LABEL: Record<string, string> = { due: '만료 도래', soon: '90일 이내', keep: '보존 중' }
  const STATE_BADGE: Record<string, string> = { due: 'badge-error', soon: 'badge-info', keep: 'badge-active' }

  const dueCount = $derived(data.rows.filter((r) => r.txn_state === 'due' || r.chat_state === 'due').length)
  const soonCount = $derived(data.rows.filter((r) => r.txn_state !== 'due' && r.chat_state !== 'due' && (r.txn_state === 'soon' || r.chat_state === 'soon')).length)
  const visible = $derived(
    filter === 'all'
      ? data.rows
      : data.rows.filter((r) => ['due', 'soon'].includes(r.txn_state ?? '') || ['due', 'soon'].includes(r.chat_state ?? '')),
  )

  function fmt(dt: string | null): string {
    if (!dt) return '-'
    const d = new Date(dt)
    if (Number.isNaN(d.getTime())) return '-'
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }
</script>

<svelte:head><title>개인정보 보존 리포트 — CMS</title></svelte:head>

<div class="page-wrap">
  <div class="sections">
    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">개인정보 보존 리포트</h2>
        <span class="section-badge">익명 전환 계정 {data.rows.length}건</span>
      </div>
      <p class="section-desc">
        탈퇴·삭제 후 익명 전환된 계정의 거래 기록(예약·주문·결제)은 <b>5년</b>, 상담 기록은 <b>3년</b> 동안 법정 보존합니다.
        기간이 지나도 자동으로 삭제하지 않으며, 만료가 도래하면 관리자에게 알림이 가고 이 화면에 표시됩니다. 삭제는 담당자가 확인한 뒤 따로 처리하세요.
      </p>

      <CmsKpiGrid columns={3} cards={[
        { label: '만료 도래', value: dueCount, unit: '건', tone: dueCount > 0 ? 'danger' : 'neutral', sub: '확인·처리 필요' },
        { label: '90일 이내 도래 예정', value: soonCount, unit: '건', tone: soonCount > 0 ? 'warn' : 'neutral' },
        { label: '전체 익명 전환 계정', value: data.rows.length, unit: '건', tone: 'primary' },
      ]} />

      {#if data.loadError}
        <p class="error-bar" role="alert">{data.loadError}</p>
      {/if}
      {#if data.anonymizeFailures > 0}
        <p class="error-bar" role="alert">삭제 유예가 끝났지만 익명 전환에 실패한 계정이 {data.anonymizeFailures}건 있어요. 개인정보가 아직 남아 있으니 확인이 필요해요(예약 등 정리가 끝나지 않은 거래가 원인일 수 있어요).</p>
      {/if}

      <div class="filter-row" role="tablist" aria-label="보존 상태 필터">
        <button type="button" role="tab" aria-selected={filter === 'attention'} class="filter-tab" class:active={filter === 'attention'} onclick={() => (filter = 'attention')}>확인 필요</button>
        <button type="button" role="tab" aria-selected={filter === 'all'} class="filter-tab" class:active={filter === 'all'} onclick={() => (filter = 'all')}>전체</button>
      </div>

      {#if visible.length === 0}
        <p class="no-data">{filter === 'attention' ? '만료가 도래했거나 90일 이내에 도래하는 건이 없습니다.' : '익명 전환된 계정이 없습니다.'}</p>
      {:else}
        <div class="rt-list">
          <div class="rt-row rt-head">
            <span>고객 코드</span><span>익명 전환일</span><span>거래 기록</span><span>거래 보존 만료</span><span>상담 보존 만료</span><span></span>
          </div>
          {#each visible as r (r.user_id)}
            <div class="rt-row">
              <span class="rt-code">{r.member_code ?? '-'}</span>
              <span>{fmt(r.purged_at)}</span>
              <span>{r.reservation_count}건 · 마지막 {fmt(r.last_txn_at)}</span>
              <span class="rt-state">
                {fmt(r.txn_expires_at)}
                {#if r.txn_state}<span class="badge {STATE_BADGE[r.txn_state]}">{STATE_LABEL[r.txn_state]}</span>{/if}
              </span>
              <span class="rt-state">
                {fmt(r.chat_expires_at)}
                {#if r.chat_state}<span class="badge {STATE_BADGE[r.chat_state]}">{STATE_LABEL[r.chat_state]}</span>{/if}
              </span>
              <a class="rt-link" href="/cms/customers?selected={r.user_id}">고객 보기</a>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .page-wrap { flex: 1; overflow-y: auto; padding: 32px 16px; min-width: 0; }
  .sections { display: flex; flex-direction: column; gap: 32px; }
  .setting-section { background: var(--cs-white); border-radius: var(--cms-radius-lg); padding: 34px 32px; }
  .section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .section-title { font: var(--text-pc-menu-kr-20); color: var(--cs-dark); margin: 0; }
  .section-badge {
    background: var(--cs-lilac); color: var(--cs-purple); font: var(--text-pc-body-14); font-weight: 700;
    padding: 2px 10px; border-radius: var(--radius-full); white-space: nowrap;
  }
  .section-desc { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0 0 24px; line-height: 1.7; }
  .error-bar {
    background: var(--cs-bg-error); border-left: 3px solid var(--cs-red-badge); border-radius: var(--radius-sm);
    padding: 8px 12px; font: var(--text-m-script-12); color: var(--cs-error); margin-top: 12px;
  }
  .no-data { text-align: center; padding: 40px 20px; font: var(--text-m-script-14); color: var(--cs-text-light); }

  /* 필터 탭 — 고객 패널 하위탭과 같은 밑줄 탭 형태 */
  .filter-row { display: flex; gap: 0; margin: 24px 0 12px; border-bottom: 1px solid #ECEBF4; }
  .filter-tab {
    width: 96px; height: 40px; background: transparent; border: none; border-bottom: 2px solid transparent;
    font: var(--text-pc-body-14); color: var(--cs-text-mid); cursor: pointer; transition: color 0.12s, border-color 0.12s;
  }
  .filter-tab:hover { color: var(--cs-text); }
  .filter-tab.active { color: var(--cs-purple); border-bottom-color: var(--cs-purple); font-weight: 700; }

  .rt-list { display: flex; flex-direction: column; gap: 6px; }
  .rt-row {
    display: grid; grid-template-columns: 120px 100px 1.3fr 1.2fr 1.2fr 80px; align-items: center; gap: 12px;
    padding: 10px 18px; background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14); color: var(--cs-text);
  }
  .rt-head { background: transparent; color: var(--cs-text-mid); padding-top: 0; padding-bottom: 0; }
  .rt-code { font-family: monospace; font-weight: 700; }
  .rt-state { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .rt-link { color: var(--cs-purple); text-decoration: underline; white-space: nowrap; font: var(--text-pc-script-12); }

  .badge {
    display: inline-flex; align-items: center; padding: 2px 8px; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); white-space: nowrap; line-height: 1.6;
  }
  .badge-active { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
  .badge-error  { background: rgba(255,53,53,0.10);  color: var(--cs-red-badge); }
  .badge-info   { background: rgba(59,47,138,0.08);  color: var(--cs-purple); }
</style>
