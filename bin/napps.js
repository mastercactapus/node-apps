#!/usr/bin/env node
var path = require("path");
var cli = require("commander");
var Q = require("q");
var request = require("request");
var fs = require("fs");
var napp = require("../lib/napp");
var cp = require("child_process");
var os = require("os");
var _ = require("lodash");

var daemonsocket = path.join(napp.basedir, "daemon.socket");


cli.command("add <appname> <scriptfile>")
.option("--start", "start the application immediately")
.option("--cwd <dir>", "set working directory [default: current]", process.cwd())
.option("--port <port>", "set PORT variable [default: use env]", process.env.PORT)
.option("-i, --instances <num>", "number of instances [default: cpu cores]", os.cpus().length)
.description("Add an application (saves cwd and env)")
.action(function(name, script, opts){
	var env = _.clone(process.env);
	env.PORT = opts.port;

	var cfg = {
		env: env,
		cwd: opts.cwd,
		id: name,
		exec: path.resolve(script),
		instances: opts.instances
	};
	addApp(cfg, opts.start);
});

cli.command("restart <name>")
.description("Gracefully restart an application (--force to skip shutdown)")
.option("--force", "Restart without sending shutdown signal")
.action(function(name, opts){
	ensureDaemon(true)
	.then(daemonRequest.bind(null, "/apps/" + name + "/" + (opts.force ? "restart" : "reload"), null, "POST"))
	.done();
});

cli.command("start <name>")
.description("Start an application")
.action(function(name){
	ensureDaemon(true)
	.then(daemonRequest.bind(null, "/apps/" + name + "/start", null, "POST"))
	.done();
});

cli.command("stop <name>")
.description("Stop a running application")
.action(function(name){
	ensureDaemon(true)
	.then(daemonRequest.bind(null, "/apps/" + name + "/stop", null, "POST"))
	.done();
});



cli.command("update <name>")
.description("Update the configuration of an application (usefull for changin number of instances)");

cli.command("logs [name[:workerId]]")
.description("View streaming logs from running applications, or just one")
.action(function(app){
	var uri;
	if (app) {
		var split = app.split(":");
		uri = "/apps/" + split[0] + "/log" + (split.length > 1 ? "/" + split[1] : "");
	} else {
		uri = "/logs";
	}
	var logs = getLogs(uri);
	logs.pipe(process.stdout); 
});

cli.command("status <name>")
.description("View the status of an application")
.action(function(name){
	ensureDaemon(true)
	.then(daemonRequest.bind(null, "/apps/" + name))
	.then(function(status){
		console.log(status);
	})
	.done();
});

cli.command("ps")
.description("List all applications");

cli.command("kill-daemon")
.description("Kills an active daemon process")
.action(function(){
	if (fs.existsSync(daemonsocket)) {
		console.log("killing daemon");
		daemonRequest("/kill", null, "POST");
	} else {
		console.log("not running");
	}
});

cli.command("start-daemon")
.description("Starts the daemon process if not running")
.action(function(){
	if (!fs.existsSync(daemonsocket)) {
		ensureDaemon(true).done();
	} else {
		console.log("already running");
	}
});


cli.parse(process.argv);

function addApp(config, start) {
	ensureDaemon(true)
	.then(function(){
		console.log("adding app '" + config.id + "'");
		return daemonRequest("/apps/" + config.id + "?createOnly=true&start=" + (start ? "true" : ""), config, "PUT").done()
	})
	.done();
}

function ensureDaemon(doStart) {
	if (!fs.existsSync(daemonsocket)) {
		if (doStart === true) {
			console.log("starting daemon");
			startDaemon();
		}

		return Q.delay(1000)
		.then(ensureDaemon.bind(null,null));

	} else {
		return Q();
	}

}

function startDaemon() {
	var daemonbin = path.resolve(__dirname, "../lib/daemon/index.js");
	cp.spawn("node", [daemonbin], {
		detached: true,
		stdio: "ignore"
	});
}

function getLogs(uri) {
	return request("unix://" + path.join(daemonsocket, uri));
}

function daemonRequest(uri, data, method) {
	var uri = "unix://" + path.join(daemonsocket, uri);
	return Q.nfcall(request, {
		method: method || "GET",
		uri: uri,
		json: data
	})
	.spread(function(res, body){
		if (res.statusCode === 200) {
			return body;
		} else if (res.statusCode > 299) {
			throw new Error("ERR: " + res.statusCode + "\n" + body);
		} else {
			return res.statusCode;
		}
	});
}
