<script lang="ts">
	import { formatTime, type ChordSegment } from '$lib/ml/videoAnalyzer';

	export let segments: ChordSegment[] = [];
	export let duration: number = 0;
	export let currentTime: number = 0;
	export let onSeek: ((time: number) => void) | undefined = undefined;

	// 和弦顏色映射
	const chordColors: Record<string, string> = {
		C: '#ef4444',
		D: '#f97316',
		E: '#eab308',
		F: '#84cc16',
		G: '#22c55e',
		A: '#14b8a6',
		Am: '#06b6d4',
		Dm: '#3b82f6',
		Em: '#8b5cf6',
		G7: '#a855f7',
		C7: '#ec4899',
		D7: '#f43f5e'
	};

	function getColor(chord: string): string {
		return chordColors[chord] || '#6b7280';
	}

	function handleClick(segment: ChordSegment) {
		if (onSeek) {
			onSeek(segment.startTime);
		}
	}

	function getSegmentStyle(segment: ChordSegment): string {
		const left = (segment.startTime / duration) * 100;
		const width = ((segment.endTime - segment.startTime) / duration) * 100;
		return `left: ${left}%; width: ${width}%; background-color: ${getColor(segment.chord)};`;
	}

	function getCurrentSegment(): ChordSegment | null {
		return segments.find(
			(s) => currentTime >= s.startTime && currentTime < s.endTime
		) || null;
	}

	$: currentSegment = getCurrentSegment();
	$: playheadPosition = duration > 0 ? (currentTime / duration) * 100 : 0;
</script>

<div class="chord-timeline">
	<!-- 當前和弦顯示 -->
	<div class="current-chord mb-4 text-center">
		{#if currentSegment}
			<span
				class="text-4xl font-bold px-6 py-2 rounded-lg"
				style="background-color: {getColor(currentSegment.chord)}; color: white;"
			>
				{currentSegment.chord}
			</span>
		{:else}
			<span class="text-4xl font-bold text-gray-500">--</span>
		{/if}
	</div>

	<!-- 時間軸 -->
	<div class="timeline-container relative h-16 bg-gray-800 rounded-lg overflow-hidden">
		<!-- 和弦段落 -->
		{#each segments as segment}
			<button
				class="absolute top-0 h-full opacity-80 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center text-white text-xs font-medium"
				style={getSegmentStyle(segment)}
				onclick={() => handleClick(segment)}
				title="{segment.chord} ({formatTime(segment.startTime)} - {formatTime(segment.endTime)})"
			>
				{#if (segment.endTime - segment.startTime) / duration > 0.05}
					{segment.chord}
				{/if}
			</button>
		{/each}

		<!-- 播放頭 -->
		<div
			class="absolute top-0 w-0.5 h-full bg-white shadow-lg z-10"
			style="left: {playheadPosition}%;"
		>
			<div class="absolute -top-1 -left-1.5 w-3 h-3 bg-white rounded-full"></div>
		</div>
	</div>

	<!-- 時間標籤 -->
	<div class="flex justify-between text-xs text-gray-400 mt-1">
		<span>{formatTime(currentTime)}</span>
		<span>{formatTime(duration)}</span>
	</div>

	<!-- 和弦列表 -->
	<div class="chord-list mt-4 max-h-48 overflow-y-auto">
		<table class="w-full text-sm">
			<thead class="text-gray-400 text-left">
				<tr>
					<th class="py-1 px-2">時間</th>
					<th class="py-1 px-2">和弦</th>
					<th class="py-1 px-2">長度</th>
				</tr>
			</thead>
			<tbody>
				{#each segments as segment, i}
					<tr
						class="cursor-pointer transition-colors {currentSegment === segment ? 'bg-white/20' : 'hover:bg-white/10'}"
						onclick={() => handleClick(segment)}
					>
						<td class="py-1 px-2 text-gray-300">
							{formatTime(segment.startTime)}
						</td>
						<td class="py-1 px-2">
							<span
								class="px-2 py-0.5 rounded text-white text-xs"
								style="background-color: {getColor(segment.chord)};"
							>
								{segment.chord}
							</span>
						</td>
						<td class="py-1 px-2 text-gray-400">
							{(segment.endTime - segment.startTime).toFixed(1)}s
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.chord-timeline {
		background: rgba(255, 255, 255, 0.05);
		border-radius: 1rem;
		padding: 1.5rem;
	}
</style>
