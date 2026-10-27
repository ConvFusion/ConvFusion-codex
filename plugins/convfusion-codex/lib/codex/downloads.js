/** Durable downloads shared by Codex's concurrent/replacement MCP hosts. */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { readPrivateJson, writePrivateJson, withPrivateLock } from './storage.js';
const active = (job) => ['running', 'finalizing', 'cancelling'].includes(job.state);
const stamp = (file) => {
    if (typeof file !== 'string')
        return null;
    try {
        const s = statSync(file);
        return s.isFile() ? [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':') : null;
    }
    catch {
        return null;
    }
};
const resultStamp = (result) => stamp(result?.value?.path);
const view = ({ id, state, phase, received, totalBytes, result }) => ({ id, state, phase, received, totalBytes, ...(result ? { result } : {}) });
export function createDownloadJobs(home) {
    const workers = new Map();
    const fileOf = (scope) => join(home, 'download-jobs', `${createHash('sha256').update(scope).digest('hex')}.json`);
    const cancellationFile = (scope, intent) => join(home, 'download-cancellations', `${createHash('sha256').update(JSON.stringify([scope, intent])).digest('hex')}.json`);
    const cancelledIntent = (scope, intent) => intent && existsSync(cancellationFile(scope, intent)) ? {
        id: `cancelled-${createHash('sha256').update(intent).digest('hex').slice(0, 32)}`,
        state: 'cancelled', phase: 'preparing', received: 0, totalBytes: null,
        pid: 0, heartbeat: 0, directory: '', revision: null, intents: [intent],
        result: { ok: false, error: { code: 'cancelled', message: '下载已取消。' } },
    } : null;
    const read = (file) => readPrivateJson(file, null);
    const clean = (job) => {
        // Only remove a temporary file recorded by the worker, never a finished ZIP.
        if (job.part && dirname(job.part) === job.directory && /^\.convfusion-.*\.zip\.part$/.test(basename(job.part))) {
            try {
                unlinkSync(job.part);
            }
            catch { /* already cleaned */ }
        }
    };
    const recover = (file) => {
        const job = read(file);
        if (!job)
            return null;
        let alive = true;
        if (active(job)) {
            try {
                process.kill(job.pid, 0);
            }
            catch (e) {
                alive = e.code !== 'ESRCH';
            }
            if (!alive || Date.now() - job.heartbeat > 45_000) {
                if (job.result?.ok && job.stamp && resultStamp(job.result) === job.stamp)
                    job.state = 'succeeded';
                else {
                    job.state = 'interrupted';
                    job.result = { ok: false, error: { code: 'interrupted', message: '下载进程已中断，请重新下载。' } };
                }
                writePrivateJson(file, job);
                clean(job);
            }
        }
        else if (job.state === 'succeeded' && (!job.stamp || resultStamp(job.result) !== job.stamp)) {
            job.state = 'interrupted';
            job.result = { ok: false, error: { code: 'local-file-changed', message: '已下载的 ZIP 已被移动、删除或修改，请重新下载。' } };
            writePrivateJson(file, job);
        }
        return job;
    };
    const get = (scope, revision, id, intent) => {
        const file = fileOf(scope);
        return withPrivateLock(file, () => {
            const cancelled = cancelledIntent(scope, intent);
            if (cancelled)
                return !id || id === cancelled.id ? view(cancelled) : null;
            const job = recover(file);
            if (!job || (id && job.id !== id))
                return null;
            if (intent && !job.intents.includes(intent))
                return null;
            if (!id && !intent && job.state === 'succeeded' && job.revision !== revision)
                return null;
            return view(job);
        });
    };
    const start = (scope, revision, directory, execute, verifyRevision, intent) => {
        const file = fileOf(scope);
        let created = false;
        const initial = withPrivateLock(file, () => {
            const cancelled = cancelledIntent(scope, intent);
            if (cancelled)
                return cancelled;
            const old = recover(file);
            if (old && (active(old) || (old.state === 'succeeded' && (old.revision === revision || !!intent && old.intents.includes(intent))))) {
                if (intent && !old.intents.includes(intent)) {
                    old.intents = [...old.intents, intent].slice(-128);
                    writePrivateJson(file, old);
                }
                return old;
            }
            const job = { id: randomBytes(16).toString('hex'), state: 'running', phase: 'preparing', received: 0, totalBytes: null, pid: process.pid, heartbeat: Date.now(), revision, directory, intents: intent ? [intent] : [] };
            writePrivateJson(file, job);
            created = true;
            return job;
        });
        if (!created)
            return view(initial);
        const controller = new AbortController();
        let lastProgress = 0;
        let latestReceived = 0;
        const change = (update) => withPrivateLock(file, () => {
            const job = read(file);
            if (!job || job.id !== initial.id || !active(job))
                return;
            update(job);
            writePrivateJson(file, job);
        });
        const check = () => {
            controller.signal.throwIfAborted();
            const job = read(file);
            if (!job || job.id !== initial.id || !['running', 'finalizing'].includes(job.state)) {
                controller.abort();
                controller.signal.throwIfAborted();
            }
        };
        const control = {
            signal: controller.signal, check,
            onPart: (part) => { check(); change((job) => { job.part = part; }); },
            onProgress: (received) => {
                latestReceived = received;
                if (Date.now() - lastProgress < 250)
                    return;
                lastProgress = Date.now();
                change((job) => { job.received = received; job.phase = 'downloading'; job.heartbeat = Date.now(); });
            },
            onHeaders: (totalBytes) => change((job) => { job.totalBytes = totalBytes; }),
            validating: () => { check(); change((job) => { job.phase = 'validating'; job.received = latestReceived; }); },
            onSaved: (value) => change((job) => {
                job.state = 'finalizing';
                job.result = { ok: true, value };
                job.stamp = stamp(value.path) ?? undefined;
            }),
        };
        // A page closing or an RPC timing out does not own the transfer's lifetime.
        const heartbeat = setInterval(() => {
            try {
                check();
                change((job) => { job.heartbeat = Date.now(); job.received = latestReceived; });
            }
            catch {
                controller.abort();
            }
        }, 500);
        const done = Promise.resolve().then(async () => {
            let result;
            try {
                result = await execute(control);
            }
            catch {
                result = { ok: false, error: { code: 'download-failed', message: '下载未完成，请重试。' } };
            }
            // The archive and its manifest must describe one stable remote version.
            // If files changed during transfer, keep the ZIP but do not reuse it for a later intent.
            let settledRevision = null;
            if (result.ok) {
                try {
                    settledRevision = await verifyRevision();
                }
                catch { /* unknown revision is never reusable */ }
            }
            change((job) => {
                job.received = latestReceived;
                job.revision = settledRevision === revision ? revision : null;
                if (result.ok) {
                    job.state = 'succeeded';
                    job.result = result;
                    job.stamp = resultStamp(result) ?? undefined;
                }
                else if (job.state === 'cancelling' || controller.signal.aborted) {
                    job.state = 'cancelled';
                    job.result = { ok: false, error: { code: 'cancelled', message: '下载已取消。' } };
                }
                else {
                    job.state = 'failed';
                    job.result = result;
                }
            });
        }).catch(() => { controller.abort(); })
            .finally(() => { clearInterval(heartbeat); workers.delete(initial.id); });
        workers.set(initial.id, { controller, done });
        return view(initial);
    };
    const cancel = (scope, id, intent) => {
        const file = fileOf(scope);
        const result = withPrivateLock(file, () => {
            const job = recover(file);
            if (!job || (id ? job.id !== id : !intent || !job.intents.includes(intent))) {
                if (id || !intent)
                    return null;
                // Cancel can arrive while start is still reading the remote manifest.
                // Serialize this tombstone with start so a late request cannot launch a transfer.
                writePrivateJson(cancellationFile(scope, intent), { cancelled: true });
                return view(cancelledIntent(scope, intent));
            }
            if (job.state === 'running') {
                job.state = 'cancelling';
                writePrivateJson(file, job);
            }
            return view(job);
        });
        if (result?.state === 'cancelling')
            workers.get(result.id)?.controller.abort();
        return result;
    };
    return { get, start, cancel, async close() {
            const current = [...workers.values()];
            for (const worker of current)
                worker.controller.abort();
            await Promise.all(current.map((worker) => worker.done));
        } };
}
//# sourceMappingURL=downloads.js.map