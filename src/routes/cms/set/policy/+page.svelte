<script lang="ts">
  // '정책관리' 페이지(2026-10-15, Stephen 지시 — 설정 서브메뉴) — 아래 3개 영역을 원래 화면에서 레이아웃 그대로 이관:
  //   ① 대여·예약 이용안내 (구 /cms/set/rental)
  //   ② 정기구독 이용안내 — 정기구독 공통 정책항목 (구 /cms/subscriptions/new ⑤ 정책설정)
  //   ③ 서비스 기본 정보 (구 /cms/set/rental)
  //   + 팀 정책 (2026-10-24 — 공통 푸터 '소개 > 팀' 모달 콘텐츠, 문서 편집기 / '서비스 기본 정보' 바로 위)
  import { untrack } from 'svelte'
  import { enhance, deserialize } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import RichContentEditor from '$lib/components/editor/RichContentEditor.svelte'
  import type { ContentBlock } from '$lib/types/content-editor'
  import { trimEmptyBlocks, nextTeamEditorSync } from '$lib/utils/teamPolicyBlocks'
  import type { ServiceInfoSettings } from '$lib/services/serviceInfoSettings'
  import type { PageData } from './$types'
  import type { RentalConsentItem } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // ─── 공통 대여 안내문 ───
  let guideText = $state(data.guideText)
  let guideLoading = $state(false)
  let guideCharCount = $derived(guideText.length)
  let guideIsDirty = $derived.by(() => guideText !== data.guideText)

  $effect(() => { guideText = data.guideText })

  // ─── 법적 고지 텍스트 ───
  let privacyText   = $state(data.policySettings?.privacy_text ?? '')
  let termsText     = $state(data.policySettings?.terms_text   ?? '')
  let refundText    = $state(data.policySettings?.refund_text  ?? '')
  let policyLoading = $state<'privacy' | 'terms' | 'refund' | null>(null)

  let privacyIsDirty = $derived.by(() => privacyText !== (data.policySettings?.privacy_text ?? ''))
  let termsIsDirty   = $derived.by(() => termsText   !== (data.policySettings?.terms_text   ?? ''))
  let refundIsDirty  = $derived.by(() => refundText  !== (data.policySettings?.refund_text  ?? ''))

  $effect(() => {
    privacyText = data.policySettings?.privacy_text ?? ''
    termsText   = data.policySettings?.terms_text   ?? ''
    refundText  = data.policySettings?.refund_text  ?? ''
  })

  // ─── 필수 동의문 ───
  let consents = $state<RentalConsentItem[]>(data.consents)
  let consentInput = $state('')
  let consentLoading = $state(false)
  let consentCharCount = $derived(consentInput.length)

  $effect(() => { consents = data.consents })

  async function saveConsentOrder(): Promise<void> {
    const ids = consents.map((c) => c.id)
    const fd = new FormData()
    fd.set('ids', JSON.stringify(ids))
    try {
      const res = await fetch('?/reorderConsents', { method: 'POST', body: fd })
      const result = deserialize(await res.text())
      if (result.type === 'success') {
        await invalidateAll()
        return
      }
      csToast.error(result.type === 'failure' ? ((result.data as { error?: string })?.error ?? '순서 저장에 실패했습니다.') : '순서 저장에 실패했습니다.')
    } catch {
      csToast.error('순서 저장에 실패했습니다.')
    }
  }

  // ─── 정책설정(정기구독 공통 정책항목) ───
  const POLICY_ITEM_MAX_LENGTH = 200
  const POLICY_ITEM_MAX_COUNT = 20

  let policyItems = $state(data.policyItems)
  let newPolicyContent = $state('')
  let editingPolicyId = $state<string | null>(null)
  let editingPolicyContent = $state('')
  let isPolicySaving = $state(false)

  // 서버 재조회(add/edit/delete 후 invalidateAll) 시 로컬 상태 재동기화
  $effect(() => {
    policyItems = data.policyItems
  })

  async function submitPolicyAction(action: string, fields: Record<string, string>): Promise<boolean> {
    isPolicySaving = true
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    const res = await fetch(`?/${action}`, { method: 'POST', body: fd })
    const result = deserialize(await res.text())
    isPolicySaving = false

    if (result.type === 'success') {
      await invalidateAll()
      return true
    }
    if (result.type === 'failure') {
      csToast.error((result.data as { error?: string } | undefined)?.error ?? '처리에 실패했습니다.')
    } else {
      csToast.error('처리에 실패했습니다.')
    }
    return false
  }

  async function addPolicyItem(): Promise<void> {
    const content = newPolicyContent.trim()
    if (!content) return
    const ok = await submitPolicyAction('addPolicyItem', { content })
    if (ok) { newPolicyContent = ''; csToast.success('정책항목이 추가됐습니다.') }
  }

  function startEditPolicy(id: string, content: string): void {
    editingPolicyId = id
    editingPolicyContent = content
  }
  function cancelEditPolicy(): void {
    editingPolicyId = null
    editingPolicyContent = ''
  }
  async function saveEditPolicy(id: string): Promise<void> {
    const content = editingPolicyContent.trim()
    if (!content) return
    const ok = await submitPolicyAction('updatePolicyItem', { id, content })
    if (ok) { cancelEditPolicy(); csToast.success('정책항목이 수정됐습니다.') }
  }
  async function removePolicyItem(id: string): Promise<void> {
    const ok = await submitPolicyAction('deletePolicyItem', { id })
    if (ok) csToast.success('정책항목이 삭제됐습니다.')
  }

  async function persistPolicyOrder(): Promise<void> {
    const orderedIds = policyItems.map((item) => item.id)
    await submitPolicyAction('reorderPolicyItems', { ordered_ids: JSON.stringify(orderedIds) })
  }

  // ─── 팀 정책(Migration #753) — 공통 푸터 '소개 > 팀' 모달에 노출되는 문서 ───
  let localTeamBlocks = $state<ContentBlock[]>([])
  let teamEditorRef = $state<RichContentEditor | undefined>()
  let teamKeywords = $state<string[]>([]) // 편집기가 요구하는 바인딩(showKeywords=false라 쓰지 않음)
  let teamEditorKey = $state(0)
  let teamDirty = $state(false)
  let teamSaving = $state(false)

  // 서버 값이 바뀌면 편집기를 새로 만들어 저장된 내용으로 되돌린다($state(prop) 초기화 금지 규칙).
  // 단, 같은 화면의 다른 저장으로 서버 값이 그대로 다시 오거나 쓰던 내용(미저장)이 있으면 건드리지 않는다.
  let teamAppliedJson = ''
  let teamEditVersion = 0 // 편집기 변경 횟수 — 저장하는 동안 더 입력했는지 구분
  $effect(() => {
    const src = data.teamBlocks as ContentBlock[]
    const incoming = JSON.stringify(src)
    untrack(() => {
      const next = nextTeamEditorSync(teamAppliedJson, incoming, teamDirty)
      teamAppliedJson = next.applied
      if (next.action === 'reset') {
        localTeamBlocks = src.map((b) => ({ ...b }))
        teamEditorKey += 1
        teamDirty = false
      }
    })
  })

  async function saveTeamPolicy(): Promise<void> {
    if (teamSaving || !teamDirty) return
    // 편집기의 디바운스 대기 중인 마지막 입력을 저장 전에 확정하고 직렬화 누락 여부를 점검한다
    const flushed = teamEditorRef?.flush()
    if (flushed && !flushed.ok) {
      csToast.error('내용을 저장 형식으로 변환하는 중 달라져 저장을 멈췄어요. 새로고침 후 다시 시도해주세요.')
      return
    }
    const blocks = trimEmptyBlocks(flushed?.blocks ?? localTeamBlocks)
    const versionAtSave = teamEditVersion
    teamSaving = true
    try {
      const fd = new FormData()
      fd.set('blocks', JSON.stringify(blocks))
      const res = await fetch('?/saveTeamPolicy', { method: 'POST', body: fd })
      const result = deserialize(await res.text())
      if (result.type === 'success') {
        csToast.success('팀 정책이 저장되었습니다.')
        // 저장하는 동안 더 입력한 내용이 있으면 미저장 상태를 유지한다(재조회가 그 입력을 지우지 않게)
        teamDirty = teamEditVersion !== versionAtSave
        await invalidateAll()
      } else if (result.type === 'failure') {
        csToast.error((result.data as { error?: string } | undefined)?.error ?? '저장에 실패했습니다.')
      } else {
        csToast.error('저장에 실패했습니다.')
      }
    } catch {
      csToast.error('저장에 실패했습니다.')
    } finally {
      teamSaving = false
    }
  }

  // ─── 서비스 기본 정보(사업자 정보, Migration #566) ───
  // PC 공통푸터·모바일 멤버십 푸터·표준계약서 임대인 정보가 이 9개 필드를 단일 소스로 참조한다.
  const EMPTY_SERVICE_INFO: ServiceInfoSettings = {
    company_name: '', ceo_name: '', biz_address: '', biz_reg_no: '', mail_order_biz_no: '',
    privacy_officer: '', ceo_email: '', cs_phone: '', business_hours: '',
  }
  let serviceInfo = $state<ServiceInfoSettings>({ ...EMPTY_SERVICE_INFO, ...data.serviceInfo })
  let serviceInfoLoading = $state(false)
  let serviceInfoIsDirty = $derived.by(() => {
    const orig = { ...EMPTY_SERVICE_INFO, ...data.serviceInfo }
    return (Object.keys(EMPTY_SERVICE_INFO) as (keyof ServiceInfoSettings)[])
      .some((key) => serviceInfo[key] !== orig[key])
  })

  $effect(() => { serviceInfo = { ...EMPTY_SERVICE_INFO, ...data.serviceInfo } })
</script>

<svelte:head><title>정책관리 — CrazyShot CMS</title></svelte:head>

<div class="page-wrap">
<div class="sections">

  <!-- ══════════════════════════════════════════
       ① 대여·예약 이용안내
  ══════════════════════════════════════════ -->
  <section class="setting-section">
    <div class="section-head">
      <h2 class="section-title">대여·예약 이용안내</h2>
    </div>

    <!-- 공통 안내문 -->
    <div class="subsection">
      <h3 class="subsection-title">공통 대여 안내문</h3>
      <form
        method="POST"
        action="?/saveGuide"
        use:enhance={() => {
          guideLoading = true
          return async ({ result, update }) => {
            guideLoading = false
            if (result.type === 'success') {
              csToast.success('안내문이 저장되었습니다.')
              await update({ reset: false })
            } else if (result.type === 'failure') {
              csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
            }
          }
        }}
      >
        <div class="textarea-wrap">
          <textarea
            name="guide_text"
            class="guide-textarea"
            placeholder="공통 대여 안내문을 입력하세요 (최대 1,000자)"
            maxlength="1000"
            rows="6"
            bind:value={guideText}
            aria-label="공통 대여 안내문"
          ></textarea>
          <span class="char-count" class:char-count--warn={guideCharCount > 900}>
            {guideCharCount} / 1,000
          </span>
        </div>
        <div class="guide-actions">
          <button
            type="submit"
            class="btn-save"
            disabled={guideLoading || !guideIsDirty}
          >
            {guideLoading ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>

    <!-- 법적 고지 텍스트 -->
    {#each ([
      { key: 'privacy' as const, field: 'privacy_text' as const, label: '개인정보처리방침', dirty: privacyIsDirty },
      { key: 'terms'   as const, field: 'terms_text'   as const, label: '이용약관',         dirty: termsIsDirty   },
      { key: 'refund'  as const, field: 'refund_text'  as const, label: '환불·취소 정책',   dirty: refundIsDirty  },
    ] as const) as item}
      <div class="subsection">
        <div class="subsection-head subsection-head--between">
          <h3 class="subsection-title">{item.label}</h3>
          <button
            type="submit"
            form="policy-form-{item.key}"
            class="btn-save-inline"
            class:dirty={item.dirty}
            disabled={policyLoading !== null || !item.dirty}
          >
            {policyLoading === item.key ? '저장 중...' : '저장'}
          </button>
        </div>
        <form
          id="policy-form-{item.key}"
          method="POST"
          action="?/savePolicy"
          use:enhance={() => {
            policyLoading = item.key
            return async ({ result, update }) => {
              policyLoading = null
              if (result.type === 'success') {
                csToast.success(`${item.label}이(가) 저장되었습니다.`)
                await update({ reset: false })
              } else if (result.type === 'failure') {
                csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
              }
            }
          }}
        >
          <input type="hidden" name="policy_field" value={item.field} />
          <div class="textarea-wrap">
            <textarea
              name="policy_text"
              class="guide-textarea"
              placeholder="{item.label} 내용을 입력하세요 (최대 5,000자)"
              maxlength="5000"
              rows="6"
              value={item.key === 'privacy' ? privacyText : item.key === 'terms' ? termsText : refundText}
              oninput={(e) => {
                const v = (e.target as HTMLTextAreaElement).value
                if (item.key === 'privacy') privacyText = v
                else if (item.key === 'terms') termsText = v
                else refundText = v
              }}
              aria-label={item.label}
            ></textarea>
            <span class="char-count" class:char-count--warn={
              (item.key === 'privacy' ? privacyText : item.key === 'terms' ? termsText : refundText).length > 4500
            }>
              {(item.key === 'privacy' ? privacyText : item.key === 'terms' ? termsText : refundText).length} / 5,000
            </span>
          </div>
        </form>
      </div>
    {/each}

    <!-- 필수 동의문 -->
    <div class="subsection">
      <div class="subsection-head">
        <h3 class="subsection-title">필수 동의문 항목</h3>
        <span class="section-badge section-badge--end">{consents.length} / 10</span>
      </div>

      <form
        method="POST"
        action="?/addConsent"
        class="add-form"
        use:enhance={({ formData }) => {
          formData.set('count', String(consents.length))
          consentLoading = true
          return async ({ result, update }) => {
            consentLoading = false
            if (result.type === 'success') {
              consentInput = ''
              csToast.success('동의문이 추가되었습니다.')
              await update({ reset: false })
            } else if (result.type === 'failure') {
              csToast.error((result.data as { error?: string })?.error ?? '추가에 실패했습니다.')
            }
          }
        }}
      >
        <div class="consent-input-wrap">
          <input
            type="text"
            name="content"
            class="add-input"
            placeholder="필수 동의문 내용 입력 (최대 200자)"
            maxlength="200"
            bind:value={consentInput}
            disabled={consentLoading}
            aria-label="필수 동의문"
          />
          <span class="char-count-inline" class:char-count--warn={consentCharCount > 180}>
            {consentCharCount}/200
          </span>
        </div>
        <button
          type="submit"
          class="btn-add"
          disabled={consentLoading || !consentInput.trim() || consents.length >= 10}
        >
          {consentLoading ? '추가 중...' : '추가'}
        </button>
      </form>

      {#if consents.length > 0}
        <CmsDragList
          bind:items={consents}
          itemKey={(item) => item.id}
          onreorder={saveConsentOrder}
          class="drag-list-wrap"
        >
          {#snippet renderItem(item: RentalConsentItem)}
            <div class="list-row">
              <span class="list-row-name consent-text">{item.content}</span>
              <CmsDeleteButton action="?/deleteConsent" id={item.id} />
            </div>
          {/snippet}
        </CmsDragList>
      {:else}
        <p class="empty-hint">등록된 필수 동의문이 없습니다.</p>
      {/if}
    </div>
  </section>

  <!-- ══════════════════════════════════════════
       ② 정기구독 이용안내 (정기구독 공통 정책항목)
  ══════════════════════════════════════════ -->
  <section class="setting-section">
    <div class="section-head">
      <h2 class="section-title">정기구독 이용안내</h2>
    </div>

    <div class="policy-body">
      <div class="policy-add-wrap">
        <div class="policy-add-input-wrap">
          <input
            type="text"
            class="f-input policy-add-input"
            placeholder="정책항목 내용 입력 (예: 정기결제는 매달 자동으로 청구됩니다)"
            maxlength={POLICY_ITEM_MAX_LENGTH}
            bind:value={newPolicyContent}
            disabled={isPolicySaving || policyItems.length >= POLICY_ITEM_MAX_COUNT}
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPolicyItem() } }}
          />
          <span class="policy-counter" class:over={newPolicyContent.length > POLICY_ITEM_MAX_LENGTH}>
            {newPolicyContent.length}/{POLICY_ITEM_MAX_LENGTH}
          </span>
        </div>
        <button
          type="button"
          class="policy-btn policy-btn-primary"
          disabled={isPolicySaving || !newPolicyContent.trim() || policyItems.length >= POLICY_ITEM_MAX_COUNT}
          onclick={addPolicyItem}
        >+ 추가</button>
      </div>
      <p class="policy-count-notice" class:over={policyItems.length >= POLICY_ITEM_MAX_COUNT}>
        {policyItems.length}/{POLICY_ITEM_MAX_COUNT}개 등록됨
        {#if policyItems.length >= POLICY_ITEM_MAX_COUNT}— 최대 개수에 도달했습니다{/if}
      </p>

      <div class="policy-list">
        {#if policyItems.length > 0}
          <CmsDragList bind:items={policyItems} itemKey={(item) => item.id} onreorder={persistPolicyOrder} class="policy-drag-list">
            {#snippet renderItem(item)}
              <div class="policy-row">
                {#if editingPolicyId === item.id}
                  <div class="policy-edit-wrap">
                    <textarea
                      class="f-input f-textarea policy-edit-input"
                      maxlength={POLICY_ITEM_MAX_LENGTH}
                      bind:value={editingPolicyContent}
                      rows="2"
                    ></textarea>
                    <span class="policy-counter" class:over={editingPolicyContent.length > POLICY_ITEM_MAX_LENGTH}>
                      {editingPolicyContent.length}/{POLICY_ITEM_MAX_LENGTH}
                    </span>
                  </div>
                  <div class="policy-row-actions">
                    <button type="button" class="policy-btn policy-btn-primary" disabled={isPolicySaving || !editingPolicyContent.trim()} onclick={() => saveEditPolicy(item.id)}>저장</button>
                    <button type="button" class="policy-btn" disabled={isPolicySaving} onclick={cancelEditPolicy}>취소</button>
                  </div>
                {:else}
                  <span class="policy-content">{item.content}</span>
                  <div class="policy-row-actions">
                    <button type="button" class="policy-btn" disabled={isPolicySaving} onclick={() => startEditPolicy(item.id, item.content)}>수정</button>
                    <button type="button" class="policy-btn policy-btn-danger" disabled={isPolicySaving} onclick={() => removePolicyItem(item.id)}>삭제</button>
                  </div>
                {/if}
              </div>
            {/snippet}
          </CmsDragList>
        {:else}
          <p class="policy-empty">등록된 정책항목이 없습니다.</p>
        {/if}
      </div>
    </div>
  </section>

  <!-- ══════════════════════════════════════════
       팀 정책 — 공통 푸터 '소개 > 팀' 모달에 노출(문서 편집기, 서비스 기본 정보 바로 위)
  ══════════════════════════════════════════ -->
  <section class="setting-section">
    <div class="section-head">
      <h2 class="section-title">팀 정책</h2>
    </div>

    <div class="subsection">
      <div class="subsection-head subsection-head--between">
        <h3 class="subsection-title">팀 소개·정책 안내</h3>
        <button
          type="button"
          class="btn-save-inline"
          class:dirty={teamDirty}
          disabled={teamSaving || !teamDirty}
          onclick={saveTeamPolicy}
        >
          {teamSaving ? '저장 중...' : '저장'}
        </button>
      </div>
      <p class="team-hint">고객 화면 공통 푸터의 '소개 &gt; 팀'을 누르면 여기에 입력한 내용이 안내창으로 표시됩니다.</p>
      {#key teamEditorKey}
        <div class="content-editor-box">
          <RichContentEditor
            bind:this={teamEditorRef}
            bind:blocks={localTeamBlocks}
            bind:keywords={teamKeywords}
            variant="cms"
            showKeywords={false}
            uploadPrefix="team-policy/content"
            placeholder="팀 소개와 정책 안내를 입력하세요"
            onchange={() => { teamEditVersion += 1; teamDirty = true }}
          />
        </div>
      {/key}
    </div>
  </section>

  <!-- ══════════════════════════════════════════
       서비스 기본 정보 (Migration #566) — 팀 정책 영역 바로 아래
  ══════════════════════════════════════════ -->
  <section class="setting-section">
    <div class="section-head">
      <h2 class="section-title">서비스 기본 정보</h2>
    </div>

    <form
      method="POST"
      action="?/saveServiceInfo"
      use:enhance={() => {
        serviceInfoLoading = true
        return async ({ result, update }) => {
          serviceInfoLoading = false
          if (result.type === 'success') {
            csToast.success('서비스 기본 정보가 저장되었습니다.')
            await update({ reset: false })
          } else if (result.type === 'failure') {
            csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
          }
        }
      }}
    >
      <div class="subsection">
        <div class="subsection-head subsection-head--between">
          <h3 class="subsection-title">사업정보</h3>
          <button
            type="submit"
            class="btn-save-inline"
            class:dirty={serviceInfoIsDirty}
            disabled={serviceInfoLoading || !serviceInfoIsDirty}
          >
            {serviceInfoLoading ? '저장 중...' : '저장'}
          </button>
        </div>
        <div class="service-info-grid">
          <div class="field-row field-row--wide">
            <label class="field-label field-label--wide" for="si-company">사업자명(상호명)</label>
            <input id="si-company" type="text" name="company_name" class="field-input" maxlength="100" bind:value={serviceInfo.company_name} />
          </div>
          <div class="field-row field-row--wide">
            <label class="field-label field-label--wide" for="si-ceo">대표자명</label>
            <input id="si-ceo" type="text" name="ceo_name" class="field-input" maxlength="50" bind:value={serviceInfo.ceo_name} />
          </div>
          <div class="field-row field-row--wide">
            <label class="field-label field-label--wide" for="si-addr">사업장 소재지</label>
            <input id="si-addr" type="text" name="biz_address" class="field-input" maxlength="200" bind:value={serviceInfo.biz_address} />
          </div>
          <div class="field-row field-row--wide">
            <label class="field-label field-label--wide" for="si-regno">사업자등록번호</label>
            <input id="si-regno" type="text" name="biz_reg_no" class="field-input" maxlength="30" placeholder="000-00-00000" bind:value={serviceInfo.biz_reg_no} />
          </div>
          <div class="field-row field-row--wide">
            <label class="field-label field-label--wide" for="si-mailorder">통신판매업신고</label>
            <input id="si-mailorder" type="text" name="mail_order_biz_no" class="field-input" maxlength="50" bind:value={serviceInfo.mail_order_biz_no} />
          </div>
          <div class="field-row field-row--wide">
            <label class="field-label field-label--wide" for="si-officer">개인정보관리책임자</label>
            <input id="si-officer" type="text" name="privacy_officer" class="field-input" maxlength="50" bind:value={serviceInfo.privacy_officer} />
          </div>
          <div class="field-row field-row--wide">
            <label class="field-label field-label--wide" for="si-email">대표 이메일</label>
            <input id="si-email" type="email" name="ceo_email" class="field-input" maxlength="100" bind:value={serviceInfo.ceo_email} />
          </div>
        </div>
      </div>

      <div class="subsection">
        <h3 class="subsection-title">안내정보</h3>
        <div class="service-info-grid">
          <div class="field-row field-row--wide">
            <label class="field-label field-label--wide" for="si-csphone">고객센터 번호</label>
            <input id="si-csphone" type="text" name="cs_phone" class="field-input" maxlength="30" placeholder="1588-0033" bind:value={serviceInfo.cs_phone} />
          </div>
          <div class="field-row field-row--wide">
            <label class="field-label field-label--wide" for="si-hours">운영시간 안내</label>
            <input id="si-hours" type="text" name="business_hours" class="field-input" maxlength="100" bind:value={serviceInfo.business_hours} />
          </div>
        </div>
      </div>
    </form>
  </section>

</div>
</div>

<style>
  /* 레이아웃·값은 원래 화면(/cms/set/rental)의 스타일을 그대로 가져왔다 — 임의 변경 금지 */
  .page-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 32px 16px;
    min-width: 0;
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .setting-section {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 34px 32px;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 30px;
  }

  .section-title {
    font: var(--text-pc-menu-kr-20);
    color: var(--cs-dark);
    margin: 0;
  }

  .section-badge {
    background: var(--cs-lilac);
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    font-weight: 700;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  .section-badge--end {
    margin-left: auto;
  }

  .subsection {
    margin-bottom: 28px;
  }

  .subsection:last-child {
    margin-bottom: 0;
  }

  .subsection-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .subsection-head--between {
    justify-content: space-between;
  }

  .subsection-title {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    margin: 0;
  }

  .guide-actions {
    display: flex;
    justify-content: flex-end;
  }

  .textarea-wrap {
    position: relative;
    margin-bottom: 10px;
  }

  .guide-textarea {
    width: 100%;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    padding: 12px 14px 32px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
    line-height: 1.6;
  }

  .guide-textarea:focus {
    border-color: var(--cs-purple);
    background: var(--cs-white);
  }

  .guide-textarea::placeholder {
    color: var(--cs-text-mid);
  }

  .char-count {
    position: absolute;
    bottom: 10px;
    right: 14px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .char-count--warn {
    color: var(--cs-error, #E53E3E);
    font-weight: 700;
  }

  .btn-save {
    height: 34px;
    padding: 0 18px;
    background: var(--cs-purple);
    border: none;
    border-radius: var(--cms-radius-sm);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-save:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-save:not(:disabled):hover {
    opacity: 0.85;
  }

  /* 섹션 인라인 저장 버튼(cms-uiux.md §0-10-D 표준) */
  .btn-save-inline {
    padding: 5px 14px;
    border: 1.5px solid var(--cs-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-light);
    font: var(--text-pc-script-12);
    cursor: not-allowed;
    min-height: 32px;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .btn-save-inline.dirty {
    border-color: var(--cs-purple);
    background: var(--cs-purple);
    color: var(--cs-white);
    cursor: pointer;
  }
  .btn-save-inline.dirty:hover {
    opacity: 0.85;
  }

  /* 팀 정책 — 안내 문구·문서 편집기 래퍼(ProductDetailPanel .content-editor-box와 동일) */
  .team-hint {
    margin: 0 0 14px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }
  .content-editor-box {
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm);
    overflow: clip;
  }

  /* ─── 필수 동의문 ─── */
  .add-form {
    display: flex;
    gap: 10px;
    margin-bottom: 32px;
  }

  .add-input {
    flex: 1;
    height: 44px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    padding: 0 14px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    outline: none;
    transition: border-color 0.15s;
  }

  .add-input:focus {
    border-color: var(--cs-purple);
    background: var(--cs-white);
  }

  .add-input::placeholder {
    color: var(--cs-text-placeholder);
  }

  .btn-add {
    padding: 5px 14px;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    white-space: nowrap;
    cursor: pointer;
    min-height: 32px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .btn-add:disabled {
    border-color: var(--cs-border);
    background: transparent;
    color: var(--cs-text-light);
    cursor: not-allowed;
  }

  .btn-add:not(:disabled):hover {
    background: var(--cs-purple-hover);
    border-color: var(--cs-purple-hover);
  }

  .consent-input-wrap {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  .consent-input-wrap .add-input {
    padding-right: 60px;
  }

  .char-count-inline {
    position: absolute;
    right: 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    pointer-events: none;
  }

  :global(.drag-list-wrap) {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 1;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    padding: 0 14px;
    height: 44px;
    gap: 12px;
    min-width: 0;
  }

  .list-row-name {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .consent-text {
    font: var(--text-pc-body-14);
  }

  .empty-hint {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    text-align: center;
    padding: 20px 0;
    margin: 0;
  }

  /* ─── 정기구독 이용안내(구 /cms/subscriptions/new ⑤ 정책설정) — 카드·헤더는 위 .setting-section/.section-head로 통일 ─── */
  .policy-body { display: flex; flex-direction: column; gap: 16px; }

  .f-input {
    background: var(--cs-surface-gray); border: none; border-radius: var(--radius-sm);
    padding: 12px 16px; font: var(--text-pc-body-14); color: var(--cs-text);
    width: 100%; box-sizing: border-box;
  }
  .f-input:focus { outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }
  .f-textarea { resize: vertical; min-height: 80px; font-family: inherit; }

  .policy-list { display: flex; flex-direction: column; gap: 8px; }
  /* 목록 행 간 표준 여백 — cms-uiux.md §5 '행 간격(gap)' 중(15px). CmsDragList 컨테이너는 자식 컴포넌트라 :global로 지정 */
  .policy-list :global(.policy-drag-list) { gap: 15px; }
  .policy-empty { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .policy-row {
    display: flex; align-items: center; gap: 12px; padding: 10px 14px; flex: 1; min-width: 0;
    background: var(--cs-surface-gray); border-radius: var(--radius-sm);
  }
  .policy-content { flex: 1; font: var(--text-pc-body-14); color: var(--cs-text); word-break: break-word; }
  .policy-row-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .policy-edit-wrap { flex: 1; display: flex; align-items: flex-start; gap: 8px; }
  .policy-edit-input { flex: 1; }

  .policy-btn {
    padding: 6px 14px; border: 1.5px solid var(--cs-lilac); border-radius: var(--radius-sm);
    background: var(--cs-white); color: var(--cs-text-mid); font: var(--text-pc-script-12);
    cursor: pointer; white-space: nowrap; transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .policy-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .policy-btn-primary:not(:disabled) { border-color: var(--cs-purple); background: var(--cs-purple); color: var(--cs-white); }
  .policy-btn-primary:not(:disabled):hover { opacity: 0.85; }
  .policy-btn-danger:not(:disabled):hover { border-color: var(--cs-red-badge); background: var(--cs-red-badge); color: var(--cs-white); }

  .policy-add-wrap { display: flex; align-items: center; gap: 10px; }
  .policy-add-input-wrap { flex: 1; position: relative; display: flex; align-items: center; }
  .policy-add-input { width: 100%; padding-right: 64px; }
  .policy-counter {
    font: var(--text-pc-descript-10); color: var(--cs-text-light); white-space: nowrap;
  }
  .policy-add-input-wrap .policy-counter { position: absolute; right: 14px; }
  .policy-counter.over { color: var(--cs-red-badge); }
  .policy-count-notice { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .policy-count-notice.over { color: var(--cs-red-badge); }

  /* ─── 서비스 기본 정보 ─── */
  .field-row {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .field-row--wide {
    grid-template-columns: 140px 1fr;
  }

  .service-info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 32px;
  }

  .field-label--wide {
    white-space: normal;
  }

  .field-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
  }

  .field-input {
    height: 38px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    padding: 0 12px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    outline: none;
    transition: border-color 0.15s;
  }

  .field-input:focus {
    border-color: var(--cs-purple);
    background: var(--cs-white);
  }

  .field-input::placeholder {
    color: var(--cs-text-mid);
  }
</style>
