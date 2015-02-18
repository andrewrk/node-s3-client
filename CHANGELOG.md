### 4.4.0

 * Export aws-sdk dependency
 * Update dependencies
 * Ability to handle symlinks in uploadDir and downloadDir
 * Expose S3 constants
 * Add downloadStream API

### 4.3.1

 * Update dependencies

### 4.3.0

 * fix open file descriptor leak. Thanks
   [Ross Wilson](https://github.com/wilsonwc)
 * add downloadBuffer API
 * uploadDir: add 'fileUploadStart', 'fileUploadEnd' events
 * downloadDir: add 'fileDownloadStart', 'fileDownloadEnd' events
 * update aws-sdk to 2.0.19

### 4.2.0

 * use new AWS SDK API to avoid PassThrough stream workaround
 * update aws-sdk to 2.0.17

### 4.1.1

 * `uploadFile` and `uploadDir` now have optional argument `defaultContentType`.
 * Fixes default Content-Type able to be mutated by third party modules
   changing the global `mime.default_type` variable.

### 4.1.0

 * Content-Type header is now automatically filled out if you do not explicitly
   provide it or set it to `null`.

### 4.0.0

 * support for multipart uploading and downloading. This raises the maximum
   supported file size to the S3 maximum of 5 TB. It also allows this module
   to be used to download files which were uploaded via multipart.
 * `uploadFile` no longer emits 'stream' (possibly multiple times). Instead, it
   emits 'fileOpened' exactly once, and the parameter can be used to create
   read streams.
 * `uploadFile` uses fstat instead of stat. Fixes a possible file system race
   condition.
 * `uploadfile` no longer accepts the `localFileStat` parameter.
 * default `maxAsyncS3` increased from 14 to 20
 * added `multipartUploadThreshold`, `multipartUploadSize`

### 3.1.3

 * `uploadDir` and `downloadDir`: fix incorrectly deleting files
 * update aws-sdk to 2.0.8

### 3.1.2

 * add license
 * update aws-sdk to 2.0.6. Fixes SSL download reliability.

### 3.1.1

 * `uploadDir` handles source directory not existing error correctly

### 3.1.0

 * `uploadFile` computes MD5 and sends bytes at the same time
 * `getPublicUrl` handles `us-east-1` bucket location correctly

### 3.0.2

 * fix upload path on Windows

### 3.0.1

 * Default `maxAsyncS3` setting change from `30` to `14`.
 * Add `Expect: 100-continue` header to downloads.

### 3.0.0

 * `uploadDir` and `downloadDir` completely rewritten with more efficient
   algorithm, which is explained in the documentation.
 * Default `maxAsyncS3` setting changed from `Infinity` to `30`.
 * No longer recommend adding graceful-fs to your app.
 * No longer recommend increasing ulimit for number of open files.
 * Add `followSymlinks` option to `uploadDir` and `downloadDir`
 * `uploadDir` and `downloadDir` support these additional progress properties:
   - `filesFound`
   - `objectsFound`
   - `deleteAmount`
   - `deleteTotal`
   - `doneFindingFiles`
   - `doneFindingObjects`
   - `progressMd5Amount`
   - `progressMd5Total`
   - `doneMd5`

### 2.0.0

 * `getPublicUrl` API changed to support bucket regions. Use `getPublicUrlHttp`
   if you want an insecure URL.

### 1.3.0

 * `downloadFile` respects `maxAsyncS3`
 * Add `copyObject` API
 * AWS JS SDK updated to 2.0.0-rc.18
 * errors with `retryable` set to `false` are not retried
 * Add `moveObject` API
 * `uploadFile` emits a `stream` event.

### 1.2.1

 * fix `listObjects` for greater than 1000 objects
 * `downloadDir` supports `getS3Params` parameter
 * `uploadDir` and `downloadDir` expose `objectsFound` progress

### 1.2.0

 * `uploadDir` accepts `getS3Params` function parameter

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

