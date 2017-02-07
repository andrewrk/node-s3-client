# High Level Amazon S3 Client

<div style="margin: 25px;">
<a href="https://rapidapi.com/package/AmazonS3/functions?utm_source=AmazonS3GitHub-Ruby&utm_medium=button&utm_content=Vendor_GitHub" style="
    all: initial;
    background-color: #498FE1;
    border-width: 0;
    border-radius: 5px;
    padding: 10px 20px;
    color: white;
    font-family: 'Helvetica';
    font-size: 12pt;
    background-image: url(https://scdn.rapidapi.com/logo-small.png);
    background-size: 25px;
    background-repeat: no-repeat;
    background-position-y: center;
    background-position-x: 10px;
    padding-left: 44px;
    cursor: pointer;">
  Run now on <b>RapidAPI</b>
</a>
</div>

## Installation

`npm install s3 --save`

## Features

 * Automatically retry a configurable number of times when S3 returns an error.
 * Includes logic to make multiple requests when there is a 1000 object limit.
 * Ability to set a limit on the maximum parallelization of S3 requests.
   Retries get pushed to the end of the parallelization queue.
 * Ability to sync a dir to and from S3.
 * Progress reporting.
 * Supports files of any size (up to S3's maximum 5 TB object size limit).
 * Uploads large files quickly using parallel multipart uploads.
 * Uses heuristics to compute multipart ETags client-side to avoid uploading
   or downloading files unnecessarily.
 * Automatically provide Content-Type for uploads based on file extension.
 * Support third-party S3-compatible platform services like Ceph

See also the companion CLI tool which is meant to be a drop-in replacement for
s3cmd: [s3-cli](https://github.com/andrewrk/node-s3-cli).

## Synopsis

### Create a client

```js
var s3 = require('s3');

var client = s3.createClient({
  maxAsyncS3: 20,     // this is the default
  s3RetryCount: 3,    // this is the default
  s3RetryDelay: 1000, // this is the default
  multipartUploadThreshold: 20971520, // this is the default (20 MB)
  multipartUploadSize: 15728640, // this is the default (15 MB)
  s3Options: {
    accessKeyId: "your s3 key",
    secretAccessKey: "your s3 secret",
    region: "your region",
    // endpoint: 's3.yourdomain.com',
    // sslEnabled: false
    // any other options are passed to new AWS.S3()
    // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
  },
});
```

### Create a client from existing AWS.S3 object

```js
var s3 = require('s3');
var awsS3Client = new AWS.S3(s3Options);
var options = {
  s3Client: awsS3Client,
  // more options available. See API docs below.
};
var client = s3.createClient(options);
```

### Upload a file to S3

```js
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
  console.log("progress", uploader.progressMd5Amount,
            uploader.progressAmount, uploader.progressTotal);
});
uploader.on('end', function() {
  console.log("done uploading");
});
```

### Download a file from S3

```js
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
downloader.on('progress', function() {
  console.log("progress", downloader.progressAmount, downloader.progressTotal);
});
downloader.on('end', function() {
  console.log("done downloading");
});
```

### Sync a directory to S3

```js
var params = {
  localDir: "some/local/dir",
  deleteRemoved: true, // default false, whether to remove s3 objects
                       // that have no corresponding local file.

  s3Params: {
    Bucket: "s3 bucket name",
    Prefix: "some/remote/dir/",
    // other options supported by putObject, except Body and ContentLength.
    // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
  },
};
var uploader = client.uploadDir(params);
uploader.on('error', function(err) {
  console.error("unable to sync:", err.stack);
});
uploader.on('progress', function() {
  console.log("progress", uploader.progressAmount, uploader.progressTotal);
});
uploader.on('end', function() {
  console.log("done uploading");
});
```

## Tips

 * Consider increasing the socket pool size in the `http` and `https` global
   agents. This will improve bandwidth when using `uploadDir` and `downloadDir`
   functions. For example:

   ```js
   http.globalAgent.maxSockets = https.globalAgent.maxSockets = 20;
   ```

## API Documentation

### s3.AWS

This contains a reference to the aws-sdk module. It is a valid use case to use
both this module and the lower level aws-sdk module in tandem.

### s3.createClient(options)

Creates an S3 client.

`options`:

 * `s3Client` - optional, an instance of `AWS.S3`. Leave blank if you provide `s3Options`.
 * `s3Options` - optional. leave blank if you provide `s3Client`.
   - See AWS SDK documentation for available options which are passed to `new AWS.S3()`:
     http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
 * `maxAsyncS3` - maximum number of simultaneous requests this client will
   ever have open to S3. defaults to `20`.
 * `s3RetryCount` - how many times to try an S3 operation before giving up.
   Default 3.
 * `s3RetryDelay` - how many milliseconds to wait before retrying an S3
   operation. Default 1000.
 * `multipartUploadThreshold` - if a file is this many bytes or greater, it
   will be uploaded via a multipart request. Default is 20MB. Minimum is 5MB.
   Maximum is 5GB.
 * `multipartUploadSize` - when uploading via multipart, this is the part size.
   The minimum size is 5MB. The maximum size is 5GB. Default is 15MB. Note that
   S3 has a maximum of 10000 parts for a multipart upload, so if this value is
   too small, it will be ignored in favor of the minimum necessary value
   required to upload the file.

### s3.getPublicUrl(bucket, key, [bucketLocation])

 * `bucket` S3 bucket
 * `key` S3 key
 * `bucketLocation` string, one of these:
   - "" (default) - US Standard
   - "eu-west-1"
   - "us-west-1"
   - "us-west-2"
   - "ap-southeast-1"
   - "ap-southeast-2"
   - "ap-northeast-1"
   - "sa-east-1"

You can find out your bucket location programatically by using this API:
http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getBucketLocation-property

returns a string which looks like this:

`https://s3.amazonaws.com/bucket/key`

or maybe this if you are not in US Standard:

`https://s3-eu-west-1.amazonaws.com/bucket/key`

### s3.getPublicUrlHttp(bucket, key)

 * `bucket` S3 Bucket
 * `key` S3 Key

Works for any region, and returns a string which looks like this:

`http://bucket.s3.amazonaws.com/key`

### client.uploadFile(params)

See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property

`params`:

 * `s3Params`: params to pass to AWS SDK `putObject`.
 * `localFile`: path to the file on disk you want to upload to S3.
 * (optional) `defaultContentType`: Unless you explicitly set the `ContentType`
   parameter in `s3Params`, it will be automatically set for you based on the
   file extension of `localFile`. If the extension is unrecognized,
   `defaultContentType` will be used instead. Defaults to
   `application/octet-stream`.

The difference between using AWS SDK `putObject` and this one:

 * This works with files, not streams or buffers.
 * If the reported MD5 upon upload completion does not match, it retries.
 * If the file size is large enough, uses multipart upload to upload parts in
   parallel.
 * Retry based on the client's retry settings.
 * Progress reporting.
 * Sets the `ContentType` based on file extension if you do not provide it.

Returns an `EventEmitter` with these properties:

 * `progressMd5Amount`
 * `progressAmount`
 * `progressTotal`

And these events:

 * `'error' (err)`
 * `'end' (data)` - emitted when the file is uploaded successfully
   - `data` is the same object that you get from `putObject` in AWS SDK
 * `'progress'` - emitted when `progressMd5Amount`, `progressAmount`, and
   `progressTotal` properties change. Note that it is possible for progress to
   go backwards when an upload fails and must be retried.
 * `'fileOpened' (fdSlicer)` - emitted when `localFile` has been opened. The file
   is opened with the [fd-slicer](https://github.com/andrewrk/node-fd-slicer)
   module because we might need to read from multiple locations in the file at
   the same time. `fdSlicer` is an object for which you can call
   `createReadStream(options)`. See the fd-slicer README for more information.
 * `'fileClosed'` - emitted when `localFile` has been closed.

And these methods:

 * `abort()` - call this to stop the find operation.

### client.downloadFile(params)

See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getObject-property

`params`:

 * `localFile` - the destination path on disk to write the s3 object into
 * `s3Params`: params to pass to AWS SDK `getObject`.

The difference between using AWS SDK `getObject` and this one:

 * This works with a destination file, not a stream or a buffer.
 * If the reported MD5 upon download completion does not match, it retries.
 * Retry based on the client's retry settings.
 * Progress reporting.

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `progressTotal`

And these events:

 * `'error' (err)`
 * `'end'` - emitted when the file is downloaded successfully
 * `'progress'` - emitted when `progressAmount` and `progressTotal`
   properties change.

### client.downloadBuffer(s3Params)

http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getObject-property

 * `s3Params`: params to pass to AWS SDK `getObject`.

The difference between using AWS SDK `getObject` and this one:

 * This works with a buffer only.
 * If the reported MD5 upon download completion does not match, it retries.
 * Retry based on the client's retry settings.
 * Progress reporting.

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `progressTotal`

And these events:

 * `'error' (err)`
 * `'end' (buffer)` - emitted when the file is downloaded successfully.
   `buffer` is a `Buffer` containing the object data.
 * `'progress'` - emitted when `progressAmount` and `progressTotal`
   properties change.

### client.downloadStream(s3Params)

http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getObject-property

 * `s3Params`: params to pass to AWS SDK `getObject`.

The difference between using AWS SDK `getObject` and this one:

 * This works with a stream only.

If you want retries, progress, or MD5 checking, you must code it yourself.

Returns a `ReadableStream` with these additional events:

 * `'httpHeaders' (statusCode, headers)` - contains the HTTP response
   headers and status code.

### client.listObjects(params)

See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#listObjects-property

`params`:

 * `s3Params` - params to pass to AWS SDK `listObjects`.
 * (optional) `recursive` - `true` or `false` whether or not you want to recurse
   into directories. Default `false`.

Note that if you set `Delimiter` in `s3Params` then you will get a list of
objects and folders in the directory you specify. You probably do not want to
set `recursive` to `true` at the same time as specifying a `Delimiter` because
this will cause a request per directory. If you want all objects that share a
prefix, leave the `Delimiter` option `null` or `undefined`.

Be sure that `s3Params.Prefix` ends with a trailing slash (`/`) unless you
are requesting the top-level listing, in which case `s3Params.Prefix` should
be empty string.

The difference between using AWS SDK `listObjects` and this one:

 * Retries based on the client's retry settings.
 * Supports recursive directory listing.
 * Makes multiple requests if the number of objects to list is greater than 1000.

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `objectsFound`
 * `dirsFound`

And these events:

 * `'error' (err)`
 * `'end'` - emitted when done listing and no more 'data' events will be emitted.
 * `'data' (data)` - emitted when a batch of objects are found. This is
   the same as the `data` object in AWS SDK.
 * `'progress'` - emitted when `progressAmount`, `objectsFound`, and
   `dirsFound` properties change.

And these methods:

 * `abort()` - call this to stop the find operation.

### client.deleteObjects(s3Params)

See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#deleteObjects-property

`s3Params` are the same.

The difference between using AWS SDK `deleteObjects` and this one:

 * Retry based on the client's retry settings.
 * Make multiple requests if the number of objects you want to delete is
   greater than 1000.

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `progressTotal`

And these events:

 * `'error' (err)`
 * `'end'` - emitted when all objects are deleted.
 * `'progress'` - emitted when the `progressAmount` or `progressTotal` properties change.
 * `'data' (data)` - emitted when a request completes. There may be more.

### client.uploadDir(params)

Syncs an entire directory to S3.

`params`:

 * `localDir` - source path on local file system to sync to S3
 * `s3Params`
   - `Prefix` (required)
   - `Bucket` (required)
 * (optional) `deleteRemoved` - delete s3 objects with no corresponding local file.
   default false
 * (optional) `getS3Params` - function which will be called for every file that
   needs to be uploaded. You can use this to skip some files. See below.
 * (optional) `defaultContentType`: Unless you explicitly set the `ContentType`
   parameter in `s3Params`, it will be automatically set for you based on the
   file extension of `localFile`. If the extension is unrecognized,
   `defaultContentType` will be used instead. Defaults to
   `application/octet-stream`.
 * (optional) `followSymlinks` - Set this to `false` to ignore symlinks.
   Defaults to `true`.

```js
function getS3Params(localFile, stat, callback) {
  // call callback like this:
  var err = new Error(...); // only if there is an error
  var s3Params = { // if there is no error
    ContentType: getMimeType(localFile), // just an example
  };
  // pass `null` for `s3Params` if you want to skip uploading this file.
  callback(err, s3Params);
}
```

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `progressTotal`
 * `progressMd5Amount`
 * `progressMd5Total`
 * `deleteAmount`
 * `deleteTotal`
 * `filesFound`
 * `objectsFound`
 * `doneFindingFiles`
 * `doneFindingObjects`
 * `doneMd5`

And these events:

 * `'error' (err)`
 * `'end'` - emitted when all files are uploaded
 * `'progress'` - emitted when any of the above progress properties change.
 * `'fileUploadStart' (localFilePath, s3Key)` - emitted when a file begins
   uploading.
 * `'fileUploadEnd' (localFilePath, s3Key)` - emitted when a file successfully
   finishes uploading.

`uploadDir` works like this:

 0. Start listing all S3 objects for the target `Prefix`. S3 guarantees
    returned objects to be in sorted order.
 0. Meanwhile, recursively find all files in `localDir`.
 0. Once all local files are found, we sort them (the same way that S3 sorts).
 0. Next we iterate over the sorted local file list one at a time, computing
    MD5 sums.
 0. Now S3 object listing and MD5 sum computing are happening in parallel. As
    each operation progresses we compare both sorted lists side-by-side,
    iterating over them one at a time, uploading files whose MD5 sums don't
    match the remote object (or the remote object is missing), and, if
    `deleteRemoved` is set, deleting remote objects whose corresponding local
    files are missing.

### client.downloadDir(params)

Syncs an entire directory from S3.

`params`:

 * `localDir` - destination directory on local file system to sync to
 * `s3Params`
   - `Prefix` (required)
   - `Bucket` (required)
 * (optional) `deleteRemoved` - delete local files with no corresponding s3 object. default `false`
 * (optional) `getS3Params` - function which will be called for every object that
   needs to be downloaded. You can use this to skip downloading some objects.
   See below.
 * (optional) `followSymlinks` - Set this to `false` to ignore symlinks.
   Defaults to `true`.

```js
function getS3Params(localFile, s3Object, callback) {
  // localFile is the destination path where the object will be written to
  // s3Object is same as one element in the `Contents` array from here:
  // http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#listObjects-property

  // call callback like this:
  var err = new Error(...); // only if there is an error
  var s3Params = { // if there is no error
    VersionId: "abcd", // just an example
  };
  // pass `null` for `s3Params` if you want to skip downloading this object.
  callback(err, s3Params);
}
```

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `progressTotal`
 * `progressMd5Amount`
 * `progressMd5Total`
 * `deleteAmount`
 * `deleteTotal`
 * `filesFound`
 * `objectsFound`
 * `doneFindingFiles`
 * `doneFindingObjects`
 * `doneMd5`

And these events:

 * `'error' (err)`
 * `'end'` - emitted when all files are downloaded
 * `'progress'` - emitted when any of the progress properties above change
 * `'fileDownloadStart' (localFilePath, s3Key)` - emitted when a file begins
   downloading.
 * `'fileDownloadEnd' (localFilePath, s3Key)` - emitted when a file successfully
   finishes downloading.

`downloadDir` works like this:

 0. Start listing all S3 objects for the target `Prefix`. S3 guarantees
    returned objects to be in sorted order.
 0. Meanwhile, recursively find all files in `localDir`.
 0. Once all local files are found, we sort them (the same way that S3 sorts).
 0. Next we iterate over the sorted local file list one at a time, computing
    MD5 sums.
 0. Now S3 object listing and MD5 sum computing are happening in parallel. As
    each operation progresses we compare both sorted lists side-by-side,
    iterating over them one at a time, downloading objects whose MD5 sums don't
    match the local file (or the local file is missing), and, if
    `deleteRemoved` is set, deleting local files whose corresponding objects
    are missing.

### client.deleteDir(s3Params)

Deletes an entire directory on S3.

`s3Params`:

 * `Bucket`
 * `Prefix`
 * (optional) `MFA`

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `progressTotal`

And these events:

 * `'error' (err)`
 * `'end'` - emitted when all objects are deleted.
 * `'progress'` - emitted when the `progressAmount` or `progressTotal` properties change.

`deleteDir` works like this:

 0. Start listing all objects in a bucket recursively. S3 returns 1000 objects
    per response.
 0. For each response that comes back with a list of objects in the bucket,
    immediately send a delete request for all of them.

### client.copyObject(s3Params)

See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property

`s3Params` are the same. Don't forget that `CopySource` must contain the
source bucket name as well as the source key name.

The difference between using AWS SDK `copyObject` and this one:

 * Retry based on the client's retry settings.

Returns an `EventEmitter` with these events:

 * `'error' (err)`
 * `'end' (data)`

### client.moveObject(s3Params)

See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property

`s3Params` are the same. Don't forget that `CopySource` must contain the
source bucket name as well as the source key name.

Under the hood, this uses `copyObject` and then `deleteObjects` only if the
copy succeeded.

Returns an `EventEmitter` with these events:

 * `'error' (err)`
 * `'copySuccess' (data)`
 * `'end' (data)`

## Examples

### Check if a file exists in S3

Using the AWS SDK, you can send a HEAD request, which will tell you if a file exists at `Key`.

See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#headObject-property

```js
var client = require('s3').createClient({ /* options */ });
client.s3.headObject({
  Bucket: 's3 bucket name',
  Key: 'some/remote/file'
}, function(err, data) {
  if (err) {
    // file does not exist (err.statusCode == 404)
    return;
  }
  // file exists
});
```

## Testing

`S3_KEY=<valid_s3_key> S3_SECRET=<valid_s3_secret> S3_BUCKET=<valid_s3_bucket> npm test`

Tests upload and download large amounts of data to and from S3. The test
timeout is set to 40 seconds because Internet connectivity waries wildly.
