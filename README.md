# Serverless Image Resizing

## Description

Resizes images on the fly using Amazon S3, AWS Lambda, and Amazon API Gateway.
Using a conventional URL structure and S3 static website hosting with
redirection rules, requests for resized images are redirected to a Lambda
function via API Gateway which will resize the image, upload it to S3, and
redirect the requestor to the resized image. The next request for the resized
image will be served from S3 directly.

## Usage

1. Build the Lambda function

   The Lambda function uses [sharp][sharp] for image resizing which requires
   native extensions. In order to run on Lambda, it must be packaged on Amazon
   Linux. You can accomplish this in one of two ways:

   - Upload the contents of the `lambda` subdirectory to an [Amazon EC2 instance
     running Amazon Linux][amazon-linux] and run `npm install`, or

   - Use the Amazon Linux Docker container image to build the package using your
     local system. This repo includes Makefile that will download Amazon Linux,
     install Node.js and developer tools, and build the extensions using Docker.
     Run `make dist`.

2. See the repo that this was forked from for an example CloudFormation deployment.

3. Manually upload the dist/function.zip file to Lambda. TODO: Automate this!

4. (Optional) Restrict resize dimensions

    To restrict the dimensions the function will create, set the environment
    variable `ALLOWED_DIMENSIONS` to a string in the format
    *(HEIGHT)x(WIDTH),(HEIGHT)x(WIDTH),...*.

    For example: *300x300,90x90,40x40*.

## Development

1. `cd lambda` then `npm install`
2. All of the code is in `index.js` and tests are in the `spec` directory.
3. Lint the with `npm run lint`. (Uses the airbnb style guide, standard for SDC).
4. Run tests with `npm test`

## License

This reference architecture sample is [licensed][license] under Apache 2.0.

[license]: LICENSE
[sharp]: https://github.com/lovell/sharp
[amazon-linux]: https://aws.amazon.com/blogs/compute/nodejs-packages-in-lambda/
[cli]: https://aws.amazon.com/cli/
