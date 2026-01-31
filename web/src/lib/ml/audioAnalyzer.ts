/**
 * 音頻和弦分析模組
 * 使用 Web Audio API 進行實時音頻分析和和弦識別
 *
 * 實現三種方案：
 * 1. Chromagram + 模板匹配（免訓練）
 * 2. 頻譜分析 + 規則匹配
 * 3. 預訓練模型推理（待整合）
 */

// 標準吉他調音頻率 (E2, A2, D3, G3, B3, E4)
const GUITAR_TUNING = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];

// 12 個音階名稱
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 和弦模板（Chromagram 特徵）
// 每個和弦定義其包含的音符（1 = 包含，0 = 不包含）
const CHORD_TEMPLATES: Record<string, number[]> = {
	// 大三和弦
	C: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], // C, E, G
	D: [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0], // D, F#, A
	E: [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1], // E, G#, B
	F: [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0], // F, A, C
	G: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1], // G, B, D
	A: [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], // A, C#, E

	// 小三和弦
	Am: [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], // A, C, E
	Dm: [1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0], // D, F, A
	Em: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1], // E, G, B

	// 七和弦
	G7: [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1], // G, B, D, F
	C7: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], // C, E, G, Bb
	D7: [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0] // D, F#, A, C
};

export interface AudioAnalyzerOptions {
	fftSize?: number;
	smoothingTimeConstant?: number;
	minDecibels?: number;
	maxDecibels?: number;
}

export interface ChordDetectionResult {
	chord: string;
	confidence: number;
	chromagram: number[];
	dominantFrequency: number;
}

export class AudioAnalyzer {
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private mediaStream: MediaStream | null = null;
	private isInitialized = false;

	private fftSize: number;
	private frequencyData: Float32Array | null = null;
	private timeData: Float32Array | null = null;

	constructor(options: AudioAnalyzerOptions = {}) {
		this.fftSize = options.fftSize || 4096;
	}

	/**
	 * 初始化音頻分析器
	 */
	async initialize(): Promise<void> {
		try {
			console.log('🎤 正在請求麥克風權限...');

			// 請求麥克風權限
			this.mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false
				}
			});

			// 創建音頻上下文
			this.audioContext = new AudioContext();

			// 創建分析器節點
			this.analyser = this.audioContext.createAnalyser();
			this.analyser.fftSize = this.fftSize;
			this.analyser.smoothingTimeConstant = 0.8;
			this.analyser.minDecibels = -90;
			this.analyser.maxDecibels = -10;

			// 連接音頻源到分析器
			const source = this.audioContext.createMediaStreamSource(this.mediaStream);
			source.connect(this.analyser);

			// 初始化數據緩衝區
			this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
			this.timeData = new Float32Array(this.analyser.fftSize);

			this.isInitialized = true;
			console.log('✅ 音頻分析器初始化完成');
			console.log(`  採樣率: ${this.audioContext.sampleRate} Hz`);
			console.log(`  FFT 大小: ${this.fftSize}`);
			console.log(`  頻率解析度: ${this.audioContext.sampleRate / this.fftSize} Hz`);
		} catch (error) {
			console.error('❌ 音頻初始化失敗:', error);
			throw error;
		}
	}

	/**
	 * 計算 Chromagram（12 音階能量分佈）
	 */
	computeChromagram(): number[] {
		if (!this.analyser || !this.frequencyData || !this.audioContext) {
			return Array(12).fill(0);
		}

		// 獲取頻譜數據
		this.analyser.getFloatFrequencyData(this.frequencyData);

		const sampleRate = this.audioContext.sampleRate;
		const binSize = sampleRate / this.fftSize;

		// 初始化 12 音階能量
		const chromagram = Array(12).fill(0);
		const chromagramCounts = Array(12).fill(0);

		// 遍歷相關頻率範圍（約 80Hz - 1200Hz，涵蓋吉他主要音域）
		const minFreq = 80;
		const maxFreq = 1200;
		const minBin = Math.floor(minFreq / binSize);
		const maxBin = Math.ceil(maxFreq / binSize);

		for (let bin = minBin; bin < maxBin && bin < this.frequencyData.length; bin++) {
			const frequency = bin * binSize;
			const magnitude = Math.pow(10, this.frequencyData[bin] / 20); // 轉換為線性幅度

			if (magnitude > 0.001) {
				// 計算該頻率對應的音階
				const noteNumber = 12 * Math.log2(frequency / 440) + 69;
				const chromaIndex = Math.round(noteNumber) % 12;

				if (chromaIndex >= 0 && chromaIndex < 12) {
					chromagram[chromaIndex] += magnitude;
					chromagramCounts[chromaIndex]++;
				}
			}
		}

		// 歸一化
		const maxEnergy = Math.max(...chromagram, 0.001);
		return chromagram.map((energy) => energy / maxEnergy);
	}

	/**
	 * 使用模板匹配識別和弦
	 */
	detectChord(): ChordDetectionResult {
		const chromagram = this.computeChromagram();

		let bestChord = '未知';
		let bestScore = -Infinity;

		// 計算與每個和弦模板的相似度（餘弦相似度）
		for (const [chordName, template] of Object.entries(CHORD_TEMPLATES)) {
			const score = this.cosineSimilarity(chromagram, template);

			if (score > bestScore) {
				bestScore = score;
				bestChord = chordName;
			}
		}

		// 計算置信度（將相似度轉換為 0-1 範圍）
		const confidence = Math.max(0, Math.min(1, (bestScore + 1) / 2));

		// 獲取主要頻率
		const dominantFrequency = this.getDominantFrequency();

		return {
			chord: bestScore > 0.3 ? bestChord : '未知',
			confidence: bestScore > 0.3 ? confidence : 0,
			chromagram,
			dominantFrequency
		};
	}

	/**
	 * 計算餘弦相似度
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
	 * 獲取主要頻率
	 */
	private getDominantFrequency(): number {
		if (!this.analyser || !this.frequencyData || !this.audioContext) {
			return 0;
		}

		this.analyser.getFloatFrequencyData(this.frequencyData);

		const sampleRate = this.audioContext.sampleRate;
		const binSize = sampleRate / this.fftSize;

		let maxMagnitude = -Infinity;
		let dominantBin = 0;

		// 只在吉他頻率範圍內搜索
		const minBin = Math.floor(80 / binSize);
		const maxBin = Math.ceil(1200 / binSize);

		for (let bin = minBin; bin < maxBin && bin < this.frequencyData.length; bin++) {
			if (this.frequencyData[bin] > maxMagnitude) {
				maxMagnitude = this.frequencyData[bin];
				dominantBin = bin;
			}
		}

		return dominantBin * binSize;
	}

	/**
	 * 獲取頻譜數據（用於視覺化）
	 */
	getFrequencyData(): number[] {
		if (!this.analyser || !this.frequencyData) {
			return [];
		}

		this.analyser.getFloatFrequencyData(this.frequencyData);

		// 將 dB 值轉換為 0-1 範圍
		return Array.from(this.frequencyData).map((db) => {
			const normalized = (db + 90) / 80; // -90dB ~ -10dB → 0 ~ 1
			return Math.max(0, Math.min(1, normalized));
		});
	}

	/**
	 * 獲取波形數據（用於視覺化）
	 */
	getWaveformData(): number[] {
		if (!this.analyser || !this.timeData) {
			return [];
		}

		this.analyser.getFloatTimeDomainData(this.timeData);
		return Array.from(this.timeData);
	}

	/**
	 * 獲取音量級別
	 */
	getVolume(): number {
		if (!this.analyser || !this.frequencyData) {
			return 0;
		}

		this.analyser.getFloatFrequencyData(this.frequencyData);

		// 計算 RMS
		let sum = 0;
		for (const value of this.frequencyData) {
			const linear = Math.pow(10, value / 20);
			sum += linear * linear;
		}

		return Math.sqrt(sum / this.frequencyData.length);
	}

	/**
	 * 釋放資源
	 */
	close(): void {
		if (this.mediaStream) {
			this.mediaStream.getTracks().forEach((track) => track.stop());
			this.mediaStream = null;
		}

		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}

		this.analyser = null;
		this.frequencyData = null;
		this.timeData = null;
		this.isInitialized = false;
	}

	get ready(): boolean {
		return this.isInitialized;
	}

	get sampleRate(): number {
		return this.audioContext?.sampleRate || 0;
	}
}

// 單例模式
let analyzerInstance: AudioAnalyzer | null = null;

export function getAudioAnalyzer(): AudioAnalyzer {
	if (!analyzerInstance) {
		analyzerInstance = new AudioAnalyzer();
	}
	return analyzerInstance;
}
