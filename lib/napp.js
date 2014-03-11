
var fs = require("fs");
var path = require("path");
var mkdirp = require("mkdirp");

exports.Napp = function Napp(id) {
		if (/\\|\//.test(id)) throw new TypeError("invalid id");

	this.id = id;
	this.dirname = path.resolve(process.env.NAPPS_HOME 
		|| path.join(process.env.HOME, ".napps/apps/", this.id));

	this.configfile = path.join(this.dirname, "config.json");
};

exports.Napp.prototype = {
	load: function() {
		return this.config = this._loadConfig();
	},
	_loadConfig: function() {
		var json = JSON.parse(fs.readFileSync(this.configfile));
		if (json.id !== this.id) throw new TypeError("configfile id does not match napp id");
		return json;
	},
	save: function (config) {
		var cfg = config || this.config;

		if (this.id !== cfg.id) throw new TypeError("id does not match napp.id");
		if (!cfg.id) throw new TypeError("id is required");

		mkdirp.sync(this.dirname);
		fs.writeFileSync(this.configfile, JSON.stringify(cfg));
	}
};

exports.create = function(config) {
	var napp = new exports.Napp(config.id);
	napp.save(config);
	return napp;
};

exports.load = function(id) {
	var napp = new exports.Napp(id);
	napp.load();
	return napp;
};
