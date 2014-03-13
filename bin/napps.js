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
var colors = require("colors");
var Table = require("cli-table");
var moment = require("moment");

var daemonsocket = path.join(napp.basedir, "daemon.socket");


cli.command("add <scriptfile> [name]")
.option("--start", "start the application immediately")
.option("--cwd <dir>", "set working directory [default: current]", process.cwd())
.option("--port <port>", "set PORT variable [default: use env]", process.env.PORT)
.option("-i, --instances <num>", "number of instances [default: cpu cores]", os.cpus().length)
.description("Add an application (saves cwd and env)")
.action(function(script, name, opts){
	var env = _.clone(process.env);

	name = name || path.basename(script).replace(/\.js$/,"");
	env.PORT = opts.port;

	var cfg = {
		env: env,
		cwd: opts.cwd,
		id: name,
		exec: path.resolve(script),
		instances: opts.instances
	};
	addApp(cfg, opts.start)
	.then(allStatus)
	.done();
});

cli.command("restart <name>")
.description("Gracefully restart an application (--force to skip shutdown)")
.option("--force", "Restart without sending shutdown signal")
.action(function(name, opts){
	ensureDaemon(true)
	.then(daemonRequest.bind(null, "/apps/" + name + "/" + (opts.force ? "restart" : "reload"), null, "POST"))
	.then(allStatus)
	.done();
});

cli.command("start <name>")
.description("Start an application")
.action(function(name){
	ensureDaemon(true)
	.then(daemonRequest.bind(null, "/apps/" + name + "/start", null, "POST"))
	.then(allStatus)
	.done();
});

cli.command("stop <name>")
.description("Stop a running application")
.action(function(name){
	ensureDaemon(true)
	.then(daemonRequest.bind(null, "/apps/" + name + "/stop", null, "POST"))
	.then(allStatus)
	.done();
});

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

cli.command("status [name]")
.description("View application status")
.action(function(name){
	appStatus(name).done();
});


cli.command("stop-daemon")
.description("Kills an active daemon process")
.action(function(){
	isRunning()
	.then(function(running){
		if (running) {
			return killDaemon(true);
		} else {
			console.log("not running");
		}
	})
	.done();
});

cli.command("start-daemon")
.description("Starts the daemon process if not running")
.action(function(){
	isRunning()
	.then(function(running){
		if (running) {
			console.log("already running");
		} else {
			return ensureDaemon(true);
		}
	})
	.done();
});

cli.command("restart-daemon")
.description("Restarts the daemon process")
.action(function(){
	killDaemon(true)
	.then(ensureDaemon.bind(null, true))
	.done();
});


cli.parse(process.argv);

function addApp(config, start) {
	return ensureDaemon(true)
	.then(function(){
		console.log("adding app '" + config.id + "'");
		return daemonRequest("/apps/" + config.id + "?createOnly=true&start=" + (start ? "true" : ""), config, "PUT")
	});
}

function isRunning(){
	return daemonRequest("/ping")
	.thenResolve(true)
	.catch(function(){
		return false;
	});
}

function ensureDaemon(doStart) {
	return isRunning()
	.then(function(running){
		if (running) return;

		if (doStart === true) {
			console.log("starting daemon");
			startDaemon()
		}

		return Q.delay(1000)
		.then(ensureDaemon.bind(null, null));
	});
}

function killDaemon(doKill) {
	return isRunning()
	.then(function(running){
		if (!running) return;

		var chain = Q();

		if (doKill === true) {
			console.log("stopping daemon");
			chain = daemonRequest("/kill", null, "POST")
		}

		return chain
		.delay(1000)
		.then(killDaemon.bind(null, null));
	})
}

function startDaemon() {
	if (fs.existsSync(daemonsocket)) {
		fs.unlinkSync(daemonsocket);
	}

	var daemonbin = path.resolve(__dirname, "../lib/daemon/index.js");
	cp.spawn("node", [daemonbin], {
		detached: true,
		stdio: "ignore"
	}).unref();
}

function getLogs(uri) {
	return request("unix://" + path.join(daemonsocket, uri));
}

function daemonRequest(uri, data, method) {
	var uri = "unix://" + path.join(daemonsocket, uri);
	return Q.nfcall(request, {
		method: method || "GET",
		uri: uri,
		json: data||true
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

function allStatus() {
	return appStatus();
}

function appStatus(name) {
	return ensureDaemon(true)
	.then(daemonRequest.bind(null, "/apps" + (name ? "/" + name : "")))
	.then(printStatus);
}

function printStatus(details) {
	if (!_.isArray(details)) details = [details];

	var tableHeader = ["App Name", "Status", "PID", "Uptime", "Crashes", "Ports", "#", "Instance PIDs"];
	tableHeader = tableHeader.map(function(header){
		return header.cyan.bold;
	})

	var table = new Table({
		head: tableHeader
	});

	_.each(details, function(app){
		var status = "OFFLINE".red;
		var instances = "", ports = "", uptime = "", workerPIDs = "", pid = "", crashes = "";
		if (app.status) {
			if (app.status.status === "ONLINE") {
				status = "ONLINE".green;
			} else {
				status = app.status.status.yellow;
			}

			instances = Object.keys(app.status.workers).length;

			ports = _.flatten(app.status.workers, "listening");
			ports = _.uniq(ports, "port");
			ports = _.pluck(ports, "port");
			ports = ports.join(" ");
			uptime = moment.duration(app.status.uptime, "seconds").humanize();
			pid = app.status.pid;
			workerPIDs = _.pluck(app.status.workers, "pid").join(" ");
			crashes = app.status.deathCount - app.status.killCount;
		}

		table.push([app.id.bold, status, pid, uptime, crashes, ports, instances, workerPIDs]);
	});

	console.log(table.toString());
}
