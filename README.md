# 身临其境（Immersion）

上传一张照片，从曲库中找到契合照片氛围的一首歌，并从匹配的音乐段落开始播放。

本项目只做已有音乐的检索与匹配，不生成音乐。前端保持零依赖、单文件；已接入本地 Chinese-CLIP 图像推理和 CLAP 音乐段落语义索引。通过本地服务打开时优先语义匹配；服务不可用时明确标注并回退为原有色彩规则。

## 启动本地语义版本

当前电脑已准备好项目 `.venv`、模型和 165 个音乐段落索引。在项目目录运行：

```powershell
.\.venv\Scripts\python.exe -X utf8 -m server.app
```

打开 http://127.0.0.1:8765，上传照片后应显示“本地语义匹配”。也可以运行 `start_local.ps1`。本次已在 CPU 上实际验证；现有 CUDA 构建不支持本机显卡架构，自动模式会做实际算子测试，失败后回退 CPU。

如果双击 `index.html` 后看到“色彩匹配 · 本地语义服务未连接”，当前结果来自旧色彩规则。请点击页面中的“打开本地语义版”入口，或直接访问上述地址，再上传照片；若地址打不开，先运行启动命令。语义方案仍可能合理地推荐同一首歌，请以匹配状态判断是否成功接入。

新环境安装与建库：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -X utf8 pipeline\build_semantic_index.py --device cpu
.\.venv\Scripts\python.exe -X utf8 -m server.app
```

需有 FFmpeg、Node.js、本地模型权重及 `demo list/` 音频。当前电脑使用首选 Python 3.14 创建环境，并复用已安装的 PyTorch；新增依赖安装在项目环境中。推理使用 `local_files_only=True`，不会上传照片或在线下载模型。

## 新旧对照

```powershell
.\.venv\Scripts\python.exe -X utf8 pipeline\evaluate_semantic.py --device cpu
```

打开 http://127.0.0.1:8765/outputs/semantic-comparison/index.html，可筛选 183 张照片、查看新旧前三候选并试听相应段落。也可直接打开 `outputs/semantic-comparison/index.html`。

首次固定方案实验：首选覆盖 **22 → 22 首**，前三候选覆盖 **27 → 29 首**，单曲最高首选占比 **23.0% → 18.0%**；38 张高暖色图片中首选《橘子花火》的次数 **37 → 1**。首选仍有 11 首未覆盖，不能宣称覆盖问题已解决。完整数据与方法限制见同目录 `results.json` 和 `report.md`。

旧规则复用页面原始排序函数，缩图使用 Pillow 双线性，可能与浏览器 Canvas 有少量差异。这批图片已用于诊断，属于开发集。分散程度不等于听感准确率，尚需新照片与人工盲听。

## 语义方案与边界

- 40 对人工编写的中文视觉描述、英文音乐描述连接两个模型；两个模型的原始 512 维向量不会直接比较。
- 每段音乐确定性抽取最多两个 10 秒、48kHz 窗口，平均 CLAP 特征后生成意境轮廓。在线只加载 Chinese-CLIP。
- 固定权重为 65% 音频意境轮廓、35% 图片与已有人工歌曲意境描述的相关性；颜色不参与新排序，仍驱动背景。没有随机换歌或强制曝光均衡。
- 相似度不是概率；画面意境标签是预设描述中的模型候选，歌曲原有标签仍为人工描述。
- 段落起止时间沿用原有启发式切分，未接入 allin1，曲式名称未经过人工验证。
- 历史目录 `model/emoset-vit/` 实际为人脸表情模型，本轮不用于照片整体意境。
- 索引记录模型、曲库、音频文件身份与描述集指纹，发生变化需重新建库；`data/semantic_cache/` 支持按歌曲恢复，图片推理缓存位于 `data/.semantic_eval_cache/`。
- 更新曲库后，依次重建页面与语义索引并重启本地服务；驻留模型不会自动热重载。前端会核对返回的歌曲文件及段落起止时间，发现与内联曲库不一致时明确降级，避免播放错歌。

## 验证

```powershell
.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -v
node pipeline/test_semantic_ui.mjs
node --check pipeline/build_index_html.mjs
```

手动验证：上传真实照片查看匹配方式与意境候选；连续快速换图检查最后一张生效；点击候选确认从所示起点播放并在段末循环。停止服务再上传应显示色彩降级提示。对照页可筛选高暖色图片，逐张试听两种方案。

## 当前功能

- 上传照片，计算色温、明度、饱和度等特征。
- 拍立得界面与随照片主色变化的流体背景。
- 从段落级索引中匹配歌曲及起止时间。
- 本地音频播放、跳转到匹配段落、2 秒渐入、段落循环与整首播放。
- 基于 FFmpeg 的离线切段、声学特征提取及索引生成。

## 本地查看

克隆仓库后，直接用浏览器打开 `index.html` 即可查看界面并上传照片，无需安装前端依赖。

仓库中的索引来自本地测试曲库，仅包含歌曲元数据、特征和段落时间。**完整音频不随仓库分发，因此仅克隆源码无法播放这些曲目。** 模型权重不随仓库分发；`picture/` 中的测试图片随仓库提供。

## 使用自己的曲库

准备 Node.js（支持内置 `fetch` 的版本，如 18 或更新版本）与 FFmpeg，并确保 `node` 和 `ffmpeg` 可在终端运行。

1. 在项目根目录创建 `demo list/`，放入你拥有使用授权的 MP3。
2. 在项目根目录依次执行：

   ```bash
   node pipeline/analyze_demo_list.mjs
   node pipeline/build_index_html.mjs
   node pipeline/test_matching.mjs
   ```

3. 重新打开 `index.html`，上传照片，试听匹配结果。

分析脚本扫描音频并更新 `data/demo_library.json`，页面构建脚本将该索引内联到 `index.html`。现有脚本含测试歌曲的人工意境标签，使用自己的曲库时应检查并按需调整 `pipeline/analyze_demo_list.mjs` 中的标签配置。匹配测试使用预设色彩特征，只用于观察规则输出，不能代表人工听感评测。

## 可选：下载本地模型

在项目根目录运行：

```bash
node model/download_models.mjs all
```

模型会下载到 `model/` 子目录，需预留磁盘空间。色彩降级版本不依赖权重；语义版本还需安装依赖和生成段落索引。模型来源和使用条件请以各上游仓库说明为准，详见 `model/README.md` 与下载脚本。

## 目录

```text
├── index.html                   # 前端页面与内联段落索引
├── pipeline/                    # 离线分析、页面生成与匹配检查
├── data/demo_library.json       # 段落级曲库索引，无音频
├── model/README.md              # 本地模型说明
├── model/download_models.mjs    # 模型下载脚本
├── AGENTS.md                    # 项目约定与路线图
└── .gitignore                   # 排除本地素材、权重与环境文件
```

公开演示前，请确认所用音乐和照片的授权范围。完整受版权保护的音频不得提交到本仓库。
