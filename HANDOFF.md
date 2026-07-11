# HANDOFF — jadekey.tech

## Что это
Отдельный лендинг/сайт на домене jadekey.tech (не путать с jadekey-art —
это разные репозитории и разные Cloudflare-проекты).
Одностраничный сайт: index.html (vanilla JS, без фреймворка).

## Инфраструктура
- GitHub repo: paninsergey1965-lgtm/jadekey-tech
- ВНИМАНИЕ: git remote содержит GitHub-токен в открытом виде в URL
  (ghp_...) — токен слит, требует отзыва (revoke) в GitHub settings
  и перенастройки доступа через ~/.git_token, как в health-tracker-bot.

## Структура файлов
- index.html — весь сайт целиком
- pre.txt — HTML-сниппет прелоадера (анимация "00-61" перед показом сайта)
- patch.py / insert.py — одноразовые python-скрипты для точечных правок
  index.html через .replace() (та же техника, что в health-tracker-bot)
- newsection.html — заготовка HTML-секции для вставки
- IMG_6163.mp4 — видео для одного из разделов (вероятно use-cases/Bags)

## Известные функции в index.html
- Кнопка "Сканировать камень" (id="scan-stone-btn", строка ~142) с модалкой
  scan-qr-modal — детект mobile/desktop для выбора сценария сканирования
- Секция "Применения JadeKey" (label ~строка 261, h2 ~строка 422) —
  разделы Art, Bags/Accessories (YouTube Shorts embed), Watches

## Грабли
- Правки через .replace() в патч-скриптах — ПРОВЕРЯТЬ синтаксис/структуру
  после патча вручную (в отличие от Python-файлов, HTML не проверить
  через ast.parse — смотреть глазами через grep/sed после патча)
- data-ru атрибуты предполагают EN/RU переключение — сверять оба языка
  при правках текста

## Не сделано / открыто
- Токен в git remote требует ротации (см. выше)
