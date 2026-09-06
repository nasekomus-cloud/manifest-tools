// Логика разбиения PDF с несколькими коносаментами на группы страниц —
// одна группа на коносамент (титульный лист + приложения). Чистая функция
// от уже извлечённого текста страниц (массив строк) — без PDF-библиотеки:
// извлечение текста (pdf.js) и сама нарезка PDF (pdf-lib) — дело app.js,
// сюда попадает только результат чтения. Это и открывает путь тестировать
// логику разбиения в Node без загрузки тяжёлых PDF-библиотек.

// Титульный лист коносамента начинается с этой фразы (шапка формы
// "INTERNATIONAL BILL OF LADING (NON NEGOTIABLE)") — проверено на реальном
// файле пользователя (732 страницы, 319 коносаментов).
const TITLE_MARKER = 'INTERNATIONAL BILL OF LADING';

// Номер коносамента в этом формате — «OVP» и далее буквы/цифры/подчёркивание
// (встречаются варианты и «OVPB26Q000717», и «OVPGISKKGD000022B_F» — с
// подчёркиванием перед суффиксом). Ищем именно на титульном листе, а не по
// всему диапазону страниц коносамента: приложения содержат свои, более
// короткие «OVP...»-коды (другое поле, не номер коносамента), которые иначе
// путаются с настоящим номером.
const NUMBER_PATTERN = /\bOVP[A-Z0-9_]{6,}\b/;

/**
 * @param {string[]} pageTexts — текст каждой страницы PDF по порядку (как есть,
 *        без нормализации регистра — маркер и номер ищутся с учётом регистра,
 *        как они напечатаны в форме).
 * @returns {{ok: true, groups: Array<{number: string|null, fileName: string, startPage: number, endPage: number}>,
 *            leadingPages: number, warnings: string[]}
 *          | {ok: false, error: string}}
 *          startPage/endPage — номера страниц с 1, включительно.
 */
export function extractBillGroups(pageTexts) {
  if (!Array.isArray(pageTexts) || pageTexts.length === 0) {
    return { ok: false, error: 'В файле не нашлось ни одной страницы' };
  }

  const titleIndexes = [];
  for (let i = 0; i < pageTexts.length; i++) {
    if (pageTexts[i].includes(TITLE_MARKER)) titleIndexes.push(i);
  }

  if (titleIndexes.length === 0) {
    return {
      ok: false,
      error: 'Не нашлось ни одного титульного листа коносамента (текста «INTERNATIONAL BILL OF LADING» нет ни на одной странице)',
    };
  }

  const warnings = [];
  const leadingPages = titleIndexes[0]; // страницы до первого титульного листа — ни в одну группу не попадают
  if (leadingPages > 0) {
    warnings.push(
      `Первые ${leadingPages} стр. до первого титульного листа не отнесены ни к одному коносаменту и не попадут в архив`,
    );
  }

  const groups = [];
  for (let k = 0; k < titleIndexes.length; k++) {
    const startIdx = titleIndexes[k];
    const endIdx = (k + 1 < titleIndexes.length ? titleIndexes[k + 1] : pageTexts.length) - 1;
    const match = pageTexts[startIdx].match(NUMBER_PATTERN);

    groups.push({
      number: match ? match[0] : null,
      startPage: startIdx + 1,
      endPage: endIdx + 1,
    });
  }

  // Номер не нашёлся — не выбрасываем страницы молча, но и не выдумываем
  // номер: файл получает заметную заглушку вместо имени, а пользователь
  // видит предупреждение с точным номером страницы, где искать своими глазами.
  const withoutNumber = groups.filter((g) => g.number === null);
  for (const g of withoutNumber) {
    warnings.push(`На стр. ${g.startPage} не нашёлся номер коносамента — файл войдёт в архив без номера в имени`);
  }

  // Совпавшие номера (не должно происходить в норме, но молча перезаписывать
  // один файл другим в архиве хуже, чем дописать различающий суффикс).
  const countByNumber = new Map();
  for (const g of groups) {
    if (g.number !== null) countByNumber.set(g.number, (countByNumber.get(g.number) || 0) + 1);
  }
  const seenSoFar = new Map();
  let unnamedIndex = 0;

  for (const g of groups) {
    if (g.number === null) {
      unnamedIndex += 1;
      g.fileName = `без_номера (${unnamedIndex}, стр. ${g.startPage}-${g.endPage}).pdf`;
      continue;
    }
    if (countByNumber.get(g.number) > 1) {
      const n = (seenSoFar.get(g.number) || 0) + 1;
      seenSoFar.set(g.number, n);
      g.fileName = `${g.number} (${n}).pdf`;
      if (n === 1) {
        warnings.push(`Номер «${g.number}» встретился на нескольких титульных листах — файлы пронумерованы (1), (2)…`);
      }
    } else {
      g.fileName = `${g.number}.pdf`;
    }
  }

  return { ok: true, groups, leadingPages, warnings };
}
