export type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  size: string;
  color: string;
  barcode: string;
  cost: number;
  price: number;
  qty: number;
  reorderLevel: number;
};

export type StockMovement = {
  id: string;
  productId: string;
  type: "opening" | "purchase" | "sale" | "sale_return" | "purchase_return" | "adjustment";
  quantity: number;
  reason?: string;
  referenceId?: string;
  createdAt: string;
};

export type Sale = {
  id: string;
  invoiceNo: string;
  items: Array<{ productId: string; qty: number; price: number }>;
  total: number;
  paymentMethod: "cash" | "card" | "bank" | "other";
  createdAt: string;
};
