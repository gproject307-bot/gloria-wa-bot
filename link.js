'use strict';
/**
 * ONE-TIME: link the dedicated WhatsApp number to this bot using a PAIRING CODE.
 *
 * Flow (matches official Baileys guide + the post-pairing restart quirk):
 *  - real current WA Web version via fetchLatestWaWebVersion (Baileys #2679)
 *  - standard desktop browser signature (custom names break pairing)
 *  - request the code on the 'qr' event (socket fully ready)
 *  - after the code is accepted WhatsApp closes with 515 (restartRequired);
 *    we RECONNECT automatically to finish login -> 'open'.
 *
 * Run:  npm run link
 */
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, Browsers, DisconnectReason } = require('baileys');
const pino = require('pino');

const SENDER = (process.env.SENDER_NUMBER || '').replace(/\D/g, '');
let attempts = 0;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestWaWebVersion();
  if (attempts === 0) console.log('Using WA Web version:', version.join('.'));

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: process.env.WA_LOG_LEVEL || 'silent' }),
    browser: Browsers.macOS('Chrome'),
    defaultQueryTimeoutMs: undefined,
  });
  sock.ev.on('creds.update', saveCreds);

  let requested = false;
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Ask for the pairing code only when the socket is ready (qr event) and we
    // aren't registered yet. After pairing, creds.registered is true so this is skipped.
    if (!requested && !sock.authState.creds.registered && !!qr) {
      requested = true;
      try {
        const code = await sock.requestPairingCode(SENDER);
        const pretty = code.length === 8 ? code.slice(0, 4) + '-' + code.slice(4) : code;
        console.log('\n============================================');
        console.log('  PAIRING CODE:  ' + pretty);
        console.log('============================================');
        console.log('WhatsApp -> Settings -> Linked Devices -> Link a device ->');
        console.log('"Link with phone number instead" -> enter it fast (~60s).\n');
      } catch (e) {
        console.error('Pairing request failed:', e.message, '- retrying...');
        requested = false; // allow another try on the next qr
      }
    }

    if (connection === 'open') {
      console.log('\n✅ Linked and ready! Test it now with:  npm run send');
      setTimeout(() => process.exit(0), 1500);
      return;
    }

    if (connection === 'close') {
      const err = lastDisconnect && lastDisconnect.error;
      const code = err && err.output && err.output.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error('\n❌ Logged out. Delete auth/ and start over:  rm -rf auth && npm run link');
        process.exit(1);
      }
      // 515 restartRequired (normal right after pairing) or a transient drop: reconnect.
      if (attempts < 6) {
        attempts++;
        console.log(`... reconnecting to finish login (status ${code}, attempt ${attempts})`);
        setTimeout(connect, 1500);
      } else {
        console.error('\n❌ Gave up after', attempts, 'reconnects. Last status:', code);
        process.exit(1);
      }
    }
  });
}

(async () => {
  if (!SENDER) {
    console.error('Set SENDER_NUMBER in .env (digits only, country code, e.g. 9715XXXXXXXX)');
    process.exit(2);
  }
  await connect();
})();
