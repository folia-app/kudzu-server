/**
 * The token list for a Kudzu contract, read from the chain.
 *
 * This used to query Index Supply for Infect events. That worked on mainnet and
 * silently returned nothing on Base -- Index Supply has no Base data at all,
 * answering `{"cursor":"8453-1","columns":[],"rows":[]}` for any query on that
 * chain, so /works/kudzu-base rendered an empty Tokens tab. It also read an
 * INDEX_SUPPLY_API_KEY that was never set on the Netlify site, at either site or
 * account level, so every request went out with `api-key=undefined`.
 *
 * Kudzu is ERC721Enumerable on every network it is deployed to, so the same list
 * can be derived from the contract itself: totalSupply, then tokenByIndex across
 * the range, then ownerOf for each id. No index, no key, no third party.
 *
 * Verified equivalent before switching: enumerating mainnet yields exactly the
 * 2,184 ids Index Supply returned, and the owners match -- Kudzu tokens are
 * soulbound, so whoever an infection minted to still holds it.
 *
 * Calls are batched through Multicall3, which is deployed at the same address on
 * both chains. Batching matters: Base has 27,912 tokens, and one eth_call each
 * would be 55,824 requests. At 4,000 calls per batch it is fifteen, which also
 * keeps it inside a Worker's subrequest budget. JSON-RPC batching would have
 * been simpler but is not portable -- base.org caps a batch at 10 calls, drpc
 * errors on every element, and 1rpc refuses outright.
 */
const abi = require('web3-eth-abi');
const fetch = require('node-fetch');
const { Kudzu } = require('kuzu-contracts');

require('dotenv').config();

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Several per chain because these are shared public endpoints and any one of
// them will rate-limit. All of the below were checked to serve a 2,000-call
// aggregate3 against this contract.
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

// Big enough that Base fits in seven batches, small enough that every endpoint
// tested returns it well inside a request timeout (~3s at this size).
const BATCH = 4000;

// How many batches are in flight at once.
const CONCURRENCY = 4;

const SEL = {
  totalSupply: '0x18160ddd',
  tokenByIndex: '0x4f6ccce7',
  ownerOf: '0x6352211e'
};

const AGGREGATE3 = {
  name: 'aggregate3',
  type: 'function',
  inputs: [{
    name: 'calls',
    type: 'tuple[]',
    components: [
      { name: 'target', type: 'address' },
      { name: 'allowFailure', type: 'bool' },
      { name: 'callData', type: 'bytes' }
    ]
  }]
};

const RESULT_ARRAY = {
  type: 'tuple[]',
  components: [
    { name: 'success', type: 'bool' },
    { name: 'returnData', type: 'bytes' }
  ]
};

const uint256 = (n) => BigInt(n).toString(16).padStart(64, '0');

/** eth_call against the first endpoint that answers. */
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
      // A rate limit is the expected failure on a shared endpoint, so move on
      // and come back rather than giving up on the first refusal.
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, Math.floor(attempt / urls.length))));
    }
  }
  throw last || new Error('no endpoint answered');
}

/**
 * One selector applied across many arguments, in as few round trips as possible.
 *
 * allowFailure is true so that a single unreadable token -- burned, or otherwise
 * reverting -- yields a hole rather than discarding the whole batch.
 */
async function multicall(chainId, target, selector, args) {
  const batches = [];
  for (let start = 0; start < args.length; start += BATCH) {
    batches.push(args.slice(start, start + BATCH));
  }

  const runBatch = async (slice) => {
    const data = abi.encodeFunctionCall(AGGREGATE3, [
      slice.map((a) => [target, true, selector + uint256(a)])
    ]);
    const raw = await ethCall(chainId, MULTICALL3, data);
    // decodeParameters returns an array-like keyed object, not a real array
    const rows = abi.decodeParameters([RESULT_ARRAY], raw)[0];
    const part = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      part.push(row.success && row.returnData !== '0x' ? row.returnData : null);
    }
    return part;
  };

  // Batches are independent, so run several at once -- Base is seven of them and
  // sequentially that was 30s of mostly waiting. Not unbounded, though: these are
  // shared endpoints and the point of the pool is to not exhaust them.
  const results = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      results[i] = await runBatch(batches[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker)
  );
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
    const totalHex = await ethCall(chainId, contract, SEL.totalSupply);
    const total = Number(BigInt(totalHex));

    const indexes = Array.from({ length: total }, (_, i) => i);
    const idHexes = await multicall(chainId, contract, SEL.tokenByIndex, indexes);
    const tokenIds = idHexes.filter(Boolean).map((h) => BigInt(h).toString());

    const ownerHexes = await multicall(chainId, contract, SEL.ownerOf, tokenIds);
    const tokens = tokenIds.map((tokenId, i) => ({
      tokenId,
      // 32-byte word, address in the low 20 bytes
      owner: ownerHexes[i] ? '0x' + ownerHexes[i].slice(-40) : null
    }));

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
