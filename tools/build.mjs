import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
// Explicit allowlist: only the public browser app goes into the Pages artifact.
await rm('dist',{recursive:true,force:true});
await mkdir('dist/vendor/design/fonts',{recursive:true});
for(const name of ['index.html','style.css','app.js','src','assets'])await cp(name,`dist/${name}`,{recursive:true});
await mkdir('dist/vendor/mediapipe',{recursive:true});
for(const name of ['vision_bundle.js','wasm'])await cp(`node_modules/@mediapipe/tasks-vision/${name}`,`dist/vendor/mediapipe/${name}`,{recursive:true});
let faces='';
for(const [name,family,axis] of [['fraunces','Fraunces','full'],['hanken-grotesk','Hanken Grotesk','wght'],['jetbrains-mono','JetBrains Mono','wght']]){
 for(const style of name==='fraunces'?['normal','italic']:['normal']){
  const file=`${name}-latin-${axis}-${style}.woff2`;
  await cp(`node_modules/@fontsource-variable/${name}/files/${file}`,`dist/vendor/design/fonts/${file}`);
  faces+=`@font-face{font-family:'${family}';font-style:${style};font-weight:100 900;font-display:swap;src:url('./fonts/${file}') format('woff2');}\n`;
 }
 await cp(`node_modules/@fontsource-variable/${name}/LICENSE`,`dist/vendor/design/fonts/${name}-LICENSE.txt`);
}
const tokens=(await readFile('node_modules/@chrisns/design/tokens.css','utf8')).replace(/^@import[^\n]*$/gm,'');
await writeFile('dist/vendor/design/tokens.css',faces+tokens);
await cp('node_modules/@chrisns/design/LICENSE','dist/vendor/design/LICENSE.txt');
await cp('node_modules/@mediapipe/tasks-vision/README.md','dist/vendor/mediapipe/README.md');
await writeFile('dist/.nojekyll','');
console.log('Built dist: app, CNS tokens, local fonts, camera runtime and model.');
