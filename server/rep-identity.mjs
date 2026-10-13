export const normalizeRepId=value=>String(value??"").trim().toUpperCase().replace(/\s+/g,"");
export const validRepId=value=>/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(normalizeRepId(value));
export function nameParts(value){
 return [...new Set(String(value||"").replace(/\([^)]*\)/g,"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().match(/[a-z]+/g)||[])];
}
export function nameScore(a,b){const left=nameParts(a),right=nameParts(b);const common=left.filter(part=>right.includes(part)).length;return common>=2?common:0;}
export function uniqueNameMatch(items,name,getName=item=>item.repName){
 const ranked=items.map(item=>({item,score:nameScore(name,getName(item))})).filter(item=>item.score).sort((a,b)=>b.score-a.score);
 if(!ranked.length||ranked[1]?.score===ranked[0].score)return null;return ranked[0].item;
}
export function productionRole(value){
 const text=String(value||"").trim();
 if(/^(?:jam|new rep|rep|trainee)$/i.test(text))return "New Rep";
 if(/owner/i.test(text))return "Owner";
 if(/manager|director|admin/i.test(text))return text;
 if(/trainer/i.test(text))return "Trainer";
 if(/promoting leader|\bpl\b/i.test(text))return "Promoting Leader";
 if(/leader|\(l\)/i.test(text))return "Leader";
 return text||"New Rep";
}
export const adminRole=value=>/trainer|manager|director|admin|owner/i.test(String(value||""));
