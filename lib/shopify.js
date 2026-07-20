'use strict';
/**
 * Fetch ACTIVE products from the Shopify Admin API and build the out-of-stock
 * report text. Uses the built-in https module (no fetch dependency) so it runs
 * on any Node >= 18. Mirrors the Python email tool's logic exactly.
 *
 * Auth (either works):
 *   - SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET  -> Dev Dashboard app; a fresh
 *     24h token is minted at runtime via the client-credentials grant (preferred,
 *     no long-lived secret on disk). This is the current Shopify flow (2026+).
 *   - SHOPIFY_ADMIN_TOKEN  -> a direct token, if you already have one.
 */
const https = require('https');

const STORE = process.env.SHOPIFY_STORE;
const STATIC_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // optional direct token
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const APIVER = process.env.SHOPIFY_API_VERSION || '2026-01';
const INCLUDE_LOW = String(process.env.INCLUDE_LOW_STOCK || 'true').toLowerCase() === 'true';
const LOW = INCLUDE_LOW ? parseInt(process.env.LOW_STOCK_THRESHOLD || '2', 10) : 0;

const QUERY =
  'query($cursor:String){ products(first:250, after:$cursor, query:"status:active"){ ' +
  'pageInfo{ hasNextPage endCursor } edges{ node{ title totalInventory ' +
  'variants(first:10){ edges{ node{ sku } } } } } } }';

function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Return a usable Admin API token: the static one, or a freshly minted 24h one. */
async function getToken() {
  if (STATIC_TOKEN) return STATIC_TOKEN;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN) in .env');
  }
  const body =
    'grant_type=client_credentials' +
    '&client_id=' + encodeURIComponent(CLIENT_ID) +
    '&client_secret=' + encodeURIComponent(CLIENT_SECRET);
  const { status, body: resp } = await httpsRequest(
    {
      method: 'POST',
      hostname: STORE,
      path: '/admin/oauth/access_token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    },
    body
  );
  let j;
  try {
    j = JSON.parse(resp);
  } catch (e) {
    throw new Error('token exchange: bad response (HTTP ' + status + ') ' + resp.slice(0, 160));
  }
  if (!j.access_token) throw new Error('token exchange failed (HTTP ' + status + '): ' + resp.slice(0, 160));
  return j.access_token;
}

async function gql(token, query, variables) {
  const payload = JSON.stringify({ query, variables });
  const { status, body: data } = await httpsRequest(
    {
      method: 'POST',
      hostname: STORE,
      path: `/admin/api/${APIVER}/graphql.json`,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    payload
  );
  let j;
  try {
    j = JSON.parse(data);
  } catch (e) {
    throw new Error('Shopify parse error (HTTP ' + status + '): ' + data.slice(0, 120));
  }
  if (j.errors) throw new Error('Shopify GraphQL: ' + JSON.stringify(j.errors));
  if (status >= 400) throw new Error('Shopify HTTP ' + status + ': ' + data.slice(0, 160));
  return j.data;
}

async function fetchActive(token) {
  const out = [];
  let cursor = null;
  do {
    const d = await gql(token, QUERY, { cursor });
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

/** Run a ShopifyQL query and return rows as objects. Requires read_reports scope. */
async function shopifyql(token, q) {
  const query = '{ shopifyqlQuery(query: ' + JSON.stringify(q) + ') { tableData { columns { name } rows } parseErrors } }';
  const d = await gql(token, query);
  const sq = d.shopifyqlQuery;
  if (!sq || (sq.parseErrors && sq.parseErrors.length)) return [];
  const td = sq.tableData;
  if (!td) return [];
  const names = td.columns.map((c) => c.name);
  return (td.rows || []).map((row) => {
    if (Array.isArray(row)) { const o = {}; names.forEach((n, i) => (o[n] = row[i])); return o; }
    return row;
  });
}

/** Turn a /products/handle path into a readable product name. */
function prettyProduct(path) {
  let s = String(path || '').split('/products/')[1] || String(path || '');
  s = s.split('?')[0].replace(/^products-/, '');
  s = s.replace(/-?eau-de-parfum.*$/, '').replace(/-?perfume-uae.*$/, '').replace(/-?50ml.*$/, '');
  s = s.replace(/[-]+/g, ' ').trim();
  return s.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Home';
}

/** Yesterday's headline analytics (visitors, orders, sales, most-viewed products). */
async function fetchAnalytics(token) {
  const sess = await shopifyql(token, "FROM sessions SHOW sessions WHERE human_or_bot_session = 'human' DURING yesterday");
  const sales = await shopifyql(token, 'FROM sales SHOW net_sales, orders DURING yesterday');
  const pages = await shopifyql(
    token,
    "FROM sessions SHOW sessions GROUP BY landing_page_path WHERE human_or_bot_session = 'human' DURING yesterday ORDER BY sessions DESC LIMIT 15"
  );
  const topProducts = pages
    .filter((r) => String(r.landing_page_path || '').includes('/products/'))
    .slice(0, 5)
    .map((r) => ({ name: prettyProduct(r.landing_page_path), views: r.sessions }));
  return {
    sessions: (sess[0] && sess[0].sessions) || 0,
    netSales: (sales[0] && sales[0].net_sales) || 0,
    orders: (sales[0] && sales[0].orders) || 0,
    topProducts,
  };
}

function buildText(oos, low, analytics) {
  const lines = [`Gloria Naturals - Daily Briefing (${gulfDate()})`, ''];

  if (analytics) {
    lines.push('YESTERDAY:');
    lines.push(`Visitors: ${analytics.sessions}  |  Orders: ${analytics.orders}  |  Sales: ${Math.round(Number(analytics.netSales) || 0)} AED`);
    if (analytics.topProducts.length) {
      lines.push('Most viewed:');
      analytics.topProducts.forEach((p, i) => lines.push(`  ${i + 1}. ${p.name} (${p.views})`));
    }
    lines.push('');
  }

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
  lines.push('', 'Automated daily briefing.');
  return lines.join('\n');
}

async function getStockReport() {
  if (!STORE) throw new Error('SHOPIFY_STORE must be set in .env');
  const token = await getToken();
  const edges = await fetchActive(token);
  const { oos, low } = classify(edges);
  let analytics = null;
  try {
    analytics = await fetchAnalytics(token); // non-fatal: needs read_reports + protected customer data
  } catch (e) {
    console.error('analytics skipped:', e.message);
  }
  return { oos, low, count: edges.length, analytics, text: buildText(oos, low, analytics) };
}

module.exports = { getStockReport, classify, buildText, fetchAnalytics, gulfDate, getToken };
