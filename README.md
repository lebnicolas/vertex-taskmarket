# TaskMarket — Decentralized AI Agent Marketplace

> Vertex Swarm Challenge 2026 · Track 3: Agent Economy

A network of autonomous AI agents that **negotiate**, **assign**, **execute**, and **verify** tasks — without a central orchestrator. Built on **FoxMQ** (decentralized MQTT 5.0 broker powered by Vertex BFT consensus).

## Architecture

```
                         ┌──────────────────────────────────────┐
                         │     FoxMQ Cluster (Vertex BFT)       │
                         │  4 nodes · 3N+1 · tolerates 1 fault  │
                         │                                      │
                         │  node0:1883  node1:1884               │
                         │  node2:1885  node3:1886               │
                         │     (cluster: 19793-19796 UDP)        │
                         └──────────┬───────────────────────────┘
                                    │ MQTT 5.0 (QoS 2)
               ┌────────────────────┼────────────────────┐
               │                    │                    │
        ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐
        │ Agent Alpha  │     │ Agent Beta   │     │ Agent Gamma  │
        │ (proposer)   │     │ (compute)    │     │ (research)   │
        │              │     │              │     │              │
        │ ┌──────────┐ │     │ ┌──────────┐ │     │ ┌──────────┐ │
        │ │Reputation│ │     │ │Reputation│ │     │ │Reputation│ │
        │ │Hive Mem  │ │     │ │Hive Mem  │ │     │ │Hive Mem  │ │
        │ │Crypto    │ │     │ │Crypto    │ │     │ │Crypto    │ │
        │ └──────────┘ │     │ └──────────┘ │     │ └──────────┘ │
        └──────────────┘     └──────────────┘     └──────────────┘

        Coordination Loop (per task):

        DISCOVER ──► NEGOTIATE ──► COMMIT ──► EXECUTE ──► VERIFY ──► PROOF
        (hello)      (propose)     (bid+      (winner     (cross-    (multi-signed
                                   resolve)    runs task)  validate)  hash chain)
```

Each agent connects to a **different** FoxMQ node. Vertex BFT consensus ensures all agents see messages in the **same order** — enabling leaderless deterministic agreement.

## Features

| Feature | Description |
|---------|-------------|
| **Leaderless Agreement** | All agents compute the same winner deterministically — no leader, no SPOF |
| **5-Phase Coordination** | discover → negotiate → commit → execute → verify |
| **Proof of Coordination** | Hash-chained, multi-signed audit log of every task lifecycle |
| **HMAC-SHA256 Security** | Every message signed; unsigned messages rejected; nonce anti-replay |
| **Dynamic Reputation** | +10 success (+ quality bonus), -15 failure, temporal decay, persistence |
| **Hive Memory** | Distributed key-value store — agents share learned patterns via MQTT |
| **BFT Fault Tolerance** | 4 FoxMQ nodes (3N+1), tolerates 1 node failure |
| **Verify Timeout** | If a verifier dies, proof finalizes with available votes after 10s |
| **Stale Detection** | Agents detect unresponsive peers in 8s, auto-recover on reconnect |
| **47 Unit Tests** | 27 reputation + 20 hive memory, all passing |

## Demo

### Prerequisites

- **Node.js** 18+ with npm
- **FoxMQ** v0.3.1 binary (included or download from [tashigit/foxmq](https://github.com/tashigit/foxmq/releases))
- Linux x86_64

### Quick Start (one command)

```bash
npm install
bash demo/full-demo.sh
```

This starts 4 FoxMQ nodes, runs 47 unit tests, executes the 3-task scenario, and prints a full summary.

### Step by Step

```bash
# 1. Install dependencies
npm install

# 2. Download FoxMQ (if not present)
wget https://github.com/tashigit/foxmq/releases/download/v0.3.1/foxmq_0.3.1_linux-amd64.zip
unzip foxmq_0.3.1_linux-amd64.zip && chmod +x foxmq

# 3. Generate cluster config (already done — foxmq.d/ exists)
./foxmq address-book from-range 127.0.0.1 19793 19796
./foxmq user add warmup warmup123

# 4. Start FoxMQ cluster (4 nodes)
./foxmq run --secret-key-file=foxmq.d/key_0.pem --mqtt-addr=0.0.0.0:1883 --cluster-addr=0.0.0.0:19793 &
./foxmq run --secret-key-file=foxmq.d/key_1.pem --mqtt-addr=0.0.0.0:1884 --cluster-addr=0.0.0.0:19794 &
./foxmq run --secret-key-file=foxmq.d/key_2.pem --mqtt-addr=0.0.0.0:1885 --cluster-addr=0.0.0.0:19795 &
./foxmq run --secret-key-file=foxmq.d/key_3.pem --mqtt-addr=0.0.0.0:1886 --cluster-addr=0.0.0.0:19796 &

# 5. Run the demo scenario
node demo/scenario.mjs

# 6. Run the warm-up (P2P handshake)
node warmup/stateful-handshake.mjs
```

### What the Demo Shows

1. **Discovery** — 3 agents find each other via FoxMQ P2P
2. **Task 1** (Sentiment Analysis) — 2 bids, deterministic winner selection, execution, 2/2 verification, Proof of Coordination
3. **Task 2** (Text Statistics) — 1 bid, execution, verification, proof
4. **Task 3** (Keyword Extraction) — 1 bid, execution, verification, proof
5. **Hive Memory** — agents share learned patterns (which strategy works for which task type)
6. **Reputation** — scores update dynamically (Alpha=50 idle, Beta=65, Gamma=80)

## Testing

```bash
# Run all tests (47 total)
node test/reputation.test.mjs   # 27 tests — scoring, decay, persistence, thresholds
node test/hive-memory.test.mjs  # 20 tests — set/get, patterns, conflict resolution, persistence

# Or via full-demo.sh which runs both
bash demo/full-demo.sh
```

| Test Suite | Tests | Coverage |
|------------|-------|----------|
| `reputation.test.mjs` | 27 | Scoring, quality bonus, failure penalty, clamping, bid score, critical threshold, temporal decay, persistence, toJSON |
| `hive-memory.test.mjs` | 20 | Set/get, getAll, last-write-wins, subscribe, patterns, best strategy, cap at 10, persistence, complex values |

## Security

### Message Integrity (HMAC-SHA256)

Every MQTT message includes a `sig` field — HMAC-SHA256 of the canonicalized JSON payload with a shared secret. Messages without a valid signature are **silently dropped**.

```javascript
// Signing: canonical JSON → HMAC-SHA256
const canonical = JSON.stringify(payload, Object.keys(payload).sort());
const sig = createHmac('sha256', SWARM_SECRET).update(canonical).digest('hex');
```

### Anti-Replay Protection

Each message includes a `nonce` (UUID) and `ts` (timestamp). Agents maintain a per-agent nonce cache (60s TTL). Rejected if:
- Nonce already seen (duplicate)
- Timestamp > 30s in the past (stale)

### Proof of Coordination (Hash Chain)

Each completed task produces a Proof of Coordination — a hash-chained record of all phases:

```
negotiate → commit → execute → verify → PROOF
   hash₁  →  hash₂  → hash₃  → hash₄  → final hash (links to previous proof)
```

Each phase entry includes the signer's HMAC. The final proof contains all verification signatures from non-executor agents. Stored in `logs/proof-of-coordination.jsonl` (append-only).

## MQTT Topics

| Topic | QoS | Retain | Purpose |
|-------|-----|--------|---------|
| `taskmarket/hello/<agentId>` | 1 | Yes | Agent discovery + capabilities |
| `taskmarket/state/<agentId>` | 1 | Yes | Heartbeat + reputation score |
| `taskmarket/task/<taskId>` | 2 | No | Task proposals |
| `taskmarket/bid/<taskId>` | 2 | No | Agent bids (cost, ETA, reputation) |
| `taskmarket/assign/<taskId>` | 2 | No | Winner assignment (leaderless) |
| `taskmarket/result/<taskId>` | 2 | No | Execution results |
| `taskmarket/verify/<taskId>` | 2 | No | Verification votes |
| `taskmarket/proof/<taskId>` | 2 | No | Proof of Coordination |
| `taskmarket/hive/memory/<key>` | 1 | Yes | Shared agent knowledge |

## Project Structure

```
├── src/
│   ├── agent.mjs           # Base agent class — full coordination lifecycle
│   ├── config.mjs           # Ports, topics, timeouts, shared secret
│   ├── crypto.mjs           # HMAC-SHA256 signing, per-agent anti-replay
│   ├── reputation.mjs       # Dynamic scoring, decay, persistence, thresholds
│   ├── proof.mjs            # Proof of Coordination (hash-chained audit log)
│   └── hive-memory.mjs      # Distributed key-value store via MQTT
├── agents/
│   ├── alpha.mjs            # Agent Alpha — proposer, sentiment analysis
│   ├── beta.mjs             # Agent Beta — computation, text statistics
│   └── gamma.mjs            # Agent Gamma — research, keyword extraction
├── demo/
│   ├── full-demo.sh         # Complete demo: tests + cluster + scenario
│   ├── run-demo.sh          # Start cluster + run scenario
│   └── scenario.mjs         # Automated 3-task demonstration
├── warmup/
│   └── stateful-handshake.mjs  # Warm-up: P2P handshake + state replication
├── test/
│   ├── reputation.test.mjs  # 27 unit tests
│   └── hive-memory.test.mjs # 20 unit tests
├── docs/
│   ├── ARCHITECTURE.md      # Detailed module descriptions
│   └── API.md               # Public API reference
└── foxmq.d/
    └── address-book.toml    # FoxMQ cluster config (4 nodes)
```

## Reputation System

| Parameter | Value |
|-----------|-------|
| Initial score | 50 |
| Success | +10 base + up to +5 quality bonus (proportional to speed) |
| Failure | -15 |
| Decay | -1 point/hour of inactivity |
| Critical threshold | 20 (blocked from critical tasks below this) |
| Score range | 0 — 100 |
| Bid score | Normalized 0.0 — 1.0 (used in winner selection formula) |
| Persistence | `data/reputation.json` |

## Hive Memory

Distributed key-value store via MQTT. Agents share task execution patterns:
- When an agent executes a task, it publishes the pattern (task type + winning strategy)
- Other agents consult patterns before bidding to adapt their strategy
- Conflict resolution: last-write-wins (timestamp)
- Pattern history: capped at 10 entries per task type
- Persistence: `data/hive-memory.json`

## Inspired By

Built by adapting [claudeMQTT](https://github.com/lebnicolas/claudeMQTT) — a production system for orchestrating distributed Claude Code agents via MQTT. TaskMarket replaces the central broker with FoxMQ P2P and implements leaderless agreement for task allocation.

## License

MIT
