/**
 * +page.ts — /dev/cart 라우트 로드 함수
 * 목적: 더미 데이터 반환 (실제 Supabase 호출 없음)
 */

import type { PageLoad } from './$types';
import {
  sampleProducts,
  sampleAssets,
  sampleCartItems,
  mockUserProfile,
  sampleReservations
} from '$lib/fixtures/cartFixtures';

export const load: PageLoad = async () => {
  return {
    products: sampleProducts,
    assets: sampleAssets,
    cartItems: sampleCartItems,
    reservations: sampleReservations,
    userProfile: mockUserProfile,
    isDevMode: true
  };
};
