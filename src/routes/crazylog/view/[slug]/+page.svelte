<script lang="ts">
  const YOUTUBE_VIDEO_ID = 'NUYvbT6vTPs'
  let showModal = $state(false)
  let liked    = $state(false)

  const relatedPosts = [
    { id: 1, title: '[사용기] SONY FE 24-105  가볍게 고퀄 영상을 바로 만들어주다', meta: '1시간 전·by 홍기동', img: '/crazylog/post-img1.png', imgStyle: 'object-fit:cover;width:100%;height:100%;' },
    { id: 2, title: '액션캠의 왕좌를 되찾으러 돌아왔다.\nGoPro HERO13 Black',          meta: '2시간 전·by 유말자',  img: '/crazylog/post-img2.png', imgStyle: 'object-fit:cover;width:100%;height:100%;' },
    { id: 3, title: '휴대용 디자인으로 이동 중에도 미디어 카드에 쉽게 접근 가능',     meta: '2시간 전·by 유말자',  img: '/crazylog/post-img3.png', imgStyle: 'position:absolute;height:226.67%;left:0.04%;top:-94.28%;width:100%;max-width:none;' },
    { id: 4, title: 'onn. 52인치 삼각대, 컴팩트 카메라, 스마트폰 및 GoPro 액션 카메라용 스', meta: '2시간 전·by 유말자', img: '/crazylog/post-img4.png', imgStyle: 'position:absolute;height:540.57%;left:-70.79%;top:-135.73%;width:238.49%;max-width:none;' },
    { id: 5, title: 'K-트레일로그를 남기는 멋진 일은 우리들에게 즐거움의 폭증이다!!', meta: '2시간 전·by 유말자',  img: '/crazylog/post-img5.png', imgStyle: 'object-fit:cover;width:100%;height:100%;' },
  ]

  const PC_SVG = {
    backArrow:  'M19.8844 8.5707L1.5 8.57107M8.57107 1.5L1.5 8.57107L8.57107 15.6421',
    goArrow:    'M14.4996 0C15.3281 1.64973e-05 15.9996 0.671583 15.9996 1.5V11.5C15.9992 12.328 15.3278 13 14.4996 13C13.6717 12.9998 13.0001 12.3279 12.9996 11.5V5.12109L10.5602 7.56055L2.5602 15.5596C1.97438 16.1449 1.02473 16.1451 0.439102 15.5596C-0.146507 14.9739 -0.146228 14.0243 0.439102 13.4385L10.8776 3H4.49965C3.67171 2.99979 3.00014 2.32788 2.99965 1.5C2.99965 0.671704 3.6714 0.000212116 4.49965 0H14.4996Z',
    dots:       'M5.5 9.5C6.32843 9.5 7 10.1716 7 11C7 11.8284 6.32843 12.5 5.5 12.5C4.67157 12.5 4 11.8284 4 11C4 10.1716 4.67157 9.5 5.5 9.5ZM11 9.5C11.8284 9.5 12.5 10.1716 12.5 11C12.5 11.8284 11.8284 12.5 11 12.5C10.1716 12.5 9.5 11.8284 9.5 11C9.5 10.1716 10.1716 9.5 11 9.5ZM16.5 9.5C17.3284 9.5 18 10.1716 18 11C18 11.8284 17.3284 12.5 16.5 12.5C15.6716 12.5 15 11.8284 15 11C15 10.1716 15.6716 9.5 16.5 9.5Z',
    playTri:    'M65.6185 44.2601C69.7337 46.636 69.7337 52.5758 65.6185 54.9517L46.23 66.1457C42.1148 68.5216 36.9708 65.5517 36.9708 60.7999L36.9708 38.412C36.9708 33.6602 42.1148 30.6903 46.23 33.0662L65.6185 44.2601Z',
    playCircle: 'M100 50C100 94.1177 95.4249 100 50 100C5.88235 100 0 94.1177 0 50C0 4.57516 5.88235 0 50 0C95.4249 0 100 4.57516 100 50Z',
  }

  const MOB_SVG = {
    back:       'M16 6.00001H1M5.61549 1.00001L1 6.00001L5.61549 11',
    heart:      'M19.7556 0C24.6867 0 28 4.56312 28 8.82C28 17.4409 14.2489 24.5 14 24.5C13.7511 24.5 0 17.4409 0 8.82C0 4.56312 3.31333 0 8.24444 0C11.0756 0 12.9267 1.39344 14 2.61844C15.0733 1.39344 16.9244 0 19.7556 0Z',
    burgerTop:  'M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z',
    burgerMid:  'M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z',
    dots:       'M5.5 9.5C6.32843 9.5 7 10.1716 7 11C7 11.8284 6.32843 12.5 5.5 12.5C4.67157 12.5 4 11.8284 4 11C4 10.1716 4.67157 9.5 5.5 9.5ZM11 9.5C11.8284 9.5 12.5 10.1716 12.5 11C12.5 11.8284 11.8284 12.5 11 12.5C10.1716 12.5 9.5 11.8284 9.5 11C9.5 10.1716 10.1716 9.5 11 9.5ZM16.5 9.5C17.3284 9.5 18 10.1716 18 11C18 11.8284 17.3284 12.5 16.5 12.5C15.6716 12.5 15 11.8284 15 11C15 10.1716 15.6716 9.5 16.5 9.5Z',
    playTri:    'M65.6185 44.2601C69.7337 46.636 69.7337 52.5758 65.6185 54.9517L46.23 66.1457C42.1148 68.5216 36.9708 65.5517 36.9708 60.7999L36.9708 38.412C36.9708 33.6602 42.1148 30.6903 46.23 33.0662L65.6185 44.2601Z',
    playCircle: 'M100 50C100 94.1177 95.4249 100 50 100C5.88235 100 0 94.1177 0 50C0 4.57516 5.88235 0 50 0C95.4249 0 100 4.57516 100 50Z',
  }

  let writeCardVisible = $state(true)

  $effect(() => {
    document.body.classList.add('crazylog-view')
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') showModal = false }
    document.addEventListener('keydown', onKey)

    let lastY = window.scrollY
    function onScroll() {
      const currentY = window.scrollY
      writeCardVisible = currentY <= lastY  // 다운스크롤(올라갈 때) = 노출, 업스크롤 = 숨김
      lastY = currentY
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      document.body.classList.remove('crazylog-view')
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll)
    }
  })
</script>

<svelte:head>
  <style>
    body.crazylog-view .gnb-mobile-wrap { display: none !important; }
    @media (max-width: 1023px) {
      body.crazylog-view .site-footer { display: none !important; }
    }

    [data-name="Posts-eng"] [data-name="img"] { cursor: pointer; }

    [data-name="Posts-eng"] [data-name="img"]::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(16,11,50,0);
      transition: background 0.4s ease;
      z-index: 1;
      pointer-events: none;
      border-radius: inherit;
    }
    [data-name="Posts-eng"] [data-name="img"]:hover::after {
      background: rgba(16,11,50,0.35);
    }

    [data-name="Posts-eng"] [data-name="img"]::before {
      content: '▶  영상 재생';
      position: absolute;
      bottom: 36px;
      left: 50%;
      transform: translateX(-50%) translateY(14px);
      background: rgba(16,11,50,0.76);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: var(--cs-white);
      padding: 9px 26px;
      border-radius: 99px;
      border: 1px solid rgba(255,255,255,0.14);
      font-size: 13px;
      font-weight: 700;
      font-family: 'Noto Sans KR', sans-serif;
      letter-spacing: -0.3px;
      opacity: 0;
      transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.34,1.3,0.64,1);
      z-index: 3;
      white-space: nowrap;
      pointer-events: none;
    }
    [data-name="Posts-eng"] [data-name="img"]:hover::before {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    [data-name="Posts-eng"] [data-name="img"] > div:last-child {
      position: absolute;
      top: 50%;
      left: 50%;
      z-index: 2;
      transform: translate(-50%, -50%) scale(1);
      transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1), filter 0.4s ease;
    }
    [data-name="Posts-eng"] [data-name="img"]:hover > div:last-child {
      transform: translate(-50%, -50%) scale(1.4);
      filter: drop-shadow(0 0 32px rgba(255,53,53,0.9)) drop-shadow(0 0 12px rgba(59,47,138,0.55));
    }

    [data-name="Posts-eng"] [data-name="img"] > div:last-child::after {
      content: '';
      position: absolute;
      inset: -10px;
      border-radius: 50%;
      border: 2px solid rgba(255,53,53,0.38);
      animation: cs-hero-pulse 2.8s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes cs-hero-pulse {
      0%, 100% { transform: scale(0.86); opacity: 0; }
      50%       { transform: scale(1.12); opacity: 1; }
    }
    [data-name="Posts-eng"] [data-name="img"]:hover > div:last-child::after {
      animation: none;
      opacity: 0;
    }

    [data-name="Posts-eng"] [data-name="img"] > div:first-child::after {
      content: 'YouTube';
      position: absolute;
      top: 16px;
      right: 16px;
      display: flex;
      align-items: center;
      gap: 5px;
      background: rgba(16,11,50,0.72);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      font-family: 'Noto Sans KR', sans-serif;
      letter-spacing: 0.3px;
      padding: 5px 10px 5px 8px;
      border-radius: 99px;
      border: 1px solid rgba(255,255,255,0.12);
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 0.3s ease, transform 0.3s ease;
      z-index: 3;
      pointer-events: none;
    }
    [data-name="Posts-eng"] [data-name="img"]:hover > div:first-child::after {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</svelte:head>

<!-- ══════════════════════════════════
     PC LAYOUT (≥ 1024px)
══════════════════════════════════ -->
<div class="d-view">
  <div class="d-body">

    <!-- 1. Navi-bar -->
    <div class="d-navi-bar">
      <button class="d-back-btn" onclick={() => history.back()} aria-label="뒤로 가기">
        <svg width="21.38" height="17.14" viewBox="0 0 21.3844 17.1421" fill="none">
          <path d={PC_SVG.backArrow} stroke="#100B32" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Back</span>
      </button>
      <span class="d-navi-title">K-Trail log</span>
      <div class="d-navi-spacer"></div>
    </div>

    <!-- 2. PostsEng (본문 카드) -->
    <div class="d-posts-eng" data-name="Posts-eng">
      <!-- Img() -->
      <div
        class="d-hero"
        data-name="img"
        onclick={() => showModal = true}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && (showModal = true)}
        aria-label="영상 재생"
      >
        <!-- first child (background layer) — YouTube badge target -->
        <div class="d-hero-img-wrap">
          <img
            src="/crazylog/content-hero-desktop.png"
            alt="경복궁 한복 체험 — K-Trail log 영상 썸네일"
            loading="eager"
            class="d-hero-img"
          />
        </div>
        <!-- last child (play button) — scale/glow target -->
        <div class="d-play-btn" aria-hidden="true">
          <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
            <defs>
              <linearGradient id="d-play-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#3B2F8A"/>
                <stop offset="100%" stop-color="#FF3535"/>
              </linearGradient>
            </defs>
            <path d={PC_SVG.playCircle} fill="url(#d-play-grad)"/>
            <path d={PC_SVG.playTri} fill="white"/>
          </svg>
        </div>
      </div>

      <!-- Writing() -->
      <div class="d-writing">
        <p class="d-author">Steven lee • Oct 24, 2022</p>
        <h1 class="d-title">Gyeongbokgung Hanbok Experience</h1>

        <div class="d-article">
          <h2 class="d-section-title">A Royal Capital Wrapped in Tradition</h2>
          <p>Seoul's Gyeongbokgung Palace sits at the heart of the city like a quiet sovereign — its sweeping tiled rooftops framed against the granite shoulders of Bugaksan. On a crisp October morning, we arrived before the tourist crowds, cameras in hand, to document the revival of joseon-era hanbok culture that has quietly taken over the palace grounds.</p>
          <p>The experience is deceptively simple: rent a hanbok from one of the dozens of shops lining the palace's northern gate, slip into billowing silk and cotton, then spend a few hours wandering courtyards that are normally a blur of selfie sticks. But wearing hanbok unlocks something different. The costume invites slowness. You walk differently, stand differently, and for a few hours, you inhabit a version of the city that most visitors never access.</p>

          <h2 class="d-section-title">The Gear Decision</h2>
          <p>For a shoot like this — rich textiles, rapidly shifting natural light, tight corridors between stone walls — we reached for the Sony FE 24-105mm f/4 G OSS mounted on the A7IV. The focal range is almost unfairly convenient: wide enough to capture the full sweep of Geunjeongjeon's throne hall, long enough to isolate a single embroidered sleeve against the glazed tile beyond.</p>
          <p>Optical stabilisation smoothed out movement in the narrow stone passages where tripods are impractical, and the linear AF transition kept focus pulls cinematic rather than hunting. The colour science on the A7IV renders deep indigo and crimson with exactly the saturation that hanbok deserves — very little grading needed in post.</p>

          <h2 class="d-section-title">Light and Timing</h2>
          <p>The palace faces south in the traditional Korean manner, which means golden-hour light rakes across the main courtyard in the late afternoon — something most visitors miss because they arrive at midday. We stayed through closing, watching the hanbok-clad visitors thin out until only a handful remained, the light going amber then copper against the painted eaves.</p>
          <p>If you plan a similar shoot, arrive when the gates open at 09:00, find your hanbok rental by 09:30, and use the first two hours while the light is low and crowds are manageable. Return just before 16:00 for the golden hour sequence.</p>

          <h2 class="d-section-title">A Note on Respect</h2>
          <p>The hanbok rental phenomenon has attracted its share of debate — questions of cultural appropriation versus appreciation, of historical accuracy versus Instagram aesthetics. What we observed at Gyeongbokgung was largely the latter: visitors from across Korea and the world treating the garments with genuine care and curiosity, palace guards joining impromptu photos with visitors, and older Koreans pausing to nod approvingly at particularly well-coordinated ensembles.</p>
          <p>The experience works because the setting demands a certain seriousness. The palace is not a theme park. Its weight — five centuries of Korean history — presses through even the most casual visit. Hanbok, worn here, becomes more than costume. It becomes a small act of homage.</p>
        </div>
      </div>
    </div>

    <!-- 3. Comments -->
    <div class="d-comments">

      <!-- Title bar -->
      <div class="d-comments-bar">
        <span class="d-comments-label">댓글</span>
        <span class="d-comments-count">03</span>
      </div>

      <!-- Review cards -->
      <div class="d-comments-list">

        <div class="d-review-card">
          <div class="d-review-header">
            <p class="d-review-title">가성비 최고예요!</p>
            <p class="d-review-date">Tawny / Apr 26, 2025</p>
          </div>
          <div class="d-review-body">
            <p>정말 훌륭한 제품입니다. 함께 제공된 매뉴얼은 조금 모호하지만, 사용하는 데 큰 어려움은 없었습니다. 설치와 사용을 돕는 온라인 영상도 많이 있습니다.</p>
          </div>
        </div>

        <div class="d-review-card">
          <div class="d-review-header">
            <p class="d-review-title">잘 작동해요, 설명서는 혼란스럽습니다.</p>
            <p class="d-review-date">Tawny / Apr 26, 2025</p>
          </div>
          <div class="d-review-body">
            <p>안정화 기능이 정말 좋아서 영상이 매끄럽게 나오네요. 설명서를 이해하기 어렵다 보니 제가 제대로 사용하고 있는 건지는 확신이 없지만, 필요한 용도로는 잘 쓰이고 있습니다.</p>
          </div>
        </div>

        <div class="d-review-card">
          <div class="d-review-header">
            <p class="d-review-title">light weight!</p>
            <p class="d-review-date">Samantha / Jul 17, 2025</p>
          </div>
          <div class="d-review-body">
            <p>Its a great product! Was fairly easy to setup and use! It works great and lasts a long while before having to recharge it!</p>
          </div>
        </div>

      </div><!-- /d-comments-list -->

      <!-- Comment input form -->
      <div class="d-comment-form">
        <input
          class="d-comment-input"
          type="text"
          placeholder="후기 입력..."
          aria-label="후기 입력"
        />
        <button class="d-comment-send" aria-label="등록">
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
            <path d="M16 6.00001H1M5.61549 1.00001L1 6.00001L5.61549 11" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

    </div><!-- /d-comments -->

    <!-- 4. PostsMore — Popular items -->
    <div class="d-posts-more">
      <div class="d-popular">

        <!-- Header -->
        <div class="d-pop-header">
          <span class="d-pop-title">Popular items</span>
          <div class="d-pop-header-icons">
            <!-- more (dots) -->
            <button class="d-pop-more-btn" aria-label="더보기">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect width="22" height="22" rx="7" fill="#ECEBF4"/>
                <path d={PC_SVG.dots} fill="#100B32"/>
              </svg>
            </button>
            <!-- go (diagonal arrow) -->
            <button class="d-pop-go-btn" aria-label="전체보기">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d={PC_SVG.goArrow} fill="#553FE0"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Cards -->
        <div class="d-pop-cards">

          <!-- List() — SONY (red bar) -->
          <div class="d-pop-card">
            <div class="d-pop-bar" style="background:#FF3535;"></div>
            <div class="d-pop-text">
              <p class="d-pop-name">[사용기] SONY FE 24-105  가볍게 고퀄 영상을 바로 만들어주다</p>
              <p class="d-pop-desc">Bower 6-in-1 Multi Selfie Tripod with Wireless Remote Shutter and Carrying Case — Compatible with iPhone...</p>
            </div>
            <div class="d-pop-img">
              <img src="/crazylog/post-img1.png" alt="SONY FE 24-105mm 렌즈" loading="lazy" />
            </div>
          </div>

          <!-- List1() — GoPro (purple bar) -->
          <div class="d-pop-card">
            <div class="d-pop-bar" style="background:#3B2F8A;"></div>
            <div class="d-pop-text">
              <p class="d-pop-name">액션캠의 왕좌를 되찾으러 돌아왔다. GoPro HERO13 Black</p>
              <p class="d-pop-desc">Best-in-Class 5.3K Video — the Ultimate Hero is now the most powerful action camera we've ever made, featuring the GP2 chip.</p>
            </div>
            <div class="d-pop-img">
              <img src="/crazylog/popular-img2.png" alt="GoPro HERO13 Black 액션캠" loading="lazy" />
            </div>
          </div>

        </div>
      </div>
    </div>

  </div>
</div>

<!-- ══════════════════════════════════
     MOBILE LAYOUT (< 1024px)
══════════════════════════════════ -->
<div class="m-view">

  <!-- 1. TopThumbView: pt-[40px] px-[25px] -->
  <div class="m-top">
    <div class="m-nav-pill">
      <button class="m-back" onclick={() => history.back()} aria-label="뒤로 가기">
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
          <path d={MOB_SVG.back} stroke="#444444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="m-nav-title">리뷰</span>
      <!-- Single SVG: viewBox="0 0 20 16.5", both bars in one <g> -->
      <button class="m-hamburger" aria-label="메뉴">
        <div class="m-hamburger-icon">
          <svg width="20" height="16.5" viewBox="0 0 20 16.5" fill="none" style="width:20px;height:16.5px;">
            <g>
              <path d={MOB_SVG.burgerMid} fill="#CF0000" />
              <path d={MOB_SVG.burgerTop} fill="#201857" />
            </g>
          </svg>
        </div>
      </button>
    </div>
  </div>

  <!-- 2. Body: pt-[50px] -->
  <div class="m-body">

    <!-- PostsEng — bg-white rounded-tl-[50px] rounded-tr-[50px] -->
    <div class="m-posts-eng" data-name="Posts-eng">

      <!-- Img() — h-[450px], play button centered -->
      <div
        class="m-hero"
        data-name="img"
        onclick={() => showModal = true}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && (showModal = true)}
        aria-label="영상 재생"
      >
        <!-- first child: image wrapper (YouTube badge target) -->
        <div class="m-hero-img-wrap">
          <img
            src="/crazylog/content-hero.png"
            alt="경복궁 한복 체험"
            loading="eager"
            class="m-hero-img"
          />
        </div>
        <!-- last child: play button (scale/glow target) -->
        <div class="m-play-btn" aria-hidden="true">
          <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
            <defs>
              <linearGradient id="m-play-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#3B2F8A"/>
                <stop offset="100%" stop-color="#FF3535"/>
              </linearGradient>
            </defs>
            <path d={MOB_SVG.playCircle} fill="url(#m-play-grad)"/>
            <path d={MOB_SVG.playTri} fill="white"/>
          </svg>
        </div>
      </div>

      <!-- Writing(): pb-[100px] pt-[50px] px-[25px] gap-[30px] -->
      <div class="m-writing">

        <!-- Frame2: author + wish -->
        <div class="m-frame2">
          <div class="m-author">
            <span>Steven lee </span><span>• Oct 24, 2022</span>
          </div>
          <button
            class="m-wish"
            onclick={() => liked = !liked}
            aria-label={liked ? '좋아요 취소' : '좋아요'}
            aria-pressed={liked}
          >
            <div class="m-wish-icon" aria-hidden="true">
              {#if !liked}
                <svg class="m-wish-svg" fill="none" viewBox="0 0 28 24.5" preserveAspectRatio="none">
                  <path d={MOB_SVG.heart} fill="#AAAAAA"/>
                </svg>
                <span class="m-wish-count m-wish-count-off">0</span>
              {:else}
                <svg class="m-wish-svg" fill="none" viewBox="0 0 28 24.5" preserveAspectRatio="none">
                  <path d={MOB_SVG.heart} fill="#553FE0"/>
                </svg>
                <span class="m-wish-count m-wish-count-on">3</span>
              {/if}
            </div>
          </button>
        </div>

        <!-- Title -->
        <h1 class="m-title">경복궁 한복 체험</h1>

        <!-- Body (Figma 원본 텍스트) -->
        <div class="m-article">
          <p>1. 메인 테마 소개: 경복궁 한복 체험<br/>
            아름답게 맞춤 제작된 한복을 입고 한국의 왕실 유산 속으로 걸어 들어가며 경복궁에서 특별한 순간을 기록해보세요.<br/>
            전문 브이로그 디렉터가 동행하여 동선을 안내하고, 고급 미러리스 카메라와 짐벌로 촬영을 진행합니다.<br/>
            한복 대여는 궁 근처에서 바로 진행되므로, 기다림 없이 체험을 시작할 수 있습니다.<br/>
            촬영한 원본 영상과 하이라이트 클립은 48시간 이내에 클라우드로 전달됩니다.</p>
          <p>2. 로드 트레일 일정 &amp; 주요 명소<br/>
            (2시간 기본 코스)<br/>
            이동 경로: 경복궁 → 국립민속박물관 → 북촌 한옥마을</p>
          <ul>
            <li>경복궁 – 조선 왕조 최대의 궁궐로, 웅장한 대문과 아름다운 전각, 계절별 정원이 특징입니다. 공공 구역 내 촬영이 가능하며(드론 사용 불가), 멋진 영상을 남길 수 있습니다.</li>
            <li>국립민속박물관 – 한국의 전통 생활문화를 직접 체험할 수 있는 야외 전시 공간.</li>
            <li>북촌 한옥마을 – 전통 한옥이 늘어선 그림 같은 골목길을 걸으며 자연스러운 순간과 영화 같은 장면을 담을 수 있습니다.</li>
          </ul>
          <p>(3시간 확장 코스) 에서는 삼청동 거리와 청와대 광장이 추가되어 더욱 다양한 촬영이 가능합니다.</p>
          <p>3. 예약 상세</p>
          <ul>
            <li>소요 시간: 2시간 또는 3시간 (도보 투어 &amp; 촬영 포함)</li>
            <li>포함 사항: 한복 대여 안내, 전문 촬영, 원본 &amp; 편집 하이라이트 클립 48시간 내 클라우드 제공</li>
            <li>미팅 장소: 경복궁역 4번 출구</li>
            <li>가격: 2시간 코스 – 100달러부터 / 3시간 코스 – 150달러부터</li>
            <li>예약 방법: 크레이지샷(CrazyShot) 계정 로그인 후 예약 진행</li>
          </ul>
          <p>참고: 날씨나 궁궐 규정에 따라 일정이 일부 조정될 수 있습니다.</p>
        </div>

      </div>
    </div><!-- /m-posts-eng -->

    <!-- 후기 div — w-[390px] px-[25px] pb-[100px] on #ecebf4 background -->
    <div class="m-huri">

      <!-- 댓글 title bar: flex justify-between -->
      <div class="m-huri-bar">
        <span class="m-huri-label">댓글</span>
        <span class="m-huri-count">03</span>
      </div>

      <!-- Frame1: gap-[30px] pb-[50px] -->
      <div class="m-frame1">

        <!-- List2: "가성비 최고예요!" -->
        <div class="m-review-card">
          <div class="m-review-header">
            <p class="m-review-title">가성비 최고예요!</p>
            <p class="m-review-date">Tawny /  Apr 26, 2025</p>
          </div>
          <div class="m-review-body">
            <p>정말 훌륭한 제품입니다. 함께 제공된 매뉴얼은 조금 모호하지만, 사용하는 데 큰 어려움은 없었습니다. 설치와 사용을 돕는 온라인 영상도 많이 있습니다.</p>
          </div>
        </div>

        <!-- List3: "잘 작동해요..." -->
        <div class="m-review-card">
          <div class="m-review-header">
            <p class="m-review-title">잘 작동해요, 설명서는 혼란스럽습니다.</p>
            <p class="m-review-date">Tawny /  Apr 26, 2025</p>
          </div>
          <div class="m-review-body">
            <p>안정화 기능이 정말 좋아서 영상이 매끄럽게 나오네요. 설명서를 이해하기 어렵다 보니 제가 제대로 사용하고 있는 건지는 확신이 없지만, 필요한 용도로는 잘 쓰이고 있습니다.</p>
          </div>
        </div>

        <!-- List4: "light weight!" -->
        <div class="m-review-card">
          <div class="m-review-header">
            <p class="m-review-title">light weight!</p>
            <p class="m-review-date">Samantha /  Jul 17, 2025</p>
          </div>
          <div class="m-review-body">
            <p>Its a great product! Was fairly easy to setup and use! It works great and lasts a long while before having to recharge it!</p>
          </div>
        </div>

      </div><!-- /m-frame1 -->

      <!-- Component: comment input form -->
      <div class="m-comment-form">
        <input
          class="m-comment-input"
          type="text"
          placeholder="후기 입력..."
          aria-label="후기 입력"
        />
        <button class="m-send-btn" aria-label="등록">
          <div style="transform: rotate(90deg); display:flex; align-items:center; justify-content:center; width:15px; height:10px;">
            <svg width="17" height="12" viewBox="0 0 17 12" fill="none" style="width:17px;height:12px;">
              <path d={MOB_SVG.back} stroke="#100B32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </button>
      </div>

    </div><!-- /m-huri -->

    <!-- Post: 연관정보 -->
    <div class="m-post">

      <!-- title bar: flex items-center (no justify-between!) -->
      <div class="m-post-bar">
        <span class="m-post-label">연관정보</span>
        <button class="m-post-more" aria-label="더보기">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect width="22" height="22" rx="7" fill="#E1DEF3"/>
            <path d={MOB_SVG.dots} fill="#553FE0"/>
          </svg>
        </button>
      </div>

      <!-- 5 related cards: gap-[30px] w-[340px] -->
      <div class="m-post-list">
        {#each relatedPosts as post, i}
          <a href="/crazylog/view/{post.id}" class="m-rel-card">
            <!-- Img: h-[150px] overflow-hidden -->
            <div class="m-rel-img-wrap">
              <img
                src={post.img}
                alt={post.title}
                loading="lazy"
                style={post.imgStyle}
              />
            </div>
            <!-- Writing: px-[30px] py-[20px] gap-[10px] -->
            <div class="m-rel-text">
              <p class="m-rel-title">{post.title}</p>
              <p class="m-rel-meta">{post.meta}</p>
            </div>
          </a>
        {/each}
      </div>

    </div><!-- /m-post -->

  </div><!-- /m-body -->

</div><!-- /m-view -->

<!-- ══════════════════════════════════
     YOUTUBE MODAL
══════════════════════════════════ -->
{#if showModal}
  <div class="yt-overlay" onclick={() => showModal = false} role="presentation">
    <div class="yt-dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="경복궁 한복 체험 영상">
      <button class="yt-close" onclick={() => showModal = false}>
        <span>닫기</span>
        <span class="yt-close-x">✕</span>
      </button>
      <div class="yt-player">
        <iframe
          src="https://www.youtube.com/embed/{YOUTUBE_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&color=white"
          title="Gyeongbokgung Hanbok Experience · K-Trail log"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>
      <div class="yt-caption">
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <rect width="16" height="11" rx="2.5" fill="#FF3535"/>
          <path d="M6.5 3L10.5 5.5L6.5 8V3Z" fill="white"/>
        </svg>
        <p>경복궁 한복 체험 · K-Trail log</p>
      </div>
    </div>
  </div>
{/if}

<!-- ══════════════════════════════════
     FLOATING WRITE CARD (로그인 사용자 요약 + 쓰기)
══════════════════════════════════ -->
<div class="write-card" class:write-card-hidden={!writeCardVisible} aria-label="내 로그 작성" role="complementary">
  <div class="wc-user">
    <div class="wc-avatar">S</div>
    <div class="wc-info">
      <span class="wc-name">스티븐봉재</span>
      <!-- 멤버십 배지: E=이지팩 / P=팝팩 / C=크레이지팩 -->
      <span class="wc-badge wc-badge-c" aria-label="크레이지팩 멤버십">C</span>
      <span class="wc-level">LV.4MD</span>
    </div>
  </div>
  <a href="/crazylog/1" class="wc-write-btn" aria-label="로그 작성하기">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1 13L5 9M9.5 1.5L12.5 4.5L5 12H2V9L9.5 1.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    쓰기
  </a>
</div>

<style>
  /* ══════════════════════════════════
     FLOATING WRITE CARD
  ══════════════════════════════════ */
  /* 모바일: 좌우 여백만 두고 가득 채움 */
  .write-card {
    position: fixed;
    bottom: 24px;
    left: 24px;
    right: 24px;
    width: auto;
    transform: translateY(0);
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 16px;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 12px 16px 12px 20px;
    box-shadow: 0 4px 24px rgba(16, 11, 50, 0.14);
    min-height: 64px;
    transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                opacity  0.35s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 1;
    pointer-events: auto;
  }

  .write-card-hidden {
    transform: translateY(calc(100% + 32px));
    opacity: 0;
    pointer-events: none;
  }

  /* PC: 중앙 고정 + 고정 폭 (콘텐츠 자연폭 × 1.3) */
  @media (min-width: 640px) {
    .write-card {
      left: 50%;
      right: auto;
      width: 460px;
      transform: translateX(-50%) translateY(0);
      white-space: nowrap;
    }
    .write-card-hidden {
      transform: translateX(-50%) translateY(calc(100% + 32px));
    }
  }

  /* 사용자 정보 영역 */
  .wc-user {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .wc-avatar {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--cs-purple) 0%, var(--cs-red-badge) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 900;
    color: var(--cs-white);
    flex-shrink: 0;
  }

  .wc-info {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .wc-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    letter-spacing: -0.5px;
  }

  /* 멤버십 배지 — 라운드 정사각형 */
  .wc-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 900;
    color: var(--cs-white);
    flex-shrink: 0;
    letter-spacing: 0;
    line-height: 1;
  }
  /* E: 이지팩 — 회색 계열 */
  .wc-badge-e { background: var(--cs-text-mid); }
  /* P: 팝팩 — 보라 */
  .wc-badge-p { background: var(--cs-purple); }
  /* C: 크레이지팩 — 오렌지 */
  .wc-badge-c { background: var(--cs-orange); }

  .wc-level {
    font-size: 11px;
    font-weight: 500;
    color: var(--cs-purple-light);
    background: var(--cs-purple-op10);
    padding: 2px 8px;
    border-radius: var(--radius-full);
  }

  /* 쓰기 버튼 */
  .wc-write-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 20px;
    height: 40px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border-radius: var(--radius-xl);
    font: var(--text-pc-body-14);
    font-weight: 700;
    letter-spacing: -0.3px;
    text-decoration: none;
    flex-shrink: 0;
    transition: background 0.15s;
  }

  .wc-write-btn:hover { background: var(--cs-red); }

  /* ══ 레이아웃 분기 (1024px) ════════════════════════ */
  .d-view { display: none; }
  .m-view { display: block; }
  @media (min-width: 1024px) {
    .d-view { display: block; }
    .m-view { display: none; }
  }

  /* ══════════════════════════════════
     PC
  ══════════════════════════════════ */
  .d-body {
    background: var(--cs-lilac);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: calc(var(--layout-header-h, 100px) + 50px) 40px 50px;
    gap: 50px;
  }

  /* 1. Navi-bar */
  .d-navi-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    max-width: 1240px;
    background: rgba(225,222,243,0.4);
    border-radius: 25px;
    padding: 20px 40px;
  }
  .d-back-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    min-height: 44px;
    padding: 0;
    transition: opacity 0.15s;
  }
  .d-back-btn:hover { opacity: 0.7; }
  .d-navi-title {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    font-weight: 400;
    color: var(--cs-purple-light);
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }
  .d-navi-bar { position: relative; }
  .d-navi-spacer { width: 80px; }

  /* 2. PostsEng */
  .d-posts-eng {
    background: var(--cs-white);
    border-radius: 30px;
    overflow: hidden;
    width: 100%;
    max-width: 1240px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .d-hero {
    position: relative;
    aspect-ratio: 5 / 3;
    min-height: 480px;
    max-height: 960px;
    width: 100%;
    overflow: hidden;
    cursor: pointer;
  }
  .d-hero-img-wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .d-hero-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }
  .d-play-btn {
    width: 100px;
    height: 100px;
    flex-shrink: 0;
  }

  .d-writing {
    padding: 50px;
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .d-author {
    font-size: 16px;
    font-weight: 400;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid);
    margin: 0;
  }
  .d-title {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 35px;
    font-weight: 400;
    color: var(--cs-text);
    margin: 0;
  }
  .d-article {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .d-section-title {
    font-size: 25px;
    font-weight: 900;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    margin: 8px 0 0;
  }
  .d-article p {
    font-size: 16px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.8;
  }

  /* 3. Comments */
  .d-comments {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    max-width: 1240px;
  }
  .d-comments-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 40px;
  }
  .d-comments-label,
  .d-comments-count {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
  }
  .d-comments-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .d-review-card {
    background: var(--cs-white);
    border-radius: 20px;
    overflow: hidden;
  }
  .d-review-header {
    background: var(--cs-purple-op10);
    padding: 16px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .d-review-title {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0;
  }
  .d-review-date {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .d-review-body {
    padding: 20px 40px;
  }
  .d-review-body p {
    font: var(--text-pc-body-14);
    font-weight: 400;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.7;
  }
  .d-comment-form {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--cs-white);
    border-radius: 20px;
    padding: 16px 20px 16px 40px;
  }
  .d-comment-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font: var(--text-pc-body-14);
    font-weight: 400;
    color: var(--cs-text);
  }
  .d-comment-input::placeholder {
    color: var(--cs-text-light);
  }
  .d-comment-send {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    background: var(--cs-purple-op10);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s;
    transform: rotate(-45deg);
  }
  .d-comment-send:hover {
    background: var(--cs-purple);
  }

  /* 4. PostsMore */
  .d-posts-more {
    width: 100%;
    max-width: 1240px;
  }
  .d-popular {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .d-pop-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 40px;
  }
  .d-pop-title {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    font-weight: 400;
    color: var(--cs-purple-light);
  }
  .d-pop-header-icons {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .d-pop-more-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .d-pop-go-btn {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    transition: opacity 0.15s;
  }
  .d-pop-go-btn:hover { opacity: 0.7; }

  .d-pop-cards {
    display: flex;
    flex-direction: row;
    gap: 30px;
  }
  .d-pop-card {
    background: var(--cs-white);
    border-radius: 30px;
    display: flex;
    overflow: hidden;
    flex: 1;
    max-width: 600px;
  }
  .d-pop-bar {
    width: 10px;
    flex-shrink: 0;
  }
  .d-pop-text {
    flex: 1;
    padding: 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .d-pop-name {
    font-size: 16px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    margin: 0;
    line-height: 1.4;
  }
  .d-pop-desc {
    font-size: 14px;
    font-weight: 400;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid);
    margin: 0;
    line-height: 1.6;
  }
  .d-pop-img {
    flex-shrink: 0;
    width: 150px;
    height: 150px;
    overflow: hidden;
    border-radius: 0 30px 30px 0;
  }
  .d-pop-img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* ══════════════════════════════════
     MOBILE
  ══════════════════════════════════ */
  .m-view {
    background: var(--cs-lilac);
    flex-direction: column;
    align-items: center;
    width: 100%;
  }
  @media (max-width: 1023px) {
    .m-view { display: flex; }
  }

  /* 1. TopThumbView: pt-[40px] px-[25px] */
  .m-top {
    width: 100%;
    padding: 40px 25px 0;
  }
  .m-nav-pill {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-purple-op10);
    border-radius: 20px;
    min-height: 60px;
    padding: 5px 20px;
    position: relative;
    width: 100%;
  }
  .m-back {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
  }
  .m-nav-title {
    font-size: 16px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }
  .m-hamburger {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
  }
  .m-hamburger-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 16.5px;
  }

  /* 2. Body: pt-[50px] */
  .m-body {
    width: 100%;
    padding-top: 50px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* PostsEng — bg-white rounded-tl-[50px] rounded-tr-[50px] */
  .m-posts-eng {
    background: var(--cs-white);
    border-radius: 50px 50px 0 0;
    overflow: hidden;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  /* Img(): h-[450px] */
  .m-hero {
    position: relative;
    aspect-ratio: 9 / 15;
    min-height: 480px;
    max-height: 900px;
    width: 100%;
    overflow: hidden;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .m-hero-img-wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .m-hero-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }
  .m-play-btn {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(1);
    z-index: 2;
    width: 100px;
    height: 100px;
    flex-shrink: 0;
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.4s ease;
  }

  .m-hero:hover .m-play-btn {
    transform: translate(-50%, -50%) scale(1.4);
    filter: drop-shadow(0 0 32px rgba(255, 53, 53, 0.9)) drop-shadow(0 0 12px rgba(59, 47, 138, 0.55));
  }

  /* Writing(): pb-[100px] pt-[50px] px-[25px] gap-[30px] */
  .m-writing {
    width: 100%;
    padding: 50px 25px 100px;
    display: flex;
    flex-direction: column;
    gap: 30px;
    align-items: flex-start;
    flex-shrink: 0;
  }

  /* Frame2: author + wish */
  .m-frame2 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    flex-shrink: 0;
  }
  .m-author {
    font-size: 14px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    letter-spacing: -0.5px;
    line-height: 2;
  }
  .m-author span:last-child { color: var(--cs-text-dark); }

  /* Wish: h-[25px] w-[28px] + count overlay */
  .m-wish {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    flex-shrink: 0;
    transition: transform 0.15s;
  }
  .m-wish:hover { transform: scale(1.1); }
  .m-wish-icon {
    position: relative;
    width: 28px;
    height: 24.5px;
  }
  .m-wish-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .m-wish-count {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 500;
    font-family: 'Noto Sans KR', sans-serif;
    white-space: nowrap;
    pointer-events: none;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .m-wish-count-off {
    top: 6.86%;
    right: 35%;
    bottom: 17.14%;
    left: 40%;
    color: var(--cs-text-mid);
  }
  .m-wish-count-on {
    top: 9.43%;
    right: 35%;
    bottom: 14.57%;
    left: 40%;
    color: var(--cs-white);
  }

  /* Title */
  .m-title {
    font-size: 24px;
    font-weight: 900;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.5px;
    word-break: keep-all;
    flex-shrink: 0;
  }

  /* Article body */
  .m-article {
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
    min-width: 100%;
  }
  .m-article p, .m-article li {
    font-size: 14px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 2;
    letter-spacing: -0.5px;
  }
  .m-article ul {
    margin: 0;
    padding-left: 21px;
    list-style: disc;
  }
  .m-article li { margin-bottom: 0; }

  /* 후기 div: px-[25px] pb-[100px] on #ecebf4 bg */
  .m-huri {
    width: 100%;
    padding: 0 25px 100px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex-shrink: 0;
  }

  /* 댓글 title bar: py-[40px] flex justify-between */
  .m-huri-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 40px 0;
    width: 100%;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    color: var(--cs-text);
    text-align: center;
    letter-spacing: -0.3px;
    line-height: 1.6;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .m-huri-label { font-size: 21px; }
  .m-huri-count { font-size: 18px; }

  /* Frame1: gap-[30px] pb-[50px] */
  .m-frame1 {
    display: flex;
    flex-direction: column;
    gap: 30px;
    padding-bottom: 50px;
    width: 100%;
    align-items: flex-start;
    flex-shrink: 0;
  }

  /* Review card: bg-white rounded-[30px] */
  .m-review-card {
    background: var(--cs-white);
    border-radius: 30px;
    overflow: hidden;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex-shrink: 0;
  }
  /* Title area: bg-[#e1def3] gap-[5px] flex-col px-[20px] py-[15px] */
  .m-review-header {
    background: var(--cs-purple-op10);
    padding: 15px 20px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
  }
  .m-review-title {
    font-size: 16px;
    font-weight: 500;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }
  .m-review-date {
    font-size: 12px;
    font-weight: 400;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: normal;
    white-space: pre;
  }
  /* Body: bg-white rounded-bl-[30px] rounded-br-[30px] px-[20px] py-[15px] */
  .m-review-body {
    background: var(--cs-white);
    padding: 15px 20px;
    width: 100%;
  }
  .m-review-body p {
    font-size: 14px;
    font-weight: 500;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }

  /* Comment form: bg-white h-[70px] rounded-[25px] */
  .m-comment-form {
    background: var(--cs-white);
    height: 70px;
    border-radius: 25px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 15px 20px;
    flex-shrink: 0;
    gap: 10px;
  }
  .m-comment-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 14px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    letter-spacing: -0.5px;
  }
  .m-comment-input::placeholder {
    color: var(--cs-text-mid);
    opacity: 0.6;
    text-align: center;
  }
  /* Send button: bg-[#e1def3] rounded-[30px] size-[35px] */
  .m-send-btn {
    flex-shrink: 0;
    width: 35px;
    height: 35px;
    border-radius: 30px;
    background: var(--cs-purple-op10);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    transition: background 0.15s;
  }
  .m-send-btn:hover { background: var(--cs-purple-pale); }

  /* Post: 연관정보 — 3-stop gradient, rounded-bl-[50px] rounded-tr-[50px] */
  .m-post {
    width: 100%;
    background: linear-gradient(to bottom,
      rgba(225,222,243,0.95) 0%,
      rgba(225,222,243,0.8) 25.962%,
      rgba(225,222,243,0) 50.481%
    );
    border-radius: 0 50px 0 50px;
    padding: 0 25px 100px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex-shrink: 0;
  }

  /* Post title bar: flex items-center (no justify-between) */
  .m-post-bar {
    display: flex;
    align-items: center;
    padding: 40px 0;
    width: 100%;
    flex-shrink: 0;
  }
  .m-post-label {
    font-size: 21px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    line-height: 1.6;
    letter-spacing: -0.3px;
    white-space: nowrap;
    text-align: center;
    flex-shrink: 0;
  }
  .m-post-more {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  /* 5 related cards: gap-[30px] */
  .m-post-list {
    display: flex;
    flex-direction: column;
    gap: 30px;
    width: 100%;
    flex-shrink: 0;
  }
  .m-rel-card {
    background: var(--cs-white);
    border-radius: 30px;
    overflow: hidden;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    flex-shrink: 0;
  }
  /* Img: h-[150px] */
  .m-rel-img-wrap {
    position: relative;
    height: 150px;
    width: 100%;
    overflow: hidden;
    flex-shrink: 0;
  }
  /* Writing: px-[30px] py-[20px] gap-[10px] */
  .m-rel-text {
    width: 100%;
    padding: 20px 30px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .m-rel-title {
    font-size: 18px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    white-space: pre-line;
    line-height: 1.6;
    letter-spacing: -0.3px;
  }
  .m-rel-meta {
    font-size: 12px;
    font-weight: 500;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }

  /* ══ YouTube Modal ════════════════════════════════ */
  .yt-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(16,11,50,0.93);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  @media (min-width: 1024px) {
    .yt-overlay { padding: 40px; }
  }
  .yt-dialog {
    position: relative;
    width: 100%;
    max-width: 900px;
  }
  .yt-close {
    position: absolute;
    top: -44px;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255,255,255,0.5);
    font-size: 12px;
    font-family: 'Noto Sans KR', sans-serif;
    transition: color 0.2s;
    min-height: 44px;
    padding: 0;
  }
  .yt-close:hover { color: var(--cs-white); }
  .yt-close-x { font-size: 20px; line-height: 1; }
  .yt-player {
    aspect-ratio: 16 / 9;
    width: 100%;
    overflow: hidden;
    border-radius: 16px;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.08),
      0 0 80px rgba(255,53,53,0.22),
      0 40px 80px rgba(0,0,0,0.6);
  }
  .yt-player iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }
  .yt-caption {
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    opacity: 0.4;
  }
  .yt-caption p {
    color: var(--cs-white);
    font-size: 12px;
    font-family: 'Noto Sans KR', sans-serif;
    margin: 0;
  }
</style>
