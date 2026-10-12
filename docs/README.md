# 敦煌 · 流沙 — 原画色彩三维飞天

网站主体使用 Hyper3D 原画色彩版敦煌飞天模型。原始模型有 100 万个三角面，网页模型减为 18 万个三角面，保留 2048 × 2048 原画色彩贴图。默认展示真正的彩色三维网格；局部拨沙会移除对应表面并释放彩色粒子。金沙模式、全局散开和重聚使用 262,144 个模型表面粒子。

- 按住鼠标拖动拨沙；右键或「转像」旋转模型；滚轮缩放。
- 顶部切换「原画模型」和「金沙演绎」。
- 「散作金沙」释放全部粒子；「聚沙成形」经过约 5.6 秒回旋归位。
- 摄像头双手识别在本机运行；录制导出最长 90 秒输入、模型、贴图、GPU 着色器及起止检查点，不包含摄像头画面。
- 「参考原画」内提供网页优化版 GLB 下载。原始高精度 GLB 保留在本地模型输出文件夹。

```sh
node server.mjs
```

本地网址 http://127.0.0.1:4287/ 。全部生产资源通过相对路径加载，支持 GitHub Pages 子目录。

`assets/apsara.mesh.bin` 包含 Float32LE 坐标、法线、UV、每顶点最近粒子查找 UV，接着 Uint32LE 索引。`apsara.mesh.json` 描述长度。网格与粒子共用归一化坐标，Y 朝上、正面朝 +Z。`apsara.samples.bin` 包含全部 XYZ 坐标，接着全部 XYZ 法线；颜色由原画贴图按 UV 双线性采样。

`tools/build-apsara.py` 可从优化 GLB 重建资源，依赖 numpy、scipy 和 Pillow。`assets/model-report.json` 记录 Hyper3D 任务 ID、模型哈希、面数、采样方法与实际三维范围。模型为静态网格，转像和粒子运动由网站实时驱动。

## 背景音乐

右上角「乐声」按钮播放或暂停古琴名曲《阳关三叠》，面板提供循环播放状态、音量和静音；M 可快捷播放或暂停。音乐仅在点击后加载，不阻塞三维模型。切到其他标签页时暂停，回到页面后恢复先前播放。

演奏者 Charlie Huang（Charles R Tsua），录音日期 2013-10-06；[Wikimedia Commons 录音来源](https://commons.wikimedia.org/wiki/File:Guqin-Yangguan_Sandie.ogg)，[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。采用 Wikimedia 的 MP3 转码，未剪辑、未混音。授权适用于音乐录音。文件来源和 SHA-256 见 `assets/music-credit.json`。粒子录制仍为动作数据包，不包含音乐音轨。
