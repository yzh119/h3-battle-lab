import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, symlink, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

/** Local transport only. No combat calculations or proprietary data responses. */
export function createEngineBridge() {
  const sessions = new Map();
  const executable = process.env.BATTLE_LAB_BACKEND;
  const profile = process.env.BATTLE_LAB_PROFILE;
  const runtimeRoot = resolve('.local/native-sessions');
  const idleTimer = setInterval(() => {
    for (const [id, session] of sessions) if (Date.now() - session.lastUse > 20 * 60 * 1000) {
      sessions.delete(id); session.process.kill();
    }
  }, 60000);
  idleTimer.unref();

  async function openSession() {
    await mkdir(runtimeRoot, { recursive: true });
    const root = await mkdtemp(join(runtimeRoot, 'session-'));
    try {
      await copyFile(join(profile, '.battle-lab-profile'), join(root, '.battle-lab-profile'));
      await symlink(resolve(profile, 'data'), join(root, 'data'), 'dir');
      const child = spawn(resolve(executable), [], { env: { ...process.env, BATTLE_LAB_PROFILE: root }, stdio: ['pipe', 'pipe', 'pipe'] });
      const session = { process: child, lastUse: Date.now(), pending: new Map(), closed: false };
      const fail = () => {
        session.closed = true;
        for (const pending of session.pending.values()) pending.reject(new Error('VCMI connection closed'));
        session.pending.clear();
      };
      child.on('error', () => { fail(); void rm(root, { recursive: true, force: true }); });
      child.on('exit', () => { fail(); void rm(root, { recursive: true, force: true }); });
      // Private engine diagnostics stay server-side; do not expose paths in the GUI.
      child.stderr.on('data', () => {});
      createInterface({ input: child.stdout }).on('line', line => {
        try {
          const packet = JSON.parse(line);
          const pending = session.pending.get(packet.requestId);
          if (pending) { session.pending.delete(packet.requestId); pending.resolve(packet); }
        } catch { fail(); child.kill(); }
      });
      const id = randomUUID(); sessions.set(id, session);
      return [id, session];
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  }
  async function exchange(session, request) {
    if (session.closed) throw new Error('VCMI connection closed');
    const requestId = randomUUID();
    return new Promise((resolvePacket, rejectPacket) => {
      const timer = setTimeout(() => { session.pending.delete(requestId); session.process.kill(); rejectPacket(new Error('VCMI response timed out')); }, 20000);
      session.pending.set(requestId, {
        resolve: packet => { clearTimeout(timer); resolvePacket(packet); },
        reject: error => { clearTimeout(timer); rejectPacket(error); },
      });
      session.process.stdin.write(JSON.stringify({ ...request, requestId }) + '\n');
    });
  }
  const middleware = async (request, response) => {
    const reply = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    if (request.method !== 'POST') { reply(405, { error: 'POST required' }); return; }
    const origin = request.headers.origin;
    let sameOrigin = true;
    try { sameOrigin = !origin || new URL(origin).host === request.headers.host; } catch { sameOrigin = false; }
    if (!sameOrigin) { reply(403, { error: 'Same-origin requests required' }); return; }
    if (!executable || !profile) { reply(503, { error: '本地 VCMI 引擎尚未配置；仍可查看模型和编辑阵容。' }); return; }
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString(); if (body.length > 1024 * 1024) throw new Error('Request too large');
      }
      const envelope = JSON.parse(body);
      if (!envelope.request || envelope.request.version !== 1) { reply(400, { error: 'Invalid protocol envelope' }); return; }
      let id = envelope.session, session = sessions.get(id);
      if (!id && envelope.request.op === 'catalogue') [id, session] = await openSession();
      if (!session) { reply(409, { error: '引擎会话已结束，请重新连接。' }); return; }
      session.lastUse = Date.now();
      const packet = await exchange(session, envelope.request);
      reply(200, { session: id, response: packet });
    } catch { reply(502, { error: 'VCMI 接口未能完成请求；请检查本地引擎配置。' }); }
  };
  return { middleware, close() {
    clearInterval(idleTimer);
    for (const session of sessions.values()) session.process.kill();
    sessions.clear();
  } };
}
