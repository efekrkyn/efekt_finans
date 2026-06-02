import sys
import json
import datetime
import yfinance as yf

def fetch_history(symbol, days):
    try:
        end = datetime.datetime.now()
        start = end - datetime.timedelta(days=int(days))
        
        t = yf.Ticker(symbol)
        df = t.history(start=start.strftime('%Y-%m-%d'), end=end.strftime('%Y-%m-%d'), interval="1d")
        
        if df.empty:
            print(json.dumps([]))
            return
            
        df = df.dropna(subset=['Close'])
        df = df.reset_index()
        
        points = []
        for _, row in df.iterrows():
            # Handle tz-aware datetime
            date_str = row['Date'].strftime('%Y-%m-%dT%H:%M:%SZ') if hasattr(row['Date'], 'strftime') else str(row['Date'])
            
            points.append({
                "date": date_str,
                "open": float(row['Open']),
                "high": float(row['High']),
                "low": float(row['Low']),
                "close": float(row['Close']),
                "volume": int(row['Volume'])
            })
            
        print(json.dumps(points))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 2:
        fetch_history(sys.argv[1], sys.argv[2])
    else:
        print(json.dumps({"error": "Symbol and days required"}))
