/**
 * WebGPU 支援檢測工具
 * 檢測瀏覽器是否支援 WebGPU，用於決定 TensorFlow.js 後端
 */

export interface WebGPUStatus {
	supported: boolean;
	adapter: GPUAdapter | null;
	device: GPUDevice | null;
	adapterInfo: GPUAdapterInfo | null;
	error: string | null;
}

/**
 * 檢測 WebGPU 支援狀態
 */
export async function checkWebGPUSupport(): Promise<WebGPUStatus> {
	const result: WebGPUStatus = {
		supported: false,
		adapter: null,
		device: null,
		adapterInfo: null,
		error: null
	};

	// 檢查 navigator.gpu 是否存在
	if (!navigator.gpu) {
		result.error = 'WebGPU 不支援：navigator.gpu 不存在';
		return result;
	}

	try {
		// 請求 GPU 適配器
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			result.error = 'WebGPU 不支援：無法獲取 GPU 適配器';
			return result;
		}
		result.adapter = adapter;

		// 獲取適配器資訊
		result.adapterInfo = await adapter.requestAdapterInfo();

		// 請求 GPU 設備
		const device = await adapter.requestDevice();
		result.device = device;
		result.supported = true;

		console.log('✅ WebGPU 支援檢測通過');
		console.log('GPU 資訊:', {
			vendor: result.adapterInfo.vendor,
			architecture: result.adapterInfo.architecture,
			description: result.adapterInfo.description
		});
	} catch (e) {
		result.error = `WebGPU 初始化失敗: ${e instanceof Error ? e.message : String(e)}`;
	}

	return result;
}

/**
 * 獲取推薦的 TensorFlow.js 後端
 */
export async function getRecommendedBackend(): Promise<'webgpu' | 'webgl' | 'cpu'> {
	const status = await checkWebGPUSupport();

	if (status.supported) {
		return 'webgpu';
	}

	// 檢查 WebGL 支援
	const canvas = document.createElement('canvas');
	const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

	if (gl) {
		return 'webgl';
	}

	return 'cpu';
}
