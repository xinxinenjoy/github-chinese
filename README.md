# GitHub 中英双语版

这是基于 [maboloshi/github-chinese](https://github.com/maboloshi/github-chinese) 自动维护的个人双语版本。

目标很简单：

> 持续跟随上游更新，只保留自己实际需要的 GitHub 中英双语用户脚本。

## 实际使用文件

- `main-bilingual.user.js`
  - 油猴实际安装和运行的双语脚本。
- `locals.js`
  - 从上游自动同步的简体中文词库。
  - `main-bilingual.user.js` 通过 `@require` 自动加载它。
- `main.user.js`
  - 上游最新版主脚本。
  - 主要用于观察上游变化和自动三方重建。
- `tools/rebuild-bilingual.mjs`
  - 双语版自动重建工具。
- `.github/workflows/sync-upstream.yml`
  - 上游同步和双语重建的唯一核心 Workflow。

## 分支结构

### `bilingual`

日常使用和维护的精简产品分支。

只保留双语脚本真正需要的文件，不再同步上游的测试、文档、VS Code 扩展和开发用 Workflow。

### `gh-pages`

完整的上游镜像分支。

用于记录 `maboloshi/github-chinese:gh-pages` 的最新状态，并给自动重建器提供“旧上游 → 新上游”的比较基准。

平时不需要在这个分支工作。

## 自动维护流程

GitHub Actions 每 6 小时检查一次上游，大约在北京时间：

- 01:17
- 07:17
- 13:17
- 19:17

流程：

```text
检查 upstream/gh-pages
        ↓
上游没有变化
        ↓
直接结束

上游有变化
        ↓
更新 gh-pages 镜像
        ↓
只提取 main.user.js + locals.js
        ↓
检测核心文件是否变化
        ↓
三方重建 main-bilingual.user.js
        ↓
语法 / 结构 / @require 安全检查
        ↓
同时更新 gh-pages + bilingual
```

## 双语保护机制

重建使用三方比较：

```text
旧上游 main.user.js
        +
当前 main-bilingual.user.js
        +
最新上游 main.user.js
        ↓
新的 main-bilingual.user.js
```

如果上游修改与双语定制没有重叠，自动干净合并。

如果发生重叠，自动优先保留双语冲突区，同时吸收其他非冲突上游更新，并在 Actions 中给出警告。

## 手动测试

进入：

```text
Actions
→ Sync Upstream & Rebuild Bilingual
→ Run workflow
```

如需在上游没有变化时测试完整重建，可勾选：

```text
force_rebuild = true
```

## 日常观察

通常只需要关注：

1. `main-bilingual.user.js` 是否正常运行。
2. `locals.js` 是否跟随上游更新。
3. `Sync Upstream & Rebuild Bilingual` 最近一次运行是否为绿色。
4. Actions Summary 中是否出现 `fallback-ours` 警告。

其他上游开发内容不再进入 `bilingual` 分支。

## 来源与许可

上游项目：

- https://github.com/maboloshi/github-chinese

本项目为其衍生双语版本，继续遵循上游 GPL-3.0 许可。
