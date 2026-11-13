const fs=require('fs');let s=fs.readFileSync('icon.svg','utf8');
s=s.replace(/<g fill="url\(#shell\)"><rect x="232"[\s\S]*?<rect x="106" y="126"[^>]*\/><\/g>/,
 `<g fill="url(#shell)">${[-60,-30,0,30,60].map(a=>`<rect x="228" y="100" width="56" height="62" rx="16" transform="rotate(${a} 256 250)"/>`).join('')}<rect x="106" y="126" width="300" height="248" rx="100"/></g>`);
s=s.replace('<linearGradient id="brand"','<linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DDD9F5"/></linearGradient>\n    <linearGradient id="brand"');
s=s.replace(/(<path d="M168 396[^>]*?)fill="url\(#shell\)"/,'$1fill="url(#body)"');
fs.writeFileSync('icon.svg',s);
