// 내정보 > '로그'(나의 대여 이용 내역)·'후기·댓글'(내가 작성한 후기와 댓글) 탭의 실제 데이터 조회.
// account/+page.server.ts(PC)와 account/profile/+page.server.ts(모바일)가 공유한다.
// 과거 두 탭은 서버 데이터 없이 컴포넌트 안의 샘플 배열(스타벅스 텀블러 등)을 모든 사용자에게 그렸다.
//
// 읽기 전용·본인 행만: 모든 쿼리에 user_id 조건을 걸고, RLS(public_select_* 등)는 그대로 따른다.
// 일부 조회가 실패해도(fail-soft) 나머지 내정보 화면 로드를 막지 않고 빈 목록으로 돌려준다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'

export interface MyLogItem {
  id: number | string
  date: string      // 'YYYY.MM.DD' — 대여 종료일(없으면 시작일)
  title: string     // 상품명
  status: string    // 화면 배지 라벨
  duration: string  // 'N일'
}

export interface MyReviewItem {
  id: string
  date: string
  item: string      // 상품명
  title: string
  content: string
}

export interface MyCommentItem {
  id: string
  date: string
  postTitle: string // 댓글을 단 게시글 제목(볼 수 없는 글이면 '게시글')
  content: string
}

export interface MyActivity {
  logs: MyLogItem[]
  reviews: MyReviewItem[]
  comments: MyCommentItem[]
}

const LIMIT = 30

// database.ts에 product_reviews/post_comments/user_posts 컬럼 타입이 부분 등록돼 있어 동일 테이블
// 접근 패턴(cart/+page.server.ts untypedFrom)을 따른다.
function untypedFrom(sb: SupabaseClient, table: string) {
  return (sb as unknown as { from: (t: string) => ReturnType<SupabaseClient['from']> }).from(table)
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10).replaceAll('-', '.')
  // KST 기준 날짜
  const kst = new Date(d.getTime() + 9 * 3600_000)
  return `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, '0')}.${String(kst.getUTCDate()).padStart(2, '0')}`
}

function durationLabel(start: string | null, end: string | null): string {
  if (!start || !end) return ''
  const s = new Date(`${start}T00:00:00+09:00`).getTime()
  const e = new Date(`${end}T00:00:00+09:00`).getTime()
  if (Number.isNaN(s) || Number.isNaN(e)) return ''
  return `${Math.max(1, Math.round((e - s) / 86400_000))}일`
}

export async function loadMyActivity(supabase: SupabaseClient, userId: string): Promise<MyActivity> {
  const empty: MyActivity = { logs: [], reviews: [], comments: [] }
  try {
    const [rentalRes, reviewRes, commentRes] = await Promise.all([
      untypedFrom(supabase, 'rental_reservations')
        .select('id, status, start_date, end_date, created_at, products!rental_reservations_product_id_fkey(name, parent_product_id)')
        .eq('user_id', userId)
        .in('status', ['returned', 'completed'])
        .order('end_date', { ascending: false })
        .limit(LIMIT),
      untypedFrom(supabase, 'product_reviews')
        .select('id, product_id, title, content, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(LIMIT),
      untypedFrom(supabase, 'post_comments')
        .select('id, post_id, content, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(LIMIT),
    ])

    // 자식 재고의 이름은 부모 값을 따른다(자식 재고 부모 참조 전환 Phase 3-B)
    await applyParentFieldsToRowProducts((rentalRes.data ?? []) as unknown[], ['name'])

    const logs: MyLogItem[] = ((rentalRes.data ?? []) as unknown as Array<{
      id: number | string; status: string; start_date: string | null; end_date: string | null; created_at: string
      products: { name: string | null } | { name: string | null }[] | null
    }>).map((r) => {
      const p = Array.isArray(r.products) ? r.products[0] : r.products
      return {
        id: r.id,
        date: fmtDate(r.end_date ?? r.start_date ?? r.created_at),
        title: p?.name ?? '상품',
        status: '반납완료',
        duration: durationLabel(r.start_date, r.end_date),
      }
    })

    const reviewRows = (reviewRes.data ?? []) as unknown as Array<{ id: string; product_id: string; title: string | null; content: string | null; created_at: string }>
    const commentRows = (commentRes.data ?? []) as unknown as Array<{ id: string; post_id: string; content: string | null; created_at: string }>

    // 상품명·게시글 제목은 별도 조회(FK 임베드 이름 의존을 피함)
    const productIds = [...new Set(reviewRows.map((r) => r.product_id).filter(Boolean))]
    const postIds = [...new Set(commentRows.map((c) => c.post_id).filter(Boolean))]
    const [productRes, postRes] = await Promise.all([
      productIds.length
        ? untypedFrom(supabase, 'products').select('id, name').in('id', productIds)
        : Promise.resolve({ data: [] as unknown[] }),
      postIds.length
        ? untypedFrom(supabase, 'user_posts').select('id, title').in('id', postIds)
        : Promise.resolve({ data: [] as unknown[] }),
    ])
    const productName = new Map(((productRes.data ?? []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name ?? '']))
    const postTitle = new Map(((postRes.data ?? []) as Array<{ id: string; title: string | null }>).map((p) => [p.id, p.title ?? '']))

    const reviews: MyReviewItem[] = reviewRows.map((r) => ({
      id: r.id,
      date: fmtDate(r.created_at),
      item: productName.get(r.product_id) || '상품',
      title: r.title ?? '',
      content: r.content ?? '',
    }))
    const comments: MyCommentItem[] = commentRows.map((c) => ({
      id: c.id,
      date: fmtDate(c.created_at),
      postTitle: postTitle.get(c.post_id) || '게시글',
      content: c.content ?? '',
    }))

    return { logs, reviews, comments }
  } catch (e) {
    console.error('[account] loadMyActivity 실패(빈 목록으로 대체)', e)
    return empty
  }
}
