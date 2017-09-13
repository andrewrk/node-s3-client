declare module 's3' {
  import * as S3 from 'aws-sdk/clients/s3';
  import { EventEmitter } from 'events';
  import * as fs from 'fs';

  interface CreateClientOptions {
    /**
     * optional, an instance of AWS.S3. Leave blank if you provide s3Options.
     */
    s3Client?: S3;

    /**
     * optional. leave blank if you provide s3Client.
     See AWS SDK documentation for available options which are passed to new AWS.S3():
     http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
     */
    s3Options?: S3.ClientConfiguration;

    /**
     * maximum number of simultaneous requests this client will ever have open to S3.
     * defaults to 20.
     */
    maxAsyncS3?: number;

    /**
     * how many times to try an S3 operation before giving up. Default 3.
     */
    s3RetryCount?: number;

    /**
     * how many milliseconds to wait before retrying an S3 operation. Default 1000.
     */
    s3RetryDelay?: number;

    /**
     * if a file is this many bytes or greater, it will be uploaded via a multipart request.
     * Default is 20MB. Minimum is 5MB. Maximum is 5GB.
     */
    multipartUploadThreshold?: number;

    /**
     * when uploading via multipart, this is the part size. The minimum size is 5MB. The maximum
     * size is 5GB. Default is 15MB. Note that S3 has a maximum of 10000 parts for a multipart
     * upload, so if this value is too small, it will be ignored in favor of the minimum necessary
     * value required to upload the file.
     */
    multipartUploadSize?: number;
  }

  interface UploadFileParams {
    /**
     * params to pass to AWS SDK putObject.
     */
    s3Params: S3.Types.PutObjectRequest;

    /**
     * path to the file on disk you want to upload to S3.
     */
    localFile: string;

    /**
     * Unless you explicitly set the ContentType parameter in s3Params, it will be automatically
     * set for you based on the file extension of localFile. If the extension is unrecognized,
     * defaultContentType will be used instead. Defaults to application/octet-stream.
     */
    defaultContentType?: string;
  }

  /**
   * Supplies these events:
   * 'error' (err)
   * 'end' (data) - emitted when the file is uploaded successfully.
   *   data is the same object that you get from putObject in AWS SDK
   * 'progress' - emitted when progressMd5Amount, progressAmount, and progressTotal properties
   * change. Note that it is possible for progress to go backwards when an upload fails and must
   * be retried.
   * 'fileOpened' (fdSlicer) - emitted when localFile has been opened. The file is opened with the
   * fd-slicer module because we might need to read from multiple locations in the file at the same
   * time. fdSlicer is an object for which you can call createReadStream(options). See the
   * fd-slicer README for more information.
   * 'fileClosed' - emitted when localFile has been closed.
   */
  interface UploadFileEventEmitter extends EventEmitter {
    progressMd5Amount: number;
    progressAmount: number;
    progressTotal: number;

    /**
     * call this to stop the find operation.
     */
    abort(): void;
  }

  interface DownloadFileParams {
    /**
     * the destination path on disk to write the s3 object into
     */
    localFile: string;

    /**
     * params to pass to AWS SDK getObject.
     */
    s3Params: S3.Types.GetObjectRequest;
  }

  /**
   * Supplies these events:
   * 'error' (err)
   * 'end' - emitted when the file is downloaded successfully
   * 'progress' - emitted when progressAmount and progressTotal properties change.
   */
  interface DownloadFileEventEmitter extends EventEmitter {
    progressAmount: number;
    progressTotal: number;
  }

  /**
   * Supplies these events:
   * 'error' (err)
   * 'end' (buffer) - emitted when the file is downloaded successfully. buffer is a Buffer
   * containing the object data.
   * 'progress' - emitted when progressAmount and progressTotal properties change.
   */
  interface DownloadBufferEventEmitter extends EventEmitter {
    progressAmount: number;
    progressTotal: number;
  }

  /**
   * Supplied these events:
   * 'httpHeaders' (statusCode, headers) - contains the HTTP response headers and status code.
   */
  interface DownloadStreamReadableStream extends ReadableStream {}

  /**
   * Note that if you set Delimiter in s3Params then you will get a list of objects and folders
   * in the directory you specify. You probably do not want to set recursive to true at the same
   * time as specifying a Delimiter because this will cause a request per directory. If you want
   * all objects that share a prefix, leave the Delimiter option null or undefined.
   * Be sure that s3Params.Prefix ends with a trailing slash (/) unless you are requesting the
   * top-level listing, in which case s3Params.Prefix should be empty string.
   * he difference between using AWS SDK listObjects and this one:
   * Retries based on the client's retry settings.
   * Supports recursive directory listing.
   */
  interface ListObjectsParams {
    /**
     * params to pass to AWS SDK listObjects.
     */
    s3Params: S3.Types.ListObjectsRequest;

    /**
     * true or false whether or not you want to recurse into directories. Default false.
     */
    recursive?: boolean;
  }

  /**
   * Supplies these events:
   * 'error' (err)
   * 'end' - emitted when done listing and no more 'data' events will be emitted.
   * 'data' (data) - emitted when a batch of objects are found. This is the same as the data object
   * in AWS SDK.
   * 'progress' - emitted when progressAmount, objectsFound, and dirsFound properties change.
   */
  interface ListObjectsEventEmitter extends EventEmitter {
    progressAmount: number;
    objectsFound: number;
    dirsFound: number;

    /**
     * call this to stop the find operation.
     */
    abort(): void;
  }

  /**
   * Supplies these events:
   * 'error' (err)
   * 'end' - emitted when all objects are deleted.
   * 'progress' - emitted when the progressAmount or progressTotal properties change.
   * 'data' (data) - emitted when a request completes. There may be more.
   */
  interface DeleteObjectsEventEmitter extends EventEmitter {
    progressAmount: number;
    progressTotal: number;
  }

  /**
   *
   */
  interface SyncDirParams {
    /**
     * source path on local file system to sync to S3
     */
    localDir: string;

    s3Params: {
      Prefix: string,
      Bucket: string,
    };

    /**
     * delete s3 objects with no corresponding local file. default false
     */
    deleteRemoved?: boolean;

    /**
     * function which will be called for every file that needs to be uploaded. You can use this
     * to skip some files.
     */
    getS3Params?: (localFile: string, stat: fs.Stats, callback: GetS3ParamsCallback) => void;

    /**
     * Unless you explicitly set the ContentType parameter in s3Params, it will be automatically
     * set for you based on the file extension of localFile. If the extension is unrecognized,
     * defaultContentType will be used instead. Defaults to application/octet-stream.
     */
    defaultContentType?: string;

    /**
     * Set this to false to ignore symlinks. Defaults to true.
     */
    followSymlinks?: boolean;
  }

  interface GetS3ParamsCallback {
    /**
     * pass `null` for `s3Params` if you want to skip uploading this file.
     * @param {Error} err
     * @param {S3.PutObjectRequest} s3Params
     */
    (err: Error, s3Params: S3.Types.PutObjectRequest): void;
  }

  /**
   * Supplied these events:
   * 'error' (err)
   * 'end' - emitted when all files are uploaded
   * 'progress' - emitted when any of the above progress properties change.
   * 'fileUploadStart' (localFilePath, s3Key) - emitted when a file begins uploading.
   * 'fileUploadEnd' (localFilePath, s3Key) - emitted when a file successfully finishes uploading.
   */
  interface SyncDirEventEmitter extends EventEmitter {
    progressAmount: number;
    progressTotal: number;
    progressMd5Amount: number;
    progressMd5Total: number;
    deleteAmount: number;
    deleteTotal: number;
    filesFound: number;
    objectsFound: number;
    doneFindingFiles: number;
    doneFindingObjects: number;
    doneMd5: number;
  }

  /**
   * Supplies these events:
   * 'error' (err)
   * 'end' - emitted when all objects are deleted.
   * 'progress' - emitted when the progressAmount or progressTotal properties change.
   */
  interface DeleteDirEventEmitter extends EventEmitter {
    progressAmount: number;
    progressTotal: number;
  }

  /**
   * Supplied these events:
   * 'error' (err)
   * 'end' (data)
   */
  interface CopyObjectEventEmitter extends EventEmitter {

  }

  /**
   * 'error' (err)
   * 'copySuccess' (data)
   * 'end' (data)
   */
  interface MoveObjectEventEmitter extends EventEmitter {

  }

  interface S3Client {
    /**
     * See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
     * The difference between using AWS SDK putObject and this one:
     * This works with files, not streams or buffers.
     * If the reported MD5 upon upload completion does not match, it retries.
     * If the file size is large enough, uses multipart upload to upload parts in parallel.
     * Retry based on the client's retry settings.
     * Progress reporting.
     * Sets the ContentType based on file extension if you do not provide it.
     * @param {"s3".UploadFileParams} params
     * @return {UploadFileEventEmitter}
     */
    uploadFile(params: UploadFileParams): UploadFileEventEmitter;

    /**
     * See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getObject-property
     * The difference between using AWS SDK getObject and this one:
     * This works with a destination file, not a stream or a buffer.
     * If the reported MD5 upon download completion does not match, it retries.
     * Retry based on the client's retry settings.
     * Progress reporting.
     * @param {"s3".DownloadFileParams} params
     * @return {"s3".DownloadFileEventEmitter}
     */
    downloadFile(params: DownloadFileParams): DownloadFileEventEmitter;

    /**
     * http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getObject-property
     * The difference between using AWS SDK getObject and this one:
     * This works with a buffer only.
     * If the reported MD5 upon download completion does not match, it retries.
     * Retry based on the client's retry settings.
     * Progress reporting.
     * @param {S3.GetObjectRequest} s3Params params to pass to AWS SDK getObject.
     * @return {DownloadBufferEventEmitter}
     */
    downloadBuffer(s3Params: S3.Types.GetObjectRequest): DownloadBufferEventEmitter;

    /**
     * http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getObject-property
     * The difference between using AWS SDK getObject and this one:
     * This works with a stream only.
     * If you want retries, progress, or MD5 checking, you must code it yourself.
     * @param {S3.GetObjectRequest} s3Params  params to pass to AWS SDK getObject.
     * @return {DownloadStreamReadableStream}
     */
    downloadStream(s3Params: S3.Types.GetObjectRequest): DownloadStreamReadableStream;

    /**
     * See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#listObjects-property
     * Makes multiple requests if the number of objects to list is greater than 1000.
     * @param {ListObjectsParams} params
     * @return {ListObjectsEventEmitter}
     */
    listObjects(params: ListObjectsParams): ListObjectsEventEmitter;

    /**
     * See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#deleteObjects-property
     * The difference between using AWS SDK deleteObjects and this one:
     * Retry based on the client's retry settings.
     * Make multiple requests if the number of objects you want to delete is greater than 1000.
     * @param {S3.DeleteObjectsRequest} s3Params
     * @return {DeleteObjectsEventEmitter}
     */
    deleteObjects(s3Params: S3.Types.DeleteObjectsRequest): DeleteObjectsEventEmitter;

    /**
     * Syncs an entire directory to S3.
     * Start listing all S3 objects for the target Prefix. S3 guarantees returned objects to be in
     * sorted order.
     * Meanwhile, recursively find all files in localDir.
     * Once all local files are found, we sort them (the same way that S3 sorts).
     * Next we iterate over the sorted local file list one at a time, computing MD5 sums.
     * Now S3 object listing and MD5 sum computing are happening in parallel. As each operation
     * progresses we compare both sorted lists side-by-side, iterating over them one at a time,
     * uploading files whose MD5 sums don't match the remote object (or the remote object is
     * missing), and, if deleteRemoved is set, deleting remote objects whose corresponding local
     * files are missing.
     * @param {SyncDirParams} params
     * @return {SyncDirEventEmitter}
     */
    uploadDir(params: SyncDirParams): SyncDirEventEmitter;

    /**
     * Syncs an entire directory from S3.
     * works like this:
     * Start listing all S3 objects for the target Prefix. S3 guarantees returned objects to be in
     * sorted order.
     * Meanwhile, recursively find all files in localDir.
     * Once all local files are found, we sort them (the same way that S3 sorts).
     * Next we iterate over the sorted local file list one at a time, computing MD5 sums.
     * Now S3 object listing and MD5 sum computing are happening in parallel. As each operation
     * progresses we compare both sorted lists side-by-side, iterating over them one at a time,
     * downloading objects whose MD5 sums don't match the local file (or the local file is missing),
     * and, if deleteRemoved is set, deleting local files whose corresponding objects are missing.
     * @param {DownloadDirParams} params
     * @return {DownloadDirEventEmitter}
     */
    downloadDir(params: SyncDirParams): SyncDirEventEmitter;

    /**
     * Deletes an entire directory on S3.
     * works like this:
     * Start listing all objects in a bucket recursively. S3 returns 1000 objects per response.
     * For each response that comes back with a list of objects in the bucket, immediately send a
     * delete request for all of them.
     * @param {S3.DeleteObjectsRequest} s3Params
     * @return {DeleteDirEventEmitter}
     */
    deleteDir(s3Params: S3.Types.DeleteObjectsRequest): DeleteDirEventEmitter;

    /**
     * See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property
     * The difference between using AWS SDK copyObject and this one:
     * Retry based on the client's retry settings.
     * @param {S3.CopyObjectRequest} s3Params
     * @return {CopyObjectEventEmitter}
     */
    copyObject(s3Params: S3.Types.CopyObjectRequest): CopyObjectEventEmitter;

    /**
     * See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property
     * Under the hood, this uses copyObject and then deleteObjects only if the copy succeeded.
     * @param {S3.CopyObjectRequest} s3Params
     * @return {CopyObjectEventEmitter}
     */
    moveObject(s3Params: S3.Types.CopyObjectRequest): MoveObjectEventEmitter;
  }

  /**
   * This contains a reference to the aws-sdk module. It is a valid use case to use both this
   * module and the lower level aws-sdk module in tandem.
   */
  export const AWS: AWS;

  /**
   * Creates an S3 client.
   * @param {"s3".CreateClientOptions} opts
   * @return {"s3".S3Client}
   */
  export function createClient(opts: CreateClientOptions): S3Client;

  /**
   * You can find out your bucket location programatically by using this API:
   *  http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getBucketLocation-property
   * returns a string which looks like this:
   * https://s3.amazonaws.com/bucket/key
   * or maybe this if you are not in US Standard:
   * https://s3-eu-west-1.amazonaws.com/bucket/key
   * @param {string} bucket S3 bucket
   * @param {string} key S3 key
   * @param {string} bucketLocation AWS Region
   * @return {string}
   */
  export function getPublicUrl(bucket: string, key: string, bucketLocation?: string): string;

  /**
   * Works for any region, and returns a string which looks like this:
   * http://bucket.s3.amazonaws.com/key
   * @param {string} bucket S3 Bucket
   * @param {string} key S3 Key
   * @return {string}
   */
  export function getPublicUrlHttp(bucket: string, key: string): string;
}
