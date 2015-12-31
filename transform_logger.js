var stream = require('stream');
var util = require ('util');
function loggerStream (prefix) {
	stream.Duplex.call(this);
	this.readCalled = false;
	this.prefix = prefix || "log"
	this.bufs = [];
}
util.inherits(loggerStream, stream.Duplex);

loggerStream.prototype._read = function _read() {
	if (!this.readCalled) this.bufs.push(new Buffer(this.prefix + ': writed '));
	this.readCalled = true;
	this.outputBuffer();
}
loggerStream.prototype._write = function _write(chunk, encoding, callback) {
	var arr = [];
	var char;
	for (var i = 0; i < chunk.length; i++) {
		char = chunk[i];
		if (char === 10 || char === 13) {
			arr.push('\r\n' + this.prefix + ': writed ');
			continue
		}
		if (char < 32 || char > 126) {
			arr.push('\\x' + (char.toString().length === 1 ? "0" + char.toString(16) : char.toString(16)) + "");
			continue
		}
		if (!Array.isArray(arr[arr.length - 1])) {
			arr.push([]);
		}
		arr[arr.length - 1].push(char);
	}
	arr = arr.map(function (item) {
		return new Buffer(item);
	})
	var result = Buffer.concat(arr);
	this.bufs.push(result);
	callback();
	if (this.readCalled) this.outputBuffer();
}
loggerStream.prototype.outputBuffer = function outputBuffer(chunk) {
	var result = Buffer.concat(this.bufs);
	
	var pointer = -1;
	var i;
	
	for (i = 0 ;i < result.length; i++) {
		if (result[i] === 10 || result[i] === 13) {
			pointer = i;
		}
	}
	
	if (pointer < 0) {
		return;
	}
	
	var buffToPush = result.slice(0, pointer + 1);
	var remaining = result.slice(pointer + 1);
	
	
	this.bufs = [remaining];
	this.push(buffToPush)
}

module.exports = loggerStream;
