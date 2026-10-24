<script lang="ts">
  /* eslint-disable @typescript-eslint/no-explicit-any */
  // 시험용 스텁 — 실제 RichContentEditor 의 외부 규약(blocks 바인딩·onchange·flush·정리 시 마지막 입력 반영)만 흉내 낸다
  import { onDestroy } from 'svelte'
  import { registry } from './registry'
  let { blocks = $bindable([]), onchange }: { blocks?: any[]; onchange?: () => void; [k: string]: any } = $props()
  let pending: any[] | null = null
  export function flush() { return { blocks, ok: true } }
  registry.mounts += 1
  registry.current = { type: (b: any[]) => { blocks = b; onchange?.() }, get: () => blocks, typePending: (b: any[]) => { pending = b } } as any
  onDestroy(() => { if (pending) { blocks = pending; onchange?.() } })
</script>
<div class="stub-editor" data-blocks={JSON.stringify(blocks)}></div>
