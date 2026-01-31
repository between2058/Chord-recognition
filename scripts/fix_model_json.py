#!/usr/bin/env python3
"""
修復 Keras 3.x 格式的 model.json 為 TensorFlow.js 兼容格式
主要修改：
1. batch_shape → batchInputShape
2. 簡化 dtype 格式
3. 清理 Keras 3.x 特有字段
"""

import json
import os
from pathlib import Path


def fix_dtype(config):
    """將複雜的 dtype 格式簡化為字符串"""
    if isinstance(config.get('dtype'), dict):
        dtype_config = config['dtype']
        if 'config' in dtype_config and 'name' in dtype_config['config']:
            config['dtype'] = dtype_config['config']['name']
        elif 'class_name' in dtype_config:
            config['dtype'] = 'float32'  # 默認
    return config


def fix_initializer(init_config):
    """簡化 initializer 格式"""
    if isinstance(init_config, dict):
        class_name = init_config.get('class_name', '')
        if class_name == 'GlorotUniform':
            return {'class_name': 'GlorotUniform', 'config': {'seed': None}}
        elif class_name == 'Zeros':
            return {'class_name': 'Zeros', 'config': {}}
        elif class_name == 'Ones':
            return {'class_name': 'Ones', 'config': {}}
    return init_config


def fix_layer_config(layer):
    """修復單個 layer 的配置"""
    config = layer.get('config', {})

    # 修復 InputLayer
    if layer.get('class_name') == 'InputLayer':
        # batch_shape → batchInputShape
        if 'batch_shape' in config:
            config['batchInputShape'] = config.pop('batch_shape')
        # 確保有 batch_input_shape（舊版 TF.js 格式）
        if 'batchInputShape' in config:
            config['batch_input_shape'] = config['batchInputShape']
        # 移除不需要的字段
        config.pop('optional', None)

    # 修復 dtype
    fix_dtype(config)

    # 修復 initializers
    if 'kernel_initializer' in config:
        config['kernel_initializer'] = fix_initializer(config['kernel_initializer'])
    if 'bias_initializer' in config:
        config['bias_initializer'] = fix_initializer(config['bias_initializer'])

    # 移除 quantization_config
    config.pop('quantization_config', None)

    layer['config'] = config
    return layer


def fix_model_json(model_path):
    """修復單個 model.json 文件"""
    with open(model_path, 'r') as f:
        model = json.load(f)

    # 修復 modelTopology.config.layers
    if 'modelTopology' in model:
        topology = model['modelTopology']
        if 'config' in topology and 'layers' in topology['config']:
            layers = topology['config']['layers']
            topology['config']['layers'] = [fix_layer_config(layer) for layer in layers]

    # 確保格式正確
    model['format'] = 'layers-model'

    # 寫回文件
    with open(model_path, 'w') as f:
        json.dump(model, f, indent=2)

    print(f"✅ 已修復: {model_path}")


def main():
    web_dir = Path(__file__).parent.parent / 'web' / 'static' / 'models'

    if not web_dir.exists():
        print(f"❌ 模型目錄不存在: {web_dir}")
        return

    # 修復所有 model.json
    for model_dir in web_dir.iterdir():
        if model_dir.is_dir():
            model_json = model_dir / 'model.json'
            if model_json.exists():
                try:
                    fix_model_json(model_json)
                except Exception as e:
                    print(f"❌ 修復失敗 {model_json}: {e}")


if __name__ == '__main__':
    main()
