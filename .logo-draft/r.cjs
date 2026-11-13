const sharp=require('../node_modules/sharp');
sharp('icon.svg',{density:144}).png().toFile('icon.png').then(()=>sharp('icon.svg',{density:300}).resize(40).png().toFile('icon-40.png')).then(()=>console.log('ok'));
