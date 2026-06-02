import sys
import json
try:
    from defeatbeta_api.data.ticker import Ticker
except ImportError:
    print(json.dumps({"error": "defeatbeta_api not installed"}))
    sys.exit(1)

def get_data(symbol):
    try:
        t = Ticker(symbol)
        price_df = t.price()
        current_price = None
        if price_df is not None and not price_df.empty:
            current_price = float(price_df['close'].iloc[-1])
            
        result = {
            "symbol": symbol,
            "price": current_price,
            "market_cap": t.market_capitalization(),
            "pe_ratio": t.ttm_pe(),
            "pb_ratio": t.pb_ratio(),
            "roe": t.roe(),
            "roa": t.roa(),
            "debt_to_equity": t.debt_to_equity(),
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        get_data(sys.argv[1])
    else:
        print(json.dumps({"error": "No symbol provided"}))
