# CrazyShot Design System Skill
Version: 1.1 | Stack: SvelteKit 5 + TypeScript | Project: crazyshot.kr

## Description
This skill enforces the CrazyShot design system when generating UI code from Figma designs. All generated code must use CSS custom properties defined in `src/app.css`. Never hardcode hex colors, font sizes, or pixel values that have a corresponding CSS variable.

---

## Framework & Syntax Rules

Generate **SvelteKit 5** components using **Svelte 5 Runes** syntax only.

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    value: string
    children?: Snippet          // slots are Snippets in Svelte 5
  }
  let { value, children }: Props = $props()   // NOT: export let value
  let count = $state(0)                        // NOT: writable(0)
  let doubled = $derived(count * 2)            // NOT: $: doubled = count * 2
</script>

<!-- Render slot content -->
{@render children?.()}    <!-- NOT: <slot /> -->

<button onclick={handleClick}>Click</button>   <!-- NOT: on:click -->
<input oninput={handleInput} />                <!-- NOT: on:input -->
```

**Forbidden patterns — never generate these:**

| ❌ Forbidden | ✅ Required |
|-------------|-----------|
| `export let prop` | `let { prop }: Props = $props()` |
| `<slot />` | `{@render children?.()}` |
| `import { writable } from 'svelte/store'` | `$state()` |
| `on:click`, `on:input`, `on:change` | `onclick`, `oninput`, `onchange` |
| `$: value = x * 2` | `let value = $derived(x * 2)` |
| TypeScript `any` type | explicit typed interface |
| Inline `style="color:#FF4500"` | CSS class with `var(--cs-orange)` |
| Hardcoded hex / raw px values | CSS variable tokens |

---

## Color Tokens

All colors must use CSS variables. Map Figma color values as follows:

**Brand Colors**

| Figma Value | CSS Variable | Usage |
|-------------|-------------|-------|
| `#FF4500` | `var(--cs-orange)` | Brand orange, logo accent |
| `#E03E00` | `var(--cs-orange-hover)` | Orange hover state |
| `#100B32` | `var(--cs-dark)` | Header bg, dark box |
| `#3B2F8A` | `var(--cs-purple)` | CTA button, selected state |
| `#2E2470` | `var(--cs-purple-hover)` | Button hover |
| `#201857` | `var(--cs-purple-dark)` | Accent background |
| `#553FE0` | `var(--cs-purple-light)` | Membership badge (blue) |
| `#C1BBEC` | `var(--cs-purple-pale)` | Points text on dark bg |
| `#E1DEF3` | `var(--cs-purple-op10)` | Nav background base |
| `rgba(225,222,243,0.4)` | `var(--cs-lilac-nav)` | Nav pill translucent bg |
| `#ECEBF4` | `var(--cs-lilac)` | Page background, quantity box |
| `#FF3535` | `var(--cs-red-badge)` | Red deal badge |
| `#CF0000` | `var(--cs-red)` | Error / warning |
| `#FFB3B3` | `var(--cs-red-light)` | Light error accent |

**Surface & Text Colors**

| Figma Value | CSS Variable | Usage |
|-------------|-------------|-------|
| `#FFFFFF` | `var(--cs-white)` | Card bg, bottom bar bg |
| `#f6f6f6` | `var(--cs-surface-gray)` | Form input, payment block |
| `#E0E0E6` | `var(--cs-border)` | Divider, border |
| `#100B32` | `var(--cs-text)` | Primary body text |
| `#444444` | `var(--cs-text-dark)` | Secondary text, price |
| `#666666` | `var(--cs-text-mid)` | Tertiary text |
| `#AAAAAA` | `var(--cs-text-light)` | Hint, inactive |
| `#b6b6b6` | `var(--cs-text-placeholder)` | Placeholder |
| `#c1bbec` | `var(--cs-points)` | Points label on dark bg |

**State Colors**

| Figma Value | CSS Variable | Usage |
|-------------|-------------|-------|
| `#388E3C` | `var(--cs-success)` | Success state |
| `#E53935` | `var(--cs-error)` | Error state |

---

## Border Radius Tokens

| Figma Value | CSS Variable | Component |
|-------------|-------------|-----------|
| `4px` | `var(--radius-xs)` | Tag, badge text |
| `8px` | `var(--radius-sm)` | Small button, search result |
| `15px` | `var(--radius-md)` | Form input field |
| `20px` | `var(--radius-lg)` | Date row, radio container, nav pill |
| `30px` | `var(--radius-xl)` | CTA button, total price dark box |
| `50px` | `var(--radius-2xl)` | **White card — most important** |
| `9999px` | `var(--radius-full)` | Badge icon, pill tag |

---

## Typography Tokens

Use the `font` shorthand property with CSS variables. Never decompose into `font-size`, `font-weight`, or `font-family` separately.

```css
/* ✅ Correct */
font: var(--text-pc-title-18);

/* ❌ Wrong — never generate these */
font-size: 18px;
font-weight: 700;
font-family: 'Noto Sans KR';
font-size: 1.125rem;
```

**PC Typography Scale**

| CSS Variable | Spec | Usage |
|-------------|------|-------|
| `--text-pc-ad-en-80` | 80px Black Config Condensed | Landing English hero |
| `--text-pc-ad-kr-60` | 60px Bold SB AggroOTF | Landing Korean hero |
| `--text-pc-ad-en-35` | 35px Tilt Warp | English ad sub-heading |
| `--text-pc-ad-kr-35` | 35px Bold SB AggroOTF | Large Korean title |
| `--text-pc-ad-kr-22` | 22px Medium SB AggroOTF | Korean ad small |
| `--text-pc-htitle-25` | 25px Bold Noto KR | Page header title |
| `--text-pc-hsub-22` | 22px Bold Noto KR | Page header sub-title |
| `--text-pc-menu-en-20` | 20px Tilt Warp | English menu / section label |
| `--text-pc-menu-kr-20` | 20px Medium SB AggroOTF | Korean menu |
| `--text-pc-title-18` | 18px Bold Noto KR | Section title |
| `--text-pc-title-16` | 16px Bold Noto KR | Card title, form label |
| `--text-pc-body-14` | 14px Bold Noto KR | Body emphasis |
| `--text-pc-script-12` | 12px Regular Noto KR | Caption, hint |

**Mobile Typography Scale**

| CSS Variable | Spec | Usage |
|-------------|------|-------|
| `--text-m-ad-kr-40` | 40px Bold SB AggroOTF | Mobile landing headline |
| `--text-m-ad-en-30` | 30px Tilt Warp | Mobile English display |
| `--text-m-ad-kr-30` | 30px Bold SB AggroOTF | Mobile section head |
| `--text-m-menu-en-24` | 24px Tilt Warp | Mobile English menu |
| `--text-m-htitle-24B` | 24px Black Noto KR | Primary mobile title (heavy) |
| `--text-m-htitle-24L` | 24px Medium Noto KR | Primary mobile title (light) |
| `--text-m-title-21` | 21px Bold Noto KR | Card title |
| `--text-m-title-18B` | 18px Bold Noto KR | Sub-section title |
| `--text-m-title-18L` | 18px Medium Noto KR | Sub-section title (light) |
| `--text-m-body-16B` | 16px Bold Noto KR | Body emphasis |
| `--text-m-body-16L` | 16px Medium Noto KR | **Default body — base font** |
| `--text-m-script-14B` | 14px Bold Noto KR | Label emphasis |
| `--text-m-script-14` | 14px Medium Noto KR | Price, sub-info |
| `--text-m-script-12` | 12px Medium Noto KR | Caption, hint |

---

## Shadow Tokens

| CSS Variable | Value | Usage |
|-------------|-------|-------|
| `--shadow-outsh1` | `10px 10px 0 rgba(5,0,38,1)` | Strong dark — text decoration |
| `--shadow-outsh2` | `4px 4px 0 rgba(39,27,122,0.5)` | Purple translucent — interactive |
| `--shadow-outsh3` | `5px 5px 0 rgba(16,11,50,1)` | Dark solid — card, button |
| `--shadow-outsh4` | `0 0 15px rgba(255,255,255,0.5)` | White glow — on dark bg |
| `--shadow-outsh5` | `4px 5px 0 rgba(0,0,0,0.5)` | Black shadow — text on image |
| `--shadow-inner` | `inset 0 0 60px rgba(0,0,0,0.6)` | Image overlay darkening |
| `--shadow-bottom-bar` | `0 -2px 20px rgba(16,11,50,0.10)` | Fixed bottom bar |

---

## Spacing Tokens

Always use spacing tokens for `padding`, `gap`, and `margin`. Never write raw px values that match a token.

| Token | Value |
|-------|-------|
| `--spacing-1` | `4px` |
| `--spacing-2` | `8px` |
| `--spacing-3` | `12px` |
| `--spacing-4` | `16px` |
| `--spacing-5` | `20px` |
| `--spacing-6` | `24px` |
| `--spacing-8` | `32px` |
| `--spacing-10` | `40px` |
| `--spacing-12` | `48px` |
| `--spacing-16` | `64px` |

---

## Layout Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--layout-pc-max` | `1240px` | Max content width |
| `--layout-pc-pad` | `40px` | PC horizontal padding |
| `--layout-tab-pad` | `32px` | Tablet ≤1024px |
| `--layout-mob-pad` | `20px` | Mobile ≤640px |
| `--layout-section-gap` | `50px` | Section vertical gap |
| `--layout-header-h` | `100px` | Fixed header height |
| `--layout-footer-h` | `80px` | Fixed bottom bar height |

**Standard page container (Svelte 5):**
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'
  interface Props { children?: Snippet }
  let { children }: Props = $props()
</script>

<div class="page-wrap">
  {@render children?.()}
</div>

<style>
.page-wrap {
  max-width: var(--layout-pc-max);
  margin: 0 auto;
  padding: calc(var(--layout-header-h) + var(--layout-section-gap))
           var(--layout-pc-pad)
           var(--layout-section-gap);
  display: flex;
  flex-direction: column;
  gap: var(--layout-section-gap);
}
@media (max-width: 1024px) {
  .page-wrap { padding-inline: var(--layout-tab-pad); }
}
@media (max-width: 640px) {
  .page-wrap { padding-inline: var(--layout-mob-pad); gap: var(--spacing-8); }
}
</style>
```

---

## Core Component Patterns

### White Card (primary section container)
```svelte
<div class="white-card">
  <!-- content -->
</div>

<style>
.white-card {
  background: var(--cs-white);
  border-radius: var(--radius-2xl);
  overflow: hidden;
}
</style>
```

### CTA Button (Primary)
```svelte
<button class="cta-btn" onclick={handleSubmit} disabled={isLoading}>
  {#if isLoading}처리 중...{:else}예약하기{/if}
</button>

<style>
.cta-btn {
  background: var(--cs-purple);
  color: var(--cs-white);
  border: none;
  border-radius: var(--radius-xl);
  height: 60px;
  width: 100%;
  font: var(--text-pc-title-16);
  cursor: pointer;
  transition: background 0.15s;
  min-height: 44px;
}
.cta-btn:hover    { background: var(--cs-purple-hover); }
.cta-btn:disabled { background: var(--cs-purple-pale); cursor: not-allowed; }
</style>
```

### Form Input
```svelte
<input class="f-input" type="text" placeholder="입력해주세요" />

<style>
.f-input {
  background: var(--cs-surface-gray);
  border: none;
  border-radius: var(--radius-md);
  padding: var(--spacing-3) var(--spacing-5);
  font: var(--text-m-script-14);
  color: var(--cs-text);
  width: 100%;
  min-height: 44px;
}
.f-input::placeholder { color: var(--cs-text-placeholder); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
</style>
```

### Total Price Dark Box
```svelte
<div class="total-box">
  <span class="total-label">합계</span>
  <span class="total-price">120,000원</span>
</div>

<style>
.total-box {
  background: var(--cs-dark);
  border-radius: var(--radius-xl);
  padding: var(--spacing-6) var(--spacing-10);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.total-label { font: var(--text-m-body-16B); color: var(--cs-purple-pale); }
.total-price { font: var(--text-m-title-21); color: var(--cs-white); }
</style>
```

### Nav Pill (translucent lavender)
```svelte
<nav class="nav-pill">
  <!-- nav items -->
</nav>

<style>
.nav-pill {
  background: var(--cs-lilac-nav);
  border: 1px solid rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(8px);
  border-radius: var(--radius-lg);
  padding: var(--spacing-4) var(--spacing-8);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
```

### Fixed Bottom Bar
```svelte
<div class="bottom-bar">
  <!-- CTA area -->
</div>

<style>
.bottom-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: var(--cs-white);
  box-shadow: var(--shadow-bottom-bar);
  height: var(--layout-footer-h);
  display: flex;
  align-items: center;
  padding: 0 var(--layout-mob-pad);
  z-index: 100;
}
</style>
```

### Fixed Header
```svelte
<header class="cs-header">
  <!-- logo, nav -->
</header>

<style>
.cs-header {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 200;
  background: var(--cs-dark);
  height: var(--layout-header-h);
  display: flex;
  align-items: center;
  padding: 0 var(--layout-pc-pad);
}
</style>
```

### Loading Skeleton
```svelte
{#if isLoading}
  <div class="skeleton" aria-label="로딩 중..."></div>
{:else}
  <!-- actual content -->
{/if}

<button disabled={isLoading} onclick={submit}>
  {#if isLoading}처리 중...{:else}예약하기{/if}
</button>

<style>
.skeleton {
  height: 120px;
  border-radius: var(--radius-2xl);
  background: var(--cs-border);
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
</style>
```

---

## Accessibility Requirements

- All interactive elements: minimum `44×44px` touch target (`min-height: 44px; min-width: 44px`)
- Images: always include `alt` attribute (decorative images: `alt=""`)
- Buttons without visible text: add `aria-label`
- Modals: `role="dialog"` + `aria-modal="true"`
- Error messages: `role="alert"` + `aria-live="assertive"`
- Color contrast: minimum 4.5:1 (WCAG AA)

---

## Image Pattern (Cloudinary CDN)

```svelte
<img
  src="https://res.cloudinary.com/crazyshot/image/upload/w_400,h_300,c_fill,f_auto,q_auto/{publicId}.jpg"
  alt="제품 설명"
  width="400"
  height="300"
  loading="lazy"
/>
```

| Context | Transform params |
|---------|-----------------|
| Thumbnail | `w_400,h_300,c_fill,f_auto,q_auto` |
| Detail | `w_800,h_600,c_fill,f_auto,q_auto` |
| Banner | `w_1240,h_500,c_fill,f_auto,q_auto` |

---

## Quick Reference — DO / DON'T

| ❌ Don't | ✅ Do |
|---------|------|
| `color: #100B32` | `color: var(--cs-dark)` |
| `background: #3B2F8A` | `background: var(--cs-purple)` |
| `background: #ECEBF4` | `background: var(--cs-lilac)` |
| `background: #f6f6f6` | `background: var(--cs-surface-gray)` |
| `border-radius: 50px` | `border-radius: var(--radius-2xl)` |
| `border-radius: 30px` | `border-radius: var(--radius-xl)` |
| `border-radius: 15px` | `border-radius: var(--radius-md)` |
| `font-size: 18px; font-weight: 700` | `font: var(--text-pc-title-18)` |
| `font-size: 1.125rem` | `font: var(--text-m-title-18B)` |
| `gap: 50px` | `gap: var(--layout-section-gap)` |
| `padding: 16px 32px` | `padding: var(--spacing-4) var(--spacing-8)` |
| `padding: 24px 40px` | `padding: var(--spacing-6) var(--spacing-10)` |
| `on:click={fn}` | `onclick={fn}` |
| `export let prop` | `let { prop }: Props = $props()` |
| `<slot />` | `{@render children?.()}` |
| `writable(false)` | `$state(false)` |
| `$: value = x * 2` | `let value = $derived(x * 2)` |
| `style="color: #FF4500"` | CSS class with `var(--cs-orange)` |
| `background: #B0ABCC` (disabled) | `background: var(--cs-purple-pale)` |
