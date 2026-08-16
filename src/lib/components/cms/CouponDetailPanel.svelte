<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'
  import type { Coupon } from '$lib/types/database'

  interface Props {
    coupon:  Coupon
    onclose: () => void
  }
  let { coupon, onclose }: Props = $props()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cc = coupon as any

  let activeTab = $state<'info' | 'distribute'>('info')

  // ─ 핵심 정보 수정 ─
  let u_discount_type   = $state<string>(coupon.discount_type)
  let u_discount_value  = $state(coupon.discount_value)
  let u_max_discount    = $state(cc.max_discount_amount ?? 0)
  let u_usage_limit     = $state(coupon.usage_limit ?? 0)
  let u_user_grade      = $state(cc.user_grade_required ?? '')
  let u_validity_type   = $state<'fixed_period' | 'unlimited'>(cc.validity_type ?? 'fixed_period')
  let u_valid_from      = $state(coupon.valid_from ? coupon.valid_from.substring(0, 10) : '')
  let u_valid_until     = $state(coupon.valid_until ? coupon.valid_until.substring(0, 10) : '')
  let updateLoading     = $state(false)

  // coupon prop 변경 시(invalidateAll 후) 편집 필드 재동기화 — ProductDetailPanel $effect 패턴 동일
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ccEff = coupon as any
    u_discount_type  = coupon.discount_type
    u_discount_value = coupon.discount_value
    u_max_discount   = ccEff.max_discount_amount ?? 0
    u_usage_limit    = coupon.usage_limit ?? 0
    u_user_grade     = ccEff.user_grade_required ?? ''
    u_validity_type  = ccEff.validity_type ?? 'fixed_period'
    u_valid_from     = coupon.valid_from  ? coupon.valid_from.substring(0, 10)  : ''
    u_valid_until    = coupon.valid_until ? coupon.valid_until.substring(0, 10) : ''
  })

  // ─ 배포 대상 ─
  let distTargetT  = $state<'all' | 'grade' | 'specific_user'>('all')
  let distGrade    = $state('')
  let distUuids    = $state('')
  let distLoading  = $state(false)

  let distTargetMeta = $derived(
    distTargetT === 'grade'
      ? JSON.stringify({ grade: distGrade })
      : distTargetT === 'specific_user' && distUuids.trim()
        ? JSON.stringify({ user_ids: distUuids.split('\n').map((s: string) => s.trim()).filter(Boolean) })
        : null
  )

  function typeLabel(type: string): string {
    const MAP: Record<string, string> = {
      fixed: '정액', percent: '정률', free_delivery: '무료배송',
      first_rental: '첫렌탈', category: '카테고리', bundle: '번들',
      subscription: '구독전용', student: '학생전용', walk_in: '방문픽업',
      reactivation: '휴면복귀', referral: '추천인', event: '이벤트', all: '전체',
    }
    return MAP[type] ?? type
  }
</script>

<div class="panel">
  <!-- 패널 헤더 -->
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-label">쿠폰</span>
      <span class="panel-id">{coupon.code}</span>
      <span class="panel-status">{typeLabel(coupon.type)}</span>
    </div>
    <button class="close-btn" onclick={onclose} aria-label="패널 닫기">✕</button>
  </div>

  <!-- 탭 -->
  <div class="panel-tabs" role="tablist">
    {#each [
      { id: 'info',       label: '정보' },
      { id: 'distribute', label: '배포' },
    ] as tab}
      <button
        class="tab"
        class:tab-active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        onclick={() => activeTab = tab.id as typeof activeTab}
      >{tab.label}</button>
    {/each}
  </div>

  <!-- 탭 바디 -->
  <div class="panel-body">

    <!-- ─── 탭1: 정보 ─── -->
    {#if activeTab === 'info'}
      <div class="section-title">현황</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">사용/한도</span>
          <span class="info-value">{coupon.usage_count} / {coupon.usage_limit ?? '∞'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">상태</span>
          <span class="info-value">{coupon.is_active ? '활성' : '비활성'}</span>
        </div>
      </div>

      <div class="section-title">핵심 정보 수정</div>
      <form method="POST" action="?/updateCoupon"
        use:enhance={() => {
          updateLoading = true
          return async ({ result, update }) => {
            updateLoading = false
            if (result.type === 'success') csToast.success('저장되었습니다.')
            await update()
          }
        }}
      >
        <input type="hidden" name="id" value={coupon.id} />
        <div class="form-grid">
          <div class="form-field">
            <label for="uc-dtype">할인 방식</label>
            <select id="uc-dtype" name="discount_type" class="f-input" bind:value={u_discount_type}>
              <option value="fixed">정액 (원)</option>
              <option value="percent">정률 (%)</option>
              <option value="free_shipping">무료배송</option>
            </select>
          </div>
          <div class="form-field">
            <label for="uc-dval">할인값</label>
            <input id="uc-dval" name="discount_value" type="number" min="0"
              class="f-input" bind:value={u_discount_value} />
          </div>
          {#if u_discount_type === 'percent'}
            <div class="form-field">
              <label for="uc-maxd">최대 할인 한도 (원, 0=무제한)</label>
              <input id="uc-maxd" name="max_discount_amount" type="number" min="0"
                class="f-input" bind:value={u_max_discount} />
            </div>
          {/if}
          <div class="form-field">
            <label for="uc-tul">전체 발급 한도 (0=무제한)</label>
            <input id="uc-tul" name="usage_limit" type="number" min="0"
              class="f-input" bind:value={u_usage_limit} />
          </div>
          <div class="form-field">
            <label for="uc-grade">필수 회원 등급 (선택)</label>
            <select id="uc-grade" name="user_grade_required" class="f-input" bind:value={u_user_grade}>
              <option value="">전체 회원</option>
              <option value="BASIC">BASIC</option>
              <option value="PRO">PRO</option>
              <option value="CRAZY">CRAZY</option>
            </select>
          </div>
        </div>
        <div class="radio-group">
          <label class="radio-lbl">
            <input type="radio" name="validity_type" value="fixed_period" bind:group={u_validity_type} />
            제한 기간
          </label>
          <label class="radio-lbl">
            <input type="radio" name="validity_type" value="unlimited" bind:group={u_validity_type} />
            무제한
          </label>
        </div>
        {#if u_validity_type === 'fixed_period'}
          <div class="form-grid">
            <div class="form-field">
              <label for="uc-vf">시작일</label>
              <CmsDatePicker bind:value={u_valid_from} name="valid_from" placeholder="시작일 선택" disablePast={false} />
            </div>
            <div class="form-field">
              <label for="uc-vu">종료일</label>
              <CmsDatePicker bind:value={u_valid_until} name="valid_until" placeholder="종료일 선택" disablePast={false} />
            </div>
          </div>
        {/if}
        <div class="panel-actions">
          <button type="submit" class="btn-primary" disabled={updateLoading}>
            {updateLoading ? '저장 중...' : '정보 저장'}
          </button>
        </div>
      </form>

    <!-- ─── 탭2: 배포 ─── -->
    {:else if activeTab === 'distribute'}
      <div class="section-title">배포 대상</div>
      <form method="POST" action="?/distributeCoupon"
        use:enhance={() => {
          distLoading = true
          return async ({ result, update }) => {
            distLoading = false
            if (result.type === 'success') csToast.success('배포되었습니다.')
            await update()
          }
        }}
      >
        <input type="hidden" name="coupon_id" value={coupon.id} />
        <div class="radio-group">
          <label class="radio-lbl">
            <input type="radio" bind:group={distTargetT} value="all" />
            전체 회원
          </label>
          <label class="radio-lbl">
            <input type="radio" bind:group={distTargetT} value="grade" />
            특정 등급
          </label>
          <label class="radio-lbl">
            <input type="radio" bind:group={distTargetT} value="specific_user" />
            특정 사용자 UUID
          </label>
        </div>
        {#if distTargetT === 'grade'}
          <div class="form-field">
            <label for="dist-grade">등급</label>
            <select id="dist-grade" class="f-input" bind:value={distGrade}>
              <option value="BASIC">BASIC</option>
              <option value="PRO">PRO</option>
              <option value="CRAZY">CRAZY</option>
            </select>
          </div>
        {/if}
        {#if distTargetT === 'specific_user'}
          <div class="form-field">
            <label for="dist-uuids">사용자 이메일 또는 UUID (줄바꿈 구분)</label>
            <textarea id="dist-uuids" class="f-input ta" rows="4"
              placeholder="user@example.com&#10;uuid-1234-..." bind:value={distUuids}></textarea>
            <span class="hint">이메일과 UUID를 섞어서 입력할 수 있습니다.</span>
          </div>
        {/if}
        <input type="hidden" name="target_type" value={distTargetT} />
        <input type="hidden" name="target_meta" value={distTargetMeta ?? ''} />
        <div class="panel-actions">
          <button type="submit" class="btn-primary" disabled={distLoading}>
            {distLoading ? '배포 중...' : '배포 실행'}
          </button>
        </div>
      </form>
    {/if}

  </div>
</div>

<style>
  /* 패널 루트 (cms-uiux.md §목록카드+DetailPanel 필수 구조) */
  .panel {
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
  }

  /* 패널 헤더 */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .panel-title-wrap { display: flex; align-items: center; gap: 8px; }
  .panel-label { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .panel-id    { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); letter-spacing: .04em; }
  .panel-status {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); font-weight: 700;
    background: rgba(59,47,138,0.10); color: var(--cs-purple);
  }
  .close-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border: none; background: none; cursor: pointer;
    font-size: 14px; color: var(--cs-text-mid);
    border-radius: 6px; transition: background 0.12s;
  }
  .close-btn:hover { background: var(--cs-surface-gray); }

  /* 탭 */
  .panel-tabs { display: flex; border-bottom: 1px solid var(--cs-lilac); flex-shrink: 0; }
  .tab {
    flex: 1; padding: 10px 8px;
    background: none; border: none; border-bottom: 2px solid transparent;
    cursor: pointer; font: var(--text-pc-script-12); font-weight: 400;
    color: var(--cs-text-mid); transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .tab:hover  { color: var(--cs-purple); }
  .tab-active { color: var(--cs-purple); border-bottom-color: var(--cs-purple); font-weight: 700; }

  /* 패널 바디 — display: block 필수 (overflow:hidden 자식 압축 방지) */
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: block;
    padding: 16px 20px 20px;
  }
  .panel-body > * + * { margin-top: 10px; }

  .section-title {
    font: var(--text-pc-script-12); font-weight: 700;
    color: var(--cs-text-mid); padding: 4px 0 2px;
  }

  .info-section {
    display: flex; flex-direction: column;
    border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }
  .info-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; border-bottom: 1px solid var(--cs-lilac);
  }
  .info-row:last-child { border-bottom: none; }
  .info-label { flex: 0 0 96px; font: var(--text-pc-script-12); color: var(--cs-text-mid); font-weight: 700; }
  .info-value { flex: 1; font: var(--text-pc-body-14); color: var(--cs-text); }

  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-field { display: flex; flex-direction: column; gap: 6px; }
  .form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .hint { font: var(--text-pc-script-12); color: var(--cs-text-light); }

  .radio-group { display: flex; gap: 16px; flex-wrap: wrap; }
  .radio-lbl {
    display: flex; align-items: center; gap: 6px;
    font: var(--text-pc-body-14); color: var(--cs-text);
    cursor: pointer; min-height: 28px;
  }

  .f-input {
    background: var(--cs-surface-gray); border: none;
    border-radius: var(--cms-radius-sm); padding: 10px 16px;
    font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
  }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-input.ta { resize: vertical; height: auto; }

  .panel-actions { display: flex; justify-content: flex-end; }

  .btn-primary {
    background: var(--cs-purple); color: var(--cs-white); border: none;
    border-radius: var(--radius-sm); padding: 8px 16px;
    font: var(--text-pc-body-14); height: 36px; cursor: pointer;
    transition: background 0.15s; white-space: nowrap;
  }
  .btn-primary:hover    { background: var(--cs-purple-hover); }
  .btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
</style>
