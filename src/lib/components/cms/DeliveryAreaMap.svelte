<script lang="ts">
  // DeliveryAreaMap.svelte — 배송 허용지역 카카오맵 보기 + 지도 클릭으로 지역 선택
  // 등록된 지역은 마커+이름 라벨로 표시하고, 지도를 클릭하면 그 지점의 시/도·시군구를 읽어 onpick으로 알린다.
  // 지역 등록 자체는 부모(/cms/set/rental)가 확인 후 ?/addDeliveryArea로 처리한다.
  import { onMount } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import { areaLabel, type DeliveryAreaLike } from '$lib/utils/deliveryArea'
  import {
    isKakaoMapConfigured,
    loadKakaoMaps,
    reverseRegion,
    geocodeRegion,
    type KakaoNamespace,
  } from '$lib/utils/kakaoMaps'

  interface MapArea extends DeliveryAreaLike {
    id: string
    lat: number | null
    lng: number | null
  }

  interface Props {
    areas: MapArea[]
    onpick: (pick: { sido: string; sigungu: string; lat: number; lng: number }) => void
  }

  let { areas, onpick }: Props = $props()

  let mapEl = $state<HTMLDivElement | null>(null)
  let status = $state<'loading' | 'ready' | 'nokey' | 'error'>('loading')
  let kakao: KakaoNamespace | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let map: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let overlays: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pickMarker: any = null
  let renderSeq = 0

  onMount(() => {
    if (!isKakaoMapConfigured()) { status = 'nokey'; return }
    let disposed = false
    loadKakaoMaps()
      .then((k) => {
        if (disposed || !mapEl) return
        kakao = k
        map = new k.maps.Map(mapEl, {
          center: new k.maps.LatLng(36.5, 127.8),
          level: 12,
        })
        k.maps.event.addListener(map, 'click', async (e: { latLng: { getLat(): number; getLng(): number } }) => {
          const lat = e.latLng.getLat()
          const lng = e.latLng.getLng()
          const region = await reverseRegion(k, lat, lng)
          if (!region) { csToast.warning('이 위치의 행정구역을 확인할 수 없습니다.'); return }
          if (pickMarker) pickMarker.setMap(null)
          pickMarker = new k.maps.Marker({ position: e.latLng, map })
          onpick({ sido: region.sido, sigungu: region.sigungu, lat, lng })
        })
        status = 'ready'
      })
      .catch(() => { status = 'error' })
    return () => { disposed = true }
  })

  // 등록 지역이 바뀔 때마다 마커 갱신 (좌표가 없으면 이름으로 위치를 찾는다)
  $effect(() => {
    const list = areas
    if (status !== 'ready' || !kakao || !map) return
    const k = kakao
    const seq = ++renderSeq
    for (const o of overlays) o.setMap(null)
    overlays = []
    if (pickMarker) { pickMarker.setMap(null); pickMarker = null }
    ;(async () => {
      for (const a of list) {
        let lat = a.lat
        let lng = a.lng
        if (lat == null || lng == null) {
          const found = await geocodeRegion(k, a.sigungu ? `${a.sido} ${a.sigungu}` : a.sido)
          if (!found) continue
          lat = found.lat
          lng = found.lng
        }
        if (seq !== renderSeq) return
        const pos = new k.maps.LatLng(lat, lng)
        const marker = new k.maps.Marker({ position: pos, map })
        const label = new k.maps.CustomOverlay({
          position: pos,
          yAnchor: 2.1,
          content: `<div class="dam-label">${areaLabel(a).replace(/[<>&]/g, '')}</div>`,
          map,
        })
        overlays.push(marker, label)
      }
    })()
  })
</script>

<div class="dam-wrap">
  {#if status === 'nokey'}
    <div class="dam-msg">
      카카오맵 키가 설정되지 않아 지도를 표시할 수 없습니다.<br />
      환경변수 <code>PUBLIC_KAKAO_MAP_KEY</code>(카카오 JavaScript 키, 사이트 도메인 등록 필요)를 등록해 주세요.
    </div>
  {:else if status === 'error'}
    <div class="dam-msg">카카오맵을 불러오지 못했습니다. 키와 등록 도메인을 확인해 주세요.</div>
  {:else}
    <div class="dam-map" bind:this={mapEl} role="application" aria-label="배송 허용지역 지도"></div>
    {#if status === 'loading'}
      <div class="dam-msg dam-msg--over">지도를 불러오는 중...</div>
    {:else}
      <p class="dam-hint">지도를 클릭하면 그 지점의 시/군/구를 선택해 배송 허용지역으로 추가할 수 있습니다.</p>
    {/if}
  {/if}
</div>

<style>
  .dam-wrap { position: relative; }
  .dam-map {
    width: 100%;
    height: 380px;
    border-radius: var(--cms-radius-md, 15px);
    overflow: hidden;
    background: var(--cs-lilac);
  }
  .dam-msg {
    padding: 28px 20px;
    border-radius: var(--cms-radius-md, 15px);
    background: var(--cs-lilac);
    color: var(--cs-text);
    font-size: 13px;
    line-height: 1.6;
    text-align: center;
  }
  .dam-msg--over {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dam-hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--cs-text-mid, #666666);
  }
  :global(.dam-label) {
    padding: 4px 10px;
    border-radius: 30px;
    background: var(--cs-purple);
    color: var(--cs-white, #ffffff);
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }
</style>
