# 本地语义匹配与图片对照实施计划

**目标：** 接入真实本地 Chinese-CLIP 和 CLAP，比较现有 183 张照片上的首选集中度、歌曲覆盖与候选变化。

**方案：** 使用人工定义的成对中文视觉描述和英文音乐描述连接两个模型。离线按音乐段落提取 CLAP 特征，在线只运行视觉模型。保留旧规则用于基线和明确标注的降级。模型分数仅表示匹配相关性，不称为准确率。

**技术：** Python 3.14 优先、PyTorch、Transformers、FFmpeg、FastAPI；保留现有单文件 JavaScript 前端。

用户已确认实施上述方案；本轮直接开发、运行和对照，不增加框架或云服务。

## 实施顺序

- [x] 环境：项目内虚拟环境复用已有 PyTorch；安装所缺依赖，验证实际模型加载和一次推理。GPU 不可执行时使用 CPU，并记录实际设备。
- [x] 核心：`server/semantic.py` 管理本地模型、统一意境描述、段落索引和歌曲排序；`server/anchors.json` 保存显式人工桥接描述。
- [x] 建库：`pipeline/build_semantic_index.py` 对原始音频以 48kHz、确定性窗口采样，逐段缓存；记录权重、描述集和曲库身份，拒绝过期索引。
- [x] 服务：`server/app.py` 提供 `/api/health`、`/api/match` 和受限本地静态文件。前端显示实际使用的匹配方式，处理断线和异步上传竞争。
- [x] 对照：`pipeline/evaluate_semantic.py` 对同一批图片分别计算旧规则与新模型结果；记录每图前 3 候选和全库计数，导出可试听的对照页。
- [x] 验证：检查 JavaScript 语法、模型和 API 实际推理、音频定位接口、降级路径和索引失效；统计指标不替代人工听感评测。
- [x] 文档：更新启动方式、模型用途及局限，将真实测量结果写入 `outputs/`。

## 评价规则

算法和描述集在首次全量对照前固定，不根据图片文件名推荐，不为覆盖率随机换歌或强制分配曝光。首选覆盖率、前 3 覆盖率、最多歌曲占比、暖色子集集中度均为描述性指标；本数据集已用于问题诊断，不视为独立测试集。新增图片盲听评价留给后续验证。

## 可复现命令

```powershell
.venv\Scripts\python.exe pipeline\build_semantic_index.py --device cpu
.venv\Scripts\python.exe pipeline\evaluate_semantic.py --device cpu
.venv\Scripts\python.exe -m server.app
node --check pipeline\build_index_html.mjs
```

## 验收记录

已完成 33 首 / 165 段真实 CLAP 建库、183 张图真实视觉推理，0 失败。18 项 Python 测试及 JavaScript 竞态、降级、歌曲/段落错位验证通过。真实浏览器已验证上传、音频跳转和对照试听，320/390/1280 像素宽度无横向溢出。

结果是部分改善：首选覆盖仍为 22 首，前三覆盖 27→29；最高占比 23%→18%，暖色图片首选《橘子花火》37/38→1/38。未做人工盲听，不声称听感准确率提升。
