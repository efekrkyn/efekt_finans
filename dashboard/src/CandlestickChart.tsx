import { useEffect, useRef } from 'react';
import { createChart, IChartApi, CandlestickSeries, HistogramSeries } from 'lightweight-charts';

interface OHLC { date: string; open: number; high: number; low: number; close: number; volume: number; }

export function CandlestickChart({ data }: { data: OHLC[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 400,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
      timeScale: { timeVisible: true, borderColor: 'rgba(255,255,255,0.1)' },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#f43f5e',
      borderUpColor: '#10b981', borderDownColor: '#f43f5e',
      wickUpColor: '#10b981', wickDownColor: '#f43f5e',
    });
    candleSeries.setData(data.map(d => ({
      time: d.date.slice(0,10),
      open: d.open, high: d.high, low: d.low, close: d.close
    })) as any);

    const volSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(148, 163, 184, 0.3)',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volSeries.setData(data.map(d => ({
      time: d.date.slice(0,10),
      value: d.volume || 0,
      color: d.close >= d.open ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'
    })) as any);

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  return <div ref={containerRef} style={{ width: '100%', height: 400 }} />;
}
