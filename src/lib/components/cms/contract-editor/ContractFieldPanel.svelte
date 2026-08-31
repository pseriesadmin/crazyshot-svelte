<script lang="ts">
  /**
   * ContractFieldPanel.svelte — DB 필드 매핑 패널 (ContractModuleBar 대체)
   *
   * - 카테고리별(계약자정보/상품정보/결제정보/특약) 변수 칩을 현재 커서 위치에 삽입
   * - 기존 ContractModuleBar의 "문서 끝 고정 표 통째로 추가" 방식 완전 대체
   * - "특약" 탭이 specifications key-value 관리 UI를 직접 담당 (P3-2)
   * - 수량(수량)은 항상 서버에서 '1'로 하드코딩됨 (products.md §5, contract-data:78)
   *   → 거짓 다중수량 선택지 없이 일반 변수 칩으로만 제공 (P3-3)
   */

  import type { MergeFieldAttrs } from '$lib/types/contract-document'

  interface SpecRow {
    key: string
    value: string
  }

  interface Props {
    /** 변수 칩 클릭 시 에디터 커서 위치에 삽입하는 콜백 */
    onInsertField: (attrs: MergeFieldAttrs) => void
    /** 특약 조항 배열 (쌍방향) */
    specifications: SpecRow[]
    /** 특약 목록 변경 알림 */
    onSpecsChange: (specs: SpecRow[]) => void
  }

  let { onInsertField, specifications, onSpecsChange }: Props = $props()

  // --------------------------------------------------------------------------
  // 탭 정의
  // --------------------------------------------------------------------------
  type TabKey = '계약자정보' | '상품정보' | '결제정보' | '특약'

  const TABS: { key: TabKey; label: string }[] = [
    { key: '계약자정보', label: '계약자' },
    { key: '상품정보',   label: '상품' },
    { key: '결제정보',   label: '결제' },
    { key: '특약',       label: '특약' },
  ]

  let activeTab = $state<TabKey>('계약자정보')

  // --------------------------------------------------------------------------
  // 변수 카탈로그 (ContractSubstitutionData 17개 스칼라 변수 중 UI 노출분)
  // NOTE: 수량은 서버 하드코딩 '1' — 다중수량 선택지 없음 (P3-3, products.md §5)
  // --------------------------------------------------------------------------
  const FIELD_GROUPS: Record<Exclude<TabKey, '특약'>, MergeFieldAttrs[]> = {
    계약자정보: [
      { variable: '고객이름', label: '고객이름' },
      { variable: '연락처',   label: '연락처' },
      { variable: '이메일',   label: '이메일' },
      { variable: '주소',     label: '주소' },
    ],
    상품정보: [
      { variable: '예약코드', label: '예약코드' },
      { variable: '상품코드', label: '상품코드' },
      { variable: '상품명',   label: '상품명' },
      { variable: '수량',     label: '수량 (항상 1)' },
      { variable: '수령형태', label: '수령형태' },
      { variable: '수령일시', label: '수령일시' },
      { variable: '반납형태', label: '반납형태' },
      { variable: '반납일시', label: '반납일시' },
      { variable: '요금유형', label: '요금유형' },
    ],
    결제정보: [
      { variable: '기본대여요금', label: '기본대여요금' },
      { variable: '할인금액',    label: '할인금액' },
      { variable: '부가세',      label: '부가세' },
      { variable: '최종합계',    label: '최종합계' },
    ],
  }

  // --------------------------------------------------------------------------
  // 특약 조항 관리 (P3-2)
  // --------------------------------------------------------------------------
  function addSpec() {
    onSpecsChange([...specifications, { key: '', value: '' }])
  }

  function removeSpec(i: number) {
    onSpecsChange(specifications.filter((_, idx) => idx !== i))
  }

  function updateSpec(i: number, field: 'key' | 'value', val: string) {
    const next = specifications.map((s, idx) => idx === i ? { ...s, [field]: val } : s)
    onSpecsChange(next)
  }
</script>

<div class="cfp-wrap">
  <!-- 탭 헤더 -->
  <div class="cfp-tabs" role="tablist" aria-label="필드 카테고리">
    {#each TABS as tab (tab.key)}
      <button
        type="button"
        role="tab"
        class="cfp-tab"
        class:active={activeTab === tab.key}
        aria-selected={activeTab === tab.key}
        onclick={() => { activeTab = tab.key }}
      >{tab.label}</button>
    {/each}
  </div>

  <!-- 탭 콘텐츠 -->
  <div class="cfp-body">
    {#if activeTab !== '특약'}
      <!-- 변수 칩 목록 -->
      <p class="cfp-hint">클릭하면 커서 위치에 변수가 삽입됩니다.</p>
      <div class="cfp-chips">
        {#each FIELD_GROUPS[activeTab] as field (field.variable)}
          <button
            type="button"
            class="cfp-chip"
            onclick={() => onInsertField(field)}
            title={`{{${field.variable}}} 삽입`}
          >
            <span class="chip-label">{field.label}</span>
            <span class="chip-var">{`{{${field.variable}}}`}</span>
          </button>
        {/each}
      </div>
    {:else}
      <!-- 특약 조항 key-value 관리 (P3-2) -->
      <p class="cfp-hint">특약은 관리자가 직접 입력하는 고정 텍스트입니다.</p>
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
    {/if}
  </div>
</div>

<style>
  .cfp-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--cms-radius-sm, 8px);
    background: var(--cs-white, #fff);
    overflow: hidden;
  }

  /* 탭 */
  .cfp-tabs {
    display: flex;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    background: var(--cs-surface-gray, #f6f6f6);
    flex-shrink: 0;
  }

  .cfp-tab {
    flex: 1;
    height: 36px;
    padding: 0 4px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    color: var(--cs-text-mid, #666);
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .cfp-tab:hover {
    color: var(--cs-purple, #3B2F8A);
  }
  .cfp-tab.active {
    color: var(--cs-purple, #3B2F8A);
    border-bottom-color: var(--cs-purple, #3B2F8A);
    background: var(--cs-white, #fff);
  }

  /* 본문 */
  .cfp-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cfp-hint {
    margin: 0;
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text-mid, #666);
    line-height: 1.4;
  }

  /* 변수 칩 목록 */
  .cfp-chips {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .cfp-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid rgba(59, 47, 138, 0.25);
    border-radius: var(--cms-radius-sm, 8px);
    background: var(--cs-white, #fff);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
    text-align: left;
  }
  .cfp-chip:hover {
    background: rgba(59, 47, 138, 0.06);
    border-color: var(--cs-purple, #3B2F8A);
  }

  .chip-label {
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    color: var(--cs-text, #100B32);
    white-space: nowrap;
  }

  .chip-var {
    font: var(--text-pc-script-12, 12px);
    font-family: monospace;
    color: var(--cs-purple, #3B2F8A);
    opacity: 0.7;
    font-size: 10px;
    white-space: nowrap;
  }

  /* 특약 조항 */
  .spec-list { display: flex; flex-direction: column; gap: 6px; }
  .spec-row  { display: flex; gap: 6px; align-items: center; }
  .spec-key  { flex: 2; }
  .spec-val  { flex: 3; }

  .f-input {
    height: 32px;
    padding: 0 8px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm, 8px);
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text, #100B32);
    outline: none;
    transition: border-color 0.1s;
    width: 100%;
    box-sizing: border-box;
  }
  .f-input:focus { border-color: var(--cs-purple, #3B2F8A); }

  .remove-btn {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm, 8px);
    background: transparent;
    cursor: pointer;
    color: var(--cs-text-mid, #666);
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.1s, color 0.1s;
  }
  .remove-btn:hover:not(:disabled) {
    background: rgba(255, 53, 53, 0.08);
    color: var(--cs-red-badge, #FF3535);
  }
  .remove-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .add-row-btn {
    align-self: flex-start;
    height: 28px;
    padding: 0 10px;
    border: 1px dashed #CCCCCC;
    border-radius: var(--cms-radius-sm, 8px);
    background: transparent;
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text-mid, #666);
    cursor: pointer;
    transition: border-color 0.1s, color 0.1s;
  }
  .add-row-btn:hover {
    border-color: var(--cs-purple, #3B2F8A);
    color: var(--cs-purple, #3B2F8A);
  }
</style>
