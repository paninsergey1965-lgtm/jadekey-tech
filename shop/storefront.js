/* JadeKey storefront: client-only filters, favourites and a one-stone basket.
   Checkout stays on the existing product page with the existing payment service. */
(() => {
  'use strict';

  const grid = document.getElementById('product-grid');
  if (!grid) return;

  const cards = [...grid.querySelectorAll('.product-card')];
  const byId = new Map(cards.map((card, index) => {
    card.dataset.position = String(index);
    return [card.dataset.id, card];
  }));
  const filterButtons = [...document.querySelectorAll('[data-filter]')];
  const search = document.getElementById('catalog-search');
  const sort = document.getElementById('catalog-sort');
  const empty = document.getElementById('empty-state');
  const count = document.getElementById('results-counter');
  const favoritesCount = document.getElementById('favorites-count');
  const cartCount = document.getElementById('cart-count');
  const cartTrigger = document.getElementById('cart-trigger');
  const drawer = document.getElementById('cart-drawer');
  const backdrop = document.getElementById('cart-backdrop');
  const closeButton = document.getElementById('cart-close');
  const content = document.getElementById('cart-content');
  const bottom = document.getElementById('cart-bottom');
  const checkout = document.getElementById('cart-checkout');
  const cartPrice = document.getElementById('cart-price');
  const favoriteKey = 'jadekey:shop:favorites:v1';
  const cartKey = 'jadekey:shop:cart:v1';
  const rub = value => Number(value).toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽';
  const normalized = value => String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} };

  const savedFavorites = read(favoriteKey);
  const favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites.filter(id => byId.has(id)) : []);
  let cartId = read(cartKey);
  if (!byId.has(cartId)) cartId = null;
  let activeFilter = ['her', 'him', 'prem', 'order'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'all';
  let returnFocus = null;

  function setFilter(next) {
    activeFilter = next;
    filterButtons.forEach(button => {
      const selected = button.dataset.filter === activeFilter;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    renderProducts();
  }

  function renderProducts() {
    const q = normalized(search.value);
    let visible = 0;
    cards.forEach(card => {
      const matchesFilter = activeFilter === 'all' ||
        (activeFilter === 'favorites' ? favorites.has(card.dataset.id) :
          activeFilter === 'order' ? card.dataset.stock === 'order' :
            card.dataset.filter.split(' ').includes(activeFilter));
      const matchesSearch = !q || normalized(card.dataset.name).includes(q);
      const show = matchesFilter && matchesSearch;
      card.hidden = !show;
      if (show) visible++;
    });
    const sorted = [...cards];
    const criterion = sort.value;
    sorted.sort((a, b) => {
      if (criterion === 'price-asc') return Number(a.dataset.price) - Number(b.dataset.price) || Number(a.dataset.position) - Number(b.dataset.position);
      if (criterion === 'price-desc') return Number(b.dataset.price) - Number(a.dataset.price) || Number(a.dataset.position) - Number(b.dataset.position);
      if (criterion === 'name') return a.dataset.name.localeCompare(b.dataset.name, 'ru');
      return Number(a.dataset.position) - Number(b.dataset.position);
    });
    sorted.forEach(card => grid.append(card));
    empty.hidden = visible !== 0;
    count.textContent = visible + ' ' + (visible % 10 === 1 && visible % 100 !== 11 ? 'камень' : visible % 10 >= 2 && visible % 10 <= 4 && (visible % 100 < 12 || visible % 100 > 14) ? 'камня' : 'камней');
  }

  function renderFavorites() {
    favoritesCount.textContent = String(favorites.size);
    document.querySelectorAll('[data-favorite]').forEach(button => {
      const selected = favorites.has(button.dataset.favorite);
      button.textContent = selected ? '♥' : '♡';
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', (selected ? 'Убрать из избранного: ' : 'В избранное: ') + byId.get(button.dataset.favorite).querySelector('h3').textContent);
    });
  }

  function renderCart() {
    const card = cartId ? byId.get(cartId) : null;
    cartCount.textContent = card ? '1' : '0';
    content.replaceChildren();
    bottom.hidden = !card;
    if (!card) {
      const p = document.createElement('p');
      p.className = 'cart-empty';
      p.textContent = 'Пока пусто. Добавьте камень из коллекции.';
      content.append(p);
      return;
    }
    const item = document.createElement('div');
    item.className = 'cart-item';
    const img = document.createElement('img');
    img.src = card.dataset.image;
    img.alt = card.querySelector('h3').textContent;
    const body = document.createElement('div');
    const category = document.createElement('p');
    category.className = 'cart-item-category';
    category.textContent = card.dataset.stock === 'order' ? 'Под заказ · 2–3 дня' : 'В наличии';
    const title = document.createElement('h3');
    title.textContent = card.querySelector('h3').textContent;
    const price = document.createElement('p');
    price.textContent = 'от ' + rub(card.dataset.price);
    body.append(category, title, price);
    item.append(img, body);
    content.append(item);
    cartPrice.textContent = rub(card.dataset.price);
    checkout.href = card.dataset.href;
  }

  function openCart() {
    returnFocus = document.activeElement;
    renderCart();
    drawer.hidden = false;
    backdrop.hidden = false;
    cartTrigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('cart-open');
    closeButton.focus();
  }

  function closeCart() {
    drawer.hidden = true;
    backdrop.hidden = true;
    cartTrigger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('cart-open');
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  }

  document.getElementById('catalog-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (button) setFilter(button.dataset.filter);
  });
  search.addEventListener('input', renderProducts);
  sort.addEventListener('change', renderProducts);
  document.getElementById('reset-filters').addEventListener('click', () => {
    search.value = '';
    sort.value = 'featured';
    setFilter('all');
    search.focus();
  });

  grid.addEventListener('click', event => {
    const favoriteButton = event.target.closest('[data-favorite]');
    if (favoriteButton) {
      const id = favoriteButton.dataset.favorite;
      favorites.has(id) ? favorites.delete(id) : favorites.add(id);
      save(favoriteKey, [...favorites]);
      renderFavorites();
      if (activeFilter === 'favorites') renderProducts();
      return;
    }
    const addButton = event.target.closest('[data-add]');
    if (addButton) {
      cartId = addButton.dataset.add;
      save(cartKey, cartId);
      renderCart();
      openCart();
    }
  });

  cartTrigger.addEventListener('click', openCart);
  closeButton.addEventListener('click', closeCart);
  backdrop.addEventListener('click', closeCart);
  document.getElementById('cart-remove').addEventListener('click', () => {
    cartId = null;
    save(cartKey, null);
    renderCart();
  });
  document.addEventListener('keydown', event => {
    if (drawer.hidden) return;
    if (event.key === 'Escape') {
      closeCart();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll('a[href],button:not([disabled])')].filter(element => element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  renderFavorites();
  renderCart();
  setFilter(activeFilter);
})();
