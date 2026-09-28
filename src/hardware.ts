export type PrinterPaper="80mm"|"A4";
export type HardwareBridge={printers:()=>Promise<Array<{name:string;displayName:string;description?:string;status?:number}>>;print:(html:string,paper?:PrinterPaper,deviceName?:string)=>Promise<{ok:boolean}>};
declare global { interface Window { stockDoneHardware?: HardwareBridge; } }
export function handleScannerInput(value:string,onScan:(code:string)=>void,settings=getScannerSettings()){const code=value.trim().replace(/[\\r\\n]+$/,"");if(!settings.enabled||!code)return;onScan(code)}
export function scannerBufferInput(current:string,key:string){if(key.length!==1)return current;return current+key}
export function printerSettings(paper:PrinterPaper){return {paper,thermal:paper==="80mm"}}
export async function getPrinters(){return window.stockDoneHardware?.printers() ?? []}
export function getSavedPrinterName(){try{return localStorage.getItem("stockdone.printer.name")||""}catch{return ""}}
export function savePrinterName(name:string){try{localStorage.setItem("stockdone.printer.name",name)}catch{}}
export async function printHtml(html:string,paper:PrinterPaper="A4",deviceName=""){if(window.stockDoneHardware)return window.stockDoneHardware.print(html,paper,deviceName);const w=window.open("","_blank","width=500,height=700");if(!w)throw new Error("Popup blocked.");w.document.write(html);w.document.close();return {ok:true}}

export type ScannerSettings={enabled:boolean,sound:boolean,autoFocus:boolean,delayMs:number};
const SCANNER_KEY="stockdone.scanner.settings";
export function getScannerSettings():ScannerSettings{try{return {...{enabled:true,sound:true,autoFocus:true,delayMs:30},...JSON.parse(localStorage.getItem(SCANNER_KEY)||"{}")}}catch{return {enabled:true,sound:true,autoFocus:true,delayMs:30}}}
export function saveScannerSettings(s:ScannerSettings){localStorage.setItem(SCANNER_KEY,JSON.stringify(s))}
export function scannerBeep(){try{const C=window.AudioContext||(window as any).webkitAudioContext;if(!C)return;const c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=880;g.gain.value=.04;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.07)}catch{}}
