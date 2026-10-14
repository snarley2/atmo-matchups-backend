import {canonicalOffice} from '../offices.mjs';
import {uniqueNameMatch} from './rep-identity.mjs';
export const workAvailable=rep=>!!rep&&!/^absent$/i.test(rep.repType||'')&&((rep.attendance||'in')==='in'||(rep.attendance==='roadtrip'&&!rep.roadtripActive));
export function liveWorkGroups(groups,agents){
 return groups.map(group=>{
  const members=(group.members||[]).map(member=>{
   const scope=member.office||group.office;const roster=scope?agents.filter(rep=>canonicalOffice(rep.office)===canonicalOffice(scope)):agents;
   const exact=roster.filter(rep=>String(rep.repKey)===String(member.repKey));const live=exact.length===1?exact[0]:uniqueNameMatch(roster,member.repName);
   return live?{...member,...live}:null;
  }).filter(workAvailable);
  const electric=members.reduce((n,rep)=>n+(Number(rep.productionLog?.lastDay?.electric)||0)+(Number(rep.productionLog?.lastDay?.partials)||0),0),gas=members.reduce((n,rep)=>n+(Number(rep.productionLog?.lastDay?.gas)||0),0);
  return {...group,members,electric,gas,production:electric*40+gas*18};
 });
}
