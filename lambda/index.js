'use strict';

// Bootstrap and config
const AWS = require('aws-sdk');
const Sharp = require('sharp');
const { URL } = require('url');

const S3 = new AWS.S3({
  signatureVersion: 'v4',
});

const { BUCKET, REDIRECT_BASE_URL } = process.env;
const PRESIGNED_EXPIRATION_SECONDS = parseInt(process.env.PRESIGNED_EXPIRATION_SECONDS, 10);

const ALLOWED_DIMENSIONS = new Set();
if (process.env.ALLOWED_DIMENSIONS) {
  const dimensions = process.env.ALLOWED_DIMENSIONS.split(/\s*,\s*/);
  dimensions.forEach(dimension => ALLOWED_DIMENSIONS.add(dimension));
}

const supportedFormats = new Set(['jpeg', 'png', 'webp', 'tiff']);

const imageFormatOptionsMap = {
  // Each output format has lots of options
  // http://sharp.dimens.io/en/stable/api-output/#parameters_3
  jpeg: { quality: 90 },
  png: {},
  webp: { quality: 90 },
  tiff: { compression: 'lzw' },
};


// Error response definitions
function invalidPathResponse() {
  return {
    statusCode: '400',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      errorCategory: 'InvalidResizePath',
      message: 'Path did not match expected format.',
    }),
  };
}

function invalidDimensionsResponse() {
  const dimensions = Array.from(ALLOWED_DIMENSIONS).join(', ');
  return {
    statusCode: '400',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      errorCategory: 'InvalidDimensions',
      message: `Allowed dimensions: ${dimensions}`,
    }),
  };
}

function unsupportedFormatResponse() {
  const imageFormats = Array.from(supportedFormats).join(', ');
  return {
    statusCode: '400',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      errorCategory: 'UnsupportedFormat',
      message: `Supported image formats: ${imageFormats}`,
    }),
  };
}

function notFoundResponse(bucket, key) {
  return {
    statusCode: '404',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      errorCategory: 'NotFound',
      message: `Asset not found in bucket ${bucket} with key ${key}`,
    }),
  };
}

// Success response definition


// Main handler called by API gateway
exports.handler = async function handler(event, context, callback) {
  const { key } = event.queryStringParameters;
  // example: 'resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123'

  const fullPath = key.split('/');
  // example: ['resize','75c06d3b-4342-4ab8-aa37-b1f01d654ac1','private','avatar','50x60-img123']
  if (fullPath.length < 2 || fullPath[0] !== 'resize') {
    // has to start with 'resize' and end with the asset name, can have more paths in between.
    console.warn(`Invalid path ${key}`);
    callback(null, invalidPathResponse());
    return;
  }

  const middlePath = fullPath.slice(1, fullPath.length - 1).join('/');
  // example '75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar'

  const dimsAndAssetName = fullPath[fullPath.length - 1]; // example: '50x60-img123'

  const match = dimsAndAssetName.match(/((\d+)x(\d+))-(.+)/);
  if (match === null) {
    console.warn(`Invalid path ${key}`);
    callback(null, invalidPathResponse());
    return;
  }
  const dimensions = match[1]; // example: '50x60'
  const width = parseInt(match[2], 10); // example: 50
  const height = parseInt(match[3], 10); // example: 60
  const assetName = match[4]; // example: 'img123'

  const fullResKey = `assets/${middlePath}/${assetName}`;
  // example 'assets/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/img123'

  // If we are restricting the allowable dimensions, make sure the request meets that.
  if (ALLOWED_DIMENSIONS.size > 0 && !ALLOWED_DIMENSIONS.has(dimensions)) {
    console.warn(`Invalid dimensions ${dimensions}`);
    callback(null, invalidDimensionsResponse());
    return;
  }


  // Get the full sized image out of S3
  let data;
  try {
    data = await S3.getObject({ Bucket: BUCKET, Key: fullResKey }).promise();
  } catch (e) {
    // Check for not found error
    if (e.code === 'NoSuchKey') {
      console.warn(`Key not found: ${fullResKey}`);
      callback(null, notFoundResponse(BUCKET, fullResKey));
      return;
    }
    callback(e);
    return;
  }


  // Check that the mimetype of the image is supported.
  // Content-Type starts with the mimetype but can have things after it.
  // example 'image/jpeg; name=something' where jpeg is the desired result
  const formatMatch = data.ContentType.toLowerCase().match(/^image\/(\w+)(;.*)?/);
  if (formatMatch === null) {
    console.warn(`Unsupported image content type: ${data.ContentType}`);
    callback(null, unsupportedFormatResponse());
    return;
  }
  const imageFormat = formatMatch[1]; // example 'jpeg'
  if (!supportedFormats.has(imageFormat)) {
    console.warn(`Unsupported image content type: ${data.ContentType}`);
    callback(null, unsupportedFormatResponse());
    return;
  }


  // Add a "resized-from" property to the metadata
  const metadata = data.Metadata;
  metadata['resized-from'] = fullResKey;


  // Resize it with Sharp
  let buffer;
  try {
    buffer = await Sharp(data.Body)
      .resize(width, height)
      .toFormat(imageFormat, imageFormatOptionsMap[imageFormat])
      .toBuffer();
  } catch (e) {
    callback(e);
    return;
  }


  // Save the resized image to S3 for retrieving later.
  try {
    await S3.putObject({
      Body: buffer,
      Bucket: BUCKET,
      ContentType: data.ContentType, // use the original content type
      Metadata: metadata, // copy the original's metadata.
      Key: key, // gets saved at the path that was originally requested.
    }).promise();
  } catch (e) {
    callback(e);
    return;
  }


  // Get a presigned url for the newly saved image.
  const signedUrl = S3.getSignedUrl('getObject',
    { Bucket: BUCKET, Key: key, Expires: PRESIGNED_EXPIRATION_SECONDS });
  // TODO: Make sure this actually works! https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getSignedUrl-property
  // Parse the url and use the configured base url instead.
  const parsedUrl = new URL(signedUrl);
  const resultUrl = new URL(REDIRECT_BASE_URL);
  resultUrl.pathname = parsedUrl.pathname;
  resultUrl.search = parsedUrl.search;
  const redirectTo = resultUrl.toString();

  // Redirect to the newly created image
  callback(null, {
    statusCode: '201',
    headers: { location: redirectTo },
    body: JSON.stringify({
      result: 'Created',
      location: redirectTo,
    }),
  });
};
