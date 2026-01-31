<script lang="ts">
	import { onMount } from 'svelte';
	import ChordTimeline from '$lib/components/ChordTimeline.svelte';
	import {
		getVideoChordAnalyzer,
		formatTime,
		type ChordSegment,
		type AnalysisProgress
	} from '$lib/ml/videoAnalyzer';
	import {
		captureSystemAudio,
		captureMicrophone,
		stopCapture,
		isSystemAudioSupported,
		isMicrophoneSupported,
		type AudioCaptureResult
	} from '$lib/ml/systemAudioCapture';
	import '../../app.css';

	// 狀態
	type Mode = 'idle' | 'file' | 'live-setup' | 'live' | 'analyzing' | 'done';
	type LiveSource = 'system' | 'microphone';

	let mode: Mode = 'idle';
	let liveSource: LiveSource = 'system';
	let selectedFile: File | null = null;
	let audioElement: HTMLAudioElement | null = null;
	let audioUrl: string | null = null;

	// 即時分析
	let audioCapture: AudioCaptureResult | null = null;
	let isRecording = false;
	let recordedChunks: ChordSegment[] = [];
	let liveCurrentChord = '';
	let liveConfidence = 0;
	let recordingStartTime = 0;
	let recordingDuration = 0;
	let animationFrameId: number | null = null;

	// 分析結果
	let segments: ChordSegment[] = [];
	let duration = 0;
	let currentTime = 0;
	let progress = 0;
	let currentChord = '';

	// 錯誤訊息
	let errorMessage = '';

	// 功能支援
	let supportsSystemAudio = false;
	let supportsMicrophone = false;

	const analyzer = getVideoChordAnalyzer();

	// Chromagram 模板
	const CHORD_TEMPLATES: Record<string, number[]> = {
		C: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
		D: [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
		E: [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
		F: [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
		G: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1],
		A: [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
		Am: [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
		Dm: [1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0],
		Em: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
		G7: [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1],
		C7: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
		D7: [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0]
	};

	onMount(() => {
		supportsSystemAudio = isSystemAudioSupported();
		supportsMicrophone = isMicrophoneSupported();

		return () => {
			analyzer.dispose();
			stopLiveAnalysis();
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl);
			}
		};
	});

	// 開始即時分析
	async function startLiveAnalysis() {
		errorMessage = '';

		try {
			if (liveSource === 'system') {
				audioCapture = await captureSystemAudio();
			} else {
				audioCapture = await captureMicrophone();
			}

			mode = 'live';
			isRecording = true;
			recordedChunks = [];
			recordingStartTime = Date.now();

			// 開始分析循環
			analyzeLoop();
		} catch (error) {
			console.error('音頻捕獲錯誤:', error);
			errorMessage = (error as Error).message;
			mode = 'live-setup';
		}
	}

	// 分析循環
	function analyzeLoop() {
		if (!audioCapture || !isRecording) return;

		const { analyser, audioContext } = audioCapture;
		const bufferLength = analyser.frequencyBinCount;
		const dataArray = new Float32Array(bufferLength);

		analyser.getFloatFrequencyData(dataArray);

		// 計算 Chromagram
		const chromagram = computeChromagram(dataArray, audioContext.sampleRate);

		// 識別和弦
		const detection = detectChord(chromagram);
		liveCurrentChord = detection.chord;
		liveConfidence = detection.confidence;

		// 更新錄製時長
		recordingDuration = (Date.now() - recordingStartTime) / 1000;

		// 記錄和弦變化
		const lastChunk = recordedChunks[recordedChunks.length - 1];
		if (!lastChunk || lastChunk.chord !== detection.chord) {
			if (lastChunk) {
				lastChunk.endTime = recordingDuration;
			}
			if (detection.chord !== '未知' && detection.confidence > 0.3) {
				recordedChunks.push({
					chord: detection.chord,
					startTime: recordingDuration,
					endTime: recordingDuration,
					confidence: detection.confidence
				});
			}
		}

		animationFrameId = requestAnimationFrame(analyzeLoop);
	}

	// 計算 Chromagram
	function computeChromagram(frequencyData: Float32Array, sampleRate: number): number[] {
		const chromagram = new Array(12).fill(0);
		const binSize = sampleRate / (frequencyData.length * 2);

		for (let i = 0; i < frequencyData.length; i++) {
			const frequency = i * binSize;
			if (frequency < 80 || frequency > 1200) continue;

			const magnitude = Math.pow(10, frequencyData[i] / 20);
			if (magnitude < 0.001) continue;

			const noteNumber = 12 * Math.log2(frequency / 440) + 69;
			const chromaIndex = Math.round(noteNumber) % 12;

			if (chromaIndex >= 0 && chromaIndex < 12) {
				chromagram[chromaIndex] += magnitude;
			}
		}

		const maxEnergy = Math.max(...chromagram, 0.001);
		return chromagram.map((e) => e / maxEnergy);
	}

	// 識別和弦
	function detectChord(chromagram: number[]): { chord: string; confidence: number } {
		let bestChord = '未知';
		let bestScore = -Infinity;

		for (const [chordName, template] of Object.entries(CHORD_TEMPLATES)) {
			let dotProduct = 0;
			let normA = 0;
			let normB = 0;

			for (let i = 0; i < 12; i++) {
				dotProduct += chromagram[i] * template[i];
				normA += chromagram[i] * chromagram[i];
				normB += template[i] * template[i];
			}

			const denominator = Math.sqrt(normA) * Math.sqrt(normB);
			const score = denominator > 0 ? dotProduct / denominator : 0;

			if (score > bestScore) {
				bestScore = score;
				bestChord = chordName;
			}
		}

		const confidence = Math.max(0, Math.min(1, (bestScore + 1) / 2));
		return {
			chord: bestScore > 0.3 ? bestChord : '未知',
			confidence: bestScore > 0.3 ? confidence : 0
		};
	}

	// 停止即時分析
	function stopLiveAnalysis() {
		isRecording = false;

		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}

		if (audioCapture) {
			stopCapture(audioCapture);
			audioCapture = null;
		}

		// 完成最後一個和弦段落
		const lastChunk = recordedChunks[recordedChunks.length - 1];
		if (lastChunk) {
			lastChunk.endTime = recordingDuration;
		}

		// 合併相鄰相同和弦
		segments = mergeSegments(recordedChunks);
		duration = recordingDuration;
		mode = 'done';
	}

	// 合併相鄰相同和弦
	function mergeSegments(chunks: ChordSegment[]): ChordSegment[] {
		if (chunks.length === 0) return [];

		const merged: ChordSegment[] = [];
		let current = { ...chunks[0] };

		for (let i = 1; i < chunks.length; i++) {
			if (chunks[i].chord === current.chord) {
				current.endTime = chunks[i].endTime;
			} else {
				if (current.endTime - current.startTime >= 0.3) {
					merged.push(current);
				}
				current = { ...chunks[i] };
			}
		}

		if (current.endTime - current.startTime >= 0.3) {
			merged.push(current);
		}

		return merged;
	}

	// 處理文件選擇
	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			selectedFile = input.files[0];
			mode = 'file';
			errorMessage = '';
		}
	}

	// 開始分析文件
	async function analyzeFile() {
		if (!selectedFile) return;

		mode = 'analyzing';
		segments = [];
		progress = 0;

		try {
			const result = await analyzer.analyzeFile(selectedFile, (p: AnalysisProgress) => {
				progress = p.percentage;
				currentChord = p.currentChord;
				currentTime = p.currentTime;
				duration = p.duration;
			});

			segments = result.segments;
			duration = result.duration;
			mode = 'done';

			// 創建音頻元素用於播放
			audioUrl = URL.createObjectURL(selectedFile);
			if (audioElement) {
				audioElement.src = audioUrl;
			}
		} catch (error) {
			console.error('分析錯誤:', error);
			errorMessage = '分析失敗: ' + (error as Error).message;
			mode = 'file';
		}
	}

	// 跳轉到指定時間
	function seekTo(time: number) {
		if (audioElement) {
			audioElement.currentTime = time;
		}
		currentTime = time;
	}

	// 更新播放位置
	function updateTime() {
		if (audioElement) {
			currentTime = audioElement.currentTime;
		}
	}

	// 導出和弦譜
	function exportChords() {
		const source = selectedFile?.name || (liveSource === 'system' ? '系統音頻' : '麥克風');
		let text = `# 和弦分析結果\n\n`;
		text += `**來源**: ${source}\n`;
		text += `**長度**: ${formatTime(duration)}\n\n`;
		text += '| 時間 | 和弦 | 長度 |\n';
		text += '|------|------|------|\n';

		for (const segment of segments) {
			text += `| ${formatTime(segment.startTime)} | ${segment.chord} | ${(segment.endTime - segment.startTime).toFixed(1)}s |\n`;
		}

		const blob = new Blob([text], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'chord-analysis.md';
		a.click();
		URL.revokeObjectURL(url);
	}

	// 重置
	function reset() {
		stopLiveAnalysis();
		mode = 'idle';
		segments = [];
		selectedFile = null;
		errorMessage = '';
		recordedChunks = [];
		liveCurrentChord = '';
		recordingDuration = 0;
		if (audioUrl) {
			URL.revokeObjectURL(audioUrl);
			audioUrl = null;
		}
	}
</script>

<svelte:head>
	<title>音頻和弦分析 - 吉他和弦自學神器</title>
</svelte:head>

<div class="min-h-screen p-4 md:p-8">
	<!-- 標題 -->
	<header class="text-center mb-8">
		<h1 class="text-3xl md:text-4xl font-bold mb-2">🎵 音頻和弦分析</h1>
		<p class="text-gray-400">上傳音樂檔案或即時捕獲電腦音頻，自動分析和弦進行</p>
		<a href="/" class="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block">
			← 返回即時模式
		</a>
	</header>

	<div class="max-w-4xl mx-auto">
		{#if mode === 'idle'}
			<!-- 選擇輸入方式 -->
			<div class="grid md:grid-cols-2 gap-6">
				<!-- 即時音頻捕獲 -->
				<div class="chord-card">
					<h2 class="text-xl font-semibold mb-4 flex items-center gap-2">
						<span class="text-purple-500">🔊</span> 即時音頻分析
					</h2>
					<p class="text-gray-400 text-sm mb-4">
						捕獲電腦播放的音樂或麥克風輸入，即時分析和弦
					</p>

					<div class="space-y-3 mb-4">
						<label class="flex items-center gap-3 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
							<input
								type="radio"
								bind:group={liveSource}
								value="system"
								class="w-4 h-4 text-purple-500"
								disabled={!supportsSystemAudio}
							/>
							<div class="flex-1">
								<div class="font-medium">系統音頻</div>
								<div class="text-xs text-gray-500">
									捕獲電腦播放的任何聲音（YouTube、Spotify 等）
								</div>
							</div>
							{#if !supportsSystemAudio}
								<span class="text-xs text-red-400">不支援</span>
							{/if}
						</label>

						<label class="flex items-center gap-3 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
							<input
								type="radio"
								bind:group={liveSource}
								value="microphone"
								class="w-4 h-4 text-purple-500"
								disabled={!supportsMicrophone}
							/>
							<div class="flex-1">
								<div class="font-medium">麥克風</div>
								<div class="text-xs text-gray-500">使用麥克風收音分析</div>
							</div>
							{#if !supportsMicrophone}
								<span class="text-xs text-red-400">不支援</span>
							{/if}
						</label>
					</div>

					<button
						onclick={() => (mode = 'live-setup')}
						disabled={!supportsSystemAudio && !supportsMicrophone}
						class="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
					>
						🎧 開始即時分析
					</button>
				</div>

				<!-- 文件上傳 -->
				<div class="chord-card">
					<h2 class="text-xl font-semibold mb-4 flex items-center gap-2">
						<span class="text-green-500">🎵</span> 本地檔案
					</h2>
					<p class="text-gray-400 text-sm mb-4">上傳 MP3、WAV、M4A 或 MP4 檔案進行分析</p>
					<label class="block">
						<div
							class="w-full py-8 border-2 border-dashed border-white/20 rounded-lg text-center cursor-pointer hover:border-blue-500 transition-colors"
						>
							<div class="text-4xl mb-2">📁</div>
							<div class="text-gray-400">點擊選擇檔案</div>
							<div class="text-gray-500 text-xs mt-1">支援 MP3, WAV, M4A, MP4</div>
						</div>
						<input
							type="file"
							accept="audio/*,video/*"
							onchange={handleFileSelect}
							class="hidden"
						/>
					</label>
				</div>
			</div>

			{#if errorMessage}
				<div class="mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300">
					{errorMessage}
				</div>
			{/if}
		{:else if mode === 'live-setup'}
			<!-- 即時分析設置 -->
			<div class="chord-card text-center py-8">
				<div class="text-6xl mb-4">
					{liveSource === 'system' ? '🔊' : '🎤'}
				</div>
				<h2 class="text-xl font-semibold mb-2">
					{liveSource === 'system' ? '系統音頻捕獲' : '麥克風收音'}
				</h2>
				<p class="text-gray-400 mb-6 max-w-md mx-auto">
					{#if liveSource === 'system'}
						點擊開始後，請選擇要分享的視窗或螢幕，<br />
						<strong class="text-yellow-400">並勾選「分享音訊」選項</strong>
					{:else}
						點擊開始後，請允許麥克風權限
					{/if}
				</p>

				{#if errorMessage}
					<div class="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
						{errorMessage}
					</div>
				{/if}

				<div class="flex gap-4 justify-center">
					<button
						onclick={startLiveAnalysis}
						class="px-8 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors"
					>
						▶ 開始捕獲
					</button>
					<button
						onclick={reset}
						class="px-6 py-3 bg-gray-600 hover:bg-gray-500 rounded-lg font-medium transition-colors"
					>
						取消
					</button>
				</div>
			</div>
		{:else if mode === 'live'}
			<!-- 即時分析中 -->
			<div class="chord-card">
				<div class="flex items-center justify-between mb-6">
					<div class="flex items-center gap-3">
						<div class="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
						<span class="text-lg font-medium">即時分析中</span>
						<span class="text-gray-400">{formatTime(recordingDuration)}</span>
					</div>
					<button
						onclick={stopLiveAnalysis}
						class="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-medium transition-colors"
					>
						⏹ 停止
					</button>
				</div>

				<!-- 當前和弦顯示 -->
				<div class="text-center py-12 bg-white/5 rounded-xl mb-6">
					<div class="text-6xl font-bold mb-2 text-blue-400">
						{liveCurrentChord || '--'}
					</div>
					<div class="text-gray-400">
						{#if liveConfidence > 0}
							信心度: {(liveConfidence * 100).toFixed(0)}%
						{:else}
							等待音頻...
						{/if}
					</div>
				</div>

				<!-- 已識別的和弦 -->
				{#if recordedChunks.length > 0}
					<div class="space-y-2">
						<h3 class="text-sm font-medium text-gray-400">已識別和弦</h3>
						<div class="flex flex-wrap gap-2">
							{#each recordedChunks.slice(-10) as chunk}
								<span class="px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full text-sm">
									{chunk.chord}
								</span>
							{/each}
						</div>
					</div>
				{/if}

				<p class="mt-6 text-center text-gray-500 text-sm">
					{liveSource === 'system' ? '正在分析電腦播放的音頻' : '正在分析麥克風輸入'}
					，播放音樂即可看到和弦變化
				</p>
			</div>
		{:else if mode === 'file'}
			<!-- 文件預覽 -->
			<div class="chord-card">
				<div class="flex items-center gap-4 mb-6">
					<div class="text-4xl">🎵</div>
					<div>
						<div class="font-medium">{selectedFile?.name}</div>
						<div class="text-gray-400 text-sm">
							{selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(2) : 0} MB
						</div>
					</div>
				</div>

				<button
					onclick={analyzeFile}
					class="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors"
				>
					🔍 開始分析和弦
				</button>

				<button onclick={reset} class="mt-4 text-gray-400 hover:text-white transition-colors">
					← 返回選擇
				</button>
			</div>
		{:else if mode === 'analyzing'}
			<!-- 分析中 -->
			<div class="chord-card text-center py-12">
				<div class="text-6xl mb-4 animate-pulse">🎸</div>
				<h2 class="text-xl font-semibold mb-2">正在分析和弦...</h2>
				<p class="text-gray-400 mb-6">
					當前和弦: <span class="text-white font-bold">{currentChord || '--'}</span>
				</p>

				<!-- 進度條 -->
				<div class="w-full h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
					<div
						class="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
						style="width: {progress}%"
					></div>
				</div>
				<div class="text-sm text-gray-400">
					{progress.toFixed(1)}% ({formatTime(currentTime)} / {formatTime(duration)})
				</div>
			</div>
		{:else if mode === 'done'}
			<!-- 分析結果 -->
			<div class="space-y-6">
				<!-- 音頻播放器（僅文件模式） -->
				{#if audioUrl}
					<div class="chord-card">
						<audio bind:this={audioElement} controls ontimeupdate={updateTime} class="w-full">
							<track kind="captions" />
						</audio>
					</div>
				{/if}

				<!-- 時間軸 -->
				<ChordTimeline {segments} {duration} {currentTime} onSeek={seekTo} />

				<!-- 操作按鈕 -->
				<div class="flex gap-4">
					<button
						onclick={exportChords}
						class="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
					>
						📥 導出和弦譜
					</button>
					<button
						onclick={reset}
						class="flex-1 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg font-medium transition-colors"
					>
						🔄 分析其他音頻
					</button>
				</div>

				<!-- 統計 -->
				<div class="chord-card">
					<h3 class="font-semibold mb-3">📊 分析統計</h3>
					<div class="grid grid-cols-3 gap-4 text-center">
						<div>
							<div class="text-2xl font-bold text-blue-400">{segments.length}</div>
							<div class="text-gray-400 text-sm">和弦段落</div>
						</div>
						<div>
							<div class="text-2xl font-bold text-green-400">
								{new Set(segments.map((s) => s.chord)).size}
							</div>
							<div class="text-gray-400 text-sm">不同和弦</div>
						</div>
						<div>
							<div class="text-2xl font-bold text-purple-400">
								{formatTime(duration)}
							</div>
							<div class="text-gray-400 text-sm">總長度</div>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- 頁尾 -->
	<footer class="text-center mt-12 text-gray-500 text-sm">
		<p>使用 Chromagram 算法分析音頻和弦</p>
	</footer>
</div>

<style>
	:global(.chord-card) {
		background: rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(10px);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 1rem;
		padding: 1.5rem;
	}
</style>
