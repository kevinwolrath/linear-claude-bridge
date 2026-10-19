import crypto from 'node:crypto';
import express from 'express';
import { JobQueue } from './jobs.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);
const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
const claudeAssigneeId = process.env.LINEAR_CLAUDE_ASSIGNEE_ID;
const queue = new JobQueue(process.env.JOB_STATE_FILE ?? '/data/jobs.json');

function validSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!webhookSecret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function routes(): Record<string, string> {
  try { return JSON.parse(process.env.REPOSITORY_ROUTES_JSON ?? '{}'); }
  catch { throw new Error('REPOSITORY_ROUTES_JSON must be valid JSON'); }
}

function assignedToClaude(payload: any): boolean {
  if (payload.type !== 'Issue' || payload.action !== 'update') return false;
  if (!claudeAssigneeId) return false;
  // Assignment changes are issue updates; updatedFrom tells us the field changed.
  if (!payload.updatedFrom || !Object.prototype.hasOwnProperty.call(payload.updatedFrom, 'assigneeId')) return false;
  return payload.data?.assigneeId === claudeAssigneeId;
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/webhooks/linear', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body as Buffer;
  if (!validSignature(rawBody, req.header('linear-signature') ?? undefined)) return res.sendStatus(401);

  let payload: any;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.sendStatus(400); }

  if (typeof payload.webhookTimestamp !== 'number' || Math.abs(Date.now() - payload.webhookTimestamp) > 60_000) return res.sendStatus(401);

  const deliveryId = req.header('linear-delivery');
  if (!deliveryId) return res.status(400).send('Missing Linear-Delivery');

  if (!assignedToClaude(payload)) {
    console.log(JSON.stringify({ level: 'info', message: 'linear webhook ignored', deliveryId, event: payload.type, action: payload.action }));
    return res.sendStatus(200);
  }

  const identifier = payload.data?.identifier as string | undefined;
  const issueId = payload.data?.id as string | undefined;
  if (!identifier || !issueId) return res.status(400).send('Issue payload missing identifier or id');

  const teamKey = identifier.split('-')[0];
  const repository = routes()[teamKey];
  if (!repository) {
    console.error(JSON.stringify({ level: 'error', message: 'no repository route', issue: identifier, teamKey }));
    return res.sendStatus(200);
  }

  const accepted = queue.enqueue({
    deliveryId,
    issueId,
    identifier,
    title: payload.data?.title,
    repository,
    queuedAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({ level: 'info', message: accepted ? 'job queued' : 'duplicate delivery ignored', deliveryId, issue: identifier, repository }));
  return res.sendStatus(200);
});

app.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', message: 'bridge listening', port }));
});
