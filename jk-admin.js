// JadeKey admin client tools. No live release until restrictive rules have
// been published and verified. All edits and audit entries use one commit.

function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  return { stringValue: String(v) };
}
function asDocument(data) {
  return { fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fsValue(v)])) };
}
const safe = v => String(v ?? '').toLowerCase();

export function initJadeKeyAdmin(ctx) {
  const root = `projects/${ctx.project}/databases/(default)/documents`;
  const api = `https://firestore.googleapis.com/v1/${root}`;
  const groups = () => {
    const all = ctx.getStones();
    const catalog = new Map();
    for (const s of all.filter(s => !s.mode && !s.of && s.g)) {
      if (!catalog.has(s.g)) catalog.set(s.g, []);
      catalog.get(s.g).push(s);
    }
    return all.filter(s => s.mode && !s.of && s.owner).map(s => ({
      main: s, sides: all.filter(b => b.of === s.id && b.mode),
      catalog: catalog.get(s.g)?.length === 1 ? catalog.get(s.g)[0] : null
    }));
  };
  let clients = [], details = new Map(), listing = false;

  async function apiCall(method, suffix, payload) {
    if (!ctx.isAdmin()) throw new Error('Нужен вход администратора');
    const token = await ctx.getAdminToken();
    if (!token) throw new Error('Сессия администратора истекла');
    const url = `${api}${suffix}${suffix.includes('?') ? '&' : '?'}key=${encodeURIComponent(ctx.firebaseKey)}`;
    const response = await fetch(url, { method, headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`
    }, body: payload ? JSON.stringify(payload) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error?.message || `HTTP ${response.status}`);
    return data;
  }

  async function loadClients() {
    const result = []; let page = '';
    do {
      const suffix = `/jk2_clients?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
      const data = await apiCall('GET', suffix);
      for (const d of data.documents || []) result.push({ uid: d.name.split('/').pop(), ...ctx.fromFs(d.fields) });
      page = data.nextPageToken || '';
    } while (page);
    clients = result.filter(c => c.verified === true);
  }

  async function readName(s) {
    if (details.has(s.id)) return details.get(s.id);
    let name = '';
    try {
      const doc = await apiCall('GET', `/jk2_private/${encodeURIComponent(s.id)}`);
      const privateDoc = ctx.fromFs(doc.fields);
      const profile = JSON.parse(privateDoc.profile || '{}');
      name = profile.name || profile.to || '';
    } catch (_) { name = s.name && s.name !== 'Живой камень' ? s.name : ''; }
    details.set(s.id, name);
    return name;
  }

  function rows() {
    const index = new Map(clients.map(c => [c.uid, c]));
    const grouped = new Map();
    for (const g of groups()) {
      const uid = g.main.owner;
      if (!grouped.has(uid)) grouped.set(uid, { uid, email: index.get(uid)?.email || '', stones: [], name: '' });
      grouped.get(uid).stones.push(g);
    }
    for (const c of clients) if (!grouped.has(c.uid)) grouped.set(c.uid, { uid: c.uid, email: c.email, stones: [], name: '' });
    return [...grouped.values()].sort((a, b) => a.email.localeCompare(b.email) || a.uid.localeCompare(b.uid));
  }

  async function open() {
    if (listing || !ctx.isAdmin()) return;
    listing = true;
    ctx.sheet('<div class="sh-name">Клиенты JadeKey</div><p class="sub">Загружаю сведения…</p>');
    try {
      await loadClients();
      // An unlinked owner has no email. Names come from private records,
      // never from the public scanner index.
      for (const g of groups()) await readName(g.main);
      render();
    } catch (e) {
      ctx.sheet(`<div class="sh-name">Клиенты</div><p class="sub">${ctx.esc(e.message)}</p><button class="btn" id="cliRetry">Повторить</button>`);
      document.getElementById('cliRetry').onclick = () => { listing = false; open(); };
    } finally { listing = false; }
  }

  function render(query = '') {
    const all = rows();
    const found = q => all.filter(c => !q || [c.uid, c.email, ...c.stones.flatMap(g => [
      details.get(g.main.id) || '', g.main.id, g.catalog?.jk || ''
    ])].some(x => safe(x).includes(safe(q).trim())));
    const listHtml = q => found(q).map(c => `<button class="row" data-uid="${ctx.esc(c.uid)}"><span>
        <b>${ctx.esc(c.email || c.stones.map(g => details.get(g.main.id)).find(Boolean) || 'Без привязанной почты')}</b>
        <small>${c.stones.length} камн. · ${ctx.esc(c.uid)}</small></span></button>`).join('') ||
      (all.length ? '<p class="sub">Ничего не найдено</p>' : '<p class="sub">Клиентов пока нет. Сначала оживи тестовый камень как покупатель. После привязки почты здесь появится адрес клиента.</p>');
    ctx.sheet(`<div class="sh-head"><div><div class="sh-state">Администратор</div><div class="sh-name">Клиенты · ${all.length}</div></div></div>
      <input class="fld" id="cliSearch" placeholder="Почта, имя, JK-номер" value="${ctx.esc(query)}">
      <p class="sub">Почта доступна только после подтверждения. Пустая почта означает, что клиент ещё не привязал аккаунт.</p>
      <div class="rows" id="cliRows">${listHtml(query)}</div>
      <div class="btns"><button class="btn" id="cliClose">Закрыть</button></div>`);
    const bind = current => document.querySelectorAll('#cliRows [data-uid]').forEach(b => b.onclick = () => openClient(b.dataset.uid, current));
    const input = document.getElementById('cliSearch');
    input.oninput = () => { document.getElementById('cliRows').innerHTML = listHtml(input.value); bind(input.value); };
    bind(query);
    document.getElementById('cliClose').onclick = ctx.hideSheet;
  }

  function openClient(uid, query = '') {
    const c = rows().find(x => x.uid === uid);
    if (!c) return;
    ctx.sheet(`<div class="sh-head"><div><div class="sh-state">Клиент</div><div class="sh-name">${ctx.esc(c.email || 'Без почты')}</div></div></div>
      <p class="sub">UID: ${ctx.esc(uid)}</p>
      <div class="rows">${c.stones.map(g => `<button class="row" data-stone="${ctx.esc(g.main.id)}"><span>
        <b>${ctx.esc(details.get(g.main.id) || 'Живой камень')}</b>
        <small>${ctx.esc(g.catalog?.jk || g.main.id)} · ${ctx.esc(g.main.mode)}</small></span></button>`).join('') || '<p class="sub">Камни не найдены</p>'}</div>
      <button class="btn" id="cliBack">Назад к клиентам</button>`);
    document.querySelectorAll('#sheet [data-stone]').forEach(b => b.onclick = () => openStone(c.stones.find(g => g.main.id === b.dataset.stone), uid, query));
    document.getElementById('cliBack').onclick = () => render(query);
  }

  async function commit(writes, event, stone, ownerBefore, ownerAfter, detail = '') {
    const logId = crypto.randomUUID();
    writes.push({ update: { name: `${root}/jk2_adminlog/${logId}`, ...asDocument({
      action: event, stoneId: stone, ownerBefore, ownerAfter: ownerAfter || '',
      actorEmail: ctx.adminEmail, detail, created: Date.now()
    }) }, currentDocument: { exists: false } });
    await apiCall('POST', ':commit', { writes });
    details.clear();
    await ctx.loadStones();
    await loadClients();
  }

  function updateWrite(collection, id, patch) {
    return { update: { name: `${root}/${collection}/${id}`, ...asDocument(patch) },
      updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: { exists: true } };
  }
  const deleteWrite = (collection, id) => ({ delete: `${root}/${collection}/${id}`, currentDocument: { exists: true } });

  function openStone(group, uid, query = '') {
    if (!group) return;
    const s = group.main, modeOptions = Object.entries(ctx.modeNames).filter(([k]) => k !== 'mem');
    ctx.sheet(`<div class="sh-head"><div><div class="sh-state">Камень клиента</div><div class="sh-name">${ctx.esc(details.get(s.id) || 'Живой камень')}</div></div></div>
      <p class="sub">${ctx.esc(group.catalog?.jk || s.id)} · ${group.sides.length + 1} сторон(ы)</p>
      <label class="lbl" for="cliMode">Режим</label><select class="fld" id="cliMode">${modeOptions.map(([m, label]) => `<option value="${ctx.esc(m)}" ${m === s.mode ? 'selected' : ''}>${ctx.esc(label)}</option>`).join('')}</select>
      <div class="btns"><button class="btn main" id="cliModeSave">Сохранить режим</button></div>
      <div class="rows"><button class="row" id="cliTransfer"><span><b>Передать другому клиенту</b><small>Только на уже подтверждённую почту</small></span></button>
      <button class="row" id="cliReset"><span><b>Сбросить активацию</b><small>Регистрация камня и отпечаток остаются</small></span></button></div>
      <button class="btn" id="cliStoneBack">Назад</button>`);
    document.getElementById('cliStoneBack').onclick = () => openClient(uid, query);
    document.getElementById('cliModeSave').onclick = async () => {
      const mode = document.getElementById('cliMode').value;
      if (mode === s.mode) return ctx.toast('Режим не изменился');
      if (!confirm(`Сменить режим камня на «${ctx.modeNames[mode]}»?`)) return;
      try {
        await commit([s, ...group.sides].map(x => updateWrite('jk2_stones', x.id, { mode })), 'mode', s.id, uid, uid, `${s.mode} -> ${mode}`);
        ctx.toast('Режим изменён'); openClient(uid, query);
      } catch (e) { ctx.toast('Не удалось изменить: ' + e.message, 6500); }
    };
    document.getElementById('cliTransfer').onclick = async () => {
      const toEmail = prompt('Почта нового владельца (уже подтверждённая в JadeKey)');
      if (!toEmail) return;
      const matching = clients.filter(c => safe(c.email) === safe(toEmail.trim()) && c.uid !== uid);
      if (matching.length !== 1) return ctx.toast('Нужна одна подтверждённая почта другого клиента.');
      if (!confirm(`Передать камень ${group.catalog?.jk || s.id} клиенту ${matching[0].email}?`)) return;
      const nextUid = matching[0].uid;
      try {
        const writes = [s, ...group.sides].map(x => updateWrite('jk2_stones', x.id, { owner: nextUid }));
        writes.push(updateWrite('jk2_private', s.id, { owner: nextUid, recipient: '', claimTry: '' }));
        await commit(writes, 'transfer', s.id, uid, nextUid, matching[0].email);
        ctx.toast('Передача выполнена'); openClient(nextUid, query);
      } catch (e) { ctx.toast('Не удалось передать: ' + e.message, 6500); }
    };
    document.getElementById('cliReset').onclick = async () => {
      if (!group.catalog) return ctx.toast('Сначала проверь исходную регистрацию: не найден каталоговый отпечаток. Сброс заблокирован.', 6500);
      const exact = group.catalog.jk || s.id;
      const answer = prompt(`Это сбросит активацию ${exact} и удалит личные данные. Исходный каталог останется. Для подтверждения введи: СБРОС`);
      if (answer !== 'СБРОС') return;
      try {
        const writes = [deleteWrite('jk2_private', s.id)];
        for (const x of [s, ...group.sides]) writes.push(deleteWrite('jk2_patches', x.id), deleteWrite('jk2_stones', x.id));
        await commit(writes, 'reset', s.id, uid, '', `catalog=${group.catalog.id}; jk=${exact}`);
        ctx.toast('Активация сброшена, каталог сохранён'); openClient(uid, query);
      } catch (e) { ctx.toast('Сброс не выполнен: ' + e.message, 6500); }
    };
  }

  return { open };
}
