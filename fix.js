const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.tsx')) results.push(file);
    }
  });
  return results;
}

const files = walk('./src/app');
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let changed = false;
  
  if (content.includes('\\`')) {
    content = content.replace(/\\`/g, '`');
    changed = true;
  }
  if (content.includes('\\$')) {
    content = content.replace(/\\\$/g, '$');
    changed = true;
  }
  
  if (changed) {
    fs.writeFileSync(f, content);
    console.log('Fixed', f);
  }
});
