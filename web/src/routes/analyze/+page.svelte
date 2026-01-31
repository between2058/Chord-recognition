<script lang="ts">
	import { onMount } from 'svelte';
	import ChordTimeline from '$lib/components/ChordTimeline.svelte';
	import {
		getVideoChordAnalyzer,
		extractYouTubeId,
		formatTime,
		type ChordSegment,
		type AnalysisProgress
	} from '$lib/ml/videoAnalyzer';
	import '../../app.css';

	// 狀態
	let mode: 'idle' | 'youtube' | 'file' | 'analyzing' | 'done' = 'idle';
	let youtubeUrl = '';
	let youtubeId = '';
	let selectedFile: File | null = null;
	let audioElement: HTMLAudioElement | null = null;
	let youtubePlayer: YT.Player | null = null;

	// 分析結果
	let segments: ChordSegment[] = [];
	let duration = 0;
	let currentTime = 0;
	let progress = 0;
	let currentChord = '';

	// 錯誤訊息
	let errorMessage = '';

	const analyzer = getVideoChordAnalyzer();

	onMount(() => {
		// 載入 YouTube IFrame API
		if (!window.YT) {
			const tag = document.createElement('script');
			tag.src = 'https://www.youtube.com/iframe_api';
			const firstScriptTag = document.getElementsByTagName('script')[0];
			firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
		}

		return () => {
			analyzer.dispose();
		};
	});

	// 處理 YouTube URL 輸入
	function handleYouTubeSubmit() {
		errorMessage = '';
		const id = extractYouTubeId(youtubeUrl);

		if (!id) {
			errorMessage = '無效的 YouTube 連結';
			return;
		}

		youtubeId = id;
		mode = 'youtube';

		// 初始化 YouTube 播放器
		setTimeout(() => {
			initYouTubePlayer();
		}, 100);
	}

	// 初始化 YouTube 播放器
	function initYouTubePlayer() {
		if (!window.YT || !window.YT.Player) {
			// API 尚未載入，等待
			window.onYouTubeIframeAPIReady = () => {
				createPlayer();
			};
		} else {
			createPlayer();
		}
	}

	function createPlayer() {
		youtubePlayer = new window.YT.Player('youtube-player', {
			height: '360',
			width: '640',
			videoId: youtubeId,
			playerVars: {
				autoplay: 0,
				controls: 1,
				modestbranding: 1
			},
			events: {
				onReady: onPlayerReady,
				onStateChange: onPlayerStateChange
			}
		});
	}

	function onPlayerReady(event: YT.PlayerEvent) {
		duration = event.target.getDuration();
		// 開始追蹤播放位置
		setInterval(() => {
			if (youtubePlayer && mode === 'youtube') {
				currentTime = youtubePlayer.getCurrentTime() || 0;
			}
		}, 100);
	}

	function onPlayerStateChange(event: YT.OnStateChangeEvent) {
		// 可以在這裡處理播放狀態變化
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
			const url = URL.createObjectURL(selectedFile);
			if (audioElement) {
				audioElement.src = url;
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
		if (youtubePlayer) {
			youtubePlayer.seekTo(time, true);
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
		let text = '# 和弦分析結果\n\n';
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
</script>

<svelte:head>
	<title>影片和弦分析 - 吉他和弦自學神器</title>
</svelte:head>

<div class="min-h-screen p-4 md:p-8">
	<!-- 標題 -->
	<header class="text-center mb-8">
		<h1 class="text-3xl md:text-4xl font-bold mb-2">
			🎬 影片和弦分析
		</h1>
		<p class="text-gray-400">
			上傳音樂檔案或貼上 YouTube 連結，自動分析和弦進行
		</p>
		<a href="/" class="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block">
			← 返回即時模式
		</a>
	</header>

	<div class="max-w-4xl mx-auto">
		{#if mode === 'idle'}
			<!-- 選擇輸入方式 -->
			<div class="grid md:grid-cols-2 gap-6">
				<!-- YouTube 輸入 -->
				<div class="chord-card">
					<h2 class="text-xl font-semibold mb-4 flex items-center gap-2">
						<span class="text-red-500">▶</span> YouTube 影片
					</h2>
					<p class="text-gray-400 text-sm mb-4">
						貼上 YouTube 連結，即時同步顯示和弦
					</p>
					<input
						type="text"
						bind:value={youtubeUrl}
						placeholder="https://www.youtube.com/watch?v=..."
						class="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
					/>
					<button
						onclick={handleYouTubeSubmit}
						class="mt-4 w-full py-2 bg-red-600 hover:bg-red-500 rounded-lg font-medium transition-colors"
					>
						載入影片
					</button>
				</div>

				<!-- 文件上傳 -->
				<div class="chord-card">
					<h2 class="text-xl font-semibold mb-4 flex items-center gap-2">
						<span class="text-green-500">🎵</span> 本地檔案
					</h2>
					<p class="text-gray-400 text-sm mb-4">
						上傳 MP3、WAV、M4A 或 MP4 檔案進行分析
					</p>
					<label class="block">
						<div class="w-full py-8 border-2 border-dashed border-white/20 rounded-lg text-center cursor-pointer hover:border-blue-500 transition-colors">
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

		{:else if mode === 'youtube'}
			<!-- YouTube 播放器 -->
			<div class="space-y-6">
				<div class="chord-card">
					<div class="aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
						<div id="youtube-player"></div>
					</div>
				</div>

				{#if segments.length > 0}
					<ChordTimeline
						{segments}
						{duration}
						{currentTime}
						onSeek={seekTo}
					/>
				{:else}
					<div class="chord-card text-center py-8">
						<p class="text-gray-400">
							播放影片時將自動分析和弦...
						</p>
						<p class="text-gray-500 text-sm mt-2">
							提示：由於瀏覽器限制，YouTube 影片無法直接提取音頻進行離線分析。
							<br/>建議下載音頻後使用本地檔案分析功能。
						</p>
					</div>
				{/if}

				<button
					onclick={() => { mode = 'idle'; youtubeId = ''; }}
					class="text-gray-400 hover:text-white transition-colors"
				>
					← 返回選擇
				</button>
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

				<button
					onclick={() => { mode = 'idle'; selectedFile = null; }}
					class="mt-4 text-gray-400 hover:text-white transition-colors"
				>
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
				<!-- 音頻播放器 -->
				<div class="chord-card">
					<audio
						bind:this={audioElement}
						controls
						ontimeupdate={updateTime}
						class="w-full"
					>
						<track kind="captions" />
					</audio>
				</div>

				<!-- 時間軸 -->
				<ChordTimeline
					{segments}
					{duration}
					{currentTime}
					onSeek={seekTo}
				/>

				<!-- 操作按鈕 -->
				<div class="flex gap-4">
					<button
						onclick={exportChords}
						class="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
					>
						📥 導出和弦譜
					</button>
					<button
						onclick={() => { mode = 'idle'; segments = []; selectedFile = null; }}
						class="flex-1 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg font-medium transition-colors"
					>
						🔄 分析其他檔案
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
								{new Set(segments.map(s => s.chord)).size}
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
