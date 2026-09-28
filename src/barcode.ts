import JsBarcode from "jsbarcode";

export function barcodeSvg(barcode:string){const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");JsBarcode(svg,barcode,{format:"CODE128",displayValue:true,fontSize:14,height:70,margin:8});return new XMLSerializer().serializeToString(svg)}

export function barcodeLabelHtml(name:string,sku:string,barcode:string,price:number){const svg=barcodeSvg(barcode);return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;margin:0}.label{width:300px;padding:10px;text-align:center}.name{font-weight:700;font-size:14px}.barcode{margin:4px auto}.price{font-size:18px;font-weight:700}</style></head><body><div class="label"><div class="name">${name}</div><div>SKU: ${sku}</div><div class="barcode">${svg}</div><div class="price">Rs. ${price}</div></div><script>window.onload=()=>window.print()</script></body></html>`}
export function printBarcodeLabel(name:string,sku:string,barcode:string,price:number){const w=window.open("","_blank","width=400,height=300");if(w){w.document.write(barcodeLabelHtml(name,sku,barcode,price));w.document.close()}}
