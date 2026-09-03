# GitHub 中英双语版

> [!IMPORTANT]
> 本仓库是基于 [maboloshi/github-chinese](https://github.com/maboloshi/github-chinese) 自动维护的个人中英双语版本。
> 原项目的功能说明、安装指南和更新日志会自动跟随上游 README 更新。
>
> **本仓库实际使用的脚本：**
> [安装 / 更新 `main-bilingual.user.js`](https://github.com/xinxinenjoy/github-chinese/raw/refs/heads/bilingual/main-bilingual.user.js)

<!-- BILINGUAL_APPENDIX -->

## 🌏 本仓库的双语维护方式

本仓库只对原项目做一层尽量轻量的“双语化”处理，不参与上游项目本身的开发。

`gh-pages` 分支作为完整上游镜像，`bilingual` 分支只保留实际使用和自动维护所需的核心文件。

自动维护采用两层机制：

```text
轻量检查上游
      ↓
没有变化
      ↓
直接结束

发现上游变化
      ↓
更新 gh-pages 镜像
      ↓
同步 main.user.js / locals.js
      ↓
检查上游 Git 历史是否正常向前
      ↓
正常提交中的版本回退继续跟随，并记录提示
      ↓
三方重建 main-bilingual.user.js
      ↓
同步上游 README 并叠加本仓库说明
      ↓
安全检查
      ↓
更新 bilingual
```

日常只进行很轻量的远程版本检查；在上游常规更新窗口之后会额外进行一次重点检查。具体执行计划以 [Sync Upstream & Rebuild Bilingual](./.github/workflows/sync-upstream.yml) 中的配置为准，不在 README 中重复写死。

### 核心文件

- `main-bilingual.user.js`：油猴实际安装和运行的中英双语脚本。
- `locals.js`：自动跟随上游更新的中文词库。
- `main.user.js`：上游最新版主脚本，用于版本观察和三方重建。
- `tools/rebuild-bilingual.mjs`：双语脚本自动重建工具。
- `.github/workflows/sync-upstream.yml`：上游检查、同步和重建流程。

### 异常保护

自动流程遇到以下情况会停止，而不是直接覆盖本仓库：

- 上游分支发生 force-push、reset 或其他 Git 历史改写。
- 双语脚本出现未解决的 Git 冲突标记。
- 双语脚本没有正确引用本仓库的 `locals.js`。
- 自动任务修改了允许范围之外的文件。

正常的新提交如果主动恢复旧代码，或者让 `main.user.js` 的版本号降低，会继续跟随上游，不会因此停止。此时 Actions 会给出提示，而 `main-bilingual.user.js` 自身的发布版本号仍保持单调递增，避免油猴因为版本号降低而无法正常更新。

如果上游修改与双语定制发生局部重叠，重建工具会优先保留双语冲突区，并在 Actions Summary 中给出提示。

> 上游项目版权、贡献者、更新日志及原项目使用说明均以
> [maboloshi/github-chinese](https://github.com/maboloshi/github-chinese)
> 为准。本仓库继续遵循上游 GPL-3.0 许可。
