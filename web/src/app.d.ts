// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

// YouTube IFrame API 類型定義
declare namespace YT {
	class Player {
		constructor(elementId: string, options: PlayerOptions);
		playVideo(): void;
		pauseVideo(): void;
		stopVideo(): void;
		seekTo(seconds: number, allowSeekAhead: boolean): void;
		getCurrentTime(): number;
		getDuration(): number;
		getPlayerState(): number;
		destroy(): void;
	}

	interface PlayerOptions {
		height?: string | number;
		width?: string | number;
		videoId?: string;
		playerVars?: PlayerVars;
		events?: PlayerEvents;
	}

	interface PlayerVars {
		autoplay?: 0 | 1;
		controls?: 0 | 1;
		modestbranding?: 0 | 1;
		rel?: 0 | 1;
		showinfo?: 0 | 1;
		start?: number;
	}

	interface PlayerEvents {
		onReady?: (event: PlayerEvent) => void;
		onStateChange?: (event: OnStateChangeEvent) => void;
		onError?: (event: OnErrorEvent) => void;
	}

	interface PlayerEvent {
		target: Player;
	}

	interface OnStateChangeEvent {
		target: Player;
		data: number;
	}

	interface OnErrorEvent {
		target: Player;
		data: number;
	}
}

declare global {
	interface Window {
		YT: typeof YT;
		onYouTubeIframeAPIReady: () => void;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
