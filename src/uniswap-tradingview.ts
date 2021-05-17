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

export const SUBGRAPH_HEALTH = gql`
  query health {
    indexingStatusForCurrentVersion(subgraphName: "uniswap/uniswap-v2") {
      synced
      health
      chains {
        chainHeadBlock {
          number
        }
        latestBlock {
          number
        }
      }
    }
  }
`

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
        interval: '1d' | '1w' | '1m' | '1yr',
        type: 'LINE' | 'CANDLE',
    ): Promise<void> {

        this.renderChart(
            container,
            options,
            async () => {
                const data = await this.getHourlyRateData(pairAddress.toLowerCase(), type, interval);
                return data;
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

    private getTimestamps(startTime, interval) {
        const utcEndTime = dayjs.utc();
        let time = startTime;    
        const timestamps = []
        while (time <= utcEndTime.unix()) {
          timestamps.push(time)
          time += interval
        }
        return timestamps;
    }

    private async getLatestBlock(): Promise<string> {
        return (await request('https://api.thegraph.com/index-node/graphql', SUBGRAPH_HEALTH)).indexingStatusForCurrentVersion.chains[0].latestBlock.number;
    }

    private async getHourlyRateData(pairAddress, type: 'LINE' | 'CANDLE', interval: '1d' | '1w' | '1m' | '1yr') {
      try {
        
        const timestamp = Math.round(new Date().getTime() / 1000);

        let timestamps = [];

        if (interval == '1d') {
            const startTime = timestamp - (24 * 3600); // 1 day
            timestamps = this.getTimestamps(startTime, 600);
        } else if (interval == '1w') {
            const startTime = timestamp - (7 * 24 * 3600); // 7 days
            timestamps = this.getTimestamps(startTime, 3600);
        } else if (interval == '1m') {
            const startTime = timestamp - (31 * 24 * 3600); // 31 days
            timestamps = this.getTimestamps(startTime, 3600);
        } else if (interval == '1yr') {
            const startTime = timestamp - (365 * 24 * 3600); // 365 days
            timestamps = this.getTimestamps(startTime, 24 * 3600);
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

        const latestBlock = await this.getLatestBlock();
        if (latestBlock) {
            blocks = blocks.filter((b) => {
              return parseFloat(b.number) <= parseFloat(latestBlock)
            })
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

        values = values.sort((a,b) => (a.timestamp > b.timestamp) ? 1 : ((b.timestamp > a.timestamp) ? -1 : 0));


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
