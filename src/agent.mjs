// Agent base class — connects to FoxMQ, handles discovery, propose/bid/execute/verify
import mqtt from 'mqtt';
import { randomUUID } from 'crypto';
import {
  MQTT_USERNAME, MQTT_PASSWORD, MQTT_PROTOCOL_VERSION,
  TOPICS, BID_WINDOW_MS, EXECUTION_TIMEOUT_MS, VERIFY_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS, STALE_THRESHOLD_MS,
} from './config.mjs';
import { signMessage, verifyMessage, createReplayDetector, makeNonce, hashPayload } from './crypto.mjs';
import { Reputation } from './reputation.mjs';
import { buildProof, appendProofLog, createChainEntry } from './proof.mjs';

export class Agent {
  constructor(name, mqttPort, capabilities = []) {
    this.name = name;
    this.port = mqttPort;
    this.capabilities = capabilities;
    this.reputation = new Reputation(name);
    this.client = null;
    this.peers = new Map();           // peerId → { capabilities, status, reputation, ... }
    this.pendingTasks = new Map();    // taskId → task proposal
    this.pendingBids = new Map();     // taskId → [bids]
    this.pendingResults = new Map();  // taskId → result
    this.pendingVerifies = new Map(); // taskId → [verify votes]
    this.proofChains = new Map();     // taskId → [chain entries]
    this.executeFn = null;            // custom execute function
    this.verifyFn = null;             // custom verify function
    this._intervals = [];
    this._handlers = new Map();       // event handlers
    this._isReplay = createReplayDetector(); // per-agent replay detection
  }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(fn);
  }

  emit(event, ...args) {
    for (const fn of this._handlers.get(event) || []) fn(...args);
  }

  // ========== CONNECTION ==========
  connect() {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(`mqtt://127.0.0.1:${this.port}`, {
        clientId: this.name,
        username: MQTT_USERNAME,
        password: MQTT_PASSWORD,
        protocolVersion: MQTT_PROTOCOL_VERSION,
        connectTimeout: 10000,
        reconnectPeriod: 2000,
      });

      this.client.on('connect', () => {
        this.log('Connected to FoxMQ');

        // Subscribe to all taskmarket topics
        this.client.subscribe(`${TOPICS.HELLO}/+`, { qos: 1 });
        this.client.subscribe(`${TOPICS.STATE}/+`, { qos: 1 });
        this.client.subscribe(`${TOPICS.TASK}/+`, { qos: 2 });
        this.client.subscribe(`${TOPICS.BID}/+`, { qos: 2 });
        this.client.subscribe(`${TOPICS.ASSIGN}/+`, { qos: 2 });
        this.client.subscribe(`${TOPICS.RESULT}/+`, { qos: 2 });
        this.client.subscribe(`${TOPICS.VERIFY}/+`, { qos: 2 });
        this.client.subscribe(`${TOPICS.PROOF}/+`, { qos: 2 });

        // Publish hello (discovery)
        this._publishHello();

        // Start heartbeat
        this._intervals.push(setInterval(() => this._publishState(), HEARTBEAT_INTERVAL_MS));
        this._publishState();

        // Stale check
        this._intervals.push(setInterval(() => this._checkStale(), STALE_THRESHOLD_MS / 2));

        resolve();
      });

      this.client.on('message', (topic, payload) => this._onMessage(topic, payload));
      this.client.on('error', (err) => this.log(`ERROR: ${err.message}`));
      setTimeout(() => reject(new Error(`${this.name} connection timeout`)), 15000);
    });
  }

  disconnect() {
    for (const i of this._intervals) clearInterval(i);
    this._intervals = [];
    if (this.client) this.client.end(true);
  }

  // ========== DISCOVERY ==========
  _publishHello() {
    const payload = {
      peer_id: this.name,
      type: 'discover',
      ts: new Date().toISOString(),
      capabilities: this.capabilities,
      status: 'available',
      nonce: makeNonce(),
    };
    this._publish(`${TOPICS.HELLO}/${this.name}`, payload, { qos: 2, retain: true });
    this.log(`Hello published (capabilities: ${this.capabilities.join(', ')})`);
  }

  _publishState() {
    if (!this.client?.connected) return;
    const payload = {
      peer_id: this.name,
      last_seen_ms: Date.now(),
      role: 'agent',
      status: this.pendingTasks.size > 0 ? 'busy' : 'available',
      reputation: this.reputation.toJSON(),
      ts: new Date().toISOString(),
    };
    this._publish(`${TOPICS.STATE}/${this.name}`, payload, { qos: 1, retain: true });
  }

  _checkStale() {
    const now = Date.now();
    for (const [peerId, peer] of this.peers) {
      const age = now - (peer.last_seen_ms || 0);
      if (age > STALE_THRESHOLD_MS && !peer._stale) {
        peer._stale = true;
        this.log(`STALE: ${peerId} (${(age / 1000).toFixed(1)}s ago)`);
        this.emit('peer-stale', peerId);
      } else if (age <= STALE_THRESHOLD_MS && peer._stale) {
        peer._stale = false;
        this.log(`RECOVERED: ${peerId}`);
        this.emit('peer-recovered', peerId);
      }
    }
  }

  // ========== NEGOTIATE: Propose a task ==========
  async propose(task) {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const payload = {
      id: taskId,
      type: 'negotiate',
      from: this.name,
      ts: new Date().toISOString(),
      nonce: makeNonce(),
      task: {
        description: task.description,
        input: task.input,
        requirements: task.requirements || [],
        deadline_ms: task.deadline_ms || EXECUTION_TIMEOUT_MS,
        reward: task.reward || 10,
      },
    };
    this.pendingBids.set(taskId, []);
    this.proofChains.set(taskId, [createChainEntry('negotiate', this.name, payload)]);
    this._publish(`${TOPICS.TASK}/${taskId}`, payload, { qos: 2 });
    this.log(`PROPOSED: ${taskId} — "${task.description}"`);

    // Wait for bids then resolve winner
    return new Promise((resolve) => {
      setTimeout(() => {
        this._resolveWinner(taskId);
        resolve(taskId);
      }, BID_WINDOW_MS);
    });
  }

  // ========== COMMIT: Bid on a task ==========
  async bid(taskId, offer) {
    const payload = {
      id: `bid-${randomUUID().slice(0, 8)}`,
      type: 'commit',
      from: this.name,
      taskId,
      ts: new Date().toISOString(),
      nonce: makeNonce(),
      bid: {
        capabilities: this.capabilities,
        cost: offer.cost,
        eta_ms: offer.eta_ms,
        reputation: this.reputation.getBidScore(),
      },
    };
    this._publish(`${TOPICS.BID}/${taskId}`, payload, { qos: 2 });
    this.log(`BID: ${taskId} — cost=${offer.cost} eta=${offer.eta_ms}ms`);
  }

  // ========== COMMIT: Resolve winner (leaderless deterministic) ==========
  _resolveWinner(taskId) {
    const bids = this.pendingBids.get(taskId) || [];
    if (bids.length === 0) {
      this.log(`NO BIDS for ${taskId}`);
      return;
    }

    // Deterministic sort — same on all nodes thanks to Vertex ordering
    const winner = [...bids].sort((a, b) => {
      const scoreA = (1 / a.bid.cost) * (1 / a.bid.eta_ms) * a.bid.reputation;
      const scoreB = (1 / b.bid.cost) * (1 / b.bid.eta_ms) * b.bid.reputation;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.from.localeCompare(b.from); // tie-breaker
    })[0];

    const assignPayload = {
      id: `assign-${randomUUID().slice(0, 8)}`,
      type: 'commit-result',
      from: this.name,
      taskId,
      winner: winner.from,
      bids: bids.length,
      ts: new Date().toISOString(),
      nonce: makeNonce(),
    };

    const chain = this.proofChains.get(taskId) || [];
    chain.push(createChainEntry('commit', this.name, assignPayload));

    this._publish(`${TOPICS.ASSIGN}/${taskId}`, assignPayload, { qos: 2 });
    this.log(`ASSIGNED: ${taskId} → ${winner.from} (${bids.length} bids)`);
  }

  // ========== EXECUTE: Run the task ==========
  async _executeTask(taskId, task) {
    const startTime = Date.now();
    this.log(`EXECUTING: ${taskId} — "${task.description}"`);

    let output;
    let success = true;
    try {
      if (this.executeFn) {
        output = await this.executeFn(task);
      } else {
        output = `Default execution result for: ${task.description}`;
      }
    } catch (e) {
      output = `ERROR: ${e.message}`;
      success = false;
    }

    const duration_ms = Date.now() - startTime;
    this.reputation.update(success, duration_ms, task.deadline_ms || 30000);
    const resultPayload = {
      id: `result-${randomUUID().slice(0, 8)}`,
      type: 'execute',
      from: this.name,
      taskId,
      ts: new Date().toISOString(),
      nonce: makeNonce(),
      result: {
        output,
        duration_ms,
        cost_actual: Math.round(duration_ms / 1000),
      },
    };

    const chain = this.proofChains.get(taskId) || [];
    chain.push(createChainEntry('execute', this.name, resultPayload));
    this.proofChains.set(taskId, chain);

    this._publish(`${TOPICS.RESULT}/${taskId}`, resultPayload, { qos: 2 });
    this.log(`RESULT: ${taskId} — ${duration_ms}ms — "${String(output).slice(0, 80)}"`);
  }

  // ========== VERIFY: Validate a result ==========
  async _verifyResult(taskId, resultMsg) {
    // Executor doesn't verify their own result
    if (resultMsg.from === this.name) return;

    const task = this.pendingTasks.get(taskId);
    let valid = true;
    let proof = 'Result appears valid';

    if (this.verifyFn) {
      try {
        const v = await this.verifyFn(task, resultMsg.result);
        valid = v.valid;
        proof = v.proof;
      } catch (e) {
        valid = false;
        proof = `Verification error: ${e.message}`;
      }
    }

    const verifyPayload = {
      id: `verify-${randomUUID().slice(0, 8)}`,
      type: 'verify',
      from: this.name,
      taskId,
      ts: new Date().toISOString(),
      nonce: makeNonce(),
      verification: {
        valid,
        hash: hashPayload(resultMsg.result),
        proof,
      },
    };

    this._publish(`${TOPICS.VERIFY}/${taskId}`, verifyPayload, { qos: 2 });
    this.log(`VERIFY: ${taskId} — ${valid ? 'VALID' : 'INVALID'} — ${proof}`);
  }

  // ========== PROOF OF COORDINATION ==========
  _finalizeProof(taskId, verifications) {
    // Guard against double finalization
    if (!this._proofFinalized) this._proofFinalized = new Set();
    if (this._proofFinalized.has(taskId)) return;
    this._proofFinalized.add(taskId);

    const chain = this.proofChains.get(taskId) || [];
    const sigs = {};
    for (const v of verifications) {
      sigs[v.from] = { valid: v.verification.valid, sig: v.verification.hash };
    }
    chain.push({
      phase: 'verify',
      signatures: sigs,
      ts: new Date().toISOString(),
    });

    const validCount = verifications.filter(v => v.verification.valid).length;
    const nonExecutorCount = verifications.length;
    const consensus = `${validCount}/${nonExecutorCount} non-executor agents verified`;

    const proof = buildProof(taskId, chain);
    proof.consensus = consensus;
    proof.status = validCount >= Math.ceil(nonExecutorCount * 2 / 3) ? 'COMPLETED' : 'REJECTED';

    appendProofLog(proof);
    this._publish(`${TOPICS.PROOF}/${taskId}`, proof, { qos: 2 });
    this.log(`PROOF: ${taskId} — ${proof.status} (${consensus})`);
    this.emit('task-complete', taskId, proof);
    return proof;
  }

  // ========== MESSAGE ROUTER ==========
  _onMessage(topic, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch { return; }

    // Verify signature — reject unsigned AND invalid-signed messages
    if (!msg.sig || !verifyMessage(msg)) {
      if (msg.sig) this.log(`INVALID SIG on ${topic}`);
      return;
    }

    // Anti-replay (per-agent detector)
    if (msg.nonce && this._isReplay(msg)) return;

    // Route by topic prefix
    if (topic.startsWith(TOPICS.HELLO + '/') && msg.peer_id !== this.name) {
      this.peers.set(msg.peer_id, { ...msg, _stale: false });
      this.log(`DISCOVERED: ${msg.peer_id} (${(msg.capabilities || []).join(', ')})`);
      this.emit('peer-discovered', msg.peer_id, msg);
    }
    else if (topic.startsWith(TOPICS.STATE + '/') && msg.peer_id !== this.name) {
      const prev = this.peers.get(msg.peer_id);
      this.peers.set(msg.peer_id, { ...msg, _stale: false });
      if (prev && prev._stale) {
        this.log(`RECOVERED: ${msg.peer_id}`);
        this.emit('peer-recovered', msg.peer_id);
      }
    }
    else if (topic.startsWith(TOPICS.TASK + '/') && msg.from !== this.name) {
      // Received a task proposal — decide whether to bid
      this.pendingTasks.set(msg.id, msg.task);
      this.pendingBids.set(msg.id, []);
      this.pendingVerifies.set(msg.id, []);
      this.proofChains.set(msg.id, [createChainEntry('negotiate', msg.from, msg)]);
      this.emit('task-proposed', msg.id, msg.task, msg.from);
    }
    else if (topic.startsWith(TOPICS.BID + '/')) {
      // Collect bids
      const taskId = msg.taskId;
      const bids = this.pendingBids.get(taskId) || [];
      bids.push(msg);
      this.pendingBids.set(taskId, bids);
      this.emit('bid-received', taskId, msg);
    }
    else if (topic.startsWith(TOPICS.ASSIGN + '/')) {
      // Assignment — am I the winner?
      const chain = this.proofChains.get(msg.taskId) || [];
      chain.push(createChainEntry('commit', msg.from, msg));
      this.proofChains.set(msg.taskId, chain);

      if (msg.winner === this.name) {
        const task = this.pendingTasks.get(msg.taskId);
        if (task) this._executeTask(msg.taskId, task);
      }
      this.log(`ASSIGNMENT: ${msg.taskId} → ${msg.winner}${msg.winner === this.name ? ' (ME!)' : ''}`);
      this.emit('task-assigned', msg.taskId, msg.winner);
    }
    else if (topic.startsWith(TOPICS.RESULT + '/')) {
      // Result received — verify it
      this.pendingResults.set(msg.taskId, msg);
      this._verifyResult(msg.taskId, msg);
      this.emit('result-received', msg.taskId, msg);

      // Start verify timeout — finalize with available votes if not all arrive
      if (!this._verifyTimers) this._verifyTimers = new Map();
      if (!this._verifyTimers.has(msg.taskId)) {
        const timer = setTimeout(() => {
          const verifies = this.pendingVerifies.get(msg.taskId) || [];
          if (verifies.length > 0 && !this._proofFinalized?.has(msg.taskId)) {
            this.log(`VERIFY TIMEOUT: ${msg.taskId} — finalizing with ${verifies.length} votes`);
            this._finalizeProof(msg.taskId, verifies);
          }
          this._verifyTimers.delete(msg.taskId);
        }, VERIFY_TIMEOUT_MS);
        this._verifyTimers.set(msg.taskId, timer);
      }
    }
    else if (topic.startsWith(TOPICS.VERIFY + '/')) {
      // Collect verification votes
      const taskId = msg.taskId;
      const verifies = this.pendingVerifies.get(taskId) || [];
      verifies.push(msg);
      this.pendingVerifies.set(taskId, verifies);

      // Check if we have enough verifications (non-stale, non-executor agents)
      const result = this.pendingResults.get(taskId);
      const activePeers = [...this.peers.values()].filter(p => !p._stale);
      // Non-executor count = active peers minus the executor (if executor is a peer)
      const executor = result?.from;
      const nonExecutorCount = activePeers.filter(p => p.peer_id !== executor).length;
      if (verifies.length >= nonExecutorCount && nonExecutorCount > 0) {
        // Cancel verify timeout and finalize
        if (this._verifyTimers?.has(taskId)) {
          clearTimeout(this._verifyTimers.get(taskId));
          this._verifyTimers.delete(taskId);
        }
        this._finalizeProof(taskId, verifies);
      }
      this.emit('verify-received', taskId, msg);
    }
    else if (topic.startsWith(TOPICS.PROOF + '/')) {
      if (msg.taskId) {
        this.emit('proof-received', msg.taskId, msg);
      }
    }
  }

  // ========== HELPERS ==========
  _publish(topic, payload, opts = {}) {
    const signed = signMessage(payload);
    this.client.publish(topic, JSON.stringify(signed), opts);
  }

  log(msg) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${this.name}] ${msg}`);
  }

  getPeers() {
    return [...this.peers.entries()].map(([id, p]) => ({
      id, capabilities: p.capabilities, status: p.status, stale: !!p._stale,
    }));
  }
}
