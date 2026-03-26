// Reputation system — tracks agent performance
export class Reputation {
  constructor() {
    this.tasks_completed = 0;
    this.tasks_failed = 0;
    this.avg_latency_ms = 0;
    this.verify_accuracy = 1.0;
    this.score = 0.5; // starting score
  }

  update(success, duration_ms) {
    if (success) {
      this.tasks_completed++;
      this.avg_latency_ms = this.tasks_completed === 1
        ? duration_ms
        : (this.avg_latency_ms * (this.tasks_completed - 1) + duration_ms) / this.tasks_completed;
    } else {
      this.tasks_failed++;
    }
    const total = this.tasks_completed + this.tasks_failed * 3; // 3x penalty for failures
    this.score = total > 0 ? this.tasks_completed / total : 0.5;
  }

  toJSON() {
    return {
      tasks_completed: this.tasks_completed,
      tasks_failed: this.tasks_failed,
      avg_latency_ms: Math.round(this.avg_latency_ms),
      score: Math.round(this.score * 1000) / 1000,
    };
  }
}
