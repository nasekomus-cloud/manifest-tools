// Дашборд по портам назначения — тонкая обёртка над общей логикой подсчёта
// разбивки (lib/port-breakdown.js), которая делит инструмент с
// dashboard-departure/ (та же логика, другая колонка-порт). Подробности —
// в lib/port-breakdown.js.

import { buildPortBreakdownDashboard } from '../lib/port-breakdown.js?v=202609131530';

/**
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} workbooks
 * @returns {{ok: true, perFile: Array<{fileName: string, breakdown: object}>, combined: object}
 *          | {ok: false, error: string}}
 */
export function buildPortDashboard(workbooks) {
  return buildPortBreakdownDashboard(workbooks, {
    portKeyword: 'назначения',
    portLabel: '«Порт назначения»',
    // Порожние контейнеры (вес груза 0) отдельной строкой от гружёных того
    // же типа — только для этого инструмента, dashboard-departure/core.js
    // параметр не передаёт (см. spec.md, «Разбивка порожних»).
    splitEmpty: true,
  });
}
