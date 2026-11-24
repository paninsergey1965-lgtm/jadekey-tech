// JadeKey account recovery. This module deliberately shares the existing
// Firebase REST session instead of creating a second Firebase SDK session.
// It must be deployed together with the reviewed jk2_clients Firestore rules.

const PENDING_KEY = 'jk2_email_pending';
const LINKED_KEY = 'jk2_email_linked';

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* Private mode. */ }
}
function storageDel(key) {
  try { localStorage.removeItem(key); } catch (_) { /* Private mode. */ }
}

function parseEmailCode(rawUrl) {
  let url;
  try { url = new URL(rawUrl, location.href); } catch (_) { return null; }
  for (let i = 0; i < 3; i++) {
    if (url.searchParams.get('mode') === 'signIn' && url.searchParams.get('oobCode')) {
      return url.searchParams.get('oobCode');
    }
    const nested = url.searchParams.get('link') || url.searchParams.get('deep_link_id');
    if (!nested) break;
    try { url = new URL(nested); } catch (_) { break; }
  }
  return null;
}

function readPending() {
  try { return JSON.parse(storageGet(PENDING_KEY) || 'null'); } catch (_) { return null; }
}

export function initJadeKeyAccounts(ctx) {
  const apiUrl = `https://identitytoolkit.googleapis.com/v1/`;
  let busy = false;

  async function authCall(endpoint, payload) {
    const response = await fetch(`${apiUrl}${endpoint}?key=${encodeURIComponent(ctx.firebaseKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) {
      const error = new Error(result.error?.message || `Ошибка Firebase HTTP ${response.status}`);
      error.code = result.error?.message || '';
      throw error;
    }
    return result;
  }

  async function currentAccount() {
    const idToken = await ctx.anonToken(false);
    if (!idToken) return null;
    const result = await authCall('accounts:lookup', { idToken });
    return result.users?.[0] || null;
  }

  async function ensureClientRecord(user) {
    // NOTE: this collection MUST be restricted before this code is deployed.
    // The old wildcard rules make any new collection readable by everyone.
    if (!user?.email || !user?.emailVerified) return;
    const token = await ctx.anonToken(false);
    const uid = ctx.myUid();
    if (!token || !uid || user.localId !== uid) throw new Error('Аккаунт не совпадает');
    const fields = { owner: uid, email: user.email.toLowerCase(), verified: true, updated: Date.now() };
    let exists = false;
    try {
      const current = await ctx.fsReq('GET', `jk2_clients/${encodeURIComponent(uid)}`, token);
      const record = Object.fromEntries(Object.entries(current.fields || {}).map(([key, value]) => [key,
        value.stringValue ?? value.booleanValue ?? value.doubleValue ?? null]));
      if (record.email === fields.email && record.owner === uid && record.verified === true) return;
      exists = true;
    } catch (e) { if (e.status !== 404) throw e; }
    try {
      if (exists) await ctx.fsReq('PATCH', `jk2_clients/${encodeURIComponent(uid)}`, token, fields, Object.keys(fields));
      else await ctx.fsReq('POST', `jk2_clients?documentId=${encodeURIComponent(uid)}`, token, fields);
    } catch (error) {
      if (error.status !== 409 || exists) throw error;
      await ctx.fsReq('PATCH', `jk2_clients/${encodeURIComponent(uid)}`, token, fields, Object.keys(fields));
    }
  }

  async function display() {
    const root = document.getElementById('jkAccount');
    if (!root) return;
    if (ctx.isNative) {
      root.innerHTML = '<div class="h2">Аккаунт и сохранность камней</div><p class="sub">Вход по почте для приложения пока проходит проверку. Не удаляй приложение и его данные до выпуска восстановления.</p>';
      return;
    }
    const cached = storageGet(LINKED_KEY);
    let email = cached;
    try {
      const user = await currentAccount();
      email = user?.emailVerified ? user.email : null;
      if (email) {
        storageSet(LINKED_KEY, email);
        // Rebuild the admin index after a session has been restored on a
        // different device, or if a prior index write was interrupted.
        await ensureClientRecord(user).catch(() => {});
      } else storageDel(LINKED_KEY);
    } catch (_) { /* Keep UI usable while temporarily offline. */ }
    const own = ctx.getStones().some(s => s.mode && !s.of && s.owner === ctx.myUid());
    root.innerHTML = `<div class="h2">Аккаунт и сохранность камней</div>
      ${email ? `<p class="sub">Почта подтверждена: <b>${ctx.esc(email)}</b>. Камни можно восстановить на другом телефоне.</p>`
        : `<p class="sub">${own ? 'Камни пока привязаны только к этому браузеру. ' : ''}Привяжи почту, чтобы не потерять камни при смене телефона.</p>`}
      ${email ? '' : '<button class="btn main" id="jkEmailLink">Привязать почту</button>'}
      <button class="btn" id="jkEmailRestore" style="margin-top:8px">Восстановить камни по почте</button>`;
    if (!email) root.querySelector('#jkEmailLink').onclick = () => sendEmail('link');
    root.querySelector('#jkEmailRestore').onclick = () => sendEmail('signin');
  }

  async function sendEmail(mode) {
    if (busy) return;
    if (ctx.isNative) return ctx.toast('Вход по почте для приложения пока недоступен.');
    let idToken = null, originalUid = null;
    if (mode === 'link') {
      try { idToken = await ctx.anonToken(false); } catch (_) { /* Show the error below. */ }
      originalUid = ctx.myUid();
      if (!idToken || !originalUid) {
        ctx.toast('Сначала оживи камень или воспользуйся восстановлением.'); return;
      }
    } else {
      const ownsOnThisDevice = ctx.getStones().some(s => s.mode && !s.of && s.owner === ctx.myUid());
      if (ownsOnThisDevice && !confirm('На этом телефоне уже есть камни. При входе по другой почте они могут перестать отображаться здесь. Продолжить?')) return;
    }

    const entered = prompt(mode === 'link' ? 'Укажи почту, к которой привяжем твои камни' : 'Укажи почту, к которой уже привязаны камни');
    if (entered === null) return;
    const email = entered.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      ctx.toast('Проверь адрес электронной почты.'); return;
    }
    busy = true;
    try {
      // The continue URL is authorized in Firebase Authentication settings.
      // Email links do not place the customer's email in a URL.
      await authCall('accounts:sendOobCode', {
        requestType: 'EMAIL_SIGNIN', email,
        continueUrl: `${location.origin}${location.pathname}?jk_email_return=1&jk_email_flow=${mode}`,
        canHandleCodeInApp: true
      });
      storageSet(PENDING_KEY, JSON.stringify({ email, mode, uid: originalUid, sentAt: Date.now() }));
      alert(`Письмо отправлено на ${email}. На iPhone открой ссылку в Safari — в том же браузере, где оживлял камень, а не внутри Gmail. Если письма нет — проверь «Спам».`);
    } catch (e) {
      const quota = /QUOTA|TOO_MANY|LIMIT|RESOURCE_EXHAUSTED/i.test(e.code);
      ctx.toast(quota ? 'Лимит отправки писем Firebase исчерпан. Попробуй позже.' : `Не удалось отправить письмо: ${e.message}`, 6500);
    } finally { busy = false; }
  }

  async function handleEmailReturn() {
    const code = parseEmailCode(location.href);
    if (!code || busy) return false;
    busy = true;
    const pending = readPending();
    const flow = new URL(location.href).searchParams.get('jk_email_flow');
    if (flow === 'link' && (!pending || pending.mode !== 'link' || pending.uid !== ctx.myUid())) {
      ctx.toast('Открой ссылку в том браузере, где находится камень: иначе привязать его нельзя.', 8000);
      busy = false;
      return true;
    }
    let email = pending?.email || '';
    if (!email) email = (prompt('Введите почту, на которую пришла ссылка (для безопасности)') || '').trim().toLowerCase();
    if (!email) { busy = false; return true; }

    try {
      const params = { email, oobCode: code };
      const mustLink = flow === 'link' || (flow !== 'signin' && pending?.mode === 'link');
      if (mustLink) {
        const oldToken = await ctx.anonToken(false);
        if (!oldToken || !pending.uid || pending.uid !== ctx.myUid()) {
          throw new Error('Открой письмо в браузере, где находится камень. Иначе старый аккаунт нельзя безопасно привязать.');
        }
        params.idToken = oldToken; // Firebase links the email without changing UID.
      }
      const result = await authCall('accounts:signInWithEmailLink', params);
      if (mustLink && result.localId !== pending.uid) {
        throw new Error('Firebase вернул другой ID. Аккаунт не переключён. Обратись в поддержку JadeKey.');
      }
      if (!result.idToken || !result.refreshToken || !result.localId) throw new Error('Firebase не вернул данные входа');
      ctx.setSession(result);
      const user = await currentAccount();
      if (!user?.emailVerified || user.localId !== result.localId) {
        throw new Error('Почта пока не подтверждена Firebase');
      }
      storageSet(LINKED_KEY, user.email);
      storageDel(PENDING_KEY);
      // Only after server verification, never based on a typed email alone.
      try { await ensureClientRecord(user); }
      catch (e) { ctx.toast(`Вход выполнен, но карточка клиента не сохранена: ${e.message}`, 6500); }
      const clean = new URL(location.href);
      for (const key of ['mode', 'oobCode', 'apiKey', 'continueUrl', 'lang', 'link', 'deep_link_id', 'jk_email_return', 'jk_email_flow']) clean.searchParams.delete(key);
      history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
      await ctx.loadStones();
      ctx.showLiveTab();
      await ctx.liveHome();
      await display();
      alert('Почта подтверждена! Теперь доступ к камням можно восстановить по этой почте.');
    } catch (e) { ctx.toast(`Не удалось подтвердить почту: ${e.message}`, 8000); }
    finally { busy = false; }
    return true;
  }

  return { display, handleEmailReturn, startLink: () => sendEmail('link') };
}
