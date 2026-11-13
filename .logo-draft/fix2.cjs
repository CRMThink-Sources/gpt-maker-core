const fs=require('fs');let s=fs.readFileSync('icon.svg','utf8');
s=s.replace('<g fill="url(#shell)"><rect x="232" y="56"','<g fill="#BDB6F0"><rect x="232" y="56"');
s=s.replace('M266 266 q28 -42 56 0','M278 266 q28 -42 56 0').replace('M190 266 q28 -42 56 0','M178 266 q28 -42 56 0');
fs.writeFileSync('icon.svg',s);
