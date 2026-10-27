type Result = {
    ok: boolean;
    value?: unknown;
    error?: {
        code: string;
        message: string;
    };
};
type State = 'running' | 'finalizing' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface DownloadControl {
    signal: AbortSignal;
    check(): void;
    onPart(path: string): void;
    onProgress(received: number): void;
    onHeaders(totalBytes: number | null): void;
    validating(): void;
    onSaved(value: {
        path: string;
        [key: string]: unknown;
    }): void;
}
export interface DownloadJob {
    id: string;
    state: State;
    phase: 'preparing' | 'downloading' | 'validating';
    received: number;
    totalBytes: number | null;
    result?: Result;
}
export declare function createDownloadJobs(home: string): {
    get: (scope: string, revision?: string, id?: string, intent?: string) => DownloadJob | null;
    start: (scope: string, revision: string, directory: string, execute: (control: DownloadControl) => Promise<Result>, verifyRevision: () => Promise<string | null>, intent?: string) => DownloadJob;
    cancel: (scope: string, id?: string, intent?: string) => DownloadJob | null;
    close(): Promise<void>;
};
export {};
//# sourceMappingURL=downloads.d.ts.map