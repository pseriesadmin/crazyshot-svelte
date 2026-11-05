<script lang="ts">
  // GuestMergeModal.svelte — 비회원(익명) 상담 세션을 회원 계정으로 수동 병합하는 관리자 모달 (2026-11-05, Stephen 지시)
  // 가입 뒤 로그아웃 상태로 새로 연 비회원 상담은 로그인 시 자동 병합이 닿지 않아, 관리자가 정황으로 같은 고객임을 판단해 직접 합친다.
  // 회원 검색: GET /api/cms/chat/merge-guest/search · 병합: POST /api/cms/chat/merge-guest (둘 다 매니저 이상)
  import { csToast } from '$lib/utils/toast'
  import { sanitizeMemberQuery, MEMBER_SEARCH_MIN } from '$lib/utils/memberSearchQuery'

  interface MemberCandidate {
    id: string
    email: string | null
    full_name: string | null
    member_code: string | null
  }

  interface Props {
    sessionId: string
    onclose: () => void
    /** 병합 성공 — 회원 쪽 상담 세션 id(없으면 null)와 옮긴 메시지 수 */
    onmerged: (memberSessionId: string | null, messages: number) => void
  }

  let { sessionId, onclose, onmerged }: Props = $props()

  let query = $state('')
  let members = $state<MemberCandidate[]>([])
  let searched = $state(false)
  let searching = $state(false)
  let selectedId = $state<string | null>(null)
  let merging = $state(false)
  let searchSeq = 0
  let debounce: ReturnType<typeof setTimeout> | null = null

  let selected = $derived(members.find((m) => m.id === selectedId) ?? null)

  function handleInput(): void {
    selectedId = null
    if (debounce) clearTimeout(debounce)
    const q = sanitizeMemberQuery(query)
    if (q.length < MEMBER_SEARCH_MIN) {
      members = []
      searched = false
      searching = false
      return
    }
    searching = true
    debounce = setTimeout(() => { void runSearch(q) }, 300)
  }

  async function runSearch(q: string): Promise<void> {
    const seq = ++searchSeq
    try {
      const res = await fetch(`/api/cms/chat/merge-guest/search?q=${encodeURIComponent(q)}`)
      if (seq !== searchSeq) return
      if (!res.ok) {
        csToast.error('회원 검색에 실패했습니다.')
        members = []
      } else {
        const body = (await res.json()) as { members?: MemberCandidate[] }
        members = body.members ?? []
      }
    } catch {
      if (seq !== searchSeq) return
      csToast.error('회원 검색에 실패했습니다.')
      members = []
    } finally {
      if (seq === searchSeq) {
        searched = true
        searching = false
      }
    }
  }

  async function handleMerge(): Promise<void> {
    if (merging) return
    if (!selected) {
      csToast.warning('병합할 회원을 선택해 주세요.')
      return
    }
    merging = true
    try {
      const res = await fetch('/api/cms/chat/merge-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, member_id: selected.id }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        messages?: number
        member_session_id?: string | null
      }
      if (!res.ok || !body.ok) {
        csToast.error(body.error ?? '병합에 실패했습니다.')
        return
      }
      onmerged(body.member_session_id ?? null, body.messages ?? 0)
    } catch {
      csToast.error('병합에 실패했습니다.')
    } finally {
      merging = false
    }
  }

  function handleBackdropKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={handleBackdropKey} />

<div class="gm-backdrop" role="presentation" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div class="gm-dialog" role="dialog" aria-modal="true" aria-labelledby="gm-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <h2 class="gm-title" id="gm-title">회원 계정으로 병합</h2>
    <p class="gm-desc">
      이 비회원 상담의 대화를 선택한 회원의 상담으로 옮깁니다. 같은 고객인지 대화·예약 내용으로 확인한 뒤 진행해 주세요.
      병합 기록은 남아 되돌릴 수 있습니다.
    </p>

    <label class="gm-label" for="gm-search">회원 검색</label>
    <input
      id="gm-search"
      class="gm-input"
      type="text"
      placeholder="이메일 · 회원코드 · 이름 (2자 이상)"
      maxlength="60"
      autocomplete="off"
      bind:value={query}
      oninput={handleInput}
    />

    <div class="gm-results" aria-live="polite">
      {#if searching}
        <p class="gm-hint">검색 중...</p>
      {:else if searched && members.length === 0}
        <p class="gm-hint">검색 결과가 없습니다.</p>
      {:else}
        {#each members as m (m.id)}
          <button
            type="button"
            class="gm-row"
            class:gm-row--selected={m.id === selectedId}
            aria-pressed={m.id === selectedId}
            onclick={() => { selectedId = m.id }}
          >
            <span class="gm-row-name">{m.full_name || '이름 없음'}</span>
            <span class="gm-row-sub">{m.email ?? '이메일 없음'}</span>
            {#if m.member_code}<span class="gm-row-code">{m.member_code}</span>{/if}
          </button>
        {/each}
      {/if}
    </div>

    <div class="gm-actions">
      <button type="button" class="gm-btn gm-btn-cancel" onclick={onclose} disabled={merging}>취소</button>
      <button type="button" class="gm-btn gm-btn-primary" onclick={handleMerge} disabled={merging}>
        {merging ? '병합 중...' : '병합하기'}
      </button>
    </div>
  </div>
</div>

<style>
  .gm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(16, 11, 50, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gm-dialog {
    width: 440px;
    max-width: 94vw;
    max-height: 90vh;
    overflow-y: auto;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .gm-title { margin: 0; font: var(--text-pc-title-16); font-weight: 700; color: var(--cs-text); }
  .gm-desc { margin: 0 0 6px; font: var(--text-pc-script-12); color: var(--cs-text-mid); line-height: 1.6; }
  .gm-label { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text-mid); }
  .gm-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    padding: 10px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 100%;
    box-sizing: border-box;
  }
  .gm-input::placeholder { color: var(--cs-text-light); }
  .gm-input:focus { outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }

  .gm-results { display: flex; flex-direction: column; gap: 6px; min-height: 48px; max-height: 260px; overflow-y: auto; }
  .gm-hint { margin: 0; padding: 14px 4px; font: var(--text-pc-script-12); color: var(--cs-text-light); text-align: center; }
  .gm-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    font: var(--text-pc-script-12);
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }
  .gm-row:hover { background: var(--cs-lilac); }
  .gm-row--selected, .gm-row--selected:hover { background: var(--cs-purple-op10); }
  .gm-row-name { font-weight: 700; flex-shrink: 0; }
  .gm-row-sub { color: var(--cs-text-mid); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gm-row-code { color: var(--cs-purple); font-weight: 700; flex-shrink: 0; }

  .gm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }
  .gm-btn {
    height: 44px;
    padding: 0 20px;
    border: none;
    border-radius: var(--cms-radius-md);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s;
  }
  .gm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .gm-btn-cancel { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .gm-btn-cancel:hover:not(:disabled) { background: var(--cs-lilac); }
  .gm-btn-primary { background: var(--cs-purple); color: var(--cs-white); }
  .gm-btn-primary:hover:not(:disabled) { background: var(--cs-purple-hover); }
</style>
