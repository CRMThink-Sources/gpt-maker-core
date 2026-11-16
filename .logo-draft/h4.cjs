const fs=require('fs');let s=fs.readFileSync('icon.svg','utf8');
s=s.replace(/(<g fill="url\(#shell\)">)(<rect x="228"[^>]*\/>)+/,`$1${[-44,0,44].map(a=>`<rect x="220" y="76" width="72" height="90" rx="20" transform="rotate(${a} 256 250)"/>`).join('')}`);
fs.writeFileSync('icon.svg',s);
