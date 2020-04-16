const log = text => console.log(`[${new Date().toISOString()}] ${text}`);

const { Status, By2UART, sleep } = require('../index');
console.log(Status);
const config = require('./port_config.json');

const status = new Status(config);

const print_pin_status_message = (value, pin) => log(pin.description[value + 0]);

status.on('UART1_DCD', print_pin_status_message);
status.on('RESET_CHK', print_pin_status_message);

const signal_port = config.signal_uart;
const data_port = config.data_uart;

const modem = new By2UART(signal_port, data_port, status, { echo: true });

(async () => {
    console.log(await status.wait().then(_ => true).catch(_ => false));

    console.log(await modem.getUserDatetime().catch(_ => _));
    await modem.setUserDatetime(new Date());
    console.log(await modem.getNetworkDatetime().catch(_ => _));
    console.log(await modem.getUserDatetime().catch(_ => _));
    console.log(await modem.getSignalQuality().catch(_ => _));

    console.log(await modem.isRadioDisabled().catch(_ => _));
    console.log(await modem.getTemperature().catch(_ => _));
    console.log(await modem.getBatteryInfo().catch(_ => _));
    console.log(await modem.getModelName().catch(_ => _));
    console.log(await modem.getVersion().catch(_ => _));
    console.log(await modem.getIMEI().catch(_ => 'IMEI取得エラー'));

    console.log(await modem.requestHttp('https://www.google.com').then(data => {
        data.body.content = data.body.content.toString('utf8');
        return data;
    }).catch(err => `HTTPリクエスト失敗: ${err}`));

    await modem.close();
})();
