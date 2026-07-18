'use strict';
/**
 * Thin Baileys helpers shared by link.js / send-now.js / bot.js.
 * The WhatsApp session is stored on disk in ./auth (git-ignored, sensitive).
 * IMPORTANT: never call sock.logout() to close — that UNLINKS the device.
 * To end a run cleanly we just stop listening and let the process exit.
 */
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('baileys');
const pino = require('pino');

const LOGGER = pino({ level: process.env.WA_LOG_LEVEL || 'silent' });

async function makeSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: LOGGER,
    browser: ['GloriaBot', 'Chrome', '1.0'],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock.ev.on('creds.update', saveCreds);
  return sock;
}

/** Resolve when the socket reaches 'open'; reject on logout or timeout. */
function waitOpen(sock, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WhatsApp connection timeout')), timeoutMs);
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        clearTimeout(timer);
        resolve();
      } else if (connection === 'close') {
        const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
        if (code === DisconnectReason.loggedOut) {
          clearTimeout(timer);
          reject(new Error('device logged out - re-run:  npm run link'));
        }
      }
    });
  });
}

function toJid(number) {
  return String(number).replace(/\D/g, '') + '@s.whatsapp.net';
}

async function sendText(sock, recipients, text) {
  let ok = 0;
  for (const r of recipients) {
    const jid = toJid(r);
    await sock.sendMessage(jid, { text });
    console.log('  -> sent to', r);
    ok++;
    await new Promise((res) => setTimeout(res, 1500)); // gentle pacing
  }
  return ok;
}

module.exports = { makeSock, waitOpen, sendText, toJid, DisconnectReason };
