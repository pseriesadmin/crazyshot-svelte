<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import CmsSuggestPicker from '$lib/components/cms/CmsSuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/cms-suggest-picker'

  interface CategoryItem {
    id: string
    code: string
    name: string
    sort_order: number
    is_active?: boolean
  }

  interface SelectedItem {
    code_id:      string
    icon_key:     string
    sort_order:   number
    name:         string
    icon_url:     string | null   // 저장된 커스텀 아이콘 URL
    _preview:     string | null   // 로컬 blob preview (미업로드)
    _file:        File   | null   // 대기 중 파일
  }

  interface Props {
    categories: CategoryItem[]
    initialSettings: {
      items: { code_id: string; icon_key: string; sort_order: number; icon_url?: string | null }[]
    }
    initialKeywordsSettings: { items: string[] }
    onclose: () => void
  }

  let { categories, initialSettings, initialKeywordsSettings, onclose }: Props = $props()

  const CAT_LABELS: Record<string, string> = {
    camera:     '카메라',
    lens:       '렌즈',
    camcorder:  '캠코더',
    action_cam: '액션캠',
    drone:      '드론',
    lighting:   '조명',
    audio:      '오디오',
    accessory:  '보조용품',
    package:    '패키지',
  }

  const CAT_ICON_IDX: Record<string, number> = {
    camera:     1,
    lens:       2,
    camcorder:  6,
    action_cam: 3,
    drone:      4,
    lighting:   4,
    audio:      3,
    accessory:  7,
    package:    0,
  }
  function catIconIdx(code: string): number {
    return CAT_ICON_IDX[code] ?? 7
  }

  // 저장된 항목만 초기 선택목록으로 반환
  // 저장값 없음 → 빈 목록 시작 (피커로 카테고리 추가, products/new 피커와 동일 구조)
  function buildSelected(): SelectedItem[] {
    const saved = initialSettings?.items ?? []
    const matched: SelectedItem[] = []
    for (const item of saved) {
      const cat = categories.find((c) => c.id === item.code_id)
      if (!cat) continue
      matched.push({
        code_id:    cat.id,
        icon_key:   cat.code,
        sort_order: item.sort_order,
        name:       CAT_LABELS[cat.code] ?? cat.name,
        icon_url:   item.icon_url ?? null,
        _preview:   null,
        _file:      null,
      })
    }
    return matched
  }

  let selected = $state<SelectedItem[]>(buildSelected())

  let pickerSelectedId = $state<string | null>(null)
  let isSaving         = $state(false)
  let error            = $state<string | null>(null)

  // 키워드 옵션 목록
  const KEYWORD_OPTIONS: SuggestPickerOption[] = [
    { id: 'SONY',       label: 'SONY' },
    { id: 'CANON',      label: 'CANON' },
    { id: 'NIKON',      label: 'NIKON' },
    { id: 'Fujifilm',   label: 'Fujifilm' },
    { id: 'Olympus',    label: 'Olympus' },
    { id: 'Panasonic',  label: 'Panasonic' },
    { id: 'Leica',      label: 'Leica' },
    { id: 'GoPro',      label: 'GoPro' },
    { id: 'DJI',        label: 'DJI' },
    { id: 'Blackmagic', label: 'Blackmagic' },
    { id: 'RODE',       label: 'RODE' },
    { id: 'Godox',      label: 'Godox' },
  ]

  let selectedKeywords   = $state<string[]>(initialKeywordsSettings?.items ?? [])
  let kwPickerSelectedId = $state<string | null>(null)

  let availableKwOptions = $derived(
    KEYWORD_OPTIONS.filter((opt) => !selectedKeywords.includes(opt.id))
  )

  function addKeyword(optId: string | null) {
    if (!optId) return
    const opt = KEYWORD_OPTIONS.find((o) => o.id === optId)
    if (!opt || selectedKeywords.includes(opt.id)) return
    if (selectedKeywords.length >= 10) return
    selectedKeywords = [...selectedKeywords, opt.id]
    kwPickerSelectedId = null
  }

  function removeKeyword(kw: string) {
    selectedKeywords = selectedKeywords.filter((k) => k !== kw)
  }

  let selectedIds   = $derived(new Set(selected.map((s) => s.code_id)))
  // 이미 선택된 카테고리는 피커 목록에서 제외 — 선택 시 addCategory guard와 충돌 방지
  let pickerOptions = $derived(
    categories
      .filter((c) => !selectedIds.has(c.id))
      .map((c) => ({
        id:    c.id,
        label: CAT_LABELS[c.code] ?? c.name,
        meta:  [c.name, c.code].filter(Boolean),
      }))
  )

  function addCategory(catId: string | null) {
    if (!catId) return
    const cat = categories.find((c) => c.id === catId)
    if (!cat || selectedIds.has(cat.id)) return
    selected = [
      ...selected,
      {
        code_id:    cat.id,
        icon_key:   cat.code,
        sort_order: selected.length,
        name:       CAT_LABELS[cat.code] ?? cat.name,
        icon_url:   null,
        _preview:   null,
        _file:      null,
      },
    ]
    pickerSelectedId = null
  }

  function removeItem(codeId: string) {
    const item = selected.find((s) => s.code_id === codeId)
    if (item?._preview) URL.revokeObjectURL(item._preview)
    selected = selected.filter((s) => s.code_id !== codeId)
  }

  function onFileChange(codeId: string, e: Event) {
    const input  = e.target as HTMLInputElement
    const file   = input.files?.[0]
    if (!file) return
    const old = selected.find((s) => s.code_id === codeId)
    if (old?._preview) URL.revokeObjectURL(old._preview)
    const preview = URL.createObjectURL(file)
    selected = selected.map((s) =>
      s.code_id === codeId ? { ...s, _preview: preview, _file: file } : s
    )
  }

  async function uploadIcon(item: SelectedItem): Promise<string | null> {
    if (!item._file) return item.icon_url
    const ext  = item._file.name.split('.').pop() ?? 'png'
    const path = `product-cat-icons/${item.icon_key}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('cms-assets')
      .upload(path, item._file, { upsert: true, contentType: item._file.type })
    if (upErr) return item.icon_url   // 업로드 실패 시 기존 URL 유지
    const { data } = supabase.storage.from('cms-assets').getPublicUrl(path)
    return data.publicUrl
  }

  async function save() {
    isSaving = true
    error    = null
    try {
      const resolved = await Promise.all(
        selected.map(async (s) => ({ ...s, icon_url: await uploadIcon(s) }))
      )
      const items = resolved.map((s, i) => ({
        code_id:    s.code_id,
        icon_key:   s.icon_key,
        icon_url:   s.icon_url ?? null,
        sort_order: i,
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: catErr } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key:   'product_page_categories',
        p_value: { items },
      })
      if (catErr) { error = catErr.message; return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: kwErr } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key:   'product_page_keywords',
        p_value: { items: selectedKeywords },
      })
      if (kwErr) {
        error = kwErr.message
      } else {
        await invalidateAll()
        onclose()
      }
    } catch (e) {
      error = e instanceof Error ? e.message : '저장 실패'
    }
    isSaving = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose} role="presentation"></div>

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="카테고리 설정">
  <div class="modal-header">
    <span class="modal-title">카테고리 설정</span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <!-- 스크롤 영역: 모달 내 전체 콘텐츠 -->
  <div class="modal-scroll">
    <p class="section-label">카테고리 선택</p>
    <CmsSuggestPicker
      id="cat-picker"
      bind:selectedId={pickerSelectedId}
      options={pickerOptions}
      placeholder="분류선택-카테고리 검색 또는 선택..."
      listLabel="카테고리 제안"
      onselect={(opt) => addCategory(opt.id)}
    >
      {#snippet field(c)}
        <input
          type="text"
          class="f-input"
          id={c.id}
          placeholder={c.placeholder}
          aria-label="카테고리 선택"
          value={c.value}
          oninput={c.oninput}
          onkeydown={c.onkeydown}
          onfocus={c.onfocus}
          onblur={c.onblur}
          aria-autocomplete={c.ariaAutocomplete}
          aria-expanded={c.ariaExpanded}
          aria-controls={c.ariaControls}
          autocomplete="off"
        />
      {/snippet}
    </CmsSuggestPicker>

    <!-- ② 카테고리 추가목록 -->
    {#if selected.length > 0}
      <p class="section-label mt">
        카테고리 추가목록
        <span class="hint">드래그로 순서 변경</span>
      </p>
      <div class="order-list">
        <CmsDragList bind:items={selected} class="order-drag">
          {#snippet renderItem(item)}
            <div class="cat-card-inner">

              <!-- 아이콘 미리보기 -->
              <div class="cat-card-icon">
                {#if item._preview}
                  <img src={item._preview} alt={item.name} class="icon-img" />
                {:else if item.icon_url}
                  <img src={item.icon_url} alt={item.name} class="icon-img" />
                {:else if catIconIdx(item.icon_key) === 0}
                  <svg xmlns="http://www.w3.org/2000/svg" width="26" height="28" viewBox="0 0 46 49" fill="none" aria-hidden="true">
                    <path d="M1 35.4413C1 37.7196 3.4397 39.1664 5.43889 38.0737L21.5611 29.2612C22.4578 28.7711 23.5422 28.7711 24.4389 29.2612L40.5611 38.0737C42.5603 39.1664 45 37.7196 45 35.4413V16.3044C45 15.2075 44.4014 14.1981 43.4389 13.672L24.4389 3.2865C23.5422 2.79639 22.4578 2.79639 21.5611 3.2865L2.56111 13.672C1.59863 14.1981 1 15.2075 1 16.3044V35.4413Z" fill="#FF3535"/>
                    <path d="M42.1101 16.2502C42.1101 14.8331 41.3421 13.5272 40.1053 12.8403L24.8856 4.38634C23.7127 3.73492 22.2874 3.73505 21.1144 4.38634L5.89376 12.8403C4.65708 13.5273 3.88992 14.8332 3.88992 16.2502V32.7498C3.88992 34.1668 4.65703 35.4728 5.89376 36.1597L21.1144 44.6127C22.2875 45.2642 23.7126 45.2643 24.8856 44.6127L40.1053 36.1597C41.3421 35.4728 42.1101 34.1669 42.1101 32.7498V16.2502ZM46 32.7498C46 35.5839 44.4648 38.1948 41.9914 39.5687L26.7717 48.0227C24.4255 49.3258 21.5745 49.3258 19.2283 48.0227L4.00863 39.5687C1.53502 38.1948 0 35.584 0 32.7498V16.2502C0 13.4161 1.53502 10.8052 4.00863 9.43129L19.2283 0.977352C21.5745 -0.325784 24.4255 -0.325784 26.7717 0.977352L41.9914 9.43129C44.4648 10.8053 46 13.4162 46 16.2502V32.7498Z" fill="#3B2F8A"/>
                    <path d="M1 16.0587C1 13.7804 3.4397 12.3336 5.43889 13.4263L21.5611 22.2388C22.4578 22.7289 23.5422 22.7289 24.4389 22.2388L40.5611 13.4263C42.5603 12.3336 45 13.7804 45 16.0587V35.1956C45 36.2925 44.4014 37.3019 43.4389 37.828L24.4389 48.2135C23.5422 48.7036 22.4578 48.7036 21.5611 48.2135L2.56111 37.828C1.59863 37.3019 1 36.2925 1 35.1956V16.0587Z" fill="#3B2F8A"/>
                  </svg>
                {:else if catIconIdx(item.icon_key) === 1}
                  <svg width="28" height="22" viewBox="0 0 46 39" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M46 26.8075V17.3422C46 13.0745 46 10.9406 45.1822 9.3105C43.5075 5.97267 40.4885 5.14973 37 5.14973C36.0433 5.14973 35.3083 4.33952 34.9217 3.46438C33.8467 1.03132 30.4876 0 28 0H19C16.364 0 12.3809 1.15812 11.4532 3.91513C11.2321 4.57222 10.6933 5.14973 10 5.14973C5.99786 5.14973 2.84232 5.27539 0.817837 9.3105C0 10.9406 0 13.0745 0 17.3422V26.8075C0 31.0753 0 33.2092 0.817837 34.8392C1.53723 36.2731 2.68512 37.4389 4.09701 38.1694C5.7021 39 7.80329 39 12.0057 39H33.9943C38.1967 39 40.2979 39 41.903 38.1694C43.3149 37.4389 44.4628 36.2731 45.1822 34.8392C46 33.2092 46 31.0753 46 26.8075Z" fill="#3B2F8A"/>
                    <path d="M23.5 10.5C29.299 10.5 34 15.201 34 21C34 26.799 29.299 31.5 23.5 31.5C17.701 31.5 13 26.799 13 21C13 15.201 17.701 10.5 23.5 10.5Z" fill="#E1DEF3" stroke="#FF3535" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {:else if catIconIdx(item.icon_key) === 2}
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                    <path d="M24 46C36.1503 46 46 36.1503 46 24C46 11.8497 36.1503 2 24 2C11.8497 2 2 11.8497 2 24C2 36.1503 11.8497 46 24 46Z" fill="#FF3535" stroke="#3B2F8A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M24 40C32.8366 40 40 32.8366 40 24C40 15.1634 32.8366 8 24 8C15.1634 8 8 15.1634 8 24C8 32.8366 15.1634 40 24 40Z" fill="#3B2F8A"/>
                    <path d="M24 31C27.866 31 31 27.866 31 24C31 20.134 27.866 17 24 17C20.134 17 17 20.134 17 24C17 27.866 20.134 31 24 31Z" fill="#E1DEF3"/>
                  </svg>
                {:else if catIconIdx(item.icon_key) === 3}
                  <svg xmlns="http://www.w3.org/2000/svg" width="26" height="24" viewBox="0 0 45 41" fill="none" aria-hidden="true">
                    <path d="M34.2588 0C39.6394 0.000140955 44.2588 4.61937 44.2588 10C44.2588 12.0007 44.2565 16.1283 44.2549 19.7549C44.2541 21.5681 44.2535 23.2563 44.2529 24.4912C44.2526 25.1087 44.2521 25.6131 44.252 25.9629V26.5078C44.2512 27.8884 43.1315 29.0074 41.751 29.0068C40.3704 29.0061 39.2514 27.8864 39.252 26.5059V25.96C39.2521 25.6103 39.2526 25.1064 39.2529 24.4893C39.2535 23.2543 39.2541 21.5653 39.2549 19.752C39.2565 16.1252 39.2588 11.9993 39.2588 10C39.2588 7.3808 36.878 5.00015 34.2588 5C32.2593 5 27.1948 5.00134 22.1299 5.00293C17.0657 5.00452 12.0005 5.00684 10 5.00684C7.38071 5.00684 5 7.38755 5 10.0068C5 12.0074 4.99976 19.0072 5 25.5068C5.00012 28.7568 5.00089 31.8819 5.00098 34.1943V38.0068C5.00098 39.3875 3.88161 40.5067 2.50098 40.5068C1.20665 40.5068 0.141806 39.5232 0.0136719 38.2627L0.000976562 38.0068V25.5068C0.000732443 19.0073 3.97228e-08 12.0075 0 10.0068C4.09365e-07 4.62612 4.61929 0.00585938 10 0.00585938C11.9996 0.00585933 17.064 0.00451667 22.1289 0.00292969C27.1931 0.00134292 32.2583 0 34.2588 0ZM41.502 33.0068C43.435 33.0068 45.002 34.5738 45.002 36.5068C45.002 38.4398 43.435 40.0068 41.502 40.0068C39.569 40.0068 38.002 38.4398 38.002 36.5068C38.002 34.5738 39.569 33.0068 41.502 33.0068ZM16.501 9.25391C20.9193 9.25391 24.501 12.8356 24.501 17.2539V28.2529C24.501 32.6712 20.9193 36.2539 16.501 36.2539C12.0827 36.2539 8.50098 32.6712 8.50098 28.2529V17.2539C8.50098 12.8356 12.0827 9.25391 16.501 9.25391ZM16.501 24.2539C14.2918 24.2539 12.501 26.0448 12.501 28.2539C12.5012 30.4628 14.292 32.2539 16.501 32.2539C18.71 32.2539 20.5007 30.4628 20.501 28.2539C20.501 26.0448 18.7101 24.2539 16.501 24.2539Z" fill="#3B2F8A"/>
                    <path d="M20.501 17.2534C20.501 19.4626 18.7101 21.2534 16.501 21.2534C14.2918 21.2534 12.501 19.4626 12.501 17.2534C12.501 15.0443 14.2918 13.2534 16.501 13.2534C18.7101 13.2534 20.501 15.0443 20.501 17.2534Z" fill="#FF3535"/>
                  </svg>
                {:else if catIconIdx(item.icon_key) === 4}
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="19" viewBox="0 0 46 31" fill="none" aria-hidden="true">
                    <rect y="16.0469" width="14" height="14" rx="5" fill="#3B2F8A"/>
                    <rect x="32" y="16.1406" width="14" height="14" rx="5" fill="#3B2F8A"/>
                    <rect x="16" y="16.0469" width="14" height="14" rx="5" fill="#FF3535"/>
                    <rect width="14" height="14" rx="5" fill="#3B2F8A"/>
                    <rect x="16" width="14" height="14" rx="5" fill="#FF3535"/>
                    <rect x="32" y="0.09375" width="14" height="14" rx="5" fill="#3B2F8A"/>
                  </svg>
                {:else if catIconIdx(item.icon_key) === 5}
                  <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 45 45" fill="none" aria-hidden="true">
                    <path d="M36 29C39.866 29 43 32.134 43 36C43 39.866 39.866 43 36 43C32.134 43 29 39.866 29 36C29 32.134 32.134 29 36 29ZM9 2C12.866 2 16 5.13401 16 9C16 12.866 12.866 16 9 16C5.13401 16 2 12.866 2 9C2 5.13401 5.13401 2 9 2Z" fill="#FF3535"/>
                    <path d="M9 27C13.9706 27 18 31.0294 18 36C18 40.9706 13.9706 45 9 45C4.02944 45 0 40.9706 0 36C0 31.0294 4.02944 27 9 27ZM36 27C40.9706 27 45 31.0294 45 36C45 40.9706 40.9706 45 36 45C31.0294 45 27 40.9706 27 36C27 31.0294 31.0294 27 36 27ZM9 31C6.23858 31 4 33.2386 4 36C4 38.7614 6.23858 41 9 41C11.7614 41 14 38.7614 14 36C14 33.2386 11.7614 31 9 31ZM36 31C33.2386 31 31 33.2386 31 36C31 38.7614 33.2386 41 36 41C38.7614 41 41 38.7614 41 36C41 33.2386 38.7614 31 36 31ZM25.3281 15.4287C26.4997 14.2571 28.3997 14.2571 29.5713 15.4287C30.7428 16.6003 30.7429 18.5003 29.5713 19.6719L28.6318 20.6104C28.5235 21.8899 28.524 23.1097 28.6328 24.3896L29.5713 25.3281C30.7429 26.4997 30.7428 28.3997 29.5713 29.5713C28.3997 30.7429 26.4997 30.7429 25.3281 29.5713L24.3779 28.6211C23.1051 28.5104 21.8946 28.5075 20.6279 28.6143L19.6719 29.5713C18.5003 30.7429 16.6003 30.7428 15.4287 29.5713C14.2571 28.3997 14.2571 26.4997 15.4287 25.3281L16.4395 24.3164C16.5471 23.0866 16.5464 21.9107 16.4375 20.6807L15.4287 19.6719C14.2571 18.5003 14.2571 16.6003 15.4287 15.4287C16.6003 14.2572 18.5003 14.2571 19.6719 15.4287L20.6689 16.4258C21.9036 16.5325 23.0886 16.5311 24.335 16.4209L25.3281 15.4287ZM9 0C13.9706 0 18 4.02944 18 9C18 13.9706 13.9706 18 9 18C4.02944 18 0 13.9706 0 9C0 4.02944 4.02944 1.03081e-06 9 0ZM36 0C40.9706 0 45 4.02944 45 9C45 13.9706 40.9706 18 36 18C31.0294 18 27 13.9706 27 9C27 4.02944 31.0294 1.03081e-06 36 0ZM9 4C6.23858 4 4 6.23858 4 9C4 11.7614 6.23858 14 9 14C11.7614 14 14 11.7614 14 9C14 6.23857 11.7614 4 9 4ZM36 4C33.2386 4 31 6.23858 31 9C31 11.7614 33.2386 14 36 14C38.7614 14 41 11.7614 41 9C41 6.23857 38.7614 4 36 4Z" fill="#3B2F8A"/>
                  </svg>
                {:else if catIconIdx(item.icon_key) === 6}
                  <svg xmlns="http://www.w3.org/2000/svg" width="26" height="21" viewBox="0 0 45 36" fill="none" aria-hidden="true">
                    <path d="M28 0C26.0745 6.58148e-05 24.331 0.777963 23.0654 2.03613H17C15.6194 2.03626 14.5 3.15553 14.5 4.53613C14.5002 5.91663 15.6195 7.036 17 7.03613H21V17C21 20.8659 24.1341 23.9999 28 24H37.8125V26.5C37.8125 29.1193 35.9318 31 33.3125 31H9.5C6.88084 30.9999 5 29.1192 5 26.5V13L4.9873 12.7441C4.85914 11.4836 3.79432 10.5 2.5 10.5C1.20578 10.5001 0.140827 11.4837 0.0126953 12.7441L0 13V26.5C0 31.8806 4.11941 35.9999 9.5 36H33.3125C38.6932 36 42.8125 31.8807 42.8125 26.5V22.0811C44.1591 20.8053 45 19.0014 45 17V7C45 3.13401 41.866 0 38 0H28ZM7.57031 1C5.63743 1.00013 4.07031 2.56708 4.07031 4.5C4.07031 6.43292 5.63743 7.99987 7.57031 8C9.50331 8 11.0703 6.433 11.0703 4.5C11.0703 2.567 9.50331 1 7.57031 1Z" fill="#3B2F8A"/>
                    <path d="M27.0002 12C27.0002 15.5899 29.9104 18.5 33.5002 18.5C37.0901 18.5 40.0002 15.5899 40.0002 12C40.0002 8.41015 37.0901 5.5 33.5002 5.5C29.9104 5.5 27.0002 8.41015 27.0002 12Z" fill="#FF3535"/>
                  </svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="28" viewBox="0 0 41 47" fill="none" aria-hidden="true">
                    <rect width="30" height="38" rx="10" fill="#3B2F8A"/>
                    <path d="M37.9902 18.1094L37.9902 32.2236C37.9902 38.8484 32.1699 44.2187 24.9902 44.2187C17.8105 44.2187 11.9902 38.8483 11.9902 32.2236L11.9902 26.2261" stroke="#3B2F8A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M15.1951 12.1094L10.9951 19.1094H17.9951L13.7951 26.1094" stroke="#FF3535" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {/if}
              </div>

              <!-- 카테고리 이름 -->
              <span class="cat-card-name">{item.name}</span>

              <!-- 아이콘 이미지 선택 -->
              <label class="btn-icon-pick" title="아이콘 이미지 선택">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span class="pick-label">이미지</span>
                <input
                  type="file"
                  accept="image/*"
                  class="sr-only"
                  onchange={(e) => onFileChange(item.code_id, e)}
                />
              </label>

              <!-- 삭제 -->
              <button
                type="button"
                class="btn-remove"
                onclick={() => removeItem(item.code_id)}
                aria-label="{item.name} 제거"
              >✕</button>
            </div>
          {/snippet}
        </CmsDragList>
      </div>
    {:else}
      <p class="empty-hint">위 목록에서 카테고리를 선택해 추가하세요.</p>
    {/if}

    {#if error}
      <p class="save-error" role="alert">{error}</p>
    {/if}

    <!-- ③ 상품 키워드 설정: 카테고리 추가목록 아래 연속 배치 -->
    <div class="kw-area">
    <p class="section-label">
      상품 키워드
      <span class="hint">최대 10개 · 모바일 화면 노출</span>
    </p>

    {#if selectedKeywords.length < 10}
      <CmsSuggestPicker
        id="kw-picker"
        bind:selectedId={kwPickerSelectedId}
        options={availableKwOptions}
        placeholder="브랜드·키워드 검색 또는 선택..."
        listLabel="키워드 제안"
        onselect={(opt) => addKeyword(opt.id)}
      >
        {#snippet field(c)}
          <input
            type="text"
            class="f-input"
            id={c.id}
            placeholder={c.placeholder}
            aria-label="키워드 선택"
            value={c.value}
            oninput={c.oninput}
            onkeydown={c.onkeydown}
            onfocus={c.onfocus}
            onblur={c.onblur}
            aria-autocomplete={c.ariaAutocomplete}
            aria-expanded={c.ariaExpanded}
            aria-controls={c.ariaControls}
            autocomplete="off"
          />
        {/snippet}
      </CmsSuggestPicker>
    {:else}
      <p class="kw-max-hint">최대 10개 선택 완료</p>
    {/if}

    {#if selectedKeywords.length > 0}
      <div class="kw-chips">
        {#each selectedKeywords as kw}
          <span class="kw-chip">
            {kw}
            <button
              type="button"
              class="kw-chip-remove"
              onclick={() => removeKeyword(kw)}
              aria-label="{kw} 제거"
            >✕</button>
          </span>
        {/each}
      </div>
    {/if}
    </div><!-- /.kw-area -->
  </div><!-- /.modal-scroll -->

  <div class="modal-footer">
    <button class="btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>
    <button class="btn-save" onclick={save} disabled={isSaving || selected.length === 0}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</aside>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16, 11, 50, 0.3);
  }

  .modal-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100dvh;
    width: 420px;
    z-index: 201;
    background: var(--cs-white);
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    box-shadow: -4px 0 24px rgba(16, 11, 50, 0.15);
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    background: var(--cs-dark);
    padding: 20px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    overflow: hidden;
  }

  .modal-title {
    color: var(--cs-white);
    font: var(--text-pc-title-16);
  }

  .modal-close {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    min-height: 32px;
  }
  .modal-close:hover { color: var(--cs-white); }

  /* 단일 스크롤 영역: 모달 내 전체 콘텐츠 */
  .modal-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px 40px;
  }

  .section-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 10px;
    font-weight: 700;
  }
  .section-label.mt { margin-top: 24px; }

  .hint {
    font-weight: 400;
    color: var(--cs-text-light);
    margin-left: 6px;
  }

  .f-input {
    flex: 1;
    width: 100%;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: 10px;
    padding: 12px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    min-height: 44px;
    box-sizing: border-box;
  }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  /* ── 추가목록 ── */
  .order-list :global(.order-drag) { gap: 8px; }

  .cat-card-inner {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  /* 아이콘 박스 */
  .cat-card-icon {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-lilac);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .icon-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* 카테고리 이름 */
  .cat-card-name {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 이미지 선택 레이블-버튼 */
  .btn-icon-pick {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 10px;
    background: var(--cs-surface-gray);
    border: 1px solid #ECEBF4;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s;
  }
  .btn-icon-pick:hover {
    background: rgba(59, 47, 138, 0.06);
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }
  .pick-label { font: var(--text-pc-script-12); }
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0);
    white-space: nowrap; border-width: 0;
  }

  /* 삭제 버튼 */
  .btn-remove {
    background: none;
    border: none;
    color: var(--cs-text-light);
    font-size: 13px;
    cursor: pointer;
    padding: 4px 6px;
    min-height: 28px;
    flex-shrink: 0;
    transition: color 0.12s;
  }
  .btn-remove:hover { color: var(--cs-red-badge); }

  /* 빈 상태 */
  .empty-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    text-align: center;
    padding: 24px 0 8px;
    margin-top: 16px;
  }

  /* 에러 */
  .save-error {
    margin-top: 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    background: rgba(255, 53, 53, 0.08);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
  }

  /* 푸터 */
  .modal-footer {
    flex-shrink: 0;
    padding: 16px 24px;
    display: flex;
    gap: 10px;
    border-top: 1px solid var(--cs-lilac);
  }

  .btn-cancel {
    flex: 1;
    height: 50px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-cancel:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .btn-cancel:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-save {
    flex: 1;
    height: 50px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-save:hover:not(:disabled) { background: var(--cs-red); }
  .btn-save:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  /* ── 키워드 영역 (modal-scroll 내 연속 배치) ── */
  .kw-area {
    margin-top: 24px;
  }

  /* ── 키워드 칩 ── */
  .kw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .kw-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border-radius: var(--radius-sm);
    padding: 5px 10px;
    font: var(--text-pc-body-14);
    font-size: 13px;
  }

  .kw-chip-remove {
    background: none;
    border: none;
    color: var(--cs-text-mid);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    font-size: 11px;
    min-width: 16px;
    min-height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .kw-chip-remove:hover { color: var(--cs-red-badge); }

  .kw-max-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 8px 0 0;
  }
</style>
