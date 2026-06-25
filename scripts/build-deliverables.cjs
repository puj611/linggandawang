const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../dist');
const outDir = path.resolve(__dirname, '../deliverables');
const htmlPath = path.join(distDir, 'index.html');

if (!fs.existsSync(htmlPath)) {
  console.error('请先运行 npm run build 生成 dist/ 目录');
  process.exit(1);
}

let html = fs.readFileSync(htmlPath, 'utf-8');

html = html.replace(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g, (match, href) => {
  const cssPath = path.join(distDir, href);
  if (!fs.existsSync(cssPath)) return match;
  const css = fs.readFileSync(cssPath, 'utf-8');
  return `<style>\n${css}\n</style>`;
});

html = html.replace(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g, (match, src) => {
  const jsPath = path.join(distDir, src);
  if (!fs.existsSync(jsPath)) return match;
  const js = fs.readFileSync(jsPath, 'utf-8');
  return `<script type="module">\n${js}\n</script>`;
});

const outHtml = path.join(outDir, 'linggandawang-demo.html');
fs.writeFileSync(outHtml, html, 'utf-8');

console.log('Generated:', outHtml);
console.log('Size:', (fs.statSync(outHtml).size / 1024).toFixed(1), 'KB');
