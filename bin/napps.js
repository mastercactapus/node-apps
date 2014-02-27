var cli = require("commander");

cli.command("add <name> <script file>")
.description("Add an application");

cli.command("restart <name>")
.description("Gracefully restart an application (--force to skip shutdown)")
.option("--force", "Restart without sending shutdown signal");

cli.command("start <name>")
.description("Start an application");

cli.command("stop <name>")
.description("Stop a running application");

cli.command("update <name>")
.description("Update the configuration of an application (usefull for changin number of instances)");

cli.command("status <name>")
.description("View the status of an application");

cli.command("ps")
.description("List all applications");

cli.parse(process.argv);
