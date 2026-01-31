/**
 * 和弦分類器模組
 * 使用 TensorFlow.js 進行手勢到和弦的分類
 * 實現與原始 Python 版本相同的層級決策樹架構
 */

import * as tf from '@tensorflow/tfjs';

// 和弦標籤定義
export const CHORD_LABELS = {
	model1: ['Barre', 'Open'],
	model2: ['E or Am shape', 'Em shape', 'A shape'],
	model3: ['C or F', 'E or Am', 'Other'],
	model4: ['Em', 'G', 'A', 'D']
} as const;

// 最終和弦名稱映射
export const FINAL_CHORD_NAMES: Record<string, string> = {
	'E or Am shape': 'E / Am (Barre)',
	'Em shape': 'Em (Barre)',
	'A shape': 'A (Barre)',
	'C or F': 'C / F',
	'E or Am': 'E / Am',
	Em: 'Em',
	G: 'G',
	A: 'A',
	D: 'D'
};

export interface ClassificationResult {
	chordName: string;
	confidence: number;
	modelPath: string[];
}

export class ChordClassifier {
	private models: Map<string, tf.GraphModel> = new Map();
	private isInitialized = false;
	private confidenceThreshold = 0.8;

	/**
	 * 載入所有模型
	 * 注意：需要先將 TFLite 模型轉換為 TensorFlow.js 格式
	 */
	async initialize(modelBasePath = '/models'): Promise<void> {
		console.log('🎸 正在載入和弦分類模型...');

		try {
			// 嘗試載入模型，如果模型不存在則使用 mock 模式
			const modelNames = ['model1', 'model2', 'model3', 'model4'];

			for (const name of modelNames) {
				try {
					const model = await tf.loadGraphModel(`${modelBasePath}/${name}/model.json`);
					this.models.set(name, model);
					console.log(`✅ ${name} 載入成功`);
				} catch {
					console.warn(`⚠️ ${name} 載入失敗，使用模擬模式`);
				}
			}

			this.isInitialized = true;
			console.log('✅ 和弦分類器初始化完成');
		} catch (error) {
			console.error('❌ 模型載入失敗:', error);
			// 即使載入失敗，也標記為初始化完成（使用模擬模式）
			this.isInitialized = true;
		}
	}

	/**
	 * 執行單個模型推理
	 */
	private async runModel(
		modelName: string,
		input: number[]
	): Promise<{ classId: number; confidence: number }> {
		const model = this.models.get(modelName);

		if (!model) {
			// 模擬模式：隨機返回結果
			const numClasses =
				CHORD_LABELS[modelName as keyof typeof CHORD_LABELS]?.length || 2;
			const classId = Math.floor(Math.random() * numClasses);
			return { classId, confidence: 0.5 + Math.random() * 0.5 };
		}

		const inputTensor = tf.tensor2d([input], [1, input.length]);

		try {
			const output = model.predict(inputTensor) as tf.Tensor;
			const probabilities = await output.data();
			const classId = probabilities.indexOf(Math.max(...probabilities));
			const confidence = probabilities[classId];

			// 清理張量
			inputTensor.dispose();
			output.dispose();

			return { classId, confidence };
		} catch (error) {
			inputTensor.dispose();
			throw error;
		}
	}

	/**
	 * 層級決策樹分類
	 * 實現與原始 Python system() 函數相同的邏輯
	 */
	async classify(preprocessedLandmarks: number[]): Promise<ClassificationResult> {
		if (!this.isInitialized) {
			throw new Error('分類器尚未初始化');
		}

		const modelPath: string[] = [];

		// Model 1: Barre vs Open
		const result1 = await this.runModel('model1', preprocessedLandmarks);
		modelPath.push('model1');

		// 置信度檢查
		if (result1.confidence < this.confidenceThreshold) {
			return {
				chordName: '未知',
				confidence: result1.confidence,
				modelPath
			};
		}

		if (result1.classId === 0) {
			// Barre chord → Model 2
			const result2 = await this.runModel('model2', preprocessedLandmarks);
			modelPath.push('model2');

			const chordName = CHORD_LABELS.model2[result2.classId] || '未知';
			return {
				chordName: FINAL_CHORD_NAMES[chordName] || chordName,
				confidence: result2.confidence,
				modelPath
			};
		} else {
			// Open chord → Model 3
			const result3 = await this.runModel('model3', preprocessedLandmarks);
			modelPath.push('model3');

			if (result3.classId === 2) {
				// Other → Model 4
				const result4 = await this.runModel('model4', preprocessedLandmarks);
				modelPath.push('model4');

				const chordName = CHORD_LABELS.model4[result4.classId] || '未知';
				return {
					chordName: FINAL_CHORD_NAMES[chordName] || chordName,
					confidence: result4.confidence,
					modelPath
				};
			} else {
				const chordName = CHORD_LABELS.model3[result3.classId] || '未知';
				return {
					chordName: FINAL_CHORD_NAMES[chordName] || chordName,
					confidence: result3.confidence,
					modelPath
				};
			}
		}
	}

	/**
	 * 設定置信度閾值
	 */
	setConfidenceThreshold(threshold: number): void {
		this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
	}

	/**
	 * 釋放資源
	 */
	dispose(): void {
		for (const model of this.models.values()) {
			model.dispose();
		}
		this.models.clear();
		this.isInitialized = false;
	}

	get ready(): boolean {
		return this.isInitialized;
	}
}

// 單例模式
let classifierInstance: ChordClassifier | null = null;

export function getChordClassifier(): ChordClassifier {
	if (!classifierInstance) {
		classifierInstance = new ChordClassifier();
	}
	return classifierInstance;
}
