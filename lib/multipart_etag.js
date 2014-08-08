var TransformStream = require('stream').Transform;
var util = require('util');
var crypto = require('crypto');

module.exports = MultipartETag;

util.inherits(MultipartETag, TransformStream);
function MultipartETag(options) {
  options = options || {};
  TransformStream.call(this, options);
  var sizes = [
    5 * 1024 * 1024, // minimum multipart upload size
    15 * 1024 * 1024, // this is the default for both s3cmd and this project
    5 * 1024 * 1024 * 1024, // maximum upload size
  ];
  if (options.size != null && options.count != null) {
    sizes.push(guessPartSizeFromSizeAndCount(options.size, options.count));
  }
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
    var digest = sumObj.hash.digest();
    sumObj.digests.push(digest);
    if (sumObj.digests.length > 1) {
      var finalHash = crypto.createHash('md5');
      for (var partIndex = 0; partIndex < sumObj.digests.length; partIndex += 1) {
        digest = sumObj.digests[partIndex];
        finalHash.update(digest);
      }
      sumObj.eTag = finalHash.digest('hex') + '-' + sumObj.digests.length;
    } else {
      sumObj.eTag = digest;
    }
  }
  this.push(null);
  callback();
};

function guessPartSizeFromSizeAndCount(size, count) {
  var divided = size / count;
  var floored = Math.floor(divided);
  return (divided === floored) ? divided : (floored + 1);
}
