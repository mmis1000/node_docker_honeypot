var fs = require('fs'),
    crypto = require('crypto'),
    inspect = require('util').inspect,
    child_process = require('child_process');
var ssh2 = require('ssh2'),
    utils = ssh2.utils;
var pty = require('pty.js');

var readline = require('readline');

var LoggerStream = require('./transform_logger')

var fs = require('fs');
var path = require('path');

var container = null;

var Docker = require('./docker.js');

var logFolder = 'logs'

Docker.create([
	//'--net=none',
	'--cpuset-cpus=1',
	'-m=200M',
	'-h', 'mmis1000-G1-7528-pot'
], 'ubuntu')
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
  privateKey: fs.readFileSync('keys/id_rsa'),
}, function(client, info) {
	var connectionId = getId(8);
	var ip = info.ip;
	var clientType = info.header.identRaw;
	
  console.log(connectionId + ': ' + 'Client connected!');
  console.log(connectionId + ': ' + 'using ' + clientType + ' from ' + ip);
	var term, terminal, user = null, passowrd = null;
	
  client.on('authentication', function(ctx) {
		user = ctx.username;

		if (!ctx.username.match(/^[a-z_][a-z0-9_]{0,29}[a-z0-9]$/)) {
			return ctx.reject();
		} else if (ctx.method !== 'password') {
      return ctx.reject(['password']);
		} else {
			passowrd = ctx.password;
			console.log(connectionId + ': ' + user + ' authed using password: ' + passowrd)
			ctx.accept();
		}
  }).on('ready', function() {
    console.log(connectionId + ': ' + 'Client authenticated!');

    client.on('session', function(accept, reject) {
			console.log(connectionId + ': ' + 'Client create session!');
			var rows, cols;
      var session = accept();
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
    });
  }).on('end', function() {
    console.log('Client disconnected');
		quitTerm(terminal);
  }).on('error', function(err) {
    console.log('Client error', err);
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
