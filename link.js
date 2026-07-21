'use strict';
/**
 * ONE-TIME: link the dedicated WhatsApp number to this bot using a PAIRING CODE.
 *
 * Follows the official Baileys pairing flow (baileys.wiki/docs/socket/connecting):
 *  - request the code on the 'connecting'/'qr' connection event (not a blind delay)
 *  - standard desktop browser signature (custom names break pairing validation)
 *  - real current WA Web version via fetchLatestWaWebVersion (Baileys #2679)
 *
 * Run:  npm run link
 * Then: WhatsApp -> Settings -> Linked Devices -> Link a device ->
 *       "Link with phone number instead" -> enter the code printed here.
 */
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, Browsers } = require('baileys');
const pino = require('pino');

const SENDER = (process.env.SENDER_NUMBER || '').replace(/\D/g, '');

(async () => {
  if (!SENDER) {
    console.error('Set SENDER_NUMBER in .env (digits only, with country code, e.g. 9715XXXXXXXX)');
    process.exit(2);
  }
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestWaWebVersion();
  console.log('Using WA Web version:', version.join('.'));

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

    if (!requested && !sock.authState.creds.registered && (connection === 'connecting' || !!qr)) {
      requested = true;
      try {
        const code = await sock.requestPairingCode(SENDER);
        const pretty = code.length === 8 ? code.slice(0, 4) + '-' + code.slice(4) : code;
        console.log('\n============================================');
        console.log('  PAIRING CODE:  ' + pretty);
        console.log('============================================');
        console.log('WhatsApp -> Settings -> Linked Devices -> Link a device ->');
        console.log('"Link with phone number instead" -> enter the code (fast, ~60s).\n');
      } catch (e) {
        console.error('Pairing request failed:', e.message);
        process.exit(1);
      }
    }

    if (connection === 'open') {
      console.log('\n✅ Linked and ready. Test it now with:  npm run send');
      setTimeout(() => process.exit(0), 2000);
    } else if (connection === 'close') {
      const err = lastDisconnect && lastDisconnect.error;
      const code = err && err.output && err.output.statusCode;
      console.error('\n❌ Connection closed. statusCode:', code, '| reason:', (err && err.message) || 'unknown');
      console.error('   Send this line to Claude if linking failed.');
    }
  });

  if (sock.authState.creds.registered) {
    console.log('Already linked. Nothing to do. (Test with: npm run send)');
    setTimeout(() => process.exit(0), 1500);
  }
})();
