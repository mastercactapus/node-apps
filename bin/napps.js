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


//add new apps
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





cli.command("start *")
.usage("[options] [NAME...]")
.description("Start application(s)")
.option("--all", "Apply to all applications (ignores names)")
.action(function(name){

	var names = [].slice.call(arguments, 0, -1);
	var opts = [].slice.call(arguments, -1)[0];
	if (opts.all) names = getNames();

	sequence(names, SSRApp.bind(null, "start"))
	.then(allStatus)
	.done();
});
cli.command("stop *")
.usage("[options] [NAME...]")
.description("Stop running application(s)")
.option("--all", "Apply to all applications (ignores names)")
.action(function(){

	var names = [].slice.call(arguments, 0, -1);
	var opts = [].slice.call(arguments, -1)[0];
	if (opts.all) names = getNames();

	sequence(names, SSRApp.bind(null, "stop"))
	.then(allStatus)
	.done();
});
cli.command("restart *")
.usage("[options] [NAME...]")
.description("Restart applications (including cluster process)")
.option("--all", "Apply to all applications (ignores names)")
.action(function(){

	var names = [].slice.call(arguments, 0, -1);
	var opts = [].slice.call(arguments, -1)[0];
	if (opts.all) names = getNames();

	sequence(names, SSRApp.bind(null, "restart"))
	.then(allStatus)
	.done();
});
cli.command("reload *")
.usage("[options] [NAME...]")
.description("Gracefully restart an application(s)")
.option("--instant", "Replace all instances immediately instead of one-by-one (uses more resources)")
.option("--all", "Apply to all applications (ignores names)")
.action(function(){

	var names = [].slice.call(arguments, 0, -1);
	var opts = [].slice.call(arguments, -1)[0];
	if (opts.all) names = getNames();

	sequence(names, SSRApp.bind(null, "reload?instant=" + (opts.instant||"")))
	.then(allStatus)
	.done();
});
cli.command("delete *")
.usage("[options] [NAME...]")
.description("Stop and delete application(s)")
.option("--all", "Apply to all applications (ignores names)")
.action(function(){

	var names = [].slice.call(arguments, 0, -1);
	var opts = [].slice.call(arguments, -1)[0];

	if (opts.all) names = getNames();

	sequence(names, SSRApp.bind(null, "delete"))
	.then(allStatus)
	.done();
});
function sequence(params, fn) {
	return Q.all([params, fn])
	.spread(function(params, fn){
		var chain = Q();
		params.forEach(function(params){
			chain = chain.then(fn.bind(null, params));
		});
		return chain;
	});
}
function SSRApp(method, appname) {
	var httpMethod = "POST";
	var methodName = method.split("?")[0] + ":";
	if (method === "delete") {
		method = "";
		httpMethod = "DELETE";
	} else {
		method = "/" + method;
	}
	return ensureDaemon(true)
	.then(function(){
		console.log(methodName, appname);
	})
	.then(daemonRequest.bind(null, "/apps/" + appname + method, null, httpMethod))
	.catch(function(err){
		console.log(methodName, appname, "FAILED", err.message||err);
	});
}



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
cli.command("list [name]")
.description("alias: status")
.action(function(name){
	appStatus(name).done();
});
cli.command("ls [name]")
.description("alias: status")
.action(function(name){
	appStatus(name).done();
});
cli.command("ps [name]")
.description("alias: status")
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


cli.command("help")
.description("output usage information")
.action(function(command){
	cli.help();
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
		if (res.statusCode >= 200 && res.statusCode < 300) {
			return body;
		} else {
			throw new Error(res.statusCode + ": " + body);
		}
	});
}
function getNames() {
	return ensureDaemon(true)
	.then(daemonRequest.bind(null, "/apps?namesOnly=true"))
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

	var tableHeader = ["App Name", "Status", "PID", "Uptime", "Crashes", "Ports", "#", "CPU", "MEM"];
	tableHeader = tableHeader.map(function(header){
		return header.cyan.bold;
	});

	var table = new Table({
		head: tableHeader
	});

	if (details.length > 1) {
		_.each(details, function(app){
			var status = "OFFLINE".red;
			var instances = "", ports = "", uptime = "", workerPIDs = "", pid = "", crashes = "", cpu = "", mem = "";
			if (app.status) {
                makeTotals(app);
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
				crashes = app.status.deathCount - app.status.killCount;
                cpu = app.status.totalCpu.toFixed(2) + "%";
                mem = prettyMem(app.status.totalMem);
			}

			table.push([app.id.bold, status, pid, uptime, crashes, ports, instances, cpu, mem]);
		});

		console.log(table.toString());
	} else if (details.length === 1) {
		printDetailedStatus(details[0]);
	} else {
		console.log("No apps currently configured");
	}

}

function prettyMem(bytes) {
    var labels = ["b", "KiB", "MiB", "GiB", "TiB"];
    for (var i = labels.length-1;i>=0;i--) {
        if (bytes > Math.pow(1000, i)) {
            return (bytes/Math.pow(1024, i)).toFixed(2) + " " + labels[i];
        }
    }
    
    return bytes + " " + labels[0];
}

function makeTotals(app) {
    if (app.status) {
        app.status.totalProc = 1;
        app.status.totalMem = app.status.mem;
        app.status.totalCpu = app.status.cpu;
        _.each(app.status.workers, function(worker){
            worker.totalProc = 1 + worker.children.length;
            worker.totalMem = worker.mem;
            worker.totalCpu = worker.cpu;
            
            _.each(worker.children, function(child){
                worker.totalMem += child.mem;
                worker.totalCpu += child.cpu;
            });
            
            app.status.totalProc += worker.totalProc;
            app.status.totalMem += worker.totalMem;
            app.status.totalCpu += worker.totalCpu;
        });
    }
}

function printDetailedStatus(app) {
	var tableHeader = ["", "PID", "Ports", "Uptime", "CPU", "MEM", "Processes"];
	tableHeader = tableHeader.map(function(header){
		return header.cyan.bold;
	});

	var table = new Table({head: tableHeader});
	var row = {};
    var uptime = moment.duration(app.status.uptime, "seconds").humanize();
    makeTotals(app);

	row[app.id.bold] = [app.status.pid, "--", uptime, app.status.totalCpu.toFixed(2) + "%", prettyMem(app.status.totalMem), app.status.totalProc];
	table.push(row);
	_.each(app.status.workers, function(worker){
		var row = {};
        var uptime = moment.duration(worker.uptime, "seconds").humanize();
        
		row[(app.id + ":" + worker.id).bold] = [worker.pid, _.pluck(worker.listening, "port"), uptime, prettyMem(worker.totalMem), worker.totalCpu.toFixed(2) + "%", worker.totalProc]
		table.push(row);
	});
	console.log(table.toString());
}