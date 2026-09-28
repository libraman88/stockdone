export type PrinterPaper="80mm"|"A4";
export type HardwareBridge={printers:()=>Promise<Array<{name:string;displayName:string;description?:string;status?:number}>>;print:(html:string,paper?:PrinterPaper,deviceName?:string)=>Promise<{ok:boolean}>};
declare global { interface Window { stockDoneHardware?: HardwareBridge; } }
export function handleScannerInput(value:string,onScan:(code:string)=>void){const code=value.trim().replace(/[\\r\\n]+$/,"");if(code)onScan(code)}
export function printerSettings(paper:PrinterPaper){return {paper,thermal:paper==="80mm"}}
export async function getPrinters(){return window.stockDoneHardware?.printers() ?? []}
export function getSavedPrinterName(){try{return localStorage.getItem("stockdone.printer.name")||""}catch{return ""}}
export function savePrinterName(name:string){try{localStorage.setItem("stockdone.printer.name",name)}catch{}}
export async function printHtml(html:string,paper:PrinterPaper="A4",deviceName=""){if(window.stockDoneHardware)return window.stockDoneHardware.print(html,paper,deviceName);const w=window.open("","_blank","width=500,height=700");if(!w)throw new Error("Popup blocked.");w.document.write(html);w.document.close();return {ok:true}}
