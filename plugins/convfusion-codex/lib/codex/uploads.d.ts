import type { Config } from '../config.js';
import { type ServerRequestOptions, type UploadManifestFile, type WorkspaceUploadStatus } from '../server-client.js';
export interface UploadProgress {
    doneFiles: number;
    totalFiles: number;
    sentBytes: number;
    totalBytes: number;
    running: boolean;
}
export interface UploadControl {
    config: Config;
    signal: AbortSignal;
    progress: UploadProgress;
    cancelRemote?: (() => Promise<WorkspaceUploadStatus>) | undefined;
    finishing: boolean;
}
export declare function transferWorkspace(base: string, key: string, projectId: string, root: string, paths: readonly string[], options: ServerRequestOptions, control: UploadControl, timeoutForBytes: (bytes: number) => number, state?: {
    content: unknown;
    baseVersion: number | null;
}): Promise<{
    receipt: {
        uploaded: number;
        uploaded_bytes: number;
        skipped_existing: number;
        version: number | null;
        content_hash: string | null;
    };
    skipped: import("../research/upload-selection.js").OversizeFile[];
    manifest: UploadManifestFile[];
}>;
//# sourceMappingURL=uploads.d.ts.map