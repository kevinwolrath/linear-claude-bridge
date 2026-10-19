import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type BridgeJob = {
  deliveryId: string;
  issueId: string;
  identifier: string;
  title?: string;
  repository: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  exitCode?: number | null;
};

type State = { jobs: BridgeJob[] };

export class JobQueue {
  private state: State = { jobs: [] };
  private running = false;

  constructor(private readonly stateFile: string) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    if (fs.existsSync(stateFile)) {
      try { this.state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { this.state = { jobs: [] }; }
    }
    // Jobs interrupted by a container restart are eligible to run again.
    for (const job of this.state.jobs) {
      if (job.startedAt && !job.completedAt && !job.failedAt) delete job.startedAt;
    }
    this.save();
  }

  hasDelivery(deliveryId: string) {
    return this.state.jobs.some(j => j.deliveryId === deliveryId);
  }

  enqueue(job: BridgeJob) {
    if (this.hasDelivery(job.deliveryId)) return false;
    this.state.jobs.push(job);
    this.save();
    void this.drain();
    return true;
  }

  private save() {
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  private next() {
    return this.state.jobs.find(j => !j.startedAt && !j.completedAt && !j.failedAt);
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      let job: BridgeJob | undefined;
      while ((job = this.next())) {
        job.startedAt = new Date().toISOString();
        this.save();
        console.log(JSON.stringify({ level: 'info', message: 'job started', issue: job.identifier, repository: job.repository }));
        const exitCode = await runClaude(job);
        job.exitCode = exitCode;
        if (exitCode === 0) job.completedAt = new Date().toISOString();
        else job.failedAt = new Date().toISOString();
        this.save();
        console.log(JSON.stringify({ level: exitCode === 0 ? 'info' : 'error', message: exitCode === 0 ? 'job completed' : 'job failed', issue: job.identifier, exitCode }));
      }
    } finally {
      this.running = false;
      // Close the race where a job arrived between next() returning undefined and running=false.
      if (this.next()) void this.drain();
    }
  }
}

function runClaude(job: BridgeJob): Promise<number | null> {
  const command = process.env.CLAUDE_COMMAND ?? 'claude';
  const args = ['-p', `Start ${job.identifier}`];
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: job.repository, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    child.stdout.on('data', chunk => process.stdout.write(`[${job.identifier}] ${chunk}`));
    child.stderr.on('data', chunk => process.stderr.write(`[${job.identifier}] ${chunk}`));
    child.on('error', error => {
      console.error(JSON.stringify({ level: 'error', message: 'claude process error', issue: job.identifier, error: error.message }));
      resolve(null);
    });
    child.on('close', code => resolve(code));
  });
}
