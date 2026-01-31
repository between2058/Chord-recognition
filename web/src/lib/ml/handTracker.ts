/**
 * MediaPipe 手部追蹤模組
 * 使用 @mediapipe/tasks-vision 進行實時手部關鍵點檢測
 */

import {
	HandLandmarker,
	FilesetResolver,
	type HandLandmarkerResult
} from '@mediapipe/tasks-vision';

export interface HandTrackerOptions {
	numHands?: number;
	minHandDetectionConfidence?: number;
	minHandPresenceConfidence?: number;
	minTrackingConfidence?: number;
}

export interface NormalizedLandmark {
	x: number;
	y: number;
	z: number;
}

export class HandTracker {
	private handLandmarker: HandLandmarker | null = null;
	private isInitialized = false;
	private lastVideoTime = -1;

	/**
	 * 初始化 HandLandmarker
	 */
	async initialize(options: HandTrackerOptions = {}): Promise<void> {
		const {
			numHands = 2,
			minHandDetectionConfidence = 0.5,
			minHandPresenceConfidence = 0.5,
			minTrackingConfidence = 0.5
		} = options;

		try {
			console.log('🖐️ 正在載入 MediaPipe Hand Landmarker...');

			// 載入 WASM 檔案
			const vision = await FilesetResolver.forVisionTasks(
				'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
			);

			// 創建 HandLandmarker
			this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
				baseOptions: {
					modelAssetPath:
						'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
					delegate: 'GPU'
				},
				runningMode: 'VIDEO',
				numHands,
				minHandDetectionConfidence,
				minHandPresenceConfidence,
				minTrackingConfidence
			});

			this.isInitialized = true;
			console.log('✅ MediaPipe Hand Landmarker 載入完成');
		} catch (error) {
			console.error('❌ MediaPipe 初始化失敗:', error);
			throw error;
		}
	}

	/**
	 * 處理視頻幀，檢測手部關鍵點
	 */
	detectForVideo(
		video: HTMLVideoElement,
		timestamp: number
	): HandLandmarkerResult | null {
		if (!this.handLandmarker || !this.isInitialized) {
			console.warn('HandLandmarker 尚未初始化');
			return null;
		}

		// 避免重複處理同一幀
		if (timestamp === this.lastVideoTime) {
			return null;
		}
		this.lastVideoTime = timestamp;

		try {
			return this.handLandmarker.detectForVideo(video, timestamp);
		} catch (error) {
			console.error('手部檢測錯誤:', error);
			return null;
		}
	}

	/**
	 * 預處理關鍵點為模型輸入格式
	 * 與原始 Python 版本的 pre_process_landmark() 相同邏輯
	 */
	preprocessLandmarks(landmarks: NormalizedLandmark[]): number[] {
		if (landmarks.length !== 21) {
			console.warn('預期 21 個關鍵點，實際:', landmarks.length);
			return [];
		}

		// 複製關鍵點
		const tempLandmarks: [number, number][] = landmarks.map((lm) => [lm.x, lm.y]);

		// 以食指尖端 (index 8) 為基準點計算相對座標
		const baseX = tempLandmarks[8][0];
		const baseY = tempLandmarks[8][1];

		for (let i = 0; i < tempLandmarks.length; i++) {
			tempLandmarks[i][0] -= baseX;
			tempLandmarks[i][1] -= baseY;
		}

		// 展開為一維陣列
		const flatList: number[] = [];
		for (const [x, y] of tempLandmarks) {
			flatList.push(x, y);
		}

		// 歸一化
		const maxValue = Math.max(...flatList.map(Math.abs));
		if (maxValue > 0) {
			for (let i = 0; i < flatList.length; i++) {
				flatList[i] /= maxValue;
			}
		}

		return flatList;
	}

	/**
	 * 判斷是否為左手
	 */
	isLeftHand(handedness: { categoryName: string }[]): boolean {
		return handedness.some((h) => h.categoryName === 'Left');
	}

	/**
	 * 計算手部邊界框
	 */
	calcBoundingRect(
		landmarks: NormalizedLandmark[],
		imageWidth: number,
		imageHeight: number
	): { x: number; y: number; width: number; height: number } {
		const xCoords = landmarks.map((lm) => lm.x * imageWidth);
		const yCoords = landmarks.map((lm) => lm.y * imageHeight);

		const minX = Math.min(...xCoords);
		const maxX = Math.max(...xCoords);
		const minY = Math.min(...yCoords);
		const maxY = Math.max(...yCoords);

		return {
			x: minX,
			y: minY,
			width: maxX - minX,
			height: maxY - minY
		};
	}

	/**
	 * 獲取指尖位置（用於繪製）
	 * 索引：4(拇指)、8(食指)、12(中指)、16(無名指)、20(小指)
	 */
	getFingerTips(landmarks: NormalizedLandmark[]): NormalizedLandmark[] {
		const tipIndices = [4, 8, 12, 16, 20];
		return tipIndices.map((i) => landmarks[i]);
	}

	/**
	 * 釋放資源
	 */
	close(): void {
		if (this.handLandmarker) {
			this.handLandmarker.close();
			this.handLandmarker = null;
		}
		this.isInitialized = false;
	}

	get ready(): boolean {
		return this.isInitialized;
	}
}

// 單例模式
let handTrackerInstance: HandTracker | null = null;

export function getHandTracker(): HandTracker {
	if (!handTrackerInstance) {
		handTrackerInstance = new HandTracker();
	}
	return handTrackerInstance;
}
