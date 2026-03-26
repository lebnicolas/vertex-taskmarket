// Agent Beta — Bidder + executor (computation tasks)
import { Agent } from '../src/agent.mjs';

export function createBeta(port = 1884) {
  const agent = new Agent('agent-beta', port, ['compute', 'math', 'nlp']);

  // Beta executes computation and NLP tasks
  agent.executeFn = async (task) => {
    const input = task.input || '';

    // Math evaluation
    if (/^\d[\d\s+\-*/().]+$/.test(input.trim())) {
      try {
        const result = Function(`"use strict"; return (${input})`)();
        return { type: 'math', result, expression: input.trim() };
      } catch (e) {
        return { type: 'math', error: e.message };
      }
    }

    // Text analysis fallback
    const words = input.split(/\s+/).filter(Boolean);
    const charCount = input.length;
    const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
    const avgWordLength = words.length > 0
      ? (words.reduce((sum, w) => sum + w.length, 0) / words.length).toFixed(1)
      : 0;

    return {
      type: 'text-stats',
      words: words.length,
      characters: charCount,
      unique_words: uniqueWords,
      avg_word_length: parseFloat(avgWordLength),
      summary: `${words.length} words, ${uniqueWords} unique, avg length ${avgWordLength}`,
    };
  };

  // Beta verifies by checking result completeness
  agent.verifyFn = async (task, result) => {
    const hasOutput = result && result.output;
    const hasDuration = result && typeof result.duration_ms === 'number';
    return {
      valid: !!hasOutput && hasDuration,
      proof: hasOutput ? `Output present, duration ${result.duration_ms}ms` : 'Missing output or duration',
    };
  };

  return agent;
}
