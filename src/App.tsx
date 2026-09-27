import { useEffect, useState } from "react";
import type { Product, Sale, StockMovement } from "./types";
import { storage } from "./storage";

const nav = ["Dashboard","Sales / POS","Products","Inventory","Purchases","Customers / Khata","Reports","How to Use","Settings"];

export default function App() {
  const [active, setActive] = useState("Dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Array<{product: Product; qty: number}>>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);

  useEffect(() => {
    setProducts(storage.getProducts());
    setSales(storage.getSales());
    setMovements(storage.getMovements());
  }, []);

  const saveProducts = (next: Product[]) => { setProducts(next); storage.saveProducts(next); };
  const saveMovements = (next: StockMovement[]) => { setMovements(next); storage.saveMovements(next); };
  const saveSales = (next: Sale[]) => { setSales(next); storage.saveSales(next); };

  return <div className="app">
    <aside><div className="brand"><strong>▣ StockDone</strong><small>Simple. Fast. In Control.</small></div>
      <nav>{nav.map(x=><button className={active===x?"active":""} onClick={()=>setActive(x)} key={x}>{x}</button>)}</nav>
    </aside>
    <main><header><div><h1>{active}</h1><p>Garments POS & Inventory Management</p></div><span className="status">● System Ready</span></header>
      {active==="Dashboard" ? <Dashboard products={products} sales={sales}/> :
       active==="Products" ? <Products products={products} setProducts={saveProducts}/> :
       active==="Inventory" ? <Inventory products={products} movements={movements} setProducts={saveProducts} setMovements={saveMovements}/> :
       active==="Sales / POS" ? <POS products={products} cart={cart} setCart={setCart} setProducts={saveProducts} sales={sales} setSales={saveSales} movements={movements} setMovements={saveMovements}/> :
       <section className="panel"><h2>{active}</h2><p>Module foundation ready for development.</p></section>}
    </main>
  </div>;
}

function Dashboard({products,sales}:{products:Product[];sales:Sale[]}) {
  const today = new Date().toISOString().slice(0,10);
  const todaySales = sales.filter(s=>s.createdAt.slice(0,10)===today).reduce((a,s)=>a+s.total,0);
  return <div className="grid">
    {[["Today Sales","Rs. "+todaySales],["Products",String(products.length)],["Low Stock",String(products.filter(p=>p.qty<=p.reorderLevel).length)],["Outstanding","Rs. 0"]].map(([a,b])=><section className="card" key={a}><span>{a}</span><strong>{b}</strong></section>)}
    <section className="panel"><h3>Quick Actions</h3><button onClick={()=>location.reload()}>Refresh Data</button></section>
  </div>;
}

function Products({products,setProducts}:{products:Product[];setProducts:(p:Product[])=>void}) {
  const empty:Product={id:"",name:"",sku:"",category:"",size:"",color:"",barcode:"",cost:0,price:0,qty:0,reorderLevel:5};
  const [form,setForm]=useState(empty);
  const update=(k:keyof Product,v:string)=>setForm({...form,[k]:["cost","price","qty","reorderLevel"].includes(k)?Number(v):v});
  const add=()=>{
    if(!form.name||!form.sku)return;
    if(products.some(p=>p.sku===form.sku))return alert("SKU already exists.");
    const product={...form,id:crypto.randomUUID(),barcode:form.barcode||"SD-"+String(products.length+1).padStart(6,"0")};
    setProducts([...products,product]); setForm(empty);
  };
  return <><section className="panel"><h2>Add Garment Product / Variant</h2><div className="formgrid">
    {(["name","sku","category","size","color","barcode","cost","price","qty","reorderLevel"] as (keyof Product)[]).map(k=><label key={k}>{k.toUpperCase()}<input value={String(form[k])} onChange={e=>update(k,e.target.value)} placeholder={k}/></label>)}
  </div><button className="primary" onClick={add}>Save Product</button></section>
  <section className="panel"><h2>Products ({products.length})</h2>{products.length===0?<p>No products added yet.</p>:<table><thead><tr><th>Product</th><th>SKU</th><th>Size</th><th>Color</th><th>Barcode</th><th>Price</th><th>Qty</th><th>Reorder</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.sku}</td><td>{p.size}</td><td>{p.color}</td><td>{p.barcode}</td><td>Rs. {p.price}</td><td>{p.qty}</td><td>{p.reorderLevel}</td></tr>)}</tbody></table>}</section></>;
}

function Inventory({products,movements,setProducts,setMovements}:{products:Product[];movements:StockMovement[];setProducts:(p:Product[])=>void;setMovements:(m:StockMovement[])=>void}) {
  const adjust=(p:Product,delta:number)=>{
    if(delta===0 || p.qty+delta<0)return;
    setProducts(products.map(x=>x.id===p.id?{...x,qty:x.qty+delta}:x));
    setMovements([{id:crypto.randomUUID(),productId:p.id,type:"adjustment",quantity:delta,reason:"Manual stock adjustment",createdAt:new Date().toISOString()},...movements]);
  };
  return <section className="panel"><h2>Current Inventory</h2><table><thead><tr><th>Product</th><th>SKU</th><th>Size</th><th>Color</th><th>Stock</th><th>Status</th><th>Adjust</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.sku}</td><td>{p.size}</td><td>{p.color}</td><td>{p.qty}</td><td>{p.qty<=p.reorderLevel?"Low Stock":"In Stock"}</td><td><button onClick={()=>adjust(p,-1)}>-</button> <button onClick={()=>adjust(p,1)}>+</button></td></tr>)}</tbody></table>{products.length===0&&<p>No inventory yet.</p>}</section>;
}

function POS({products,cart,setCart,setProducts,sales,setSales,movements,setMovements}:{products:Product[];cart:Array<{product:Product;qty:number}>;setCart:(c:Array<{product:Product;qty:number}>)=>void;setProducts:(p:Product[])=>void;sales:Sale[];setSales:(s:Sale[])=>void;movements:StockMovement[];setMovements:(m:StockMovement[])=>void}) {
  const [scan,setScan]=useState("");
  const add=(p:Product)=>{if(p.qty<=0)return;const f=cart.find(x=>x.product.id===p.id);setCart(f?cart.map(x=>x.product.id===p.id?{...x,qty:Math.min(x.qty+1,p.qty)}:x):[...cart,{product:p,qty:1}]);setScan("")};
  const enter=(e:React.KeyboardEvent<HTMLInputElement>)=>{if(e.key==="Enter"){const p=products.find(x=>x.barcode===scan.trim()||x.sku===scan.trim());if(p)add(p)}};
  const total=cart.reduce((s,x)=>s+x.product.price*x.qty,0);
  const complete=()=>{
    if(!cart.length)return;
    const sale:Sale={id:crypto.randomUUID(),invoiceNo:"INV-"+Date.now(),items:cart.map(x=>({productId:x.product.id,qty:x.qty,price:x.product.price})),total,paymentMethod:"cash",createdAt:new Date().toISOString()};
    setProducts(products.map(p=>{const c=cart.find(x=>x.product.id===p.id);return c?{...p,qty:p.qty-c.qty}:p}));
    const newMovements=[...cart.map(x=>({id:crypto.randomUUID(),productId:x.product.id,type:"sale" as const,quantity:-x.qty,reason:"POS sale",createdAt:new Date().toISOString()})),...movements];
    setMovements(newMovements); setSales([sale,...sales]); setCart([]); setScan(""); alert("Sale completed: "+sale.invoiceNo);
  };
  return <div className="pos"><section className="panel"><h2>Fast Sale</h2><input className="scanner" autoFocus value={scan} onChange={e=>setScan(e.target.value)} onKeyDown={enter} placeholder="Scan barcode or enter SKU, then press Enter"/><div className="product-picks">{products.map(p=><button key={p.id} onClick={()=>add(p)}>{p.name}<small>{p.barcode} • Rs. {p.price} • Stock {p.qty}</small></button>)}</div></section>
  <section className="panel"><h2>Cart</h2>{cart.length===0?<p>Scan a product to start.</p>:<table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>{cart.map(x=><tr key={x.product.id}><td>{x.product.name}</td><td>{x.qty}</td><td>Rs. {x.product.price}</td><td>Rs. {x.product.price*x.qty}</td></tr>)}</tbody></table>}<div className="total">Total: Rs. {total}</div><button className="primary" onClick={complete}>Complete Sale</button></section></div>;
}