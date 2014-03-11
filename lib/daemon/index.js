
var koa = require("koa");
var app = koa();



/ *
	app:
		id
		instances
		port
		cwd 
		env {}
		file args
		nodeversion
		nodeargs

		status:
			running:
			ports: []
			instances:
			memory
			cpu
			total processes
			connections
* /

app.get("/apps", )
app.put("/apps/:id", )
app.del("/apps/:id", )
app.post("/apps/:id/start", )
app.post("/apps/:id/stop", )
app.post("/apps/:id/reload", )
app.post("/apps/:id/restart", )
