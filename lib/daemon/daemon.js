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

var clusterbin = path.join(__dirname,"../cluster/index.js");

function getJSON(uri) {
	return Q.nfcall(request, uri)
	.spread(function(res, body){
		if (res.statusCode === 200) {
			return body;
		} else {
			Q.reject(body);
		}
	})
	.then(JSON.parse);
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
	this.base = napp.basedir;
	this.app = express();
	this.app.use(express.json());
	this.server = http.createServer(this.app);
	this.routes();
	this.proxy = httpProxy.createProxyServer({});

	this.server.listen(path.join(this.base, "daemon.socket"));
	this.events = new events.EventEmitter();
}

Daemon.prototype = {
	shutdown: function(){
		this.server.close();
	},
	routes: function() {
		this.app.get("/apps", this._getApps.bind(this));
		this.app.get("/apps/:id", this._getApp.bind(this));

		this.app.delete("/apps/:id", this._removeApp.bind(this));
		this.app.put("/apps/:id", this._addApp.bind(this));
		this.app.post("/apps/:id/start", this._startApp.bind(this));
		this.app.post("/apps/:id/restart", this._restartApp.bind(this));

		this.app.post("/kill", this._shutdown.bind(this));

		this.app.use("/apps", this._proxyApp.bind(this));
	},
	_proxyApp: function(req, res, next) {
		var id = req.path.split("/")[1];
		if (!id) return next();
		this.validateId(id);
		req.url = req.url.replace("/" + id, "");

		this.proxy.web(req, res, {
			target: {
				socketPath: this.base + "/apps/" + id + "/socket"
			}
		});
	},
	_shutdown: function(req, res) {
		res.json(202);
		this.shutdown();
	},
	_getApps: function(req, res){
		var self = this;

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
		//call /stop?force=true
		//some event to know when socket is gone?
		//rm-rf dir
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
		.done();
	},
	_restartApp: function(req, res) {

	},


	startApp: function(appname) {
		var dir = this.appDir(appname);

		return Q.all([readJSON(path.join(dir,"config.json")), exists(path.join(dir, "socket"))])
		.spread(function(config, running){
			if (running) return;

			cp.spawn("node", [clusterbin, appname], {
				cwd: config.cwd,
				detached: true,
				stdio: "ignore"
			});
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
