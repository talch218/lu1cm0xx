# LU1CM0xx library for UART

This library is used for products that can be used only in Japan. Therefore, please forgive the explanation in Japanese.

## Summary
[京セラ製GPSマルチユニット][unit] 「LU1CM0xx」シリーズをUART2系統制御にて利用するためのライブラリです。


## Supported platforms
Raspberry Pi, Node.js v10.15.2で確認。
[serialport][serialport]で動作するUARTが2系統と、[rpi-gpio][gpio]で制御可能なGPIOが⑧本必要です。

## Getting started
### Hardware
UART2系統モデムモードでキッティングされたLU1CM0xxシリーズを下図のように配線してください。
キッティングは、メーカーサポートでお願いします。

なおサンプルでは、下表のようにGPIOと接続し、Raspberry Piのブートコンフィグを次のように行っています。
各自の環境に合わせて、[マニュアル][manual]をもとにカスタムしてください。
特にRaspberry Piのバージョンが異なるとピン配置が異なるので注意してください。

|LU1CM側制御信号|Pin|Raspberry Pi側ピン番号（GPIO番号ではありません）|
|----------:|----|------|
|GND        | 1  | GND  |  
|UART1_CTS  | 2  | 23   |      
|UART1_DSR  | 3  | 12   |       
|UART1_RX   | 4  | 24   |      
|PSM_DISABLE| 5  | 11   |         
|(NC)       | 6  | (NC) |    
|UART2_RX   | 7  | 7    |     
|(NC)       | 8  | (NC) |    
|(NC)       | 9  | (NC) |    
|UART2_TX   | 10 | 29   |      
|UART1_TX   | 11 | 21   |       
|UART1_RTS  | 12 | 19   |        
|UART1_DCD  | 13 | 16   |        
|UART1_DTR  | 14 | 15   |        
|(NC)       | 15 | (NC) |     
|TE_UP      | 16 | 38   |    
|RESET_CHK  | 17 | 40   |        
|(NC)       | 18 | (NC) |     
|PSM_MON    | 19 | (NC) |        
|FUNC_SW    | 20 | 35   |      
|RESET      | 21 | 36   |    
|GND        | 22 | GND  |   


```bash:/boot/config.txt
# [all]セクションに下記を追加
enable_uart=1
dtoverlay=uart4,ctsrts
dtoverlay=uart3
```

### Config
ポートコンフィグファイル
```json:port_config.json
{
	"UART1_DTR": 15,
	"UART1_DCD": 16,
	"TE_UP": 38,
	"RESET_CHK": 40,

	"PSM_DISABLE": 11,
	"UART1_DSR": 12,
	"FUNC_SW": 35,
	"RESET": 36,
	
	"signal_uart": "/dev/ttyAMA1",
	"data_uart": "/dev/ttyAMA2"
}
```

### Get Location
精度5m以内、タイムアウト120秒として、位置情報を取得する

```node
const { Status, By2UART } = require('lu1cm0xx');
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
```

### Write SSL Certificates
HTTPS通信を行うのに必要です。（整備中）

### Post Http(s) Request
POSTメソッドでWebサーバーにデータを送信する。
（実際に[Google][google]へアクセスすると8kb程度の通信が発生します。）

```node
const { Status, By2UART } = require('lu1cm0xx');
const config = require('./port_config.json');

const status = new Status(config);

const log = text => console.log(`[${new Date().toISOString()}] ${text}`);


const print_pin_status_message = (value, pin) => log(pin.description[value + 0]);

status.on('UART1_DCD', print_pin_status_message);
status.on('RESET_CHK', print_pin_status_message);

const gps_unit = new By2UART(config.signal_uart, config.data_uart, status, { echo: true });

(async () => {
    console.log('GPIOの初期化: ' + await status.wait().then(_ => _).catch(_ => _));
    console.log('UARTの初期化: ' + await gps_unit.wait().then(_ => _).catch(_ => _));

    console.log(await status.wait().then(_ => true).catch(_ => false));

    console.log(await gps_unit.getUserDatetime().catch(_ => _));
    await gps_unit.setUserDatetime(new Date());
    console.log(await gps_unit.getNetworkDatetime().catch(_ => _));
    console.log(await gps_unit.getUserDatetime().catch(_ => _));

    console.log(await gps_unit.getSignalQuality().catch(_ => _));

    console.log(await gps_unit.isRadioDisabled().catch(_ => _));
    const temperature = await gps_unit.getTemperature().catch(_ => _);

    console.log(await gps_unit.getModelName().catch(_ => _));
    console.log(await gps_unit.getVersion().catch(_ => _));
    console.log(await gps_unit.getIMEI().catch(_ => 'IMEI取得エラー'));

    console.log(await gps_unit.requestHttp('https://www.google.com', 'POST', {
        message:'Hello, world',
        temperature,
      }).then(data => {
        data.body.content = data.body.content.toString('utf8');
        return data;
      }).catch(err => `HTTPリクエスト失敗: ${err}`));

    await gps_unit.close();
})();
```


[unit]:https://www.kyocera.co.jp/prdct/telecom/office/iot/products/gps_multiunit.html
[serialport]:https://www.npmjs.com/package/serialport
[gpio]:https://www.npmjs.com/package/rpi-gpio
[manual]:https://www.kyocera.co.jp/prdct/telecom/office/iot/development/download/index.html
