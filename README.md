<p align="center">
  <img src="./plugins/convfusion-codex/assets/favicon.svg" width="200" alt="ConvFusion Logo">
</p>

<h1 align="center">ConvFusion for Codex</h1>

<p align="center"><strong>面向 Codex 的本地优先、证据驱动科研工作流插件</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.2.0--codex.1-4a43ea" alt="Version 0.2.0-codex.1">
  <img src="https://img.shields.io/badge/Codex-plugin-4a43ea" alt="Codex Plugin">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e" alt="MIT License"></a>
</p>

---

ConvFusion 帮助研究者和开发者把研究计划、文献、证据、主张、决策、实验结果、论文修订和成果输出组织为可追溯的本地资产。Codex 继续负责推理、浏览、编码与实验执行；ConvFusion 提供科研方法和确定性的资产约束，不另外实现一套 Agent Runtime。

> 当前版本：`0.2.0-codex.1`。项目仍处于早期阶段，插件接口和工具参数可能继续演进，欢迎通过 Issue 和 Pull Request 参与改进。

本项目是 [ConvFusion](https://github.com/ConvFusion) 面向 Codex 的官方插件，与 [ConvFusion for DeepSeek Harness](https://github.com/ConvFusion/ConvFusion-dsh) 共享科研领域 Core，通过 Codex Skill 与本地 STDIO MCP 提供科研工作流能力。

## 为什么使用 ConvFusion

普通对话很适合探索想法，但长期研究还需要回答这些问题：

- 一个结论由哪些文献、实验或原始产物支持？
- 新证据与已有主张是支持、反驳还是取代关系？
- 为什么选择当前研究方向、基线或实验设计？
- 论文中的某个表述基于哪一版研究状态？
- 专利、报告和演示文稿能否回溯到原始证据？

ConvFusion 将这些关系保存在工作区内的 Markdown 和结构化元数据中，使研究过程可检查、可版本化，也便于人与 Agent 协作。

## 主要能力

- 一个总控 Skill：`$convfusion-research`
- 50 份科研方法参考，按任务按需加载，避免一次性占用上下文
- 13 个本地 MCP 工具，覆盖工作区、计划、证据、主张、决策、研究状态、论文和多类型成果
- OpenAlex 文献检索、开放全文下载和 LaTeX 处理
- Evidence 与 Claim 双向引用及自动编号
- 保留矛盾证据和历史版本，使用 supersede 代替破坏性覆盖
- Research State 更新和论文修订采用“提案—人工审核”边界
- 数据默认保存在当前任务目录，不需要部署服务器或开放网络端口

## 适用场景

- 建立或评估一个研究项目
- 文献检索、筛选、综述和研究版图分析
- 研究问题、假设、创新点和技术路线设计
- 数据集、基线、消融实验及评估协议设计
- 沉淀实验结果并维护可追溯的 Evidence/Claim 图谱
- 管理论文演化、缺口和修订提案
- 将研究成果转换为专利、技术报告或演示文稿

如果只是完成与研究无关的普通编码任务，通常不需要启用本插件。

## 系统要求

- 支持插件和本地 MCP 的 Codex Desktop 或 Codex CLI
- Node.js 18 或更高版本
- Git（从源码安装或参与开发时需要）
- OpenAlex API Key 可选

由于插件包含本地 STDIO MCP，它主要面向桌面端 Codex 环境。

## 安装

将 GitHub 仓库添加为 Codex Marketplace，然后安装插件：

```bash
codex plugin marketplace add ConvFusion/ConvFusion-codex --ref main
codex plugin add convfusion-codex@convfusion
```

安装完成后，重新打开 Codex 或创建一个新任务。插件自带本地 MCP 配置，无需单独部署服务。

更新 Marketplace 快照：

```bash
codex plugin marketplace upgrade convfusion
```

如需参与开发，可以克隆源码并进入插件目录：

```bash
git clone https://github.com/ConvFusion/ConvFusion-codex.git
cd ConvFusion-codex/plugins/convfusion-codex
```

建议优先使用带版本号的 Git tag 或 GitHub Release，以获得可复现的插件版本。

## 快速开始

安装后，在新的 Codex 任务中显式调用 Skill：

```text
$convfusion-research 帮我建立一个关于无人机视觉-LiDAR 跨模态定位的研究项目
```

也可以直接提出与科研相关的自然语言请求，例如：

```text
评估这个研究项目当前有哪些证据缺口，并给出下一步实验计划。
```

Skill 会首先进行只读状态检查。只有用户明确要求新建或初始化研究项目时，才会在当前任务目录中创建 `workspace/`：

```text
<task-cwd>/workspace/
├── project.md
├── research-state.md
├── plans/
├── research/
│   ├── evidence/
│   ├── claims/
│   ├── decisions/
│   └── state-history/
├── experiments/        # 按需创建
├── papers/             # 按需创建
└── outputs/            # 按需创建
```

每次 MCP 调用都会显式传入当前 Codex 任务的绝对工作目录，插件安装目录不会被误用为研究数据目录。

## 可选配置

OpenAlex Key 和联系邮箱可通过环境变量提供：

```bash
export OPENALEX_API_KEY="..."
export OPENALEX_MAILTO="you@example.com"
```

这些值只用于文献请求，不会写入研究资产或工具返回内容。没有 API Key 时，其余本地研究资产功能仍然可用。

## 架构

```text
Codex
├── Skill
│   └── 选择科研方法并约束 Agent 行为
├── Native capabilities
│   └── 推理、浏览、编码、实验和文档处理
└── Local STDIO MCP
    └── 调用 ConvFusion Core，维护确定性研究资产
```

仓库采用 Codex Marketplace 布局：

```text
.
├── .agents/plugins/marketplace.json # Marketplace 清单
└── plugins/convfusion-codex/
    ├── .codex-plugin/plugin.json    # Codex 插件清单
    ├── .mcp.json                    # 本地 STDIO MCP 配置
    ├── skills/convfusion-research/
    │   ├── SKILL.md                 # 总控科研 Skill
    │   └── references/              # 50 份科研方法参考
    ├── scripts/convfusion-mcp.mjs   # Codex MCP 适配器
    ├── lib/research/                # 编译后的科研领域 Core
    └── src/                         # TypeScript 源码及兼容代码
```

## 开发与验证

以下命令均在仓库根目录执行。

安装开发依赖：

```bash
npm --prefix plugins/convfusion-codex install
```

执行类型检查和构建：

```bash
npm --prefix plugins/convfusion-codex run typecheck
npm --prefix plugins/convfusion-codex run build
```

验证 Codex MCP 适配器：

```bash
npm --prefix plugins/convfusion-codex run verify:codex
```

该验证会真实完成：

1. MCP 初始化；
2. 13 个工具发现；
3. 临时研究工作区初始化；
4. Evidence 和 Claim 写入；
5. 最终工作区状态读取。

版本使用 `v<DSH 版本>-codex.<迭代号>` 命名。例如，`v0.2.0-codex.1` 对应 DSH 的 `0.2.0`，`codex.1` 中的 `1` 表示 Codex 版本的迭代号；在该基础版本上继续优化时，依次使用 `v0.2.0-codex.2`、`v0.2.0-codex.3`。Git tag 使用 `v` 前缀，插件元数据中的版本号不带 `v`。

插件版本以 `plugins/convfusion-codex/package.json` 为唯一来源。发布新版本时，在仓库根目录执行：

```bash
npm --prefix plugins/convfusion-codex run version:set -- 0.2.0-codex.2
```

该命令会校验 SemVer，并同步插件清单、README 和现有 lockfile。可以单独检查版本标记是否一致：

```bash
npm --prefix plugins/convfusion-codex run version:check
```

仓库还保留了针对 Skill Library、Plan、Research State、Paper Evolution 和 Output Transformation 的离线回归脚本，位于 `scripts/verify-*.mjs`。

## 数据与安全边界

- 默认使用本地文件，不上传整个研究工作区。
- 初始化、状态应用和论文修订遵守显式授权边界。
- 未验证的结果不会自动升级为已验证 Claim。
- 原始实验数据和大型产物应通过路径引用，不应复制进 Evidence 正文。
- 删除、覆盖、外部发布和需要密钥的操作仍由 Codex 权限模型及用户确认控制。

在处理敏感数据、未公开论文或商业研究成果前，请审查插件源码、工作区权限和外部服务配置。

## 当前限制

当前 Codex 插件通过 Skill 与本地 MCP 提供能力，不提供以下 DSH 专用宿主接口：

- Harness 设置页面、进度卡和 React slot
- Cordis `ctx.*` 服务注入和 DSH 会话事件
- DSH `/research` 命令注册
- 基于 DSH 事件的自动继续

当前版本优先保证无 UI、无 Hook 时，研究资产和生命周期约束仍可独立工作。未来可以增加 MCP Apps UI 或 Codex Hooks，而不改变既有研究资产格式。

## 贡献

欢迎提交 Issue、讨论和 Pull Request。建议在提交前：

1. 清楚描述使用场景或可复现问题；
2. 保持科研 Core 与具体 Agent 宿主解耦；
3. 不绕过 Evidence、Research State、Plan 和 Paper 的审核边界；
4. 为行为变化补充相应验证；
5. 运行 `npm --prefix plugins/convfusion-codex run typecheck`、`npm --prefix plugins/convfusion-codex run build` 和 `npm --prefix plugins/convfusion-codex run verify:codex`。

涉及资产格式或工具参数的破坏性变更，请先通过 Issue 讨论迁移策略。

## 宿主入口与兼容性

Codex 的插件入口是 `plugins/convfusion-codex/` 下的 `.codex-plugin/plugin.json`、`skills/` 和 `.mcp.json`。`src/index.ts`、`src/client/` 和 `cordis.patch.yml` 为 DSH 兼容代码，用于共享 Core 的开发与验证，Codex 不加载这些入口。

## 许可证

本项目采用 [MIT License](LICENSE)。
