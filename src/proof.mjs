// Proof of Coordination — hash-chained audit log
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { hashPayload, signPayload } from './crypto.mjs';

const LOG_PATH = new URL('../logs/proof-of-coordination.jsonl', import.meta.url).pathname;

let lastHash = '0000000000000000000000000000000000000000000000000000000000000000';

export function buildProof(taskId, chain) {
  const proof = {
    taskId,
    type: 'proof-of-coordination',
    ts: new Date().toISOString(),
    chain,
    previousHash: lastHash,
  };
  proof.hash = hashPayload(proof);
  lastHash = proof.hash;
  return proof;
}

export function appendProofLog(proof) {
  try {
    appendFileSync(LOG_PATH, JSON.stringify(proof) + '\n');
  } catch (e) {
    console.error('[proof] Failed to write log:', e.message);
  }
}

export function createChainEntry(phase, from, payload, agentId) {
  return {
    phase,
    from,
    hash: hashPayload(payload),
    sig: signPayload({ phase, from, hash: hashPayload(payload) }),
    ts: new Date().toISOString(),
  };
}
