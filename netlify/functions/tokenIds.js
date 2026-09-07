/**
 * The token list for a Kudzu contract, read from the chain.
 *
 * This used to query Index Supply for Infect events. That worked on mainnet and
 * silently returned nothing on Base -- Index Supply has no Base data at all,
 * answering `{"cursor":"8453-1","columns":[],"rows":[]}` for any query on that
 * chain against a head of 50.8 million, so /works/kudzu-base rendered an empty
 * Tokens tab. It also read an INDEX_SUPPLY_API_KEY that was never set on the
 * Netlify site, at either site or account level, so every request had always
 * gone out with `api-key=undefined`.
 *
 * Kudzu is ERC721Enumerable on every network it is deployed to, so the list can
 * come from the contract instead: totalSupply, tokenByIndex across the range,
 * ownerOf for each id. No index, no key, no third party.
 *
 * Calls go through Multicall3, deployed at the same address on both chains.
 * Base has 27,912 tokens and one eth_call each would be 55,824 requests; at
 * 4,000 per batch it is fifteen. Plain JSON-RPC batching would have been
 * simpler but is not portable -- base.org caps a batch at 10 calls, drpc errors
 * on every element, 1rpc refuses outright.
 *
 * The ABI codec below is hand-rolled rather than web3-eth-abi. That is not
 * premature optimisation: the library version of this function died in
 * production with error 1102, the Workers CPU limit, on both chains. Decoding
 * the same payload is ~57x cheaper this way -- string slicing instead of BN.js
 * and the generic coder -- and it is verified against the library rather than
 * trusted (see the encode/decode parity checks in the commit message).
 */
const fetch = require('node-fetch');
const { Kudzu } = require('kuzu-contracts');

require('dotenv').config();

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const AGGREGATE3 = '0x82ad56cb';

// Several per chain because these are shared public endpoints and any one will
// rate-limit. Each was checked to serve a 2,000-call aggregate3 for this
// contract before being listed.
const RPCS = {
  1: [
    'https://gateway.tenderly.co/public/mainnet',
    'https://mainnet.gateway.tenderly.co',
    'https://eth.drpc.org',
    'https://ethereum-rpc.publicnode.com'
  ],
  8453: [
    'https://mainnet.base.org',
    'https://base-rpc.publicnode.com',
    'https://base.gateway.tenderly.co',
    'https://base.drpc.org'
  ]
};

const BATCH = 4000;
const CONCURRENCY = 4;

const SEL = {
  totalSupply: '0x18160ddd',
  tokenByIndex: '0x4f6ccce7',
  ownerOf: '0x6352211e'
};

const word = (n) => BigInt(n).toString(16).padStart(64, '0');

/** aggregate3((address,bool,bytes)[]) for a list of 36-byte calls to one target. */
function encodeAggregate3(target, calls) {
  const tgt = target.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const n = calls.length;
  const tupleWords = 6; // target, allowFailure, bytesOffset, bytesLen, + 2 data
  let heads = '';
  let bodies = '';
  for (let i = 0; i < n; i++) {
    heads += word(32 * n + i * tupleWords * 32);
    // allowFailure true: one unreadable token yields a hole, not a dead batch
    bodies += tgt + word(1) + word(96) + word(36) +
      calls[i].replace(/^0x/, '').padEnd(128, '0');
  }
  return AGGREGATE3 + word(32) + word(n) + heads + bodies;
}

/** The (bool success, bytes returnData)[] that comes back. */
function decodeAggregate3(hex) {
  const d = hex.replace(/^0x/, '');
  const at = (w) => d.slice(w * 64, w * 64 + 64);
  const arrStart = Number(BigInt('0x' + at(0))) / 32;
  const n = Number(BigInt('0x' + at(arrStart)));
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const base = arrStart + 1 + Number(BigInt('0x' + at(arrStart + 1 + i))) / 32;
    // the bytes offset is relative to the start of the tuple
    const dataOff = Number(BigInt('0x' + at(base + 1))) / 32;
    const len = Number(BigInt('0x' + at(base + dataOff)));
    out[i] = {
      success: at(base).endsWith('1'),
      returnData: len ? at(base + dataOff + 1) : null
    };
  }
  return out;
}

async function ethCall(chainId, to, data) {
  const urls = RPCS[chainId];
  if (!urls) throw new Error(`no RPC configured for chain ${chainId}`);
  let last;
  for (let attempt = 0; attempt < urls.length * 2; attempt++) {
    const url = urls[attempt % urls.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to, data }, 'latest']
        })
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error.message || 'rpc error');
      if (!body.result || body.result === '0x') throw new Error('empty result');
      return body.result;
    } catch (e) {
      last = e;
      // rate limiting is the expected failure on a shared endpoint, so move on
      // and come back rather than giving up on the first refusal
      await new Promise((r) =>
        setTimeout(r, 200 * Math.pow(2, Math.floor(attempt / urls.length))));
    }
  }
  throw last || new Error('no endpoint answered');
}

/** One selector across many arguments, in as few round trips as possible. */
async function multicall(chainId, target, selector, args) {
  const batches = [];
  for (let s = 0; s < args.length; s += BATCH) batches.push(args.slice(s, s + BATCH));

  const results = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      const calls = batches[i].map((a) => selector + word(a));
      const raw = await ethCall(chainId, MULTICALL3, encodeAggregate3(target, calls));
      results[i] = decodeAggregate3(raw);
    }
  };
  // batches are independent; sequentially Base was 30s of mostly waiting
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return results.flat();
}

exports.handler = async function (event) {
  const networkId = (event.queryStringParameters || {}).network ?? '1';
  const chainId = parseInt(networkId, 10);
  const contract = (Kudzu.networks[networkId] || {}).address || null;

  if (!contract) {
    return {
      statusCode: 404,
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: `no Kudzu deployment for network ${networkId}` })
    };
  }

  try {
    const total = Number(BigInt(await ethCall(chainId, contract, SEL.totalSupply)));

    const indexes = new Array(total);
    for (let i = 0; i < total; i++) indexes[i] = i;

    const idRows = await multicall(chainId, contract, SEL.tokenByIndex, indexes);
    const tokenIds = [];
    for (const r of idRows) {
      if (r.success && r.returnData) tokenIds.push(BigInt('0x' + r.returnData).toString());
    }

    // Refuse to answer with a short list. Returning {tokens:[]} with a 200 is
    // precisely the failure this function was rewritten to remove -- an empty
    // grid that looks like a work with no tokens rather than a broken read.
    if (tokenIds.length !== total) {
      throw new Error(`enumerated ${tokenIds.length} of ${total} tokens`);
    }

    const ownerRows = await multicall(chainId, contract, SEL.ownerOf, tokenIds);
    const tokens = new Array(tokenIds.length);
    for (let i = 0; i < tokenIds.length; i++) {
      const r = ownerRows[i];
      tokens[i] = {
        tokenId: tokenIds[i],
        // 32-byte word, address in the low 20 bytes
        owner: r && r.success && r.returnData ? '0x' + r.returnData.slice(24) : null
      };
    }

    return {
      statusCode: 200,
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'public, s-maxage=300, stale-while-revalidate=86400'
      },
      body: JSON.stringify({ contract, chainId, tokens })
    };
  } catch (e) {
    console.error('tokenIds', e);
    return {
      statusCode: 502,
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: String((e && e.message) || e) })
    };
  }
};
