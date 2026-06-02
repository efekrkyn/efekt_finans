import sys
import json
import yfinance as yf

def fetch(symbol):
    try:
        t = yf.Ticker(symbol)
        info = t.info
        
        price = info.get('currentPrice') or info.get('regularMarketPrice') or getattr(t.fast_info, 'last_price', None)
        if not price:
            history = t.history(period="1d")
            if not history.empty:
                price = history['Close'].iloc[-1]
                
        prev_close = info.get('previousClose') or getattr(t.fast_info, 'previous_close', None)
        change = 0
        if price and prev_close:
            change = ((price - prev_close) / prev_close) * 100
            
        result = {
            "companyName": info.get('longName') or info.get('shortName') or symbol,
            "currentPrice": float(price) if price else 0,
            "marketCap": info.get('marketCap') or getattr(t.fast_info, 'market_cap', None),
            "currency": info.get('currency', 'USD'),
            "change": float(change),
            "dayHigh": info.get('dayHigh') or getattr(t.fast_info, 'day_high', None),
            "dayLow": info.get('dayLow') or getattr(t.fast_info, 'day_low', None),
            "fiftyTwoWeekHigh": info.get('fiftyTwoWeekHigh') or getattr(t.fast_info, 'year_high', None),
            "fiftyTwoWeekLow": info.get('fiftyTwoWeekLow') or getattr(t.fast_info, 'year_low', None),
            "volume": info.get('volume') or getattr(t.fast_info, 'last_volume', None)
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        fetch(sys.argv[1])
    else:
        print(json.dumps({"error": "No symbol provided"}))
