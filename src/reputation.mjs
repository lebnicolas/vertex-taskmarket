// Advanced reputation system — dynamic scoring, decay, persistence, thresholds
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = `${__dirname}/../data`;
const REPUTATION_FILE = `${DATA_DIR}/reputation.json`;

// Scoring constants
const SUCCESS_POINTS = 10;
const FAILURE_POINTS = -15;
const QUALITY_BONUS_MAX = 5;       // bonus for fast execution
const DECAY_POINTS_PER_HOUR = 1;
const MIN_SCORE = 0;
const MAX_SCORE = 100;
const INITIAL_SCORE = 50;
const CRITICAL_THRESHOLD = 20;     // below this, no critical tasks

export class Reputation {
  constructor(agentId = null) {
    this.agentId = agentId;
    this.tasks_completed = 0;
    this.tasks_failed = 0;
    this.avg_latency_ms = 0;
    this.score = INITIAL_SCORE;
    this.lastActivityTs = Date.now();
    this._loaded = false;

    if (agentId) this.load();
  }

  // (1) Dynamic scoring with quality weighting
  update(success, duration_ms, deadline_ms = 30000) {
    this.lastActivityTs = Date.now();

    if (success) {
      this.tasks_completed++;
      // Update avg latency
      this.avg_latency_ms = this.tasks_completed === 1
        ? duration_ms
        : (this.avg_latency_ms * (this.tasks_completed - 1) + duration_ms) / this.tasks_completed;

      // Base score + quality bonus (faster = higher bonus)
      const speedRatio = Math.max(0, 1 - (duration_ms / deadline_ms));
      const qualityBonus = Math.round(speedRatio * QUALITY_BONUS_MAX);
      this.score = Math.min(MAX_SCORE, this.score + SUCCESS_POINTS + qualityBonus);
    } else {
      this.tasks_failed++;
      this.score = Math.max(MIN_SCORE, this.score + FAILURE_POINTS);
    }

    this.save();
  }

  // (3) Temporal decay — call periodically
  applyDecay() {
    const now = Date.now();
    const hoursSinceActivity = (now - this.lastActivityTs) / (1000 * 60 * 60);
    if (hoursSinceActivity >= 1) {
      const decayPoints = Math.floor(hoursSinceActivity) * DECAY_POINTS_PER_HOUR;
      if (decayPoints > 0) {
        this.score = Math.max(MIN_SCORE, this.score - decayPoints);
      }
    }
  }

  // (2) Normalized score for bidding (0.0 - 1.0)
  getBidScore() {
    this.applyDecay();
    return this.score / MAX_SCORE;
  }

  // (5) Check if agent can handle critical tasks
  canHandleCritical() {
    this.applyDecay();
    return this.score >= CRITICAL_THRESHOLD;
  }

  // (4) Persistence — save to JSON
  save() {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      const all = Reputation.loadAll();
      all[this.agentId || '_default'] = this._serialize();
      writeFileSync(REPUTATION_FILE, JSON.stringify(all, null, 2));
    } catch (e) {
      // Silent fail — persistence is best-effort
    }
  }

  // (4) Persistence — load from JSON
  load() {
    if (this._loaded) return;
    try {
      const all = Reputation.loadAll();
      const data = all[this.agentId];
      if (data) {
        this.tasks_completed = data.tasks_completed || 0;
        this.tasks_failed = data.tasks_failed || 0;
        this.avg_latency_ms = data.avg_latency_ms || 0;
        this.score = data.score ?? INITIAL_SCORE;
        this.lastActivityTs = data.lastActivityTs || Date.now();
      }
    } catch (e) {
      // No saved data — start fresh
    }
    this._loaded = true;
  }

  _serialize() {
    return {
      tasks_completed: this.tasks_completed,
      tasks_failed: this.tasks_failed,
      avg_latency_ms: Math.round(this.avg_latency_ms),
      score: Math.round(this.score * 10) / 10,
      lastActivityTs: this.lastActivityTs,
    };
  }

  static loadAll() {
    try {
      if (existsSync(REPUTATION_FILE)) {
        return JSON.parse(readFileSync(REPUTATION_FILE, 'utf-8'));
      }
    } catch (e) { /* ignore */ }
    return {};
  }

  static resetAll() {
    try {
      if (existsSync(REPUTATION_FILE)) writeFileSync(REPUTATION_FILE, '{}');
    } catch (e) { /* ignore */ }
  }

  toJSON() {
    this.applyDecay();
    return {
      tasks_completed: this.tasks_completed,
      tasks_failed: this.tasks_failed,
      avg_latency_ms: Math.round(this.avg_latency_ms),
      score: Math.round(this.score * 10) / 10,
      canHandleCritical: this.canHandleCritical(),
    };
  }
}

// Export constants for tests
export { SUCCESS_POINTS, FAILURE_POINTS, QUALITY_BONUS_MAX, DECAY_POINTS_PER_HOUR,
         MIN_SCORE, MAX_SCORE, INITIAL_SCORE, CRITICAL_THRESHOLD };
