'use strict';

// Bootstrap and config
const AWS = require('aws-sdk');
const Sharp = require('sharp');


const S3 = new AWS.S3({
  signatureVersion: 'v4',
});

const { BUCKET, URL } = process.env;
const ALLOWED_DIMENSIONS = new Set();

if (process.env.ALLOWED_DIMENSIONS) {
  const dimensions = process.env.ALLOWED_DIMENSIONS.split(/\s*,\s*/);
  dimensions.forEach(dimension => ALLOWED_DIMENSIONS.add(dimension));
}

const contentTypeFormatMap = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};


// Error response definitions
function invalidPathResponse() {
  return {
    statusCode: '400',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'INVALID_PATH',
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
      code: 'INVALID_DIMENSIONS',
      message: `Allowed dimensions: ${dimensions}`,
    }),
  };
}

function unsupportedFormatResponse() {
  const contentTypes = Object.keys(contentTypeFormatMap).join(', ');
  return {
    statusCode: '400',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'UNSUPPORTED_FORMAT',
      message: `Supported content types: ${contentTypes}`,
    }),
  };
}

function notFoundResponse(bucket, key) {
  return {
    statusCode: '404',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'NOT_FOUND',
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
    callback(null, invalidPathResponse());
    return;
  }

  const middlePath = fullPath.slice(1, fullPath.length - 1).join('/');
  // example '75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar'

  const dimsAndAssetName = fullPath[fullPath.length - 1]; // example: '50x60-img123'

  const match = dimsAndAssetName.match(/((\d+)x(\d+))-(.+)/);
  if (match === null) {
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
      callback(null, notFoundResponse(BUCKET, fullResKey));
      return;
    }
    callback(e);
    return;
  }
  // Check that the content type of the image is supported.
  if (!(data.ContentType in contentTypeFormatMap)) {
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
      .toFormat(contentTypeFormatMap[data.ContentType])
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


  // Redirect to the newly created image
  callback(null, {
    statusCode: '301',
    headers: { location: `${URL}/${key}` },
    body: '',
  });
};
