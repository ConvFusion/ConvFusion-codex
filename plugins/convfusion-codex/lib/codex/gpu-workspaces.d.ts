import { type Config } from '../config.js';
import { type ServerRequestOptions } from '../server-client.js';
type Action = 'list' | 'request' | 'connection' | 'activity';
export declare function gpuWorkspaceAccess(config: Config, env: NodeJS.ProcessEnv, options: ServerRequestOptions, action: Action, hostId?: string): Promise<{
    ok: false;
    error: {
        code: string;
        message: string;
    };
} | {
    ok: true;
    value: {
        workspaceStatus: string;
        localIdentity: boolean;
        id: string;
        name: string;
        tailscaleIp: string;
        tailscaleDnsName: string | null;
        sshPort: number;
        sshUsername: string;
        gpuModel: string | null;
        gpuCount: number | null;
        networkAccess: "existing" | "pending" | "accepted" | "account-mismatch" | "unavailable" | "preparing";
    }[];
} | {
    ok: true;
    value: {
        requested: boolean;
        status?: undefined;
        hostId?: undefined;
        hostName?: undefined;
        alias?: undefined;
        configPath?: undefined;
        remoteWorkspace?: undefined;
        sshArgv?: undefined;
        command?: undefined;
    };
} | {
    ok: true;
    value: {
        status: "unknown" | "busy" | "idle";
        requested?: undefined;
        hostId?: undefined;
        hostName?: undefined;
        alias?: undefined;
        configPath?: undefined;
        remoteWorkspace?: undefined;
        sshArgv?: undefined;
        command?: undefined;
    };
} | {
    ok: true;
    value: {
        hostId: string;
        hostName: string;
        alias: string;
        configPath: string;
        remoteWorkspace: string;
        sshArgv: readonly ["ssh", "-F", string, string];
        command: string;
        requested?: undefined;
        status?: undefined;
    };
}>;
export {};
//# sourceMappingURL=gpu-workspaces.d.ts.map