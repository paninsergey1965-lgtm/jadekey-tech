// JadeKey Shop — Yandex Cloud Function (Node.js 18+)
// Env: YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Optional: FIREBASE_SA — Firebase service-account JSON (whole file, or base64 of it).
//   With it, a paid mode change (up:<from>-<to> with a stone id) is applied to the stone automatically.
// POST {id,name,phone,email,delivery,address,comment} -> {paymentUrl}
// POST from YooKassa {event,object} -> Telegram notification (payment re-checked via API)

// Catalog lives on the site: https://jadekey.tech/shop/items.json  ({id: {name, price}})
// Edit that file to add goods or change prices — no need to touch this function.
const ITEMS_URL = 'https://jadekey.tech/shop/items.json';
async function loadItems() {
  const r = await fetch(ITEMS_URL + '?t=' + Date.now());
  if (!r.ok) throw new Error('catalog ' + r.status);
  return r.json();
}
const DELIVERY = { pickup: 'Самовывоз, Москва', cdek: 'СДЭК по России' };
const ORIGINS = ['https://jadekey.tech', 'http://localhost:8765'];
const RETURN_URL = 'https://jadekey.tech/shop/thanks.html?paid=1';

const auth = () => 'Basic ' + Buffer.from(process.env.YOOKASSA_SHOP_ID + ':' + process.env.YOOKASSA_SECRET_KEY).toString('base64');
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

async function telegram(text) {
  try {
    await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
    });
  } catch (e) {}
}

async function pay(b) {
  const p = (await loadItems())[b.id];
  if (!p || !(p.price > 0)) return [400, { message: 'Такого камня нет или он уже продан.' }];
  const name = s(b.name, 80), phone = s(b.phone, 30), email = s(b.email, 100);
  const delivery = DELIVERY[b.delivery] ? b.delivery : 'cdek';
  const address = s(b.address, 200), comment = s(b.comment, 200);
  if (!name || !phone || !/^\S+@\S+\.\S+$/.test(email)) return [400, { message: 'Заполните имя, телефон и почту.' }];
  if (delivery !== 'pickup' && !address) return [400, { message: 'Укажите адрес или пункт СДЭК.' }];
  const value = p.price.toFixed(2); // price always from the server
  const up = /^up:([a-z]+)-([a-z]+)$/.exec(b.id || '');
  const sid = up && /^[A-Za-z0-9]{10,40}$/.test(b.sid || '') ? b.sid : '';
  const upm = sid ? { sid, nm: s(b.nm, 40), bd: /^\d{4}-\d\d-\d\d$/.test(b.bd || '') ? b.bd : '', bt: /^\d\d:\d\d$/.test(b.bt || '') ? b.bt : '', bz: /^[A-Za-z_\/+\-|]{0,40}$/.test(b.bz || '') ? (b.bz || '') : '' } : {};
  const r = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json', 'Idempotence-Key': crypto.randomUUID() },
    body: JSON.stringify({
      amount: { value, currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: RETURN_URL },
      capture: true,
      description: 'JadeKey Shop: ' + p.name,
      metadata: { shop: '1', package: 'SHOP ' + b.id, name, email, phone, delivery, address, comment, ...upm },
      receipt: { customer: { email }, items: [{ description: p.name, quantity: '1.00', amount: { value, currency: 'RUB' }, vat_code: 1, payment_subject: 'commodity', payment_mode: 'full_payment' }] },
    }),
  });
  const d = await r.json();
  if (d.confirmation && d.confirmation.confirmation_url) return [200, { paymentUrl: d.confirmation.confirmation_url }];
  return [502, { message: 'Платёжная система не приняла заказ. Напишите нам: jadekey1965@gmail.com' }];
}

// ---------- Firestore with a service account (rules don't apply to it) ----------
const FS_DB = () => 'https://firestore.googleapis.com/v1/projects/' + SA().project_id + '/databases/(default)/documents';
let _sa = null, _tok = null, _tokExp = 0;
function SA() {
  if (_sa) return _sa;
  const raw = process.env.FIREBASE_SA.trim();
  _sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString());
  return _sa;
}
async function gToken() {
  if (_tok && Date.now() < _tokExp) return _tok;
  const sa = SA(), now = Math.floor(Date.now() / 1000), b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT' }), body = b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = require('crypto').createSign('RSA-SHA256').update(head + '.' + body).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + sig });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google не выдал доступ: ' + (j.error_description || j.error || r.status));
  _tok = j.access_token; _tokExp = Date.now() + 50 * 60 * 1000;
  return _tok;
}
async function fs(method, path, body) {
  const r = await fetch(FS_DB() + path, { method, headers: { Authorization: 'Bearer ' + (await gToken()), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('база ' + r.status + (j.error && j.error.message ? ': ' + j.error.message : ''));
  return j;
}
const str = v => ({ stringValue: String(v) });
const NAMES = { fc: 'Печенье', love: 'Love', luna: 'Луна', tal: 'Талисман', path: 'Путь' };
async function applyMode(sid, from, to, m) {
  if (!NAMES[to]) throw new Error('неизвестный режим ' + to);
  const doc = await fs('GET', '/jk2_stones/' + sid);
  const cur = ((doc.fields || {}).mode || {}).stringValue || '';
  if ((cur === 'ny' ? 'luna' : cur) !== from) throw new Error('у камня сейчас режим «' + (NAMES[cur] || cur || '—') + '», а оплачен переход с «' + NAMES[from] + '»');
  let old = {};
  try { const pv = await fs('GET', '/jk2_private/' + sid); old = JSON.parse(((pv.fields || {}).profile || {}).stringValue || '{}'); } catch (e) {}
  const name = (m.nm || old.name || old.to || '').trim();
  if (!name) throw new Error('нет имени владельца');
  const bday = m.bd || old.bday || '', btime = m.bt || old.btime || '', btz = m.bz || old.btz || '';
  if (to === 'path' && !bday) throw new Error('для «Пути» нет даты рождения');
  const prof = to === 'luna' ? { name, bday } : to === 'path' ? { name, bday, btime, btz, from: old.from || '' } : to === 'tal' ? { name, bday, btime, btz } : { to: old.to || name, from: old.from || '' };
  const pub = to === 'fc' || to === 'love' ? (old.to || name) : name;
  // the stone and its second side (docs with of == sid)
  const q = await fs('POST', ':runQuery', { structuredQuery: { from: [{ collectionId: 'jk2_stones' }], where: { fieldFilter: { field: { fieldPath: 'of' }, op: 'EQUAL', value: str(sid) } } } });
  const ids = [sid].concat((q || []).filter(x => x.document).map(x => x.document.name.split('/').pop()));
  for (const id of ids) await fs('PATCH', '/jk2_stones/' + id + '?updateMask.fieldPaths=mode&updateMask.fieldPaths=name', { fields: { mode: str(to), name: str(pub) } });
  // keep everything the stone already had (names, dates) — cheaper modes stay available to switch back to
  Object.keys(prof).forEach(k => { if (prof[k] === '' && old[k]) delete prof[k]; });
  await fs('PATCH', '/jk2_private/' + sid + '?updateMask.fieldPaths=profile', { fields: { profile: str(JSON.stringify(Object.assign({}, old, prof))) } });
  return 'Режим сменён автоматически: ' + NAMES[from] + ' → ' + NAMES[to] + ' (' + name + ')';
}

async function webhook(b) {
  if (b.event !== 'payment.succeeded' || !b.object || !b.object.id) return [200, 'ok'];
  // never trust the notification body: re-read the payment from YooKassa
  const r = await fetch('https://api.yookassa.ru/v3/payments/' + encodeURIComponent(b.object.id), { headers: { Authorization: auth() } });
  const o = await r.json();
  if (o.status !== 'succeeded') return [200, 'ok'];
  const m = o.metadata || {};
  let t = 'Оплачено ' + o.amount.value + ' ₽\n' + (o.description || m.package || '') + '\n' + (m.name || '') + '\n' + (m.email || '');
  if (m.shop) t += '\nТел: ' + (m.phone || '') + '\nДоставка: ' + (DELIVERY[m.delivery] || m.delivery || '') + (m.address ? '\nАдрес: ' + m.address : '') + (m.comment ? '\nКомментарий: ' + m.comment : '');
  const up = /^SHOP up:([a-z]+)-([a-z]+)$/.exec(m.package || '');
  if (up && m.sid) {
    if (!process.env.FIREBASE_SA) t += '\n⚙️ Автосмена выключена — смени вручную по ссылке выше';
    else {
      try { t += '\n✅ ' + (await applyMode(m.sid, up[1], up[2], m)); }
      catch (e) { t += '\n⚠️ Автоматически не сменилось: ' + e.message + '. Смени вручную по ссылке выше'; }
    }
  }
  t += '\n' + o.id;
  await telegram(t);
  return [200, 'ok'];
}

module.exports.handler = async (event) => {
  const origin = (event.headers && (event.headers.Origin || event.headers.origin)) || '';
  const cors = {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, service: 'jadekey-shop' }) };
  let b = {};
  try { b = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body || '{}'); } catch (e) {}
  try {
    const [code, res] = b.event ? await webhook(b) : await pay(b);
    return { statusCode: code, headers: cors, body: typeof res === 'string' ? res : JSON.stringify(res) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ message: 'Ошибка сервера. Попробуйте ещё раз.' }) };
  }
};
