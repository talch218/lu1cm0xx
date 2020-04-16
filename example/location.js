const log = text => console.log(`[${new Date().toISOString()}] ${text}`);

const { Status, By2UART } = require('../index');
const config = require('./port_config.json');

const status = new Status(config);

const print_pin_status_message = (value, pin) => log(pin.description[value + 0]);

status.on('UART1_DCD', print_pin_status_message);
status.on('RESET_CHK', print_pin_status_message);

const signal_port = config.signal_uart;
const data_port = config.data_uart;

const gps_unit = new By2UART(signal_port, data_port, status, { echo: { command: true, location: false, result: true } });

(async () => {
    console.log('GPIOの初期化: ' + await status.wait().then(_ => _).catch(_ => _));
    console.log('UARTの初期化: ' + await gps_unit.wait().then(_ => _).catch(_ => _));

    console.log(
        await gps_unit.getLocation(2, 2 * 60 * 1000).then(location => {
            return `[${location.success}](${location.datetime.toISOString()}) `
                 + `緯度: ${location.latitude}°, 経度: ${location.longitude}°, `
                 + `精度: ${location.accuracy}m`;
        }).catch(err => `位置情報取得失敗: ${err}`));
    await gps_unit.close();
})();
