#!/bin/bash
# TaskMarket Demo — Start FoxMQ cluster + run scenario
set -e
cd "$(dirname "$0")/.."

echo "=== Starting FoxMQ cluster (4 nodes, BFT f=1) ==="

# Kill existing nodes
pkill -f "foxmq run" 2>/dev/null || true
sleep 1

# Start 4 FoxMQ nodes
mkdir -p logs
./foxmq run --secret-key-file=foxmq.d/key_0.pem --mqtt-addr=0.0.0.0:1883 --cluster-addr=0.0.0.0:19793 >logs/node0.log 2>&1 &
./foxmq run --secret-key-file=foxmq.d/key_1.pem --mqtt-addr=0.0.0.0:1884 --cluster-addr=0.0.0.0:19794 >logs/node1.log 2>&1 &
./foxmq run --secret-key-file=foxmq.d/key_2.pem --mqtt-addr=0.0.0.0:1885 --cluster-addr=0.0.0.0:19795 >logs/node2.log 2>&1 &
./foxmq run --secret-key-file=foxmq.d/key_3.pem --mqtt-addr=0.0.0.0:1886 --cluster-addr=0.0.0.0:19796 >logs/node3.log 2>&1 &

echo "Waiting for cluster to form..."
sleep 3

NODES=$(pgrep -f "foxmq run" | wc -l)
echo "$NODES FoxMQ nodes running"

if [ "$NODES" -lt 4 ]; then
  echo "ERROR: Expected 4 nodes, got $NODES"
  exit 1
fi

echo ""
echo "=== Running TaskMarket scenario ==="
echo ""
node demo/scenario.mjs

echo ""
echo "=== Stopping FoxMQ cluster ==="
pkill -f "foxmq run" 2>/dev/null || true
echo "Done."
