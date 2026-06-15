/**
 * TournaTrak Icon Generator
 * Builds two icon variants (public/trophy and admin/gear) and renders
 * them to PNG at 180, 192, and 512px using Playwright's headless Chromium.
 *
 * Usage: node generate-icons.js
 * Output: trophy-180.png, trophy-192.png, trophy-512.png
 *         admin-180.png,  admin-192.png,  admin-512.png
 */

const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

// ─── Bracket ────────────────────────────────────────────────────────────────
// Valid 8-team single-elimination: 8 → 4 → 2 → 1
// Returns SVG <line> elements and the y-coordinate of the final output line.
function buildBracket() {
  const X0 = 18;   // left edge of team slots
  const X1 = 110;  // end of round-1 slots / start of R1 connectors
  const X2 = 200;  // end of R1 outputs  / start of R2 connectors
  const X3 = 290;  // end of R2 outputs  / finals connector
  const X4 = 352;  // end of final output line

  // 8 teams evenly spaced, y from 258 to 482 (step = 32)
  const ys = Array.from({ length: 8 }, (_, i) => 258 + i * 32);
  // [258, 290, 322, 354, 386, 418, 450, 482]

  const lines = [];

  // Round 1: 4 matches → 4 output midpoints
  const r1 = [];
  for (let i = 0; i < 4; i++) {
    const y1 = ys[i * 2], y2 = ys[i * 2 + 1];
    const mid = (y1 + y2) / 2;
    lines.push(`<line x1="${X0}" y1="${y1}" x2="${X1}" y2="${y1}"/>`);
    lines.push(`<line x1="${X0}" y1="${y2}" x2="${X1}" y2="${y2}"/>`);
    lines.push(`<line x1="${X1}" y1="${y1}" x2="${X1}" y2="${y2}"/>`);
    lines.push(`<line x1="${X1}" y1="${mid}" x2="${X2}" y2="${mid}"/>`);
    r1.push(mid);
  }
  // r1 = [274, 338, 402, 466]

  // Round 2: 2 semi-final matches → 2 output midpoints
  const r2 = [];
  for (let i = 0; i < 2; i++) {
    const y1 = r1[i * 2], y2 = r1[i * 2 + 1];
    const mid = (y1 + y2) / 2;
    lines.push(`<line x1="${X2}" y1="${y1}" x2="${X2}" y2="${y2}"/>`);
    lines.push(`<line x1="${X2}" y1="${mid}" x2="${X3}" y2="${mid}"/>`);
    r2.push(mid);
  }
  // r2 = [306, 434]

  // Final: connect the two semi outputs
  const finalY = (r2[0] + r2[1]) / 2; // 370
  lines.push(`<line x1="${X3}" y1="${r2[0]}" x2="${X3}" y2="${r2[1]}"/>`);
  lines.push(`<line x1="${X3}" y1="${finalY}" x2="${X4}" y2="${finalY}"/>`);

  return { lines, finalY };
}

// ─── Gear polygon ───────────────────────────────────────────────────────────
// Returns SVG polygon `points` string for a star-gear (alternating r/R).
// numTeeth * 2 total vertices.
function gearPoints(cx, cy, outerR, innerR, numTeeth, startAngleDeg = -90) {
  const n = numTeeth * 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const angleDeg = startAngleDeg + (i / n) * 360;
    const angleRad = (angleDeg * Math.PI) / 180;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(
      `${(cx + r * Math.cos(angleRad)).toFixed(2)},${(cy + r * Math.sin(angleRad)).toFixed(2)}`
    );
  }
  return pts.join(' ');
}

// ─── Trophy SVG fragment ─────────────────────────────────────────────────────
function trophySvg(cx, cy) {
  const cL = cx - 34, cR = cx + 34;
  const cTop = cy - 44, cMid = cy - 8;
  const cupBot = cy + 2;
  return `
  <!-- Trophy cup -->
  <path d="M ${cL},${cTop} L ${cR},${cTop} L ${cR},${cMid}
           Q ${cR},${cupBot} ${cx},${cupBot + 2}
           Q ${cL},${cupBot} ${cL},${cMid} Z"
        fill="url(#gold)"/>
  <!-- Left handle -->
  <path d="M ${cL},${cTop + 10} C ${cL - 24},${cTop + 10} ${cL - 24},${cMid + 4} ${cL},${cMid + 4}"
        fill="none" stroke="#c9a227" stroke-width="9" stroke-linecap="round"/>
  <!-- Right handle -->
  <path d="M ${cR},${cTop + 10} C ${cR + 24},${cTop + 10} ${cR + 24},${cMid + 4} ${cR},${cMid + 4}"
        fill="none" stroke="#c9a227" stroke-width="9" stroke-linecap="round"/>
  <!-- Stem -->
  <rect x="${cx - 6}" y="${cupBot + 2}" width="12" height="20" fill="#c9a227" rx="2"/>
  <!-- Base -->
  <rect x="${cx - 26}" y="${cupBot + 22}" width="52" height="12" fill="#c9a227" rx="5"/>`;
}

// ─── Gear + person SVG fragment ──────────────────────────────────────────────
function gearPersonSvg(cx, cy) {
  const pts = gearPoints(cx, cy, 57, 44, 10);
  return `
  <!-- Gear -->
  <polygon points="${pts}" fill="url(#gold)"/>
  <!-- Hub cutout -->
  <circle cx="${cx}" cy="${cy}" r="28" fill="#111214"/>
  <!-- Person head -->
  <circle cx="${cx}" cy="${cy - 10}" r="8.5" fill="#c9a227"/>
  <!-- Person body / shoulders -->
  <path d="M ${cx - 16},${cy + 24} Q ${cx - 16},${cy + 7} ${cx},${cy + 7} Q ${cx + 16},${cy + 7} ${cx + 16},${cy + 24}"
        fill="#c9a227"/>`;
}

// ─── Full SVG builder ────────────────────────────────────────────────────────
function buildSvg(symbolFn) {
  const { lines, finalY } = buildBracket();
  const symCx = 427, symCy = finalY; // bracket final line exits at y=370

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#f0d060"/>
    <stop offset="50%"  stop-color="#c9a227"/>
    <stop offset="100%" stop-color="#907020"/>
  </linearGradient>
  <linearGradient id="border" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%"   stop-color="#e8c050"/>
    <stop offset="60%"  stop-color="#c9a227"/>
    <stop offset="100%" stop-color="#6a4c10"/>
  </linearGradient>
  <linearGradient id="textG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#f2d862"/>
    <stop offset="45%"  stop-color="#d4a820"/>
    <stop offset="100%" stop-color="#8a6410"/>
  </linearGradient>
  <!-- Subtle hex-style dot texture -->
  <pattern id="dots" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
    <circle cx="9" cy="9" r="1.3" fill="#2d2d2d"/>
  </pattern>
</defs>

<!-- Background -->
<rect width="512" height="512" rx="96" fill="#111214"/>

<!-- Dot texture (top half only, fades into background) -->
<rect x="0" y="0" width="512" height="260" rx="0" fill="url(#dots)" opacity="0.5"
      clip-path="inset(0 0 0 0 round 96px)"/>

<!-- Gold border -->
<rect x="7" y="7" width="498" height="498" rx="91"
      fill="none" stroke="url(#border)" stroke-width="10"/>

<!-- "T" lettermark -->
<text x="257" y="196"
      font-family="Georgia, 'Times New Roman', serif"
      font-style="italic"
      font-size="178"
      font-weight="900"
      fill="url(#textG)"
      text-anchor="middle">T</text>

<!-- TournaTrak wordmark -->
<text x="257" y="241"
      font-family="Georgia, 'Times New Roman', serif"
      font-style="italic"
      font-size="49"
      font-weight="700"
      fill="url(#textG)"
      text-anchor="middle">TournaTrak</text>

<!-- 8-team single-elimination bracket (valid binary tree: 8→4→2→1) -->
<g stroke="#c9a227" stroke-width="9" stroke-linecap="round" fill="none">
  ${lines.join('\n  ')}
</g>

<!-- Symbol -->
${symbolFn(symCx, symCy)}
</svg>`;
}

// ─── Render SVG → PNG via Playwright ────────────────────────────────────────
async function renderToPng(browser, svgContent, outputPath, size) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: size, height: size });

  // Inline the SVG into an HTML page so the browser handles text/gradient rendering
  const innerSvg = svgContent.replace(/^<svg[^>]*>|<\/svg>\s*$/g, '');
  const html = `<!DOCTYPE html>
<html><head>
<style>* { margin:0; padding:0; overflow:hidden; } body { background: transparent; }</style>
</head><body>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
${innerSvg}
</svg>
</body></html>`;

  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({
    path: outputPath,
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: true,
  });
  await page.close();
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const outDir = __dirname;
  const publicSvg = buildSvg(trophySvg);
  const adminSvg  = buildSvg(gearPersonSvg);

  // Write SVG sources alongside PNGs for reference
  fs.writeFileSync(path.join(outDir, 'trophy-source.svg'), publicSvg);
  fs.writeFileSync(path.join(outDir, 'admin-source.svg'),  adminSvg);
  console.log('SVG sources written.');

  const browser = await chromium.launch();

  const targets = [
    { size: 512, pubOut: 'trophy-512.png', adminOut: 'admin-512.png' },
    { size: 192, pubOut: 'trophy-192.png', adminOut: 'admin-192.png' },
    { size: 180, pubOut: 'trophy-180.png', adminOut: 'admin-180.png' },
  ];

  for (const { size, pubOut, adminOut } of targets) {
    const pPub   = path.join(outDir, pubOut);
    const pAdmin = path.join(outDir, adminOut);
    await renderToPng(browser, publicSvg, pPub,   size);
    console.log(`  ✓ ${pubOut}  (${size}×${size})`);
    await renderToPng(browser, adminSvg,  pAdmin, size);
    console.log(`  ✓ ${adminOut}  (${size}×${size})`);
  }

  await browser.close();
  console.log('Done. All icons written to', outDir);
}

main().catch((err) => { console.error(err); process.exit(1); });
