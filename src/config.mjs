// Configuration — TaskMarket on FoxMQ
export const MQTT_USERNAME = 'warmup';
export const MQTT_PASSWORD = 'warmup123';
export const MQTT_PROTOCOL_VERSION = 5;

// FoxMQ node ports (MQTT client ports, not cluster ports)
export const FOXMQ_PORTS = [1883, 1884, 1885, 1886];

// Topics
export const TOPICS = {
  HELLO:    'taskmarket/hello',    // + /<agentId> — retain, QoS 1
  STATE:    'taskmarket/state',    // + /<agentId> — retain, QoS 1
  TASK:     'taskmarket/task',     // + /<taskId>  — QoS 2
  BID:      'taskmarket/bid',      // + /<taskId>  — QoS 2
  ASSIGN:   'taskmarket/assign',   // + /<taskId>  — QoS 2
  RESULT:   'taskmarket/result',   // + /<taskId>  — QoS 2
  VERIFY:   'taskmarket/verify',   // + /<taskId>  — QoS 2
  PROOF:    'taskmarket/proof',    // + /<taskId>  — QoS 2
};

// Timeouts
export const BID_WINDOW_MS = 5000;       // Wait for bids after proposing
export const EXECUTION_TIMEOUT_MS = 30000; // Max execution time
export const VERIFY_TIMEOUT_MS = 10000;   // Wait for verification votes
export const HEARTBEAT_INTERVAL_MS = 2000;
export const STALE_THRESHOLD_MS = 8000;

// Shared secret for HMAC signatures
export const SWARM_SECRET = 'vertex-taskmarket-secret-2026';
