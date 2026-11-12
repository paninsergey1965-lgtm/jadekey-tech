// JadeKey Shop — Yandex Cloud Function (Node.js 18+)
// Env: YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
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
  const r = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json', 'Idempotence-Key': crypto.randomUUID() },
    body: JSON.stringify({
      amount: { value, currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: RETURN_URL },
      capture: true,
      description: 'JadeKey Shop: ' + p.name,
      metadata: { shop: '1', package: 'SHOP ' + b.id, name, email, phone, delivery, address, comment },
      receipt: { customer: { email }, items: [{ description: p.name, quantity: '1.00', amount: { value, currency: 'RUB' }, vat_code: 1, payment_subject: 'commodity', payment_mode: 'full_payment' }] },
    }),
  });
  const d = await r.json();
  if (d.confirmation && d.confirmation.confirmation_url) return [200, { paymentUrl: d.confirmation.confirmation_url }];
  return [502, { message: 'Платёжная система не приняла заказ. Напишите нам: jadekey1965@gmail.com' }];
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
