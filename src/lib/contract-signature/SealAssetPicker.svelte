<script lang="ts">
  /**
   * SealAssetPicker.svelte — 발행자 서명/직인 선택 UI
   * Phase 8-B-3
   *
   * 발행(send-chat) 시점에 관리자가:
   *   (a) 사전 등록된 자산 중 선택 → asset_id 반환
   *   (b) 그 자리에서 직접 서명   → signature_data(base64 PNG) 반환
   */
  import SignatureCanvas from '$lib/components/common/SignatureCanvas.svelte'
  import type { SignatureData } from '$lib/components/common/SignatureCanvas.svelte'

  interface SignatureAsset {
    id: string
    asset_type: 'signature' | 'seal'
    image_url: string
    label: string | null
    is_default: boolean
  }

  interface Props {
    contractId: string
    signatureType: 'personal_signature' | 'company_seal'
    oncancel: () => void
    oncomplete: (result: { asset_id?: string; signature_data?: string }) => void
  }

  let { contractId, signatureType, oncancel, oncomplete }: Props = $props()

  let mode         = $state<'asset' | 'direct'>('asset')
  let assets       = $state<SignatureAsset[]>([])
  let loading      = $state(true)
  let selectedId   = $state<string | null>(null)
  let sigData      = $state<SignatureData | null>(null)
  let sigValid     = $state(false)
  let submitting   = $state(false)
  let error        = $state('')

  $effect(() => {
    // signatureType을 $effect 내부에서 직접 참조 — 반응형 추적 보장
    // (prop 변경 시 $effect가 재실행되어 올바른 필터로 자산 목록 재로드)
    const filter: 'seal' | 'signature' = signatureType === 'company_seal' ? 'seal' : 'signature'
    // 자산 목록 로드
    fetch(`/api/cms/signature-assets?contract_id=${encodeURIComponent(contractId)}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => {
        assets = (data as SignatureAsset[]).filter(a => a.asset_type === filter)
        // 기본값 자동 선택
        const defaultAsset = assets.find(a => a.is_default)
        if (defaultAsset) selectedId = defaultAsset.id
      })
      .catch(() => {})
      .finally(() => { loading = false })
  })

  function handleSigChange(valid: boolean, data: SignatureData | null) {
    sigValid = valid
    sigData  = data
  }

  async function handleSubmit() {
    error = ''
    if (mode === 'asset' && !selectedId) {
      error = '서명/직인을 선택해 주세요.'; return
    }
    if (mode === 'direct' && !sigValid) {
      error = '서명을 완성해 주세요.'; return
    }

    submitting = true
    try {
      const body: Record<string, unknown> = {
        signature_type: signatureType,
      }
      if (mode === 'asset') {
        body.asset_id = selectedId
      } else {
        body.signature_data = sigData?.pngBase64 ?? null
      }

      const res = await fetch(`/api/cms/contracts/${contractId}/issuer-sign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })

      if (!res.ok) {
        const { error: errMsg } = await res.json().catch(() => ({ error: '서명 등록 실패' })) as { error: string }
        error = errMsg; return
      }

      oncomplete(
        mode === 'asset'
          ? { asset_id: selectedId ?? undefined }
          : { signature_data: sigData?.pngBase64 ?? undefined },
      )
    } catch {
      error = '네트워크 오류가 발생했습니다.'
    } finally {
      submitting = false
    }
  }
</script>

<div class="picker">
  <div class="picker-header">
    <h3 class="picker-title">
      {signatureType === 'company_seal' ? '법인직인 등록' : '발행자 서명 등록'}
    </h3>
    <button class="picker-close" onclick={oncancel} aria-label="닫기">✕</button>
  </div>

  <!-- 모드 선택 -->
  <div class="mode-tabs">
    <button
      class="mode-tab"
      class:active={mode === 'asset'}
      onclick={() => { mode = 'asset'; error = '' }}
    >
      등록된 {signatureType === 'company_seal' ? '직인' : '서명'} 선택
    </button>
    <button
      class="mode-tab"
      class:active={mode === 'direct'}
      onclick={() => { mode = 'direct'; error = '' }}
    >
      직접 서명
    </button>
  </div>

  {#if mode === 'asset'}
    {#if loading}
      <p class="picker-hint">자산 로딩 중...</p>
    {:else if assets.length === 0}
      <p class="picker-hint">
        등록된 {signatureType === 'company_seal' ? '직인' : '서명'} 자산이 없습니다.<br>
        <a href="/cms/set/signature" target="_blank" class="picker-link">자산 등록하기 →</a>
      </p>
    {:else}
      <div class="asset-grid">
        {#each assets as asset (asset.id)}
          <button
            class="asset-card"
            class:selected={selectedId === asset.id}
            onclick={() => selectedId = asset.id}
          >
            <img src={asset.image_url} alt={asset.label ?? '서명'} class="asset-img" />
            <span class="asset-label">{asset.label ?? '(이름 없음)'}</span>
            {#if asset.is_default}
              <span class="asset-badge">기본</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <!-- 직접 서명 -->
    <div class="direct-sig-wrap">
      <SignatureCanvas
        width={500}
        height={150}
        onchange={handleSigChange}
      />
    </div>
  {/if}

  {#if error}
    <p class="picker-error" role="alert">{error}</p>
  {/if}

  <div class="picker-actions">
    <button class="picker-btn-cancel" onclick={oncancel}>취소</button>
    <button
      class="picker-btn-confirm"
      onclick={handleSubmit}
      disabled={submitting || (mode === 'asset' && assets.length === 0)}
    >
      {submitting ? '등록 중...' : '서명 등록 후 발송'}
    </button>
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .picker-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
  }
  .picker-close {
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    color: var(--cs-text-mid, #666);
    padding: 4px 8px;
    min-height: 32px;
  }
  .mode-tabs {
    display: flex;
    gap: 6px;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    padding-bottom: 12px;
  }
  .mode-tab {
    padding: 6px 16px;
    border-radius: var(--radius-full, 99px);
    border: 1.5px solid #dcdcdc;
    background: #fff;
    font-size: 13px;
    font-weight: 600;
    color: var(--cs-text-mid, #666);
    cursor: pointer;
    min-height: 36px;
    transition: all 0.15s;
  }
  .mode-tab.active {
    background: var(--cs-purple, #3B2F8A);
    border-color: var(--cs-purple, #3B2F8A);
    color: #fff;
  }
  .picker-hint {
    font-size: 14px;
    color: var(--cs-text-mid, #666);
    line-height: 1.6;
    margin: 0;
    text-align: center;
    padding: 16px 0;
  }
  .picker-link { color: var(--cs-purple, #3B2F8A); text-decoration: underline; }
  .asset-grid {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .asset-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px;
    border: 2px solid #dcdcdc;
    border-radius: var(--radius-sm, 8px);
    background: #fff;
    cursor: pointer;
    min-width: 100px;
    position: relative;
    transition: border-color 0.15s;
  }
  .asset-card.selected { border-color: var(--cs-purple, #3B2F8A); }
  .asset-img { max-width: 80px; max-height: 60px; object-fit: contain; }
  .asset-label { font-size: 12px; font-weight: 600; color: var(--cs-text); text-align: center; }
  .asset-badge {
    position: absolute;
    top: 4px; right: 4px;
    font-size: 10px;
    background: var(--cs-purple, #3B2F8A);
    color: #fff;
    padding: 2px 6px;
    border-radius: var(--radius-full, 99px);
    font-weight: 700;
  }
  .direct-sig-wrap {
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-sm, 8px);
    overflow: hidden;
  }
  .picker-error {
    font-size: 13px;
    color: var(--cs-red-badge, #ff3535);
    margin: 0;
    padding: 8px 12px;
    background: #fff0f0;
    border-radius: var(--radius-sm, 8px);
  }
  .picker-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    border-top: 1px solid var(--cs-lilac, #ECEBF4);
    padding-top: 16px;
  }
  .picker-btn-cancel {
    padding: 8px 20px;
    border-radius: var(--radius-md, 15px);
    border: 1px solid #dcdcdc;
    background: #fff;
    color: var(--cs-text-mid, #666);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    min-height: 40px;
  }
  .picker-btn-confirm {
    padding: 8px 20px;
    border-radius: var(--radius-md, 15px);
    border: none;
    background: var(--cs-purple, #3B2F8A);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    min-height: 40px;
    transition: opacity 0.15s;
  }
  .picker-btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
