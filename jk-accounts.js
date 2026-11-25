// Email/password registration and recovery for JadeKey.
// Upgrade existing anonymous users in place to preserve stone ownership UIDs.
// Deploy together with private jk2_clients Firestore rules, never by itself.

const API = 'https://identitytoolkit.googleapis.com/v1/';

function validEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function friendlyError(error) {
  const code = String(error.code || error.message || '');
  if (/EMAIL_EXISTS/i.test(code)) return 'Эта почта уже зарегистрирована. Выбери «Войти».';
  if (/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/i.test(code)) return 'Неверная почта или пароль.';
  if (/WEAK_PASSWORD/i.test(code)) return 'Пароль слишком простой.';
  if (/CREDENTIAL_TOO_OLD_LOGIN_AGAIN|REQUIRES_RECENT_LOGIN/i.test(code)) return 'Для смены почты нужно заново войти в текущий аккаунт с прежней почтой и паролем, затем повторить.';
  if (/INVALID_EMAIL/i.test(code)) return 'Неверный формат электронной почты.';
  if (/OPERATION_NOT_ALLOWED/i.test(code)) return 'Firebase отклонил операцию входа. Проверь настройки авторизации проекта.';
  if (/TOO_MANY|QUOTA|LIMIT|RESOURCE_EXHAUSTED/i.test(code)) return 'Лимит попыток или писем исчерпан. Попробуй позже.';
  if (/NETWORK|Failed to fetch|Load failed|fetch failed/i.test(code)) return 'Не удалось связаться с Firebase. Проверь интернет и повтори попытку.';
  return `Не удалось завершить действие: ${code.slice(0, 110)}`;
}

export function initJadeKeyAccounts(ctx) {
  let busy = false;
  let formMode = null;
  let pendingChangeEmail = null;
  let lastVerificationAttempt = null;
  const verificationSender = `noreply@${ctx.project}.firebaseapp.com`;
  const speak = text => { try { window.JKVoiceDemo?.say(text); } catch (_) {} };

  async function authCall(endpoint, payload) {
    const response = await fetch(`${API}${endpoint}?key=${encodeURIComponent(ctx.firebaseKey)}`, {
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

  function hasOwnedStones() {
    return ctx.getStones().some(s => s.mode && !s.of && s.owner === ctx.myUid());
  }

  async function currentAccount() {
    const idToken = await ctx.anonToken(false);
    if (!idToken) return null;
    const result = await authCall('accounts:lookup', { idToken });
    return result.users?.[0] || null;
  }

  async function ensureClientRecord(user) {
    // Never index an unverified email, and never trust typed user input.
    if (!user?.email || !user?.emailVerified) return false;
    const token = await ctx.anonToken(false);
    const uid = ctx.myUid();
    if (!token || !uid || user.localId !== uid) throw new Error('Аккаунт не совпадает');
    const fields = { owner: uid, email: user.email.toLowerCase(), verified: true, updated: Date.now() };
    let exists = false;
    try {
      const current = await ctx.fsReq('GET', `jk2_clients/${encodeURIComponent(uid)}`, token);
      const record = Object.fromEntries(Object.entries(current.fields || {}).map(([key, value]) => [key,
        value.stringValue ?? value.booleanValue ?? value.doubleValue ?? null]));
      if (record.email === fields.email && record.owner === uid && record.verified === true) return true;
      exists = true;
    } catch (error) { if (error.status !== 404) throw error; }
    try {
      if (exists) await ctx.fsReq('PATCH', `jk2_clients/${encodeURIComponent(uid)}`, token, fields, Object.keys(fields));
      else await ctx.fsReq('POST', `jk2_clients?documentId=${encodeURIComponent(uid)}`, token, fields);
    } catch (error) {
      if (error.status !== 409 || exists) throw error;
      await ctx.fsReq('PATCH', `jk2_clients/${encodeURIComponent(uid)}`, token, fields, Object.keys(fields));
    }
    return true;
  }

  function renderForm(root) {
    const register = formMode === 'register';
    const reset = formMode === 'reset';
    const caption = register ? 'Создать аккаунт' : reset ? 'Отправить письмо' : 'Войти';
    root.insertAdjacentHTML('beforeend', `<form id="jkEmailForm" style="margin-top:12px">
      <label class="sub" for="jkEmailAddress">Электронная почта</label>
      <input id="jkEmailAddress" type="email" inputmode="email" autocomplete="email" required maxlength="255" placeholder="name@example.com" style="width:100%;padding:12px;margin:5px 0 12px;border-radius:10px">
      ${reset ? '' : `<label class="sub" for="jkEmailPassword">Пароль (не менее 8 символов)</label>
      <input id="jkEmailPassword" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required ${register ? 'minlength="8"' : ''} style="width:100%;padding:12px;margin:5px 0 12px;border-radius:10px">`}
      ${register ? `<label class="sub" for="jkEmailPasswordRepeat">Повтори пароль</label>
      <input id="jkEmailPasswordRepeat" type="password" autocomplete="new-password" required minlength="8" style="width:100%;padding:12px;margin:5px 0 12px;border-radius:10px">` : ''}
      <div class="btns"><button class="btn main" type="submit">${caption}</button><button class="btn" type="button" id="jkEmailCancel">Отмена</button></div>
    </form>`);
    root.querySelector('#jkEmailCancel').onclick = () => { formMode = null; display(); };
    root.querySelector('#jkEmailForm').onsubmit = event => {
      event.preventDefault();
      const email = root.querySelector('#jkEmailAddress').value;
      const password = root.querySelector('#jkEmailPassword')?.value;
      if (register) registerEmail(email, password, root.querySelector('#jkEmailPasswordRepeat').value);
      else if (reset) resetPassword(email);
      else signIn(email, password);
    };
  }

  function renderEmailChangeForm(root) {
    root.insertAdjacentHTML('beforeend', `<form id="jkEmailChangeForm" style="margin-top:12px">
      <label class="sub" for="jkEmailAddress">Новая электронная почта</label>
      <input id="jkEmailAddress" type="email" inputmode="email" autocomplete="email" required maxlength="255" placeholder="name@example.com" style="width:100%;padding:12px;margin:5px 0 12px;border-radius:10px">
      <label class="sub" for="jkEmailCurrentPassword">Пароль текущего аккаунта JadeKey</label>
      <input id="jkEmailCurrentPassword" type="password" autocomplete="current-password" required style="width:100%;padding:12px;margin:5px 0 12px;border-radius:10px">
      <p class="sub">Введи пароль от текущей почты JadeKey, не пароль от новой iCloud. Мы проверим, что это тот же владелец камней, затем отправим письмо на новый адрес. До подтверждения старая почта остаётся привязанной.</p>
      <div class="btns"><button class="btn main" type="submit">Подтвердить новую почту</button><button class="btn" type="button" id="jkEmailCancel">Отмена</button></div>
    </form>`);
    root.querySelector('#jkEmailCancel').onclick = () => { formMode = null; display(); };
    root.querySelector('#jkEmailChangeForm').onsubmit = event => {
      event.preventDefault();
      requestEmailChange(root.querySelector('#jkEmailAddress').value, root.querySelector('#jkEmailCurrentPassword').value);
    };
  }

  async function display() {
    const root = document.getElementById('jkAccount');
    if (!root) return;
    let user = null, offline = false;
    try {
      user = await currentAccount();
      if (user?.emailVerified) {
        try { await ensureClientRecord(user); }
        catch (_) {
          // A verification completed in another tab may leave a cached ID
          // token without email_verified until Firebase refreshes it.
          await ctx.refreshSession();
          await ensureClientRecord(user);
        }
      }
    } catch (_) { offline = true; }
    // Do not offer registration when Firebase lookup failed or a previously
    // stored owner UID exists but its session could not be verified.
    const accountUnknown = !user && (offline || Boolean(ctx.myUid()));
    const email = user?.email ? ctx.esc(user.email) : '';
    root.innerHTML = `<div class="h2">Аккаунт и сохранность камней</div>
      ${accountUnknown
        ? `<p class="sub">Не удалось проверить, привязана ли почта к этому аккаунту. Камни остаются на месте. Пока не создавай новый аккаунт — сначала повтори проверку соединения.</p>
           <button class="btn main" id="jkEmailRetry">Повторить проверку</button>`
        : email && user.emailVerified
        ? `<p class="sub">Почта подтверждена: <b>${email}</b>. Камни можно восстановить на другом телефоне по почте и паролю.</p>`
        : email
          ? `<p class="sub">Почта <b>${email}</b> привязана, но ещё не подтверждена. Открой письмо от <b>${ctx.esc(verificationSender)}</b>, нажми ссылку подтверждения, вернись сюда и нажми «Проверить подтверждение». Если письма нет, проверь «Спам».</p>
             ${lastVerificationAttempt?.email === user.email.toLowerCase() ? `<p class="sub" role="status">Последняя попытка в ${ctx.esc(lastVerificationAttempt.time)}: ${lastVerificationAttempt.accepted ? 'сервер принял запрос на отправку письма, но доставку не подтвердил' : `сервер отклонил запрос — ${ctx.esc(lastVerificationAttempt.error)}`}.</p>` : ''}
             <button class="btn main" id="jkEmailVerify">Проверить подтверждение</button>
             <button class="btn" id="jkEmailResend">Отправить письмо ещё раз</button>`
          : `<p class="sub">${hasOwnedStones() ? 'Твои камни пока привязаны к этому устройству. ' : ''}Зарегистрируй почту, чтобы восстановить доступ при смене телефона.</p>
             <button class="btn main" id="jkEmailRegister">Зарегистрироваться</button>`}
      ${!accountUnknown && email ? `<button class="btn" id="jkEmailChange" style="margin-top:8px">Изменить почту</button>` : ''}
      ${email && pendingChangeEmail && !user?.emailVerified
        ? `<p class="sub">Ожидается подтверждение нового адреса <b>${ctx.esc(pendingChangeEmail)}</b>. Открой письмо на этой почте и затем нажми «Проверить подтверждение».</p>` : ''}
      ${accountUnknown ? '' : `<button class="btn" id="jkEmailLogin" style="margin-top:8px">Войти на другом устройстве</button>
      <button class="btn" id="jkEmailReset" style="margin-top:8px">Забыли пароль?</button>`}
      ${offline && !accountUnknown ? '<p class="sub">Не удалось синхронизировать профиль с сервером. Повтори попытку позже.</p>' : ''}`;
    root.querySelector('#jkEmailRetry')?.addEventListener('click', () => display());
    root.querySelector('#jkEmailRegister')?.addEventListener('click', () => showForm('register'));
    if (!accountUnknown) {
      root.querySelector('#jkEmailLogin').onclick = () => showForm('login');
      root.querySelector('#jkEmailReset').onclick = () => showForm('reset');
    }
    root.querySelector('#jkEmailChange')?.addEventListener('click', () => showForm('change'));
    root.querySelector('#jkEmailVerify')?.addEventListener('click', () => checkVerification());
    root.querySelector('#jkEmailResend')?.addEventListener('click', () => sendVerification());
    if (!accountUnknown && formMode === 'change') renderEmailChangeForm(root);
    else if (!accountUnknown && formMode) renderForm(root);
  }

  function showForm(mode) {
    formMode = mode;
    if (mode === 'register') window.JKVoiceDemo?.begin();
    display().then(() => document.getElementById('jkEmailAddress')?.focus());
    if (mode === 'register') speak('Введите адрес электронной почты. Придумайте пароль не короче восьми символов и повторите его в следующем поле. Затем нажмите Создать аккаунт.');
    if (mode === 'change') speak('Введите новый адрес электронной почты и пароль от вашего текущего аккаунта JadeKey. Не используйте пароль от новой почты. Затем нажмите Подтвердить новую почту.');
  }

  async function requestEmailChange(rawEmail, currentPassword) {
    if (busy) return;
    const newEmail = validEmail(rawEmail);
    if (!newEmail) return ctx.toast('Проверь новый адрес электронной почты.');
    if (!currentPassword) return ctx.toast('Введи пароль текущего аккаунта JadeKey.');
    busy = true;
    try {
      const originalUid = ctx.myUid();
      const account = await currentAccount();
      if (!originalUid || !account?.email || account.localId !== originalUid) {
        throw new Error('Не удалось проверить текущий аккаунт. Не создавай новый.');
      }
      if (account.email.toLowerCase() === newEmail) {
        ctx.toast('Это уже текущий адрес. Для него используй «Отправить письмо ещё раз».', 6500);
        return;
      }
      // Reauthenticate against the CURRENT email, not the new address.
      // Do not update local credentials until the returned UID is verified.
      const login = await authCall('accounts:signInWithPassword', {
        email: account.email, password: currentPassword, returnSecureToken: true
      });
      if (login.localId !== originalUid || !login.idToken || !login.refreshToken) {
        throw new Error('Вход не совпал с текущим владельцем камней. Сеанс не изменён.');
      }
      ctx.setSession(login);
      // Firebase verifies the NEW mailbox before changing the email.
      // Owner UID and stones are never replaced.
      await authCall('accounts:sendOobCode', {
        requestType: 'VERIFY_AND_CHANGE_EMAIL', idToken: login.idToken, newEmail
      });
      pendingChangeEmail = newEmail;
      formMode = null;
      await display();
      ctx.toast('Запрос отправлен. Проверь новую почту (и «Спам»), открой ссылку и вернись сюда.', 8000);
      speak('Запрос на смену электронной почты отправлен. Откройте письмо в новой почте, нажмите ссылку подтверждения и вернитесь в JadeKey. Затем нажмите Проверить подтверждение. Ваши камни останутся привязаны к тому же аккаунту.');
    } catch (error) { ctx.toast(friendlyError(error), 8000); }
    finally { busy = false; }
  }

  async function sendVerification() {
    if (busy) return;
    window.JKVoiceDemo?.begin();
    busy = true;
    let requestedEmail = null;
    try {
      const token = await ctx.anonToken(false);
      const user = await currentAccount();
      if (!token || !user?.email || user.localId !== ctx.myUid()) throw new Error('Нет привязанной почты');
      if (user.emailVerified) return await checkVerification(true);
      requestedEmail = validEmail(user.email);
      const result = await authCall('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: token });
      const intendedEmail = validEmail(user.email);
      const serverEmail = result.email ? validEmail(result.email) : null;
      if (serverEmail && serverEmail !== intendedEmail) throw new Error('Адрес в ответе сервера не совпал с адресом аккаунта.');
      lastVerificationAttempt = { email: intendedEmail, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), accepted: true };
      ctx.toast(`Сервер принял запрос для ${intendedEmail}. Проверь почту, включая «Спам».`, 7000);
      speak('Сервер принял запрос на отправку письма. Откройте почту, проверьте папку Спам и найдите письмо от JadeKey. Нажмите ссылку, затем вернитесь и нажмите Проверить подтверждение.');
    } catch (error) {
      if (requestedEmail) lastVerificationAttempt = { email: requestedEmail, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), accepted: false, error: friendlyError(error) };
      ctx.toast(friendlyError(error), 6500);
    }
    finally { busy = false; await display(); }
  }

  async function checkVerification(skipBusy = false) {
    if (busy && !skipBusy) return;
    window.JKVoiceDemo?.begin();
    if (!skipBusy) busy = true;
    try {
      // Refresh cached JWT so Firestore sees updated email_verified claim.
      await ctx.refreshSession();
      const user = await currentAccount();
      if (user?.emailVerified && user.localId === ctx.myUid()) {
        await ensureClientRecord(user);
        pendingChangeEmail = null;
        formMode = null;
        ctx.toast('Почта подтверждена. Доступ к камням защищён!', 6500);
        speak('Почта успешно подтверждена. Теперь ваши камни можно восстановить на другом телефоне по электронной почте и паролю.');
      } else {
        ctx.toast('Пока не подтверждено. Открой ссылку из письма и нажми ещё раз.', 6500);
        speak('Почта пока не подтверждена. Откройте письмо, нажмите ссылку подтверждения и вернитесь в JadeKey. Затем снова нажмите Проверить подтверждение.');
      }
    } catch (error) { ctx.toast(friendlyError(error), 6500); }
    finally { if (!skipBusy) busy = false; await display(); }
  }

  async function registerEmail(rawEmail, password, repeated) {
    if (busy) return;
    const email = validEmail(rawEmail);
    if (!email) { ctx.toast('Проверь адрес электронной почты.'); speak('Проверьте адрес электронной почты и попробуйте ещё раз.'); return; }
    if (!password || password.length < 8) { ctx.toast('Пароль должен содержать минимум 8 символов.'); speak('Пароль должен содержать не менее восьми символов.'); return; }
    if (password !== repeated) { ctx.toast('Пароли не совпадают.'); speak('Пароли не совпадают. Введите одинаковый пароль в обоих полях.'); return; }
    busy = true;
    try {
      // An existing anonymous UID owns the stones. Link email/password to it;
      // for a new buyer, first create an anonymous UID.
      // If an owner UID exists locally but its session expired, do not
      // silently create a *different* anonymous owner.
      const idToken = await ctx.anonToken(!ctx.myUid());
      const originalUid = ctx.myUid();
      const before = await currentAccount();
      if (!idToken || !originalUid || (before && before.localId !== originalUid)) throw new Error('Не удалось проверить владельца');
      if (before?.email) throw new Error('К аккаунту уже привязана почта');
      // Email-enumeration protection rejects accounts:update for provider linking.
      // accounts:signUp with the existing ID token links credentials in place.
      const result = await authCall('accounts:signUp', { idToken, email, password, returnSecureToken: true });
      if (!result.idToken || !result.refreshToken || result.localId !== originalUid) {
        throw new Error('Firebase не подтвердил прежний ID владельца. Обратись в поддержку.');
      }
      ctx.setSession(result);
      formMode = null;
      await display();
      try {
        const sent = await authCall('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: result.idToken });
        if (sent.email && validEmail(sent.email) !== email) throw new Error('Адрес в ответе сервера не совпал с адресом аккаунта.');
        lastVerificationAttempt = { email, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), accepted: true };
        await display();
        ctx.toast('Аккаунт создан! Сервер принял запрос на письмо подтверждения.', 7500);
        speak('Аккаунт создан. Мы отправили на вашу почту письмо со ссылкой подтверждения. Откройте почту, найдите письмо и нажмите ссылку. Если письма нет, проверьте папку Спам. Затем вернитесь в JadeKey и нажмите Проверить подтверждение.');
      } catch (error) {
        lastVerificationAttempt = { email, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), accepted: false, error: friendlyError(error) };
        await display();
        ctx.toast(`Аккаунт создан, но сервер отклонил запрос на письмо: ${friendlyError(error)} Используй «Отправить письмо ещё раз».`, 8000);
        speak('Аккаунт создан, но письмо не удалось отправить. Нажмите Отправить письмо ещё раз.');
      }
    } catch (error) {
      ctx.toast(friendlyError(error), 7500);
      speak('Не получилось зарегистрироваться. Проверь введённые данные и сообщение на экране.');
    }
    finally { busy = false; }
  }

  async function signIn(rawEmail, password) {
    if (busy) return;
    const email = validEmail(rawEmail);
    if (!email || !password) return ctx.toast('Введите почту и пароль.');
    if (hasOwnedStones() && !confirm('На этом устройстве есть камни другого аккаунта. После входа они могут перестать отображаться. Продолжить?')) return;
    busy = true;
    try {
      const result = await authCall('accounts:signInWithPassword', { email, password, returnSecureToken: true });
      if (!result.idToken || !result.refreshToken || !result.localId) throw new Error('Firebase не вернул данные входа');
      ctx.setSession(result);
      formMode = null;
      await ctx.loadStones();
      ctx.showLiveTab();
      await ctx.liveHome();
      const user = await currentAccount();
      if (user?.emailVerified && user.localId === ctx.myUid()) {
        try { await ensureClientRecord(user); }
        catch (_) { ctx.toast('Вход выполнен, но список клиентов обновить не удалось.', 6500); }
      }
      ctx.toast('Вход выполнен. Камни аккаунта доступны.', 6000);
    } catch (error) { ctx.toast(friendlyError(error), 7500); }
    finally { busy = false; }
  }

  async function resetPassword(rawEmail) {
    if (busy) return;
    const email = validEmail(rawEmail);
    if (!email) return ctx.toast('Проверь адрес электронной почты.');
    busy = true;
    try {
      await authCall('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });
      formMode = null;
      await display();
      ctx.toast('Если эта почта зарегистрирована, на неё придёт письмо для смены пароля.', 7000);
    } catch (error) { ctx.toast(friendlyError(error), 6500); }
    finally { busy = false; }
  }

  async function startLink() {
    window.JKVoiceDemo?.begin();
    speak('Сохрани камень по почте, чтобы открыть его на новом телефоне. Сейчас появится форма регистрации.');
    await ctx.liveHome();
    showForm('register');
  }

  // No one-time email sign-in URL is needed for email/password accounts.
  return { display, handleEmailReturn: async () => false, startLink,
    registerEmail, signIn, resetPassword, checkVerification, sendVerification, requestEmailChange };
}
