export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string;
  balance: number;
};

export type CustomerTransaction = {
  id: string;
  customerId: string;
  type: "credit_sale" | "payment" | "return";
  amount: number;
  reference?: string;
  note?: string;
  createdAt: string;
};

const CUSTOMERS_KEY = "stockdone.customers";
const CUSTOMER_TX_KEY = "stockdone.customerTransactions";

function read<T>(key:string,fallback:T):T {
  try { const value=localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}
function write<T>(key:string,value:T) { localStorage.setItem(key,JSON.stringify(value)); }

export const customerStorage = {
  getCustomers:()=>read<Customer[]>(CUSTOMERS_KEY,[]),
  saveCustomers:(v:Customer[])=>write(CUSTOMERS_KEY,v),
  getTransactions:()=>read<CustomerTransaction[]>(CUSTOMER_TX_KEY,[]),
  saveTransactions:(v:CustomerTransaction[])=>write(CUSTOMER_TX_KEY,v),
};
