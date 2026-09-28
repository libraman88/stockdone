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

export function login(username: string, password: string) {
  return apiRequest<{token:string;user:{id:string;username:string;name:string;role:string}}>("/auth/login", {
    method: "POST", body: JSON.stringify({username,password})
  });
}

export function getProducts() {
  return apiRequest<Product[]>("/products");
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
