// Куда вести после входа: только путь внутри сайта. Обычный скрипт (window.safeNext),
// без import/export — подключается страницей входа и разбирается в тесте через vm.
(function (root) {
  function safeNext(next, origin) {
    if (typeof next !== 'string' || next.charAt(0) !== '/') return '/';
    // «//host» и «/\host» — адрес на чужой сайт; управляющие символы (табуляция, CR, LF)
    // браузер при разборе адреса выбрасывает, и «/\t/evil.com» превращается в «//evil.com»
    if (next.charAt(1) === '/' || next.indexOf('\\') >= 0) return '/';
    for (var i = 0; i < next.length; i++) {
      if (next.charCodeAt(i) < 0x20 || next.charCodeAt(i) === 0x7f) return '/';
    }
    try {
      if (new URL(next, origin).origin !== origin) return '/';
    } catch (e) {
      return '/';
    }
    return next;
  }
  root.safeNext = safeNext;
})(typeof window !== 'undefined' ? window : globalThis);
