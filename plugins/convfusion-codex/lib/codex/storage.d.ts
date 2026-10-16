export declare function codexHome(env?: NodeJS.ProcessEnv): string;
export declare function stateKey(value: string): string;
export declare function readPrivateJson<T>(path: string, fallback: T): T;
export declare function writePrivateJson(path: string, value: unknown): void;
export declare function withPrivateLock<T>(path: string, work: () => T): T;
export interface CodexWorkspace {
    id: string;
    path: string;
    title: string;
    updatedAt: string;
}
export declare function readCodexWorkspaces(home: string): CodexWorkspace[];
export declare function registerCodexWorkspace(home: string, root: string): CodexWorkspace;
//# sourceMappingURL=storage.d.ts.map