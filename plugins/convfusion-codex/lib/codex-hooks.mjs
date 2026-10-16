import { createRequire as __codexCreateRequire } from 'node:module'; const require = __codexCreateRequire(import.meta.url);

// lib/codex/lifecycle.js
import { isAbsolute as isAbsolute4, join as join16, resolve as resolve3, relative as relative4, sep as sep2 } from "node:path";
import { realpathSync as realpathSync2 } from "node:fs";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// lib/research/context.js
import { isAbsolute as isAbsolute2, relative as relative3, resolve as resolve2 } from "node:path";

// lib/research/workspace.js
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync } from "node:fs";
import { isAbsolute, join as join2, resolve } from "node:path";

// lib/research/research-data.js
var EVIDENCE_SOURCES = [
  "literature",
  "experiment",
  "computation",
  "observation",
  "dataset",
  "implementation",
  "analysis",
  "user-judgment",
  "external"
];
var EVIDENCE_STATUSES = [
  "unverified",
  "supported",
  "verified",
  "rejected",
  "superseded"
];
var CLAIM_STATUSES = [
  "unverified",
  "supported",
  "verified",
  "rejected",
  "superseded"
];
var STATE_DIMENSIONS = [
  "Problem",
  "Research Questions",
  "Current Knowledge",
  "Literature",
  "Innovation",
  "Hypotheses",
  "Method",
  "Experiments",
  "Claims",
  "Evidence",
  "Decisions",
  "Risks",
  "Open Questions"
];
var MATURITY_LEVELS = ["Unknown", "Weak", "Emerging", "Strong", "Established"];
var MATURITY_DIMENSIONS = [
  "Problem",
  "Knowledge",
  "Innovation",
  "Method",
  "Experiment",
  "Evidence"
];
var RESEARCH_DIR = "research";
var RESEARCH_STATE_FILE = "research-state.md";
var PROJECT_FILE = "project.md";
var EVIDENCE_DIR = `${RESEARCH_DIR}/evidence`;
var CLAIMS_DIR = `${RESEARCH_DIR}/claims`;
var DECISIONS_DIR = `${RESEARCH_DIR}/decisions`;
var STATE_HISTORY_DIR = `${RESEARCH_DIR}/state-history`;
var PROPOSALS_DIR = `${RESEARCH_DIR}/state-proposals`;
var RESEARCH_INDEX_FILE = `${RESEARCH_DIR}/index.json`;

// lib/research/markdown.js
function parseFrontmatter(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m)
    return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#"))
      continue;
    const idx = line.indexOf(":");
    if (idx <= 0)
      continue;
    const key = line.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key))
      continue;
    out[key] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
function stripFrontmatter(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
function fenceTracker() {
  let fence = null;
  return {
    inFence: () => fence !== null,
    feed(line) {
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (!m)
        return;
      const char = m[1][0];
      const len = m[1].length;
      if (fence === null)
        fence = { char, len };
      else if (char === fence.char && len >= fence.len)
        fence = null;
    }
  };
}
function parseSections(body) {
  const lines = body.split(/\r?\n/);
  let title = null;
  const sections = [];
  let current = null;
  const fence = fenceTracker();
  for (const line of lines) {
    const wasInFence = fence.inFence();
    fence.feed(line);
    if (!wasInFence) {
      if (title === null && /^#\s+/.test(line) && !line.startsWith("## ")) {
        title = line.replace(/^#\s+/, "").trim();
        continue;
      }
      const h2 = line.match(/^##\s+(.+?)\s*$/);
      if (h2) {
        if (current)
          sections.push({ title: current.title, body: current.lines.join("\n").trim() });
        current = { title: h2[1].trim(), lines: [] };
        continue;
      }
    }
    if (current)
      current.lines.push(line);
  }
  if (current)
    sections.push({ title: current.title, body: current.lines.join("\n").trim() });
  return { title, sections };
}
function findSection(sections, ...names) {
  for (const want of names) {
    const w = want.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
    const hit = sections.find((s) => s.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "") === w);
    if (hit)
      return hit.body;
  }
  return "";
}
function parseIdList(raw) {
  if (!raw)
    return [];
  return (raw.match(/[ECDP]\d{1,4}/gi) ?? []).map((s) => s.toUpperCase());
}
function stripListMarker(line) {
  const withoutMarker = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
  return withoutMarker.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/^[*_]+|[*_]+$/g, "").trim();
}
function isBoldHeading(line) {
  return /^\s*(?:\*\*|__)[^*_]+(?:\*\*|__)\s*$/.test(line);
}
function parseListItems(section) {
  const items = [];
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("<!--"))
      continue;
    const startsItem = /^\s*(?:[-*+]|\d+[.)])\s+/.test(raw) || isBoldHeading(raw);
    const text = stripListMarker(raw);
    if (!text)
      continue;
    if (startsItem || items.length === 0)
      items.push(text);
    else
      items[items.length - 1] = `${items[items.length - 1]} ${text}`;
  }
  return items;
}

// lib/research/paper-data.js
var PAPERS_DIR = "papers";
var DEFAULT_PAPER_ID = "paper-main";
var PAPER_FILES = {
  /** 正文（最小 Paper 只需要它）。 */
  manuscript: "paper.md",
  metadata: "metadata.md",
  /** 演化历史（人类可读的事件叙述）。 */
  evolution: "evolution.md",
  /** Claim → Evidence 映射。 */
  claims: "claims.md",
  /** Evidence → Section 映射。 */
  evidence: "evidence.md",
  /** 研究缺口。 */
  gaps: "gaps.md",
  /** 修订提案（每个提案一个文件）。 */
  proposalsDir: "proposals",
  /** 版本快照。 */
  historyDir: "history"
};
var PAPER_STATUSES = ["draft", "evolving", "frozen", "archived", "submitted"];
var ACTIVE_PAPER_FILE = ".active-paper";
var PAPER_MATURITY_DIMENSIONS = [
  "Problem",
  "Literature",
  "Innovation",
  "Method",
  "Experiment",
  "Evidence",
  "Claims",
  "Writing",
  "Reproducibility"
];
var REQUIRED_PAPER_SECTIONS = [
  "Abstract",
  "Introduction",
  "Related Work",
  "Method",
  "Experiments",
  "Results",
  "Discussion",
  "Conclusion"
];
var REQUIRED_SECTION_ALIASES = {
  Abstract: ["abstract", "summary"],
  Introduction: ["introduction", "intro"],
  "Related Work": ["related work", "background", "prior work", "literature review", "related literature"],
  Method: ["method", "methods", "methodology", "approach", "framework", "model", "formulation", "technical"],
  Experiments: ["experiment", "experiments", "experimental", "evaluation", "empirical", "benchmark", "setup", "protocol"],
  Results: ["result", "results", "evaluation", "analysis", "findings", "experiments"],
  Discussion: ["discussion", "limitations", "threats to validity"],
  Conclusion: ["conclusion", "conclusions", "concluding", "summary"]
};
function sectionPlaysRole(sectionTitle, want) {
  const title = normalizeSectionName(sectionTitle).toLowerCase();
  if (!title)
    return false;
  const aliases = REQUIRED_SECTION_ALIASES[want] ?? [want.toLowerCase()];
  return aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(title);
  });
}
function hasSectionFor(titles, want) {
  return titles.some((t) => sectionPlaysRole(t, want));
}
function normalizeSectionName(title) {
  return title.replace(/^\s*\d+[.、)]\s*/, "").replace(/\s+/g, " ").trim();
}

// lib/research/project.js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
function projectPath(workspace) {
  return join(workspace, PROJECT_FILE);
}
function loadProjectFile(workspace) {
  const file = projectPath(workspace);
  if (!existsSync(file))
    return null;
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(source);
  const body = stripFrontmatter(source);
  const section = (name) => {
    const re = new RegExp(`^##\\s+${name}\\s*$\\n([\\s\\S]*?)(?=\\n##\\s|(?![\\s\\S]))`, "m");
    return body.match(re)?.[1]?.replace(/<!--[\s\S]*?-->/g, "").trim() ?? "";
  };
  const statement = section("Research Statement");
  const topic = fm.topic || firstLine(statement);
  if (!topic)
    return null;
  const initialTopic = fm.initial_topic || void 0;
  const questions = parseListItems(section("Research Questions"));
  return {
    topic,
    ...initialTopic ? { initialTopic } : {},
    ...fm.domain || section("Domain") ? { domain: fm.domain || firstLine(section("Domain")) } : {},
    ...section("Scope") ? { scope: section("Scope") } : {},
    ...questions.length > 0 ? { questions } : {},
    ...section("Motivation") ? { goal: firstLine(section("Motivation")) } : {},
    ...fm.created_at ? { createdAt: fm.created_at } : {},
    ...fm.updated_at ? { updatedAt: fm.updated_at } : {}
  };
}
function firstLine(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

// lib/research/workspace.js
function readText(path) {
  try {
    return readFileSync2(path, "utf8");
  } catch {
    return null;
  }
}
function firstHeading(source) {
  return parseSections(stripFrontmatter2(source)).title;
}
function stripFrontmatter2(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
function isResearchWorkspace(dir) {
  try {
    if (!statSync(dir).isDirectory())
      return false;
  } catch {
    return false;
  }
  return existsSync2(join2(dir, PROJECT_FILE)) || existsSync2(join2(dir, RESEARCH_STATE_FILE));
}
var RESEARCH_ROOT_DIR = "workspace";
function researchWorkspaceOf(sessionWorkspace) {
  const base = resolve(sessionWorkspace);
  const nested = join2(base, RESEARCH_ROOT_DIR);
  if (isResearchWorkspace(nested))
    return nested;
  if (isResearchWorkspace(base))
    return base;
  return nested;
}
function loadPaper(workspace, paperId = DEFAULT_PAPER_ID, excerptChars = 4e3) {
  const source = readText(join2(workspace, "papers", paperId, "paper.md"));
  if (source === null)
    return { title: null, excerpt: null };
  const body = stripFrontmatter2(source);
  return {
    title: firstHeading(source),
    excerpt: body.length > excerptChars ? body.slice(0, excerptChars) + "\n\n\u2026\uFF08\u5DF2\u622A\u65AD\uFF09" : body
  };
}

// lib/research/taxonomy.js
var SYSTEM_TAXONOMY = [
  {
    /*
     * C00 全局能力：不专属任何研究阶段，作用域是**整项研究**（跨阶段的前置），
     * 所以置首而不是置末（对比 C09 工作评阅：它作用于已有资产，故置末）。
     * 目前只有「研究过程定义」：它规定这套研究怎么推进，也决定进展面板的阶段。
     */
    group: "global-capabilities",
    name: "Global Capabilities",
    leaves: [["research-process", "Research Process"]]
  },
  {
    group: "research-understanding",
    name: "Research Understanding",
    leaves: [
      ["input-understanding", "Input Understanding"],
      ["research-intent-assessment", "Research Intent Assessment"],
      ["research-topic-proposal", "Research Topic Proposal"],
      ["research-domain-profiling", "Research Domain Profiling"],
      ["research-foundation-assessment", "Research Foundation Assessment"],
      ["research-direction-steering", "Research Direction Steering"]
    ]
  },
  {
    group: "literature",
    name: "Literature",
    leaves: [
      ["literature-search", "Literature Search"],
      ["literature-screening", "Literature Screening"],
      ["paper-fulltext-download", "Paper Full-Text Download"],
      ["literature-review", "Literature Review"],
      ["research-landscape", "Research Landscape"]
    ]
  },
  {
    group: "innovation",
    name: "Innovation",
    leaves: [
      ["research-theme-generation", "Research Theme Generation"],
      ["innovation-gap-analysis", "Innovation Gap Analysis"],
      ["idea-novelty-assessment", "Idea Novelty Assessment"],
      ["hypothesis-formulation", "Hypothesis Formulation"],
      ["contribution-design", "Contribution Design"]
    ]
  },
  {
    group: "research-planning",
    name: "Research Planning",
    leaves: [
      ["research-strategy-portfolio", "Research Strategy Portfolio"],
      ["research-method-design", "Research Method Design"],
      ["experiment-pipeline-design", "Experiment Pipeline Design"],
      ["plan-risk-assessment", "Plan Risk Assessment"],
      ["research-risk-assessment", "Research Risk Assessment"]
    ]
  },
  {
    group: "resource-estimation",
    name: "Resource Estimation",
    leaves: [
      ["resource-requirement-estimation", "Resource Requirement Estimation"],
      ["infrastructure-cost-selection", "Infrastructure Cost Selection"],
      ["feasibility-cost-and-resource-plan", "Feasibility, Cost and Resource Plan"]
    ]
  },
  {
    group: "research-decision",
    name: "Research Decision",
    leaves: [
      ["research-topic-ranking", "Research Topic Ranking"],
      ["research-direction", "Research Direction"],
      ["research-direction-selection", "Research Direction Selection"],
      ["go-no-go-decision", "Go / No-Go Decision"]
    ]
  },
  {
    group: "experiment",
    name: "Experiment",
    leaves: [
      ["experiment-design", "Experiment Design"],
      ["simulation-baseline", "Simulation Baseline"],
      ["dataset-selection", "Dataset Selection"],
      ["baseline-selection", "Baseline Selection"],
      ["evaluation-protocol", "Evaluation Protocol"],
      ["ablation-design", "Ablation Design"],
      ["reproducible-implementation-spec", "Reproducible Implementation Spec"],
      ["method-implementation-spec", "Method Implementation Specification"],
      ["result-analysis", "Result Analysis"],
      ["comparative-analysis", "Comparative Analysis"],
      ["evidence-assessment", "Evidence Assessment"]
    ]
  },
  {
    group: "academic-writing",
    name: "Academic Writing",
    leaves: [
      ["venue-fit-decision", "Venue Fit Decision"],
      ["paper-architecture", "Paper Architecture"],
      ["research-narrative", "Research Narrative"],
      ["section-drafting", "Section Drafting"],
      ["equation-formalization", "Equation Formalization"],
      ["visual-evidence-selection", "Visual Evidence Selection"],
      ["paper-diagrams", "Paper Diagrams"],
      ["manuscript-revision", "Manuscript Revision"],
      ["submission-compile-and-format", "Submission Compile and Format"],
      ["technical-report-writing", "Technical Report Writing"],
      ["patent-drafting", "Patent Drafting"],
      ["presentation-design", "Presentation Design"]
    ]
  },
  {
    /*
     * C09 工作评阅：对**已有的**研究做系统诊断（`ConvFusion-dsh-Skill-Review.md`）。
     *
     * 为什么排在最后而不是插在实验/写作之间：评阅是**横切能力** —— 它作用于某一轮
     * 研究已经产出的资产（state / evidence / claims / paper），不专属某个阶段。真要在
     * 中间插一个，就必须重编 C06–C08，而编号是常量表、被导出与界面引用。
     *
     * 粒度按该文档 §8「不过度拆分」：只做五个，而不是把 problem/literature/novelty/
     * evidence/claim/... 拆成一堆微技能 —— 那些是这些技能**内部的方法维度**。
     */
    group: "review",
    name: "Review",
    leaves: [
      // 顺序 = **评阅场合从早到晚**：只有方向 → 有研究状态 → 证据链 → 正文 → 投稿包
      ["research-direction-review", "Research Direction Review"],
      ["research-quality-review", "Research Quality Review"],
      ["experimental-evidence-review", "Experimental Evidence Review"],
      ["paper-claim-review", "Paper and Claim Review"],
      ["pre-submission-review", "Pre-submission Review"]
    ]
  }
];
var SYSTEM_CATEGORIES = (() => {
  const out = [];
  for (const g of SYSTEM_TAXONOMY) {
    out.push({ id: g.group, name: g.name, origin: "system" });
    for (const [leaf, leafName] of g.leaves) {
      out.push({
        id: `${g.group}/${leaf}`,
        name: leafName,
        parent: g.group,
        origin: "system"
      });
    }
  }
  return out;
})();
function systemGroups() {
  return SYSTEM_CATEGORIES.filter((c) => !c.parent);
}
function normalizeCategoryId(input) {
  if (!input)
    return void 0;
  const raw = input.trim();
  if (!raw)
    return void 0;
  const lower = raw.toLowerCase();
  const byId = SYSTEM_CATEGORIES.find((c) => c.id === lower);
  if (byId)
    return byId.id;
  const byName = SYSTEM_CATEGORIES.find((c) => c.parent && c.name.toLowerCase() === lower) ?? SYSTEM_CATEGORIES.find((c) => c.name.toLowerCase() === lower);
  if (byName)
    return byName.id;
  const kebab = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const byKebab = SYSTEM_CATEGORIES.find((c) => c.id.endsWith(`/${kebab}`) || c.id === kebab);
  if (byKebab)
    return byKebab.id;
  return void 0;
}
function categoryName(id, userCategories = []) {
  if (!id)
    return "Uncategorized";
  const hit = [...SYSTEM_CATEGORIES, ...userCategories].find((c) => c.id === id);
  return hit ? hit.name : id;
}
function categoryGroup(id) {
  if (!id)
    return void 0;
  return id.includes("/") ? id.split("/")[0] : id;
}

// lib/research/skill-customization.js
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync4, readdirSync as readdirSync2, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { dirname as dirname3 } from "node:path";

// lib/research/skills.js
import { existsSync as existsSync3, readFileSync as readFileSync3, readdirSync } from "node:fs";
import { dirname as dirname2, join as join3, relative } from "node:path";
import { fileURLToPath } from "node:url";

// lib/research/skill-codes.js
var SKILL_CODES = {
  // ── C00 全局能力（跨阶段前置：规定这套研究怎么推进）──
  "research-process": { code: "C00P01", label: "\u7814\u7A76\u8FC7\u7A0B\u5B9A\u4E49" },
  // ── C01 理解输入 ──
  "input-understanding": { code: "C01P01", label: "\u8F93\u5165\u7406\u89E3" },
  "research-intent-assessment": { code: "C01P02", label: "\u7814\u7A76\u610F\u56FE\u5224\u65AD" },
  "research-topic-proposal": { code: "C01P03", label: "\u63D0\u51FA\u7814\u7A76\u8BDD\u9898" },
  "research-domain-profiling": { code: "C01P04", label: "\u7814\u7A76\u9886\u57DF\u753B\u50CF" },
  "research-foundation-assessment": { code: "C01P05", label: "\u7814\u7A76\u57FA\u7840\u8BC4\u4F30" },
  "research-direction-steering": { code: "C01P06", label: "\u7814\u7A76\u65B9\u5411\u5F15\u5BFC" },
  // ── C02 文献调研 ──
  "literature-search": { code: "C02P01", label: "\u6587\u732E\u68C0\u7D22" },
  "literature-screening": { code: "C02P02", label: "\u6587\u732E\u7B5B\u9009" },
  "paper-fulltext-download": { code: "C02P03", label: "\u8BBA\u6587\u5168\u6587\u4E0B\u8F7D" },
  "literature-review": { code: "C02P04", label: "\u6587\u732E\u7EFC\u8FF0" },
  "research-landscape": { code: "C02P05", label: "\u7814\u7A76\u5168\u666F" },
  // ── C03 创新与假设 ──
  "research-theme-generation": { code: "C03P01", label: "\u751F\u6210\u7814\u7A76\u4E3B\u9898" },
  "innovation-gap-analysis": { code: "C03P02", label: "\u521B\u65B0\u7F3A\u53E3\u5206\u6790" },
  "idea-novelty-assessment": { code: "C03P03", label: "\u65B0\u9896\u6027\u8BC4\u4F30" },
  "hypothesis-formulation": { code: "C03P04", label: "\u5047\u8BBE\u5F62\u5F0F\u5316" },
  "contribution-design": { code: "C03P05", label: "\u8D21\u732E\u8BBE\u8BA1" },
  // ── C04 研究计划 ──
  "research-strategy-portfolio": { code: "C04P01", label: "\u7814\u7A76\u7B56\u7565\u7EC4\u5408" },
  "research-method-design": { code: "C04P02", label: "\u7814\u7A76\u65B9\u6CD5\u8BBE\u8BA1" },
  "experiment-pipeline-design": { code: "C04P03", label: "\u5B9E\u9A8C\u6D41\u6C34\u7EBF\u8BBE\u8BA1" },
  "plan-risk-assessment": { code: "C04P04", label: "\u8BA1\u5212\u98CE\u9669\u8BC4\u4F30" },
  "research-risk-assessment": { code: "C04P05", label: "\u7814\u7A76\u98CE\u9669\u8BC4\u4F30" },
  // ── C05 资源估计 ──
  "resource-requirement-estimation": { code: "C05P01", label: "\u8D44\u6E90\u9700\u6C42\u4F30\u7B97" },
  "infrastructure-cost-selection": { code: "C05P02", label: "\u57FA\u7840\u8BBE\u65BD\u9009\u578B" },
  "feasibility-cost-and-resource-plan": { code: "C05P03", label: "\u53EF\u884C\u6027\u4E0E\u8D44\u6E90\u89C4\u5212" },
  // ── C06 研究决策（实验前：决定做研究）──
  "research-topic-ranking": { code: "C06P01", label: "\u7814\u7A76\u4E3B\u9898\u6392\u5E8F" },
  "research-direction": { code: "C06P02", label: "\u7814\u7A76\u65B9\u5411\u6536\u655B" },
  "research-direction-selection": { code: "C06P03", label: "\u7814\u7A76\u65B9\u5411\u9009\u62E9" },
  "go-no-go-decision": { code: "C06P04", label: "\u7EE7\u7EED/\u653E\u5F03\u51B3\u7B56" },
  // ── C07 实验验证（含仿真与结果分析）──
  "experiment-design": { code: "C07P01", label: "\u5B9E\u9A8C\u8BBE\u8BA1" },
  "simulation-baseline": { code: "C07P02", label: "\u4EFF\u771F\u5B9E\u9A8C" },
  "dataset-selection": { code: "C07P03", label: "\u6570\u636E\u96C6\u9009\u62E9" },
  "baseline-selection": { code: "C07P04", label: "\u57FA\u7EBF\u9009\u62E9" },
  "evaluation-protocol": { code: "C07P05", label: "\u8BC4\u6D4B\u534F\u8BAE" },
  "ablation-design": { code: "C07P06", label: "\u6D88\u878D\u8BBE\u8BA1" },
  "reproducible-implementation-spec": { code: "C07P07", label: "\u53EF\u590D\u73B0\u5B9E\u73B0\u89C4\u8303" },
  "method-implementation-spec": { code: "C07P11", label: "\u65B9\u6CD5\u5B9E\u73B0\u89C4\u683C" },
  "result-analysis": { code: "C07P08", label: "\u7ED3\u679C\u5206\u6790" },
  "comparative-analysis": { code: "C07P09", label: "\u5BF9\u6BD4\u5206\u6790" },
  "evidence-assessment": { code: "C07P10", label: "\u8BC1\u636E\u8BC4\u4F30" },
  // ── C08 论文写作（草稿 → 正式稿）──
  "venue-fit-decision": { code: "C08P01", label: "\u6295\u7A3F\u6E20\u9053\u51B3\u7B56" },
  "paper-architecture": { code: "C08P02", label: "\u8BBA\u6587\u67B6\u6784" },
  "research-narrative": { code: "C08P03", label: "\u7814\u7A76\u53D9\u4E8B" },
  "section-drafting": { code: "C08P04", label: "\u7AE0\u8282\u8D77\u8349" },
  "equation-formalization": { code: "C08P05", label: "\u516C\u5F0F\u5F62\u5F0F\u5316" },
  "visual-evidence-selection": { code: "C08P06", label: "\u56FE\u8868\u8BC1\u636E\u9009\u62E9" },
  "paper-diagrams": { code: "C08P07", label: "\u8BBA\u6587\u914D\u56FE" },
  "manuscript-revision": { code: "C08P08", label: "\u624B\u7A3F\u4FEE\u8BA2" },
  "submission-compile-and-format": { code: "C08P09", label: "\u6295\u7A3F\u7F16\u8BD1\u4E0E\u683C\u5F0F\u5316" },
  "technical-report-writing": { code: "C08P10", label: "\u6280\u672F\u62A5\u544A\u5199\u4F5C" },
  "patent-drafting": { code: "C08P11", label: "\u4E13\u5229\u64B0\u5199" },
  "presentation-design": { code: "C08P12", label: "\u6F14\u8BB2\u8BBE\u8BA1" },
  // ── C09 工作评阅 ──
  // 顺序 = **评阅场合从早到晚**，不是按重要性：
  //   只有方向 → 有研究状态 → 证据链 → 正文表达 → 面向投稿包/期刊政策
  // P05 不算把 P04 拆细：它审的是"能不能投、投出去会怎么被拒"，
  // 输出是编辑建议 / 评分卡 / 整改计划，与"研究工作本身好不好"是两个问题。
  "research-direction-review": { code: "C09P01", label: "\u9009\u9898\u65B9\u5411\u8BC4\u9605" },
  "research-quality-review": { code: "C09P02", label: "\u7814\u7A76\u5DE5\u4F5C\u8D28\u91CF\u8BC4\u9605" },
  "experimental-evidence-review": { code: "C09P03", label: "\u5B9E\u9A8C\u4E0E\u8BC1\u636E\u8BC4\u9605" },
  "paper-claim-review": { code: "C09P04", label: "\u8BBA\u6587\u4E0E\u4E3B\u5F20\u8BC4\u9605" },
  "pre-submission-review": { code: "C09P05", label: "\u6295\u7A3F\u524D\u8BC4\u9605" }
};
function skillCode(skillId) {
  return SKILL_CODES[skillId]?.code;
}
function skillLabel(skillId) {
  return SKILL_CODES[skillId]?.label;
}
function skillIdByCode(code) {
  const key = code.trim().toUpperCase();
  if (!key)
    return void 0;
  for (const [skillId, entry] of Object.entries(SKILL_CODES)) {
    if (entry.code === key)
      return skillId;
  }
  return void 0;
}
function looksLikeSkillCode(key) {
  return /^C\d{2}P\d{2}$/i.test(key.trim());
}
function skillSortKey(skillId) {
  const code = SKILL_CODES[skillId]?.code;
  if (code)
    return code;
  return `Z${skillId}`;
}

// lib/research/skills.js
var SKILLS_DIR = "skills";
function findSection2(doc, ...names) {
  for (const want of names) {
    const w = want.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
    const hit = doc.sections.find((s) => s.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "") === w);
    if (hit)
      return hit.body;
  }
  return "";
}
function isMethodSkill(doc) {
  return doc.kind === "method";
}
function skillPurpose(doc) {
  return findSection2(doc, "Purpose", "\u76EE\u7684");
}
function skillWhenToUse(doc) {
  return findSection2(doc, "When to Use", "When To Use", "When");
}
function parseSkillFrontmatter(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m)
    return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#"))
      continue;
    const idx = line.indexOf(":");
    if (idx <= 0)
      continue;
    const key = line.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key))
      continue;
    out[key] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
function stripSkillFrontmatter(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
function normalizeStatus(raw) {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "draft" || v === "archived" || v === "active" ? v : "active";
}
function parseSkillDocument(absPath, relPath, typeDefault = "system") {
  let source;
  try {
    source = readFileSync3(absPath, "utf8");
  } catch {
    return null;
  }
  const fm = parseSkillFrontmatter(source);
  const body = stripSkillFrontmatter(source).trim();
  const parsed = parseSections(body);
  const skillTitle = parsed.title?.replace(/^Skill:\s*/i, "") ?? null;
  const id = (absPath.split(/[\\/]/).pop() ?? "").replace(/\.md$/, "");
  const category = normalizeCategoryId(fm.category);
  const code = skillCode(id);
  const label = skillLabel(id);
  const type = fm.type === "system" || fm.type === "user" || fm.type === "derived" ? fm.type : typeDefault;
  return {
    id,
    name: skillTitle || fm.name || id,
    kind: fm.kind === "operation" ? "operation" : "method",
    ...category ? { category } : {},
    ...code ? { code } : {},
    ...label ? { label } : {},
    type,
    status: normalizeStatus(fm.status),
    version: fm.version || "1.0",
    sections: parsed.sections,
    body,
    path: absPath,
    relPath,
    // 系统库由我们维护，运行时**只读**
    editable: false
  };
}
function listMarkdownRecursive(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith("."))
        continue;
      const abs = join3(dir, e.name);
      if (e.isDirectory())
        walk(abs);
      else if (e.name.endsWith(".md")) {
        const rel = relative(root, abs).replace(/\\/g, "/");
        out.push({ abs, rel });
      }
    }
  };
  walk(root);
  return out;
}
function systemSkillRoot() {
  const hereDir = dirname2(fileURLToPath(new URL("./research/skills.js", import.meta.url).href));
  const candidates = [
    join3(hereDir, "..", "..", "skills", "convfusion-research", "references"),
    // Codex method library
    join3(hereDir, "..", "..", SKILLS_DIR),
    // lib/research → 包根
    join3(hereDir, "..", "..", "..", SKILLS_DIR),
    // 布局变化兜底
    join3(process.cwd(), SKILLS_DIR)
  ];
  for (const c of candidates) {
    if (existsSync3(c))
      return c;
  }
  return candidates[0];
}
function listSystemSkills(root) {
  const base = root ?? systemSkillRoot();
  const docs = [];
  for (const { abs, rel } of listMarkdownRecursive(base)) {
    const doc = parseSkillDocument(abs, `${SKILLS_DIR}/${rel}`, "system");
    if (doc)
      docs.push({ ...doc, type: "system", editable: false });
  }
  return docs.sort((a, b) => skillSortKey(a.id).localeCompare(skillSortKey(b.id)));
}

// lib/research/skill-customization.js
function normalizeCustomizationKey(rawKey) {
  const key = rawKey.trim();
  if (!key)
    return void 0;
  if (looksLikeSkillCode(key))
    return skillIdByCode(key) ?? key;
  return key;
}
function sortCustomizations(c) {
  const out = {};
  for (const skillId of Object.keys(c).sort((a, b) => skillSortKey(a).localeCompare(skillSortKey(b)))) {
    out[skillId] = c[skillId];
  }
  return out;
}
function parseCustomizations(raw) {
  if (!raw || !raw.trim())
    return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v))
      return {};
    const out = {};
    for (const [rawKey, sections] of Object.entries(v)) {
      if (!sections || typeof sections !== "object" || Array.isArray(sections))
        continue;
      const skillId = normalizeCustomizationKey(rawKey);
      if (!skillId)
        continue;
      const clean = { ...out[skillId] ?? {} };
      for (const [section, text] of Object.entries(sections)) {
        if (typeof text === "string" && text.trim())
          clean[section] = text;
      }
      if (Object.keys(clean).length > 0)
        out[skillId] = clean;
    }
    return sortCustomizations(out);
  } catch {
    return {};
  }
}
function createFileCustomizationStore(resolvePath) {
  const readAll = () => {
    const file = resolvePath();
    if (!existsSync4(file))
      return {};
    try {
      return parseCustomizations(readFileSync4(file, "utf8"));
    } catch {
      return {};
    }
  };
  const writeAll = (c) => {
    const file = resolvePath();
    if (Object.keys(c).length === 0) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync2(dirname3(file), { recursive: true });
    writeFileSync2(file, JSON.stringify(sortCustomizations(c), null, 2) + "\n", "utf8");
  };
  return {
    get description() {
      return `file: ${resolvePath()}`;
    },
    load: readAll,
    set: (skillId, section, text) => {
      const c = readAll();
      const sections = { ...c[skillId] ?? {} };
      if (text.trim())
        sections[section] = text;
      else
        delete sections[section];
      if (Object.keys(sections).length > 0)
        c[skillId] = sections;
      else
        delete c[skillId];
      writeAll(c);
    }
  };
}
var USER_SECTION_HEADER = "=== \u7528\u6237\u989D\u5916\u8981\u6C42\uFF08User additions\uFF09===";
var BASE_SECTION_HEADER = "=== \u539F\u6709\u65B9\u6CD5\uFF08Original method\uFF09===";
function composeSkillContent(baseContent, overrides) {
  const entries = Object.entries(overrides ?? {}).filter(([, t]) => t.trim());
  if (entries.length === 0)
    return baseContent;
  const userBlocks = entries.map(([section, text]) => `## ${section}

${text.trim()}`);
  return [
    USER_SECTION_HEADER,
    "",
    "The researcher has specified the following additions to this method. Follow them as part of",
    "the method; where they are more specific than the original, they take precedence.",
    "",
    ...userBlocks,
    "",
    BASE_SECTION_HEADER,
    "",
    baseContent
  ].join("\n");
}
var here = dirname3(fileURLToPath2(new URL("./research/skill-customization.js", import.meta.url).href));

// lib/research/library.js
function effectiveSkillContentById(id, store) {
  const doc = listSystemSkills().find((d) => d.id === id);
  if (!doc)
    return void 0;
  return effectiveSkillContent(doc, store?.load() ?? {});
}
function effectiveSkillContent(doc, customizations) {
  return composeSkillContent(doc.body, customizations[doc.id]);
}
function loadSkillLibrary(workspace, store) {
  const customizations = store?.load() ?? {};
  const docs = listSystemSkills().filter(isMethodSkill);
  const entries = docs.map((document) => {
    const overrides = customizations[document.id] ?? {};
    return {
      document,
      purpose: skillPurpose(document),
      whenToUse: skillWhenToUse(document),
      categoryName: categoryName(document.category, []),
      ...categoryGroup(document.category) ? { group: categoryGroup(document.category) } : {},
      customizedSections: Object.values(overrides).filter((t) => t.trim()).length,
      effectiveContent: effectiveSkillContent(document, customizations)
    };
  });
  const count = (t) => entries.filter((e) => e.document.type === t).length;
  return {
    workspace,
    entries,
    categories: [...SYSTEM_CATEGORIES],
    groups: [...systemGroups()],
    counts: {
      system: count("system"),
      user: count("user"),
      derived: count("derived"),
      total: entries.length,
      customized: entries.filter((e) => e.customizedSections > 0).length
    }
  };
}
function recommendSkills(workspace, context, store) {
  const view = loadSkillLibrary(workspace, store);
  const terms = [context.topic ?? "", ...context.keywords ?? []].join(" ").toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((t) => t.length >= 3);
  if (terms.length === 0)
    return [];
  return view.entries.map((e) => {
    const hay = `${e.document.name} ${e.document.id} ${e.purpose} ${e.whenToUse} ${e.document.category ?? ""}`.toLowerCase();
    const score = terms.reduce((n, t) => hay.includes(t) ? n + 1 : n, 0);
    return { e, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.e);
}
function skillSummaries(_workspace) {
  return listSystemSkills().filter((d) => d.status === "active").map((d) => ({
    id: d.id,
    name: d.name,
    purpose: skillPurpose(d),
    whenToUse: skillWhenToUse(d),
    ...d.category ? { category: d.category } : {},
    type: d.type,
    path: d.relPath
  }));
}

// lib/research/stage-signals.js
import { existsSync as existsSync9, readFileSync as readFileSync10, readdirSync as readdirSync7, statSync as statSync2 } from "node:fs";
import { join as join9, relative as relative2, sep } from "node:path";

// lib/research/claims.js
import { existsSync as existsSync6, mkdirSync as mkdirSync4, readFileSync as readFileSync6, readdirSync as readdirSync4, rmSync as rmSync3, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join5 } from "node:path";

// lib/research/evidence.js
import { existsSync as existsSync5, mkdirSync as mkdirSync3, readFileSync as readFileSync5, readdirSync as readdirSync3, rmSync as rmSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join4 } from "node:path";
var EVIDENCE_HISTORY = `${EVIDENCE_DIR}/.history`;
function normalizeSource(raw) {
  const v = (raw ?? "").trim().toLowerCase();
  return EVIDENCE_SOURCES.includes(v) ? v : "observation";
}
function normalizeStatus2(raw) {
  const v = (raw ?? "").trim().toLowerCase();
  return EVIDENCE_STATUSES.includes(v) ? v : "unverified";
}
function normalizePlanRef(raw) {
  const v = (raw ?? "").trim();
  if (!v)
    return void 0;
  return v.replace(/^plans\//, "").replace(/\.md$/, "");
}
function parseEvidenceDocument(absPath, relPath) {
  let source;
  try {
    source = readFileSync5(absPath, "utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(source);
  const body = stripFrontmatter(source).trim();
  const parsed = parseSections(body);
  const id = (absPath.split("/").pop() ?? "").replace(/\.md$/, "").toUpperCase();
  return {
    id,
    name: (parsed.title ?? "").replace(/^Evidence:\s*/i, "").trim() || fm.name || id,
    type: fm.type || `${normalizeSource(fm.source_kind ?? fm.source)}-evidence`,
    sourceKind: normalizeSource(fm.source_kind ?? fm.source),
    status: normalizeStatus2(fm.status),
    supports: parseIdList(fm.supports ?? findSection(parsed.sections, "Supports")),
    contradicts: parseIdList(fm.contradicts),
    ...fm.supersedes ? { supersedes: fm.supersedes.toUpperCase() } : {},
    ...fm.superseded_by ? { supersededBy: fm.superseded_by.toUpperCase() } : {},
    provenance: {
      ...normalizePlanRef(fm.plan) ? { plan: normalizePlanRef(fm.plan) } : {},
      ...fm.harness_session ? { harnessSession: fm.harness_session } : {},
      ...fm.source_skill ? { sourceSkill: fm.source_skill } : {},
      ...fm.citation ? { citation: fm.citation } : {},
      ...fm.source && !EVIDENCE_SOURCES.includes(fm.source) ? { source: fm.source } : {},
      ...fm.paper ? { paper: fm.paper } : {},
      // ⚠️ 两种载体要分别解析：frontmatter 里是 `a | b`，Markdown 章节里是列表项。
      // 混用同一个解析器会把 frontmatter 形式解析成空数组（曾经的真 bug）。
      rawArtifacts: fm.raw_artifacts ? splitDelimited(fm.raw_artifacts) : parseArtifacts(findSection(parsed.sections, "Supporting Data"))
    },
    ...fm.created_at ? { createdAt: fm.created_at } : {},
    ...fm.updated_at ? { updatedAt: fm.updated_at } : {},
    sections: parsed.sections,
    body,
    path: absPath,
    relPath
  };
}
function splitDelimited(raw) {
  if (!raw)
    return [];
  return [...new Set(raw.split("|").map((s) => s.trim()).filter((s) => s.length > 0))];
}
function parseArtifacts(raw) {
  if (!raw)
    return [];
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/) ?? line.match(/`([^`]+)`/);
    if (m) {
      const v = m[1].trim().replace(/^`|`$/g, "");
      if (v && !v.startsWith("<!--"))
        out.push(v);
    }
  }
  return [...new Set(out)];
}
function listMarkdown(dir) {
  try {
    return readdirSync3(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith(".")).map((e) => e.name).sort();
  } catch {
    return [];
  }
}
function listEvidence(workspace) {
  const dir = join4(workspace, EVIDENCE_DIR);
  const out = [];
  for (const file of listMarkdown(dir)) {
    const doc = parseEvidenceDocument(join4(dir, file), `${EVIDENCE_DIR}/${file}`);
    if (doc)
      out.push(doc);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// lib/research/claims.js
function listMarkdown2(dir) {
  try {
    return readdirSync4(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith(".")).map((e) => e.name).sort();
  } catch {
    return [];
  }
}
function normalizeClaimStatus(raw) {
  const v = (raw ?? "").trim().toLowerCase();
  return CLAIM_STATUSES.includes(v) ? v : "unverified";
}
function parseClaimDocument(absPath, relPath) {
  let source;
  try {
    source = readFileSync6(absPath, "utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(source);
  const body = stripFrontmatter(source).trim();
  const parsed = parseSections(body);
  const id = (absPath.split("/").pop() ?? "").replace(/\.md$/, "").toUpperCase();
  return {
    id,
    statement: findSection(parsed.sections, "Statement", "Claim") || parsed.title || fm.name || id,
    status: normalizeClaimStatus(fm.status),
    evidence: parseIdList(fm.evidence),
    contradictions: parseIdList(fm.contradicts),
    ...fm.required_evidence || findSection(parsed.sections, "Required Evidence") ? { requiredEvidence: fm.required_evidence || findSection(parsed.sections, "Required Evidence") } : {},
    ...fm.paper ? { paper: fm.paper } : {},
    ...fm.created_at ? { createdAt: fm.created_at } : {},
    ...fm.updated_at ? { updatedAt: fm.updated_at } : {},
    sections: parsed.sections,
    body,
    path: absPath,
    relPath
  };
}
function listClaims(workspace) {
  const dir = join5(workspace, CLAIMS_DIR);
  const out = [];
  for (const file of listMarkdown2(dir)) {
    const doc = parseClaimDocument(join5(dir, file), `${CLAIMS_DIR}/${file}`);
    if (doc)
      out.push(doc);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
function parseDecisionDocument(absPath, relPath) {
  let source;
  try {
    source = readFileSync6(absPath, "utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(source);
  const body = stripFrontmatter(source).trim();
  const parsed = parseSections(body);
  const id = (absPath.split("/").pop() ?? "").replace(/\.md$/, "").toUpperCase();
  return {
    id,
    decision: findSection(parsed.sections, "Decision") || parsed.title || fm.name || id,
    reason: findSection(parsed.sections, "Reason"),
    evidence: parseIdList(fm.evidence),
    alternatives: findSection(parsed.sections, "Alternatives Considered", "Alternatives"),
    status: fm.status || "decided",
    ...fm.created_at ? { createdAt: fm.created_at } : {},
    ...fm.updated_at ? { updatedAt: fm.updated_at } : {},
    sections: parsed.sections,
    body,
    path: absPath,
    relPath
  };
}
function listDecisions(workspace) {
  const dir = join5(workspace, DECISIONS_DIR);
  const out = [];
  for (const file of listMarkdown2(dir)) {
    const doc = parseDecisionDocument(join5(dir, file), `${DECISIONS_DIR}/${file}`);
    if (doc)
      out.push(doc);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// lib/research/plans.js
import { readFileSync as readFileSync7, readdirSync as readdirSync5 } from "node:fs";
import { join as join6 } from "node:path";
var PLAN_STATUSES = [
  "draft",
  "reviewed",
  "ready",
  "executing",
  "completed",
  "refined",
  "archived"
];
var PLANS_DIR = "plans";
var PLAN_HISTORY_DIR = "plans/history";
function parsePlanFrontmatter(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m)
    return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#"))
      continue;
    const idx = line.indexOf(":");
    if (idx <= 0)
      continue;
    const key = line.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key))
      continue;
    out[key] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
function stripPlanFrontmatter(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
function parsePlanSections(body) {
  const parsed = parseSections(body);
  return { title: parsed.title?.replace(/^Plan:\s*/i, "") ?? null, sections: parsed.sections };
}
function normalizeStatus3(raw) {
  const v = (raw ?? "").trim().toLowerCase();
  if (PLAN_STATUSES.includes(v))
    return v;
  return STATUS_SYNONYMS[v] ?? "draft";
}
function parseBodyStatusLine(body) {
  const m = body.match(/^\s*[-*]\s*状态\s*[:：]\s*([^\s（(]+)/m);
  return m ? m[1] : void 0;
}
var STATUS_SYNONYMS = {
  complete: "completed",
  done: "completed",
  finalized: "completed",
  \u5B9A\u7A3F: "completed",
  \u5DF2\u6267\u884C: "completed",
  executed: "completed",
  "in-progress": "executing",
  inprogress: "executing",
  \u8FDB\u884C\u4E2D: "executing",
  \u6267\u884C\u4E2D: "executing",
  \u5DF2\u8BC4\u5BA1: "reviewed",
  \u5C31\u7EEA: "ready",
  \u5DF2\u5F52\u6863: "archived"
};
function parsePlanDocument(absPath, relPath) {
  let source;
  try {
    source = readFileSync7(absPath, "utf8");
  } catch {
    return null;
  }
  const fm = parsePlanFrontmatter(source);
  const body = stripPlanFrontmatter(source).trim();
  const parsed = parsePlanSections(body);
  const id = absPath.split("/").pop().replace(/\.md$/, "");
  return {
    id,
    name: parsed.title || fm.name || id,
    type: fm.type || "research-plan",
    // 状态：frontmatter `status:` 优先；缺省时回退到正文 `- 状态：` 行（研究工作流约定）
    status: normalizeStatus3(fm.status ?? parseBodyStatusLine(body)),
    version: fm.version || "1.0",
    ...fm.source_skill || fm.sourceSkill ? { sourceSkill: fm.source_skill || fm.sourceSkill } : {},
    ...fm.source_skill_version || fm.sourceSkillVersion ? { sourceSkillVersion: fm.source_skill_version || fm.sourceSkillVersion } : {},
    ...fm.paper ? { paper: fm.paper } : {},
    ...fm.research_context || fm.researchContext ? { researchContext: fm.research_context || fm.researchContext } : {},
    ...fm.created_at ? { createdAt: fm.created_at } : {},
    ...fm.updated_at ? { updatedAt: fm.updated_at } : {},
    ...fm.review_policy === "auto-execute" || fm.review_policy === "review-required" ? { reviewPolicy: fm.review_policy } : {},
    sections: parsed.sections,
    body,
    path: absPath,
    relPath
  };
}
function listMarkdown3(dir) {
  try {
    return readdirSync5(dir).filter((f) => f.endsWith(".md") && !f.startsWith(".")).sort();
  } catch {
    return [];
  }
}
function listPlanDocuments(workspace) {
  const dir = join6(workspace, PLANS_DIR);
  const out = [];
  for (const file of listMarkdown3(dir)) {
    const doc = parsePlanDocument(join6(dir, file), `${PLANS_DIR}/${file}`);
    if (doc)
      out.push(doc);
  }
  return out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id));
}

// lib/research/paper.js
import { existsSync as existsSync7, mkdirSync as mkdirSync5, readFileSync as readFileSync8, readdirSync as readdirSync6, rmSync as rmSync4, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join7 } from "node:path";

// lib/research/output-data.js
var OUTPUT_TYPES = ["paper", "patent", "technical-report", "slides"];
var OUTPUT_DIRS = {
  paper: "papers",
  patent: "patents",
  "technical-report": "reports",
  slides: "slides"
};
var OUTPUT_STATUSES = ["draft", "reviewed", "approved", "archived"];
var OUTPUTS_DIR = "outputs";
var OUTPUT_MAIN_FILE = {
  paper: "paper.md",
  patent: "patent.md",
  "technical-report": "report.md",
  slides: "slides.md"
};

// lib/research/workspace-layout.js
var REVIEW_DIR = "review";
var WORKSPACE_LAYOUT = [
  // ── Research Definition（§2 根文件；由 project.ts / research-state.ts 写入）──
  { path: PROJECT_FILE, category: "definition", kind: "core", duty: "\u5B9A\u4E49\u7814\u7A76\u662F\u4EC0\u4E48" },
  { path: RESEARCH_STATE_FILE, category: "definition", kind: "core", duty: "\u63CF\u8FF0\u5F53\u524D\u7814\u7A76\u72B6\u6001" },
  // ── Research Inputs（§4：原始附件，保持原样，不静默修改）──
  { path: "attachments", category: "inputs", kind: "optional", duty: "\u539F\u59CB\u8F93\u5165\u6750\u6599" },
  { path: "attachments/papers", category: "inputs", kind: "optional", duty: "\u8BBA\u6587/\u6587\u732E\u539F\u4EF6" },
  { path: "attachments/datasets", category: "inputs", kind: "optional", duty: "\u6570\u636E\u96C6\u539F\u4EF6" },
  { path: "attachments/figures", category: "inputs", kind: "optional", duty: "\u56FE\u7247\u539F\u4EF6" },
  { path: "attachments/reference", category: "inputs", kind: "optional", duty: "\u53C2\u8003\u8D44\u6599\u539F\u4EF6" },
  // ── Research Assets ──
  { path: "plans", category: "assets", kind: "core", duty: "\u9488\u5BF9\u5F53\u524D\u7814\u7A76\u7684\u5177\u4F53\u7814\u7A76\u8BA1\u5212" },
  { path: "experiments", category: "assets", kind: "optional", duty: "\u5B9E\u9A8C\u4EE3\u7801/\u914D\u7F6E/\u6570\u636E/\u7ED3\u679C" },
  // 评阅记录：与 `research/` 平级（`REVIEW_DIR` 同时是服务器对关系方保留的前缀）
  { path: REVIEW_DIR, category: "assets", kind: "optional", duty: "\u8BC4\u9605\u8BB0\u5F55\uFF1A\u8BCA\u65AD\u3001\u53D1\u73B0\u4E0E\u6307\u5BFC" },
  { path: RESEARCH_DIR, category: "assets", kind: "core", duty: "\u7ED3\u6784\u5316\u7814\u7A76\u8D44\u4EA7\u6839" },
  { path: `${RESEARCH_DIR}/evidence`, category: "assets", kind: "core", duty: "\u7ECF\u8FC7\u786E\u8BA4\u7684\u79D1\u5B66\u8BC1\u636E" },
  { path: `${RESEARCH_DIR}/claims`, category: "assets", kind: "core", duty: "\u79D1\u5B66\u4E3B\u5F20" },
  { path: `${RESEARCH_DIR}/decisions`, category: "assets", kind: "core", duty: "\u7814\u7A76\u51B3\u7B56\u53CA\u5176\u4F9D\u636E" },
  { path: `${RESEARCH_DIR}/state-history`, category: "assets", kind: "core", duty: "Research State \u5386\u53F2\u7248\u672C" },
  // Research IR Kernel（v0.5.6）：machine-facing 的 Typed IR + 状态版本 + Decision Trace。
  // 按需产生 —— 不用 IR 内核的研究不该凭空多出这个目录。
  { path: `${RESEARCH_DIR}/ir`, category: "assets", kind: "optional", duty: "Typed Research IR\uFF08IR###.json / states / trace\uFF09" },
  // ── Harness Runtime（§3：执行过程与原始运行产物）──
  { path: "harness", category: "runtime", kind: "optional", duty: "Harness \u6267\u884C\u8FC7\u7A0B\u4E0E\u539F\u59CB\u4EA7\u7269\u6839" },
  { path: "harness/sessions", category: "runtime", kind: "optional", duty: "\u4F1A\u8BDD\u8BB0\u5F55" },
  { path: "harness/events", category: "runtime", kind: "optional", duty: "\u8FD0\u884C\u4E8B\u4EF6" },
  { path: "harness/artifacts", category: "runtime", kind: "optional", duty: "\u539F\u59CB\u8FD0\u884C\u4EA7\u7269" },
  // ── Research Outputs ──
  { path: "papers", category: "outputs", kind: "optional", duty: "Paper \u53CA\u5176\u6F14\u5316" },
  { path: OUTPUTS_DIR, category: "outputs", kind: "optional", duty: "\u5176\u4ED6\u6210\u679C\u6839" },
  { path: `${OUTPUTS_DIR}/patents`, category: "outputs", kind: "optional", duty: "Patent" },
  { path: `${OUTPUTS_DIR}/reports`, category: "outputs", kind: "optional", duty: "Technical Report" },
  { path: `${OUTPUTS_DIR}/slides`, category: "outputs", kind: "optional", duty: "Presentation" }
];

// lib/research/paper.js
function paperDir(workspace, paperId = DEFAULT_PAPER_ID) {
  return join7(workspace, PAPERS_DIR, paperId);
}
function paperRelDir(paperId = DEFAULT_PAPER_ID) {
  return `${PAPERS_DIR}/${paperId}`;
}
function filePath(workspace, paperId, name) {
  return join7(paperDir(workspace, paperId), name);
}
function readTextOrNull(p) {
  try {
    return readFileSync8(p, "utf8");
  } catch {
    return null;
  }
}
function normalizeStatus4(raw) {
  const v = (raw ?? "").trim().toLowerCase();
  return PAPER_STATUSES.includes(v) ? v : "evolving";
}
function parseMetadata(source, fallbackId) {
  const fm = source ? parseFrontmatter(source) : {};
  const body = source ? stripFrontmatter(source) : "";
  const h1 = body.match(/^#\s+(.+)$/m);
  return {
    id: fm.id || fallbackId.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "PAPER001",
    ...fm.title ? { title: fm.title } : h1 ? { title: h1[1].trim() } : {},
    status: normalizeStatus4(fm.status),
    version: fm.version || "0.1",
    ...fm.research_project ? { researchProject: fm.research_project } : {},
    ...fm.research_state_version ? { researchStateVersion: fm.research_state_version } : {},
    ...fm.authors ? { authors: fm.authors } : {},
    ...fm.affiliation ? { affiliation: fm.affiliation } : {},
    ...fm.target_venue ? { targetVenue: fm.target_venue } : {},
    ...fm.research_domain ? { researchDomain: fm.research_domain } : {},
    ...fm.research_track ? { researchTrack: String(fm.research_track).toLowerCase().trim() } : {},
    ...fm.paper_type ? { paperType: String(fm.paper_type).toLowerCase().trim() } : {},
    ...fm.created_at ? { createdAt: fm.created_at } : {},
    ...fm.updated_at ? { updatedAt: fm.updated_at } : {}
  };
}
function hasManuscript(workspace) {
  const active = getActivePaperId(workspace);
  if (existsSync7(join7(paperDir(workspace, active), "paper.md")))
    return true;
  return listPaperIds(workspace).some((id) => existsSync7(join7(paperDir(workspace, id), "paper.md")));
}
function listPaperIds(workspace) {
  try {
    return readdirSync6(join7(workspace, PAPERS_DIR), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
  } catch {
    return [];
  }
}
function listPapers(workspace) {
  return listPaperIds(workspace).map((id) => readPaper(workspace, id)).filter((p) => p !== null);
}
function getActivePaperId(workspace) {
  const activeFile = join7(workspace, ACTIVE_PAPER_FILE);
  try {
    const id = readFileSync8(activeFile, "utf8").trim();
    if (readPaper(workspace, id))
      return id;
  } catch {
  }
  const papers = listPaperIds(workspace);
  if (papers.includes(DEFAULT_PAPER_ID))
    return DEFAULT_PAPER_ID;
  return papers[0] ?? DEFAULT_PAPER_ID;
}
function readPaper(workspace, paperId = DEFAULT_PAPER_ID) {
  const dir = paperDir(workspace, paperId);
  if (!existsSync7(dir))
    return null;
  const manuscriptSource = readTextOrNull(filePath(workspace, paperId, PAPER_FILES.manuscript));
  const metadataSource = readTextOrNull(filePath(workspace, paperId, PAPER_FILES.metadata));
  if (manuscriptSource === null && metadataSource === null)
    return null;
  const manuscript = manuscriptSource ? stripFrontmatter(manuscriptSource).trim() : "";
  const parsed = parseSections(manuscript);
  return {
    id: paperId,
    dir,
    relDir: paperRelDir(paperId),
    metadata: parseMetadata(metadataSource, paperId),
    manuscript,
    sections: parsed.sections.map((s) => ({ title: normalizeSectionName(s.title), body: s.body })),
    present: {
      manuscript: manuscriptSource !== null,
      metadata: metadataSource !== null,
      evolution: existsSync7(filePath(workspace, paperId, PAPER_FILES.evolution)),
      claims: existsSync7(filePath(workspace, paperId, PAPER_FILES.claims)),
      evidence: existsSync7(filePath(workspace, paperId, PAPER_FILES.evidence)),
      gaps: existsSync7(filePath(workspace, paperId, PAPER_FILES.gaps))
    }
  };
}
function readClaimMap(workspace, paperId = DEFAULT_PAPER_ID) {
  const paper = readPaper(workspace, paperId);
  if (!paper)
    return [];
  const source = readTextOrNull(filePath(workspace, paperId, PAPER_FILES.claims));
  if (source) {
    const sections = parseSections(stripFrontmatter(source)).sections;
    const entries = [];
    for (const s of sections) {
      if (!/^C\d{1,4}$/.test(s.title.trim()))
        continue;
      entries.push({
        id: s.title.trim(),
        statement: findSection([s], "Statement") || s.body.split("\n")[0] || "",
        status: (findSection([s], "Status") || "unknown").split("\n")[0].trim(),
        evidence: (findSection([s], "Evidence").match(/E\d{1,4}/g) ?? []).map((x) => x.toUpperCase()),
        contradictions: (findSection([s], "Contradicting Evidence").match(/E\d{1,4}/g) ?? []).map((x) => x.toUpperCase()),
        sections: (findSection([s], "Paper Sections").match(/^[-*]\s*(.+)$/gm) ?? []).map((l) => l.replace(/^[-*]\s*/, "").trim())
      });
    }
    const isClaimId = manuscriptClaimIdMatcher(listClaims(workspace).map((c) => c.id));
    const fromManuscript = deriveClaimMapFromManuscript(paper, isClaimId);
    if (entries.length > 0) {
      return mergeWithResearchClaims(entries, workspace, { derived: fromManuscript });
    }
    return mergeWithResearchClaims([], workspace, { requireInManuscript: false, derived: fromManuscript });
  }
  const fallbackMatcher = manuscriptClaimIdMatcher(listClaims(workspace).map((c) => c.id));
  return mergeWithResearchClaims([], workspace, { requireInManuscript: false, derived: deriveClaimMapFromManuscript(paper, fallbackMatcher) });
}
function mergeWithResearchClaims(entries, workspace, options = {}) {
  const requireInManuscript = options.requireInManuscript ?? true;
  const authoritative = new Map(listClaims(workspace).map((c) => [c.id, c]));
  const sectionsById = new Map((options.derived ?? []).map((d) => [d.id, d.sections]));
  const byId = /* @__PURE__ */ new Map();
  for (const e of entries) {
    byId.set(e.id, { ...e, sections: [.../* @__PURE__ */ new Set([...e.sections, ...sectionsById.get(e.id) ?? []])] });
  }
  for (const d of options.derived ?? []) {
    if (!byId.has(d.id))
      byId.set(d.id, { ...d });
  }
  for (const [id, c] of authoritative) {
    const existing = byId.get(id);
    if (!existing && requireInManuscript)
      continue;
    byId.set(id, {
      id,
      statement: existing?.statement || c.statement,
      status: c.status,
      evidence: c.evidence,
      contradictions: c.contradictions,
      sections: existing?.sections ?? sectionsById.get(id) ?? []
    });
  }
  return [...byId.values()];
}
function manuscriptClaimIdMatcher(knownIds) {
  const known = new Set(knownIds.map((x) => x.trim().toUpperCase()));
  const shapes = /* @__PURE__ */ new Set();
  for (const id of known) {
    const m = /^([A-Z]+)(\d+)$/.exec(id);
    if (m)
      shapes.add(`${m[1]}${m[2].length}`);
  }
  return (id) => {
    const up = id.trim().toUpperCase();
    if (known.has(up))
      return true;
    const m = /^([A-Z]+)(\d+)$/.exec(up);
    if (!m)
      return false;
    const digits = m[2].length;
    if (shapes.size === 0)
      return digits >= 3;
    return shapes.has(`${m[1]}${digits}`);
  };
}
function deriveClaimMapFromManuscript(paper, isClaimId = manuscriptClaimIdMatcher([])) {
  const byClaim = /* @__PURE__ */ new Map();
  for (const section of paper.sections) {
    const ids = [...new Set((section.body.match(/\b[A-Z]\d{1,4}\b/g) ?? []).map((x) => x.toUpperCase()))].filter(isClaimId);
    for (const id of ids) {
      const entry = byClaim.get(id) ?? { id, statement: "", status: "unknown", evidence: [], contradictions: [], sections: [] };
      entry.sections.push(section.title);
      byClaim.set(id, entry);
    }
  }
  return [...byClaim.values()];
}
function buildEvidenceMap(workspace, paperId = DEFAULT_PAPER_ID) {
  const paper = readPaper(workspace, paperId);
  if (!paper)
    return [];
  const claims = readClaimMap(workspace, paperId);
  const byEvidence = /* @__PURE__ */ new Map();
  for (const c of claims) {
    for (const e of c.evidence) {
      const entry = byEvidence.get(e) ?? { id: e, supports: [], contradicts: [], sections: [] };
      if (!entry.supports.includes(c.id))
        entry.supports.push(c.id);
      entry.sections.push(...c.sections);
      byEvidence.set(e, entry);
    }
    for (const e of c.contradictions) {
      const entry = byEvidence.get(e) ?? { id: e, supports: [], contradicts: [], sections: [] };
      if (!entry.contradicts.includes(c.id))
        entry.contradicts.push(c.id);
      byEvidence.set(e, entry);
    }
  }
  for (const section of paper.sections) {
    const ids = [...new Set((section.body.match(/\bE\d{1,4}\b/g) ?? []).map((x) => x.toUpperCase()))];
    for (const id of ids) {
      const entry = byEvidence.get(id) ?? { id, supports: [], contradicts: [], sections: [] };
      if (!entry.sections.includes(section.title))
        entry.sections.push(section.title);
      byEvidence.set(id, entry);
    }
  }
  return [...byEvidence.values()].map((e) => ({ ...e, sections: [...new Set(e.sections)] })).sort((a, b) => a.id.localeCompare(b.id));
}
var EVOLUTION_INDEX = "evolution.json";
function evolutionIndexPath(workspace, paperId) {
  return filePath(workspace, paperId, EVOLUTION_INDEX);
}
function listEvolutionEvents(workspace, paperId = DEFAULT_PAPER_ID) {
  const raw = readTextOrNull(evolutionIndexPath(workspace, paperId));
  if (!raw)
    return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// lib/research/paper-download.js
var FULLTEXT_DIR = "research/literature/fulltext";
var FULLTEXT_MANIFEST = `${FULLTEXT_DIR}/manifest.json`;
var DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;

// lib/research/action-construction/types.js
var ACTION_TYPES = [
  "single_ablation",
  "binary_contrast",
  "component_scan",
  "factorial"
];

// lib/research/action-construction/environment.js
function environmentFor(state) {
  return {
    k: 6,
    m: 6,
    beta: 2,
    budget: typeof state.budget === "number" && state.budget > 0 ? state.budget : Number.POSITIVE_INFINITY,
    truth: state.truth ?? null
  };
}
var jointScratch = new Float64Array(0);
var logPoScratch = new Float64Array(0);
var maxScratch = new Float64Array(0);

// lib/research/action-construction/prompts.js
var FORMATS = {
  L1: "Decide the single next experiment and answer in exactly one line:\nACTION: <one of: single_ablation | binary_contrast | component_scan | factorial>\nREASON: <at most 20 words>\n",
  L3: "Decide the single next experiment and answer in exactly these four lines:\nTARGET: <h index of the mechanism you want to discriminate>\nARMS: <comma-separated arm indices to run>\nSEEDS: <integer number of seeds per arm, 2..12>\nSUCCESS: <what observation would confirm or reject the target mechanism, at most 20 words>\n"
};
var FORMATS_EXT = {
  L1: FORMATS.L1,
  L2: "Decide the single next experiment and answer in exactly these two lines:\nTARGET: <h index of the mechanism you want to discriminate>\nWHY: <why that is the mechanism to test, at most 20 words>\n",
  L3: FORMATS.L3,
  L4: "Decide the single next experiment and answer in exactly these five lines:\nTARGET: <h index of the mechanism you want to discriminate>\nARMS: <comma-separated arm indices to run>\nSEEDS: <integer number of seeds per arm, 2..12>\nPREDICTION: <what each arm's outcome would be if the target is the cause, one line>\nSUCCESS: <what observation would confirm or reject the target mechanism, at most 20 words>\n"
};

// lib/research/action-construction/parse.js
var VALID_TYPES = new Set(ACTION_TYPES);
var DEFAULT_ENV = environmentFor({
  question: "",
  method: "",
  partial_results: "",
  mechanisms: [],
  arms: [],
  prior: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6],
  budget: 6,
  truth: null
});

// lib/research/action-construction/extract.js
var IMPERATIVE = new RegExp("^(?:[\uFF08(]?\\d*[\uFF09)]?\\s*)?(?:\u505A|\u8DD1|\u6267\u884C|\u8FD0\u884C|\u8BC4\u6D4B|\u8BC4\u4F30|\u6D4B\u8BD5|\u5BF9\u6BD4|\u626B\u63CF|\u6D88\u878D|\u8BAD\u7EC3|\u6807\u6CE8|\u6392\u5E8F|\u8D77\u8349|\u590D\u6838|\u6536\u96C6|\u64B0\u5199|\u751F\u6210|\u51BB\u7ED3|\u62DB\u52DF|\u4E3B\u6301|\u53D1\u5E03|\u91CD\u7B97|\u590D\u7B97|\u5BA1\u8BA1|\u68C0\u67E5|\u8865\u8DD1|\u88C1\u526A|\u6269\u5C55|\u8DD1\u5B8C|\\b(?:run|ablate|train|evaluate|test|compare|scan|rank|annotate|draft|collect|freeze|generate|measure|report)\\b)", "i");

// lib/research/action-construction/states.js
var MECHANISM_NAMES = [
  "adaptive memory module",
  "attention re-weighting",
  "long-context positional encoding",
  "layer normalisation placement",
  "residual scaling schedule",
  "data curriculum ordering"
];
var K = MECHANISM_NAMES.length;

// lib/research/action-construction/workspace.js
import { appendFileSync, existsSync as existsSync8, mkdirSync as mkdirSync6, readFileSync as readFileSync9, writeFileSync as writeFileSync6 } from "node:fs";
import { dirname as dirname4, join as join8 } from "node:path";
var ACTION_STATE_FILE = "research/action-state.json";
var ACTION_LOG_FILE = "research/action-construction.jsonl";
function actionLogPath(workspace) {
  return join8(workspace, ACTION_LOG_FILE);
}
function summariseActionRecords(workspace) {
  const path = actionLogPath(workspace);
  if (!existsSync8(path))
    return { count: 0, inBudget: 0, latest: null };
  let count = 0;
  let inBudget = 0;
  let latest = null;
  for (const line of readFileSync9(path, "utf8").split("\n")) {
    if (!line.trim())
      continue;
    try {
      const record = JSON.parse(line);
      count += 1;
      if (record.feasible)
        inBudget += 1;
      latest = record;
    } catch {
    }
  }
  return { count, inBudget, latest };
}

// lib/research/stage-signals.js
var STAGE_SIGNALS = [
  "topic-proposed",
  "problem-defined",
  "literature-evidence",
  "claims",
  "method-plan",
  "experiments",
  "settled-evidence",
  "decisions",
  "manuscript",
  // ── 技能前置依赖新增（阶段模型未覆盖）──
  "resource-estimate",
  "simulation-result",
  "fulltext-analyzed",
  "experiment-budget",
  // ── 章节起草：论文大纲是否存在且不早于正文（结构契约，见 C08P04）──
  "paper-outline",
  // ── 动作构造（论文 d4）：动作是否被写成可执行设计，且预算付得起 ──
  "action-construction"
];
function buildSignalContext(workspace) {
  const project = loadProjectFile(workspace);
  const evidence = listEvidence(workspace);
  const claims = listClaims(workspace);
  const decisions = listDecisions(workspace);
  const plans = listPlanDocuments(workspace);
  const literatureEvidence = evidence.filter((e) => e.sourceKind === "literature");
  const settledEvidence = evidence.filter((e) => e.status === "supported" || e.status === "verified");
  const hasExperiments = existsSync9(join9(workspace, "experiments"));
  const hasManuscript2 = hasManuscript(workspace);
  let topicCount = 0;
  try {
    topicCount = readFileSync10(join9(workspace, "research", "topics.md"), "utf8").split(/\r?\n/).filter((line) => /^(?:[-*+]|\d+[.)])\s+\S/.test(line)).length;
  } catch {
    topicCount = 0;
  }
  let fulltextCount = 0;
  try {
    fulltextCount = readdirSync7(join9(workspace, FULLTEXT_DIR)).filter((f) => /\.(pdf|html|txt)$/i.test(f)).length;
  } catch {
    fulltextCount = 0;
  }
  let budgetPlan = null;
  let latestRunArtifactMs = 0;
  try {
    const plansDir = join9(workspace, "plans");
    for (const f of readdirSync7(plansDir)) {
      if (!/budget/i.test(f) || /template/i.test(f) || !/\.md$/i.test(f))
        continue;
      const st = statSync2(join9(plansDir, f));
      if (!budgetPlan || st.mtimeMs > budgetPlan.mtimeMs)
        budgetPlan = { path: `plans/${f}`, mtimeMs: st.mtimeMs };
    }
  } catch {
    budgetPlan = null;
  }
  try {
    const expDir = join9(workspace, "experiments");
    const stack = [expDir];
    while (stack.length) {
      const dir = stack.pop();
      for (const f of readdirSync7(dir)) {
        const full = join9(dir, f);
        const st = statSync2(full);
        if (st.isDirectory()) {
          stack.push(full);
          continue;
        }
        const rel = relative2(workspace, full).split(sep).join("/");
        if (!/\.(json|jsonl)$/i.test(f) || !/(cache|results?)/i.test(rel))
          continue;
        if (st.mtimeMs > latestRunArtifactMs)
          latestRunArtifactMs = st.mtimeMs;
      }
    }
  } catch {
    latestRunArtifactMs = 0;
  }
  let paperOutline = null;
  let latestManuscriptMs = 0;
  try {
    const papersDir = join9(workspace, "papers");
    for (const d of readdirSync7(papersDir)) {
      const dir = join9(papersDir, d);
      if (!statSync2(dir).isDirectory())
        continue;
      const outline = join9(dir, "paper-outlines.md");
      if (existsSync9(outline)) {
        const st = statSync2(outline);
        if (!paperOutline || st.mtimeMs > paperOutline.mtimeMs) {
          paperOutline = { path: `papers/${d}/paper-outlines.md`, mtimeMs: st.mtimeMs };
        }
      }
      for (const rel of [join9("latex", "main.tex"), "paper.md"]) {
        const f = join9(dir, rel);
        if (!existsSync9(f))
          continue;
        const st = statSync2(f);
        if (st.mtimeMs > latestManuscriptMs)
          latestManuscriptMs = st.mtimeMs;
      }
    }
  } catch {
    paperOutline = null;
    latestManuscriptMs = 0;
  }
  const hasActionState = existsSync9(join9(workspace, ACTION_STATE_FILE));
  const actionConstruction = summariseActionRecords(workspace);
  return { project, evidence, claims, decisions, plans, literatureEvidence, settledEvidence, hasExperiments, hasManuscript: hasManuscript2, topicCount, fulltextCount, budgetPlan, latestRunArtifactMs, hasActionState, actionConstruction, paperOutline, latestManuscriptMs };
}
function judgeSignal(ctx, signal) {
  switch (signal) {
    case "topic-proposed":
      return {
        satisfied: ctx.topicCount > 0,
        evidence: ctx.topicCount > 0 ? `research/topics.md \u8BB0\u5F55\u4E86 ${ctx.topicCount} \u6761\u7814\u7A76\u8BDD\u9898` : "\u5C1A\u65E0\u7814\u7A76\u8BDD\u9898\uFF08`research/topics.md`\uFF09"
      };
    case "problem-defined": {
      const questions = ctx.project?.questions?.length ?? 0;
      return {
        satisfied: questions > 0 && Boolean(ctx.project?.domain),
        evidence: questions > 0 ? `${questions} \u4E2A\u7814\u7A76\u95EE\u9898${ctx.project?.domain ? "\u3001\u5DF2\u5B9A\u9886\u57DF" : "\uFF08\u7F3A\u9886\u57DF\uFF09"}` : "\u5C1A\u65E0\u7814\u7A76\u95EE\u9898"
      };
    }
    case "literature-evidence":
      return {
        satisfied: ctx.literatureEvidence.length > 0,
        evidence: ctx.literatureEvidence.length > 0 ? `${ctx.literatureEvidence.length} \u6761\u6587\u732E\u8BC1\u636E` : "\u5C1A\u65E0\u6587\u732E\u8BC1\u636E\uFF08\u53EA\u6709\u68C0\u7D22\u8BA1\u5212\u4E0D\u7B97\uFF09"
      };
    case "claims":
      return { satisfied: ctx.claims.length > 0, evidence: ctx.claims.length > 0 ? `${ctx.claims.length} \u6761\u4E3B\u5F20` : "\u5C1A\u65E0\u4E3B\u5F20\uFF0F\u5047\u8BBE" };
    case "method-plan": {
      const methodPlans = ctx.plans.filter((p) => /method|approach|design/i.test(p.id) || /方法|设计/.test(p.name));
      return {
        satisfied: methodPlans.length > 0,
        evidence: methodPlans.length > 0 ? `\u65B9\u6CD5\u76F8\u5173 Plan\uFF1A${methodPlans.map((p) => p.id).join(", ")}` : "\u5C1A\u65E0\u65B9\u6CD5\u8BBE\u8BA1\u7684 Plan"
      };
    }
    case "experiments":
      return { satisfied: ctx.hasExperiments, evidence: ctx.hasExperiments ? "\u5B58\u5728 `experiments/`" : "\u5C1A\u65E0\u5B9E\u9A8C\u76EE\u5F55" };
    case "settled-evidence":
      return {
        satisfied: ctx.settledEvidence.length > 0,
        evidence: ctx.settledEvidence.length > 0 ? `${ctx.settledEvidence.length} \u6761\u5DF2\u786E\u8BA4\u8BC1\u636E` : `\u5C1A\u65E0 confirmed \u8BC1\u636E\uFF08\u73B0\u6709 ${ctx.evidence.length} \u6761\uFF0C\u5747\u672A\u786E\u8BA4\uFF09`
      };
    case "decisions":
      return { satisfied: ctx.decisions.length > 0, evidence: ctx.decisions.length > 0 ? `${ctx.decisions.length} \u6761\u51B3\u7B56\u8BB0\u5F55` : "\u5C1A\u65E0\u51B3\u7B56\u8BB0\u5F55" };
    case "manuscript":
      return { satisfied: ctx.hasManuscript, evidence: ctx.hasManuscript ? "\u5B58\u5728\u8BBA\u6587\u6B63\u6587" : "\u5C1A\u65E0\u8BBA\u6587\u6B63\u6587" };
    // ── 技能前置依赖新增信号 ──
    case "resource-estimate": {
      const resourcePlans = ctx.plans.filter((p) => /resource|cost|feasibility|infrastructure/i.test(p.id) || /资源|成本|可行性|基础设施/.test(p.name));
      return {
        satisfied: resourcePlans.length > 0,
        evidence: resourcePlans.length > 0 ? `\u8D44\u6E90\u76F8\u5173 Plan\uFF1A${resourcePlans.map((p) => p.id).join(", ")}` : "\u5C1A\u65E0\u8D44\u6E90/\u53EF\u884C\u6027 Plan"
      };
    }
    case "simulation-result": {
      const simEvidence = ctx.evidence.filter((e) => e.sourceKind === "computation");
      return {
        satisfied: simEvidence.length > 0,
        evidence: simEvidence.length > 0 ? `${simEvidence.length} \u6761\u8BA1\u7B97/\u4EFF\u771F\u8BC1\u636E` : "\u5C1A\u65E0\u8BA1\u7B97/\u4EFF\u771F\u8BC1\u636E"
      };
    }
    case "fulltext-analyzed": {
      const downloaded = ctx.fulltextCount > 0;
      const analyzed = ctx.literatureEvidence.length > 0;
      return {
        satisfied: downloaded && analyzed,
        evidence: downloaded && analyzed ? `${ctx.fulltextCount} \u7BC7\u5168\u6587\u5DF2\u4E0B\u8F7D\u3001${ctx.literatureEvidence.length} \u6761\u6587\u732E\u8BC1\u636E\u5DF2\u8BB0\u5F55` : downloaded ? `\u5DF2\u4E0B\u8F7D ${ctx.fulltextCount} \u7BC7\u5168\u6587\uFF0C\u4F46\u5C1A\u65E0\u6587\u732E\u8BC1\u636E\uFF08\u6458\u8981/\u8BA1\u5212\u4E0D\u7B97\u5206\u6790\uFF09` : "\u5C1A\u65E0\u5168\u6587\uFF08`research/literature/fulltext/`\uFF09"
      };
    }
    case "action-construction": {
      const { count, inBudget, latest } = ctx.actionConstruction;
      if (!ctx.hasActionState) {
        return {
          satisfied: false,
          evidence: `\u5C1A\u65E0\u52A8\u4F5C\u72B6\u6001\uFF08\`${ACTION_STATE_FILE}\`\uFF09\u2014\u2014 \u52A8\u4F5C\u5C1A\u672A\u5199\u6210\u53EF\u5EA6\u91CF\u7684\u8BBE\u8BA1`
        };
      }
      if (count === 0 || !latest) {
        return { satisfied: false, evidence: "\u5DF2\u6709\u52A8\u4F5C\u72B6\u6001\uFF0C\u4F46\u8FD8\u6CA1\u6709\u4EFB\u4F55\u6784\u9020\u8BC4\u6D4B\u8BB0\u5F55\uFF08`research/action-construction.jsonl`\uFF09" };
      }
      const at = latest.at.slice(0, 16).replace("T", " ");
      const cost = latest.cost === null ? "n/a" : latest.cost.toFixed(2);
      if (!latest.feasible) {
        return {
          satisfied: false,
          evidence: `\u6700\u8FD1\u4E00\u6B21\u6784\u9020\u8D85\u51FA\u9898\u9762\u9884\u7B97\uFF08cost ${cost} > budget ${latest.budget.toFixed(1)}\uFF0C\u5408\u89C4\u53E3\u5F84 0\uFF09\u2014\u2014 \u5148\u6539\u8BBE\u8BA1\u6216\u4E0A\u8C03\u9884\u7B97\uFF0C\u518D\u53D1\u771F\u5B9E\u8C03\u7528\uFF08${at}\uFF09`
        };
      }
      return {
        satisfied: true,
        evidence: `\u6700\u8FD1\u4E00\u6B21\u6784\u9020\u5728\u9884\u7B97\u5185\uFF1AIG/cost ${latest.ig_per_cost.toFixed(4)}\uFF08\u5360\u4E0A\u754C ${(100 * latest.bound_share).toFixed(1)}%\uFF0Ccost ${cost} \u2264 ${latest.budget.toFixed(1)}\uFF0C${at}\uFF09\uFF1B\u5171 ${count} \u6761\u8BB0\u5F55\u3001${inBudget} \u6761\u5728\u9884\u7B97\u5185`
      };
    }
    case "experiment-budget": {
      if (!ctx.budgetPlan) {
        return { satisfied: false, evidence: "\u5C1A\u65E0\u6267\u884C\u524D\u9884\u7B97\uFF08`plans/<run>-budget.md`\uFF09\u2014\u2014 \u672A\u7ECF\u7528\u6237\u786E\u8BA4\u4E0D\u5F97\u53D1\u51FA\u771F\u5B9E\u8C03\u7528" };
      }
      const fresh = ctx.budgetPlan.mtimeMs >= ctx.latestRunArtifactMs;
      const at = new Date(ctx.budgetPlan.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
      return {
        satisfied: fresh,
        evidence: fresh ? `${ctx.budgetPlan.path}\uFF08${at}\uFF09\u4E0D\u65E9\u4E8E\u6700\u8FD1\u5B9E\u9A8C\u4EA7\u7269\uFF0C\u53EF\u7528\u4E8E\u6388\u6743\u672C\u6B21\u6267\u884C` : `${ctx.budgetPlan.path}\uFF08${at}\uFF09\u65E9\u4E8E\u6700\u8FD1\u5B9E\u9A8C\u4EA7\u7269 \u2014\u2014 \u9884\u7B97\u5DF2\u8FC7\u671F\uFF0C\u9700\u91CD\u65B0\u62A5\u9884\u7B97\u5E76\u53D6\u5F97\u786E\u8BA4`
      };
    }
    case "paper-outline": {
      if (!ctx.paperOutline) {
        return { satisfied: false, evidence: "\u5C1A\u65E0\u8BBA\u6587\u5927\u7EB2\uFF08`papers/<id>/paper-outlines.md`\uFF09\u2014\u2014 \u5148\u5B9A\u5927\u7EB2\u518D\u8D77\u8349\u6B63\u6587" };
      }
      const drifted = ctx.paperOutline.mtimeMs < ctx.latestManuscriptMs;
      const at = new Date(ctx.paperOutline.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
      return {
        satisfied: !drifted,
        evidence: drifted ? `${ctx.paperOutline.path}\uFF08${at}\uFF09\u65E9\u4E8E\u8BBA\u6587\u6B63\u6587 \u2014\u2014 \u7ED3\u6784\u5DF2\u6F02\u79FB\uFF0C\u9700\u5148\u6539\u5927\u7EB2\u518D\u6539\u6B63\u6587` : `${ctx.paperOutline.path}\uFF08${at}\uFF09\u4E0D\u65E9\u4E8E\u8BBA\u6587\u6B63\u6587\uFF0C\u53EF\u4F5C\u4E3A\u8D77\u8349\u7684\u7ED3\u6784\u4F9D\u636E`
      };
    }
    default:
      return { satisfied: true, evidence: '\u8BE5\u9636\u6BB5\u672A\u58F0\u660E\u5224\u5B9A\u4FE1\u53F7\uFF0C\u4E0D\u53C2\u4E0E"\u5F53\u524D\u9636\u6BB5"\u5224\u5B9A' };
  }
}

// lib/research/research-process.js
var DEFAULT_STAGES = [
  { id: "topics", label: "\u63D0\u51FA\u8BDD\u9898", category: "research-understanding", signal: "topic-proposed", produces: "\u7814\u7A76\u8BDD\u9898\uFF08`research/topics.md`\uFF09", state: ["Problem"] },
  { id: "literature", label: "\u6587\u732E\u8C03\u7814", category: "literature", signal: "literature-evidence", produces: "\u5B9E\u9645\u68C0\u7D22\u5230\u7684\u6587\u732E\u8BC1\u636E\uFF08`research/evidence/`\uFF09", state: ["Literature", "Current Knowledge"] },
  { id: "innovation", label: "\u521B\u65B0\u5047\u8BBE", category: "innovation", signal: "claims", produces: "\u5DF2\u786E\u5B9A\u7684\u7814\u7A76\u95EE\u9898\u4E0E\u4E3B\u9898\u3001\u53EF\u68C0\u9A8C\u7684\u5047\u8BBE\u4E0E\u4E3B\u5F20\uFF08`project.md` / `research/claims/`\uFF09", state: ["Innovation", "Hypotheses"] },
  { id: "planning", label: "\u8BA1\u5212\u7BA1\u7406", category: "research-planning", signal: "method-plan", produces: "\u53EF\u6267\u884C\u7684\u7814\u7A76\u8BA1\u5212\u4E0E\u65B9\u6CD5\u8BBE\u8BA1\uFF08`research/plans/`\uFF09", state: ["Method"] },
  { id: "resource", label: "\u8D44\u6E90\u8BC4\u4F30", category: "resource-estimation", signal: "resource-estimate", produces: "\u8D44\u6E90\u9700\u6C42\u3001\u6210\u672C\u4E0E\u53EF\u884C\u6027\u4F30\u8BA1\uFF08`research/plans/`\uFF09" },
  { id: "decision", label: "\u7814\u7A76\u51B3\u7B56", category: "research-decision", signal: "decisions", produces: "\u5DF2\u8BB0\u5F55\u7406\u7531\u7684\u7814\u7A76\u51B3\u7B56\uFF08`research/decisions/`\uFF09", state: ["Decisions"] },
  { id: "experiment", label: "\u5B9E\u9A8C\u9A8C\u8BC1", category: "experiment", signal: "experiments", produces: "\u5B9E\u9A8C\u4EA7\u7269\u4E0E\u7ECF\u786E\u8BA4\u7684\u7ED3\u679C\u8BC1\u636E\uFF08`experiments/<name>/results/`\uFF09", state: ["Experiments", "Evidence"] },
  { id: "writing", label: "\u8BBA\u6587\u5199\u4F5C", category: "academic-writing", signal: "manuscript", produces: "\u8BBA\u6587\u6B63\u6587\uFF08`papers/<id>/paper.md`\uFF09" }
];
var PROCESS_SKILL_ID = "research-process";
function parseStateDimensions(field) {
  const raw = (field ?? "").trim();
  if (!raw)
    return [];
  const body = /^state\s*[:=]\s*(.*)$/i.exec(raw)?.[1] ?? raw;
  const out = [];
  for (const piece of body.split(/[,，;；]/).map((x) => x.trim())) {
    if (!piece)
      continue;
    const hit = STATE_DIMENSIONS.find((d) => d.toLowerCase() === piece.toLowerCase());
    if (hit && !out.includes(hit))
      out.push(hit);
  }
  return out;
}
function parseStages(content) {
  if (!content)
    return void 0;
  const stages = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^stage:\s*(.+)$/i.exec(line);
    if (!m) {
      if (stages.length > 0 && line !== "" && !line.startsWith("```"))
        break;
      continue;
    }
    const parts = m[1].split("|").map((x) => x.trim());
    const [id, label, category, signal, produces, stateField] = parts;
    if (!id || !label || !category)
      continue;
    const known = STAGE_SIGNALS.includes(signal ?? "");
    const state = parseStateDimensions(stateField);
    stages.push({
      id,
      label,
      category: category.split("/")[0] ?? category,
      ...known ? { signal } : {},
      produces: produces || `${label} \u9636\u6BB5\u7684\u4EA7\u51FA`,
      ...state.length > 0 ? { state } : {}
    });
  }
  return stages.length > 0 ? stages : void 0;
}
function assessResearchProcess(workspace, options = {}) {
  const stages = parseStages(options.skillContent?.(PROCESS_SKILL_ID)) ?? [...DEFAULT_STAGES];
  return assessWithStages(workspace, stages);
}
function assessWithStages(workspace, stages) {
  const ctx = buildSignalContext(workspace);
  const statuses = stages.map((stage) => {
    const { satisfied, evidence: basis } = judgeSignal(ctx, stage.signal);
    return { stage, satisfied, evidence: basis };
  });
  const missing = statuses.filter((s) => !s.satisfied);
  return { stages: statuses, current: missing[0], missing };
}

// lib/research/prerequisites.js
function parsePrerequisites(content) {
  if (!content)
    return void 0;
  const out = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^requires:\s*(.+)$/i.exec(line);
    if (!m) {
      if (out.length > 0 && (line.startsWith("```") || line !== ""))
        break;
      continue;
    }
    const body = m[1];
    const idx = body.indexOf("|");
    let req = body;
    let note = "";
    if (idx >= 0) {
      req = body.slice(0, idx).trim();
      note = body.slice(idx + 1).trim();
    } else {
      req = body.trim();
    }
    const signals = req.split("/").map((s) => s.trim()).filter(Boolean);
    if (signals.length === 0)
      continue;
    out.push({ signals, note });
  }
  return out.length > 0 ? out : void 0;
}
function isKnownSignal(signal) {
  return STAGE_SIGNALS.includes(signal);
}
function assessPrerequisites(skills, ctx) {
  const out = [];
  for (const { id, content } of skills) {
    const prerequisites = parsePrerequisites(content) ?? [];
    const unmet = [];
    for (const line of prerequisites) {
      let lineSatisfied = false;
      const missingSignals = [];
      for (const signal of line.signals) {
        if (!isKnownSignal(signal)) {
          lineSatisfied = true;
          continue;
        }
        const j = judgeSignal(ctx, signal);
        if (j.satisfied)
          lineSatisfied = true;
        else
          missingSignals.push(signal);
      }
      if (!lineSatisfied)
        unmet.push({ signals: line.signals, note: line.note, missingSignals });
    }
    out.push({ skillId: id, prerequisites, unmet, satisfied: unmet.length === 0 });
  }
  return out;
}
function renderUnmetPrerequisites(status) {
  return status.unmet.map((u) => u.note ? `${u.signals.join(" / ")}\uFF08${u.note}\uFF09` : u.signals.join(" / ")).join("\uFF1B");
}

// lib/research/research-state.js
import { existsSync as existsSync10, mkdirSync as mkdirSync7, readFileSync as readFileSync11, readdirSync as readdirSync8, rmSync as rmSync5, writeFileSync as writeFileSync7 } from "node:fs";
import { join as join10 } from "node:path";
function normalizeMaturity(raw) {
  const v = (raw ?? "").trim();
  const hit = MATURITY_LEVELS.find((l) => l.toLowerCase() === v.toLowerCase());
  return hit ?? "Unknown";
}
function extractDimensions(sections) {
  const out = {};
  for (const d of STATE_DIMENSIONS) {
    const body = findSection(sections, d);
    const cleaned = body.replace(/<!--[\s\S]*?-->/g, "").trim();
    if (cleaned)
      out[d] = cleaned;
  }
  return out;
}
function parseResearchState(absPath, relPath) {
  let source;
  try {
    source = readFileSync11(absPath, "utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(source);
  const body = stripFrontmatter(source).trim();
  const parsed = parseSections(body);
  const maturity = {};
  for (const m of MATURITY_DIMENSIONS) {
    maturity[m] = normalizeMaturity(fm[`maturity_${m.toLowerCase()}`] ?? fm[m.toLowerCase()]);
  }
  return {
    version: fm.version || "1",
    dimensions: extractDimensions(parsed.sections),
    maturity,
    ...fm.created_at ? { createdAt: fm.created_at } : {},
    ...fm.updated_at ? { updatedAt: fm.updated_at } : {},
    body,
    path: absPath,
    relPath
  };
}
function statePath(workspace) {
  return join10(workspace, RESEARCH_STATE_FILE);
}
function loadResearchState(workspace) {
  return parseResearchState(statePath(workspace), RESEARCH_STATE_FILE);
}
function emptyMaturity() {
  const out = {};
  for (const m of MATURITY_DIMENSIONS)
    out[m] = "Unknown";
  return out;
}
var APPLIED_LOG_FILE = "applied.json";
var UPDATE_LOG = `${PROPOSALS_DIR}/${APPLIED_LOG_FILE}`;
function openQuestions(workspace) {
  const state = loadResearchState(workspace);
  const raw = state?.dimensions["Open Questions"];
  if (!raw)
    return [];
  return parseListItems(raw);
}
function buildResearchIndex(workspace) {
  const state = loadResearchState(workspace);
  const evidence = listEvidence(workspace);
  const claims = listClaims(workspace);
  const dimensions = {};
  for (const d of STATE_DIMENSIONS)
    dimensions[d] = Boolean(state?.dimensions[d]?.trim());
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    stateVersion: state?.version ?? "0",
    dimensions,
    maturity: state?.maturity ?? emptyMaturity(),
    claims: claims.map((c) => ({
      id: c.id,
      status: c.status,
      evidence: c.evidence,
      contradictions: c.contradictions
    })),
    evidence: evidence.map((e) => ({
      id: e.id,
      status: e.status,
      sourceKind: e.sourceKind,
      supports: e.supports,
      contradicts: e.contradicts
    })),
    openQuestions: openQuestions(workspace),
    unsupportedClaims: claims.filter((c) => c.evidence.length === 0).map((c) => c.id),
    contestedClaims: claims.filter((c) => c.contradictions.length > 0).map((c) => c.id),
    evidenceWithoutRawArtifact: evidence.filter((e) => e.provenance.rawArtifacts.length === 0 && e.status !== "rejected").map((e) => e.id)
  };
}

// lib/research/paper-evolution.js
import { existsSync as existsSync12, mkdirSync as mkdirSync9, readFileSync as readFileSync13, readdirSync as readdirSync9, rmSync as rmSync6, writeFileSync as writeFileSync9 } from "node:fs";
import { join as join12 } from "node:path";

// lib/research/paper-gaps.js
import { existsSync as existsSync11, mkdirSync as mkdirSync8, readFileSync as readFileSync12, writeFileSync as writeFileSync8 } from "node:fs";
import { join as join11 } from "node:path";
function gapsPath(workspace, paperId) {
  return join11(paperDir(workspace, paperId), PAPER_FILES.gaps);
}
function listPaperGaps(workspace, paperId) {
  let source;
  try {
    source = readFileSync12(gapsPath(workspace, paperId), "utf8");
  } catch {
    return [];
  }
  const body = stripFrontmatter(source);
  const lines = body.split(/\r?\n/);
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(G\d{1,4})\s*$/);
    if (m)
      heads.push({ index: i, id: m[1] });
  }
  const out = [];
  for (let h = 0; h < heads.length; h++) {
    const block = lines.slice(heads[h].index + 1, h + 1 < heads.length ? heads[h + 1].index : lines.length).join("\n");
    const field = (name) => {
      const m = block.match(new RegExp(`^\\*\\*${name}\\*\\*:\\s*(.*)$`, "m")) ?? block.match(new RegExp(`^${name}:\\s*(.*)$`, "m"));
      return m?.[1]?.trim() ?? "";
    };
    out.push({
      id: heads[h].id,
      type: field("Type") || "experimental-validation",
      description: field("Description"),
      ...field("Related Claim") ? { relatedClaim: field("Related Claim") } : {},
      ...field("Related Section") ? { relatedSection: field("Related Section") } : {},
      ...field("Suggested Capability") ? { suggestedSkill: field("Suggested Capability") } : {},
      priority: field("Priority") || "medium",
      detectedBy: field("Detected By") || "rule",
      createdAt: field("Created At") || (/* @__PURE__ */ new Date()).toISOString(),
      ...field("Resolved") ? { resolved: { at: field("Resolved"), by: field("Resolved By") || "user" } } : {}
    });
  }
  return out;
}
function nextGapId(existing) {
  const max = existing.reduce((n, g) => Math.max(n, Number(g.id.replace(/^G/, "")) || 0), 0);
  return `G${String(max + 1).padStart(3, "0")}`;
}
var GAP_SKILL_HINTS = {
  "unsupported-claim": "evidence-assessment",
  "contested-claim": "comparative-analysis",
  "missing-evidence": "experiment-design",
  "evidence-without-artifact": "reproducible-implementation-spec",
  "missing-ablation": "ablation-design",
  "experimental-validation": "evaluation-protocol",
  "missing-section": "paper-architecture",
  "thin-section": "section-drafting",
  "unreferenced-evidence": "section-drafting",
  // Claim/Evidence 映射资产还没建立：要先把"哪条证据支撑哪一节"记下来，
  // 之后 §9 的"删掉这条证据会影响哪里"才答得出来。
  "no-claim-map": "section-drafting",
  "outdated-related-work": "literature-review",
  reproducibility: "reproducible-implementation-spec"
};
function detectPaperGaps(workspace, paperId) {
  const paper = readPaper(workspace, paperId);
  if (!paper)
    return [];
  const out = [];
  const sectionNames = paper.sections.map((s) => s.title);
  for (const want of REQUIRED_PAPER_SECTIONS) {
    if (!hasSectionFor(sectionNames, want)) {
      const priority = want === "Abstract" || want === "Method" ? "high" : "medium";
      out.push({
        type: "missing-section",
        description: `The manuscript has no \`${want}\` section.`,
        relatedSection: want,
        priority
      });
    }
  }
  for (const s of paper.sections) {
    const substantive = s.body.replace(/<!--[\s\S]*?-->/g, "").trim();
    if (substantive.length === 0) {
      out.push({
        type: "thin-section",
        description: `Section \`${s.title}\` has no substantive content (only a placeholder).`,
        relatedSection: s.title,
        priority: ["method", "experiments", "results"].includes(s.title.toLowerCase()) ? "high" : "low"
      });
    }
  }
  const claims = readClaimMap(workspace, paperId);
  const researchClaims = new Map(listClaims(workspace).map((c) => [c.id, c]));
  for (const c of claims) {
    const authoritative = researchClaims.get(c.id);
    const evidence = authoritative?.evidence ?? c.evidence;
    const contradictions = authoritative?.contradictions ?? c.contradictions;
    const status = (authoritative?.status ?? c.status ?? "").toLowerCase();
    const inManuscript = c.sections.length > 0;
    const settled = status === "rejected" || status === "superseded";
    if (!inManuscript || settled)
      continue;
    if (evidence.length === 0) {
      out.push({
        type: "unsupported-claim",
        description: `Claim ${c.id} appears in the manuscript with no supporting evidence.`,
        relatedClaim: c.id,
        ...c.sections[0] ? { relatedSection: c.sections[0] } : {},
        priority: "high"
      });
    }
    if (contradictions.length > 0) {
      out.push({
        type: "contested-claim",
        description: `Claim ${c.id} has contradicting evidence (${contradictions.join(", ")}) that the manuscript does not address.`,
        relatedClaim: c.id,
        ...c.sections[0] ? { relatedSection: c.sections[0] } : {},
        priority: "high"
      });
    }
  }
  const evidenceIds = new Set(listEvidence(workspace).map((e) => e.id));
  for (const c of claims) {
    if (!researchClaims.has(c.id)) {
      out.push({
        type: "missing-evidence",
        description: `The manuscript cites claim ${c.id}, but no such claim is recorded in the research state.`,
        relatedClaim: c.id,
        priority: "high"
      });
    }
  }
  for (const e of listEvidence(workspace)) {
    if (e.provenance.rawArtifacts.length === 0 && e.status !== "rejected") {
      out.push({
        type: "evidence-without-artifact",
        description: `Evidence ${e.id} (${e.name}) has no raw artifact reference, so it cannot be reproduced or checked.`,
        priority: "medium"
      });
    }
  }
  const map = buildEvidenceMap(workspace, paperId);
  const claimsFile = join11(paperDir(workspace, paperId), PAPER_FILES.claims);
  const mappedClaims = claims.filter((c) => c.sections.length > 0);
  if (!existsSync11(claimsFile) && mappedClaims.length === 0 && listEvidence(workspace).length > 0) {
    out.push({
      type: "no-claim-map",
      description: 'The manuscript has no Claim/Evidence map (no `claims.md`, and the text references no Claim ids), so "which section does this evidence support?" cannot be answered for any of it. Until that map exists, per-evidence "unused" reports would be noise, not findings.',
      priority: "medium"
    });
  } else {
    for (const entry of map) {
      if (entry.sections.length === 0) {
        out.push({
          type: "unreferenced-evidence",
          description: `Evidence ${entry.id} is recorded but never used in the manuscript. (Deleting it would change nothing.)`,
          priority: "low"
        });
      }
    }
    const usedEvidence = new Set(map.map((m) => m.id));
    for (const e of listEvidence(workspace)) {
      if (!usedEvidence.has(e.id) && e.status === "verified") {
        out.push({
          type: "unreferenced-evidence",
          description: `Verified evidence ${e.id} is not referenced anywhere in the manuscript \u2014 either use it or record why it is excluded.`,
          priority: "medium"
        });
      }
    }
  }
  const hasExperiment = paper.sections.some((s) => /experiment|result/i.test(s.title) && s.body.replace(/<!--[\s\S]*?-->/g, "").trim().length > 80);
  const mentionsAblation = /ablation/i.test(paper.manuscript);
  const hasAblationEvidence = listEvidence(workspace).some((e) => /ablation/i.test(e.name) || /ablation/i.test(e.type));
  if (hasExperiment && !mentionsAblation && !hasAblationEvidence) {
    out.push({
      type: "missing-ablation",
      description: "The manuscript reports experiments but contains no ablation. There is no evidence isolating which component causes the reported effect.",
      relatedSection: "Experiments",
      priority: "high"
    });
  }
  const reproText = paper.sections.filter((s) => /method|experiment/i.test(s.title)).map((s) => s.body).join("\n");
  if (reproText.length > 80 && !/(dataset|data set|benchmark|seed|environment|version|hyperparameter|hyper-parameter)/i.test(reproText)) {
    out.push({
      type: "reproducibility",
      description: "The method/experiment sections do not mention dataset, seeds, environment or hyper-parameters, so the result cannot be reproduced from the paper.",
      priority: "medium"
    });
  }
  const state = loadResearchState(workspace);
  const openQ = state?.dimensions["Open Questions"];
  if (openQ) {
    for (const q of parseListItems(openQ)) {
      const key = q.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      if (key.length > 12 && !paper.manuscript.toLowerCase().includes(key)) {
        out.push({
          type: "missing-section",
          description: `Open research question not addressed in the paper: "${q}"`,
          relatedSection: "Discussion",
          priority: "medium"
        });
      }
    }
  }
  return out;
}
function mergeDetectedGaps(existing, detected) {
  const key = (g) => {
    return `${g.type}|${g.relatedClaim ?? ""}|${g.relatedSection ?? ""}|${g.description.slice(0, 60)}`;
  };
  const seen = new Set(existing.filter((g) => !g.resolved).map(key));
  const added = [];
  const gaps = [...existing];
  for (const d of detected) {
    if (seen.has(key(d)))
      continue;
    const gap = {
      id: nextGapId(gaps),
      type: d.type,
      description: d.description,
      ...d.relatedClaim ? { relatedClaim: d.relatedClaim } : {},
      ...d.relatedSection ? { relatedSection: d.relatedSection } : {},
      ...GAP_SKILL_HINTS[d.type] ? { suggestedSkill: GAP_SKILL_HINTS[d.type] } : {},
      priority: d.priority,
      detectedBy: "rule",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    gaps.push(gap);
    added.push(gap);
    seen.add(key(d));
  }
  return { gaps, added };
}
function prioritizeGaps(gaps) {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...gaps].sort((a, b) => {
    if (Boolean(a.resolved) !== Boolean(b.resolved))
      return a.resolved ? 1 : -1;
    return rank[a.priority] - rank[b.priority] || a.id.localeCompare(b.id);
  });
}
function paperTitle(paper) {
  return paper.metadata.title ?? paper.manuscript.match(/^#\s+(.+)$/m)?.[1] ?? paper.id;
}

// lib/research/paper-evolution.js
function proposalsDir(workspace, paperId) {
  return join12(paperDir(workspace, paperId), PAPER_FILES.proposalsDir);
}
function parseProposal(source, fallbackId) {
  const fm = parseFrontmatter(source);
  const sections = parseSections(stripFrontmatter(source)).sections;
  const id = fm.id || fallbackId;
  if (!id)
    return null;
  const list = (title) => (findSection(sections, title).match(/^[-*]\s*(.+)$/gm) ?? []).map((l) => l.replace(/^[-*]\s*/, "").trim());
  return {
    id,
    reason: findSection(sections, "Reason"),
    affectedClaims: list("Affected Claims"),
    affectedSections: list("Affected Sections"),
    proposedChanges: findSection(sections, "Proposed Changes"),
    supportingEvidence: list("Supporting Evidence"),
    ...findSection(sections, "Related Research State") ? { relatedResearchState: findSection(sections, "Related Research State") } : {},
    ...findSection(sections, "Risk") ? { risk: findSection(sections, "Risk") } : {},
    ...fm.trigger ? { trigger: fm.trigger } : {},
    status: fm.status ?? "proposed",
    proposedBy: fm.proposed_by === "user" ? "user" : "agent",
    createdAt: fm.created_at ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
function listProposals(workspace, paperId) {
  const dir = proposalsDir(workspace, paperId);
  let files;
  try {
    files = readdirSync9(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const p = parseProposal(readFileSync13(join12(dir, f), "utf8"), f.replace(/\.md$/, ""));
      if (p)
        out.push(p);
    } catch {
    }
  }
  return out;
}
var MATURITY_FILE = "maturity.md";
function maturityPath(workspace, paperId) {
  return join12(paperDir(workspace, paperId), MATURITY_FILE);
}
function readPaperMaturity(workspace, paperId) {
  let source = null;
  try {
    source = readFileSync13(maturityPath(workspace, paperId), "utf8");
  } catch {
  }
  const fm = source ? parseFrontmatter(source) : {};
  const body = source ? stripFrontmatter(source) : "";
  const sections = parseSections(body).sections;
  const out = {};
  for (const d of PAPER_MATURITY_DIMENSIONS) {
    const key = d.toLowerCase().replace(/\s+/g, "_");
    const raw = fm[key];
    const section = sections.find((s) => s.title.toLowerCase() === d.toLowerCase());
    out[d] = {
      status: raw ?? "Unknown",
      reason: section?.body ?? "",
      evidence: (section?.body.match(/\b(?:E\d{1,4}|C\d{1,4})\b/g) ?? []).map((x) => x.toUpperCase())
    };
  }
  return out;
}
function suggestPaperMaturity(workspace, paperId) {
  const paper = readPaper(workspace, paperId);
  const claims = readClaimMap(workspace, paperId);
  const evidence = listEvidence(workspace);
  const evidenceMap = buildEvidenceMap(workspace, paperId);
  const gaps = listPaperGaps(workspace, paperId).filter((g) => !g.resolved);
  const state = loadResearchState(workspace);
  const hasSection = (re) => (paper?.sections ?? []).some((s) => re.test(s.title) && s.body.replace(/<!--[\s\S]*?-->/g, "").trim().length > 60);
  const level = (n) => ["Unknown", "Weak", "Emerging", "Strong", "Established"][Math.min(4, n)];
  const out = {};
  {
    const hasProblem = Boolean(state?.dimensions["Problem"]?.trim());
    const hasQuestions = Boolean(state?.dimensions["Research Questions"]?.trim());
    out.Problem = {
      status: hasProblem && hasQuestions ? "Established" : hasProblem ? "Emerging" : "Unknown",
      reason: hasProblem ? hasQuestions ? "Research State records both the problem and the research questions." : "Research State records the problem but no explicit research questions." : "Research State has no Problem dimension yet.",
      evidence: []
    };
  }
  {
    const litEvidence = evidence.filter((e) => e.sourceKind === "literature");
    const hasRelated = hasSection(/related work|background/i);
    out.Literature = {
      status: level((hasRelated ? 2 : 0) + (litEvidence.length > 0 ? 1 : 0) + (litEvidence.length >= 3 ? 1 : 0)),
      reason: `${hasRelated ? "Related Work section present" : "No Related Work section"}; ${litEvidence.length} literature evidence item(s).`,
      evidence: litEvidence.slice(0, 5).map((e) => e.id)
    };
  }
  {
    const hasInnovation = Boolean(state?.dimensions.Innovation?.trim());
    const inText = /contribut|novel|our approach|we propose/i.test(paper?.manuscript ?? "");
    out.Innovation = {
      status: hasInnovation && inText ? "Strong" : hasInnovation || inText ? "Emerging" : "Unknown",
      reason: `Research State Innovation: ${hasInnovation ? "recorded" : "absent"}; manuscript states a contribution: ${inText ? "yes" : "no"}.`,
      evidence: []
    };
  }
  {
    const hasMethod = hasSection(/method|approach/i);
    const methodEvidence = evidence.filter((e) => e.sourceKind === "implementation" || e.sourceKind === "computation");
    out.Method = {
      status: hasMethod ? methodEvidence.length > 0 ? "Strong" : "Emerging" : "Unknown",
      reason: hasMethod ? methodEvidence.length > 0 ? `Method section present with ${methodEvidence.length} implementation/computation evidence item(s).` : "Method section present but no implementation evidence recorded." : "No substantive Method section.",
      evidence: methodEvidence.slice(0, 5).map((e) => e.id)
    };
  }
  {
    const expEvidence = evidence.filter((e) => e.sourceKind === "experiment");
    const hasExperiments = hasSection(/experiment|result/i);
    out.Experiment = {
      status: expEvidence.length === 0 ? hasExperiments ? "Weak" : "Unknown" : hasExperiments ? "Strong" : "Emerging",
      reason: `${expEvidence.length} experiment evidence item(s); experiments/results section ${hasExperiments ? "present" : "missing"}.`,
      evidence: expEvidence.slice(0, 5).map((e) => e.id)
    };
  }
  {
    const verified = evidence.filter((e) => e.status === "verified").length;
    const withoutArtifact = gaps.filter((g) => g.type === "evidence-without-artifact").length;
    out.Evidence = {
      status: evidence.length === 0 ? "Unknown" : verified >= 3 && withoutArtifact === 0 ? "Established" : verified > 0 ? "Strong" : "Emerging",
      reason: `${evidence.length} item(s), ${verified} verified; ${withoutArtifact} lacking a raw artifact reference.`,
      evidence: evidence.slice(0, 5).map((e) => e.id)
    };
  }
  {
    const supported = claims.filter((c) => c.evidence.length > 0).length;
    const unsupported = claims.filter((c) => c.evidence.length === 0).length;
    out.Claims = {
      status: claims.length === 0 ? "Unknown" : unsupported === 0 && supported > 0 ? "Strong" : supported > 0 ? "Emerging" : "Weak",
      reason: `${claims.length} claim(s) in the paper; ${supported} with evidence, ${unsupported} without.`,
      evidence: claims.flatMap((c) => c.evidence).slice(0, 5)
    };
  }
  {
    const substantive = (paper?.sections ?? []).filter((s) => s.body.replace(/<!--[\s\S]*?-->/g, "").trim().length > 60);
    const total = paper?.sections.length ?? 0;
    const ratio = total > 0 ? substantive.length / total : 0;
    out.Writing = {
      status: total === 0 ? "Unknown" : ratio > 0.8 ? "Strong" : ratio > 0.5 ? "Emerging" : "Weak",
      reason: `${substantive.length}/${total} sections have substantive content.`,
      evidence: []
    };
  }
  {
    const reproGaps = gaps.filter((g) => g.type === "reproducibility" || g.type === "evidence-without-artifact").length;
    const artifacts = evidence.filter((e) => e.provenance.rawArtifacts.length > 0).length;
    out.Reproducibility = {
      status: evidence.length === 0 ? "Unknown" : reproGaps === 0 && artifacts > 0 ? "Strong" : artifacts > 0 ? "Emerging" : "Weak",
      reason: `${artifacts}/${evidence.length} evidence item(s) reference raw artifacts; ${reproGaps} reproducibility gap(s) open.`,
      evidence: evidence.filter((e) => e.provenance.rawArtifacts.length > 0).slice(0, 5).map((e) => e.id)
    };
  }
  return out;
}
function maturityOverview(maturity) {
  const established = [];
  const emerging = [];
  const missing = [];
  for (const d of PAPER_MATURITY_DIMENSIONS) {
    const l = maturity[d].status;
    if (l === "Strong" || l === "Established")
      established.push(d);
    else if (l === "Unknown")
      missing.push(d);
    else
      emerging.push(d);
  }
  return { established, emerging, missing };
}
function paperStatusSummary(workspace, paperId) {
  const paper = readPaper(workspace, paperId);
  if (!paper)
    return void 0;
  const claims = readClaimMap(workspace, paperId);
  const evidence = listEvidence(workspace);
  const evidenceMap = buildEvidenceMap(workspace, paperId);
  const gaps = listPaperGaps(workspace, paperId);
  const openGaps = gaps.filter((g) => !g.resolved);
  const substantive = paper.sections.filter((s) => s.body.replace(/<!--[\s\S]*?-->/g, "").trim().length > 60).length;
  const maturity = readPaperMaturity(workspace, paperId);
  return {
    paperId,
    title: paper.metadata.title ?? paper.id,
    status: paper.metadata.status,
    version: paper.metadata.version,
    sections: { total: paper.sections.length, substantive },
    claims: {
      total: claims.length,
      withEvidence: claims.filter((c) => c.evidence.length > 0).length,
      withoutEvidence: claims.filter((c) => c.evidence.length === 0).length
    },
    evidence: { usedInManuscript: evidenceMap.filter((e) => e.sections.length > 0).length, total: evidence.length },
    gaps: { open: openGaps.length, high: openGaps.filter((g) => g.priority === "high").length },
    openProposals: listProposals(workspace, paperId).filter((p) => p.status === "proposed").length,
    evolutionEvents: listEvolutionEvents(workspace, paperId).length,
    maturity: maturityOverview(maturity)
  };
}

// lib/research/output.js
import { existsSync as existsSync13, mkdirSync as mkdirSync10, readFileSync as readFileSync14, readdirSync as readdirSync10, rmSync as rmSync7, writeFileSync as writeFileSync10 } from "node:fs";
import { join as join13 } from "node:path";

// lib/research/output-profiles.js
var PATENT_CLAIM_NOTE = [
  "# Research Claim vs Patent Claim",
  "",
  "\u8FD9\u4E24\u4E2A\u6982\u5FF5**\u4E0D\u662F**\u540C\u4E00\u79CD\u4E1C\u897F\uFF0C\u4E0D\u80FD\u4E92\u6284\uFF08Stage 5.1 \xA710\uFF09\u3002",
  "",
  "## Research Claim",
  "",
  "\u9648\u8FF0\u4E16\u754C\u662F\u600E\u6837\u7684\uFF0C\u9700\u8981\u8BC1\u636E\u652F\u6491\uFF1A",
  "",
  "```text",
  "C003 \u2014 The proposed method improves localization accuracy.",
  "```",
  "",
  "## Patent Claim",
  "",
  "\u5B9A\u4E49**\u6392\u4ED6\u6743\u7684\u8FB9\u754C**\uFF0C\u7531\u6280\u672F\u7279\u5F81\u9650\u5B9A\uFF1A",
  "",
  "```text",
  "1. A localization calibration method, comprising:",
  "     receiving first and second modality observations;",
  "     determining a common rigid structure between them;",
  "     calibrating a localization error based on said structure.",
  "```",
  "",
  "## \u533A\u522B",
  "",
  "| | Research Claim | Patent Claim |",
  "|---|---|---|",
  "| \u76EE\u7684 | \u9648\u8FF0\u4E3A\u771F\u7684\u4E8B\u5B9E | \u754C\u5B9A\u4FDD\u62A4\u8303\u56F4 |",
  "| \u4F9D\u636E | Evidence | \u6280\u672F\u7279\u5F81\uFF08components/steps\uFF09 |",
  "| \u5199\u6CD5 | \u9648\u8FF0\u53E5 | \u5355\u53E5\u3001\u7531\u7279\u5F81\u9650\u5B9A\u3001\u5C3D\u91CF\u5BBD\u800C\u4E0A\u4F4D |",
  "| \u9A8C\u4F2A | \u53EF\u88AB\u5B9E\u9A8C\u63A8\u7FFB | \u7531\u65B0\u9896\u6027/\u521B\u9020\u6027\u8861\u91CF |",
  "",
  "\u628A C003 \u76F4\u63A5\u6284\u6210\u4E13\u5229\u6743\u5229\u8981\u6C42\u662F**\u9519\u7684**\uFF1A\u5B83\u6CA1\u6709\u9650\u5B9A\u4EFB\u4F55\u6280\u672F\u7279\u5F81\uFF0C",
  "\u56E0\u6B64\u65E2\u65E0\u6CD5\u754C\u5B9A\u8303\u56F4\uFF0C\u4E5F\u65E0\u6CD5\u901A\u8FC7\u5BA1\u67E5\u3002\u6B63\u786E\u505A\u6CD5\u662F\u7531\u6280\u672F\u65B9\u6848\u91CD\u65B0\u8868\u8FF0\u51FA\u7279\u5F81\u7EC4\u5408\u3002"
].join("\n");

// lib/research/output.js
function outputTypeDir(workspace, type) {
  if (type === "paper")
    return join13(workspace, "papers");
  return join13(workspace, OUTPUTS_DIR, OUTPUT_DIRS[type]);
}
function outputTypeRelDir(type) {
  if (type === "paper")
    return "papers";
  return `${OUTPUTS_DIR}/${OUTPUT_DIRS[type]}`;
}
function readTextOrNull2(p) {
  try {
    return readFileSync14(p, "utf8");
  } catch {
    return null;
  }
}
function normalizeStatus5(raw) {
  const v = (raw ?? "").trim().toLowerCase();
  return OUTPUT_STATUSES.includes(v) ? v : "draft";
}
function normalizeType(raw) {
  const v = (raw ?? "").trim().toLowerCase();
  return OUTPUT_TYPES.includes(v) ? v : "technical-report";
}
function deriveOutputId(absPath, frontmatterId) {
  const explicit = (frontmatterId ?? "").trim();
  if (explicit)
    return explicit;
  const segments = absPath.split("/").filter(Boolean);
  const file = segments.pop() ?? "";
  const parent = segments.pop() ?? "";
  const typeDirs = new Set(Object.values(OUTPUT_DIRS));
  if (parent && !typeDirs.has(parent))
    return parent;
  return file.replace(/\.md$/, "");
}
function parseOutputArtifact(absPath, relPath, typeHint) {
  const source = readTextOrNull2(absPath);
  if (source === null)
    return null;
  const fm = parseFrontmatter(source);
  const body = stripFrontmatter(source).trim();
  const parsed = parseSections(body);
  const id = deriveOutputId(absPath, fm.id);
  const reviews = [];
  return {
    id,
    type: typeHint ?? normalizeType(fm.type),
    title: (parsed.title ?? "").replace(/^(?:Output|Patent|Report|Slides|Presentation|Paper):\s*/i, "").trim() || fm.title || id,
    status: normalizeStatus5(fm.status),
    version: fm.version || "0.1",
    ...fm.goal ? { goal: fm.goal } : {},
    source: {
      ...fm.source_research_state ? { researchState: fm.source_research_state } : {},
      ...fm.source_paper ? { paper: fm.source_paper } : {},
      claims: parseIdList(fm.source_claims),
      evidence: parseIdList(fm.source_evidence),
      plans: (fm.source_plans ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    },
    ...fm.skill ? { skill: fm.skill } : {},
    ...fm.plan ? { plan: fm.plan } : {},
    ...fm.harness_session ? { harnessSession: fm.harness_session } : {},
    sections: parsed.sections,
    body,
    reviews,
    ...fm.created_at ? { createdAt: fm.created_at } : {},
    ...fm.updated_at ? { updatedAt: fm.updated_at } : {},
    path: absPath,
    relPath
  };
}
function listOutputs(workspace, type) {
  if (type === "paper")
    return [];
  const out = [];
  let dirs;
  try {
    dirs = readdirSync10(outputTypeDir(workspace, type), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs.filter((e) => e.isDirectory() && !e.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = OUTPUT_MAIN_FILE[type];
    const abs = join13(outputTypeDir(workspace, type), d.name, file);
    if (!existsSync13(abs))
      continue;
    const doc = parseOutputArtifact(abs, `${outputTypeRelDir(type)}/${d.name}/${file}`, type);
    if (doc)
      out.push(doc);
  }
  return out;
}
function listAllOutputs(workspace) {
  return OUTPUT_TYPES.filter((t) => t !== "paper").flatMap((t) => listOutputs(workspace, t));
}

// lib/research/plan-library.js
import { existsSync as existsSync14, mkdirSync as mkdirSync11, readFileSync as readFileSync15, readdirSync as readdirSync11, rmSync as rmSync8, writeFileSync as writeFileSync11 } from "node:fs";
import { join as join14 } from "node:path";
function planHistoryDir(workspace, id) {
  return join14(workspace, PLAN_HISTORY_DIR, id);
}
function listPlans(workspace) {
  return listPlanDocuments(workspace).map((d) => ({
    id: d.id,
    title: d.name,
    status: d.status,
    path: d.relPath
  }));
}
var ARCHIVE_HEADER_RE = /^<!--\s*archived:[\s\S]*?-->\r?\n/;
function stripPlanArchiveHeader(source) {
  return source.replace(ARCHIVE_HEADER_RE, "");
}
function archivePlanVersion(workspace, doc, note) {
  const dir = planHistoryDir(workspace, doc.id);
  let current;
  try {
    current = readFileSync15(doc.path, "utf8");
  } catch {
    return void 0;
  }
  const existing = listPlanVersions(workspace, doc.id);
  const last = existing[existing.length - 1];
  if (last) {
    const previous = readPlanVersion(workspace, doc.id, last.version);
    if (previous !== void 0 && stripPlanArchiveHeader(previous).trim() === current.trim())
      return void 0;
  }
  const seq = String(existing.length + 1).padStart(3, "0");
  const header = `<!-- archived: ${(/* @__PURE__ */ new Date()).toISOString()} \u2014 plan_version: ${doc.version}${note ? ` \u2014 ${note}` : ""} -->
`;
  mkdirSync11(dir, { recursive: true });
  writeFileSync11(join14(dir, `v${seq}.md`), header + current, "utf8");
  return `${PLAN_HISTORY_DIR}/${doc.id}/v${seq}.md`;
}
function syncPlanHistoryDetailed(workspace) {
  const out = [];
  for (const doc of listPlanDocuments(workspace)) {
    const snap = archivePlanVersion(workspace, doc);
    if (snap)
      out.push({ id: doc.id, snapshot: snap });
  }
  return out;
}
function readPlanVersion(workspace, id, version) {
  const file = join14(planHistoryDir(workspace, id), `v${version.replace(/^v/i, "")}.md`);
  try {
    return readFileSync15(file, "utf8");
  } catch {
    return void 0;
  }
}
function listPlanVersions(workspace, id) {
  let files;
  try {
    files = readdirSync11(planHistoryDir(workspace, id)).filter((f) => /^v\d+\.md$/.test(f));
  } catch {
    return [];
  }
  return files.map((f) => {
    const version = f.replace(/^v/, "").replace(/\.md$/, "");
    const source = readPlanVersion(workspace, id, version);
    const fm = source ? parsePlanFrontmatter(stripPlanArchiveHeader(source)) : {};
    return {
      version,
      ...fm.version ? { planVersion: fm.version } : {},
      id,
      path: `${PLAN_HISTORY_DIR}/${id}/${f}`
    };
  }).sort((a, b) => Number(a.version) - Number(b.version));
}

// lib/research/context.js
var RESEARCH_STATE_REF = "research-state.md";
var RESEARCH_GUIDE_TEXT = [
  "# Research project mode",
  "",
  "This session is attached to a long-lived ConvFusion research project.",
  "All research files live under one research root \u2014 by default the `workspace/` subdirectory of the session workspace (the context below states the actual root for this session).",
  "The research context below reflects that project as it currently stands.",
  "",
  "How to work here:",
  "",
  "- Treat the research context as the authoritative state of the project.",
  "- Decide what the project needs next from the state, the user message and the",
  "  available skills \u2014 there is no fixed pipeline to follow, and no step order",
  "  to complete.",
  "- When a skill matches what the project needs, read that skill file and follow",
  "  its method. Skills are research methods, not commands.",
  "- When a task needs substantial execution (experiments, coding, data work),",
  "  write the plan into `plans/*.md` first so the user can review it, then carry",
  "  it out with the native tools.",
  "- Keep research knowledge in the workspace (`project.md`, `research-state.md`,",
  "  `plans/`, `research/`, `papers/`), not only in the conversation.",
  "",
  "Language:",
  "",
  "- **Talk to the user in the language they use.** Answer in the language of the user",
  "  message \u2014 \u4E2D\u6587\u63D0\u95EE\u5C31\u7528\u4E2D\u6587\u56DE\u7B54\uFF0CEnglish in English \u2014 for explanations, questions,",
  "  progress reports and plan summaries alike. Never switch the user to English just",
  "  because the system prompt, skills and this note are written in English.",
  "- **Write paper materials and data in English**, whatever the conversation language:",
  "  the manuscript and everything under `papers/` (LaTeX source, figures, captions,",
  "  tables, references), experiment code and configuration, datasets, result files",
  "  and logs. These are shared artefacts that outlive the conversation.",
  "- Everything else \u2014 plans, research state and other working notes \u2014 follows the",
  "  conversation language; the user reads them, so do not make them a wall of English."
].join("\n");
function extractProcessGuidance(composed) {
  if (!composed)
    return void 0;
  const userAt = composed.indexOf(USER_SECTION_HEADER);
  if (userAt < 0)
    return void 0;
  const baseAt = composed.indexOf(BASE_SECTION_HEADER);
  const block = composed.slice(userAt + USER_SECTION_HEADER.length, baseAt < 0 ? void 0 : baseAt).trim();
  if (!block)
    return void 0;
  const heading = /^##\s+Research Method\s*$/m.exec(block);
  if (!heading)
    return void 0;
  const after = block.slice(heading.index + heading[0].length);
  const next = /^##\s+\S/m.exec(after);
  const picked = (next ? after.slice(0, next.index) : after).trim();
  const withoutStages = picked.replace(/```[^\n]*\n[\s\S]*?```/g, (fenced) => /^[ \t]*stage:/m.test(fenced) ? "" : fenced);
  const cleaned = withoutStages.split(/\r?\n/).filter((line) => !/^[^：:]{0,40}[：:]$/.test(line.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || void 0;
}
function collectResearchContext(source) {
  const ws = source.workspace;
  const activePaperId = getActivePaperId(ws);
  const allPapers = listPapers(ws).map((p) => ({
    id: p.id,
    title: p.metadata.title,
    status: p.metadata.status,
    version: p.metadata.version,
    track: p.metadata.researchTrack,
    type: p.metadata.paperType,
    active: p.id === activePaperId
  }));
  const paper = loadPaper(ws, activePaperId);
  let rootPrefix;
  if (source.sessionWorkspace) {
    const rel = relative3(resolve2(source.sessionWorkspace), resolve2(ws));
    if (rel && rel !== "." && !isAbsolute2(rel) && !rel.startsWith(".."))
      rootPrefix = rel;
  }
  const suggestedSkills = suggestSkillsFor(ws, source.userInput, source.skillContent);
  const prereqWarnings = /* @__PURE__ */ new Map();
  if (suggestedSkills.length > 0) {
    const signalCtx = buildSignalContext(ws);
    const statuses = assessPrerequisites(suggestedSkills.map((s) => ({ id: s.id, content: source.skillContent?.(s.id) })), signalCtx);
    for (const st of statuses) {
      if (!st.satisfied)
        prereqWarnings.set(st.skillId, renderUnmetPrerequisites(st));
    }
  }
  return {
    ...rootPrefix ? { rootPrefix } : {},
    project: loadProjectFile(ws),
    activePaperId,
    allPapers,
    paperTitle: paper.title,
    paperExcerpt: paper.excerpt,
    plans: listPlans(ws),
    skills: skillSummaries(ws),
    process: assessResearchProcess(ws, { ...source.skillContent ? { skillContent: source.skillContent } : {} }),
    ...(() => {
      const guidance = extractProcessGuidance(source.skillContent?.(PROCESS_SKILL_ID));
      return guidance ? { processGuidance: guidance } : {};
    })(),
    suggestedSkills,
    prereqWarnings,
    state: loadResearchState(ws),
    index: buildResearchIndex(ws),
    openQuestions: openQuestions(ws),
    paper: paperStatusSummary(ws, activePaperId) ?? null,
    paperGaps: prioritizeGaps(listPaperGaps(ws, activePaperId)).filter((g) => !g.resolved),
    outputs: listAllOutputs(ws).map((o) => ({
      id: o.id,
      type: o.type,
      status: o.status,
      version: o.version,
      title: o.title,
      relPath: o.relPath
    }))
  };
}
var MAX_SUGGESTED_SKILLS = 6;
function suggestSkillsFor(ws, userInput, skillContent) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (s) => {
    if (seen.has(s.id) || out.length >= MAX_SUGGESTED_SKILLS)
      return;
    seen.add(s.id);
    out.push(s);
  };
  const toSummary = (e) => ({
    id: e.document.id,
    name: e.document.name,
    purpose: e.purpose,
    whenToUse: e.whenToUse,
    ...e.document.category ? { category: e.document.category } : {},
    type: e.document.type,
    path: e.document.relPath
  });
  const input = (userInput ?? "").trim();
  if (input) {
    for (const e of recommendSkills(ws, { topic: input, keywords: [input] }))
      add(toSummary(e));
  }
  const process2 = assessResearchProcess(ws, { ...skillContent ? { skillContent } : {} });
  if (process2.current) {
    const all = listSystemSkills().filter((d) => d.status === "active");
    for (const doc of all) {
      if ((doc.category ?? "").split("/")[0] !== process2.current.stage.category)
        continue;
      add({
        id: doc.id,
        name: doc.name,
        purpose: skillPurpose(doc),
        whenToUse: skillWhenToUse(doc),
        ...doc.category ? { category: doc.category } : {},
        type: doc.type,
        path: doc.relPath
      });
    }
  }
  return out;
}
function renderResearchContext(ctx, userInput = "") {
  if (!ctx.project)
    return "";
  const lines = [];
  lines.push("# Current research context");
  lines.push("");
  const p = ctx.project;
  const root = ctx.rootPrefix ? `${ctx.rootPrefix}/` : "";
  lines.push("## Research project");
  lines.push("");
  if (ctx.rootPrefix) {
    lines.push(`- Files root: \`${root}\` \u2014 all research files live in this subdirectory of the session workspace; every path in this context is relative to that root.`);
  }
  lines.push(`- Topic: ${p.topic}`);
  if (p.initialTopic && p.initialTopic !== p.topic)
    lines.push(`- Initial topic: ${p.initialTopic}`);
  if (p.domain)
    lines.push(`- Domain: ${p.domain}`);
  if (p.goal)
    lines.push(`- Goal: ${p.goal}`);
  if (p.questions && p.questions.length > 0) {
    lines.push("- Open questions:");
    for (const q of p.questions)
      lines.push(`  - ${q}`);
  }
  lines.push("");
  if (ctx.allPapers.length > 0) {
    lines.push("## Papers in workspace");
    lines.push("");
    lines.push(`Current active paper: **${ctx.activePaperId}**`);
    lines.push("");
    for (const p2 of ctx.allPapers) {
      const flags = [
        p2.active ? "\u2705 active" : "",
        p2.track ? `track: ${p2.track}` : "",
        p2.type ? `type: ${p2.type}` : ""
      ].filter(Boolean).join(" | ");
      lines.push(`- ${p2.active ? "*" : " "} \`${p2.id}\` v${p2.version} [${p2.status}] \u2014 ${p2.title ?? "(untitled)"}`);
      if (flags)
        lines.push(`    ${flags}`);
    }
    lines.push(`- Use \`research_paper action=switch paper=<id/alias>\` to switch active paper.`);
    lines.push("");
  }
  if (ctx.paperTitle || ctx.paperExcerpt) {
    lines.push(`## Current active paper (${ctx.activePaperId})`);
    lines.push("");
    if (ctx.paperTitle)
      lines.push(`- Title: ${ctx.paperTitle}`);
    const wantsPaper = /\b(paper|manuscript|section|abstract|writ|论文|写作|章节)\b/i.test(userInput);
    if (!userInput || wantsPaper) {
      if (ctx.paperExcerpt) {
        lines.push("");
        lines.push("Excerpt:");
        lines.push("");
        lines.push(ctx.paperExcerpt);
      }
    } else {
      lines.push(`- (Full manuscript available at \`${root}papers/${ctx.activePaperId}/\`; read it when the task needs it.)`);
    }
    lines.push("");
  }
  if (ctx.plans.length > 0) {
    lines.push("## Plans");
    lines.push("");
    for (const plan of ctx.plans) {
      const status = plan.status ? ` [${plan.status}]` : "";
      lines.push(`- \`${root}${plan.path}\` \u2014 ${plan.title}${status}`);
    }
    lines.push("");
  }
  if (ctx.state) {
    const established = Object.entries(ctx.state.dimensions).filter(([, v]) => v).map(([k]) => k);
    const maturity = Object.entries(ctx.state.maturity).filter(([, v]) => v && v !== "Unknown").map(([k, v]) => `${k}=${v}`);
    lines.push("## Research state");
    lines.push("");
    lines.push(`- Version: v${ctx.state.version}`);
    if (established.length > 0)
      lines.push(`- Established dimensions: ${established.join(", ")}`);
    else
      lines.push("- Established dimensions: none yet (an empty state is normal early on)");
    if (maturity.length > 0)
      lines.push(`- Maturity: ${maturity.join(", ")}`);
    lines.push(`- Full state: \`${root}${RESEARCH_STATE_REF}\``);
    lines.push("");
  }
  if (ctx.index && (ctx.index.unsupportedClaims.length > 0 || ctx.index.contestedClaims.length > 0)) {
    lines.push("## Evidence gaps");
    lines.push("");
    if (ctx.index.unsupportedClaims.length > 0) {
      lines.push(`- Claims with no supporting evidence yet: ${ctx.index.unsupportedClaims.join(", ")}`);
    }
    if (ctx.index.contestedClaims.length > 0) {
      lines.push(`- Claims with contradicting evidence: ${ctx.index.contestedClaims.join(", ")}`);
    }
    if (ctx.index.evidenceWithoutRawArtifact.length > 0) {
      lines.push(`- Evidence lacking a raw artifact reference: ${ctx.index.evidenceWithoutRawArtifact.join(", ")} (provenance is incomplete)`);
    }
    lines.push("");
  }
  if (ctx.openQuestions.length > 0) {
    lines.push("## Open questions");
    lines.push("");
    for (const q of ctx.openQuestions)
      lines.push(`- ${q}`);
    lines.push("");
  }
  if (ctx.paper) {
    const p2 = ctx.paper;
    lines.push("## Paper");
    lines.push("");
    lines.push(`- Title: ${p2.title}`);
    lines.push(`- Version: v${p2.version} [${p2.status}]`);
    lines.push(`- Sections with content: ${p2.sections.substantive}/${p2.sections.total}`);
    lines.push(`- Claims: ${p2.claims.total}${p2.claims.withoutEvidence ? ` (${p2.claims.withoutEvidence} without evidence)` : ""}`);
    lines.push(`- Evidence used in the manuscript: ${p2.evidence.usedInManuscript}/${p2.evidence.total}`);
    if (p2.maturity.established.length)
      lines.push(`- Maturity established: ${p2.maturity.established.join(", ")}`);
    if (p2.openProposals > 0)
      lines.push(`- ${p2.openProposals} revision proposal(s) awaiting your review`);
    lines.push(`- Paper files: \`${root}papers/${p2.paperId}/\``);
    lines.push("");
  }
  if (ctx.outputs.length > 0) {
    lines.push("## Research outputs");
    lines.push("");
    lines.push("The same research expressed in other forms (a paper is one of them):");
    lines.push("");
    for (const o of ctx.outputs) {
      lines.push(`- \`${o.id}\` [${o.status}] v${o.version} (${o.type}) \u2014 ${o.title}  \xB7 \`${root}${o.relPath}\``);
    }
    const drafts = ctx.outputs.filter((o) => o.status === "draft").length;
    if (drafts > 0)
      lines.push("", `${drafts} output(s) are drafts awaiting review.`);
    lines.push("");
  }
  if (ctx.paperGaps.length > 0) {
    lines.push("## Current paper gaps");
    lines.push("");
    lines.push("These are what the paper is missing right now (from rule checks + recorded notes):");
    lines.push("");
    for (const g of ctx.paperGaps.slice(0, 6)) {
      lines.push(`- [${g.priority}] ${g.type}: ${g.description}${g.suggestedSkill ? ` (a suitable skill: \`${g.suggestedSkill}\`)` : ""}`);
    }
    if (ctx.paperGaps.length > 6)
      lines.push(`- \u2026and ${ctx.paperGaps.length - 6} more`);
    lines.push("");
    lines.push("Gaps only *suggest* what could be done \u2014 decide yourself what to act on.");
    lines.push("");
  }
  if (ctx.process.stages.length > 0) {
    lines.push("## Research process");
    lines.push("");
    if (ctx.process.current) {
      lines.push(`Current stage: **${ctx.process.current.stage.label}** \u2014 ${ctx.process.current.stage.produces}.`);
      const stageState = ctx.process.current.stage.state ?? [];
      if (stageState.length > 0) {
        lines.push(`Write-back: this stage's results belong in the Research State dimension(s) ${stageState.map((d) => `\`${d}\``).join(" / ")} \u2014 use \`research_state_propose\` (artifact-indexed dimensions are auto-synced into \`${RESEARCH_STATE_REF}\`).`);
      }
      lines.push(`Basis: ${ctx.process.current.evidence}.`);
    } else {
      lines.push("Every stage of the research process has landed artifacts; there is no obvious missing step.");
    }
    const landed = ctx.process.stages.filter((s) => s.satisfied).map((s) => s.stage.label);
    const pending = ctx.process.missing.map((s) => s.stage.label);
    if (landed.length > 0)
      lines.push(`Landed: ${landed.join(" \u2192 ")}`);
    if (pending.length > 0)
      lines.push(`Not yet: ${pending.join(" \xB7 ")}`);
    lines.push("");
    if (ctx.processGuidance) {
      lines.push("## Research process (this project's own flow)");
      lines.push("");
      lines.push(ctx.processGuidance);
      lines.push("");
      lines.push("This flow is defined by the researcher for this project \u2014 follow it when choosing the next step; where it is more specific, it takes precedence.");
      lines.push("");
    }
    lines.push("The stage list above is a description of the research assets, not a procedure to follow: stages do not gate anything, and you may work on any of them in any order the research actually needs.");
    lines.push("");
  }
  if (ctx.skills.length > 0) {
    lines.push("## Research skills");
    lines.push("");
    lines.push(`The capability library holds ${ctx.skills.length} research skills; the full catalogue and its on-demand loading are provided by the native skill list. Load a skill before following its method.`);
    if (ctx.suggestedSkills.length > 0) {
      lines.push("");
      lines.push("Possibly relevant to this request (navigation only \u2014 no execution order):");
      for (const s of ctx.suggestedSkills) {
        const purpose = s.purpose ? ` \u2014 ${s.purpose.split("\n")[0]}` : "";
        const warning = ctx.prereqWarnings.get(s.id);
        lines.push(`- **${s.name}** (\`${s.path}\`)${purpose}${warning ? ` \xB7 \u26A0 \u524D\u7F6E\u672A\u6EE1\u8DB3: ${warning}` : ""}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

// lib/codex/context.js
function codexResearchContext(root, input, store) {
  const context = renderResearchContext(collectResearchContext({
    workspace: researchWorkspaceOf(root),
    sessionWorkspace: root,
    userInput: input,
    skillContent: (id) => effectiveSkillContentById(id, store)
  }), input);
  if (!context)
    return "";
  const guide = RESEARCH_GUIDE_TEXT.replace("read that skill file", "load its effective content with `research_methods`");
  return `${guide}

${context.replace("the native skill list", "`research_methods` (list or read an id; user customizations are included)")}`;
}

// lib/codex/storage.js
import { createHash, randomBytes } from "node:crypto";
import { existsSync as existsSync15, readFileSync as readFileSync16, mkdirSync as mkdirSync12, writeFileSync as writeFileSync12, renameSync, chmodSync, realpathSync, statSync as statSync3, openSync, closeSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname as dirname5, isAbsolute as isAbsolute3, join as join15 } from "node:path";
function codexHome(env = process.env) {
  return env.CONVFUSION_CODEX_HOME || join15(env.CODEX_HOME || join15(homedir(), ".codex"), "convfusion");
}
function stateKey(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
function readPrivateJson(path, fallback) {
  return existsSync15(path) ? JSON.parse(readFileSync16(path, "utf8")) : fallback;
}
function writePrivateJson(path, value) {
  mkdirSync12(dirname5(path), { recursive: true, mode: 448 });
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync12(temp, JSON.stringify(value, null, 2) + "\n", { mode: 384, flag: "wx" });
  renameSync(temp, path);
  chmodSync(path, 384);
}
function withPrivateLock(path, work) {
  mkdirSync12(dirname5(path), { recursive: true, mode: 448 });
  const lock = `${path}.lock`;
  let fd;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      fd = openSync(lock, "wx", 384);
      writeFileSync12(fd, String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
      try {
        const owner = Number(readFileSync16(lock, "utf8"));
        if (Number.isInteger(owner) && owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (probe) {
            if (probe.code === "ESRCH") {
              unlinkSync(lock);
              continue;
            }
          }
        }
      } catch {
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  if (fd === void 0)
    throw new Error("ConvFusion adapter state is busy; retry the operation.");
  try {
    return work();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
function readCodexWorkspaces(home) {
  const rows = readPrivateJson(join15(home, "workspaces.json"), []);
  return Array.isArray(rows) ? rows.filter((row) => {
    try {
      return typeof row?.path === "string" && isAbsolute3(row.path) && typeof row.id === "string" && statSync3(row.path).isDirectory();
    } catch {
      return false;
    }
  }) : [];
}
function registerCodexWorkspace(home, root) {
  const path = realpathSync(root);
  const row = { id: stateKey(path), path, title: basename(path), updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  withPrivateLock(join15(home, "workspaces.json"), () => {
    const rows = readCodexWorkspaces(home).filter((old) => old.id !== row.id);
    writePrivateJson(join15(home, "workspaces.json"), [row, ...rows]);
  });
  return row;
}

// lib/research/advance.js
function findBlockingQuestion(questions) {
  for (const q of questions ?? []) {
    if (/\[blocking\]/i.test(q) || /（阻塞项）|\(阻塞项\)/.test(q))
      return q;
  }
  return void 0;
}
var DEFAULT_STALE_THRESHOLD = 2;
function assessAdvance(input) {
  const process2 = input.process ?? assessResearchProcess(input.workspace);
  const project = loadProjectFile(input.workspace);
  const staleThreshold = input.staleThreshold ?? DEFAULT_STALE_THRESHOLD;
  const staleRounds = input.staleRounds ?? 0;
  const blocking = findBlockingQuestion(project?.questions);
  if (blocking) {
    return {
      clarity: "blocked",
      basisCode: "blockingQuestion",
      basis: "\u7814\u7A76\u95EE\u9898\u4E2D\u5B58\u5728\u663E\u5F0F\u6807\u8BB0\u7684\u963B\u585E\u9879",
      needsUserDecision: blocking
    };
  }
  if (staleRounds >= staleThreshold) {
    return {
      clarity: "ambiguous",
      basisCode: "stalled",
      basisParams: { rounds: staleRounds },
      basis: `\u8FDE\u7EED ${staleRounds} \u8F6E\u6CA1\u6709\u5F62\u6210\u65B0\u7684\u53EF\u9A8C\u8BC1\u7814\u7A76\u8D44\u4EA7`,
      needsUserDecision: "\u5F53\u524D\u63A8\u8FDB\u65B9\u5F0F\u6CA1\u6709\u4EA7\u751F\u8D44\u4EA7\u3002\u8BF7\u786E\u8BA4\uFF1A\u662F\u7EE7\u7EED\u8FD9\u4E2A\u65B9\u5411\uFF0C\u8FD8\u662F\u6362\u4E00\u4E2A\u65B9\u5411\uFF0F\u8C03\u6574\u76EE\u6807\uFF1F",
      decisionCode: "stalled"
    };
  }
  const drafts = listPlanDocuments(input.workspace).filter((p) => p.status === "draft");
  if (drafts.length >= 2) {
    const decided = listDecisions(input.workspace).filter((d) => /^decided/i.test(d.status.trim()));
    if (decided.length === 0) {
      return {
        clarity: "ambiguous",
        basisCode: "draftPlans",
        basisParams: { count: drafts.length, plans: drafts.map((p) => p.id).join(", ") },
        basis: `\u5B58\u5728 ${drafts.length} \u4E2A\u4ECD\u662F draft \u7684\u8BA1\u5212\uFF08${drafts.map((p) => p.id).join(", ")}\uFF09`,
        needsUserDecision: "\u591A\u4E2A\u8BA1\u5212\u90FD\u8FD8\u662F\u8349\u7A3F\u3001\u6CA1\u6709\u6392\u5E8F\u3002\u8BF7\u786E\u8BA4\u4EE5\u54EA\u4E00\u4E2A\u4E3A\u51C6\uFF0C\u6216\u8BF4\u660E\u53D6\u820D\u6807\u51C6\u3002",
        decisionCode: "draftPlans"
      };
    }
  }
  if (!process2.current) {
    return {
      clarity: "ambiguous",
      basisCode: "processComplete",
      basis: "\u79D1\u7814\u8FC7\u7A0B\u5404\u9636\u6BB5\u5747\u5DF2\u6709\u843D\u5730\u8D44\u4EA7\uFF0C\u6CA1\u6709\u7ED3\u6784\u6027\u7F3A\u53E3",
      needsUserDecision: "\u63A5\u4E0B\u6765\u662F\u7EE7\u7EED\u6DF1\u5316\u3001\u8F6C\u5411\u5199\u4F5C\uFF0C\u8FD8\u662F\u5F00\u65B0\u7684\u95EE\u9898\uFF1F\u8BF7\u6307\u5B9A\u65B9\u5411\u3002",
      decisionCode: "processComplete"
    };
  }
  const stage = process2.current.stage;
  return {
    clarity: "clear",
    basisCode: "stagePending",
    basisParams: { stage: stage.label, evidence: process2.current.evidence },
    basis: `\u5F53\u524D\u9636\u6BB5\u300C${stage.label}\u300D\u5C1A\u672A\u843D\u5730\uFF08${process2.current.evidence}\uFF09`,
    nextStep: stage.produces
  };
}
var DEFAULT_AUTO_CONTINUE = { enabled: true, maxRounds: 3 };
function shouldAutoContinue(assessment, policy, roundsUsed) {
  if (!policy.enabled)
    return { go: false, reason: "auto-continue disabled by settings" };
  if (assessment.clarity !== "clear") {
    return { go: false, reason: `next step is ${assessment.clarity}: ${assessment.basis}` };
  }
  if (roundsUsed >= policy.maxRounds) {
    return { go: false, reason: `auto-continue budget exhausted (${roundsUsed}/${policy.maxRounds})` };
  }
  return { go: true, reason: assessment.basis };
}

// lib/research/progress.js
var MATURITY_SCALE = {
  Unknown: 0,
  Weak: 0.25,
  Emerging: 0.5,
  Strong: 0.75,
  Established: 1
};
function shortWorkTitle(title, id) {
  const source = (title || id).trim();
  const head = source.split(/\s+[—–]\s+|:\s+/)[0]?.trim() || source;
  const words = head.split(/\s+/).filter(Boolean);
  const brief = words.length > 2 ? words.slice(0, 2).join(" ") : head;
  const chars = [...brief];
  return chars.length > 22 ? `${chars.slice(0, 22).join("")}\u2026` : brief;
}
function captureWorkProgress(workspace) {
  const activeId = getActivePaperId(workspace);
  const out = [];
  for (const paper of listPapers(workspace)) {
    const summary = paperStatusSummary(workspace, paper.id);
    if (!summary)
      continue;
    const title = paperTitle(paper);
    const recorded = readPaperMaturity(workspace, paper.id);
    const recordedKnown = PAPER_MATURITY_DIMENSIONS.some((d) => recorded[d].status !== "Unknown");
    const maturity = recordedKnown ? recorded : suggestPaperMaturity(workspace, paper.id);
    const dimensions = PAPER_MATURITY_DIMENSIONS.map((d) => ({
      dimension: d,
      level: maturity[d].status,
      scale: MATURITY_SCALE[maturity[d].status]
    }));
    const open = prioritizeGaps(mergeDetectedGaps(listPaperGaps(workspace, paper.id), detectPaperGaps(workspace, paper.id)).gaps).filter((g) => !g.resolved);
    const top = open[0];
    const target = top?.relatedClaim ?? top?.relatedSection;
    out.push({
      id: paper.id,
      title,
      short: shortWorkTitle(title, paper.id),
      active: paper.id === activeId,
      status: summary.status,
      version: summary.version,
      overall: dimensions.reduce((a, d) => a + d.scale, 0) / dimensions.length,
      maturitySource: recordedKnown ? "recorded" : "derived",
      maturity: dimensions,
      counts: {
        sections: summary.sections.total,
        sectionsWithContent: summary.sections.substantive,
        claims: summary.claims.total,
        claimsWithoutEvidence: summary.claims.withoutEvidence,
        evidence: summary.evidence.total,
        evidenceUsedInManuscript: summary.evidence.usedInManuscript,
        gaps: open.length,
        gapsHigh: open.filter((g) => g.priority === "high").length,
        openProposals: summary.openProposals
      },
      ...top ? {
        next: {
          code: top.type,
          priority: top.priority,
          ...target ? { target } : {},
          ...top.suggestedSkill ? { skill: top.suggestedSkill } : {}
        }
      } : {}
    });
  }
  return out;
}
function captureProgress(workspace, skillContent, advanceOptions = {}) {
  const state = loadResearchState(workspace);
  const evidence = listEvidence(workspace);
  const claims = listClaims(workspace);
  const decisions = listDecisions(workspace);
  const plans = listPlanDocuments(workspace);
  const index = buildResearchIndex(workspace);
  const process2 = assessResearchProcess(workspace, { ...skillContent ? { skillContent } : {} });
  const maturity = { ...state?.maturity ?? {} };
  for (const d of MATURITY_DIMENSIONS)
    maturity[d] = maturity[d] ?? "Unknown";
  const advance = assessAdvance({
    workspace,
    ...advanceOptions.staleRounds !== void 0 ? { staleRounds: advanceOptions.staleRounds } : {},
    ...advanceOptions.staleThreshold !== void 0 ? { staleThreshold: advanceOptions.staleThreshold } : {},
    process: process2
  });
  return {
    advance,
    stateVersion: state?.version ?? "\u2014",
    maturity,
    works: captureWorkProgress(workspace),
    counts: {
      evidence: evidence.length,
      evidenceSettled: evidence.filter((e) => e.status === "supported" || e.status === "verified").length,
      evidenceWithArtifact: evidence.filter((e) => e.provenance.rawArtifacts.length > 0).length,
      claims: claims.length,
      claimsSupported: claims.filter((c) => c.evidence.length > 0).length,
      decisions: decisions.length,
      plans: plans.length,
      plansReady: plans.filter((p) => p.status === "ready" || p.status === "refined").length,
      openQuestions: index.openQuestions.length,
      outputs: listAllOutputs(workspace).length,
      paperPresent: hasManuscript(workspace)
    },
    stage: process2.current ? { id: process2.current.stage.id, label: process2.current.stage.label } : null
  };
}
function meanScale(m) {
  const values = MATURITY_DIMENSIONS.map((d) => MATURITY_SCALE[m[d]]);
  if (values.length === 0)
    return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function diffProgress(before, after) {
  const maturityChanges = MATURITY_DIMENSIONS.filter((d) => before.maturity[d] !== after.maturity[d]).map((d) => ({
    dimension: d,
    from: before.maturity[d],
    to: after.maturity[d]
  }));
  const keys = Object.keys(after.counts);
  const countChanges = keys.filter((k) => before.counts[k] !== after.counts[k]).map((k) => ({ key: k, from: before.counts[k], to: after.counts[k] }));
  return {
    before,
    after,
    overallBefore: meanScale(before.maturity),
    overallAfter: meanScale(after.maturity),
    maturityChanges,
    countChanges,
    changed: maturityChanges.length > 0 || countChanges.length > 0
  };
}
function pct(scale) {
  return `${Math.round(scale * 100)}%`;
}
function progressGapData(snapshot) {
  const out = [];
  if (snapshot.stage)
    out.push({ code: "stagePending", stage: snapshot.stage });
  else
    out.push({ code: "processComplete" });
  const unsupported = snapshot.counts.claims - snapshot.counts.claimsSupported;
  if (unsupported > 0)
    out.push({ code: "unsupportedClaims", count: unsupported });
  const noArtifact = snapshot.counts.evidence - snapshot.counts.evidenceWithArtifact;
  if (noArtifact > 0)
    out.push({ code: "missingArtifacts", count: noArtifact });
  if (snapshot.counts.openQuestions > 0) {
    out.push({ code: "openQuestions", count: snapshot.counts.openQuestions });
  }
  return out;
}
function buildTurnReport(diff, turn, advance, at = /* @__PURE__ */ new Date()) {
  const moved = diff.changed;
  const ovDelta = Math.round((diff.overallAfter - diff.overallBefore) * 100);
  const summary = `\u7814\u7A76\u8FDB\u5C55 \xB7 \u6210\u719F\u5EA6\u6298\u7B97 ${pct(diff.overallBefore)} \u2192 ${pct(diff.overallAfter)}` + (ovDelta !== 0 ? ` (${ovDelta > 0 ? "+" : ""}${ovDelta})` : "") + (diff.countChanges.length > 0 ? ` \xB7 ${diff.countChanges.length} \u9879\u8D44\u4EA7\u53D8\u5316` : " \xB7 \u672C\u8F6E\u65E0\u8D44\u4EA7\u53D8\u5316") + (advance ? advance.clarity === "clear" ? " \xB7 \u53EF\u7EE7\u7EED" : " \xB7 \u5F85\u4F60\u5B9A" : "");
  return {
    at: at.toISOString(),
    turn,
    summary,
    overall: { before: diff.overallBefore, after: diff.overallAfter },
    progress: {
      dimensions: MATURITY_DIMENSIONS.map((d) => ({
        dimension: d,
        level: diff.after.maturity[d],
        scale: MATURITY_SCALE[diff.after.maturity[d]]
      })),
      stage: diff.after.stage
    },
    changes: {
      changed: moved,
      maturity: diff.maturityChanges.map((m) => ({ dimension: m.dimension, from: m.from, to: m.to })),
      counts: diff.countChanges.map((c) => ({
        key: String(c.key),
        from: c.from,
        to: c.to
      }))
    },
    need: {
      gaps: progressGapData(diff.after),
      clarity: advance?.clarity ?? "unknown",
      basis: advance?.basis ?? "",
      ...advance?.basisCode ? { basisCode: advance.basisCode } : {},
      ...advance?.basisParams ? { basisParams: advance.basisParams } : {},
      ...advance?.nextStep ? { nextStep: advance.nextStep } : {},
      ...advance?.needsUserDecision ? { needsUserDecision: advance.needsUserDecision } : {},
      ...advance?.decisionCode ? { decisionCode: advance.decisionCode } : {}
    },
    moved
  };
}

// lib/codex/lifecycle.js
function isReadOnlyRequest(prompt) {
  return /只(?:做)?(?:排查|核查|检查|总结|审查|读)|只(?:给|做)(?:方案|计划|建议)|不(?:要|做|进行)(?:任何)?(?:修改|改动|改|写入|修复)|先(?:别|不要)(?:改|修)|read[- ]only|(?:do not|don't) (?:modify|edit|write|change|fix|delete)|(?:audit|review|inspect) only|only (?:audit|review|inspect)|no changes|(?:^|\s)(?:stop|pause)(?:\s|$)|停止|暂停/i.test(prompt);
}
function requestsResearchContinuation(prompt) {
  if (/导出.*方法|export.*methods|打开.*(?:界面|工作台)|open.*(?:workbench|interface)|登录|login|sign in|账号|account/i.test(prompt))
    return false;
  return /继续|推进|开展|执行|跑实验|实施|完成|(?:建立|创建|开始).*研究|\b(?:continue|proceed|execute|implement)\b|\b(?:start|create).*research|\brun.*experiment/i.test(prompt);
}
function contextOutput(event, text) {
  return text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : {};
}
function handleLifecycle(input, env = process.env) {
  if (!input || typeof input.cwd !== "string" || !isAbsolute4(input.cwd) || typeof input.session_id !== "string" || !input.session_id)
    return {};
  const root = realpathSync2(input.cwd);
  const plugin = realpathSync2(fileURLToPath3(new URL("../..", new URL("./codex/lifecycle.js", import.meta.url).href)));
  const fromPlugin = relative4(plugin, root);
  if (!fromPlugin || fromPlugin !== ".." && !fromPlugin.startsWith(`..${sep2}`) && !isAbsolute4(fromPlugin))
    return {};
  const ws = researchWorkspaceOf(root);
  const research = isResearchWorkspace(ws);
  const home = resolve3(codexHome(env));
  registerCodexWorkspace(home, root);
  const store = createFileCustomizationStore(() => join16(home, "skill-customizations.json"));
  const skillContent = (id) => effectiveSkillContentById(id, store);
  const path = join16(home, "sessions", `${stateKey(`${root}
${input.session_id}`)}.json`);
  return withPrivateLock(path, () => {
    const state = readPrivateJson(path, {
      root,
      sessionId: input.session_id,
      readOnly: true,
      interrupted: false,
      canContinue: false,
      rounds: 0,
      staleRounds: 0,
      turn: 0,
      observations: []
    });
    const event = input.hook_event_name;
    const planning = input.permission_mode === "plan";
    state.observations = [...state.observations, { event, ...input.tool_name ? { tool: input.tool_name } : {} }].slice(-64);
    let output = {};
    if (event === "UserPromptSubmit") {
      const continuation = Boolean(state.pendingContinuation && input.prompt === state.pendingContinuation);
      if (!continuation) {
        state.rounds = 0;
        state.staleRounds = 0;
        state.interrupted = false;
        state.readOnly = isReadOnlyRequest(input.prompt ?? "") || planning;
        state.canContinue = requestsResearchContinuation(input.prompt ?? "");
      }
      state.pendingContinuation = void 0;
      state.lastStop = void 0;
      state.lastOutput = void 0;
      state.baseline = research ? captureProgress(ws, skillContent) : void 0;
      if (research && !state.readOnly && !planning)
        syncPlanHistoryDetailed(ws);
      output = contextOutput(event, codexResearchContext(root, input.prompt ?? "", store));
    } else if (event === "SessionStart" || event === "PreToolUse") {
      if (research && !state.baseline && event === "PreToolUse")
        state.baseline = captureProgress(ws, skillContent);
      if (research && event === "PreToolUse" && !state.readOnly && !planning && !state.interrupted)
        syncPlanHistoryDetailed(ws);
      output = contextOutput(event, codexResearchContext(root, "", store));
    } else if (event === "Interrupt") {
      state.interrupted = true;
      state.pendingContinuation = void 0;
    } else if (event === "Stop" && research) {
      const stopId = input.turn_id || "current";
      if (state.lastStop === stopId)
        return input.stop_hook_active ? {} : state.lastOutput ?? {};
      const after = captureProgress(ws, skillContent);
      const before = state.baseline ?? after;
      const diff = diffProgress(before, after);
      state.staleRounds = diff.changed ? 0 : state.staleRounds + 1;
      const assessed = captureProgress(ws, skillContent, { staleRounds: state.staleRounds });
      const report = buildTurnReport(diff, ++state.turn, assessed.advance);
      writePrivateJson(join16(home, "reports", `${stateKey(root)}.json`), { sessionId: input.session_id, workspaceRoot: root, report });
      if (!state.readOnly && !planning && !state.interrupted)
        syncPlanHistoryDetailed(ws);
      const config = readPrivateJson(join16(home, "config.json"), {});
      const configuredMax = config.autoContinueMaxRounds;
      const policy = {
        enabled: config.autoContinue ?? DEFAULT_AUTO_CONTINUE.enabled,
        maxRounds: typeof configuredMax === "number" && Number.isFinite(configuredMax) && configuredMax >= 0 ? Math.floor(configuredMax) : DEFAULT_AUTO_CONTINUE.maxRounds
      };
      const gate = shouldAutoContinue(assessed.advance, policy, state.rounds);
      if (gate.go && state.canContinue && !state.readOnly && !planning && !state.interrupted) {
        state.rounds++;
        const reason = `ConvFusion research continuation ${state.rounds}/${policy.maxRounds}.

${codexResearchContext(root, "", store)}

Continue the user's authorized research: ${assessed.advance.nextStep ?? assessed.advance.basis}. Use native tools, preserve plan review policies, and stop for a blocking choice. Do not expand the user's scope or publish, purchase, or accept paid guidance without their authorization.`;
        state.pendingContinuation = reason;
        output = { decision: "block", reason };
      }
      state.baseline = assessed;
      state.lastStop = stopId;
      state.lastOutput = output;
    }
    writePrivateJson(path, state);
    return output;
  });
}
async function serveLifecycle() {
  try {
    let data = "";
    for await (const chunk of process.stdin) {
      data += chunk;
      if (data.length > 4 * 1024 * 1024)
        throw new Error("Hook input too large");
    }
    process.stdout.write(JSON.stringify(handleLifecycle(JSON.parse(data))) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ systemMessage: "ConvFusion could not refresh research context; use research_context and check the local adapter state." }) + "\n");
  }
}

// scripts/convfusion-hooks.mjs
await serveLifecycle();
