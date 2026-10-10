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
    const normalize = (value: unknown) => String(value ?? "")
      .replace(/^\uFEFF/, "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\*+$/, "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
    const aliases: Record<string,string> = {
      "name":"Name","product":"Name","product name":"Name","item":"Name","item name":"Name",
      "name of product":"Name","product title":"Name","item description":"Name","description":"Name",
      "sku":"SKU","code":"SKU","item code":"SKU","product code":"SKU","stock keeping unit":"SKU",
      "barcode":"Barcode","bar code":"Barcode","ean":"Barcode","category":"Category","brand":"Brand",
      "sub category":"Sub-category","subcategory":"Sub-category","sub-category":"Sub-category",
      "floor":"Floor","warehouse":"Warehouse","size":"Size","color":"Color","colour":"Color",
      "cost":"Cost","purchase cost":"Cost","unit cost":"Cost","price":"Price","sale price":"Price",
      "selling price":"Price","retail price":"Price","qty":"Qty","quantity":"Qty","stock":"Qty",
      "opening stock":"Qty","reorder level":"Reorder Level","reorder point":"Reorder Level"
    };
    const canonical = (value: unknown) => aliases[normalize(value)] || "";
    // Excel files from different suppliers often put the real data on a later worksheet
    // or place a title/logo above the header. Search every worksheet and a generous
    // number of leading rows instead of assuming the first sheet/first 30 rows.
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1, defval: "", blankrows: false
      });
      let headerIndex = -1;
      let headers: string[] = [];
      for (let i = 0; i < Math.min(matrix.length, 200); i++) {
        const candidate = (matrix[i] || []).map(canonical);
        const recognized = candidate.filter(Boolean);
        // A product-name column is the reliable anchor. Also accept a row with a
        // unique product identifier plus a price/stock field for common supplier sheets.
        const hasName = candidate.includes("Name");
        const hasIdentifier = candidate.includes("SKU") || candidate.includes("Barcode");
        const hasProductData = candidate.includes("Price") || candidate.includes("Qty") || candidate.includes("Category");
        if (hasName || (hasIdentifier && hasProductData)) {
          headerIndex = i;
          headers = (matrix[i] || []).map((value) => canonical(value) || String(value ?? "").trim());
          break;
        }
        // Keep scanning; title rows and merged cells are common in vendor exports.
        void recognized;
      }
      if (headerIndex < 0) continue;
      const rows: Record<string,unknown>[] = [];
      for (const cells of matrix.slice(headerIndex + 1)) {
        if (!(cells || []).some(v => String(v ?? "").trim() !== "")) continue;
        const row: Record<string,unknown> = {};
        headers.forEach((key,index) => {
          if (key) row[key] = cells?.[index] ?? "";
        });
        // Ignore footer/notes rows that do not identify a product.
        const name = String(row.Name ?? "").trim();
        const sku = String(row.SKU ?? "").trim();
        const barcode = String(row.Barcode ?? "").trim();
        if (name || sku || barcode) rows.push(row);
      }
      if (rows.length) return rows;
    }
    throw new Error("Excel product columns not found. Check that a worksheet has a Name/Product Name/Item Name column, or SKU/Barcode with Price/Qty/Category. The importer checked all worksheets and the first 200 rows of each.");
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
