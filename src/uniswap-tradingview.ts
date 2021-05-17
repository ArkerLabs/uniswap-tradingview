import { Config } from './config';
import { ChartOptions, createChart, CrosshairMode, DeepPartial, IChartApi } from 'lightweight-charts';
import { request } from 'graphql-request';
import gql from 'graphql-tag';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

export const HOURLY_PAIR_RATES = (pairAddress, blocks) => {
    let queryString = 'query blocks {'
    queryString += blocks.map(
      (block) => `
        t${block.timestamp}: pair(id:"${pairAddress}", block: { number: ${block.number} }) { 
          token0Price
          token1Price
        }
      `
    )
  
    queryString += '}'
    return gql(queryString)
}

export const GET_BLOCKS = (timestamps) => {
    let queryString = 'query blocks {'
    queryString += timestamps.map((timestamp) => {
      return `t${timestamp}:blocks(first: 1, orderBy: timestamp, orderDirection: desc, where: { timestamp_gt: ${timestamp}, timestamp_lt: ${
        timestamp + 600
      } }) {
        number
      }`
    })
    queryString += '}';
    return gql(queryString)
  }

export class UniswapTradingview {

    private lastChart: IChartApi;
    private lastSeries;

    constructor(private readonly config: Config) {
        dayjs.extend(utc);
    }

    async createChart(
        container: string | HTMLElement,
        options: DeepPartial<ChartOptions>,
        pairAddress: string,
        interval: '1d' | '1w' | '1m' | 'ALL',
        type: 'LINE' | 'CANDLE',
    ): Promise<void> {

        this.renderChart(
            container,
            options,
            async () => {
                const timestamp = Math.round(new Date().getTime() / 1000);
                const from = timestamp - (7 * 24 * 3600); // 7 days
                const data = await this.getHourlyRateData(pairAddress.toLowerCase(), from, type);
                return data.sort((a,b) => (a.time > b.time) ? 1 : ((b.time > a.time) ? -1 : 0));
            },
            type
        );
    }

    private async renderChart(
        container: string | HTMLElement,
        options: DeepPartial<ChartOptions>,
        data: () => Promise<any[]>,
        type: 'LINE' | 'CANDLE',
    ) {
        if (this.lastChart) {
            this.lastChart.removeSeries(this.lastSeries);
        } else {
            const defaultOptions: DeepPartial<ChartOptions> = {
                crosshair: {
                    mode: CrosshairMode.Normal,
                },
                timeScale: {
                    timeVisible: true,
                    secondsVisible: false,
                }
            };
            this.lastChart = createChart(container, {
                ...defaultOptions,
                ...options
            });;
        
        }
        if (type == 'CANDLE') {
            this.lastSeries = this.lastChart.addCandlestickSeries({
                upColor: 'green',
                downColor: 'red',
                borderDownColor: 'red',
                borderUpColor: 'green',
                wickDownColor: 'red',
                wickUpColor: 'green',
            });
        } else {
            this.lastSeries = this.lastChart.addLineSeries();
        }
        this.lastSeries.setData(await data());
    }

    private async splitQuery(query, localClient: 'ETH' | 'DEX', vars, list, skipCount = 100) {
        let fetchedData = {}
        let allFound = false
        let skip = 0
      
        while (!allFound) {
          let end = list.length
          if (skip + skipCount < list.length) {
            end = skip + skipCount
          }
          let sliced = list.slice(skip, end)
          let result = await request(
                localClient == 'ETH' ? 'https://api.thegraph.com/subgraphs/name/blocklytics/ethereum-blocks' : this.config.dex.toString(),
                query(...vars, sliced),
          );
          fetchedData = {
            ...fetchedData,
            ...result,
          }
          if (Object.keys(result).length < skipCount || skip + skipCount > list.length) {
            allFound = true
          } else {
            skip += skipCount
          }
        }
      
        return fetchedData
      }

    private async getBlocksFromTimestamps(timestamps, skipCount = 500) {
        if (timestamps?.length === 0) {
          return []
        }
      
        let fetchedData = await this.splitQuery(GET_BLOCKS, 'ETH', [], timestamps, skipCount)
        let blocks = []
        if (fetchedData) {
          for (var t in fetchedData) {
            if (fetchedData[t].length > 0) {
              blocks.push({
                timestamp: t.split('t')[1],
                number: fetchedData[t][0]['number'],
              })
            }
          }
        }
        return blocks
    }

    private async getHourlyRateData(pairAddress, startTime, type: 'LINE' | 'CANDLE') {
      try {
        const utcEndTime = dayjs.utc();
        let time = startTime
    
        // create an array of hour start times until we reach current hour
        const timestamps = []
        while (time <= utcEndTime.unix()) {
          timestamps.push(time)
          time += 3600
        }
    
        // backout if invalid timestamp format
        if (timestamps.length === 0) {
          return []
        }
    
        // once you have all the timestamps, get the blocks for each timestamp in a bulk query
        let blocks;
        blocks = await this.getBlocksFromTimestamps(timestamps, 100)
        // catch failing case
        if (!blocks || blocks?.length === 0) {
          return []
        }
    
        const result = await this.splitQuery(HOURLY_PAIR_RATES, 'DEX', [pairAddress], blocks, 100)
    
        // format token ETH price results
        let values = []
        for (var row in result) {
          let timestamp = row.split('t')[1]
          if (timestamp) {
            values.push({
              timestamp,
              rate0: parseFloat(result[row]?.token0Price),
              rate1: parseFloat(result[row]?.token1Price),
            })
          }
        }

        if (type == 'LINE') {
            let linear = [];
            for (let i = 0; i < values.length - 1; i++) {
                linear.push({
                    time: parseFloat(values[i].timestamp),
                    value: parseFloat(values[i].rate0),
                })
            }
            return linear;
        }
    
        let formattedHistoryRate0 = []
        // for each hour, construct the open and close price
        for (let i = 0; i < values.length - 1; i++) {
            const rate0 = parseFloat(values[i].rate0);
            const rate0Next = parseFloat(values[i + 1].rate0);
            formattedHistoryRate0.push({
                time: parseFloat(values[i].timestamp),
                open: rate0,
                low: rate0,
                close: rate0Next,
                high: rate0Next,
            });
        }
        return formattedHistoryRate0;
      } catch (e) {
        console.log(e)
        return []
      }
    }
}
