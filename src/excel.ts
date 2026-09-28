import * as XLSX from "xlsx";
import type { Product } from "./types";

const headers = ["Name","SKU","Category","Size","Color","Barcode","Cost","Price","Qty","Reorder Level"];

export function downloadProductsExcel(products: Product[]) {
  const rows = products.map((p) => ({
    Name: p.name,
    SKU: p.sku,
    Category: p.category,
    Size: p.size ?? "",
    Color: p.color ?? "",
    Barcode: p.barcode ?? "",
    Cost: Number(p.cost ?? 0),
    Price: Number(p.price ?? 0),
    Qty: Number(p.qty ?? 0),
    "Reorder Level": Number(p.reorderLevel ?? 0)
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  worksheet["!cols"] = [
    { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 14 },
    { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 16 }
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
  XLSX.writeFile(workbook, "stockdone-products.xlsx");
}

export function parseProductsExcel(file: File): Promise<Record<string, unknown>[]> {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  });
}
