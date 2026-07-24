<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import CmsContentEditor from '$lib/components/cms/CmsContentEditor.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import ContractModuleBar from '$lib/components/cms/ContractModuleBar.svelte'
  import type { ContentBlock } from '$lib/types/content-editor'
  import type { ContractTemplate } from '$lib/types/contract-template'

  interface Props {
    template:  ContractTemplate | null
    onclose?:  () => void
    onsaved?:  (id: string) => void
  }

  let { template = null, onclose, onsaved }: Props = $props()

  let blocks    = $state<ContentBlock[]>((template?.content_blocks as ContentBlock[]) ?? [])
  let keywords  = $state<string[]>([])
  let specs     = $state<{ key: string; value: string }[]>(
    Array.isArray(template?.specifications) && (template.specifications as unknown[]).length > 0
      ? (template.specifications as { key: string; value: string }[])
      : [{ key: '', value: '' }]
  )
  let title   = $state(template?.title ?? '')
  let saving  = $state(false)

  function addSpec() { specs = [...specs, { key: '', value: '' }] }
  function removeSpec(i: number) { specs = specs.filter((_, idx) => idx !== i) }
  function serializeSpecs(): string {
    return JSON.stringify(specs.filter((s) => s.key.trim()))
  }
  function serializeBlocks(): string { return JSON.stringify(blocks) }

  function insertModuleBlocks(newBlocks: ContentBlock[]) {
    blocks = [...blocks, ...newBlocks]
  }
</script>

<div class="template-panel">
  <div class="panel-header">
    <span class="panel-title">{template ? '계약서 양식 수정' : '계약서 양식 등록'}</span>
    {#if onclose}
      <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
    {/if}
  </div>

  <form
    method="POST"
    action={template ? '?/update' : '?/create'}
    use:enhance={({ formData }) => {
      formData.set('content_blocks', serializeBlocks())
      formData.set('specifications', serializeSpecs())
      saving = true
      return async ({ result, update }) => {
        saving = false
        if (result.type === 'success') {
          csToast.success(template ? '수정되었습니다.' : '등록되었습니다.')
          const id = (result.data as { id?: string })?.id ?? template?.id ?? ''
          if (onsaved) {
            onsaved(id)
          } else {
            await update()
          }
        } else if (result.type === 'failure') {
          const msg = (result.data as { error?: string })?.error ?? '저장에 실패했습니다.'
          csToast.error(msg)
        }
      }
    }}
  >
    {#if template}
      <input type="hidden" name="id" value={template.id} />
    {/if}

    <div class="field-row">
      <label class="f-label" for="tpl-title">계약서 제목</label>
      <input
        id="tpl-title"
        class="f-input"
        name="title"
        bind:value={title}
        placeholder="계약서 양식 제목 입력"
        required
      />
    </div>

    <div class="field-section">
      <p class="section-label">계약서 본문</p>
      <ContractModuleBar onInsertBlocks={insertModuleBlocks} />
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

    <div class="panel-actions">
      {#if template}
        <CmsDeleteButton
          action="?/softDelete"
          id={template.id}
          warnMessage="한번 더 클릭 시 이 양식이 삭제됩니다."
          successMessage="양식이 삭제되었습니다."
          onsuccess={() => { onsaved?.('') }}
        />
      {/if}
      <button type="submit" class="btn-action" disabled={saving}>
        {saving ? '저장 중...' : template ? '수정 저장' : '양식 등록'}
      </button>
    </div>
  </form>
</div>

<style>
  .template-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .panel-title {
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
    line-height: 1;
    border-radius: var(--radius-sm);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--cs-lilac); }

  form {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
    overflow-y: auto;
    flex: 1;
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

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--cs-lilac);
    margin-top: auto;
  }
  .panel-actions :global(.act-del) { margin-right: auto; }

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
</style>
