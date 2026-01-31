#!/usr/bin/env python3
"""
將 Keras HDF5 模型轉換為 TensorFlow.js 格式
"""

import os
import json
import numpy as np

# 嘗試導入必要的庫
try:
    import tensorflow as tf
    print(f"TensorFlow version: {tf.__version__}")
except ImportError:
    print("ERROR: TensorFlow not installed")
    exit(1)

# 模型路徑配置
MODELS = {
    'model1': {
        'input': '/home/user/Chord-recognition/model/system/model1/keypoint_classifier.hdf5',
        'output': '/home/user/Chord-recognition/web/static/models/model1',
        'labels': ['Barre', 'Open']
    },
    'model2': {
        'input': '/home/user/Chord-recognition/model/system/model2/keypoint_classifier.hdf5',
        'output': '/home/user/Chord-recognition/web/static/models/model2',
        'labels': ['E or Am shape', 'Em shape', 'A shape']
    },
    'model3': {
        'input': '/home/user/Chord-recognition/model/system/model3/keypoint_classifier.hdf5',
        'output': '/home/user/Chord-recognition/web/static/models/model3',
        'labels': ['C or F', 'E or Am', 'Other']
    },
    'model4': {
        'input': '/home/user/Chord-recognition/model/system/model4/keypoint_classifier.hdf5',
        'output': '/home/user/Chord-recognition/web/static/models/model4',
        'labels': ['Em', 'G', 'A', 'D']
    }
}

def convert_to_tfjs_layers_model(model_name, config):
    """將 Keras 模型轉換為 TensorFlow.js Layers Model 格式"""

    input_path = config['input']
    output_dir = config['output']
    labels = config['labels']

    print(f"\n{'='*50}")
    print(f"轉換 {model_name}")
    print(f"輸入: {input_path}")
    print(f"輸出: {output_dir}")
    print(f"標籤: {labels}")
    print(f"{'='*50}")

    # 檢查輸入文件是否存在
    if not os.path.exists(input_path):
        print(f"ERROR: 找不到模型文件 {input_path}")
        return False

    # 創建輸出目錄
    os.makedirs(output_dir, exist_ok=True)

    try:
        # 載入 Keras 模型
        print("載入 Keras 模型...")
        model = tf.keras.models.load_model(input_path)
        model.summary()

        # 獲取模型結構
        model_config = model.get_config()
        weights = model.get_weights()

        # 創建 TFJS 格式的 model.json
        tfjs_model = create_tfjs_model_json(model, model_name)

        # 保存 model.json
        model_json_path = os.path.join(output_dir, 'model.json')
        with open(model_json_path, 'w') as f:
            json.dump(tfjs_model, f, indent=2)
        print(f"已保存: {model_json_path}")

        # 保存權重為二進制文件
        weights_path = os.path.join(output_dir, 'group1-shard1of1.bin')
        save_weights_to_binary(weights, weights_path)
        print(f"已保存: {weights_path}")

        # 保存標籤文件
        labels_path = os.path.join(output_dir, 'labels.json')
        with open(labels_path, 'w') as f:
            json.dump(labels, f, indent=2)
        print(f"已保存: {labels_path}")

        print(f"✅ {model_name} 轉換成功!")
        return True

    except Exception as e:
        print(f"❌ 轉換失敗: {e}")
        import traceback
        traceback.print_exc()
        return False

def create_tfjs_model_json(model, model_name):
    """創建 TensorFlow.js 格式的 model.json"""

    # 獲取模型配置
    config = model.get_config()
    weights = model.get_weights()

    # 計算權重大小
    total_bytes = sum(w.nbytes for w in weights)

    # 構建權重規格
    weights_manifest = []
    weight_specs = []

    for i, layer in enumerate(model.layers):
        layer_weights = layer.get_weights()
        for j, w in enumerate(layer_weights):
            weight_name = f"{layer.name}/{['kernel', 'bias'][j]}"
            weight_specs.append({
                "name": weight_name,
                "shape": list(w.shape),
                "dtype": "float32"
            })

    weights_manifest.append({
        "paths": ["group1-shard1of1.bin"],
        "weights": weight_specs
    })

    # 構建模型拓撲
    model_topology = {
        "class_name": "Sequential",
        "config": {
            "name": model_name,
            "layers": []
        },
        "keras_version": "2.15.0",
        "backend": "tensorflow"
    }

    for layer in config['layers']:
        layer_config = {
            "class_name": layer['class_name'],
            "config": layer['config']
        }
        model_topology['config']['layers'].append(layer_config)

    return {
        "format": "layers-model",
        "generatedBy": "keras2tfjs-converter",
        "convertedBy": "custom-script",
        "modelTopology": model_topology,
        "weightsManifest": weights_manifest
    }

def save_weights_to_binary(weights, filepath):
    """將權重保存為二進制文件"""

    # 將所有權重連接成一個 float32 數組
    all_weights = []
    for w in weights:
        all_weights.append(w.astype(np.float32).flatten())

    concatenated = np.concatenate(all_weights)

    # 保存為二進制文件
    concatenated.tofile(filepath)
    print(f"  權重大小: {len(concatenated)} floats ({concatenated.nbytes} bytes)")

def main():
    print("🎸 吉他和弦識別模型轉換器")
    print("將 Keras HDF5 模型轉換為 TensorFlow.js 格式\n")

    success_count = 0
    fail_count = 0

    for model_name, config in MODELS.items():
        if convert_to_tfjs_layers_model(model_name, config):
            success_count += 1
        else:
            fail_count += 1

    print(f"\n{'='*50}")
    print(f"轉換完成!")
    print(f"成功: {success_count}, 失敗: {fail_count}")
    print(f"{'='*50}")

if __name__ == '__main__':
    main()
