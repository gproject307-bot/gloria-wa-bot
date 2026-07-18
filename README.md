# Gloria Naturals — WhatsApp stock alert (spare-phone bot)

Sends the out-of-stock list to your own numbers over WhatsApp, every 3 days, from
a **dedicated number** on a **spare Android phone** — no third-party relay, no
cost, no risk to your personal WhatsApp.

Engine: [Baileys](https://github.com/WhiskeySockets/Baileys) (WebSocket, **no
browser** — runs light on a phone). Data comes straight from the Shopify Admin API.

> Pairs with the email alert (`gloria-stock-alert`, runs in the cloud). Email is
> the reliable backbone; this phone bot adds the WhatsApp push.

---

## Before you start (the pending bit)
- The **dedicated number must be activated** and **registered in the WhatsApp app
  on the spare phone** (normal WhatsApp, one-time SMS code). Everything below waits
  on that.
- Keep that phone **plugged in**. It becomes your always-on sender.

## One-time setup on the spare phone

**1. Install Termux** — from **F-Droid** (https://f-droid.org), *not* the Play
Store (that build is broken). Also install **Termux:API** and **Termux:Boot** from
F-Droid (used for wake-lock + auto-start).

**2. In Termux, install the runtime:**
```bash
pkg update -y && pkg install -y nodejs git termux-api
```

**3. Get the bot and its dependencies:**
```bash
git clone https://github.com/gproject307-bot/gloria-wa-bot
cd gloria-wa-bot
npm install --omit=optional        # --omit=optional skips native image libs we don't need
```

**4. Configure:**
```bash
cp .env.example .env
nano .env      # fill SHOPIFY_ADMIN_TOKEN, SENDER_NUMBER, RECIPIENTS  (Ctrl+O, Enter, Ctrl+X)
```
- `SENDER_NUMBER` = the dedicated number, digits only (e.g. `9715XXXXXXXX`).
- `RECIPIENTS` = your own number(s), comma-separated.
- `SHOPIFY_ADMIN_TOKEN` = the same Custom App token (read_products) used by the email bot.

**5. Link the number (pairing code, not QR):**
```bash
npm run link
```
It prints an 8-character code. On the phone: **WhatsApp → Settings → Linked
Devices → Link a device → "Link with phone number instead"** → enter the code.
When it says `✅ Linked`, you're paired. (The session is saved in `auth/` — keep it,
it's what avoids re-linking.)

**6. Test immediately:**
```bash
npm run send
```
Your recipients should get the WhatsApp within a few seconds. It also prints the
exact message to the terminal.

## Keep it running every 3 days

```bash
termux-wake-lock                       # stop Android from sleeping the process
nohup npm start > bot.log 2>&1 &       # run the persistent bot in the background
```
- `npm start` stays connected and fires on the schedule in `.env` (`CRON`, default
  every 3 days at 10:00 Gulf). It auto-reconnects if WhatsApp drops.
- Check it: `cat bot.log`  ·  send a manual test anytime: `npm run send`.

**Auto-start after a reboot** (Termux:Boot): create `~/.termux/boot/gloria.sh`
```bash
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/gloria.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/gloria-wa-bot
nohup npm start > bot.log 2>&1 &
EOF
chmod +x ~/.termux/boot/gloria.sh
```

**Android battery settings (important):** Settings → Apps → Termux → Battery →
**Unrestricted / Don't optimize**. Without this, Android will eventually kill the
process.

## Honest reliability notes
- A plugged-in, battery-unrestricted phone with wake-lock runs for weeks. But
  Android is not a server: if the OS force-kills the app and the phone doesn't
  reboot, the bot won't fire again until you restart it (or next reboot triggers
  the boot script). Glance at `bot.log` now and then.
- This uses a WhatsApp linked-device session, which is against WhatsApp's automation
  ToS. That's why it runs on a **dedicated** number — a worst-case ban costs you
  nothing personal. Low volume (a few messages/month to your own numbers) keeps risk
  minimal.
- Never commit `.env` or `auth/` (already git-ignored). `auth/` is a live login to
  the WhatsApp account.

## Files
| file | role |
|---|---|
| `lib/shopify.js` | fetch active products from Admin API + build the report text |
| `lib/wa.js` | Baileys helpers (connect, wait-for-open, send) |
| `link.js` | one-time pairing-code linker |
| `send-now.js` | send one report and exit (testing / external scheduler) |
| `bot.js` | persistent bot with the every-3-days schedule + auto-reconnect |
