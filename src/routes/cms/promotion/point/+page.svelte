<script lang="ts">
  import { enhance } from '$app/forms'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { EarnRule } from './+page.server'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  const TABS = [
    { id: 'dashboard', label: '대시보드' },
    { id: 'grant',     label: '발행·차감' },
    { id: 'history',   label: '이력' },
    { id: 'balance',   label: '잔량 현황' },
    { id: 'rules',     label: '적립 규칙' },
  ] as const

  let activeTab = $state(data.tab)

  function switchTab(id: string) {
    activeTab = id
    const u = new URL(page.url)
    u.searchParams.set('tab', id)
    goto(u.toString(), { replaceState: true, invalidateAll: true })
  }

  // ─ 발행·차감 폼 ─
  let grantUserId    = $state('')
  let grantAmount    = $state(0)
  let grantType      = $state<'admin_grant' | 'admin_deduct'>('admin_grant')
  let grantDesc      = $state('')
  let grantLoading   = $state(false)

  // ─ 일괄 발행 ─
  let bulkCsvText    = $state('')
  let bulkLoading    = $state(false)

  function parseBulkCsv(): { user_id: string; amount: number; description?: string }[] {
    return bulkCsvText.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(l => {
        const [user_id, amount, ...rest] = l.split(',')
        return { user_id: user_id.trim(), amount: Number(amount.trim()), description: rest.join(',').trim() || undefined }
      })
      .filter(r => r.user_id && r.amount > 0)
  }

  // ─ 이력 필터 ─
  let txTypeFilter = $state(data.txType)
  let fromFilter   = $state(data.from.substring(0, 10))
  let toFilter     = $state(data.to.substring(0, 10))

  function applyFilter() {
    const u = new URL(page.url)
    u.searchParams.set('tab', 'history')
    u.searchParams.set('txType', txTypeFilter)
    u.searchParams.set('from', fromFilter)
    u.searchParams.set('to', toFilter)
    goto(u.toString(), { replaceState: true, invalidateAll: true })
  }

  // ─ 적립 규칙 ─
  let editingRule = $state<string | null>(null)
  let ruleLoading = $state(false)

  // 로컬 편집 버퍼
  let ruleEdits = $state<Record<string, { amount: string; rate: string; is_active: boolean }>>({})

  function startEdit(r: EarnRule) {
    editingRule = r.event_type
    ruleEdits[r.event_type] = {
      amount:    String(r.amount),
      rate:      String(r.rate),
      is_active: r.is_active,
    }
  }

  function cancelEdit() { editingRule = null }

  // ─ action 결과 ─
  $effect(() => {
    if (!form) return
    if (form.ok) {
      csToast.success('완료되었습니다.')
      grantUserId  = ''
      grantAmount  = 0
      grantDesc    = ''
      bulkCsvText  = ''
      editingRule  = null
    } else if ('error' in form && form.error) {
      csToast.error(String(form.error))
    }
  })

  // ─ 유틸 ─
  function formatDate(d: string): string {
    return new Date(d).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' })
  }

  function txTypeLabel(t: string): string {
    const MAP: Record<string, string> = {
      earn: '적립', use: '사용', expire: '만료',
      admin_grant: '관리자 지급', admin_deduct: '관리자 차감',
    }
    return MAP[t] ?? t
  }

  function eventTypeLabel(e: string): string {
    const MAP: Record<string, string> = {
      rental_complete: '렌탈 완료',
      review:          '리뷰 작성',
      on_time_return:  '정시 반납',
      referrer:        '추천인',
      referee:         '피추천인',
      birthday:        '생일 축하',
      event:           '이벤트 (관리자)',
    }
    return MAP[e] ?? e
  }
</script>

<div class="page-wrap">
  <!-- 서브탭 -->
  <div class="sub-tabs">
    {#each TABS as t}
      <button class="sub-tab-btn" class:active={activeTab === t.id}
        onclick={() => switchTab(t.id)}>{t.label}</button>
    {/each}
  </div>

  <!-- ────────────────────────────────────────────
       탭1: 대시보드
  ──────────────────────────────────────────── -->
  {#if activeTab === 'dashboard'}
    <div class="section-title">포인트 현황</div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">총 발급 포인트</span>
        <span class="kpi-val">{data.stats.total_granted.toLocaleString()}P</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">총 사용 포인트</span>
        <span class="kpi-val">{data.stats.total_used.toLocaleString()}P</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">총 만료 소멸</span>
        <span class="kpi-val kv-muted">{data.stats.total_expired.toLocaleString()}P</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">현재 유통 잔량 (부채)</span>
        <span class="kpi-val kv-active">{data.stats.total_balance.toLocaleString()}P</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">포인트 사용률</span>
        <span class="kpi-val">{data.stats.usage_rate}%</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">평균 사용자 보유</span>
        <span class="kpi-val">{data.stats.avg_user_balance.toLocaleString()}P</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">이번 달 발급</span>
        <span class="kpi-val">{data.stats.monthly_issued.toLocaleString()}P</span>
      </div>
    </div>

    {#if data.txRows.length > 0}
      <div class="section-title">최근 이력</div>
      <div class="table-card">
        <table>
          <thead>
            <tr><th>사용자</th><th>유형</th><th>금액</th><th>일시</th></tr>
          </thead>
          <tbody>
            {#each data.txRows.slice(0, 5) as r}
              <tr>
                <td class="td-uid">{r.user_profiles?.full_name ?? r.user_id.substring(0, 8) + '...'}</td>
                <td><span class="badge {r.amount > 0 ? 'badge-active' : 'badge-error'}">{txTypeLabel(r.type)}</span></td>
                <td class:amount-pos={r.amount > 0} class:amount-neg={r.amount < 0}>
                  {r.amount > 0 ? '+' : ''}{r.amount.toLocaleString()}P
                </td>
                <td class="td-date">{formatDate(r.created_at)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  <!-- ────────────────────────────────────────────
       탭2: 발행·차감
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'grant'}
    <div class="section-title">포인트 발행·차감</div>

    <div class="form-card">
      <div class="fs-title">개별 발행·차감</div>
      <form method="POST" action="?/grantPoints"
        use:enhance={() => {
          grantLoading = true
          return ({ update }) => { grantLoading = false; update() }
        }}
      >
        <div class="form-grid">
          <div class="form-field form-full">
            <label for="g-uid">사용자 UUID</label>
            <input id="g-uid" name="user_id" class="f-input"
              bind:value={grantUserId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required />
          </div>
          <div class="form-field">
            <label for="g-type">유형</label>
            <div class="radio-group">
              <label class="radio-lbl">
                <input type="radio" name="tx_type" value="admin_grant" bind:group={grantType} />
                지급 (적립)
              </label>
              <label class="radio-lbl">
                <input type="radio" name="tx_type" value="admin_deduct" bind:group={grantType} />
                차감
              </label>
            </div>
          </div>
          <div class="form-field">
            <label for="g-amt">금액 (P)</label>
            <input id="g-amt" name="amount" type="number" min="1" class="f-input"
              bind:value={grantAmount} required />
          </div>
          <div class="form-field form-full">
            <label for="g-desc">사유 (필수)</label>
            <input id="g-desc" name="description" class="f-input"
              bind:value={grantDesc} placeholder="예: 리뷰 작성 보상" required />
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary" disabled={grantLoading}>
            {grantLoading ? '처리 중...' : '포인트 처리'}
          </button>
        </div>
      </form>
    </div>

    <div class="form-card">
      <div class="fs-title">일괄 발행 (CSV)</div>
      <p class="hint">형식: user_id,금액,사유 (줄바꿈 구분)</p>
      <form method="POST" action="?/bulkGrantPoints"
        use:enhance={() => {
          bulkLoading = true
          return ({ update }) => { bulkLoading = false; update() }
        }}
      >
        <div class="form-field">
          <label for="bulk-csv">CSV 입력</label>
          <textarea id="bulk-csv" class="f-input ta" rows="6"
            placeholder="uuid-1,500,리뷰 보상&#10;uuid-2,1000,생일 쿠폰"
            bind:value={bulkCsvText}></textarea>
        </div>
        <input type="hidden" name="grants" value={JSON.stringify(parseBulkCsv())} />
        <div class="form-actions">
          <span class="hint">{parseBulkCsv().length}건 파싱됨</span>
          <button type="submit" class="btn-primary"
            disabled={bulkLoading || parseBulkCsv().length === 0}>
            {bulkLoading ? '처리 중...' : '일괄 발행'}
          </button>
        </div>
      </form>
    </div>

  <!-- ────────────────────────────────────────────
       탭3: 이력
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'history'}
    <div class="toolbar">
      <span class="section-title nm">포인트 이력</span>
      <div class="filter-form">
        <select class="f-input sm" bind:value={txTypeFilter}>
          <option value="all">전체 유형</option>
          <option value="earn">적립</option>
          <option value="use">사용</option>
          <option value="expire">만료</option>
          <option value="admin_grant">관리자 지급</option>
          <option value="admin_deduct">관리자 차감</option>
        </select>
        <CmsDatePicker bind:value={fromFilter} placeholder="시작일" disablePast={false} />
        <CmsDatePicker bind:value={toFilter} placeholder="종료일" disablePast={false} />
        <button class="btn-primary" onclick={applyFilter}>조회</button>
      </div>
    </div>

    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>사용자</th><th>유형</th>
            <th>금액</th><th>잔액after</th><th>사유</th><th>일시</th>
          </tr>
        </thead>
        <tbody>
          {#each data.txRows as r}
            <tr>
              <td class="td-uid">{r.user_profiles?.full_name ?? r.user_id.substring(0, 8) + '...'}</td>
              <td>
                <span class="badge {r.amount > 0 ? 'badge-active' : 'badge-error'}">
                  {txTypeLabel(r.type)}
                </span>
              </td>
              <td class:amount-pos={r.amount > 0} class:amount-neg={r.amount < 0}>
                {r.amount > 0 ? '+' : ''}{r.amount.toLocaleString()}P
              </td>
              <td>{r.balance_after.toLocaleString()}P</td>
              <td class="td-desc">{r.description ?? '—'}</td>
              <td class="td-date">{formatDate(r.created_at)}</td>
            </tr>
          {:else}
            <tr><td colspan="6" class="no-data">이력이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

  <!-- ────────────────────────────────────────────
       탭4: 잔량 현황
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'balance'}
    <div class="section-title">사용자별 잔량 (상위 100명)</div>
    <div class="table-card">
      <table>
        <thead>
          <tr><th>순위</th><th>이름</th><th>연락처</th><th>보유 포인트</th></tr>
        </thead>
        <tbody>
          {#each data.userBalances as u, i}
            <tr>
              <td class="td-rank">{i + 1}</td>
              <td>{u.full_name ?? '—'}</td>
              <td class="td-uid">{u.phone ?? '—'}</td>
              <td class="amount-pos">{u.points.toLocaleString()}P</td>
            </tr>
          {:else}
            <tr><td colspan="4" class="no-data">보유 포인트 사용자가 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

  <!-- ────────────────────────────────────────────
       탭5: 적립 규칙 설정
  ──────────────────────────────────────────── -->
  {:else if activeTab === 'rules'}
    <div class="toolbar">
      <span class="section-title nm">적립 규칙 설정</span>
    </div>

    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>이벤트</th><th>고정 적립 (P)</th>
            <th>적립률 (%)</th><th>등급별 배수</th>
            <th>활성</th><th>관리</th>
          </tr>
        </thead>
        <tbody>
          {#each data.earnRules as r}
            {@const isEditing = editingRule === r.event_type}
            <tr>
              <td>
                <span class="rule-label">{eventTypeLabel(r.event_type)}</span>
                {#if r.description}
                  <span class="rule-desc">{r.description}</span>
                {/if}
              </td>
              {#if isEditing}
                <td>
                  <input type="number" min="0" class="f-input inline"
                    bind:value={ruleEdits[r.event_type].amount} />
                </td>
                <td>
                  <input type="number" min="0" step="0.01" class="f-input inline"
                    bind:value={ruleEdits[r.event_type].rate} />
                </td>
                <td class="td-date">
                  {#if r.grade_multipliers}
                    BASIC×{r.grade_multipliers.BASIC} / PRO×{r.grade_multipliers.PRO} / CRAZY×{r.grade_multipliers.CRAZY}
                  {:else}—{/if}
                </td>
                <td>
                  <button type="button" class="tog" class:tog-on={ruleEdits[r.event_type].is_active}
                    role="switch" aria-checked={ruleEdits[r.event_type].is_active}
                    aria-label="활성화 토글"
                    onclick={() => { ruleEdits[r.event_type].is_active = !ruleEdits[r.event_type].is_active }}>
                    <span class="tog-thumb"></span>
                  </button>
                </td>
                <td>
                  <form method="POST" action="?/updateEarnRule"
                    use:enhance={() => {
                      ruleLoading = true
                      return ({ update }) => { ruleLoading = false; update() }
                    }}
                  >
                    <input type="hidden" name="event_type" value={r.event_type} />
                    <input type="hidden" name="amount"    value={ruleEdits[r.event_type].amount} />
                    <input type="hidden" name="rate"      value={ruleEdits[r.event_type].rate} />
                    <input type="hidden" name="is_active" value={String(ruleEdits[r.event_type].is_active)} />
                    {#if r.grade_multipliers}
                      <input type="hidden" name="grade_multipliers"
                        value={JSON.stringify(r.grade_multipliers)} />
                    {/if}
                    <div class="row-gap">
                      <button type="submit" class="btn-primary sm"
                        disabled={ruleLoading}>저장</button>
                      <button type="button" class="btn-ghost sm"
                        onclick={cancelEdit}>취소</button>
                    </div>
                  </form>
                </td>
              {:else}
                <td>{r.amount > 0 ? r.amount.toLocaleString() + 'P' : '—'}</td>
                <td>{r.rate > 0 ? (r.rate * 100).toFixed(1) + '%' : '—'}</td>
                <td class="td-date">
                  {#if r.grade_multipliers}
                    B×{r.grade_multipliers.BASIC} / P×{r.grade_multipliers.PRO} / C×{r.grade_multipliers.CRAZY}
                  {:else}—{/if}
                </td>
                <td>
                  <span class="badge {r.is_active ? 'badge-active' : 'badge-inactive'}">
                    {r.is_active ? '활성' : '비활성'}
                  </span>
                </td>
                <td>
                  <button class="btn-ghost sm" onclick={() => startEdit(r)}>수정</button>
                </td>
              {/if}
            </tr>
          {:else}
            <tr><td colspan="6" class="no-data">적립 규칙이 없습니다. (migration #50 적용 필요)</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
/* ─ 레이아웃 ─ */
.page-wrap {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 20px 24px 32px;
}

/* ─ 서브탭 ─ */
.sub-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.sub-tab-btn {
  padding: 6px 18px; border: none;
  border-radius: var(--cms-radius-sm);
  background: transparent; color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer;
  min-height: 34px; transition: background 0.15s, color 0.15s;
}
.sub-tab-btn:hover  { background: rgba(59,47,138,0.08); color: var(--cs-text); }
.sub-tab-btn.active { background: var(--cs-white); color: var(--cs-purple); }

/* ─ 섹션 타이틀 ─ */
.section-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 16px; }
.section-title.nm { margin: 0; }

/* ─ KPI 그리드 ─ */
.kpi-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 12px; margin-bottom: 20px;
}
.kpi-card {
  background: var(--cs-white); border-radius: var(--cms-radius-md);
  padding: 20px 24px; display: flex; flex-direction: column; gap: 8px;
}
.kpi-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
.kpi-val   { font: var(--text-pc-title-18); color: var(--cs-text); }
.kv-active { color: var(--cs-purple); }
.kv-muted  { color: var(--cs-text-light); }

/* ─ 툴바 ─ */
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }

/* ─ 카드 ─ */
.form-card {
  background: var(--cs-white); border-radius: var(--cms-radius-lg);
  padding: 28px; margin-bottom: 16px;
}

.fs-title {
  font: var(--text-pc-body-14); color: var(--cs-purple);
  margin: 0 0 14px;
  border-bottom: 1px solid var(--cs-surface-gray); padding-bottom: 6px;
}

.hint { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0 0 10px; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-full { grid-column: 1 / -1; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

.row-gap { display: flex; gap: 8px; align-items: center; }

/* ─ 라디오 ─ */
.radio-group { display: flex; gap: 16px; flex-wrap: wrap; }
.radio-lbl {
  display: flex; align-items: center; gap: 6px;
  font: var(--text-pc-body-14); color: var(--cs-text);
  cursor: pointer; min-height: 28px;
}

/* ─ 필터 폼 ─ */
.filter-form { display: flex; gap: 8px; align-items: center; }
.f-input.sm  { padding: 6px 10px; font: var(--text-pc-script-12); height: 32px; }

/* ─ 폼 액션 ─ */
.form-actions {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  margin-top: 20px; padding-top: 16px;
  border-top: 1px solid var(--cs-surface-gray);
}

/* ─ 테이블 ─ */
.table-card {
  background: var(--cs-white); border-radius: var(--cms-radius-md);
  overflow: hidden; margin-bottom: 16px;
}
table { width: 100%; border-collapse: collapse; font: var(--text-pc-body-14); color: var(--cs-text); }
thead th {
  background: var(--cs-lilac); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); padding: 10px 16px;
  text-align: left; white-space: nowrap;
}
tbody tr { border-bottom: 1px solid var(--cs-surface-gray); }
tbody tr:hover { background: rgba(59,47,138,0.04); }
tbody tr:last-child { border-bottom: none; }
td { padding: 10px 16px; vertical-align: middle; }
.td-uid  { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
.td-date { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.td-desc { font: var(--text-pc-script-12); color: var(--cs-text-mid); max-width: 200px; }
.td-rank { font: var(--text-pc-body-14); color: var(--cs-text-light); text-align: center; }
.no-data { text-align: center; color: var(--cs-text-light); padding: 32px; }

.amount-pos { color: var(--cs-purple); font: var(--text-pc-body-14); }
.amount-neg { color: var(--cs-red-badge); font: var(--text-pc-body-14); }

/* ─ 적립 규칙 ─ */
.rule-label { font: var(--text-pc-body-14); color: var(--cs-text); display: block; }
.rule-desc  { font: var(--text-pc-descript-10); color: var(--cs-text-light); display: block; margin-top: 2px; }

.f-input.inline {
  padding: 6px 8px; font: var(--text-pc-script-12); width: 80px;
}

/* ─ 배지 ─ */
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); white-space: nowrap;
}
.badge-active   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
.badge-inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }
.badge-error    { background: rgba(255,53,53,0.10); color: var(--cs-red-badge); }

/* ─ 토글 ─ */
.tog {
  position: relative; width: 40px; height: 22px; border: none;
  border-radius: var(--radius-full); background: var(--cs-disabled-toggle);
  cursor: pointer; transition: background 0.2s; flex-shrink: 0;
}
.tog.tog-on { background: var(--cs-purple); }
.tog-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--cs-white); transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.tog.tog-on .tog-thumb { transform: translateX(18px); }

/* ─ 버튼 ─ */
.btn-primary {
  background: var(--cs-purple); color: var(--cs-white); border: none;
  border-radius: var(--radius-sm); padding: 8px 16px;
  font: var(--text-pc-body-14); height: 36px; cursor: pointer;
  transition: background 0.15s; white-space: nowrap;
}
.btn-primary:hover    { background: var(--cs-purple-hover); }
.btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
.btn-ghost {
  background: transparent; border: 1.5px solid var(--cs-purple);
  border-radius: var(--radius-sm); color: var(--cs-purple);
  padding: 7px 14px; font: var(--text-pc-body-14); height: 36px;
  cursor: pointer; transition: background 0.15s; white-space: nowrap;
}
.btn-ghost:hover { background: rgba(59,47,138,0.06); }
.btn-primary.sm, .btn-ghost.sm {
  padding: 4px 10px; height: 28px; font: var(--text-pc-script-12);
}

/* ─ 입력 필드 ─ */
.f-input {
  background: var(--cs-surface-gray); border: none;
  border-radius: var(--cms-radius-sm); padding: 10px 16px;
  font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
}
.f-input::placeholder { color: var(--cs-text-placeholder); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
.f-input.ta { resize: vertical; height: auto; }
</style>
