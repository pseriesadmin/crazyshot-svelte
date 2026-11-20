<script lang="ts">
  // 조합 행을 왼쪽 카테고리 카드에 끌어 놓았을 때 뜨는 소형 확인창.
  // 열리면 즉시 미리보기(변경 없음)를 불러오고, [이동 확정]에서만 실제로 반영한다. 코드품번은 바뀌지 않는다(Migration 841).
  import { csToast } from '$lib/utils/toast'
  import type { GroupComboMove, GroupComboMoveResult } from '$lib/utils/codeGroupMove'
  import { callCodesAction } from './_groupMoveClient'

  type PreviewWarning = { groupId: string; groupName: string; categoryKey: string; settings: string[] }

  interface Props {
    move: GroupComboMove
    fromName: string
    toName: string
    /** 이 조합이 출발 카테고리의 마지막 조합이라 카테고리가 비게 되는 경우 — 상품 전체 이동 선택지를 연다 */
    restOffer: boolean
    onclose: () => void
    onapplied: (result: GroupComboMoveResult) => void
  }
  let { move, fromName, toName, restOffer, onclose, onapplied }: Props = $props()

  let busy = $state(true)
  let includeRest = $state(false)
  let preview = $state<GroupComboMoveResult | null>(null)
  let warnings = $state<PreviewWarning[]>([])
  let seq = 0

  function payload() {
    return { moves: JSON.stringify([move]), include_rest: includeRest ? '1' : '0' }
  }

  async function loadPreview() {
    const my = ++seq
    const body = payload()
    busy = true
    const r = await callCodesAction('previewGroupComboMove', body)
    if (my !== seq) return
    busy = false
    if (!r.ok) {
      csToast.error(r.error)
      onclose()
      return
    }
    preview = r.data['preview'] as GroupComboMoveResult
    warnings = (r.data['warnings'] as PreviewWarning[] | undefined) ?? []
  }

  // 열릴 때, 그리고 [상품 전체 이동] 체크가 바뀔 때마다 미리보기를 다시 불러온다
  $effect(() => {
    void includeRest
    void loadPreview()
  })

  // 확정 요청이 나간 뒤에는 닫지 않는다(결과 토스트가 뜰 때까지 창을 유지해 재시도·오해를 막는다)
  let applying = false
  function close() {
    if (!applying) onclose()
  }

  async function confirmApply() {
    applying = true
    busy = true
    const r = await callCodesAction('applyGroupComboMove', payload())
    if (!r.ok) {
      applying = false
      busy = false
      csToast.error(r.error)
      onclose()
      return
    }
    onapplied(r.data['applied'] as GroupComboMoveResult)
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') close() }} />

<div class="cd-backdrop" role="presentation" onclick={close}>
  <div class="cd-dialog" role="dialog" aria-modal="true" aria-label="카테고리 이동 확인" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <button class="close-btn" type="button" aria-label="패널 닫기" onclick={close}>✕</button>

    {#if preview}
      <p class="cd-sum">조합 {preview.combos}개 · 상품 {preview.parents}개 · 자식 재고 {preview.children}개{#if preview.rest > 0} · 나머지 상품 {preview.rest}개{/if}</p>
      <ul class="cd-lines">
        {#each preview.detail as d (d.combo_row_id)}
          <li>{d.code} · {fromName} → {toName} {#if d.shared_code}(같은 코드 조합이 남아 상품은 그대로){:else}({d.parents}개{#if d.children > 0} + 자식 {d.children}개{/if}){/if}</li>
        {/each}
      </ul>
      {#each warnings as w (w.groupId)}
        <p class="cd-warn">'{w.groupName}'({w.categoryKey})가 비게 됩니다. 이 키를 쓰는 설정: {w.settings.join(', ')}</p>
      {/each}
    {:else}
      <p class="cd-sum">불러오는 중…</p>
    {/if}

    <div class="cd-footer">
      {#if restOffer}
        <label class="cd-rest">
          <input type="checkbox" bind:checked={includeRest} disabled={busy} />
          '{fromName}' 카테고리 상품 전체 이동
        </label>
      {/if}
      <button type="button" class="cd-btn-sub" disabled={busy} onclick={close}>취소</button>
      <button type="button" class="btn-primary" disabled={busy || !preview} onclick={confirmApply}>이동 확정</button>
    </div>
  </div>
</div>

<style>
.cd-backdrop {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(16,11,50,0.45);
  display: flex; align-items: center; justify-content: center;
}
.cd-dialog {
  position: relative;
  width: min(520px, 94vw); max-height: 88vh; overflow: auto;
  background: var(--cs-white);
  border-radius: var(--cms-radius-lg);
  padding: 50px 30px 30px;
  display: flex; flex-direction: column; gap: 14px;
}
.close-btn {
  position: absolute; top: 14px; right: 16px;
  width: 28px; height: 28px; min-height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: var(--radius-sm);
  color: var(--cs-text-light); font-size: 14px; cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

.cd-sum { margin: 0; font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }
.cd-lines { margin: 0; padding-left: 18px; font: var(--text-pc-script-12); color: var(--cs-text-mid); display: flex; flex-direction: column; gap: 4px; }
.cd-warn { margin: 0; padding: 10px 12px; border-radius: var(--cms-radius-sm); background: var(--cs-surface-gray); font: var(--text-pc-script-12); color: var(--cs-error); }

.cd-footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 6px; }
.cd-rest { margin-right: auto; display: inline-flex; align-items: center; gap: 8px; font: var(--text-pc-script-12); color: var(--cs-text-mid); }
.btn-primary {
  height: 44px; padding: 0 20px;
  background: var(--cs-purple); color: var(--cs-white);
  border: none; border-radius: var(--cms-radius-md);
  font: var(--text-pc-body-14); cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) { background: var(--cs-purple-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.cd-btn-sub {
  height: 44px; padding: 0 20px; border: none; border-radius: var(--cms-radius-md);
  background: var(--cs-lilac); color: var(--cs-text-mid); font: var(--text-pc-body-14); cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.cd-btn-sub:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
.cd-btn-sub:disabled { opacity: 0.5; cursor: default; }
</style>
