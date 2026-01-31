<script lang="ts">
	import { onMount } from 'svelte';
	import CameraView from '$lib/components/CameraView.svelte';
	import ChordDisplay from '$lib/components/ChordDisplay.svelte';
	import AudioVisualizer from '$lib/components/AudioVisualizer.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import { checkWebGPUSupport } from '$lib/utils/webgpuCheck';
	import { systemStatus } from '$lib/stores/appState';
	import '../app.css';

	let isClient = false;

	onMount(async () => {
		isClient = true;

		// 檢查 WebGPU 支援
		const gpuStatus = await checkWebGPUSupport();
		systemStatus.update((s) => ({
			...s,
			webgpu: gpuStatus.supported ? 'supported' : 'unsupported'
		}));
	});
</script>

<svelte:head>
	<title>🎸 吉他和弦自學神器</title>
	<meta name="description" content="使用 AI 技術即時識別吉他和弦，支援視覺和音頻雙重識別" />
</svelte:head>

<div class="min-h-screen p-4 md:p-8">
	<!-- 標題 -->
	<header class="text-center mb-8">
		<h1 class="text-3xl md:text-4xl font-bold mb-2">
			🎸 吉他和弦自學神器
		</h1>
		<p class="text-gray-400">
			AI 驅動 · 視覺 + 音頻雙重識別 · 即時反饋
		</p>
		<!-- 模式切換 -->
		<div class="flex justify-center gap-4 mt-4">
			<span class="px-4 py-2 bg-blue-600 rounded-full text-sm font-medium">
				📷 即時模式
			</span>
			<a
				href="/analyze"
				class="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-sm font-medium transition-colors"
			>
				🎬 影片分析
			</a>
		</div>
	</header>

	{#if isClient}
		<!-- 主要內容區 -->
		<div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- 左側：攝像頭視圖 -->
			<div class="lg:col-span-2 space-y-6">
				<CameraView />

				<!-- 音頻視覺化 -->
				<AudioVisualizer />
			</div>

			<!-- 右側：資訊面板 -->
			<div class="space-y-6">
				<!-- 和弦顯示 -->
				<ChordDisplay />

				<!-- 系統狀態 -->
				<StatusBar />

				<!-- 使用說明 -->
				<div class="chord-card">
					<h3 class="text-sm font-semibold text-gray-300 mb-3">使用說明</h3>
					<ul class="text-sm text-gray-400 space-y-2">
						<li class="flex gap-2">
							<span>1.</span>
							<span>允許攝像頭和麥克風權限</span>
						</li>
						<li class="flex gap-2">
							<span>2.</span>
							<span>將左手（按弦手）放在攝像頭前</span>
						</li>
						<li class="flex gap-2">
							<span>3.</span>
							<span>做出和弦手勢，系統會自動識別</span>
						</li>
						<li class="flex gap-2">
							<span>4.</span>
							<span>同時彈奏吉他，音頻識別會輔助確認</span>
						</li>
					</ul>
				</div>

				<!-- 支援的和弦 -->
				<div class="chord-card">
					<h3 class="text-sm font-semibold text-gray-300 mb-3">支援的和弦</h3>
					<div class="flex flex-wrap gap-2">
						{#each ['C', 'D', 'E', 'F', 'G', 'A', 'Am', 'Dm', 'Em', 'G7', 'C7', 'D7'] as chord}
							<span class="px-2 py-1 bg-white/10 rounded text-sm">{chord}</span>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- 頁尾 -->
		<footer class="text-center mt-12 text-gray-500 text-sm">
			<p>Powered by MediaPipe + TensorFlow.js + Web Audio API</p>
			<p class="mt-1">在 MacBook 上使用 WebGPU 加速</p>
		</footer>
	{:else}
		<!-- 載入畫面 -->
		<div class="flex items-center justify-center h-64">
			<div class="text-center">
				<div class="text-6xl mb-4 animate-pulse">🎸</div>
				<p class="text-gray-400">載入中...</p>
			</div>
		</div>
	{/if}
</div>
