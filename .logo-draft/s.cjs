const fs=require('fs');let s=fs.readFileSync('icon.svg','utf8');
const stops='<stop offset="0" stop-color="#FFA23E"/><stop offset=".3" stop-color="#FF8A4C"/><stop offset=".6" stop-color="#D9468F" stop-opacity=".65"/><stop offset="1" stop-color="#7A2BE0" stop-opacity="0"/>';
s=s.replace(/(<radialGradient id="sunA" cx="0" cy="0" r=")230(" gradientUnits="userSpaceOnUse">)[\s\S]*?(<\/radialGradient>)/,`$1290$2${stops}$3`);
s=s.replace(/(<radialGradient id="sunB" cx="512" cy="512" r=")200(" gradientUnits="userSpaceOnUse">)[\s\S]*?(<\/radialGradient>)/,`$1260$2${stops}$3`);
fs.writeFileSync('icon.svg',s);
