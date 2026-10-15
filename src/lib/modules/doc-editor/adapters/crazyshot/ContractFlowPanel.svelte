<script lang="ts">
  /**
   * ContractFlowPanel.svelte — 계약서 양식(문서형) 변수 패널 어댑터 (adapters/crazyshot)
   *
   * VariablePanel에 계약서 변수 카탈로그를 주입하고, 계약서 고유 '특약' 탭을 extraTabs로 끼운다.
   * 기존 ContractFieldPanel(flow 모드 4탭: 계약자·상품·결제·특약)을 대체한다.
   */
  import VariablePanel from '../../ui/VariablePanel.svelte'
  import SpecsTab from './SpecsTab.svelte'
  import { CONTRACT_VARIABLE_CATALOG } from './contractCatalog'
  import type { MergeFieldAttrs } from '../../core/types'
  import './host-tokens.css'

  interface SpecRow { key: string; value: string }

  interface Props {
    onInsertField: (attrs: MergeFieldAttrs) => void
    specifications: SpecRow[]
    onSpecsChange: (specs: SpecRow[]) => void
  }

  let { onInsertField, specifications, onSpecsChange }: Props = $props()
</script>

<div class="cs-doc-editor-host" style="display: contents">
  <VariablePanel
    catalog={CONTRACT_VARIABLE_CATALOG}
    onInsert={onInsertField}
    extraTabs={[{ key: 'specs', label: '특약' }]}
  >
    {#snippet extra()}
      <SpecsTab {specifications} {onSpecsChange} />
    {/snippet}
  </VariablePanel>
</div>
