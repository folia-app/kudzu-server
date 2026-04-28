const { createCanvas, loadImage } = require('@napi-rs/canvas')
const fs = require('fs')
require('dotenv').config()
const w = 553
const h = 311

exports.handler = async function (event, context) {
  try {
    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    const data = fs.readFileSync(require.resolve('./test-image.jpeg'))
    const drawing = await loadImage(data)
    ctx.drawImage(drawing, 0, 0, w, h)
    const dataURL = canvas.toDataURL("image/jpeg", 0.03)
    return {
      statusCode: 200,
      headers: { 'content-type': "image/jpeg" },
      body: dataURL.replace('data:image/jpeg;base64,', ''),
      isBase64Encoded: true,
    }
  } catch (error) {
    return { statusCode: 500, body: error.toString() }
  }
}



