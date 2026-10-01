import type { Product, Sale, StockMovement } from "./types";

const PRODUCTS_KEY = "stockdone.products";
const MOVEMENTS_KEY = "stockdone.stockMovements";
const SALES_KEY = "stockdone.sales";

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  getProducts: () => read<Product[]>(PRODUCTS_KEY, []),
  saveProducts: (products: Product[]) => write(PRODUCTS_KEY, products),
  getMovements: () => read<StockMovement[]>(MOVEMENTS_KEY, []),
  saveMovements: (movements: StockMovement[]) => write(MOVEMENTS_KEY, movements),
  getSales: () => read<Sale[]>(SALES_KEY, []),
  saveSales: (sales: Sale[]) => write(SALES_KEY, sales),
};
