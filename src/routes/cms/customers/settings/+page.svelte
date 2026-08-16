<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import { sortByTier } from '$lib/utils/comboCategoryCode'
  import { csToast } from '$lib/utils/toast'
  import { datePart } from '../../codes/_shared'
  import type { PageData, ActionData } from './$types'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import type { MappingGroupSimple, MappingItemSimple, TaxonomyCodeSimple, SequenceStateRow } from './+page.server'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  // ─── 분류(조합그룹) + 코드 조합(콤보) 선택 — subscriptions/new와 동일 패턴 재사용 ───
  let selectedGroupId = $state<string | null>(null)
  let selectedComboRowId = $state<string | null>(null)
  let selectedGroupName = $state('')
  let lastConfirmedGroupId = $state<string | null>(null)
  let isSaving = $state(false)
  // 사용자가 직접 조합을 고르기 전까지는 아래 $effect가 "이미 적용 중인 기준코드"를 자동으로
  // 선택 상태로 채워 목록·미리보기가 곧바로 보이게 한다 — 한번 손대면 더 이상 덮어쓰지 않음
  // (core-rules.md ⛔ $state(prop) 초기화 금지 — prop 변경을 실시간 반영해야 하는 케이스라
  // $effect로 동기화하는 올바른 패턴 2를 사용).
  let userTouchedSelection = $state(false)

  const groupPickerOptions = $derived<SuggestPickerOption[]>(
    (data.mappingGroups as MappingGroupSimple[]).map((mg) => ({ id: mg.id, label: mg.name }))
  )

  $effect(() => {
    if (userTouchedSelection) return
    const setting = data.currentSetting as { prefix: string; group_name: string; combo_row_id: string } | null
    if (!setting) return
    const matchedItem = (data.mappingItems as MappingItemSimple[]).find(
      (i) => i.combo_row_id === setting.combo_row_id
    )
    if (!matchedItem) return
    selectedGroupId = matchedItem.group_id
    lastConfirmedGroupId = matchedItem.group_id
    selectedGroupName =
      (data.mappingGroups as MappingGroupSimple[]).find((g) => g.id === matchedItem.group_id)?.name ??
      setting.group_name
    selectedComboRowId = setting.combo_row_id
  })

  function onGroupChange(): void {
    selectedComboRowId = null
  }

  function onGroupPickerSelect(opt: SuggestPickerOption, _previousId: string | null): void {
    userTouchedSelection = true
    if (opt.id !== lastConfirmedGroupId) onGroupChange()
    selectedGroupId = opt.id
    lastConfirmedGroupId = opt.id
    selectedGroupName = opt.label
  }

  function onGroupPickerInput(val: string): void {
    if (!val.trim() && selectedGroupId) {
      userTouchedSelection = true
      selectedGroupId = null
      lastConfirmedGroupId = null
      onGroupChange()
    }
  }

  interface ComboRow { combo_row_id: string; combo_name: string | null; codes: TaxonomyCodeSimple[] }

  const combosForGroup = $derived<ComboRow[]>(
    selectedGroupId
      ? (() => {
          const items = (data.mappingItems as MappingItemSimple[]).filter((i) => i.group_id === selectedGroupId)
          const rowIds = [...new Set(items.map((i) => i.combo_row_id))]
          return rowIds.map((rid) => {
            const rowItems = items.filter((i) => i.combo_row_id === rid)
            const codes = sortByTier(
              rowItems
                .map((i) => (data.taxonomyCodes as TaxonomyCodeSimple[]).find((tc) => tc.id === i.taxonomy_code_id))
                .filter((tc): tc is TaxonomyCodeSimple => tc !== undefined)
            )
            return { combo_row_id: rid, combo_name: rowItems[0]?.combo_name ?? null, codes }
          })
        })()
      : []
  )

  function selectCombo(combo: ComboRow): void {
    userTouchedSelection = true
    selectedComboRowId = combo.combo_row_id
  }

  // 상품등록(/cms/products/new) '코드 조합 선택' 목록과 동일한 미리보기 구성 — CS(고정 접두어)
  // · 분류코드 칩 · 가입일 기준 년월 · 순번. 회원코드는 상품코드와 달리 부모/자식 2단 채번
  // 개념이 없어(products.md §2-1 참고, 회원은 실물 재고단위가 아님) 상품 미리보기의
  // "부모~99·자식~999" 형태를 그대로 가져오지 않고 이 도메인에 맞게 단순화함.
  // ⚠️ 순번은 "3자리 고정"이 아니다 — generate_member_code는 3자리 미만이면 0으로 채우고,
  // 1000 이상으로 누적되면 절단 없이 자릿수가 자연 확장된다(migration 277, LPAD 절단버그 수정
  // — 2026-08-17 Stephen이 "일괄 재발급" 실행 중 실제로 재현·보고). 그래서 이 미리보기·목록
  // 칩은 하드코딩된 "001~999" 대신 sequenceState(member_code_sequences 전체)에서 해당
  // 접두어·이번달의 실제 next_seq를 찾아 그대로 보여준다 — 실제 채번 상태와 항상 일치해야 함.
  function comboCatCodeStr(codes: TaxonomyCodeSimple[]): string {
    return codes.map((c) => c.code).filter(Boolean).join('').toUpperCase()
  }

  const currentYYMM = datePart('YYMM')

  // member_code_sequences.next_seq는 "다음에 발급될 순번"을 그대로 담고 있다(generate_member_code
  // 의 INSERT ON CONFLICT DO UPDATE ... RETURNING next_seq - 1과 반대 방향 — 여기서는 소비 전
  // 값을 그대로 읽기만 하므로 보정 불필요). 해당 접두어·이번달 행이 아직 없으면(한 번도 채번된
  // 적 없는 조합) 1부터 시작한다.
  function nextSeqFor(prefix: string): number {
    const row = (data.sequenceState as SequenceStateRow[]).find(
      (r) => r.member_type === prefix && r.year_month === currentYYMM
    )
    return row?.next_seq ?? 1
  }

  // JS padStart는 SQL LPAD와 달리 대상보다 긴 문자열을 자르지 않는다(절단 위험 없음) —
  // 3자리 미만이면 0으로 채우고, 그 이상이면 원래 자릿수 그대로 노출.
  function formatSeq(n: number): string {
    return String(n).padStart(3, '0')
  }

  const previewPrefix = $derived(
    selectedComboRowId
      ? comboCatCodeStr(combosForGroup.find((c) => c.combo_row_id === selectedComboRowId)?.codes ?? [])
      : null
  )
  const previewCode = $derived(
    previewPrefix ? `CS${previewPrefix}${currentYYMM}${formatSeq(nextSeqFor(previewPrefix))}` : null
  )

  // NOW-8 자동선택(마운트 시 currentSetting 반영) 도입 후 "선택됨 = 저장 가능"으로만 판단하면
  // 이미 적용 중인 조합을 그대로 보고 있을 뿐인데도 저장 버튼이 활성화되는 오탐이 생긴다
  // (products.md §4 isDirty 관례와 동일 원칙 — 실제로 바뀐 게 있을 때만 저장 가능해야 함).
  // 현재 선택이 저장된 combo_row_id와 다를 때만 활성화.
  const isDirtyCombo = $derived(
    selectedComboRowId !== null &&
      selectedComboRowId !== (data.currentSetting as { combo_row_id: string } | null)?.combo_row_id
  )

  // ─── 기존 고객 일괄 재발급 ───
  let confirmReissue = $state(false)
  let isReissuing = $state(false)

  $effect(() => {
    if (!form) return
    if (form.action === 'saveMemberCodeCombo' && form.success === true) {
      csToast.success('기준 코드가 저장됐습니다.')
      invalidateAll()
    } else if (form.action === 'bulkReissue' && form.success === true) {
      csToast.success(`기존 고객 ${form.reissuedCount ?? 0}명의 회원코드가 재발급됐습니다.`)
      confirmReissue = false
      invalidateAll()
    } else if ('error' in form && form.error) {
      csToast.error(form.error)
    }
  })
</script>

<svelte:head>
  <title>고객 설정 — CMS</title>
</svelte:head>

<div class="form-wrap">
  <h1 class="page-title">고객 설정</h1>

  <form
    class="sub-form"
    method="POST"
    action="?/saveMemberCodeCombo"
    use:enhance={() => {
      isSaving = true
      return async ({ result, update }) => {
        isSaving = false
        await update()
        if (result.type !== 'success') return
      }
    }}
  >
    <section class="form-section">
      <h2 class="section-title">① 회원코드 기준 설정</h2>
      <p class="section-desc">
        /cms/codes 코드조합에서 '회원' 카테고리로 등록한 조합을 신규 가입자의 회원코드 접두어
        기준으로 지정합니다. 저장 즉시 신규 가입자에게만 적용되며, 기존 고객은 아래 ②에서
        별도로 재발급해야 반영됩니다.
      </p>

      <div class="field-row">
        <label class="field-label" for="combo-picker">코드 조합 <span class="required">*</span></label>
        <SuggestPicker
          id="combo-picker"
          bind:selectedId={selectedGroupId}
          options={groupPickerOptions}
          placeholder="'회원' 카테고리 코드조합 검색 또는 선택..."
          listLabel="코드조합 제안"
          variant="generic"
          oninput={onGroupPickerInput}
          onselect={onGroupPickerSelect}
        >
          {#snippet field(c)}
            <input
              type="text"
              class="f-input"
              id={c.id}
              placeholder={c.placeholder}
              required={c.required}
              value={c.value}
              oninput={c.oninput}
              onkeydown={c.onkeydown}
              onfocus={c.onfocus}
              onblur={c.onblur}
              aria-autocomplete={c.ariaAutocomplete}
              aria-expanded={c.ariaExpanded}
              aria-controls={c.ariaControls}
              autocomplete="off"
            />
          {/snippet}
        </SuggestPicker>
        <input type="hidden" name="group_name" value={selectedGroupName} />
        {#if selectedComboRowId}<input type="hidden" name="combo_row_id" value={selectedComboRowId} />{/if}
        {#if groupPickerOptions.length === 0}
          <p class="field-guide">
            '회원' 카테고리로 태그된 코드조합이 없습니다. /cms/codes → 코드조합 탭에서 새 조합을
            만들고 분류를 'member'로 지정한 뒤 다시 시도하세요.
          </p>
        {/if}
      </div>

      {#if selectedGroupId}
        <div class="field-row field-row-combo">
          <div class="field-label">코드 조합 선택</div>
          {#if combosForGroup.length > 0}
            <div class="combo-rows">
              {#each combosForGroup as combo (combo.combo_row_id)}
                <button
                  type="button"
                  class="combo-row-btn"
                  class:combo-row-selected={selectedComboRowId === combo.combo_row_id}
                  onclick={() => selectCombo(combo)}
                >
                  {#if combo.combo_name}
                    <span class="combo-name-label">{combo.combo_name}</span>
                  {/if}
                  <span class="combo-row-chips">
                    <span class="combo-prefix-chip">CS</span>
                    <span class="combo-sep">·</span>
                    <span class="combo-chips">
                      {#each combo.codes as tc, i (tc.id)}
                        {#if i > 0}<span class="combo-sep">·</span>{/if}
                        <span class="combo-chip">{tc.code}</span>
                      {/each}
                    </span>
                    <span class="combo-sep">·</span>
                    <span class="combo-meta-chip combo-ym-chip" title="가입일 기준 년월">
                      {currentYYMM}
                    </span>
                    <span class="combo-sep">·</span>
                    <span class="combo-meta-chip combo-seq-chip" title="다음 발급 순번(자동 증가, 상한 없음)">
                      {formatSeq(nextSeqFor(comboCatCodeStr(combo.codes)))}~
                    </span>
                  </span>
                </button>
              {/each}
            </div>
          {:else}
            <p class="combo-empty">이 그룹에 등록된 조합이 없습니다.</p>
          {/if}
        </div>
      {/if}

      {#if previewCode}
        <div class="preview-box">
          <span class="preview-label">채번 예시</span>
          <code class="preview-code">{previewCode}</code>
        </div>
      {/if}

      <div class="info-panel">
        {#if data.currentSetting}
          현재 적용 중: <strong>{data.currentSetting.group_name}</strong> (접두어 <code>{data.currentSetting.prefix}</code>)
        {:else}
          미설정 — 기존 <code>CS+BC/BB</code> 자동 방식이 그대로 사용되고 있습니다.
        {/if}
      </div>

      <button class="btn-submit" type="submit" disabled={isSaving || !isDirtyCombo}>
        {isSaving ? '저장 중...' : '기준 코드로 저장'}
      </button>
    </section>
  </form>

  {#if data.currentSetting}
    <form
      method="POST"
      action="?/bulkReissue"
      use:enhance={() => {
        isReissuing = true
        return async ({ update }) => {
          isReissuing = false
          await update()
        }
      }}
    >
      <section class="form-section section-danger">
        <h2 class="section-title">② 기존 고객 일괄 재발급</h2>
        <p class="section-desc">
          현재 활성 고객 <strong>{data.activeCustomerCount}명</strong>의 회원코드가 전부 새 기준
          (<code>{data.currentSetting.prefix}</code>)으로 교체됩니다. <strong>되돌릴 수 없습니다.</strong>
          변경 이력은 별도로 기록되어 이전 코드를 조회할 수 있습니다.
        </p>

        <input type="hidden" name="confirmed" value={confirmReissue ? 'true' : 'false'} />

        <label class="confirm-row">
          <input type="checkbox" bind:checked={confirmReissue} />
          <span>위 내용을 확인했으며, 기존 고객 전원의 회원코드 일괄 재발급을 진행합니다.</span>
        </label>

        <button class="btn-submit btn-submit-danger" type="submit" disabled={isReissuing || !confirmReissue}>
          {isReissuing ? '재발급 중...' : '일괄 재발급 실행'}
        </button>
      </section>
    </form>
  {/if}
</div>

<style>
  .form-wrap { padding: 24px 32px 80px; display: flex; flex-direction: column; gap: 20px; }
  .page-title { font: var(--text-pc-htitle-25); color: var(--cs-text); margin: 0; }
  .sub-form { display: flex; flex-direction: column; gap: 16px; }
  .form-section {
    background: var(--cs-white); border-radius: var(--radius-lg); padding: 28px 32px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .section-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0; }
  .section-desc { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: -8px 0 0; }
  .section-danger { border: 1.5px solid rgba(255,53,53,0.3); }

  .field-row { display: flex; flex-direction: column; gap: 6px; }
  .field-label { font: var(--text-pc-body-14); color: var(--cs-text-dark); }
  .field-guide { font: var(--text-pc-descript-10); color: var(--cs-text-light); margin: 0; }
  .required { color: var(--cs-red-badge); }

  .f-input {
    background: var(--cs-surface-gray); border: none; border-radius: var(--radius-sm);
    padding: 12px 16px; font: var(--text-pc-body-14); color: var(--cs-text);
    width: 100%; box-sizing: border-box;
  }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .field-row-combo { gap: 10px; }

  /* 상품등록(/cms/products/new) '코드 조합 선택' 목록과 동일한 칩 구성 — 신규 CSS 패턴
     발명 금지 원칙에 따라 해당 화면의 클래스명·색상·배치를 그대로 재사용 */
  .combo-rows { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  .combo-row-btn {
    display: inline-flex; flex-direction: column; align-items: flex-start; gap: 4px;
    padding: 8px 14px; border: 1.5px solid #ECEBF4; border-radius: var(--radius-sm);
    background: var(--cs-white); cursor: pointer; min-height: 44px;
    transition: border-color 0.12s, background 0.12s;
  }
  .combo-row-btn:hover { border-color: rgba(59,47,138,0.35); background: rgba(59,47,138,0.04); }
  .combo-row-selected { border-color: var(--cs-purple) !important; background: rgba(59,47,138,0.06) !important; }

  .combo-name-label {
    font: var(--text-pc-descript-10); color: var(--cs-text-light); line-height: 1.2;
    align-self: flex-start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .combo-row-chips { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; }

  .combo-prefix-chip {
    padding: 2px 7px; background: var(--cs-dark); color: var(--cs-white); border-radius: 4px;
    font: var(--text-pc-body-14); font-weight: 700; letter-spacing: 0.04em; font-family: 'Courier New', monospace;
  }
  .combo-row-selected .combo-prefix-chip { background: var(--cs-purple-dark); }
  .combo-chips { display: flex; align-items: center; gap: 4px; }
  .combo-chip {
    padding: 2px 7px; background: var(--cs-lilac); color: var(--cs-purple-dark); border-radius: 4px;
    font: var(--text-pc-body-14); font-weight: 700; letter-spacing: 0.01em;
  }
  .combo-row-selected .combo-chip { background: var(--cs-purple); color: var(--cs-white); }
  .combo-sep { color: var(--cs-text-light); font-size: 11px; }
  .combo-meta-chip {
    padding: 2px 7px; border-radius: 4px; font: var(--text-pc-script-12); font-weight: 600;
    font-family: 'Courier New', monospace; letter-spacing: 0.02em;
  }
  .combo-ym-chip { color: var(--cs-text-dark); background: var(--cs-surface-gray); }
  .combo-seq-chip { color: var(--cs-purple-dark); background: rgba(59, 47, 138, 0.08); }
  .combo-row-selected .combo-ym-chip { color: var(--cs-purple-dark); background: rgba(59, 47, 138, 0.12); }
  .combo-row-selected .combo-seq-chip { color: var(--cs-white); background: var(--cs-purple); }
  .combo-empty { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 4px 0 0; }

  .preview-box {
    display: flex; align-items: center; gap: 10px; padding: 12px 16px;
    background: rgba(59,47,138,0.06); border-radius: var(--radius-sm);
  }
  .preview-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .preview-code { font: var(--text-pc-title-18); font-weight: 700; color: var(--cs-purple); }

  .info-panel {
    background: #F3F4F6; border-radius: var(--radius-sm);
    padding: 12px 14px; font: var(--text-pc-script-12); color: var(--cs-text-mid); line-height: 160%;
  }
  .info-panel code { font-weight: 700; color: var(--cs-text); }

  .confirm-row {
    display: flex; align-items: flex-start; gap: 8px; cursor: pointer;
    font: var(--text-pc-script-12); color: var(--cs-text);
  }
  .confirm-row input[type="checkbox"] { margin-top: 2px; min-width: 18px; min-height: 18px; }

  .btn-submit {
    padding: 16px; border: none; border-radius: var(--radius-md); background: var(--cs-purple); color: var(--cs-white);
    font: var(--text-pc-title-16); font-weight: 700; cursor: pointer; transition: opacity 0.12s;
  }
  .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-submit:not(:disabled):hover { opacity: 0.85; }
  .btn-submit-danger { background: var(--cs-red-badge); }
</style>
