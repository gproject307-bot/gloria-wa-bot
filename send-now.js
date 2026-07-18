'use strict';
/**
 * Send ONE out-of-stock report right now, then exit. Use this to test after
 * linking, or drive it from an external scheduler if you prefer short-lived runs.
 *
 * Run:  npm run send
 */
require('dotenv').config();
const { makeSock, waitOpen, sendText } = require('./lib/wa');
const { getStockReport } = require('./lib/shopify');

const RECIPIENTS = (process.env.RECIPIENTS || '').split(',').map((s) => s.trim()).filter(Boolean);

(async () => {
  if (!RECIPIENTS.length) {
    console.error('Set RECIPIENTS in .env (comma-separated)');
    process.exit(2);
  }
  const report = await getStockReport();
  console.log(`[shopify] active=${report.count}  out-of-stock=${report.oos.length}  low=${report.low.length}`);
  console.log('-'.repeat(44) + '\n' + report.text + '\n' + '-'.repeat(44));

  const sock = await makeSock();
  await waitOpen(sock);
  const n = await sendText(sock, RECIPIENTS, report.text);
  console.log(`[whatsapp] delivered to ${n}/${RECIPIENTS.length} recipient(s)`);

  await new Promise((r) => setTimeout(r, 3000)); // let the socket flush the send
  process.exit(0); // NB: exit, do NOT logout (logout would unlink the device)
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
