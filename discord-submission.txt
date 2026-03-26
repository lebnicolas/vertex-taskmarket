# Vertex Swarm Challenge 2026 — Warm-Up: "The Stateful Handshake"
**Team:** Solo (Nicolas)
**Track:** 3 — Agent Economy
**Machine:** nle-test-02 (47 GB RAM, 8 cores, Debian)
**Stack:** FoxMQ v0.3.1 (4 nodes, BFT f=1) + Node.js + mqtt.js (MQTT 5.0)

---

## Acceptance Criteria — All 5 Passed

### 1. Spin Up — 2 agents connected to separate FoxMQ nodes
- Agent-A → FoxMQ node 0 (port 1883)
- Agent-B → FoxMQ node 1 (port 1884)
- 4 FoxMQ nodes total (ports 1883-1886, cluster 19793-19796) for BFT f=1 tolerance

### 2. Discover & Handshake — Signed hello payload
- HMAC-SHA256 signature on every hello message (shared secret)
- Bidirectional verification: both agents verify each other's signature
- Anti-replay: UUID nonce per hello

### 3. Pulse Check — Bidirectional heartbeats
- Heartbeats every 2 seconds
- 12 seconds of continuous heartbeat exchange demonstrated

### 4. Sync State — JSON state with exact spec fields
- Replicated fields: `peer_id`, `last_seen_ms`, `role` (scout/carrier), `status` (ready/busy)
- All state messages signed (HMAC-SHA256) and verified before acceptance

### 5. Trigger Action — Role toggle replicated < 1 second
- carrier → scout: **38ms** replication latency
- scout → carrier: **44ms** replication latency
- Both well under the 1-second requirement

### 6. Failure Injection — Kill + stale detection + automatic recovery
- Agent-B disconnected for 12 seconds
- Agent-A detected peer as **STALE after 6 seconds**
- Agent-B reconnected → Agent-A detected **RECOVERY** instantly
- Handshake re-verified on reconnection

---

## Terminal Log (full run)

```
======================================================================
  VERTEX SWARM CHALLENGE — Warm-Up: "The Stateful Handshake"
  4 FoxMQ nodes (BFT f=1) | 2 Agents (A + B) | MQTT 5.0
======================================================================

[2026-03-26T14:16:18.332Z] --- STEP 1: Spin up & connect ---
[2026-03-26T14:16:18.449Z] [agent-A] ✅ Connected to FoxMQ node on port 1883
[2026-03-26T14:16:18.454Z] [agent-A] 📡 Published signed hello (nonce: c6735ea8...)
[2026-03-26T14:16:18.460Z] [agent-B] ✅ Connected to FoxMQ node on port 1884
[2026-03-26T14:16:18.460Z] [agent-B] 📡 Published signed hello (nonce: c048d24f...)

[2026-03-26T14:16:18.461Z] --- STEPS 2-4: Handshake + Heartbeats + State Sync (running 12s) ---
[2026-03-26T14:16:18.529Z] [agent-B] 🤝 Handshake verified from agent-A
[2026-03-26T14:16:18.532Z] [agent-A] 🤝 Handshake verified from agent-B

[2026-03-26T14:16:30.462Z] --- STEP 5: Role Toggle (carrier → scout) ---
[2026-03-26T14:16:30.462Z] [agent-A] 🔀 Toggling role: carrier → scout
[2026-03-26T14:16:30.500Z] [agent-B] 🔄 ROLE CHANGE detected: agent-A carrier → scout (replicated in 38ms)

[2026-03-26T14:16:33.463Z] --- STEP 5b: Role Toggle back (scout → carrier) ---
[2026-03-26T14:16:33.463Z] [agent-A] 🔀 Toggling role: scout → carrier
[2026-03-26T14:16:33.507Z] [agent-B] 🔄 ROLE CHANGE detected: agent-A scout → carrier (replicated in 44ms)

[2026-03-26T14:16:36.464Z] --- STEP 6: Failure Injection — Disconnecting agent-B for 12s ---
[2026-03-26T14:16:36.467Z] [agent-B] ❌ DISCONNECTED (simulating node failure)
[2026-03-26T14:16:42.466Z] [agent-A] ⚠️  STALE: agent-B last seen 8.0s ago

[2026-03-26T14:16:48.468Z] --- STEP 7: Recovery — Reconnecting agent-B ---
[2026-03-26T14:16:48.508Z] [agent-B] ✅ Connected to FoxMQ node on port 1884
[2026-03-26T14:16:48.509Z] [agent-B] 📡 Published signed hello (nonce: 1a96b0a6...)
[2026-03-26T14:16:48.513Z] [agent-B] 🤝 Handshake verified from agent-A
[2026-03-26T14:16:48.552Z] [agent-A] 🟢 RECOVERY: agent-B is back!
[2026-03-26T14:16:48.552Z] [agent-A] 🤝 Handshake verified from agent-B

======================================================================
  WARM-UP COMPLETE
  Agent A peers: [{"id":"agent-B","role":"carrier","status":"ready","stale":false}]
  Agent B peers: [{"id":"agent-A","role":"carrier","status":"ready","stale":false}]
======================================================================
```

---

## Key Metrics Summary

| Criteria | Result | Metric |
|----------|--------|--------|
| Signed Handshake | PASS | HMAC-SHA256 bilateral verification |
| Heartbeats | PASS | 2s interval, 12s sustained |
| State Replication | PASS | 4 fields: peer_id, last_seen_ms, role, status |
| Role Toggle < 1s | PASS | 38ms / 44ms |
| Failure Injection | PASS | Stale @ 6s, auto-recovery on reconnect |
