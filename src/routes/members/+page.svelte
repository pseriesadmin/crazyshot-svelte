<script lang="ts">
  import MembersHero from '$lib/components/members/MembersHero.svelte'
  import PricingCards from '$lib/components/members/PricingCards.svelte'
  import FeaturesTable from '$lib/components/members/FeaturesTable.svelte'
  import CommonBenefits from '$lib/components/members/CommonBenefits.svelte'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
</script>

<svelte:head>
  <title>Members — CrazyShot</title>
  <meta name="description" content="CrazyShot 멤버십 — 촬영장비 구독 서비스. Easy, Pop, Crazy 플랜으로 나에게 맞는 혜택을 누리세요." />
</svelte:head>

<div class="members-page">
  <MembersHero />

  <div class="pc-content-wrap">
    <section class="pc-section" id="pricing" aria-label="멤버십 플랜">
      <PricingCards />
    </section>

    <section class="pc-section" aria-label="플랜 혜택 비교">
      <FeaturesTable />
    </section>

    <section class="pc-section" aria-label="K-트레일 혜택">
      <CommonBenefits />
    </section>
  </div>
</div>

<BottomTabBar />

<style>
  .members-page {
    background: var(--cs-lilac);
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    padding-bottom: 80px;
  }

  @media (min-width: 768px) {
    .members-page { padding-bottom: 0; }
  }

  /* Mobile: 섹션 간격 없이 연속 배치 */
  .pc-content-wrap {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .pc-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  @media (min-width: 1024px) {
    /* PC: fixed GNB(120px) + gap 100px = 220px top offset. 원본 250px(50py+100gnb+50gap+50bodyPt)에 근사 */
    .members-page {
      padding: 220px 0 150px;
      gap: 50px;
    }

    .pc-content-wrap {
      gap: 150px;
    }
  }
</style>
