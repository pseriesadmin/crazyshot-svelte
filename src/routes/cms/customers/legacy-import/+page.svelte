<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { PhoneGroup, ImportResult } from './+page.server'

  interface Props {
    data: PageData
    form: ActionData
  }
  let { data, form }: Props = $props()

  // ─── 상태 ────────────────────────────────────────────────────
  let view        = $state<'import' | 'pending'>('import')
  let csvText     = $state('')
  let groups      = $state<PhoneGroup[]>([])
  let results     = $state<ImportResult[] | null>(null)
  let summary     = $state<{ successCount: number; skippedCount: number; errorCount: number } | null>(null)
  let step        = $state<'input' | 'preview' | 'done'>('input')
  let isLoading   = $state(false)

  // form 응답 처리
  $effect(() => {
    if (!form) return
    if ('error' in form && form.error) {
      csToast.error(form.error as string)
      isLoading = false
    } else if ('groups' in form && form.ok) {
      groups = (form.groups as PhoneGroup[]).map(g => ({ ...g }))
      step = 'preview'
      isLoading = false
    } else if ('results' in form && form.ok) {
      results = form.results as ImportResult[]
      summary = form.summary as { successCount: number; skippedCount: number; errorCount: number }
      step = 'done'
      isLoading = false
    }
  })

  // 대표 이메일 선택 (그룹 인덱스로 mutate)
  function selectEmail(idx: number, email: string) {
    groups[idx].representEmail = email
  }

  // 그룹 제외 토글
  function toggleExclude(idx: number) {
    groups[idx].excluded = !groups[idx].excluded
  }

  // confirm 시 JSON 직렬화
  function buildGroupsJson() {
    return JSON.stringify(groups)
  }

  function reset() {
    step = 'input'
    groups = []
    results = null
    summary = null
    csvText = ''
  }

  // 전화번호 없는 그룹 감지
  function hasNoPhone(g: PhoneGroup) { return !g.phone }
  // 대표 이메일 미선택인 그룹 감지 (2개 이상)
  function needsSelection(g: PhoneGroup) { return g.rows.length >= 2 && !g.representEmail }

  const activeGroups = $derived(groups.filter(g => !g.excluded))
  const totalSuccess = $derived(summary?.successCount ?? 0)
  const totalSkipped = $derived(summary?.skippedCount ?? 0)
  const totalError   = $derived(summary?.errorCount ?? 0)
</script>

<div class="legacy-import-page">
  <div class="page-header">
    <a href="/cms/customers" class="back-link">← 고객 관리</a>
    <h1 class="page-title">레거시 회원 일괄 등록</h1>
    <p class="page-desc">
      과거 SNS 로그인 고객(카카오/네이버)의 CSV 데이터를 붙여 넣어 선등록 계정으로 일괄 등록합니다.
    </p>
  </div>

  <!-- 임포트 화면(CSV 등록) ↔ 미인증 대기 목록(legacy_member_staging 조회 전용) 탭 —
       실 고객 DB(/cms/customers)와는 완전히 분리된 화면이라는 원칙을 이 화면 내에서만
       유지한다(2026-09-11, Stephen 지시 — 개인정보보호법 위반 소지 시정). -->
  <div class="tab-row">
    <button type="button" class:active={view === 'import'} onclick={() => view = 'import'}>
      CSV 일괄 등록
    </button>
    <button type="button" class:active={view === 'pending'} onclick={() => view = 'pending'}>
      미인증 대기 목록 ({data.pendingStaging.length})
    </button>
  </div>

  {#if view === 'pending'}
    <div class="result-card">
      <h2 class="step-title">미인증 대기 목록</h2>
      <p class="step-desc">
        아직 본인이 인증(OTP)을 완료하지 않은 레거시 후보입니다. 실제 고객 DB(auth.users/
        user_profiles)와 완전히 분리된 대기 상태이며, 본인이 로그인 화면에서 이름+전화번호
        인증을 완료해야만 실 계정으로 편입됩니다.
      </p>
      {#if data.pendingStaging.length === 0}
        <p class="step-desc">대기 중인 레거시 후보가 없습니다.</p>
      {:else}
        <div class="result-table">
          <div class="rt-header cols-6">
            <span>이름</span><span>전화번호</span><span>이메일</span>
            <span>출처</span><span>구매횟수</span><span>등록일</span>
          </div>
          {#each data.pendingStaging as row}
            <div class="rt-row cols-6">
              <span>{row.full_name}</span>
              <span>{row.phone ?? '—'}</span>
              <span class="rt-email">{row.email}</span>
              <span>{row.legacy_source ?? '—'}</span>
              <span>{row.legacy_purchase_count}</span>
              <span>{new Date(row.imported_at).toLocaleDateString('ko-KR')}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}

  <!-- ═══ STEP 1: CSV 입력 ═══ -->
  {#if step === 'input'}
    <div class="step-card">
      <h2 class="step-title">1단계 — CSV 데이터 입력</h2>
      <p class="step-desc">
        컬럼 순서: <code>이름 / 전화번호 / 이메일 / 가입일 / 구매횟수 / 출처(kakao|naver|csv)</code>
        <br />탭 또는 쉼표로 구분. 첫 행이 헤더이면 자동 건너뜀.
      </p>

      <form
        method="POST"
        action="?/preview"
        use:enhance={() => {
          isLoading = true
          return ({ result }) => {
            // $effect가 form을 통해 처리하므로 여기서는 아무것도 하지 않음
          }
        }}
      >
        <textarea
          name="csv_text"
          class="csv-input"
          placeholder={"이용희\t010-1234-5678\tlee@kakao.com\t2023-01-01\t3\tkakao\n이용희\t010-1234-5678\tlee2@naver.com\t2022-06-15\t1\tnaver"}
          rows="12"
          bind:value={csvText}
          disabled={isLoading}
        ></textarea>
        <div class="action-row">
          <button type="submit" class="btn-primary" disabled={isLoading || !csvText.trim()}>
            {isLoading ? '분석 중...' : '미리보기 →'}
          </button>
        </div>
      </form>
    </div>

  <!-- ═══ STEP 2: 그룹 미리보기 ═══ -->
  {:else if step === 'preview'}
    <div class="step-header-row">
      <h2 class="step-title">2단계 — 그룹 확인 및 대표 이메일 선택</h2>
      <button class="btn-ghost" onclick={reset}>← 다시 입력</button>
    </div>

    <div class="group-summary-bar">
      전체 {groups.length}개 그룹 / 유효 {activeGroups.length}개 등록 예정
    </div>

    <!-- 경고: 대표 이메일 미선택 그룹 존재 -->
    {#if groups.some(needsSelection)}
      <div class="warn-banner">
        ⚠️ 동일 전화번호 그룹 중 대표 이메일이 선택되지 않은 항목이 있습니다. 등록 전 선택해주세요.
      </div>
    {/if}

    <div class="groups-list">
      {#each groups as group, idx}
        <div class="group-card" class:excluded={group.excluded} class:no-phone={hasNoPhone(group)} class:needs-sel={needsSelection(group)}>
          <div class="group-card-header">
            <div class="group-meta">
              <span class="group-phone">{group.phone ?? '전화번호 없음'}</span>
              {#if hasNoPhone(group)}
                <span class="badge-warn">전화번호 없음 — OTP 인증 불가</span>
              {/if}
              <span class="group-count">{group.rows.length}개 계정</span>
              <span class="group-purchase">구매횟수 합계: {group.totalPurchaseCount}</span>
            </div>
            <label class="exclude-toggle">
              <input
                type="checkbox"
                checked={group.excluded}
                onchange={() => toggleExclude(idx)}
              />
              <span>제외</span>
            </label>
          </div>

          {#if !group.excluded}
            <!-- 이메일 선택 (2개 이상 그룹) -->
            {#if group.rows.length >= 2}
              <div class="email-select-section">
                <p class="email-label">대표 이메일 선택 <span class="required">*</span></p>
                {#each group.rows as row}
                  <label class="email-radio" class:selected={group.representEmail === row.email}>
                    <input
                      type="radio"
                      name="rep_{idx}"
                      value={row.email ?? ''}
                      checked={group.representEmail === row.email}
                      onchange={() => selectEmail(idx, row.email ?? '')}
                      disabled={!row.email}
                    />
                    <span class="email-val">{row.email ?? '(이메일 없음)'}</span>
                    <span class="row-meta">{row.name} / {row.source} / 가입 {row.signupAt ?? '불명'} / {row.purchaseCount}회</span>
                  </label>
                {/each}
              </div>
            {:else}
              <!-- 단일 행 그룹 — 자동 대표 이메일 -->
              <div class="single-row-info">
                <span class="email-val">{group.rows[0]?.email ?? '(이메일 없음)'}</span>
                <span class="row-meta">{group.rows[0]?.name} / {group.rows[0]?.source} / 가입 {group.rows[0]?.signupAt ?? '불명'} / {group.rows[0]?.purchaseCount}회</span>
              </div>
            {/if}
          {:else}
            <div class="excluded-notice">이 그룹은 등록에서 제외됩니다.</div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- 확정 등록 폼 -->
    <form
      method="POST"
      action="?/confirm"
      use:enhance={() => {
        isLoading = true
        return ({ result }) => {}
      }}
    >
      <input type="hidden" name="groups_json" value={buildGroupsJson()} />
      <div class="action-row">
        <button class="btn-ghost" type="button" onclick={reset} disabled={isLoading}>← 다시 입력</button>
        <button
          type="submit"
          class="btn-primary"
          disabled={isLoading || groups.some(g => !g.excluded && needsSelection(g))}
        >
          {isLoading ? '등록 중...' : `${activeGroups.length}개 그룹 등록 확정`}
        </button>
      </div>
    </form>

  <!-- ═══ STEP 3: 결과 ═══ -->
  {:else if step === 'done'}
    <div class="result-card">
      <h2 class="step-title">등록 완료</h2>
      <div class="summary-chips">
        <span class="chip success">성공 {totalSuccess}건</span>
        <span class="chip skipped">건너뜀 {totalSkipped}건</span>
        {#if totalError > 0}
          <span class="chip error">오류 {totalError}건</span>
        {/if}
      </div>

      {#if results && results.length > 0}
        <div class="result-table">
          <div class="rt-header">
            <span>이메일</span>
            <span>결과</span>
            <span>사유</span>
          </div>
          {#each results as r}
            <div class="rt-row" class:rt-success={r.status === 'success'} class:rt-skip={r.status === 'skipped'} class:rt-error={r.status === 'error'}>
              <span class="rt-email">{r.email}</span>
              <span class="rt-status">{r.status === 'success' ? '✅' : r.status === 'skipped' ? '⏭' : '❌'}</span>
              <span class="rt-reason">{r.reason ?? '—'}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="action-row">
        <button class="btn-primary" onclick={reset}>새로 등록하기</button>
        <a href="/cms/customers" class="btn-ghost">고객 목록으로</a>
      </div>
    </div>
  {/if}
  {/if}
</div>

<style>
  /* CMS 기본 레이아웃 정합(/cms/customers 정본과 동일 패턴, 2026-09-11) — 900px 중앙정렬
     캡을 제거해 다른 CMS 화면과 동일하게 좌측 정렬 + 전체 가로폭을 쓰도록 수정 */
  .legacy-import-page {
    padding: 20px 24px 32px;
  }
  .page-header { margin-bottom: 4px; }
  .back-link {
    font-size: 13px;
    color: var(--cs-text-mid);
    text-decoration: none;
    display: inline-block;
    margin-bottom: 8px;
  }
  .page-title {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
    margin: 0 0 4px;
  }
  .page-desc {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }

  .step-card, .result-card {
    background: #fff;
    border-radius: var(--radius-lg);
    border: 1px solid var(--cs-lilac);
    padding: 24px;
    margin-bottom: 20px;
  }
  .step-title {
    font-size: 17px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0 0 8px;
  }
  .step-desc {
    font-size: 13px;
    color: var(--cs-text-mid);
    margin: 0 0 16px;
  }
  .step-desc code {
    font-size: 12px;
    background: var(--cs-lilac);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .step-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .csv-input {
    width: 100%;
    box-sizing: border-box;
    font-family: monospace;
    font-size: 13px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm);
    padding: 12px;
    resize: vertical;
    color: var(--cs-text);
    background: #fafafa;
  }
  .csv-input:focus { outline: 2px solid var(--cs-purple); }

  .action-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
    justify-content: flex-end;
  }

  .btn-primary {
    background: var(--cs-purple);
    color: #fff;
    border: none;
    border-radius: var(--radius-md);
    padding: 10px 24px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    min-height: 44px;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-ghost {
    background: transparent;
    color: var(--cs-text-mid);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-md);
    padding: 10px 20px;
    font-size: 14px;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

  .group-summary-bar {
    font-size: 14px;
    color: var(--cs-text-mid);
    margin-bottom: 8px;
    font-weight: 600;
  }
  .warn-banner {
    background: #fff8e1;
    border: 1px solid #ffe082;
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    font-size: 13px;
    color: #7c5c00;
    margin-bottom: 12px;
  }
  .groups-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
  }
  .group-card {
    background: #fff;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-lg);
    padding: 16px;
  }
  .group-card.excluded { opacity: 0.5; }
  .group-card.needs-sel { border-color: #ffe082; }
  .group-card.no-phone  { border-color: #ffccbc; }

  .group-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .group-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .group-phone { font-weight: 700; font-size: 15px; color: var(--cs-text); }
  .badge-warn {
    background: #ff7043;
    color: #fff;
    border-radius: var(--radius-full);
    padding: 2px 10px;
    font-size: 11px;
    font-weight: 700;
  }
  .group-count, .group-purchase {
    font-size: 12px;
    color: var(--cs-text-mid);
    background: var(--cs-lilac);
    border-radius: var(--radius-full);
    padding: 2px 10px;
  }

  .exclude-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    cursor: pointer;
    color: var(--cs-text-mid);
  }
  .exclude-toggle input { cursor: pointer; }

  .email-select-section { margin-top: 4px; }
  .email-label {
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0 0 8px;
  }
  .required { color: #ef5350; }
  .email-radio {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    margin-bottom: 4px;
    border: 1px solid transparent;
  }
  .email-radio.selected {
    border-color: var(--cs-purple);
    background: rgba(59, 47, 138, 0.04);
  }
  .email-radio input { margin-top: 2px; accent-color: var(--cs-purple); }
  .email-val { font-size: 14px; font-weight: 600; color: var(--cs-text); }
  .row-meta { font-size: 12px; color: var(--cs-text-mid); margin-left: auto; }

  .single-row-info {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
  }
  .excluded-notice {
    font-size: 13px;
    color: var(--cs-text-light);
    font-style: italic;
    padding: 8px 0;
  }

  .summary-chips {
    display: flex;
    gap: 8px;
    margin: 12px 0 20px;
  }
  .chip {
    padding: 6px 16px;
    border-radius: var(--radius-full);
    font-size: 14px;
    font-weight: 700;
  }
  .chip.success { background: #e8f5e9; color: #2e7d32; }
  .chip.skipped { background: #f5f5f5; color: #666; }
  .chip.error   { background: #ffebee; color: #c62828; }

  .tab-row { display: flex; gap: 8px; margin-bottom: 20px; }
  .tab-row button {
    padding: 10px 18px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm);
    background: #fff;
    color: var(--cs-text-mid);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
  .tab-row button.active { background: var(--cs-purple); border-color: var(--cs-purple); color: #fff; }

  .result-table { border: 1px solid var(--cs-lilac); border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 20px; }
  .rt-header.cols-6, .rt-row.cols-6 { grid-template-columns: 1fr 1.2fr 2fr 0.8fr 0.8fr 1fr; }
  .rt-header {
    display: grid;
    grid-template-columns: 2fr 1fr 2fr;
    gap: 12px;
    padding: 10px 14px;
    background: var(--cs-lilac);
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
  }
  .rt-row {
    display: grid;
    grid-template-columns: 2fr 1fr 2fr;
    gap: 12px;
    padding: 10px 14px;
    font-size: 13px;
    border-top: 1px solid var(--cs-lilac);
  }
  .rt-success { background: #f9fff9; }
  .rt-skip    { background: #fafafa; }
  .rt-error   { background: #fff5f5; }
  .rt-email   { color: var(--cs-text); word-break: break-all; }
  .rt-reason  { color: var(--cs-text-mid); }
</style>
