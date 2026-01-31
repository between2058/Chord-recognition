# 🎸 吉他和弦自學神器 - Web 版

基於 AI 的即時吉他和弦識別 Web 應用，支援視覺和音頻雙重識別。

## 功能特點

- **🖐️ 手部姿態追蹤**：使用 MediaPipe 檢測 21 個手部關鍵點
- **🎵 音頻和弦識別**：使用 Chromagram 分析即時音頻
- **🔗 多模態融合**：視覺 (70%) + 音頻 (30%) 智能融合
- **⚡ WebGPU 加速**：在 MacBook 上使用 GPU 加速推理
- **📱 跨平台**：瀏覽器即可運行，無需安裝

## 技術架構

```
┌─────────────────────────────────────────────────────────┐
│                    Web 瀏覽器應用                        │
├─────────────────────────────────────────────────────────┤
│  前端框架    │  Svelte 5 + Vite + TypeScript            │
│  樣式       │  Tailwind CSS                             │
│  手部追蹤    │  @mediapipe/tasks-vision                  │
│  ML 推理    │  TensorFlow.js + WebGPU backend           │
│  音頻處理    │  Web Audio API + AudioWorklet             │
└─────────────────────────────────────────────────────────┘
```

## 專案結構

```
web/
├── src/
│   ├── lib/
│   │   ├── components/          # Svelte UI 組件
│   │   │   ├── CameraView.svelte      # 攝像頭 + 手部追蹤
│   │   │   ├── ChordDisplay.svelte    # 和弦顯示
│   │   │   ├── AudioVisualizer.svelte # 音頻視覺化
│   │   │   └── StatusBar.svelte       # 系統狀態
│   │   ├── ml/                  # 機器學習模組
│   │   │   ├── handTracker.ts         # MediaPipe 封裝
│   │   │   ├── chordClassifier.ts     # TensorFlow.js 分類器
│   │   │   └── audioAnalyzer.ts       # 音頻分析 + Chromagram
│   │   ├── stores/              # Svelte 狀態管理
│   │   │   └── appState.ts            # 應用狀態
│   │   └── utils/               # 工具函數
│   │       └── webgpuCheck.ts         # WebGPU 檢測
│   └── routes/
│       └── +page.svelte         # 主頁面
├── static/
│   ├── images/                  # 和弦圖片
│   └── models/                  # TensorFlow.js 模型（需轉換）
└── package.json
```

## 快速開始

### 安裝依賴

```bash
cd web
npm install
```

### 開發模式

```bash
npm run dev
```

瀏覽器打開 http://localhost:5173

### 生產構建

```bash
npm run build
npm run preview
```

## 核心模組說明

### HandTracker (手部追蹤)

使用 MediaPipe Tasks Vision 進行即時手部關鍵點檢測：

```typescript
import { getHandTracker } from '$lib/ml/handTracker';

const tracker = getHandTracker();
await tracker.initialize();

// 檢測視頻幀
const results = tracker.detectForVideo(videoElement, timestamp);

// 預處理為模型輸入（42 維向量）
const features = tracker.preprocessLandmarks(results.landmarks[0]);
```

### ChordClassifier (和弦分類)

實現層級決策樹架構：

```
Model1 (Barre vs Open)
├─ Barre → Model2 (E/Am/A shape)
└─ Open → Model3 (C/F vs E/Am vs Other)
          └─ Other → Model4 (Em/G/A/D)
```

```typescript
import { getChordClassifier } from '$lib/ml/chordClassifier';

const classifier = getChordClassifier();
await classifier.initialize();

const result = await classifier.classify(features);
console.log(result.chordName, result.confidence);
```

### AudioAnalyzer (音頻分析)

使用 Chromagram 進行和弦識別：

```typescript
import { getAudioAnalyzer } from '$lib/ml/audioAnalyzer';

const analyzer = getAudioAnalyzer();
await analyzer.initialize();

// 即時和弦檢測
const detection = analyzer.detectChord();
console.log(detection.chord, detection.confidence);

// 獲取 Chromagram 數據
const chromagram = analyzer.computeChromagram();
```

## 多模態融合

視覺和音頻識別結果使用加權融合：

```typescript
// 在 appState.ts 中定義
const VISION_WEIGHT = 0.7;
const AUDIO_WEIGHT = 0.3;

// 如果兩者識別相同，額外加成 10%
if (visionChord === audioChord) {
  confidence += 0.1;
}
```

## 瀏覽器支援

| 瀏覽器 | WebGPU | 攝像頭 | 麥克風 |
|--------|--------|--------|--------|
| Chrome 113+ | ✅ | ✅ | ✅ |
| Safari 26+ | ✅ | ✅ | ✅ |
| Firefox 145+ | ✅ | ✅ | ✅ |
| Edge 113+ | ✅ | ✅ | ✅ |

## 模型轉換

將現有的 TFLite 模型轉換為 TensorFlow.js 格式：

```bash
# 安裝轉換工具
pip install tensorflowjs

# 轉換模型
tensorflowjs_converter \
  --input_format=tf_saved_model \
  --output_format=tfjs_graph_model \
  ../model/system/model1/ \
  static/models/model1/
```

## 支援的和弦

| 類型 | 和弦 |
|------|------|
| 大三和弦 | C, D, E, F, G, A |
| 小三和弦 | Am, Dm, Em |
| 七和弦 | G7, C7, D7 |
| Barre 和弦 | E shape, Am shape, A shape |

## 開發指南

### 添加新和弦

1. 在 `audioAnalyzer.ts` 的 `CHORD_TEMPLATES` 添加 Chromagram 模板
2. 在 `chordClassifier.ts` 的 `FINAL_CHORD_NAMES` 添加標籤
3. 在 `static/images/` 添加和弦圖片

### 調整融合權重

修改 `stores/appState.ts` 中的 `fusedChord` derived store：

```typescript
const VISION_WEIGHT = 0.7;  // 調整視覺權重
const AUDIO_WEIGHT = 0.3;   // 調整音頻權重
```

## 授權

MIT License

## 致謝

- [MediaPipe](https://developers.google.com/mediapipe) - 手部追蹤
- [TensorFlow.js](https://www.tensorflow.org/js) - 瀏覽器 ML 推理
- [Svelte](https://svelte.dev/) - 前端框架
