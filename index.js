var AWS = require('aws-sdk');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var findit = require('findit');
var Pend = require('pend');
var path = require('path');
var crypto = require('crytpo');

// greater than 5 gigabytes and S3 requires a multipart upload. Multipart
// uploads have a different ETag format. For multipart upload ETags it is
// impossible to tell how te generate the ETag.
// unfortunately we're still assuming that files <= 5 GB were not uploaded with
// via multipart upload.
var MAX_PUTOBJECT_SIZE = 5 * 1024 * 1024 * 1024;

var MAX_DELETE_COUNT = 1000;

/*
TODO:
 - test debugger areas
 - write tests
 - ability to query progress
*/

exports.createClient = function(options) {
  var client = new Client(options);
  client.s3 = new AWS.S3(options);
  client.connectionDetails = {s3Client: client.s3};
  return client;
};

exports.fromAwsSdkS3 = function(s3, options) {
  var client = new Client(options);
  client.s3 = s3;
  client.connectionDetails = {s3Client: client.s3};
  return client;
}

exports.Client = Client;

function Client(options) {
  options = options || {};
  this.s3Pend = new Pend();
  this.s3Pend.max = options.maxAsyncS3 || Infinity;
  this.s3RetryCount = options.s3RetryCount || 3;
  this.s3RetryDelay = options.s3RetryDelay || 1000;
  this.freePend = new Pend();
}

Client.prototype.deleteObjects = function(params) {
  var self = this;
  var ee = new EventEmitter();

  var targetObjects = params.Delete.Objects;
  var slices = chunkArray(targetObjects, MAX_DELETE_COUNT);
  var errorOccurred = false;
  var errors = [];
  var pend = new Pend();

  slices.forEach(uploadSlice);
  pend.wait(function(err) {
    if (err) {
      ee.emit('error', err);
      return;
    }
    ee.emit('end', errors);
  });
  return ee;

  function uploadSlice(slice) {
    pend.go(function(cb) {
      doWithRetry(tryDeletingObjects, self.s3RetryCount, self.s3RetryDelay, function(err, data) {
        if (err) {
          cb(err);
        } else {
          errors = errors.concat(data.Errors);
          cb();
        }
      });
    });

    function tryDeletingObjects(cb) {
      self.s3Pend.go(function(pendCb) {
        params.Delete.Objects = slice;
        self.s3.deleteObjects(params, function(err, data) {
          pendCb();
          cb(err, data);
        });
      });
    }
  }
};

Client.prototype.uploadFile = function(params) {
  var self = this;
  var uploader = new EventEmitter();
  var localFile = params.localFile;
  var localFileStat = params.localFileStat;

  if (!localFileStat || !localFileStat.md5sum) {
    doStatAndMd5Sum();
  } else {
    startPuttingObject();
  }

  return uploader;

  function doStatAndMd5Sum() {
    var md5sum;
    var pend = new Pend();
    pend.go(doStat);
    pend.go(doMd5Sum);
    pend.wait(function(err) {
      if (err) {
        uploader.emit('error', err);
        return;
      }
      localFileStat.md5sum = md5sum;
      startPuttingObject();
    });

    function doStat(cb) {
      fs.stat(localFile, function(err, stat) {
        if (!err) localFileStat = stat;
        cb(err);
      });
    }

    function doMd5Sum(cb) {
      var inStream = fs.createReadStream(localFile);
      inStream.on('error', function(err) {
        cb(err);
      });
      var hash = crypto.createHash('md5');
      hash.on('data', function(digest) {
        md5sum = digest.toString('hex');
        cb();
      });
      inStream.pipe(hash);
    }
  }

  function startPuttingObject() {
    if (localFileStat.size > MAX_PUTOBJECT_SIZE) {
      uploader.emit('error', new Error("file exceeded max size for putObject"));
      return;
    }
    doWithRetry(tryPuttingObject, self.s3RetryCount, self.s3RetryDelay, function(err, data) {
      if (err) {
        uploader.emit('error', err);
        return;
      }

      uploader.emit('end');
    });
  }

  function tryPuttingObject(cb) {
    self.s3Pend.go(function(pendCb) {
      var inStream = fs.createReadStream(localFile);
      var errorOccurred = false;
      inStream.on('error', function(err) {
        if (errorOccurred) return;
        errorOccurred = true;
        uploader.emit('error', err);
      });
      params.Body = inStream;
      params.ContentMD5 = localFileStat.md5sum;
      params.ContentLength = localFileStat.size;
      self.s3.putObject(params, function(err, data) {
        pendCb();
        if (errorOccurred) return;
        if (err) {
          errorOccurred = true;
          cb(err);
          return;
        }
        if (data.ETag !== localFileStat.md5sum) {
          errorOccurred = true;
          cb(new Error("ETag does not match MD5 checksum"));
          return;
        }
        cb(null, data);
      });
    });
  }
};

Client.prototype.downloadFile = function(params) {
  var downloader = new EventEmitter();
  var localFile = params.localFile;
  var response = this.s3.getObject(params).createReadStream();
  var outStream = fs.createWriteStream(localFile);

  response.on('error', function(err) {
    downloader.emit('error', err);
  });

  outStream.on('error', function(err) {
    downloader.emit('error', err);
  });

  response.pipe(outStream);

  return downloader;
};

/* params:
 * - Bucket (required)
 * - Key (required)
 * - Delimiter - defaults to '/'
 * - deleteRemoved - delete s3 objects with no corresponding local file. default false
 * - localDir - path on local file system to sync
 */
Client.prototype.uploadDir = function(params) {
  syncDir(this, params, true);
};

Client.prototype.downloadDir = function(params) {
  syncDir(this, params, false);
};

function syncDir(self, params, directionIsToS3) {
  var ee = new EventEmitter();

  var localDir = params.localDir;
  var localFiles = {};
  var s3Objects = {};
  var deleteRemoved = params.deleteRemoved === true;
  var findS3ObjectsParams = {
    Bucket: params.Bucket,
    Delimiter: params.Delimiter || '/',
    EncodingType: 'url',
    Marker: null,
    MaxKeys: null,
    Prefix: params.Key,
  };
  var s3Details = extend({}, params);

  var pend = new Pend();
  pend.go(findAllS3Objects);
  pend.go(findAllFiles);
  pend.wait(compareResults);

  return ee;

  function compareResults(err) {
    if (err) {
      ee.emit('error', err);
      return;
    }

    var pend = new Pend();
    if (directionIsToS3) {
      if (deleteRemoved) pend.go(deleteRemovedObjects);
      pend.go(uploadDifferentObjects);
    } else {
      if (deleteRemoved) pend.go(deleteRemovedLocalFiles);
      pend.go(downloadDifferentObjects);
    }
    pend.wait(function(err) {
      if (err) {
        ee.emit('error', err);
        return;
      }
      ee.emit('end');
    });
  }

  function downloadDifferentObjects(cb) {
    var pend = new Pend();
    debugger
    for (var relPath in s3Objects) {
      var s3Object = s3Objects[relPath];
      var localFileStat = localFiles[relPath];
      if (!localFileStat || localFileStat.md5sum !== s3Object.ETag) {
        downloadOneFile(relPath);
      }
    }
    pend.wait(cb);

    function downloadOneFile(relPath) {
      var fullPath = path.join(localDir, relPath);
      pend.go(function(cb) {
        s3Details.Key = relPath;
        s3Details.localFile = fullPath;
        var downloader = self.downloadFile(s3Details);
        downloader.on('error', function(err) {
          cb(err);
        });
        downloader.on('end', function() {
          cb();
        });
      });
    }
  }

  function deleteRemovedLocalFiles(cb) {
    var pend = new Pend();
    debugger;
    for (var relPath in localFiles) {
      var localFileStat = localFiles[relPath];
      var s3Object = s3Objects[relPath];
      if (!s3Object) {
        deleteOneFile(relPath);
      }
    }
    pend.wait(cb);

    function deleteOneFile(relPath) {
      var fullPath = path.join(localDir, relPath);
      pend.go(function(cb) {
        fs.unlink(cb);
      });
    }
  }

  function uploadDifferentObjects(cb) {
    var pend = new Pend();
    debugger
    for (var relPath in localFiles) {
      var localFileStat = localFiles[relPath];
      var s3Object = s3Objects[relPath];
      if (!s3Object || localFileStat.md5sum !== s3Object.ETag) {
        uploadOneFile(relPath);
      }
    }
    pend.wait(cb);

    function uploadOneFile(relPath, localFileStat) {
      var fullPath = path.join(localDir, relPath);
      pend.go(function(cb) {
        s3Details.Key = relPath;
        s3Details.localFile = fullPath;
        s3Details.localFileStat = localFileStat;
        var uploader = self.uploadFile(s3Details);
        uploader.on('error', function(err) {
          cb(err);
        });
        uploader.on('end', function() {
          cb();
        });
      });
    }
  }

  function deleteRemovedObjects(cb) {
    debugger;
    var objectsToDelete = [];
    for (var relPath in s3Objects) {
      var s3Object = s3Objects[relPath];
      var localFileStat = localFiles[relPath];
      if (!localFileStat) {
        objectsToDelete.push({Key: relPath});
      }
    }
    var params = {
      Bucket: params.Bucket,
      Delete: {
        Objects: objectsToDelete,
        Quiet: true,
      },
    };
    var deleter = self.deleteObjects(params);
    deleter.on('error', function(err) {
      cb(err);
    });
    deleter.on('end', function() {
      cb();
    });
  }

  function findAllS3Objects(cb) {
    doWithRetry(listObjects, self.s3RetryCount, self.s3RetryDelay, function(err, data) {
      if (err) return cb(err);

      for (var i = 0; i < data.Contents.length; i += 1) {
        var object = data.Contents[i];
        s3Objects[object.Key] = object;
      }

      if (data.IsTruncated) {
        findS3ObjectsParams.Marker = data.NextMarker;
        findAllS3Objects(cb);
      } else {
        cb();
      }
    });

    function listObjects(cb) {
      self.s3Pend.go(function(pendCb) {
        self.s3.listObjects(findS3ObjectsParams, function(err, data) {
          pendCb();
          cb(err, data);
        });
      });
    }
  }

  function findAllFiles(cb) {
    var dirWithSlash = ensureSep(localDir);
    var walker = findit(dirWithSlash);
    var errorOccurred = false;
    var pend = new Pend();
    walker.on('error', function(err) {
      if (errorOccurred) return;
      errorOccurred = true;
      walker.stop();
      cb(err);
    });
    walker.on('file', function(file, stat) {
      var relPath = path.relative(localDir, file);
      if (stat.size > MAX_PUTOBJECT_SIZE) {
        stat.md5sum = ""; // ETag has different format for files this big
        localFiles[relPath] = stat;
        return;
      }
      pend.go(function(cb) {
        var inStream = fs.createReadStream(file);
        var hash = crypto.createHash('md5');
        inStream.on('error', function(err) {
          if (errorOccurred) return;
          errorOccurred = true;
          walker.stop();
          cb(err);
        });
        hash.on('data', function(digest) {
          stat.md5sum = digest.toString('hex');
          localFiles[relPath] = stat;
          cb();
        });
        inStream.pipe(hash);
      });
    });
    walker.on('end', function() {
      if (errorOccurred) return;
      pend.wait(cb);
    });
  }
}

function ensureSep(dir) {
  return (dir[dir.length - 1] === path.sep) ? dir : (dir + path.sep);
}

function doWithRetry(fn, tryCount, delay, cb) {
  var tryIndex = 0;

  tryOnce();

  function tryOnce() {
    fn(function(err, result) {
      if (err) {
        tryIndex += 1;
        if (tryIndex >= tryCount) {
          cb(err);
        } else {
          setTimeout(tryOnce, delay);
        }
      } else {
        cb(null, result);
      }
    });
  }
}

function extend(target, source) {
  for (var propName in source) {
    target[propName] = source[propName];
  }
  return target;
}

function chunkArray(array, maxLength) {
  var slices = [array];
  while (slices[slices.length - 1].length > maxLength) {
    slices.push(slices[slices.length - 1].splice(maxLength));
  }
  return slices;
}

