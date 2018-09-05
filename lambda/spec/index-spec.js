/* eslint-env node, jasmine */

'use strict';

const patcher = require('mock-require');
const sinon = require('sinon');


describe('The image resize function', () => {
  beforeEach(() => {
    process.env.BUCKET = 'example-bucket';
    process.env.REDIRECT_BASE_URL = 'https://configurable.url.com';
    process.env.PRESIGNED_EXPIRATION_SECONDS = '30';

    const getObjectsPromise = new Promise((resolve) => {
      resolve({
        Metadata: { example: 'value' },
        Body: 'original image data',
        ContentType: 'image/jpeg',
      });
    });

    const putObjectsPromise = new Promise((resolve) => {
      resolve({});
    });

    const getObjectStub = sinon.stub();
    const putObjectStub = sinon.stub();
    const getSignedUrlStub = sinon.stub();
    this.getSignedUrlStub = getSignedUrlStub; // return value set in test

    getObjectStub.returns({ promise: () => getObjectsPromise });
    putObjectStub.returns({ promise: () => putObjectsPromise });

    function s3Constructor() {
      return {
        getObject: getObjectStub,
        putObject: putObjectStub,
        getSignedUrl: getSignedUrlStub,
      };
    }
    patcher('aws-sdk', { S3: s3Constructor });

    const sharpFunctionStubs = {
      resize: sinon.stub(),
      toFormat: sinon.stub(),
      toBuffer: sinon.stub(),
    };

    sharpFunctionStubs.resize.returns(sharpFunctionStubs);
    sharpFunctionStubs.toFormat.returns(sharpFunctionStubs);

    const sharpBufferPromise = new Promise((resolve) => {
      resolve('resized image data');
    });

    sharpFunctionStubs.toBuffer.returns(sharpBufferPromise);

    const sharpStub = sinon.stub();
    sharpStub.returns(sharpFunctionStubs);
    patcher('sharp', sharpStub);

    // The index handler needs to be required after the patchers.
    this.handler = require('../index').handler; // eslint-disable-line global-require
  });

  afterEach(() => {
    process.env.BUCKET = undefined;
    process.env.REDIRECT_BASE_URL = undefined;
    process.env.PRESIGNED_EXPIRATION_SECONDS = undefined;
    patcher.stop('aws-sdk');
    patcher.stop('sharp');
  });

  it('should calculate the correct URL', () => {
    const event = {
      queryStringParameters: {
        key: 'resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123',
      },
    };
    const s3Url = 'https://s3-us-west-1.amazonaws.com/example-bucket/resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123?AWSAccessKeyId=key&Expires=12345&Signature=signature';
    this.getSignedUrlStub.returns(s3Url);
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
