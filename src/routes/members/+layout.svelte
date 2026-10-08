<script lang="ts">
  let { children } = $props()
</script>

{@render children()}

<!-- [2026-09-29] 아래 숨김 규칙을 컴포넌트 <style>(:global)에서 <svelte:head> 스타일로 이동 — :global 규칙은 화면 이동 후에도 문서에 남아
     다른 화면(상품·하입팩·헬프 등)의 플로팅 메뉴·GNB까지 계속 숨기는 결함이 있었음. head 스타일은 이 레이아웃이 사라질 때 자동 제거된다. -->
<svelte:head>
  <style>
    /* Members 페이지: 모바일(<1024px, MembersHero·PC여백 보정과 동일 기준)에서
       공통 데스크톱 GNB 숨김. 원본 그대로 유지.
       2026-10-09(Stephen 지시): 공통 플로팅 아이콘 메뉴(.fab-bar)는 이 규칙에서 제외 — 모바일에서도 노출.
       (이전엔 <1024px에서 .fab-bar까지 함께 숨겨 /members 모바일만 플로팅 메뉴가 없었음. PC 1024px 이상은 원래 노출) */
    @media (max-width: 1023px) {
      .gnb-desktop-wrap {
        display: none !important;
      }
    }

    /* [GNB-BREAKPOINT-FIX 2026-08-10 — 안전 보강, 원본 로직 변경 없음]
       GNB.svelte 자체 전환점은 768px(≥768px에서 모바일 GNB 자동 숨김)이라, 위 규칙과
       맞물려 768~1023px 구간에서 데스크톱·모바일 GNB가 동시에 사라지던 문제가 있었음.
       이 블록은 그 구간에서만 모바일 GNB를 강제로 다시 노출시켜 완전 미노출을 막는다
       (768px 미만 원본 동작·1024px 이상 원본 동작은 전혀 건드리지 않음).
       복원(되돌리기) 시 이 블록만 삭제하면 원본 상태로 완전히 복귀됨. */
    @media (min-width: 768px) and (max-width: 1023px) {
      .gnb-mobile-wrap {
        display: flex !important;
      }
    }
  </style>
</svelte:head>

