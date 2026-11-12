"""Poll YooKassa for new paid orders and send them to Telegram.
Runs on GitHub Actions (Russian clouds can't reach Telegram, YooKassa can't reach Cloudflare).
Env: YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, STATE (path to seen.json)"""
import base64, datetime as dt, json, os, urllib.parse, urllib.request

E = os.environ
AUTH = 'Basic ' + base64.b64encode(f"{E['YOOKASSA_SHOP_ID']}:{E['YOOKASSA_SECRET_KEY']}".encode()).decode()
STATE = E.get('STATE', 'seen.json')
DELIVERY = {'pickup': 'Самовывоз, Москва', 'cdek': 'СДЭК по России', 'post': 'Почта России'}

def get(url):
    req = urllib.request.Request(url, headers={'Authorization': AUTH})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def tg(text):
    data = json.dumps({'chat_id': E['TELEGRAM_CHAT_ID'], 'text': text}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{E['TELEGRAM_BOT_TOKEN']}/sendMessage", data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get('ok')

first = not os.path.exists(STATE)
seen = set() if first else set(json.load(open(STATE)))
now = dt.datetime.now(dt.timezone.utc)
since = (now - dt.timedelta(days=3)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
items, cursor = [], None
while True:
    q = {'status': 'succeeded', 'created_at.gte': since, 'limit': 100}
    if cursor: q['cursor'] = cursor
    d = get('https://api.yookassa.ru/v3/payments?' + urllib.parse.urlencode(q))
    items += d.get('items', [])
    cursor = d.get('next_cursor')
    if not cursor: break

sent = 0
for p in sorted(items, key=lambda x: x['created_at']):
    if p['id'] in seen: continue
    created = dt.datetime.fromisoformat(p['created_at'].replace('Z', '+00:00'))
    if first and now - created > dt.timedelta(hours=6):
        seen.add(p['id']); continue          # don't flood with old payments on the very first run
    m = p.get('metadata') or {}
    t = f"Оплачено {p['amount']['value']} ₽\n{p.get('description') or m.get('package', '')}"
    for k, label in (('name', ''), ('phone', 'Тел: '), ('email', '')):
        if m.get(k): t += f"\n{label}{m[k]}"
    addr = m.get('address') or ''
    if addr.startswith('Почта России: '):
        m['delivery'], m['address'] = 'post', addr[len('Почта России: '):]
    if m.get('delivery'): t += f"\nДоставка: {DELIVERY.get(m['delivery'], m['delivery'])}"
    if m.get('address'): t += f"\nАдрес: {m['address']}"
    if m.get('comment'): t += f"\nКомментарий: {m['comment']}"
    if tg(t):
        seen.add(p['id']); sent += 1
json.dump(sorted(seen), open(STATE, 'w'))
print('payments', len(items), 'sent', sent)
