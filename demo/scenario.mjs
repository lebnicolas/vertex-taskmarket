#!/usr/bin/env node
// TaskMarket — Full coordination demo
// negotiate → commit → execute → verify → Proof of Coordination

import { createAlpha } from '../agents/alpha.mjs';
import { createBeta } from '../agents/beta.mjs';
import { createGamma } from '../agents/gamma.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('='.repeat(70));
  console.log('  TASKMARKET — Decentralized AI Agent Marketplace on FoxMQ/Vertex');
  console.log('  3 Agents | 4 FoxMQ Nodes (BFT f=1) | Full Coordination Loop');
  console.log('='.repeat(70));
  console.log();

  // ===== STEP 1: Create and connect agents =====
  console.log('--- PHASE 0: Agent Discovery ---');
  const alpha = createAlpha(1883);
  const beta = createBeta(1884);
  const gamma = createGamma(1885);

  await Promise.all([alpha.connect(), beta.connect(), gamma.connect()]);
  await sleep(3000); // Let discovery settle

  console.log();
  console.log(`Alpha peers: ${alpha.getPeers().map(p => p.id).join(', ')}`);
  console.log(`Beta peers:  ${beta.getPeers().map(p => p.id).join(', ')}`);
  console.log(`Gamma peers: ${gamma.getPeers().map(p => p.id).join(', ')}`);
  console.log();

  // ===== STEP 2: Set up bid handlers =====
  // Beta and Gamma auto-bid on tasks they can handle
  beta.on('task-proposed', (taskId, task, from) => {
    const canHandle = task.requirements.every(r => beta.capabilities.includes(r));
    if (canHandle) {
      beta.bid(taskId, { cost: 5, eta_ms: 8000 });
    }
  });

  gamma.on('task-proposed', (taskId, task, from) => {
    const canHandle = task.requirements.every(r => gamma.capabilities.includes(r));
    if (canHandle) {
      gamma.bid(taskId, { cost: 3, eta_ms: 12000 });
    }
  });

  // Track proofs
  const proofs = [];
  for (const agent of [alpha, beta, gamma]) {
    agent.on('proof-received', (taskId, proof) => {
      if (!proofs.find(p => p.taskId === taskId)) {
        proofs.push(proof);
      }
    });
  }

  // ===== STEP 3: Task 1 — Sentiment Analysis =====
  console.log('--- PHASE 1: NEGOTIATE — Alpha proposes Task 1 (Sentiment Analysis) ---');
  const taskId1 = await alpha.propose({
    description: 'Analyze sentiment of product review',
    input: 'The product is excellent and well-built, but the customer service was terribly slow and unhelpful.',
    requirements: ['nlp'],
    deadline_ms: 15000,
    reward: 10,
  });
  console.log();

  // Wait for execution + verification
  console.log('--- PHASE 2-4: COMMIT → EXECUTE → VERIFY ---');
  await sleep(8000);
  console.log();

  // ===== STEP 4: Task 2 — Text Statistics =====
  console.log('--- TASK 2: Alpha proposes Text Statistics ---');
  const taskId2 = await alpha.propose({
    description: 'Compute text statistics',
    input: 'FoxMQ is a decentralized message queue powered by the Tashi Consensus Engine. It provides Byzantine fault tolerance with sub-100ms finality.',
    requirements: ['compute'],
    deadline_ms: 15000,
    reward: 8,
  });
  console.log();
  await sleep(8000);
  console.log();

  // ===== STEP 5: Task 3 — Keyword Extraction =====
  console.log('--- TASK 3: Alpha proposes Keyword Extraction ---');
  const taskId3 = await alpha.propose({
    description: 'Extract keywords and categorize text',
    input: 'The software API has a critical bug affecting price calculations. Users are angry about the service quality degradation.',
    requirements: ['research'],
    deadline_ms: 15000,
    reward: 12,
  });
  console.log();
  await sleep(8000);
  console.log();

  // ===== HIVE MEMORY =====
  console.log('--- HIVE MEMORY — Shared Knowledge ---');
  await sleep(1000);
  for (const agent of [alpha, beta, gamma]) {
    const patterns = agent.hive.getAll();
    const patternKeys = Object.keys(patterns).filter(k => k.startsWith('pattern:'));
    if (patternKeys.length > 0) {
      for (const key of patternKeys) {
        const taskType = key.replace('pattern:', '');
        const best = agent.hive.getBestStrategy(taskType);
        console.log(`  [${agent.name}] ${taskType}: best strategy = ${best || 'none'} (${(patterns[key].value || []).length} entries)`);
      }
    }
  }
  console.log();

  // ===== SUMMARY =====
  console.log('='.repeat(70));
  console.log('  DEMO COMPLETE — Summary');
  console.log('='.repeat(70));
  console.log();
  console.log(`Tasks proposed:  3`);
  console.log(`Proofs received: ${proofs.length}`);
  for (const p of proofs) {
    console.log(`  ${p.taskId}: ${p.status} (${p.consensus})`);
  }
  console.log();
  console.log('Agent reputations:');
  console.log(`  Alpha: ${JSON.stringify(alpha.reputation.toJSON())}`);
  console.log(`  Beta:  ${JSON.stringify(beta.reputation.toJSON())}`);
  console.log(`  Gamma: ${JSON.stringify(gamma.reputation.toJSON())}`);
  console.log();
  console.log('Hive Memory entries:');
  const allHive = alpha.hive.getAll();
  for (const [key, entry] of Object.entries(allHive)) {
    if (key.startsWith('pattern:')) {
      const count = Array.isArray(entry.value) ? entry.value.length : 1;
      console.log(`  ${key}: ${count} patterns`);
    }
  }
  console.log();
  console.log('Proof of Coordination log: logs/proof-of-coordination.jsonl');
  console.log('='.repeat(70));

  // Cleanup
  alpha.disconnect();
  beta.disconnect();
  gamma.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
