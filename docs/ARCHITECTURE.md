# Architecture — TaskMarket

## Overview

TaskMarket is a decentralized AI agent marketplace where autonomous agents negotiate, execute, and verify tasks without a central orchestrator. The system relies on FoxMQ (Vertex BFT consensus) for message ordering and fault tolerance.

## Modules

### `src/agent.mjs` — Agent Base Class

The core of the system. Each agent is an instance of the `Agent` class connected to a FoxMQ node via MQTT 5.0.

**Responsibilities:**
- Connect to FoxMQ and subscribe to all `taskmarket/` topics
- Discover peers via `hello` messages (with HMAC signature)
- Publish heartbeats (`state`) every 2 seconds
- Detect stale peers (>8s without heartbeat)
- Propose tasks (publish on `taskmarket/task/<taskId>`)
- Bid on tasks from other agents
- Resolve winners deterministically (leaderless — same formula on all nodes)
- Execute tasks via pluggable `executeFn`
- Verify results via pluggable `verifyFn` (executor excluded from self-verification)
- Finalize Proof of Coordination when enough verifications arrive
- Verify timeout: finalize with available votes after 10s if a verifier is unresponsive
- Capitalize learnings in Hive Memory after each execution

**Key design decisions:**
- Per-agent replay detector (not shared) to avoid cross-agent nonce conflicts in single-process demos
- Anti-double-finalization guard (`_proofFinalized` set)
- Stale peers excluded from non-executor count to avoid blocking proof finalization

### `src/config.mjs` — Configuration

Central configuration for all constants. No runtime dependencies.

| Constant | Value | Purpose |
|----------|-------|---------|
| `FOXMQ_PORTS` | [1883, 1884, 1885, 1886] | MQTT client ports for 4 FoxMQ nodes |
| `TOPICS` | `taskmarket/*` | MQTT topic namespace |
| `BID_WINDOW_MS` | 5000 | Time to collect bids after proposal |
| `EXECUTION_TIMEOUT_MS` | 30000 | Max task execution time |
| `VERIFY_TIMEOUT_MS` | 10000 | Max wait for verification votes |
| `HEARTBEAT_INTERVAL_MS` | 2000 | Heartbeat frequency |
| `STALE_THRESHOLD_MS` | 8000 | Time before peer marked stale |
| `SWARM_SECRET` | shared key | HMAC signing secret |

### `src/crypto.mjs` — Cryptographic Utilities

Handles message signing, verification, and anti-replay protection.

- **`signMessage(payload)`** — Adds `sig` field (HMAC-SHA256 of canonicalized JSON)
- **`verifyMessage(msg)`** — Verifies `sig` matches recomputed HMAC
- **`createReplayDetector()`** — Returns a per-agent `isReplay(msg)` function with its own nonce cache
- **`hashPayload(payload)`** — Content hash for proof chain entries
- **`makeNonce()`** — UUID v4 generator

**Canonicalization:** Keys are sorted alphabetically before hashing to ensure deterministic signatures regardless of JSON key ordering.

### `src/reputation.mjs` — Reputation System

Tracks agent performance with dynamic scoring.

**Scoring formula:**
- Success: `+10 base + quality_bonus` (bonus = `floor((1 - duration/deadline) * 5)`, max +5)
- Failure: `-15`
- Score clamped to [0, 100]

**Temporal decay:** `-1 point/hour` of inactivity. Applied lazily on `getBidScore()`, `canHandleCritical()`, and `toJSON()`.

**Persistence:** Saved to `data/reputation.json` on every update. Loaded on construction if `agentId` is provided.

**Critical threshold:** Agents with score < 20 are flagged `canHandleCritical: false`.

### `src/proof.mjs` — Proof of Coordination

Produces a hash-chained, multi-signed audit log for each task.

**Chain structure:** Each phase (negotiate, commit, execute, verify) adds an entry with:
- `phase` — which phase
- `from` — which agent
- `hash` — content hash of the phase payload
- `sig` — HMAC of the entry
- `ts` — timestamp

**Final proof** links to the previous proof via `previousHash`, forming a mini-blockchain. Appended to `logs/proof-of-coordination.jsonl`.

### `src/hive-memory.mjs` — Hive Memory

Distributed key-value store shared between all agents via MQTT retain messages.

**Conflict resolution:** Last-write-wins based on timestamp. When two agents set the same key, the newer timestamp wins.

**Pattern learning:** After each task execution, the agent publishes a pattern (`taskType → strategy + success`). Other agents query `getBestStrategy(taskType)` to see which agent has the best track record for a given task type.

**MQTT integration:** Attached to the agent's MQTT client. Subscribes to `taskmarket/hive/memory/+`. On connect, publishes all local entries to sync with the cluster.

## Agent Specializations

| Agent | File | Capabilities | Execute Function |
|-------|------|-------------|-----------------|
| Alpha | `agents/alpha.mjs` | nlp, analysis, proposer | Sentiment analysis (positive/negative/mixed/neutral) |
| Beta | `agents/beta.mjs` | compute, math, nlp | Math evaluation + text statistics (word count, unique words, avg length) |
| Gamma | `agents/gamma.mjs` | research, fetch, nlp, verify | Keyword extraction + text categorization |

Each agent has a custom `verifyFn` for cross-validation:
- **Alpha** checks result structure (has output with valid sentiment)
- **Beta** checks output presence and duration validity
- **Gamma** checks output, duration, and deadline compliance (strictest)

## Data Flow

```
1. Alpha proposes task → publishes on taskmarket/task/<id>
2. Beta & Gamma receive → check capabilities match requirements
3. Beta bids (cost=5, eta=8s) → publishes on taskmarket/bid/<id>
4. Gamma bids (cost=3, eta=12s) → publishes on taskmarket/bid/<id>
5. Alpha collects bids (5s window) → resolves winner deterministically
6. Alpha publishes assignment → taskmarket/assign/<id>
7. Winner (Gamma) executes → publishes result on taskmarket/result/<id>
8. Alpha & Beta verify → publish votes on taskmarket/verify/<id>
9. When 2/2 non-executor votes arrive → Proof of Coordination finalized
10. Proof published → taskmarket/proof/<id> + appended to JSONL log
11. Winner publishes learning → taskmarket/hive/memory/pattern:<type>
```
