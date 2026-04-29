// import { Kudzu } from 'kuzu-contracts'
const { Kudzu } = require('kuzu-contracts');
const fetch = require('node-fetch');
// import Eth from 'web3-eth'

require('dotenv').config();

const ignoreIsOwned = process.env.VUE_APP_DEV_IGNORE_IS_OWNED === 'true';

// Index Supply API configuration
const INDEX_SUPPLY_API_KEY = process.env.INDEX_SUPPLY_API_KEY;
const INDEX_SUPPLY_BASE_URL = 'https://api.indexsupply.net/v2/query';

const transferInputs = [
  {
    indexed: true,
    internalType: 'address',
    name: 'from',
    type: 'address',
  },
  {
    indexed: true,
    internalType: 'address',
    name: 'to',
    type: 'address',
  },
  {
    indexed: true,
    internalType: 'uint256',
    name: 'tokenId',
    type: 'uint256',
  },
];

let kudzuContract;

exports.handler = async function (event, context) {
  const networkId = event.queryStringParameters.network ?? '1'; // ?network=4
  const tokenIds = await getTokenIds(networkId);
  const contract = Kudzu.networks[networkId]?.address || null;
  return {
    statusCode: 200,
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=86400',
    },
    body: JSON.stringify({ contract, chainId: parseInt(networkId, 10), tokens: tokenIds }),
  };
};

function makeIndexSupplyUrl(query, eventSignature, chainId) {
  const escapedQuery = encodeURIComponent(query);
  const escapedSignature = encodeURIComponent(eventSignature);
  return `${INDEX_SUPPLY_BASE_URL}?api-key=${INDEX_SUPPLY_API_KEY}&query=${escapedQuery}&signatures=${escapedSignature}`;
}

async function getTokenIds(networkId) {
  const contractAddress = Kudzu.networks[networkId].address;
  const chainId = networkId;

  if (!contractAddress) {
    throw new Error(`No contract address found for network ${networkId}`);
  }

  // SQL query to get all Infect events for the contract
  const query = `
    SELECT "to", tokenId
    FROM infect 
    WHERE chain = ${chainId} 
    AND address = '${contractAddress.toLowerCase()}'
    ORDER BY block_num ASC, log_idx ASC
  `;

  const eventSignature =
    'event Infect(address indexed from, address indexed to, uint256 indexed tokenId)';
  const url = makeIndexSupplyUrl(query, eventSignature);

  console.log(`Fetching Infect events from Index Supply for chain ${chainId}...`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Index Supply API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Found ${data[0]?.rows?.length || 0} Infect events`);

    if (!data[0] || !data[0].rows) {
      return [];
    }

    let events = data[0].rows.map((row) => {
      const [to, tokenId] = row;
      return {
        returnValues: {
          to,
          tokenId: tokenId.toString(),
        },
      };
    });

    // Apply the same filtering logic as before
    // if (networkId == '8453') {
    //   events = events.filter((event) => {
    //     const { from, to, tokenId } = event.returnValues;
    //     return from != '0x0000000000000000000000000000000000000000';
    //   });
    // }

    const tokenIds = events.map((event) => {
      return {
        tokenId: event.returnValues.tokenId,
        owner: event.returnValues.to,
      };
    });

    return tokenIds;
  } catch (error) {
    console.error('Error fetching from Index Supply:', error);
    throw error;
  }
}
