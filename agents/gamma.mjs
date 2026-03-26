// Agent Gamma — Bidder + executor + primary verifier (research/fetch tasks)
import { Agent } from '../src/agent.mjs';

export function createGamma(port = 1885) {
  const agent = new Agent('agent-gamma', port, ['research', 'fetch', 'nlp', 'verify']);

  // Gamma executes research/parsing tasks
  agent.executeFn = async (task) => {
    const input = task.input || '';

    // Keyword extraction
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'shall', 'can', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'for',
      'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'it', 'its', 'this', 'that']);

    const words = input.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
    const freq = {};
    for (const w of words) {
      if (!stopWords.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1;
    }
    const keywords = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));

    // Simple categorization
    const categories = [];
    if (/product|service|quality|price/i.test(input)) categories.push('commerce');
    if (/code|software|bug|api|function/i.test(input)) categories.push('technology');
    if (/happy|sad|angry|love|hate/i.test(input)) categories.push('emotion');
    if (categories.length === 0) categories.push('general');

    return {
      type: 'research',
      keywords,
      categories,
      word_count: words.length,
      summary: `${keywords.length} keywords extracted, categories: ${categories.join(', ')}`,
    };
  };

  // Gamma is the primary verifier — strict checks
  agent.verifyFn = async (task, result) => {
    if (!result || !result.output) {
      return { valid: false, proof: 'No output in result' };
    }
    if (typeof result.duration_ms !== 'number' || result.duration_ms < 0) {
      return { valid: false, proof: 'Invalid duration_ms' };
    }
    if (result.duration_ms > (task?.deadline_ms || 30000)) {
      return { valid: false, proof: `Execution exceeded deadline (${result.duration_ms}ms > ${task?.deadline_ms || 30000}ms)` };
    }
    return {
      valid: true,
      proof: `Output valid, duration ${result.duration_ms}ms within deadline`,
    };
  };

  return agent;
}
