require("dotenv").config();
const Eth = require("web3-eth");
const { Kudzu } = require("kuzu-contracts");
const { eyes, mouths } = require("kudzu-cup");
const fetch = require("node-fetch");
const infura = {
  1: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
  4: `https://rinkeby.infura.io/v3/${process.env.INFURA_API_KEY}`,
  8453: "https://mainnet.base.org/",
  84532: "https://sepolia.base.org/",
};

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

    const eth = new Eth(infura[networkId]);
    kudzuContract = new eth.Contract(
      Kudzu.abi,
      Kudzu.networks[networkId].address
    );
    owner = await kudzuContract.methods.ownerOf(tokenId).call();
  } catch (e) {
    // will throw error if no owner...
    console.error(e);
  }
  return owner;
}
