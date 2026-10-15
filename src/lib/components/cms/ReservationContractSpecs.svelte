<script lang="ts">
  // 계약 특약 사전 등록 — 계약서 발행 전에 이 예약 건만의 특약(항목명·내용)을 미리 저장한다(2026-10-15, Stephen).
  // 저장값은 전자계약 발행(자동·수동) 때 양식의 '특약사항'에 양식 특약 뒤로 이어 붙는다(service-operations.md §31).
  // 계약서가 이미 생성된 뒤에는 부모가 이 영역을 숨긴다(발행된 계약서에는 반영되지 않기 때문).
  import { csToast } from '$lib/utils/toast'
  import { MAX_CONTRACT_SPEC_ROWS, MAX_CONTRACT_SPEC_KEY, MAX_CONTRACT_SPEC_VALUE, type ContractSpecRow } from '$lib/utils/contractSpecs'

  interface Props { reservationId: number; disabled?: boolean; disabledReason?: string; onsaved?: (contractUpdated: boolean) => void }
  let { reservationId, disabled = false, disabledReason = '', onsaved }: Props = $props()

  let rows = $state<ContractSpecRow[]>([])
  let saved = $state('[]')
  let loading = $state(true)
  let saving = $state(false)
  let hidden = $state(false) // 권한 없음(partner) 등으로 조회가 막히면 영역 자체를 숨긴다
  let loadedFor: number | null = null

  const cleaned = $derived(rows.filter(r => r.key.trim()).map(r => ({ key: r.key.trim(), value: r.value.trim() })))
  const dirty = $derived(JSON.stringify(cleaned) !== saved)

  $effect(() => {
    const id = reservationId
    if (loadedFor === id) return
    loadedFor = id
    loading = true
    hidden = false
    fetch(`/api/cms/reservations/${id}/contract-specs`)
      .then(async (r) => {
        if (loadedFor !== id) return
        if (!r.ok) { hidden = true; return }
        const d = await r.json() as { specifications?: ContractSpecRow[] }
        const list = d.specifications ?? []
        rows = list.map(x => ({ ...x }))
        saved = JSON.stringify(list)
      })
      .catch(() => { if (loadedFor === id) hidden = true })
      .finally(() => { if (loadedFor === id) loading = false })
  })

  function addRow() {
    if (rows.length >= MAX_CONTRACT_SPEC_ROWS) { csToast.warning(`특약은 최대 ${MAX_CONTRACT_SPEC_ROWS}개까지 등록할 수 있어요.`); return }
    rows = [...rows, { key: '', value: '' }]
  }
  function removeRow(i: number) { rows = rows.filter((_, idx) => idx !== i) }

  async function save() {
    if (saving || !dirty) return
    saving = true
    try {
      const res = await fetch(`/api/cms/reservations/${reservationId}/contract-specs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specifications: cleaned }),
      })
      const d = await res.json().catch(() => null) as { ok?: boolean; error?: string; specifications?: ContractSpecRow[]; contractUpdated?: boolean } | null
      if (d?.ok) {
        const list = d.specifications ?? []
        rows = list.map(x => ({ ...x }))
        saved = JSON.stringify(list)
        csToast.success(d.contractUpdated ? '계약 특약을 저장하고, 생성된 계약서의 특약사항에도 반영했어요.' : '계약 특약을 저장했어요. 전자계약 발행 시 특약사항에 반영돼요.')
        onsaved?.(!!d.contractUpdated)
      } else {
        csToast.error(d?.error ?? '특약 저장에 실패했습니다.')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      saving = false
    }
  }
</script>

{#if !hidden}
  <div class="specs-box">
    <div class="specs-head">
      <span class="specs-title">계약 특약 등록</span>
      <button type="button" class="btn-save" disabled={disabled || !dirty || saving || loading} onclick={save}>{saving ? '저장 중...' : '저장'}</button>
    </div>
    {#if disabled}<p class="specs-hint specs-off">{disabledReason}</p>{/if}
    <p class="specs-hint">이 예약 건만의 특약을 미리 등록하면, 전자계약 발행 시 양식의 '특약사항'에 자동으로 들어가요.</p>
    {#if loading}
      <p class="specs-hint">불러오는 중…</p>
    {:else}
      <div class="spec-list">
        {#each rows as row, i (i)}
          <div class="spec-row">
            <input class="f-input spec-key" placeholder="항목명" maxlength={MAX_CONTRACT_SPEC_KEY} aria-label="특약 항목명 {i + 1}" bind:value={row.key} {disabled} />
            <input class="f-input spec-val" placeholder="내용" maxlength={MAX_CONTRACT_SPEC_VALUE} aria-label="특약 내용 {i + 1}" bind:value={row.value} {disabled} />
            <button type="button" class="remove-btn" aria-label="항목 {i + 1} 삭제" {disabled} onclick={() => removeRow(i)}>✕</button>
          </div>
        {/each}
      </div>
      <button type="button" class="add-row-btn" {disabled} onclick={addRow}>+ 항목 추가</button>
    {/if}
  </div>
{/if}

<style>
  .specs-box { background: var(--cs-white); border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-md); padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .specs-head { display: flex; align-items: center; justify-content: space-between; }
  .specs-title { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }
  .specs-hint { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .specs-off { color: var(--cs-error); font-weight: 700; }
  .f-input:disabled, .add-row-btn:disabled, .remove-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .spec-list { display: flex; flex-direction: column; gap: 6px; }
  .spec-row { display: flex; align-items: center; gap: 8px; }
  .f-input { background: var(--cs-surface-gray); border: none; border-radius: var(--radius-sm); padding: 8px 12px; font: var(--text-pc-body-14); color: var(--cs-text); box-sizing: border-box; min-width: 0; }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .spec-key { flex: 0 0 140px; }
  .spec-val { flex: 1; }
  .remove-btn { width: 28px; height: 28px; background: none; border: none; border-radius: var(--radius-sm); color: var(--cs-text-light); cursor: pointer; flex-shrink: 0; }
  .remove-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .add-row-btn { align-self: flex-start; height: 30px; padding: 0 12px; background: none; border: 1px dashed var(--cs-text-light); border-radius: var(--radius-sm); font: var(--text-pc-script-12); color: var(--cs-text-mid); cursor: pointer; }
  .add-row-btn:hover { border-color: var(--cs-purple); color: var(--cs-purple); }
  /* DetailPanel 소형 실행 버튼(cms-uiux.md §0-10-F) */
  .btn-save { min-width: 78px; text-align: center; font-size: 12px; font-weight: 700; line-height: 1.4; padding: 8px 14px; border: 1px solid var(--cs-text-mid); border-radius: var(--cms-radius-sm); background: var(--cs-surface-gray); color: var(--cs-text-mid); cursor: pointer; white-space: nowrap; transition: background 0.15s, color 0.15s; }
  .btn-save:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
  .btn-save:disabled { opacity: 0.5; cursor: default; }
</style>
