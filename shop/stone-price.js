export async function lovePrice(sid) {
  const response = await fetch('https://functions.yandexcloud.net/d4eif8g25o2652dmff0v?priceFor=' + encodeURIComponent(sid), {cache:'no-store'});
  if (!response.ok) throw new Error('Цена временно недоступна');
  const quote = await response.json();
  if (quote.sid === sid && quote.mode === 'love' && quote.price === 100) return 100;
  if (quote.ok && quote.service === 'jadekey-shop') return 2900;
  throw new Error('Цена временно недоступна');
}
