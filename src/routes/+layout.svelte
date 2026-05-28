<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { locale } from 'svelte-i18n';

	let currentLocale = 'ko';

	onMount(() => {
		locale.set(currentLocale);
	});

	function toggleLanguage() {
		currentLocale = currentLocale === 'ko' ? 'en' : 'ko';
		locale.set(currentLocale);
	}
</script>

<div class="min-h-screen flex flex-col">
	<header class="sticky top-0 z-100 bg-white shadow-sm">
		<nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
			<div class="font-bold text-2xl text-purple-600">📸 CRAZYSHOT</div>
			<div class="flex gap-4 items-center">
				<button
					on:click={toggleLanguage}
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
