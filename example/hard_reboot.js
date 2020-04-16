const log = text => console.log(`[${new Date().toISOString()}] ${text}`);

const { Status, By2UART, sleep } = require('../index');

const config = require('./port_config.json');

const status = new Status(config);

const print_pin_status_message = (value, pin) => log(pin.description[value + 0]);

status.on('UART1_DCD', print_pin_status_message);
status.on('RESET_CHK', (value, pin) => {
    print_pin_status_message(value, pin);
    if (value) status.close();
});

(async () => {
    console.log(await status.wait().then(_ => true).catch(_ => false));
    await status.reboot();
})();
