"""Generate a fully offline, static HTML explorer for IQOS archive event records."""
from __future__ import annotations
import argparse
import html
import json
from pathlib import Path
from iqos_agent.storage import DB_FOLDER, connect, latest_snapshots
from iqos_agent.record_decode import decode_puffs

TEMPLATE = r'''<!doctype html>
<html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IQOS History – archiv událostí</title>
<style>
:root{color-scheme:dark;background:#10151c;color:#e9eff4;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif}
*{box-sizing:border-box}body{margin:0 auto;max-width:1350px;padding:28px 30px}h1{font-size:27px;margin:0 0 5px}
p{color:#a8b5c2;font-size:14px;line-height:1.5}header{margin-bottom:26px}
.badge{display:inline-block;background:#243142;padding:6px 10px;border-radius:10px;color:#bcd3ec;font-size:12px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px;margin:18px 0}
.summary>div{background:#1a222c;border:1px solid #2a3b4a;border-radius:14px;padding:18px}
.summary b{font-size:26px;display:block}.summary small{color:#9eb0c1}
.filters{display:flex;gap:13px;flex-wrap:wrap;margin:24px 0 15px;align-items:end}
.filters label{color:#a8b5c2;font-size:12px;display:grid;gap:5px}
select,input{min-height:39px;background:#18232e;color:#e9eff4;border:1px solid #3c4c5b;border-radius:8px;padding:6px 9px;font:inherit}
section{background:#171e26;border:1px solid #293744;border-radius:14px;padding:20px;margin:18px 0}
.devicegrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.devicecard{border:1px solid #354655;border-radius:12px;padding:16px;background:#1c2834}
.devicecard h3{margin:0 0 12px;font-size:16px}
.devicecard dl{display:grid;grid-template-columns:1.2fr 1fr;gap:9px;margin:0;font-size:13px}
.devicecard dt{color:#a8b5c2}.devicecard dd{margin:0;text-align:right;font-weight:600}
.devicecard details{margin-top:12px}.devicecard pre{white-space:pre-wrap;word-break:break-all;font-size:11px;color:#a7c2d1}
.devicefoot{color:#b9a768;font-size:12px;line-height:1.5;margin-top:12px}
h2{font-size:18px;margin:0 0 17px}.bars{height:145px;display:flex;gap:5px;align-items:end;overflow-x:auto;min-width:100%}
.barwrap{min-width:35px;flex:1;display:flex;align-items:center;flex-direction:column;gap:7px;justify-content:flex-end;height:100%}
.bar{width:85%;max-width:40px;border-radius:6px 6px 2px 2px;background:#24bac7;min-height:2px}
.barlabel{font-size:10px;color:#91a9b6;white-space:nowrap}
.barcount{font-size:10px;color:#d6eef0}
.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;color:#a6b7c7;font-weight:600;border-bottom:1px solid #344756;padding:12px}
td{padding:11px 12px;border-bottom:1px solid #263543;white-space:nowrap}
code{font-family:ui-monospace,Cascadia Code,Consolas,monospace;color:#b4d3eb}
.raw{white-space:normal;word-break:break-all;max-width:450px}button{background:none;border:1px solid #415468;color:#c3dfe9;border-radius:7px;padding:4px 9px;cursor:pointer}
.warn{border-left:3px solid #d8af4e;padding-left:13px}small.note{color:#95acbd}
</style></head><body>
<header><h1>IQOS History <span class="badge">Lokální archiv</span></h1>
<p>USB historické záznamy · každé ID uchováno právě jednou · bez cloudových služeb</p>
<p class="warn">Důležité: jeden archivní záznam <b>není automaticky jedna vykouřená náplň</b>. Denní graf počítá časované události, ne potvrzenou spotřebu. Některé starší časy (zejména modrá) mohou být nesprávné. Počet položek potáhnutí nově čteme přímo z archivních záznamů (experimentální dekódování, ověřené 26 vzorky a 2 kontrolovanými relacemi). Přesný konec použití je zatím doložen jen u dvou ručně měřených relací.</p>
</header>
<section><h2>Diagnostika zařízení · IQOS Scope + ověřené USB čtení</h2>
<p>Identita, baterie, stav a celoživotní čítače. Čítače potáhnutí a náplní jsou <b>pravděpodobné interpretace</b> registru – experimentálně odpovídají změnám při kontrolovaném použití. Průměr potáhnutí na náplň není počet u konkrétní náplně. Nejasné hodnoty senzorů záměrně neoznačujeme jako °C nebo mV.</p>
<div class="devicegrid" id="devicegrid"></div>
</section>
<div class="summary"><div><small>Načtených záznamů</small><b id="count">–</b></div>
<div><small>S časovou značkou</small><b id="timestamps">–</b></div>
<div><small>Chybové nebo prázdné odpovědi</small><b id="other">–</b></div>
<div><small>Zařízení</small><b id="devicecount">–</b></div><div><small>Události s potáhnutím*</small><b id="withpuffs">–</b></div><div><small>Potáhnutí v archivu*</small><b id="pufftotal">–</b></div></div>
<div class="filters"><label>Zařízení <select id="device"><option value="">Všechna</option></select></label>
<label>Od data <input type="date" id="after"></label>
<label>Do data <input type="date" id="before"></label>
<label>Stav <select id="status"><option value="">Všechny</option><option value="ok">S obsahem</option><option value="empty">Prázdné</option><option value="timeout">Timeout</option><option value="bad_crc">CRC chyba</option></select></label>
<label>Vyhledat ID <input type="text" id="search" placeholder="Např. 10487"></label>
<label><input type="checkbox" id="allhistory"> Zobrazit kompletní uložený archiv</label></div>
<p><small class="note">Výchozí pohled: poslední 3 kalendářní měsíce podle časových značek zařízení. Úplný archiv v databázi zůstává zachovaný. Pozor: chybné hodiny mohou události zařadit do nesprávného období.</small></p>
<section><h2>Archivní události podle dne</h2><div class="bars" id="bars"></div></section>
<p><small class="note">* Odvozeno z experimentálně dekódovaného počtu dvoubajtových položek v historii. Není to záruka, že jde vždy o dokončenou náplň. Záznam s 0 položkami není započítán mezi relace s potáhnutím.</small></p>
<section><h2>Jednotlivé záznamy</h2><div class="tablewrap"><table><thead><tr><th>Zařízení</th><th>ID archivu</th><th>Začátek (lokální)</th><th>Upozornění na konec</th><th>Potáhnutí*</th><th>Průběh (RAW)</th><th>Stav</th><th>HEX odpověď</th></tr></thead><tbody id="tbody"></tbody></table></div>
<p id="limit-note"><small class="note">Zobrazuje se nejvýše 500 řádků podle filtru; celý archiv je v SQLite a CSV.</small></p></section>
<script>
const EVENTS=__JSON__;
const DEVICE_SNAPSHOTS=__DEVICES__;
const $=id=>document.getElementById(id);
const dt=s=>s?new Date(s):null;
const fmt=s=>s?dt(s).toLocaleString('cs-CZ'):'—';
const timeOnly=s=>s?dt(s).toLocaleTimeString('cs-CZ'):'—';
function localDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
let windowDate=new Date();windowDate.setHours(0,0,0,0);
const originalDay=windowDate.getDate();windowDate.setDate(1);windowDate.setMonth(windowDate.getMonth()-3);
const lastDayOfMonth=new Date(windowDate.getFullYear(),windowDate.getMonth()+1,0).getDate();
windowDate.setDate(Math.min(originalDay,lastDayOfMonth));
const threeMonthsAgo=localDate(windowDate);
$('after').value=threeMonthsAgo;
// Adjacent archive IDs with a sudden >30-day timestamp discontinuity are suspect.
const clockSuspects=new Set();
const byDevice=new Map();for(const x of EVENTS){if(x.time){if(!byDevice.has(x.serial))byDevice.set(x.serial,[]);byDevice.get(x.serial).push(x)}}
for(const items of byDevice.values()){
 items.sort((a,b)=>b.id-a.id);
 for(let i=0;i<items.length-1;i++){
  if(items[i].id===items[i+1].id+1 && Math.abs(dt(items[i].time)-dt(items[i+1].time))>30*86400000){
   clockSuspects.add(items[i].serial+':'+items[i].id);
   clockSuspects.add(items[i+1].serial+':'+items[i+1].id);
  }
 }
}
const day=s=>s?new Date(s).toLocaleDateString('sv-SE'):'',
      dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('cs-CZ',{day:'numeric',month:'numeric'});
const num=(x,dec=0)=>x==null?'—':Number(x).toLocaleString('cs-CZ',{maximumFractionDigits:dec});
const rows=[
 ['Model',v=>v.model],
 ['Sériové číslo',v=>v.serial_readback],
 ['Baterie',v=>v.battery_percent==null?'—':num(v.battery_percent)+' %'],
 ['Celoživotní použití*',v=>num(v.lifetime_sticks_candidate)],
 ['Celoživotní potáhnutí*',v=>num(v.lifetime_puffs_candidate)],
 ['Průměr potáhnutí / použití*',v=>num(v.average_puffs_per_stick_candidate,2)],
 ['Celoživotní doba použití*',v=>v.lifetime_seconds_candidate==null?'—':num(v.lifetime_seconds_candidate/3600,1)+' h'],
 ['Stav náplně (raw)',v=>v.stick_state_code||'—'],
 ['Chybový kód',v=>v.error_state_code==null?'—':v.error_state_code],
 ['Sensor 0x83 (raw)',v=>v.sensor_83_raw_value==null?'—':v.sensor_83_raw_value],
 ['Sensor 0x84 (raw)',v=>v.sensor_84_raw_value==null?'—':v.sensor_84_raw_value],
 ['Firmware (raw)',v=>v.firmware_raw||'—'],
];
for(const s of DEVICE_SNAPSHOTS){
 const c=document.createElement('div');c.className='devicecard';
 const h=document.createElement('h3');h.textContent=s.name; c.append(h);
 const stamp=document.createElement('p');stamp.textContent='Naposledy načteno: '+new Date(s.collected_utc).toLocaleString('cs-CZ');c.append(stamp);
 const dl=document.createElement('dl');
 for(const [label,fn] of rows){let dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(fn(s.values)??'—');dl.append(dt,dd)}
 c.append(dl);
 const f=document.createElement('p');f.className='devicefoot';
 f.textContent='Nastavení jasu: '+(s.statuses.brightness||'—')+' · vibrace: '+(s.statuses.vibration||'—')+' · FlexBattery: '+(s.statuses.flexbattery||'—')+'. FlexPuff, Autostart a Pause se zatím bezpečně nečtou.';c.append(f);
 const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Surová data a diagnostika';
 const raw=document.createElement('pre');raw.textContent=JSON.stringify({values:s.values,statuses:s.statuses,frames:s.frames},null,2);
 details.append(summary,raw);c.append(details);$('devicegrid').append(c);
}
if(!DEVICE_SNAPSHOTS.length){const m=document.createElement('p');m.textContent='Diagnostika se zobrazí po prvním připojení a synchronizaci zařízení.';$('devicegrid').append(m)}
for(const n of [...new Set(EVENTS.map(x=>x.name+' · '+x.serial))].sort()){
 const opt=document.createElement('option');opt.value=n;opt.textContent=n;$('device').append(opt);
}
function update(){
 const selected=$('device').value,from=$('after').value,to=$('before').value,status=$('status').value,search=$('search').value.trim();
 const all=EVENTS.filter(x=>(!selected||x.name+' · '+x.serial===selected)&&(!status||x.status===status)&&(!search||String(x.id).includes(search))&&(!from||day(x.time)>=from)&&(!to||day(x.time)<=to));
 $('count').textContent=all.length.toLocaleString('cs-CZ');
 $('timestamps').textContent=all.filter(x=>x.time).length.toLocaleString('cs-CZ');
 $('other').textContent=all.filter(x=>x.status!=='ok').length.toLocaleString('cs-CZ');
 $('devicecount').textContent=new Set(all.map(x=>x.serial)).size;
 $('withpuffs').textContent=all.filter(x=>x.puff_count>0).length.toLocaleString('cs-CZ');
 $('pufftotal').textContent=all.reduce((sum,x)=>sum+(x.puff_count||0),0).toLocaleString('cs-CZ');
 const counts=new Map();for(const x of all){if(x.time){const d=day(x.time);counts.set(d,(counts.get(d)||0)+1)}}
 const days=[...counts].sort((a,b)=>a[0].localeCompare(b[0])).slice(-45),max=Math.max(1,...days.map(v=>v[1]));
 $('bars').replaceChildren();for(const [d,n] of days){
   const wrap=document.createElement('div');wrap.className='barwrap';wrap.title=d+': '+n+' archivních záznamů';
   const count=document.createElement('span');count.className='barcount';count.textContent=n;
   const bar=document.createElement('div');bar.className='bar';bar.style.height=Math.max(3,n/max*105)+'px';
   const label=document.createElement('span');label.className='barlabel';label.textContent=dateLabel(d);
   wrap.append(count,bar,label);$('bars').append(wrap);
 }
 const table=$('tbody');table.replaceChildren();
 for(const x of all.slice(0,500)){
   const tr=document.createElement('tr');
   for(const val of [x.name,x.id]){const td=document.createElement('td');td.textContent=val;tr.append(td)}
   const timeTd=document.createElement('td');timeTd.textContent=fmt(x.time);
   if(clockSuspects.has(x.serial+':'+x.id)){timeTd.textContent+=' ⚠';timeTd.title='Čas sousedních ID se liší o více než 30 dní; hodiny mohly být špatně';}
   tr.append(timeTd);
   const endTd=document.createElement('td');endTd.textContent=x.end?timeOnly(x.end)+' *':'—';
   if(x.end)endTd.title='Ručně naměřený čas vibrace oznamující konec; nikoliv přesný okamžik posledního potáhnutí.';
   tr.append(endTd);
   const puffTd=document.createElement('td');
   if(x.puff_count!=null){
     puffTd.textContent=String(x.puff_count);
     puffTd.title='Počet položek dvoubajtových událostí dekódovaný přímo ze surové SCP historie; experimentálně ověřený.';
     if(x.puffs!=null && x.puffs!==x.puff_count){
       puffTd.textContent+=' ⚠';puffTd.title+=' Nesouhlasí s ručním kontrolním měřením ('+x.puffs+').';
     }
   }else{puffTd.textContent=x.puffs==null?'—':'≈ '+x.puffs+' *';}
   tr.append(puffTd);
   const traceTd=document.createElement('td');
   if(x.puff_pairs&&x.puff_pairs.length){
     const details=document.createElement('details');const summary=document.createElement('summary');
     summary.textContent=x.puff_pairs.length+' událostí';summary.style.cursor='pointer';
     const rawTrace=document.createElement('code');rawTrace.textContent=x.puff_pairs.join(' · ');rawTrace.className='raw';
     details.append(summary,rawTrace);traceTd.append(details);
   }else{traceTd.textContent=x.puff_count===0?'0 událostí':'—';}
   tr.append(traceTd);
   const statusTd=document.createElement('td');statusTd.textContent=x.status;tr.append(statusTd);
   const td=document.createElement('td');const btn=document.createElement('button');btn.textContent='HEX ('+Math.floor(x.raw.length/2)+' B)';
   btn.onclick=()=>{if(btn.nextSibling){btn.nextSibling.remove();return}const c=document.createElement('code');c.className='raw';c.textContent=x.raw;btn.after(c)};
   td.append(btn);tr.append(td);table.append(tr);
 }
}
$('allhistory').addEventListener('change',()=>{$('after').value=$('allhistory').checked?'':threeMonthsAgo;update()});
for(const x of ['device','after','before','status','search'])$(x).addEventListener('input',update);
update();
</script></body></html>
'''


def build(db, out):
    rows=db.execute('''SELECT d.display_name,e.serial,e.event_id,e.timestamp_candidate_utc,
                              e.status,e.response_hex,
                              o.end_notice_utc,o.puffs_estimate,o.source
                       FROM events e JOIN devices d ON d.serial=e.serial
                       LEFT JOIN observations o ON o.serial=e.serial AND o.event_id=e.event_id
                       ORDER BY e.timestamp_candidate_utc DESC, e.event_id DESC''').fetchall()
    data=[]
    for r in rows:
        try:
            trace=decode_puffs(bytes.fromhex(r[5] or '')) if r[4]=='ok' else None
        except ValueError:
            trace=None
        data.append({'name':r[0], 'serial':r[1][-5:], 'id':r[2], 'time':r[3],
           'status':r[4], 'raw':r[5] or '', 'end':r[6], 'puffs':r[7], 'source':r[8],
           'puff_count':trace.count if trace else None,
           'puff_pairs':list(trace.event_pairs) if trace else None})
    payload=json.dumps(data,ensure_ascii=False).replace('<','\\u003c')
    device_payload=json.dumps(latest_snapshots(db),ensure_ascii=False).replace('<','\\u003c')
    out=Path(out)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(TEMPLATE.replace('__JSON__',payload).replace('__DEVICES__',device_payload),encoding='utf-8')
    return out


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--db',type=Path,default=DB_FOLDER / 'history.sqlite3')
    parser.add_argument('--out',type=Path,default=DB_FOLDER / 'prohlizec.html')
    args=parser.parse_args()
    db=connect(args.db)
    try: print('HTML:',build(db,args.out))
    finally: db.close()
