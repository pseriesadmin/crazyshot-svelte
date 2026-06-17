<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { locale } from 'svelte-i18n';
	import { initializeAuth, subscribeToAuthChanges, authState } from '$lib/stores/auth';

	let currentLocale = 'ko';

	onMount(() => {
		locale.set(currentLocale);

		// Initialize auth state
		initializeAuth().catch((_error) => {
			console.warn('Auth initialization error');
		});

		// Subscribe to auth state changes (e.g., when user logs in/out in another tab)
		const unsubscribe = subscribeToAuthChanges();

		return () => {
			unsubscribe();
		};
	});

	function toggleLanguage() {
		currentLocale = currentLocale === 'ko' ? 'en' : 'ko';
		locale.set(currentLocale);
	}
</script>

<div class="min-h-screen flex flex-col">
	<header class="sticky top-0 z-100 bg-white shadow-sm">
		<nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
			<a href="/" class="font-bold text-2xl text-purple-600 hover:text-purple-800">📸 CRAZYSHOT</a>
			<div class="flex gap-6 items-center">
				<a href="/products" class="text-gray-700 hover:text-purple-600 font-medium">
					렌탈 장비
				</a>
				{#if $authState.loading}
					<div class="text-sm text-gray-500">Loading...</div>
				{:else if $authState.user}
					<div class="text-sm text-gray-700">{$authState.user.email}</div>
					<a href="/auth/logout" class="px-3 py-1 text-sm rounded hover:bg-gray-100">Sign Out</a>
				{:else}
					<a href="/auth/login" class="px-3 py-1 text-sm rounded hover:bg-gray-100">Sign In</a>
				{/if}
				<button
					onclick={toggleLanguage}
					class="px-3 py-1 text-sm rounded hover:bg-gray-100"
				>
					{currentLocale === 'ko' ? '🇰🇷 KOR' : '🇺🇸 ENG'}
				</button>
			</div>
		</nav>
	</header>

	<main class="flex-1">
		<slot />
	</main>

	<footer class="bg-gray-900 text-white py-8 mt-12">
		<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
			<p class="text-center text-sm">© 2026 CRAZYSHOT. All rights reserved.</p>
		</div>
	</footer>
</div>

<style>
	:global(html) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
			Arial, sans-serif;
	}
</style>
