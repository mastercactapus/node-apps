var express = require("express");
var Q = require("q");
var napp = require("../napp");
var http = require("http");
var httpProxy = require("http-proxy");
var request = require("request");
var fs = require("fs");
var path = require("path");
var _ = require("lodash");
var cp = require("child_process");
var events = require("events");
var rimraf = require("rimraf");

var clusterbin = path.join(__dirname,"../cluster/index.js");

function okStatus(res) {
	return (res.statusCode >= 200 && res.statusCode < 300);
}
function getJSON(uri, method) {
	return Q.nfcall(request, {
		uri:uri,
		json: true,
		method: method||"GET"
	})
	.spread(function(res, body){
		if (okStatus(res)) {
			return body;
		} else {
			Q.reject(body);
		}
	});
}
function readJSON(file) {
	return Q.nfcall(fs.readFile, file)
	.then(JSON.parse);
}
function exists(filename) {
	return Q.nfcall(fs.stat, filename)
	.thenResolve(true)
	.catch(function(){
		return false;
	});
}

function Daemon() {
	var self = this;

	self.base = napp.basedir;
	self.app = express();
	self.app.use(express.json());
	self.server = http.createServer(self.app);
	self.routes();
	self.proxy = httpProxy.createProxyServer({});

	self.server.listen(path.join(self.base, "daemon.socket"));
	self.events = new events.EventEmitter();
}

Daemon.prototype = {
	shutdown: function(){
		console.log("-- Shutting Down --");
	},
	routes: function() {
		this.app.get("/ping", this._pong.bind(this));

		this.app.get("/apps", this._getApps.bind(this));
		this.app.get("/apps/:id", this._getApp.bind(this));

		this.app.delete("/apps/:id", this._removeApp.bind(this));
		this.app.put("/apps/:id", this._addApp.bind(this));
		this.app.post("/apps/:id/start", this._startApp.bind(this));
		this.app.post("/apps/:id/restart", this._restartApp.bind(this));
		this.app.post("/apps/:id/reload", this._reloadApp.bind(this));
		this.app.post("/apps/:id/stop", this._stopApp.bind(this));

		this.app.post("/kill", this._shutdown.bind(this));

		this.app.use("/apps", this._proxyApp.bind(this));
	},
	_pong: function(req,res){
		res.type("json");
		res.json({pong: true});
	},
	_proxyApp: function(req, res, next) {
		var self = this;
		var id = req.path.split("/")[1];
		if (!id) return next();
		this.validateId(id);
		req.url = req.url.replace("/" + id, "");

		this._appRunning(id)
		.then(function(running){
			if (!running) throw new Error("app not running: '" + id + "'");


			self.proxy.web(req, res, {
				target: {
					socketPath: self.base + "/apps/" + id + "/socket"
				}
			});
		})
		.catch(function(err){
			res.send(400, err.message);
		});
	},
	_reloadApp: function(req, res) {
		var self = this;

		this.validateId(req.params.id);
		this._appRunning(req.params.id)
		.then(function(running){
			if (running) {
                //this should be proxied
				return getJSON("unix://" + self.appSocket(req.params.id) + "/reload?instant=" + (req.query.instant||""), "POST");
			} else {
				return self.startApp(req.params.id);
			}
		})
		.then(function(){
			res.json(204);
		})
		.catch(function(err){
			res.send(500, err.message||err);
		})
        .done();
	},
	_shutdown: function(req, res) {
		res.json(202);
		this.shutdown();
	},
	_getApps: function(req, res){
		var self = this;

		if (req.query.namesOnly) {
			return this.appnames()
			.then(function(names){
				res.type("json");
				res.json(names);
			})
			.catch(function(err){
				res.send(500, err.message||err);
			})
			.done();
		}

		this.appnames()
		.then(function(apps){
			return Q.all(_.map(apps, self.getApp.bind(self)));
		})
		.then(function(appData){
			res.type("json");
			res.json(appData);
		})
		.done();
	},
	_getApp: function(req, res) {
		this.validateId(req.params.id);
		this.getApp(req.params.id)
		.then(function(data){
			res.type("json");
			res.json(data);
		})
		.done();
	},
	_removeApp: function(req, res) {
		var self = this;

		self.validateId(req.params.id);

		self.stopApp(req.params.id)
		.then(function(){
			return Q.nfcall(rimraf, self.appDir(req.params.id));
		})
		.then(function(){
			res.send(204);
		})
		.catch(function(err){
			res.type("text");
			res.send(500, err.message||err);
		})
		.done();
	},
	_addApp: function(req, res) {
		var self = this;
		var id = req.body.id;

		this.validateConfig(req.body);

		var dir = this.appDir(id);
		var created = true;

		Q.nfcall(fs.mkdir, dir)
		.catch(function(){
			created = false;
			if (req.query.createOnly) {
				return Q.reject(new Error("app already exists with name '" + id + "'"));
			}
		})
		.then(Q.nfbind(fs.writeFile, path.join(dir, "config.json"), JSON.stringify(req.body)))
		.then(function(){
			if (req.query.start) {
				return self.startApp(id);
			}
		})
		.then(function(){
			res.send(created ? 201 : 204, "");
		})
		.catch(function(err){
			res.type("text");
			res.send(500, err.message);
		})
		.done();
	},
	appSocket: function(id) {
		return path.join(this.appDir(id), "socket");
	},
	appDir: function(id) {
		return path.join(this.base, "apps", id);
	},
	validateConfig: function(config) {
		if (!config.id) throw new TypeError("id is required");
		if (!config.exec) throw new TypeError("exec is required");
		this.validateId(config.id);

	},
	validateId: function(id) {
		if (/\//.test(id)) {
			throw new TypeError("invalid character '/' in id");
		} else if (id.length < 3) {
			throw new TypeError("site id must be >= 3 chars in length");
		}
	},
	_startApp: function(req, res) {
		this.validateId(req.params.id);
		this.startApp(req.params.id)
		.then(function(){
			res.json(204);
		})
		.catch(function(err){
			res.type("text");
			res.send(500, err.message||err);
		})
		.done();
	},
	_stopApp: function(req, res) {
		this.validateId(req.params.id);
		this.stopApp(req.params.id)
		.then(function(){
			res.json(204);
		})
		.catch(function(err){
			res.type("text");
			res.send(500, err.message||err);
		})
		.done();
	},
	_restartApp: function(req, res) {
		this.validateId(req.params.id);
		this.stopApp(req.params.id, req.query.force)
		.then(this.startApp.bind(this, req.params.id))
		.then(function(){
			res.json(204);
		})
		.catch(function(err){
			res.type("text");
			res.send(500, err.message||err);
		})
		.done();
	},

	_appRunning: function(appname) {
		var socket = this.appSocket(appname);

		return getJSON("unix://" + socket + "/ping", "POST")
		.thenResolve(true)
		.catch(function(){
			return Q.nfcall(fs.unlink, socket)
			.catch(_.noop)
			.thenResolve(false);
		});
	},
	stopApp: function(appname, force) {
		console.log("stopping '" + appname + "'");
		var uri = "unix://" + this.appSocket(appname) + "/stop?force=" + (force||"");
		return this._appRunning(appname)
		.then(function(running){
			if (!running) return;

			return getJSON(uri, "POST");
		});
	},
	startApp: function(appname) {
		var dir = this.appDir(appname);
		var config = readJSON(path.join(dir,"config.json"))
			.catch(function(err){
				console.log("Error: " + err.message);
				//assume app doesn't exist
				return Q.reject(new Error("app config does not exist: '" + appname + "'"));
			});

		console.log("Starting '" + appname + "'")
		//instead of exists, try to connect to /ping!!
		return Q.all([config, this._appRunning(appname)])
		.spread(function(config, running){
			if (running) return;

			var defer = Q.defer();

			var child = cp.spawn("node", [clusterbin, appname], {
				cwd: config.cwd,
				detached: true,
				stdio: ["ignore", "ignore", "ignore", "ipc"]
			});

			child.unref();

			child.on("error", function(){
				defer.reject(new Error("failed to start"));
			});
			child.on("exit", function(){
				defer.reject(new Error("crashed"));
			});


			child.on("message", function(data){
				child.disconnect();
				if (data === "online") {
					child.removeAllListeners();
					defer.resolve();
				} else {
					defer.reject(data);
				}
			});

			return defer.promise;
		});
	},

	getApp: function(appname) {
		var dir = this.appDir(appname);

		var config = Q.nfcall(fs.readFile, path.join(dir, "config.json")).then(JSON.parse);
		var status = getJSON("unix://" + path.join(dir, "socket") + "/status").catch(function(){ return null; });

		return Q.all([config, status])
		.spread(function(config, status){
			return {
				id: appname,
				config: config,
				status: status
			};
		});
	},

	appnames: function() {
		return Q.nfcall(fs.readdir, path.join(this.base, "apps"))
		.catch(function(){
			return [];
		});
	}
}

exports.Daemon = Daemon;
