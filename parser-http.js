const { Transform } = require('stream')

/**
 * A transform stream that emits data each time a byte sequence is received.
 * @extends Transform
 * @summary Httpパーサ
 * @example
const SerialPort = require('serialport')
const Delimiter = require('@serialport/parser-delimiter')
const port = new SerialPort('/dev/tty-usbserial1')
const parser = port.pipe(new HttpParser())
parser.on('data', console.log)
 */
class HttpParser extends Transform {
	constructor() {
		super({})
		this.init();
	}

	init() {
		this.buffer = Buffer.alloc(0);
		this.data = { status: { version: undefined, code: undefined, result: undefined }, header: {}, body: { size: undefined, content: undefined } };
	}

	_transform(chunk, encoding, cb) {
		let data = Buffer.concat([this.buffer, chunk]);
		let position;
		if (!this.data.body.size) { // サイズが未定義の場合はヘッダーを収集する
			// ヘッダーの最初はHTTPではじまるが省略
			while ((position = data.indexOf('\r\n')) !== -1) {
				const line = data.slice(0, position).toString('utf8');
				if (line === '') { // ヘッダー終了

					// Transfer-Encoding: chunkedとContent-Lengthをいれる
					if (this.data.header['Content-Length']) {
						this.data.body.size = parseInt(this.data.header['Content-Length'], 10);
					} else if (this.data.header['Transfer-Encoding'] === 'chunked') {
						this.data.body.size = [];
						this.data.body.content = Buffer.alloc(0);
					} else {
						console.log('no body ?');
						// Body無し？
						this.push(JSON.stringify(this.data));
						this.init();
					}
					data = data.slice(position + 2);
					break;
				}

				if (line.indexOf('HTTP/') == 0) {
					const [_, version, code, result] = line.match(/^HTTP\/([0-9\.]+) ([0-9]{3}) (.*?)$/);
					this.data.status = { version, code, result };
				} else {
					const sep = line.indexOf(':');

					this.data.header[line.substring(0, sep)] = line.substring(sep + 2);
				}

				data = data.slice(position + 2);
			}
		} else if (this.data.body.size instanceof Array) {
			while ((position = data.indexOf('\r\n')) !== -1) {
				const line = data.slice(0, position + 2);
				console.log(line);
				data = data.slice(position + 2);
				if ('current_chunk_size' in this.data.body) {
					this.data.body.content = Buffer.concat([this.data.body.content, line]);
					this.data.body.current_chunk_size -= position;
					if (this.data.body.current_chunk_size == 0) {
						delete this.data.body.current_chunk_size;
					} else if (this.data.body.current_chunk_size < 0) {
						throw 'チャンクサイズが合いません';
					}
				} else {
					this.data.body.current_chunk_size = parseInt(line, 16);
					if (this.data.body.current_chunk_size == 0) {
						// 全チャンク取得終了
						delete this.data.body.current_chunk_size;
						this.data.body.size = this.data.body.size.reduce((a, b) => a + b);
						this.push(JSON.stringify(this.data));
						this.init();
						break;
					}

					this.data.body.size.push(this.data.body.current_chunk_size);
					break;
				}
			}
		} else if (this.data.body.size) {
			if (data.length >= this.data.body.size) {
				this.data.body.content = data.slice(0, this.data.body.size);
				data = data.slice(this.data.body.size);
				this.push(JSON.stringify(this.data));
				this.init();
			}
		}
		this.buffer = data;
		cb();
	}

	_flush(cb) {
		this.push(JSON.stringify(this.data));
		this.init();
		if (typeof (cb) === 'function') cb();
	}
}

module.exports = HttpParser
