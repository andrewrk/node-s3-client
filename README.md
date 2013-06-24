Install:
--------
`npm install --save s3`

Usage:
------
```js
// configure
var s3 = require('s3');

// createClient allows any options that knox does.
var client = s3.createClient({
  key: "your s3 key",
  secret: "your s3 secret",
  bucket: "your s3 bucket"
});

// optional headers
var headers = {
  'Content-Type' : 'image/jpg',
  'x-amz-acl'    : 'public-read'
};

// upload a file to s3
var uploader = client.upload("some/local/file", "some/remote/file", headers);
uploader.on('error', function(err) {
  console.error("unable to upload:", err.stack);
});
uploader.on('progress', function(amountDone, amountTotal) {
  console.log("progress", amountDone, amountTotal);
});
uploader.on('end', function(url) {
  console.log("file available at", url);
});

// download a file from s3
var downloader = client.download("some/remote/file", "some/local/file");
downloader.on('error', function(err) {
  console.error("unable to download:", err.stack);
});
downloader.on('progress', function(amountDone, amountTotal) {
  console.log("progress", amountDone, amountTotal);
});
downloader.on('end', function() {
  console.log("done");
});

// instantiate from existing knox client
var knoxClient = knox.createClient(options);
var client = s3.fromKnox(knoxClient);

```

This module uses [knox](https://github.com/LearnBoost/knox) as a backend. If
you want to do more low-level things, use knox for those things. It's ok to use
both.

Testing:
--------
`S3_KEY=<valid_s3_key> S3_SECRET=<valid_s3_secret> S3_BUCKET=<valid_s3_bucket> npm test`
