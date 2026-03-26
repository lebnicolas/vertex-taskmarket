# API Reference — TaskMarket

## `Agent` (src/agent.mjs)

### Constructor

```javascript
new Agent(name, mqttPort, capabilities)
```

| Param | Type | Description |
|-------|------|-------------|
| `name` | string | Unique agent identifier |
| `mqttPort` | number | FoxMQ MQTT port to connect to |
| `capabilities` | string[] | List of capabilities (e.g., `['nlp', 'compute']`) |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `connect()` | `Promise<void>` | Connect to FoxMQ, subscribe to topics, start heartbeat |
| `disconnect()` | `void` | Stop heartbeat, close MQTT connection |
| `propose(task)` | `Promise<string>` | Propose a task, wait for bids, resolve winner. Returns `taskId` |
| `bid(taskId, offer)` | `Promise<void>` | Submit a bid for a task |
| `on(event, fn)` | `void` | Register event handler |
| `getPeers()` | `Array` | Get list of discovered peers with status |

### Task Object (for `propose()`)

```javascript
{
  description: string,     // Human-readable task description
  input: string,           // Input data for the task
  requirements: string[],  // Required capabilities (e.g., ['nlp'])
  deadline_ms: number,     // Max execution time (default: 30000)
  reward: number,          // Task reward points
}
```

### Offer Object (for `bid()`)

```javascript
{
  cost: number,    // Bid cost (lower = better)
  eta_ms: number,  // Estimated execution time
}
```

### Events

| Event | Args | Description |
|-------|------|-------------|
| `peer-discovered` | `(peerId, msg)` | New peer found |
| `peer-stale` | `(peerId)` | Peer unresponsive (>8s) |
| `peer-recovered` | `(peerId)` | Stale peer came back |
| `task-proposed` | `(taskId, task, from)` | Task proposal received |
| `bid-received` | `(taskId, msg)` | Bid received for a task |
| `task-assigned` | `(taskId, winner)` | Task assigned to winner |
| `result-received` | `(taskId, msg)` | Execution result received |
| `verify-received` | `(taskId, msg)` | Verification vote received |
| `task-complete` | `(taskId, proof)` | Proof of Coordination finalized |
| `proof-received` | `(taskId, proof)` | Proof received from network |

### Pluggable Functions

```javascript
// Custom execution logic
agent.executeFn = async (task) => {
  // task = { description, input, requirements, deadline_ms, reward }
  return { /* result output */ };
};

// Custom verification logic
agent.verifyFn = async (task, result) => {
  // result = { output, duration_ms, cost_actual }
  return { valid: true, proof: 'Reason for validation' };
};
```

---

## `Reputation` (src/reputation.mjs)

### Constructor

```javascript
new Reputation(agentId?)
```

If `agentId` provided, loads persisted data from `data/reputation.json`.

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `update(success, duration_ms, deadline_ms?)` | `void` | Update score after task execution |
| `getBidScore()` | `number` | Normalized score 0.0-1.0 (applies decay) |
| `canHandleCritical()` | `boolean` | True if score >= 20 |
| `applyDecay()` | `void` | Apply temporal decay (-1/hour) |
| `save()` | `void` | Persist to `data/reputation.json` |
| `load()` | `void` | Load from `data/reputation.json` |
| `toJSON()` | `object` | Serialized reputation with `canHandleCritical` flag |

### Static Methods

| Method | Description |
|--------|-------------|
| `Reputation.loadAll()` | Load all agent reputations from file |
| `Reputation.resetAll()` | Clear persisted reputation data |

### Exported Constants

```javascript
SUCCESS_POINTS = 10
FAILURE_POINTS = -15
QUALITY_BONUS_MAX = 5
DECAY_POINTS_PER_HOUR = 1
MIN_SCORE = 0
MAX_SCORE = 100
INITIAL_SCORE = 50
CRITICAL_THRESHOLD = 20
```

---

## `HiveMemory` (src/hive-memory.mjs)

### Constructor

```javascript
new HiveMemory(agentId)
```

Loads persisted data from `data/hive-memory.json`.

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `attach(mqttClient)` | `void` | Attach to MQTT client, subscribe to hive topic, sync |
| `set(key, value)` | `void` | Set key-value, broadcast via MQTT |
| `get(key)` | `any` | Get value by key (undefined if not found) |
| `getAll()` | `object` | Get all entries `{ key: { value, from, ts } }` |
| `subscribe(callback)` | `void` | Subscribe to changes `(key, value, from)` |
| `publishPattern(taskType, strategy, success)` | `void` | Publish a task execution pattern |
| `getPatterns(taskType)` | `Array` | Get all patterns for a task type |
| `getBestStrategy(taskType)` | `string\|null` | Get most successful strategy for a task type |

### Static Methods

| Method | Description |
|--------|-------------|
| `HiveMemory.reset()` | Clear persisted hive memory data |

---

## `crypto` (src/crypto.mjs)

| Function | Returns | Description |
|----------|---------|-------------|
| `signMessage(payload)` | `object` | Returns payload with `sig` field added |
| `verifyMessage(msg)` | `boolean` | Verify HMAC signature on message |
| `signPayload(payload)` | `string` | Compute HMAC-SHA256 hex string |
| `verifySignature(payload, sig)` | `boolean` | Check signature matches |
| `createReplayDetector()` | `function` | Returns per-agent `isReplay(msg)` function |
| `makeNonce()` | `string` | Generate UUID v4 |
| `hashPayload(payload)` | `string` | Content hash for proof chain |

---

## `proof` (src/proof.mjs)

| Function | Returns | Description |
|----------|---------|-------------|
| `buildProof(taskId, chain)` | `object` | Build final proof with hash linking |
| `appendProofLog(proof)` | `void` | Append proof to JSONL log file |
| `createChainEntry(phase, from, payload)` | `object` | Create a signed chain entry |

---

## Agent Specializations

### `createAlpha(port?)` (agents/alpha.mjs)

Creates Agent Alpha — proposer + text analysis executor.

- **Capabilities:** `nlp`, `analysis`, `proposer`
- **Execute:** Sentiment analysis (positive/negative/mixed/neutral + word/sentence count)
- **Verify:** Checks result has valid structure with output field

### `createBeta(port?)` (agents/beta.mjs)

Creates Agent Beta — computation executor.

- **Capabilities:** `compute`, `math`, `nlp`
- **Execute:** Math evaluation (safe) + text statistics (word count, unique words, avg length)
- **Verify:** Checks output presence and valid `duration_ms`

### `createGamma(port?)` (agents/gamma.mjs)

Creates Agent Gamma — research executor + primary verifier.

- **Capabilities:** `research`, `fetch`, `nlp`, `verify`
- **Execute:** Keyword extraction + text categorization
- **Verify:** Strictest — checks output, duration, and deadline compliance
