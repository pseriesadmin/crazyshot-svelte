<script lang="ts">
  // 빠른답변 분류 설정 모달 — 기본 6개(이름·순서만) + 추가 분류(이름·순서·노출·민감·삭제). 규칙은 planCategoryChange가 서버에서 집행한다.
  import { csToast } from '$lib/utils/toast'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import { MAX_CATEGORY_LABEL_LENGTH, sortCategories, type CannedCategory } from '$lib/constants/cannedResponseCategories'

  interface Props {
    categories: CannedCategory[]
    onchange: (list: CannedCategory[]) => void
    onclose: () => void
    /** AI 허용을 '켜는' 것은 슈퍼마스터 전용(끄는 것은 매니저도 가능) */
    canEnableAi?: boolean
  }
  let { categories, onchange, onclose, canEnableAi = false }: Props = $props()

  let busy = $state(false)
  let newLabel = $state('')
  let newHumanOnly = $state(false)
  let edits = $state<Record<string, string>>({})

  // 드래그로 바꾸는 화면용 목록(서버 목록이 바뀌면 다시 맞춘다)
  let ordered = $state<CannedCategory[]>(sortCategories(categories))
  $effect(() => { ordered = sortCategories(categories) })

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, okMsg: string): Promise<boolean> {
    busy = true
    try {
      const res = await fetch('/api/cms/canned-categories', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => ({}))) as { categories?: CannedCategory[]; error?: string }
      if (!res.ok || !data.categories) { csToast.error(data.error ?? '처리하지 못했어요.'); return false }
      onchange(data.categories)
      csToast.success(okMsg)
      return true
    } finally { busy = false }
  }

  async function add(): Promise<void> {
    if (await call('POST', { label: newLabel, human_only: newHumanOnly }, '분류를 추가했어요.')) { newLabel = ''; newHumanOnly = false }
  }
  async function rename(c: CannedCategory): Promise<void> {
    const label = (edits[c.value] ?? c.label).trim()
    if (label === c.label) return
    if (await call('PATCH', { value: c.value, label }, '이름을 바꿨어요.')) delete edits[c.value]
  }
  // 드래그가 끝나면 전체 순서를 한 번에 저장한다(실패하면 서버 목록으로 되돌린다)
  async function saveOrder(): Promise<void> {
    busy = true
    try {
      const res = await fetch('/api/cms/canned-categories', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: ordered.map((c) => c.value) }) })
      const data = (await res.json().catch(() => ({}))) as { categories?: CannedCategory[]; error?: string }
      if (!res.ok || !data.categories) { csToast.error(data.error ?? '순서를 저장하지 못했어요.'); ordered = sortCategories(categories); return }
      onchange(data.categories)
    } finally { busy = false }
  }
</script>

<div class="cs-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose() }}>
  <div class="cs-dialog" role="dialog" aria-modal="true" aria-label="빠른답변 분류 설정">
    <div class="cs-head">
      <h2 class="cs-title">분류 설정</h2>
      <button type="button" class="cs-close" aria-label="닫기" onclick={onclose}>✕</button>
    </div>
    <p class="cs-desc">분류를 추가하면 빠른답변 등록·필터에서 바로 쓸 수 있어요. 기본 분류는 이름과 순서만 바꿀 수 있고, <b>민감</b>으로 표시한 분류의 답변이 자동으로 나가면 상담원에게 알려요. <b>AI 허용</b>은 크레이지챗 AI가 답해도 되는 분류예요(민감 분류는 허용할 수 없고, 켜는 것은 슈퍼마스터만 가능해요). 왼쪽 손잡이(⋮⋮)를 끌어서 순서를 바꿀 수 있어요.</p>

    <div class="cs-list">
      <CmsDragList bind:items={ordered} itemKey={(c) => c.value} onreorder={saveOrder} class="cs-drag">
        {#snippet renderItem(c)}
          <div class="cs-row" class:cs-row--off={!c.is_active}>
            <input class="cs-input" maxlength={MAX_CATEGORY_LABEL_LENGTH} value={edits[c.value] ?? c.label} aria-label="분류 이름"
              oninput={(e) => (edits[c.value] = e.currentTarget.value)} onblur={() => rename(c)} onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} disabled={busy} />
            <span class="cs-tag">{c.is_system ? '기본' : '추가'}</span>
            {#if c.human_only}<span class="cs-tag cs-tag--warn">민감</span>{/if}
            {#if c.ai_allowed}<span class="cs-tag">AI 허용</span>{/if}
            {#if !c.human_only && (c.ai_allowed || canEnableAi)}
              <button type="button" class="cs-chip" disabled={busy} onclick={() => call('PATCH', { value: c.value, ai_allowed: !c.ai_allowed }, c.ai_allowed ? 'AI 허용을 껐어요.' : 'AI가 이 분류에 답할 수 있게 했어요.')}>{c.ai_allowed ? 'AI 허용 해제' : 'AI 허용'}</button>
            {/if}
            {#if !c.is_system}
              <button type="button" class="cs-chip" disabled={busy} onclick={() => call('PATCH', { value: c.value, human_only: !c.human_only }, c.human_only ? '민감 표시를 껐어요.' : '민감으로 표시했어요.')}>{c.human_only ? '민감 해제' : '민감 표시'}</button>
              <button type="button" class="cs-chip" disabled={busy} onclick={() => call('PATCH', { value: c.value, is_active: !c.is_active }, c.is_active ? '숨겼어요.' : '다시 보이게 했어요.')}>{c.is_active ? '숨기기' : '보이기'}</button>
              <button type="button" class="cs-chip cs-chip--danger" disabled={busy} onclick={() => call('DELETE', { value: c.value }, '삭제했어요.')}>삭제</button>
            {/if}
          </div>
        {/snippet}
      </CmsDragList>
    </div>

    <div class="cs-add">
      <input class="cs-input" maxlength={MAX_CATEGORY_LABEL_LENGTH} placeholder="새 분류 이름 (최대 {MAX_CATEGORY_LABEL_LENGTH}자)" bind:value={newLabel} aria-label="새 분류 이름" disabled={busy}
        onkeydown={(e) => { if (e.key === 'Enter' && newLabel.trim()) void add() }} />
      <button type="button" class="cs-chip" class:cs-chip--on={newHumanOnly} aria-pressed={newHumanOnly} disabled={busy} onclick={() => (newHumanOnly = !newHumanOnly)}>민감</button>
      <button type="button" class="cs-cta" disabled={busy || !newLabel.trim()} onclick={add}>분류 추가</button>
    </div>
  </div>
</div>

<style>
  .cs-backdrop { position: fixed; inset: 0; background: rgba(16, 11, 50, 0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .cs-dialog { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 64px); overflow-y: auto; background: var(--cs-white); border-radius: var(--cms-radius-lg); padding: 24px; display: flex; flex-direction: column; gap: 14px; }
  .cs-head { display: flex; align-items: center; justify-content: space-between; }
  .cs-title { font: var(--text-pc-menu-kr-20); color: var(--cs-dark); margin: 0; }
  .cs-close { width: 28px; height: 28px; border: none; border-radius: 50%; background: transparent; color: var(--cs-text-mid); cursor: pointer; }
  .cs-close:hover { color: var(--cs-red-badge); }
  .cs-desc { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }
  .cs-list :global(.cs-drag) { gap: 8px; }
  .cs-row { flex: 1; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm); flex-wrap: wrap; }
  .cs-row--off { opacity: 0.55; }
  .cs-input { flex: 1; min-width: 120px; height: 36px; padding: 0 12px; border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm); font: var(--text-pc-body-14); color: var(--cs-text); background: var(--cs-white); }
  .cs-tag { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-purple); background: var(--cs-lilac); padding: 2px 8px; border-radius: var(--radius-full); }
  .cs-tag--warn { color: var(--cs-red-badge); background: var(--cs-red-xlight); }
  .cs-chip { height: 30px; padding: 0 12px; border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm); background: var(--cs-white); color: var(--cs-text-mid); font: var(--text-pc-script-12); font-weight: 600; cursor: pointer; }
  .cs-chip:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
  .cs-chip--on { background: var(--cs-purple); color: var(--cs-white); }
  .cs-chip--danger { color: var(--cs-error); }
  .cs-chip:disabled { opacity: 0.5; cursor: not-allowed; }
  .cs-add { display: flex; gap: 8px; align-items: center; }
  .cs-cta { height: 44px; padding: 0 20px; border: none; border-radius: var(--cms-radius-md); background: var(--cs-purple); color: var(--cs-white); font: var(--text-pc-body-14); cursor: pointer; white-space: nowrap; transition: background 0.15s; }
  .cs-cta:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .cs-cta:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
