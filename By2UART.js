const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');
const HttpParser = require('./parser-http');

const { sleep } = require('./common');

const disconnection_reason = [
	'正常に切断されました。',
	'PDN接続異常',
	'ホスト名がみつかりません',
	'ソケットの確立に失敗しました。',
	'サーバから切断されました。',
	'SSLセッションの確立に失敗しました。',
	'Alert受信',
];
disconnection_reason[99] = '未知のエラーにより切断されました。';

const Echo = class {
	constructor(keys, useDefault) {
		const default_func = message => console.error(`> ${message}`);
		const none = () => { };

		keys.forEach(x => {
			this[x] = useDefault === true ? default_func : none;
		});
		if (typeof (useDefault) == 'object') {
			Object.entries(useDefault)
				.filter(([k, v]) => v)
				.forEach(([k, _]) => {
					this[k] = default_func;
				});
		}
	}
}

const error = text => console.error(`[LU1CM01x Controller] ${text}`);
const writeln = (port, cmd, callback) => {
	port.write(`${cmd}\r\n`, (err) => {
		if (typeof (callback) == 'function') callback(err);
		else if (err) error(err.message);
	});
	return sleep(500);
};

const By2UART = class {
	constructor(signal, data_port, status, option = { echo: true }) {
		const echo = new Echo(['result', 'command', 'location'], option.echo);
		Object.defineProperty(this, 'status', {
			configurable: false,
			writable: false,
			enumerable: false,
			value: status
		})

		Object.defineProperty(this, 'data_port_addr', {
			configurable: false,
			writable: false,
			enumerable: false,
			value: data_port,
		});

		const sport = new SerialPort(signal, {
			baudRate: 9600,
			dataBits: 8,
			parity: 'none',
			stopBits: 1,
			startBits: 1,
			rtscts: false,
		});

		const store = [];
		Object.defineProperty(this, 'addListener', {
			configurable: false,
			writable: false,
			enumerable: false,
			value: (callback, time, reject) => {
				const timeout = setTimeout(() => {
					store.splice(store.findIndex(x => x.callback == callback), 1);
					reject();
				}, time);
				store.push({ callback, timeout });
			}
		});


		const message = {};
		const location = {};

		const sparser = sport.pipe(new Readline({ delimiter: '\r\n' }));
		sparser.on('data', data => {
			store.filter(x => x.callback(data)).forEach(x => {
				clearTimeout(x.timeout);
				store.splice(store.findIndex(y => y == x), 1);
			});
			const datetime = new Date().toISOString();

			if (!data.match) return;

			if (data.indexOf('$') == 0) {
				echo.location(data);
				const [_, key, value] = data.match(/^(.*?),(.*?)$/);
				location[key] = { datetime, value };
			} else if (data.indexOf('+') == 0) {
				echo.result(data);
				const [_, key, value] = data.match(/^(.*?):\s+?(.*?)$/);
				message[key.substr(1)] = { datetime, value };
			} else {
				echo.command(data);
				if (data === 'CONNECT4NP') {
					message.CONNECTED = { datetime, value: true };
				} else if (data.indexOf('NO CARRIER4NP:') == 0) {
					message.CONNECTED = { datetime, value: false };
				}
			}
		});

		sport.on('close', err => {
			error('Signal port closing');
			if (err) error(err.message);
		});

		this.initializePromise = [];

		this.initializePromise.push(new Promise((resolve, reject) => {
			sport.on('open', async err => {
				if (err) {
					error(err.message);
					reject();
					return;
				}

				// 非請求リザルトが溜まっていることがあるため、バッファをクリアする仕組みを入れたい

				await writeln(this.ports.signal, 'ATE1');
				await writeln(this.ports.signal, 'ATQ0');
				await writeln(this.ports.signal, 'ATV1');
				// 非請求リザルトを(4つ目のパラメータ)表示1/非表示0
				// await writeln(this.ports.signal, 'AT+CMER=3,0,0,1,0');
				resolve(true);
			});
		}));

		Object.defineProperty(this, 'ports', {
			configurable: false,
			writable: false,
			enumerable: false,
			value: { signal: sport }
		});
		if (status) this.ports.status = status;
	}

	wait() {
		return Promise.all(this.initializePromise);
	}


	/**
	 * Close all port
	 * @returns {Promise}　Promise object represents the Date object
	 */
	close() {
		const closing = Object.entries(this.ports).map(([_, x]) => x.close());
		if (this.status) closing.push(this.status.close());
		return Promise.all(closing);
	};


	/**
	 * ユーザ時刻を取得します。
	 * @returns {Promise}　Promise object represents the Date object
	 */
	getUserDatetime() {
		return new Promise((resolve, reject) => {
			this.addListener(data => {
				if (data.indexOf('+CCLK') == 0) {
					const [_, yy, MM, dd, hh, mm, ss, TZ] = data.match(
						/\+CCLK: "([0-9]{2})\/([0-9]{2})\/([0-9]{2}),([0-9]{2})\:([0-9]{2})\:([0-9]{2})([\+\-][0-9]{2})"/
					).map(x => parseInt(x, 10));
					resolve(new Date(Date.UTC(yy + 2000, MM - 1, dd, hh, mm, ss)));
					return true;
				}
				return false;
			}, 2000, () => reject('Timeout'));
			writeln(this.ports.signal, 'AT+CCLK?');
		});
	}

	/**
	 * ユーザ時刻を設定します。
	 * @param {Date} date
	 */
	setUserDatetime(date) {
		const yy = ('0' + (date.getFullYear() - 2000)).slice(-2);
		const MM = ('0' + (date.getMonth() + 1)).slice(-2);
		const dd = ('0' + date.getDate()).slice(-2);
		const hh = ('0' + date.getHours()).slice(-2);
		const mm = ('0' + date.getMinutes()).slice(-2);
		const ss = ('0' + date.getSeconds()).slice(-2);
		const tz = date.getTimezoneOffset();
		const TZ = (tz < 0 ? '-' : '+') + ('0' + Math.abs(Math.round(tz / -15))).slice(-2);
		return writeln(this.ports.signal, `AT+CCLK="${yy}/${MM}/${dd},${hh}:${mm}:${ss}${TZ}"`);
	}


	/**
	 * ネットワーク時刻を取得します。
	 * @returns {Promise}　Promise object represents the Date object
	 */
	getNetworkDatetime() {
		return new Promise((resolve, reject) => {
			this.addListener(data => {
				if (data.indexOf('+KCCLK') == 0) {
					const [_, yy, MM, dd, hh, mm, ss, TZ] = data.match(
						/\+KCCLK: "([0-9]{2})\/([0-9]{2})\/([0-9]{2}),([0-9]{2})\:([0-9]{2})\:([0-9]{2})([\+\-][0-9]{2})"/
					).map(x => parseInt(x, 10));
					resolve(new Date(Date.UTC(yy + 2000, MM - 1, dd, hh, mm + TZ * 15, ss)));
					return true;
				}
				return false;
			}, 2000, () => reject('Timeout'));
			writeln(this.ports.signal, 'AT+KCCLK?');
		});
	}


	/**
	 * 信号品質を取得します。
	 * @returns {Promise<{ rsrq: number, rsrp: number, sinr: number }>}
	 * 				信号品質データを返すPromiseオブジェクト
	 */
	getSignalQuality() {
		return new Promise((resolve, reject) => {
			this.addListener(data => {
				if (data.indexOf('+CESQ') == 0) {
					const cesq = data.match(
						/\+CESQ: 99,99,255,255,([0-9]{2}),([0-9]{2}),([0-9]{2})/
					);
					if (!cesq) {
						reject(`信号品質取得エラー: [${data}]`);
						return true;
					}
					const [_, rsrq, rsrp, sinr] = cesq.map(x => new Number(parseInt(x, 10)));

					const rsrq_db_max = -19.5 + rsrq * 0.5;
					const rsrq_db = [rsrq_db_max - 0.5, rsrq_db_max];
					if (rsrq_db[0] < -19.5) rsrq_db[0] = -Infinity;
					if (rsrq_db[1] > -3) rsrq_db[1] = Infinity;
					const rsrq_db_ave = (rsrq_db[0] + rsrq_db[1]) / 2;
					Object.defineProperty(rsrq, 'db_range', {
						configurable: false,
						writable: false,
						enumerable: false,
						value: rsrq_db,
					});
					Object.defineProperty(rsrq, 'db_average', {
						configurable: false,
						writable: false,
						enumerable: false,
						value: rsrq_db_ave,
					});

					const rsrp_dbm_max = -140 + rsrp;
					const rsrp_dbm = [rsrp_dbm_max, rsrp_dbm_max];
					if (rsrp_dbm[0] < -140) rsrp_dbm[0] = -Infinity;
					if (rsrp_dbm[1] > -44) rsrp_dbm[1] = Infinity;
					const rsrp_dbm_ave = (rsrp_dbm[0] + rsrp_dbm[1]) / 2;
					Object.defineProperty(rsrp, 'db_range', {
						configurable: false,
						writable: false,
						enumerable: false,
						value: rsrp_dbm,
					});
					Object.defineProperty(rsrp, 'db_average', {
						configurable: false,
						writable: false,
						enumerable: false,
						value: rsrp_dbm_ave,
					});


					const sinr_db_max = -19 + rsrq;
					const sinr_db = [sinr_db_max, sinr_db_max];
					if (sinr_db[0] < -19) sinr_db[0] = -Infinity;
					if (sinr_db[1] > 30) sinr_db[1] = Infinity;
					const sinr_db_ave = (sinr_db[0] + sinr_db[1]) / 2;
					Object.defineProperty(sinr, 'db_range', {
						configurable: false,
						writable: false,
						enumerable: false,
						value: sinr_db,
					});
					Object.defineProperty(sinr, 'db_average', {
						configurable: false,
						writable: false,
						enumerable: false,
						value: sinr_db_ave,
					});

					resolve({ rsrq, rsrp, sinr, });
					return true;
				}
				return false;
			}, 2000, () => reject('Timeout'));
			writeln(this.ports.signal, 'AT+CESQ=1');
		});
	}


	/**
	 * 電波送受信状態を取得します。
	 * @returns {Promise<{ thermal_protection: bool, module_disable: bool }>}
	 * 				電波送受信が停止されている理由を返すPromiseオブジェクト
	 * 				送受信可能な場合 undefined を返す
	 */
	isRadioDisabled() {
		return new Promise((resolve, reject) => {
			this.addListener(data => {
				if (data.indexOf('+KRMDST') == 0) {
					const [_0, status, _1, flag] = data.match(
						/\+KRMDST: ([0-1])(,([0-9]{2}))?/
					).map(x => parseInt(x));

					if (status == 0) resolve({
						thermal_protection: flag & 2,
						module_disable: flag & 1,
					});
					else resolve(undefined);
					return true;
				}
				return false;
			}, 2000, () => reject('Timeout'));
			writeln(this.ports.signal, 'AT+KRMDST?');
		});
	}


	/**
	 * ユニット内部温度を取得します。
	 * @returns {Promise<number>}
	 * 				内部セ氏℃を返すPromiseオブジェクト
	 */
	getTemperature() {
		return new Promise((resolve, reject) => {
			this.addListener(data => {
				if (data.indexOf('+KGTEMP') == 0) {
					const [_, temp] = data.match(
						/\+KGTEMP: ([\+\-][0-9]+)/
					).map(x => parseInt(x));
					resolve(temp);
					return true;
				}
				return false;
			}, 2000, () => reject('Timeout'));
			writeln(this.ports.signal, 'AT+KGTEMP');
		});
	}

	/**
	 * 電池情報取得
	 * @returns {Promise<number, number>} 返却値をそのまま返します。（いい案がなかったので。マニュアル確認）
	 */
	getBatteryInfo() {
		return new Promise((resolve, reject) => {
			this.addListener(data => {
				if (data.indexOf('+KGBATINFO') == 0) {
					const [_, amount, status] = data.match(
						/\+KGBATINFO: ([0-9]+),([0-9]+)/
					).map(x => parseInt(x));
					resolve(amount, status);
					return true;
				}
				return false;
			}, 2000, () => reject('Timeout'));
			writeln(this.ports.signal, 'AT+KGBATINFO?');
		});
	}

	/**
	 * 電波送受信モジュールを有効化します。
	 */
	setRadioEnable() {
		return writeln(this.ports.signal, `AT+CFUN=1`);
	}

	/**
	 * 電波送受信モジュールを有効化します。
	 */
	setRadioDisable() {
		return writeln(this.ports.signal, `AT+CFUN=0`);
	}

	/**
	 * 電波送受信モジュールを有効化します。
	 * @param {bool} enabled
	 */
	setRadioAvailable(enabled) {
		return writeln(this.ports.signal, `AT+CFUN=${enabled ? 1 : 0}`);
	}

	/**
	 * GPSマルチユニットをシャットダウンします。
	 * @param {bool} enabled
	 */
	shutdown() {
		return writeln(this.ports.signal, `AT+CFUN=9`);
	}

	/**
	 * GPSマルチユニットを再起動します。
	 * @param {bool} enabled
	 */
	reboot() {
		return writeln(this.ports.signal, `AT+CFUN=6`);
	}

	/**
	 * モデル名取得
	 * @returns {Promise<string>} 'LU1CM012'または'LU1CM013'
	 */
	getModelName() {
		return new Promise((resolve, reject) => {
			this.addListener(data => {
				if (data.indexOf('LU1CM0') != 0) return false;

				resolve(data);
				return true;
			}, 2000, () => reject('Timeout'));
			writeln(this.ports.signal, 'AT+CGMM');
		});
	}

	/**
	 * ファームウェアバージョン取得 (未実装)
	 * @returns {Promise<string>} [0-9a-zA-Z\.]{7}
	 */
	getVersion() {
		return new Promise((resolve, reject) => {
			this.addListener(data => {
				resolve('Not implements');
				return true;
			}, 2000, () => reject('Timeout'));
			writeln(this.ports.signal, 'AT+CGMR');
		});
	}

	/**
	 * IMEI取得
	 * @returns {Promise<number>} [0-9]{15}
	 */
	getIMEI() {
		return new Promise((resolve, reject) => {
			this.addListener(data => {
				const imei = data.match(/[0-9]{15}/);
				if (imei) {
					resolve(imei[0]);
					return true;
				}
				return false;
			}, 2000, () => reject('Timeout'));
			writeln(this.ports.signal, 'AT+CGSN');
		});
	}

	/**
	 * 無手順接続用のAPNを設定します。
	 * @param {string} apn APNのアドレス
	 * @param {string} user ユーザー名
	 * @param {string} password パスワード
	 * @param {pap:bool, chap:bool} [auth_type={pap:true, chap:true}] 認証タイプ
	 * @param {ipv4:bool, ipv6:bool} [pdp_type={ipv4:true,ipv6:false}] PDPタイプ
	 */
	async setApnInfo(apn, user, password, auth_type = { pap: true, chap: true }, pdp_type = { ipv4: true, ipv6: false }) {
		const pdp = (() => {
			if (pdp_type.ipv4 && pdp_type.ipv6) {
				return "IPV4V6";
			} else if (pdp_type.ipv4) {
				return "IP";
			} else if (pdp_type.ipv6) {
				return "IPV6";
			}
			throw "PDPタイプはIPv4, IPv6のうち一つ以上設定しなければなりません。";
		})();
		await writeln(this.ports.signal, `AT+CGDCONT=2,"${pdp}",${apn}`);
		const auth = auth_type.pap * 1 + auth_type.chap * 2;
		const auth_info = auth == 0 ? "" : `,"${user}","${password}"`;
		return writeln(this.ports.signal, `AT+CGAUTH=2,${auth}${auth_info}`);
	}

	/**
	 * 無手順接続用にSORACOMのAPN情報を設定します。
	 */
	async setSoracomApnInfo() {
		await writeln(this.ports.signal, `AT+CGDCONT=2,"IP","soracom.io"`);
		return writeln(this.ports.signal, `AT+CGAUTH=2,3,"sora","sora"`);
	}


	/**
	 * 宛先ホストとの接続を確立します。
	 * @param {string} host APNのアドレス
	 * @param {number} port ユーザー名
	 * @param {string} protocol tcp | udp | ssl
	 * @param {number} [timeout=30000] 接続確立タイムアウト [msec]
	 */
	createConnection(host, port, protocol, timeout = 30000) {
		const ipv4_addr = host.match(/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/);
		const ipv6_addr = host.match(/[0-9a-fA-F]{4}\:[0-9a-fA-F]{4}\:[0-9a-fA-F]{4}\:[0-9a-fA-F]{4}\:[0-9a-fA-F]{4}\:[0-9a-fA-F]{4}\:[0-9a-fA-F]{4}\:[0-9a-fA-F]{4}/);
		const addr = ipv4_addr ? `${ipv4_addr},,${port}` : ipv6_addr ? `${ipv6_addr},,${port}` : `,${host},${port}`;
		const p = { udp: 0, tcp: 1, ssl: 2 };

		return new Promise((resolve, reject) => {
			this.addListener(data => {
				if (data == 'CONNECT4NP') {
					resolve(true);
					return true;
				}
				if (data == 'REJECT') {
					reject('競合が検出されました。確立済みの接続が存在しませんか。');
					return true;
				}
				if (data.indexOf('NO CARRIER4NP:') == 0) {
					reject(disconnection_reason[parseInt(data.substr(15))]);
					return true;
				}
				return false;
			}, timeout, () => reject('Timeout'));
			writeln(this.ports.signal, `AT+KDNP=${addr},${p[protocol]},,2`);
		});
	}

	/**
	 * TCP接続を確立します。
	 * @param {string} host APNのアドレス
	 * @param {number} port ユーザー名
	 */
	createTcpConnection(host, port) {
		return this.createConnection(host, port, 'tcp');
	}

	/**
	 * UDP接続を確立します。
	 * @param {string} host APNのアドレス
	 * @param {number} port ユーザー名
	 */
	createUdpConnection(host, port) {
		return this.createConnection(host, port, 'udp');
	}

	/**
	 * SSL接続を確立します。
	 * @param {string} host APNのアドレス
	 * @param {number} port ユーザー名
	 */
	createSSLConnection(host, port) {
		return this.createConnection(host, port, 'ssl');
	}

	/**
	 * Http(s)リクエストを送ります。
	 * @param {string} host APNのアドレス
	 * @param {number} port ユーザー名
	 * @param {string} [method='GET'] GET | POST
	 * @param {number} [timeout=120000] データ受信タイムアウト [msec]
	 * @param {object} [payload={}] 現在の実装では、メソッドがPOSTかつapplication/json限定
	 */
	async requestHttp(url, method = 'GET', payload = {}, timeout = 120000) {
		let [protocol, host, port, path] =
			url.match(/(https?):\/\/(.*?)(:([0-9]+))?(\/.*?)?$/)
				.filter((_, i) => [1, 2, 4, 5].indexOf(i) >= 0);
		if (!protocol || !host) {
			throw ('URL parse error');
		}
		if (!port) port = ({ http: 80, https: 443 })[protocol];
		if (!path) path = '/';

		if (this.status && this.status.is_connected()) throw '既に別の接続が確立しています。';
		if ('data' in this.ports) throw '既にデータポートが開かれています。';


		if (this.status) await this.status.set_data_enable().catch(err => `DSR制御に失敗しました。 ${err}`);

		const dport = new SerialPort(this.data_port_addr, {
			baudRate: 9600,
			dataBits: 8,
			parity: 'none',
			stopBits: 1,
			startBits: 1,
			rtscts: true,
		});

		this.ports.data = dport;

		dport.on('close', err => {
			if (this.status) this.status.set_data_disable();
			delete this.ports.data;
			error('Data port closing');
			if (err) error(err.message);
		});

		dport.on('open', err => dport.flush());

		return this.createConnection(host, port, ({ http: 'tcp', https: 'ssl' })[protocol])
			.catch(err => { throw err; })
			.then(_ => {
				return new Promise((resolve, reject) => {
					const timer = setTimeout(() => {
						if ('data' in this.ports) {
							delete this.ports.data;
							dport.close();
						}
						reject('データ受信がタイムアウトしました。');
					}, timeout);

					const dparser = dport.pipe(new HttpParser());
					dparser.on('data', data => {
						clearTimeout(timer);
						delete this.ports.data;
						dport.close();
						const d = JSON.parse(data);
						d.body.content = Buffer.from(d.body.content.data);
						resolve(d);
					});

					const req = [
						`${method} ${path} HTTP/1.1`,
						`Host: ${host}:${port}`,
					];
					const send_methods = ['POST', 'PUT'];
					if (send_methods.indexOf(method) >= 0 && payload) {
						const text = JSON.stringify(payload);
						req.push('Content-type: application/json');
						req.push('Content-Length: ' + text.length);
						req.push('');
						req.push(text);
					}
					req.push('');
					writeln(this.ports.data, req.join('\r\n'), err => {
						if (err) error(err.message);
					});
				});
			});
	}


	/**
	 * 位置情報を取得します。
	 * @param {number} [accuracy=0] 要求精度 [m]
	 * @param {number} [timeout=120000] タイムアウト [msec]
	 * @returns {Promise<{success: bool, latitude: number, longitude: number, datetime: Date [, accuracy: number]}>}
	 * @description accuracyで指定した精度情報になるまで、位置情報を取得し続けます。タイムアウトは最大で10分です。
	 * 緯度は北緯を正、南緯を負の値でしめし、経度は東経を正、西経を負の値で示します。
	 */
	getLocation(accuracy = 0, timeout = 120000) {
		timeout = Math.min(timeout, 10 * 60 * 1000);

		let result = null;

		return new Promise((resolve, reject) => {
			this.addListener(data => {

				if (data.indexOf('$GNRMC') == 0) {
					const [nmea, time, status,
						latitude, north_or_south, longitude, east_or_west,
						velocity_knot, velocity_way,
						date,
						_0, _1, mode, checksum] = data.split(',');

					if (status != 'A') return false;
					if (result === null) result = { success: false };

					const [_2, hour, min, sec, msec] = time
						.match(/([0-9]{2})([0-9]{2})([0-9]{2})\.([0-9]{2})/)
						.map(x => parseInt(x, 10));
					const [_3, day, month, year] = date
						.match(/([0-9]{2})([0-9]{2})([0-9]{2})/)
						.map(x => parseInt(x, 10));
					result.datetime = new Date(Date.UTC(2000 + year, month - 1, day, hour, min, sec, msec * 10));
					const DMMtoDegrees = dmm => {
						const [_, d, m] = dmm.match(/([0-9]+)([0-9]{2}\.[0-9]+)/);
						return parseInt(d) + (parseFloat(m) / 60);
					};
					result.latitude = (north_or_south == 'N' ? 1 : -1) * DMMtoDegrees(latitude);
					result.longitude = (east_or_west == 'E' ? 1 : -1) * DMMtoDegrees(longitude);

					if (accuracy <= 0) {
						writeln(this.ports.signal, 'AT+KLBS=0');
						result.success = true;
						resolve(result);
					}
				} else if (data.indexOf('$GNGST') == 0) {
					const [nmea, time, _, long_accuracy, short_accuracy, slant, _0, _1, checksum] = data.split(',');
					// マニュアルには9番目の値に高さ誤差とあるが、実際ははいっていない模様
					if (time == '') return false;
					if (!result) return false;
					result.accuracy = Math.max(...[long_accuracy, short_accuracy].map(x => parseInt(x)));
					if (result.accuracy <= accuracy) {
						writeln(this.ports.signal, 'AT+KLBS=0');
						result.success = true;
						resolve(result);
						return true;
					}
				}

				return false;
			}, timeout, () => {
				writeln(this.ports.signal, 'AT+KLBS=0');
				if (!result) reject('Timeout');
				else resolve(result);
			});
			writeln(this.ports.signal, 'AT+KLBS=1');
		});
	}

	/**
	 * GPSマルチユニットにSSL通信用の証明書を書き込みます。
	 * @param {string[]} certificates CA files
	 * @param {string} key_type ['ca' | 'client' | 'psk']
	 * @returns {Promise<number>}
	 */
	async writeSSLCertificates(certificates, key_type) {
		const type_num = ({ client: 1, ca: 2, psk: 3 })[key_type];
		for (let i = 0; i < certificates.length; i++) {
			const ssl_key = certificates[i].toString('hex');
			const length = parseInt(Math.ceil(ssl_key.length / 200) + '00') * 2;
			const data = (ssl_key + 'F'.repeat(length - ssl_key.length)).match(/.{200}/g);
			for (let j = 0; j < data.length; j++) {
				await writeln(this.ports.signal,
					`AT+KSETSSL=1,${type_num},${i + 1},${ssl_key.length / 2},${j + 1},${data[j]}`);
			}
		}
		return certificates.length;
	}


	/**
	 * GPSマルチユニットにCA証明書を書き込みます。
	 * @param {string[]} certificates CA files
	 * @returns {Promise<bool>}
	 * 
	 * @example <caption>ファイルから証明書を読み込みGPSマルチユニットに書き込む</caption>
	 * const certificates = fs.readdirSync(dir)
	 *                        .filter(filename => filename[0] != '.')
	 *                        .map(filename => fs.readFileSync(filename));
	 * await gps_unit.writeCACertificates(certificates, true);
	 */
	async writeCACertificates(certificates) {
		if (this.status) await this.status.set_data_enable().catch(_ => console.log(_));
		await writeln(this.ports.signal, 'AT+CFUN=0');
		await writeln(this.ports.signal, 'AT+KLBS=0');
		await sleep(2000);

		await this.writeSSLCertificates(certificates, 'ca');
		await writeln(this.ports.signal, 'AT+KSETSSL=9');
		return true;
	}


	/**
	 * GPSマルチユニットにクライアント証明書とその秘密鍵を書き込みます。
	 * @param {string} client_key クライアント証明書
	 * @param {string} private_key 秘密鍵
	 * @param {string} [passphrase] パスフレーズ
	 * @returns {Promise<bool>}
	 * 
	 * @example <caption>ファイルから証明書を読み込みGPSマルチユニットに書き込む</caption>
	 * const client = fs.readFileSync(client_key_path);
	 * const private = fs.readFileSync(private_key_path);
	 * const passphrase = '****'; // Possible to undefined
	 * await gps_unit.writeClientCertificates(client, private, passphrase);
	 */
	async writeClientCertificates(client_key, private_key, passphrase) {
		if (this.status) await status.set_data_enable();
		await writeln(this.ports.signal, 'AT+CFUN=0');
		await writeln(this.ports.signal, 'AT+KLBS=0');
		await sleep(2000);

		await this.writeSSLCertificates([client_key, private_key], 'client');
		if (passphrase) await writeln(this.ports.signal, `AT+KSETSSL=1,1,3,,,,${passphrase}`);
		await writeln(this.ports.signal, 'AT+KSETSSL=9');

		return true;
	}


	/**
	 * GPSマルチユニットにPSKを書き込みます。
	 * @param {string} psk "Identity_1:psk_key1"
	 * @returns {Promise<bool>}
	 */
	async writePSKCertificates(psk) {
		if (this.status) await status.set_data_enable();
		await writeln(this.ports.signal, 'AT+CFUN=0');
		await writeln(this.ports.signal, 'AT+KLBS=0');
		await sleep(2000);

		await this.writeSSLCertificates([psk], 'psk');
		await writeln(this.ports.signal, 'AT+KSETSSL=9');

		return true;
	}


	/**
	 * GPSマルチユニットからクライアント証明書を削除します。
	 * @returns {Promise<bool>}
	 */
	async deleteClientCertificates() {
		await writeln(this.ports.signal, 'AT+CFUN=0');
		await writeln(this.ports.signal, 'AT+KLBS=0');
		await sleep(2000);

		await writeln(this.ports.signal, `AT+KSETSSL=0,1`);
		return true;
	}


	/**
	 * GPSマルチユニットからCA証明書を削除します。
	 * @returns {Promise<bool>}
	 */
	async deleteCACertificates() {
		await writeln(this.ports.signal, 'AT+CFUN=0');
		await writeln(this.ports.signal, 'AT+KLBS=0');
		await sleep(2000);

		await writeln(this.ports.signal, `AT+KSETSSL=0,2`);
		return true;
	}


	/**
	 * GPSマルチユニットからPSK証明書を削除します。
	 * @returns {Promise<bool>}
	 */
	async deletePSKCertificates() {
		await writeln(this.ports.signal, 'AT+CFUN=0');
		await writeln(this.ports.signal, 'AT+KLBS=0');
		await sleep(2000);

		await writeln(this.ports.signal, `AT+KSETSSL=0,3`);
		return true;
	}
};


module.exports = By2UART;
