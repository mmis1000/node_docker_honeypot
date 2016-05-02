var Q = require('q');
var child_process = require('child_process');
var pty = require('pty.js');
var EventEmitter = require('events').EventEmitter;
var util = require('util')

var execP = Q.denodeify(child_process.exec);
var execFileP =  Q.denodeify(child_process.execFile);
function Docker(args, image) {
	EventEmitter.call(this);
	
	this.id = null;
	this.info = null;
	
	this.lastCommandResult = null;
	
	var self = this;
	args = args || [];
	
	var args = ['create'].concat(args.concat([image].concat('/sbin/init')));
	console.log(args, 'docker '  + args.join(' '));
	
	execP('docker '  + args.join(' '))
	.then(function (res) {
		self.id = res[0].replace(/^[\s\r\n]*|[\s\r\n]*$/g, '');
		console.log('created', self.id);
		self.emit('created', self.id);
		return self.inspect();
	})
	.then(function (info) {
		self.info = info;
		/*
		return self.start();
	})
	.then(function () {*/
		self.emit('ready', this);
	})
	.catch(function (e) {
		self.clear();
		console.error('error', e);
		self.emit('error', e);
	})
}
util.inherits(Docker, EventEmitter);

Docker.create = function (args, image) {
	var docker = new Docker(args, image);
	var deferred = Q.defer();
	docker
	.once('ready', function () {
		deferred.resolve(docker);
	})
	.once('error', function (err) {
		deferred.reject(err);
	})
	return deferred.promise;
}
Docker.removeAll = function () {
	var deferred = Q.defer();
	execP('docker rm -f $(docker ps -aq)')
	.then(function (res) {
		deferred.resolve(JSON.parse(res[0])[0]);
	})
	.catch(function (err) {
		deferred.reject(err);
	})
	return deferred.promise;
}
Docker.prototype.inspect = function inspect() {
	var deferred = Q.defer();
	execP('docker inspect ' + this.id)
	.then(function (res) {
		deferred.resolve(JSON.parse(res[0])[0]);
	})
	.catch(function (err) {
		deferred.reject(err);
	})
	return deferred.promise;
}
Docker.prototype.clear = function clear(force) {
	if (!this.id) throw new Error('not created container');
	
	var command = force ? 'docker rm -f ' + this.id : 'docker rm ' + this.id
	var deferred = Q.defer();
	
	console.log(command);
	execP(command)
	.then(function (res) {
		deferred.resolve(JSON.parse(res[0]));
	})
	.catch(function (err) {
		deferred.reject(err);
	})
	return deferred.promise;
}
Docker.prototype.start = function start() {
	if (!this.id) throw new Error('not created container');
	var self = this;
	var deferred = Q.defer();
	
	execP('docker start '+ this.id)
	.then(function (res) {
		deferred.resolve(self);
	})
	.catch(function (err) {
		deferred.reject(err);
	})
	return deferred.promise;
}

Docker.prototype.stop = function start() {
	if (!this.id) throw new Error('not created container');
	var self = this;
	var deferred = Q.defer();
	
	execP('docker stop '+ this.id)
	.then(function (res) {
		deferred.resolve(self);
	})
	.catch(function (err) {
		deferred.reject(err);
	})
	return deferred.promise;
}

Docker.prototype.remove = function remove(force, ignoreError) {
	if (!this.id) throw new Error('not created container');
	var self = this;
	var deferred = Q.defer();
	
	var command = force ? "docker rm -f " : "docker rm "
	command += this.id;
	
	execP(command)
	.then(function (res) {
		self.id = null;
		deferred.resolve(self);
	})
	.catch(function (err) {
		if (ignoreError) {
			return deferred.resolve(self);
		}
		deferred.reject(err);
	})
	return deferred.promise;
}
Docker.prototype.setWriteLimit = function setWriteLimit(speed, device) {
	device = device || '/dev/mapper/' + this.info.GraphDriver.Data.DeviceName;
	var self = this;
	// sudo systemctl set-property --runtime docker-d2115072c442b0453b3df3b16e8366ac9fd3defd4cecd182317a6f195dab3b88.scope "BlockIOWriteBandwidth=/dev/mapper/docker-253:0-3408580-d2115072c442b0453b3df3b16e8366ac9fd3defd4cecd182317a6f195dab3b88 10M"
	// BlockIOWriteBandwidth
	var runtime = 'docker-' + this.info.Id + '.scope';
	var command = 'systemctl set-property --runtime ' + runtime + ' "BlockIOWriteBandwidth=' + device + ' ' + speed + '"';
	var deferred = Q.defer();
	// console.log(command);
	execP(command)
	.then(function (res) {
		deferred.resolve(self);
	})
	.catch(function (err) {
		deferred.reject(err);
	})
	return deferred.promise;
	
}
Docker.prototype.setReadLimit = function setReadLimit(speed, device) {
	device = device || '/dev/mapper/' + this.info.GraphDriver.Data.DeviceName;
	var self = this;
	// sudo systemctl set-property --runtime docker-d2115072c442b0453b3df3b16e8366ac9fd3defd4cecd182317a6f195dab3b88.scope "BlockIOReadBandwidth=/dev/mapper/docker-253:0-3408580-d2115072c442b0453b3df3b16e8366ac9fd3defd4cecd182317a6f195dab3b88 10M"
	// BlockIOReadBandwidth 
	var runtime = 'docker-' + this.info.Id + '.scope';
	var command = 'systemctl set-property --runtime ' + runtime + ' "BlockIOReadBandwidth=' + device + ' ' + speed + '"';
	// console.log(command);
	var deferred = Q.defer();
	execP(command)
	.then(function (res) {
		deferred.resolve(self);
	})
	.catch(function (err) {
		deferred.reject(err);
	})
	return deferred.promise;
}

Docker.prototype.execCommandInDcoker = function execCommandInDcoker(command, suppressError) {
	var self = this;
	var deferred = Q.defer();
	execFileP('docker' ,[
		'exec',
		this.id,
		'bash',
		'-c',
		command
	])
	.then(function (res) {
		deferred.resolve(res);
	})
	.catch(function (err) {
		this.lastError = err;
		if (suppressError) {
			return deferred.resolve([]);
		}
		deferred.reject(err);
	})
	return deferred.promise;
}

Docker.prototype.getUserId = function getUserId(userName) {
	var deferred = Q.defer();
	this.execCommandInDcoker('id -u ' + userName + ' 2>dev/null')
	.then(function (res) {
		deferred.resolve(parseInt(res[0], 10));
	})
	.catch(function (err) {
		deferred.resolve(null);
	})
	return deferred.promise;
}

Docker.prototype.createUser = function createUser(userName, password) {
	password = password || 'pa$$w0rd'
	var deferred = Q.defer();
	this.execCommandInDcoker(
		'addgroup $1; useradd $1 -s /bin/bash -m -g $1 -G sudo; echo $1:$2 | sudo chpasswd;'
		.replace(/\$1/g, userName)
		.replace(/\$2/g, password))
	.then(function (res) {
		deferred.resolve(res);
	})
	.catch(function (err) {
		deferred.reject(err);
	})
	return deferred.promise;
}

Docker.prototype.getPty = function getPty(cols, rows, user) {
	user = user || 'root';
	
	var terminal = pty.spawn('docker', [
		'exec',
		'-it',
		'-u', user,
		this.id,
		
		'env',
		'TERM=xterm',
		
		'script',
		'-q',
		'-c',
		'/bin/bash -l',
		'/dev/null'
		
		//'env',
		//'TERM=xterm',
		//'bash',
		//'-l'
	], {
		name: 'xterm-color',
		cols: cols,
		rows: rows,
		cwd: process.env.HOME,
		env: process.env
	});
	return terminal;
}

module.exports = Docker;
/*
Docker.create([
	'--net=none',
	'--cpuset-cpus=1',
	'-m=200M',
	'-h', 'mmis1000-G1-7528'
], 'ubuntu')
.then(function (docker) {
	console.log('starting docekr...')
	return docker.start()
})
.then(function (docker) {
	console.log(docker.info)
	
	console.log('limiting write io...')
	return docker.setWriteLimit('1M', '/dev/sda');
})
.then(function (docker) {
	console.log('limiting write io...')
	return docker.setWriteLimit('1M');
})
.then(function (docker) {
	console.log('limiting read io...')
	return docker.setReadLimit('1M', '/dev/sda');
})
.then(function (docker) {
	console.log('limiting read io...')
	return docker.setReadLimit('1M');
})
.then(function (docker) {
	console.log('finished')
})
.catch(function (err) {
	console.log(err.stack ? err.stack : err.toString());
}
*/

/*
.then(function () {
	return Docker.removeAll()
})
.then(function () {
	console.log('bye bye')
})*/