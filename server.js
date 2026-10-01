const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 10000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const ALLOWED_ORIGINS = String(process.env.LEKHVI_ALLOWED_ORIGINS || 'http://localhost:8080,http://127.0.0.1:8080,https://lekhvi.com,https://www.lekhvi.com').split(',').map(s => s.trim()).filter(Boolean);
const PUBLIC_BASE_URL = String(process.env.LEKHVI_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const ADMIN_USER = process.env.LEKHVI_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.LEKHVI_ADMIN_PASSWORD || 'change-me-now';
const SESSION_TTL = 1000 * 60 * 60 * 12;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const DATA_DIR = process.env.LEKHVI_DATA_DIR ? path.resolve(process.env.LEKHVI_DATA_DIR) : path.join(ROOT, 'data');
const ASSET_DIR = path.join(DATA_DIR, 'assets', 'products');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ASSET_DIR, { recursive: true });
const TEMPLATE_PRODUCTS_FILE = path.join(ROOT, 'data', 'products.json');
if (!fs.existsSync(PRODUCTS_FILE) && fs.existsSync(TEMPLATE_PRODUCTS_FILE)) fs.copyFileSync(TEMPLATE_PRODUCTS_FILE, PRODUCTS_FILE);
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');

const sessions = new Map();

function send(res, status, data, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}
function json(res, status, obj, extra = {}) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
}
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
}
function readBody(req, limit = 5e6) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function safeJoin(p) {
  const full = path.normalize(path.join(ROOT, p));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}
function cookie(name, value, options = {}) {
  const sameSite = process.env.LEKHVI_COOKIE_SAMESITE || (IS_PRODUCTION ? 'None' : 'Lax');
  const secure = options.secure ?? IS_PRODUCTION;
  let s = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}`;
  if (options.maxAge != null) s += `; Max-Age=${options.maxAge}`;
  if (secure) s += '; Secure';
  return s;
}
function requireAdmin(req, res) {
  const sid = parseCookies(req).lekhvi_admin;
  const session = sid && sessions.get(sid);
  if (!session || session.expires < Date.now()) {
    if (sid) sessions.delete(sid);
    json(res, 401, { error: 'Admin authentication required' });
    return false;
  }
  session.expires = Date.now() + SESSION_TTL;
  return true;
}
function safeProduct(p) {
  return {
    id: Number(p.id), sku: p.sku || `LEK-${String(p.id).padStart(3, '0')}`,
    name: String(p.name || ''), titleStatus: p.titleStatus || 'example-title',
    collection: p.collection || 'Uncategorised', subcategory: p.subcategory || '',
    ageRange: p.ageRange || '', language: p.language || 'English', format: p.format || '',
    shortDescription: p.shortDescription || '', description: p.description || '',
    whatYouGet: Array.isArray(p.whatYouGet) ? p.whatYouGet : [], features: p.features || {},
    purpose: p.purpose || '', price: Number(p.price || 0), compareAt: Number(p.compareAt || 0),
    currency: p.currency || 'INR', samplePrice: !!p.samplePrice,
    variants: Array.isArray(p.variants) ? p.variants : [], rating: Number(p.rating || 0),
    sampleRating: !!p.sampleRating, images: Array.isArray(p.images) ? p.images : [],
    sampleCaption: p.sampleCaption || '', tags: Array.isArray(p.tags) ? p.tags : [],
    sourceBasis: p.sourceBasis || '', status: p.status || 'published',
    stock: Number.isFinite(Number(p.stock)) ? Number(p.stock) : 999, featured: !!p.featured,
    updatedAt: p.updatedAt || new Date().toISOString()
  };
}
function loadProducts() { return loadJson(PRODUCTS_FILE, []).map(safeProduct); }
function saveProducts(products) { saveJson(PRODUCTS_FILE, products.map(safeProduct)); }
function loadOrders() { return loadJson(ORDERS_FILE, []); }

function productStats(products) {
  const published = products.filter(p => p.status === 'published').length;
  const lowStock = products.filter(p => p.stock < 10).length;
  const draft = products.filter(p => p.status !== 'published').length;
  return { total: products.length, published, draft, lowStock };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true, service: 'lekhvi-api', time: new Date().toISOString() });

    // Public catalogue API: only published products are storefront-visible.
    if (req.method === 'GET' && p === '/api/products') {
      return json(res, 200, loadProducts().filter(x => x.status === 'published'));
    }

    if (req.method === 'POST' && p === '/api/orders') {
      const body = await readBody(req, 500000);
      const customer = body.customer || {};
      if (!String(customer.name || '').trim() || !String(customer.mobile || '').trim() || !String(customer.address || '').trim()) {
        return json(res, 400, { error: 'Name, mobile and address are required' });
      }
      const products = loadProducts().filter(x => x.status === 'published');
      const requested = Array.isArray(body.items) ? body.items : [];
      if (!requested.length) return json(res, 400, { error: 'Cart is empty' });
      const items = [];
      let total = 0;
      for (const item of requested) {
        const p = products.find(x => x.id === Number(item.id));
        if (!p) return json(res, 400, { error: `Product ${item.id} is unavailable` });
        const variantName = String(item.f || item.format || p.variants?.[0]?.name || '');
        const variant = (p.variants || []).find(v => v.name === variantName) || p.variants?.[0];
        if (!variant) return json(res, 400, { error: `Variant unavailable for product ${p.id}` });
        const qty = Math.max(1, Math.min(20, Number(item.q || item.qty || 1)));
        if (p.stock < qty) return json(res, 400, { error: `${p.name} has insufficient stock` });
        const unitPrice = Number(variant.price || p.price || 0);
        items.push({ id: p.id, name: p.name, variant: variant.name, qty, price: unitPrice });
        total += unitPrice * qty;
      }
      const orderId = `LEK-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const order = { orderId, customer: { name: String(customer.name).trim(), mobile: String(customer.mobile).trim(), email: String(customer.email || '').trim(), address: String(customer.address).trim() }, payment: String(body.payment || 'UPI'), items, total, status: 'PENDING_PAYMENT', createdAt: new Date().toISOString() };
      const orders = loadOrders(); orders.push(order); saveJson(ORDERS_FILE, orders);
      return json(res, 201, { ok: true, orderId, total, status: order.status });
    }

    if (req.method === 'GET' && p === '/api/admin/status') {
      const sid = parseCookies(req).lekhvi_admin;
      const s = sid && sessions.get(sid);
      return json(res, 200, { authenticated: !!s && s.expires > Date.now(), username: s?.username || null });
    }

    if (req.method === 'POST' && p === '/api/admin/login') {
      const body = await readBody(req, 100000);
      const user = String(body.username || '');
      const pass = String(body.password || '');
      const valid = user === ADMIN_USER && pass === ADMIN_PASSWORD;
      if (!valid) return json(res, 401, { error: 'Invalid username or password' });
      const sid = crypto.randomBytes(32).toString('hex');
      sessions.set(sid, { username: user, expires: Date.now() + SESSION_TTL });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('lekhvi_admin', sid, { maxAge: SESSION_TTL / 1000 }) });
    }

    if (req.method === 'POST' && p === '/api/admin/logout') {
      const sid = parseCookies(req).lekhvi_admin;
      if (sid) sessions.delete(sid);
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('lekhvi_admin', '', { maxAge: 0 }) });
    }

    if (p.startsWith('/api/admin/')) {
      if (!requireAdmin(req, res)) return;

      if (req.method === 'GET' && p === '/api/admin/stats') {
        const products = loadProducts(); const orders = loadOrders();
        const paid = orders.filter(o => ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(o.status));
        const revenue = paid.reduce((sum, o) => sum + Number(o.total || 0), 0);
        return json(res, 200, { products: productStats(products), orders: orders.length, revenue });
      }

      if (req.method === 'GET' && p === '/api/admin/products') {
        const products = loadProducts();
        const q = String(url.searchParams.get('q') || '').toLowerCase();
        const status = String(url.searchParams.get('status') || 'all');
        const filtered = products.filter(x => (!q || [x.name, x.sku, x.collection, x.subcategory].join(' ').toLowerCase().includes(q)) && (status === 'all' || x.status === status));
        return json(res, 200, filtered);
      }

      if (req.method === 'POST' && p === '/api/admin/products') {
        const body = await readBody(req);
        const products = loadProducts();
        const id = products.length ? Math.max(...products.map(x => Number(x.id))) + 1 : 1;
        const product = safeProduct({ ...body, id, sku: body.sku || `LEK-${String(id).padStart(3, '0')}`, updatedAt: new Date().toISOString() });
        products.push(product); saveProducts(products);
        return json(res, 201, product);
      }

      const pm = p.match(/^\/api\/admin\/products\/(\d+)$/);
      if (pm && req.method === 'PUT') {
        const id = Number(pm[1]); const body = await readBody(req); const products = loadProducts();
        const idx = products.findIndex(x => x.id === id); if (idx < 0) return json(res, 404, { error: 'Product not found' });
        products[idx] = safeProduct({ ...products[idx], ...body, id, updatedAt: new Date().toISOString() });
        saveProducts(products); return json(res, 200, products[idx]);
      }
      if (pm && req.method === 'DELETE') {
        const id = Number(pm[1]); const products = loadProducts(); const idx = products.findIndex(x => x.id === id);
        if (idx < 0) return json(res, 404, { error: 'Product not found' });
        products.splice(idx, 1); saveProducts(products); return json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/api/admin/upload') {
        const body = await readBody(req, 12e6);
        const id = Number(body.productId);
        const kind = String(body.kind || 'sample').replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'sample';
        const dataUrl = String(body.dataUrl || '');
        const m = dataUrl.match(/^data:(image\/(png|jpe?g|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/i);
        if (!m) return json(res, 400, { error: 'Only PNG, JPG, WEBP or SVG image data is supported' });
        const extMap = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', 'svg+xml': 'svg' };
        const ext = extMap[m[2].toLowerCase()];
        const filename = `p${String(id).padStart(3, '0')}-${kind}.${ext}`;
        const target = path.join(ASSET_DIR, filename);
        fs.writeFileSync(target, Buffer.from(m[3].replace(/\s/g, ''), 'base64'));
        const url = `${PUBLIC_BASE_URL}/uploads/products/${filename}` || `uploads/products/${filename}`;
        return json(res, 201, { ok: true, url });
      }

      if (req.method === 'GET' && p === '/api/admin/orders') return json(res, 200, loadOrders());

      const om = p.match(/^\/api\/admin\/orders\/([^/]+)$/);
      if (om && req.method === 'PATCH') {
        const body = await readBody(req, 100000); const orders = loadOrders();
        const idx = orders.findIndex(o => String(o.orderId) === decodeURIComponent(om[1]));
        if (idx < 0) return json(res, 404, { error: 'Order not found' });
        const allowed = ['PENDING_PAYMENT','PAID','PROCESSING','SHIPPED','DELIVERED','CANCELLED','REFUNDED'];
        if (body.status && allowed.includes(body.status)) orders[idx].status = body.status;
        if (body.note != null) orders[idx].adminNote = String(body.note).slice(0, 2000);
        orders[idx].updatedAt = new Date().toISOString(); saveJson(ORDERS_FILE, orders);
        return json(res, 200, orders[idx]);
      }
    }

    // Persistent uploaded product images.
    if (p.startsWith('/uploads/products/')) {
      const rel = p.slice('/uploads/products/'.length);
      const filePath = path.normalize(path.join(ASSET_DIR, rel));
      if (!filePath.startsWith(ASSET_DIR + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, 'Not found');
      const ext = path.extname(filePath).toLowerCase();
      return send(res, 200, fs.readFileSync(filePath), mime[ext] || 'application/octet-stream', { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }

    // Static files.
    const staticPath = p === '/' ? '/index.html' : p;
    const file = safeJoin(decodeURIComponent(staticPath));
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    return send(res, 200, fs.readFileSync(file), mime[ext] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Server error', detail: process.env.NODE_ENV === 'development' ? e.message : undefined });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k);
}, 30 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Lekhvi standalone store: http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`Admin username: ${ADMIN_USER}`);
  if (ADMIN_PASSWORD === 'change-me-now') console.warn('WARNING: Set LEKHVI_ADMIN_PASSWORD before production use.');
});
