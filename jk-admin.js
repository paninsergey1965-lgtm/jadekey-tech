// JadeKey admin client tools. Deploy with production Firestore private client
// index and append-only audit rules. Edits and audit entries use one commit.

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

  async function apiCall(method, suffix, payload, { allow404 = false, timeoutMs = 12000 } = {}) {
    if (!ctx.isAdmin()) throw new Error('Нужен вход администратора');
    const token = await ctx.getAdminToken();
    if (!token) throw new Error('Сессия администратора истекла');
    const url = `${api}${suffix}${suffix.includes('?') ? '&' : '?'}key=${encodeURIComponent(ctx.firebaseKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method, headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${token}`
      }, body: payload ? JSON.stringify(payload) : undefined, signal: controller.signal });
      if (allow404 && response.status === 404) return null;
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error?.message || `HTTP ${response.status}`);
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Сервер не ответил за отведённое время');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Read the activation itself, not the collection cache: loadStones() can
  // swallow read errors and temporarily display an empty collection.
  async function activationIsGone(stoneId) {
    return (await apiCall('GET', `/jk2_stones/${encodeURIComponent(stoneId)}`,
      undefined, { allow404: true, timeoutMs: 9000 })) === null;
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
    showUnlinked = false;
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

  let showUnlinked = false;
  const stoneLabel = g => g.catalog?.jk || g.catalog?.name || details.get(g.main.id) || 'Живой камень';
  const thumbnail = g => {
    const src = g.main.thumb || g.catalog?.thumb;
    return src ? `<img class="cli-thumb" loading="lazy" src="${ctx.esc(src)}" alt="">` : '';
  };

  function render(query = '') {
    const all = rows();
    const clientRow = c => {
      const name = c.email || c.stones.map(g => details.get(g.main.id)).find(Boolean) || 'Без привязанной почты';
      return `<button class="row cli-row" data-uid="${ctx.esc(c.uid)}"><span><b>${ctx.esc(name)}</b>
        <small>Камней: ${c.stones.length}</small></span>${c.stones.slice(0, 3).map(thumbnail).join('')}</button>`;
    };
    const listHtml = value => {
      const q = safe(value).trim();
      const matches = all.filter(c => !q || [c.uid, c.email, ...c.stones.flatMap(g => [
        details.get(g.main.id), g.main.id, g.catalog?.jk, g.catalog?.name
      ])].some(x => safe(x).includes(q)));
      if (!matches.length) return `<p class="sub">${q ? 'Ничего не найдено' : 'Клиентов пока нет'}</p>`;
      const unlinked = matches.filter(c => !c.email);
      return matches.filter(c => c.email).map(clientRow).join('') + (unlinked.length ?
        `<details id="cliUnlinked" ${q || showUnlinked ? 'open' : ''}><summary>Без подтверждённой почты · ${unlinked.length}</summary>
        <div class="rows">${unlinked.map(clientRow).join('')}</div></details>` : '');
    };
    ctx.sheet(`<div class="sh-head"><div class="sh-name">Клиенты · ${all.length}</div></div>
      <input class="fld" id="cliSearch" aria-label="Поиск клиентов и камней" placeholder="Почта, имя или номер камня" value="${ctx.esc(query)}">
      <div class="rows" id="cliRows">${listHtml(query)}</div>
      <div class="btns"><button class="btn" id="cliClose">Закрыть</button></div>`);
    const bind = current => {
      const section = document.getElementById('cliUnlinked');
      if (section && !current.trim()) section.ontoggle = () => { showUnlinked = section.open; };
      document.querySelectorAll('#cliRows [data-uid]').forEach(b => b.onclick = () => openClient(b.dataset.uid, current));
    };
    const input = document.getElementById('cliSearch');
    input.oninput = () => { document.getElementById('cliRows').innerHTML = listHtml(input.value); bind(input.value); };
    bind(query);
    document.getElementById('cliClose').onclick = ctx.hideSheet;
  }

  function openClient(uid, query = '') {
    const c = rows().find(x => x.uid === uid);
    if (!c) return;
    ctx.sheet(`<div class="sh-head"><div><div class="sh-state">Клиент</div><div class="sh-name">${ctx.esc(c.email || 'Без почты')}</div></div></div>

      <div class="rows">${c.stones.map(g => `<button class="row" data-stone="${ctx.esc(g.main.id)}">${thumbnail(g)}<span>
        <b>${ctx.esc(stoneLabel(g))}</b>
        <small>${ctx.esc(ctx.modeNames[g.main.mode] || g.main.mode)}</small></span></button>`).join('') || '<p class="sub">Камни не найдены</p>'}</div>
      <button class="btn" id="cliBack">Назад к клиентам</button>`);
    document.querySelectorAll('#sheet [data-stone]').forEach(b => b.onclick = () => openStone(c.stones.find(g => g.main.id === b.dataset.stone), uid, query));
    document.getElementById('cliBack').onclick = () => render(query);
  }

  async function commit(writes, event, stone, ownerBefore, ownerAfter, detail = '', refresh = true) {
    const logId = crypto.randomUUID();
    writes.push({ update: { name: `${root}/jk2_adminlog/${logId}`, ...asDocument({
      action: event, stoneId: stone, ownerBefore, ownerAfter: ownerAfter || '',
      actorEmail: ctx.adminEmail, detail, created: Date.now()
    }) }, currentDocument: { exists: false } });
    await apiCall('POST', ':commit', { writes });
    // The private profile survives mode changes and ownership corrections.
    // Do not replace its actual name with the generic public stone name.
    if (event === 'reset') details.delete(stone);
    if (refresh) {
      await ctx.loadStones();
      await loadClients();
    }
  }

  function updateWrite(collection, id, patch, updateTime = '') {
    return { update: { name: `${root}/${collection}/${id}`, ...asDocument(patch) },
      updateMask: { fieldPaths: Object.keys(patch) },
      currentDocument: updateTime ? { updateTime } : { exists: true } };
  }
  function deleteWrite(collection, id, requireExists = false) {
    const write = { delete: `${root}/${collection}/${id}` };
    // Auxiliary private/patch documents may already be missing. Requiring
    // each to exist would reject the *entire* atomic reset, including the
    // live stone. Only the main activation must still exist.
    if (requireExists) write.currentDocument = { exists: true };
    return write;
  }

  async function transferStone(group, fromUid, toUid, targetEmail) {
    if (fromUid === toUid) throw new Error('Выбери другого клиента');
    if (!group.catalog) throw new Error('Не найден однозначный исходный каталоговый камень; передача заблокирована');
    // Verify the destination using a fresh server read, not an old UI list.
    const targetDoc = await apiCall('GET', `/jk2_clients/${encodeURIComponent(toUid)}`);
    const target = ctx.fromFs(targetDoc.fields);
    if (target.owner !== toUid || target.verified !== true || target.email !== targetEmail) {
      throw new Error('У нового владельца нет подтверждённого адреса в базе');
    }

    // Updating from a cached collection is unsafe if another administrator
    // has already moved/reset this stone. Read all actual documents and use
    // Firestore updateTime preconditions for the entire atomic commit.
    const stones = [group.main, ...group.sides];
    const fresh = await Promise.all(stones.map(async stone => {
      const doc = await apiCall('GET', `/jk2_stones/${encodeURIComponent(stone.id)}`);
      const record = ctx.fromFs(doc.fields);
      if (record.owner !== fromUid || record.mode !== group.main.mode ||
          (stone.id === group.main.id ? !!record.of : record.of !== group.main.id)) {
        throw new Error('Владение или режим камня уже изменились. Обнови список');
      }
      if (!doc.updateTime) throw new Error('Не удалось подтвердить версию записи камня');
      return { id: stone.id, updateTime: doc.updateTime };
    }));
    const privateDoc = await apiCall('GET', `/jk2_private/${encodeURIComponent(group.main.id)}`,
      undefined, { allow404: true });
    if (!privateDoc) throw new Error('Отсутствует личная запись камня; передача заблокирована');
    if (ctx.fromFs(privateDoc.fields).owner !== fromUid || !privateDoc.updateTime) {
      throw new Error('Личные данные камня изменились. Обнови список');
    }

    const writes = fresh.map(x => updateWrite('jk2_stones', x.id, { owner: toUid }, x.updateTime));
    writes.push(updateWrite('jk2_private', group.main.id, {
      owner: toUid, recipient: '', claim: crypto.randomUUID().replace(/-/g, ''),
      claimTry: '', share: false
    }, privateDoc.updateTime));
    await commit(writes, 'transfer', group.main.id, fromUid, toUid,
      `catalog=${group.catalog.id}; target=${targetEmail}`, false);
    // A subsequent collection reload may hang on mobile. The atomic server
    // commit itself is already the confirmation; avoid letting UI appear stuck.
    let timer;
    try {
      const loaded = await Promise.race([
        Promise.all([ctx.loadStones(), loadClients()]).then(() => true, () => false),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), ctx.resetRefreshTimeoutMs ?? 8000); })
      ]);
      return loaded && ctx.getStones().find(x => x.id === group.main.id)?.owner === toUid;
    } finally { clearTimeout(timer); }
  }

  function openStone(group, uid, query = '') {
    if (!group) return;
    const s = group.main, modeOptions = Object.entries(ctx.modeNames).filter(([k]) => k !== 'mem');
    const targets = clients.filter(c => c.uid !== uid && c.verified === true && c.email)
      .sort((a, b) => a.email.localeCompare(b.email));
    ctx.sheet(`<div class="sh-head"><div><div class="sh-state">Камень клиента</div><div class="sh-name">${ctx.esc(details.get(s.id) || 'Живой камень')}</div></div></div>
      <p class="sub">${ctx.esc(group.catalog?.jk || s.id)} · ${group.sides.length + 1} сторон(ы)</p>
      <label class="lbl" for="cliMode">Режим</label><select class="fld" id="cliMode">${modeOptions.map(([m, label]) => `<option value="${ctx.esc(m)}" ${m === s.mode ? 'selected' : ''}>${ctx.esc(label)}</option>`).join('')}</select>
      <div class="btns"><button class="btn main" id="cliModeSave">Сохранить режим</button></div>
      ${targets.length ? `<div class="rows"><label class="lbl" for="cliTransferTo">Передать другому подтверждённому клиенту</label>
        <select class="fld" id="cliTransferTo"><option value="">Выбери почту нового владельца</option>${targets.map(c => `<option value="${ctx.esc(c.uid)}">${ctx.esc(c.email)}</option>`).join('')}</select>
        <p class="sub">Передаются все стороны и текущий профиль с личными данными. Старые подарочные ссылки отключаются. Передавай только с согласия владельца.</p>
        <button class="btn" id="cliTransfer">Передать камень</button><p class="sub" id="cliTransferStatus" role="status"></p></div>` : ''}
      <div class="rows"><button class="row" id="cliReset"><span><b>Сбросить активацию</b><small>Личные данные удалятся, исходный камень и отпечаток останутся</small></span></button></div>
      <p class="sub" id="cliResetStatus" role="status" style="display:none"></p>
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
    if (targets.length) document.getElementById('cliTransfer').onclick = async () => {
      const targetUid = document.getElementById('cliTransferTo').value;
      const target = targets.find(c => c.uid === targetUid);
      if (!target) return ctx.toast('Выбери подтверждённую почту получателя');
      const answer = prompt(`Передать ${group.catalog?.jk || s.id} клиенту ${target.email}? Все стороны и личный профиль перейдут новому владельцу. Старые ссылки будут отключены. Для подтверждения введи: ПЕРЕДАТЬ`);
      if (answer !== 'ПЕРЕДАТЬ') return;
      const button = document.getElementById('cliTransfer'), status = document.getElementById('cliTransferStatus');
      button.disabled = true;
      status.textContent = 'Проверяю владельца и передаю камень…';
      try {
        const refreshed = await transferStone(group, uid, targetUid, target.email);
        ctx.toast('Камень передан клиенту ' + target.email);
        if (refreshed) openClient(targetUid, query);
        else status.textContent = 'Передача подтверждена базой. Список ещё не обновился — обнови страницу.';
      } catch (e) {
        status.textContent = 'Не удалось подтвердить передачу: ' + e.message + '. Не повторяй без обновления списка.';
        ctx.toast(status.textContent, 6500);
        // An uncertain network failure may occur after the server committed.
        // Never offer a blind second transfer from stale browser data.
      }
    };
    document.getElementById('cliReset').onclick = async () => {
      if (!group.catalog) return ctx.toast('Сначала проверь исходную регистрацию: не найден каталоговый отпечаток. Сброс заблокирован.', 6500);
      const exact = group.catalog.jk || s.id;
      const answer = prompt(`Это сбросит активацию ${exact} и удалит личные данные. Исходный каталог останется. Для подтверждения введи: СБРОС`);
      if (answer !== 'СБРОС') return;
      const button = document.getElementById('cliReset');
      button.disabled = true;
      const status = document.getElementById('cliResetStatus');
      status.style.display = '';
      status.textContent = 'Отправляю сброс на сервер…';

      const writes = [deleteWrite('jk2_private', s.id)];
      for (const x of [s, ...group.sides]) writes.push(deleteWrite('jk2_patches', x.id));
      for (const x of group.sides) writes.push(deleteWrite('jk2_stones', x.id));
      writes.push(deleteWrite('jk2_stones', s.id, true));
      let commitError = null;
      try {
        // The Firestore commit includes one audit entry and is atomic.
        // Do not wait for a full collection reload to confirm deletion.
        await commit(writes, 'reset', s.id, uid, '', `catalog=${group.catalog.id}; jk=${exact}`, false);
      } catch (e) {
        // A connection timeout does not prove that Firestore rejected a write.
        // Read the original activation before ever offering another reset.
        commitError = e;
      }
      status.textContent = 'Проверяю результат в базе…';
      let gone;
      try {
        gone = await activationIsGone(s.id);
      } catch (e) {
        status.textContent = 'Не удалось проверить результат. Не нажимай сброс повторно. Обнови страницу и проверь камень: ' + e.message;
        ctx.toast('Результат сброса не подтверждён. Проверь после обновления страницы.', 6500);
        return;
      }
      if (!gone) {
        status.textContent = commitError
          ? 'Активация не сброшена: ' + commitError.message
          : 'Активация всё ещё существует в базе. Повтори позже после проверки.';
        button.disabled = false;
        ctx.toast(status.textContent, 6500);
        return;
      }

      status.textContent = 'Активация сброшена. Обновляю список…';
      ctx.toast('Активация сброшена, каталог сохранён');
      // A read can hang on a phone even after a successful Firestore commit.
      // Stop waiting after eight seconds; the user can reload the page.
      let timer;
      try {
        const refreshed = await Promise.race([
          Promise.all([ctx.loadStones(), loadClients()]).then(() => true, () => false),
          new Promise(resolve => { timer = setTimeout(() => resolve(false), ctx.resetRefreshTimeoutMs ?? 8000); })
        ]);
        if (refreshed && !ctx.getStones().some(x => x.id === s.id)) {
          openClient(uid, query);
        } else {
          status.textContent = 'Активация сброшена в базе. Список пока не обновился — обнови страницу.';
        }
      } finally {
        clearTimeout(timer);
      }
    };
  }

  return { open };
}
