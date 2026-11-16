const fs=require('fs');let s=fs.readFileSync('icon.svg','utf8');
const teeth=[-64,-32,0,32,64].map(a=>`<rect x="232" y="56" width="48" height="60" rx="14" transform="rotate(${a} 256 230)"/>`).join('');
s=s.replace(/<!-- coroa[\s\S]*?<rect x="72"/,`<!-- engrenagem atrás da cabeça -->\n  <g fill="url(#shell)">${teeth}<circle cx="256" cy="230" r="150"/></g>\n  <rect x="72"`);
s=s.replace('M186 238 q30 40 60 0','M190 266 q28 -42 56 0').replace('M266 238 q30 40 60 0','M266 266 q28 -42 56 0');
fs.writeFileSync('icon.svg',s);
