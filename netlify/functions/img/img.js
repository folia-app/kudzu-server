const { Image, createCanvas } = require("canvas");
const fs = require("fs");
const Eth = require("web3-eth");
const { Kudzu } = require("kuzu-contracts");
const path = require("path");
require("dotenv").config();

var loadFromUrl = process.env.IMG_URL?.length > 0;
const ignoreIsOwned = process.env.VUE_APP_DEV_IGNORE_IS_OWNED === "true";

const networks = {
  mainnet: {
    id: 1,
    infura: `wss://mainnet.infura.io/ws/v3/${process.env.INFURA_API_KEY}`,
  },
  base: {
    id: 8453,
    infura: "https://mainnet.base.org/",
    theme: {
      leavesShift: 10000000000,
      getLeavesColor: (num) => {
        const maxBlue = 285;
        const minBlue = 190;
        const diff = maxBlue - minBlue;
        num = minBlue + parseInt((num * diff) / 10); // hsl 190 - 285
        if (Math.abs(num - 221) < 30) {
          num = 221;
        }
        return `hsl(${num}, 100%, 52%)`;
      },
      replacements: [
        { old: { r: 128, g: 92, b: 254 }, new: { r: 0, g: 82, b: 255 } },
        { old: { r: 2, g: 168, b: 254 }, new: { r: 31, g: 137, b: 187 } },
        { old: { r: 29, g: 0, b: 219 }, new: { r: 5, g: 69, b: 113 } },
      ],
      replaceBlackValue: 40,
    },
  },
  forma: {
    id: 984122,
    infura: "",
    theme: {
      fry: 0.02,
      // bgColor: 'gray',
      leavesShift: 10000000000 / 2,
      getLeavesColor: (num) => {
        // these colors don't produce gray gaps between that get replaced with replaceBlack()
        // (so face stands out more)
        const colors = [
          200,
          // 200,
          225,
          // 225,
          // 235,
          235, 280, 320,
          // 221, // fries violet (#00CC7F)
          // 250, // fries dark blue (#1B00D9)
          // // 285, // fries pink (#FF11FF) -- DONT USE: SAME AS HEARTs...
          // // 340, // creates orange
        ];
        let color = colors[num % colors.length];
        // shift colors until produces 5 colors without gray gaps
        // and aren't the same colors as barf and sweat (turq + peasoup)
        color += 0; // 35
        // adjust light for texture / noise / reduce gray gaps
        const light = 58; // 58 // 52
        return `hsl(${color}, 100%, ${light}%)`;
      },
      replacements: [
        {
          old: { r: 5, g: 80, b: 255 }, // bright blue
          new: { r: 194, g: 0, b: 255 },
        },

        {
          old: { r: 142, g: 52, b: 18 }, // brown to black
          // new: { r: 20, g: 20, b: 20 },
          // new: { r: 71, g: 25, b: 9 },
          new: { r: 48, g: 8, b: 3 },
        },

        // { old: { r: 27, g: 0, b: 217 },  // darkblue ->
        //   // new: { r: 117, g: 14, b: 165, }
        //   new: { r: 139, g: 0, b: 204 }
        // },
        // { old: { r: 255, g: 17, b: 255 },  // brighpink ->
        //   // new: { r: 194, g: 0, b: 255, }
        //   new: { r: 194, g: 0, b: 255 }
        // },
        // { old: { r: 129, g: 91, b: 254},  // violet ->
        //   // new: { r: 123, g: 43, b: 249 }
        //   new: { r: 194, g: 0, b: 255 }
        // },

        // { old: { r: 1, g: 166, b: 255 },  // skyblue ->
        //   new: { r: 146, g: 79, b: 236 }
        //   // new: { r: 106, g: 106, b: 106, }
        //   // new: { r: 255, g: 43, b: 20 }
        // },

        // // { old: { r: 254, g: 88, b: 1 },  // orange ->
        // //   new: { r: 171, g: 44, b: 255, }
        // // },
      ],
      replaceBlackValue: 50,
    },
  },
  // saved for later:
  // purple, blue, yellow, teal, puke-green, orange (before swaps)
  rainbowbarf: {
    id: 4,
    infura: "",
    theme: {
      // bgColor: 'gray',
      leavesShift: 10000000000 / 2,
      getLeavesColor: (num) => {
        const colors = [
          "#7b2bf9", // "Electric Violet"
          "hsla(280, 80%, 40%, 1)", // makes dark blue for replace color targeting
          "#fd63d9", // "Razzle Dazzle Rose" bright pink
          "hsla(181, 80%, 72%, 1)", // makes teal but white edges??
          "hsla(37, 80%, 55%, 1)", // fries to puke green
          "hsla(37, 100%, 60%, 1)", // fries to neon yellow
          "hsla(37, 100%, 55%, 1)", // fries to solid orange
        ];
        const color = colors[num % colors.length];
        return color;
      },
    },
  },
  // 'base-sepolia': {
  //   id: 84532,
  //   infura: "https://sepolia.base.org/",
  // }
};

var size = 768;
var gridSize = 8;
var margin = 2;
let circleSize, radius, offset, ctx;
let kudzuContract;

exports.handler = async function (event, context) {
  const funcPath = event.path.split("img/")[1].split("/");
  let tokenId = funcPath.pop();
  const network = funcPath[0] || "mainnet";
  const theme = networks[network].theme;

  const networkId = event.queryStringParameters.network ?? networks[network].id; // ?network=4
  const byIndex = event.queryStringParameters.byIndex;

  if (byIndex) {
    tokenId = await getTokenByIndex(tokenId, networkId);
  }

  if (tokenId == "") {
    tokenId = Math.floor(Math.random() * 10000000000000000);
    console.log({ tokenId });
  }

  if (!ignoreIsOwned) {
    // !! generative && not owned / minted yet
    const owner = await getNFTOwnerByTokenId(tokenId, networkId);
    if (!owner) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: "Not yet minted",
        }),
      };
    }
  }

  const canvas = createCanvas(size, size);
  ctx = canvas.getContext("2d");
  canvas.width = size;
  canvas.height = size;

  await makeKudzu(tokenId, theme);

  // le deep frying happens here
  const fry = theme?.fry || 0.01;
  var dataURL = canvas.toDataURL("image/jpeg", fry);
  dataURL = await replaceWhite(dataURL);

  if (theme?.replacements) {
    dataURL = await replaceColors(dataURL, theme.replacements);
  }

  if (theme?.replaceBlackValue) {
    dataURL = await replaceBlack(dataURL, theme.replaceBlackValue);
  }

  return {
    statusCode: 200,
    headers: {
      "content-type": "image/jpeg",
    },
    body: dataURL.replace("data:image/jpeg;base64,", ""),
    isBase64Encoded: true,
  };
};

// methods
async function makeKudzu(tokenId, theme) {
  var grid = new Array(gridSize)
    .fill([])
    .map((item) => new Array(gridSize).fill(0));

  ctx.fillStyle = theme?.bgColor || "white";
  ctx.fillRect(0, 0, size, size);

  addLeaves(grid, tokenId, theme);

  await addEyesAndMouth(tokenId);
}

function addLeaves(grid, tokenId, theme) {
  circleSize = size / (gridSize + margin * 2);
  radius = circleSize / 1.25;
  offset = margin * circleSize;

  if (theme?.leavesShift) {
    tokenId += theme.leavesShift;
  }

  var tokenBase = BigInt(tokenId);
  tokenBase = tokenBase >> 16n;
  tokenBase = tokenBase.toString(10);

  var sequence = Array.from(Array(grid.length * grid.length).keys());

  shuffle(sequence, tokenBase);
  var off = 0;
  for (var i = 0; i < sequence.length; i++) {
    var row = Math.floor(sequence[i] / grid.length);
    var col = sequence[i] % grid.length;
    let color;
    var num = tokenBase.substr(-off, 1);
    if (theme?.getLeavesColor) {
      color = theme.getLeavesColor(num);
    } else {
      num = num * 11 + 119;
      color = `rgba(0, ${num}, 0, 1)`;
    }
    off += 1;
    if (off >= tokenBase.length) {
      off = 0;
    }

    makeSmallLeaf(row, col, color, tokenBase, off);
  }
}

function shuffle(array, tokenId) {
  var currentIndex = array.length,
    temporaryValue,
    randomIndex;
  var off = 0;
  // While there remain elements to shuffle...
  while (0 !== currentIndex) {
    // Pick a remaining element...
    // randomIndex = Math.floor(Math.random() * currentIndex);
    randomIndex = Math.floor((tokenId.substr(-off, 1) / 10) * currentIndex);

    // randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
    off += 1;
    if (off >= tokenId.length) {
      off = 0;
    }
  }
  return array;
}

function makeSmallLeaf(i, j, color, tokenId, off) {
  var x = i * circleSize + circleSize / 2 + offset;
  var y = j * circleSize + circleSize / 2 + offset;
  ctx.fillStyle = color;
  let rotate;
  ctx.beginPath();

  var side = Math.floor((tokenId.substr(off, 1) / 10) * 4) + 1;

  switch (side) {
    case 1:
      rotate = 0;
      ctx.arc(x - radius, y, radius * 2, rotate, rotate + 0.4 * Math.PI, 0);
      ctx.arc(x - radius * 2, y, radius * 2, rotate, rotate, 0);
      break;
    case 2:
      rotate = Math.PI;
      ctx.arc(x + radius, y, radius * 2, rotate, rotate + 0.4 * Math.PI, 0);
      ctx.arc(x + radius * 2, y, radius * 2, rotate, rotate, 0);
      break;
    case 3:
      rotate = -Math.PI / 2;
      ctx.arc(x, y + radius, radius * 2, rotate, rotate + 0.4 * Math.PI, 0);
      ctx.arc(x, y + radius * 2, radius * 2, rotate, rotate, 0);
      break;
    case 4:
      rotate = -Math.PI;
      ctx.arc(
        x + radius / 2,
        y + radius * 0.9,
        radius * 2,
        rotate,
        rotate + 0.4 * Math.PI,
        0
      );
      ctx.arc(x + radius * 2, y - radius * 0.1, radius * 2, rotate, rotate, 0);
      break;
  }

  // circle
  var startAngle = 0;
  var endAngle = 2 * Math.PI;
  var counterclockwise = 0;
  ctx.arc(x, y, radius, startAngle, endAngle, counterclockwise);
  ctx.fill();
}

async function addEyesAndMouth(tokenId) {
  tokenId = BigInt(tokenId);
  var mouth = tokenId & 31n;
  var eyes = (tokenId >> 8n) & 31n;

  // for testing colors against tear and barf colors
  // mouth = 1
  // eyes = 15

  var drawingSize = size / 1.6;
  var drawingPos = (size - drawingSize) / 2;

  return new Promise((resolve) => {
    var done = false;

    var drawing = new Image();
    if (!loadFromUrl) {
      var filename = `./eyes/${eyes}.png`;
      const data = fs.readFileSync(require.resolve(filename));
      // // convert image file to base64-encoded string
      const base64Image = Buffer.from(data, "binary").toString("base64");
      // // combine all strings
      const base64ImageStr = `data:image/${eyes};base64,${base64Image}`;
      src = base64ImageStr;
    } else {
      src = `${process.env.IMG_URL}/eyes/${eyes}.png`;
    }

    drawing.onload = function () {
      ctx.drawImage(drawing, drawingPos, drawingPos, drawingSize, drawingSize);
      if (done) {
        resolve();
      } else {
        done = true;
      }
    };
    drawing.src = src;

    var drawing2 = new Image();
    if (!loadFromUrl) {
      var filename = `./mouth/${mouth}.png`;
      const data = fs.readFileSync(require.resolve(filename));
      // // convert image file to base64-encoded string
      const base64Image = Buffer.from(data, "binary").toString("base64");
      // // combine all strings
      const base64ImageStr = `data:image/${eyes};base64,${base64Image}`;
      src2 = base64ImageStr;
    } else {
      src2 = `${process.env.IMG_URL}/mouth/${mouth}.png`;
    }

    drawing2.onload = function () {
      ctx.drawImage(drawing2, drawingPos, drawingPos, drawingSize, drawingSize);
      if (done) {
        resolve();
      } else {
        done = true;
      }
    };
    drawing2.src = src2;
  });
}
function replaceBlack(dataURL, value = 40) {
  return new Promise((resolve) => {
    const cnv = createCanvas(size, size);
    const ctx = cnv.getContext("2d");
    cnv.width = size;
    cnv.height = size;
    const img = new Image();
    img.onload = function () {
      ctx.drawImage(img, 0, 0);
      const oldR = 127;
      const oldG = 127;
      const oldB = 127;

      const newR = value;
      const newG = value;
      const newB = value;

      var imageData = ctx.getImageData(0, 0, size, size);

      // change any old rgb to the new-rgb
      for (var i = 0; i < imageData.data.length; i += 4) {
        // console.log(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2])
        // is this pixel the old rgb?
        const redDiff = imageData.data[i] - oldR;
        const greenDiff = imageData.data[i + 1] - oldG;
        const blueDiff = imageData.data[i + 2] - oldB;
        const diffMax = 70;
        if (
          Math.abs(redDiff) < diffMax &&
          Math.abs(greenDiff) < diffMax &&
          Math.abs(blueDiff) < diffMax
        ) {
          // change to your new rgb
          imageData.data[i] = newR; //+ redDiff;
          imageData.data[i + 1] = newG; //+ greenDiff;
          imageData.data[i + 2] = newB; //+ blueDiff;
        }
      }
      // put the altered data back on the canvas
      ctx.putImageData(imageData, 0, 0);
      resolve(cnv.toDataURL("image/jpeg"));
    };
    img.src = dataURL;
  });
}

function replaceColors(dataURL, replacements) {
  // return dataURL
  return new Promise((resolve) => {
    const cnv = createCanvas(size, size);
    const ctx = cnv.getContext("2d");
    cnv.width = size;
    cnv.height = size;
    const img = new Image();
    img.onload = function () {
      ctx.drawImage(img, 0, 0);

      var imageData = ctx.getImageData(0, 0, size, size);

      // change any old rgb to the new-rgb
      for (var i = 0; i < imageData.data.length; i += 4) {
        // console.log(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2])
        // is this pixel the old rgb?
        for (let j = 0; j < replacements.length; j++) {
          const oldR = replacements[j].old.r;
          const oldG = replacements[j].old.g;
          const oldB = replacements[j].old.b;

          const newR = replacements[j].new.r;
          const newG = replacements[j].new.g;
          const newB = replacements[j].new.b;

          const redDiff = imageData.data[i] - oldR;
          const greenDiff = imageData.data[i + 1] - oldG;
          const blueDiff = imageData.data[i + 2] - oldB;
          const diffMax = 70;
          if (
            Math.abs(redDiff) < diffMax &&
            Math.abs(greenDiff) < diffMax &&
            Math.abs(blueDiff) < diffMax
          ) {
            // change to your new rgb
            imageData.data[i] = newR; //+ redDiff;
            imageData.data[i + 1] = newG; //+ greenDiff;
            imageData.data[i + 2] = newB; //+ blueDiff;
          }
        }
      }
      // put the altered data back on the canvas
      ctx.putImageData(imageData, 0, 0);
      resolve(cnv.toDataURL("image/jpeg"));
    };
    img.src = dataURL;
  });
}

function replaceWhite(dataURL) {
  return new Promise((resolve) => {
    const cnv = createCanvas(size, size);
    const ctx = cnv.getContext("2d");
    cnv.width = size;
    cnv.height = size;
    const img = new Image();
    img.onload = function () {
      ctx.drawImage(img, 0, 0);
      const oldRed = 228;
      const oldGreen = 228;
      const oldBlue = 228;

      var imageData = ctx.getImageData(0, 0, size, size);

      // change any old rgb to the new-rgb
      for (var i = 0; i < imageData.data.length; i += 4) {
        // is this pixel the old rgb?
        if (
          imageData.data[i] == oldRed &&
          imageData.data[i + 1] == oldGreen &&
          imageData.data[i + 2] == oldBlue
        ) {
          // change to your new rgb
          imageData.data[i] = 255;
          imageData.data[i + 1] = 255;
          imageData.data[i + 2] = 255;
        }
      }
      // put the altered data back on the canvas
      ctx.putImageData(imageData, 0, 0);
      resolve(cnv.toDataURL("image/jpeg"));
    };
    img.src = dataURL;
  });
}

async function getTokenByIndex(tokenId, networkId = 1) {
  // setup contract
  const eth = new Eth(networks.find((n) => n.id === networkId).infura);
  kudzuContract = new eth.Contract(
    Kudzu.abi,
    Kudzu.networks[networkId].address
  );

  const tokenByIndex = await kudzuContract.methods.tokenByIndex(tokenId).call();
  return tokenByIndex.toString(10);
}

// get token owner (check if token minted...)
async function getNFTOwnerByTokenId(tokenId, networkId = 1) {
  let owner;
  try {
    // setup contract
    const eth = new Eth(networks.find((n) => n.id === networkId).infura);
    kudzuContract = new eth.Contract(
      Kudzu.abi,
      Kudzu.networks[networkId].address
    );

    const totalSupply = await kudzuContract.methods.totalSupply().call();
    console.log({ totalSupply });

    owner = await kudzuContract.methods.ownerOf(tokenId).call();
  } catch (e) {
    // will throw error if no owner...
    console.error(e);
  }
  return owner;
}
