<script lang="ts">
  /**
   * ContractFieldPanel.svelte — DB 필드 매핑 패널 (ContractModuleBar 대체)
   *
   * - 카테고리별(계약자정보/상품정보/결제정보/특약) 변수 칩을 현재 커서 위치에 삽입
   * - 기존 ContractModuleBar의 "문서 끝 고정 표 통째로 추가" 방식 완전 대체
   * - "특약" 탭이 specifications key-value 관리 UI를 직접 담당 (P3-2)
   * - 수량(수량): ⛔ 2026-09-03 정정 — 과거엔 항상 '1' 하드코딩(P3-3, 폐기)이었으나
   *   Stephen 지적으로 실제 예약 수량(같은 상품을 여러 건 예약했으면 그 건수) 반영으로
   *   변경. contractLineItems.ts buildLineItems()의 그룹화 원칙과 동일(2026-08-28 정정)
   *   — 반복영역 상품목록과 스칼라 {{수량}} 둘 다 이제 일관되게 실제 건수를 반영한다.
   * - 탭·칩 버튼 onmousedown preventDefault+stopPropagation (2026-09-03, Stephen 제보
   *   "셀 선택 상태에서 변수탭 메뉴 선택 시 선택한 셀이 해제되어 사용 상 불편"): 원인은
   *   포커스/blur가 아니라 jspreadsheet-ce 자체의 전역 이벤트 위임 구조에 있다 —
   *   jspreadsheet는 자체 root 옵션을 지정하지 않으면 mousedown 등 모든 마우스 리스너를
   *   `document`에 직접 건다(`setEvents(t.root ? t.root : document)`,
   *   node_modules/jspreadsheet-ce/dist/index.js 확인). 그 `mouseDownControls` 핸들러는
   *   클릭 target이 자신의 워크시트 셀(`getElement(e.target)`로 판별)이 아니면 무조건
   *   `resetSelection()`을 호출해 현재 선택을 지운다 — 그리드 바깥의 어떤 요소를 클릭해도
   *   (이 패널의 탭·칩 버튼 포함) document까지 mousedown이 버블링되는 순간 선택이 풀린다.
   *   ContractSpreadsheetEditor.svelte의 resolveActiveCell()이 이런 상황을 대비한 좌표
   *   캐시(lastSelectedWs/lastSelectedCoords) 폴백을 이미 갖고 있어 변수 삽입 "기능"
   *   자체는 이전에도 정상 동작했지만, 화면상 하이라이트가 사라져 사용자가 지금 어느
   *   셀에 삽입될지 눈으로 확인할 수 없는 UX 문제가 남아 있었다. 이 세션에서 같은 파일
   *   ContractSpreadsheetEditor.svelte에 이미 적용된 dblclick 방지 수정(wrap의 dblclick을
   *   wrap 단계에서 stopPropagation)과 정확히 동일한 원리 — mousedown을 버튼 단계에서
   *   stopPropagation해 document의 mouseDownControls에 도달하지 못하게 막는다.
   *   preventDefault()는 버튼으로의 기본 포커스 이동을 함께 막아주는 보조 조치(필수는
   *   아니지만 그리드 외부로 포커스가 튀는 것도 함께 방지).
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
  // 변수 카탈로그 (ContractSubstitutionData 21개 스칼라 변수 중 UI 노출분)
  // NOTE: 수량은 실제 예약 건수 반영(2026-09-03 정정 — 과거 '항상 1' 하드코딩은 폐기)
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
      { variable: '수량',     label: '수량 (실제 예약 건수)' },
      { variable: '수령형태', label: '수령형태' },
      { variable: '수령일시', label: '수령일시' },
      { variable: '반납형태', label: '반납형태' },
      { variable: '반납일시', label: '반납일시' },
      { variable: '요금유형', label: '요금유형' },
      { variable: '구성품',   label: '구성품 (50자 말줄임)' },
    ],
    결제정보: [
      { variable: '기본대여요금', label: '기본대여요금' },
      { variable: '할인금액',    label: '할인금액 (등급할인)' },
      { variable: '할인차감',    label: '할인차감 (쿠폰)' },
      { variable: '차감포인트',  label: '차감포인트' },
      { variable: '배송비',      label: '배송비' },
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
        onmousedown={(e) => { e.preventDefault(); e.stopPropagation() }}
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
            onmousedown={(e) => { e.preventDefault(); e.stopPropagation() }}
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
