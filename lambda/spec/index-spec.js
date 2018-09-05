/* eslint-env node, jasmine */

'use strict';

const patcher = require('mock-require');
const sinon = require('sinon');


describe('The image resize function', () => {
  beforeEach(() => {
    process.env.BUCKET = 'example-bucket';
    process.env.URL = 'https://s3-example.amazonaws.com/example-bucket';

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

    getObjectStub.returns({ promise: () => getObjectsPromise });
    putObjectStub.returns({ promise: () => putObjectsPromise });

    function s3Constructor() {
      return {
        getObject: getObjectStub,
        putObject: putObjectStub,
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
    delete process.env.URL;
    delete process.env.BUCKET;
    patcher.stop('aws-sdk');
    patcher.stop('sharp');
  });

  it('should calculate the correct URL', () => {
    const event = {
      queryStringParameters: {
        key: 'resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123',
      },
    };
    const resultUrl = 'https://s3-example.amazonaws.com/example-bucket/resize/75c06d3b-4342-4ab8-aa37-b1f01d654ac1/private/avatar/50x60-img123';

    function callback(error, result) {
      expect(error).toBe(null);
      expect(result).toEqual({
        statusCode: '301',
        headers: { location: resultUrl },
        body: '',
      });
    }
    this.handler(event, null, callback);
  });
});
