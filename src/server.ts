import crypto from 'node:crypto';
import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 8080);
const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;

function validSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!webhookSecret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/webhooks/linear', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body as Buffer;
  const signature = req.header('linear-signature') ?? undefined;

  if (!validSignature(rawBody, signature)) {
    return res.sendStatus(401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }

  // Linear recommends rejecting stale webhook timestamps to reduce replay risk.
  if (typeof payload.webhookTimestamp !== 'number' || Math.abs(Date.now() - payload.webhookTimestamp) > 60_000) {
    return res.sendStatus(401);
  }

  const deliveryId = req.header('linear-delivery');
  const event = req.header('linear-event') ?? payload.type;
  console.log(JSON.stringify({
    level: 'info',
    message: 'linear webhook received',
    deliveryId,
    event,
    action: payload.action,
    issue: payload.data?.identifier,
  }));

  // TODO: filter assignment-to-Claude events, deduplicate Linear-Delivery,
  // resolve repository routing, and enqueue a persistent job.
  return res.sendStatus(200);
});

app.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', message: 'bridge listening', port }));
});
