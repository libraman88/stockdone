export type Product = {
  id: string;
  variantId?: string;
  name: string;
  sku: string;
  category: string;
  brand?: string;
  subCategory?: string;
  floor?: string;
  warehouse?: string;
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
  items: Array<{ productId: string; variantId?: string; qty: number; price: number }>;
  total: number;
  paymentMethod: "cash" | "card" | "bank" | "other";
  discount?: number;
  customerId?: string;
  createdAt: string;
};

export type Payment = {
  id: string;
  saleId: string;
  method: "cash" | "card" | "bank" | "other";
  amount: number;
  received?: number;
  change?: number;
  createdAt: string;
};

export type InvoiceSettings = {
  businessName: string;
  phone: string;
  address: string;
  footer: string;
  paper: "A4" | "80mm";
  printerName?: string;
};
