<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getAudioAnalyzer } from '$lib/ml/audioAnalyzer';
	import { audioData, audioChord, systemStatus } from '$lib/stores/appState';

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let animationId: number;

	const audioAnalyzer = getAudioAnalyzer();
	const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

	export let enabled = true;

	onMount(async () => {
		ctx = canvas.getContext('2d');

		if (enabled) {
			await startAudio();
		}
	});

	onDestroy(() => {
		if (animationId) {
			cancelAnimationFrame(animationId);
		}
		audioAnalyzer.close();
	});

	async function startAudio() {
		try {
			systemStatus.update((s) => ({ ...s, microphone: 'requesting' }));
			await audioAnalyzer.initialize();
			systemStatus.update((s) => ({ ...s, microphone: 'active' }));
			visualize();
		} catch (error) {
			console.error('音頻初始化失敗:', error);
			systemStatus.update((s) => ({ ...s, microphone: 'error' }));
		}
	}

	function visualize() {
		if (!ctx || !canvas || !audioAnalyzer.ready) {
			animationId = requestAnimationFrame(visualize);
			return;
		}

		const width = canvas.width;
		const height = canvas.height;

		// 清除畫布
		ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
		ctx.fillRect(0, 0, width, height);

		// 獲取數據
		const chromagram = audioAnalyzer.computeChromagram();
		const waveform = audioAnalyzer.getWaveformData().slice(0, 256);

		// 更新 store
		audioData.update((d) => ({
			...d,
			chromagram,
			waveform
		}));

		// 和弦檢測
		const detection = audioAnalyzer.detectChord();
		if (detection.confidence > 0.3) {
			audioChord.set({
				name: detection.chord,
				confidence: detection.confidence,
				source: 'audio',
				timestamp: Date.now()
			});
		}

		// 繪製 Chromagram（12 個音階柱狀圖）
		const barWidth = (width - 24) / 12;
		const barGap = 2;

		for (let i = 0; i < 12; i++) {
			const x = 12 + i * barWidth;
			const barHeight = chromagram[i] * (height - 40);

			// 漸變顏色
			const gradient = ctx.createLinearGradient(x, height - barHeight, x, height);
			gradient.addColorStop(0, '#8b5cf6');
			gradient.addColorStop(1, '#3b82f6');

			ctx.fillStyle = gradient;
			ctx.fillRect(x + barGap / 2, height - barHeight - 20, barWidth - barGap, barHeight);

			// 音階標籤
			ctx.fillStyle = chromagram[i] > 0.5 ? '#fff' : '#666';
			ctx.font = '10px monospace';
			ctx.textAlign = 'center';
			ctx.fillText(NOTE_NAMES[i], x + barWidth / 2, height - 6);
		}

		// 繪製頂部波形
		ctx.beginPath();
		ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
		ctx.lineWidth = 1;

		const sliceWidth = width / waveform.length;
		let wx = 0;

		for (let i = 0; i < waveform.length; i++) {
			const v = waveform[i];
			const y = ((v + 1) / 2) * 30 + 5;

			if (i === 0) {
				ctx.moveTo(wx, y);
			} else {
				ctx.lineTo(wx, y);
			}
			wx += sliceWidth;
		}

		ctx.stroke();

		// 顯示檢測到的和弦
		if (detection.confidence > 0.3) {
			ctx.fillStyle = '#fff';
			ctx.font = 'bold 14px sans-serif';
			ctx.textAlign = 'right';
			ctx.fillText(
				`${detection.chord} (${Math.round(detection.confidence * 100)}%)`,
				width - 10,
				20
			);
		}

		animationId = requestAnimationFrame(visualize);
	}
</script>

<div class="chord-card">
	<div class="flex justify-between items-center mb-3">
		<h3 class="text-sm font-semibold text-gray-300">🎵 音頻分析</h3>
		{#if $systemStatus.microphone === 'active'}
			<span class="status-dot status-active"></span>
		{:else if $systemStatus.microphone === 'requesting'}
			<span class="status-dot bg-yellow-500 animate-pulse"></span>
		{:else}
			<span class="status-dot status-inactive"></span>
		{/if}
	</div>

	<canvas
		bind:this={canvas}
		width="300"
		height="120"
		class="w-full rounded-lg bg-black/30"
	></canvas>

	<div class="mt-2 text-xs text-gray-500 text-center">
		Chromagram - 12 音階能量分佈
	</div>
</div>
