import { type TurnProgressReport } from '../research/progress.js';
export interface LifecycleInput {
    hook_event_name: string;
    cwd: string;
    session_id: string;
    turn_id?: string;
    prompt?: string;
    permission_mode?: string;
    stop_hook_active?: boolean;
    tool_name?: string;
    tool_use_id?: string;
}
export interface StoredTurnReport {
    sessionId: string;
    workspaceRoot: string;
    report: TurnProgressReport;
}
export declare function latestCodexTurn(home: string, root: string): StoredTurnReport | null;
export declare function isReadOnlyRequest(prompt: string): boolean;
export declare function requestsResearchContinuation(prompt: string): boolean;
export declare function handleLifecycle(input: LifecycleInput, env?: NodeJS.ProcessEnv): Record<string, unknown>;
export declare function serveLifecycle(): Promise<void>;
//# sourceMappingURL=lifecycle.d.ts.map