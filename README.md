# 敦煌 · 流沙 — 飞天粒子壁画

用户提供的敦煌飞天原画，化为 262,144 个可交互粒子。支持原画矿彩 / 金沙切换、鼠标和触屏拨沙、旋转缩放、手势，以及最长 90 秒的运动数据录制。

**网站：https://zxl9456-hub.github.io/dunhuang-golden-apsara/**

源码位于 `docs/`。GitHub Actions 将自动发布到 GitHub Pages。

首次构建会将 `site-source.zip` 展开到 `docs/`，提交源码并移除引导压缩包。后续直接编辑 `docs/` 中的源码并推送即可自动部署。

本地运行：进入 `docs` 后执行 `node server.mjs`，打开 http://127.0.0.1:4287/ 。无须安装 npm 依赖。

详细操作和验证结果见 `docs/README.md` 与 `docs/verification.json`。
