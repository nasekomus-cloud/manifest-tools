// Итоговый PDF-отчёт по манифесту («Grand Total») — трёхстрочная обёртка над
// общей логикой подсчёта (lib/port-breakdown.js), по образцу dashboard/core.js:
// вся дедупликация, пропуск строк без контейнера и подсчёт коносаментов уже
// там, здесь только добавляется судно/рейс из шапки первого файла (тот же
// файл, что уже играет роль эталонного при проверке структуры).

import { buildManifestTotals } from '../lib/port-breakdown.js?v=202609111500';
import { readVoyageHeader } from '../lib/manifest-format.js?v=202609121930';

/**
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} workbooks
 * @returns {{ok: true, vessel: string|null, voyage: string|null,
 *            byType: Array<{type: string, isEmpty: boolean, count: number, cargoWeight: number, tareWeight: number, totalWeight: number}>,
 *            grandTotal: {count: number, cargoWeight: number, tareWeight: number, totalWeight: number},
 *            billsOfLading: number|null}
 *          | {ok: false, error: string}}
 */
export function buildGrandTotalData(workbooks) {
  const totals = buildManifestTotals(workbooks);
  if (!totals.ok) return totals;

  const { vessel, voyage } = readVoyageHeader(workbooks[0].workbook);

  return {
    ok: true,
    vessel,
    voyage,
    byType: totals.byType,
    grandTotal: totals.grandTotal,
    billsOfLading: totals.billsOfLading,
  };
}
