var knox = require('knox')
  , EventEmitter = require('events').EventEmitter
  , fs = require('fs');

exports.createClient = function(options) {
  var client = new Client();
  client.knox = knox.createClient(options);
  return client;
};

exports.fromKnox = function(knoxClient) {
  var client = new Client();
  client.knox = knoxClient;
  return client;
}

function Client(options) {}

Client.prototype.upload = function(localFile, remoteFile, headers) {
  
  if (typeof headers != 'object')
    headers = { };
  
  var uploader = new EventEmitter();
  var knoxUpload = this.knox.putFile(localFile, remoteFile, headers, function (err, resp) {
    if (err) {
      uploader.emit('error', err);
    } else if (resp.statusCode === 200) {
      uploader.emit('end');
    } else {
      uploader.emit('error', new Error("s3 http status code " + resp.statusCode));
    }
  });
  knoxUpload.on('progress', function (progress) {
    uploader.emit('progress', progress.written, progress.total);
  });
  return uploader;
};

Client.prototype.download = function(remoteFile, localFile) {
  var downloader = new EventEmitter();
  var amountDone = 0;
  var amountTotal;
  var writeStream;
  var knoxDownload = this.knox.getFile(remoteFile, function (err, resp) {
    if (err) {
      downloader.emit('error', err);
    } else if (resp.statusCode === 200) {
      amountTotal = parseInt(resp.headers['content-length'], 10);
      var writeStream = fs.createWriteStream(localFile);
      writeStream.on('error', onError);
      resp.on('error', onError);
      resp.on('end', onSuccess);
      resp.on('data', onData);
      resp.pipe(writeStream);
    } else {
      downloader.emit('error', new Error("s3 http status code" + resp.statusCode));
    }
    function removeListeners() {
      writeStream.removeListener('error', onError);
      resp.removeListener('error', onError);
      resp.removeListener('end', onSuccess);
    }
    function onError(err) {
      removeListeners();
      writeStream.destroy();
      downloader.emit('error', err);
    }
    function onSuccess() {
      removeListeners();
      writeStream.end();
      downloader.emit('end');
    }
    function onData(data) {
      amountDone += data.length;
      downloader.emit('progress', amountDone, amountTotal);
    }
  });
  return downloader;
};
