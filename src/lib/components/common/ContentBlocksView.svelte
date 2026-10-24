<script lang="ts">
  /**
   * ContentBlocksView — 콘텐츠 블록(ContentBlock[]) 읽기 전용 렌더러 (2026-10-24)
   * 공통 푸터 '소개 > 팀' 모달처럼 문서 편집기로 저장한 내용을 고객 화면에 그대로 보여준다.
   * ⛔ 텍스트·HTML 블록은 {@html}로 출력하므로 호출하는 쪽이 서버에서 정화한 값만 넘겨야 한다
   *    (팀 정책: GET /api/team-policy → prepareTeamPolicyForView). 유튜브 ID는 여기서도 한 번 더 확인한다.
   */
  import { imageBlockBoxStyle, type ContentBlock } from '$lib/types/content-editor'

  interface Props {
    blocks: ContentBlock[]
  }
  let { blocks }: Props = $props()

  const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/
</script>

<div class="cbv">
  {#each blocks as block, i (i)}
    {#if block.type === 'text'}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="cbv-text">{@html block.html}</div>
    {:else if block.type === 'image'}
      <div class="cbv-images cbv-images--{block.layout}" style={imageBlockBoxStyle(block.width, block.align)}>
        {#each block.images.filter((img) => !img.isHead) as img, j (j)}
          <img src={img.url} alt={img.alt} loading="lazy" class="cbv-img" />
        {/each}
      </div>
    {:else if block.type === 'youtube'}
      {#if YOUTUBE_ID_RE.test(block.videoId)}
        <div class="cbv-youtube">
          <iframe
            src="https://www.youtube.com/embed/{block.videoId}"
            title="YouTube 영상"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            loading="lazy"
          ></iframe>
        </div>
      {/if}
    {:else if block.type === 'html'}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="cbv-text">{@html block.content}</div>
    {:else if block.type === 'divider'}
      <hr class="cbv-divider" />
    {:else if block.type === 'link-entry'}
      <a href={block.url} class="cbv-link" target="_blank" rel="noopener noreferrer">{block.text}</a>
    {/if}
  {/each}
</div>

<style>
  .cbv {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .cbv-text {
    font-family: var(--font-kr);
    font-size: 14px;
    color: var(--cs-text);
    line-height: 1.8;
    word-break: break-word;
  }
  .cbv-text :global(p) { margin: 0 0 12px; }
  .cbv-text :global(p:last-child) { margin-bottom: 0; }
  .cbv-text :global(ul),
  .cbv-text :global(ol) { padding-left: 20px; margin: 0 0 12px; }
  .cbv-text :global(h1),
  .cbv-text :global(h2),
  .cbv-text :global(h3) { margin: 0 0 8px; color: var(--cs-text); }
  .cbv-text :global(a) { color: var(--cs-purple); }
  .cbv-text :global(table) { border-collapse: collapse; max-width: 100%; }
  .cbv-text :global(th),
  .cbv-text :global(td) { border: 1px solid var(--cs-lilac); padding: 6px 10px; }
  .cbv-images {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .cbv-images--individual { flex-direction: column; }
  .cbv-images--individual .cbv-img { width: 100%; }
  .cbv-images--collage .cbv-img { flex: 1 1 calc(50% - 4px); width: auto; min-width: 0; max-height: 400px; }
  .cbv-images--slide { flex-wrap: nowrap; overflow-x: auto; scroll-snap-type: x mandatory; }
  .cbv-images--slide .cbv-img { flex: 0 0 85%; width: 85%; scroll-snap-align: center; }
  .cbv-img {
    border-radius: var(--radius-md);
    object-fit: cover;
    display: block;
    max-width: 100%;
  }
  .cbv-youtube {
    position: relative;
    width: 100%;
    padding-bottom: 56.25%;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--cs-dark);
  }
  .cbv-youtube iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
  }
  .cbv-divider {
    border: none;
    height: 1px;
    background: var(--cs-lilac);
    margin: 0;
  }
  .cbv-link {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 6px;
    padding: 10px 16px;
    border-radius: var(--radius-md);
    background: var(--cs-lilac);
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-purple);
    text-decoration: none;
  }
  .cbv-link:hover { background: var(--cs-purple); color: var(--cs-white); }
</style>
