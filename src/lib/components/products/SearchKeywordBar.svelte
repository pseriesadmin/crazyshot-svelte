<script lang="ts">
  import svgPaths from '$lib/assets/svg/search-output-paths'

  interface Props {
    keywords?: string[]
  }

  let {
    keywords = [
      'CANON 100mm',
      'FeiyuTech SCORP Mini 2',
      'FDR-AX43',
      'Air 3S Drone',
      'Air 3S Drone',
      'Air 3S Drone',
    ],
  }: Props = $props()
</script>

<section class="keywords-section">
  <div class="keywords-inner">
    <div class="title-bar">
      <h2 class="title-text">관심집중 키워드</h2>
      <span class="title-dots" aria-hidden="true">···</span>
      <div class="plus-box" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect width="22" height="22" rx="7" fill="#E1DEF3" />
          <path d={svgPaths.p160bd500} fill="#553FE0" />
        </svg>
      </div>
    </div>

    <div class="chip-bar">
      {#each keywords as kw, i (i)}
        <button class="chip">{kw}</button>
      {/each}
      <span class="fire-badge" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 29.9999 29.9999" fill="none">
          <path d={svgPaths.p3a2fea00} fill="#FF3535" />
        </svg>
      </span>
    </div>
  </div>
</section>

<style>
  .keywords-section {
    width: 100%;
    padding: 0 25px;
  }
  @media (min-width: 1024px) {
    .keywords-section {
      padding: 0 100px;
    }
  }
  .keywords-inner {
    max-width: 1600px;
    margin: 0 auto;
    padding-bottom: 50px;
  }
  .title-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 40px;
    padding-bottom: 25px;
  }
  .title-text {
    font-size: 21px;
    font-weight: 700;
    line-height: 1.6;
    letter-spacing: -0.3px;
    color: #100b32;
    font-family: 'Noto Sans KR', sans-serif;
  }
  @media (min-width: 1024px) {
    .title-text {
      font-size: 25px;
    }
  }
  .title-dots {
    font-size: 21px;
    font-weight: 700;
    line-height: 1.6;
    color: #100b32;
    font-family: 'Tilt Warp', sans-serif;
  }
  @media (min-width: 1024px) {
    .title-dots {
      font-size: 25px;
    }
  }
  .plus-box {
    display: flex;
    align-items: center;
  }
  .chip-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .chip {
    padding: 8px 25px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.6;
    letter-spacing: -0.5px;
    white-space: nowrap;
    background: #e1def3;
    color: #444444;
    border-radius: 13px;
    border: none;
    cursor: pointer;
    font-family: 'Noto Sans KR', sans-serif;
    transition: background 0.15s;
    min-height: 44px;
  }
  .chip:hover {
    background: #c1bbec;
  }
  .fire-badge {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
</style>
