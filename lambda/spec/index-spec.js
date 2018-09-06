/* eslint-env node, jasmine */

'use strict';

const patcher = require('mock-require');
const sinon = require('sinon');

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
  sharpStub.returns(sharpFuncStubs);
  patcher('sharp', sharpStub);
}


// Test descriptions, setup, teardown, and actual tests.
describe('The image resize function', () => {
  beforeEach(() => {
    setEnvironment();
    patchS3.call(this);
    patchSharp.call(this);
    // Now that everything has been patched, the handler can be loaded.
    this.handler = require('../index').handler; // eslint-disable-line global-require
  });

  afterEach(() => {
    resetEnvironment();
    resetPatcher();
  });

  it('should calculate the correct URL', () => {
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

    function callback(error, result) {
      expect(error).toBe(null);
      expect(result).toEqual({
        statusCode: '303',
        headers: { location: resultUrl },
        body: '',
      });
    }
    this.handler(event, null, callback);
  });
});
