Install:
--------
`npm install --save s3_`

There is an underscore because [someone is squatting](https://npmjs.org/package/s3)
on the 's3' package name. I'm pretty sure this is going to get transferred to this
project within a couple weeks. - Nov 24 2012

Usage:
------
```js
// configure
var s3 = require('s3_');
var client = s3.createClient({
  key: "your s3 key",
  secret: "your s3 secret",
  bucket: "your s3 bucket"
});
// createClient allows any options that knox does.

// upload a file to s3
var uploader = client.upload("some/local/file", "some/remote/file");
uploader.on('error', function(err) {
  console.error("unable to upload:", err.stack);
});
uploader.on('progress', function(amountDone, amountTotal) {
  console.log("progress", amountDone, amountTotal);
});
uploader.on('end', function() {
  console.log("done");
});

// download a file from s3
var downloader = client.download("some/remote/file", "some/local/file");
downloader.on('error', function(err) {
  console.error("unable to upload:", err.stack);
});
downloader.on('progress', function(amountDone, amountTotal) {
  console.log("progress", amountDone, amountTotal);
});
downloader.on('end', function() {
  console.log("done");
});

// get access to the underlying knox client
var knoxClient = s3.createClient(options).knox;
```

This module uses [knox](https://github.com/LearnBoost/knox) as a backend. If
you want to do more low-level things, use knox for those things. It's ok to use
both.

Testing:
--------
`S3_KEY=<valid_s3_key> S3_SECRET=<valid_s3_secret> S3_BUCKET=<valid_s3_bucket> npm test`
