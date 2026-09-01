require("dotenv").config();
const Eth = require("web3-eth");
const { Kudzu } = require("kuzu-contracts");
const { eyes, mouths } = require("kudzu-cup");
const fetch = require("node-fetch");
// Keyless, and more than one per chain. Mainnet used to be a single keyed
// Infura url; that is both a credential to leak and a single point of failure,
// and the same provider's limits had already broken metadata elsewhere in this
// codebase quietly, behind a try/catch. Order is preference, each entry a
// fallback for the one before.
const rpcs = {
  1: [
    "https://gateway.tenderly.co/public/mainnet",
    "https://mainnet.gateway.tenderly.co",
    "https://eth.drpc.org",
    "https://rpc.mevblocker.io",
    "https://ethereum-rpc.publicnode.com",
    "https://eth-mainnet.public.blastapi.io",
  ],
  4: ["https://gateway.tenderly.co/public/mainnet"],
  8453: ["https://mainnet.base.org/", "https://base-rpc.publicnode.com"],
  84532: ["https://sepolia.base.org/"],
};

// Try each endpoint for the chain until one answers. The caller reads a throw
// as "this token has no owner", so without this an outage is served as a
// legitimate result rather than as an error.
async function withEth(networkId, fn) {
  let last;
  for (const url of rpcs[networkId] ?? rpcs[1]) {
    try {
      return await fn(new Eth(url));
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("no rpc endpoint answered");
}

const networkNames = {
  1: "homestead",
  4: "rinkeby",
  8453: "base",
  84532: "base-sepolia",
};

// require('encoding') // netlify build error / missing package??

// // handler
exports.handler = async function (event, context) {
  let networkId, isBase, owner, tokenId, bigTokenId, mouth, eye;
  try {
    isBase = event.path.indexOf("base") > -1;
    networkId = event.queryStringParameters.network ?? (isBase ? "8453" : "1"); // ?network=4
    tokenId = event.path.substr(event.path.lastIndexOf("/") + 1); // 1000005

    bigTokenId = BigInt(tokenId);
    mouth = bigTokenId & 31n;
    eye = (bigTokenId >> 8n) & 31n;

    // owner = await getNFTOwnerByTokenId(tokenId, networkId);
    const contractAddress = Kudzu.networks[networkId].address;
    owner = await getOwnerOS(contractAddress, tokenId, networkId);
  } catch (e) {
    console.log({ e });
  }
  try {
    // the sauce
    const metadata = {
      // both opensea and rarebits
      name: `${isBase ? "Based " : ""}Kudzu #${bigTokenId >> 16n}`,
      owner,

      description: `Kudzu is contagious, let the vine grow...\n\nThis is the token number ${
        bigTokenId >> 16n
      } but it has ID ${tokenId} (0x${bigTokenId.toString(16)}) with ${
        eyes[eye]
      } eyes (0x${((bigTokenId >> 8n) & 31n).toString(16)}) and ${
        mouths[mouth]
      } mouth (0x${(bigTokenId & 31n).toString(16)}).`,

      // opensea
      external_url: isBase
        ? "https://x.com/billyrennekamp"
        : `https://folia.app/works/kudzu?token=${tokenId}`,
      // rarebits
      home_url: isBase
        ? "https://x.com/billyrennekamp"
        : `https://folia.app/works/kudzu?token=${tokenId}`,

      // opensea
      image: `${process.env.VUE_APP_CANONICAL_DOMAIN}/img/${
        isBase ? "base/" : ""
      }${tokenId}`,

      // rarebits
      image_url: `${process.env.VUE_APP_CANONICAL_DOMAIN}/img/${
        isBase ? "base/" : ""
      }${tokenId}`,

      // opensea
      attributes: [
        {
          trait_type: "eyes",
          value: eyes[eye],
        },
        {
          trait_type: "mouth",
          value: mouths[mouth],
        },
      ],
      // rarebits
      properties: [
        { key: "eyes", value: eyes[eye], type: "string" },
        { key: "mouth", value: mouths[mouth], type: "string" },
      ],
    };

    // return metadata :)
    return {
      statusCode: 200,
      body: JSON.stringify(metadata),
    };

    // errors...
  } catch (e) {
    console.error(e);
    return {
      statusCode: 500,
      body: JSON.stringify({
        status: 500,
        message: "Internal Server Error",
        error: e,
      }),
    };
  }
};

// HELPERS

const getNetwork = (networkId) => networkNames[networkId] ?? "homestead";

async function getOwnerOS(nftContractAddress, tokenId, networkId = 1) {
  const prefix = networkId == "1" || networkId == "8453" ? "" : "testnets-";
  // https://testnets-api.opensea.io/v2/chain/sepolia/contract/0xc8a395e3b82e515f88e0ef548124c114f16ce9e3/nfts/1?limit=50
  const target = `https://${prefix}api.opensea.io/v2/chain/${
    getNetwork(networkId) == "homestead" ? "ethereum" : getNetwork(networkId)
  }/contract/${nftContractAddress}/nfts/${tokenId.toString()}?limit=1`;
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      "X-API-KEY": process.env.OPENSEA_API_KEY,
    },
  };
  const request = await fetch(target, options);
  const response = await request.json();
  console.log({ response });
  const nft = response.nft;
  console.log({ nft });
  const owners = nft.owners;
  return owners[0].address;
}
// get token owner (check if token minted...)
async function getNFTOwnerByTokenId(tokenId, networkId = 1) {
  let owner;
  try {
    // setup contract

    owner = await withEth(networkId, async (eth) => {
      kudzuContract = new eth.Contract(
        Kudzu.abi,
        Kudzu.networks[networkId].address
      );
      return kudzuContract.methods.ownerOf(tokenId).call();
    });
  } catch (e) {
    // will throw error if no owner...
    console.error(e);
  }
  return owner;
}
