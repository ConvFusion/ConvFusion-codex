<p align="center">
  <img src="./plugins/convfusion-codex/assets/favicon.svg" width="200" alt="ConvFusion Logo">
</p>

<h1 align="center">ConvFusion for Codex</h1>

<p align="center"><strong>面向 Codex 的科研工作流插件</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.6.2--codex.6-4a43ea" alt="Version 0.6.2-codex.6">
  <img src="https://img.shields.io/badge/Codex-plugin-4a43ea" alt="Codex Plugin">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e" alt="MIT License"></a>
</p>

---

ConvFusion 帮助研究者在 Codex 中完成文献整理、研究规划、实验设计、论文写作和成果输出，并将研究资料、实验结果及结论保存在本地，方便持续管理和追溯。

## 主要功能

- 文献检索、开放全文下载、筛选与综述
- 研究问题、假设、技术路线和实验方案设计
- 研究计划、证据、结论和决策记录管理
- 论文写作、修订、科研配图及 LaTeX 处理
- 专利、技术报告和演示文稿整理
- 研究进展查看、研究方法定制
- 研究上下文自动刷新、Plan 历史及有轮数上限的自动推进
- ConvFusion.com 研究发布、寻找线上导师或学生、研究资料交换与同步

## 系统要求

- 支持插件和本地 MCP 的 Codex Desktop 或 Codex CLI
- Node.js 20 或更高版本

## 安装

```bash
codex plugin marketplace add ConvFusion/ConvFusion-codex --ref main
codex plugin add convfusion-codex@convfusion
```

安装后重新打开 Codex 或创建一个新任务，无需单独部署服务。

自动上下文、回合进展和自动推进需要在 Codex 中审核并信任插件的 Hooks。未启用 Hooks 时，仍可通过聊天和工作台使用研究工具。

## 更新

```bash
codex plugin marketplace upgrade convfusion
```

## 快速开始

在 Codex 任务中调用：

```text
$convfusion-research 帮我建立一个关于无人机视觉-LiDAR 跨模态定位的研究项目
```

也可以继续提出具体需求：

```text
整理这个方向的相关文献，比较现有方法，并列出值得研究的问题。
```

```text
评估当前研究还缺少哪些证据，并给出下一步实验计划。
```

新建研究项目后，资料保存在当前任务目录的 `workspace/` 中。

## 交互界面

在 Codex 的插件应用列表中打开 **ConvFusion 工作台**，即可进入独立界面。在顶部选择研究项目目录；账号登录和研究方法浏览也可在未选择目录时使用。

也可以在聊天中提出：

```text
打开 ConvFusion 界面，我要寻找线上导师。
```

界面包含研究网络、研究进展和研究方法，支持全局侧栏入口和聊天侧面板。选择目录不会自动新建研究项目。也可以打开工具返回的本地链接使用界面。

使用研究网络时，在界面中配置服务器并登录 ConvFusion.com，再选择研究工作、上传文件和发布方向。涉及费用的操作会在界面中显示确认信息。

下载研究资料后，将界面提供的同步请求复制到 Codex。插件会先检查压缩包与本地研究的差异，确认后再同步。

聊天侧面板支持编辑同步请求后发送给 Codex。研究方法页支持导出方法与完整正文；研究进展页可以关闭自动推进或调整连续推进上限。

## 可选配置

文献检索可通过环境变量配置 OpenAlex API Key 和联系邮箱：

```bash
export OPENALEX_API_KEY="..."
export OPENALEX_MAILTO="you@example.com"
```

未配置 API Key 时，仍可使用本地研究资料管理功能。

## 许可证

本项目采用 [MIT License](LICENSE)。
