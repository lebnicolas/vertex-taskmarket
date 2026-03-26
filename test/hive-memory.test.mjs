#!/usr/bin/env node
// Unit tests — Hive Memory
import { HiveMemory } from '../src/hive-memory.mjs';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

HiveMemory.reset();

console.log('=== Test 1: Basic set/get ===');
{
  const hive = new HiveMemory('test-agent');
  hive.set('greeting', 'hello');
  assert(hive.get('greeting') === 'hello', 'get returns set value');
  assert(hive.get('nonexistent') === undefined, 'get unknown returns undefined');
}

console.log('\n=== Test 2: getAll ===');
{
  HiveMemory.reset();
  const hive = new HiveMemory('test-agent');
  hive.set('a', 1);
  hive.set('b', 2);
  const all = hive.getAll();
  assert(all.a && all.a.value === 1, 'getAll contains a=1');
  assert(all.b && all.b.value === 2, 'getAll contains b=2');
  assert(all.a.from === 'test-agent', 'getAll includes from');
}

console.log('\n=== Test 3: Last-write-wins conflict resolution ===');
{
  HiveMemory.reset();
  const hive = new HiveMemory('test-agent');
  // Simulate two writes with different timestamps
  hive.store.set('key', { value: 'old', ts: 1000, from: 'agent-a' });
  hive._merge('key', 'new', 2000, 'agent-b');
  assert(hive.get('key') === 'new', 'Newer timestamp wins');

  hive._merge('key', 'ancient', 500, 'agent-c');
  assert(hive.get('key') === 'new', 'Older timestamp rejected');
}

console.log('\n=== Test 4: Subscribe to changes ===');
{
  HiveMemory.reset();
  const hive = new HiveMemory('test-agent');
  let notified = false;
  let notifiedKey = null;
  hive.subscribe((key, value, from) => {
    notified = true;
    notifiedKey = key;
  });
  hive._merge('test-key', 'test-value', Date.now(), 'other-agent');
  assert(notified, 'Subscriber notified on merge');
  assert(notifiedKey === 'test-key', 'Subscriber received correct key');
}

console.log('\n=== Test 5: publishPattern + getPatterns ===');
{
  HiveMemory.reset();
  const hive = new HiveMemory('agent-beta');
  hive.publishPattern('nlp', 'agent-beta', true);
  hive.publishPattern('nlp', 'agent-gamma', false);
  hive.publishPattern('nlp', 'agent-beta', true);

  const patterns = hive.getPatterns('nlp');
  assert(patterns.length === 3, `3 patterns stored (got ${patterns.length})`);
  assert(patterns[0].success === true, 'First pattern is success');
  assert(patterns[1].success === false, 'Second pattern is failure');
}

console.log('\n=== Test 6: getBestStrategy ===');
{
  HiveMemory.reset();
  const hive = new HiveMemory('agent-alpha');
  hive.publishPattern('compute', 'agent-beta', true);
  hive.publishPattern('compute', 'agent-beta', true);
  hive.publishPattern('compute', 'agent-gamma', true);
  hive.publishPattern('compute', 'agent-gamma', false);

  const best = hive.getBestStrategy('compute');
  assert(best === 'agent-beta', `Best strategy = agent-beta (got ${best})`);

  assert(hive.getBestStrategy('unknown') === null, 'Unknown type returns null');
}

console.log('\n=== Test 7: Pattern cap at 10 ===');
{
  HiveMemory.reset();
  const hive = new HiveMemory('agent-test');
  for (let i = 0; i < 15; i++) {
    hive.publishPattern('spam', `strategy-${i}`, true);
  }
  const patterns = hive.getPatterns('spam');
  assert(patterns.length === 10, `Capped at 10 (got ${patterns.length})`);
}

console.log('\n=== Test 8: Persistence ===');
{
  HiveMemory.reset();
  const hive1 = new HiveMemory('persist-test');
  hive1.set('persistent-key', 'persistent-value');

  const hive2 = new HiveMemory('persist-test-2');
  assert(hive2.get('persistent-key') === 'persistent-value', 'Value persisted across instances');
}

console.log('\n=== Test 9: Complex values ===');
{
  HiveMemory.reset();
  const hive = new HiveMemory('test-agent');
  const obj = { nested: { data: [1, 2, 3] }, flag: true };
  hive.set('complex', obj);
  const retrieved = hive.get('complex');
  assert(retrieved.nested.data.length === 3, 'Complex object stored/retrieved');
  assert(retrieved.flag === true, 'Boolean preserved');
}

console.log('\n=== Test 10: Empty patterns ===');
{
  HiveMemory.reset();
  const hive = new HiveMemory('test-agent');
  assert(hive.getPatterns('nothing').length === 0, 'No patterns returns empty array');
  assert(hive.getBestStrategy('nothing') === null, 'No best strategy returns null');
}

HiveMemory.reset();

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
