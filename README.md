# High Level Amazon S3 Client

## Features and Limitations

 * Automatically retry a configurable number of times when S3 returns an error.
 * Includes logic to make multiple requests when there is a 1000 object limit.
 * Ability to set a limit on the maximum parallelization of S3 requests.
   Retries get pushed to the end of the paralellization queue.
 * Ability to sync a dir to and from S3.
 * Progress reporting.
 * Limited to files less than 5GB.
 * Limited to objects which were not uploaded using a multipart request.

See also the companion CLI tool, [s3-cli](https://github.com/andrewrk/node-s3-cli).

## Synopsis

### Create a client

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
```

### Create a client from existing AWS.S3 object

```js
var s3 = require('s3');
var awsS3Client = new AWS.S3(s3Options);
var options = {
  s3Client: awsS3Client,
};
var client = s3.fromAwsSdkS3(options);
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

## API Documentation

### s3.createClient(options)

Creates an S3 client.

`options`:

 * `s3Client` - optional, an instance of `AWS.S3`. Leave blank if you provide `s3Options`.
 * `s3Options` - optional, provide this if you don't provide `s3Client`.
   - See AWS SDK documentation for available options which are passed to `new AWS.S3()`:
     http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
 * `maxAsyncS3` - maximum number of simultaneous requests this client will
   ever have open to S3. defaults to `Infinity`.
 * `s3RetryCount` - how many times to try an S3 operation before giving up.
 * `s3RetryDelay` - how many milliseconds to wait before retrying an S3 operation.

### s3.getPublicUrl(bucket, key, [insecure])

 * `bucket` S3 bucket
 * `key` S3 key
 * `insecure` boolean, whether to use http or https. defaults to false.

returns a string which looks like this:

`https://s3.amazonaws.com/bucket/key`

### client.uploadFile(params)

See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property

`params`:

 * `s3Params`: params to pass to AWS SDK `putObject`.
 * `localFile`: path to the file on disk you want to upload to S3.
 * `localFileStat`: optional - if you happen to have the stat object from
   `fs.stat` and the md5sum of the file, you can provide it here. Otherwise it
   will be computed for you.

The difference between using AWS SDK `putObject` and this one:

 * This works with files, not streams or buffers.
 * If the reported MD5 upon upload completion does not match, it retries.
 * Retry based on the client's retry settings.
 * Progress reporting.

Returns an `EventEmitter` with these properties:

 * `progressMd5Amount`
 * `progressAmount`
 * `progressTotal`

And these events:

 * `'error' (err)`
 * `'end' (data)` - emitted when the file is uploaded successfully
   - `data` is the same object that you get from `putObject` in AWS SDK
 * `'progress'` - emitted when `progressMd5Amount`, `progressAmount`, and
   `progressTotal` properties change.

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
 * `'end'` - emitted when the file is uploaded successfully
 * `'progress'` - emitted when `progressAmount` and `progressTotal`
   properties change.

### client.listObjects(params)

See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#listObjects-property

`params`:

 * `recursive` - `true` or `false` whether or not you want to recurse
   into directories.
 * `s3Params` - params to pass to AWS SDK `listObjects`.

Note that if you set `Delimiter` in `s3Params` then you will get a list of
objects and folders in the directory you specify. You probably do not want to
set `recursive` to `true` at the same time as specifying a `Delimiter` because
this will cause a request per directory. If you want all objects that share a
prefix, leave the `Delimiter` option `null` or `undefined`.

Be sure that `s3Params.Prefix` ends with a trailing slash (`/`) unless you
are requesting the top-level listing, in which case `s3Params.Prefix` should
be empty string.

The difference between using AWS SDK `listObjects` and this one:

 * Retry based on the client's retry settings.
 * Supports recursive directory listing.
 * Make multiple requests if the number of objects to list is greater than 1000.

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

The difference between using AWS SDK `deleteObjects` and this one is that this one will:

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

 * `deleteRemoved` - delete s3 objects with no corresponding local file. default false
 * `localDir` - source path on local file system to sync to S3
 * `s3Params`
   - `Prefix` (required)
   - `Bucket` (required)

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `progressTotal`

And these events:

 * `'error' (err)`
 * `'end'` - emitted when all files are uploaded
 * `'progress'` - emitted when the `progressAmount` or `progressTotal` properties change.

### client.downloadDir(params)

Syncs an entire directory from S3.

`params`:

 * `deleteRemoved` - delete local files with no corresponding s3 object. default `false`
 * `localDir` - destination directory on local file system to sync to
 * `s3Params`
   - `Prefix` (required)
   - `Bucket` (required)

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `progressTotal`

And these events:

 * `'error' (err)`
 * `'end'` - emitted when all files are uploaded
 * `'progress'` - emitted when the `progressAmount` or `progressTotal` properties change.

### client.deleteDir(s3Params)

Deletes an entire directory on S3.

`s3Params`:

 * `Bucket`
 * `Prefix`
 * `MFA` (optional)

Returns an `EventEmitter` with these properties:

 * `progressAmount`
 * `progressTotal`

And these events:

 * `'error' (err)`
 * `'end'` - emitted when all objects are deleted.
 * `'progress'` - emitted when the `progressAmount` or `progressTotal` properties change.

## Testing

`S3_KEY=<valid_s3_key> S3_SECRET=<valid_s3_secret> S3_BUCKET=<valid_s3_bucket> npm test`

## History

### 1.1.1

 * fix handling of directory seperator in Windows
 * allow `uploadDir` and `downloadDir` with empty `Prefix`

### 1.1.0

 * Add an API function to get the HTTP url to an S3 resource

### 1.0.0

 * complete module rewrite
 * depend on official AWS SDK instead of knox
 * support `uploadDir`, `downloadDir`, `listObjects`, `deleteObject`, and `deleteDir`

### 0.3.1

 * fix `resp.req.url` sometimes not defined causing crash
 * fix emitting `end` event before write completely finished
