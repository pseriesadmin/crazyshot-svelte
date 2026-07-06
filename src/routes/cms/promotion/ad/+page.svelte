<script lang="ts">
  import { enhance } from '$app/forms'
  import { goto } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { Banner } from './+page.server'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'

  const SLOTS = [
    { key: 'hero_pc',           label: 'PC 히어로 슬라이드' },
    { key: 'hero_mobile',       label: '모바일 히어로 슬라이드' },
    { key: 'mid_banner_pc',     label: 'PC 중간 배너' },
    { key: 'mid_banner_mobile', label: '모바일 중간 배너' },
  ]

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  type Tab = 'slots' | 'list' | 'create'
  let activeTab = $state<Tab>((data.tab as Tab) ?? 'slots')

  function switchTab(t: Tab) {
    activeTab = t
    goto(`/cms/promotion/ad?tab=${t}`, { replaceState: true })
  }

  // 삭제 확인
  let deleteTarget = $state<Banner | null>(null)
  let deleting = $state(false)
  let creating = $state(false)
  let adValidFrom  = $state('')
  let adValidUntil = $state('')

  function slotLabel(key: string): string {
    return SLOTS.find(s => s.key === key)?.label ?? key
  }

  function formatDate(d: string | null): string {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('ko-KR')
  }

  function bannersForSlot(key: string): Banner[] {
    return data.banners.filter(b => b.slot_key === key)
  }

  $effect(() => {
    if (form?.ok === true) {
      csToast.success('처리되었습니다.')
      creating = false
    } else if (form?.ok === false) {
      csToast.error((form as { ok: boolean; error?: string }).error ?? '오류가 발생했습니다.')
    }
  })
</script>

<div class="page-wrap">

  <div class="page-header">
    <h1 class="page-title">홍보 배너 관리</h1>
    <p class="page-sub">홈페이지 슬롯별 배너 이미지와 링크를 관리합니다.</p>
  </div>

  <!-- 탭 네비게이션 -->
  <div class="tab-nav" role="tablist">
    {#each [
      { id: 'slots',  label: '슬롯 현황' },
      { id: 'list',   label: '전체 목록' },
      { id: 'create', label: '배너 등록' },
    ] as t (t.id)}
      <button
        role="tab"
        aria-selected={activeTab === t.id}
        class="tab-btn"
        class:active={activeTab === t.id}
        onclick={() => switchTab(t.id as Tab)}
      >{t.label}</button>
    {/each}
  </div>

  <!-- ─── 슬롯 현황 ─── -->
  {#if activeTab === 'slots'}
    <div class="slots-grid">
      {#each SLOTS as slot (slot.key)}
        {@const slotBanners = bannersForSlot(slot.key)}
        <div class="slot-card">
          <p class="slot-label">{slot.label}</p>
          <p class="slot-key-tag">{slot.key}</p>
          {#if slotBanners.length === 0}
            <div class="slot-empty">
              <p class="empty-msg">등록된 배너 없음</p>
              <button class="btn-ghost btn-sm" onclick={() => switchTab('create')}>배너 등록</button>
            </div>
          {:else}
            <div class="slot-banners">
              {#each slotBanners as b (b.id)}
                <div class="slot-banner-item" class:inactive={!b.is_active}>
                  <img
                    src={b.image_url}
                    alt={b.title ?? slot.label}
                    class="slot-thumb"
                    loading="lazy"
                  />
                  <div class="slot-banner-info">
                    <p class="banner-title">{b.title ?? '제목 없음'}</p>
                    <p class="banner-meta">정렬: {b.sort_order} · {b.is_active ? '노출 중' : '비활성'}</p>
                    {#if b.valid_until}
                      <p class="banner-meta">~{formatDate(b.valid_until)}</p>
                    {/if}
                  </div>
                  <div class="slot-banner-actions">
                    <form method="POST" action="?/toggleBanner" use:enhance>
                      <input type="hidden" name="id" value={b.id} />
                      <input type="hidden" name="is_active" value={String(b.is_active)} />
                      <button type="submit" class="btn-ghost btn-sm">
                        {b.is_active ? '숨기기' : '노출'}
                      </button>
                    </form>
                    <button
                      class="btn-danger btn-sm"
                      onclick={() => { deleteTarget = b }}
                    >삭제</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

  <!-- ─── 전체 목록 ─── -->
  {:else if activeTab === 'list'}
    <div class="section-card">
      {#if data.banners.length === 0}
        <p class="no-data">등록된 배너가 없습니다.</p>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>슬롯</th><th>제목</th><th>이미지</th><th>링크</th>
                <th>기기</th><th>정렬</th><th>기간</th><th>상태</th><th>액션</th>
              </tr>
            </thead>
            <tbody>
              {#each data.banners as b (b.id)}
                <tr class:row-inactive={!b.is_active}>
                  <td>
                    <span class="slot-badge">{slotLabel(b.slot_key)}</span>
                  </td>
                  <td class="title-cell">{b.title ?? '—'}</td>
                  <td>
                    <img src={b.image_url} alt={b.title ?? ''} class="list-thumb" loading="lazy" />
                  </td>
                  <td class="link-cell">
                    {#if b.link_url}
                      <span class="link-text">{b.link_url}</span>
                    {:else}
                      —
                    {/if}
                  </td>
                  <td>{b.device_type}</td>
                  <td class="center-cell">{b.sort_order}</td>
                  <td class="date-cell">
                    {formatDate(b.valid_from)} ~ {formatDate(b.valid_until)}
                  </td>
                  <td>
                    <span class="badge {b.is_active ? 'badge-active' : 'badge-inactive'}">
                      {b.is_active ? '노출' : '숨김'}
                    </span>
                  </td>
                  <td>
                    <div class="action-row">
                      <form method="POST" action="?/toggleBanner" use:enhance>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="is_active" value={String(b.is_active)} />
                        <button type="submit" class="btn-ghost btn-sm">
                          {b.is_active ? '숨기기' : '노출'}
                        </button>
                      </form>
                      <button
                        class="btn-danger btn-sm"
                        onclick={() => { deleteTarget = b }}
                      >삭제</button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

  <!-- ─── 배너 등록 ─── -->
  {:else if activeTab === 'create'}
    <div class="form-card">
      <p class="section-label">배너 등록</p>
      <form
        method="POST"
        action="?/createBanner"
        use:enhance={() => {
          creating = true
          return async ({ update }) => { creating = false; await update() }
        }}
        class="create-form"
      >
        <div class="form-row">
          <div class="form-field">
            <label for="slot_key">슬롯 <span class="required">*</span></label>
            <select id="slot_key" name="slot_key" class="f-input" required>
              {#each SLOTS as s (s.key)}
                <option value={s.key}>{s.label}</option>
              {/each}
            </select>
          </div>
          <div class="form-field">
            <label for="device_type">기기 타입</label>
            <select id="device_type" name="device_type" class="f-input">
              <option value="all">전체</option>
              <option value="pc">PC</option>
              <option value="mobile">모바일</option>
            </select>
          </div>
        </div>

        <div class="form-field">
          <label for="title">배너 제목</label>
          <input id="title" name="title" class="f-input" placeholder="예: 여름 할인 이벤트 배너" />
        </div>

        <div class="form-field">
          <label for="image_url">이미지 URL (Cloudinary) <span class="required">*</span></label>
          <input
            id="image_url"
            name="image_url"
            class="f-input"
            required
            placeholder="https://res.cloudinary.com/crazyshot/image/upload/..."
          />
          <span class="hint">Cloudinary에 이미지 업로드 후 URL을 붙여넣으세요.</span>
        </div>

        <div class="form-field">
          <label for="link_url">클릭 링크 URL</label>
          <input id="link_url" name="link_url" class="f-input" placeholder="/products 또는 https://..." />
        </div>

        <div class="form-row">
          <div class="form-field">
            <label for="sort_order">정렬 순서</label>
            <input id="sort_order" name="sort_order" type="number" min="0" value="0" class="f-input" />
            <span class="hint">낮은 숫자가 먼저 표시됩니다.</span>
          </div>
          <div class="form-field"><!-- spacer --></div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label for="valid_from">노출 시작일</label>
            <CmsDatePicker bind:value={adValidFrom} name="valid_from" placeholder="시작일 선택" disablePast={false} />
          </div>
          <div class="form-field">
            <label for="valid_until">노출 종료일</label>
            <CmsDatePicker bind:value={adValidUntil} name="valid_until" placeholder="종료일 선택" disablePast={false} />
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn-primary" disabled={creating}>
            {creating ? '등록 중...' : '배너 등록'}
          </button>
        </div>
      </form>
    </div>
  {/if}

</div>

<!-- 삭제 확인 모달 -->
{#if deleteTarget}
  <div
    class="confirm-backdrop"
    role="presentation"
    onclick={() => { deleteTarget = null }}
  >
    <div
      class="confirm-dialog"
      role="dialog"
      aria-modal="true"
      onclick={(e) => e.stopPropagation()}
    >
      <p class="confirm-msg">배너를 삭제하시겠습니까?</p>
      <p class="confirm-sub">"{deleteTarget.title ?? deleteTarget.slot_key}" 배너가 영구 삭제됩니다.</p>
      <div class="confirm-actions">
        <button class="btn-ghost" onclick={() => { deleteTarget = null }}>취소</button>
        <form
          method="POST"
          action="?/deleteBanner"
          use:enhance={() => {
            deleting = true
            return async ({ update }) => { deleting = false; deleteTarget = null; await update() }
          }}
        >
          <input type="hidden" name="id" value={deleteTarget.id} />
          <button type="submit" class="btn-danger" disabled={deleting}>
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </form>
      </div>
    </div>
  </div>
{/if}

<style>
  .page-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 32px;
  }
  .page-header { margin-bottom: 20px; }
  .page-title  { font: var(--text-pc-htitle-25); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub    { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }

  .tab-nav { display: flex; gap: 4px; margin-bottom: 20px; }
  .tab-btn {
    padding: 6px 20px;
    border-radius: var(--cms-radius-sm);
    border: none;
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    cursor: pointer;
    min-height: 34px;
    transition: background 0.15s, color 0.15s;
  }
  .tab-btn:hover  { background: rgba(59,47,138,0.08); color: var(--cs-text); }
  .tab-btn.active { background: var(--cs-white); color: var(--cs-purple); }

  /* 슬롯 현황 */
  .slots-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  .slot-card {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 20px;
    overflow: hidden;
  }
  .slot-label { font: var(--text-pc-body-14); color: var(--cs-text); margin: 0 0 4px; }
  .slot-key-tag {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 0 0 16px;
  }
  .slot-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 24px 0;
  }
  .empty-msg { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }

  .slot-banners { display: flex; flex-direction: column; gap: 10px; }
  .slot-banner-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
  }
  .slot-banner-item.inactive { opacity: 0.5; }
  .slot-thumb {
    width: 80px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .slot-banner-info { flex: 1; min-width: 0; }
  .banner-title { font: var(--text-pc-body-14); color: var(--cs-text); margin: 0 0 2px; truncate: clip; }
  .banner-meta { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }
  .slot-banner-actions { display: flex; gap: 6px; flex-shrink: 0; }

  /* 전체 목록 */
  .section-card {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 20px;
    overflow: hidden;
  }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font: var(--text-pc-body-14); color: var(--cs-text); }
  thead th {
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    padding: 10px 16px;
    text-align: left;
    white-space: nowrap;
  }
  tbody tr { border-bottom: 1px solid var(--cs-surface-gray); }
  tbody tr:hover { background: rgba(59,47,138,0.04); }
  tbody tr.row-inactive { opacity: 0.55; }
  tbody tr:last-child { border-bottom: none; }
  td { padding: 10px 16px; vertical-align: middle; }
  .title-cell { max-width: 120px; }
  .link-cell { max-width: 140px; }
  .link-text { font: var(--text-pc-script-12); color: var(--cs-purple); }
  .date-cell { font: var(--text-pc-script-12); color: var(--cs-text-dark); white-space: nowrap; }
  .center-cell { text-align: center; }
  .list-thumb {
    width: 64px;
    height: 40px;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }

  .slot-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    white-space: nowrap;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    white-space: nowrap;
  }
  .badge-active   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
  .badge-inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }

  .action-row { display: flex; gap: 6px; }

  /* 배너 등록 폼 */
  .form-card {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px;
    max-width: 640px;
  }
  .section-label { font: var(--text-pc-body-14); color: var(--cs-text); margin: 0 0 20px; }
  .create-form { display: flex; flex-direction: column; gap: 16px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .form-field { display: flex; flex-direction: column; gap: 6px; }
  .form-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .required { color: var(--cs-red-badge); }
  .hint { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .form-actions { display: flex; gap: 10px; padding-top: 4px; }

  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 8px 12px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 100%;
  }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  /* 버튼 */
  .btn-primary {
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    padding: 8px 16px;
    font: var(--text-pc-body-14);
    height: 36px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-primary:hover    { background: var(--cs-purple-hover); }
  .btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-ghost {
    background: transparent;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    color: var(--cs-purple);
    padding: 7px 14px;
    font: var(--text-pc-body-14);
    height: 36px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-ghost:hover { background: rgba(59,47,138,0.06); }

  .btn-danger {
    background: transparent;
    border: 1.5px solid var(--cs-red-badge);
    border-radius: var(--radius-sm);
    color: var(--cs-red-badge);
    padding: 7px 14px;
    font: var(--text-pc-body-14);
    height: 36px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-danger:hover    { background: rgba(255,53,53,0.08); }
  .btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

  .btn-sm { height: 30px; padding: 4px 10px; font: var(--text-pc-script-12); }

  /* 삭제 모달 */
  .confirm-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(16,11,50,0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .confirm-dialog {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px 32px;
    min-width: 320px;
    max-width: 420px;
    text-align: center;
  }
  .confirm-msg  { font: var(--text-pc-title-16); color: var(--cs-text); margin: 0 0 8px; }
  .confirm-sub  { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 20px; }
  .confirm-actions { display: flex; gap: 10px; justify-content: center; }

  .no-data {
    text-align: center;
    padding: 40px 20px;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    margin: 0;
  }
</style>
