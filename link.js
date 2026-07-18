'use strict';
/**
 * ONE-TIME: link the dedicated WhatsApp number to this bot using a PAIRING CODE
 * (not a QR - because the bot usually runs on the same phone that holds WhatsApp,
 * so you can't scan your own screen).
 *
 * Prereq: the SENDER number is already activated and registered in the WhatsApp
 * app on the spare phone.
 *
 * Run:  npm run link
 * Then: WhatsApp -> Settings -> Linked Devices -> Link a device ->
 *       "Link with phone number instead" -> enter the code printed here.
 */
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, delay } = require('baileys');
const pino = require('pino');

const SENDER = (process.env.SENDER_NUMBER || '').replace(/\D/g, '');

(async () => {
  if (!SENDER) {
    console.error('Set SENDER_NUMBER in .env (digits only, with country code, e.g. 9715XXXXXXXX)');
    process.exit(2);
  }
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['GloriaBot', 'Chrome', '1.0'],
    printQRInTerminal: false,
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') {
      console.log('\n✅ Linked and ready. Test it now with:  npm run send');
      setTimeout(() => process.exit(0), 2000);
    }
  });

  if (!sock.authState.creds.registered) {
    await delay(4000); // let the socket initialise before requesting a code
    try {
      const code = await sock.requestPairingCode(SENDER);
      const pretty = code.length === 8 ? code.slice(0, 4) + '-' + code.slice(4) : code;
      console.log('\n============================================');
      console.log('  PAIRING CODE:  ' + pretty);
      console.log('============================================');
      console.log('On the spare phone: WhatsApp -> Settings -> Linked Devices ->');
      console.log('Link a device -> "Link with phone number instead" -> enter the code.\n');
    } catch (e) {
      console.error('Pairing request failed:', e.message);
      process.exit(1);
    }
  } else {
    console.log('Already linked. Nothing to do. (Test with: npm run send)');
    setTimeout(() => process.exit(0), 1500);
  }
})();
