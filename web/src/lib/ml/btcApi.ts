/**
 * BTC Chord Recognition API Client
 *
 * Connects to the BTC (Bi-directional Transformer for Chord) backend API
 * for high-accuracy chord recognition (170 chord types, ~82% accuracy)
 */

export interface BTCChordSegment {
	start: number;
	end: number;
	chord: string;
	duration: number;
}

export interface BTCAnalysisResponse {
	success: boolean;
	duration: number;
	num_chords: number;
	vocabulary_size: number;
	chords: BTCChordSegment[];
	message?: string;
}

export interface BTCHealthResponse {
	status: string;
	model_loaded: boolean;
	device: string;
}

export interface BTCChordListResponse {
	total: number;
	by_root: Record<string, string[]>;
}

/**
 * BTC API Client for chord recognition
 */
export class BTCApiClient {
	private baseUrl: string;

	constructor(baseUrl: string = 'http://localhost:8000') {
		this.baseUrl = baseUrl;
	}

	/**
	 * Set the API base URL
	 */
	setBaseUrl(url: string): void {
		this.baseUrl = url;
	}

	/**
	 * Check if the BTC API server is available and healthy
	 */
	async healthCheck(): Promise<BTCHealthResponse> {
		const response = await fetch(`${this.baseUrl}/health`);
		if (!response.ok) {
			throw new Error(`Health check failed: ${response.statusText}`);
		}
		return response.json();
	}

	/**
	 * Check if the API server is reachable
	 */
	async isAvailable(): Promise<boolean> {
		try {
			const health = await this.healthCheck();
			return health.status === 'healthy';
		} catch {
			return false;
		}
	}

	/**
	 * Get list of all supported chord types
	 */
	async getChordList(): Promise<BTCChordListResponse> {
		const response = await fetch(`${this.baseUrl}/chords`);
		if (!response.ok) {
			throw new Error(`Failed to get chord list: ${response.statusText}`);
		}
		return response.json();
	}

	/**
	 * Analyze an audio file for chord detection
	 *
	 * @param file - Audio file (MP3, WAV, etc.)
	 * @param minDuration - Minimum chord duration in seconds (default: 0.3)
	 * @param onProgress - Optional progress callback
	 */
	async analyzeFile(
		file: File,
		minDuration: number = 0.3,
		onProgress?: (progress: number) => void
	): Promise<BTCAnalysisResponse> {
		const formData = new FormData();
		formData.append('file', file);

		// Report initial progress
		if (onProgress) onProgress(10);

		const response = await fetch(
			`${this.baseUrl}/analyze?min_duration=${minDuration}`,
			{
				method: 'POST',
				body: formData
			}
		);

		if (onProgress) onProgress(90);

		if (!response.ok) {
			const error = await response.json().catch(() => ({ detail: response.statusText }));
			throw new Error(error.detail || 'Analysis failed');
		}

		const result = await response.json();

		if (onProgress) onProgress(100);

		return result;
	}

	/**
	 * Analyze audio from a Blob (e.g., recorded audio)
	 */
	async analyzeBlob(
		blob: Blob,
		filename: string = 'audio.wav',
		minDuration: number = 0.3
	): Promise<BTCAnalysisResponse> {
		const file = new File([blob], filename, { type: blob.type });
		return this.analyzeFile(file, minDuration);
	}

	/**
	 * Analyze audio from a URL
	 * Note: The URL must be a direct link to an audio file
	 */
	async analyzeUrl(url: string, minDuration: number = 0.3): Promise<BTCAnalysisResponse> {
		const response = await fetch(
			`${this.baseUrl}/analyze/url?url=${encodeURIComponent(url)}&min_duration=${minDuration}`,
			{ method: 'POST' }
		);

		if (!response.ok) {
			const error = await response.json().catch(() => ({ detail: response.statusText }));
			throw new Error(error.detail || 'Analysis failed');
		}

		return response.json();
	}
}

/**
 * Format BTC chord name to display-friendly format
 * e.g., "C:maj7" -> "Cmaj7", "C:min" -> "Cm"
 */
export function formatChordName(chord: string): string {
	if (chord === 'N' || chord === 'X') return 'N.C.'; // No Chord

	// Handle chords without quality (already major)
	if (!chord.includes(':')) return chord;

	const [root, quality] = chord.split(':');

	// Map quality names to common abbreviations
	const qualityMap: Record<string, string> = {
		maj: '',
		min: 'm',
		dim: 'dim',
		aug: 'aug',
		min6: 'm6',
		maj6: '6',
		min7: 'm7',
		minmaj7: 'mM7',
		maj7: 'maj7',
		'7': '7',
		dim7: 'dim7',
		hdim7: 'm7b5',
		sus2: 'sus2',
		sus4: 'sus4'
	};

	const abbrev = qualityMap[quality] ?? quality;
	return `${root}${abbrev}`;
}

/**
 * Get chord color for visualization
 */
export function getChordColor(chord: string): string {
	if (chord === 'N' || chord === 'X' || chord === 'N.C.') {
		return '#666666';
	}

	// Extract root note
	const root = chord.replace(/[^A-G#b]/g, '').charAt(0);

	// Color map based on circle of fifths
	const colorMap: Record<string, string> = {
		C: '#FF6B6B',
		G: '#4ECDC4',
		D: '#45B7D1',
		A: '#96CEB4',
		E: '#FFEAA7',
		B: '#DDA0DD',
		'F#': '#98D8C8',
		Gb: '#98D8C8',
		'C#': '#F7DC6F',
		Db: '#F7DC6F',
		'G#': '#BB8FCE',
		Ab: '#BB8FCE',
		'D#': '#85C1E9',
		Eb: '#85C1E9',
		'A#': '#F8B500',
		Bb: '#F8B500',
		F: '#FF8C00'
	};

	return colorMap[root] || '#888888';
}

/**
 * Check if chord is minor
 */
export function isMinorChord(chord: string): boolean {
	return chord.includes('min') || chord.includes(':min') || /m[^a]/.test(chord);
}

/**
 * Check if chord has seventh
 */
export function hasSeventhChord(chord: string): boolean {
	return chord.includes('7');
}

// Singleton instance
let btcApiInstance: BTCApiClient | null = null;

/**
 * Get the BTC API client singleton
 */
export function getBTCApiClient(baseUrl?: string): BTCApiClient {
	if (!btcApiInstance) {
		btcApiInstance = new BTCApiClient(baseUrl);
	} else if (baseUrl) {
		btcApiInstance.setBaseUrl(baseUrl);
	}
	return btcApiInstance;
}
