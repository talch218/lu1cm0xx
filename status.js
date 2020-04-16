const gpio = require('rpi-gpio');

/* Memo: GPIO番号は下記の通り、rpi-gpioではピン番号を用いるため注意
// Input
const UART1_DTR = 22;
const UART1_DCD = 23;
const TE_UP = 20;
const RESET_CHK = 21;

// Output
const PSM_DISABLE = 17;
const UART1_DSR = 3;
const FUNC_SW = 20;
const RESET = 21;
*/

function Status(pin_assign) {
    const controll_pins = [{
        direction: 'IN',
        name: 'UART1_DTR',
        description: ['GPSユニットモジュールと通信できます。', 'GPSユニットモジュールと通信できません。'],
    }, {
        direction: 'IN',
        name: 'UART1_DCD',
        description: ['キャリア網に接続されてます。', 'キャリア網に接続されてません。'],
    }, {
        direction: 'IN',
        name: 'TE_UP',
        description: ['受信データはありません。', '受信データが発生しました。'],
    }, {
        direction: 'IN',
        name: 'RESET_CHK',
        description: ['ATコマンドは実行できません。', 'ATコマンドが実行できます。'],
    }, {
        direction: 'OUT',
        name: 'PSM_DISABLE',
        description: 'HIGH状態で、PSM遷移を抑止します。',
        default: true,
    }, {
        direction: 'OUT',
        name: 'UART1_DSR',
        descriptsion: 'LOW状態で、本デバイスがUART1通信可能状態だと通知します。',
        default: false,
    }, {
        direction: 'OUT',
        name: 'FUNC_SW',
        descripttion: 'HIGH状態が、約1秒で電源ON、約4秒で電源OFF、約13秒で再起動を行います。',
        default: false,
    }, {
        direction: 'OUT',
        name: 'RESET',
        description: 'HIGH状態でGPSユニットを再起動します。',
        default: false,
    }];

    Object.entries(pin_assign).forEach(([name, pin_number]) => {
        const target_pin = controll_pins.find(x => x.name == name);
        if (target_pin) target_pin.pin = pin_number;
    });

    const active_pins = controll_pins.filter(x => x.pin);
    const active_pin_numbers = active_pins.reduce((obj, pin) => {
        obj[pin.name] = pin.pin;
        return obj;
    }, {});

    const callbacks = [];
    const status = {};

    gpio.on('change', (ch, value) => {
        const pin = active_pins.find(x => x.pin == ch);
        if (pin) {
            status[pin.name] = value;
            callbacks.filter(x => x.name == pin.name).forEach(x => x.callback(value, pin));
        }
    });

    const setup_pins = Promise.all(active_pins.map(x => {
        return new Promise((resolve, reject) => {
            setTimeout(() => reject(`Timeout: [p${x.pin}]`), 2000);

            if (x.direction == 'IN') {
                gpio.setup(x.pin, gpio.DIR_IN, gpio.EDGE_BOTH, err => {
                    if (err) reject(err);
                    gpio.read(x.pin, (err, value) => {
                        status[x.name] = value;
                        resolve(true);
                    });
                });
            } else { // OUT
                gpio.setup(x.pin, gpio.DIR_OUT, err => {
                    if (err) reject(err);
                    if (x.direction == 'OUT') {
                        gpio.write(x.pin, x.default, () => resolve(true));
                    }
                });
            }
        });
    }));

    Object.defineProperty(this, 'on', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function (name, callback) {
            callbacks.push({ name, callback });
        }
    });

    let power_control = false;

    Object.defineProperty(this, 'poweron', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function () {
            return new Promise((resolve, reject) => {
                if (power_control) reject('既に電源制御中です。');
                power_control = true;

                gpio.write(active_pin_numbers.FUNC_SW, true, () => {
                    setTimeout(() => {
                        gpio.write(active_pin_numbers.FUNC_SW, false, () => {
                            power_control = false;
                            resolve(true);
                        });
                    }, 1300);
                });
            });
        }
    });

    Object.defineProperty(this, 'shutdown', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function () {
            return new Promise((resolve, reject) => {
                if (power_control) reject('既に電源制御中です。');
                power_control = true;

                gpio.write(active_pin_numbers.FUNC_SW, true, () => {
                    setTimeout(() => {
                        gpio.write(active_pin_numbers.FUNC_SW, false, () => {
                            power_control = false;
                            resolve(true);
                        });
                    }, 4500);
                });
            });
        }
    });

    Object.defineProperty(this, 'reboot', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function () {
            return new Promise((resolve, reject) => {
                if (power_control) reject('既に電源制御中です。');
                power_control = true;

                gpio.write(active_pin_numbers.RESET, true, () => {
                    setTimeout(() => {
                        gpio.write(active_pin_numbers.RESET, false, () => {
                            power_control = false;
                            resolve(true);
                        });
                    }, 500);
                });
            });
        }
    });

    Object.defineProperty(this, 'set_uart1_dsr', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function (value) {
            const p = active_pin_numbers.UART1_DSR;
            if (p) {
                return new Promise((resolve, reject) => {
                    gpio.write(active_pin_numbers.UART1_DSR, value, () => resolve(true));
                    setTimeout(() => reject(`failed: set_uart1_dsr(${value})`), 2000);
                });
            } else {
                throw 'UART1 DSRは割り当てられていません。';
            }
        }
    });

    Object.defineProperty(this, 'set_data_enable', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function () {
            return this.set_uart1_dsr(false);
        }
    });

    Object.defineProperty(this, 'set_data_disable', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function () {
            return this.set_uart1_dsr(true);
        }
    });



    Object.defineProperty(this, 'list', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function () {
            return { ...status };
        }
    });

    Object.defineProperty(this, 'is_connected', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function () {
            const p = active_pin_numbers.UART1_DCD;
            if (p) return status.UART1_DCD == false;
            else throw 'UART1 DCDは割り当てられていません。'
        }
    });

    Object.defineProperty(this, 'close', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: () => {
            console.error('Controller GPIO closing');
            return setup_pins.then(_ => gpio.destroy(() => { }))
                .catch(_ => gpio.destroy(() => { }));
        }
    });

    Object.defineProperty(this, 'wait', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: () => {
            return setup_pins;
        }
    });

    return this;
}

module.exports = Status;
