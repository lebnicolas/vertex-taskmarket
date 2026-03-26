#!/bin/bash
# TaskMarket — Full Demo: tests + cluster + scenario + summary
set -e
cd "$(dirname "$0")/.."

echo "======================================================================"
echo "  TASKMARKET — Full Demo"
echo "  Vertex Swarm Challenge 2026 · Track 3: Agent Economy"
echo "======================================================================"
echo ""

# ===== PHASE 1: Unit Tests =====
echo "=== PHASE 1: Unit Tests (47 total) ==="
echo ""

echo "--- Reputation Tests (27) ---"
node test/reputation.test.mjs
echo ""

echo "--- Hive Memory Tests (20) ---"
node test/hive-memory.test.mjs
echo ""

# ===== PHASE 2: Start FoxMQ Cluster =====
echo "=== PHASE 2: Starting FoxMQ Cluster (4 nodes, BFT f=1) ==="

# Kill existing nodes
pkill -f "foxmq run" 2>/dev/null || true
sleep 1

# Clean state
rm -f data/reputation.json data/hive-memory.json logs/proof-of-coordination.jsonl
mkdir -p logs data

# Start 4 FoxMQ nodes
./foxmq run --secret-key-file=foxmq.d/key_0.pem --mqtt-addr=0.0.0.0:1883 --cluster-addr=0.0.0.0:19793 >logs/node0.log 2>&1 &
./foxmq run --secret-key-file=foxmq.d/key_1.pem --mqtt-addr=0.0.0.0:1884 --cluster-addr=0.0.0.0:19794 >logs/node1.log 2>&1 &
./foxmq run --secret-key-file=foxmq.d/key_2.pem --mqtt-addr=0.0.0.0:1885 --cluster-addr=0.0.0.0:19795 >logs/node2.log 2>&1 &
./foxmq run --secret-key-file=foxmq.d/key_3.pem --mqtt-addr=0.0.0.0:1886 --cluster-addr=0.0.0.0:19796 >logs/node3.log 2>&1 &

echo "Waiting for cluster to form..."
sleep 3

NODES=$(ps aux | grep "foxmq run" | grep -v grep | wc -l)
echo "$NODES FoxMQ nodes running"

if [ "$NODES" -lt 4 ]; then
  echo "ERROR: Expected 4 nodes, got $NODES"
  exit 1
fi
echo ""

# ===== PHASE 3: Demo Scenario =====
echo "=== PHASE 3: TaskMarket Demo Scenario (3 tasks) ==="
echo ""
node demo/scenario.mjs
echo ""

# ===== PHASE 4: Summary =====
echo "=== PHASE 4: Artifacts ==="
echo ""

if [ -f "data/reputation.json" ]; then
  echo "Reputation data (data/reputation.json):"
  cat data/reputation.json
  echo ""
fi

if [ -f "data/hive-memory.json" ]; then
  HIVE_KEYS=$(python3 -c "import json; d=json.load(open('data/hive-memory.json')); print(len(d))" 2>/dev/null || echo "?")
  echo "Hive Memory: $HIVE_KEYS entries (data/hive-memory.json)"
fi

if [ -f "logs/proof-of-coordination.jsonl" ]; then
  PROOFS=$(wc -l < logs/proof-of-coordination.jsonl)
  echo "Proof of Coordination log: $PROOFS entries (logs/proof-of-coordination.jsonl)"
fi

echo ""

# ===== Cleanup =====
echo "=== Stopping FoxMQ cluster ==="
pkill -f "foxmq run" 2>/dev/null || true
echo "Done."
echo ""
echo "======================================================================"
echo "  FULL DEMO COMPLETE"
echo "======================================================================"
