<script lang="ts">
  // CrazychatAssistPanel — AI 조력 생성기(API 호출형) 화면 조각. ⚠️ 현재 비활성: 어디에도 마운트하지 않는다(2026-10-08).
  // 다시 켜는 방법: src/lib/server/crazychat/assist/README.md. API는 switch.ts(ASSIST_ENABLED)가 꺼져 있는 동안 503을 돌려준다.
  import { onMount } from 'svelte'
  import { csToast } from '$lib/utils/toast'

  function fmt(iso: string | null): string {
    if (!iso) return '-'
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { error?: string } }> {
    const res = await fetch(url, init)
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    return { ok: res.ok, data }
  }

  // ── AI 조력 생성기(수동 요청형, 즉시 운영 반영) ──
  interface AssistRun { id: string; created_at: string; status: string; model: string | null; input_tokens: number | null; output_tokens: number | null; summary: { keywordsAdded?: number; faqsCreated?: number; removedKeywords?: number; deletedFaqs?: number } | null; error: string | null }
  let assistEnabled = $state(false)
  let assistCanToggle = $state(false)
  let assistRuns = $state<AssistRun[]>([])
  let assistBusy = $state(false)
  let confirmAssist = $state(false)
  const ASSIST_STATUS: Record<string, string> = { running: '진행 중', done: '완료', failed: '실패', rolled_back: '되돌림' }

  async function loadAssist(): Promise<void> {
    const r = await api<{ enabled: boolean; runs: AssistRun[]; can_toggle: boolean }>('/api/cms/chat/crazychat/assist')
    if (!r.ok) return
    assistEnabled = r.data.enabled
    assistRuns = r.data.runs
    assistCanToggle = r.data.can_toggle
  }
  async function toggleAssist(next: boolean): Promise<void> {
    assistBusy = true
    try {
      const r = await api<{ enabled?: boolean }>('/api/cms/chat/crazychat/assist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }) })
      if (!r.ok) { csToast.error(r.data.error ?? '변경하지 못했습니다.'); return }
      assistEnabled = next
    } finally { assistBusy = false }
  }
  async function runAssist(): Promise<void> {
    confirmAssist = false
    assistBusy = true
    try {
      const r = await api<{ ok?: boolean; summary?: { keywordsAdded: number; faqsCreated: number } }>('/api/cms/chat/crazychat/assist', { method: 'POST' })
      if (!r.ok) { csToast.error(r.data.error ?? 'AI 조력 생성에 실패했어요.'); return }
      csToast.success(`키워드 ${r.data.summary?.keywordsAdded ?? 0}개 · 새 자동답변 ${r.data.summary?.faqsCreated ?? 0}건을 반영했어요.`)
    } finally { assistBusy = false; await loadAssist() }
  }
  async function rollbackAssist(id: string): Promise<void> {
    assistBusy = true
    try {
      const r = await api<{ ok?: boolean }>(`/api/cms/chat/crazychat/assist/${id}/rollback`, { method: 'POST' })
      if (!r.ok) { csToast.error(r.data.error ?? '되돌리지 못했어요.'); return }
      csToast.success('이번 실행을 되돌렸어요.')
    } finally { assistBusy = false; await loadAssist() }
  }

  onMount(() => { void loadAssist() })
</script>

  <section class="setting-section">
    <div class="section-head">
      <h2 class="section-title">AI 조력 생성기</h2>
      <div class="chips">
        <button type="button" class="mk-chip" class:mk-chip--on={!assistEnabled} disabled={assistBusy || !assistCanToggle} aria-pressed={!assistEnabled} onclick={() => toggleAssist(false)}>꺼짐</button>
        <button type="button" class="mk-chip" class:mk-chip--on={assistEnabled} disabled={assistBusy || !assistCanToggle} title={assistCanToggle ? undefined : '슈퍼마스터만 켤 수 있습니다.'} aria-pressed={assistEnabled} onclick={() => toggleAssist(true)}>켜짐</button>
      </div>
    </div>
    <p class="section-desc">관리자가 요청할 때만 실행합니다. 빠른답변·상품 색인·개인정보를 가린 최근 고객 질문을 AI가 분석해 키워드와 새 자동답변을 만들고, 안전 검증을 통과한 항목을 <b>즉시 운영에 반영</b>합니다. 반영한 실행은 아래에서 한 번에 되돌릴 수 있습니다.</p>
    <div class="chips">
      <button type="button" class="btn-save" disabled={assistBusy || !assistEnabled} onclick={() => (confirmAssist = true)}>{assistBusy ? '처리 중…' : 'AI 조력 생성 실행'}</button>
    </div>
    {#if assistRuns.length === 0}
      <p class="hint">실행 이력이 없습니다.</p>
    {:else}
      <div class="assist-runs">
        {#each assistRuns as run (run.id)}
          <div class="draft">
            <div class="draft-meta">
              <span>{fmt(run.created_at)}</span>
              <span>{ASSIST_STATUS[run.status] ?? run.status}</span>
              {#if run.summary?.keywordsAdded !== undefined}<span>키워드 +{run.summary.keywordsAdded}</span>{/if}
              {#if run.summary?.faqsCreated !== undefined}<span>새 자동답변 {run.summary.faqsCreated}건</span>{/if}
              {#if run.input_tokens !== null}<span>토큰 {run.input_tokens}/{run.output_tokens ?? 0}</span>{/if}
              {#if run.error}<span>{run.error}</span>{/if}
            </div>
            {#if run.status === 'done' || run.status === 'failed'}
              <div class="draft-actions">
                <button type="button" class="btn-small" disabled={assistBusy} onclick={() => rollbackAssist(run.id)}>이번 실행 되돌리기</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

{#if confirmAssist}
  <div class="confirm-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) confirmAssist = false }}>
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-label="AI 조력 생성 실행 확인">
      <p class="confirm-msg">AI 조력 생성을 실행할까요?</p>
      <p class="confirm-sub">
        검증을 통과한 키워드와 새 자동답변이 <b>바로 운영 자동답변에 반영</b>됩니다.<br />
        외부 AI에는 개인정보를 가린 고객 질문과 빠른답변 내용이 전달됩니다. 반영 후에도 이력에서 되돌릴 수 있습니다.
      </p>
      <div class="confirm-actions">
        <button type="button" class="s-chip" onclick={() => (confirmAssist = false)}>취소</button>
        <button type="button" class="btn-save" disabled={assistBusy} onclick={runAssist}>실행</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .setting-section { background: var(--cs-white); border-radius: var(--cms-radius-lg); padding: 34px 32px; display: flex; flex-direction: column; gap: 14px; }
  .section-head { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
  .section-title { font: var(--text-pc-menu-kr-20); color: var(--cs-dark); margin: 0; }
  .section-desc { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0; }
  .hint { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }
  .chips { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }
  .mk-chip {
    height: 32px; padding: 0 14px; border: 1.5px solid var(--cs-lilac); border-radius: var(--cms-radius-xl, 30px);
    background: var(--cs-white); color: var(--cs-text-mid); font: var(--text-pc-script-12); font-weight: 600; cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .mk-chip--on { background: var(--cs-purple); color: var(--cs-white); border-color: var(--cs-purple); }
  .mk-chip:not(.mk-chip--on):hover:not(:disabled) { border-color: var(--cs-purple); color: var(--cs-purple); }
  .mk-chip:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-save {
    height: 44px; padding: 0 20px; border: none; border-radius: var(--cms-radius-md); background: var(--cs-purple); color: var(--cs-white);
    font: var(--text-pc-body-14); cursor: pointer; transition: background 0.15s;
  }
  .btn-save:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
  .s-chip {
    height: 44px; padding: 0 20px; border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-md); background: var(--cs-white);
    color: var(--cs-text-mid); font: var(--text-pc-body-14); cursor: pointer;
  }
  .draft { display: flex; flex-direction: column; gap: 8px; padding: 14px 18px; background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm); }
  .draft-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .draft-actions { display: flex; gap: 6px; }
  .btn-small {
    flex-shrink: 0; font-size: 11px; font-weight: 600; padding: 5px 10px; border: none; border-radius: var(--radius-full);
    background: var(--cs-white); color: var(--cs-text-mid); cursor: pointer; white-space: nowrap; transition: background 0.15s, color 0.15s;
  }
  .btn-small:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
  .btn-small:disabled { opacity: 0.5; cursor: not-allowed; }
  .confirm-backdrop { position: fixed; inset: 0; z-index: 200; background: rgba(16, 11, 50, 0.45); display: flex; align-items: center; justify-content: center; }
  .confirm-dialog { background: var(--cs-white); border-radius: var(--radius-lg); padding: 28px 32px; min-width: 320px; max-width: 460px; text-align: center; }
  .confirm-msg { font: var(--text-pc-title-16); color: var(--cs-text); margin: 0 0 8px; }
  .confirm-sub { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 20px; }
  .confirm-actions { display: flex; gap: 10px; justify-content: center; }
  .assist-runs { display: flex; flex-direction: column; gap: 8px; }
</style>
