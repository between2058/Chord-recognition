<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getHandTracker } from '$lib/ml/handTracker';
	import { handLandmarks, systemStatus, fps, visionChord } from '$lib/stores/appState';
	import { getChordClassifier } from '$lib/ml/chordClassifier';

	let video: HTMLVideoElement;
	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let animationId: number;
	let lastTime = performance.now();
	let frameCount = 0;

	const handTracker = getHandTracker();
	const chordClassifier = getChordClassifier();

	onMount(async () => {
		ctx = canvas.getContext('2d');

		try {
			// 初始化攝像頭
			systemStatus.update((s) => ({ ...s, camera: 'requesting' }));

			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					width: { ideal: 1280 },
					height: { ideal: 720 },
					facingMode: 'user'
				}
			});

			video.srcObject = stream;
			await video.play();

			systemStatus.update((s) => ({ ...s, camera: 'active' }));

			// 初始化手部追蹤
			systemStatus.update((s) => ({ ...s, handTracking: 'loading' }));
			await handTracker.initialize();
			systemStatus.update((s) => ({ ...s, handTracking: 'ready' }));

			// 初始化和弦分類器
			systemStatus.update((s) => ({ ...s, chordModel: 'loading' }));
			await chordClassifier.initialize();
			systemStatus.update((s) => ({ ...s, chordModel: 'ready' }));

			// 開始處理循環
			processFrame();
		} catch (error) {
			console.error('攝像頭初始化失敗:', error);
			systemStatus.update((s) => ({ ...s, camera: 'error' }));
		}
	});

	onDestroy(() => {
		if (animationId) {
			cancelAnimationFrame(animationId);
		}

		if (video?.srcObject) {
			const stream = video.srcObject as MediaStream;
			stream.getTracks().forEach((track) => track.stop());
		}
	});

	async function processFrame() {
		if (!video || !ctx || !canvas) {
			animationId = requestAnimationFrame(processFrame);
			return;
		}

		// 繪製視頻幀
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		ctx.drawImage(video, 0, 0);

		// 鏡像翻轉
		ctx.save();
		ctx.scale(-1, 1);
		ctx.drawImage(video, -canvas.width, 0);
		ctx.restore();

		// 手部檢測
		if (handTracker.ready) {
			const timestamp = performance.now();
			const results = handTracker.detectForVideo(video, timestamp);

			if (results && results.landmarks && results.landmarks.length > 0) {
				// 尋找左手（吉他按弦手）
				for (let i = 0; i < results.landmarks.length; i++) {
					const landmarks = results.landmarks[i];
					const handedness = results.handednesses[i];

					// 繪製手部關鍵點
					drawLandmarks(landmarks);

					// 只處理左手進行和弦識別
					if (handTracker.isLeftHand(handedness)) {
						handLandmarks.set(landmarks);

						// 和弦分類
						if (chordClassifier.ready) {
							const preprocessed = handTracker.preprocessLandmarks(landmarks);
							if (preprocessed.length === 42) {
								try {
									const result = await chordClassifier.classify(preprocessed);
									visionChord.set({
										name: result.chordName,
										confidence: result.confidence,
										source: 'vision',
										timestamp: Date.now()
									});
								} catch (e) {
									console.error('分類錯誤:', e);
								}
							}
						}
					}
				}
			} else {
				handLandmarks.set(null);
			}
		}

		// 計算 FPS
		frameCount++;
		const now = performance.now();
		if (now - lastTime >= 1000) {
			fps.set(Math.round(frameCount / ((now - lastTime) / 1000)));
			frameCount = 0;
			lastTime = now;
		}

		animationId = requestAnimationFrame(processFrame);
	}

	function drawLandmarks(landmarks: { x: number; y: number; z: number }[]) {
		if (!ctx || !canvas) return;

		// 鏡像 x 座標
		const mirroredLandmarks = landmarks.map((lm) => ({
			x: 1 - lm.x,
			y: lm.y,
			z: lm.z
		}));

		// 繪製連接線
		const connections = [
			// 拇指
			[0, 1], [1, 2], [2, 3], [3, 4],
			// 食指
			[0, 5], [5, 6], [6, 7], [7, 8],
			// 中指
			[9, 10], [10, 11], [11, 12],
			// 無名指
			[13, 14], [14, 15], [15, 16],
			// 小指
			[0, 17], [17, 18], [18, 19], [19, 20],
			// 手掌
			[5, 9], [9, 13], [13, 17]
		];

		ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
		ctx.lineWidth = 2;

		for (const [start, end] of connections) {
			ctx.beginPath();
			ctx.moveTo(
				mirroredLandmarks[start].x * canvas.width,
				mirroredLandmarks[start].y * canvas.height
			);
			ctx.lineTo(
				mirroredLandmarks[end].x * canvas.width,
				mirroredLandmarks[end].y * canvas.height
			);
			ctx.stroke();
		}

		// 繪製關鍵點
		for (let i = 0; i < mirroredLandmarks.length; i++) {
			const lm = mirroredLandmarks[i];
			const x = lm.x * canvas.width;
			const y = lm.y * canvas.height;

			// 指尖用較大的圓圈
			const isFingerTip = [4, 8, 12, 16, 20].includes(i);
			const radius = isFingerTip ? 8 : 4;
			const color = isFingerTip ? '#22c55e' : '#3b82f6';

			ctx.beginPath();
			ctx.arc(x, y, radius, 0, 2 * Math.PI);
			ctx.fillStyle = color;
			ctx.fill();
			ctx.strokeStyle = 'white';
			ctx.lineWidth = 2;
			ctx.stroke();
		}
	}
</script>

<div class="video-container relative">
	<!-- 隱藏的 video 元素 -->
	<video bind:this={video} class="hidden" playsinline></video>

	<!-- Canvas 顯示 -->
	<canvas
		bind:this={canvas}
		class="w-full h-auto rounded-xl"
	></canvas>

	<!-- FPS 顯示 -->
	<div class="absolute top-4 left-4 bg-black/50 px-3 py-1 rounded-full text-sm">
		{$fps} FPS
	</div>
</div>
