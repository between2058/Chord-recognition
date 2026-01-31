/**
 * 應用程式狀態管理
 * 使用 Svelte 5 的 runes 進行響應式狀態管理
 */

import { writable, derived } from 'svelte/store';

// ============ 類型定義 ============

export interface HandLandmark {
	x: number;
	y: number;
	z: number;
}

export interface DetectedChord {
	name: string;
	confidence: number;
	source: 'vision' | 'audio' | 'fused';
	timestamp: number;
}

export interface SystemStatus {
	webgpu: 'checking' | 'supported' | 'unsupported';
	camera: 'inactive' | 'requesting' | 'active' | 'error';
	microphone: 'inactive' | 'requesting' | 'active' | 'error';
	handTracking: 'loading' | 'ready' | 'error';
	chordModel: 'loading' | 'ready' | 'error';
}

export interface AudioVisualizerData {
	frequencies: number[];
	chromagram: number[];
	waveform: number[];
}

// ============ Stores ============

// 系統狀態
export const systemStatus = writable<SystemStatus>({
	webgpu: 'checking',
	camera: 'inactive',
	microphone: 'inactive',
	handTracking: 'loading',
	chordModel: 'loading'
});

// 當前檢測到的手部關鍵點 (21 個點)
export const handLandmarks = writable<HandLandmark[] | null>(null);

// 當前檢測到的和弦
export const currentChord = writable<DetectedChord | null>(null);

// 視覺識別的和弦
export const visionChord = writable<DetectedChord | null>(null);

// 音頻識別的和弦
export const audioChord = writable<DetectedChord | null>(null);

// 音頻視覺化數據
export const audioData = writable<AudioVisualizerData>({
	frequencies: [],
	chromagram: Array(12).fill(0),
	waveform: []
});

// FPS 計數
export const fps = writable<number>(0);

// 是否顯示除錯資訊
export const showDebug = writable<boolean>(false);

// ============ Derived Stores ============

// 系統是否完全就緒
export const isSystemReady = derived(
	systemStatus,
	($status) =>
		$status.camera === 'active' &&
		$status.handTracking === 'ready' &&
		$status.chordModel === 'ready'
);

// 融合後的和弦（結合視覺和音頻）
export const fusedChord = derived(
	[visionChord, audioChord],
	([$vision, $audio]) => {
		if (!$vision && !$audio) return null;
		if (!$vision) return $audio;
		if (!$audio) return $vision;

		// 多模態融合邏輯
		// 視覺權重 0.7，音頻權重 0.3
		const VISION_WEIGHT = 0.7;
		const AUDIO_WEIGHT = 0.3;

		// 如果兩者識別相同，提高置信度
		if ($vision.name === $audio.name) {
			return {
				name: $vision.name,
				confidence: Math.min(1, $vision.confidence * VISION_WEIGHT + $audio.confidence * AUDIO_WEIGHT + 0.1),
				source: 'fused' as const,
				timestamp: Date.now()
			};
		}

		// 否則選擇置信度較高的
		const visionScore = $vision.confidence * VISION_WEIGHT;
		const audioScore = $audio.confidence * AUDIO_WEIGHT;

		if (visionScore >= audioScore) {
			return { ...$vision, source: 'fused' as const };
		} else {
			return { ...$audio, source: 'fused' as const };
		}
	}
);

// 和弦歷史記錄
export const chordHistory = writable<DetectedChord[]>([]);

// 添加和弦到歷史
export function addChordToHistory(chord: DetectedChord) {
	chordHistory.update((history) => {
		const newHistory = [...history, chord];
		// 只保留最近 100 個記錄
		if (newHistory.length > 100) {
			return newHistory.slice(-100);
		}
		return newHistory;
	});
}
