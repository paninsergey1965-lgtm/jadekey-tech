export const defaultPrices = {love:2900, luna:3500, tal:4200, path:5500};

export function stonePrices(raw) {
  const prices = {...defaultPrices};
  if (!raw) return prices;
  const saved = JSON.parse(raw);
  for (const mode of Object.keys(prices)) {
    if (!Object.hasOwn(saved, mode)) continue;
    if (!Number.isSafeInteger(saved[mode]) || saved[mode] < 1) throw new Error('Некорректная цена');
    prices[mode] = saved[mode];
  }
  return prices;
}
