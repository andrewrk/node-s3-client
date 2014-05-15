var AWS = require('aws-sdk');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var rimraf = require('rimraf');
var findit = require('findit');
var Pend = require('pend');
var path = require('path');
var crypto = require('crypto');
var StreamCounter = require('stream-counter');
var mkdirp = require('mkdirp');

// greater than 5 gigabytes and S3 requires a multipart upload. Multipart
// uploads have a different ETag format. For multipart upload ETags it is
// impossible to tell how te generate the ETag.
// unfortunately we're still assuming that files <= 5 GB were not uploaded with
// via multipart upload.
var MAX_PUTOBJECT_SIZE = 5 * 1024 * 1024 * 1024;

var MAX_DELETE_COUNT = 1000;

exports.createClient = function(options) {
  return new Client(options);
};

exports.Client = Client;

function Client(options) {
  options = options || {};
  this.s3 = options.s3Client || new AWS.S3(options.s3Options);
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
  uploader.progressMd5Amount = 0;
  uploader.progressUploadAmount = 0;
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
      s3Params.Body = inStream;
      s3Params.ContentMD5 = localFileStat.md5sum.toString('base64');
      s3Params.ContentLength = localFileStat.size;
      uploader.progressUploadAmount = 0;
      var counter = new StreamCounter();
      counter.on('progress', function() {
        uploader.progressUploadAmount = counter.bytes;
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
  mkdirp(dirPath, function(err) {
    if (err) {
      downloader.emit('error', err);
      return;
    }

    doWithRetry(doTheDownload, self.s3RetryCount, self.s3RetryDelay, function(err) {
      if (err) {
        downloader.emit('error', err);
        return;
      }
      downloader.emit('end');
    });
  });

  return downloader;

  function doTheDownload(cb) {
    var request = self.s3.getObject(s3Params);
    var response = request.createReadStream();
    var outStream = fs.createWriteStream(localFile);
    var counter = new StreamCounter();
    var errorOccurred = false;

    response.on('error', handleError);
    outStream.on('error', handleError);

    request.on('httpHeaders', function(statusCode, headers, resp) {
      if (statusCode < 300) {
        var contentLength = parseInt(headers['content-length'], 10);
        downloader.progressTotal = contentLength;
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
 *    - EncodingType: 'url',
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
      ee.emit('objects', data);

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
        findAllS3Objects(data.NextMarker, prefix, cb);
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
      EncodingType: 'url',
    },
  };
  var finder = self.listObjects(listObjectsParams);
  var pend = new Pend();
  ee.progressAmount = 0;
  ee.progressTotal = 0;
  finder.on('error', function(err) {
    ee.emit('error', err);
  });
  finder.on('objects', function(objects) {
    ee.progressTotal += objects.length;
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
        ee.progressAmount += objects.length;
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

function syncDir(self, params, directionIsToS3) {
  var ee = new EventEmitter();

  var localDir = params.localDir;
  var localFiles = {};
  var localDirs = {};
  var s3Objects = {};
  var s3Dirs = {};
  var deleteRemoved = params.deleteRemoved === true;
  var prefix = ensureSep(params.s3Params.Prefix);
  var bucket = params.s3Params.Bucket;
  var listObjectsParams = {
    recursive: true,
    s3Params: {
      Bucket: bucket,
      EncodingType: 'url',
      Marker: null,
      MaxKeys: null,
      Prefix: prefix,
    },
  };
  var upDownFileParams = {
    localFile: null,
    localFileStat: null,
    s3Params: extend({}, params.s3Params),
  };
  delete upDownFileParams.s3Params.Prefix;

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
    for (var relPath in s3Objects) {
      var s3Object = s3Objects[relPath];
      var localFileStat = localFiles[relPath];
      if (!localFileStat || !compareETag(s3Object.ETag, localFileStat.md5sum)) {
        downloadOneFile(relPath);
      }
    }
    pend.wait(cb);

    function downloadOneFile(relPath) {
      var fullPath = path.join(localDir, relPath);
      pend.go(function(cb) {
        upDownFileParams.s3Params.Key = prefix + relPath;
        upDownFileParams.localFile = fullPath;
        upDownFileParams.localFileStat = null;
        var downloader = self.downloadFile(upDownFileParams);
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
    var relPath;
    for (relPath in localFiles) {
      var localFileStat = localFiles[relPath];
      var s3Object = s3Objects[relPath];
      if (!s3Object) {
        deleteOneFile(relPath);
      }
    }
    for (relPath in localDirs) {
      var localDirStat = localDirs[relPath];
      var s3Dir = s3Dirs[relPath];
      if (!s3Dir) {
        deleteOneDir(relPath);
      }
    }
    pend.wait(cb);

    function deleteOneDir(relPath) {
      var fullPath = path.join(localDir, relPath);
      pend.go(function(cb) {
        rimraf(fullPath, function(err) {
          // ignore ENOENT errors
          if (err && err.code === 'ENOENT') err = null;
          cb(err);
        });
      });
    }

    function deleteOneFile(relPath) {
      var fullPath = path.join(localDir, relPath);
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
    pend.wait(cb);

    function uploadOneFile(relPath, localFileStat) {
      var fullPath = path.join(localDir, relPath);
      pend.go(function(cb) {
        upDownFileParams.s3Params.Key = prefix + relPath;
        upDownFileParams.localFile = fullPath;
        upDownFileParams.localFileStat = localFileStat;
        var uploader = self.uploadFile(upDownFileParams);
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
    finder.on('objects', function(data) {
      data.Contents.forEach(function(object) {
        var key = object.Key.substring(prefix.length);
        s3Objects[key] = object;
        var dirname = path.dirname(key);
        if (dirname === '.') return;
        s3Dirs[path.dirname(key)] = true;
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
      localDirs[relPath] = stat;
    });
    walker.on('file', function(file, stat) {
      var relPath = path.relative(localDir, file);
      if (stat.size > MAX_PUTOBJECT_SIZE) {
        stat.md5sum = new Buffer(0); // ETag has different format for files this big
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
          stat.md5sum = digest;
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
