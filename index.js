var AWS = require('aws-sdk');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var quotemeta = require('quotemeta');
var url = require('url');
var rimraf = require('rimraf');
var findit = require('findit');
var Pend = require('pend');
var path = require('path');
var crypto = require('crypto');
var StreamCounter = require('stream-counter');
var mkdirp = require('mkdirp');

// greater than 5 gigabytes and S3 requires a multipart upload. Multipart
// uploads have a different ETag format. For multipart upload ETags it is
// impossible to tell how to generate the ETag.
// unfortunately we're still assuming that files <= 5 GB were not uploaded with
// via multipart upload.
var MAX_PUTOBJECT_SIZE = 5 * 1024 * 1024 * 1024;

var MAX_DELETE_COUNT = 1000;

var TO_UNIX_RE = new RegExp(quotemeta(path.sep), 'g');
var UNIX_SPLIT_PATH_RE = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;

exports.createClient = function(options) {
  return new Client(options);
};

exports.getPublicUrl = getPublicUrl;
exports.getPublicUrlHttp = getPublicUrlHttp;

exports.Client = Client;

function Client(options) {
  options = options || {};
  this.s3 = options.s3Client || new AWS.S3(options.s3Options);
  this.s3Pend = new Pend();
  this.s3Pend.max = options.maxAsyncS3 || Infinity;
  this.s3RetryCount = options.s3RetryCount || 3;
  this.s3RetryDelay = options.s3RetryDelay || 1000;
}

Client.prototype.deleteObjects = function(s3Params) {
  var self = this;
  var ee = new EventEmitter();

  var params = {
    Bucket: s3Params.Bucket,
    Delete: extend({}, s3Params.Delete),
    MFA: s3Params.MFA,
  };
  var slices = chunkArray(params.Delete.Objects, MAX_DELETE_COUNT);
  var errorOccurred = false;
  var pend = new Pend();

  ee.progressAmount = 0;
  ee.progressTotal = params.Delete.Objects.length;

  slices.forEach(uploadSlice);
  pend.wait(function(err) {
    if (err) {
      ee.emit('error', err);
      return;
    }
    ee.emit('end');
  });
  return ee;

  function uploadSlice(slice) {
    pend.go(function(cb) {
      doWithRetry(tryDeletingObjects, self.s3RetryCount, self.s3RetryDelay, function(err, data) {
        if (err) {
          cb(err);
        } else {
          ee.progressAmount += slice.length;
          ee.emit('progress');
          ee.emit('data', data);
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
  uploader.progressMd5Amount = 0;
  uploader.progressAmount = 0;
  uploader.progressTotal = 1;

  var localFile = params.localFile;
  var localFileStat = params.localFileStat;
  var s3Params = extend({}, params.s3Params);

  if (!localFileStat || !localFileStat.md5sum) {
    doStatAndMd5Sum();
  } else {
    uploader.progressTotal = localFileStat.size;
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
        if (!err) {
          localFileStat = stat;
          uploader.progressTotal = stat.size;
        }
        cb(err);
      });
    }

    function doMd5Sum(cb) {
      var inStream = fs.createReadStream(localFile);
      var counter = new StreamCounter();
      inStream.on('error', function(err) {
        cb(err);
      });
      uploader.emit('stream', inStream);
      var hash = crypto.createHash('md5');
      hash.on('data', function(digest) {
        md5sum = digest;
        cb();
      });
      counter.on('progress', function() {
        uploader.progressMd5Amount = counter.bytes;
        uploader.emit('progress');
      });
      inStream.pipe(hash);
      inStream.pipe(counter);
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

      uploader.emit('end', data);
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
      s3Params.Body = inStream;
      s3Params.ContentMD5 = localFileStat.md5sum.toString('base64');
      s3Params.ContentLength = localFileStat.size;
      uploader.progressAmount = 0;
      var counter = new StreamCounter();
      counter.on('progress', function() {
        uploader.progressAmount = counter.bytes;
        uploader.emit('progress');
      });
      inStream.pipe(counter);
      self.s3.putObject(s3Params, function(err, data) {
        pendCb();
        if (errorOccurred) return;
        if (err) {
          errorOccurred = true;
          cb(err);
          return;
        }
        if (!compareETag(data.ETag, localFileStat.md5sum)) {
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
  var self = this;
  var downloader = new EventEmitter();
  var localFile = params.localFile;
  var s3Params = extend({}, params.s3Params);

  var dirPath = path.dirname(localFile);
  downloader.progressAmount = 0;
  mkdirp(dirPath, function(err) {
    if (err) {
      downloader.emit('error', err);
      return;
    }

    doWithRetry(doDownloadWithPend, self.s3RetryCount, self.s3RetryDelay, function(err) {
      if (err) {
        downloader.emit('error', err);
        return;
      }
      downloader.emit('end');
    });
  });

  return downloader;

  function doDownloadWithPend(cb) {
    self.s3Pend.go(function(pendCb) {
      doTheDownload(function(err) {
        pendCb();
        cb(err);
      });
    });
  }

  function doTheDownload(cb) {
    var request = self.s3.getObject(s3Params);
    var response = request.createReadStream();
    var outStream = fs.createWriteStream(localFile);
    var counter = new StreamCounter();
    var hash = crypto.createHash('md5');
    var errorOccurred = false;
    var eTag = "";

    response.on('error', handleError);
    outStream.on('error', handleError);

    request.on('httpHeaders', function(statusCode, headers, resp) {
      if (statusCode < 300) {
        var contentLength = parseInt(headers['content-length'], 10);
        downloader.progressTotal = contentLength;
        downloader.progressAmount = 0;
        downloader.emit('progress');
        downloader.emit('httpHeaders', statusCode, headers, resp);
        eTag = headers.etag || "";
      } else {
        handleError(new Error("http status code " + statusCode));
      }
    });

    hash.on('data', function(digest) {
      if (!compareETag(eTag, digest)) {
        handleError(new Error("ETag does not match MD5 checksum"));
      }
    });

    counter.on('progress', function() {
      downloader.progressAmount = counter.bytes;
      downloader.emit('progress');
    });

    outStream.on('close', function() {
      if (errorOccurred) return;
      cb();
    });

    response.pipe(counter);
    response.pipe(outStream);
    response.pipe(hash);

    function handleError(err) {
      if (errorOccurred) return;
      errorOccurred = true;
      cb(err);
    }
  }
};

/* params:
 *  - recursive: false
 *  - s3Params:
 *    - Bucket: params.s3Params.Bucket,
 *    - Delimiter: null,
 *    - Marker: null,
 *    - MaxKeys: null,
 *    - Prefix: prefix,
 */
Client.prototype.listObjects = function(params) {
  var self = this;
  var ee = new EventEmitter();
  var s3Details = extend({}, params.s3Params);
  var recursive = !!params.recursive;
  var abort = false;

  ee.progressAmount = 0;
  ee.objectsFound = 0;
  ee.dirsFound = 0;
  findAllS3Objects(s3Details.Marker, s3Details.Prefix, function(err, data) {
    if (err) {
      ee.emit('error', err);
      return;
    }
    ee.emit('end');
  });

  ee.abort = function() {
    abort = true;
  };

  return ee;

  function findAllS3Objects(marker, prefix, cb) {
    if (abort) return;
    doWithRetry(listObjects, self.s3RetryCount, self.s3RetryDelay, function(err, data) {
      if (abort) return;
      if (err) return cb(err);

      ee.progressAmount += 1;
      ee.objectsFound += data.Contents.length;
      ee.dirsFound += data.CommonPrefixes.length;
      ee.emit('progress');
      ee.emit('data', data);

      var pend = new Pend();

      if (recursive) {
        data.CommonPrefixes.forEach(recurse);
        data.CommonPrefixes = [];
      }

      if (data.IsTruncated) {
        pend.go(findNext1000);
      }

      pend.wait(function(err) {
        cb(err);
      });

      function findNext1000(cb) {
        var nextMarker = data.NextMarker || data.Contents[data.Contents.length - 1].Key;
        findAllS3Objects(nextMarker, prefix, cb);
      }

      function recurse(dirObj) {
        var prefix = dirObj.Prefix;
        pend.go(function(cb) {
          findAllS3Objects(null, prefix, cb);
        });
      }
    });

    function listObjects(cb) {
      if (abort) return;
      self.s3Pend.go(function(pendCb) {
        if (abort) {
          pendCb();
          return;
        }
        s3Details.Marker = marker;
        s3Details.Prefix = prefix;
        self.s3.listObjects(s3Details, function(err, data) {
          pendCb();
          if (abort) return;
          cb(err, data);
        });
      });
    }
  }
};

/* params:
 * - deleteRemoved - delete s3 objects with no corresponding local file. default false
 * - localDir - path on local file system to sync
 * - s3Params:
 *   - Bucket (required)
 *   - Key (required)
 */
Client.prototype.uploadDir = function(params) {
  return syncDir(this, params, true);
};

Client.prototype.downloadDir = function(params) {
  return syncDir(this, params, false);
};

Client.prototype.deleteDir = function(s3Params) {
  var self = this;
  var ee = new EventEmitter();
  var bucket = s3Params.Bucket;
  var mfa = s3Params.MFA;
  var listObjectsParams = {
    recursive: true,
    s3Params: {
      Bucket: bucket,
      Prefix: s3Params.Prefix,
    },
  };
  var finder = self.listObjects(listObjectsParams);
  var pend = new Pend();
  ee.progressAmount = 0;
  ee.progressTotal = 0;
  finder.on('error', function(err) {
    ee.emit('error', err);
  });
  finder.on('data', function(objects) {
    ee.progressTotal += objects.Contents.length;
    ee.emit('progress');
    if (objects.Contents.length > 0) {
      pend.go(deleteThem);
    }

    function deleteThem(cb) {
      var params = {
        Bucket: bucket,
        Delete: {
          Objects: objects.Contents.map(keyOnly),
          Quiet: true,
        },
        MFA: mfa,
      };
      var deleter = self.deleteObjects(params);
      deleter.on('error', function(err) {
        finder.abort();
        ee.emit('error', err);
      });
      deleter.on('end', function() {
        ee.progressAmount += objects.Contents.length;
        ee.emit('progress');
        cb();
      });
    }
  });
  finder.on('end', function() {
    pend.wait(function() {
      ee.emit('end');
    });
  });
  return ee;
};

Client.prototype.copyObject = function(_s3Params) {
  var self = this;
  var ee = new EventEmitter();
  var s3Params = extend({}, _s3Params);
  delete s3Params.MFA;
  doWithRetry(doCopyWithPend, self.s3RetryCount, self.s3RetryDelay, function(err, data) {
    if (err) {
      ee.emit('error', err);
    } else {
      ee.emit('end', data);
    }
  });
  function doCopyWithPend(cb) {
    self.s3Pend.go(function(pendCb) {
      doTheCopy(function(err, data) {
        pendCb();
        cb(err, data);
      });
    });
  }
  function doTheCopy(cb) {
    self.s3.copyObject(s3Params, cb);
  }
  return ee;
};

Client.prototype.moveObject = function(s3Params) {
  var self = this;
  var ee = new EventEmitter();
  var copier = self.copyObject(s3Params);
  var copySource = s3Params.CopySource;
  var mfa = s3Params.MFA;
  copier.on('error', function(err) {
    ee.emit('error', err);
  });
  copier.on('end', function(data) {
    ee.emit('copySuccess', data);
    var slashIndex = copySource.indexOf('/');
    var sourceBucket = copySource.substring(0, slashIndex);
    var sourceKey = copySource.substring(slashIndex + 1);
    var deleteS3Params = {
      Bucket: sourceBucket,
      Delete: {
        Objects: [
          {
            Key: sourceKey,
          },
        ],
        Quiet: true,
      },
      MFA: mfa,
    };
    var deleter = self.deleteObjects(deleteS3Params);
    deleter.on('error', function(err) {
      ee.emit('error', err);
    });
    var deleteData;
    deleter.on('data', function(data) {
      deleteData = data;
    });
    deleter.on('end', function() {
      ee.emit('end', deleteData);
    });
  });
  return ee;
};

function syncDir(self, params, directionIsToS3) {
  var ee = new EventEmitter();

  var localDir = params.localDir;
  var getS3Params = params.getS3Params;
  var localFiles = {};
  var localFilesSize = 0;
  var localDirs = {};
  var s3Objects = {};
  var s3ObjectsSize = 0;
  var s3Dirs = {};
  var deleteRemoved = params.deleteRemoved === true;
  var prefix = params.s3Params.Prefix ? ensureSlash(params.s3Params.Prefix) : '';
  var bucket = params.s3Params.Bucket;
  var listObjectsParams = {
    recursive: true,
    s3Params: {
      Bucket: bucket,
      Marker: null,
      MaxKeys: null,
      Prefix: prefix,
    },
  };
  var baseUpDownS3Params = extend({}, params.s3Params);
  var upDownFileParams = {
    localFile: null,
    localFileStat: null,
    s3Params: baseUpDownS3Params,
  };
  delete upDownFileParams.s3Params.Prefix;

  ee.progressTotal = 0;
  ee.progressAmount = 0;
  ee.progressMd5Amount = 0;
  ee.progressMd5Total = 0;
  ee.objectsFound = 0;
  ee.startedTransfer = false;

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
    ee.startedTransfer = true;
    ee.emit('progress');
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
    for (var relPath in s3Objects) {
      var s3Object = s3Objects[relPath];
      var localFileStat = localFiles[relPath];
      if (!localFileStat || !compareETag(s3Object.ETag, localFileStat.md5sum)) {
        downloadOneFile(relPath, s3Object);
      }
    }
    pend.wait(cb);

    function downloadOneFile(relPath, s3Object) {
      var fullPath = path.join(localDir, toNativeSep(relPath));
      pend.go(function(cb) {
        if (getS3Params) {
          getS3Params(fullPath, s3Object, haveS3Params);
        } else {
          startDownload();
        }

        function haveS3Params(err, s3Params) {
          if (err) return cb(err);

          if (!s3Params) {
            //user has decided to skip this file
            cb();
            return;
          }

          upDownFileParams.s3Params = extend(extend({}, baseUpDownS3Params), s3Params);
          startDownload();
        }

        function startDownload() {
          ee.progressTotal += s3Object.Size;
          upDownFileParams.s3Params.Key = prefix + relPath;
          upDownFileParams.localFile = fullPath;
          upDownFileParams.localFileStat = null;
          var downloader = self.downloadFile(upDownFileParams);
          var prevAmountDone = 0;
          downloader.on('error', function(err) {
            cb(err);
          });
          downloader.on('progress', function() {
            var delta = downloader.progressAmount - prevAmountDone;
            prevAmountDone = downloader.progressAmount;
            ee.progressAmount += delta;
            ee.emit('progress');
          });
          downloader.on('end', function() {
            cb();
          });
        }
      });
    }
  }

  function deleteRemovedLocalFiles(cb) {
    var pend = new Pend();
    var relPath;
    for (relPath in localFiles) {
      var localFileStat = localFiles[relPath];
      var s3Object = s3Objects[relPath];
      if (!s3Object) {
        deleteOneFile(localFileStat);
      }
    }
    for (relPath in localDirs) {
      var localDirStat = localDirs[relPath];
      var s3Dir = s3Dirs[relPath];
      if (!s3Dir) {
        deleteOneDir(localDirStat);
      }
    }
    pend.wait(cb);

    function deleteOneDir(stat) {
      var fullPath = path.join(localDir, stat.path);
      pend.go(function(cb) {
        rimraf(fullPath, function(err) {
          // ignore ENOENT errors
          if (err && err.code === 'ENOENT') err = null;
          cb(err);
        });
      });
    }

    function deleteOneFile(stat) {
      var fullPath = path.join(localDir, stat.path);
      pend.go(function(cb) {
        fs.unlink(fullPath, function(err) {
          // ignore ENOENT errors
          if (err && err.code === 'ENOENT') err = null;
          cb(err);
        });
      });
    }
  }

  function uploadDifferentObjects(cb) {
    var pend = new Pend();
    for (var relPath in localFiles) {
      var localFileStat = localFiles[relPath];
      var s3Object = s3Objects[relPath];
      if (!s3Object || !compareETag(s3Object.ETag, localFileStat.md5sum)) {
        uploadOneFile(relPath, localFileStat);
      }
    }
    ee.emit('progress');
    pend.wait(cb);

    function uploadOneFile(relPath, localFileStat) {
      var fullPath = path.join(localDir, localFileStat.path);
      pend.go(function(cb) {
        if (getS3Params) {
          getS3Params(fullPath, localFileStat, haveS3Params);
        } else {
          upDownFileParams.s3Params = baseUpDownS3Params;
          startUpload();
        }

        function haveS3Params(err, s3Params) {
          if (err) return cb(err);

          if (!s3Params) {
            // user has decided to skip this file
            cb();
            return;
          }

          upDownFileParams.s3Params = extend(extend({}, baseUpDownS3Params), s3Params);
          startUpload();
        }

        function startUpload() {
          ee.progressTotal += localFileStat.size;
          upDownFileParams.s3Params.Key = prefix + relPath;
          upDownFileParams.localFile = fullPath;
          upDownFileParams.localFileStat = localFileStat;
          var uploader = self.uploadFile(upDownFileParams);
          var prevAmountDone = 0;
          uploader.on('error', function(err) {
            cb(err);
          });
          uploader.on('progress', function() {
            var delta = uploader.progressAmount - prevAmountDone;
            prevAmountDone = uploader.progressAmount;
            ee.progressAmount += delta;
            ee.emit('progress');
          });
          uploader.on('end', function() {
            cb();
          });
        }
      });
    }
  }

  function deleteRemovedObjects(cb) {
    var objectsToDelete = [];
    for (var relPath in s3Objects) {
      var s3Object = s3Objects[relPath];
      var localFileStat = localFiles[relPath];
      if (!localFileStat) {
        objectsToDelete.push({Key: prefix + relPath});
      }
    }
    var params = {
      Bucket: bucket,
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
    var finder = self.listObjects(listObjectsParams);
    finder.on('error', function(err) {
      cb(err);
    });
    finder.on('data', function(data) {
      ee.objectsFound += data.Contents.length;
      ee.emit('progress');
      data.Contents.forEach(function(object) {
        var key = object.Key.substring(prefix.length);
        s3Objects[key] = object;
        s3ObjectsSize += object.Size;
        var dirname = unixDirname(key);
        if (dirname === '.') return;
        s3Dirs[dirname] = true;
      });
    });
    finder.on('end', function() {
      cb();
    });
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
    walker.on('directory', function(dir, stat) {
      var relPath = path.relative(localDir, dir);
      if (relPath === '') return;
      stat.path = relPath;
      localDirs[toUnixSep(relPath)] = stat;
    });
    walker.on('file', function(file, stat) {
      var relPath = path.relative(localDir, file);
      if (stat.size > MAX_PUTOBJECT_SIZE) {
        stat.md5sum = new Buffer(0); // ETag has different format for files this big
        localFiles[relPath] = stat;
        return;
      }
      ee.progressMd5Total += stat.size;
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
          stat.md5sum = digest;
          stat.path = relPath;
          localFiles[toUnixSep(relPath)] = stat;
          localFilesSize += stat.size;
          ee.progressMd5Amount += stat.size;
          ee.emit('progress');
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

function ensureChar(str, c) {
  return (str[str.length - 1] === c) ? str : (str + c);
}

function ensureSep(dir) {
  return ensureChar(dir, path.sep);
}

function ensureSlash(dir) {
  return ensureChar(dir, '/');
}

function doWithRetry(fn, tryCount, delay, cb) {
  var tryIndex = 0;

  tryOnce();

  function tryOnce() {
    fn(function(err, result) {
      if (err) {
        if (err.retryable === false) {
          cb(err);
        } else {
          tryIndex += 1;
          if (tryIndex >= tryCount) {
            cb(err);
          } else {
            setTimeout(tryOnce, delay);
          }
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

function compareETag(eTag, md5Buffer) {
  eTag = eTag.replace(/^\s*'?\s*"?\s*(.*?)\s*"?\s*'?\s*$/, "$1");
  var hex = md5Buffer.toString('hex');
  return eTag === hex;
}

function keyOnly(item) {
  return {
    Key: item.Key,
    VersionId: item.VersionId,
  };
}

function encodeSpecialCharacters(filename) {
  // Note: these characters are valid in URIs, but S3 does not like them for
  // some reason.
  return encodeURI(filename).replace(/[!'()* ]/g, function (char) {
    return '%' + char.charCodeAt(0).toString(16);
  });
}

function getPublicUrl(bucket, key, bucketLocation) {
  var hostnamePrefix = bucketLocation ? ("s3-" + bucketLocation) : "s3";
  var parts = {
    protocol: "https:",
    hostname: hostnamePrefix + ".amazonaws.com",
    pathname: "/" + bucket + "/" + encodeSpecialCharacters(key),
  };
  return url.format(parts);
}

function getPublicUrlHttp(bucket, key) {
  var parts = {
    protocol: "http:",
    hostname: bucket + ".s3.amazonaws.com",
    pathname: "/" + encodeSpecialCharacters(key),
  };
  return url.format(parts);
}

function toUnixSep(str) {
  return str.replace(TO_UNIX_RE, "/");
}

function toNativeSep(str) {
  return str.replace(/\//g, path.sep);
}

function unixDirname(path) {
  var result = unixSplitPath(path);
  var root = result[0];
  var dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
}

function unixSplitPath(filename) {
  return UNIX_SPLIT_PATH_RE.exec(filename).slice(1);
}
