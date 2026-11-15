<script lang="ts">
  // 배지 템플릿 등록·수정 패널 — 이미지형(SVG 가져오기) / 텍스트바형(문구 + 바 색상). 부모에서 {#key} 로 재마운트한다.
  import { csToast } from '$lib/utils/toast'
  import CmsColorPicker from '$lib/components/cms/CmsColorPicker.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import BadgeChip from './BadgeChip.svelte'
  import { postBadgeAction } from './badgeApi'
  import { badgeTextColor, isHexColor } from '$lib/utils/badgeColor'
  import { BADGE_SVG_SIZE_MESSAGE, MAX_BADGE_SVG_BYTES } from '$lib/utils/badgeSvgUrl'
  import type { BadgeKind, BadgeTemplate } from '$lib/types/badge'

  interface Props {
    template: BadgeTemplate | null
    onclose: () => void
    /** 저장 성공 시 저장된 항목 id 와 함께 호출(패널은 열어 둔다) — id 없이 호출하면 삭제 등으로 패널을 닫는 경우 */
    onsaved: (savedId?: string) => void
  }

  let { template, onclose, onsaved }: Props = $props()

  // 마운트 시 1회 초기화 — 부모가 {#key} 로 감싸 항목이 바뀌면 재마운트된다(core-rules: $state(prop) 금지 패턴 1)
  let kind = $state<BadgeKind>(template?.kind ?? 'textbar')
  let name = $state(template?.name ?? '')
  let svgUrl = $state(template?.svg_url ?? '')
  let text = $state(template?.text ?? '')
  let bgColor = $state(template?.bg_color ?? '#3B2F8A')
  let saving = $state(false)
  let uploading = $state(false)
  let pendingPath = $state<string | null>(null)

  const textColor = $derived(badgeTextColor(bgColor))

  const isNew = template === null
  const isDirty = $derived(
    isNew
      ? name.trim() !== ''
      : kind !== template.kind ||
        name !== template.name ||
        (kind === 'image' ? svgUrl !== (template.svg_url ?? '') : text !== (template.text ?? '') || bgColor.toUpperCase() !== (template.bg_color ?? '').toUpperCase())
  )

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    // 크기는 선택 즉시 확인한다(서버로 올리기 전에 거절 — 서버·정화기·버킷도 같은 한도)
    if (file.size > MAX_BADGE_SVG_BYTES) return csToast.error(BADGE_SVG_SIZE_MESSAGE)
    uploading = true
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/cms/badges/icon', { method: 'POST', body: fd })
      const body = (await res.json().catch(() => null)) as { url?: string; path?: string; message?: string } | null
      if (!res.ok || !body?.url) {
        csToast.error(body?.message ?? 'SVG 를 가져오지 못했어요')
        return
      }
      if (pendingPath) await removeUploaded(pendingPath)
      pendingPath = body.path ?? null
      svgUrl = body.url
    } catch {
      csToast.error('SVG 를 가져오지 못했어요')
    } finally {
      uploading = false
    }
  }

  async function removeUploaded(path: string) {
    try {
      await fetch('/api/cms/badges/icon', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      })
    } catch {
      // 정리 실패는 저장 흐름에 영향 없음(미사용 파일만 남음)
    }
  }

  async function save() {
    if (!isDirty || saving) return
    if (name.trim() === '') return csToast.error('이름을 입력해 주세요')
    if (kind === 'image' && !svgUrl) return csToast.error('SVG 이미지를 가져와 주세요')
    if (kind === 'textbar') {
      if (text.trim() === '') return csToast.error('문구를 입력해 주세요')
      if (!isHexColor(bgColor)) return csToast.error('바 색상은 #RRGGBB 형식이어야 해요')
    }
    saving = true
    const r = await postBadgeAction('saveBadgeTemplate', {
      id: template?.id ?? '',
      kind,
      name: name.trim(),
      svg_url: kind === 'image' ? svgUrl : '',
      text: kind === 'textbar' ? text.trim() : '',
      bg_color: kind === 'textbar' ? bgColor : '',
      text_color: kind === 'textbar' ? textColor : '#FFFFFF',
      is_active: 'true',
    })
    saving = false
    if (!r.ok) return csToast.error(r.error ?? '저장에 실패했어요')
    pendingPath = null
    csToast.success('저장되었습니다.')
    onsaved(r.id ?? template?.id)
  }

  async function close() {
    if (pendingPath) await removeUploaded(pendingPath)
    onclose()
  }
</script>

<div class="detail-panel">
  <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <span class="section-title">{template ? template.name : '새 배지'}</span>
        <div class="head-actions">
          <button type="button" class="btn-save-inline" class:dirty={isDirty} disabled={!isDirty || saving} onclick={save}>{saving ? '저장 중...' : '저장'}</button>
          <button type="button" class="close-btn" aria-label="패널 닫기" onclick={close}>✕</button>
        </div>
      </div>

      <div class="inline-form">
        <div class="inline-row">
          <span class="vr-label">형태</span>
          <div class="pill-row">
            <button type="button" class="cat-pill" class:active={kind === 'image'} onclick={() => (kind = 'image')}>이미지형</button>
            <button type="button" class="cat-pill" class:active={kind === 'textbar'} onclick={() => (kind = 'textbar')}>텍스트바형</button>
          </div>
        </div>

        <div class="inline-row">
          <label class="vr-label" for="bt-name">이름</label>
          <input id="bt-name" class="il-input" maxlength="40" bind:value={name} autocomplete="off" />
        </div>

        {#if kind === 'image'}
          <div class="inline-row">
            <span class="vr-label">SVG 이미지</span>
            <label class="btn-file">
              {uploading ? '가져오는 중…' : 'SVG 가져오기'}
              <input type="file" accept="image/svg+xml,.svg" onchange={onFile} disabled={uploading} hidden />
            </label>
          </div>
        {:else}
          <div class="inline-row">
            <label class="vr-label" for="bt-text">문구</label>
            <input id="bt-text" class="il-input" maxlength="8" bind:value={text} autocomplete="off" />
          </div>
          <div class="inline-row inline-row-top">
            <span class="vr-label">바 배경색</span>
            <div class="row-value"><CmsColorPicker bind:value={bgColor} id="bt-bg" /></div>
          </div>
        {/if}

        <div class="inline-row">
          <span class="vr-label">미리보기</span>
          <div class="preview">
            {#if kind === 'image' && svgUrl}
              <BadgeChip kind="image" svg_url={svgUrl} size={32} />
            {:else if kind === 'textbar' && text.trim()}
              <BadgeChip kind="textbar" text={text.trim()} bg_color={bgColor} text_color={textColor} size={32} />
            {/if}
          </div>
        </div>
      </div>

      {#if template}
        <div class="panel-actions">
          <CmsDeleteButton action="?/deleteBadgeTemplate" id={template.id} onsuccess={() => onsaved()} />
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .head-actions { display: flex; align-items: center; gap: 8px; }
  /* 패널 닫기 close-red (cms-uiux.md §0-10-A-1) */
  .close-btn {
    flex-shrink: 0; width: 28px; height: 28px; min-height: 28px; display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer; transition: background 0.12s, color 0.12s;
  }
  .close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  /* 상세 패널 본문(ProductDetailPanel .detail-panel / .tab-content / .section 과 동일) */
  .detail-panel { display: flex; flex-direction: column; background: var(--cs-white); border-radius: var(--cms-radius-lg); overflow: hidden; }
  .tab-content { padding: 26px 26px 65px; }
  .section { display: flex; flex-direction: column; gap: 16px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; }
  .section-title { font: var(--text-pc-title-16); color: var(--cs-text); }

  /* 섹션 인라인 저장 버튼 btn-save-inline (cms-uiux.md §0-10-D, ProductDetailPanel 값) */
  .btn-save-inline {
    padding: 5px 14px; border: 1.5px solid var(--cs-border); border-radius: var(--radius-sm);
    background: transparent; color: var(--cs-text-light); font: var(--text-pc-script-12);
    cursor: not-allowed; min-height: 32px; transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .btn-save-inline.dirty { border-color: var(--cs-purple); background: var(--cs-purple); color: var(--cs-white); cursor: pointer; }
  .btn-save-inline.dirty:hover { background: var(--cs-purple-hover); border-color: var(--cs-purple-hover); }

  /* 인라인 편집 폼 — 라벨(왼쪽) + 값(오른쪽) 행 */
  .inline-form { display: flex; flex-direction: column; gap: 0; }
  .inline-row { display: flex; align-items: center; gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--cs-surface-gray); }
  .inline-row:last-child { border-bottom: none; }
  .inline-row-top { align-items: flex-start; padding-top: 10px; }
  .vr-label { flex: 0 0 90px; font: var(--text-pc-script-12); color: var(--cs-text-light); padding-top: 1px; }
  .row-value { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .il-input {
    flex: 1; width: 100%; background: transparent; border: none; border-radius: var(--cms-radius-sm);
    padding: 3px 8px; font: var(--text-pc-body-14); color: var(--cs-text);
    transition: background 0.12s, outline 0.12s; min-height: 32px;
  }
  .il-input::placeholder { color: var(--cs-text-placeholder); }
  .il-input:hover { background: rgba(59,47,138,0.04); }
  .il-input:focus { background: var(--cs-surface-gray); outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }
  .panel-actions { display: flex; justify-content: flex-end; padding-top: 16px; }

  /* 콤보버튼 UI — 상세패널형 (cms-uiux.md §7-12-A) */
  .pill-row { display: flex; gap: 6px; }
  .cat-pill {
    height: 34px; padding: 0 18px; border-radius: var(--radius-xl, 30px); border: none;
    background: var(--cs-lilac); font: 700 13px/1 'Noto Sans KR', sans-serif; color: var(--cs-text);
    cursor: pointer; transition: background 0.15s, color 0.15s;
  }
  .cat-pill.active { background: var(--cs-purple); color: var(--cs-white); }
  .cat-pill:hover:not(.active) { color: var(--cs-purple); }
  /* 초소형 라운드 버튼형 (cms-uiux.md §0-10-C) */
  .btn-file {
    display: inline-flex; align-items: center; padding: 5px 10px; border-radius: var(--radius-full);
    background: var(--cs-surface-gray); color: var(--cs-text-mid); font-size: 11px; font-weight: 600; cursor: pointer;
    white-space: nowrap; transition: background 0.15s, color 0.15s;
  }
  .btn-file:hover { background: var(--cs-text-mid); color: var(--cs-white); }
  .preview { display: flex; align-items: center; min-height: 32px; padding: 0 8px; }
</style>
