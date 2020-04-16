const log = text => console.log(`[${new Date().toISOString()}] ${text}`);

const { Status, By2UART, sleep } = require('../index');

const config = require('./port_config.json');

const status = new Status(config);

(async () => {
	await status.wait();

	console.log(status.list());
	status.close();
})();
