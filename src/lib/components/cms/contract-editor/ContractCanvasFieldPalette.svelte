<script lang="ts">
  /**
   * ContractCanvasFieldPalette.svelte — canvas 모드 필드 팔레트 (Phase 6, P6-3)
   *
   * 역할:
   *   1. 4종 필드 타입 버튼 (서명 / DB연동텍스트 / 고정라벨 / 발행자 이미지)
   *   2. 선택된 필드 속성 패널 (라벨·필수여부·DB변수 바인딩·자산 선택)
   *   3. ContractFieldPanel과 동일 ContractSubstitutionData 21개 변수 카탈로그 재사용
   *
   * 설계 원칙:
   *   - v1 = 3종(signature/text/label), v2 = issuer-image 추가 (발행자 서명·직인 이미지 배치)
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
  // ContractSubstitutionData 변수 카탈로그 (ContractFieldPanel과 동일 21개 변수)
  // --------------------------------------------------------------------------
  type VarKey =
    | '고객이름' | '연락처' | '이메일' | '주소'
    | '예약코드' | '상품코드' | '상품명' | '수량'
    | '수령형태' | '수령일시' | '반납형태' | '반납일시' | '요금유형' | '구성품'
    | '기본대여요금' | '할인금액' | '할인차감' | '차감포인트' | '배송비' | '부가세' | '최종합계'

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
    { key: '수량',       label: '수량 (실제 예약 건수)',  group: '상품' },
    { key: '수령형태',   label: '수령형태',     group: '상품' },
    { key: '수령일시',   label: '수령일시',     group: '상품' },
    { key: '반납형태',   label: '반납형태',     group: '상품' },
    { key: '반납일시',   label: '반납일시',     group: '상품' },
    { key: '요금유형',   label: '요금유형',     group: '상품' },
    { key: '구성품',     label: '구성품 (50자 말줄임)', group: '상품' },
    { key: '기본대여요금', label: '기본대여요금', group: '결제' },
    { key: '할인금액',   label: '할인금액 (등급할인)', group: '결제' },
    { key: '할인차감',   label: '할인차감 (쿠폰)', group: '결제' },
    { key: '차감포인트', label: '차감포인트',   group: '결제' },
    { key: '배송비',     label: '배송비',       group: '결제' },
    { key: '부가세',     label: '부가세',       group: '결제' },
    { key: '최종합계',   label: '최종합계',     group: '결제' },
  ]

  // --------------------------------------------------------------------------
  // 필드 타입 정의
  // --------------------------------------------------------------------------
  const FIELD_TYPES: { type: CanvasFieldType; label: string; desc: string; icon: string }[] = [
    { type: 'signature',    label: '서명',         desc: '고객 전자서명',              icon: '✍' },
    { type: 'text',         label: 'DB연동 텍스트', desc: '변수값 자동 채움',          icon: 'T' },
    { type: 'label',        label: '고정 라벨',     desc: '항상 같은 텍스트',          icon: 'L' },
    { type: 'issuer-image', label: '발행자 이미지', desc: '서명·직인 이미지 배치',     icon: '🖋' },
  ]

  // --------------------------------------------------------------------------
  // 발행자 이미지 자산 목록 (issuer-image 타입 속성 패널용)
  // --------------------------------------------------------------------------
  interface SignatureAssetItem {
    id: string
    asset_type: 'signature' | 'seal'
    image_url: string
    label: string | null
    is_default: boolean
  }

  let signatureAssets   = $state<SignatureAssetItem[]>([])
  let assetsLoading     = $state(false)
  let loadingInProgress = false  // 비반응형 가드 — 중복 로드 방지

  /**
   * issuer-image 타입이 선택됐는지 파생 (타입 변경 시만 업데이트).
   * x/y/width/height 드래그 변경은 type 값이 동일하므로 effect를 재실행하지 않는다.
   */
  const isIssuerImageType = $derived(selectedField?.type === 'issuer-image')

  /** 서명·직인 자산 목록 최신 로드 */
  async function loadSignatureAssets() {
    if (loadingInProgress) return
    loadingInProgress = true
    assetsLoading = true
    try {
      const r = await fetch('/api/cms/signature-assets')
      const data: unknown = r.ok ? await r.json() : []
      signatureAssets = (data as SignatureAssetItem[]) ?? []
    } catch {
      // ignore
    } finally {
      loadingInProgress = false
      assetsLoading = false
    }
  }

  $effect(() => {
    // issuer-image 타입 필드가 선택될 때마다 최신 목록 로드
    // length === 0 가드 제거 — 등록 직후 목록 미갱신 버그 수정
    if (isIssuerImageType) {
      void loadSignatureAssets()
    }
  })

  // --------------------------------------------------------------------------
  // 속성 변경 헬퍼
  // --------------------------------------------------------------------------
  function update<K extends keyof CanvasField>(key: K, value: CanvasField[K]) {
    if (!selectedField) return
    onUpdateField({ ...selectedField, [key]: value })
  }

  /** issuer-image 전용: assetId + imageUrl 동시 업데이트 */
  function selectIssuerAsset(assetId: string, imageUrl: string) {
    if (!selectedField) return
    onUpdateField({ ...selectedField, assetId, imageUrl })
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

      <!-- 발행자 자산 선택 (issuer-image 타입만) -->
      {#if selectedField.type === 'issuer-image'}
        <div class="prop-row prop-row--full">
          <div class="asset-label-row">
            <span class="prop-label prop-label--block">자산</span>
            <button
              type="button"
              class="btn-asset-refresh"
              onclick={() => void loadSignatureAssets()}
              disabled={assetsLoading}
              title="목록 새로고침"
              aria-label="자산 목록 새로고침"
            >↻</button>
          </div>
          {#if assetsLoading}
            <span class="prop-loading">로딩 중...</span>
          {:else if signatureAssets.length === 0}
            <span class="prop-no-asset">
              등록된 자산 없음 —
              <a href="/cms/set/signature" target="_blank" class="prop-asset-link">자산 등록</a>
            </span>
          {:else}
            <div class="asset-select-list">
              {#each signatureAssets as asset (asset.id)}
                <button
                  type="button"
                  class="asset-select-btn"
                  class:selected={selectedField.assetId === asset.id}
                  onclick={() => selectIssuerAsset(asset.id, asset.image_url)}
                  title={asset.label ?? (asset.asset_type === 'signature' ? '서명' : '직인')}
                >
                  <img
                    src={asset.image_url}
                    alt={asset.label ?? '자산'}
                    class="asset-thumb"
                  />
                  <span class="asset-thumb-label">
                    {asset.label ?? (asset.asset_type === 'signature' ? '서명' : '직인')}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        {#if selectedField.assetId && selectedField.imageUrl}
          <div class="prop-row prop-row--full">
            <span class="prop-label prop-label--block">미리보기</span>
            <img
              src={selectedField.imageUrl}
              alt="선택된 자산"
              class="asset-preview"
            />
          </div>
        {/if}
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
  .type-badge.type-signature    { background: rgba(59,47,138,0.12);  color: var(--cs-purple, #3B2F8A); }
  .type-badge.type-text         { background: rgba(16,11,50,0.08);   color: var(--cs-text, #100B32); }
  .type-badge.type-label        { background: rgba(0,0,0,0.06);      color: #555; }
  .type-badge.type-issuer-image { background: rgba(0,120,80,0.10);   color: #006644; }

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

  /* issuer-image 자산 선택 영역 */
  .prop-row--full {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .prop-label--block { width: auto; min-width: auto; padding-top: 0; }
  .prop-loading { font-size: 11px; color: #888; }
  .prop-no-asset { font-size: 11px; color: #888; }
  .prop-asset-link { color: var(--cs-purple, #3B2F8A); text-decoration: underline; }

  /* 자산 레이블 + 새로고침 버튼 행 */
  .asset-label-row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
  }
  .btn-asset-refresh {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 13px;
    color: #aaa;
    cursor: pointer;
    line-height: 1;
    min-width: 20px;
    min-height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    transition: color 0.12s, background 0.12s;
  }
  .btn-asset-refresh:hover:not(:disabled) {
    color: var(--cs-purple, #3B2F8A);
    background: rgba(59, 47, 138, 0.08);
  }
  .btn-asset-refresh:disabled { opacity: 0.35; cursor: not-allowed; }

  .asset-select-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    max-height: 140px;
    overflow-y: auto;
  }
  .asset-select-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: 1.5px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-sm, 8px);
    background: #fff;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: border-color 0.12s, background 0.12s;
  }
  .asset-select-btn:hover { border-color: var(--cs-purple, #3B2F8A); }
  .asset-select-btn.selected {
    border-color: var(--cs-purple, #3B2F8A);
    background: rgba(59, 47, 138, 0.05);
  }
  .asset-thumb {
    width: 32px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
    border-radius: 2px;
  }
  .asset-thumb-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--cs-text, #100B32);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .asset-preview {
    max-width: 100%;
    max-height: 60px;
    object-fit: contain;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: 4px;
  }

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
