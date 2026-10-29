# 本地模型库 (`model/`)

本目录存放「身临其境（Immersion）」离线建库与在线视觉匹配所需的开源小模型权重与配置文件（全部可本地运行，不依赖任何闭源商业大模型 API）。

---

## 目录结构

```
model/
├── allin1/                        # 音乐曲式结构切分模型 (taejunkim/allinone)
│   └── harmonix-fold0..7.pth      # 8折集成权重，自动切分 intro/verse/chorus/bridge/outro 起止秒数
├── chinese-clip-vit-base-patch16/ # 中文视觉-文本跨模态意境模型 (OFA-Sys/chinese-clip-vit-base-patch16)
│   ├── config.json
│   ├── preprocessor_config.json
│   ├── vocab.txt
│   └── pytorch_model.bin          # 照片 → 512维意境向量 / 与中文意境词库零样本计算余弦相似度
├── emoset-vit/                    # 历史目录名；实际为人脸表情识别模型，本项目不用于风景意境
│   ├── config.json
│   ├── preprocessor_config.json
│   └── model.safetensors          # 识别人脸表情；不接入本轮语义匹配
├── clap-htsat-unfused/            # 音频段落跨模态特征提取模型 (laion/clap-htsat-unfused)
│   ├── config.json
│   ├── preprocessor_config.json
│   ├── tokenizer.json
│   └── pytorch_model.bin          # 音乐切片音频 → 512维语义向量
└── download_models.mjs            # 断点续传/校验下载脚本（使用国内 hf-mirror 镜像源）
```

---

## 重新校验或补全下载

如果移动了目录或需要重新校验完整性，可在项目根目录运行：

```bash
node model/download_models.mjs all
```
