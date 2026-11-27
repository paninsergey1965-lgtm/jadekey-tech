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
const DELIVERY = { pickup: 'Самовывоз, Москва', cdek: 'СДЭК по России', post: 'Почта России' };
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

const crypto = require('node:crypto');
const STONE_PRICES = { love: 2900, luna: 3500, tal: 4200, path: 5500 };
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const field = (doc, name) => doc?.fields?.[name]?.stringValue || '';

async function updateInventory(doc, changes) {
  const values = Object.fromEntries(Object.entries(changes).map(([k,v]) => [k, { stringValue: v }]));
  await fs('POST', ':commit', { writes: [{ update: { name: doc.name, fields: values },
    updateMask: { fieldPaths: Object.keys(values) }, currentDocument: { updateTime: doc.updateTime } }] });
}

async function settleStone(payment) {
  const { stoneId, reserve, stoneMode } = payment.metadata || {};
  if (!/^[a-zA-Z0-9]{20}$/.test(stoneId || '') || !Object.hasOwn(STONE_PRICES, stoneMode)) return;
  const doc = await fs('GET', '/jk2_stones/' + stoneId);
  if (field(doc, 'shopState') !== 'reserved' || field(doc, 'shopReserve') !== reserve) return;
  if (payment.status === 'canceled') {
    await updateInventory(doc, { shopState: 'available', shopReserve: '', shopPayment: '' });
  } else if (payment.status === 'succeeded' && payment.amount?.currency === 'RUB' &&
             Number(payment.amount.value) === Number(field(doc,'shopReservedPrice') || STONE_PRICES[stoneMode])) {
    await updateInventory(doc, { shopState: 'sold', buy: stoneMode, shopPayment: payment.id });
  }
}

async function payStone(b) {
  const { sid, mode, attempt } = b;
  if (!/^[A-Za-z0-9]{20}$/.test(sid || '') || !Object.hasOwn(STONE_PRICES, mode) ||
      !/^[a-f0-9-]{36}$/.test(attempt || '')) return [400, { message: 'Некорректный заказ.' }];
  if (!s(b.name,80) || !s(b.phone,30) || !/^\S+@\S+\.\S+$/.test(s(b.email,100)) ||
      !['post','cdek'].includes(b.delivery) || !s(b.address,200) || !b.termsAccepted) {
    return [400,{ message:'Заполните контактные данные, доставку и согласие.' }];
  }
  let doc = await fs('GET', '/jk2_stones/' + sid);
  const code = [field(doc,'jk'),field(doc,'name')].find(x => /^L[ -]?\d+$/i.test(x.trim()));
  const configured = JSON.parse(field(doc,'shopPrices') || '{}');
  const price = field(doc,'shopState') === 'reserved'
    ? Number(field(doc,'shopReservedPrice') || STONE_PRICES[mode])
    : (configured[mode] ?? STONE_PRICES[mode]);
  if (!Number.isSafeInteger(price) || price < 1) return [409,{message:'Цена недоступна.'}];
  if (!code || field(doc,'owner') || field(doc,'mode') || field(doc,'of')) return [400,{message:'Камень не продаётся.'}];
  const key = digest(JSON.stringify([sid, mode, attempt, s(b.name,80),s(b.phone,30),s(b.email,100),b.delivery,s(b.address,200),s(b.comment,200)]));
  const reserve = digest(key);
  if (!field(doc,'shopPreview')) return [409,{message:'Камень не опубликован.'}];
  const state = field(doc,'shopState');
  if (state === 'available') {
    const shown = b.displayedPrice ?? STONE_PRICES[mode];
    if (shown !== price) return [409,{message:'Цена изменилась. Обновите карточку камня перед оплатой.'}];
    try { await updateInventory(doc, { shopState:'reserved', shopReserve:reserve, shopPayment:'', shopReservedPrice:String(price), shopReservedAt:String(Date.now()) }); }
    catch (e) {
      doc = await fs('GET','/jk2_stones/' + sid);
      if (field(doc,'shopState') !== 'reserved' || field(doc,'shopReserve') !== reserve || Number(field(doc,'shopReservedPrice') || STONE_PRICES[mode]) !== price) return [409,{message:'Данные изменились. Обновите карточку камня.'}];
    }
  } else if (state !== 'reserved' || field(doc,'shopReserve') !== reserve) {
    return [409,{message:'Этот камень уже куплен или зарезервирован.'}];
  } else if (field(doc,'shopPayment')) {
    const payment = await getPayment(field(doc,'shopPayment'));
    await settleStone(payment);
    if (payment.status === 'pending' && payment.confirmation?.confirmation_url) return [200,{paymentUrl:payment.confirmation.confirmation_url}];
    return [409,{newAttempt:payment.status === 'canceled',message:payment.status === 'succeeded' ? 'Заказ уже оплачен.' : 'Платёж завершён. Обновите страницу.'}];
  } else if (Date.now()-Number(field(doc,'shopReservedAt')) > 23*3600000) {
    return [409,{message:'Статус предыдущей попытки уточняется. Свяжитесь с магазином.'}];
  }
  const result = await createPayment(b,{name:'Камень '+code+' · '+NAMES[mode],price},key,{stoneId:sid,stoneMode:mode,reserve});
  if (result[0] === 200) {
    const fresh = await fs('GET','/jk2_stones/'+sid);
    if (field(fresh,'shopState') === 'reserved' && field(fresh,'shopReserve') === reserve && !field(fresh,'shopPayment')) {
      await updateInventory(fresh,{shopPayment:result[1].paymentId});
    }
    delete result[1].paymentId;
  }
  if (result[0] === 422) {
    const fresh = await fs('GET','/jk2_stones/'+sid);
    if (field(fresh,'shopState') === 'reserved' && field(fresh,'shopReserve') === reserve && !field(fresh,'shopPayment')) {
      await updateInventory(fresh,{shopState:'available',shopReserve:''});
    }
  }
  return result;
}
async function getPayment(id) {
  const r = await fetch('https://api.yookassa.ru/v3/payments/' + encodeURIComponent(id),{headers:{Authorization:auth()}});
  if (!r.ok) throw new Error('Не удалось сверить платёж');
  return r.json();
}
async function pay(b) {
  if (b.id === 'catalog-stone') return payStone(b);
  const p = (await loadItems())[b.id];
  if (!p || !(p.price > 0)) return [400, { message: 'Такого камня нет или он уже продан.' }];
  return createPayment(b,p,crypto.randomUUID(),{});
}
async function createPayment(b,p,key,stoneMeta) {
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
    headers: { Authorization: auth(), 'Content-Type': 'application/json', 'Idempotence-Key': key },
    body: JSON.stringify({
      amount: { value, currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: RETURN_URL },
      capture: true,
      description: 'JadeKey Shop: ' + p.name,
      metadata: { shop: '1', package: 'SHOP ' + b.id, name, email, phone, delivery, address, comment, ...upm, ...stoneMeta },
      receipt: { customer: { email }, items: [{ description: p.name, quantity: '1.00', amount: { value, currency: 'RUB' }, vat_code: 1, payment_subject: 'commodity', payment_mode: 'full_payment' }] },
    }),
  });
  const d = await r.json();
  if (stoneMeta.stoneId && d.status === 'canceled') {
    await settleStone(d);
    return [409,{newAttempt:true,message:'Предыдущий платёж отменён. Можно оформить заказ снова.'}];
  }
  if (d.confirmation && d.confirmation.confirmation_url) return [200, { paymentUrl: d.confirmation.confirmation_url, ...(stoneMeta.stoneId ? {paymentId:d.id} : {}) }];
  if (r.status === 400 && d.type === 'error' && d.code === 'invalid_request') return [422,{message:'Проверьте данные заказа и попробуйте снова.'}];
  return [502, { message: 'Платёжная система не приняла заказ. Напишите нам: jadekey1965@gmail.com' }];
}

// ---------- Firestore with a service account (rules don't apply to it) ----------
const FS_DB = () => 'https://firestore.googleapis.com/v1/projects/' + SA().project_id + '/databases/(default)/documents';
let _sa = null, _tok = null, _tokExp = 0;
function SA() {
  if (_sa) return _sa;
  const raw = process.env.FIREBASE_SA.trim();
  _sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString());
  if (_sa.project_id !== "jadekey-46f37") { _sa = null; throw new Error("wrong-project"); }
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
  if (!['payment.succeeded','payment.canceled'].includes(b.event) || !b.object || !b.object.id) return [200, 'ok'];
  // never trust the notification body: re-read the payment from YooKassa
  const r = await fetch('https://api.yookassa.ru/v3/payments/' + encodeURIComponent(b.object.id), { headers: { Authorization: auth() } });
  const o = await r.json();
  if (!r.ok) throw new Error('Не удалось проверить оплату');
  if (o.metadata?.stoneId) await settleStone(o);
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

let nextInventoryCheck = 0;
async function shopInventory() {
  const fields = ['shopState','shopPreview','jk','name','owner','mode','of'];
  // Reconcile lost notifications using provider status; elapsed time alone never releases a stone.
  if (Date.now() >= nextInventoryCheck) {
    nextInventoryCheck = Date.now()+60000;
    const reserved = await fs('POST',':runQuery',{structuredQuery:{
      from:[{collectionId:'jk2_stones'}],select:{fields:[{fieldPath:'shopPayment'}]},
      where:{fieldFilter:{field:{fieldPath:'shopState'},op:'EQUAL',value:str('reserved')}}}});
    await Promise.allSettled(reserved.filter(x=>field(x.document,'shopPayment')).map(async x=>
      settleStone(await getPayment(field(x.document,'shopPayment')))));
  }
  const docs = await fs('POST',':runQuery',{structuredQuery:{
    from:[{collectionId:'jk2_stones'}],select:{fields:fields.map(fieldPath=>({fieldPath}))},
    where:{fieldFilter:{field:{fieldPath:'shopState'},op:'IN',value:{arrayValue:{
      values:['available','sold'].map(stringValue=>({stringValue}))}}}}
  }});
  return docs.map(x=>x.document).filter(doc=>doc && !field(doc,'owner') && !field(doc,'mode') && !field(doc,'of'))
    .map(doc=>({id:doc.name.split('/').pop(), name:[field(doc,'jk'),field(doc,'name')].find(v=>/^L[ -]?\d+$/i.test(v)),
      photo:field(doc,'shopPreview'),state:field(doc,'shopState')}))
    .filter(x=>x.name && x.photo.startsWith('data:image/jpeg;base64,'));
}

module.exports.handler = async (event) => {
  const origin = (event.headers && (event.headers.Origin || event.headers.origin)) || '';
  const cors = {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (event.httpMethod === 'GET' && event.queryStringParameters?.pricing === '1') return {statusCode:200,headers:{...cors,'Cache-Control':'no-store'},body:JSON.stringify({stonePricing:1})};
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod === 'GET' && event.queryStringParameters?.inventory === '1' && process.env.FIREBASE_SA) {
    try { return {statusCode:200,headers:{...cors,'Cache-Control':'no-store'},body:JSON.stringify({version:1,stones:await shopInventory()})}; }
    catch (e) {
      let reason = 'internal';
      if (e instanceof SyntaxError) reason = 'json';
      else if (e.message === 'wrong-project') reason = 'project';
      else if (/^база [0-9]{3}/.test(e.message)) reason = 'firestore-' + e.message.slice(5,8);
      else if (e.message.startsWith('Google не выдал доступ')) reason = 'google-auth';
      else if (e.message === 'fetch failed') reason = 'network';
      else if (e.code?.startsWith('ERR_OSSL') || e.code === 'ERR_INVALID_ARG_TYPE') reason = 'signing';
      return {statusCode:503,headers:cors,body:JSON.stringify({message:'Каталог временно недоступен.',reason})};
    }
  }
  if (event.httpMethod !== 'POST') return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, service: 'jadekey-shop', inventoryVersion: process.env.FIREBASE_SA ? 1 : 0 }) };
  let b = {};
  try { b = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body || '{}'); } catch (e) {}
  try {
    const [code, res] = b.event ? await webhook(b) : await pay(b);
    return { statusCode: code, headers: cors, body: typeof res === 'string' ? res : JSON.stringify(res) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ message: 'Ошибка сервера. Попробуйте ещё раз.' }) };
  }
};
