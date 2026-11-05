import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConvFusionApiKey, resolveServerUrl } from '../config.js';
import { fetchDecisionAssist } from '../server-client.js';
import { loadResearchState } from './research-state.js';
import { loadProjectFile } from './project.js';
import { isResearchWorkspace } from './workspace.js';
export const DECISION_TYPES = [
    'C1_next_action_selection', 'B1_evidence_sufficiency',
    'B2_claim_evidence_consistency', 'D1_direction_decision',
];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const skipped = (reason) => ({ ok: true, status: 'skipped', reason, instruction: 'Continue the existing workflow without decision assistance.' });
/** Preserve text verbatim up to a fixed budget, reporting every omitted field. */
export function decisionState(workspace) {
    const state = loadResearchState(workspace);
    const d = state?.dimensions ?? {};
    const project = loadProjectFile(workspace);
    const truncated = [];
    const text = (key, value) => {
        const raw = value ?? '';
        const limited = Array.from(raw).slice(0, 500).join('');
        if (raw !== limited)
            truncated.push(key);
        return limited;
    };
    const list = (key, value) => {
        const item = text(key, value);
        return item ? [item] : [];
    };
    return {
        research_state: {
            research_question: text('research_question', d['Research Questions'] || d.Problem || project?.questions?.join('\n') || project?.topic),
            hypothesis: text('hypothesis', d.Hypotheses), method: text('method', d.Method),
            experiments: list('experiments', d.Experiments), evidence: list('evidence', d.Evidence),
            claims: list('claims', d.Claims), history: list('history', d.Decisions),
        },
        truncated_fields: truncated,
        sources: ['project.md', 'research-state.md'].filter(file => existsSync(join(workspace, file))),
        state_version: state?.version ?? null,
    };
}
function parsePrediction(raw, type, options) {
    const p = raw;
    if (!p || p.status !== 'used' || p.decision_type !== type
        || !Array.isArray(p.probabilities) || p.probabilities.length !== options.length
        || typeof p.model !== 'string' || !p.model || !/^[a-f0-9]{64}$/.test(p.input_hash)
        || !Number.isInteger(p.input_tokens) || p.input_tokens < 1 || p.input_tokens > 2048
        || p.probability_kind !== 'candidate_normalized_uncalibrated')
        throw new Error('Invalid decision response');
    let sum = 0;
    for (const [i, row] of p.probabilities.entries()) {
        if (row.label !== options[i].label || row.text !== options[i].text
            || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1)
            throw new Error('Invalid probabilities');
        sum += row.probability;
    }
    const order = p.probabilities.map((row, i) => ({ ...row, i })).sort((a, b) => b.probability - a.probability || a.i - b.i);
    if (Math.abs(sum - 1) > 1e-6 || p.predicted_label !== order[0].label || p.predicted_text !== order[0].text
        || JSON.stringify(p.top3_labels) !== JSON.stringify(order.slice(0, 3).map(row => row.label)))
        throw new Error('Inconsistent ranking');
    // Select fields explicitly so arbitrary upstream data cannot enter records/tool output.
    return { status: 'used', decision_type: type, predicted_label: p.predicted_label, predicted_text: p.predicted_text,
        probabilities: p.probabilities.map(row => ({ label: row.label, text: row.text, probability: row.probability })),
        top3_labels: p.top3_labels, model: p.model, input_tokens: p.input_tokens, input_hash: p.input_hash,
        probability_kind: p.probability_kind };
}
/** Read-only consultation: each MCP host caches in memory, never writes workspace files. */
export function createDecisionAssistant(getConfig, env = process.env, net = {}) {
    const cache = new Map();
    const pending = new Map();
    return async (workspace, args, onRequest) => {
        const config = getConfig();
        if (config.decisionAssistEnabled === false) {
            cache.clear();
            return skipped('disabled');
        }
        const apiKey = resolveConvFusionApiKey(config, env);
        if (!apiKey) {
            cache.clear();
            return skipped('not_logged_in');
        }
        if (!isResearchWorkspace(workspace))
            return skipped('no_research_workspace');
        const type = args.decision_type;
        const question = args.decision_question;
        const options = args.candidate_options;
        if (!DECISION_TYPES.includes(type)
            || typeof question !== 'string' || !question.trim() || Array.from(question).length > 1000
            || !Array.isArray(options) || options.length < 2 || options.length > 26
            || options.some(o => !o || typeof o.label !== 'string' || !o.label.trim() || o.label.length > 64
                || typeof o.text !== 'string' || !o.text.trim() || Array.from(o.text).length > 500)
            || new Set(options.map(o => o.label)).size !== options.length)
            return skipped('invalid_input');
        const projection = decisionState(workspace);
        const body = { decision_type: type, decision_question: question,
            candidate_options: options.map(o => ({ label: o.label, text: o.text })), research_state: projection.research_state };
        const base = resolveServerUrl(config, env).url;
        const key = hash(JSON.stringify([workspace, base, hash(apiKey), body, projection.state_version]));
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < 60_000)
            return { ...hit.value, cached: true };
        const active = pending.get(key);
        if (active) {
            const result = await active;
            return result.status === 'used' ? { ...result, shared_request: true } : result;
        }
        const run = (async () => {
            try {
                // Notify only after all gates/cache checks, immediately before a new request.
                // Presentation failures must not change inference or fallback behavior.
                try {
                    onRequest?.();
                }
                catch { /* optional observer */ }
                const prediction = parsePrediction(await fetchDecisionAssist(base, apiKey, body, net), String(type), body.candidate_options);
                // A toggle or account switch while the network call was in flight takes effect immediately.
                const current = getConfig();
                if (current.decisionAssistEnabled === false || resolveConvFusionApiKey(current, env) !== apiKey
                    || resolveServerUrl(current, env).url !== base)
                    return skipped('settings_changed');
                const value = { ok: true, ...prediction, cached: false,
                    ...projection, instruction: 'Tell the user in chat the DCRM recommendation and whether you adopt, partially adopt or reject it, with a short evidence-based reason. Do not claim it influenced the decision until you have actually assessed it. This consultation never writes workspace files and is available during read-only/chat-only analysis. Save useful research outcomes with the normal tools when the current task permits workspace changes; saving is never a prerequisite for consulting DCRM. Candidate probabilities are not calibrated confidence and cannot grant permission or bypass review.' };
                if (cache.size >= 64)
                    cache.delete(cache.keys().next().value);
                cache.set(key, { at: Date.now(), value });
                return value;
            }
            catch {
                return skipped('service_unavailable');
            }
        })();
        pending.set(key, run);
        try {
            return await run;
        }
        finally {
            pending.delete(key);
        }
    };
}
//# sourceMappingURL=decision-assist.js.map