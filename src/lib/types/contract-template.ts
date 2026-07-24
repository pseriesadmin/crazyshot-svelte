export interface ContractTemplate {
  id:             string
  title:          string
  content_blocks: unknown[]
  specifications: unknown[]
  status:         'active' | 'archived'
  created_at:     string
  updated_at:     string
}

export type ContractTemplateSummary = Pick<ContractTemplate, 'id' | 'title' | 'status' | 'created_at'>
