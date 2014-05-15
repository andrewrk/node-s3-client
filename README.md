# High Level Amazon S3 Client

## Features and Limitations

 * Automatically retry a configurable number of times when S3 returns an error.
 * Includes logic to make multiple requests when there is a 1000 object limit.
 * Ability to set a limit on the maximum parallelization of S3 requests.
   Retries get pushed to the end of the paralellization queue.
 * Ability to sync a dir to and from S3.
 * Limited to files less than 5GB.
 * Progress reporting.

## Usage

```js
var s3 = require('s3');

var client = s3.createClient({
  maxAsyncS3: Infinity,
  s3RetryCount: 3,
  s3RetryDelay: 1000,
  s3Options: {
    accessKeyId: "your s3 key",
    secretAccessKey: "your s3 secret",
    // any other options are passed to new AWS.S3()
    // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
  },
});

// upload a file to s3
var params = {
  localFile: "some/local/file",

  s3Params: {
    Bucket: "s3 bucket name",
    Key: "some/remote/file",
    // other options supported by putObject, except Body and ContentLength.
    // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
  },
};
var uploader = client.uploadFile(params);
uploader.on('error', function(err) {
  console.error("unable to upload:", err.stack);
});
uploader.on('progress', function() {
  console.log("progress", uploader.progressMd5Amount, uploader.progressUploadAmount, uploader.progressTotal);
});
uploader.on('end', function() {
  console.log("done uploading");
});

// download a file from s3
var params = {
  localFile: "some/local/file",

  s3Params: {
    Bucket: "s3 bucket name",
    Key: "some/remote/file",
    // other options supported by getObject
    // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getObject-property
  },
};
var downloader = client.downloadFile(params);
downloader.on('error', function(err) {
  console.error("unable to download:", err.stack);
});
downloader.on('end', function() {
  console.log("done downloading");
});

// sync a directory to S3
var params = {
  localDir: "some/local/dir",
  deleteRemoved: true, // default false, whether to remove s3 objects
                       // that have no corresponding local file.

  s3Params: {
    Bucket: "s3 bucket name",
    Key: "some/remote/dir",
    // other options supported by putObject, except Body and ContentLength.
    // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
  },
};
var uploader = client.uploadDir(params);
uploader.on('error', function(err) {
  console.error("unable to sync:", err.stack);
});
uploader.on('end', function() {
  console.log("done uploading");
});


// instantiate from existing AWS.S3 object:
var awsS3Client = new AWS.S3(s3Options);
var options = {
  s3Client: awsS3Client,
};
var client = s3.fromAwsSdkS3(options);
```

## Testing

`S3_KEY=<valid_s3_key> S3_SECRET=<valid_s3_secret> S3_BUCKET=<valid_s3_bucket> npm test`

## History

### 0.3.1

 * fix `resp.req.url` sometimes not defined causing crash
 * fix emitting `end` event before write completely finished
