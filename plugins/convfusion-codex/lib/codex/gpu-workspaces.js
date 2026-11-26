import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveConvFusionApiKey, resolveServerUrl } from '../config.js';
import { fetchAccount, fetchAssignedGpuHosts, fetchGpuActivity, requestGpuWorkspace } from '../server-client.js';
import { stateKey, withPrivateLock } from './storage.js';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ed25519 = /^ssh-ed25519 [A-Za-z0-9+/]{68}$/;
export async function gpuWorkspaceAccess(config, env, options, action, hostId) {
    const failure = (code, message) => ({ ok: false, error: { code, message } });
    const apiKey = resolveConvFusionApiKey(config, env);
    if (!apiKey)
        return failure('not-configured', '尚未登录 ConvFusion.com。');
    const base = resolveServerUrl(config, env).url;
    const hosts = await fetchAssignedGpuHosts(base, apiKey, options);
    const account = hosts.some((host) => host.workspace !== undefined)
        ? await fetchAccount(base, apiKey, options)
        : null;
    const directory = account ? identityDirectory(env, base, account.id) : null;
    const identity = directory ? readIdentity(directory) : null;
    if (action === 'list')
        return { ok: true, value: hosts.map(({ workspace, ...host }) => ({
                ...host, workspaceStatus: workspace === undefined ? 'unsupported' : workspace?.status ?? 'unrequested',
                localIdentity: Boolean(workspace && identity?.fingerprint === workspace.keyFingerprint),
            })) };
    const host = typeof hostId === 'string' && uuid.test(hostId) ? hosts.find((item) => item.id === hostId) : undefined;
    if (!host)
        return failure('gpu-host-missing', '当前账号没有这台 GPU 主机。');
    if (!directory || host.workspace === undefined)
        return failure('gpu-workspace-unsupported', '当前服务端暂不支持 Docker 实验环境。');
    const workspace = host.workspace;
    if (action === 'request') {
        if (workspace) {
            if (identity?.fingerprint !== workspace.keyFingerprint) {
                return failure('gpu-key-mismatch', '当前设备没有这套实验环境已登记的密钥。');
            }
            return { ok: true, value: { requested: true } };
        }
        const key = ensureIdentity(directory);
        await requestGpuWorkspace(base, apiKey, host.id, key.publicKey, options);
        return { ok: true, value: { requested: true } };
    }
    if (host.networkAccess !== 'existing' && host.networkAccess !== 'accepted') {
        return failure('gpu-network-pending', '请先完成 Tailscale 设备共享。');
    }
    if (workspace?.status !== 'ready' || !workspace.sshPort || !workspace.hostPublicKey) {
        return failure('gpu-workspace-pending', 'Docker 实验环境尚未开通。');
    }
    if (identity?.fingerprint !== workspace.keyFingerprint) {
        return failure('gpu-key-mismatch', '当前设备没有这套实验环境已登记的密钥。');
    }
    if (action === 'activity') {
        const status = await fetchGpuActivity(base, apiKey, host.id, { ...options, timeoutMs: 10_000 });
        return { ok: true, value: { status } };
    }
    const address = host.tailscaleDnsName ?? host.tailscaleIp;
    const port = workspace.sshPort;
    if (!uuid.test(workspace.id) || !ed25519.test(workspace.hostPublicKey) || !Number.isInteger(port) || port < 1024 || port > 65535
        || (!isIP(address) && !/^[a-z0-9.-]+\.ts\.net$/i.test(address))) {
        return failure('gpu-workspace-invalid', 'Docker 实验环境的 SSH 信息无效。');
    }
    const alias = `convfusion-gpu-${workspace.id}`;
    const connection = join(directory, 'workspaces', workspace.id);
    const configPath = join(connection, 'ssh-config');
    const knownHosts = join(connection, 'known_hosts');
    const privateKey = join(directory, 'id_ed25519');
    withPrivateLock(configPath, () => {
        writeFileSync(knownHosts, `${alias} ${workspace.hostPublicKey}\n`, { mode: 0o600 });
        writeFileSync(configPath, [
            `Host ${alias}`, `  HostName ${address}`, `  Port ${port}`, '  User research',
            `  IdentityFile ${sshPath(privateKey)}`, '  IdentitiesOnly yes', '  IdentityAgent none',
            `  UserKnownHostsFile ${sshPath(knownHosts)}`, '  GlobalKnownHostsFile none', `  HostKeyAlias ${alias}`,
            '  StrictHostKeyChecking yes', '  HostKeyAlgorithms ssh-ed25519', '  UpdateHostKeys no',
            '  BatchMode yes', '  PasswordAuthentication no', '  KbdInteractiveAuthentication no', '  ConnectTimeout 10', '',
        ].join('\n'), { mode: 0o600 });
    });
    const quotedPath = process.platform === 'win32'
        ? `'${configPath.replaceAll("'", "''")}'`
        : `'${configPath.replaceAll("'", "'\\''")}'`;
    return { ok: true, value: {
            hostId: host.id, hostName: host.name, alias, configPath, remoteWorkspace: '/workspace',
            sshArgv: ['ssh', '-F', configPath, alias],
            command: `ssh -F ${quotedPath} ${alias}`,
        } };
}
// Shared by Codex and future DSH clients. Account/API-key rotation must not change the path.
function identityDirectory(env, base, accountId) {
    const root = resolve(env.CONVFUSION_GPU_SSH_HOME || join(homedir(), '.convfusion', 'gpu-ssh'));
    const server = new URL(base).href.replace(/\/+$/, '');
    return join(root, stateKey(JSON.stringify([server, accountId])));
}
function readIdentity(directory) {
    const path = join(directory, 'id_ed25519');
    if (!existsSync(path) || !existsSync(`${path}.pub`))
        return null;
    const file = lstatSync(path);
    if (!lstatSync(directory).isDirectory() || !file.isFile() || !lstatSync(`${path}.pub`).isFile()
        || (process.platform !== 'win32' && (file.mode & 0o077) !== 0))
        return null;
    const publicKey = readFileSync(`${path}.pub`, 'utf8').trim().split(/\s+/).slice(0, 2).join(' ');
    if (!ed25519.test(publicKey))
        return null;
    const fingerprint = createHash('sha256').update(Buffer.from(publicKey.split(' ')[1], 'base64')).digest('base64').replace(/=+$/, '');
    return { publicKey, fingerprint: `SHA256:${fingerprint}` };
}
function ensureIdentity(directory) {
    return withPrivateLock(directory, () => {
        const existing = readIdentity(directory);
        if (existing)
            return existing;
        if (existsSync(directory))
            throw new Error('现有 ConvFusion SSH 密钥不完整或权限不正确。');
        const temp = mkdtempSync(join(dirname(directory), 'gpu-key-'));
        try {
            const generated = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ConvFusion GPU workspace', '-f', join(temp, 'id_ed25519')], {
                stdio: 'ignore', timeout: 5000, windowsHide: true,
            });
            const key = generated.status === 0 ? readIdentity(temp) : null;
            if (!key)
                throw new Error('无法创建 GPU SSH 密钥，请确认系统已安装 OpenSSH。');
            renameSync(temp, directory);
            return key;
        }
        finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
}
function sshPath(path) {
    if (/[\r\n]/.test(path))
        throw new Error('SSH file path contains a line break.');
    return `"${path.replaceAll('\\', '/').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
}
//# sourceMappingURL=gpu-workspaces.js.map