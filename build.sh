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

docker build --tag amazonlinux:nodejs .
docker run -e 'NODE_ENV=production' --rm --volume ${PWD}/lambda:/build amazonlinux:nodejs npm install
docker run -v ${PWD}/lambda:/lambda -v ${PWD}/out:/out -w /lambda crazymax/7zip 7za a /out/$COMMIT.zip ./