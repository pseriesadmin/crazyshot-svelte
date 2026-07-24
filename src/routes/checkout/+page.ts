import type { PageLoad } from './$types';
import {
  sampleProducts,
  sampleAssets,
  sampleCartItems,
  mockUserProfile,
  sampleReservations
} from '$lib/fixtures/cartFixtures';

// +page.server.ts 가 실 카트 데이터(serverCartItems / serverProducts / cartProducts 등)를 제공.
// data param을 spread해 서버 데이터가 컴포넌트까지 도달하도록 한다.
// 픽스처는 isServerLoaded=false 시 폴백으로만 사용 (서버 데이터가 없는 키에만 적용).
export const load: PageLoad = async ({ data }) => {
  return {
    products:     sampleProducts,
    assets:       sampleAssets,
    cartItems:    sampleCartItems,
    reservations: sampleReservations,
    userProfile:  mockUserProfile,
    isDevMode:    true,
    ...data,  // 서버 데이터(cartProducts, reservationIds, deliveryOptions 등)를 덮어씌움
  }
}
