#!/bin/bash
COMMIT=$1

if [ "$COMMIT" = "" ]
then
    echo "must supply commit hash"
    exit 1
fi

aws ecr get-login | sed "s/ -e .* https/ https/" | bash
if [ "$?" != "0" ]
then
  echo "ecr login failed"
  exit 1
fi

docker run -v "${PWD}/out":/app -w /app --entrypoint aws 866893681515.dkr.ecr.us-west-1.amazonaws.com/tools/terraform s3 cp "$COMMIT.zip" "s3://sdc-services-lambda/customer-asset/image-resizing/$COMMIT.zip"
