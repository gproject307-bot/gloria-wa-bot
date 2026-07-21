'use strict';
/**
 * Persistent bot: stays connected to WhatsApp and sends the out-of-stock report
 * on a schedule (default every 3 days). Auto-reconnects if the socket drops.
 * This is what you keep running on the always-on spare phone.
 *
 * Run:  npm start        (ideally under termux-wake-lock; see README)
 */
require('dotenv').config();
const cron = require('node-cron');
const { makeSock, sendText, DisconnectReason } = require('./lib/wa');
const { getStockReport } = require('./lib/shopify');

const RECIPIENTS = (process.env.RECIPIENTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const CRON = process.env.CRON || '0 5 * * *'; // 05:00 UTC = 09:00 Gulf
const CRON_TZ = process.env.CRON_TZ || 'UTC'; // interpret CRON in this tz (not phone-local)

let sock = null;
let ready = false;

function ts() {
  return new Date().toISOString();
}

async function start() {
  sock = await makeSock();
  ready = false;
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      ready = true;
      console.log(ts(), 'connected to WhatsApp');
    } else if (connection === 'close') {
      ready = false;
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error(ts(), 'LOGGED OUT - run `npm run link` on the phone to re-link. Exiting.');
        process.exit(1);
      }
      console.log(ts(), 'connection closed - reconnecting in 5s');
      setTimeout(start, 5000);
    }
  });
}

async function job() {
  if (!ready) {
    console.log(ts(), 'scheduled tick but not connected yet - skipping');
    return;
  }
  try {
    const report = await getStockReport();
    console.log(ts(), `sending report: out-of-stock=${report.oos.length} low=${report.low.length}`);
    await sendText(sock, RECIPIENTS, report.text);
    console.log(ts(), 'report sent');
  } catch (e) {
    console.error(ts(), 'job error:', e.message);
  }
}

(async () => {
  if (!RECIPIENTS.length) {
    console.error('Set RECIPIENTS in .env (comma-separated)');
    process.exit(2);
  }
  if (!cron.validate(CRON)) {
    console.error('Invalid CRON expression:', CRON);
    process.exit(2);
  }
  await start();
  cron.schedule(CRON, job, { timezone: CRON_TZ });
  const cp = CRON.split(' ');
  const gulf = CRON_TZ === 'UTC'
    ? `${String((parseInt(cp[1], 10) + 4) % 24).padStart(2, '0')}:${cp[0].padStart(2, '0')} Gulf`
    : `${cp[1]}:${cp[0]} ${CRON_TZ}`;
  console.log(ts(), 'bot up | schedule:', CRON, '(' + CRON_TZ + ') =', gulf, '| recipients:', RECIPIENTS.join(', '));
  console.log('Tip: send a test immediately with `npm run send` in another Termux session.');
})();
