const fs=require('fs');const sharp=require('../node_modules/sharp');
const base=fs.readFileSync('icon.svg','utf8');
const noSun=s=>s.replace(/\s*<rect width="512" height="512" rx="112" fill="url\(#sun[AB]\)"\/>/g,'');
const orange='<linearGradient id="ora" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFB04A"/><stop offset="1" stop-color="#FF7A3C"/></linearGradient>';
// A: laranja só em detalhes (faíscas + barra do corpo)
let A=noSun(base).replace('</defs>',orange+'</defs>')
  .replace('<g stroke="#FFFFFF" stroke-width="15"','<g stroke="url(#ora)" stroke-width="15"')
  .replace(/(<rect x="222" y="394"[^>]*fill=)"url\(#glow\)"/,'$1"url(#ora)"');
// B: halo laranja atrás do robô
let B=noSun(base).replace('</defs>','<radialGradient id="halo" cx="256" cy="290" r="270" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FF9A3D" stop-opacity=".95"/><stop offset=".45" stop-color="#E4508A" stop-opacity=".45"/><stop offset="1" stop-color="#7A2BE0" stop-opacity="0"/></radialGradient></defs>')
  .replace('<g stroke="#FFFFFF"','<rect width="512" height="512" rx="112" fill="url(#halo)"/>\n  <g stroke="#FFFFFF"');
// C: horizonte laranja embaixo + faíscas laranja
let C=noSun(base).replace('</defs>',orange+'<linearGradient id="hor" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FF8A3C"/><stop offset=".35" stop-color="#E4508A" stop-opacity=".6"/><stop offset=".7" stop-color="#7A2BE0" stop-opacity="0"/></linearGradient></defs>')
  .replace('<g stroke="#FFFFFF" stroke-width="15"','<rect width="512" height="512" rx="112" fill="url(#hor)"/>\n  <g stroke="url(#ora)" stroke-width="15"');
const vs={A,B,C};
(async()=>{
  const bufs=[];
  for(const k of Object.keys(vs)){fs.writeFileSync(`var-${k}.svg`,vs[k]);bufs.push(await sharp(Buffer.from(vs[k]),{density:96}).resize(500).png().toBuffer());}
  await sharp({create:{width:1580,height:540,channels:4,background:'#ffffff'}}).composite(bufs.map((b,i)=>({input:b,left:20+i*520,top:20}))).png().toFile(process.env.CLAUDE_JOB_DIR+'/tmp/variants.png');
  console.log('ok');
})();
