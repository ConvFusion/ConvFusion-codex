import { type Config } from '../config.js';
import { type ServerRequestOptions } from '../server-client.js';
export declare const DECISION_TYPES: readonly ["C1_next_action_selection", "B1_evidence_sufficiency", "B2_claim_evidence_consistency", "D1_direction_decision"];
/** Preserve text verbatim up to a fixed budget, reporting every omitted field. */
export declare function decisionState(workspace: string): {
    research_state: {
        research_question: string;
        hypothesis: string;
        method: string;
        experiments: string[];
        evidence: string[];
        claims: string[];
        history: string[];
    };
    truncated_fields: string[];
    sources: string[];
    state_version: string | null;
};
/** Read-only consultation: each MCP host caches in memory, never writes workspace files. */
export declare function createDecisionAssistant(getConfig: () => Partial<Config>, env?: NodeJS.ProcessEnv, net?: ServerRequestOptions): (workspace: string, args: Record<string, unknown>, onRequest?: () => void) => Promise<Record<string, unknown>>;
//# sourceMappingURL=decision-assist.d.ts.map