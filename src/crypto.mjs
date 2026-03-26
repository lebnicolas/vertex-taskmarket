// Message signing and anti-replay
import { createHmac, randomUUID } from 'crypto';
import { SWARM_SECRET } from './config.mjs';

const seenNonces = new Map();
const NONCE_TTL = 60000;

export function signPayload(payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHmac('sha256', SWARM_SECRET).update(canonical).digest('hex');
}

export function verifySignature(payload, sig) {
  return signPayload(payload) === sig;
}

export function signMessage(payload) {
  return { ...payload, sig: signPayload(payload) };
}

export function verifyMessage(msg) {
  const { sig, ...rest } = msg;
  if (!sig) return false;
  return verifySignature(rest, sig);
}

export function createReplayDetector() {
  const seen = new Map();
  return function isReplay(msg) {
    if (!msg.nonce) return false;
    if (seen.has(msg.nonce)) return true;
    if (msg.ts && Date.now() - new Date(msg.ts).getTime() > 30000) return true;
    seen.set(msg.nonce, Date.now());
    for (const [n, t] of seen) {
      if (Date.now() - t > NONCE_TTL) seen.delete(n);
    }
    return false;
  };
}

export function makeNonce() {
  return randomUUID();
}

export function hashPayload(payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHmac('sha256', 'proof-hash').update(canonical).digest('hex');
}
