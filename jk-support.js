// JadeKey support: FAQ first, then a private Firestore conversation with admin.
// Only escalated conversations are stored remotely. No paid AI service is used.

const CONTENT = {
  ru: {
    title: 'Поддержка JadeKey', intro: 'Здравствуйте! Помогу с камнем JadeKey. Что у вас случилось?',
    placeholder: 'Напишите вопрос…', send: 'Отправить', close: 'Закрыть',
    handoff: 'Передать администратору', handoffQuestion: 'Не получилось решить вопрос? Я могу передать переписку администратору JadeKey.',
    connecting: 'Передаю вопрос…', waiting: 'Вопрос передан администратору. Продолжайте писать здесь — ответ появится в этом окне.',
    failed: 'Не удалось передать вопрос. Проверьте интернет и повторите.',
    unknown: 'У меня нет надёжного ответа на этот вопрос.',
    activate: 'Откройте вкладку «Живой» → «Оживить камень». Положите камень на белый лист, отсканируйте, выберите режим и завершите активацию. Затем нажмите «Сохранить камень по почте».',
    light: 'Лучше сканировать при дневном свете у окна. Яркий прямой свет сверху создаёт блики, из-за которых сканер не узнаёт камень. Положите камень на белый лист и держите телефон прямо над ним.',
    account: 'Откройте «Живой» → «Войти на другом устройстве» и используйте подтверждённую почту и пароль. Если пароль забыли, нажмите «Забыли пароль?».',
    sale: 'Уточните, какой камень интересует и в каком городе его нужно получить. Наличие, цену и доставку при необходимости уточнит администратор.',
    guest: 'Покупатель', operator: 'Администратор', bot: 'Помощник', chats: 'Чаты',
    empty: 'Обращений пока нет.', refresh: 'Обновить', back: 'К обращениям', reply: 'Ответить',
    received: 'Сообщение отправлено', error: 'Не удалось выполнить действие'
  },
  en: {
    title: 'JadeKey Support', intro: 'Hello! I can help with your JadeKey stone. What happened?',
    placeholder: 'Type your question…', send: 'Send', close: 'Close',
    handoff: 'Contact support', handoffQuestion: 'Need more help? I can forward this conversation to JadeKey support.',
    connecting: 'Forwarding…', waiting: 'Your question has been sent. Continue here; the reply will appear in this chat.',
    failed: 'Could not send the question. Check your connection and try again.',
    unknown: 'I do not have a reliable answer to that question.',
    activate: 'Open “Live” → “Activate stone”. Place the stone on white paper, scan it, choose a mode and complete activation. Then select “Save stone by email”.',
    light: 'Scan in daylight near a window. Bright overhead lighting creates glare and prevents recognition. Place the stone on white paper and hold the phone directly above it.',
    account: 'Open “Live” → “Sign in on another device” with your verified email and password. Use “Forgot password?” if needed.',
    sale: 'Which stone are you interested in, and where should it be delivered? Support can confirm availability, pricing and shipping.',
    guest: 'Customer', operator: 'Support', bot: 'Assistant', chats: 'Chats',
    empty: 'No support requests yet.', refresh: 'Refresh', back: 'Back', reply: 'Reply',
    received: 'Message sent', error: 'Could not complete the request'
  },
  zh: {
    title: 'JadeKey 客服', intro: '您好！我可以帮助您使用 JadeKey 宝石。请问遇到了什么问题？',
    placeholder: '输入问题…', send: '发送', close: '关闭',
    handoff: '联系人工客服', handoffQuestion: '还需要帮助吗？我可以将对话转给 JadeKey 客服。',
    connecting: '正在转接…', waiting: '问题已发送给客服。您可以继续留言，回复会显示在这里。',
    failed: '发送失败，请检查网络后重试。', unknown: '对于这个问题，我暂时没有可靠答案。',
    activate: '打开“活石”→“激活宝石”。把宝石放在白纸上扫描，选择模式完成激活，然后点击“通过邮箱保存宝石”。',
    light: '建议在窗边使用自然光扫描。顶部强光会产生反光，影响识别。将宝石放在白纸上，手机正对宝石。',
    account: '打开“活石”→“在其他设备登录”，使用已验证的邮箱和密码。如忘记密码，请选择“忘记密码”。',
    sale: '请告诉我们您想购买哪颗宝石，以及收货城市。客服可以确认库存、价格和配送。',
    guest: '客户', operator: '客服', bot: '助手', chats: '客服消息',
    empty: '暂无客服消息。', refresh: '刷新', back: '返回', reply: '回复',
    received: '消息已发送', error: '操作失败'
  }
};

const KINDS = [
  { test: /почт|парол|кэш|кеш|восстанов|аккаунт|email|password|cache|recover|邮箱|密码|账户/i, key: 'account' },
  { test: /свет|блик|ламп|камер|узна|распозн|скан|light|glare|lamp|camera|recogn|scan|拍摄|识别|扫描|光线|反光/i, key: 'light' },
  { test: /ожив|актив|подар|activate|activation|gift|激活|礼物/i, key: 'activate' },
  { test: /стоим|цен|достав|заказ|купить|price|order|delivery|shipping|buy|价格|购买|配送/i, key: 'sale' }
];

export function classifySupportQuestion(question) {
  if (/оператор|администратор|человек|поддержк|связаться|human|operator|support agent|人工|客服/i.test(question)) return 'handoff';
  return KINDS.find(kind => kind.test.test(question))?.key || 'unknown';
}

export function initJadeKeySupport(ctx) {
  const lang = ['ru','en','zh'].includes(ctx.lang()) ? ctx.lang() : 'ru';
  const L = CONTENT[lang];
  const collection = 'jk2_support';
  const esc = ctx.esc;
  const log = [{ author: 'bot', text: L.intro }];
  let remote = false, active = false, busy = false, poll = null;
  let currentUid = null, currentThread = null;

  const style = document.createElement('style');
  style.textContent = `
    .jk-support-launch{position:fixed;right:15px;bottom:calc(var(--nav) + 18px + env(safe-area-inset-bottom));z-index:14;
      width:54px;height:54px;border-radius:50%;background:var(--jade);color:#061c14;font-size:27px;
      border:1px solid #fff3;box-shadow:0 4px 26px #0007}
    .jk-support-panel{position:fixed;z-index:25;right:10px;left:10px;bottom:calc(var(--nav) + 10px + env(safe-area-inset-bottom));
      max-width:520px;margin-left:auto;height:min(67dvh,650px);background:var(--panel);border:1px solid var(--line);
      border-radius:20px;display:flex;flex-direction:column;box-shadow:0 12px 40px #000a;overflow:hidden}
    .jk-support-panel[hidden]{display:none}.jk-support-head{display:flex;align-items:center;justify-content:space-between;
      padding:14px 16px;border-bottom:1px solid var(--line);font-weight:600}
    .jk-support-head button{font-size:25px;min-width:36px;min-height:36px}
    .jk-support-log{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
    .jk-support-msg{max-width:90%;padding:10px 12px;border-radius:14px;background:var(--bg);font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
    .jk-support-msg.mine{align-self:flex-end;background:#204b3e}.jk-support-msg small{display:block;color:var(--mute);font-size:11px;margin-bottom:3px}
    .jk-support-actions{padding:0 12px 8px}.jk-support-actions button{width:100%;font-size:14px;color:var(--jade);padding:9px;border:1px solid var(--line);border-radius:10px}
    .jk-support-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}
    .jk-support-form input{flex:1;min-width:0;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:12px;
      font:inherit;font-size:16px;color:var(--fg)}
    .jk-support-form button{padding:0 15px;background:var(--jade);color:#04150e;border-radius:11px;font-weight:600}
    .jk-support-form button:disabled{opacity:.5}.jk-support-admin-messages{max-height:43vh;overflow:auto;padding:5px 0}
    .jk-support-admin-bubble{background:var(--panel2);margin:7px 0;padding:10px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
    .jk-support-admin-bubble.mine{border-left:3px solid var(--jade)}
    .jk-support-admin-bubble small{display:block;color:var(--mute);margin-bottom:4px}
  `;
  document.head.append(style);
  const launcher = document.createElement('button');
  launcher.className = 'jk-support-launch'; launcher.type = 'button'; launcher.textContent = '✉';
  launcher.setAttribute('aria-label', L.title); document.body.append(launcher);
  const panel = document.createElement('div');
  panel.className = 'jk-support-panel'; panel.hidden = true;
  panel.innerHTML = `<div class="jk-support-head"><span>${esc(L.title)}</span><button type="button" id="jkSupportClose" aria-label="${esc(L.close)}">×</button></div>
    <div class="jk-support-log" id="jkSupportLog" aria-live="polite"></div>
    <div class="jk-support-actions" id="jkSupportActions"></div>
    <form class="jk-support-form" id="jkSupportForm"><input id="jkSupportInput" maxlength="1000" autocomplete="off" placeholder="${esc(L.placeholder)}" aria-label="${esc(L.placeholder)}"><button id="jkSupportSend" type="submit">${esc(L.send)}</button></form>`;
  document.body.append(panel);

  async function api(method, path, data, admin = false) {
    const token = admin ? await ctx.adminToken() : await ctx.clientToken();
    if (!token) throw new Error('Authentication required');
    const url = `https://firestore.googleapis.com/v1/projects/${ctx.project}/databases/(default)/documents/${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(ctx.firebaseKey)}`;
    const response = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: data ? JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k,v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) }])) }) : undefined
    });
    if (response.status === 404 && method === 'GET') return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) throw new Error(result.error?.message || `HTTP ${response.status}`);
    return result;
  }
  const unpack = d => ({ id: d?.name?.split('/').pop(), ...ctx.fromFs(d?.fields) });
  const id = () => crypto.randomUUID();
  const path = uid => `${collection}/${encodeURIComponent(uid)}`;
  const messagesPath = uid => `${path(uid)}/messages`;

  async function allMessages(uid, admin = false) {
    // Firestore's default list order is document ID, not creation time.
    // Fetch the latest messages so new replies never disappear after 100 posts.
    const result = await api('GET', `${messagesPath(uid)}?pageSize=100&orderBy=${encodeURIComponent('created desc')}`, null, admin);
    return (result?.documents || []).map(unpack).sort((a,b) => a.created - b.created);
  }
  function renderLog() {
    const root = panel.querySelector('#jkSupportLog');
    root.innerHTML = log.map(m => `<div class="jk-support-msg ${m.author === 'client' ? 'mine' : ''}"><small>${esc(m.author === 'client' ? L.guest : m.author === 'admin' ? L.operator : L.bot)}</small>${esc(m.text)}</div>`).join('');
    root.scrollTop = root.scrollHeight;
    panel.querySelector('#jkSupportActions').innerHTML = !remote && log.some(m => m.author === 'bot' && m.key === 'handoff')
      ? `<button type="button" id="jkSupportHandoff">${esc(L.handoff)}</button>` : '';
    panel.querySelector('#jkSupportHandoff')?.addEventListener('click', escalate);
  }
  function add(author, text, key = '') { log.push({ author, text, key }); renderLog(); }
  function setBusy(on) {
    busy = on;
    panel.querySelector('#jkSupportSend').disabled = on;
    panel.querySelector('#jkSupportHandoff')?.toggleAttribute('disabled', on);
  }
  async function refreshClient() {
    if (!active || !remote || busy) return;
    try {
      const uid = ctx.myUid(); if (!uid) return;
      const fromCloud = await allMessages(uid);
      // The remote thread becomes authoritative after the handoff.
      if (fromCloud.length && fromCloud.map(m => m.id).join('|') !== log.filter(m => m.id).map(m => m.id).join('|')) {
        log.length = 0;
        for (const m of fromCloud) log.push({ ...m, text: m.body });
        renderLog();
      }
    } catch (_) { /* keep the draft visible while offline */ }
  }
  async function findExisting() {
    try {
      const token = await ctx.clientToken(false); if (!token || !ctx.myUid()) return;
      const record = await api('GET', path(ctx.myUid()));
      if (record) { remote = true; await refreshClient(); }
    } catch (_) { /* the help bot remains usable without authentication */ }
  }
  async function sendRemote(body) {
    const uid = ctx.myUid(); if (!uid) throw new Error('No account');
    const msgId = id(), when = Date.now();
    const msg = await api('POST', `${messagesPath(uid)}?documentId=${msgId}`, { author: 'client', body, created: when });
    add('client', body); log[log.length - 1].id = msgId;
    try {
      await api('PATCH', `${path(uid)}?updateMask.fieldPaths=lastMessage&updateMask.fieldPaths=updated&updateMask.fieldPaths=status`,
        { lastMessage: body.slice(0,150), updated: when, status: 'waiting' });
    } catch (_) {
      // The message is already saved. Do not ask the customer to resend it.
      ctx.toast(L.received);
    }
    return msg;
  }
  async function escalate() {
    if (busy || remote) return;
    setBusy(true);
    const draft = [...log];
    try {
      await ctx.clientToken(true);
      const uid = ctx.myUid(); if (!uid) throw new Error('No account');
      const lastQuestions = log.filter(m => m.author === 'client').slice(-3).map(m => m.text);
      const body = (lastQuestions.join('\n\n') || 'Нужна помощь администратора').slice(0,1000);
      if (!(await api('GET', path(uid)))) {
        await api('POST', `${collection}?documentId=${encodeURIComponent(uid)}`, {
          ownerUid: uid, status: 'waiting', lastMessage: body.slice(0,150), updated: Date.now()
        });
      }
      remote = true;
      log.length = 0;
      await sendRemote(body);
      add('bot', L.waiting);
      refreshClient();
    } catch (error) {
      remote = false;
      log.splice(0, log.length, ...draft);
      add('bot', L.failed);
    }
    finally { setBusy(false); }
  }
  async function submit(value) {
    const text = String(value || '').trim(); if (!text || busy) return;
    if (remote) {
      setBusy(true);
      try { await sendRemote(text); }
      catch (_) { add('bot', L.failed); }
      finally { setBusy(false); }
      return;
    }
    add('client', text);
    const key = classifySupportQuestion(text);
    if (key === 'handoff' || key === 'unknown') {
      add('bot', (key === 'unknown' ? `${L.unknown} ` : '') + L.handoffQuestion, 'handoff');
    } else add('bot', L[key]);
  }
  launcher.onclick = () => {
    active = true; panel.hidden = false; launcher.hidden = true;
    renderLog(); findExisting();
    if (poll) clearInterval(poll); poll = setInterval(refreshClient, 25000);
  };
  panel.querySelector('#jkSupportClose').onclick = () => {
    active = false; panel.hidden = true; launcher.hidden = false;
    if (poll) { clearInterval(poll); poll = null; }
  };
  panel.querySelector('#jkSupportForm').onsubmit = event => {
    event.preventDefault(); const input = panel.querySelector('#jkSupportInput');
    const value = input.value; input.value = ''; submit(value);
  };
  renderLog();

  // Admin-only inbox: clients cannot list conversations or view another UID.
  let inbox = [];
  async function openInbox() {
    if (!ctx.isAdmin()) return;
    ctx.sheet(`<div class="sh-name">${esc(L.chats)}</div><p class="sub">${esc(L.connecting)}</p>`);
    try {
      const result = await api('GET', `${collection}?pageSize=100&orderBy=${encodeURIComponent('updated desc')}`, null, true);
      inbox = (result.documents || []).map(unpack).sort((a,b) => b.updated - a.updated);
      renderInbox();
    } catch (error) {
      ctx.sheet(`<div class="sh-name">${esc(L.chats)}</div><p class="sub">${esc(error.message)}</p><button class="btn" id="jkChatRetry">${esc(L.refresh)}</button>`);
      document.getElementById('jkChatRetry').onclick = openInbox;
    }
  }
  function renderInbox() {
    ctx.sheet(`<div class="sh-head"><div><div class="sh-state">${esc(L.operator)}</div><div class="sh-name">${esc(L.chats)} · ${inbox.length}</div></div></div>
      <div class="rows">${inbox.map(c => `<button class="row" data-uid="${esc(c.id)}"><span><b>${esc(c.lastMessage || '…')}</b><small>${esc(c.status)} · ${esc(c.id.slice(0,14))}</small></span></button>`).join('') || `<p class="sub">${esc(L.empty)}</p>`}</div>
      <div class="btns"><button class="btn" id="jkChatClose">${esc(L.close)}</button><button class="btn" id="jkChatRefresh">${esc(L.refresh)}</button></div>`);
    document.querySelectorAll('#sheet [data-uid]').forEach(button => button.onclick = () => openThread(button.dataset.uid));
    document.getElementById('jkChatClose').onclick = ctx.hideSheet;
    document.getElementById('jkChatRefresh').onclick = openInbox;
  }
  async function openThread(uid) {
    if (!ctx.isAdmin()) return;
    currentUid = uid;
    ctx.sheet(`<div class="sh-name">${esc(L.chats)}</div><p class="sub">Загрузка…</p>`);
    try {
      const msgs = await allMessages(uid, true);
      currentThread = msgs;
      ctx.sheet(`<div class="sh-head"><div><div class="sh-state">${esc(L.guest)}</div><div class="sh-name">${esc(uid.slice(0,18))}</div></div></div>
        <div class="jk-support-admin-messages" id="jkAdminMessages">${msgs.map(m => `<div class="jk-support-admin-bubble ${m.author === 'admin' ? 'mine' : ''}"><small>${esc(m.author === 'admin' ? L.operator : L.guest)}</small>${esc(m.body || '')}</div>`).join('')}</div>
        <form id="jkAdminReply"><textarea class="fld" id="jkAdminText" rows="3" maxlength="1000" placeholder="${esc(L.reply)}" required></textarea>
          <div class="btns"><button type="button" class="btn" id="jkChatBack">${esc(L.back)}</button><button type="submit" class="btn main" id="jkAdminSend">${esc(L.send)}</button></div></form>`);
      const scroller = document.getElementById('jkAdminMessages'); scroller.scrollTop = scroller.scrollHeight;
      document.getElementById('jkChatBack').onclick = renderInbox;
      document.getElementById('jkAdminReply').onsubmit = async e => {
        e.preventDefault(); const reply = document.getElementById('jkAdminText').value.trim();
        if (!reply) return;
        const button = document.getElementById('jkAdminSend'); button.disabled = true;
        try {
          const created = Date.now();
          await api('POST', `${messagesPath(uid)}?documentId=${id()}`, { author: 'admin', body: reply, created }, true);
          try {
            await api('PATCH', `${path(uid)}?updateMask.fieldPaths=lastMessage&updateMask.fieldPaths=updated&updateMask.fieldPaths=status`,
              { lastMessage: reply.slice(0,150), updated: created, status: 'answered' }, true);
          } catch (_) { /* The reply was saved. Never resend a duplicate. */ }
          ctx.toast(L.received); await openThread(uid);
        } catch (error) { ctx.toast(`${L.error}: ${error.message}`, 5000); button.disabled = false; }
      };
    } catch (error) { ctx.toast(`${L.error}: ${error.message}`, 5000); renderInbox(); }
  }
  return { openInbox };
}
