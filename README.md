🦄 Uniswap Tradingview
=====

[![](https://badgen.net/npm/v/uniswap-tradingview )](https://www.npmjs.com/package/uniswap-tradingview ) ![](https://badgen.net/npm/dt/uniswap-tradingview ) 

Financial charts using data from Uniswap and other DEXs. 

## 🛠 Installation
```bash
npm install uniswap-tradingview
```

## Usage

```html
<div id="uniswap_tradingview_chart"></div>
```

```ts
import { UniswapTradingview, Dex } from 'uniswap-tradingview';

const chart = new UniswapTradingview({dex: Dex.UNISWAP});
const pairAddress = '0xa478c2975ab1ea89e8196811f51a7b7ade33eb11';
await chart.createChart('uniswap_tradingview_chart', { width: 400, height: 300 }, pairAddress, '1m', 'LINE');
```

## Examples

### Candle Chart
![Example 1](https://raw.githubusercontent.com/ArkerLabs/uniswap-tradingview/master/docs/example_1.png)

```ts
import { UniswapTradingview, Dex } from 'uniswap-tradingview';

const chart = new UniswapTradingview({dex: Dex.UNISWAP});
const pairAddress = '0xa478c2975ab1ea89e8196811f51a7b7ade33eb11';
await chart.createChart('uniswap_tradingview_chart', { width: 400, height: 300 }, pairAddress, '1w', 'CANDLE');
```

### Line chart
![Example 2](https://raw.githubusercontent.com/ArkerLabs/uniswap-tradingview/master/docs/example_2.png)

```ts
import { UniswapTradingview, Dex } from 'uniswap-tradingview';

const chart = new UniswapTradingview({dex: Dex.UNISWAP});
const pairAddress = '0xa478c2975ab1ea89e8196811f51a7b7ade33eb11';
await chart.createChart('uniswap_tradingview_chart', { width: 400, height: 300 }, pairAddress, '1m', 'LINE');
```