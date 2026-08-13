<script lang="ts">
  import type { PageData, ActionData } from './$types'
  import { enhance } from '$app/forms'
  import type { SignatureAsset } from './+page.server'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  let sigAssets   = $derived(data.assets.filter((a: SignatureAsset) => a.asset_type === 'signature'))
  let sealAssets  = $derived(data.assets.filter((a: SignatureAsset) => a.asset_type === 'seal'))

  // 업로드 폼 상태
  let uploadType  = $state<'signature' | 'seal'>('signature')
  let uploadLabel = $state('')
  let uploading   = $state(false)
  let deleting    = $state<string | null>(null)
</script>

<svelte:head>
  <title>서명/직인 자산 관리 — 크레이지샷 CMS</title>
</svelte:head>

<div class="sig-page">
  <div class="sig-header">
    <h1 class="sig-title">서명 / 직인 자산 관리</h1>
    <p class="sig-desc">
      계약서 발행 시 사용할 서명·직인 이미지를 미리 등록합니다.<br>
      발행 시점에 등록된 자산 중 선택하거나, 그 자리에서 직접 서명할 수 있습니다.
    </p>
  </div>

  <!-- 오류/성공 메시지 -->
  {#if form?.error}
    <div class="sig-alert sig-alert--error" role="alert">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="sig-alert sig-alert--success" role="alert">저장됐습니다.</div>
  {/if}

  <!-- 신규 자산 등록 폼 -->
  <section class="sig-section">
    <h2 class="sig-section-title">새 자산 등록</h2>
    <form
      method="POST"
      action="?/uploadAsset"
      enctype="multipart/form-data"
      use:enhance={() => {
        uploading = true
        return async ({ update }) => {
          await update()
          uploading = false
          uploadLabel = ''
        }
      }}
      class="sig-form"
    >
      <div class="sig-row">
        <label class="sig-label" for="asset_type">유형</label>
        <div class="sig-type-group">
          <label class="sig-type-btn" class:active={uploadType === 'signature'}>
            <input
              type="radio"
              name="asset_type"
              value="signature"
              bind:group={uploadType}
              class="sig-radio"
            />
            개인 서명
          </label>
          <label class="sig-type-btn" class:active={uploadType === 'seal'}>
            <input
              type="radio"
              name="asset_type"
              value="seal"
              bind:group={uploadType}
              class="sig-radio"
            />
            법인·회사 직인
          </label>
        </div>
      </div>

      <div class="sig-row">
        <label class="sig-label" for="label">이름 (선택)</label>
        <input
          id="label"
          name="label"
          type="text"
          bind:value={uploadLabel}
          placeholder="예: 대표이사 서명, 법인직인"
          class="sig-input"
        />
      </div>

      <div class="sig-row">
        <label class="sig-label" for="file">이미지 파일 <span class="sig-required">*</span></label>
        <input
          id="file"
          name="file"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
          required
          class="sig-file-input"
        />
        <span class="sig-hint">PNG, JPEG, WebP, HEIF 형식</span>
      </div>

      <button type="submit" class="sig-btn-primary" disabled={uploading}>
        {uploading ? '등록 중...' : '등록하기'}
      </button>
    </form>
  </section>

  <!-- 서명 자산 목록 -->
  <section class="sig-section">
    <h2 class="sig-section-title">개인 서명 ({sigAssets.length}개)</h2>
    {#if sigAssets.length === 0}
      <p class="sig-empty">등록된 서명이 없습니다.</p>
    {:else}
      <div class="sig-grid">
        {#each sigAssets as asset (asset.id)}
          <div class="sig-card" class:sig-card--default={asset.is_default}>
            <div class="sig-img-wrap">
              <img src={asset.image_url} alt={asset.label ?? '서명 이미지'} class="sig-img" />
            </div>
            <div class="sig-card-info">
              <span class="sig-card-label">{asset.label ?? '(이름 없음)'}</span>
              {#if asset.is_default}
                <span class="sig-badge-default">기본값</span>
              {/if}
            </div>
            <div class="sig-card-actions">
              {#if !asset.is_default}
                <form method="POST" action="?/setDefault" use:enhance>
                  <input type="hidden" name="asset_id" value={asset.id} />
                  <input type="hidden" name="asset_type" value="signature" />
                  <button type="submit" class="sig-btn-sm">기본값으로</button>
                </form>
              {/if}
              <form method="POST" action="?/deleteAsset" use:enhance={() => {
                deleting = asset.id
                return async ({ update }) => { await update(); deleting = null }
              }}>
                <input type="hidden" name="asset_id" value={asset.id} />
                <button type="submit" class="sig-btn-danger-sm" disabled={deleting === asset.id}>
                  {deleting === asset.id ? '삭제 중...' : '삭제'}
                </button>
              </form>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- 직인 자산 목록 -->
  <section class="sig-section">
    <h2 class="sig-section-title">법인·회사 직인 ({sealAssets.length}개)</h2>
    {#if sealAssets.length === 0}
      <p class="sig-empty">등록된 직인이 없습니다.</p>
    {:else}
      <div class="sig-grid">
        {#each sealAssets as asset (asset.id)}
          <div class="sig-card" class:sig-card--default={asset.is_default}>
            <div class="sig-img-wrap">
              <img src={asset.image_url} alt={asset.label ?? '직인 이미지'} class="sig-img" />
            </div>
            <div class="sig-card-info">
              <span class="sig-card-label">{asset.label ?? '(이름 없음)'}</span>
              {#if asset.is_default}
                <span class="sig-badge-default">기본값</span>
              {/if}
            </div>
            <div class="sig-card-actions">
              {#if !asset.is_default}
                <form method="POST" action="?/setDefault" use:enhance>
                  <input type="hidden" name="asset_id" value={asset.id} />
                  <input type="hidden" name="asset_type" value="seal" />
                  <button type="submit" class="sig-btn-sm">기본값으로</button>
                </form>
              {/if}
              <form method="POST" action="?/deleteAsset" use:enhance={() => {
                deleting = asset.id
                return async ({ update }) => { await update(); deleting = null }
              }}>
                <input type="hidden" name="asset_id" value={asset.id} />
                <button type="submit" class="sig-btn-danger-sm" disabled={deleting === asset.id}>
                  {deleting === asset.id ? '삭제 중...' : '삭제'}
                </button>
              </form>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .sig-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 24px;
  }
  .sig-header {
    margin-bottom: 32px;
  }
  .sig-title {
    font-size: var(--text-pc-htitle-25, 25px);
    font-weight: 700;
    color: var(--cs-text);
    margin: 0 0 8px;
  }
  .sig-desc {
    font-size: 14px;
    color: var(--cs-text-mid, #666);
    line-height: 1.6;
    margin: 0;
  }
  .sig-alert {
    padding: 12px 16px;
    border-radius: var(--radius-sm, 8px);
    margin-bottom: 20px;
    font-size: 14px;
  }
  .sig-alert--error   { background: #fff0f0; color: var(--cs-red-badge, #ff3535); border: 1px solid #ffcccc; }
  .sig-alert--success { background: #f0fff4; color: #16a34a; border: 1px solid #bbf7d0; }
  .sig-section {
    background: #fff;
    border-radius: var(--radius-sm, 8px);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    padding: 24px;
    margin-bottom: 24px;
  }
  .sig-section-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0 0 20px;
  }
  .sig-form { display: flex; flex-direction: column; gap: 16px; }
  .sig-row  { display: flex; flex-direction: column; gap: 6px; }
  .sig-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--cs-text-mid, #666);
  }
  .sig-required { color: var(--cs-red-badge, #ff3535); }
  .sig-type-group { display: flex; gap: 8px; }
  .sig-type-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: var(--radius-xl, 30px);
    border: 1.5px solid #dcdcdc;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    color: var(--cs-text);
    background: #fff;
    transition: all 0.15s;
  }
  .sig-type-btn.active {
    background: var(--cs-purple, #3B2F8A);
    border-color: var(--cs-purple, #3B2F8A);
    color: #fff;
  }
  .sig-radio { display: none; }
  .sig-input {
    padding: 10px 14px;
    border-radius: var(--radius-sm, 8px);
    border: 1px solid #dcdcdc;
    font-size: 14px;
    color: var(--cs-text);
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .sig-input:focus { border-color: var(--cs-purple, #3B2F8A); }
  .sig-file-input {
    font-size: 14px;
    color: var(--cs-text);
  }
  .sig-hint { font-size: 12px; color: var(--cs-text-mid, #666); }
  .sig-btn-primary {
    align-self: flex-start;
    padding: 10px 24px;
    border-radius: var(--radius-md, 15px);
    background: var(--cs-purple, #3B2F8A);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    min-height: 44px;
    transition: opacity 0.15s;
  }
  .sig-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .sig-empty { font-size: 14px; color: var(--cs-text-mid, #666); margin: 0; }
  .sig-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 16px;
  }
  .sig-card {
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-sm, 8px);
    overflow: hidden;
    background: #fff;
    transition: border-color 0.15s;
  }
  .sig-card--default { border-color: var(--cs-purple, #3B2F8A); }
  .sig-img-wrap {
    background: #f9f9f9;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 120px;
    padding: 12px;
  }
  .sig-img {
    max-width: 100%;
    max-height: 96px;
    object-fit: contain;
  }
  .sig-card-info {
    padding: 8px 12px 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sig-card-label { font-size: 13px; font-weight: 600; color: var(--cs-text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sig-badge-default {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: var(--radius-full, 99px);
    background: var(--cs-purple, #3B2F8A);
    color: #fff;
    white-space: nowrap;
  }
  .sig-card-actions {
    padding: 8px 12px 12px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sig-btn-sm {
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 600;
    border-radius: var(--radius-full, 99px);
    border: 1px solid var(--cs-purple, #3B2F8A);
    color: var(--cs-purple, #3B2F8A);
    background: transparent;
    cursor: pointer;
    min-height: 30px;
    transition: all 0.15s;
  }
  .sig-btn-sm:hover { background: var(--cs-purple, #3B2F8A); color: #fff; }
  .sig-btn-danger-sm {
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 600;
    border-radius: var(--radius-full, 99px);
    border: 1px solid #dcdcdc;
    color: var(--cs-text-mid, #666);
    background: transparent;
    cursor: pointer;
    min-height: 30px;
    transition: all 0.15s;
  }
  .sig-btn-danger-sm:hover { border-color: var(--cs-red-badge, #ff3535); color: var(--cs-red-badge, #ff3535); }
  .sig-btn-danger-sm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
