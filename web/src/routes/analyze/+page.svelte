<script lang="ts">
	import { onMount } from 'svelte';
	import ChordTimeline from '$lib/components/ChordTimeline.svelte';
	import { getHandTracker } from '$lib/ml/handTracker';
	import { getChordClassifier } from '$lib/ml/chordClassifier';
	import {
		getVideoChordAnalyzer,
		formatTime,
		type ChordSegment
	} from '$lib/ml/videoAnalyzer';
	import {
		isSystemAudioSupported,
		type AudioCaptureResult
	} from '$lib/ml/systemAudioCapture';
	import '../../app.css';

	// 狀態
	type Mode = 'idle' | 'youtube' | 'file' | 'ready' | 'analyzing' | 'done';
	type InputSource = 'youtube' | 'file';

	let mode: Mode = 'idle';
	let inputSource: InputSource = 'youtube';

	// YouTube
	let youtubeUrl = '';
	let youtubeId: string | null = null;

	// 本地檔案
	let selectedFile: File | null = null;
	let videoUrl: string | null = null;

	// 影片元素
	let videoElement: HTMLVideoElement | null = null;
	let canvasElement: HTMLCanvasElement | null = null;
	let capturedVideoElement: HTMLVideoElement | null = null;

	// 螢幕捕獲
	let screenStream: MediaStream | null = null;
	let audioCapture: AudioCaptureResult | null = null;

	// 分析狀態
	let isAnalyzing = false;
	let animationFrameId: number | null = null;

	// 即時結果
	let currentChord = '';
	let visionChord = '';
	let audioChord = '';
	let confidence = 0;
	let handDetected = false;

	// 錄製的和弦
	let recordedSegments: ChordSegment[] = [];
	let analysisStartTime = 0;
	let currentTime = 0;

	// 最終結果
	let segments: ChordSegment[] = [];
	let duration = 0;

	// 錯誤訊息
	let errorMessage = '';

	// 功能支援
	let supportsScreenCapture = false;
	let isSafari = false;
	let useMicForAudio = false; // Safari 需要用麥克風收音

	// ML 模組
	const handTracker = getHandTracker();
	const chordClassifier = getChordClassifier();
	const videoAnalyzer = getVideoChordAnalyzer();

	onMount(() => {
		supportsScreenCapture = isSystemAudioSupported();
		// 檢測 Safari
		isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

		return () => {
			cleanup();
		};
	});

	function cleanup() {
		stopAnalysis();
		if (videoUrl) {
			URL.revokeObjectURL(videoUrl);
			videoUrl = null;
		}
	}

	// 提取 YouTube ID
	function extractYouTubeId(url: string): string | null {
		const patterns = [
			/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
			/youtube\.com\/shorts\/([^&\n?#]+)/
		];

		for (const pattern of patterns) {
			const match = url.match(pattern);
			if (match) return match[1];
		}
		return null;
	}

	// 處理 YouTube URL 輸入
	function handleYouTubeSubmit() {
		errorMessage = '';
		const id = extractYouTubeId(youtubeUrl);

		if (!id) {
			errorMessage = '無效的 YouTube 連結';
			return;
		}

		youtubeId = id;
		inputSource = 'youtube';
		mode = 'youtube';
	}

	// 處理文件選擇
	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			selectedFile = input.files[0];
			inputSource = 'file';
			mode = 'file';
			errorMessage = '';
			videoUrl = URL.createObjectURL(selectedFile);
		}
	}

	// 開始分析（YouTube 模式 - 需要螢幕捕獲）
	async function startYouTubeAnalysis() {
		errorMessage = '';

		try {
			// Safari 不支援螢幕分享音頻，需要用麥克風
			if (isSafari) {
				await startYouTubeAnalysisSafari();
				return;
			}

			// Chrome/Edge: 請求螢幕分享（讓用戶選擇 YouTube 視窗）
			screenStream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false
				}
			});

			// 檢查音頻軌道
			const audioTracks = screenStream.getAudioTracks();
			if (audioTracks.length === 0) {
				errorMessage = '請勾選「分享標籤頁音訊」選項，才能分析音頻和弦。';
				screenStream.getTracks().forEach((t) => t.stop());
				screenStream = null;
				return;
			}

			// 設置捕獲的影片元素
			if (capturedVideoElement) {
				capturedVideoElement.srcObject = screenStream;
				await capturedVideoElement.play();
			}

			// 設置音頻分析
			const audioStream = new MediaStream(audioTracks);
			const audioContext = new AudioContext({ sampleRate: 44100 });
			const source = audioContext.createMediaStreamSource(audioStream);
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 4096;
			source.connect(analyser);

			audioCapture = {
				stream: audioStream,
				audioContext,
				analyser,
				source
			};

			// 監聽螢幕分享結束
			screenStream.getVideoTracks()[0].onended = () => {
				stopAnalysis();
			};

			// 開始分析
			await startAnalysis();
		} catch (error) {
			console.error('螢幕捕獲錯誤:', error);
			errorMessage = (error as Error).message;
		}
	}

	// Safari 專用：螢幕捕獲畫面 + 麥克風收音
	async function startYouTubeAnalysisSafari() {
		try {
			// 1. 請求螢幕分享（只有畫面）
			screenStream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: false // Safari 不支援
			});

			// 設置捕獲的影片元素
			if (capturedVideoElement) {
				capturedVideoElement.srcObject = screenStream;
				await capturedVideoElement.play();
			}

			// 2. 請求麥克風權限來收錄電腦播放的聲音
			const micStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false
				}
			});

			// 設置音頻分析
			const audioContext = new AudioContext({ sampleRate: 44100 });
			const source = audioContext.createMediaStreamSource(micStream);
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 4096;
			source.connect(analyser);

			audioCapture = {
				stream: micStream,
				audioContext,
				analyser,
				source
			};

			useMicForAudio = true;

			// 監聽螢幕分享結束
			screenStream.getVideoTracks()[0].onended = () => {
				stopAnalysis();
			};

			// 開始分析
			await startAnalysis();
		} catch (error) {
			console.error('Safari 分析錯誤:', error);
			errorMessage = (error as Error).message;
		}
	}

	// 開始分析本地影片
	async function startFileAnalysis() {
		if (!videoElement || !videoUrl) return;

		try {
			// 創建影片的音頻源
			const audioContext = new AudioContext({ sampleRate: 44100 });
			const source = audioContext.createMediaElementSource(videoElement);
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 4096;

			// 連接到揚聲器
			const gainNode = audioContext.createGain();
			source.connect(analyser);
			source.connect(gainNode);
			gainNode.connect(audioContext.destination);

			audioCapture = {
				stream: new MediaStream(),
				audioContext,
				analyser,
				source
			};

			capturedVideoElement = videoElement;
			videoElement.play();
			await startAnalysis();
		} catch (error) {
			console.error('分析錯誤:', error);
			errorMessage = (error as Error).message;
		}
	}

	// 開始分析循環
	async function startAnalysis() {
		// 初始化 ML 模組
		await Promise.all([handTracker.initialize(), chordClassifier.initialize()]);

		mode = 'analyzing';
		isAnalyzing = true;
		recordedSegments = [];
		analysisStartTime = Date.now();
		currentTime = 0;

		analyzeFrame();
	}

	// 分析單幀
	async function analyzeFrame() {
		if (!isAnalyzing || !capturedVideoElement || !canvasElement) return;

		const ctx = canvasElement.getContext('2d');
		if (!ctx) return;

		// 更新時間
		if (inputSource === 'file' && capturedVideoElement.currentTime) {
			currentTime = capturedVideoElement.currentTime;
		} else {
			currentTime = (Date.now() - analysisStartTime) / 1000;
		}

		// 確保影片有有效尺寸
		const videoWidth = capturedVideoElement.videoWidth || 640;
		const videoHeight = capturedVideoElement.videoHeight || 480;

		if (videoWidth > 0 && videoHeight > 0) {
			// 繪製影片幀到 canvas
			canvasElement.width = videoWidth;
			canvasElement.height = videoHeight;
			ctx.drawImage(capturedVideoElement, 0, 0);

			// 視覺分析：MediaPipe 手部追蹤
			let visionResult = { chord: '', confidence: 0 };
			try {
				const imageData = ctx.getImageData(0, 0, canvasElement.width, canvasElement.height);
				const landmarks = await handTracker.detectHands(imageData);

				if (landmarks && landmarks.length > 0) {
					handDetected = true;
					visionResult = await chordClassifier.classifyChord(landmarks);
					visionChord = visionResult.chord;
				} else {
					handDetected = false;
					visionChord = '';
				}
			} catch (e) {
				// 忽略視覺分析錯誤
			}

			// 音頻分析
			let audioResult = { chord: '', confidence: 0 };
			if (audioCapture?.analyser) {
				try {
					audioResult = analyzeAudioFrame(
						audioCapture.analyser,
						audioCapture.audioContext.sampleRate
					);
					audioChord = audioResult.chord;
				} catch (e) {
					// 忽略音頻分析錯誤
				}
			}

			// 融合結果（視覺優先）
			if (handDetected && visionResult.confidence > 0.5) {
				currentChord = visionResult.chord;
				confidence = visionResult.confidence;
			} else if (audioResult.confidence > 0.3) {
				currentChord = audioResult.chord;
				confidence = audioResult.confidence;
			} else {
				currentChord = '';
				confidence = 0;
			}

			// 記錄和弦變化
			if (currentChord) {
				const lastSegment = recordedSegments[recordedSegments.length - 1];
				if (!lastSegment || lastSegment.chord !== currentChord) {
					if (lastSegment) {
						lastSegment.endTime = currentTime;
					}
					recordedSegments.push({
						chord: currentChord,
						startTime: currentTime,
						endTime: currentTime,
						confidence
					});
				}
			}
		}

		// 檢查影片是否結束（本地檔案模式）
		if (inputSource === 'file' && capturedVideoElement.ended) {
			stopAnalysis();
			return;
		}

		animationFrameId = requestAnimationFrame(analyzeFrame);
	}

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

	// 分析音頻幀
	function analyzeAudioFrame(
		analyser: AnalyserNode,
		sampleRate: number
	): { chord: string; confidence: number } {
		const bufferLength = analyser.frequencyBinCount;
		const dataArray = new Float32Array(bufferLength);
		analyser.getFloatFrequencyData(dataArray);

		const chromagram = new Array(12).fill(0);
		const binSize = sampleRate / (bufferLength * 2);

		for (let i = 0; i < bufferLength; i++) {
			const frequency = i * binSize;
			if (frequency < 80 || frequency > 1200) continue;

			const magnitude = Math.pow(10, dataArray[i] / 20);
			if (magnitude < 0.001) continue;

			const noteNumber = 12 * Math.log2(frequency / 440) + 69;
			const chromaIndex = Math.round(noteNumber) % 12;

			if (chromaIndex >= 0 && chromaIndex < 12) {
				chromagram[chromaIndex] += magnitude;
			}
		}

		const maxEnergy = Math.max(...chromagram, 0.001);
		const normalizedChromagram = chromagram.map((e) => e / maxEnergy);

		let bestChord = '';
		let bestScore = -Infinity;

		for (const [chordName, template] of Object.entries(CHORD_TEMPLATES)) {
			let dotProduct = 0;
			let normA = 0;
			let normB = 0;

			for (let i = 0; i < 12; i++) {
				dotProduct += normalizedChromagram[i] * template[i];
				normA += normalizedChromagram[i] * normalizedChromagram[i];
				normB += template[i] * template[i];
			}

			const denominator = Math.sqrt(normA) * Math.sqrt(normB);
			const score = denominator > 0 ? dotProduct / denominator : 0;

			if (score > bestScore) {
				bestScore = score;
				bestChord = chordName;
			}
		}

		const conf = Math.max(0, Math.min(1, (bestScore + 1) / 2));
		return {
			chord: bestScore > 0.3 ? bestChord : '',
			confidence: bestScore > 0.3 ? conf : 0
		};
	}

	// 停止分析
	function stopAnalysis() {
		isAnalyzing = false;

		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}

		if (screenStream) {
			screenStream.getTracks().forEach((t) => t.stop());
			screenStream = null;
		}

		if (audioCapture) {
			audioCapture.audioContext.close();
			audioCapture = null;
		}

		if (capturedVideoElement && inputSource === 'youtube') {
			capturedVideoElement.srcObject = null;
		}

		const lastSegment = recordedSegments[recordedSegments.length - 1];
		if (lastSegment) {
			lastSegment.endTime = currentTime;
		}

		segments = mergeSegments(recordedSegments);
		duration = currentTime;
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

	// 導出和弦譜
	function exportChords() {
		const source = selectedFile?.name || `YouTube: ${youtubeId}`;
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
		cleanup();
		mode = 'idle';
		segments = [];
		recordedSegments = [];
		selectedFile = null;
		youtubeUrl = '';
		youtubeId = null;
		errorMessage = '';
		currentChord = '';
		visionChord = '';
		audioChord = '';
	}
</script>

<svelte:head>
	<title>影片和弦分析 - 吉他和弦自學神器</title>
</svelte:head>

<div class="min-h-screen p-4 md:p-8">
	<!-- 標題 -->
	<header class="text-center mb-8">
		<h1 class="text-3xl md:text-4xl font-bold mb-2">🎬 影片和弦分析</h1>
		<p class="text-gray-400">貼上 YouTube 連結或上傳影片，分析吉他和弦</p>
		<a href="/" class="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block">
			← 返回即時模式
		</a>
	</header>

	<div class="max-w-5xl mx-auto">
		{#if mode === 'idle'}
			<!-- 選擇輸入方式 -->
			<div class="grid md:grid-cols-2 gap-6">
				<!-- YouTube 連結 -->
				<div class="chord-card">
					<h2 class="text-xl font-semibold mb-4 flex items-center gap-2">
						<span class="text-red-500">▶</span> YouTube 影片
					</h2>
					<p class="text-gray-400 text-sm mb-4">貼上 YouTube 影片連結，分析其中的吉他和弦</p>

					<input
						type="text"
						bind:value={youtubeUrl}
						placeholder="https://www.youtube.com/watch?v=..."
						class="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
					/>

					<button
						onclick={handleYouTubeSubmit}
						disabled={!youtubeUrl}
						class="mt-4 w-full py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
					>
						載入影片
					</button>
				</div>

				<!-- 本地影片 -->
				<div class="chord-card">
					<h2 class="text-xl font-semibold mb-4 flex items-center gap-2">
						<span class="text-green-500">🎵</span> 本地影片
					</h2>
					<p class="text-gray-400 text-sm mb-4">上傳本地影片檔案，分析其中的吉他和弦</p>
					<label class="block">
						<div class="w-full py-8 border-2 border-dashed border-white/20 rounded-lg text-center cursor-pointer hover:border-green-500 transition-colors">
							<div class="text-4xl mb-2">📁</div>
							<div class="text-gray-400">點擊選擇影片</div>
							<div class="text-gray-500 text-xs mt-1">支援 MP4, WebM, MOV</div>
						</div>
						<input
							type="file"
							accept="video/*"
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
			<!-- YouTube 影片 - 在新視窗打開 -->
			<div class="chord-card">
				<!-- 縮圖預覽 -->
				<div class="aspect-video mb-4 rounded-lg overflow-hidden bg-black relative">
					<img
						src="https://img.youtube.com/vi/{youtubeId}/maxresdefault.jpg"
						alt="YouTube 縮圖"
						class="w-full h-full object-cover"
						onerror={(e) => {
							(e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
						}}
					/>
					<a
						href="https://www.youtube.com/watch?v={youtubeId}"
						target="_blank"
						rel="noopener noreferrer"
						class="absolute inset-0 flex items-center justify-center bg-black/50 hover:bg-black/30 transition-colors"
					>
						<div class="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center">
							<span class="text-4xl ml-1">▶</span>
						</div>
					</a>
				</div>

				<div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
					<h3 class="font-medium text-blue-400 mb-2">📋 分析步驟</h3>
					<ol class="text-gray-300 text-sm space-y-2 list-decimal list-inside">
						<li>
							<strong class="text-yellow-400">先點擊上方縮圖</strong>，在新視窗打開 YouTube
						</li>
						<li>回到此頁面，點擊下方「開始分析」</li>
						<li>在彈出視窗中選擇 <strong class="text-yellow-400">YouTube 所在的視窗</strong></li>
						{#if isSafari}
							<li>允許麥克風權限，<strong class="text-yellow-400">開啟喇叭</strong>讓麥克風收錄音頻</li>
						{:else}
							<li>勾選「分享音訊」選項</li>
						{/if}
						<li>在 YouTube 視窗播放影片，系統即時分析</li>
					</ol>
				</div>

				{#if errorMessage}
					<div class="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
						{errorMessage}
					</div>
				{/if}

				<div class="flex gap-4">
					<button
						onclick={startYouTubeAnalysis}
						class="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors"
					>
						🔍 開始分析
					</button>
					<button
						onclick={reset}
						class="px-6 py-3 bg-gray-600 hover:bg-gray-500 rounded-lg font-medium transition-colors"
					>
						取消
					</button>
				</div>
			</div>

		{:else if mode === 'file'}
			<!-- 本地影片預覽 -->
			<div class="chord-card">
				<div class="flex items-center gap-4 mb-4">
					<div class="text-4xl">🎬</div>
					<div>
						<div class="font-medium">{selectedFile?.name}</div>
						<div class="text-gray-400 text-sm">
							{selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(2) : 0} MB
						</div>
					</div>
				</div>

				<video
					bind:this={videoElement}
					src={videoUrl}
					class="w-full rounded-lg mb-4"
					controls
				>
					<track kind="captions" />
				</video>

				<button
					onclick={startFileAnalysis}
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
			<div class="grid md:grid-cols-3 gap-6">
				<!-- 影片預覽 -->
				<div class="md:col-span-2 chord-card">
					<div class="flex items-center justify-between mb-4">
						<div class="flex items-center gap-3">
							<div class="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
							<span class="font-medium">分析中</span>
							<span class="text-gray-400">{formatTime(currentTime)}</span>
						</div>
						<button
							onclick={stopAnalysis}
							class="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-medium transition-colors"
						>
							⏹ 停止
						</button>
					</div>

					<!-- 捕獲的畫面 -->
					<div class="relative aspect-video bg-black rounded-lg overflow-hidden">
						<video
							bind:this={capturedVideoElement}
							class="w-full h-full object-contain"
							muted
							playsinline
						>
							<track kind="captions" />
						</video>
						<canvas bind:this={canvasElement} class="hidden"></canvas>
					</div>

					<!-- 檢測指示器 -->
					<div class="mt-4 flex items-center gap-4 text-sm">
						<div class="flex items-center gap-2">
							<div class={`w-2 h-2 rounded-full ${handDetected ? 'bg-green-500' : 'bg-gray-500'}`}></div>
							<span class="text-gray-400">手部檢測</span>
						</div>
						{#if visionChord}
							<span class="text-blue-400">視覺: {visionChord}</span>
						{/if}
						{#if audioChord}
							<span class="text-purple-400">音頻: {audioChord}</span>
						{/if}
					</div>

					{#if inputSource === 'youtube'}
						<p class="mt-4 text-center text-yellow-400 text-sm">
							{#if useMicForAudio}
								🔊 請在 YouTube 視窗播放影片，開啟喇叭讓麥克風收錄
							{:else}
								▶️ 請在 YouTube 視窗播放影片
							{/if}
						</p>
					{/if}
				</div>

				<!-- 和弦顯示 -->
				<div class="chord-card flex flex-col items-center justify-center">
					<div class="text-gray-400 text-sm mb-2">當前和弦</div>
					<div class="text-6xl font-bold text-blue-400 mb-2">
						{currentChord || '--'}
					</div>
					{#if confidence > 0}
						<div class="text-gray-400 text-sm">
							信心度: {(confidence * 100).toFixed(0)}%
						</div>
					{/if}

					{#if recordedSegments.length > 0}
						<div class="mt-6 w-full">
							<h3 class="text-sm font-medium text-gray-400 mb-2">和弦序列</h3>
							<div class="flex flex-wrap gap-2">
								{#each recordedSegments.slice(-8) as segment}
									<span class="px-2 py-1 bg-blue-500/20 text-blue-300 rounded text-sm">
										{segment.chord}
									</span>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>

		{:else if mode === 'done'}
			<!-- 分析結果 -->
			<div class="space-y-6">
				<!-- 時間軸 -->
				<ChordTimeline {segments} {duration} {currentTime} onSeek={() => {}} />

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
						🔄 分析其他影片
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
		<p>使用 MediaPipe 手部追蹤 + Chromagram 音頻分析</p>
		<p class="mt-1">雙模態融合識別吉他和弦</p>
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
