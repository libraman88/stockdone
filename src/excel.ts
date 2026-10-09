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
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
    const normalize = (value: unknown) => String(value ?? "").replace(/^\\uFEFF/, "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\\s+/g, " ");
    const aliases: Record<string,string> = {
      "name":"Name","product":"Name","product name":"Name","item":"Name","item name":"Name","description":"Name",
      "sku":"SKU","code":"SKU","item code":"SKU","product code":"SKU","stock keeping unit":"SKU",
      "barcode":"Barcode","bar code":"Barcode","ean":"Barcode","category":"Category","brand":"Brand",
      "sub category":"Sub-category","subcategory":"Sub-category","floor":"Floor","warehouse":"Warehouse",
      "size":"Size","color":"Color","colour":"Color","cost":"Cost","purchase cost":"Cost","unit cost":"Cost",
      "price":"Price","sale price":"Price","selling price":"Price","retail price":"Price",
      "qty":"Qty","quantity":"Qty","stock":"Qty","opening stock":"Qty","reorder level":"Reorder Level","reorder point":"Reorder Level"
    };
    let headerIndex = -1;
    let headers: string[] = [];
    for (let i=0; i<Math.min(matrix.length,30); i++) {
      const candidate = (matrix[i] || []).map(v => aliases[normalize(v)] || String(v ?? "").trim());
      if (candidate.includes("Name") && candidate.some(v => ["Price","SKU","Barcode","Qty","Category"].includes(v))) {
        headerIndex = i; headers = candidate; break;
      }
    }
    if (headerIndex < 0) throw new Error("Excel header row not found. Required columns: Name and at least one of Price, SKU, Barcode, Qty, or Category.");
    const rows: Record<string,unknown>[] = [];
    for (const cells of matrix.slice(headerIndex+1)) {
      if (!(cells || []).some(v => String(v ?? "").trim() !== "")) continue;
      const row: Record<string,unknown> = {};
      headers.forEach((key,index) => { if (key) row[key] = cells?.[index] ?? ""; });
      rows.push(row);
    }
    return rows;
  });
}

export function downloadSheetExcel(sheetName:string,fileName:string,rows:Record<string,unknown>[]){const wb=XLSX.utils.book_new();const ws=XLSX.utils.json_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,sheetName.slice(0,31)||"Export");XLSX.writeFile(wb,fileName.endsWith(".xlsx")?fileName:fileName+".xlsx")}
export const exportInventoryExcel=(rows:Record<string,unknown>[])=>downloadSheetExcel("Inventory","stockdone-inventory.xlsx",rows);
export const exportSalesExcel=(rows:Record<string,unknown>[])=>downloadSheetExcel("Sales","stockdone-sales.xlsx",rows);
export const exportPurchasesExcel=(rows:Record<string,unknown>[])=>downloadSheetExcel("Purchases","stockdone-purchases.xlsx",rows);
export const exportCustomersExcel=(rows:Record<string,unknown>[])=>downloadSheetExcel("Customers","stockdone-customers.xlsx",rows);
export const exportMovementsExcel=(rows:Record<string,unknown>[])=>downloadSheetExcel("Movements","stockdone-stock-movements.xlsx",rows);

export const exportReturnsExcel=(rows:Record<string,unknown>[])=>downloadSheetExcel("Returns","stockdone-returns.xlsx",rows);
export const exportReportExcel=(sheetName:string,fileName:string,rows:Record<string,unknown>[])=>downloadSheetExcel(sheetName,fileName,rows);
