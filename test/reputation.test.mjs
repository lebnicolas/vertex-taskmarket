#!/usr/bin/env node
// Unit tests — Advanced Reputation System
import { Reputation, SUCCESS_POINTS, FAILURE_POINTS, QUALITY_BONUS_MAX,
         DECAY_POINTS_PER_HOUR, INITIAL_SCORE, CRITICAL_THRESHOLD, MAX_SCORE, MIN_SCORE
} from '../src/reputation.mjs';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

function assertClose(actual, expected, tolerance, name) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${name} (got ${actual}, expected ~${expected})`);
}

// Clean state before tests
Reputation.resetAll();

console.log('=== Test 1: Initial state ===');
{
  const r = new Reputation('test-init');
  assert(r.score === INITIAL_SCORE, `Initial score = ${INITIAL_SCORE}`);
  assert(r.tasks_completed === 0, 'No tasks completed');
  assert(r.tasks_failed === 0, 'No tasks failed');
  assert(r.canHandleCritical(), 'Can handle critical (score >= threshold)');
}

console.log('\n=== Test 2: Success scoring (+10 base + quality bonus) ===');
{
  Reputation.resetAll();
  const r = new Reputation('test-success');
  // Fast execution (1ms out of 10000ms deadline) → max quality bonus
  r.update(true, 1, 10000);
  assert(r.score === INITIAL_SCORE + SUCCESS_POINTS + QUALITY_BONUS_MAX,
    `Score after fast success = ${INITIAL_SCORE + SUCCESS_POINTS + QUALITY_BONUS_MAX}`);
  assert(r.tasks_completed === 1, 'tasks_completed = 1');

  // Slow execution (9500ms out of 10000ms deadline) → minimal bonus
  r.update(true, 9500, 10000);
  const expectedBonus = Math.round((1 - 9500/10000) * QUALITY_BONUS_MAX);
  assert(r.tasks_completed === 2, 'tasks_completed = 2');
}

console.log('\n=== Test 3: Failure scoring (-15) ===');
{
  Reputation.resetAll();
  const r = new Reputation('test-failure');
  r.update(false, 0);
  assert(r.score === INITIAL_SCORE + FAILURE_POINTS, `Score after failure = ${INITIAL_SCORE + FAILURE_POINTS}`);
  assert(r.tasks_failed === 1, 'tasks_failed = 1');
}

console.log('\n=== Test 4: Score clamping (min=0, max=100) ===');
{
  Reputation.resetAll();
  const r = new Reputation('test-clamp');
  // Drive score to max
  for (let i = 0; i < 20; i++) r.update(true, 1, 10000);
  assert(r.score === MAX_SCORE, `Score capped at ${MAX_SCORE}`);

  // Drive score to min
  Reputation.resetAll();
  const r2 = new Reputation('test-clamp2');
  for (let i = 0; i < 10; i++) r2.update(false, 0);
  assert(r2.score === MIN_SCORE, `Score floored at ${MIN_SCORE}`);
}

console.log('\n=== Test 5: Bid score (0.0 - 1.0) ===');
{
  Reputation.resetAll();
  const r = new Reputation('test-bid');
  assertClose(r.getBidScore(), INITIAL_SCORE / MAX_SCORE, 0.01, 'Initial bid score = 0.5');

  r.update(true, 1, 10000);
  assert(r.getBidScore() > 0.5, `Bid score after success > 0.5 (got ${r.getBidScore()})`);

  Reputation.resetAll();
  const r2 = new Reputation('test-bid2');
  r2.update(false, 0);
  assert(r2.getBidScore() < 0.5, `Bid score after failure < 0.5 (got ${r2.getBidScore()})`);
}

console.log('\n=== Test 6: Critical threshold ===');
{
  Reputation.resetAll();
  const r = new Reputation('test-critical');
  assert(r.canHandleCritical(), 'Initial score passes critical threshold');

  // Fail repeatedly to go below threshold
  for (let i = 0; i < 3; i++) r.update(false, 0);
  assert(r.score < CRITICAL_THRESHOLD, `Score below threshold: ${r.score}`);
  assert(!r.canHandleCritical(), 'Cannot handle critical after repeated failures');
}

console.log('\n=== Test 7: Temporal decay ===');
{
  Reputation.resetAll();
  const r = new Reputation('test-decay');
  r.update(true, 100, 10000);
  const scoreBeforeDecay = r.score;

  // Simulate 3 hours of inactivity
  r.lastActivityTs = Date.now() - (3 * 60 * 60 * 1000);
  r.applyDecay();
  const expectedDecay = 3 * DECAY_POINTS_PER_HOUR;
  assertClose(r.score, scoreBeforeDecay - expectedDecay, 0.1,
    `Score decayed by ${expectedDecay} after 3h inactivity`);
}

console.log('\n=== Test 8: Persistence (save/load) ===');
{
  Reputation.resetAll();
  const r = new Reputation('test-persist');
  r.update(true, 500, 5000);
  r.update(true, 200, 5000);
  r.update(false, 0);
  const savedScore = r.score;
  const savedCompleted = r.tasks_completed;
  const savedFailed = r.tasks_failed;

  // Create new instance — should load from file
  const r2 = new Reputation('test-persist');
  assertClose(r2.score, savedScore, 0.1, `Loaded score matches saved (${savedScore})`);
  assert(r2.tasks_completed === savedCompleted, `Loaded tasks_completed = ${savedCompleted}`);
  assert(r2.tasks_failed === savedFailed, `Loaded tasks_failed = ${savedFailed}`);
}

console.log('\n=== Test 9: Quality bonus proportional to speed ===');
{
  Reputation.resetAll();
  const rFast = new Reputation('test-fast');
  rFast.update(true, 100, 10000); // 1% of deadline used → ~5 bonus
  const fastScore = rFast.score;

  Reputation.resetAll();
  const rSlow = new Reputation('test-slow');
  rSlow.update(true, 8000, 10000); // 80% of deadline used → ~1 bonus
  const slowScore = rSlow.score;

  assert(fastScore > slowScore, `Fast agent scores higher (${fastScore} > ${slowScore})`);
}

console.log('\n=== Test 10: toJSON output format ===');
{
  Reputation.resetAll();
  const r = new Reputation('test-json');
  r.update(true, 100, 5000);
  const json = r.toJSON();
  assert('tasks_completed' in json, 'toJSON has tasks_completed');
  assert('tasks_failed' in json, 'toJSON has tasks_failed');
  assert('avg_latency_ms' in json, 'toJSON has avg_latency_ms');
  assert('score' in json, 'toJSON has score');
  assert('canHandleCritical' in json, 'toJSON has canHandleCritical');
}

// Cleanup
Reputation.resetAll();

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
