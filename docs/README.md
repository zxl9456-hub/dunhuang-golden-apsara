# 敦煌 · 流沙 — 飞天粒子壁画

按照用户提供的金沙佛像交互案例改编。最终版本直接采样《敦煌飞天舞韵》原画，保留完整壁画构图、石青、赭红和金色。主体由 262,144 个真实可移动粒子组成，没有用原画贴在粒子后面；初始粒子位于平面，拨动后可以在三维空间中飘散。

## 本地打开

需要 Node.js，无需安装 npm 依赖。

```bash
node server.mjs
```

打开 http://127.0.0.1:4287/ 。摄像头功能需要 localhost 或 HTTPS，直接双击 HTML 不可用。

## 操作

- 顶部切换「矿彩壁画」与「金沙演绎」。
- 左键或触屏按住拖动，局部拨散粒子；松开后轻缓回流。
- 「散作金沙」散开整幅壁画，「聚沙成形」经过约 5.6 秒的卷流重组归位。
- 右键 / Shift 拖动转像，中键环绕，滚轮缩放；触屏先选择「转像」。
- R 或底部回转箭头重置。空格暂停 / 继续，H 隐藏 / 显示界面。
- 设置面板调节金光、力度、速度、闪光、画质，可开启缓慢转动。
- 「手势」启用 MediaPipe 双手识别，摄像头画面在本机处理，不上传，不申请麦克风。
- 「录制」记录最长 90 秒的运动输入、生产 GPU 着色器与起止 GPU 检查点，下载 `.sandpack.zip`。录制时固定正面并锁定镜头。请保留整个包以供后续重放；它不是视频文件。

## 文件

- `index.html`、`style.css`、`main.js`：界面和交互。
- `sculpture-sand.js`：从附件案例改编的 GPU 粒子引擎。
- `assets/reference.png`：用户提供的原画，未重绘。
- `assets/mural.samples.bin`：Float32LE，全部 XYZ 坐标，接着全部 XYZ 法线。
- `assets/mural.colors.bin`：RGB Uint8 sRGB，每粒一个原画颜色。
- `assets/mural.tones.bin`：Uint8 亮度，每粒一个值，用于金沙表现。
- `assets/model-report.json`：来源哈希、粒子数量和采样说明。
- `tools/build-mural.py`：可重复采样工具，需要 numpy 和 Pillow。
- `verification.json`：实际浏览器与导出包校验结果。

## 验证与边界

已在实际浏览器中检查矿彩 / 金沙两种视觉、真实鼠标拨沙、散开 / 重聚、参数操作、重置、录制启停，以及 390 × 844 的手机布局。实际导出的约 30.5 秒、2,973 步数据包所有文件 SHA-256 匹配，GPU 起止坐标与速度均为有限数，记录到 16,327 颗粒子的局部拨散。

摄像头双手识别沿用附件本地模块，尚未用真实双手实测。设备性能会影响帧率。此版本是原画粒子壁画，未使用 Hyper3D 建模，也不是浮雕。

第三方依赖 Three.js 和 MediaPipe 及相应许可证保留在 `vendor/`。原画由用户提供；第三方依赖的许可证不改变原画的权利归属。

## GitHub Pages

目标仓库：`zxl9456-hub/dunhuang-golden-apsara`。

本目录可直接作为仓库根目录。GitHub Settings → Pages → Deploy from a branch，选择 `main` 分支和 `/ (root)`，保存即可。`.nojekyll` 确保静态文件直接发布。

预计网站地址为 https://zxl9456-hub.github.io/dunhuang-golden-apsara/ ，需要完成上传和 Pages 构建后才会生效。
