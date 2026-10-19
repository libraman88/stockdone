import JsBarcode from "jsbarcode";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]!));

export function barcodeSvg(barcode: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, barcode, { format: "CODE128", displayValue: true, fontSize: 14, height: 70, margin: 8 });
  return new XMLSerializer().serializeToString(svg);
}

export function barcodeLabelHtml(name: string, sku: string, barcode: string, price: number) {
  const svg = barcodeSvg(barcode);
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;margin:0}.label{width:300px;padding:10px;text-align:center}.name{font-weight:700;font-size:14px}.barcode{margin:4px auto}.price{font-size:18px;font-weight:700}</style></head><body><div class="label"><div class="name">${escapeHtml(name)}</div><div>SKU: ${escapeHtml(sku)}</div><div class="barcode">${svg}</div><div class="price">Rs. ${Number(price || 0).toFixed(2)}</div></div><script>window.onload=()=>window.print()</script></body></html>`;
}

export type BarcodePrintOptions = { columns?: number; labelWidthMm?: number; labelHeightMm?: number; quantity?: number };

export function barcodeBatchHtml(name: string, sku: string, barcode: string, price: number, options: BarcodePrintOptions = {}) {
  const columns = Math.max(1, Math.min(5, Math.floor(options.columns ?? 2)));
  const qty = Math.max(1, Math.min(500, Math.floor(options.quantity ?? 1)));
  const safeName = escapeHtml(name);
  const safeSku = escapeHtml(sku);
  const safePrice = Number(price || 0).toFixed(2);
  const svg = barcodeSvg(barcode);
  const labels = Array.from({ length: qty }, () =>
    `<div class="label"><div class="name">${safeName}</div><div>SKU: ${safeSku}</div><div class="barcode">${svg}</div><div class="price">Rs. ${safePrice}</div></div>`
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>StockDone Barcode Labels</title><style>@page{margin:4mm}body{font-family:Arial;margin:0}.sheet{display:grid;grid-template-columns:repeat(${columns},1fr);gap:2mm}.label{text-align:center;border:1px dashed #999;padding:3mm;break-inside:avoid;min-height:${Math.max(10, Math.min(150, options.labelHeightMm ?? 30))}mm}.name{font-weight:700;font-size:12px;overflow-wrap:anywhere}.barcode{margin:2px auto}.barcode svg{max-width:100%;height:auto}.price{font-size:15px;font-weight:700}@media print{.label{break-inside:avoid}}</style></head><body><div class="sheet">${labels}</div><script>window.onload=()=>window.print()</script></body></html>`;
}

export function printBarcodeBatch(name: string, sku: string, barcode: string, price: number, options: BarcodePrintOptions = {}) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) throw new Error("Print window was blocked. Allow pop-ups for StockDone, then try again.");
  try {
    w.document.open();
    w.document.write(barcodeBatchHtml(name, sku, barcode, price, options));
    w.document.close();
  } catch (error) {
    w.close();
    throw new Error(error instanceof Error ? `Barcode print window failed: ${error.message}` : "Barcode print window failed.");
  }
}

export function printBarcodeLabel(name: string, sku: string, barcode: string, price: number) {
  printBarcodeBatch(name, sku, barcode, price, { columns: 1, quantity: 1, labelHeightMm: 35 });
}

export function generateBarcode(prefix = "SD") {
  const safe = prefix.replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || "SD";
  return safe + "-" + Date.now().toString().slice(-10) + Math.floor(Math.random() * 90 + 10);
}

export function generateBarcodeBatch(prefix = "SD", count = 1) {
  const n = Math.max(1, Math.min(500, Math.floor(count)));
  return Array.from({ length: n }, () => generateBarcode(prefix));
}
