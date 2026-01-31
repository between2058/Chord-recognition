/**
 * 系統音頻捕獲模組
 * 支援系統音頻（螢幕分享）和麥克風輸入
 */

export type CaptureMode = 'system' | 'microphone';

export interface AudioCaptureResult {
	stream: MediaStream;
	audioContext: AudioContext;
	analyser: AnalyserNode;
	source: MediaStreamAudioSourceNode;
}

/**
 * 捕獲系統音頻（透過螢幕分享）
 * 注意：用戶需要選擇分享整個螢幕或視窗，並勾選「分享音頻」
 */
export async function captureSystemAudio(): Promise<AudioCaptureResult> {
	console.log('🔊 請求系統音頻權限...');

	// 使用 getDisplayMedia 捕獲系統音頻
	const stream = await navigator.mediaDevices.getDisplayMedia({
		video: true, // 必須包含 video，即使我們只需要音頻
		audio: {
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			sampleRate: 44100
		}
	});

	// 檢查是否有音頻軌道
	const audioTracks = stream.getAudioTracks();
	if (audioTracks.length === 0) {
		// 停止視頻軌道
		stream.getVideoTracks().forEach((track) => track.stop());
		throw new Error('未選擇音頻分享。請重新選擇並勾選「分享音頻」選項。');
	}

	console.log('✅ 系統音頻捕獲成功');

	// 停止視頻軌道（我們只需要音頻）
	stream.getVideoTracks().forEach((track) => track.stop());

	// 創建只有音頻的 stream
	const audioStream = new MediaStream(audioTracks);

	return setupAudioAnalyser(audioStream);
}

/**
 * 捕獲麥克風音頻
 */
export async function captureMicrophone(): Promise<AudioCaptureResult> {
	console.log('🎤 請求麥克風權限...');

	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			sampleRate: 44100
		}
	});

	console.log('✅ 麥克風捕獲成功');

	return setupAudioAnalyser(stream);
}

/**
 * 設置音頻分析器
 */
function setupAudioAnalyser(stream: MediaStream): AudioCaptureResult {
	const audioContext = new AudioContext({ sampleRate: 44100 });
	const source = audioContext.createMediaStreamSource(stream);
	const analyser = audioContext.createAnalyser();

	analyser.fftSize = 4096;
	analyser.smoothingTimeConstant = 0.8;

	source.connect(analyser);

	return {
		stream,
		audioContext,
		analyser,
		source
	};
}

/**
 * 停止捕獲並釋放資源
 */
export function stopCapture(capture: AudioCaptureResult): void {
	capture.stream.getTracks().forEach((track) => track.stop());
	capture.source.disconnect();
	capture.audioContext.close();
}

/**
 * 檢查瀏覽器是否支援系統音頻捕獲
 */
export function isSystemAudioSupported(): boolean {
	return 'getDisplayMedia' in navigator.mediaDevices;
}

/**
 * 檢查瀏覽器是否支援麥克風
 */
export function isMicrophoneSupported(): boolean {
	return 'getUserMedia' in navigator.mediaDevices;
}
