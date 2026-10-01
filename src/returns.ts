export type ReturnRecord = {
  id: string;
  returnNo: string;
  saleId?: string;
  productId: string;
  qty: number;
  refundAmount: number;
  reason: string;
  createdAt: string;
};

const RETURNS_KEY = "stockdone.returns";

function read<T>(key:string,fallback:T):T {
  try { const value=localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}
export const returnStorage = {
  get:()=>read<ReturnRecord[]>(RETURNS_KEY,[]),
  save:(v:ReturnRecord[])=>localStorage.setItem(RETURNS_KEY,JSON.stringify(v)),
};
