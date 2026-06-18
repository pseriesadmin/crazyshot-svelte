<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase, rpc } from '$lib/services/supabase';
	import { isAuthenticated } from '$lib/stores/auth';
	import { validateReservationInput, calculateReservationPrice } from '$lib/services/reservationHelper';
	import type { Tables } from '$lib/types/database';
	import type { PriceBreakdown } from '$lib/services/reservationHelper';

	export let data;

	let product: Tables<'products'> | null = null;
	let assets: Tables<'assets'>[] = [];
	let loading = true;
	let error: string | null = null;

	let startDate = '';
	let endDate = '';
	let reservationError = '';
	let reservationLoading = false;
	let priceBreakdown: PriceBreakdown | null = null;

	onMount(async () => {
		try {
			loading = true;
			error = null;

			const { data: productData, error: productError } = await supabase
				.from('products')
				.select('*')
				.eq('id', data.params.id)
				.single();

			if (productError) throw productError;
			product = productData;

			const { data: assetsData, error: assetsError } = await supabase
				.from('assets')
				.select('*')
				.eq('product_id', data.params.id)
				.eq('status', 'available');

			if (assetsError) throw assetsError;
			assets = assetsData || [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load product';
			console.warn('Product detail loading error:', error);
		} finally {
			loading = false;
		}
	});

	function updatePriceBreakdown() {
		if (!startDate || !endDate || !product) {
			priceBreakdown = null;
			return;
		}

		// Validate dates using helper functions
		const validationErrors = validateReservationInput({
			productId: product.id,
			startDate,
			endDate
		});

		if (validationErrors.length > 0) {
			priceBreakdown = null;
			return;
		}

		// Calculate price with potential subscription discount (0% for now, would come from user profile)
		priceBreakdown = calculateReservationPrice(
			product.base_price_daily,
			product.base_price_weekly,
			product.base_price_monthly,
			startDate,
			endDate,
			0 // TODO: Get subscription discount from user profile
		);
	}

	$: if (startDate && endDate) updatePriceBreakdown();

	async function makeReservation() {
		if (!$isAuthenticated) {
			error = '예약하려면 먼저 로그인해주세요.';
			return;
		}

		if (!startDate || !endDate) {
			reservationError = '시작일과 종료일을 선택해주세요.';
			return;
		}

		// Validate input using helper function
		if (!product) {
			throw new Error('Product not loaded');
		}

		const validationErrors = validateReservationInput({
			productId: product.id,
			startDate,
			endDate
		});

		if (validationErrors.length > 0) {
			reservationError = validationErrors.map((e) => e.message).join(', ');
			return;
		}

		try {
			reservationLoading = true;
			reservationError = '';

			// Use RPC to atomically reserve asset (H-01: no direct INSERT)
			const result = await rpc.atomicReserveAsset(product.id, startDate, endDate);

			if (!result.success) {
				throw new Error(result.error_message || 'Reservation failed');
			}

			// Clear form
			startDate = '';
			endDate = '';
			priceBreakdown = null;

			// Show success message
			console.warn('예약이 완료되었습니다. 결제 페이지로 이동합니다.');
			// TODO: Redirect to checkout page with reservation ID
		} catch (err) {
			reservationError = err instanceof Error ? err.message : 'Reservation failed';
			console.warn('Reservation error:', reservationError);
		} finally {
			reservationLoading = false;
		}
	}

	function formatPrice(price: number): string {
		return new Intl.NumberFormat('ko-KR', {
			style: 'currency',
			currency: 'KRW'
		}).format(price);
	}

	function getConditionBadgeColor(condition: string): string {
		switch (condition) {
			case 'excellent':
				return 'bg-green-100 text-green-800';
			case 'good':
				return 'bg-blue-100 text-blue-800';
			case 'fair':
				return 'bg-yellow-100 text-yellow-800';
			default:
				return 'bg-red-100 text-red-800';
		}
	}

	function getConditionLabel(condition: string): string {
		switch (condition) {
			case 'excellent':
				return '최상';
			case 'good':
				return '좋음';
			case 'fair':
				return '보통';
			default:
				return '손상';
		}
	}
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
	<a href="/products" class="text-purple-600 hover:text-purple-800 mb-6 inline-block">
		← 돌아가기
	</a>

	{#if loading}
		<div class="flex justify-center items-center py-12">
			<div class="text-lg text-gray-500">로딩 중...</div>
		</div>
	{:else if error || !product}
		<div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
			{error || 'Product not found'}
		</div>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
			<!-- Product Info -->
			<div class="lg:col-span-2">
				<div class="bg-gradient-to-br from-purple-100 to-blue-100 rounded-lg h-96 flex items-center justify-center mb-8">
					<div class="text-9xl">
						{product.category === 'camera'
							? '📷'
							: product.category === 'lens'
								? '🔍'
								: product.category === 'tripod'
									? '📏'
									: product.category === 'audio'
										? '🎤'
										: '💡'}
					</div>
				</div>

				<h1 class="text-4xl font-bold text-gray-900 mb-4">{product.name}</h1>

				<p class="text-xl text-gray-600 mb-8">{product.description}</p>

				<!-- Pricing -->
				<div class="bg-white rounded-lg shadow-md p-6 mb-8">
					<h2 class="text-2xl font-bold text-gray-900 mb-4">렌탈 가격</h2>
					<div class="grid grid-cols-3 gap-4">
						<div class="text-center">
							<p class="text-gray-600 text-sm mb-2">일일</p>
							<p class="text-2xl font-bold text-purple-600">{formatPrice(product.base_price_daily)}</p>
						</div>
						<div class="text-center">
							<p class="text-gray-600 text-sm mb-2">주간 (7일)</p>
							<p class="text-2xl font-bold text-purple-600">{formatPrice(product.base_price_weekly)}</p>
						</div>
						<div class="text-center">
							<p class="text-gray-600 text-sm mb-2">월간 (30일)</p>
							<p class="text-2xl font-bold text-purple-600">{formatPrice(product.base_price_monthly)}</p>
						</div>
					</div>
				</div>

				<!-- Available Assets -->
				<div class="bg-white rounded-lg shadow-md p-6">
					<h2 class="text-2xl font-bold text-gray-900 mb-4">가용 장비 ({assets.length})</h2>

					{#if assets.length === 0}
						<p class="text-gray-600">현재 가용한 장비가 없습니다.</p>
					{:else}
						<div class="space-y-3">
							{#each assets as asset (asset.id)}
								<div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
									<div>
										<p class="font-bold text-gray-900">{asset.serial_number}</p>
										<p class="text-sm text-gray-600">구매일: {asset.purchase_date}</p>
									</div>
									<span
										class={`px-3 py-1 rounded-full text-sm font-medium ${getConditionBadgeColor(
											asset.condition
										)}`}
									>
										{getConditionLabel(asset.condition)}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- Reservation Form -->
			<div class="lg:col-span-1">
				<div class="bg-white rounded-lg shadow-md p-6 sticky top-4">
					<h2 class="text-2xl font-bold text-gray-900 mb-6">예약하기</h2>

					{#if !$isAuthenticated}
						<div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
							<p class="text-sm text-blue-800">예약하려면 먼저 로그인해주세요.</p>
						</div>
						<a
							href="/auth/login"
							class="w-full block text-center bg-purple-600 text-white font-bold py-3 rounded-lg hover:bg-purple-700 transition"
						>
							로그인하기
						</a>
					{:else}
						<div class="space-y-4 mb-6">
							<div>
								<label for="startDate" class="block text-sm font-medium text-gray-700 mb-2">
									시작일
								</label>
								<input
									id="startDate"
									type="date"
									bind:value={startDate}
									min={new Date().toISOString().split('T')[0]}
									class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>

							<div>
								<label for="endDate" class="block text-sm font-medium text-gray-700 mb-2">
									종료일
								</label>
								<input
									id="endDate"
									type="date"
									bind:value={endDate}
									min={startDate || new Date().toISOString().split('T')[0]}
									class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
						</div>

						{#if priceBreakdown}
							<div class="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6 text-sm">
								<div class="flex justify-between mb-2">
									<span class="text-gray-700">대여 기간:</span>
									<span class="font-semibold text-gray-900">{priceBreakdown.rentalDays}일 ({priceBreakdown.rentalPeriodType})</span>
								</div>
								<div class="flex justify-between mb-2">
									<span class="text-gray-700">소계:</span>
									<span class="font-semibold text-gray-900">{formatPrice(priceBreakdown.subtotal)}</span>
								</div>
								{#if priceBreakdown.discountAmount > 0}
									<div class="flex justify-between mb-2">
										<span class="text-gray-700">할인 ({priceBreakdown.discountRate}%):</span>
										<span class="font-semibold text-red-600">-{formatPrice(priceBreakdown.discountAmount)}</span>
									</div>
								{/if}
								<div class="border-t border-purple-200 pt-2 flex justify-between">
									<span class="font-bold text-gray-900">총액:</span>
									<span class="font-bold text-purple-600 text-lg">{formatPrice(priceBreakdown.finalAmount)}</span>
								</div>
							</div>
						{/if}

						{#if reservationError}
							<div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-700 text-sm">
								{reservationError}
							</div>
						{/if}

						<button
							onclick={makeReservation}
							disabled={reservationLoading || assets.length === 0 || !priceBreakdown}
							class="w-full bg-purple-600 text-white font-bold py-3 rounded-lg hover:bg-purple-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
						>
							{reservationLoading ? '예약 중...' : assets.length === 0 ? '품절' : !priceBreakdown ? '날짜를 선택하세요' : '예약하기'}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
