<script lang="ts">
  // 상품설명서(PDF) 목록 편집 — 상품 등록 화면과 상품목록 패널('상품설명' 탭)이 같이 쓴다.
  // 올리기: 서버가 발급한 서명 토큰으로 브라우저가 저장소에 직접 업로드(서버 본문 한도 회피). 목록 저장은 호출한 쪽이 맡는다(onchange).
  // 보기: PdfModal(단순 PDF 모달). 정본 규칙: $lib/utils/productManuals.ts
  import PdfModal from '$lib/components/common/PdfModal.svelte'
  import { supabase } from '$lib/services/supabase'
  import { getSupabaseUrl } from '$lib/env/supabasePublic'
  import { csToast } from '$lib/utils/toast'
  import {
    PRODUCT_MANUAL_BUCKET,
    MAX_PRODUCT_MANUALS,
    validateManualUpload,
    manualPublicUrl,
    formatManualSize,
    type ProductManualFile,
  } from '$lib/utils/productManuals'

  interface Props {
    files: ProductManualFile[]
    /** 이미 등록된 대표 상품 id — 없으면 상품 등록 화면(임시 범위) */
    productId?: string | null
    /** 상품 등록 화면이 만든 임시 범위 id(productId 가 없을 때 필수) */
    tempId?: string
    readonly?: boolean
    /** 다른 저장이 진행 중일 때 등 — 모든 조작 잠금 */
    disabled?: boolean
    /** 'form' = 상품 등록 화면 스타일, 'panel' = 상품목록 패널 스타일 */
    variant?: 'form' | 'panel'
    /** 목록이 바뀔 때마다 호출(next = 바뀐 전체 목록, removed = 빠진 항목). 저장은 호출한 쪽이 한다 */
    onchange: (next: ProductManualFile[], removed: ProductManualFile[]) => void | Promise<void>
  }

  let { files, productId = null, tempId = '', readonly = false, disabled = false, variant = 'form', onchange }: Props = $props()

  let uploading = $state(false)
  let viewerOpen = $state(false)
  let viewerIndex = $state(0)
  let addInput = $state<HTMLInputElement | null>(null)
  let replaceInput = $state<HTMLInputElement | null>(null)
  let replaceIndex = $state<number | null>(null)

  const locked = $derived(disabled || uploading)
  const atLimit = $derived(files.length >= MAX_PRODUCT_MANUALS)
  const viewerFile = $derived(viewerOpen ? (files[viewerIndex] ?? null) : null)

  /** PDF 1개를 저장소에 올리고 목록 항목을 만든다. 실패하면 사유를 토스트로 알리고 null */
  async function uploadOne(file: File): Promise<ProductManualFile | null> {
    const check = validateManualUpload(file.type, file.size)
    if (!check.ok) { csToast.error(`${file.name}: ${check.error}`); return null }
    try {
      const res = await fetch('/api/cms/product-manuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: file.type,
          size: file.size,
          ...(productId ? { product_id: productId } : { temp_id: tempId }),
        }),
      })
      const sign = (await res.json().catch(() => ({}))) as { path?: string; token?: string; error?: string }
      if (!res.ok || !sign.path || !sign.token) {
        csToast.error(sign.error ?? '업로드 준비에 실패했어요.')
        return null
      }
      const { error } = await supabase.storage
        .from(PRODUCT_MANUAL_BUCKET)
        .uploadToSignedUrl(sign.path, sign.token, file, { contentType: 'application/pdf' })
      if (error) { csToast.error(`${file.name}: 파일을 올리지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.`); return null }
      return { path: sign.path, name: file.name.slice(0, 120), size: file.size, uploaded_at: new Date().toISOString() }
    } catch {
      csToast.error(`${file.name}: 파일을 올리는 중 오류가 발생했어요.`)
      return null
    }
  }

  /** 등록 화면(임시 범위)에서 빠진 파일은 저장소에서 바로 지운다 — 상품에 저장된 파일은 저장 시 서버가 정리 */
  function cleanupTemp(removed: ProductManualFile[]): void {
    if (productId) return
    for (const f of removed) {
      if (!f.path.startsWith('temp/')) continue
      fetch('/api/cms/product-manuals', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: f.path }),
      }).catch(() => { /* 정리 실패는 화면에 영향 없음 */ })
    }
  }

  async function commit(next: ProductManualFile[], removed: ProductManualFile[]): Promise<void> {
    await onchange(next, removed)
    cleanupTemp(removed)
  }

  async function onAddSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement
    const picked = Array.from(input.files ?? [])
    input.value = ''
    if (picked.length === 0 || locked || readonly) return
    if (!productId && !tempId) { csToast.error('업로드 준비가 되지 않았어요. 새로고침 후 다시 시도해 주세요.'); return }
    const room = MAX_PRODUCT_MANUALS - files.length
    if (picked.length > room) csToast.warning(`상품설명서는 최대 ${MAX_PRODUCT_MANUALS}개까지 등록할 수 있어요. ${room}개만 올립니다.`)
    uploading = true
    try {
      const added: ProductManualFile[] = []
      for (const f of picked.slice(0, Math.max(room, 0))) {
        const one = await uploadOne(f)
        if (one) added.push(one)
      }
      if (added.length > 0) await commit([...files, ...added], [])
    } finally {
      uploading = false
    }
  }

  function startReplace(i: number): void {
    if (locked || readonly) return
    replaceIndex = i
    replaceInput?.click()
  }

  async function onReplaceSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement
    const picked = input.files?.[0] ?? null
    input.value = ''
    const i = replaceIndex
    replaceIndex = null
    if (!picked || i === null || locked || readonly || !files[i]) return
    uploading = true
    try {
      const one = await uploadOne(picked)
      if (!one) return
      const old = files[i]
      await commit(files.map((f, idx) => (idx === i ? one : f)), [old])
    } finally {
      uploading = false
    }
  }

  async function remove(i: number): Promise<void> {
    if (locked || readonly || !files[i]) return
    const old = files[i]
    await commit(files.filter((_, idx) => idx !== i), [old])
  }

  function open(i: number): void {
    viewerIndex = i
    viewerOpen = true
  }
</script>

<div class="pm" class:pm--panel={variant === 'panel'}>
  {#if files.length > 0}
    <ul class="pm-list">
      {#each files as f, i (f.path)}
        <li class="pm-row">
          <span class="pm-chip" aria-hidden="true">PDF</span>
          <button type="button" class="pm-name" onclick={() => open(i)} title="PDF 뷰어로 보기" aria-label={`${f.name} PDF 보기`}>{f.name}</button>
          <span class="pm-size">{formatManualSize(f.size)}</span>
          {#if !readonly}
            <button type="button" class="pm-mini" disabled={locked} onclick={() => startReplace(i)} aria-label={`${f.name} 파일 변경`}>변경</button>
            <button type="button" class="pm-remove" disabled={locked} onclick={() => remove(i)} aria-label={`${f.name} 삭제`}>✕</button>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="pm-empty">{readonly ? '등록된 상품설명서가 없습니다.' : '등록된 상품설명서가 없습니다. PDF 파일을 추가해 주세요.'}</p>
  {/if}

  {#if !readonly}
    <button type="button" class="pm-add" disabled={locked || atLimit} onclick={() => addInput?.click()}>
      {uploading ? '업로드 중...' : '+ 상품설명서 추가'}
    </button>
    <p class="pm-hint">PDF만 · 파일당 10MB 이하 · 최대 {MAX_PRODUCT_MANUALS}개 ({files.length}/{MAX_PRODUCT_MANUALS}) · 고객 상품상세에서도 볼 수 있어요.</p>
    <input bind:this={addInput} type="file" accept="application/pdf" multiple hidden onchange={onAddSelected} />
    <input bind:this={replaceInput} type="file" accept="application/pdf" hidden onchange={onReplaceSelected} />
  {/if}
</div>

{#if viewerFile}
  <PdfModal
    src={manualPublicUrl(viewerFile.path, getSupabaseUrl())}
    title={viewerFile.name}
    downloadUrl={manualPublicUrl(viewerFile.path, getSupabaseUrl())}
    downloadFilename={viewerFile.name}
    onclose={() => (viewerOpen = false)}
  />
{/if}

<style>
  .pm { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
  .pm-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .pm-row {
    display: flex; align-items: center; gap: 10px;
    background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm);
    padding: 6px 8px 6px 12px; min-height: 44px;
  }
  .pm-chip {
    flex-shrink: 0; font: var(--text-pc-script-12); font-weight: 700;
    background: var(--cs-lilac); color: var(--cs-purple);
    border-radius: var(--cms-radius-sm); padding: 3px 8px;
  }
  .pm-name {
    flex: 1; min-width: 0; text-align: left; background: transparent; border: none; padding: 6px 0;
    font: var(--text-pc-body-14); color: var(--cs-text); cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pm-name:hover { color: var(--cs-purple); }
  .pm-size { flex-shrink: 0; font: var(--text-pc-script-12); color: var(--cs-text-light); }

  /* 초소형 라운드 버튼형 — cms-uiux.md §0-10-C 값 그대로 */
  .pm-mini {
    flex-shrink: 0; font-size: 11px; font-weight: 600; padding: 5px 10px;
    border: none; border-radius: var(--radius-full);
    background: var(--cs-white); color: var(--cs-text-mid);
    cursor: pointer; white-space: nowrap; transition: background 0.15s, color 0.15s;
  }
  .pm-mini:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
  .pm-mini:disabled { opacity: 0.5; cursor: default; }

  .pm-remove {
    flex-shrink: 0; width: 32px; height: 32px; min-height: 32px;
    border: none; border-radius: var(--radius-sm); background: transparent;
    color: var(--cs-text-light); cursor: pointer; transition: background 0.12s, color 0.12s;
  }
  .pm-remove:hover:not(:disabled) { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .pm-remove:disabled { opacity: 0.35; cursor: not-allowed; }

  /* 추가 버튼 — 상품 등록 화면은 '+ 구성품 추가'(.add-btn), 패널은 '.btn-add-dashed' 와 같은 모양 */
  .pm-add {
    align-self: flex-start; padding: 8px 16px; min-height: 44px;
    border: 1.5px dashed rgba(59,47,138,0.25); border-radius: var(--radius-md);
    background: transparent; color: var(--cs-purple); font: var(--text-pc-body-14);
    cursor: pointer; transition: background 0.12s, border-color 0.12s;
  }
  .pm-add:hover:not(:disabled) { background: var(--cs-lilac); border-color: var(--cs-purple); }
  .pm-add:disabled { opacity: 0.5; cursor: not-allowed; }
  .pm--panel .pm-add {
    align-self: stretch; padding: 8px; min-height: 36px;
    border-color: var(--cs-border); border-radius: var(--cms-radius-sm);
    color: var(--cs-text-mid); font: var(--text-pc-script-12);
  }
  .pm--panel .pm-add:hover:not(:disabled) { background: transparent; border-color: var(--cs-purple); color: var(--cs-purple); }

  .pm-empty { margin: 0; font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .pm-hint { margin: 0; font: var(--text-pc-script-12); color: var(--cs-text-light); font-weight: 400; }
</style>
