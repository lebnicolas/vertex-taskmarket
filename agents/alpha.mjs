// Agent Alpha — Proposer + executor (text analysis)
import { Agent } from '../src/agent.mjs';

export function createAlpha(port = 1883) {
  const agent = new Agent('agent-alpha', port, ['nlp', 'analysis', 'proposer']);

  // Alpha can execute text analysis tasks
  agent.executeFn = async (task) => {
    const input = task.input || '';
    const words = input.split(/\s+/).length;
    const sentences = input.split(/[.!?]+/).filter(Boolean).length;
    const hasPositive = /good|great|excellent|amazing|love|best/i.test(input);
    const hasNegative = /bad|terrible|awful|slow|worst|hate/i.test(input);

    let sentiment = 'neutral';
    if (hasPositive && hasNegative) sentiment = 'mixed';
    else if (hasPositive) sentiment = 'positive';
    else if (hasNegative) sentiment = 'negative';

    return {
      sentiment,
      words,
      sentences,
      summary: `Sentiment: ${sentiment} | ${words} words, ${sentences} sentences`,
    };
  };

  // Alpha verifies by checking result structure
  agent.verifyFn = async (task, result) => {
    const hasOutput = result && result.output;
    const hasValidSentiment = hasOutput && ['positive', 'negative', 'neutral', 'mixed'].includes(result.output.sentiment);
    return {
      valid: !!hasOutput,
      proof: hasOutput ? `Result has valid structure (sentiment: ${result.output?.sentiment || 'n/a'})` : 'Missing output',
    };
  };

  return agent;
}
