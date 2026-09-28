import type { Product } from "./types";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
let token = sessionStorage.getItem("stockdone.apiToken");

export function setApiToken(value: string | null) {
  token = value;
  if (value) sessionStorage.setItem("stockdone.apiToken", value);
  else sessionStorage.removeItem("stockdone.apiToken");
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(BASE_URL + path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "API request failed");
  return data as T;
}

export function requestPasswordReset(username:string){return apiRequest<{ok:boolean;message:string}>("/auth/password-reset/request",{method:"POST",body:JSON.stringify({username})});}
export function confirmPasswordReset(token:string,password:string){return apiRequest<{ok:boolean}>("/auth/password-reset/confirm",{method:"POST",body:JSON.stringify({token,password})});}
export type AuthSession={id:string;created_at:string;expires_at:string;revoked_at:string|null};
export function getAuthSessions(){return apiRequest<AuthSession[]>("/auth/sessions");}
export function logout(){return apiRequest<{ok:boolean}>("/auth/logout",{method:"POST"}).finally(()=>setApiToken(null));}
export function logoutAll(){return apiRequest<{ok:boolean}>("/auth/logout-all",{method:"POST"}).finally(()=>setApiToken(null));}

export function login(username: string, password: string) {
  return apiRequest<{token:string;user:{id:string;username:string;name:string;role:string}}>("/auth/login", {
    method: "POST", body: JSON.stringify({username,password})
  });
}

export function getProducts() {
  return apiRequest<Product[]>("/products").then(rows => rows.map((p: any) => ({...p, variantId: p.variantId || p.variant_id, reorderLevel: Number(p.reorderLevel ?? p.reorder_level ?? 5), qty: Number(p.qty ?? 0), cost: Number(p.cost ?? 0), price: Number(p.price ?? 0)})));
}

export function createProduct(product: Omit<Product,"id">) {
  return apiRequest<{id:string;variantId:string}>("/products", {
    method: "POST",
    body: JSON.stringify({
      name: product.name, sku: product.sku, categoryId: null,
      size: product.size || null, color: product.color || null,
      barcode: product.barcode || null, cost: product.cost,
      price: product.price, qty: product.qty, reorderLevel: product.reorderLevel
    })
  });
}

export type ApiSaleItem = { variantId: string; qty: number; price: number };
export function createSale(input: { invoiceNo: string; paymentMethod: "cash"|"card"|"bank"|"other"; discount: number; customerId?: string; received?: number; change?: number; items: ApiSaleItem[] }) {
  return apiRequest<{id:string;invoiceNo:string;total:number}>("/sales", { method: "POST", body: JSON.stringify(input) });
}

export function createPurchase(input: { invoiceNo: string; supplierId?: string; items: { variantId: string; quantity: number; cost: number }[] }) {
  return apiRequest<{id:string;invoiceNo:string;total:number}>("/purchases", { method: "POST", body: JSON.stringify(input) });
}

export type ApiCustomer = { id:string; name:string; phone?:string|null; address?:string|null; balance:number };
export function getCustomers(){return apiRequest<ApiCustomer[]>("/customers");}
export function createCustomer(input:{name:string;phone?:string;address?:string}){return apiRequest<ApiCustomer>("/customers",{method:"POST",body:JSON.stringify(input)});}
export function recordCustomerPayment(id:string,amount:number,note?:string){return apiRequest<{customerId:string;balance:number}>(`/customers/${id}/payment`,{method:"POST",body:JSON.stringify({amount,note})});}

export type ApiReturnItem={variantId:string;quantity:number;unitPrice:number};
export function createReturn(input:{saleId:string;type:"return"|"exchange";refundAmount:number;items:ApiReturnItem[];exchangeItems?:ApiReturnItem[]}){return apiRequest<{id:string;type:string;refundAmount:number;priceDifference:number}>("/returns",{method:"POST",body:JSON.stringify(input)});}
export function getSales(){return apiRequest<any[]>("/sales");}

export type ReportSummary={sales:{invoices:number;sales_total:number;discounts:number};profit:{gross_profit:number};inventory:{variants:number;units:number;cost_value:number;retail_value:number};lowStock:Array<{name:string;sku:string;size:string|null;color:string|null;quantity:number;reorder_level:number}>};
export function getReportSummary(from:string,to:string){return apiRequest<ReportSummary>(`/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}

export type DailySalesReport={date:string;invoices:number;total:number;discounts:number};
export type PaymentReport={method:string;invoices:number;total:number};
export type ProductReport={name:string;sku:string;size:string|null;color:string|null;units:number;sales:number;cost:number;gross_profit:number};
export function getSalesReport(from:string,to:string){return apiRequest<{daily:DailySalesReport[];payments:PaymentReport[]}>(`/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
export function getProductReport(from:string,to:string){return apiRequest<ProductReport[]>(`/reports/products?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
export function getPurchaseReport(from:string,to:string){return apiRequest<any[]>(`/reports/purchases?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
export function getKhataReport(){return apiRequest<any[]>("/reports/khata");}

export type AdminRole={id:string;name:string;permissions:string[]};
export type AdminPermission={code:string;description:string};
export function getAdminRoles(){return apiRequest<AdminRole[]>("/admin/roles");}
export function getAdminPermissions(){return apiRequest<AdminPermission[]>("/admin/permissions");}
export function createAdminRole(input:{name:string;permissionCodes:string[]}){return apiRequest<AdminRole>("/admin/roles",{method:"POST",body:JSON.stringify(input)});}
export function updateAdminRolePermissions(id:string,permissionCodes:string[]){return apiRequest<{ok:boolean}>(`/admin/roles/${id}/permissions`,{method:"PUT",body:JSON.stringify({permissionCodes})});}
export type AuditLog={id:string;user_id:string|null;action:string;entity:string;entity_id:string|null;details:any;created_at:string};
export function getAuditLogs(){return apiRequest<AuditLog[]>("/audit-logs");}
export type AdminUser={id:string;username:string;name:string;role:"owner"|"manager"|"cashier";active:boolean;created_at:string};
export function getAdminUsers(){return apiRequest<AdminUser[]>("/admin/users");}
export function createAdminUser(input:{username:string;name:string;role:"manager"|"cashier";password:string}){return apiRequest<AdminUser>("/admin/users",{method:"POST",body:JSON.stringify(input)});}
export function setAdminUserStatus(id:string,active:boolean){return apiRequest<AdminUser>(`/admin/users/${id}/status`,{method:"PATCH",body:JSON.stringify({active})});}
export function setAdminUserPassword(id:string,password:string){return apiRequest<{ok:boolean}>(`/admin/users/${id}/password`,{method:"PATCH",body:JSON.stringify({password})});}

export function createVariant(productId:string,input:{size?:string;color?:string;barcode?:string;cost:number;price:number;qty:number;reorderLevel:number}){return apiRequest<{variantId:string}>(`/products/${productId}/variants`,{method:"POST",body:JSON.stringify(input)});}

export function adjustInventory(input:{variantId:string;quantityDelta:number;reason:"Damaged"|"Missing"|"Physical Count"|"Correction"|"Other";note?:string}){return apiRequest<{id:string;quantity:number}>("/inventory/adjustments",{method:"POST",body:JSON.stringify(input)});}

export function createStockTransfer(input:{toBranchId:string;items:{variantId:string;quantity:number}[]}){return apiRequest<{id:string;status:string}>("/inventory/transfers",{method:"POST",body:JSON.stringify(input)});}

export type Branch={id:string;name:string;code:string};
export function getBranches(){return apiRequest<Branch[]>("/branches");}
export function createBranch(input:{name:string;code:string}){return apiRequest<Branch>("/branches",{method:"POST",body:JSON.stringify(input)});}
export function receiveStockTransfer(id:string){return apiRequest<{id:string;status:string}>(`/inventory/transfers/${id}/receive`,{method:"POST"});}

export function getStockTransfers(){return apiRequest<any[]>("/inventory/transfers");}

export function getPurchases(){return apiRequest<any[]>("/purchases");}

export type Supplier={id:string;name:string;phone?:string|null;address?:string|null};
export function getSuppliers(){return apiRequest<Supplier[]>("/suppliers");}
export function createSupplier(input:{name:string;phone?:string;address?:string}){return apiRequest<Supplier>("/suppliers",{method:"POST",body:JSON.stringify(input)});}
