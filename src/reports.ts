import type { Product, Sale, StockMovement } from "./types";
import type { Purchase } from "./purchases";
import type { ReturnRecord } from "./returns";

export function salesTotal(sales: Sale[], from?: string, to?: string) {
  return sales.filter(s => (!from || s.createdAt >= from) && (!to || s.createdAt <= to)).reduce((n, s) => n + s.total, 0);
}
export function stockValue(products: Product[]) { return products.reduce((n, p) => n + p.qty * p.cost, 0); }
export function movementSummary(movements: StockMovement[]) {
  return movements.reduce<Record<string, number>>((a, m) => { a[m.type] = (a[m.type] || 0) + m.quantity; return a; }, {});
}
export function purchaseTotal(purchases: Purchase[]) { return purchases.reduce((n, p) => n + p.total, 0); }
export function returnTotal(returns: ReturnRecord[]) { return returns.reduce((n, r) => n + r.refundAmount, 0); }
export function exportCsv(headers: string[], rows: string[][]) {
  const esc = (v: string) => '"' + String(v).replaceAll('"', '""') + '"';
  return [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
}