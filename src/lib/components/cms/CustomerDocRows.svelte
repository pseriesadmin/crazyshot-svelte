<script lang="ts">
  // 본인증명·외국인증명 서류 행(유형 배지·등록일·승인 버튼·파일 목록 보기/다운로드/재등록·뷰어) — 고객 관리 패널(CustomerDetailPanel)과
  // 예약 패널 고객정보 탭(RentalDetailPanel)이 같은 컴포넌트를 쓴다(2026-10-15, Stephen: "두 곳에서 동기화"). 한 곳을 고치면 두 화면이 함께 바뀐다.
  // 파일 열람은 클릭 시점에 서버가 발급하는 60초 서명 URL로만(서류 비공개 정책) — 이 컴포넌트는 서류 URL·경로를 props로 받지 않고 개수·종류만 받는다.
  import { tick, untrack } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import { validateUploadFile } from '$lib/utils/fileValidation'
  import { identityRequiredMet, foreignRequiredMet } from '$lib/utils/docApproval'
  import {
    IDENTITY_TYPE_LABELS, FOREIGN_TYPE_LABELS, identityTypeLabel, identityFileLabel,
    foreignTypeLabel, foreignFileLabel, formatDocDate, isDocExpired, needsDocApproval,
  } from '$lib/utils/customerDocLabels'

  interface Props {
    userId: string
    memberCode?: string | null
    identityCount: number
    identityTypes: string[] | null
    identityVerifiedAt: string | null
    identityApprovedAt: string | null
    isForeign: boolean
    foreignCount: number
    foreignTypes: string[] | null
    foreignStayType?: string | null
    foreignVerifiedAt: string | null
    foreignApprovedAt: string | null
    /** manager 이상 — 승인·재등록 버튼 노출(서버가 다시 검사한다) */
    canManage?: boolean
    foreignLabel?: string
    /** 승인·재등록·승인취소 성공 후 호출 — 부모가 데이터를 다시 불러온다 */
    onchanged?: () => void | Promise<void>
  }
  let {
    userId, memberCode = null,
    identityCount, identityTypes, identityVerifiedAt, identityApprovedAt,
    isForeign, foreignCount, foreignTypes, foreignStayType = null, foreignVerifiedAt, foreignApprovedAt,
    canManage = true, foreignLabel = '외국인 증명', onchanged,
  }: Props = $props()

  type DocType = 'identity' | 'foreign'

  // ── 뷰어·다운로드(서명 URL) ──
  let viewerUrl = $state<string | null>(null)
  let viewerIsPdf = $state(false)
  let viewerTitle = $state('본인증명 문서')
  let signing = $state(false)

  async function requestSignedDocUrl(type: DocType, index: number, downloadName?: string): Promise<{ url: string; isPdf: boolean } | null> {
    if (signing) return null
    signing = true
    try {
      const qs = new URLSearchParams({ type, index: String(index) })
      if (downloadName) qs.set('download', downloadName)
      const res = await fetch(`/api/cms/customers/${userId}/doc-url?${qs.toString()}`)
      const data = await res.json().catch(() => null) as { ok?: boolean; url?: string; isPdf?: boolean; error?: string } | null
      if (!res.ok || !data?.ok || !data.url) {
        csToast.error(data?.error ?? '파일을 열 수 없습니다.')
        return null
      }
      return { url: data.url, isPdf: !!data.isPdf }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
      return null
    } finally {
      signing = false
    }
  }

  async function openDoc(type: DocType, index: number, title: string) {
    const signed = await requestSignedDocUrl(type, index)
    if (!signed) return
    viewerTitle = title
    viewerIsPdf = signed.isPdf
    viewerUrl = signed.url
  }

  async function downloadDoc(type: DocType, index: number, filename: string) {
    const signed = await requestSignedDocUrl(type, index, filename)
    if (!signed) return
    const a = document.createElement('a')
    a.href = signed.url
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  // ── 재등록 요청 — 고객이 등록한 서류가 불충분할 때 고객 채팅에 요청 카드 + 푸시 + SMS를 보낸다(2026-10-15) ──
  let requesting = $state<Record<DocType, boolean>>({ identity: false, foreign: false })
  let approving = $state<Record<DocType, boolean>>({ identity: false, foreign: false })

  async function requestReregister(type: DocType) {
    if (requesting[type]) return
    requesting[type] = true
    try {
      const res = await fetch(`/api/cms/customers/${userId}/doc-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (data?.ok) csToast.success('고객에게 재등록 요청을 보냈어요. (채팅 카드·푸시·문자)')
      else csToast.error(data?.error ?? '재등록 요청에 실패했습니다.')
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      requesting[type] = false
    }
  }

  // ── 직접 등록(관리자 대리 등록 — 서류 종류 1건만 교체) ──
  const DOC_ACCEPT = 'image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf'
  let uploadOpen = $state<Record<DocType, boolean>>({ identity: false, foreign: false })
  // 업로드 상자를 열고 닫을 때마다 올려 서류 종류 선택칸(SuggestPicker)을 새로 만든다 — 이전 선택칸의 펼침 상태가 남지 않게
  let pickerKey = $state<Record<DocType, number>>({ identity: 0, foreign: 0 })
  let uploadSlot = $state<Record<DocType, string | null>>({ identity: null, foreign: null })
  let pickedFile = $state<Record<DocType, File | null>>({ identity: null, foreign: null })
  let previewUrl = $state<Record<DocType, string | null>>({ identity: null, foreign: null })
  let fileError = $state<Record<DocType, string>>({ identity: '', foreign: '' })
  let uploading = $state<Record<DocType, boolean>>({ identity: false, foreign: false })

  const IDENTITY_SLOT_OPTIONS: SuggestPickerOption[] = ['student', 'resident', 'resident_copy', 'driver', 'other']
    .map(id => ({ id, label: IDENTITY_TYPE_LABELS[id] ?? id }))
  const FOREIGN_SLOT_OPTIONS: SuggestPickerOption[] = [
    'passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket',
    'arc_front', 'arc_back', 'foreign_fact_cert',
  ].map(id => ({ id, label: FOREIGN_TYPE_LABELS[id] ?? id }))

  // 서류 종류를 선택하면(또는 행의 [직접 등록]으로 종류가 미리 정해지면) 파일 선택 창을 바로 연다
  let fileInputs = $state<Record<DocType, HTMLInputElement | null>>({ identity: null, foreign: null })
  const lastSlot: Record<DocType, string | null> = { identity: null, foreign: null }
  // 행의 [직접 등록]으로 종류가 미리 정해진 경우에는 창을 자동으로 열지 않는다 — 사용자가 종류를 바꾸거나 확인할 수 있게(2026-10-15)
  const skipAuto: Record<DocType, boolean> = { identity: false, foreign: false }
  $effect(() => {
    for (const t of ['identity', 'foreign'] as const) {
      const cur = uploadSlot[t]
      if (cur && skipAuto[t]) { skipAuto[t] = false; lastSlot[t] = cur; continue }
      if (cur && cur !== lastSlot[t] && !untrack(() => pickedFile[t])) {
        // 이미 등록된 종류를 고르면 새 파일이 기존 파일을 교체한다 — 화면 목록이 그대로 보여 등록이 안 된 것으로 오해하기 쉬워 미리 알린다
        const registered = (t === 'identity' ? identityTypes : foreignTypes) ?? []
        if (registered.includes(cur)) {
          const label = (t === 'identity' ? IDENTITY_TYPE_LABELS : FOREIGN_TYPE_LABELS)[cur] ?? cur
          csToast.warning(`'${label}'은 이미 등록돼 있어요. 새 파일을 등록하면 기존 파일이 교체됩니다.`)
        }
        // 선택칸의 펼침 목록이 닫히도록 포커스를 먼저 푼다
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        void tick().then(() => fileInputs[t]?.click())
      }
      lastSlot[t] = cur
    }
  })

  $effect(() => {
    return () => {
      for (const t of ['identity', 'foreign'] as const) {
        const u = previewUrl[t]
        if (u) URL.revokeObjectURL(u)
      }
    }
  })

  function handleFile(e: Event, type: DocType) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0] ?? null
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      fileError[type] = '파일 크기는 10MB 이하여야 합니다.'
      pickedFile[type] = null
      input.value = ''
      return
    }
    const validation = validateUploadFile(file)
    if (!validation.ok) {
      fileError[type] = validation.error ?? '지원하지 않는 파일입니다.'
      pickedFile[type] = null
      input.value = ''
      return
    }
    fileError[type] = ''
    pickedFile[type] = file
    const prev = previewUrl[type]
    if (prev) URL.revokeObjectURL(prev)
    previewUrl[type] = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
  }

  function cancelUpload(type: DocType) {
    pickerKey[type] += 1
    uploadOpen[type] = false
    uploadSlot[type] = null
    pickedFile[type] = null
    fileError[type] = ''
    const prev = previewUrl[type]
    if (prev) { URL.revokeObjectURL(prev); previewUrl[type] = null }
  }

  async function submitUpload(type: DocType) {
    const file = pickedFile[type]
    const slot = uploadSlot[type]
    if (!file) return
    if (!slot) { csToast.warning('교체할 서류 종류를 선택해주세요.'); return }
    uploading[type] = true
    try {
      const fd = new FormData()
      fd.append('user_id', userId)
      fd.append('type', type)
      fd.append('file', file)
      fd.append('slot_type', slot)
      const res = await fetch('/api/cms/upload-doc', { method: 'POST', body: fd })
      const data = await res.json() as { ok: boolean; error?: string }
      if (data.ok) {
        const wasRegistered = ((type === 'identity' ? identityTypes : foreignTypes) ?? []).includes(slot)
        csToast.success(wasRegistered ? '기존 서류를 새 파일로 교체했어요. 승인은 다시 받아야 해요.' : '증명서가 등록되었습니다.')
        await onchanged?.()
        cancelUpload(type)
      } else {
        csToast.error(data.error ?? '업로드 실패')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      uploading[type] = false
    }
  }

  // 승인된 서류를 직접 등록하려면 먼저 승인을 취소해 고객 화면의 수정·삭제 잠금을 푼다(고객 관리 패널과 같은 동작)
  async function toggleUpload(type: DocType, slot: string | null = null) {
    if (uploadOpen[type]) { cancelUpload(type); return }
    const approvedAt = type === 'identity' ? identityApprovedAt : foreignApprovedAt
    const verifiedAt = type === 'identity' ? identityVerifiedAt : foreignVerifiedAt
    const isApproved = !!approvedAt && (!verifiedAt || new Date(approvedAt).getTime() >= new Date(verifiedAt).getTime())
    if (isApproved) {
      // 승인 취소는 되돌릴 수 없고 파일을 고르지 않고 닫아도 복구되지 않는다 — 먼저 확인받는다
      if (!window.confirm('이미 승인된 서류입니다. 직접 등록하려면 승인이 취소되고 다시 승인받아야 해요. 계속할까요?')) return
      try {
        const res = await fetch('/api/cms/revoke-doc-approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, type }),
        })
        const data = await res.json() as { ok: boolean; error?: string }
        if (!data.ok) { csToast.error(data.error ?? '승인 취소 실패'); return }
        csToast.success('승인이 취소되었습니다. 고객 화면에서 수정·삭제할 수 있습니다.')
        await onchanged?.()
      } catch {
        csToast.error('네트워크 오류가 발생했습니다.')
        return
      }
    }
    const options = type === 'identity' ? IDENTITY_SLOT_OPTIONS : FOREIGN_SLOT_OPTIONS
    const preset = slot && options.some(o => o.id === slot) ? slot : null
    pickerKey[type] += 1
    skipAuto[type] = !!preset
    uploadSlot[type] = preset
    uploadOpen[type] = true
  }

  async function approve(type: DocType) {
    if (approving[type]) return
    approving[type] = true
    try {
      const res = await fetch('/api/cms/approve-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, type }),
      })
      const data = await res.json() as { ok: boolean; error?: string; contractsSent?: number; contractsSkipped?: string[] }
      if (data.ok) {
        csToast.success(data.contractsSent ? `승인 처리되었습니다. 예약승인 대기 중이던 전자계약 ${data.contractsSent}건을 고객에게 발송했어요.` : '승인 처리되었습니다.')
        for (const m of data.contractsSkipped ?? []) csToast.warning(m)
        await onchanged?.()
      } else {
        csToast.error(data.error ?? '승인 실패')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      approving[type] = false
    }
  }

  const identityDocsReady = $derived(identityRequiredMet(identityTypes))
  const foreignDocsReady = $derived(foreignRequiredMet(foreignTypes))
  const fileBase = $derived(memberCode ?? userId)
</script>

<!-- 본인 증명 -->
<div class="dr-row">
  <span class="dr-label">본인 증명</span>
  {#if identityCount > 0}
    <span class="doc-type-badge-cms">{identityTypeLabel(identityTypes)}</span>
  {:else}
    <span class="info-val-empty">미등록</span>
  {/if}
  {#if identityCount > 0 && identityVerifiedAt}
    <span class="identity-date">
      {formatDocDate(identityVerifiedAt)}
      {#if isDocExpired(identityVerifiedAt)}<span class="identity-expired">기간경과</span>{/if}
    </span>
  {/if}
  {#if canManage && identityCount === 0}
    <button type="button" class="btn-reupload" disabled={requesting.identity} onclick={() => requestReregister('identity')} title="고객에게 재등록 요청(채팅 카드·푸시·문자)">{requesting.identity ? '요청 중...' : '재요청'}</button>
    <button type="button" class="btn-reupload" class:btn-reupload-cancel={uploadOpen.identity} onclick={() => toggleUpload('identity', null)} title="관리자가 서류를 직접 등록">{uploadOpen.identity ? '취소' : '직접 등록'}</button>
  {/if}
  {#if identityCount > 0 && needsDocApproval(identityVerifiedAt, identityApprovedAt)}
    {#if !identityDocsReady}
      <span class="doc-incomplete-hint">필수 서류 미비</span>
    {:else if canManage}
      <button type="button" class="btn-approve" disabled={approving.identity} onclick={() => approve('identity')}>{approving.identity ? '처리 중...' : '승인'}</button>
    {/if}
  {:else if identityCount > 0 && identityApprovedAt}
    <span class="badge-approved">승인완료</span>
  {/if}
</div>
{#if identityCount > 0}
  <div class="doc-file-list">
    {#each Array.from({ length: identityCount }, (_, i) => i) as i (i)}
      <div class="doc-file-row">
        <span class="doc-file-label">{identityFileLabel(identityTypes, i, identityCount)}</span>
        <button type="button" class="btn-file-view" onclick={() => openDoc('identity', i, '본인증명 문서')}>보기</button>
        <button type="button" class="btn-file-download" onclick={() => downloadDoc('identity', i, `${fileBase}_identity_${i + 1}`)} aria-label="본인증명 파일 다운로드" title="다운로드">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        {#if canManage}
          <button type="button" class="btn-reupload" disabled={requesting.identity} onclick={() => requestReregister('identity')} title="고객에게 재등록 요청(채팅 카드·푸시·문자)">{requesting.identity ? '요청 중...' : '재요청'}</button>
          <button type="button" class="btn-reupload" class:btn-reupload-cancel={uploadOpen.identity} onclick={() => toggleUpload('identity', identityTypes?.[i] ?? null)} title="관리자가 서류를 직접 등록">{uploadOpen.identity ? '취소' : '직접 등록'}</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if uploadOpen.identity}
  {@render uploadBox('identity', IDENTITY_SLOT_OPTIONS)}
{/if}

<!-- 외국인 증명 -->
<div class="dr-row">
  <span class="dr-label">{foreignLabel}</span>
  {#if foreignCount > 0}
    <span class="doc-type-badge-cms">{foreignTypeLabel(foreignStayType, foreignTypes)}</span>
  {:else if isForeign}
    <span class="info-val-empty">미등록</span>
  {/if}
  {#if isForeign && foreignCount > 0 && foreignVerifiedAt}
    <span class="identity-date">
      {formatDocDate(foreignVerifiedAt)}
      {#if isDocExpired(foreignVerifiedAt)}<span class="identity-expired">기간경과</span>{/if}
    </span>
  {/if}
  {#if canManage && isForeign && foreignCount === 0}
    <button type="button" class="btn-reupload" disabled={requesting.foreign} onclick={() => requestReregister('foreign')} title="고객에게 재등록 요청(채팅 카드·푸시·문자)">{requesting.foreign ? '요청 중...' : '재요청'}</button>
    <button type="button" class="btn-reupload" class:btn-reupload-cancel={uploadOpen.foreign} onclick={() => toggleUpload('foreign', null)} title="관리자가 서류를 직접 등록">{uploadOpen.foreign ? '취소' : '직접 등록'}</button>
  {/if}
  {#if isForeign && foreignCount > 0 && needsDocApproval(foreignVerifiedAt, foreignApprovedAt)}
    {#if !foreignDocsReady}
      <span class="doc-incomplete-hint">필수 서류 미비</span>
    {:else if canManage}
      <button type="button" class="btn-approve" disabled={approving.foreign} onclick={() => approve('foreign')}>{approving.foreign ? '처리 중...' : '승인'}</button>
    {/if}
  {:else if isForeign && foreignCount > 0 && foreignApprovedAt}
    <span class="badge-approved">승인완료</span>
  {/if}
</div>
{#if foreignCount > 0}
  <div class="doc-file-list">
    {#each Array.from({ length: foreignCount }, (_, i) => i) as i (i)}
      <div class="doc-file-row">
        <span class="doc-file-label">{foreignFileLabel(foreignTypes, i, foreignCount)}</span>
        <button type="button" class="btn-file-view" onclick={() => openDoc('foreign', i, '외국인증명 문서')}>보기</button>
        <button type="button" class="btn-file-download" onclick={() => downloadDoc('foreign', i, `${fileBase}_foreign_${i + 1}`)} aria-label="외국인증명 파일 다운로드" title="다운로드">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        {#if canManage}
          <button type="button" class="btn-reupload" disabled={requesting.foreign} onclick={() => requestReregister('foreign')} title="고객에게 재등록 요청(채팅 카드·푸시·문자)">{requesting.foreign ? '요청 중...' : '재요청'}</button>
          <button type="button" class="btn-reupload" class:btn-reupload-cancel={uploadOpen.foreign} onclick={() => toggleUpload('foreign', foreignTypes?.[i] ?? null)} title="관리자가 서류를 직접 등록">{uploadOpen.foreign ? '취소' : '직접 등록'}</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}


{#if uploadOpen.foreign}
  {@render uploadBox('foreign', FOREIGN_SLOT_OPTIONS)}
{/if}

{#snippet uploadBox(type: DocType, options: SuggestPickerOption[])}
  <div class="reupload-box">
    <p class="reupload-hint">PNG · JPEG · WebP · HEIF · PDF (최대 10MB)</p>
    <label for="doc-slot-{type}-{userId}" class="reupload-slot-label">서류 종류 — 선택한 종류의 서류 1건만 교체되고 다른 서류는 유지돼요</label>
    {#key pickerKey[type]}
    <SuggestPicker id="doc-slot-{type}-{userId}" bind:selectedId={uploadSlot[type]} {options} placeholder="서류 종류 선택" listLabel="서류 종류" variant="generic" minChars={0}>
      {#snippet field(c)}
        <input type="text" class="f-input" id={c.id} placeholder={c.placeholder}
          value={c.value} oninput={c.oninput} onkeydown={c.onkeydown}
          onfocus={c.onfocus} onblur={c.onblur}
          aria-autocomplete={c.ariaAutocomplete} aria-expanded={c.ariaExpanded}
          aria-controls={c.ariaControls} autocomplete="off" />
      {/snippet}
    </SuggestPicker>
    {/key}
    <!-- 서류 종류를 고르면 파일 선택 창이 바로 열린다(아래 effect). 창을 닫았거나 파일을 바꾸려는 경우를 위해 종류 선택 후에만 보이는 보조 버튼을 둔다. -->
    <input type="file" accept={DOC_ACCEPT} class="sr-only" bind:this={fileInputs[type]} onchange={(e) => handleFile(e, type)} />
    {#if uploadSlot[type]}
      <button type="button" class="btn-file-pick" onclick={() => fileInputs[type]?.click()}>{pickedFile[type] ? '파일 변경' : '파일 선택'}</button>
    {/if}
    {#if pickedFile[type]}
      <div class="reupload-preview">
        {#if previewUrl[type]}
          <img src={previewUrl[type]} alt="미리보기" class="reupload-img" />
        {:else}
          <span class="reupload-pdf-name">{pickedFile[type]?.name}</span>
        {/if}
      </div>
    {/if}
    {#if pickedFile[type] && !uploadSlot[type]}<p class="reupload-error" role="status">서류 종류를 목록에서 선택해야 등록할 수 있어요.</p>{/if}
    {#if fileError[type]}<p class="reupload-error" role="alert">{fileError[type]}</p>{/if}
    <div class="reupload-actions">
      <button type="button" class="btn-doc-confirm" disabled={!pickedFile[type] || !uploadSlot[type] || uploading[type]} onclick={() => submitUpload(type)}>{uploading[type] ? '업로드 중...' : '등록 확인'}</button>
      <button type="button" class="btn-doc-cancel" onclick={() => cancelUpload(type)}>취소</button>
    </div>
  </div>
{/snippet}

{#if viewerUrl}
  <div class="doc-viewer-backdrop" role="presentation" onclick={() => (viewerUrl = null)}>
    <div class="doc-viewer-dialog" role="dialog" aria-modal="true" aria-label="{viewerTitle} 보기" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="doc-viewer-header">
        <span class="doc-viewer-title">{viewerTitle}</span>
        <button type="button" class="doc-viewer-close" onclick={() => (viewerUrl = null)} aria-label="닫기">✕</button>
      </div>
      <div class="doc-viewer-body">
        {#if viewerIsPdf}
          <iframe src={viewerUrl} title={viewerTitle} class="doc-viewer-iframe"></iframe>
        {:else}
          <img src={viewerUrl} alt={viewerTitle} class="doc-viewer-img" />
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* 행 레이아웃 — 부모 패널이 --dr-row-pad·--dr-label-w·--dr-indent·--dr-row-border로 자기 info-row 규격에 맞춘다 */
  .dr-row {
    display: flex; align-items: center; gap: 12px;
    padding: var(--dr-row-pad, 6px 0);
    border-bottom: 1px solid var(--dr-row-border, var(--cs-surface-gray));
  }
  .dr-label {
    flex: 0 0 var(--dr-label-w, 80px);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-weight: var(--dr-label-weight, 400);
  }
  .info-val-empty { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .doc-type-badge-cms {
    display: inline-flex; align-items: center; height: 22px; padding: 0 8px;
    background: var(--cs-purple-op10); color: var(--cs-purple); border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); font-weight: 700; white-space: nowrap;
  }
  .identity-date { display: inline-flex; align-items: center; gap: 6px; font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .identity-expired {
    display: inline-flex; align-items: center; height: 20px; padding: 0 7px;
    background: rgba(255,53,53,0.10); color: var(--cs-red-badge); border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); font-weight: 700;
  }
  .doc-file-list { margin-left: var(--dr-indent, 92px); display: flex; flex-direction: column; gap: 4px; padding: 4px 0 8px; }
  .doc-file-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--cs-surface-gray); border-radius: var(--radius-sm); }
  .doc-file-label { font: var(--text-pc-script-12); color: var(--cs-text-light); min-width: 40px; flex-shrink: 0; }
  .btn-file-view {
    height: 24px; padding: 0 8px; background: var(--cs-purple-op10); color: var(--cs-purple); border: none;
    border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700; cursor: pointer;
    white-space: nowrap; flex-shrink: 0; margin-left: auto;
  }
  .btn-file-view:hover { background: rgba(59,47,138,0.12); }
  .btn-file-download {
    display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
    background: none; border: none; border-radius: var(--radius-sm); color: var(--cs-text-mid);
    cursor: pointer; flex-shrink: 0; transition: background 0.12s, color 0.12s;
  }
  .btn-file-download:hover { background: var(--cs-purple-op10); color: var(--cs-purple); }
  .btn-reupload {
    height: 22px; padding: 0 8px; background: rgba(59,47,138,0.08); color: var(--cs-purple); border: none;
    border-radius: var(--radius-sm); font: var(--text-pc-descript-10); font-weight: 700; cursor: pointer;
    white-space: nowrap; flex-shrink: 0; transition: background 0.12s;
  }
  .btn-reupload:hover { background: rgba(59,47,138,0.15); }
  .btn-reupload.btn-reupload-cancel { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .btn-reupload.btn-reupload-cancel:hover { background: rgba(255,53,53,0.14); }
  /* DetailPanel 실행 버튼(cms-uiux.md §0-10-F) */
  .btn-approve {
    margin-left: auto; min-width: 78px; text-align: center; flex-shrink: 0; font-size: 12px; font-weight: 700;
    line-height: 1.4; padding: 8px 14px; border: 1px solid var(--cs-text-mid); border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray); color: var(--cs-text-mid); cursor: pointer; white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .btn-approve:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
  .btn-approve:disabled { opacity: 0.5; cursor: default; }
  .doc-incomplete-hint { margin-left: auto; flex-shrink: 0; font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-warning); }
  .badge-approved {
    display: inline-flex; align-items: center; height: 20px; padding: 0 7px; background: rgba(16,185,129,0.10);
    color: var(--cs-success-light); border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700;
  }
  .reupload-box { margin-left: var(--dr-indent, 92px); padding: 12px 14px; background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm); border: 1px solid var(--cs-lilac); display: flex; flex-direction: column; gap: 8px; }
  .reupload-slot-label { font: var(--text-pc-descript-10); color: var(--cs-text-mid); }
  .reupload-hint { font: var(--text-pc-descript-10); color: var(--cs-text-light); margin: 0; }
  .f-input { background: var(--cs-white); border: none; border-radius: var(--radius-sm); padding: 8px 12px; font: var(--text-pc-body-14); color: var(--cs-text); width: 100%; box-sizing: border-box; }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .btn-file-pick { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; background: var(--cs-white); border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm); font: var(--text-pc-script-12); color: var(--cs-text); cursor: pointer; width: fit-content; }
  .btn-file-pick:hover { background: var(--cs-purple-op10); border-color: var(--cs-purple); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border-width: 0; }
  .reupload-preview { display: flex; align-items: center; }
  .reupload-img { max-width: 120px; max-height: 80px; object-fit: contain; border-radius: var(--cms-radius-sm); border: 1px solid var(--cs-lilac); }
  .reupload-pdf-name { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .reupload-error { font: var(--text-pc-script-12); color: var(--cs-red-badge); margin: 0; }
  .reupload-actions { display: flex; gap: 8px; align-items: center; }
  .btn-doc-confirm { display: inline-flex; align-items: center; height: 30px; padding: 0 14px; background: var(--cs-purple); color: var(--cs-white); border: none; border-radius: var(--cms-radius-sm); font: var(--text-pc-script-12); font-weight: 700; cursor: pointer; white-space: nowrap; }
  .btn-doc-confirm:hover { background: var(--cs-purple-hover); }
  .btn-doc-confirm:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
  .btn-doc-cancel { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; background: var(--cs-white); color: var(--cs-text-mid); border: 1px solid var(--cs-lilac); border-radius: var(--cms-radius-sm); font: var(--text-pc-script-12); cursor: pointer; white-space: nowrap; }
  .btn-doc-cancel:hover { background: var(--cs-surface-gray); }
  .btn-reupload.btn-reupload-cancel { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .btn-reupload:disabled { opacity: 0.5; cursor: default; }
  /* 본인증명 파일 뷰어 모달 */
  .doc-viewer-backdrop {
    position: fixed; inset: 0; z-index: 400;
    background: rgba(16,11,50,0.72);
    display: flex; align-items: center; justify-content: center;
  }
  .doc-viewer-dialog {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    display: flex; flex-direction: column;
    width: min(860px, calc(100vw - 40px));
    max-height: calc(100vh - 80px);
    overflow: hidden;
  }
  .doc-viewer-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #ECEBF4;
    flex-shrink: 0;
  }
  .doc-viewer-title {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }
  .doc-viewer-close {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px;
    background: none; border: none;
    border-radius: var(--radius-sm);
    font-size: 14px; color: var(--cs-text-mid);
    cursor: pointer;
    transition: background 0.12s;
  }
  .doc-viewer-close:hover { background: rgba(59,47,138,0.08); color: var(--cs-text); }
  .doc-viewer-body {
    flex: 1; overflow: auto;
    display: flex; align-items: center; justify-content: center;
    background: #F3F4F6;
    min-height: 400px;
  }
  .doc-viewer-img {
    max-width: 100%; max-height: calc(100vh - 160px);
    object-fit: contain;
  }
  .doc-viewer-iframe {
    width: 100%; height: calc(100vh - 160px);
    border: none;
  }
</style>
