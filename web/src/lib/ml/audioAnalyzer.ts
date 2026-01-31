/**
 * 即時音頻和弦分析模組
 * 使用 Web Audio API 進行實時音頻分析和和弦識別
 *
 * 改進版特性：
 * - 48+ 種和弦模板（Major, Minor, 7th, maj7, m7, dim, aug, sus）
 * - 泛音加權 Chromagram 計算
 * - 和弦平滑與穩定性檢測
 * - 可選的 WebSocket 後端驗證
 */

// 12 個音階名稱
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 和弦品質定義（相對於根音的半音距離）
const CHORD_QUALITIES: Record<string, number[]> = {
	// 三和弦
	maj: [0, 4, 7], // Major: 1, 3, 5
	min: [0, 3, 7], // Minor: 1, b3, 5
	dim: [0, 3, 6], // Diminished: 1, b3, b5
	aug: [0, 4, 8], // Augmented: 1, 3, #5

	// 七和弦
	'7': [0, 4, 7, 10], // Dominant 7: 1, 3, 5, b7
	maj7: [0, 4, 7, 11], // Major 7: 1, 3, 5, 7
	m7: [0, 3, 7, 10], // Minor 7: 1, b3, 5, b7
	dim7: [0, 3, 6, 9], // Diminished 7: 1, b3, b5, bb7
	m7b5: [0, 3, 6, 10], // Half-diminished: 1, b3, b5, b7

	// 掛留和弦
	sus2: [0, 2, 7], // Suspended 2: 1, 2, 5
	sus4: [0, 5, 7], // Suspended 4: 1, 4, 5

	// 加音和弦
	add9: [0, 4, 7, 14], // Add 9: 1, 3, 5, 9
	madd9: [0, 3, 7, 14] // Minor add 9: 1, b3, 5, 9
};

// 生成所有和弦的 Chromagram 模板
function generateChordTemplates(): Record<string, number[]> {
	const templates: Record<string, number[]> = {};

	for (let root = 0; root < 12; root++) {
		const rootName = NOTE_NAMES[root];

		for (const [quality, intervals] of Object.entries(CHORD_QUALITIES)) {
			// 生成和弦名稱
			let chordName: string;
			if (quality === 'maj') {
				chordName = rootName; // C, D, E, etc.
			} else if (quality === 'min') {
				chordName = `${rootName}m`; // Cm, Dm, Em, etc.
			} else {
				chordName = `${rootName}${quality}`; // C7, Cmaj7, etc.
			}

			// 生成 Chromagram 模板
			const template = Array(12).fill(0);
			for (const interval of intervals) {
				const noteIndex = (root + interval) % 12;
				// 加權：根音和五度權重更高
				if (interval === 0) {
					template[noteIndex] = 1.0; // 根音
				} else if (interval === 7) {
					template[noteIndex] = 0.8; // 五度
				} else {
					template[noteIndex] = 0.6; // 其他音
				}
			}

			templates[chordName] = template;
		}
	}

	return templates;
}

// 生成所有和弦模板
const CHORD_TEMPLATES = generateChordTemplates();

// 常用吉他和弦（優先匹配）
const COMMON_GUITAR_CHORDS = [
	'C',
	'D',
	'E',
	'F',
	'G',
	'A',
	'B',
	'Am',
	'Dm',
	'Em',
	'Bm',
	'Fm',
	'C7',
	'D7',
	'E7',
	'G7',
	'A7',
	'B7',
	'Cmaj7',
	'Dmaj7',
	'Fmaj7',
	'Gmaj7',
	'Am7',
	'Dm7',
	'Em7',
	'Bm7',
	'Csus4',
	'Dsus4',
	'Asus4',
	'Dsus2',
	'Asus2'
];

export interface AudioAnalyzerOptions {
	fftSize?: number;
	smoothingTimeConstant?: number;
	minDecibels?: number;
	maxDecibels?: number;
	chordSmoothingWindow?: number; // 和弦平滑窗口大小
	stabilityThreshold?: number; // 穩定性閾值
}

export interface ChordDetectionResult {
	chord: string;
	confidence: number;
	chromagram: number[];
	dominantFrequency: number;
	isStable: boolean; // 和弦是否穩定
	alternativeChords: Array<{ chord: string; confidence: number }>; // 備選和弦
}

export class AudioAnalyzer {
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private mediaStream: MediaStream | null = null;
	private isInitialized = false;

	private fftSize: number;
	private frequencyData: Float32Array | null = null;
	private timeData: Float32Array | null = null;

	// 和弦平滑相關
	private chordHistory: string[] = [];
	private chordSmoothingWindow: number;
	private stabilityThreshold: number;
	private lastStableChord: string = '';
	private stableChordCount: number = 0;

	// 泛音加權係數
	private readonly HARMONIC_WEIGHTS = [1.0, 0.5, 0.33, 0.25, 0.2];

	constructor(options: AudioAnalyzerOptions = {}) {
		this.fftSize = options.fftSize || 8192; // 增加 FFT 大小以獲得更好的頻率解析度
		this.chordSmoothingWindow = options.chordSmoothingWindow || 5;
		this.stabilityThreshold = options.stabilityThreshold || 3;
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
					autoGainControl: false,
					sampleRate: 44100
				}
			});

			// 創建音頻上下文
			this.audioContext = new AudioContext({ sampleRate: 44100 });

			// 創建分析器節點
			this.analyser = this.audioContext.createAnalyser();
			this.analyser.fftSize = this.fftSize;
			this.analyser.smoothingTimeConstant = 0.85;
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
			console.log(`  頻率解析度: ${(this.audioContext.sampleRate / this.fftSize).toFixed(2)} Hz`);
			console.log(`  和弦模板數量: ${Object.keys(CHORD_TEMPLATES).length}`);
		} catch (error) {
			console.error('❌ 音頻初始化失敗:', error);
			throw error;
		}
	}

	/**
	 * 計算改進的 Chromagram（含泛音加權）
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

		// 吉他頻率範圍（E2 ~ E5: 約 82Hz ~ 660Hz，考慮泛音到 2000Hz）
		const minFreq = 70;
		const maxFreq = 2000;
		const minBin = Math.floor(minFreq / binSize);
		const maxBin = Math.min(Math.ceil(maxFreq / binSize), this.frequencyData.length - 1);

		// 計算噪音門檻
		let totalEnergy = 0;
		for (let bin = minBin; bin <= maxBin; bin++) {
			const magnitude = Math.pow(10, this.frequencyData[bin] / 20);
			totalEnergy += magnitude;
		}
		const noiseThreshold = (totalEnergy / (maxBin - minBin)) * 0.5;

		for (let bin = minBin; bin <= maxBin; bin++) {
			const frequency = bin * binSize;
			const magnitude = Math.pow(10, this.frequencyData[bin] / 20);

			// 噪音門檻過濾
			if (magnitude < noiseThreshold) continue;

			// 計算該頻率對應的音階和泛音序號
			const noteNumber = 12 * Math.log2(frequency / 440) + 69;
			const chromaIndex = Math.round(noteNumber) % 12;

			if (chromaIndex >= 0 && chromaIndex < 12) {
				// 估算泛音序號（基於頻率與最近基音的關係）
				const fundamentalFreq = 440 * Math.pow(2, (Math.round(noteNumber) - 69) / 12);
				const harmonicRatio = frequency / fundamentalFreq;
				const harmonicNumber = Math.round(harmonicRatio);

				// 泛音加權
				let weight = 1.0;
				if (harmonicNumber > 0 && harmonicNumber <= this.HARMONIC_WEIGHTS.length) {
					weight = this.HARMONIC_WEIGHTS[harmonicNumber - 1];
				} else if (harmonicNumber > this.HARMONIC_WEIGHTS.length) {
					weight = 0.1;
				}

				chromagram[chromaIndex] += magnitude * weight;
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

		// 檢查是否有足夠的音頻能量
		const totalEnergy = chromagram.reduce((sum, val) => sum + val, 0);
		if (totalEnergy < 0.5) {
			return {
				chord: '...',
				confidence: 0,
				chromagram,
				dominantFrequency: 0,
				isStable: false,
				alternativeChords: []
			};
		}

		// 計算所有和弦的匹配分數
		const scores: Array<{ chord: string; score: number }> = [];

		for (const [chordName, template] of Object.entries(CHORD_TEMPLATES)) {
			let score = this.cosineSimilarity(chromagram, template);

			// 常用吉他和弦加分
			if (COMMON_GUITAR_CHORDS.includes(chordName)) {
				score *= 1.1;
			}

			scores.push({ chord: chordName, score });
		}

		// 排序
		scores.sort((a, b) => b.score - a.score);

		// 取前 5 個候選
		const topChords = scores.slice(0, 5);
		const bestChord = topChords[0];

		// 計算置信度
		const confidence = Math.max(0, Math.min(1, (bestChord.score + 1) / 2));

		// 最小置信度閾值
		const minConfidence = 0.4;
		const detectedChord = confidence >= minConfidence ? bestChord.chord : '...';

		// 和弦平滑處理
		this.chordHistory.push(detectedChord);
		if (this.chordHistory.length > this.chordSmoothingWindow) {
			this.chordHistory.shift();
		}

		// 計算最常出現的和弦
		const smoothedChord = this.getMostFrequentChord();

		// 穩定性檢測
		if (smoothedChord === this.lastStableChord) {
			this.stableChordCount++;
		} else {
			this.stableChordCount = 1;
			this.lastStableChord = smoothedChord;
		}

		const isStable = this.stableChordCount >= this.stabilityThreshold;

		// 獲取主要頻率
		const dominantFrequency = this.getDominantFrequency();

		return {
			chord: smoothedChord,
			confidence: confidence,
			chromagram,
			dominantFrequency,
			isStable,
			alternativeChords: topChords.slice(1, 4).map((c) => ({
				chord: c.chord,
				confidence: Math.max(0, Math.min(1, (c.score + 1) / 2))
			}))
		};
	}

	/**
	 * 獲取和弦歷史中最常出現的和弦
	 */
	private getMostFrequentChord(): string {
		const counts: Record<string, number> = {};
		for (const chord of this.chordHistory) {
			counts[chord] = (counts[chord] || 0) + 1;
		}

		let maxCount = 0;
		let mostFrequent = '...';
		for (const [chord, count] of Object.entries(counts)) {
			if (count > maxCount) {
				maxCount = count;
				mostFrequent = chord;
			}
		}

		return mostFrequent;
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
		const minBin = Math.floor(70 / binSize);
		const maxBin = Math.ceil(1000 / binSize);

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
			const normalized = (db + 90) / 80;
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

		let sum = 0;
		const minBin = Math.floor(70 / (this.audioContext!.sampleRate / this.fftSize));
		const maxBin = Math.ceil(2000 / (this.audioContext!.sampleRate / this.fftSize));

		for (let bin = minBin; bin < maxBin && bin < this.frequencyData.length; bin++) {
			const linear = Math.pow(10, this.frequencyData[bin] / 20);
			sum += linear * linear;
		}

		return Math.sqrt(sum / (maxBin - minBin));
	}

	/**
	 * 重置和弦歷史（用於手動清除）
	 */
	resetHistory(): void {
		this.chordHistory = [];
		this.lastStableChord = '';
		this.stableChordCount = 0;
	}

	/**
	 * 獲取所有支援的和弦列表
	 */
	static getSupportedChords(): string[] {
		return Object.keys(CHORD_TEMPLATES);
	}

	/**
	 * 獲取常用吉他和弦列表
	 */
	static getCommonGuitarChords(): string[] {
		return [...COMMON_GUITAR_CHORDS];
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
		this.chordHistory = [];
	}

	get ready(): boolean {
		return this.isInitialized;
	}

	get sampleRate(): number {
		return this.audioContext?.sampleRate || 0;
	}

	get supportedChordCount(): number {
		return Object.keys(CHORD_TEMPLATES).length;
	}
}

// 單例模式
let analyzerInstance: AudioAnalyzer | null = null;

export function getAudioAnalyzer(options?: AudioAnalyzerOptions): AudioAnalyzer {
	if (!analyzerInstance) {
		analyzerInstance = new AudioAnalyzer(options);
	}
	return analyzerInstance;
}

/**
 * 創建新的分析器實例（非單例）
 */
export function createAudioAnalyzer(options?: AudioAnalyzerOptions): AudioAnalyzer {
	return new AudioAnalyzer(options);
}
