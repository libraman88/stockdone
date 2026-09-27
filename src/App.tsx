import {useState} from "react";

const nav=["Dashboard","Sales / POS","Products","Inventory","Purchases","Customers / Khata","Reports","How to Use","Settings"];
type Product={name:string;sku:string;category:string;size:string;color:string;barcode:string;cost:number;price:number;qty:number};

export default function App(){
 const [active,setActive]=useState("Dashboard");
 const [products,setProducts]=useState<Product[]>([]);
 return <div className="app"><aside><div className="brand"><strong>▣ StockDone</strong><small>Simple. Fast. In Control.</small></div><nav>{nav.map(x=><button className={active===x?"active":""} onClick={()=>setActive(x)} key={x}>{x}</button>)}</nav></aside><main><header><div><h1>{active}</h1><p>Garments POS & Inventory Management</p></div><span className="status">● System Ready</span></header>{active==="Dashboard"?<Dashboard products={products}/>:active==="Products"?<Products products={products} setProducts={setProducts}/>:<section className="panel"><h2>{active}</h2><p>Module foundation ready for development.</p></section>}</main></div>
}
function Dashboard({products}:{products:Product[]}){return <div className="grid">{[["Today Sales","Rs. 0"],["Products",String(products.length)],["Low Stock",String(products.filter(p=>p.qty<=5).length)],["Outstanding","Rs. 0"]].map(([a,b])=><section className="card" key={a}><span>{a}</span><strong>{b}</strong></section>)}<section className="panel"><h3>Quick Actions</h3><button>+ New Sale</button><button>+ Add Product</button><button>+ Purchase</button><button>Print Barcode</button></section></div>}
function Products({products,setProducts}:{products:Product[];setProducts:(p:Product[])=>void}){
 const [form,setForm]=useState<Product>({name:"",sku:"",category:"",size:"",color:"",barcode:"",cost:0,price:0,qty:0});
 const update=(k:keyof Product,v:string)=>setForm({...form,[k]:["cost","price","qty"].includes(k)?Number(v):v});
 const add=()=>{if(!form.name||!form.sku)return;setProducts([...products,form]);setForm({name:"",sku:"",category:"",size:"",color:"",barcode:"",cost:0,price:0,qty:0})};
 return <><section className="panel"><h2>Add Garment Product / Variant</h2><div className="formgrid">{(["name","sku","category","size","color","barcode","cost","price","qty"] as (keyof Product)[]).map(k=><label key={k}>{k.toUpperCase()}<input value={String(form[k])} onChange={e=>update(k,e.target.value)} placeholder={k}/></label>)}</div><button className="primary" onClick={add}>Save Product</button></section><section className="panel"><h2>Products ({products.length})</h2>{products.length===0?<p>No products added yet.</p>:<table><thead><tr><th>Product</th><th>SKU</th><th>Size</th><th>Color</th><th>Barcode</th><th>Price</th><th>Qty</th></tr></thead><tbody>{products.map((p,i)=><tr key={i}><td>{p.name}</td><td>{p.sku}</td><td>{p.size}</td><td>{p.color}</td><td>{p.barcode}</td><td>Rs. {p.price}</td><td>{p.qty}</td></tr>)}</tbody></table>}</section></>
}