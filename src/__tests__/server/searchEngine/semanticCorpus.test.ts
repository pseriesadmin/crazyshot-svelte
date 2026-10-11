/**
 * semanticCorpus.test.ts — B-2 말뭉치 화이트리스트·마스킹·어휘 필터 계약
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSemanticCorpus, SEMANTIC_CORPUS_SOURCES } from '$lib/server/searchEngine/adapters/semanticCorpus'

const products = [
  { id: 'p1', name: 'Sony A7S3', brand: 'Sony', category: 'camera', slug: 's', product_caption: '풀프레임 미러리스', keywords: ['브이로그'] },
  { id: 'p2', name: 'Ulanzi 미니삼각대', brand: 'Ulanzi', category: 'actcam', slug: 'u', product_caption: '휴대용 삼각대', keywords: [] },
]
const okPost = { id: 'post1', title: '브이로그 미러리스 풀프레임 추천', content_blocks: [], keywords: ['미러리스'], tags: [], is_public: true, status: 'published', allow_ai_save: true }

describe('buildSemanticCorpus — 허용 소스만', () => {
  it('상품·빠른답변·동의어는 그대로 들어가고 pending_review 답변은 제외', () => {
    const c = buildSemanticCorpus({
      products,
      canned: [
        { title: '반납 안내', content: '반납은 영업시간 내에 해주세요', match_keywords: ['반납'], pending_review: false },
        { title: '검수중', content: '검수중 내용', match_keywords: [], pending_review: true },
      ],
      synonymGroups: [{ canonicalTerm: '셀카봉', confirmedTerms: ['셀피스틱'] }],
    })
    expect(c.stats.docs.product).toBe(2)
    expect(c.stats.docs.canned).toBe(1)
    expect(c.stats.docs.synonym).toBe(1)
    expect(c.docs.find((d) => d.text.includes('셀피스틱'))?.weight).toBe(3)
    expect(c.docs.some((d) => d.text.includes('검수중'))).toBe(false)
  })

  it('비공개 글·AI 저장 거부 글·미발행 글과 그 댓글은 제외', () => {
    const c = buildSemanticCorpus({
      products,
      posts: [
        { ...okPost, id: 'a', is_public: false },
        { ...okPost, id: 'b', allow_ai_save: false },
        { ...okPost, id: 'c', status: 'draft' },
        { ...okPost, id: 'd' },
      ],
      comments: [
        { post_id: 'a', content: '브이로그 미러리스 좋아요', is_public: true },
        { post_id: 'd', content: '브이로그 미러리스 좋아요', is_public: false },
        { post_id: 'd', content: '브이로그 미러리스 정말 좋아요', is_public: true },
      ],
    })
    expect(c.stats.docs.crazylog).toBe(1)
    expect(c.stats.docs.comment).toBe(1)
  })
})

describe('buildSemanticCorpus — 개인정보·어휘 필터', () => {
  it('전화·이메일·긴 숫자가 든 줄은 버리고(또는 마스킹) 말뭉치에 남지 않는다', () => {
    const c = buildSemanticCorpus({
      products,
      reviews: [
        { title: '브이로그 좋아요', content: '연락은 010-1234-5678 로 주세요. 이메일 a@b.com. 카드 1234 5678 9012 3456', is_public: true },
      ],
    })
    const all = c.docs.map((d) => d.text).join('\n')
    expect(all).not.toMatch(/010|1234|a@b|9012/)
  })

  it('사용자 출처에서 한 번만 나온 고유한 말(이름·별명)은 어휘에서 빠지고 상품 말은 남는다', () => {
    const c = buildSemanticCorpus({
      products,
      reviews: [{ title: '', content: '쿠키몬스터닉네임 미러리스 브이로그 최고', is_public: true }],
    })
    const joined = c.docs.map((d) => d.text).join('\n')
    expect(joined).not.toContain('쿠키몬스터닉네임')
    expect(joined).toContain('미러리스 브이로그')
    expect(c.stats.droppedWords).toBeGreaterThan(0)
  })

  it('사용자 출처에서 2회 이상 나온 말은 상품에 없어도 남는다', () => {
    const c = buildSemanticCorpus({
      products,
      reviews: [
        { title: '', content: '야간 촬영 브이로그 미러리스', is_public: true },
        { title: '', content: '야간 촬영 풀프레임 미러리스', is_public: true },
      ],
    })
    expect(c.docs.filter((d) => d.text.includes('야간')).length).toBe(2)
  })
})

describe('허용 소스 고정', () => {
  it('소스는 정확히 7종', () => {
    expect([...SEMANTIC_CORPUS_SOURCES]).toEqual(['product', 'review', 'crazylog', 'comment', 'canned', 'synonym', 'learned'])
  })

  it('말뭉치 모듈 소스에 채팅 원문·답변 후보·분류 로그 원문·검색 로그 원문이 나타나지 않는다', () => {
    for (const f of ['adapters/semanticCorpus.ts', 'adapters/semanticModelStore.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/lib/server/searchEngine', f), 'utf-8')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '') // 설명 주석 제외
      for (const banned of ['chat_messages', 'chat_reply_candidates', 'raw_response', 'search_logs', 'chat_intent_logs']) {
        expect(code, `${f} 에 ${banned} 가 있으면 안 됨`).not.toContain(banned)
      }
    }
  })
})

describe('말뭉치 조회 테이블 화이트리스트(semanticModelStore.loadSemanticCorpusInput)', () => {
  it('읽는 테이블이 허용 소스 7종의 테이블과 정확히 일치한다', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/server/searchEngine/adapters/semanticModelStore.ts'), 'utf-8')
    const body = src.slice(src.indexOf('export async function loadSemanticCorpusInput'), src.indexOf('export type BuildOutcome'))
    const tables = [...body.matchAll(/admin\s*\.from\('([a-z_]+)'\)/g)].map((m) => m[1]).sort()
    expect(tables).toEqual(
      ['canned_responses', 'post_comments', 'product_reviews', 'product_search_stats', 'products', 'synonym_group_members', 'user_posts'].sort(),
    )
  })
})

describe('마스킹 → 문장 분리 순서', () => {
  it('구두점이 낀 전화번호(010.1234.5678)도 말뭉치에 남지 않는다', () => {
    const c = buildSemanticCorpus({
      products,
      reviews: [{ title: '', content: '브이로그 미러리스 연락처 010.1234.5678 입니다', is_public: true }],
    })
    expect(c.docs.map((d) => d.text).join('\n')).not.toMatch(/1234|5678/)
  })
})
