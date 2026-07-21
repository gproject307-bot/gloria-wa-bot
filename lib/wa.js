'use strict';
/**
 * Thin Baileys helpers shared by link.js / send-now.js / bot.js.
 * The WhatsApp session is stored on disk in ./auth (git-ignored, sensitive).
 * IMPORTANT: never call sock.logout() to close — that UNLINKS the device.
 * To end a run cleanly we just stop listening and let the process exit.
 */
const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, fetchLatestBaileysVersion, DisconnectReason, Browsers } = require('baileys');
const pino = require('pino');

const LOGGER = pino({ level: process.env.WA_LOG_LEVEL || 'silent' });

async function makeSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  // fetchLatestWaWebVersion = the REAL current WA Web version (Baileys #2679:
  // the bundled/fetchLatestBaileysVersion one is stale and breaks pairing).
  let version;
  try {
    ({ version } = await fetchLatestWaWebVersion());
  } catch (e) {
    ({ version } = await fetchLatestBaileysVersion()); // offline fallback
  }
  const sock = makeWASocket({
    version,
    auth: state,
    logger: LOGGER,
    browser: Browsers.macOS('Chrome'),
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
