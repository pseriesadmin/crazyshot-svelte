<script lang="ts">
  import { onMount } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import CmsContentEditor from '$lib/components/cms/CmsContentEditor.svelte'
  import type { ContentBlock } from '$lib/types/content-editor'

  interface Props {
    contractId:    string
    reservationId: number
    onclose:       () => void
  }

  let { contractId, reservationId, onclose }: Props = $props()

  let blocks    = $state<ContentBlock[]>([])
  let keywords  = $state<string[]>([])
  let specs     = $state<{ key: string; value: string }[]>([{ key: '', value: '' }])
  let title     = $state('')
  let loading   = $state(true)
  let saving    = $state(false)

  onMount(async () => {
    try {
      const res = await fetch(`/api/cms/contracts/${contractId}/content`)
      if (res.ok) {
        const body = await res.json() as {
          title?: string
          content_blocks?: ContentBlock[]
          specifications?: { key: string; value: string }[]
        }
        title   = body.title ?? ''
        blocks  = body.content_blocks ?? []
        specs   = (body.specifications?.length ?? 0) > 0
          ? (body.specifications as { key: string; value: string }[])
          : [{ key: '', value: '' }]
      }
    } catch {
      csToast.error('계약서 데이터를 불러오지 못했습니다.')
    } finally {
      loading = false
    }
  })

  function addSpec() { specs = [...specs, { key: '', value: '' }] }
  function removeSpec(i: number) { specs = specs.filter((_, idx) => idx !== i) }

  async function save() {
    saving = true
    try {
      const res = await fetch(`/api/cms/contracts/${contractId}/content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content_blocks: blocks,
          specifications: specs.filter((s) => s.key.trim()),
        }),
      })
      if (res.ok) {
        csToast.success('계약서가 저장되었습니다.')
        onclose()
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string }
        csToast.error(body.error ?? '저장에 실패했습니다.')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      saving = false
    }
  }

  function trapFocus(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={trapFocus} />

<div class="modal-overlay" role="dialog" aria-modal="true" aria-label="계약서 편집">
  <div class="modal-box">
    <div class="modal-header">
      <span class="modal-title">계약서 편집</span>
      <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
    </div>

    {#if loading}
      <div class="modal-loading">데이터를 불러오는 중...</div>
    {:else}
      <div class="modal-body">
        <div class="field-row">
          <label class="f-label" for="contract-title">계약서 제목</label>
          <input
            id="contract-title"
            class="f-input"
            bind:value={title}
            placeholder="계약서 제목"
          />
        </div>

        <div class="field-section">
          <p class="section-label">계약서 본문</p>
          <CmsContentEditor bind:blocks bind:keywords />
        </div>

        <div class="field-section">
          <p class="section-label">특약 조항</p>
          <div class="spec-list">
            {#each specs as spec, i (i)}
              <div class="spec-row">
                <input class="f-input spec-key" placeholder="항목명" bind:value={spec.key} />
                <input class="f-input spec-val" placeholder="내용" bind:value={spec.value} />
                <button
                  type="button"
                  class="remove-btn"
                  onclick={() => removeSpec(i)}
                  disabled={specs.length === 1}
                  aria-label="항목 삭제"
                >✕</button>
              </div>
            {/each}
          </div>
          <button type="button" class="add-row-btn" onclick={addSpec}>+ 항목 추가</button>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick={onclose}>취소</button>
        <button type="button" class="btn-action" onclick={save} disabled={saving}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .modal-box {
    background: var(--cs-white);
    border-radius: var(--cms-radius-sm);
    width: 100%;
    max-width: 900px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .modal-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--cs-text-mid);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--cs-lilac); }

  .modal-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    padding: 48px;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .field-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .f-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }
  .f-input {
    height: 36px;
    padding: 0 12px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    outline: none;
    transition: border-color 0.1s;
    width: 100%;
    box-sizing: border-box;
  }
  .f-input:focus { border-color: var(--cs-purple); }

  .field-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .section-label {
    margin: 0;
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }

  .spec-list { display: flex; flex-direction: column; gap: 8px; }
  .spec-row  { display: flex; gap: 8px; align-items: center; }
  .spec-key  { flex: 2; }
  .spec-val  { flex: 3; }

  .remove-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    color: var(--cs-text-mid);
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.1s, color 0.1s;
  }
  .remove-btn:hover:not(:disabled) {
    background: rgba(255,53,53,0.08);
    color: var(--cs-red-badge);
  }
  .remove-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .add-row-btn {
    align-self: flex-start;
    height: 30px;
    padding: 0 12px;
    border: 1px dashed #CCCCCC;
    border-radius: var(--cms-radius-sm);
    background: transparent;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    cursor: pointer;
    transition: border-color 0.1s, color 0.1s;
  }
  .add-row-btn:hover { border-color: var(--cs-purple); color: var(--cs-purple); }

  .modal-footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 16px 20px;
    border-top: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }

  .btn-action {
    height: 34px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-action:hover    { background: var(--cs-purple-hover); }
  .btn-action:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-secondary {
    height: 34px;
    padding: 0 16px;
    background: var(--cs-white);
    color: var(--cs-text);
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-secondary:hover { background: var(--cs-surface-gray); }
</style>
