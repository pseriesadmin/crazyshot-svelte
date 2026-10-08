<script lang="ts">
  import { onMount } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import CmsKpiGrid from '$lib/components/cms/CmsKpiGrid.svelte'
  import type { FeatureLevel, SettingsLevels } from '$lib/server/crazychat/settings-update'
  import type { AiSummary, QuerySummary } from '$lib/server/crazychat/stats'

  type FeatureKey = 'query' | 'action' | 'recommend' | 'ai_fallback'
  type Range = 'today' | '7d' | 'all'
  interface Stats {
    range: Range
    query: QuerySummary
    ai: AiSummary
    ai_today: { calls: number; daily_limit: number }
    requests: { pending: number; resolved: number }
    truncated: boolean
  }
  interface Draft {
    id: string; created_at: string; session_id: string; mode: string; category: string | null
    confidence: number | null; draft_text: string; sent: boolean; feedback: number | null
  }

  const FEATURE_ROWS: { key: FeatureKey; label: string; desc: string }[] = [
    { key: 'query', label: '조회형', desc: '고객 본인의 예약 단계·반납일·서류 승인·결제 완료 여부를 정해진 문장으로 알려줍니다.' },
    { key: 'action', label: '접수형', desc: '예약 시간 변경·연장 요청을 접수하고 상담원 호출·서류 재제출을 안내합니다. 변경은 관리자가 처리합니다.' },
    { key: 'recommend', label: '추천형', desc: '"카메라 추천해 주세요" 같은 질문에 검색으로 찾은 대여 상품 최대 3개를 상품 카드로 보내 드립니다. 상품은 DB 검색 결과만 쓰고 판매전용·옵션전용 상품은 제외합니다.' },
    { key: 'ai_fallback', label: 'AI 답변', desc: '위 기능이 답하지 못한 일반 문의에 검수된 근거 안에서만 답합니다.' },
  ]
  const LEVEL_OPTIONS: { value: FeatureLevel; label: string }[] = [
    { value: 'off', label: '꺼짐' },
    { value: 'observe', label: '관찰' },
    { value: 'on', label: '켜짐' },
  ]
  const CATEGORY_CHOICES = ['reservation', 'return', 'payment', 'general'] as const
  const CATEGORY_LABEL: Record<string, string> = { reservation: '예약', return: '반납', payment: '결제', general: '일반' }
  const RANGE_OPTIONS: { value: Range; label: string }[] = [
    { value: 'today', label: '오늘' },
    { value: '7d', label: '최근 7일' },
    { value: 'all', label: '전체' },
  ]
  const REASON_LABEL: Record<string, string> = {
    declined: '근거 없음 판단', format: '형식 오류', no_source: '근거 번호 없음', unknown_source: '모르는 근거 번호',
    low_confidence: '확신 부족', too_long: '너무 긴 답변', promise: '약속 표현', ungrounded_number: '근거에 없는 숫자',
    ungrounded_link: '근거에 없는 링크', sensitive_topic: '민감 주제', ungrounded_category: '허용 안 된 분류', call_failed: '호출 실패',
    category_not_allowed: '허용 분류 아님',
  }

  let settings = $state<SettingsLevels | null>(null)
  let updatedAt = $state<string | null>(null)
  let updatedByName = $state<string | null>(null)
  let canEnableLive = $state(false)
  let saving = $state(false)
  let loadError = $state('')

  let stats = $state<Stats | null>(null)
  let range = $state<Range>('7d')
  let drafts = $state<Draft[]>([])
  let draftFilter = $state<'pending' | 'reviewed'>('pending')
  let draftBusy = $state<string | null>(null)

  let draftCategories = $state<string[]>([])
  let confirmAi = $state(false)

  function fmt(iso: string | null): string {
    if (!iso) return '-'
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  function pct(v: number | null): string { return v === null ? '-' : `${Math.round(v * 100)}`}

  async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { error?: string } }> {
    const res = await fetch(url, init)
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    return { ok: res.ok, data }
  }

  async function loadSettings(): Promise<void> {
    const r = await api<{ settings: SettingsLevels; updated_at: string | null; updated_by_name: string | null; can_enable_live: boolean }>('/api/cms/chat/crazychat/settings')
    if (!r.ok) { loadError = r.data.error ?? '설정을 불러오지 못했습니다.'; return }
    settings = r.data.settings
    draftCategories = [...r.data.settings.ai_allowed_categories]
    updatedAt = r.data.updated_at
    updatedByName = r.data.updated_by_name
    canEnableLive = r.data.can_enable_live
  }
  async function loadStats(): Promise<void> {
    const r = await api<Stats>(`/api/cms/chat/crazychat/stats?range=${range}`)
    if (r.ok) stats = r.data
  }
  async function loadDrafts(): Promise<void> {
    const r = await api<{ drafts: Draft[] }>(`/api/cms/chat/crazychat/drafts?filter=${draftFilter}`)
    if (r.ok) drafts = r.data.drafts
  }

  onMount(() => { void loadSettings(); void loadStats(); void loadDrafts() })

  async function saveChange(change: Record<string, unknown>): Promise<boolean> {
    saving = true
    try {
      const r = await api<{ settings?: SettingsLevels }>('/api/cms/chat/crazychat/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change),
      })
      if (!r.ok) { csToast.error(r.data.error ?? '저장하지 못했습니다.'); return false }
      csToast.success('저장했어요.')
      await loadSettings()
      return true
    } finally {
      saving = false
    }
  }

  // 단계 선택: AI를 '켜짐'으로 바꿀 때는 먼저 확인창(현재 검토 현황 안내)
  function chooseLevel(key: FeatureKey, value: FeatureLevel): void {
    if (!settings || saving || settings[key] === value) return
    if (key === 'ai_fallback' && value === 'on') { confirmAi = true; return }
    void saveChange({ [key]: value })
  }
  async function confirmAiOn(): Promise<void> {
    confirmAi = false
    await saveChange({ ai_fallback: 'on' })
  }
  function toggleMaster(next: boolean): void {
    if (!settings || saving || settings.agent_enabled === next) return
    void saveChange({ agent_enabled: next })
  }

  function toggleCategory(c: string): void {
    draftCategories = draftCategories.includes(c) ? draftCategories.filter((x) => x !== c) : [...draftCategories, c]
  }
  const categoriesDirty = $derived(
    settings !== null &&
      (draftCategories.length !== settings.ai_allowed_categories.length || draftCategories.some((c) => !settings!.ai_allowed_categories.includes(c))),
  )
  const liveLocked = $derived(!canEnableLive)

  async function sendFeedback(d: Draft, fb: 1 | 0 | null): Promise<void> {
    if (draftBusy) return
    draftBusy = d.id
    try {
      const r = await api<Record<string, never>>(`/api/cms/chat/crazychat/drafts/${d.id}/feedback`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feedback: fb }),
      })
      if (!r.ok) { csToast.error(r.data.error ?? '저장하지 못했습니다.'); return }
      await Promise.all([loadDrafts(), loadStats()])
    } finally {
      draftBusy = null
    }
  }
  function setRange(r: Range): void { range = r; void loadStats() }
  function setDraftFilter(f: 'pending' | 'reviewed'): void { draftFilter = f; void loadDrafts() }

  const queryCards = $derived(stats ? [
    { label: '조회·접수 판정', value: stats.query.total.toLocaleString(), unit: '건', tone: 'primary' as const },
    { label: '처리율', value: pct(stats.query.answerRate), unit: '%', tone: 'info' as const, progress: stats.query.answerRate === null ? undefined : Math.round(stats.query.answerRate * 100) },
    { label: '접수 대기', value: stats.requests.pending.toLocaleString(), unit: '건', tone: stats.requests.pending > 0 ? ('warn' as const) : ('neutral' as const), sub: `처리 완료 ${stats.requests.resolved.toLocaleString()}건` },
  ] : [])
  const aiCards = $derived(stats ? [
    { label: 'AI 호출', value: stats.ai.calls.toLocaleString(), unit: '건', tone: 'primary' as const, sub: `토큰 입력 ${stats.ai.inputTokens.toLocaleString()} · 출력 ${stats.ai.outputTokens.toLocaleString()}` },
    { label: '검증 통과율', value: pct(stats.ai.passRate), unit: '%', tone: 'info' as const, progress: stats.ai.passRate === null ? undefined : Math.round(stats.ai.passRate * 100), sub: `발송 ${stats.ai.sent.toLocaleString()}건` },
    { label: '오늘 사용량', value: stats.ai_today.calls.toLocaleString(), unit: `/ ${stats.ai_today.daily_limit}회`, tone: stats.ai_today.calls >= stats.ai_today.daily_limit * 0.8 ? ('warn' as const) : ('neutral' as const) },
  ] : [])
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') confirmAi = false }} />

<div class="page-wrap">
  <div class="page-header">
    <h1 class="page-title">크레이지챗</h1>
    <p class="page-sub">채팅 에이전트의 스위치와 관찰 결과를 관리합니다. 마스터를 끄면 모든 기능이 즉시 멈추고 기존 빠른답변·대기 안내만 동작합니다.</p>
  </div>

  {#if loadError}
    <p class="notice-error" role="alert">{loadError}</p>
  {/if}

  <section class="setting-section">
    <div class="section-head">
      <h2 class="section-title">스위치</h2>
      {#if settings}<span class="section-badge">{settings.agent_enabled ? '마스터 켜짐' : '마스터 꺼짐'}</span>{/if}
    </div>
    <p class="section-desc">
      관찰은 판정과 기록만 하고 고객에게는 아무것도 보내지 않습니다. 마지막 변경: {updatedByName ?? '-'} · {fmt(updatedAt)}
    </p>

    {#if settings}
      <div class="row-list">
        <div class="row">
          <div class="row-text">
            <span class="row-label">마스터 스위치 (킬스위치)</span>
            <span class="row-desc">꺼두면 아래 기능이 켜져 있어도 전부 정지합니다. 켜는 것은 슈퍼마스터만 할 수 있습니다.</span>
          </div>
          <div class="chips">
            <button type="button" class="mk-chip" class:mk-chip--on={!settings.agent_enabled} disabled={saving} aria-pressed={!settings.agent_enabled} onclick={() => toggleMaster(false)}>꺼짐</button>
            <button type="button" class="mk-chip" class:mk-chip--on={settings.agent_enabled} disabled={saving || (liveLocked && !settings.agent_enabled)} title={liveLocked ? '슈퍼마스터만 켤 수 있습니다.' : undefined} aria-pressed={settings.agent_enabled} onclick={() => toggleMaster(true)}>켜짐</button>
          </div>
        </div>

        {#each FEATURE_ROWS as f (f.key)}
          <div class="row" class:row--muted={!settings.agent_enabled}>
            <div class="row-text">
              <span class="row-label">{f.label}</span>
              <span class="row-desc">{f.desc}</span>
            </div>
            <div class="chips">
              {#each LEVEL_OPTIONS as opt (opt.value)}
                <button
                  type="button"
                  class="mk-chip"
                  class:mk-chip--on={settings[f.key] === opt.value}
                  disabled={saving || (f.key === 'ai_fallback' && opt.value === 'on' && liveLocked && settings[f.key] !== 'on')}
                  title={f.key === 'ai_fallback' && opt.value === 'on' && liveLocked ? '슈퍼마스터만 켤 수 있습니다.' : undefined}
                  aria-pressed={settings[f.key] === opt.value}
                  onclick={() => chooseLevel(f.key, opt.value)}
                >{opt.label}</button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      {#if !settings.agent_enabled}
        <p class="hint">마스터가 꺼져 있어 개별 스위치는 저장만 되고 동작하지 않습니다.</p>
      {/if}

      <div class="sub-block">
        <h3 class="sub-title">AI가 답해도 되는 분류</h3>
        <p class="row-desc">'켜짐' 단계에서 선택한 분류의 근거로만 고객에게 발송합니다. 파손·분실·환불·취소 같은 사람 전용 주제는 선택할 수 없습니다.</p>
        <div class="chips chips--wrap">
          {#each CATEGORY_CHOICES as c (c)}
            <button type="button" class="mk-chip" class:mk-chip--on={draftCategories.includes(c)} disabled={saving} aria-pressed={draftCategories.includes(c)} onclick={() => toggleCategory(c)}>{CATEGORY_LABEL[c]}</button>
          {/each}
          <button type="button" class="btn-save" disabled={saving || !categoriesDirty || (liveLocked && settings.ai_fallback === 'on')} onclick={() => saveChange({ ai_allowed_categories: draftCategories })}>분류 저장</button>
        </div>
        {#if liveLocked && settings.ai_fallback === 'on'}
          <p class="hint">AI가 켜짐인 동안 허용 분류 변경은 슈퍼마스터만 할 수 있습니다.</p>
        {/if}
      </div>
    {:else if !loadError}
      <p class="hint">불러오는 중…</p>
    {/if}
  </section>

  <section class="setting-section">
    <div class="section-head">
      <h2 class="section-title">관찰 통계</h2>
      <div class="chips">
        {#each RANGE_OPTIONS as r (r.value)}
          <button type="button" class="mk-chip" class:mk-chip--on={range === r.value} onclick={() => setRange(r.value)}>{r.label}</button>
        {/each}
      </div>
    </div>
    {#if stats}
      <h3 class="sub-title">조회·접수</h3>
      <CmsKpiGrid columns={3} cards={queryCards} />
      <h3 class="sub-title">AI 답변</h3>
      <CmsKpiGrid columns={3} cards={aiCards} />
      <div class="reason-box">
        <span class="row-label">
          검토 현황: {stats.ai.reviewed.toLocaleString()}건 검토 · 정답률 {pct(stats.ai.accuracy)}%
          {#if stats.ai.ready}— 켜도 좋은 상태입니다(검토 50건 이상·정답률 90% 이상){:else}— 아직 기준 미달입니다(검토 50건 이상·정답률 90% 이상){/if}
        </span>
        {#if Object.keys(stats.ai.byReason).length > 0}
          <ul class="reason-list">
            {#each Object.entries(stats.ai.byReason).sort((a, b) => b[1] - a[1]) as [reason, n] (reason)}
              <li>{REASON_LABEL[reason] ?? reason} <strong>{n}</strong>건</li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if stats.truncated}<p class="hint">기록이 많아 최근 5,000건 기준으로 집계했습니다.</p>{/if}
    {:else}
      <p class="hint">불러오는 중…</p>
    {/if}
  </section>

  <section class="setting-section">
    <div class="section-head">
      <h2 class="section-title">AI 초안 검토</h2>
      <div class="chips">
        <button type="button" class="mk-chip" class:mk-chip--on={draftFilter === 'pending'} onclick={() => setDraftFilter('pending')}>검토 대기</button>
        <button type="button" class="mk-chip" class:mk-chip--on={draftFilter === 'reviewed'} onclick={() => setDraftFilter('reviewed')}>검토 완료</button>
      </div>
    </div>
    <p class="section-desc">AI가 만든 답변 초안입니다(검증 통과분). 정답/오답 표시는 켜도 되는지 판단하는 통계에만 쓰이며 고객에게는 영향이 없습니다. 고객 질문 원문은 채팅 화면에서 확인하세요.</p>
    {#if drafts.length === 0}
      <p class="hint">{draftFilter === 'pending' ? '검토할 초안이 없습니다.' : '검토 완료된 초안이 없습니다.'}</p>
    {:else}
      <div class="row-list">
        {#each drafts as d (d.id)}
          <div class="draft">
            <div class="draft-meta">
              <span>{fmt(d.created_at)}</span>
              <span>{d.category ? (CATEGORY_LABEL[d.category] ?? d.category) : '-'}</span>
              <span>확신 {d.confidence === null ? '-' : Math.round(d.confidence * 100)}%</span>
              <span>{d.sent ? '고객에게 발송됨' : '관찰만(미발송)'}</span>
              <a class="draft-link" href={`/cms/chat?session=${d.session_id}`}>채팅 보기</a>
            </div>
            <p class="draft-text">{d.draft_text}</p>
            <div class="draft-actions">
              <button type="button" class="btn-small" class:btn-small--on={d.feedback === 1} disabled={draftBusy === d.id} onclick={() => sendFeedback(d, 1)}>정답</button>
              <button type="button" class="btn-small" class:btn-small--on={d.feedback === 0} disabled={draftBusy === d.id} onclick={() => sendFeedback(d, 0)}>오답</button>
              {#if d.feedback !== null}
                <button type="button" class="btn-small" disabled={draftBusy === d.id} onclick={() => sendFeedback(d, null)}>보류</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

{#if confirmAi && stats}
  <div class="confirm-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) confirmAi = false }}>
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-label="AI 답변 켜기 확인">
      <p class="confirm-msg">AI 답변을 '켜짐'으로 바꿀까요?</p>
      <p class="confirm-sub">
        켜면 허용 분류의 AI 답변이 고객에게 실제로 발송됩니다.<br />
        현재 검토 {stats.ai.reviewed}건 · 정답률 {pct(stats.ai.accuracy)}% —
        {stats.ai.ready ? '추천 기준(50건·90%)을 충족했습니다.' : '추천 기준(50건·90%)에 미달입니다.'}
      </p>
      <div class="confirm-actions">
        <button type="button" class="s-chip" onclick={() => (confirmAi = false)}>취소</button>
        <button type="button" class="btn-save" disabled={saving} onclick={confirmAiOn}>켜기</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page-wrap { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px 32px; display: flex; flex-direction: column; gap: 24px; }
  .page-header { margin-bottom: 0; }
  .page-title { font: var(--text-pc-menu-kr-20); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0; }
  .notice-error { font: var(--text-pc-body-14); color: var(--cs-error); margin: 0; }

  .setting-section { background: var(--cs-white); border-radius: var(--cms-radius-lg); padding: 34px 32px; display: flex; flex-direction: column; gap: 14px; }
  .section-head { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
  .section-title { font: var(--text-pc-menu-kr-20); color: var(--cs-dark); margin: 0; }
  .section-badge { background: var(--cs-lilac); color: var(--cs-purple); font: var(--text-pc-body-14); font-weight: 700; padding: 2px 10px; border-radius: var(--radius-full); white-space: nowrap; }
  .section-desc { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0; }
  .sub-title { font: var(--text-pc-title-16); color: var(--cs-text); margin: 6px 0 0; }
  .sub-block { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
  .hint { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }

  .row-list { display: flex; flex-direction: column; gap: 12px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 18px; background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm); }
  .row--muted { opacity: 0.6; }
  .row-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .row-label { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }
  .row-desc { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

  .chips { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }
  .chips--wrap { flex-wrap: wrap; }
  /* cms-uiux.md §7-12-B 콤보버튼 UI(mk-chip) */
  .mk-chip {
    height: 32px; padding: 0 14px; border: 1.5px solid var(--cs-lilac); border-radius: var(--cms-radius-xl, 30px);
    background: var(--cs-white); color: var(--cs-text-mid); font: var(--text-pc-script-12); font-weight: 600; cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .mk-chip--on { background: var(--cs-purple); color: var(--cs-white); border-color: var(--cs-purple); }
  .mk-chip:not(.mk-chip--on):hover:not(:disabled) { border-color: var(--cs-purple); color: var(--cs-purple); }
  .mk-chip:disabled { opacity: 0.5; cursor: not-allowed; }

  /* cms-uiux.md §0-10-G DetailPanel 전용 버튼 — 대형(44px) */
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

  .reason-box { display: flex; flex-direction: column; gap: 8px; padding: 14px 18px; background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm); }
  .reason-list { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0; padding: 0; list-style: none; font: var(--text-pc-script-12); color: var(--cs-text-mid); }

  .draft { display: flex; flex-direction: column; gap: 8px; padding: 14px 18px; background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm); }
  .draft-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .draft-link { color: var(--cs-purple); text-decoration: none; font-weight: 600; }
  .draft-text { font: var(--text-pc-body-14); color: var(--cs-text); margin: 0; white-space: pre-wrap; word-break: break-word; }
  .draft-actions { display: flex; gap: 6px; }
  /* cms-uiux.md §0-10-C 초소형 라운드 버튼형 */
  .btn-small {
    flex-shrink: 0; font-size: 11px; font-weight: 600; padding: 5px 10px; border: none; border-radius: var(--radius-full);
    background: var(--cs-white); color: var(--cs-text-mid); cursor: pointer; white-space: nowrap; transition: background 0.15s, color 0.15s;
  }
  .btn-small:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
  .btn-small--on { background: var(--cs-purple); color: var(--cs-white); }
  .btn-small:disabled { opacity: 0.5; cursor: not-allowed; }

  .confirm-backdrop { position: fixed; inset: 0; z-index: 200; background: rgba(16, 11, 50, 0.45); display: flex; align-items: center; justify-content: center; }
  .confirm-dialog { background: var(--cs-white); border-radius: var(--radius-lg); padding: 28px 32px; min-width: 320px; max-width: 460px; text-align: center; }
  .confirm-msg { font: var(--text-pc-title-16); color: var(--cs-text); margin: 0 0 8px; }
  .confirm-sub { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 20px; }
  .confirm-actions { display: flex; gap: 10px; justify-content: center; }
</style>
