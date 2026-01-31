/**
 * YouTube 音頻提取模組
 * 使用 Cobalt API 從 YouTube 提取音頻
 */

// Cobalt API 端點列表（如果一個失敗，嘗試下一個）
// 注意：大多數公共實例現在需要 API 金鑰或 Turnstile 驗證
const COBALT_INSTANCES = [
	'https://cobalt.weasel.is',
	'https://co.eepy.today',
	'https://cobalt.canine.tools',
	'https://api.cobalt.tools'
];

export interface YouTubeAudioResult {
	success: boolean;
	audioUrl?: string;
	filename?: string;
	error?: string;
}

export interface CobaltResponse {
	status: 'tunnel' | 'redirect' | 'picker' | 'error';
	url?: string;
	filename?: string;
	audio?: string;
	picker?: Array<{ url: string; type: string }>;
	text?: string;
}

/**
 * 從 YouTube URL 提取音頻下載連結
 */
export async function extractYouTubeAudio(
	youtubeUrl: string,
	onProgress?: (message: string) => void
): Promise<YouTubeAudioResult> {
	const log = (msg: string) => {
		console.log(`[YouTube] ${msg}`);
		onProgress?.(msg);
	};

	log('開始提取 YouTube 音頻...');

	// 嘗試每個 Cobalt 實例
	for (const instance of COBALT_INSTANCES) {
		try {
			log(`嘗試 API: ${instance}`);

			const response = await fetch(`${instance}/`, {
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					url: youtubeUrl,
					downloadMode: 'audio',
					audioFormat: 'mp3',
					audioBitrate: '128',
					filenameStyle: 'basic',
					disableMetadata: false
				})
			});

			if (!response.ok) {
				log(`API 返回錯誤: ${response.status}`);
				continue;
			}

			const data: CobaltResponse = await response.json();
			log(`API 回應狀態: ${data.status}`);

			if (data.status === 'error') {
				log(`錯誤: ${data.text}`);
				continue;
			}

			// 處理不同的回應類型
			if (data.status === 'tunnel' || data.status === 'redirect') {
				const audioUrl = data.url || data.audio;
				if (audioUrl) {
					log('成功獲取音頻連結！');
					return {
						success: true,
						audioUrl,
						filename: data.filename || 'youtube-audio.mp3'
					};
				}
			}

			if (data.status === 'picker' && data.picker) {
				// 選擇音頻選項
				const audioOption = data.picker.find(
					(p) => p.type === 'audio' || p.url.includes('audio')
				);
				if (audioOption) {
					log('從選項中選擇音頻...');
					return {
						success: true,
						audioUrl: audioOption.url,
						filename: data.filename || 'youtube-audio.mp3'
					};
				}
			}
		} catch (error) {
			log(`API 請求失敗: ${(error as Error).message}`);
			continue;
		}
	}

	return {
		success: false,
		error: '所有 API 實例都無法使用。請嘗試上傳本地檔案。'
	};
}

/**
 * 下載音頻並轉換為 ArrayBuffer
 */
export async function downloadAudioAsArrayBuffer(
	audioUrl: string,
	onProgress?: (percentage: number) => void
): Promise<ArrayBuffer> {
	console.log('[YouTube] 開始下載音頻...');

	const response = await fetch(audioUrl);

	if (!response.ok) {
		throw new Error(`下載失敗: ${response.status}`);
	}

	const contentLength = response.headers.get('Content-Length');
	const total = contentLength ? parseInt(contentLength, 10) : 0;

	if (!response.body) {
		throw new Error('無法讀取回應內容');
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;

	while (true) {
		const { done, value } = await reader.read();

		if (done) break;

		chunks.push(value);
		received += value.length;

		if (total > 0 && onProgress) {
			onProgress((received / total) * 100);
		}
	}

	// 合併所有 chunks
	const arrayBuffer = new Uint8Array(received);
	let position = 0;
	for (const chunk of chunks) {
		arrayBuffer.set(chunk, position);
		position += chunk.length;
	}

	console.log(`[YouTube] 下載完成: ${(received / 1024 / 1024).toFixed(2)} MB`);

	return arrayBuffer.buffer;
}

/**
 * 從 YouTube URL 提取視頻 ID
 */
export function extractVideoId(url: string): string | null {
	const patterns = [
		/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
		/youtube\.com\/shorts\/([^&\n?#]+)/,
		/youtube\.com\/live\/([^&\n?#]+)/
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) return match[1];
	}

	return null;
}

/**
 * 獲取 YouTube 視頻縮圖
 */
export function getThumbnailUrl(videoId: string): string {
	return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

/**
 * 獲取 YouTube 視頻信息（通過 oEmbed API）
 */
export async function getVideoInfo(
	youtubeUrl: string
): Promise<{ title: string; author: string; thumbnail: string } | null> {
	try {
		const response = await fetch(
			`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`
		);

		if (!response.ok) return null;

		const data = await response.json();
		return {
			title: data.title,
			author: data.author_name,
			thumbnail: data.thumbnail_url
		};
	} catch {
		return null;
	}
}
