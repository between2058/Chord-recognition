<script lang="ts">
	import { systemStatus, showDebug } from '$lib/stores/appState';

	function getStatusIcon(status: string): string {
		switch (status) {
			case 'active':
			case 'ready':
			case 'supported':
				return '✅';
			case 'loading':
			case 'requesting':
			case 'checking':
				return '⏳';
			case 'error':
			case 'unsupported':
				return '❌';
			default:
				return '⚪';
		}
	}

	function getStatusText(status: string): string {
		switch (status) {
			case 'active':
				return '啟用';
			case 'ready':
				return '就緒';
			case 'supported':
				return '支援';
			case 'loading':
				return '載入中';
			case 'requesting':
				return '請求中';
			case 'checking':
				return '檢查中';
			case 'error':
				return '錯誤';
			case 'unsupported':
				return '不支援';
			case 'inactive':
				return '未啟用';
			default:
				return status;
		}
	}
</script>

<div class="chord-card">
	<div class="flex justify-between items-center mb-3">
		<h3 class="text-sm font-semibold text-gray-300">系統狀態</h3>
		<button
			class="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
			on:click={() => showDebug.update((v) => !v)}
		>
			{$showDebug ? '隱藏除錯' : '顯示除錯'}
		</button>
	</div>

	<div class="grid grid-cols-2 gap-2 text-sm">
		<div class="flex items-center gap-2">
			<span>{getStatusIcon($systemStatus.webgpu)}</span>
			<span class="text-gray-400">WebGPU:</span>
			<span class="font-medium">{getStatusText($systemStatus.webgpu)}</span>
		</div>

		<div class="flex items-center gap-2">
			<span>{getStatusIcon($systemStatus.camera)}</span>
			<span class="text-gray-400">攝像頭:</span>
			<span class="font-medium">{getStatusText($systemStatus.camera)}</span>
		</div>

		<div class="flex items-center gap-2">
			<span>{getStatusIcon($systemStatus.microphone)}</span>
			<span class="text-gray-400">麥克風:</span>
			<span class="font-medium">{getStatusText($systemStatus.microphone)}</span>
		</div>

		<div class="flex items-center gap-2">
			<span>{getStatusIcon($systemStatus.handTracking)}</span>
			<span class="text-gray-400">手部追蹤:</span>
			<span class="font-medium">{getStatusText($systemStatus.handTracking)}</span>
		</div>

		<div class="flex items-center gap-2 col-span-2">
			<span>{getStatusIcon($systemStatus.chordModel)}</span>
			<span class="text-gray-400">和弦模型:</span>
			<span class="font-medium">{getStatusText($systemStatus.chordModel)}</span>
		</div>
	</div>
</div>
