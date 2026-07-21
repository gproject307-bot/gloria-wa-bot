'use strict';
/**
 * PLAN B: link via QR CODE instead of a pairing code.
 * Run this on a COMPUTER (the QR shows in the terminal), then scan it with the
 * spare phone: WhatsApp -> Settings -> Linked Devices -> Link a device (camera).
 * The session lands in ./auth — copy that folder to the phone afterwards.
 *
 * Run:  npm run link:qr
 */
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, Browsers } = require('baileys');
const pino = require('pino');
const qrcode = require('qrcode');

(async () => {
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

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\nScan this with the spare phone (WhatsApp -> Linked Devices -> Link a device):\n');
      console.log(await qrcode.toString(qr, { type: 'terminal', small: true }));
    }
    if (connection === 'open') {
      console.log('\n✅ Linked! Session saved in ./auth — copy that folder to the phone.');
      setTimeout(() => process.exit(0), 2000);
    } else if (connection === 'close') {
      const err = lastDisconnect && lastDisconnect.error;
      const code = err && err.output && err.output.statusCode;
      console.error('\n❌ Connection closed. statusCode:', code, '| reason:', (err && err.message) || 'unknown');
    }
  });

  if (sock.authState.creds.registered) {
    console.log('Already linked. Nothing to do.');
    setTimeout(() => process.exit(0), 1500);
  }
})();
