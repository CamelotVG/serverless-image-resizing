'use strict';

// Bootstrap and config
const AWS = require('aws-sdk');
const S3 = new AWS.S3({
  signatureVersion: 'v4',
});
const Sharp = require('sharp');

const BUCKET = process.env.BUCKET;
const URL = process.env.URL;
const ALLOWED_DIMENSIONS = new Set();

if (process.env.ALLOWED_DIMENSIONS) {
  const dimensions = process.env.ALLOWED_DIMENSIONS.split(/\s*,\s*/);
  dimensions.forEach((dimension) => ALLOWED_DIMENSIONS.add(dimension));
}

const formatMap = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
};

const contentTypeMap = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}


// Error response definitions
function invalidPathResponse() {
  return {
    statusCode: '400',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      'code': 'INVALID_PATH',
      'message': 'Path did not match expected format.',
    }),
  };
}

function invalidDimensionsResponse() {
  const dimensions = Array.from(ALLOWED_DIMENSIONS).join(', ');
  return {
    statusCode: '403',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      'code': 'INVALID_DIMENSIONS',
      'message': `Allowed dimensions: ${dimensions}`,
    }),
  };
}

function unsupportedFormatResponse() {
  const extensions = Object.keys(formatMap).join(', ');
  return {
    statusCode: '400',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      'code': 'UNSUPPORTED_FORMAT',
      'message': `Supported file extensions: ${extensions}`,
    }),
  };
}

// Success response definition


// Main handler called by API gateway
exports.handler = function(event, context, callback) {
  const key = event.queryStringParameters.key;
  // example: 'resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123.jpg'

  const fullPath = key.split('/');
  // example: ['resize', '75c06d3b-4342-4ab8-aa37-b1f01d654ac1', 'private', 'avatar', '50x60-img123.jpg']
  if (fullPath.length < 2 || fullPath[0] !== 'resize') {
    callback(null, invalidPathResponse()); // has to start with 'resize' and end with the filename, can have more paths in between.
    return;
  }

  const middlePath = fullPath.slice(1, fullPath.length - 1).join('/');
  // example '75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar'

  const dimsAndFilename = fullPath[fullPath.length - 1]; // example: '50x60-img123.jpg'

  const match = dimsAndFilename.match(/((\d+)x(\d+))-(.+)\.(.+)/);
  if (match === null) {
    callback(null, invalidPathResponse());
    return;
  }
  const dimensions = match[1]; // example: '50x60'
  const width = parseInt(match[2], 10); // example: 50
  const height = parseInt(match[3], 10); // example: 60
  const filename = match[4]; // example: 'img123'
  const extension = match[5]; // example: 'jpg'

  const fullResKey = `assets/${middlePath}/${filename}.${extension}`;
  // example 'assets/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/img123.jpg'

  // If we are restricting the allowable dimensions, make sure the request meets that.
  if(ALLOWED_DIMENSIONS.size > 0 && !ALLOWED_DIMENSIONS.has(dimensions)) {
    callback(null, invalidDimensionsResponse());
    return;
  }

  // check the file extension
  const lowerExtension = extension.toLowerCase();
  if (!formatMap.hasOwnProperty(lowerExtension)) {
    callback(null, unsupportedFormatResponse());
    return;
  }

  // Get the full sized image out of S3
  S3.getObject({Bucket: BUCKET, Key: fullResKey,}).promise()
    // Resize it with Sharp
    .then(data => Sharp(data.Body)
      .resize(width, height)
      .toFormat(formatMap[lowerExtension])
      .toBuffer()
    )
    // Save it for future use
    .then(buffer => S3.putObject({
        Body: buffer,
        Bucket: BUCKET,
        ContentType: contentTypeMap[lowerExtension],
        // TODO: Any other attributes to save?
        Key: key, // gets saved at the path that was originally requested.
      }).promise()
    )
    // Redirect to the newly created image
    .then(() => callback(null, {
        statusCode: '301',
        headers: {'location': `${URL}/${key}`},
        body: '',
      })
    )
    // TODO: Catch not found error when getting the full res image.
    .catch(err => callback(err))
}
