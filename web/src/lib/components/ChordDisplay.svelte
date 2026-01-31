<script lang="ts">
	import { fusedChord, visionChord, audioChord, showDebug } from '$lib/stores/appState';

	// 和弦圖片映射
	const chordImages: Record<string, string> = {
		C: '/images/C.png',
		D: '/images/D.png',
		E: '/images/E.png',
		F: '/images/F.png',
		G: '/images/G.png',
		A: '/images/A.png',
		Am: '/images/Am.png',
		Dm: '/images/Dm.png',
		Em: '/images/Em.png',
		'C / F': '/images/C.png',
		'E / Am': '/images/E.png',
		'E / Am (Barre)': '/images/E shape.png',
		'Em (Barre)': '/images/Em shape.png',
		'A (Barre)': '/images/A shape.png'
	};

	function getConfidenceColor(confidence: number): string {
		if (confidence >= 0.8) return 'bg-green-500';
		if (confidence >= 0.6) return 'bg-yellow-500';
		if (confidence >= 0.4) return 'bg-orange-500';
		return 'bg-red-500';
	}

	function getSourceLabel(source: string): string {
		switch (source) {
			case 'vision':
				return '👁️ 視覺';
			case 'audio':
				return '🎵 音頻';
			case 'fused':
				return '🔗 融合';
			default:
				return source;
		}
	}
</script>

<div class="chord-card">
	<h2 class="text-lg font-semibold mb-4 text-gray-300">檢測到的和弦</h2>

	{#if $fusedChord}
		<div class="text-center">
			<!-- 和弦名稱 -->
			<div class="text-5xl font-bold mb-4 text-white">
				{$fusedChord.name}
			</div>

			<!-- 和弦圖片 -->
			{#if chordImages[$fusedChord.name]}
				<div class="mb-4 flex justify-center">
					<img
						src={chordImages[$fusedChord.name]}
						alt={$fusedChord.name}
						class="w-32 h-auto rounded-lg bg-white/10 p-2"
					/>
				</div>
			{/if}

			<!-- 置信度 -->
			<div class="mb-2">
				<div class="flex justify-between text-sm mb-1">
					<span class="text-gray-400">置信度</span>
					<span class="font-mono">{Math.round($fusedChord.confidence * 100)}%</span>
				</div>
				<div class="confidence-bar">
					<div
						class="confidence-fill {getConfidenceColor($fusedChord.confidence)}"
						style="width: {$fusedChord.confidence * 100}%"
					></div>
				</div>
			</div>

			<!-- 來源標籤 -->
			<div class="text-sm text-gray-400 mt-3">
				{getSourceLabel($fusedChord.source)}
			</div>
		</div>
	{:else}
		<div class="text-center py-8">
			<div class="text-6xl mb-4 opacity-30">🎸</div>
			<p class="text-gray-500">等待檢測...</p>
			<p class="text-sm text-gray-600 mt-2">請將左手放在攝像頭前</p>
		</div>
	{/if}

	<!-- 除錯資訊 -->
	{#if $showDebug}
		<div class="mt-4 pt-4 border-t border-white/10 text-xs font-mono">
			<div class="grid grid-cols-2 gap-2">
				<div>
					<span class="text-gray-500">視覺:</span>
					{$visionChord?.name || '-'}
					({$visionChord ? Math.round($visionChord.confidence * 100) : 0}%)
				</div>
				<div>
					<span class="text-gray-500">音頻:</span>
					{$audioChord?.name || '-'}
					({$audioChord ? Math.round($audioChord.confidence * 100) : 0}%)
				</div>
			</div>
		</div>
	{/if}
</div>
