type OfflineBridge = {
  status: () => Promise<{available:boolean}>;
  exec: (sql:string, params?:unknown[]) => Promise<unknown>;
  query: <T=Record<string,unknown>>(sql:string, params?:unknown[]) => Promise<T[]>;
};

declare global {
  interface Window { stockDoneOffline?: OfflineBridge; }
}

export const offlineDb = {
  available: async () => Boolean(window.stockDoneOffline && (await window.stockDoneOffline.status()).available),
  exec: (sql:string, params:unknown[] = []) => {
    if (!window.stockDoneOffline) throw new Error("Offline database bridge unavailable.");
    return window.stockDoneOffline.exec(sql, params);
  },
  query: <T=Record<string,unknown>>(sql:string, params:unknown[] = []) => {
    if (!window.stockDoneOffline) throw new Error("Offline database bridge unavailable.");
    return window.stockDoneOffline.query<T>(sql, params);
  }
};

export async function cacheProduct(product:{
  id:string; name:string; sku:string; category?:string|null; size?:string|null;
  color?:string|null; barcode?:string|null; cost:number; price:number; qty:number; reorderLevel:number;
}) {
  const now = new Date().toISOString();
  await offlineDb.exec(
    `INSERT INTO products(id,name,sku,category,size,color,barcode,cost,price,qty,reorder_level,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name,sku=excluded.sku,category=excluded.category,
     size=excluded.size,color=excluded.color,barcode=excluded.barcode,cost=excluded.cost,
     price=excluded.price,qty=excluded.qty,reorder_level=excluded.reorder_level,updated_at=excluded.updated_at`,
    [product.id,product.name,product.sku,product.category??null,product.size??null,product.color??null,
     product.barcode??null,product.cost,product.price,product.qty,product.reorderLevel,now]
  );
}

export async function queueOfflineSale(sale:{
  id:string; invoiceNo:string; total:number; paymentMethod:string; discount:number;
  customerId?:string|null; items:{id:string;productId:string;qty:number;price:number;unitCost:number}[];
}) {
  const createdAt = new Date().toISOString();
  await offlineDb.exec("BEGIN");
  try {
    await offlineDb.exec(
      "INSERT INTO sales(id,invoice_no,total,payment_method,discount,customer_id,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
      [sale.id,sale.invoiceNo,sale.total,sale.paymentMethod,sale.discount,sale.customerId??null,"completed",createdAt]
    );
    for (const item of sale.items) {
      await offlineDb.exec(
        "INSERT INTO sale_items(id,sale_id,product_id,qty,price,unit_cost) VALUES(?,?,?,?,?,?)",
        [item.id,sale.id,item.productId,item.qty,item.price,item.unitCost]
      );
      await offlineDb.exec(
        "UPDATE products SET qty=qty-?,updated_at=? WHERE id=? AND qty>=?",
        [item.qty,createdAt,item.productId,item.qty]
      );
      await offlineDb.exec(
        "INSERT INTO stock_movements(id,product_id,type,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)",
        [crypto.randomUUID(),item.productId,"sale",-item.qty,"offline_sale",sale.id,createdAt]
      );
    }
    await offlineDb.exec(
      "INSERT INTO sync_queue(id,entity,entity_id,operation,payload,created_at,status) VALUES(?,?,?,?,?,?,?)",
      [crypto.randomUUID(),"sale",sale.id,"create",JSON.stringify(sale),createdAt,"pending"]
    );
    await offlineDb.exec("COMMIT");
  } catch (error) {
    await offlineDb.exec("ROLLBACK");
    throw error;
  }
}
