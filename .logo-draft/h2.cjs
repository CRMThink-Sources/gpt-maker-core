const fs=require('fs');let s=fs.readFileSync('icon.svg','utf8');
s=s.replace(/<linearGradient id="shell"[^>]*>/,'<linearGradient id="shell" gradientUnits="userSpaceOnUse" x1="0" y1="70" x2="0" y2="380">');
const teeth=[-52,-26,0,26,52].map(a=>`<rect x="232" y="70" width="48" height="84" rx="14" transform="rotate(${a} 256 250)"/>`).join('');
s=s.replace(/<path d="M130 170[^>]*\/>/,`<g fill="url(#shell)">${teeth}<rect x="106" y="126" width="300" height="248" rx="100"/></g>`);
fs.writeFileSync('icon.svg',s);
