var TransformStream = require('stream').Transform;
var util = require('util');
var crypto = require('crypto');

module.exports = MultipartETag;

util.inherits(MultipartETag, TransformStream);
function MultipartETag(options) {
  options = options || {};
  TransformStream.call(this, options);
  var sizes = options.sizes || [
    5 * 1024 * 1024, // minimum multipart upload size
    15 * 1024 * 1024, // s3cmd uses 15MB for the default
  ];
  this.sums = [];
  for (var i = 0; i < sizes.length; i += 1) {
    this.sums.push({
      size: sizes[i],
      hash: crypto.createHash('md5'),
      amtWritten: 0,
      digests: [],
      eTag: null,
    });
  }
}

MultipartETag.prototype._transform = function(chunk, encoding, callback) {
  for (var i = 0; i < this.sums.length; i += 1) {
    var sumObj = this.sums[i];
    var newAmtWritten = sumObj.amtWritten + chunk.length;
    if (newAmtWritten <= sumObj.size) {
      sumObj.amtWritten = newAmtWritten;
      sumObj.hash.update(chunk, encoding);
    } else {
      var finalBytes = sumObj.size - sumObj.amtWritten;
      sumObj.hash.update(chunk.slice(0, finalBytes), encoding);
      sumObj.digests.push(sumObj.hash.digest());
      sumObj.hash = crypto.createHash('md5');
      sumObj.hash.update(chunk.slice(finalBytes), encoding);
      sumObj.amtWritten = chunk.length - finalBytes;
    }
  }
  callback();
};

MultipartETag.prototype._flush = function(callback) {
  for (var i = 0; i < this.sums.length; i += 1) {
    var sumObj = this.sums[i];
    sumObj.digests.push(sumObj.hash.digest());
    var finalHash = crypto.createHash('md5');
    for (var partIndex = 0; partIndex < sumObj.digests.length; partIndex += 1) {
      var digest = sumObj.digests[partIndex];
      finalHash.update(digest);
    }
    sumObj.eTag = finalHash.digest('hex') + '-' + sumObj.digests.length;
  }
  this.push(null);
  callback();
};
