'use strict';
/**
 * Fetch ACTIVE products from the Shopify Admin API and build the out-of-stock
 * report text. Uses the built-in https module (no fetch dependency) so it runs
 * on any Node >= 18. Mirrors the Python email tool's logic exactly.
 */
const https = require('https');

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const APIVER = process.env.SHOPIFY_API_VERSION || '2026-01';
const INCLUDE_LOW = String(process.env.INCLUDE_LOW_STOCK || 'true').toLowerCase() === 'true';
const LOW = INCLUDE_LOW ? parseInt(process.env.LOW_STOCK_THRESHOLD || '2', 10) : 0;

const QUERY =
  'query($cursor:String){ products(first:250, after:$cursor, query:"status:active"){ ' +
  'pageInfo{ hasNextPage endCursor } edges{ node{ title totalInventory ' +
  'variants(first:10){ edges{ node{ sku } } } } } } }';

function gql(query, variables) {
  const payload = JSON.stringify({ query, variables });
  const opts = {
    method: 'POST',
    hostname: STORE,
    path: `/admin/api/${APIVER}/graphql.json`,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
      'Content-Length': Buffer.byteLength(payload),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.errors) return reject(new Error('Shopify GraphQL: ' + JSON.stringify(j.errors)));
          if (res.statusCode >= 400) return reject(new Error('Shopify HTTP ' + res.statusCode + ': ' + data.slice(0, 200)));
          resolve(j.data);
        } catch (e) {
          reject(new Error('Shopify parse error: ' + e.message + ' body=' + data.slice(0, 120)));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function fetchActive() {
  const out = [];
  let cursor = null;
  do {
    const d = await gql(QUERY, { cursor });
    const p = d.products;
    out.push(...p.edges);
    cursor = p.pageInfo.hasNextPage ? p.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

function classify(edges) {
  const oos = [];
  const low = [];
  for (const e of edges) {
    const n = e.node;
    const qty = n.totalInventory || 0;
    const vs = (n.variants && n.variants.edges) || [];
    const sku = (vs[0] && vs[0].node.sku) || '(no SKU)';
    const name = n.title.split(' – ')[0].split(' - ')[0].trim();
    if (qty <= 0) oos.push({ name, sku, qty });
    else if (LOW && qty <= LOW) low.push({ name, sku, qty });
  }
  oos.sort((a, b) => a.name.localeCompare(b.name));
  low.sort((a, b) => a.qty - b.qty);
  return { oos, low };
}

function gulfDate() {
  const d = new Date(Date.now() + 4 * 3600 * 1000); // UAE = UTC+4, no DST
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${day} ${mon} ${d.getUTCFullYear()}`;
}

function buildText(oos, low) {
  const lines = [`Gloria Naturals - Stock Alert (${gulfDate()})`, ''];
  if (oos.length) {
    lines.push(`OUT OF STOCK (${oos.length}):`);
    for (const p of oos) lines.push(`- ${p.name}  [${p.sku}]`);
  } else {
    lines.push('OUT OF STOCK: none - all active products in stock.');
  }
  if (LOW && low.length) {
    lines.push('', `LOW (<= ${LOW}) (${low.length}):`);
    for (const p of low) lines.push(`- ${p.name}  [${p.sku}]  ${p.qty} left`);
  }
  lines.push('', 'Automated reminder - runs every 3 days.');
  return lines.join('\n');
}

async function getStockReport() {
  if (!STORE || !TOKEN) throw new Error('SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN must be set in .env');
  const edges = await fetchActive();
  const { oos, low } = classify(edges);
  return { oos, low, count: edges.length, text: buildText(oos, low) };
}

module.exports = { getStockReport, classify, buildText, gulfDate };
