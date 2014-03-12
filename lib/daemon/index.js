var Daemon = require("./daemon").Daemon;

process.title = "[napps Daemon]";
var main = new Daemon();

process.on("SIGINT", function(){
	main.shutdown();
});
