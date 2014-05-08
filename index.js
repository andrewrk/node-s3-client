var AWS = require('aws-sdk');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var S3Uploader = require('s3-upload-stream').Uploader;
var findit = require('findit');
var Pend = require('pend');
var path = require('path');

/*
TODO:
 - ability to query progress
 - mtime checking is not good enough, we have to do etag
 - deleteObjects
 - uploadFile
 - downloadFile
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
  this.fsPend = new Pend();
  this.fsPend.max = options.maxAsyncFs || Infinity;
  this.s3RetryCount = options.s3RetryCount || 3;
  this.s3RetryDelay = options.s3RetryDelay || 1000;
  this.freePend = new Pend();
}

Client.prototype.deleteObjects = function(params) {
  var deleter = new EventEmitter();

  // TODO handle the 1000 limit
  // TODO handle retries

  return deleter;
};

Client.prototype.uploadFile = function(params) {
  var uploader = new EventEmitter();
  var localFile = params.localFile;
  var s3Uploader = new S3Uploader(this.connectionDetails, params, function(err, uploadStream) {
    if (err) {
      uploader.emit('error', err);
      return;
    }
    var inputStream = fs.createReadStream(localFile);
    inputStream.on('error', function(err) {
      uploader.emit('error', err);
    });
    uploadStream.on('error', function(err) {
      uploader.emit('error', err);
    });
    uploadStream.on('uploaded', function() {
      uploader.emit('end');
    });
    inputStream.pipe(uploadStream);
  });
  return uploader;
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

  var groupPend = new GroupPend();
  groupPend.go(self.freePend, findAllS3Objects);
  groupPend.go(self.fsPend, findAllFiles);
  groupPend.wait(compareResults);

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
      if (!localFileStat || localFileStat.mtime.getTime() !== s3Object.LastModified.getTime()) {
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
    var groupPend = new GroupPend();
    debugger;
    for (var relPath in localFiles) {
      var localFileStat = localFiles[relPath];
      var s3Object = s3Objects[relPath];
      if (!s3Object) {
        deleteOneFile(relPath);
      }
    }
    groupPend.wait(cb);

    function deleteOneFile(relPath) {
      var fullPath = path.join(localDir, relPath);
      groupPend.go(self.fsPend, function(cb) {
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
      if (!s3Object || localFileStat.mtime.getTime() !== s3Object.LastModified.getTime()) {
        uploadOneFile(relPath);
      }
    }
    pend.wait(cb);

    function uploadOneFile(relPath) {
      var fullPath = path.join(localDir, relPath);
      pend.go(function(cb) {
        s3Details.Key = relPath;
        s3Details.localFile = fullPath;
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

      data.Contents.forEach(function(object) {
        s3Objects[object.Key] = object;
      });

      if (data.IsTruncated) {
        findS3ObjectsParams.Marker = data.NextMarker;
        findAllS3Objects(cb);
      } else {
        cb();
      }
    });

    function listObjects(cb) {
      groupPend.go(self.s3Pend, function(pendCb) {
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
    walker.on('error', function(err) {
      if (errorOccurred) return;
      errorOccurred = true;
      walker.stop();
      cb(err);
    });
    walker.on('file', function(file, stat) {
      var relPath = path.relative(localDir, file);
      localFiles[relPath] = stat;
    });
    walker.on('end', function() {
      if (errorOccurred) return;
      cb();
    });
  }
}

function GroupPend() {
  this.pend = new Pend();
}

GroupPend.prototype.go = function(pend, fn) {
  var innerPend = this.pend;
  pend.go(function(cb) {
    innerPend.go(function(innerCb) {
      fn(function(err) {
        innerCb(err);
        cb(err);
      });
    });
  });
};

GroupPend.prototype.wait = function(fn) {
  this.pend.wait(fn);
};

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
