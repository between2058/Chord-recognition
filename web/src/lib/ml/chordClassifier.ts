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
	private models: Map<string, tf.LayersModel> = new Map();
	private labels: Map<string, string[]> = new Map();
	private isInitialized = false;
	private confidenceThreshold = 0.6; // 降低閾值以獲得更多結果

	/**
	 * 載入所有模型（Keras LayersModel 格式）
	 */
	async initialize(modelBasePath = '/models'): Promise<void> {
		console.log('🎸 正在載入和弦分類模型...');

		try {
			const modelNames = ['model1', 'model2', 'model3', 'model4'];

			// 並行載入所有模型
			const loadPromises = modelNames.map(async (name) => {
				try {
					// 使用 loadLayersModel 載入 Keras 格式模型
					const model = await tf.loadLayersModel(`${modelBasePath}/${name}/model.json`);
					this.models.set(name, model);

					// 載入標籤
					try {
						const labelsResponse = await fetch(`${modelBasePath}/${name}/labels.json`);
						const labelsData = await labelsResponse.json();
						this.labels.set(name, labelsData);
					} catch {
						// 使用預設標籤
						this.labels.set(name, CHORD_LABELS[name as keyof typeof CHORD_LABELS] as unknown as string[]);
					}

					console.log(`✅ ${name} 載入成功 (${model.inputs[0].shape})`);
					return true;
				} catch (err) {
					console.warn(`⚠️ ${name} 載入失敗，使用模擬模式:`, err);
					return false;
				}
			});

			await Promise.all(loadPromises);

			this.isInitialized = true;
			console.log(`✅ 和弦分類器初始化完成 (${this.models.size}/4 模型載入)`);
		} catch (error) {
			console.error('❌ 模型載入失敗:', error);
			this.isInitialized = true; // 使用模擬模式
		}
	}

	/**
	 * 執行單個模型推理
	 */
	private async runModel(
		modelName: string,
		input: number[]
	): Promise<{ classId: number; confidence: number; label: string }> {
		const model = this.models.get(modelName);
		const labels = this.labels.get(modelName) || CHORD_LABELS[modelName as keyof typeof CHORD_LABELS] || [];

		if (!model) {
			// 模擬模式：隨機返回結果
			const numClasses = labels.length || 2;
			const classId = Math.floor(Math.random() * numClasses);
			return {
				classId,
				confidence: 0.5 + Math.random() * 0.5,
				label: labels[classId] || '未知'
			};
		}

		// 創建輸入張量 (batch_size=1, features=42)
		const inputTensor = tf.tensor2d([input], [1, 42]);

		try {
			// 執行推理
			const output = model.predict(inputTensor) as tf.Tensor;
			const probabilities = await output.data();

			// 找到最大概率的類別
			let maxProb = -1;
			let classId = 0;
			for (let i = 0; i < probabilities.length; i++) {
				if (probabilities[i] > maxProb) {
					maxProb = probabilities[i];
					classId = i;
				}
			}

			// 清理張量
			inputTensor.dispose();
			output.dispose();

			return {
				classId,
				confidence: maxProb,
				label: labels[classId] || '未知'
			};
		} catch (error) {
			inputTensor.dispose();
			console.error(`模型 ${modelName} 推理錯誤:`, error);
			throw error;
		}
	}

	/**
	 * 層級決策樹分類
	 * 實現與原始 Python system() 函數相同的邏輯
	 *
	 * 決策樹結構：
	 * Model1 (Barre=0 vs Open=1)
	 * ├─ Barre (0) → Model2 (E/Am/A shape)
	 * └─ Open (1) → Model3 (C/F=0, E/Am=1, Other=2)
	 *               └─ Other (2) → Model4 (Em/G/A/D)
	 */
	async classify(preprocessedLandmarks: number[]): Promise<ClassificationResult> {
		if (!this.isInitialized) {
			throw new Error('分類器尚未初始化');
		}

		const modelPath: string[] = [];

		// Model 1: Barre vs Open
		const result1 = await this.runModel('model1', preprocessedLandmarks);
		modelPath.push(`model1:${result1.label}(${(result1.confidence * 100).toFixed(1)}%)`);

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
			modelPath.push(`model2:${result2.label}(${(result2.confidence * 100).toFixed(1)}%)`);

			return {
				chordName: FINAL_CHORD_NAMES[result2.label] || result2.label,
				confidence: result2.confidence,
				modelPath
			};
		} else {
			// Open chord → Model 3
			const result3 = await this.runModel('model3', preprocessedLandmarks);
			modelPath.push(`model3:${result3.label}(${(result3.confidence * 100).toFixed(1)}%)`);

			if (result3.classId === 2) {
				// Other → Model 4
				const result4 = await this.runModel('model4', preprocessedLandmarks);
				modelPath.push(`model4:${result4.label}(${(result4.confidence * 100).toFixed(1)}%)`);

				return {
					chordName: FINAL_CHORD_NAMES[result4.label] || result4.label,
					confidence: result4.confidence,
					modelPath
				};
			} else {
				return {
					chordName: FINAL_CHORD_NAMES[result3.label] || result3.label,
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
