<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/services/supabase';
	import type { Tables } from '$lib/types/database';

	let products: (Tables<'products'> & { available_count?: number })[] = [];
	let loading = true;
	let error: string | null = null;
	let searchQuery = '';
	let selectedCategory = 'all';

	const categories = ['all', 'camera', 'lens', 'tripod', 'audio', 'lighting'];

	async function loadProducts() {
		try {
			loading = true;
			error = null;

			// Fetch products with available asset count
			let query = supabase.from('products').select('*');

			if (searchQuery) {
				query = query.ilike('name', `%${searchQuery}%`);
			}

			if (selectedCategory !== 'all') {
				query = query.eq('category', selectedCategory);
			}

			const { data: rawData, error: fetchError } = await (query as ReturnType<typeof query.eq>).eq('is_active', true);
			const data: Tables<'products'>[] = (rawData ?? []) as Tables<'products'>[];

			if (fetchError) throw fetchError;

			// Fetch available asset counts for each product
			const productsWithCounts = await Promise.all(
				(data || []).map(async (product: Record<string, unknown>) => {
					const { count } = await supabase
						.from('assets')
						.select('*', { count: 'exact', head: true })
						.eq('product_id', product.id)
						.eq('status', 'available');

					return {
						...product,
						available_count: count || 0
					};
				})
			);

			products = productsWithCounts;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load products';
			console.warn('Product loading error:', error);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadProducts();
	});

	$: if (searchQuery || selectedCategory) {
		loadProducts();
	}

	function formatPrice(price: number): string {
		return new Intl.NumberFormat('ko-KR', {
			style: 'currency',
			currency: 'KRW'
		}).format(price);
	}
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
	<div class="mb-8">
		<h1 class="text-4xl font-bold text-gray-900 mb-2">렌탈 장비</h1>
		<p class="text-lg text-gray-600">전문 카메라부터 음향 장비까지 모든 것을 빌려보세요</p>
	</div>

	<!-- Search and Filter -->
	<div class="bg-white rounded-lg shadow-md p-6 mb-8">
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
			<div>
				<label for="search" class="block text-sm font-medium text-gray-700 mb-2">
					검색
				</label>
				<input
					id="search"
					type="text"
					placeholder="장비 이름으로 검색..."
					bind:value={searchQuery}
					class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				/>
			</div>

			<div>
				<label for="category" class="block text-sm font-medium text-gray-700 mb-2">
					카테고리
				</label>
				<select
					id="category"
					bind:value={selectedCategory}
					class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
					{#each categories as cat}
						<option value={cat}>
							{cat === 'all' ? '전체' : cat}
						</option>
					{/each}
				</select>
			</div>
		</div>
	</div>

	<!-- Products Grid -->
	{#if loading}
		<div class="flex justify-center items-center py-12">
			<div class="text-lg text-gray-500">로딩 중...</div>
		</div>
	{:else if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
			{error}
		</div>
	{:else if products.length === 0}
		<div class="text-center py-12">
			<p class="text-lg text-gray-500">검색 결과가 없습니다.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{#each products as product (product.id)}
				<a
					href={`/products/${product.id}`}
					class="bg-white rounded-lg shadow-md hover:shadow-lg transition overflow-hidden group cursor-pointer"
				>
					<div class="bg-gradient-to-br from-purple-100 to-blue-100 h-48 flex items-center justify-center">
						<div class="text-6xl">
							{product.category === 'camera'
								? '📷'
								: product.category === 'lens'
									? '🔍'
									: (product.category as string) === 'tripod'
										? '📏'
										: product.category === 'audio'
											? '🎤'
											: '💡'}
						</div>
					</div>

					<div class="p-6">
						<h3 class="font-bold text-lg text-gray-900 mb-2 group-hover:text-purple-600">
							{product.name}
						</h3>

						<p class="text-sm text-gray-600 mb-4 line-clamp-2">
							{product.description || '상세 설명 없음'}
						</p>

						<div class="space-y-3 mb-4">
							<div class="flex justify-between text-sm">
								<span class="text-gray-600">일일 렌탈</span>
								<span class="font-bold text-purple-600">{formatPrice(product.base_price_daily)}</span>
							</div>
							<div class="flex justify-between text-sm">
								<span class="text-gray-600">주간 렌탈</span>
								<span class="font-bold text-purple-600">{formatPrice(product.base_price_weekly)}</span>
							</div>
							<div class="flex justify-between text-sm">
								<span class="text-gray-600">월간 렌탈</span>
								<span class="font-bold text-purple-600">{formatPrice(product.base_price_monthly)}</span>
							</div>
						</div>

						<div class="flex items-center justify-between pt-4 border-t">
							<span class="text-sm text-gray-600">
								가용: {product.available_count || 0}개
							</span>
							<span
								class={`px-3 py-1 rounded-full text-sm font-medium ${
									(product.available_count || 0) > 0
										? 'bg-green-100 text-green-800'
										: 'bg-red-100 text-red-800'
								}`}
							>
								{(product.available_count || 0) > 0 ? '가능' : '품절'}
							</span>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
