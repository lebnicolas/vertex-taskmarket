// Hive Memory — Distributed key-value store via FoxMQ MQTT
// All agents share knowledge through a dedicated topic.
// Conflict resolution: last-write-wins (timestamp).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { signMessage, verifyMessage } from './crypto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = `${__dirname}/../data`;
const HIVE_FILE = `${DATA_DIR}/hive-memory.json`;
const HIVE_TOPIC = 'taskmarket/hive/memory';

export class HiveMemory {
  constructor(agentId) {
    this.agentId = agentId;
    this.store = new Map();       // key → { value, ts, from }
    this._subscribers = [];
    this._client = null;
    this._load();
  }

  // Attach to an MQTT client (called by Agent after connect)
  attach(mqttClient) {
    this._client = mqttClient;
    mqttClient.subscribe(`${HIVE_TOPIC}/+`, { qos: 1 });
    mqttClient.on('message', (topic, raw) => {
      if (!topic.startsWith(HIVE_TOPIC + '/')) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (!verifyMessage(msg)) return;
        const { key, value, ts, from } = msg;
        if (!key) return;
        this._merge(key, value, ts, from);
      } catch { /* ignore */ }
    });

    // Publish all local entries on connect (sync)
    for (const [key, entry] of this.store) {
      this._publish(key, entry.value, entry.ts);
    }
  }

  // (5) API: set a key-value pair and broadcast
  set(key, value) {
    const ts = Date.now();
    this.store.set(key, { value, ts, from: this.agentId });
    this._save();
    this._publish(key, value, ts);
  }

  // (5) API: get a value by key
  get(key) {
    const entry = this.store.get(key);
    return entry ? entry.value : undefined;
  }

  // (5) API: get all entries
  getAll() {
    const result = {};
    for (const [key, entry] of this.store) {
      result[key] = { value: entry.value, from: entry.from, ts: entry.ts };
    }
    return result;
  }

  // (5) API: subscribe to changes
  subscribe(callback) {
    this._subscribers.push(callback);
  }

  // (3) Capitalize learnings: publish a task pattern
  publishPattern(taskType, strategy, success) {
    const key = `pattern:${taskType}`;
    const existing = this.get(key);
    const patterns = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
    patterns.push({
      strategy,
      success,
      from: this.agentId,
      ts: Date.now(),
    });
    // Keep last 10 patterns per type
    while (patterns.length > 10) patterns.shift();
    this.set(key, patterns);
  }

  // (3) Query patterns for a task type
  getPatterns(taskType) {
    const key = `pattern:${taskType}`;
    const val = this.get(key);
    return val ? (Array.isArray(val) ? val : [val]) : [];
  }

  // (3) Get best strategy for a task type (most successful)
  getBestStrategy(taskType) {
    const patterns = this.getPatterns(taskType);
    if (patterns.length === 0) return null;
    const successPatterns = patterns.filter(p => p.success);
    if (successPatterns.length === 0) return null;
    // Count strategy occurrences
    const counts = {};
    for (const p of successPatterns) {
      counts[p.strategy] = (counts[p.strategy] || 0) + 1;
    }
    // Return most common successful strategy
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // (4) Conflict resolution: last-write-wins
  _merge(key, value, ts, from) {
    const existing = this.store.get(key);
    if (!existing || ts > existing.ts) {
      this.store.set(key, { value, ts, from });
      this._save();
      for (const cb of this._subscribers) {
        try { cb(key, value, from); } catch { /* ignore */ }
      }
    }
  }

  _publish(key, value, ts) {
    if (!this._client?.connected) return;
    const msg = signMessage({
      key,
      value,
      ts: ts || Date.now(),
      from: this.agentId,
    });
    this._client.publish(`${HIVE_TOPIC}/${key}`, JSON.stringify(msg), { qos: 1, retain: true });
  }

  // (2) Persistence
  _save() {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      const obj = {};
      for (const [k, v] of this.store) obj[k] = v;
      writeFileSync(HIVE_FILE, JSON.stringify(obj, null, 2));
    } catch { /* silent */ }
  }

  _load() {
    try {
      if (existsSync(HIVE_FILE)) {
        const data = JSON.parse(readFileSync(HIVE_FILE, 'utf-8'));
        for (const [k, v] of Object.entries(data)) {
          this.store.set(k, v);
        }
      }
    } catch { /* start fresh */ }
  }

  static reset() {
    try {
      if (existsSync(HIVE_FILE)) writeFileSync(HIVE_FILE, '{}');
    } catch { /* ignore */ }
  }
}

export { HIVE_TOPIC };
