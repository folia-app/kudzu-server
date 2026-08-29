#!/usr/bin/env node
/**
 * Golden-image test for the Kudzu renderer.
 *
 * Renders a fixed sample of real token ids through the full production pipeline
 * — draw, fry at quality 0.01, replaceWhite's re-encode, theme replacements —
 * and hashes the resulting JPEG. Identical hash means identical pixels.
 *
 * This exists because "does a newer canvas or node change the art?" has always
 * been answered by guessing. Now it is answered by running this.
 *
 *   node test/golden.js            compare against test/golden.json
 *   node test/golden.js --record   write test/golden.json from this environment
 *
 * Exits non-zero on any mismatch, so it can gate an upgrade.
 */

process.env.VUE_APP_DEV_IGNORE_IS_OWNED = 'true'; // pixels don't depend on ownership

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCanvas } = require('canvas');
const { handler } = require('../img');

const RECORD = process.argv.includes('--record');
const GOLDEN = path.join(__dirname, 'golden.json');
const TOKENS = fs
  .readFileSync(path.join(__dirname, 'tokens.txt'), 'utf8')
  .trim()
  .split(',')
  .filter(Boolean);

/**
 * Every chain has its own palette, and they do not exercise the same code.
 * mainnet is the plain green path; base adds replaceColors and replaceBlack;
 * forma additionally fries at 0.02 instead of 0.01. The later two are the more
 * sensitive paths because each replacement is another JPEG decode/re-encode.
 */
const NETWORKS = ['mainnet', 'base', 'forma'];

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * The no-argument default matters: replaceWhite/replaceColors/replaceBlack all
 * call toDataURL('image/jpeg') with no quality, so a change to canvas's default
 * would silently alter every image.
 */
function defaultJpegQuality() {
  const c = createCanvas(64, 64);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 64);
  g.addColorStop(0, '#f00');
  g.addColorStop(1, '#00f');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const enc = (q) =>
    sha(Buffer.from(c.toDataURL('image/jpeg', q).split(',')[1], 'base64'));
  const dflt = sha(Buffer.from(c.toDataURL('image/jpeg').split(',')[1], 'base64'));
  for (const q of [0.75, 0.92, 1]) if (enc(q) === dflt) return q;
  return 'unknown';
}

async function render(network, tokenId) {
  const p = network === 'mainnet' ? `/img/${tokenId}` : `/img/${network}/${tokenId}`;
  const res = await handler({ path: p, queryStringParameters: {} }, {});
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
  return Buffer.from(res.body, 'base64');
}

(async () => {
  const env = {
    canvas: require('canvas/package.json').version,
    node: process.version,
    defaultJpegQuality: defaultJpegQuality(),
  };

  const hashes = {};
  for (const net of NETWORKS) {
    for (const id of TOKENS) {
      const key = `${net}/${id}`;
      try {
        const buf = await render(net, id);
        hashes[key] = { sha: sha(buf), bytes: buf.length };
      } catch (e) {
        hashes[key] = { error: e.message };
      }
    }
  }

  if (RECORD) {
    fs.writeFileSync(
      GOLDEN,
      JSON.stringify({ recordedWith: env, tokens: hashes }, null, 2) + '\n'
    );
    console.log(`recorded ${TOKENS.length} tokens x ${NETWORKS.length} networks (${Object.keys(hashes).length} images) with canvas ${env.canvas} on ${env.node}`);
    console.log(`default jpeg quality: ${env.defaultJpegQuality}`);
    return;
  }

  if (!fs.existsSync(GOLDEN)) {
    console.error('No golden.json — run with --record in a known-good environment first.');
    process.exit(2);
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  console.log(`golden : canvas ${golden.recordedWith.canvas} on ${golden.recordedWith.node} (default jpeg q=${golden.recordedWith.defaultJpegQuality})`);
  console.log(`current: canvas ${env.canvas} on ${env.node} (default jpeg q=${env.defaultJpegQuality})`);

  let same = 0;
  const diffs = [];
  const perNetwork = {};
  for (const key of Object.keys(golden.tokens)) {
    const net = key.split('/')[0];
    perNetwork[net] = perNetwork[net] || { same: 0, total: 0 };
    perNetwork[net].total++;
    const g = golden.tokens[key];
    const c = hashes[key];
    if (!c || c.error) { diffs.push(`${key}: ${c ? c.error : 'missing'}`); continue; }
    if (g.sha === c.sha) { same++; perNetwork[net].same++; }
    else diffs.push(`${key}: golden ${g.sha.slice(0, 12)} (${g.bytes}B) vs ${c.sha.slice(0, 12)} (${c.bytes}B)`);
  }

  if (env.defaultJpegQuality !== golden.recordedWith.defaultJpegQuality) {
    console.log(`\n  WARNING: canvas's default JPEG quality changed — every re-encode in img.js is affected`);
  }

  const total = Object.keys(golden.tokens).length;
  console.log('');
  for (const [net, r] of Object.entries(perNetwork)) {
    console.log(`  ${net.padEnd(8)} ${r.same}/${r.total} identical`);
  }
  console.log(`  ${same}/${total} identical overall`);
  if (diffs.length) {
    console.log(`  ${diffs.length} differ:`);
    diffs.slice(0, 10).forEach((d) => console.log(`    ${d}`));
    process.exit(1);
  }
  console.log('  PASS — pixel-identical to golden');
})();
