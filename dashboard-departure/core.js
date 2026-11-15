// Дашборд по портам отправления — тонкая обёртка над общей логикой подсчёта
// разбивки (lib/port-breakdown.js), которая делит инструмент с dashboard/
// (та же логика, другая колонка-порт: «Порт погрузки», колонка Y; до 2026-11-15 — «Порт отправления», F). Подробности — в lib/port-breakdown.js.

import { buildPortBreakdownDashboard } from '../lib/port-breakdown.js?v=202609131530';

/**
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} workbooks
 * @returns {{ok: true, perFile: Array<{fileName: string, breakdown: object}>, combined: object}
 *          | {ok: false, error: string}}
 */
export function buildPortDashboard(workbooks) {
  return buildPortBreakdownDashboard(workbooks, {
    portKeyword: 'погрузки',
    portLabel: '«Порт погрузки»',
  });
}
