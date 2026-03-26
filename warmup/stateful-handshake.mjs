#!/usr/bin/env node
// Warm-Up: "The Stateful Handshake" — Vertex Swarm Challenge Track 3
// Proves: discovery + signed handshake + heartbeats + state replication + role toggle + failure injection

import mqtt from 'mqtt';
import { createHmac, randomUUID } from 'crypto';

const SHARED_SECRET = 'vertex-warmup-secret-2026';

function sign(payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHmac('sha256', SHARED_SECRET).update(canonical).digest('hex');
}

function verifySig(payload, sig) {
  return sign(payload) === sig;
}

function ts() {
  return new Date().toISOString();
}

// ========== AGENT CLASS ==========
class WarmupAgent {
  constructor(id, mqttPort, role) {
    this.id = id;
    this.port = mqttPort;
    this.role = role;
    this.status = 'ready';
    this.peers = new Map(); // peer_id → state
    this.client = null;
    this.heartbeatInterval = null;
    this.staleCheckInterval = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(`mqtt://127.0.0.1:${this.port}`, {
        clientId: this.id,
        username: 'warmup',
        password: 'warmup123',
        protocolVersion: 5,
        connectTimeout: 10000,
        reconnectPeriod: 2000,
      });

      this.client.on('connect', () => {
        console.log(`[${ts()}] [${this.id}] ✅ Connected to FoxMQ node on port ${this.port}`);

        // Subscribe to discovery and state topics
        this.client.subscribe('swarm/hello/+', { qos: 2 });
        this.client.subscribe('swarm/state/+', { qos: 1 });

        // Step 2 — Discover & Handshake: publish signed hello
        const helloPayload = {
          peer_id: this.id,
          ts: ts(),
          nonce: randomUUID(),
          capabilities: ['nlp', 'compute'],
        };
        const helloMsg = { ...helloPayload, sig: sign(helloPayload) };
        this.client.publish(`swarm/hello/${this.id}`, JSON.stringify(helloMsg), { qos: 2, retain: true });
        console.log(`[${ts()}] [${this.id}] 📡 Published signed hello (nonce: ${helloPayload.nonce.slice(0,8)}...)`);

        // Step 3 — Pulse Check: heartbeats every 2s
        this.heartbeatInterval = setInterval(() => this.publishState(), 2000);
        this.publishState(); // immediate first heartbeat

        // Stale check every 3s
        this.staleCheckInterval = setInterval(() => this.checkStale(), 3000);

        resolve();
      });

      this.client.on('message', (topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());

          if (topic.startsWith('swarm/hello/') && data.peer_id !== this.id) {
            // Verify signature
            const { sig, ...rest } = data;
            if (verifySig(rest, sig)) {
              console.log(`[${ts()}] [${this.id}] 🤝 Handshake verified from ${data.peer_id}`);
            } else {
              console.log(`[${ts()}] [${this.id}] ❌ INVALID signature from ${data.peer_id}`);
            }
          }

          if (topic.startsWith('swarm/state/') && data.peer_id !== this.id) {
            // Verify signature
            const { sig, ...rest } = data;
            if (!verifySig(rest, sig)) {
              console.log(`[${ts()}] [${this.id}] ❌ INVALID state sig from ${data.peer_id}`);
              return;
            }

            const prev = this.peers.get(data.peer_id);
            this.peers.set(data.peer_id, data);

            // Detect role change (Step 5)
            if (prev && prev.role !== data.role) {
              const latency = Date.now() - new Date(data.ts).getTime();
              console.log(`[${ts()}] [${this.id}] 🔄 ROLE CHANGE detected: ${data.peer_id} ${prev.role} → ${data.role} (replicated in ${latency}ms)`);
            }

            // Detect recovery from stale
            if (prev && prev._stale && !data._stale) {
              console.log(`[${ts()}] [${this.id}] 🟢 RECOVERY: ${data.peer_id} is back!`);
            }
          }
        } catch (e) { /* ignore parse errors */ }
      });

      this.client.on('error', (err) => {
        console.error(`[${ts()}] [${this.id}] ERROR: ${err.message}`);
      });

      setTimeout(() => reject(new Error(`${this.id} connection timeout`)), 15000);
    });
  }

  publishState() {
    if (!this.client || !this.client.connected) return;
    const statePayload = {
      peer_id: this.id,
      last_seen_ms: Date.now(),
      role: this.role,
      status: this.status,
      ts: ts(),
    };
    const stateMsg = { ...statePayload, sig: sign(statePayload) };
    this.client.publish(`swarm/state/${this.id}`, JSON.stringify(stateMsg), { qos: 1, retain: true });
  }

  checkStale() {
    const now = Date.now();
    for (const [peerId, state] of this.peers) {
      const age = now - state.last_seen_ms;
      if (age > 6000 && !state._stale) {
        state._stale = true;
        this.peers.set(peerId, state);
        console.log(`[${ts()}] [${this.id}] ⚠️  STALE: ${peerId} last seen ${(age / 1000).toFixed(1)}s ago`);
      } else if (age <= 6000 && state._stale) {
        state._stale = false;
        this.peers.set(peerId, state);
        console.log(`[${ts()}] [${this.id}] 🟢 RECOVERED: ${peerId} is back (${(age / 1000).toFixed(1)}s)`);
      }
    }
  }

  toggleRole(newRole) {
    console.log(`[${ts()}] [${this.id}] 🔀 Toggling role: ${this.role} → ${newRole}`);
    this.role = newRole;
    this.publishState(); // immediate publish
  }

  disconnect() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.staleCheckInterval) clearInterval(this.staleCheckInterval);
    if (this.client) this.client.end(true);
  }
}

// ========== MAIN ==========
async function main() {
  console.log('='.repeat(70));
  console.log('  VERTEX SWARM CHALLENGE — Warm-Up: "The Stateful Handshake"');
  console.log('  4 FoxMQ nodes (BFT f=1) | 2 Agents (A + B) | MQTT 5.0');
  console.log('='.repeat(70));
  console.log();

  const agentA = new WarmupAgent('agent-A', 1883, 'carrier');
  const agentB = new WarmupAgent('agent-B', 1884, 'carrier');

  // Step 1 — Connect both agents
  console.log(`[${ts()}] --- STEP 1: Spin up & connect ---`);
  await Promise.all([agentA.connect(), agentB.connect()]);
  console.log();

  // Steps 2-4 run automatically (hello + heartbeats + state sync)
  console.log(`[${ts()}] --- STEPS 2-4: Handshake + Heartbeats + State Sync (running 12s) ---`);
  await sleep(12000);
  console.log();

  // Step 5 — Role toggle
  console.log(`[${ts()}] --- STEP 5: Role Toggle (carrier → scout) ---`);
  agentA.toggleRole('scout');
  await sleep(3000); // Wait for replication (should be < 1s)
  console.log();

  // Toggle back
  console.log(`[${ts()}] --- STEP 5b: Role Toggle back (scout → carrier) ---`);
  agentA.toggleRole('carrier');
  await sleep(3000);
  console.log();

  // Step 6 — Failure injection: disconnect agent-B for 10s
  console.log(`[${ts()}] --- STEP 6: Failure Injection — Disconnecting agent-B for 12s ---`);
  agentB.disconnect();
  console.log(`[${ts()}] [agent-B] ❌ DISCONNECTED (simulating node failure)`);

  await sleep(12000); // Wait for stale detection
  console.log();

  // Step 7 — Recovery: reconnect agent-B
  console.log(`[${ts()}] --- STEP 7: Recovery — Reconnecting agent-B ---`);
  const agentB2 = new WarmupAgent('agent-B', 1884, 'carrier');
  await agentB2.connect();
  await sleep(6000); // Wait for recovery detection
  console.log();

  // Final state
  console.log('='.repeat(70));
  console.log('  WARM-UP COMPLETE');
  console.log(`  Agent A peers: ${JSON.stringify([...agentA.peers.entries()].map(([k, v]) => ({ id: k, role: v.role, status: v.status, stale: !!v._stale })))}`);
  console.log(`  Agent B peers: ${JSON.stringify([...agentB2.peers.entries()].map(([k, v]) => ({ id: k, role: v.role, status: v.status, stale: !!v._stale })))}`);
  console.log('='.repeat(70));

  // Cleanup
  agentA.disconnect();
  agentB2.disconnect();
  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
