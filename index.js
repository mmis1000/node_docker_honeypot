var fs = require('fs'),
    crypto = require('crypto'),
    inspect = require('util').inspect,
    child_process = require('child_process');
var ssh2 = require('ssh2'),
    utils = ssh2.utils;
var pty = require('pty.js');


var buffersEqual = require('buffer-equal-constant-time');
var readline = require('readline');

var LoggerStream = require('./transform_logger')

var fs = require('fs');
var path = require('path');

var container = null;

var Docker = require('./docker.js');

var logFolder = 'logs'

var pubKey = utils.genPublicKey(utils.parseKey(fs.readFileSync('keys/client.pub')));

Docker.create([
	//'--net=none',
	'--cpuset-cpus=1',
	'-m=200M',
	'-h', 'mmis1000-G1-7528-pot',
	'--privileged=false',
	'--kernel-memory=10M',
	'--pids-limit=20'
], 'mmis1000/test:v2')
.then(function (docker) {
	console.log('starting docekr...')
	container = docker;
	return docker.start();
})
.then(function (docker) {
	console.log("id of container is: " + docker.id)
	
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
})

function quitTerm(term) {
	if (!term || term.issuedQuit) return;
	term.issuedQuit = true;
	console.log('');
	try {
		term.write('\u0004');
		setTimeout(function () {
			try {
				term.end();
			} catch (e) {
				console.log(e);
			}
		}, 1000)
	} catch (e) {
		console.log(e);
	}
	
}

function getId (len) {
	var _sym = 'abcdef1234567890';
	var str = '';
	var pos;
	while (str.length < len) {
		pos = Math.floor(_sym.length * Math.random());
		str += _sym.slice(pos, pos + 1);
	}
	return str;
}

new ssh2.Server({
  hostKeys: [fs.readFileSync('keys/id_rsa')],
  debug: function (str) {
  	console.log('DEBUG: ' + str);
  }
}, function(client, info) {
	var connectionId = getId(8);
	var ip = info.ip;
	var clientType = info.header.identRaw;
	
  console.log(connectionId + ': Client connected!');
  console.log(connectionId + ': using ' + clientType + ' from ' + ip);
	console.log(connectionId + ': connected with info: ' + JSON.stringify(info));
	var term, terminal, user = null, passowrd = null;
	
  client.on('authentication', function(ctx) {
		user = ctx.username;

		if (!ctx.username.match(/^[a-z_][a-z0-9_]{0,29}[a-z0-9]$/)) {
			return ctx.reject();
		} else if (ctx.method === 'publickey'
             && ctx.key.algo === pubKey.fulltype
             && buffersEqual(ctx.key.data, pubKey.public)) {
      if (ctx.signature) {
        var verifier = crypto.createVerify(ctx.sigAlgo);
        verifier.update(ctx.blob);
        if (verifier.verify(pubKey.publicOrig, ctx.signature))
          ctx.accept();
        else
          ctx.reject();
      } else {
        // if no signature present, that means the client is just checking
        // the validity of the given public key
        ctx.accept();
      }
    } else if (ctx.method === 'password'){
			passowrd = ctx.password;
			console.log(connectionId + ': ' + user + ' authed using password: ' + passowrd)
			ctx.accept();
		} else {
			console.log(connectionId + ': trying to auth with ' + ctx.method + ' but not supported')
			ctx.reject(['publickey', 'password'])
		}
  }).on('ready', function() {
    console.log(connectionId + ': ' + 'Client authenticated!');

    client.on('session', function(accept, reject) {
			console.log(connectionId + ': ' + 'Client create session!');
			var rows, cols;
      var session = accept();
			session.on('env', function (accept, reject, info) {
				console.log(connectionId + ': ' + 'client want to set ' + info.key + ' to ' + info.val)
				accept && accept();
			})
      session.once('pty', function(accept, reject, info) {
				console.log(connectionId + ': ' + 'client request pty with ' + JSON.stringify(info))
        rows = info.rows;
        cols = info.cols;
        term = info.term;
        accept && accept();
      });
			session.once('shell', function(accept, reject, info) {
        var stream = accept();
        stream.write('Dear cute bee~~\r\n');
				
				terminal && quitTerm(terminal);
				
				
				container.getUserId(user)
				.then(function (res) {
					if (res === null) {
						return container.createUser(user, passowrd)
					}
					return null;
				})
				.then(function (res) {
					if (res) {
						console.log(connectionId + ': ' + 'user ' + user + ' created')
					}
					
					terminal = container.getPty(cols, rows, user);
					
					terminal.on('close', function () {
						console.log(connectionId + ': ' + 'client closed');
						stream.exit(0);
						stream.end();
					})
					stream.pipe(terminal)
					
					logInputStream(stream, connectionId, ip, clientType)
					
					terminal.pipe(stream)
				})
				.catch(function (err) {
					console.log('err', err)
				})
				
      });
			session.on('signal', function(accept, reject, info) {
        accept && accept();
      });
			session.on('window-change', function (accept, reject, info) {
				console.log(connectionId + ': ' + 'client change pty screen size with ' + JSON.stringify(info))
        accept && accept();
				terminal && terminal.resize(info.cols, info.rows);
			
			})
			
      session.once('exec', function(accept, reject, info) {
      	
				container.getUserId(user)
				.then(function (res) {
					if (res === null) {
						return container.createUser(user, passowrd)
					}
					return null;
				})
				.then(function (res) {
	        console.log('Client wants to execute: ' + inspect(info.command));
	        var stream = accept();
	        var commandToRun;
	        if (user === 'root') {
	        	commandToRun = /*'cd /root;' + */info.command;
	        } else {
	        	commandToRun = /*'cd /home/'+ user + ';' + */info.command;
	        }
	        
	        /*stream.stderr.write('Oh no, the dreaded errors!\n');
	        stream.write('Just kidding about the errors!\n');
	        stream.exit(0);
	        stream.end();*/
	        var commandProcess = container.spawnInDocker(commandToRun);
	        
	        var stdinLogFilePath = path.resolve(logFolder, connectionId + '-exec-stdin-' + Date.now() + '.log')
	        var logFilePath = path.resolve(logFolder, connectionId + '-exec-' + Date.now() + '.log')
	        
	        
	        
	        console.log('log file at ' + stdinLogFilePath + '\r\nand ' + logFilePath)
	        // stream.stdin.pipe(fs.createWriteStream(stdinLogFilePath));
	        // stream.stdin.pipe(process.stdout)
	        stream.pipe(fs.createWriteStream(stdinLogFilePath + '.2'));
	        // stream.pipe(process.stdout)
	        
	        fs.writeFile(logFilePath, info.command);
	        
	        stream.pipe(commandProcess.stdin)
	        commandProcess.stderr.pipe(stream.stderr);
	        commandProcess.stdout.pipe(stream, {end: false});
	        
	        commandProcess.stdout.pipe(process.stdout);
	        commandProcess.stderr.pipe(process.stdout);
	        commandProcess.stdout.on('end', function(e) {
	      		console.log('command finished')
		        stream.exit(0);
		        stream.end();
	        })
	        commandProcess.on('error', function (e) {
	      		console.log('command failed ' + inspect(e))
	        	try {
	        		stream.exit(0);
	        		stream.end();
	        	} catch (e) {
	        		console.log('bad exit ' + inspect(e))
	        	}
	        })
				})
      });
    });
  }).on('end', function() {
    console.log(connectionId + ': ' + 'Client disconnected');
		quitTerm(terminal);
  }).on('error', function(err) {
    console.log(connectionId + ': ' + 'Client error', err);
		quitTerm(terminal);
    // ignore errors
  });
}).listen(22, function() {
  console.log('Listening on port ' + this.address().port);
});

function logInputStream (stream, id, ip, clientType) {
	var logger = new LoggerStream(id);
	logger.pipe(process.stdout);
	
	var fileStream = fs.createWriteStream(path.resolve(__dirname, logFolder, 'tcp_dump_' + id + '_' + (new Date()).toISOString()) + '_' + ip)
	fileStream.write('using clinet ' + clientType + '\r\n');
	
	stream.pipe(logger);
	stream.pipe(fileStream);
	
}



process.stdin.resume();//so the program will not close instantly
process.nextTick(function() {
	
function exitHandler(options, err) {
  if (err) {
    console.log(err.stack);
  }
  if (options.exit) {
    if (container) {
			
			container.remove(true, true)
			.then(function() {
				console.log('container killed... bye');
				process.exit()
			})
			.catch(function() {
				console.log('fail to kill container ' + container.id + ' \r\n[warning] bad exit');
				process.exit(1)
			})
		} else {
			process.nextTick(function () {
				process.exit()
			})
		}
  };
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

//catches signal
process.on('SIGTERM', exitHandler.bind(null, {exit:true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
});
