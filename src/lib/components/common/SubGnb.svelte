<script lang="ts">
  import { goto } from '$app/navigation'

  interface Props {
    title: string
    floating?: boolean
    pcOnly?: boolean      // 모바일 숨김 — 히어로 floating과 중복 방지
    mobileOnly?: boolean  // PC 숨김 — cart처럼 자체 PC 헤더가 있을 때
    transparent?: boolean // PC 배경 제거 — 히어로 이미지 위 overlay 배치 시
  }

  let { title, floating = false, pcOnly = false, mobileOnly = false, transparent = false }: Props = $props()

  let menuOpen = $state(false)

  function goBack() {
    if (history.length > 1) {
      history.back()
    } else {
      goto('/products')
    }
  }

  function toggleMenu() { menuOpen = !menuOpen }
  function closeMenu() { menuOpen = false }
  function navigateTo(category: string) {
    closeMenu()
    goto(`/products?category=${category}`)
  }

  const CATEGORIES: { key: string; label: string; svgPath: string }[] = [
    {
      key: 'camera', label: 'Camera',
      svgPath: `<svg viewBox="0 0 31.5 33.6" fill="none" width="28" height="28"><path d="M0.685 24.276C0.685 25.836 2.356 26.827 3.725 26.079L14.768 20.042C15.382 19.707 16.125 19.707 16.74 20.042L27.782 26.079C29.152 26.827 30.823 25.836 30.823 24.276V11.168C30.823 10.416 30.413 9.725 29.754 9.365L16.74 2.251C16.125 1.915 15.382 1.915 14.768 2.251L1.754 9.365C1.095 9.725 0.685 10.416 0.685 11.168V24.276Z" fill="#FF3535"/><path d="M28.843 11.131C28.843 10.16 28.317 9.265 27.47 8.795L17.045 3.004C16.242 2.558 15.266 2.558 14.462 3.004L4.037 8.795C3.19 9.266 2.664 10.16 2.664 11.131V22.432C2.664 23.403 3.19 24.297 4.037 24.768L14.462 30.558C15.266 31.004 16.242 31.004 17.045 30.558L27.47 24.768C28.317 24.297 28.843 23.403 28.843 22.432V11.131ZM31.508 22.432C31.508 24.373 30.456 26.162 28.762 27.103L18.337 32.893C16.73 33.786 14.778 33.786 13.171 32.893L2.746 27.103C1.051 26.162 0 24.373 0 22.432V11.131C0 9.189 1.051 7.401 2.746 6.46L13.171 0.669C14.778 -0.223 16.73 -0.223 18.337 0.669L28.762 6.46C30.456 7.401 31.508 9.189 31.508 11.131V22.432Z" fill="#3B2F8A"/><path d="M0.685 12.593C0.685 10.315 3.125 8.868 5.124 9.961L14.315 14.985C15.212 15.475 16.296 15.475 17.193 14.985L26.384 9.961C28.383 8.868 30.823 10.315 30.823 12.593V23.547C30.823 24.644 30.224 25.653 29.262 26.179L17.193 32.776C16.296 33.266 15.212 33.266 14.315 32.776L2.246 26.179C1.284 25.653 0.685 24.644 0.685 23.547V12.593Z" fill="#3B2F8A"/></svg>`
    },
    {
      key: 'lens', label: 'Lens',
      svgPath: `<svg viewBox="0 0 30 30" fill="none" width="28" height="28"><path d="M24 28.667C26.577 28.667 28.667 26.577 28.667 24C28.667 21.423 26.577 19.333 24 19.333C21.423 19.333 19.333 21.423 19.333 24C19.333 26.577 21.423 28.667 24 28.667Z" fill="#FF3535"/><path d="M6 10.667C8.577 10.667 10.667 8.577 10.667 6C10.667 3.423 8.577 1.333 6 1.333C3.423 1.333 1.333 3.423 1.333 6C1.333 8.577 3.423 10.667 6 10.667Z" fill="#FF3535"/><path d="M27.333 24C27.333 22.159 25.841 20.667 24 20.667C22.159 20.667 20.667 22.159 20.667 24C20.667 25.841 22.159 27.333 24 27.333C25.841 27.333 27.333 25.841 27.333 24ZM30 24C30 27.314 27.314 30 24 30C20.686 30 18 27.314 18 24C18 20.686 20.686 18 24 18C27.314 18 30 20.686 30 24Z" fill="#3B2F8A"/><path d="M9.333 24C9.333 22.159 7.841 20.667 6 20.667C4.159 20.667 2.667 22.159 2.667 24C2.667 25.841 4.159 27.333 6 27.333C7.841 27.333 9.333 25.841 9.333 24ZM12 24C12 27.314 9.314 30 6 30C2.686 30 0 27.314 0 24C0 20.686 2.686 18 6 18C9.314 18 12 20.686 12 24Z" fill="#3B2F8A"/><path d="M27.333 6C27.333 4.159 25.841 2.667 24 2.667C22.159 2.667 20.667 4.159 20.667 6C20.667 7.841 22.159 9.333 24 9.333C25.841 9.333 27.333 7.841 27.333 6ZM30 6C30 9.314 27.314 12 24 12C20.686 12 18 9.314 18 6C18 2.686 20.686 0 24 0C27.314 0 30 2.686 30 6Z" fill="#3B2F8A"/><path d="M9.333 6C9.333 4.159 7.841 2.667 6 2.667C4.159 2.667 2.667 4.159 2.667 6C2.667 7.841 4.159 9.333 6 9.333C7.841 9.333 9.333 7.841 9.333 6ZM12 6C12 9.314 9.314 12 6 12C2.686 12 0 9.314 0 6C0 2.686 2.686 0 6 0C9.314 0 12 2.686 12 6Z" fill="#3B2F8A"/><path d="M10.941 13.591C10.789 12.093 12.094 10.786 13.592 10.935C14.565 11.031 15.486 11.028 16.472 10.925C17.954 10.769 19.251 12.05 19.106 13.534C19.007 14.545 19.009 15.493 19.111 16.507C19.258 17.98 17.981 19.256 16.508 19.104C15.503 19.001 14.566 18.996 13.57 19.092C12.078 19.235 10.786 17.927 10.94 16.436C11.039 15.468 11.039 14.558 10.941 13.591Z" fill="#3B2F8A"/><path d="M19.714 16.886C20.495 17.667 20.495 18.933 19.714 19.714C18.933 20.495 17.667 20.495 16.886 19.714L10.286 13.114C9.505 12.333 9.505 11.067 10.286 10.286C11.067 9.505 12.333 9.505 13.114 10.286L19.714 16.886Z" fill="#3B2F8A"/><path d="M13.114 19.714C12.333 20.495 11.067 20.495 10.286 19.714C9.505 18.933 9.505 17.667 10.286 16.886L16.886 10.286C17.667 9.505 18.933 9.505 19.714 10.286C20.495 11.067 20.495 12.333 19.714 13.114L13.114 19.714Z" fill="#3B2F8A"/></svg>`
    },
    {
      key: 'video', label: 'Video',
      svgPath: `<svg viewBox="0 0 32 27.1" fill="none" width="28" height="24"><path d="M32 18.649V12.064C32 9.095 32 7.611 31.431 6.477C30.266 4.155 28.166 3.582 25.739 3.582C25.074 3.582 24.562 3.019 24.293 2.41C23.546 0.717 21.209 0 19.478 0H13.217C11.384 0 8.613 0.806 7.967 2.724C7.814 3.181 7.439 3.582 6.957 3.582C4.172 3.582 1.977 3.67 0.569 6.477C0 7.611 0 9.095 0 12.064V18.649C0 21.618 0 23.102 0.569 24.236C1.069 25.234 1.868 26.044 2.85 26.553C3.967 27.13 5.428 27.13 8.352 27.13H23.648C26.572 27.13 28.033 27.13 29.15 26.553C30.132 26.044 30.931 25.234 31.431 24.236C32 23.102 32 21.618 32 18.649Z" fill="#3B2F8A"/><path d="M22.261 14.609C22.261 11.343 19.614 8.696 16.348 8.696C13.082 8.696 10.435 11.343 10.435 14.609C10.435 17.874 13.082 20.522 16.348 20.522C19.614 20.522 22.261 17.874 22.261 14.609ZM25.043 14.609C25.043 19.411 21.15 23.304 16.348 23.304C11.545 23.304 7.652 19.411 7.652 14.609C7.652 9.806 11.545 5.913 16.348 5.913C21.15 5.913 25.043 9.806 25.043 14.609Z" fill="#FF3535"/><path d="M16.348 20.522C19.614 20.522 22.261 17.874 22.261 14.609C22.261 11.343 19.614 8.696 16.348 8.696C13.082 8.696 10.435 11.343 10.435 14.609C10.435 17.874 13.082 20.522 16.348 20.522Z" fill="#E1DEF3"/></svg>`
    },
    {
      key: 'drone', label: 'Drone',
      svgPath: `<svg viewBox="0 0 32.9 32.9" fill="none" width="28" height="28"><path d="M16.439 2.74C24.005 2.74 30.138 8.873 30.138 16.439C30.138 24.005 24.005 30.138 16.439 30.138C8.873 30.138 2.74 24.005 2.74 16.439C2.74 8.873 8.873 2.74 16.439 2.74Z" fill="#FF3535"/><path d="M30.138 16.439C30.138 8.873 24.005 2.74 16.439 2.74C8.873 2.74 2.74 8.873 2.74 16.439C2.74 24.005 8.873 30.138 16.439 30.138C24.005 30.138 30.138 24.005 30.138 16.439ZM32.878 16.439C32.878 25.518 25.518 32.878 16.439 32.878C7.36 32.878 0 25.518 0 16.439C0 7.36 7.36 0 16.439 0C25.518 0 32.878 7.36 32.878 16.439Z" fill="#3B2F8A"/><path d="M16.439 27.398C22.491 27.398 27.398 22.491 27.398 16.439C27.398 10.386 22.491 5.48 16.439 5.48C10.386 5.48 5.48 10.386 5.48 16.439C5.48 22.491 10.386 27.398 16.439 27.398Z" fill="#3B2F8A"/><path d="M16.439 21.233C19.087 21.233 21.233 19.087 21.233 16.439C21.233 13.791 19.087 11.644 16.439 11.644C13.791 11.644 11.644 13.791 11.644 16.439C11.644 19.087 13.791 21.233 16.439 21.233Z" fill="#E1DEF3"/></svg>`
    },
    {
      key: 'tripod', label: 'Tripod',
      svgPath: `<svg viewBox="0 0 32 26" fill="none" width="28" height="23"><path d="M19.911 0C18.542 0 17.302 0.562 16.402 1.471H12.089C11.107 1.471 10.311 2.279 10.311 3.276C10.311 4.273 11.107 5.082 12.089 5.082H14.933V12.278C14.933 15.07 17.162 17.333 19.911 17.333H26.889V19.139C26.889 21.031 25.552 22.389 23.689 22.389H6.756C4.893 22.389 3.556 21.031 3.556 19.139V9.389C3.465 8.479 2.698 7.769 1.778 7.769C0.857 7.769 0.1 8.479 0.009 9.389L0 9.389V19.139C0 23.025 2.929 26 6.756 26H23.689C27.515 26 30.444 23.025 30.444 19.139V15.947C31.402 15.026 32 13.723 32 12.278V5.056C32 2.263 29.771 0 27.022 0H19.911ZM5.383 0.722C4.009 0.722 2.894 1.854 2.894 3.25C2.894 4.646 4.009 5.778 5.383 5.778C6.758 5.778 7.872 4.646 7.872 3.25C7.872 1.854 6.758 0.722 5.383 0.722Z" fill="#3B2F8A"/><path d="M19.2 8.667C19.2 11.259 21.27 13.361 23.822 13.361C26.375 13.361 28.445 11.259 28.445 8.667C28.445 6.074 26.375 3.972 23.822 3.972C21.27 3.972 19.2 6.074 19.2 8.667Z" fill="#FF3535"/></svg>`
    },
    {
      key: 'audio', label: 'Audio',
      svgPath: `<svg viewBox="0 0 28 32" fill="none" width="24" height="28"><path d="M0 6.85C0 3.067 3.096 0 6.915 0H13.831C17.65 0 20.746 3.067 20.746 6.85V19.179C20.746 22.962 17.65 26.028 13.831 26.028H6.915C3.096 26.028 0 22.962 0 19.179V6.85Z" fill="#3B2F8A"/><path d="M17.281 28.575C21.296 28.575 24.347 25.724 24.534 22.395L24.542 22.072V12.404C24.542 11.458 25.316 10.692 26.271 10.692C27.226 10.692 28 11.458 28 12.404V22.072C27.846 27.816 22.977 32 17.281 32C11.495 32 6.563 27.682 6.563 22.072V17.963C6.563 17.018 7.337 16.251 8.292 16.251C9.246 16.251 10.02 17.018 10.02 17.963V22.072C10.02 25.536 13.138 28.575 17.281 28.575Z" fill="#3B2F8A"/><path d="M9.322 7.589C9.715 6.941 10.564 6.731 11.219 7.12C11.874 7.509 12.087 8.351 11.694 8.999L10.046 11.719H12.444C12.942 11.719 13.402 11.985 13.648 12.414C13.893 12.844 13.886 13.371 13.63 13.794L10.725 18.589C10.332 19.237 9.483 19.447 8.828 19.058C8.173 18.669 7.961 17.827 8.354 17.179L10.001 14.459H7.603C7.105 14.459 6.645 14.193 6.4 13.764C6.154 13.334 6.161 12.807 6.418 12.384L9.322 7.589Z" fill="#FF3535"/></svg>`
    },
    {
      key: 'lighting', label: 'Lighting',
      svgPath: `<svg viewBox="0 0 32 21" fill="none" width="28" height="18"><path d="M0 14.641C0 12.72 1.557 11.163 3.478 11.163H6.261C8.182 11.163 9.739 12.72 9.739 14.641V17.424C9.739 19.345 8.182 20.902 6.261 20.902H3.478C1.557 20.902 0 19.345 0 17.424V14.641Z" fill="#3B2F8A"/><path d="M22.261 14.707C22.261 12.786 23.818 11.228 25.739 11.228H28.522C30.443 11.228 32 12.786 32 14.707V17.489C32 19.41 30.443 20.967 28.522 20.967H25.739C23.818 20.967 22.261 19.41 22.261 17.489V14.707Z" fill="#3B2F8A"/><path d="M11.13 14.641C11.13 12.72 12.688 11.163 14.609 11.163H17.391C19.312 11.163 20.87 12.72 20.87 14.641V17.424C20.87 19.345 19.312 20.902 17.391 20.902H14.609C12.688 20.902 11.13 19.345 11.13 17.424V14.641Z" fill="#FF3535"/><path d="M0 3.478C0 1.557 1.557 0 3.478 0H6.261C8.182 0 9.739 1.557 9.739 3.478V6.261C9.739 8.182 8.182 9.739 6.261 9.739H3.478C1.557 9.739 0 8.182 0 6.261V3.478Z" fill="#3B2F8A"/><path d="M11.13 3.478C11.13 1.557 12.688 0 14.609 0H17.391C19.312 0 20.87 1.557 20.87 3.478V6.261C20.87 8.182 19.312 9.739 17.391 9.739H14.609C12.688 9.739 11.13 8.182 11.13 6.261V3.478Z" fill="#FF3535"/><path d="M22.261 3.543C22.261 1.622 23.818 0.065 25.739 0.065H28.522C30.443 0.065 32 1.622 32 3.543V6.326C32 8.247 30.443 9.804 28.522 9.804H25.739C23.818 9.804 22.261 8.247 22.261 6.326V3.543Z" fill="#3B2F8A"/></svg>`
    },
    {
      key: 'phone', label: 'Phone',
      svgPath: `<svg viewBox="0 0 32 29" fill="none" width="24" height="24"><path d="M24.361 0C28.187 0 31.472 3.307 31.472 7.159C31.472 8.592 31.47 11.547 31.469 14.143C31.468 15.441 31.468 16.65 31.467 17.534V18.978C31.466 19.966 30.67 20.767 29.688 20.767C28.707 20.767 27.911 19.965 27.911 18.976V18.586C27.911 18.335 27.912 17.974 27.912 17.533C27.912 16.648 27.913 15.439 27.913 14.141C27.915 11.545 27.916 8.591 27.916 7.159C27.916 5.284 26.223 3.58 24.361 3.58C22.939 3.58 19.338 3.581 15.736 3.582C12.135 3.583 8.533 3.585 7.111 3.585C5.248 3.585 3.555 5.289 3.555 7.164C3.555 8.596 3.555 13.608 3.555 18.261C3.555 20.588 3.556 22.825 3.556 24.481V27.21C3.556 28.199 2.76 29 1.778 29C0.858 29 0.101 28.296 0.01 27.393V27.21V18.261C0 13.608 0 8.597 0 7.164C0 3.312 3.285 0.004 7.111 0.004C8.533 0.004 12.134 0.003 15.735 0.002C19.337 0.001 22.938 0 24.361 0ZM29.511 23.631C30.886 23.631 32 24.752 32 26.136C32 27.52 30.886 28.642 29.511 28.642C28.137 28.642 27.022 27.52 27.022 26.136C27.022 24.752 28.137 23.631 29.511 23.631ZM11.734 6.625C14.875 6.625 17.422 9.189 17.422 12.353V20.227C17.422 23.39 14.875 25.955 11.734 25.955C8.592 25.955 6.045 23.39 6.045 20.227V12.353C6.045 9.189 8.592 6.625 11.734 6.625ZM11.734 17.364C10.163 17.364 8.889 18.646 8.889 20.228C8.889 21.809 10.163 23.092 11.734 23.092C13.304 23.092 14.578 21.809 14.578 20.228C14.578 18.646 13.304 17.364 11.734 17.364Z" fill="#3B2F8A"/><path d="M14.578 12.352C14.578 13.934 13.304 15.216 11.734 15.216C10.163 15.216 8.889 13.934 8.889 12.352C8.889 10.771 10.163 9.489 11.734 9.489C13.304 9.489 14.578 10.771 14.578 12.352Z" fill="#FF3535"/></svg>`
    },
  ]
</script>

<!-- ── PC Sub GNB (≥641px) — floating/mobileOnly 모드에서는 렌더링 안 함 ── -->
{#if !floating && !mobileOnly}
<header class="sub-gnb-pc" class:transparent>
  <div class="sub-gnb-pc-inner">
    <button class="pc-pill" onclick={goBack} aria-label="뒤로가기">
      <div class="pc-pill-left">
        <svg class="pc-pill-arrow" viewBox="0 0 21.3844 17.1421" fill="none" aria-hidden="true">
          <path d="M19.8844 8.5707L1.5 8.57107M8.57107 1.5L1.5 8.57107L8.57107 15.6421" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
        </svg>
        <span class="pc-back-text">Back</span>
      </div>
      <span class="pc-title">{title}</span>
    </button>
    <div class="pc-cat-icons">
      {#each CATEGORIES as cat}
        <button
          class="pc-cat-btn"
          onclick={() => navigateTo(cat.key)}
          aria-label={cat.label}
          title={cat.label}
        >
          {@html cat.svgPath}
        </button>
      {/each}
    </div>
  </div>
</header>
{/if}

<!-- ── Mobile Sub GNB (≤640px) — pcOnly 시 렌더링 안 함 ── -->
{#if !pcOnly}
<div class="sub-gnb-mobile" class:floating>
  <div class="gnb-pill">
    <button class="back-btn" onclick={goBack} aria-label="뒤로가기">
      <svg width="15" height="10" viewBox="0 0 17 12" fill="none" aria-hidden="true">
        <path d="M1 6H16M1 6L6 1M1 6L6 11" stroke="#444444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <span class="gnb-title">{title}</span>
    <button class="menu-btn" onclick={toggleMenu} aria-label="카테고리 메뉴" aria-expanded={menuOpen}>
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="17" viewBox="0 0 20 17" fill="none" aria-hidden="true">
        <path d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z" fill="#CF0000"/>
        <path d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z" fill="#201857"/>
      </svg>
    </button>
  </div>

  {#if menuOpen}
    <div class="cat-menu" role="menu">
      <div class="cat-grid">
        {#each CATEGORIES as cat}
          <a
            href="/products?category={cat.key}"
            class="cat-item"
            role="menuitem"
            onclick={closeMenu}
          >
            <div class="cat-icon">{@html cat.svgPath}</div>
            <span class="cat-label">{cat.label}</span>
          </a>
        {/each}
      </div>
    </div>
    <button class="cat-overlay" onclick={closeMenu} aria-label="메뉴 닫기" tabindex="-1"></button>
  {/if}
</div>
{/if}

<style>
  /* ══ PC Sub GNB ══ */
  .sub-gnb-pc {
    display: none;
  }

  @media (min-width: 641px) {
    .sub-gnb-pc {
      display: block;
      position: sticky;
      top: 0;
      z-index: 50;
      background: #ECEBF4;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    }

    .sub-gnb-pc.transparent {
      background: transparent;
      border-bottom: none;
      position: relative;
    }

    .sub-gnb-pc-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 30px;
      width: 100%;
      max-width: var(--layout-pc-max);
      margin: 0 auto;
      padding: 20px var(--layout-pc-pad);
      flex-wrap: nowrap;
      box-sizing: border-box;
    }

    .pc-pill {
      background: rgba(225, 222, 243, 0.4);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 20px 40px;
      border-radius: 25px;
      width: 100%;
      max-width: 460px;
      min-width: 0;
      min-height: 62px;
      flex: 0 1 460px;
      box-sizing: border-box;
      color: var(--cs-text);
      transition: background 0.2s;
    }

    .pc-pill:hover {
      background: rgba(225, 222, 243, 0.85);
    }

    .pc-pill-left {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
    }

    .pc-pill-arrow {
      width: 22px;
      height: 18px;
      flex-shrink: 0;
    }

    .pc-back-text {
      font: var(--text-pc-title-16);
      color: var(--cs-text);
      white-space: nowrap;
    }

    .pc-title {
      font: var(--text-pc-menu-en-20);
      color: var(--cs-text);
      flex-shrink: 0;
      white-space: nowrap;
    }

    .pc-cat-icons {
      display: flex;
      flex-wrap: nowrap;
      gap: 30px;
      align-items: center;
      justify-content: flex-end;
      flex-shrink: 0;
    }

    .pc-cat-btn {
      background: #E1DEF3;
      border: none;
      outline: none;
      cursor: pointer;
      border-radius: 30px;
      width: 60px;
      height: 60px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s;
      padding: 0;
    }

    .pc-cat-btn:hover {
      background: #D0CCEB;
    }
  }

  /* ══ Mobile Sub GNB ══ */
  .sub-gnb-mobile {
    display: block;
    position: relative;
    z-index: 50;
    padding: 16px 20px 0;
  }

  .sub-gnb-mobile.floating {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 24px 20px 0;
    z-index: 10;
  }

  @media (min-width: 641px) {
    .sub-gnb-mobile {
      display: none;
    }
  }

  .gnb-pill {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-lilac-nav);
    border: 1px solid rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: var(--radius-lg);
    padding: 14px 20px;
    min-height: 52px;
  }

  .back-btn,
  .menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    margin: -8px;
  }

  .gnb-title {
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    text-align: center;
    flex: 1;
    padding: 0 8px;
    letter-spacing: -0.3px;
  }

  /* ── 카테고리 드롭다운 (Mobile) ── */
  .cat-menu {
    position: absolute;
    top: calc(100% - 4px);
    left: 20px;
    right: 20px;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px rgba(16, 11, 50, 0.18);
    padding: 20px 16px;
    z-index: 100;
    animation: menuIn 0.18s ease;
  }

  @keyframes menuIn {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .cat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px 0;
  }

  .cat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 4px;
    text-decoration: none;
    border-radius: var(--radius-md);
    transition: background 0.12s;
  }

  .cat-item:hover,
  .cat-item:active { background: var(--cs-lilac); }

  .cat-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
  }

  .cat-label {
    font: var(--text-m-script-12);
    color: var(--cs-text-dark);
    text-align: center;
    white-space: nowrap;
  }

  .cat-overlay {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 99;
    border: none;
    cursor: default;
  }
</style>
