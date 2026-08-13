<script lang="ts">
  /**
   * ContractCanvasFieldPalette.svelte — canvas 모드 필드 팔레트 (Phase 6, P6-3)
   *
   * 역할:
   *   1. 3종 필드 타입 버튼 (서명 / DB연동텍스트 / 고정라벨)
   *   2. 선택된 필드 속성 패널 (라벨·필수여부·DB변수 바인딩)
   *   3. ContractFieldPanel과 동일 ContractSubstitutionData 16개 변수 카탈로그 재사용
   *
   * 설계 원칙:
   *   - 4종 이상 필드타입으로 과설계 금지 (v1 = 3종)
   *   - ContractSubstitutionData 변수 목록은 이 컴포넌트 단독 소유 (flow 패널과 중복 없음)
   */

  import type { CanvasField, CanvasFieldType } from '$lib/types/contract-document'

  // --------------------------------------------------------------------------
  // Props
  // --------------------------------------------------------------------------
  interface Props {
    /** 현재 배치 중인 필드 타입 (null = 배치 모드 아님) */
    placingType: CanvasFieldType | null
    /** 현재 선택된 필드 (null = 없음) */
    selectedField: CanvasField | null
    /** 필드 타입 클릭 콜백 (배치 모드 진입 / 취소 토글) */
    onSelectType: (type: CanvasFieldType | null) => void
    /** 선택된 필드 속성 변경 콜백 */
    onUpdateField: (updated: CanvasField) => void
    /** 선택된 필드 삭제 콜백 */
    onDeleteField: (id: string) => void
  }

  let {
    placingType,
    selectedField,
    onSelectType,
    onUpdateField,
    onDeleteField,
  }: Props = $props()

  // --------------------------------------------------------------------------
  // ContractSubstitutionData 변수 카탈로그 (ContractFieldPanel과 동일 16개 변수)
  // --------------------------------------------------------------------------
  type VarKey =
    | '고객이름' | '연락처' | '이메일' | '주소'
    | '예약코드' | '상품코드' | '상품명' | '수량'
    | '수령형태' | '수령일시' | '반납형태' | '반납일시'
    | '기본대여요금' | '할인금액' | '부가세' | '최종합계'

  interface VarOption {
    key: VarKey
    label: string
    group: string
  }

  const VARIABLE_OPTIONS: VarOption[] = [
    { key: '고객이름',   label: '고객이름',     group: '계약자' },
    { key: '연락처',     label: '연락처',       group: '계약자' },
    { key: '이메일',     label: '이메일',       group: '계약자' },
    { key: '주소',       label: '주소',         group: '계약자' },
    { key: '예약코드',   label: '예약코드',     group: '상품' },
    { key: '상품코드',   label: '상품코드',     group: '상품' },
    { key: '상품명',     label: '상품명',       group: '상품' },
    { key: '수량',       label: '수량 (항상 1)',  group: '상품' },
    { key: '수령형태',   label: '수령형태',     group: '상품' },
    { key: '수령일시',   label: '수령일시',     group: '상품' },
    { key: '반납형태',   label: '반납형태',     group: '상품' },
    { key: '반납일시',   label: '반납일시',     group: '상품' },
    { key: '기본대여요금', label: '기본대여요금', group: '결제' },
    { key: '할인금액',   label: '할인금액',     group: '결제' },
    { key: '부가세',     label: '부가세',       group: '결제' },
    { key: '최종합계',   label: '최종합계',     group: '결제' },
  ]

  // --------------------------------------------------------------------------
  // 필드 타입 정의
  // --------------------------------------------------------------------------
  const FIELD_TYPES: { type: CanvasFieldType; label: string; desc: string; icon: string }[] = [
    { type: 'signature', label: '서명',       desc: '고객 전자서명',            icon: '✍' },
    { type: 'text',      label: 'DB연동 텍스트', desc: '변수값 자동 채움',      icon: 'T' },
    { type: 'label',     label: '고정 라벨',   desc: '항상 같은 텍스트',        icon: 'L' },
  ]

  // --------------------------------------------------------------------------
  // 속성 변경 헬퍼
  // --------------------------------------------------------------------------
  function update<K extends keyof CanvasField>(key: K, value: CanvasField[K]) {
    if (!selectedField) return
    onUpdateField({ ...selectedField, [key]: value })
  }

  function toggleRequired() {
    if (!selectedField) return
    update('required', !selectedField.required)
  }

  function handleBoundVarChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value as VarKey | ''
    if (!selectedField) return
    if (val === '') {
      const { boundVariable: _, ...rest } = selectedField
      onUpdateField(rest as CanvasField)
    } else {
      update('boundVariable', val as VarKey)
    }
  }
</script>

<div class="palette">
  <!-- 배치 모드 헤더 -->
  {#if placingType}
    <div class="placing-banner" role="status">
      <span class="placing-icon">
        {FIELD_TYPES.find((t) => t.type === placingType)?.icon ?? ''}
      </span>
      <span class="placing-label">
        배치 중 — 페이지를 클릭하세요
      </span>
      <button class="btn-cancel-place" onclick={() => onSelectType(null)} aria-label="배치 취소">
        ✕
      </button>
    </div>
  {/if}

  <!-- 필드 타입 버튼 -->
  <section class="section">
    <h3 class="section-title">필드 추가</h3>
    <div class="type-buttons">
      {#each FIELD_TYPES as ft (ft.type)}
        <button
          class="type-btn"
          class:active={placingType === ft.type}
          onclick={() => onSelectType(placingType === ft.type ? null : ft.type)}
          title={ft.desc}
        >
          <span class="type-icon">{ft.icon}</span>
          <span class="type-label">{ft.label}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- 선택된 필드 속성 패널 -->
  {#if selectedField}
    <section class="section props-section">
      <div class="props-header">
        <h3 class="section-title">속성</h3>
        <button
          class="btn-delete"
          onclick={() => onDeleteField(selectedField!.id)}
          aria-label="필드 삭제"
        >
          삭제
        </button>
      </div>

      <!-- 타입 표시 -->
      <div class="prop-row">
        <span class="prop-label">타입</span>
        <span class="prop-value type-badge type-{selectedField.type}">
          {FIELD_TYPES.find((t) => t.type === selectedField!.type)?.label ?? selectedField.type}
        </span>
      </div>

      <!-- 라벨 -->
      <div class="prop-row">
        <label class="prop-label" for="field-label">라벨</label>
        <input
          id="field-label"
          class="prop-input"
          type="text"
          value={selectedField.label}
          oninput={(e) => update('label', (e.target as HTMLInputElement).value)}
          placeholder="표시 이름"
        />
      </div>

      <!-- 필수 여부 (signature / text 타입만) -->
      {#if selectedField.type !== 'label'}
        <div class="prop-row">
          <span class="prop-label">필수</span>
          <label class="toggle-label">
            <input
              type="checkbox"
              checked={selectedField.required}
              onchange={toggleRequired}
            />
            <span>{selectedField.required ? '필수' : '선택'}</span>
          </label>
        </div>
      {/if}

      <!-- DB 변수 바인딩 (text 타입만) -->
      {#if selectedField.type === 'text'}
        <div class="prop-row">
          <label class="prop-label" for="field-var">변수</label>
          <select
            id="field-var"
            class="prop-select"
            value={selectedField.boundVariable ?? ''}
            onchange={handleBoundVarChange}
          >
            <option value="">— 없음 —</option>
            {#each ['계약자', '상품', '결제'] as group (group)}
              <optgroup label={group}>
                {#each VARIABLE_OPTIONS.filter((v) => v.group === group) as opt (opt.key)}
                  <option value={opt.key}>{opt.label}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </div>
      {/if}

      <!-- 좌표·크기 (px) -->
      <div class="prop-row">
        <span class="prop-label">위치</span>
        <div class="coord-grid">
          <label class="coord-item">
            <span class="coord-l">X</span>
            <input
              class="coord-input"
              type="number"
              min="0"
              value={selectedField.x}
              oninput={(e) => update('x', Number((e.target as HTMLInputElement).value))}
            />
          </label>
          <label class="coord-item">
            <span class="coord-l">Y</span>
            <input
              class="coord-input"
              type="number"
              min="0"
              value={selectedField.y}
              oninput={(e) => update('y', Number((e.target as HTMLInputElement).value))}
            />
          </label>
          <label class="coord-item">
            <span class="coord-l">W</span>
            <input
              class="coord-input"
              type="number"
              min="10"
              value={selectedField.width}
              oninput={(e) => update('width', Number((e.target as HTMLInputElement).value))}
            />
          </label>
          <label class="coord-item">
            <span class="coord-l">H</span>
            <input
              class="coord-input"
              type="number"
              min="10"
              value={selectedField.height}
              oninput={(e) => update('height', Number((e.target as HTMLInputElement).value))}
            />
          </label>
        </div>
      </div>
    </section>
  {:else}
    <div class="no-selection">
      <span class="no-sel-icon">←</span>
      <p>캔버스에서 필드를 클릭하면<br />속성이 여기에 표시됩니다.</p>
    </div>
  {/if}
</div>

<style>
  .palette {
    width: 220px;
    min-width: 220px;
    background: var(--cs-surface-gray, #f6f6f6);
    border-right: 1px solid var(--cs-lilac, #ECEBF4);
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
  }

  /* 배치 중 배너 */
  .placing-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--cs-purple, #3B2F8A);
    color: #fff;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
  }
  .placing-icon { font-size: 16px; }
  .placing-label { flex: 1; }
  .btn-cancel-place {
    background: none;
    border: none;
    color: rgba(255,255,255,0.8);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    min-width: 24px;
    min-height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .btn-cancel-place:hover { color: #fff; }

  /* 섹션 */
  .section {
    padding: 12px;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
  }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 8px;
  }

  /* 필드 타입 버튼 */
  .type-buttons {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .type-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1.5px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-sm, 8px);
    background: #fff;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
    width: 100%;
  }
  .type-btn:hover {
    border-color: var(--cs-purple, #3B2F8A);
    background: rgba(59, 47, 138, 0.04);
  }
  .type-btn.active {
    border-color: var(--cs-purple, #3B2F8A);
    background: rgba(59, 47, 138, 0.08);
  }
  .type-icon {
    width: 24px;
    height: 24px;
    background: var(--cs-lilac, #ECEBF4);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .type-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--cs-text, #100B32);
  }

  /* 속성 패널 */
  .props-section { gap: 0; }
  .props-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .btn-delete {
    font-size: 11px;
    color: var(--cs-error, #e53935);
    background: none;
    border: 1px solid var(--cs-error, #e53935);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    min-height: 24px;
  }
  .btn-delete:hover { background: rgba(229, 57, 53, 0.08); }

  .prop-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 8px;
  }
  .prop-label {
    font-size: 11px;
    font-weight: 600;
    color: #666;
    width: 44px;
    min-width: 44px;
    padding-top: 5px;
  }
  .prop-value {
    font-size: 12px;
    color: var(--cs-text, #100B32);
  }
  .type-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 99px;
    background: var(--cs-lilac, #ECEBF4);
  }
  .type-badge.type-signature { background: rgba(59,47,138,0.12); color: var(--cs-purple, #3B2F8A); }
  .type-badge.type-text      { background: rgba(16,11,50,0.08);  color: var(--cs-text, #100B32); }
  .type-badge.type-label     { background: rgba(0,0,0,0.06);     color: #555; }

  .prop-input,
  .prop-select {
    flex: 1;
    font-size: 12px;
    border: 1px solid #ddd;
    border-radius: var(--radius-sm, 8px);
    padding: 4px 8px;
    height: 30px;
    background: #fff;
    color: var(--cs-text, #100B32);
    outline: none;
  }
  .prop-input:focus,
  .prop-select:focus { border-color: var(--cs-purple, #3B2F8A); }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    color: var(--cs-text, #100B32);
  }
  .toggle-label input { accent-color: var(--cs-purple, #3B2F8A); }

  /* 좌표 그리드 */
  .coord-grid {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .coord-item {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .coord-l {
    font-size: 10px;
    font-weight: 700;
    color: #888;
    width: 12px;
  }
  .coord-input {
    flex: 1;
    font-size: 11px;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 3px 4px;
    height: 26px;
    width: 100%;
    background: #fff;
    outline: none;
    -moz-appearance: textfield;
  }
  .coord-input::-webkit-inner-spin-button,
  .coord-input::-webkit-outer-spin-button { display: none; }
  .coord-input:focus { border-color: var(--cs-purple, #3B2F8A); }

  /* 선택 없음 */
  .no-selection {
    padding: 24px 12px;
    text-align: center;
    color: #bbb;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .no-sel-icon { font-size: 24px; }
  .no-selection p { font-size: 12px; line-height: 1.5; margin: 0; }
</style>
