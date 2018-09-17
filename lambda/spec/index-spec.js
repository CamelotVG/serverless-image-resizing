/* eslint-env node, jasmine */

'use strict';

const patcher = require('mock-require');
const sinon = require('sinon');
require('jasmine-sinon'); // adds jasmine matchers for sinon mocks.

// Helper functions
function setEnvironment() {
  process.env.BUCKET = 'example-bucket';
  process.env.REDIRECT_BASE_URL = 'https://configurable.url.com';
  process.env.PRESIGNED_EXPIRATION_SECONDS = '30';
}

function resetEnvironment() {
  process.env.BUCKET = undefined;
  process.env.REDIRECT_BASE_URL = undefined;
  process.env.PRESIGNED_EXPIRATION_SECONDS = undefined;
}

function resetPatcher() {
  patcher.stop('aws-sdk');
  patcher.stop('sharp');
}

function makeGetObjectsPromiseWrapper(contentType) {
  return {
    promise() { // the AWS sdk functions all return an object with a promise function.
      return new Promise((resolve) => {
        resolve({
          Metadata: { example: 'value' },
          Body: 'original image data',
          ContentType: contentType,
        });
      });
    },
  };
}

function makeGetObjectsNotFoundPromiseWrapper() {
  return {
    promise() {
      return new Promise((_, reject) => {
        reject({ code: 'NoSuchKey' }); // eslint-disable-line prefer-promise-reject-errors
      });
    },
  };
}

function makeEmptyPromiseWrapper() {
  return {
    promise() {
      return new Promise((resolve) => {
        resolve({});
      });
    },
  };
}

function patchS3() {
  const s3Stubs = {
    getObject: sinon.stub(),
    putObject: sinon.stub(),
    getSignedUrl: sinon.stub(),
  };
  // this allows the return values to be set in the actual tests.
  this.s3Stubs = s3Stubs;

  function s3Constructor() {
    return s3Stubs;
  }
  patcher('aws-sdk', { S3: s3Constructor });
}

function patchSharp() {
  const sharpFuncStubs = {
    resize: sinon.stub(),
    toFormat: sinon.stub(),
    toBuffer: sinon.stub(),
  };
  this.sharpFuncStubs = sharpFuncStubs;

  sharpFuncStubs.resize.returns(sharpFuncStubs);
  sharpFuncStubs.toFormat.returns(sharpFuncStubs);
  sharpFuncStubs.toBuffer.returns(new Promise((resolve) => {
    resolve('resized image data');
  }));

  const sharpStub = sinon.stub();
  this.sharpStub = sharpStub;
  sharpStub.returns(sharpFuncStubs);
  patcher('sharp', sharpStub);
}


// Test descriptions, setup, teardown, and actual tests.
describe('Image resize function', () => {
  beforeEach(function before() {
    setEnvironment();
    patchS3.call(this);
    patchSharp.call(this);
    sinon.stub(console, 'warn'); // makes test output quieter.
    // Now that everything has been patched, the handler can be loaded.
    this.handler = require('../index').handler; // eslint-disable-line global-require
  });

  afterEach(() => {
    resetEnvironment();
    resetPatcher();
    console.warn.restore();
    delete require.cache[require.resolve('../index')]; // force re-importing of the code.
  });

  it('should calculate the correct URL with good input', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsPromiseWrapper('image/jpeg; name=something'));
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123',
      },
    };
    const s3Url = 'https://s3-us-west-1.amazonaws.com/example-bucket/resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123?AWSAccessKeyId=key&Expires=12345&Signature=signature';
    this.s3Stubs.getSignedUrl.returns(s3Url);
    const resultUrl = 'https://configurable.url.com/example-bucket/resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123?AWSAccessKeyId=key&Expires=12345&Signature=signature';

    const callback = (error, result) => {
      expect(error).toBeNull();
      expect(result).toEqual({
        statusCode: '201',
        headers: { location: resultUrl },
        body: {
          result: 'Created',
          location: resultUrl,
        },
      });
    };
    return this.handler(event, null, callback);
  });

  it('should call the correct S3 functions', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsPromiseWrapper('image/jpeg; name=something'));
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'resize/something/50x60-img123',
      },
    };
    const s3Url = 'https://presigned.url.com/path?stuff=things';
    this.s3Stubs.getSignedUrl.returns(s3Url);

    const callback = () => {
      expect(this.s3Stubs.getObject).toHaveBeenCalledWith(
        { Bucket: 'example-bucket', Key: 'assets/something/img123' },
      );
      expect(this.s3Stubs.putObject).toHaveBeenCalledWith({
        Body: 'resized image data',
        Bucket: 'example-bucket',
        ContentType: 'image/jpeg; name=something',
        Metadata: { example: 'value', 'resized-from': 'assets/something/img123' },
        Key: 'resize/something/50x60-img123',
      });
      expect(this.s3Stubs.getSignedUrl).toHaveBeenCalledWith(
        'getObject',
        { Bucket: 'example-bucket', Key: 'resize/something/50x60-img123', Expires: 30 },
      );
    };
    return this.handler(event, null, callback);
  });

  it('should call the correct Sharp functions', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsPromiseWrapper('image/jpeg; name=something'));
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'resize/something/50x60-img123',
      },
    };
    const s3Url = 'https://presigned.url.com/path?stuff=things';
    this.s3Stubs.getSignedUrl.returns(s3Url);

    const callback = () => {
      expect(this.sharpStub).toHaveBeenCalledWith('original image data');
      expect(this.sharpFuncStubs.resize).toHaveBeenCalledWith(50, 60);
      expect(this.sharpFuncStubs.toFormat).toHaveBeenCalledWith(
        'jpeg',
        { quality: 90 },
      );
      expect(this.sharpFuncStubs.toBuffer).toHaveBeenCalled();
    };
    return this.handler(event, null, callback);
  });

  it('should return InvalidResizePath error when the path is wrong format', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsPromiseWrapper('image/jpeg; name=something'));
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'does/not/start/with/resize/50x60-img123',
      },
    };
    const s3Url = 'https://presigned.url.com/path?stuff=things';
    this.s3Stubs.getSignedUrl.returns(s3Url);

    const callback = (error, result) => {
      expect(error).toBeNull();
      expect(result).toEqual({
        statusCode: '400',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorCategory: 'InvalidResizePath',
          message: 'Path did not match expected format.',
        }),
      });
    };
    return this.handler(event, null, callback);
  });

  it('should return InvalidResizePath error when no dimensions are included', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsPromiseWrapper('image/jpeg; name=something'));
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'resize/something/no-dimensions-img123',
      },
    };
    const s3Url = 'https://presigned.url.com/path?stuff=things';
    this.s3Stubs.getSignedUrl.returns(s3Url);

    const callback = (error, result) => {
      expect(error).toBeNull();
      expect(result).toEqual({
        statusCode: '400',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorCategory: 'InvalidResizePath',
          message: 'Path did not match expected format.',
        }),
      });
    };
    return this.handler(event, null, callback);
  });

  it('should return NotFound error when S3 cannot find original', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsNotFoundPromiseWrapper());
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'resize/something/50x60-img123',
      },
    };
    const s3Url = 'https://presigned.url.com/path?stuff=things';
    this.s3Stubs.getSignedUrl.returns(s3Url);

    const callback = (error, result) => {
      expect(error).toBeNull();
      expect(result).toEqual({
        statusCode: '404',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorCategory: 'NotFound',
          message: 'Asset not found in bucket example-bucket with key assets/something/img123',
        }),
      });
    };
    return this.handler(event, null, callback);
  });

  it('should return UnsupportedFormat when the content type is invalid', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsPromiseWrapper('application/pdf; foo=bar'));
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'resize/something/50x60-img123',
      },
    };
    const s3Url = 'https://presigned.url.com/path?stuff=things';
    this.s3Stubs.getSignedUrl.returns(s3Url);

    const callback = (error, result) => {
      expect(error).toBeNull();
      expect(result).toEqual({
        statusCode: '400',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorCategory: 'UnsupportedFormat',
          message: 'Supported image formats: jpeg, png, webp, tiff',
        }),
      });
    };
    return this.handler(event, null, callback);
  });

  it('should return UnsupportedFormat when the image type is unsupported', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsPromiseWrapper('image/heic; foo=bar'));
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'resize/something/50x60-img123',
      },
    };
    const s3Url = 'https://presigned.url.com/path?stuff=things';
    this.s3Stubs.getSignedUrl.returns(s3Url);

    const callback = (error, result) => {
      expect(error).toBeNull();
      expect(result).toEqual({
        statusCode: '400',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorCategory: 'UnsupportedFormat',
          message: 'Supported image formats: jpeg, png, webp, tiff',
        }),
      });
    };
    return this.handler(event, null, callback);
  });
});

describe('Image resize function - specific demensions', () => {
  beforeEach(function before() {
    setEnvironment();
    process.env.ALLOWED_DIMENSIONS = '30x40,50x60,20x30';
    patchS3.call(this);
    patchSharp.call(this);
    sinon.stub(console, 'warn'); // makes test output quieter.
    // Now that everything has been patched, the handler can be loaded.
    this.handler = require('../index').handler; // eslint-disable-line global-require
  });

  afterEach(() => {
    resetEnvironment();
    process.env.ALLOWED_DIMENSIONS = undefined;
    resetPatcher();
    console.warn.restore();
    delete require.cache[require.resolve('../index')]; // force re-importing of the code.
  });

  it('should allow valid dimensions', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsPromiseWrapper('image/jpeg; name=something'));
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123',
      },
    };
    const s3Url = 'https://s3-us-west-1.amazonaws.com/example-bucket/resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123?AWSAccessKeyId=key&Expires=12345&Signature=signature';
    this.s3Stubs.getSignedUrl.returns(s3Url);
    const resultUrl = 'https://configurable.url.com/example-bucket/resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123?AWSAccessKeyId=key&Expires=12345&Signature=signature';

    const callback = (error, result) => {
      expect(error).toBeNull();
      expect(result).toEqual({
        statusCode: '201',
        headers: { location: resultUrl },
        body: {
          result: 'Created',
          location: resultUrl,
        },
      });
    };
    return this.handler(event, null, callback);
  });

  it('should return InvalidDimensions error when incorrect', async function test() {
    this.s3Stubs.getObject.returns(makeGetObjectsPromiseWrapper('image/jpeg; name=something'));
    this.s3Stubs.putObject.returns(makeEmptyPromiseWrapper());
    const event = {
      queryStringParameters: {
        key: 'resize/something/1000x2000-img123',
      },
    };
    const s3Url = 'https://presigned.url.com/path?stuff=things';
    this.s3Stubs.getSignedUrl.returns(s3Url);

    const callback = (error, result) => {
      expect(error).toBeNull();
      expect(result).toEqual({
        statusCode: '400',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorCategory: 'InvalidDimensions',
          message: 'Allowed dimensions: 30x40, 50x60, 20x30',
        }),
      });
    };
    return this.handler(event, null, callback);
  });
});
