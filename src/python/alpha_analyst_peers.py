"""
AlphaAnalyst Peer Comparison Motoru
Kaynak: kbhujbal/AlphaAnalyst konsepti
Kullanım: python alpha_analyst_peers.py AAPL
"""
import sys
import json
import yfinance as yf

def compare_peers(symbol: str):
    try:
        # Ticker objesi
        ticker = yf.Ticker(symbol)
        info = ticker.info
        
        sector = info.get('sector', 'Bilinmiyor')
        industry = info.get('industry', 'Bilinmiyor')
        
        # Sektör/Endüstri eşlenikleri (Yahoo'dan doğrudan liste almak zor olabilir, sector bilgisi ile benzerleri bulacağız)
        # Yahoo finance info dictionary'de bazen 'industryDisp' vs var ama peer listesi her zaman doğrudan gelmez.
        # Bu yüzden yfinance 0.2+ 'de ticker.get_institutional_holders vs var ancak yfinance peer dönmez.
        # DefeatBeta veya yf info'daki temel rasyoları çekip bir sektör analizi dönebiliriz.
        
        result = {
            "symbol": symbol,
            "sector": sector,
            "industry": industry,
            "metrics": {
                "trailingPE": info.get('trailingPE'),
                "forwardPE": info.get('forwardPE'),
                "priceToBook": info.get('priceToBook'),
                "enterpriseToEbitda": info.get('enterpriseToEbitda'),
                "enterpriseToRevenue": info.get('enterpriseToRevenue'),
                "profitMargins": info.get('profitMargins'),
                "operatingMargins": info.get('operatingMargins'),
                "returnOnAssets": info.get('returnOnAssets'),
                "returnOnEquity": info.get('returnOnEquity'),
            }
        }
        
        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e), "symbol": symbol}))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Kullanım: python alpha_analyst_peers.py <TICKER>"}))
        sys.exit(1)
    
    symbol = sys.argv[1].upper()
    compare_peers(symbol)
