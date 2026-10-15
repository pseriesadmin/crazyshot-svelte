<script lang="ts">
  /**
   * SpecsTab.svelte — 특약 조항 key-value 편집 (adapters/crazyshot, 계약서 전용)
   *
   * 이관 원본: contract-editor/ContractFieldPanel.svelte 의 '특약' 탭 UI(원본은 무변경 유지).
   * 변수 패널의 extraTabs 스니펫 본문으로 쓰인다. 계약서 고유 개념이라 core/ui가 아니라 어댑터에 둔다.
   */
  interface SpecRow { key: string; value: string }

  interface Props {
    specifications: SpecRow[]
    onSpecsChange: (specs: SpecRow[]) => void
  }

  let { specifications, onSpecsChange }: Props = $props()

  function addSpec() {
    onSpecsChange([...specifications, { key: '', value: '' }])
  }
  function removeSpec(i: number) {
    onSpecsChange(specifications.filter((_, idx) => idx !== i))
  }
  function updateSpec(i: number, field: 'key' | 'value', val: string) {
    onSpecsChange(specifications.map((s, idx) => (idx === i ? { ...s, [field]: val } : s)))
  }
</script>

<p class="sp-hint">특약은 관리자가 직접 입력하는 고정 텍스트입니다.</p>
<div class="spec-list">
  {#each specifications as spec, i (i)}
    <div class="spec-row">
      <input
        class="f-input spec-key"
        placeholder="항목명"
        value={spec.key}
        oninput={(e) => updateSpec(i, 'key', (e.target as HTMLInputElement).value)}
        aria-label="특약 항목명 {i + 1}"
      />
      <input
        class="f-input spec-val"
        placeholder="내용"
        value={spec.value}
        oninput={(e) => updateSpec(i, 'value', (e.target as HTMLInputElement).value)}
        aria-label="특약 내용 {i + 1}"
      />
      <button
        type="button"
        class="remove-btn"
        onclick={() => removeSpec(i)}
        disabled={specifications.length === 1}
        aria-label="항목 {i + 1} 삭제"
      >✕</button>
    </div>
  {/each}
</div>
<button type="button" class="add-row-btn" onclick={addSpec}>+ 항목 추가</button>

<style>
  .sp-hint {
    margin: 0;
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    color: var(--de-text-mid, #666666);
    line-height: 1.4;
  }
  .spec-list { display: flex; flex-direction: column; gap: 6px; }
  .spec-row  { display: flex; gap: 6px; align-items: center; }
  .spec-key  { flex: 2; }
  .spec-val  { flex: 3; }

  .f-input {
    height: 32px;
    padding: 0 8px;
    border: 1px solid #DDDDDD;
    border-radius: var(--de-radius-sm, 10px);
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    color: var(--de-text, #100B32);
    outline: none;
    transition: border-color 0.1s;
    width: 100%;
    box-sizing: border-box;
  }
  .f-input:focus { border-color: var(--de-purple, #3B2F8A); }

  .remove-btn {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--de-radius-xs, 8px);
    background: transparent;
    cursor: pointer;
    color: var(--de-text-mid, #666666);
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.1s, color 0.1s;
  }
  .remove-btn:hover:not(:disabled) {
    background: rgba(255, 53, 53, 0.08);
    color: var(--de-danger, #FF3535);
  }
  .remove-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .add-row-btn {
    align-self: flex-start;
    height: 28px;
    padding: 0 10px;
    border: 1px dashed #CCCCCC;
    border-radius: var(--de-radius-sm, 10px);
    background: transparent;
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    color: var(--de-text-mid, #666666);
    cursor: pointer;
    transition: border-color 0.1s, color 0.1s;
  }
  .add-row-btn:hover {
    border-color: var(--de-purple, #3B2F8A);
    color: var(--de-purple, #3B2F8A);
  }
</style>
