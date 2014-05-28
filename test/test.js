var s3 = require('../');
var path = require('path');
var ncp = require('ncp');
var Pend = require('pend');
var assert = require('assert');
var fs = require('fs');
var mkdirp = require('mkdirp');
var crypto = require('crypto');
var rimraf = require('rimraf');
var tempDir = path.join(__dirname, 'tmp');
var localFile = path.join(tempDir, 'random');
var remoteRoot = "node-s3-test/";
var remoteFile = remoteRoot + "file.png";
var remoteFile2 = remoteRoot + "file2.png";
var remoteFile3 = remoteRoot + "file3.png";
var remoteDir = remoteRoot + "dir1";

var describe = global.describe;
var it = global.it;
var after = global.after;

var s3Bucket = process.env.S3_BUCKET;

if (!s3Bucket || !process.env.S3_KEY || !process.env.S3_SECRET) {
  console.log("S3_BUCKET, S3_KEY, and S3_SECRET env vars needed to run tests");
  process.exit(1);
}

function createClient() {
  return s3.createClient({
    s3Options: {
      accessKeyId: process.env.S3_KEY,
      secretAccessKey: process.env.S3_SECRET,
    },
  });
}

function createBigFile(size, cb) {
  mkdirp(tempDir, function(err) {
    if (err) return cb(err);
    var md5sum = crypto.createHash('md5');
    var out = fs.createWriteStream(localFile);
    out.on('error', function(err) {
      cb(err);
    });
    out.on('close', function() {
      cb(null, md5sum.digest('hex'));
    });
    var str = "abcdefghijklmnopqrstuvwxyz";
    for (var i = 0; i < size; ++i) {
      out.write(str);
      md5sum.update(str);
    }
    out.end();
  });
}

describe("s3", function () {
  var hexdigest;

  after(function(done) {
    rimraf(tempDir, done);
  });

  it("get public URL", function() {
    var httpsUrl = s3.getPublicUrl("mybucket", "path/to/key");
    assert.strictEqual(httpsUrl, "https://s3.amazonaws.com/mybucket/path/to/key");
    var httpUrl = s3.getPublicUrlHttp("mybucket", "path/to/key");
    assert.strictEqual(httpUrl, "http://mybucket.s3.amazonaws.com/path/to/key");
    // treat slashes literally
    httpsUrl = s3.getPublicUrl("marina-restaurant.at", "uploads/about_restaurant_10.jpg", "eu-west-1");
    assert.strictEqual(httpsUrl,
      "https://s3-eu-west-1.amazonaws.com/marina-restaurant.at/uploads/about_restaurant_10.jpg")
  });

  it("uploads", function(done) {
    createBigFile(4000, function (err, _hexdigest) {
      if (err) return done(err);
      hexdigest = _hexdigest;
      var client = createClient();
      var params = {
        localFile: localFile,
        s3Params: {
          Key: remoteFile,
          Bucket: s3Bucket,
        },
      };
      var uploader = client.uploadFile(params);
      uploader.on('error', done);
      var progress = 0;
      var progressEventCount = 0;
      uploader.on('progress', function() {
        var amountDone = uploader.progressAmount;
        var amountTotal = uploader.progressTotal;
        var newProgress = amountDone / amountTotal;
        progressEventCount += 1;
        assert(newProgress >= progress, "old progress: " + progress + ", new progress: " + newProgress);
        progress = newProgress;
      });
      uploader.on('end', function(url) {
        assert.strictEqual(progress, 1);
        assert(progressEventCount >= 2, "expected at least 2 progress events. got " + progressEventCount);
        assert(url !== "", "expected a url. got " + url);
        done();
      });
    });
  });

  it("downloads", function(done) {
    fs.unlink(localFile, function(err) {
      if (err) return done(err);
      var client = createClient();
      var params = {
        localFile: localFile,
        s3Params: {
          Key: remoteFile,
          Bucket: s3Bucket,
        },
      };
      var downloader = client.downloadFile(params);
      downloader.on('error', done);
      var progress = 0;
      var progressEventCount = 0;
      downloader.on('progress', function() {
        var amountDone = downloader.progressAmount;
        var amountTotal = downloader.progressTotal;
        var newProgress = amountDone / amountTotal;
        progressEventCount += 1;
        assert(newProgress >= progress, "old progress: " + progress + ", new progress: " + newProgress);
        progress = newProgress;
      });
      downloader.on('end', function() {
        assert.strictEqual(progress, 1);
        assert(progressEventCount >= 3, "expected at least 3 progress events. got " + progressEventCount);
        var reader = fs.createReadStream(localFile);
        var md5sum = crypto.createHash('md5');
        reader.on('data', function(data) {
          md5sum.update(data);
        });
        reader.on('end', function() {
          assert.strictEqual(md5sum.digest('hex'), hexdigest);
          fs.unlink(localFile, done);
        });
      });
    });
  });

  it("lists objects", function(done) {
    var params = {
      recursive: true,
      s3Params: {
        Bucket: s3Bucket,
        Prefix: remoteRoot,
      },
    };
    var client = createClient();
    var finder = client.listObjects(params);
    var found = false;
    finder.on('data', function(data) {
      assert.strictEqual(data.Contents.length, 1);
      found = true;
    });
    finder.on('end', function() {
      assert.strictEqual(found, true);
      done();
    });
  });

  it("copies an object", function(done) {
    var s3Params = {
      Bucket: s3Bucket,
      CopySource: s3Bucket + '/' + remoteFile,
      Key: remoteFile2,
    };
    var client = createClient();
    var copier = client.copyObject(s3Params);
    copier.on('end', function(data) {
      done();
    });
  });

  it("moves an object", function(done) {
    var s3Params = {
      Bucket: s3Bucket,
      CopySource: s3Bucket + '/' + remoteFile2,
      Key: remoteFile3,
    };
    var client = createClient();
    var copier = client.moveObject(s3Params);
    copier.on('end', function(data) {
      done();
    });
  });

  it("deletes an object", function(done) {
      var client = createClient();
      var params = {
        Bucket: s3Bucket,
        Delete: {
          Objects: [
            {
              Key: remoteFile,
            },
            {
              Key: remoteFile3,
            },
          ],
        },
      };
      var deleter = client.deleteObjects(params);
      deleter.on('end', function() {
        done();
      });
  });

  it("uploads a folder", function(done) {
    var client = createClient();
    var params = {
      localDir: path.join(__dirname, "dir1"),
      s3Params: {
        Prefix: remoteDir,
        Bucket: s3Bucket,
      },
    };
    var uploader = client.uploadDir(params);
    uploader.on('end', function() {
      done();
    });
  });

  it("downloads a folder", function(done) {
    var client = createClient();
    var localDir = path.join(tempDir, "dir-copy");
    var params = {
      localDir: localDir,
      s3Params: {
        Prefix: remoteDir,
        Bucket: s3Bucket,
      },
    };
    var downloader = client.downloadDir(params);
    downloader.on('end', function() {
      assertFilesMd5([
        {
          path: path.join(localDir, "file1"),
          md5: "b1946ac92492d2347c6235b4d2611184",
        },
        {
          path: path.join(localDir, "file2"),
          md5: "6f0f1993fceae490cedfb1dee04985af",
        },
        {
          path: path.join(localDir, "inner1/a"),
          md5: "ebcb2061cab1d5c35241a79d27dce3af",
        },
        {
          path: path.join(localDir, "inner2/b"),
          md5: "c96b1cbe66f69b234cf361d8c1e5bbb9",
        },
      ], done);
    });
  });

  it("uploadDir with deleteRemoved", function(done) {
    var client = createClient();
    var params = {
      localDir: path.join(__dirname, "dir2"),
      deleteRemoved: true,
      s3Params: {
        Prefix: remoteDir,
        Bucket: s3Bucket,
      },
    };
    var uploader = client.uploadDir(params);
    uploader.on('end', function() {
      done();
    });
  });

  it("lists objects", function(done) {
    var params = {
      recursive: true,
      s3Params: {
        Bucket: s3Bucket,
        Prefix: remoteDir,
      },
    };
    var client = createClient();
    var finder = client.listObjects(params);
    var found = false;
    finder.on('data', function(data) {
      assert.strictEqual(data.Contents.length, 2);
      assert.strictEqual(data.CommonPrefixes.length, 0);
      found = true;
    });
    finder.on('end', function() {
      assert.strictEqual(found, true);
      done();
    });
  });

  it("downloadDir with deleteRemoved", function(done) {
    var localDir = path.join(__dirname, "dir1");
    var localTmpDir = path.join(tempDir, "dir1");
    ncp(localDir, localTmpDir, function(err) {
      if (err) throw err;

      var client = createClient();
      var localDir = path.join(tempDir, "dir-copy");
      var params = {
        localDir: localTmpDir,
        deleteRemoved: true,
        s3Params: {
          Prefix: remoteDir,
          Bucket: s3Bucket,
        },
      };
      var downloader = client.downloadDir(params);
      downloader.on('end', function() {
        assertFilesMd5([
          {
            path: path.join(localTmpDir, "file1"),
            md5: "b1946ac92492d2347c6235b4d2611184",
          },
          {
            path: path.join(localTmpDir, "inner1/a"),
            md5: "ebcb2061cab1d5c35241a79d27dce3af",
          },
        ], function(err) {
          if (err) throw err;
          assert.strictEqual(fs.existsSync(path.join(localTmpDir, "file2")), false);
          assert.strictEqual(fs.existsSync(path.join(localTmpDir, "inner2/b")), false);
          assert.strictEqual(fs.existsSync(path.join(localTmpDir, "inner2")), false);
          done();
        });
      });
    });
  });

  it("deletes a folder", function(done) {
    var client = createClient();
    var s3Params = {
      Prefix: remoteRoot,
      Bucket: s3Bucket,
    };
    var deleter = client.deleteDir(s3Params);
    deleter.on('end', function() {
      done();
    });
  });
});

function assertFilesMd5(list, cb) {
  var pend = new Pend();
  list.forEach(function(o) {
    pend.go(function(cb) {
      var inStream = fs.createReadStream(o.path);
      var hash = crypto.createHash('md5');
      inStream.pipe(hash);
      hash.on('data', function(digest) {
        var hexDigest = digest.toString('hex');
        assert.strictEqual(hexDigest, o.md5, o.path + " md5 mismatch");
        cb();
      });
    });
  });
  pend.wait(cb);
}
