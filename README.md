# TaskMarket — Decentralized AI Agent Marketplace

> Vertex Swarm Challenge 2026 · Track 3: Agent Economy

A network of autonomous AI agents that **negotiate**, **assign**, **execute**, and **verify** tasks — without a central orchestrator. Built on **FoxMQ** (decentralized MQTT 5.0 broker powered by Vertex BFT consensus).

## Architecture

```
┌─────────────┐    FoxMQ P2P     ┌─────────────┐
│  Agent Alpha │◄── consensus ──►│  Agent Beta  │
│  (proposer)  │   (Vertex BFT)  │  (compute)   │
└──────┬───────┘                 └──────┬───────┘
       │        ┌─────────────┐         │
       └───────►│ Agent Gamma  │◄───────┘
                │ (research)   │
                └─────────────┘
```

**Key features:**
- **Leaderless agreement** — all agents compute the same winner deterministically (Vertex fair ordering)
- **Proof of Coordination** — hash-chained, multi-signed audit log of every task lifecycle
- **HMAC-SHA256 message integrity** + nonce-based anti-replay
- **Dynamic reputation** — scoring with quality bonus, temporal decay, persistence
- **Hive Memory** — distributed shared knowledge store for agent learning
- **BFT fault tolerance** — 4 FoxMQ nodes, tolerates 1 node failure

## Coordination Loop

```
DISCOVER → NEGOTIATE → COMMIT → EXECUTE → VERIFY → PROOF
   │           │          │         │         │        │
 agents      propose    bids     winner    result   multi-signed
 find each   a task    from all  selected  produced  proof of
 other       on MQTT   agents   (leaderless) + published coordination
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start FoxMQ cluster (4 nodes)
bash demo/run-demo.sh

# Or manually:
./foxmq run --secret-key-file=foxmq.d/key_0.pem --mqtt-addr=0.0.0.0:1883 --cluster-addr=0.0.0.0:19793 &
./foxmq run --secret-key-file=foxmq.d/key_1.pem --mqtt-addr=0.0.0.0:1884 --cluster-addr=0.0.0.0:19794 &
./foxmq run --secret-key-file=foxmq.d/key_2.pem --mqtt-addr=0.0.0.0:1885 --cluster-addr=0.0.0.0:19795 &
./foxmq run --secret-key-file=foxmq.d/key_3.pem --mqtt-addr=0.0.0.0:1886 --cluster-addr=0.0.0.0:19796 &

# 3. Run the demo scenario
node demo/scenario.mjs

# 4. Run tests
node test/reputation.test.mjs
node test/hive-memory.test.mjs
```

## Project Structure

```
├── src/
│   ├── agent.mjs          # Base agent class (connect, propose, bid, execute, verify)
│   ├── config.mjs          # Ports, topics, timeouts, shared secret
│   ├── crypto.mjs          # HMAC-SHA256 signing, anti-replay, payload hashing
│   ├── reputation.mjs      # Dynamic scoring, decay, persistence, thresholds
│   ├── proof.mjs           # Proof of Coordination (hash-chained audit log)
│   └── hive-memory.mjs     # Distributed key-value store (shared agent learning)
├── agents/
│   ├── alpha.mjs           # Agent Alpha — proposer, text analysis
│   ├── beta.mjs            # Agent Beta — computation, text stats
│   └── gamma.mjs           # Agent Gamma — research, keyword extraction
├── demo/
│   ├── run-demo.sh         # Start cluster + run scenario
│   └── scenario.mjs        # Automated 3-task demonstration
├── warmup/
│   └── stateful-handshake.mjs  # Warm-up: P2P handshake + state replication
├── test/
│   ├── reputation.test.mjs # 27 unit tests for reputation system
│   └── hive-memory.test.mjs # 20 unit tests for hive memory
└── foxmq.d/
    └── address-book.toml   # FoxMQ cluster configuration (4 nodes)
```

## MQTT Topics

| Topic | QoS | Purpose |
|-------|-----|---------|
| `taskmarket/hello/<agentId>` | 1 | Agent discovery (retain) |
| `taskmarket/state/<agentId>` | 1 | Heartbeat + reputation (retain) |
| `taskmarket/task/<taskId>` | 2 | Task proposals |
| `taskmarket/bid/<taskId>` | 2 | Agent bids |
| `taskmarket/assign/<taskId>` | 2 | Winner assignment |
| `taskmarket/result/<taskId>` | 2 | Execution results |
| `taskmarket/verify/<taskId>` | 2 | Verification votes |
| `taskmarket/proof/<taskId>` | 2 | Proof of Coordination |
| `taskmarket/hive/memory/<key>` | 1 | Shared agent knowledge (retain) |

## Security

- **Message integrity**: HMAC-SHA256 signature on every message
- **Anti-replay**: UUID nonce + 30s timestamp window
- **Unsigned messages rejected**: no signature = dropped
- **Multi-signed Proof of Coordination**: each phase hashed and signed

## Reputation System

| Parameter | Value |
|-----------|-------|
| Initial score | 50 |
| Success | +10 base + up to +5 quality bonus |
| Failure | -15 |
| Decay | -1 point/hour of inactivity |
| Critical threshold | 20 (blocked from critical tasks) |
| Score range | 0 — 100 |
| Persistence | `data/reputation.json` |

## Hive Memory

Distributed key-value store via MQTT. Agents share task execution patterns:
- When an agent succeeds, it publishes the pattern (task type + strategy)
- Other agents consult patterns before bidding
- Conflict resolution: last-write-wins (timestamp)
- Persistence: `data/hive-memory.json`

## Inspired By

Built by adapting [claudeMQTT](https://github.com/lebnicolas/claudeMQTT) — a production system for orchestrating distributed Claude Code agents via MQTT. TaskMarket replaces the central broker with FoxMQ P2P and implements leaderless agreement for task allocation.

## License

MIT
