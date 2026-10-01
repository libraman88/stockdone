export type Supplier = {
  id: string;
  name: string;
  phone: string;
  address: string;
};

export type PurchaseItem = {
  productId: string;
  qty: number;
  cost: number;
};

export type Purchase = {
  id: string;
  invoiceNo: string;
  supplierId: string;
  items: PurchaseItem[];
  total: number;
  createdAt: string;
};

const SUPPLIERS_KEY = "stockdone.suppliers";
const PURCHASES_KEY = "stockdone.purchases";

function read<T>(key:string, fallback:T):T {
  try { const value=localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}

function write<T>(key:string,value:T) { localStorage.setItem(key,JSON.stringify(value)); }

export const purchaseStorage = {
  getSuppliers:()=>read<Supplier[]>(SUPPLIERS_KEY,[]),
  saveSuppliers:(items:Supplier[])=>write(SUPPLIERS_KEY,items),
  getPurchases:()=>read<Purchase[]>(PURCHASES_KEY,[]),
  savePurchases:(items:Purchase[])=>write(PURCHASES_KEY,items),
};
