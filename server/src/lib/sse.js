// Tiny Server-Sent-Events hub keyed by exam id (Supabase Realtime analogue for local dev).
const channels = new Map(); // examId -> Set<res>

export function sseSubscribe(examId, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  if (!channels.has(examId)) channels.set(examId, new Set());
  channels.get(examId).add(res);
  const keepAlive = setInterval(() => res.write(`: ka ${Date.now()}\n\n`), 25000);
  res.on('close', () => {
    clearInterval(keepAlive);
    channels.get(examId)?.delete(res);
  });
}

export function ssePublish(examId, event, payload) {
  const set = channels.get(Number(examId));
  if (!set) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) { try { res.write(data); } catch { /* dropped */ } }
}
