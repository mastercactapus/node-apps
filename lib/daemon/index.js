var napp = require("../napp");
var fs = require("fs");
var path = require("path");

process.title = "[napps Daemon]";
var log = fs.createWriteStream(path.join(napp.basedir, "daemon.log"), {flags: "a"});
// process.__defineGetter__('stderr', function(){
// 	return log;
// });
// process.__defineGetter__('stdout', function(){
// 	return log;
// });

var Daemon = require("./daemon").Daemon;
var main = new Daemon();
console.log("-- Daemon Started --");

process.on("SIGINT", function(){
	main.server.unref();
});

process.on("exit", function(){
	main.server.close();
});
