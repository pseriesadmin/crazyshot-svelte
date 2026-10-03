<script lang="ts">
  /**
   * 공통 더보기 아이콘 버튼 — 가로 점 3개 + 라운드 사각 배경, 섹션 타이틀 우측에 두고 해당 상세 화면으로 랜딩.
   * 형태는 front 홈 `.m-articles-more-btn`(22×22px · 반경 7px · 배경 purple-op10)을 따르고 안의 아이콘만
   * 가로 점 3개로 교체. 호버는 배경색만 변경(outline·box-shadow 금지 — CMS 버튼 규칙).
   * 새 탭으로 열어 진행 중인 화면(상담 입력 등)을 유지한다(rel noopener).
   */
  interface Props {
    href: string
    /** 스크린리더·툴팁 문구 */
    label: string
    newTab?: boolean
  }

  let { href, label, newTab = true }: Props = $props()
</script>

<a
  class="more-dots-btn"
  {href}
  target={newTab ? '_blank' : undefined}
  rel={newTab ? 'noopener noreferrer' : undefined}
  aria-label={label}
  title={label}
>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
</a>

<style>
  .more-dots-btn {
    width: 22px;
    height: 22px;
    min-width: 22px;
    flex-shrink: 0;
    border-radius: 7px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    transition: background 0.15s, color 0.15s;
  }
  .more-dots-btn:hover {
    background: var(--cs-purple);
    color: var(--cs-white);
  }
</style>
