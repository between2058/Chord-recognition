/**
 * 影片/音頻和弦分析器
 * 分析音頻中的和弦並生成時間軸
 *
 * 支援兩種模式:
 * 1. BTC API (推薦) - 使用 BTC Transformer 模型，準確度 ~82%，支援 170 種和弦
 * 2. 本地 Chromagram - 瀏覽器端分析，準確度較低，支援 12 種和弦
 */

import { getAudioAnalyzer, type ChordDetectionResult } from './audioAnalyzer';
import { getBTCApiClient, formatChordName, type BTCChordSegment } from './btcApi';

export interface ChordSegment {
	chord: string;
	startTime: number;
	endTime: number;
	confidence: number;
}

export interface AnalysisResult {
	segments: ChordSegment[];
	duration: number;
	bpm?: number;
	method?: 'btc' | 'chromagram'; // 使用的分析方法
	vocabularySize?: number; // 支援的和弦數量
}

export interface AnalysisProgress {
	currentTime: number;
	duration: number;
	percentage: number;
	currentChord: string;
}

export interface AnalyzerOptions {
	useBTC?: boolean; // 是否使用 BTC API (預設: true)
	btcApiUrl?: string; // BTC API URL (預設: http://localhost:8000)
	minDuration?: number; // 最小和弦持續時間 (預設: 0.3)
}

type ProgressCallback = (progress: AnalysisProgress) => void;

export class VideoChordAnalyzer {
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private isAnalyzing = false;
	private segments: ChordSegment[] = [];
	private options: AnalyzerOptions;
	private btcAvailable: boolean | null = null;

	// Chromagram 模板（與 audioAnalyzer.ts 相同）
	private readonly CHORD_TEMPLATES: Record<string, number[]> = {
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

	constructor(options: AnalyzerOptions = {}) {
		this.options = {
			useBTC: true,
			btcApiUrl: 'http://localhost:8000',
			minDuration: 0.3,
			...options
		};
	}

	/**
	 * 檢查 BTC API 是否可用
	 */
	async checkBTCAvailability(): Promise<boolean> {
		if (this.btcAvailable !== null) {
			return this.btcAvailable;
		}

		try {
			const client = getBTCApiClient(this.options.btcApiUrl);
			this.btcAvailable = await client.isAvailable();
			console.log(`BTC API ${this.btcAvailable ? '可用' : '不可用'}`);
		} catch {
			this.btcAvailable = false;
			console.log('BTC API 不可用，將使用本地 Chromagram 分析');
		}

		return this.btcAvailable;
	}

	/**
	 * 分析本地音頻/視頻文件
	 */
	async analyzeFile(
		file: File,
		onProgress?: ProgressCallback
	): Promise<AnalysisResult> {
		console.log('🎵 開始分析文件:', file.name);

		// 檢查是否使用 BTC API
		if (this.options.useBTC) {
			const btcAvailable = await this.checkBTCAvailability();
			if (btcAvailable) {
				return this.analyzeFileWithBTC(file, onProgress);
			}
			console.log('BTC API 不可用，回退到本地分析');
		}

		// 創建音頻上下文
		this.audioContext = new AudioContext();

		// 讀取文件
		const arrayBuffer = await file.arrayBuffer();
		const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

		console.log(`  時長: ${audioBuffer.duration.toFixed(2)}s`);
		console.log(`  採樣率: ${audioBuffer.sampleRate}Hz`);
		console.log(`  聲道數: ${audioBuffer.numberOfChannels}`);

		// 分析音頻
		return this.analyzeAudioBuffer(audioBuffer, onProgress);
	}

	/**
	 * 使用 BTC API 分析文件
	 */
	private async analyzeFileWithBTC(
		file: File,
		onProgress?: ProgressCallback
	): Promise<AnalysisResult> {
		console.log('🚀 使用 BTC Transformer 分析 (170 種和弦)');

		const client = getBTCApiClient(this.options.btcApiUrl);

		// 報告進度
		if (onProgress) {
			onProgress({
				currentTime: 0,
				duration: 0,
				percentage: 10,
				currentChord: '分析中...'
			});
		}

		try {
			const response = await client.analyzeFile(
				file,
				this.options.minDuration,
				(progress) => {
					if (onProgress) {
						onProgress({
							currentTime: 0,
							duration: 0,
							percentage: progress,
							currentChord: '分析中...'
						});
					}
				}
			);

			// 轉換 BTC 響應格式
			const segments: ChordSegment[] = response.chords.map((chord) => ({
				chord: formatChordName(chord.chord),
				startTime: chord.start,
				endTime: chord.end,
				confidence: 0.85 // BTC 模型的平均置信度
			}));

			// 完成
			if (onProgress) {
				onProgress({
					currentTime: response.duration,
					duration: response.duration,
					percentage: 100,
					currentChord: segments.length > 0 ? segments[segments.length - 1].chord : ''
				});
			}

			return {
				segments,
				duration: response.duration,
				method: 'btc',
				vocabularySize: response.vocabulary_size
			};
		} catch (error) {
			console.error('BTC 分析失敗:', error);
			throw error;
		}
	}

	/**
	 * 從 ArrayBuffer 分析音頻（用於 YouTube 音頻）
	 */
	async analyzeArrayBuffer(
		arrayBuffer: ArrayBuffer,
		onProgress?: ProgressCallback
	): Promise<AnalysisResult> {
		console.log('🎵 開始分析 ArrayBuffer...');

		// 如果 BTC 可用，將 ArrayBuffer 轉換為 File 並使用 BTC
		if (this.options.useBTC) {
			const btcAvailable = await this.checkBTCAvailability();
			if (btcAvailable) {
				const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
				const file = new File([blob], 'audio.wav', { type: 'audio/wav' });
				return this.analyzeFileWithBTC(file, onProgress);
			}
		}

		// 創建音頻上下文
		if (!this.audioContext) {
			this.audioContext = new AudioContext();
		}

		// 解碼音頻
		const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

		console.log(`  時長: ${audioBuffer.duration.toFixed(2)}s`);
		console.log(`  採樣率: ${audioBuffer.sampleRate}Hz`);
		console.log(`  聲道數: ${audioBuffer.numberOfChannels}`);

		// 分析音頻
		return this.analyzeAudioBuffer(audioBuffer, onProgress);
	}

	/**
	 * 分析 AudioBuffer
	 */
	async analyzeAudioBuffer(
		audioBuffer: AudioBuffer,
		onProgress?: ProgressCallback
	): Promise<AnalysisResult> {
		this.isAnalyzing = true;
		this.segments = [];

		const sampleRate = audioBuffer.sampleRate;
		const duration = audioBuffer.duration;

		// 獲取音頻數據（混合為單聲道）
		const channelData = this.mixToMono(audioBuffer);

		// 分析參數
		const hopSize = Math.floor(sampleRate * 0.1); // 每 100ms 分析一次
		const windowSize = 4096;

		let currentChord = '';
		let chordStartTime = 0;
		let lastChord = '';

		for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
			if (!this.isAnalyzing) break;

			const currentTime = i / sampleRate;

			// 提取窗口數據
			const windowData = channelData.slice(i, i + windowSize);

			// 計算 Chromagram
			const chromagram = this.computeChromagramFromSamples(windowData, sampleRate);

			// 識別和弦
			const detection = this.detectChordFromChromagram(chromagram);

			// 更新進度
			if (onProgress) {
				onProgress({
					currentTime,
					duration,
					percentage: (currentTime / duration) * 100,
					currentChord: detection.chord
				});
			}

			// 和弦變化檢測
			if (detection.chord !== lastChord && detection.confidence > 0.3) {
				if (lastChord && lastChord !== '未知') {
					// 保存上一個和弦段落
					this.segments.push({
						chord: lastChord,
						startTime: chordStartTime,
						endTime: currentTime,
						confidence: 0.8
					});
				}
				lastChord = detection.chord;
				chordStartTime = currentTime;
			}
		}

		// 保存最後一個和弦段落
		if (lastChord && lastChord !== '未知') {
			this.segments.push({
				chord: lastChord,
				startTime: chordStartTime,
				endTime: duration,
				confidence: 0.8
			});
		}

		// 合併相鄰的相同和弦
		const mergedSegments = this.mergeAdjacentSegments(this.segments);

		this.isAnalyzing = false;

		return {
			segments: mergedSegments,
			duration,
			method: 'chromagram',
			vocabularySize: Object.keys(this.CHORD_TEMPLATES).length
		};
	}

	/**
	 * 混合多聲道為單聲道
	 */
	private mixToMono(audioBuffer: AudioBuffer): Float32Array {
		const length = audioBuffer.length;
		const mono = new Float32Array(length);

		for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
			const channelData = audioBuffer.getChannelData(channel);
			for (let i = 0; i < length; i++) {
				mono[i] += channelData[i] / audioBuffer.numberOfChannels;
			}
		}

		return mono;
	}

	/**
	 * 從樣本數據計算 Chromagram
	 */
	private computeChromagramFromSamples(
		samples: Float32Array,
		sampleRate: number
	): number[] {
		// 簡單的 FFT 實現（使用 DFT）
		const fftSize = samples.length;
		const magnitudes = new Float32Array(fftSize / 2);

		// 計算頻譜（簡化版 DFT）
		for (let k = 0; k < fftSize / 2; k++) {
			let real = 0;
			let imag = 0;
			for (let n = 0; n < fftSize; n++) {
				const angle = (2 * Math.PI * k * n) / fftSize;
				real += samples[n] * Math.cos(angle);
				imag -= samples[n] * Math.sin(angle);
			}
			magnitudes[k] = Math.sqrt(real * real + imag * imag);
		}

		// 計算 Chromagram
		const chromagram = new Array(12).fill(0);
		const chromaCounts = new Array(12).fill(0);

		const binSize = sampleRate / fftSize;
		const minFreq = 80;
		const maxFreq = 1200;
		const minBin = Math.floor(minFreq / binSize);
		const maxBin = Math.ceil(maxFreq / binSize);

		for (let bin = minBin; bin < maxBin && bin < magnitudes.length; bin++) {
			const frequency = bin * binSize;
			const magnitude = magnitudes[bin];

			if (magnitude > 0.001) {
				const noteNumber = 12 * Math.log2(frequency / 440) + 69;
				const chromaIndex = Math.round(noteNumber) % 12;

				if (chromaIndex >= 0 && chromaIndex < 12) {
					chromagram[chromaIndex] += magnitude;
					chromaCounts[chromaIndex]++;
				}
			}
		}

		// 歸一化
		const maxEnergy = Math.max(...chromagram, 0.001);
		return chromagram.map((energy) => energy / maxEnergy);
	}

	/**
	 * 從 Chromagram 識別和弦
	 */
	private detectChordFromChromagram(chromagram: number[]): ChordDetectionResult {
		let bestChord = '未知';
		let bestScore = -Infinity;

		for (const [chordName, template] of Object.entries(this.CHORD_TEMPLATES)) {
			const score = this.cosineSimilarity(chromagram, template);
			if (score > bestScore) {
				bestScore = score;
				bestChord = chordName;
			}
		}

		const confidence = Math.max(0, Math.min(1, (bestScore + 1) / 2));

		return {
			chord: bestScore > 0.3 ? bestChord : '未知',
			confidence: bestScore > 0.3 ? confidence : 0,
			chromagram,
			dominantFrequency: 0
		};
	}

	/**
	 * 餘弦相似度
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		const denominator = Math.sqrt(normA) * Math.sqrt(normB);
		return denominator > 0 ? dotProduct / denominator : 0;
	}

	/**
	 * 合併相鄰的相同和弦段落
	 */
	private mergeAdjacentSegments(segments: ChordSegment[]): ChordSegment[] {
		if (segments.length === 0) return [];

		const merged: ChordSegment[] = [];
		let current = { ...segments[0] };

		for (let i = 1; i < segments.length; i++) {
			if (segments[i].chord === current.chord) {
				// 合併
				current.endTime = segments[i].endTime;
			} else {
				// 保存並開始新段落
				if (current.endTime - current.startTime >= 0.5) {
					merged.push(current);
				}
				current = { ...segments[i] };
			}
		}

		// 保存最後一個
		if (current.endTime - current.startTime >= 0.5) {
			merged.push(current);
		}

		return merged;
	}

	/**
	 * 停止分析
	 */
	stop(): void {
		this.isAnalyzing = false;
	}

	/**
	 * 釋放資源
	 */
	dispose(): void {
		this.stop();
		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}
	}
}

// 單例
let analyzerInstance: VideoChordAnalyzer | null = null;

export function getVideoChordAnalyzer(options?: AnalyzerOptions): VideoChordAnalyzer {
	if (!analyzerInstance) {
		analyzerInstance = new VideoChordAnalyzer(options);
	}
	return analyzerInstance;
}

/**
 * 創建新的分析器實例 (非單例)
 */
export function createVideoChordAnalyzer(options?: AnalyzerOptions): VideoChordAnalyzer {
	return new VideoChordAnalyzer(options);
}

/**
 * 從 YouTube URL 提取視頻 ID
 */
export function extractYouTubeId(url: string): string | null {
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

/**
 * 格式化時間為 MM:SS
 */
export function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}
